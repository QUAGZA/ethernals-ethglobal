# PRD A: TaskEscrow, sandbox verifier and Namera spend guard (Dev A)

> **For the coding agent:** this file is your whole brief. Build everything below on the git branch
> **`feat/proof-escrow-verifier`** (create it from `main`). Before writing code, read:
> 1. `docs/proof-of-work/PLAN.md`: the direction, the partner map, the split with Dev B, and the checkpoints.
> 2. `packages/contracts/contracts/ITaskEscrow.sol`: the **frozen** escrow interface you must implement exactly.
> 3. `packages/shared/src/tasks.ts`: the **frozen** verifier HTTP API types, `VerificationResult`, `canonicalJson`, and the **`SpendGuard` types** your Namera package implements.
> 4. `PRD.md` §6 (the counting rule) and `README.md`, for context on Ethernals v1.
> 5. Existing code to reuse as examples: `apps/server/src/ledger.ts` (viem write queue), `apps/server/src/ens.ts` (Sepolia writes), `apps/server/src/payments.ts` (x402 seller middleware on Hedera), `apps/server/src/hedera.ts`, and `packages/contracts` (Hardhat setup and tests).
> 6. Namera docs: `https://namera.ai/llms-full.txt` (the whole documentation, one page) and `https://namera.ai/docs/sdk/getting-started`.
>
> **Hard rules**
> - Edit only `packages/contracts/**` (never `ITaskEscrow.sol`), `apps/verifier/**` (new), `packages/spend-guard/**` (new), `demo/tasks/**` (new), `docs/proof-of-work/NAMERA-SETUP.md` and `VERIFIER.md`, and the root `package.json` scripts.
> - Do **not** edit `apps/server/**`, `apps/web/**`, `packages/shared/src/tasks.ts`, `packages/shared/src/task-escrow-abi.ts` or `.env.example`. Every env var you need is already in `.env.example`. If you truly need an interface change, stop and tell the human, because it needs Dev B's agreement.
> - Read code from `apps/server`, but do not import it. Copy the small helpers you need.
> - Commit small and often, with clear messages.

## 1. Mission

Make agent money **safe and conditional**:
- a **Sepolia** escrow that only the verifier can settle;
- a Docker sandbox verifier that applies a patch, runs **hidden tests** with no network, signs PASS or FAIL, settles the escrow, and answers ERC-8004 validation requests;
- a **Namera spend guard**: client agents fund bounties through a smart account and a session key whose on-chain policy limits what they can do;
- a demo code-fix task with a strong and a weak reference patch.

**Why Sepolia and not Hedera:** Namera supports Ethereum, Sepolia, Base, Base Sepolia, Arbitrum, OP and Arc. It does not support Hedera. Put the escrow where Namera's policy can govern it. Payments (x402) and the HireLedger remain on Hedera; Dev B owns those.

## 2. Priorities

P0 = must ship · P1 = should ship · P2 = stretch.

## 3. Hour-0 spikes (do these first; report results in the team chat)

1. **Namera on Sepolia (P0, 45 min).** In `dashboard.namera.ai`: create an account, create a session key, and approve its installation on **Sepolia** (`eip155:11155111`). Create an API key restricted to that session key. Then, with `@namera-ai/sdk` (`new NameraClient({ apiKey })`), run `executions.execute({ namespace: "eip155", walletId, sessionKeyId, chainId: "eip155:11155111", calls, sponsor: true })` and poll `executions.getStatus(submissionId)` until `confirmed` or `failed`. Record these answers:
   - the exact policy names the dashboard offers (the docs mention `contract-access`, `erc20-token-transfer`, `usdc-allowance`, `lifetime-allowance`, `rate-limit`, `token-contract-address`);
   - whether an ERC-20 **`approve(escrow, amount)`** counts toward the token allowance, or only `transfer` does;
   - whether `calls: [approve, createTask]` runs as one batched operation;
   - whether `sponsor: true` works on Sepolia;
   - how a policy violation comes back (error code and message), so you can map it to `blocked`.
