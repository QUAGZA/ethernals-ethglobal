# PRD B: Agents on 0G Compute, x402 on Hedera, tasks and UI (Dev B)

> **For the coding agent:** this file is your whole brief. Build everything below on the git branch
> **`feat/proof-tasks-ui`** (create it from `main`). Before writing code, read:
> 1. `docs/proof-of-work/PLAN.md`: the direction, the partner map, the split with Dev A, and the checkpoints.
> 2. `packages/shared/src/tasks.ts`: the **frozen** task, verifier API, **0G brain** (`InferenceReceipt`, `AgentBrainView`) and **spend guard** (`SpendGuard`, `SpendPolicyView`, `SpendResult`) types; `canonicalJson`.
> 3. `packages/contracts/contracts/ITaskEscrow.sol` and `packages/shared/src/task-escrow-abi.ts`: the **frozen** escrow interface, deployed on **Ethereum Sepolia**.
> 4. `PRD.md` §6 (the counting rule) and `README.md`.
> 5. The existing server, which you extend: `apps/server/src/agent-runtime.ts`, `buyer.ts`, `verifier.ts` (`submitRating` → HireLedger), `ledger.ts`, `ens.ts`, `llm.ts`, `agents.ts`, `api.ts`, `db.ts`, `events.ts`, `payments.ts`.
> 6. The existing web app, which you extend in the same design system: `apps/web/app/*`, `components/*`, `lib/*`.
> 7. 0G Router docs: `https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/overview` (quickstart, authentication, models, provider routing). Namera docs for context: `https://namera.ai/llms-full.txt`.
>
> **Hard rules**
> - Edit only `apps/server/**`, `apps/web/**`, `README.md`, `SETUP.md` and `PRD.md`.
> - Do **not** edit `packages/contracts/**`, `apps/verifier/**`, `packages/spend-guard/**`, `demo/tasks/**`, `packages/shared/src/tasks.ts`, `packages/shared/src/task-escrow-abi.ts`, `.env.example` or the root `package.json`. Every env var you need is already in `.env.example`. If you need an interface change, stop and tell the human.
> - Dev A builds the TaskEscrow contract and tUSDC (on **Sepolia**), the sandbox verifier (`apps/verifier`, HTTP API typed in `tasks.ts`), the Namera guard (`packages/spend-guard`, exports `createNameraGuard`) and the demo task files (`demo/tasks/slugify/`).
>   - Until CP1, code against the types and mock `fetch` in your tests.
>   - At CP1, Dev A posts `TASK_ESCROW_ADDRESS` and `MOCK_USDC_ADDRESS`.
>   - At CP2, merge `main`, add `"@ethernals/spend-guard": "workspace:*"` to `apps/server/package.json`, and switch client funding from your `DirectGuard` to `createNameraGuard` for people who connected Namera.
> - Keep every v1 feature working: the Arena, hires, ENS, World ID. `pnpm test` and `pnpm typecheck` must stay green.
> - Commit small and often, with clear messages.

## 1. Mission

Make the agents themselves the partner-tech showcase:
- **0G Compute:** agents are **spun up on 0G**. Each gets its own API key, thinks only on 0G, leaves a request-id receipt for every call, and earns the credit it thinks with.
- **x402 on Hedera:** every agent-to-agent payment is an x402 payment on Hedera; spend limits are enforced in code.
- **Namera:** the client agent funds bounties through a Namera session key. A bounty over the policy is **blocked**, and the UI shows it.
- The specialist is paid only if the hidden tests pass, and the outcome becomes the hire's rating on the HireLedger (PASS = 5, FAIL = 1), under the v1 counting rule.
- Show it in the UI, including a **Duel** between a strong and a weak agent.

## 2. Priorities

P0 = must ship · P1 = should ship · P2 = stretch.

## 3. Hour-0 spikes (do these first; report results in the team chat)

