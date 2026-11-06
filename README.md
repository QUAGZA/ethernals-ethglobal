# Ethernals

**ENS-named AI agents whose track record and price move only when a different verified human pays and rates them.**

*Bots can pay. Only people can vouch.*

**v2:** AI agents that think on 0G, get paid over x402 on Hedera only when hidden tests pass, spend only what Namera lets them, and earn a record that only different verified humans can move.

Built at ETHGlobal Mumbai (Nov 2026) for the World, ENS and Hedera partner prizes.

---

## The problem

AI agents can now pay each other per request with x402, but nobody can tell which agents deserve the money.

- **Fake reviewers dominate open registries.** In ERC-8004 registries, 59–91% of reviewers show coordinated Sybil behaviour, and a forged rating costs a median $0.003–$0.055 ([arXiv 2606.26028](https://arxiv.org/abs/2606.26028), a preprint).
- **The standard can't stop it on-chain.** It only stops an agent's *owner* from reviewing it, so a fresh wallet gets past that check ([EIP-8004](https://eips.ethereum.org/EIPS/eip-8004)).
- **No hacking is needed.** One provider runs several agents that hire and rate each other until the record looks earned.

## What Ethernals does

| | |
|---|---|
| **Identity** | Every agent is an **ENSv2 subname** (`summarize.<parent>.eth`) owned by a person who proved they are a unique human with **World ID**. |
| **Payment** | Anyone, human or agent, discovers the agent by ENS name and pays per task with **x402 on Hedera** (USDC, `exact` scheme). No human approval is needed. |
| **The counting rule** (on-chain, in [`HireLedger.sol`](packages/contracts/contracts/HireLedger.sol)) | A hire's 1–5 rating becomes a vote only if the payment settled on Hedera **and** the buyer is a verified person **different from the agent's provider**. One vote per person per agent; a replayed payment never counts. |
| **Score and price** | `score = (9 + Σvotes) / (3 + voters)`, a prior of three neutral 3-star votes, so a handful of ratings can't spike it. `price = basePrice × score ÷ 3`. |
| **Public credit report** | Score, price, votes and hire counts are written to the agent's **ENS text records** after every counted hire, so any client can read them. |

**The Arena** is the demo:
1. **Fake reviews on the open standard.** 20 fresh wallets each leave 5 stars on the official ERC-8004 registry, and the average jumps for a few cents.
2. **Farmed hires against Ethernals.** 20 agents owned by the provider hire the provider's own agent, and all 20 settle on Hedera. The ledger records **0 counted**, and the score stays at 3.00.
3. **One real hire.** A different person hires once, and the ENS record moves from 3.00 → 3.50, with price 0.100 → 0.117.

## Architecture

```
People (World ID) ──▶ Web (Next.js :3000) ──proxy /api, /a──▶ Server (Express :4000)
Buyer-agent CLI ─────────────────────────────────────────────▶  ├─ x402 seller endpoints  POST /a/:label/task
                                                                ├─ buyer runtime (x402 client, budget policy, LLM judge)
                                                                ├─ verifier (mirror-node payment check, person hashes)
                                                                └─ SQLite (metadata only — no task content)
        x402 facilitator (x402.org)   Hedera testnet: USDC payments + HireLedger (EVM)   Sepolia: ENSv2 records + ERC-8004 (Arena)
```

1. The buyer agent reads `agent-endpoint[x402]`, `ethernals.price` and `ethernals.score` from **ENS**.
2. It calls the endpoint and gets a **402** quote. The price is dynamic, read from the HireLedger.
3. The buyer signs a USDC transfer. The facilitator pays the Hedera fee and settles it.
4. The agent runs the task in a **fresh workspace that is deleted afterwards**, with no shared memory and an outbound allowlist.
5. The buyer rates the result: a person in the UI, or an agent's LLM judge with a signed rating.
6. The verifier confirms the payment on Hedera's **mirror node** (payer, payee, amount) and computes per-agent person hashes `HMAC(secret, personId ‖ agentKey)`.
7. `HireLedger.recordHires` (batched) decides *counted / reason*, then the score, price and ENS records update.

## Repo layout

| Path | What |
|---|---|
| `apps/web` | Next.js app: `/arena`, `/agents`, `/agents/[label]`, `/tasks`, `/tasks/new`, `/tasks/[id]`, `/duel`, `/sandbox`, `/proofs`, `/signup`, `/provider`, `/me` |
| `apps/server` | Express server, verifier, x402, ENS/Hedera/World integrations, ops scripts in `scripts/` |
| `packages/contracts` | `HireLedger.sol` and its Hardhat tests (9, including the PRD worked example) |
| `packages/shared` | Scoring math that mirrors the contract, reason codes, ENS keys, API types |
| `PRD.md` | Product requirements (the spec this was built from) |
| `SETUP.md` | **Plain-English setup guide**: start here |

## Run it

Follow **[SETUP.md](SETUP.md)**. The short version:

```bash
pnpm install
cp .env.example .env        # Windows: Copy-Item .env.example .env
pnpm check-setup --gen-secrets
pnpm hedera:setup
pnpm deploy:ledger
pnpm ens:setup
pnpm dev                    # http://localhost:3000
```

Tests: `pnpm test` (contract, scoring and privacy tests) · Types: `pnpm typecheck`

## Our data promise

> *Task data is used only to perform the task that was paid for. Apart from the model API that runs the task, it never trains a model and never reaches another agent unless the hirer consents for that hire. Isolation is enforced by our software, not by secure hardware, and the model provider sees the task data it processes.*

How the code enforces it:
- **Fresh workspace per hire,** deleted in `finally` ([`sandbox.ts`](apps/server/src/sandbox.ts)).
- **Outbound allowlist** (`safeFetch`): only the LLM API, the facilitator, the mirror node and endpoints named in a mandate.
- **Sub-hires go through one function,** `subHire()`, which checks the hirer's consent and sub-budget in code ([`agent-runtime.ts`](apps/server/src/agent-runtime.ts)).
- **The database stores no task content.** It keeps only input and output hashes.

## What we don't claim

- **Collusion:** World ID stops one person posing as many, not two people colluding. One vote per person limits what collusion buys.
- **Trusted backend:** in v1 the verifier is trusted to attest the payment check and person hashes. The counting rule itself lives in the contract.
- **Hardware confidentiality:** there is none, and the model provider (Anthropic API) sees task data. Its commercial terms rule out training on API inputs.

## Why World ID uses only proof of uniqueness (IDKit prize)

The counting rule only needs to know whether two hires come from the same human. So Ethernals requests the **minimum sufficient credential**, World ID's proof of human (`proofOfHuman`), and stores only the action-scoped nullifier. We ask for no name, age, country or document data. See [WORLD_INTEGRATION.md](WORLD_INTEGRATION.md).

## Proof-of-work tasks (v2)

v1 proves who is vouching. v2 also proves the work was done before anyone is paid.

### Who does what

| Partner tech | Role in the product | Where it runs |
|---|---|---|
| **x402 on Hedera** | Every agent-to-agent payment: the client's agent pays the specialist's attempt fee | Hedera testnet (USDC) |
| **Hedera EVM** | The HireLedger: the public counting rule and reputation | Hedera testnet |
| **0G Compute** | Every agent's brain: one API key per agent, a receipt for every call, and earnings that credit the brain | 0G Router |
| **Namera** | Spending controls: a session key limited by on-chain policy. An over-limit bounty is blocked | Ethereum Sepolia |
| **ENSv2** | Agent names and public credit report: capabilities, brain, verified tasks, score, price | Sepolia |
| **World ID** | Unique-human proof for providers and clients, which powers the counting rule | World |
| **ERC-8004** | Agent identity and validation records | Sepolia |

The escrow is on Sepolia because Namera supports Sepolia and not Hedera. Hedera stays the payments and reputation chain.

### How a task flows

1. A client posts a Python code-fix task, writing the tests or having its agent draft them. The verifier checks the tests before funding, then their hash is committed on-chain and they stay hidden from the specialist.
2. The bounty is funded through a spend guard. Over the limit, it is blocked: nothing is created and the rule is shown.
3. The client's agent hires a specialist with an x402 attempt fee on Hedera. The specialist accepts on-chain, thinks on 0G and submits a patch.
4. The sandbox verifier runs the hidden tests, signs the result, settles the escrow and answers the ERC-8004 validation request.
5. **PASS pays the specialist and counts as a 5-star vote. FAIL refunds the client and counts as a 1-star vote.** The v1 rule still applies: one vote per person, never from the agent's own provider.
6. ENS updates in one transaction, and the earnings credit the agent's brain.

### The Duel

`/duel` gives the same task to `fixer` (careful) and `weak-fixer` (a demo agent that misses edge cases). The weak agent's patch is scripted from `demo/tasks/slugify/weak.patch`, and its ENS description says so. Its explanation, payments, tests and rating are all real.

### Disclosures

- **Brain credit is internal accounting.** The conversion rate from USDC to credit is set by us. The Router balance is the platform's treasury, funded on 0G's testnet or mainnet Router. Credit tracks what each agent has earned versus spent.
- **Thinking is sealed from model providers, not from us.** Every 0G call uses Private mode, so only providers running in a TEE can serve it, and a call fails rather than falling back. Our server and verifier run outside a TEE, so whoever operates them can read the code they handle. Code-fix repos, specs and patches are public by design.
- **A dormant agent cannot wake itself.** An agent below the minimum credit refuses hires before any payment, so a buyer never pays an agent that can't think. Today it needs a manual top-up.
- **The direct guard is weaker.** People who haven't connected Namera use limits enforced only by our server, and the UI labels them that way.
- **Test checks rule out bad tests. They can't prove tests are good.** Before funding, the verifier requires custom tests to fail a real check on the unfixed code, and to pass any reference fix and reject any naive patch supplied. Agent-drafted tests come with both patches, but a client can leave them out, and the task page shows that. Shallow tests that survive, or tests rigged between a client and an agent, are caught only by people reading the published tests. Built-in template tests skip the check and stay hidden, because later tasks reuse them.
- **A patch can't be fully stopped from cheating at pytest.** Patched code runs inside pytest, so the verifier has two defences. It fails any patch that changes `conftest.py` or pytest config (`pytest.ini`, `pyproject.toml`, `setup.cfg`, `tox.ini`), makes binary changes, or adds code that names pytest's internals. Every run also includes a randomly named control test that must fail: if it doesn't, the run fails as `results_tampered`. That catches code that forces every test to pass, however disguised, but code that works out which test is the control could still dodge it. These patches fail with a 1-star vote, including the rare honest fix that needs to edit `pyproject.toml`.
- **The live verifier log is test output.** It is streamed during the run; see `docs/proof-of-work/VERIFIER.md` for what the sandbox does and doesn't isolate.

Prompts and completions are never stored. Receipts hold only ids, token counts and costs. Hidden tests stay with the verifier until the task settles; custom tests are then published.

## Agent sandbox

On `/sandbox`, you give an agent you own a goal and a budget. It thinks on 0G and recruits the agents it needs, paying each one over x402 on Hedera.

- **Where it runs:** on our server. 0G Compute serves AI models, not machines, so an agent's thinking runs on 0G while its run loop runs here.
- **What is enforced in code:** the budget, 8 steps, 3 recruits, 5 minutes, one run per agent, and who can be recruited. The model only proposes, so a confused or manipulated model can't spend past these limits or reach an agent outside the roster.
- **Who can be recruited:** summarize and translate agents hosted on this server. Code-fix agents work on funded tasks instead. Recruited agents don't recruit further.
- **Who pays:** the lead agent's own Hedera account, up to 1.00 USDC a run. Recruits are real hires, so ratings pass through the counting rule: a recruit by an agent you own isn't a vote if you also own the recruited agent.
- **Your data:** the goal is shared with recruits only if you allow it. Goals and results stay in a workspace that is always deleted and in memory for an hour, for you alone. The database and event stream hold only hashes, steps, amounts and ids.

This isolates what agents can spend and reach. It is a software sandbox, not separate hardware or containers.

## Sponsor checklist

- **World (Agent Pass + IDKit):**
  - The protected action is "a hire gains a reputation vote".
  - Denied paths: `SAME_PERSON`, plus an expired or unregistered credential → `UNVERIFIED_BUYER`.
  - Proofs are verified on the backend (`/api/v4/verify`), with RP-signed requests.
- **ENS (Best Use of ENSv2):**
  - Agents *are* ENSv2 subnames on the parent's Permissioned Resolver.
  - Buyers discover and price agents through ENS.
  - Records update after every counted hire and are read live in the browser.
- **Hedera (x402 on Hedera):**
  - x402 `exact` endpoints settle USDC on Hedera testnet.
  - Agents pay end to end with no human approval: `pnpm agent:hire` and the Arena farm.
  - Every payment links to HashScan, and the HireLedger lives on Hedera's EVM.

### Hedera evidence (fill in after your first live run)

| What | Hedera transaction ID / link |
|---|---|
| HireLedger deployment | _paste the HashScan contract link printed by `pnpm deploy:ledger`_ |
| A counted hire (x402 payment) | _paste a HashScan link from an agent page_ |
| A `SAME_PERSON` hire (paid, not counted) | _paste a HashScan link_ |
| x402 attempt fee for a task | _paste a HashScan link from a task page_ |
| x402 verification fee (if paid verification is on) | _paste a HashScan link_ |

### 0G evidence (fill in after your first live run)

| What | Request id |
|---|---|
| An agent's first thought | _paste from `GET /api/agents/fixer/inference`_ |
| A code fix | _paste from a task page's "Thought on 0G" card_ |

## Built with AI

See [AI_USAGE.md](AI_USAGE.md).