2. **Docker on the demo laptop (P0, 20 min).** `docker run --rm hello-world`. On Windows, test a bind mount with a Windows path.

If Namera cannot enforce a token cap on `approve`, do not stall: ship the guard with `contract-access` + `rate-limit` + expiry enforced by Namera, add an **amount cap checked inside `NameraGuard` before submission** (clearly labelled `rule: "local-cap"`), and tell the human.

## 4. Deliverables

### A1. Contracts (P0): `packages/contracts/contracts/`

**`MockUSDC.sol`** ("Test USDC", symbol `tUSDC`, 6 decimals):
- Use OpenZeppelin ERC20: `pnpm --filter @ethernals/contracts add -D @openzeppelin/contracts`.
- `mint(address to, uint256 amount)` is open to anyone (a testnet faucet), but reverts if `amount > 1_000_000_000` (1,000 tUSDC). This must match `MOCK_USDC_MINT_CAP` in `tasks.ts`.

**`TaskEscrow.sol is ITaskEscrow`**, using OpenZeppelin `SafeERC20` and `ReentrancyGuard`:
- `constructor(address token_, address validator_)`, an `owner`, and `setValidator(address)` (onlyOwner).
- State machine, exactly as in the interface:
  - `createTask`: requires `bounty > 0`, `deadline > block.timestamp` and `specHash != 0`; pulls the bounty with `safeTransferFrom(msg.sender, this, bounty)`; ids start at **1**; emits `TaskCreated`.
  - `acceptTask`: status `Open`, `block.timestamp <= deadline`. If `task.specialist != 0`, then `msg.sender` must equal it; otherwise set `task.specialist = msg.sender`. Status becomes `Accepted`.
  - `submitResult`: status `Accepted`, `msg.sender == task.specialist`, before the deadline, `patchHash != 0`. Status becomes `Submitted`.
  - `settle`: onlyValidator, status `Submitted` (allowed after the deadline too, unless refunded). **PASS** → status `Passed`, bounty to the specialist. **FAIL** → status `Failed`, bounty refunded to the client. Store `resultHash`; emit `TaskSettled`.
  - `refund`: only the client. Allowed when status is `Open` or `Accepted` and `now > deadline`, or `Submitted` and `now > deadline + 30 minutes` (`VERIFY_GRACE`). Status becomes `Refunded`; emit `TaskRefunded`.
- Custom errors for every revert (`NotValidator`, `BadStatus(Status have)`, `NotSpecialist`, `DeadlinePassed`, `TooEarly`, `NotClient`, `ZeroValue`). ERC-20 only, no native value.

**Tests** (`packages/contracts/test/TaskEscrow.test.cjs`, Hardhat + `node:assert`, same style as `HireLedger.test.cjs`): the happy path with balances; FAIL refunds the client; open tasks accepted by anyone, directed tasks reject others; only the validator settles, and settling twice reverts; refund timing including the 30-minute grace; submit after the deadline reverts; the mint cap. The 9 existing HireLedger tests must stay green.

**ABI export:** extend `packages/contracts/scripts/export-abi.cjs` so it also writes `apps/verifier/src/generated/artifacts.ts` with the `TaskEscrow` and `MockUSDC` ABI and bytecode (for the deploy script). Do not change what it writes to `packages/shared`.

### A2. Deploy and setup scripts (P0): `apps/verifier/scripts/`

Root aliases already exist: `deploy:escrow`, `verifier:setup`, `verifier:image`, `verifier:dev`.