1. **0G Router (P0, 40 min).**
   - At `pc.testnet.0g.ai` connect a wallet (Google sign-in via Privy works), get testnet tokens from `faucet.0g.ai`, and deposit.
   - Create a management key (`mk-…`) with the scopes `keys:create` and `keys:read` (Settings → Management Keys), and one API key (`sk-…`).
   - **Check that the testnet endpoint is reachable** from the demo laptop: `curl https://router-api-testnet.integratenetwork.work/v1/models`. (It failed a TLS handshake from one machine while the mainnet endpoint worked. If it fails everywhere, **stop and tell the human**: using the mainnet Router means a small real 0G deposit, and only the human may approve that.)
   - Call `POST {ZG_ROUTER_BASE_URL}/chat/completions` with a model from `GET /models`. Prefer `0gm-1.0-35b-a3b` (0G's own model, built for agentic coding and tool use; its `supported_parameters` include `response_format` and `tools`). Thinking models spend many tokens on reasoning, so set `max_tokens` generously (at least 4,000) and `reasoning_effort: "low"` when supported. Non-streaming requests must finish within about 10 minutes.
   - Record: the response `id` (the request id), any `x-*` headers the Router returns (provider address, request id), the `usage` block, and the per-model `pricing` (neuron per token).
   - Find the Router **API reference** in the docs sidebar and work out the `POST /v1/api-keys` request (management key in `Authorization: Bearer mk-…`), so each agent can get its own `sk-` key.
2. **x402 on Hedera (P0, 20 min).** Make one USDC payment against an existing agent with `pnpm agent:hire` (v1), to confirm the facilitator and your Hedera setup work.
3. **Sepolia tooling (P0, 10 min).** Confirm `SEPOLIA_RPC_URL` works with viem for `eth_getLogs`-free calls (you will poll `getTask` state, not logs).

## 4. Deliverables

### B1. Data (P0): `apps/server/src/db.ts`

Add additive migrations (`CREATE TABLE IF NOT EXISTS`; guarded `ALTER TABLE`):
- `tasks`: `id`, `chain_task_id`, `duel_id`, `client_person_id`, `client_agent_key`, `specialist_agent_key` (nullable), `spec_json`, `spec_hash`, `tests_id`, `tests_hash`, `bounty` (atomic), `deadline` (ISO), `status` (`TaskStatus`), `patch`, `patch_hash`, `explanation`, `verify_job_id`, `result_json`, `hire_id`, `create_tx`, `accept_tx`, `submit_tx`, `settle_tx`, `refund_tx`, `erc8004_request_hash`, `erc8004_request_tx`, `erc8004_response_tx`, `error`, `created_at`.
- `duels` (`id`, `created_at`).
- `agent_brain` (`agent_key` PK, `api_key_enc`, `key_label`, `model`, `credit_neuron`, `spent_neuron`, `earned_units`, `credited_from_earnings_neuron`, `last_request_id`).
- `inference_receipts` (`id`, `agent_key`, `task_id`, `purpose`, `model`, `request_id`, `provider`, `prompt_tokens`, `completion_tokens`, `cost_neuron`, `created_at`).
- `spend_accounts` (`person_id` PK, `api_key_enc`, `wallet_id`, `session_key_id`, `wallet_address`, `created_at`).
- `spend_events` (`id`, `person_id`, `task_id`, `guard`, `purpose`, `amount_units`, `status`, `rule`, `reason`, `tx_hash`, `created_at`).
- An agents column `strategy TEXT DEFAULT 'careful'` (`careful` | `weak`).

Encrypt every stored API key with the existing keystore helpers. **Never store hidden-test contents** (only `tests_id` and `tests_hash`) **and never store prompts or completions**: store only the receipts.

### B2. Agents spun up on 0G Compute (P0): new `apps/server/src/brain.ts`

This is the 0G centrepiece. A small module, with plain `fetch` (no new dependency; the Router is OpenAI-compatible).

**Config:** add typed getters in `config.ts` for the variables already in `.env.example` (`ZG_ENABLED`, `ZG_NETWORK`, `ZG_ROUTER_BASE_URL`, `ZG_MANAGEMENT_KEY`, `ZG_API_KEY`, `ZG_MODEL`, `ZG_SEED_CREDIT_NEURON`, `ZG_MIN_CREDIT_NEURON`, `ZG_NEURON_PER_USDC`), with plain-English `ConfigError` hints that point at `SETUP.md`.

**Model:** on boot, `GET /models` (no auth). Use `ZG_MODEL` if set; otherwise prefer `0gm-1.0-35b-a3b`, otherwise the cheapest model that supports `response_format` or JSON output. Cache the pricing table (`pricing.prompt` and `pricing.completion` are neuron per token) and refresh it every 10 minutes.

**Spin-up (`spinUpBrain(agent)`)**, called when a seller agent is created:
1. Create an API key for this agent with the management key (`POST /v1/api-keys`, label = the agent's ENS name). Encrypt and store it. If creation fails, fall back to `ZG_API_KEY` and say so in the event log.
2. Seed the credit: `credit_neuron = ZG_SEED_CREDIT_NEURON`.
3. Make a first call, a "birth" thought (`purpose: "birth"`), e.g. one sentence on what the agent is and what it does. Store the receipt.
4. Write the ENS records `ethernals.brain = "0g-router:<model>"` and `ethernals.earned = "0.00"`.
5. Emit `agent.born` events with `data.step` and `data.message` for each step ("Hedera account ✓", "0G brain key ✓", "ENS ✓", "ERC-8004 ✓", "first thought ✓ request id …") so the UI can show the spin-up live.

**Thinking (`think(agent, { purpose, taskId, messages, maxTokens })`)**:
- Calls the Router with the agent's own key. Retries once on 429 or a 5xx with a short backoff.
- Extracts the text. Reasoning models may wrap their answer: when JSON is expected, take the **last** JSON object in the output.
- Records an `InferenceReceipt`: the response `id` as `requestId`, the provider address if a header or `/providers` gives it, token usage, and `costNeuron = prompt × promptPrice + completion × completionPrice`. Update `spent_neuron` and subtract it from `credit_neuron`. Emit `inference.receipt`.
- Prompt hygiene (same as v1): task text is data; the agent has no tools; hidden tests are never in a prompt.

**Self-funding (the "Agents That Pay for Themselves" story):**
- When an agent earns, credit its brain: `credit += earnedUnits × ZG_NEURON_PER_USDC / 1e6`. Earnings are (a) the x402 attempt fee once the payment is verified on the mirror node (hook into `verifier.ts` after `verifyPaymentOnMirror` succeeds), and (b) the bounty on PASS (from the settlement watcher). Update `ethernals.earned` in ENS.
- **Dormant gating:** before the x402 middleware charges anyone, a pre-check (next to the unknown-agent 404 guard in `index.ts`) returns `503 { error: "agent_dormant" }` if `credit_neuron < ZG_MIN_CREDIT_NEURON`. A buyer must never pay an agent that can't think. The agent page shows "dormant, needs a paid hire to wake".
- **Disclosure (put it in the README):** the conversion rate is internal accounting. The Router balance is the platform's treasury, funded from the testnet faucet. Brain credit tracks what each agent has "earned vs spent".

**Route the existing agents through the brain (P0):** `llm.ts` (`summarize`, `translate`, `judge`) uses `think()` when `ZG_ENABLED=true`, with the agent's own key for seller tasks and the platform key (`ZG_API_KEY`) for the buyer-side judge. If `ZG_ENABLED=false` it keeps the Anthropic/offline behaviour (development only). `AgentBrainView.backend` reports which one is in use.

**API:** `GET /api/agents/:label/brain` → `AgentBrainView`; `GET /api/agents/:label/inference` → `InferenceReceipt[]` (newest first, up to 50).

### B3. Escrow client on Sepolia, through a SpendGuard (P0): new `apps/server/src/escrow.ts`

Use viem on Sepolia (reuse `sepoliaPublic` from `ens.ts`), with `taskEscrowAbi` and `mockUsdcAbi` from `@ethernals/shared` and the addresses from `TASK_ESCROW_ADDRESS` and `MOCK_USDC_ADDRESS` (add `ConfigError` hints).

**Wallets:**
- **Client account:** the funding goes through a `SpendGuard` (below). `task.client` is the guard's `address()`.
- **Specialists:** sign `acceptTask` and `submitResult` with **their own** ECDSA key (decrypt `enc_private_key`; the EVM address is the same on every chain). Fund each new specialist with 0.01 Sepolia ETH from the platform wallet when it is spun up (`ensureSepoliaGas`).
- Every Sepolia transaction goes through the **shared platform write queue** in `ens.ts` (export a helper), or a per-address `SerialQueue`, so no nonce collides.

**Spend guards:**
- **`DirectGuard`** (build it now, you own it): the agent uses its own key on Sepolia. It enforces its own limit (a `MAX_DIRECT_BOUNTY_USDC = 10` constant in code, and a per-hour counter) and returns `blocked` with `rule: "direct-cap"` when exceeded. The UI labels this guard "server-enforced, weaker". Fund the account with 0.01 ETH.
- **`NameraGuard`** comes from Dev A's `@ethernals/spend-guard` (`createNameraGuard({ apiKey, walletId, sessionKeyId })`). A person connects it on `/me` (below). Use it whenever the person has a `spend_accounts` row; otherwise use `DirectGuard`.
- `fundTask(person, bounty, …)` builds `calls = [mockUsdc.approve(escrow, bounty), escrow.createTask(…)]` and sends them with `guard.execute({ chainId: ESCROW_CHAIN_ID, calls, purpose, amountUsdc })`. **Mint first:** the platform wallet calls `mint(guardAddress, amount)` when the account's tUSDC balance is too low (the faucet is open and capped at 1,000 per call). Record every attempt in `spend_events` and emit `spend.allowed` or `spend.blocked`. On `blocked`, the task is **not** created and the API answers 409 with the rule and reason (a normal, displayable outcome).
- After a confirmed spend, read `taskCount()`/the `TaskCreated` event from the transaction receipt to get `chainTaskId`.

**Functions:** `acceptOnChain`, `submitOnChain`, `refundOnChain` (the client's guard sends the refund), `getTaskOnChain`.

**Settlement watcher (`startEscrowWatcher()`, started in `index.ts`):** poll `getTask(chainTaskId)` for every task that is not terminal, every 4 s, and act when the status becomes `Passed`, `Failed` or `Refunded`. State polling avoids `getLogs` range limits on free RPC plans. Get the settle transaction hash and signed result from the verifier job (`GET ${VERIFIER_URL}/jobs/:id`). It must be idempotent: a task settles once.

### B4. Tasks, coding agents and the x402 hire on Hedera (P0)

**Creating a task (`apps/server/src/task-service.ts`)**, `createTask(person, CreateTaskRequest)`:
1. **Spec and hidden tests.** With `template: "slugify"`, read `demo/tasks/slugify/task.json` and the files under `demo/tasks/slugify/hidden_tests/` (repo-relative paths). Otherwise use the request's `spec` and `hiddenTests`, allowing only `https://github.com/` repos.
2. **Upload the hidden tests** to the verifier: `POST ${VERIFIER_URL}/tests` with `x-verifier-token` → `{testsId, testsHash}`.
3. **Hash and link the spec.** `spec = { version: 1, kind: "code-fix", language: "python", ... }`, `specHash = keccak256(utf8(canonicalJson(spec)))`, `specURI = ${PUBLIC_BASE_URL}/api/tasks/<id>/spec.json`.
4. **Fund the bounty** with B3's `fundTask`. Status goes `creating` → `open`. Emit `task.created`. If the guard blocks it, return the block (see above); the task row is saved with status `error` and the `spend` entry so the UI can show it.

**Specialist agents.** Code-fix agents are seller agents with `task_type = "code-fix"`.
- `/provider` gets the option "Code fix (Python)" with a default base price of `0.05` USDC, the **x402 attempt fee**, reputation-priced by the HireLedger as in v1.
- Creation runs the whole **spin-up** with live `agent.born` events: Hedera account (v1) → ledger registration (v1) → **0G brain key + first thought (B2)** → Sepolia gas → **ERC-8004 identity** on Sepolia (`register(agentURI)` from the platform wallet with a data-URI JSON holding the ENS name, endpoint and capabilities; copy the pattern from `apps/server/src/arena.ts`; store `erc8004_agent_id`) → ENS records.
- ENS records: `ethernals.capabilities = "code-fix:python"`, `ethernals.validation = "hidden-tests:docker"`, `ethernals.erc8004 = "eip155:11155111:<identity registry>:<agentId>"`, `ethernals.brain`, `ethernals.earned`, and `ethernals.tasks.passed` / `.failed` = `0`.

**Hiring (the x402 attempt fee).** `POST /api/tasks/:id/hire {specialist}`:
- The client's buyer agent calls `hireAsAgent` against the specialist's endpoint `POST /a/<label>/task` with body `{ taskId, buyerAgent, consent }`. This pays the x402 attempt fee in USDC on Hedera, with the budget policy (`maxUnits`) from v1.
- Do **not** auto-rate it; the rating comes from the verifier outcome (B5). Store `hire_id` on the task.

**The code-fix runtime**, inside `handleSellerTask` when `seller.task_type === "code-fix"`. Allow `input` to be empty when `taskId` is present.
1. Load the task. It must be `open` or `accepted`, and directed to this seller (or open).
2. `acceptOnChain` (if open) from the seller's key. Emit `task.accepted`.
3. **Coding agent** (`apps/server/src/coding-agent.ts`), inside `withWorkspace`:
   - `git -c core.autocrlf=false clone` the repo and check out `baseCommit` (only github.com HTTPS).
   - Collect up to 20 text files, 60 KB total (skip `.git`, binaries and anything over 20 KB).
   - **Think on 0G** with `think(seller, { purpose: "code-fix", taskId, … })`: prompt with the issue, the files and the **public** tests (never the hidden ones). Ask for JSON `{ "files": [{ "path", "content" }], "explanation" }`; write the files; take the patch from `git diff`. An empty diff is an error.
   - `strategy = "weak"`: with the slugify template, use the weak patch from `demo/tasks/slugify/weak.patch` as the model's answer; otherwise use a deliberately minimal prompt. Their ENS description says "weak demo agent". They still call `think()` once (for the explanation), so their brain and receipts are real.
   - If 0G is disabled and there is no API key (development only) with the slugify template, careful agents use `good.patch` and say so in `explanation`.
   - Never send hidden tests or other hires' data anywhere.
4. `submitOnChain(chainTaskId, keccak256(utf8(patch)), patchURI = ${PUBLIC_BASE_URL}/api/tasks/<id>/patch.diff)`. Emit `task.submitted`.
5. **ERC-8004 validation request** (from the platform Sepolia wallet): `validationRequest(validatorAddress = (GET ${VERIFIER_URL}/health).validator, agentId = seller.erc8004_agent_id, requestURI = specURI, requestHash = keccak256(utf8(canonicalJson({ chainTaskId, specHash, patchHash, testsHash }))))` on `ERC8004_VALIDATION_REGISTRY`. Minimal ABI: `function validationRequest(address validatorAddress, uint256 agentId, string requestURI, bytes32 requestHash)`. If it fails, carry on and log it.
6. **Start verification:** `POST ${VERIFIER_URL}/verify` with a `VerifyRequest` (include `erc8004RequestHash` and `specialistAgentId`). **P1:** if `/health.paidVerify` is non-null, call `/verify-paid` instead, paying the fee with the **specialist's own x402 client** (`createPayingFetch`), so a second Hedera payment appears. Store `verify_job_id`; status becomes `verifying`.
   - **Relay** the verifier's SSE (`GET /jobs/:id/events`) into the server event bus as `verify.status` / `verify.log` / `verify.result` events with `{ taskId, ... }`, so the web app needs only `/api/events`.
7. Respond `200 { hireId, taskId, patchHash, verifyJobId }`. The x402 middleware then settles the attempt fee.

### B5. Settlement → reputation → earnings (P0)

When the watcher sees `Passed` or `Failed` (or the verifier job finishes):
1. Update the task: `passed` or `failed`, `settle_tx` (from the job), and the `VerificationResult`. Store `erc8004_response_tx` from the job.
2. Call `submitRating({ hireId: task.hire_id, rating: passed ? 5 : 1, paymentTxId })` from `verifier.ts`. The existing pipeline checks the x402 payment on the mirror node and records it on the **HireLedger on Hedera** with the counting rule. Make sure a code-fix hire is never auto-rated anywhere else.
3. After the hire is recorded, update the specialist's ENS records in **one** `setRecords` call: `ethernals.tasks.passed` / `.failed`, score and price (reuse `queueReputationUpdate`), and `ethernals.earned`.
4. **Credit the brain** (B2) with the bounty on PASS.
5. Emit `task.settled { taskId, passed, settleTxUrl, reason, score, price }`.

**Refunds:** `POST /api/tasks/:id/refund` (client only) → `refundOnChain` once eligible: after the deadline if `open` or `accepted`, or after the deadline plus 30 minutes if `submitted`. Emit `task.refunded`.

### B6. Spending controls API (P0)

| Route | Purpose |
|---|---|
| `GET /api/me/spend` | `SpendStateView`: the active guard, its `SpendPolicyView`, the last 10 `SpendEventView`s |
| `POST /api/me/spend/connect` | `ConnectNameraRequest` → `SpendPolicyView`. Validate by building `createNameraGuard(...)` and calling `policy()`; store encrypted in `spend_accounts`. A wrong key or ids returns a plain-English error |
| `DELETE /api/me/spend` | Disconnect (back to `DirectGuard`) |
| `POST /api/me/spend/try-overspend` | **Demo mode only.** Tries to fund a bounty of 5× the policy cap (or 50 tUSDC if the cap is unknown) with a throwaway spec, expects `blocked`, and returns `TryOverspendResponse`. Never creates a task or moves money if it is blocked; if the guard unexpectedly allows it, refuse to submit (check the amount against the policy first) and say so |

### B7. Tasks API (P0): `apps/server/src/api.ts`, types from `tasks.ts`

| Route | Purpose |
|---|---|
| `GET /api/tasks` | `TaskView[]`, newest first |
| `GET /api/tasks/:id` | `TaskView` (include `inference` receipts and `spend` events for the task) |
| `POST /api/tasks` | `CreateTaskRequest` → `TaskView` (session needed) |
| `POST /api/tasks/:id/hire` | `HireForTaskRequest` → `TaskView` (client only). Long request, up to about 90 s |
| `POST /api/tasks/:id/refund` | → `TaskView` |
| `GET /api/tasks/:id/spec.json` | The public `TaskSpec` (exactly the object that was hashed) |
| `GET /api/tasks/:id/patch.diff` | The submitted patch (`text/plain`) |
| `POST /api/duels` | `CreateDuelRequest` → `DuelView`: two directed tasks from the same template, one per specialist, both hired in parallel |
| `GET /api/duels/:id` | `DuelView` |
| `GET /api/verifier/health` | Proxies `VerifierHealth`, for the UI and `check-setup` |

Fill `TaskLinks` with Etherscan links for the Sepolia transactions (`sepoliaTxUrl`), HashScan links for the x402 payment and the HireLedger, the verifier's `resultUrl`, and the ERC-8004 transactions. Extend `GET /api/config` with the optional `zeroG`, `namera` and `escrow` blocks.

### B8. Web (P0 unless marked): `apps/web`, same design system and API client patterns

- **Header nav:** add TASKS and DUEL.
- **`/tasks`:** the feed. Status chips (open, verifying, passed = green, failed = red, refunded = grey), bounty in tUSDC, specialist ENS name, created time.
- **`/tasks/new`** (sign-in needed):
  - a template card "Fix the slugify bug (Python, hidden tests)" with the issue shown;
  - bounty (default `TASK_DEFAULT_BOUNTY`), deadline in minutes (default 30), and a specialist picker listing code-fix agents with their score, price, verified tasks passed and brain status (awake or dormant);
  - a **spending-controls banner** showing the active guard ("Namera session key · cap 10 tUSDC · expires …" or "server-enforced · weaker"), with a link to `/me`;
  - when funding is **blocked**, show a red card "Blocked by Namera policy: <rule> — <reason>" and keep the form;
  - P1: an advanced section with a custom repo URL, commit, issue and a hidden-tests textarea (a single `tests_hidden/test_x.py`).
- **`/tasks/[id]`:**
  - **Timeline:** Created → Accepted → Submitted → Verifying → Passed / Failed / Refunded, each with its transaction link.
  - **The patch** as a diff (+ lines green, − lines red).
  - **A live verifier console** streaming `verify.log` lines.
  - **A "Thought on 0G" card:** the specialist's inference receipts (model, request id, tokens, cost).
  - **A result card:** tests passed and failed, `isolation`, a "Signed result ↗" link, a "Validation on ERC-8004 ↗" link, and the HireLedger reason badge with the score change.
  - **Commitments:** "Hidden tests committed before work: testsHash 0x…".
  - Hire and Refund buttons when allowed.
- **`/duel`** (the second "click"): pick a template, then two specialists (default `fixer` and `weak-fixer`), then "Start duel". Two columns, each with a live log, its outcome (**PAID** in yellow or **REFUNDED**), the score change, and the 0G request ids. Readable on a projector.
- **Spin-up view** on `/provider`: when you create a code-fix agent, show the live `agent.born` steps as a checklist ("Hedera account", "0G brain key", "ENS", "ERC-8004", "first thought — request id …").
- **Agent page additions:** capabilities, verified tasks passed/failed (live from ENS), the ERC-8004 id, and a **Brain panel** (model, key label, credit, spent, earned, awake/dormant, recent receipts). P1: read the Validation Registry in the browser (`getAgentValidations(agentId)` → `getValidationStatus(hash)`).
- **`/me` additions:** a **Spending controls** card.
  - Not connected: explain it in two sentences, show the three fields (API key, wallet id, session key id), link to `docs/proof-of-work/NAMERA-SETUP.md`, and a Connect button.
  - Connected: show the policy (account address, allowed contracts, token cap, rate limit, expiry, status) and the recent spend events with allowed/blocked badges. In demo mode, a **"Try an overspend"** button calls `try-overspend` and shows the BLOCKED result.
- **Landing page:** add a Protocol step "Work is verified before it's paid: hidden tests, a sandbox and escrow", and a line "Agents think on 0G and spend within Namera limits".

### B9. Ops (P0): `apps/server/scripts/*`

These run with `pnpm --filter @ethernals/server exec tsx scripts/<name>.ts`. Don't edit the root `package.json`; ask Dev A for root aliases.
- **`seed-coders.ts --strong <providerHandle> --weak <otherHandle>`** creates `fixer` (careful) and `weak-fixer` (weak) code-fix agents, spun up with the full 0G flow, for two **different** providers. Neither provider may be the client in the demo, or the votes won't count.
- **`check-setup` additions** (`doctor.ts`): 0G Router reachable and the model resolved; management key valid (can list keys); the shared fallback key; Router balance if exposed; the verifier `/health` (mode, validator); the escrow and tUSDC addresses set and the contracts present on Sepolia; the Sepolia balances of the platform wallet and validator; Docker mode reported; Namera guard status for connected people.
- **`demo-reset` additions:** clear the tasks, duels, receipts and spend events tables. Keep agents and their brain keys; reset brain credit to the seed. Keep the escrow; old tasks stay on-chain.

### B10. Tests (P0, vitest in `apps/server/test/`)

- `specHash` and `requestHash` match `canonicalJson` (including key order);
- `brain.think`: receipt recorded, cost computed from pricing, credit decremented, last JSON object extracted from a "thinking" response; 429 retry; fallback to the shared key;
- the dormant gate returns 503 before any payment;
- earnings credit the brain at the configured rate;
- `DirectGuard` blocks above the cap and above the hourly counter; a blocked spend creates no task and records a `spend_events` row;
- the coding-agent patch flow on a temp git repo (LLM stubbed);
- the watcher settles a task exactly once; PASS → rating 5, FAIL → rating 1, `submitRating` called once;
- the refund eligibility rules; API validation (bad repo host rejected, bounty limits).

### B11. Docs (P1)

- `README.md`: the v2 one-liner, the partner map (copy from `PLAN.md`), the task flow, the Duel, the disclosure about brain credit, and the security notes from Dev A's `VERIFIER.md`. Add a "Hedera evidence" row for the x402 attempt fee and verification fee, and a "0G evidence" row listing request ids.
- `SETUP.md`, in the same plain-English style, with new steps:
  - **Docker Desktop** (install, start, `pnpm verifier:image`);
  - **0G Compute:** open `pc.testnet.0g.ai`, connect a wallet, get tokens from `faucet.0g.ai`, deposit, create a management key and an API key, and paste them in `.env`;
  - **Namera:** point to Dev A's `NAMERA-SETUP.md`;
  - `pnpm verifier:setup`, `pnpm deploy:escrow`, seed the coders, run the Duel.

## 5. Milestones (IST)

| By | Done when |
|---|---|
| **Hour-0 07:30–08:30** | Spikes reported (0G reachable, key creation works, the model and its latency) |
| **CP1 10:30** | `brain.ts` working on 0G with receipts and per-agent keys; tasks table; `escrow.ts` creating a task on Sepolia against Dev A's deployed escrow via `DirectGuard` (tUSDC minted, `TaskCreated` parsed); API skeleton for `/api/tasks` |
| **CP2 14:30** | Specialists spun up on 0G; x402 hire → accept → think → submit → `/verify`; merge `main`; first full flow end to end; Namera guard wired (connect on `/me`, blocked path works) |
| **CP3 19:30** | Settlement → HireLedger → ENS → brain credit; `/tasks`, `/tasks/new`, `/tasks/[id]`, `/duel`, brain and spending panels; joint end-to-end on the demo machine |
| **CP4 23:30** | **Open the PR to `main` and merge it.** Feature freeze; rehearse the PLAN.md demo twice from `pnpm demo:reset` |

## 6. Definition of done (self-check before the PR)

- [ ] **Duel works on testnets:** `fixer` → PASS → paid; `weak-fixer` → FAIL → refunded. Both x402 attempt fees show on HashScan, both HireLedger records show (fixer's score rises, weak-fixer's falls), the ENS records update, and the ERC-8004 request and response show on Sepolia.
- [ ] **Every agent thought is a 0G receipt:** each task page lists request ids; `GET /api/agents/fixer/inference` returns them; no Anthropic call happens when `ZG_ENABLED=true`.
- [ ] **Namera block demonstrated:** the over-cap bounty is blocked with a visible rule, and no task is created.
- [ ] **Self-funding visible:** after a paid hire, the agent's brain credit and `ethernals.earned` increase.
- [ ] **v1 still works:** the Arena, a normal hire, World ID sign-up.
- [ ] `pnpm test` and `pnpm typecheck` are green; `pnpm build` succeeds.
- [ ] Hidden tests, prompts and completions are never stored, logged or shown before settlement (receipts hold only ids, counts and costs).
- [ ] No edits to files you don't own: `git diff main -- packages/contracts apps/verifier packages/spend-guard demo/tasks packages/shared/src/tasks.ts packages/shared/src/task-escrow-abi.ts .env.example package.json` is empty.
