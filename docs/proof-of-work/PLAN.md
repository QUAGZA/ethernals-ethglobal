# Ethernals v2: proof-of-work hiring on partner tech (plan for two devs)

Written Friday 6 Nov 2026. Submissions close **Saturday 7 Nov, 09:00 IST**, with no late submissions. Our internal freeze is **07:00 IST**.

## 1. The direction in one paragraph

The research report ("Decentralized Agent Marketplaces: Market Gap and ETHGlobal Mumbai MVP") found the real gap: nothing ties an agent's payment to proof that the work was done. Ethernals v1 already fixes the other half: a reputation that only a different, verified human can move, and only by paying. v2 joins the two, and builds it **on partner technology**:

> **One-liner:** AI agents that think on 0G, get paid over x402 on Hedera only when hidden tests pass, spend only what Namera lets them, and earn a record that only different verified humans can move.

- **A client agent** posts a Python code-fix task with **hidden tests**. Its money is governed by **Namera** (session-key policy), and the bounty goes into escrow.
- **Specialist coding agents** are **spun up on 0G Compute**: each gets its own 0G API key, and all of its thinking runs there. They earn to pay for their own inference.
- **The client's agent hires a specialist over x402 on Hedera** (an attempt fee). The specialist writes a patch.
- **A Docker sandbox verifier** runs the hidden tests, signs PASS or FAIL, and settles the escrow. It also answers an **ERC-8004 validation request**.
- **PASS pays the specialist and counts as a 5-star vote; FAIL refunds the client and counts as a 1-star vote.** The v1 rule stays: one vote per person, never from the agent's own provider.

## 2. Partner map: who does what

| Partner tech | Role in the product | Where it runs | Built by | Prize? |
|---|---|---|---|---|
| **x402 on Hedera** | Every agent-to-agent payment: the client's agent pays the specialist's attempt fee; (P1) the specialist pays the verifier per run. Budget policy in code. | Hedera testnet (USDC) | Dev B (payments), Dev A (paid verify) | Hedera $6.5k |
| **Hedera EVM** | The HireLedger: the public counting rule and reputation | Hedera testnet | already built (v1) | |
| **0G Compute** | Every agent's brain. One 0G API key per agent, created when the agent is spun up. Receipts (request ids) for every call. Self-funding: earnings credit the brain. | 0G Router (testnet) | Dev B | 0G $2k ("Agents That Pay for Themselves") |
| **Namera** | Spending controls for client agents: a smart account with a **session key** limited by on-chain policy (allowed contracts, tUSDC cap, rate limit, expiry). An over-limit bounty is **blocked**. | Ethereum Sepolia | Dev A (guard), Dev B (UI + wiring) | none on the Mumbai prize page |
| **ENSv2** | Agent names and public credit report: capabilities, brain, verified tasks, score, price | Sepolia | v1 + Dev B | ENS $7k |
| **World ID** | Unique-human proof for providers and clients; powers the counting rule | World | v1 | World $7.5k |
| **ERC-8004** | Agent identity and validation records | Sepolia | Dev A (response), Dev B (request) | |

**Why escrow is on Sepolia, not Hedera:** Namera supports Ethereum, Sepolia, Base, Arbitrum, OP and Arc. It does **not** support Hedera or 0G Chain. For Namera's on-chain policy to govern the bounty, the escrow has to live on a chain it supports. Sepolia already hosts ENS and ERC-8004, so it becomes the "identity, escrow and validation" chain. Hedera stays the "payments and reputation" chain.

## 3. Prize strategy: you can use five technologies but enter only three prizes

ETHGlobal lets each project enter **at most 3 partner prizes**. Using a technology is separate from entering its prize.

| If you enter | Pool you could win | Comment |
|---|---|---|
| **Hedera + ENS + World** (recommended) | $6.5k + $7k + $7.5k = $21k | Highest value. 0G and Namera still make the product stronger and the demo more impressive. |
| Hedera + ENS + 0G | $6.5k + $7k + $2k = $15.5k | Pick this only if 0G is the story you most want to tell. The 0G track that fits is the smallest one. |