- **`setup.ts`** (`pnpm verifier:setup`): idempotent, plain-English output in the style of `apps/server/scripts/doctor.ts`.
  1. If `VERIFIER_PRIVATE_KEY` is empty, generate an ECDSA key and write it into the root `.env`; same for `VERIFIER_TOKEN` (random 32 bytes, base64url). Write a small `.env` writer like `writeEnvValue` in `apps/server/src/config.ts`.
  2. **Sepolia:** send 0.03 ETH from `SEPOLIA_PRIVATE_KEY` to the validator address if its balance is below 0.01. The validator uses ETH for `settle` and the ERC-8004 response.
  3. **Hedera (P1, for paid verification):** create a Hedera account for the verifier's fee income (copy the account-creation helper from `apps/server/src/hedera.ts`, with the USDC association), and write `VERIFIER_HEDERA_PAYTO` into `.env`.
  4. Report Docker availability and whether `VERIFIER_IMAGE` exists; if not, print the fix `pnpm verifier:image`.
- **`deploy-escrow.ts`** (`pnpm deploy:escrow`): deploy `MockUSDC`, then `TaskEscrow(mockUsdc, validatorAddress)`, to **Ethereum Sepolia** with viem and `SEPOLIA_PRIVATE_KEY` (RPC `SEPOLIA_RPC_URL`). Write `MOCK_USDC_ADDRESS` and `TASK_ESCROW_ADDRESS` into `.env`, print Etherscan links, and remind the human to **post both addresses in the team chat** for Dev B.

### A3. The verifier service (P0): new package `apps/verifier` (`@ethernals/verifier`)

Stack: Node 22, TypeScript (`type: module`), Express 5, `tsx`, viem, zod, `dotenv` (load the root `.env`, as `apps/server/src/config.ts` does), vitest. Scripts: `dev` (`tsx watch src/index.ts`), `start`, `test`, `typecheck`, and `image` (`docker build -t ${VERIFIER_IMAGE:-ethernals-pytest:latest} sandbox`), all written as Windows-friendly Node scripts. It listens on `VERIFIER_PORT` (4100). **Implement the API exactly as typed in `tasks.ts`.**

| Endpoint | Behaviour |
|---|---|
| `GET /health` | `VerifierHealth` (`escrowChain` is `eip155:11155111`; `paidVerify` is non-null when P1 is on). No auth. |
| `POST /tests` | Body `HiddenTestsBundle`. At most 20 files and 200 KB. Paths relative, using `/`, no `..`. Store under `VERIFIER_DATA_DIR` (default `./data/verifier`, git-ignored). `testsHash = keccak256(utf8(canonicalJson({ files: sortedByPath })))`. Return `UploadTestsResponse`. **Never return or log the contents.** |
| `POST /verify` | Body `VerifyRequest`; patch at most 200 KB. Return `202 { jobId }` and queue the job (concurrency 2). |
| `GET /jobs/:jobId` | `VerifyJob`, including `logTail` (last 200 lines). |
| `GET /jobs/:jobId/events` | SSE; each `data:` is one `VerifierEvent`. Replay events so far on connect, then stream live. Heartbeat comment every 20 s, `cache-control: no-cache, no-transform`. |
| `GET /results/:jobId.json` | The signed `VerificationResult` (public, no auth). This URL is the on-chain `resultURI`. |

Every endpoint except `/health` and `/results` needs the header `x-verifier-token: $VERIFIER_TOKEN`, otherwise answer 401. Persist jobs as JSON files in `VERIFIER_DATA_DIR/jobs/`.

**The job pipeline** (emit `status` / `log` / `result` / `settled` / `erc8004` / `error` events at each step):
1. **Check the request against the chain** (Sepolia): `TaskEscrow.getTask(chainTaskId)` must be `Submitted` with `task.patchHash == keccak256(utf8(patch))` and `task.testsHash == request.testsHash`; the stored bundle's hash must also equal `testsHash`. On any mismatch → status `error`, no settlement.
2. **Prepare the workspace** in a fresh temp directory (`os.tmpdir()/ethernals-verify/<jobId>`), deleted in `finally`. Only `https://github.com/...` repo URLs. Clone with `git -c core.autocrlf=false clone --quiet <repoUrl> repo`, then `git -c advice.detachedHead=false checkout <baseCommit>`.
3. **Apply the patch:** `git apply --check`, then `git apply`. If it fails → result FAIL with `failureReason "patch_did_not_apply"`; still sign it and settle FAIL.
4. **Add the hidden tests:** write the bundle's files into the repo (overwriting is allowed; reject paths outside the repo).
5. **Run the tests (`VERIFIER_MODE=docker`, default):**
   ```
   docker run --rm --name ev-<jobId> --network none --cpus 1 --memory 512m --pids-limit 256 \
     --security-opt no-new-privileges --cap-drop ALL -e PYTHONDONTWRITEBYTECODE=1 \
     -v <repo>:/work -v <out>:/out -w /work <VERIFIER_IMAGE> \
     sh -c "<testCommand or 'pytest -q'> -p no:cacheprovider --junitxml=/out/junit.xml"
   ```
   Stream stdout and stderr as `log` events (strip ANSI codes, cap lines at 500 characters, keep at most 2,000 lines). Enforce `VERIFIER_TIMEOUT_SECONDS`: on timeout, `docker kill ev-<jobId>` → FAIL `"timeout"`. On Windows with Docker Desktop, pass absolute Windows paths to `-v`.