- Namera has no track on the Mumbai prizes page. It is a technology choice, not a prize slot.
- 0G reviews code like an auditor, wants request ids, a demo under 3 minutes, and rejects removable AI calls. If you enter 0G, the agent's inference must be essential (it is: the agent cannot write a patch without it).
- Decide at submission time. The architecture is the same either way.

## 4. How a task flows

```
Client person (World ID) ── /tasks/new ──▶ Server
   │ (1) hidden tests ─────────────────────────────────────────────▶ Verifier  POST /tests → testsId, testsHash
   │ (2) spend guard: Namera session key on the person's smart account (Sepolia)
   │       approve(tUSDC → escrow) + TaskEscrow.createTask(bounty, deadline, specialist, specHash, testsHash)   ← BLOCKED if over the policy
   │ (3) client's buyer agent ── x402 attempt fee (USDC, Hedera) ──▶ specialist endpoint POST /a/fixer/task {taskId}
   │       specialist: acceptTask → clone repo → THINK on 0G Compute (own API key, receipt recorded) → git diff → submitResult(patchHash)
   │       server: ERC-8004 validationRequest(verifier, agentId, …)                                              [Sepolia]
   │ (4) Verifier: checks patchHash + testsHash on-chain → git apply → hidden tests in Docker (no network)
   │       → signs result → TaskEscrow.settle(PASS|FAIL) → ERC-8004 validationResponse(100|0)                    [Sepolia]
   └ (5) watcher sees Passed/Failed → HireLedger.recordHire(rating PASS→5 / FAIL→1)                              [Hedera]
          → ENS records update (score, price, verified tasks, earned) → earnings credit the agent's 0G brain
```

## 5. The split: two devs, two branches, minimal shared files

| | **Dev A: escrow, verifier, Namera guard** | **Dev B: agents on 0G, x402 flow, UI** |
|---|---|---|
| Branch | `feat/proof-escrow-verifier` | `feat/proof-tasks-ui` |
| Agent brief | [PRD-A-escrow-verifier.md](PRD-A-escrow-verifier.md) | [PRD-B-tasks-agents-ui.md](PRD-B-tasks-agents-ui.md) |
| Owns | `packages/contracts/**` (except the frozen interface), `apps/verifier/**` (new), `packages/spend-guard/**` (new), `demo/tasks/**` (new), `docs/proof-of-work/NAMERA-SETUP.md` and `VERIFIER.md`, the root `package.json` | `apps/server/**`, `apps/web/**`, `README.md`, `SETUP.md`, `PRD.md` |
| Must not edit | `apps/server/**`, `apps/web/**` | `packages/contracts/**`, `apps/verifier/**`, `packages/spend-guard/**`, `demo/tasks/**`, the root `package.json` |

**Frozen interface (already on `main`; neither dev edits it on a branch):**
- `packages/contracts/contracts/ITaskEscrow.sol` and its ABI in `packages/shared/src/task-escrow-abi.ts`.
- `packages/shared/src/tasks.ts`:
  - task spec, hidden tests, `canonicalJson` and the verifier HTTP API types;
  - `InferenceReceipt` and `AgentBrainView` (0G);
  - `SpendGuard`, `SpendPolicyView`, `SpendResult` and the Namera connect types;
  - the server↔web task types.
- `packages/shared/src/ens-keys.ts` and `api.ts` additions (brain/earned keys, new event types, optional config blocks).
- `.env.example`: every new variable is already listed.

**Seams between the two branches:**
- Dev A publishes the **escrow and tUSDC addresses** at CP1.
- Dev A's `@ethernals/spend-guard` exports `createNameraGuard(...)`, which returns a `SpendGuard`. Dev B uses their own `DirectGuard` until it lands at CP2.
- The verifier's HTTP API is typed in `tasks.ts`, so Dev B can mock it.

Changing the interface takes a tiny PR to `main` that both devs agree on. Additive changes are fine; tell the other dev.

## 6. Checkpoints (IST; shift everything if you start late)