6. **`VERIFIER_MODE=local` (development only):** run the same command with `child_process` in the repo directory, same timeout, `isolation: "none"`. Log a loud warning at startup; `/health` reports `mode: "local"`.
7. **Grade:** parse `junit.xml` for tests, failures, errors. `passed = exitCode === 0 && failures + errors === 0 && tests > 0`. `failureReason`: `null` if passed; else `"tests_failed"`, `"timeout"` or `"patch_did_not_apply"`.
8. **Sign:** build a `VerificationResult` without `signature`; `resultHash = keccak256(utf8(canonicalJson(result)))`; `signature = account.signMessage({ message: { raw: resultHash } })` with the `VERIFIER_PRIVATE_KEY` account. Save to `VERIFIER_DATA_DIR/results/<jobId>.json`; `resultUrl = ${VERIFIER_PUBLIC_URL}/results/<jobId>.json`. Emit `result`.
9. **Settle on Sepolia:** `TaskEscrow.settle(chainTaskId, passed, resultHash, resultUrl)` from the validator key, through **one serial write queue** shared with the ERC-8004 response. Wait for the receipt, store `settleTxHash`, emit `settled`. On failure retry 3 times with backoff, then mark the job `error` but keep the signed result.
10. **ERC-8004 on Sepolia (P0 if `erc8004RequestHash` is set):** call `validationResponse(requestHash, passed ? 100 : 0, resultUrl, resultHash, "hidden-tests")` on `ERC8004_VALIDATION_REGISTRY` from the validator key. Store `erc8004TxHash`, emit `erc8004`. The ABI is in `vendor/erc8004/abis/ValidationRegistry.json` (clone `github.com/erc-8004/erc-8004-contracts` if you don't have it). Dev B's server creates the **request** with `validationRequest(validatorAddress, agentId, requestURI, requestHash)`, using the address from your `/health`.
11. **Final status:** `passed` or `failed`. Always delete the workspace.

**Sandbox image** (`apps/verifier/sandbox/Dockerfile`): `python:3.12-slim`, `pip install --no-cache-dir "pytest==8.*"`, a non-root user, `WORKDIR /work`. `pnpm verifier:image` builds it.

**Unit tests (vitest), no chain needed (inject a fake chain client):** tests-bundle hashing matches `canonicalJson`; path traversal rejected; the junit parser handles pass, fail and error; `resultHash` is computed without the signature and the signature recovers to the validator; the job state machine; the `local` mode run on the demo task (good patch → PASS, weak patch → FAIL).

### A4. The Namera spend guard (P0): new package `packages/spend-guard` (`@ethernals/spend-guard`)

Namera gives a person a **smart account** and gives the agent only a **session key** with on-chain permissions. The agent can spend only what the policy allows, and the owner can revoke it any time. Build the `SpendGuard` implementation Dev B plugs into the server.

- Dependencies: `@namera-ai/sdk`, `viem`, `@ethernals/shared` (workspace). TypeScript, `type: module`, `main: ./src/index.ts` like `packages/shared`. Add `test` and `typecheck` scripts.
- **Export `createNameraGuard(opts): SpendGuard`**, with `opts = { apiKey: string; walletId: string; sessionKeyId: string; apiUrl?: string; client?: NameraLike }` (`client` is for tests):
  - `kind` is `"namera"`.
  - `address()` returns the wallet's address from `namera.wallets.list()`, matched by `walletId`.
  - `policy()` reads `namera.sessionKeys.list()`, finds `sessionKeyId`, and takes the installation for `eip155:11155111`. It maps the `authorization.permissions` to `SpendPolicyView`: `contract-access` addresses → `allowedContracts`; the token or USDC allowance permission → `tokenAllowanceUsdc` (convert atomic units to a decimal string); a rate limit → `rateLimit`; `validUntil` (unix seconds) → ISO string; `status` from the key and installation; `source: "namera-api"`. Use the names you recorded in the spike. If a field isn't present, return `null`.
  - `execute(request)`:
    1. Convert `request.calls` to Namera calls (`value` strings become `bigint`). Call `executions.execute({ namespace: "eip155", walletId, sessionKeyId, chainId: request.chainId, calls, sponsor: true })`.
    2. If the SDK returns `success: false` or the status becomes `failed`, classify the error: policy violations (permission, allowance, rate limit, expired or revoked key, contract not allowed) → `{ status: "blocked", reason, rule }`, where `rule` is a short code you derive from the error such as `"contract-access"`, `"token-allowance"`, `"rate-limit"` or `"expired"`; everything else → `{ status: "failed", error }`.
    3. Poll `getStatus(submissionId)` every 2 s, for at most 120 s, until `confirmed` or `failed`. On `confirmed` return `{ status: "confirmed", txHash, submissionId }`, with the transaction hash from the execution record.
    4. Never throw for policy blocks and never log the API key.
- **Unit tests** with a fake `NameraLike`: confirmed, blocked (each rule), failed, timeout, the policy mapping.
- **`scripts/spend-selftest.ts`** (`pnpm --filter @ethernals/spend-guard exec tsx scripts/spend-selftest.ts`), reading `NAMERA_TEST_API_KEY`, `NAMERA_TEST_WALLET_ID` and `NAMERA_TEST_SESSION_KEY_ID` from `.env` (already listed, empty, in `.env.example`; explain them in `NAMERA-SETUP.md`):
  1. mint tUSDC to the Namera account from the platform wallet;
  2. `approve + createTask` of 2 tUSDC → expect `confirmed`;
  3. a bounty above the cap → expect `blocked`;
  4. a call to a contract not on the allowlist → expect `blocked`.
  Print each outcome with a plain-English label. Needs the deployed escrow.
- **`docs/proof-of-work/NAMERA-SETUP.md`**, in plain English, step by step: create the Namera account; create an account (smart account) and fund it with a little Sepolia ETH only if sponsorship doesn't cover gas; create the session key with the recommended policy (**contract access: tUSDC and TaskEscrow; token allowance: 10 tUSDC for the key's lifetime; rate limit: about 5 per hour; expiry: 24 hours**) using the exact dashboard names you saw; approve its installation on **Sepolia**; create an API key restricted to that session key; copy the three values (API key, wallet id, session key id) that the person pastes on `/me`. Include screenshots-by-words of what each screen looks like, and the common errors.

### A5. The demo task (P0): `demo/tasks/slugify/`

Create these files exactly. The repo part is pushed to GitHub as a **public** repo, for example `ethernals-demo-slugify` on the team's account. The human does the push, so print instructions.

```
demo/tasks/slugify/
  repo/                       ← contents of the public demo repo
    README.md                 ← short; includes the issue text below
    pytest.ini                ← "[pytest]\npythonpath = ."
    textkit/__init__.py       ← empty
    textkit/slugify.py        ← BUGGY version below
    tests/test_slugify.py     ← public tests (they PASS on the buggy version)
  hidden_tests/
    tests_hidden/test_slugify_hidden.py   ← hidden tests (never pushed to the public repo)
  issue.md
  good.patch                  ← reference fix: passes everything (git diff against the repo's first commit)
  weak.patch                  ← passes the public tests, FAILS the hidden ones
  task.json                   ← { "title", "issue", "repoUrl", "baseCommit", "testCommand": "pytest -q" }
```

`textkit/slugify.py` (buggy):
```python
def slugify(text: str) -> str:
    """Turn a title into a URL slug, e.g. "Hello World" -> "hello-world"."""
    return text.strip().lower().replace(" ", "-")
```

`tests/test_slugify.py` (public):
```python
from textkit.slugify import slugify

def test_simple():
    assert slugify("Hello World") == "hello-world"

def test_lowercase():
    assert slugify("ETHGlobal") == "ethglobal"
```

`issue.md`: *"slugify() breaks on real titles. Punctuation stays in, repeated spaces turn into repeated hyphens, and accented letters are kept. A slug must contain only a–z, 0–9 and single hyphens, with no hyphen at the start or end; accented letters become their plain letter (é → e). An input with no letters or digits gives an empty string."*

`tests_hidden/test_slugify_hidden.py`:
```python
import pytest
from textkit.slugify import slugify

@pytest.mark.parametrize("text,expected", [
    ("Hello, World!", "hello-world"),
    ("  many   spaces  ", "many-spaces"),
    ("Crème Brûlée", "creme-brulee"),
    ("a--b__c", "a-b-c"),
    ("ETHGlobal Mumbai 2026", "ethglobal-mumbai-2026"),
    ("!!!", ""),
    ("", ""),
])
def test_hidden(text, expected):
    assert slugify(text) == expected
```

`good.patch` makes `slugify.py`:
```python
import re
import unicodedata

def slugify(text: str) -> str:
    """Turn a title into a URL slug, e.g. "Hello World" -> "hello-world"."""
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", "-", ascii_text.lower()).strip("-")
```

`weak.patch` makes `slugify.py` (it fails `"  many   spaces  "` and `"Crème Brûlée"`):
```python
import re

def slugify(text: str) -> str:
    """Turn a title into a URL slug, e.g. "Hello World" -> "hello-world"."""
    return re.sub(r"[^a-z0-9 ]", "", text.strip().lower()).replace(" ", "-")
```

**Steps:**
1. Make `repo/` a git repo with one commit, so the patches apply with `git apply` against it. Generate both patches with `git diff`, with LF line endings.
2. After the human pushes it, fill `repoUrl` and `baseCommit` (the full SHA) in `task.json`.
3. Add `apps/verifier/scripts/selftest.ts` (`pnpm --filter @ethernals/verifier exec tsx scripts/selftest.ts`). It runs the good and weak patches through the pipeline **without the chain steps**, in the configured mode. It must print good = PASS and weak = FAIL.

### A6. Root wiring (P0, once the verifier runs)

The root `package.json` `dev` and `start` scripts also start the verifier: add `"pnpm --filter @ethernals/verifier dev"` (and `start`) as a third `concurrently` entry named `verifier`. Do this only after `apps/verifier` exists, because `concurrently -k` stops everything if one entry exits.

### A7. x402-paid verification (P1): another Hedera payment