| When | Dev A | Dev B | Together |
|---|---|---|---|
| **07:30–08:30** | Hour-0 spikes (PRD A §3): Namera session key + policy on Sepolia, Docker on Windows | Hour-0 spikes (PRD B §3): 0G Router + per-agent key, x402 on Hedera | Report spike results in the team chat |
| **CP1 10:30** | Contracts deployed to **Sepolia**; **post `TASK_ESCROW_ADDRESS` and `MOCK_USDC_ADDRESS`**; verifier running in `local` mode and pushed | Brain module on 0G with receipts; tasks table; escrow client against Dev A's deployed escrow (DirectGuard) | Dev B sets the addresses in `.env` |
| **CP2 14:30** | Docker mode, settle + ERC-8004 response, demo repo pushed, `spend-guard` package with a passing self-test. **Open PR A → `main` and merge** | Specialists spun up on 0G, x402 hire → patch → verify; settlement watcher → HireLedger. Merge `main`; switch client funding to the Namera guard | First full run: create → hire → patch → verify → settle |
| **CP3 19:30** | Paid verification (x402), docs, `NAMERA-SETUP.md` verified by a fresh pair of eyes | Web pages: tasks, task detail with live log, Duel, brain and spending panels | End-to-end on the **demo machine** (Docker, one laptop) |
| **CP4 23:30** | Fixes only | **Open PR B → `main` and merge.** Feature freeze | Rehearse the demo twice from `pnpm demo:reset` |
| Sat 00:00–05:00 | Backup video, evidence links | Polish, sponsor write-ups | Sleep in shifts |
| **Sat 07:00** | | | **Submit** (the deadline is 09:00) |

Merging: Dev A's PR is mostly additive, so it merges first. If `pnpm-lock.yaml` conflicts, take either side, run `pnpm install`, and commit. Push small commits often; ETHGlobal flags large single commits.

## 7. Demo script v2 (4:00; 0G wants under 3:00, so cut the Arena for their recording)

| Time | Beat |
|---|---|
| 0:00–0:20 | Hook: "Agents can pay each other now. Three things are broken: anyone can fake an agent's reputation, nobody checks the work before paying, and agents spend with nobody's permission." |
| 0:20–1:00 | **Arena**: 20 fake ERC-8004 reviews vs 20 farmed hires on Ethernals, counted 0 times |
| 1:00–1:30 | **Spin-up on 0G**: create `fixer`. The log shows the Hedera account, its own 0G key, the ENS record, the ERC-8004 id, and a first thought with its request id |
| 1:30–2:15 | **Namera**: Bob's agent tries a 50 tUSDC bounty against a 10 tUSDC session-key cap: **BLOCKED by the policy**, with the rule shown. A 2 tUSDC bounty goes through |
| 2:15–3:20 | **Duel**: `fixer` and `weak-fixer` each get paid an x402 attempt fee on Hedera and think on 0G. The live verifier log streams. The weak one fails the hidden tests: refunded, vote 1. The strong one passes: paid, vote 5. The agent earns, and its 0G brain credit rises |
| 3:20–3:50 | Proof: ENS records in the official ENS app, the escrow on Etherscan, the payments and HireLedger on HashScan, the signed result, the ERC-8004 validation |
| 3:50–4:00 | Close: "Verified work, paid by a different human, within limits the owner set." Plus what we don't claim |

## 8. Risks and the fallbacks

| Risk | Fallback |
|---|---|
| The 0G **testnet** Router endpoint may be unreachable (it failed a TLS handshake from one machine while the mainnet endpoint worked) | Check at hour 0. If it fails everywhere, the human decides whether to use the mainnet Router with a small real 0G deposit. Never silently |
| Namera policy semantics for ERC-20 (`approve` vs `transfer`) | Dev A tests it at hour 0. Fallback: the policy limits contracts, rate and expiry, and the amount cap is also enforced by our server, and the UI says so |
| Namera sessions and accounts are created by hand in its dashboard | Done once per demo client (2 people), following `NAMERA-SETUP.md` |
| Per-agent 0G key creation API differs from what the docs suggest | Fall back to one shared key plus per-agent accounting on our side |
| Docker Desktop on the demo laptop | The verifier's `local` mode exists for development, but it isn't isolated and must not be used in the demo recording |

## 9. Cut list (do not build)

General tasks beyond Python code fixes; zkML, TEEs, a network of verifiers, disputes, token economics; multi-hop delegation. Mention them as "next".