Agents should pay validators too. Add `POST /verify-paid` to the verifier:
- It takes the same body as `/verify`, with no `x-verifier-token`, and is gated by **x402 on Hedera**: price `VERIFIER_FEE_USDC` (default 0.02) in the Hedera USDC token, paid to `VERIFIER_HEDERA_PAYTO`.
- Copy the seller middleware pattern from `apps/server/src/payments.ts` (`HTTPFacilitatorClient`, `x402ResourceServer`, `ExactHederaScheme`, `paymentMiddleware`). Packages: `@x402/core`, `@x402/express`, `@x402/hedera`, as in `apps/server/package.json`.
- It returns `202 { jobId }`. Unpaid requests get a normal 402 quote.
- `/health.paidVerify` reports `{ feeUsdc, payTo, network: "hedera:testnet" }`.
- Dev B's specialist agents call it with their own x402 client, so the specialist pays the validator out of its attempt fee. Both payments show on HashScan.

### A8. Stretch (P2)

- **Reveal after settlement:** `GET /jobs/:jobId/tests` returns the hidden tests after settlement, so anyone can audit them against `testsHash`.
- **IPFS pinning** of the result JSON (keep the HTTP URL as the fallback).

## 5. Milestones (IST)

| By | Done when |
|---|---|
| **Hour-0 07:30–08:30** | Spikes reported (Namera policy semantics, Docker) |
| **CP1 10:30** | Contracts and tests green; `pnpm deploy:escrow` deployed to **Sepolia**; both addresses posted in the team chat; verifier running in `local` mode, answering `/health`, `/tests`, `/verify` and `/jobs`, with real settlement on Sepolia. Branch pushed |
| **CP2 14:30** | Docker mode works; ERC-8004 response; demo repo pushed with `task.json` filled; `selftest` gives good = PASS and weak = FAIL; **`@ethernals/spend-guard` merged with a passing `spend-selftest` and `NAMERA-SETUP.md`**; root `dev` starts the verifier. **Open the PR to `main` and merge it** |
| **CP3 19:30** | Paid verification (A7); `docs/proof-of-work/VERIFIER.md` (how it works, the security posture, and a plain-English setup section Dev B can paste into `SETUP.md`); joint end-to-end on the demo machine |
| **CP4 23:30** | Bug fixes only |

## 6. Security posture (say this in the README and Q&A)

- **Isolation:** Docker with `--network none`, CPU, memory and pid limits, all capabilities dropped, `no-new-privileges`, and a timeout. Hidden tests never leave the verifier before settlement. The patch must match the hash the specialist committed on-chain.
- **Trust:** one trusted verifier in v1, whose identity is its key, visible on-chain as `validator`. Next: several verifiers, staked re-execution, or TEE attestation.
- **What it doesn't prove:** passing hidden tests proves the patch meets *those tests*, not that the code is perfect.
- **Spending:** the client agent holds a Namera session key, not the owner's key. The policy is enforced on-chain at execution; the owner can revoke the key without moving funds.

## 7. Definition of done (self-check before every PR)

- [ ] `pnpm --filter @ethernals/contracts test` is green (HireLedger + TaskEscrow).
- [ ] `pnpm --filter @ethernals/verifier test`, `pnpm --filter @ethernals/spend-guard test` and `typecheck` are green; `pnpm typecheck` at the root is green.
- [ ] `selftest`: good = PASS, weak = FAIL, in Docker mode.
- [ ] `spend-selftest`: in-policy bounty confirmed, over-cap blocked, off-allowlist call blocked.
- [ ] A real run on Sepolia: createTask → accept → submit → `/verify` → `TaskSettled`, visible on Etherscan, plus the ERC-8004 response.
- [ ] No edits outside the folders you own; the frozen files are unchanged (`git diff main -- packages/shared/src/tasks.ts packages/contracts/contracts/ITaskEscrow.sol .env.example` is empty).
- [ ] No secrets committed; `data/` stays git-ignored.
