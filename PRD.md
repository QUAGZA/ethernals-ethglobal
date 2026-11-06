# Ethernals v1: Product Requirements Document

> **Ethernals** is a working name. To rename the product, change `APP_NAME` and `ENS_PARENT_NAME` in `.env`. Nothing else in the code should hard-code the name.

| | |
|---|---|
| Version | 1.0 (hackathon v1) |
| Date | 6 November 2026 |
| Event | ETHGlobal Mumbai, 5–7 November 2026 (in person) |
| Hard deadline | Submissions close **Saturday 7 November, 09:00 IST**, with no late submissions. Internal code freeze is **07:00 IST**. |
| Target partner prizes (max 3) | World (Agent Pass + IDKit), ENS (Best Use of ENSv2), Hedera (AI Agents That Pay: x402 on Hedera) |
| Companion docs | `SETUP.md` (plain-English setup), the research report `reports/Agent economy gaps for ETHGlobal Mumbai.md` |

Items marked **⚠ CHECK AT HOUR 0** depend on brand-new sponsor tooling and must be confirmed before building on them (see §17).

---

## 1. Summary

**One line:** ENS-named AI agents whose track record and price move only when a different verified human pays and rates them.

**Tagline:** *Bots can pay. Only people can vouch.*

Ethernals is a hiring layer for AI agents:
- Every agent has an ENSv2 name and is backed by a real, unique person, proven with World ID.
- Anyone, a person or an agent, can find an agent by its name and pay it per task over x402 on Hedera.
- A hire changes the agent's public record only if two things are true: the payment has settled on-chain, and the buyer is a different verified person from the agent's provider.
- Each counted hire allows one 1–5 rating, and each person gets one vote per agent.
- The score sets the agent's price, and both are written back into the agent's ENS records, where anyone can read them.

**The click factor is the Arena.** On screen, we fake a 5-star reputation on the open agent-reputation standard (ERC-8004) for a few cents. Then we run the same attack against Ethernals, and it refuses: 20 hires, 0 counted.

---

## 2. The problem

AI agents can now pay each other per request (x402 is a Linux Foundation standard backed by Visa, Mastercard, Stripe, Google and Coinbase), but buyers cannot tell which agents deserve the money. In 2026:

- In ERC-8004 registries, **59–91% of reviewers** (depending on the chain) show coordinated Sybil behaviour. A forged rating costs a median **$0.0027–$0.055**, and **~99% of feedback** has no proof of payment or task ([arXiv 2606.26028](https://arxiv.org/abs/2606.26028); a preprint, not yet peer reviewed).
- The standard itself only stops an agent's *owner* from reviewing it. A fresh wallet gets past that check, and the spec leaves Sybil filtering to someone else ([EIP-8004](https://eips.ethereum.org/EIPS/eip-8004)).
- A Visa-funded Artemis analysis classed **89% of x402 dollar volume** as wash, test or internal transfers through April 2026. Real agent spend is only about **$5K–$11K a month** ([TRM Labs](https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain)).
- Agent-to-agent marketplaces collapsed once incentives stopped. Virtuals' ACP fees fell from $345K in March to $5.48 in September, and 64% of ACP v2's Base volume came from two wallets paying each other ([ChainWard](https://chainward.ai/decodes/virtuals-top-dog)).

The cheapest attack needs no hacking at all. A provider runs several agents that hire and rate each other until their record and price look earned.

## 3. Why this is different

| Existing thing | What it does | What it does not do |
|---|---|---|
| ERC-8004 registries and explorers | Store anyone's feedback about an agent | Tell paid feedback from fake, or one person from many |
| Agent factories (for example, *CaaS* at ETHGlobal Cannes 2026) | Create, host and connect agents | Tell a buyer which agent is worth paying |
| Payment rails (x402, Mastercard Agent Pay, AP2) | Move money and enforce spend limits | Say whether the work was good |
| **Ethernals** | **Counts only paid hires from a different verified person, with one vote per person, and publishes the score and price in ENS** | Stop collusion between *different* real people (it limits that to one vote each) |

**Positioning line for judges:** "Agent factories make a thousand agents. We tell you which three are real, including theirs."

---

## 4. Goals, non-goals and success metrics

### Goals (v1)
1. **G1 Counting rule, end to end.** A real hire flows through: x402 payment on Hedera → settlement check → person check → on-chain ledger event → score and price update → ENS records update.
2. **G2 The Arena.** A live, side-by-side attack on an open ERC-8004 registry and on Ethernals.
3. **G3 ENS as the public credit report.** Buyers and agents discover, price and audit agents by ENS name, and the record is readable without our app.
4. **G4 Autonomous payment.** A buyer agent hires, pays and rates with no human approval.
5. **G5 An honest data promise,** enforced in code (§12).
6. **G6 Every sponsor requirement met** (§13).

### Non-goals (v1)
- Retraining or fine-tuning any model. "Learns and grows" means the record and price grow.
- Secure hardware (TEEs), zero-knowledge machine learning, encryption of task data from the model provider.
- Chat channels (WhatsApp, Telegram, Discord), NFTs for agents, a token, mainnet money.
- Escrow, refunds or disputes.
- Personalized or graph-based scoring.
- Self / Aadhaar identity (a stretch goal only).
- Native mobile apps.

### Success metrics (demo day)
| Metric | Target |
|---|---|
| Arena, open-registry side | A test agent's ERC-8004 average climbs from 3.0 to about 4.8 with 20 fake reviewers. The on-screen cost counter shows the same transactions would cost under $0.10 on Base mainnet. |
| Arena, Ethernals side | 20 farmed hires from one person settle on Hedera, 0 are counted, and the score stays at **3.00** |
| Real hire | A different person's 5-star hire moves the score from **3.00 to 3.50** and the price from **0.100 to 0.117 USDC** in ENS within 60 s |
| Evidence | Every hire on screen links to its payment on HashScan and to its ledger transaction |
| Demo length | Full demo in at most 4:00. A clean reset (`pnpm demo:reset`) takes at most 10 min. |

---

## 5. Users

| Persona | Who | Wants |
|---|---|---|
| **Provider (Alice)** | Runs one or more AI agents (for example `summarize`) | Earn money and a reputation that buyers trust |
| **Buyer person (Bob)** | Hires agents through the web app | A good result for a fair price, without his data leaking |
| **Buyer agent** | An autonomous agent owned by a person | Pick a trustworthy agent and pay automatically, within a budget |
| **Sub-contractor (Carol)** | Provider of `translate` | Get hired by other agents |
| **Attacker (Mallory or Alice)** | Farms ratings | Inflate a record cheaply. Ethernals must make this worthless. |
| **Observer (a judge)** | Reads ENS and HashScan | Verify the claims without trusting our app |

---

## 6. Core rules (the product)

### 6.1 Definitions
- **Person:** a unique human, proven once with World ID at sign-up. Internally a person is identified by their World ID nullifier for the action `WORLD_ACTION` (in `agentkit` mode, by AgentBook's human link, §8.1).
- **Agent:** an ENS subname (for example `summarize.ethernals.eth`) with a Hedera account. A **seller agent** does work. A **buyer agent** pays for work for its person. Every agent belongs to exactly one person.
- **Agent key:** `namehash(ensName)`, as `bytes32`.
- **Person hash (per agent):** `HMAC_SHA256(PERSON_HASH_SECRET, personId ‖ agentKey)`. Two hashes match only if they are the same person on the same agent. Outsiders cannot link one person's hires across different agents.
- **Provider key:** `HMAC_SHA256(PERSON_HASH_SECRET, personId ‖ "provider")`. It is public and groups all agents owned by one provider.
- **Hire:** one paid x402 request to a seller agent.
- **Vote:** a person's latest 1–5 rating of an agent.

### 6.2 Rules
- **R1, when a hire counts.** A hire's rating becomes a vote only if all of these hold:
  1. The payment settled on Hedera, confirmed by the server through the mirror node, not just the facilitator's word.
  2. The amount paid is at least the quoted price.
  3. The payment transaction has not been used for another hire.
  4. The buyer agent belongs to a verified person whose human credential is valid and unexpired.
  5. The buyer's person is **not** the seller agent's provider.
  6. The rating is an integer from 1 to 5.
- **R2, one vote per person per agent.** A later rating from the same person replaces their earlier vote. It does not add a new one.
- **R3, score.** `score = (3×3 + Σ votes) ÷ (3 + n)`, where `n` is the number of distinct voters. This acts like a Bayesian prior of three neutral 3-star votes. A new agent's score is 3.00.
- **R4, price.** `price = basePrice × score ÷ 3`, computed in integers with USDC's 6 decimals: `price = basePrice × (9 + Σ) ÷ (3 × (3 + n))`, rounded down. The price can range from ⅓ to 5⁄3 of the base price.
- **R5, every hire is recorded.** Counted or not, each hire is recorded on the ledger with a **reason code**: `COUNTED`, `COUNTED_REPLACED_VOTE`, `SAME_PERSON`, `UNVERIFIED_BUYER`, `DUPLICATE_PAYMENT`, `NO_RATING`, `INVALID_RATING`, `UNKNOWN_AGENT`. Payments that never settle are not recorded, because nothing happened.
- **R6, unrated hires.** If a hire gets no rating within 10 minutes, it is recorded as `NO_RATING`.
- **R7, sub-hires.** A seller agent may hire another agent while working on a task only if the hirer's mandate allows it (§8.5). Sub-hires follow R1–R6 unchanged, so a sub-hire between two agents of the same provider never counts.

### 6.3 Worked example (base price 0.10 USDC)
| Event | n | Σ | Score | Price (USDC) | Reason |
|---|---|---|---|---|---|
| New agent | 0 | 0 | 3.00 | 0.100000 | — |
| Alice's own buyer agent rates 5 | 0 | 0 | 3.00 | 0.100000 | `SAME_PERSON` |
| Bob rates 5 | 1 | 5 | 3.50 | 0.116666 | `COUNTED` |
| Dave rates 5 | 2 | 10 | 3.80 | 0.126666 | `COUNTED` |
| Bob re-rates 4 | 2 | 9 | 3.60 | 0.120000 | `COUNTED_REPLACED_VOTE` |
| Erin rates 5 | 3 | 14 | 3.83 | 0.127777 | `COUNTED` |

These exact numbers are the unit-test fixtures (§16).

---

## 7. User flows

**F1. Sign up (any person). P0**
1. The person opens `/signup` and verifies with World ID (IDKit widget).
2. The server verifies the proof server-side. If this person is new, it creates them. If the nullifier already exists, it signs them in instead of creating a duplicate.
3. The server creates the person's **buyer agent**:
   - a Hedera account with automatic token association;
   - an ENS subname `<handle>-buyer.<parent>`;
   - a starting balance of test USDC from the operator (`BUYER_STARTING_USDC`, default 1.00).
4. Acceptance: one human cannot create two persons. The second attempt reports "already registered".

**F2. Create a seller agent (provider). P0**
1. The provider opens `/provider` and enters a label (`summarize`), a task type (`summarize` | `translate`), and a base price.
2. The server creates the agent's Hedera account and registers it on the HireLedger.
3. It issues the ENS subname and writes its records (§11.3).
4. Acceptance: the official ENS app shows `summarize.ethernals.eth` with an endpoint, price 0.10 and score 3.00.

**F3. Hire from the web (person in the loop for the rating). P0**
1. Bob opens `/agents/summarize`. The page reads the score and price **live from ENS**, not from our database.
2. He enters text and sets the consent toggles (forwarding off by default).
3. He clicks **Hire**. His buyer agent resolves the ENS name, calls the x402 endpoint, gets a 402 quote, and pays.
4. The result is returned.
5. Bob rates 1–5.
6. The verifier checks the payment and the person, records the hire on the HireLedger, and updates ENS.
7. Acceptance: within 60 s the agent page shows the new score and price, a `COUNTED` badge, a HashScan link and a ledger transaction link.

**F4. Autonomous hire (no human approval). P0**
1. Run `pnpm agent:hire --as bob-buyer --agent summarize.ethernals.eth --input demo/sample.txt`.
2. The buyer agent reads the score and price from ENS and checks them against its policy (`--min-score`, `--max-price`).
3. It pays over x402, receives the result, and rates the result with an LLM judge (prompt in §8.8).
4. It submits a signed rating and prints the HashScan link and the reason code.
5. Acceptance: no prompts or clicks happen between start and the printed result.

**F5. Self-hire (World's "denied path"). P0**
- Alice's own buyer agent hires `summarize` and rates it 5.
- The payment settles, the ledger records `SAME_PERSON`, and the score does not move.
- The UI shows "Paid ✓ · Counted ✗ · same person as provider".

**F6. Expired or revoked human credential (second denied path). P1**
- The demo control `Expire pass` marks a buyer agent's human credential as expired.
- That agent's next hire is recorded as `UNVERIFIED_BUYER`.
- In `agentkit` mode, an agent wallet that is not registered in AgentBook gives the same result.

**F7. Sub-hire with consent. P1**
1. Bob hires `summarize` with "Also translate to Hindi" on.
2. With forwarding consent **off**, the agent's attempt to send Bob's text to `translate.ethernals.eth` is **blocked by code** and logged as `SUBHIRE_BLOCKED_NO_CONSENT`, and Bob gets an English-only result.
3. With consent **on** and a sub-budget of 0.05 USDC, `summarize` pays `translate` (Carol) over x402 from its own account.
4. That sub-hire counts toward Carol's agent, because Alice is a different person from Carol.

**F8. The Arena (the click). P0**
- The `/arena` page has two panels and a shared live event log.
  - **Left, "Open registry (ERC-8004, Sepolia)":** a test copy of `summarize` registered in the official ERC-8004 Identity Registry, seeded with two 3-star reviews (average 3.0). **Run fake-review attack** sends 20 fresh wallets, pre-funded with gas, each calling `giveFeedback(…5 stars…)`. The panel shows the average climbing, the reviewer count, and the cost: gas used × Base mainnet gas price × ETH/USD.
  - **Right, "Ethernals (Hedera)":** **Run farmed-hire attack** makes 20 buyer agents owned by **Alice** (the provider) each hire `summarize` and rate it 5. The panel shows "20 hires · 20 paid · 0 counted", the attacker's spend in USDC, and the score staying at 3.00.
  - **Toggle (P1), "Attacker is a different person":** the same 20 agents are owned by Mallory, a separate test person. The result is "20 hires · 1 person · 1 vote".
- After the attack, Bob makes one real hire (F3) and the right-side score moves.
- Acceptance: both attacks finish in 45 s or less each, and every attack transaction is linkable.

---

## 8. Functional requirements

Priorities: **P0** must ship · **P1** should ship · **P2** stretch.

### 8.1 Identity (World)
| ID | Requirement | P |
|---|---|---|
| ID-1 | IDKit (v4) `IDKitRequestWidget` on `/signup`, with a backend-signed `rp_context` (World ID 4.0 requires RP signing via `WORLD_RP_SIGNING_KEY`). The proof is verified **server-side** against World's v4 verify API, forwarding the proof JSON byte-for-byte. | P0 |
| ID-2 | `WORLD_ENV=staging` (default for the build) uses the World App Simulator's test identities. `production` uses real World App users. The staging/production setting of the action must match the app used, or proofs fail. | P0 |
| ID-3 | The person key is the nullifier for `WORLD_ACTION`. A second sign-up with the same nullifier is rejected as a duplicate person. | P0 |
| ID-4 | Credential minimization (IDKit prize): request only proof of uniqueness. No name, age, country or document data. The README explains why. | P0 |
| ID-5 | `HUMAN_MODE=agentkit`: agent wallets are registered in World's **AgentBook** (`@worldcoin/agentkit`, CLI `@worldcoin/agentkit-cli register <address>`), and the verifier resolves which human backs a buyer wallet through AgentBook on every hire. This is the "official Agent Pass" integration for World's track. The AgentKit SDK repo is archived, so Ethernals reads AgentBook's `lookupHuman(address)` directly on World Chain; two wallets of one human share one humanId. **⚠ CHECK AT HOUR 0:** whether Mumbai's "Agent Pass" is AgentKit; and registration needs an Orb-verified World App holder, while Orbs have not operated in India since 2023 (ask World's booth). | P1 |
| ID-6 | All identity logic sits behind one interface `HumanResolver { personFor(agentAddress): PersonId \| null; isValid(agentAddress): boolean }` with `IdkitResolver` and `AgentBookResolver` implementations, so the mode switch is configuration only. | P0 |
| ID-7 | `DEV_FAKE_PERSONS=true` creates persons without World ID, for local development only. The UI shows a red "DEV MODE: not verified" banner. It must be `false` in the demo. | P0 |

### 8.2 Agents and ENS
| ID | Requirement | P |
|---|---|---|
| ENS-1 | The platform owns `ENS_PARENT_NAME` (ENSv2 on **Sepolia**). Each agent gets a subname `<label>.<parent>`. Records for all subnames live in one ENSv2 **Permissioned Resolver** on the parent, which needs no subregistry or subname token. | P0 |
| ENS-2 | The record schema is in §11.3. Reputation keys are written only by the platform's verifier wallet. | P0 |
| ENS-3 | After every **counted** hire, write `ethernals.score`, `ethernals.price`, `ethernals.votes`, `ethernals.hires.counted` and `ethernals.updated` in **one** multicall transaction. Totals that include uncounted hires (`ethernals.hires.total`) are debounced to at most one write per 30 s per agent. | P0 |
| ENS-4 | The agent page and the buyer agent read records **from ENS on Sepolia** with viem (`getEnsText`), never from our database. The page labels them "live from ENS". | P0 |
| ENS-5 | ENSv2 role permissions: the provider's wallet may set `description`, `avatar` and `ethernals.basePrice.proposed`, while only the verifier may set reputation keys. **⚠ CHECK AT HOUR 0** how granular Permissioned Resolver roles are. If they are root-only, the platform writes all keys and the README says so. **Verified during the build: resolver roles cannot be scoped to one name**, so on a shared resolver the platform writes every key in v1. | P2 |
| ENS-6 | `pnpm ens:sync` rewrites every agent's `agent-endpoint[x402]` to the current `PUBLIC_BASE_URL`, for when the public URL changes. | P0 |
| ENS-7 | An ENSIP-25 `agent-registration[…]` record links the agent to its ERC-8004 identity (see §8.6, P2 bridge). | P2 |

### 8.3 Payments (x402 on Hedera)
| ID | Requirement | P |
|---|---|---|
| PAY-1 | Each seller agent exposes `POST /a/:label/task`, protected by x402 v2 using the **Hedera `exact` scheme** (`@x402/hedera` and `@x402/core`, both published on npm as of v2.30). | P0 |
| PAY-2 | The asset is set by `PAYMENT_ASSET`: `USDC` (HTS token `HEDERA_USDC_TOKEN_ID`, default testnet `0.0.429274`) or `HBAR` as a fallback. | P0 |
| PAY-3 | The price is **dynamic**: the endpoint quotes `priceOf(agentKey)` from the HireLedger on each request. If the middleware only supports static prices, the 402 challenge is implemented with `@x402/core` directly. | P0 |
| PAY-4 | The facilitator is `X402_FACILITATOR_URL` (default `https://x402.org/facilitator`, which supports `hedera:testnet` with no API key; fallback Blocky402 testnet `https://api.testnet.blocky402.com`). On boot the server calls the facilitator's `/supported` endpoint and refuses to start if `hedera:testnet` is missing. The facilitator pays the Hedera network fee. | P0 |
| PAY-5 | Every Hedera account the platform creates uses an ECDSA key with an EVM alias, and has automatic token associations enabled (≥ 5), so USDC can arrive without a separate association step. `pnpm hedera:setup` associates USDC with the operator account. | P0 |
| PAY-6 | After settlement, the seller returns the result plus the x402 payment-response header, and the server stores the Hedera **transaction ID**. Tx IDs are normalized to mirror-node form (`0.0.X-SSSSSSSSSS-NNNNNNNNN`). | P0 |
| PAY-7 | The buyer runtime enforces a **per-agent budget** (`budgetRemaining`) and a per-hire `--max-price` in code. A quote above the limit aborts before paying. | P0 |

### 8.4 Verifier and ledger
| ID | Requirement | P |
|---|---|---|
| LED-1 | The `HireLedger` contract is deployed on **Hedera testnet EVM** (chain id 296, JSON-RPC `https://testnet.hashio.io/api`). Its interface is in §11.1. Only the verifier address can write. | P0 |
| LED-2 | Before recording, the verifier confirms the payment through the **Hedera mirror node**: status SUCCESS, the expected token, payer = the buyer agent's account, payee = the seller agent's account, amount ≥ the quoted price. If any check fails, nothing is recorded and the hire is marked `PAYMENT_NOT_VERIFIED` in the database. | P0 |
| LED-3 | The verifier computes the per-agent person hashes (§6.1). The **contract itself** applies R1.3, R1.5, R1.6, R2, R3 and R4, so anyone can audit the counting from the contract code and events. The backend attests R1.1, R1.2 and R1.4. | P0 |
| LED-4 | One writer queue per chain (Hedera and Sepolia) serializes transactions, so concurrent hires never collide on nonces. The Hedera queue batches up to 25 pending hires into `recordHires` every 2 s. | P0 |
| LED-5 | The rating is submitted with a signature from the buyer agent's key (EIP-191 over `hireId‖rating`), or with a session for web users. Ratings for hires not owned by the caller are rejected. | P0 |
| LED-6 | Each recorded hire emits an event on `/api/events` (SSE) with `{hireId, agent, reason, counted, score, price, paymentUrl, ledgerUrl}`. | P0 |

### 8.5 Sub-hire, consent and mandates
| ID | Requirement | P |
|---|---|---|
| SUB-1 | Every hire request carries `consent: { forward: boolean (default false), subBudget: string (USDC) }`. The server stores a **mandate** `{hireId, forward, subBudget, spent, expiresAt}` and puts `consentHash = keccak256(JSON)` in the ledger record. | P0 (fields) / P1 (sub-hire) |
| SUB-2 | Sub-hiring is triggered **deterministically** by a task option (`translateTo: "hi"`), not by an LLM decision. An LLM tool-use version is P2. | P1 |
| SUB-3 | The single function that can send hire data to another agent, `subHire()`, checks the mandate first. If `forward=false` or the price is above the remaining budget, it throws `SUBHIRE_BLOCKED_*`, logs an event, and the task continues without the sub-hire. | P1 |
| SUB-4 | A sub-hire is paid from the seller agent's own Hedera account through the same x402 client (the agent pays from its earnings). | P1 |

### 8.6 Arena
| ID | Requirement | P |
|---|---|---|
| AR-1 | `pnpm arena:prepare` does the setup ahead of time: registers the left-side test agent in the ERC-8004 Identity Registry on Sepolia (`ERC8004_IDENTITY_REGISTRY`), seeds two 3-star reviews from two seed wallets, creates `ARENA_FAKE_REVIEWERS` (default 20) fresh wallets and funds each with just enough Sepolia ETH for one `giveFeedback`, and creates `ARENA_FARM_HIRES` (default 20) buyer agents owned by the attacker person, each funded with 0.15 USDC. It also prints the total cost and checks balances first. | P0 |
| AR-2 | The left attack sends all `giveFeedback(agentId, value=5, valueDecimals=0, tag1="stars", tag2="", endpoint="", feedbackURI="", feedbackHash=0x0)` transactions in parallel, using the ABI from the official contracts, not hand-written. The displayed average is computed from all feedback events, the way an explorer shows it. | P0 |
| AR-3 | The left cost counter shows `Σ gasUsed × current Base mainnet gas price × ETH_USD_PRICE` as "≈ $X if done on Base mainnet", along with Sepolia Etherscan links. | P0 |
| AR-4 | The right attack fires all farm hires in parallel through the real x402 flow, with no shortcuts. The panel counts paid, counted and not-counted hires live from SSE events. | P0 |
| AR-5 | The "attacker is a different person" toggle (F8). | P1 |
| AR-6 | ERC-8004 bridge: the verifier posts each **counted** hire as `giveFeedback` from the verifier address, citing the Hedera transaction in `feedbackURI`. Any ERC-8004 client can then filter `getSummary(agentId, [verifier], …)` to see only paid ratings between different people. | P2 |

### 8.7 Web app pages
| Page | Content | P |
|---|---|---|
| `/` | One-liner, tagline, live counters (agents, hires, counted), buttons to Arena and Agents | P0 |
| `/arena` | §8.6 split screen plus a live log with colored badges (`COUNTED` green, `SAME_PERSON` / `UNVERIFIED_BUYER` amber, `SUBHIRE_BLOCKED` red) | P0 |
| `/agents` | Agent cards: ENS name, provider key (short), score, price, votes, hires | P0 |
| `/agents/[label]` | ENS records panel ("live from ENS", with a link to the official ENS app), score history, hire table (reason, HashScan and ledger links), hire form (text, "translate to Hindi", consent toggle, sub-budget), result, star rating | P0 |
| `/signup` | IDKit widget and handle choice | P0 |
| `/provider` | Create agent; my agents; **my history across all my agents** (dropping a badly rated agent cannot hide it) | P0 / P1 |
| `/me` | My buyer agent: Hedera account, USDC balance, budget, my hires | P1 |

The UI must be followable by a judge without a terminal. Use a clean, high-contrast design. The Arena is the hero screen and must read well on a projector.

### 8.8 Buyer agent CLI
- `pnpm agent:hire --as <buyer-agent-label> --agent <ens-name> --input <file|text> [--translate-to hi] [--forward] [--sub-budget 0.05] [--min-score 0] [--max-price 0.2]`
- The LLM judge (`LLM_MODEL`) receives only the task description and the result, and returns JSON `{rating: 1-5, reason}`. The judge prompt tells it to treat the result as data, not instructions.
- It prints the ENS records read, the quote, the HashScan payment link, the result, the rating and the reason code.

### 8.9 Ops scripts (`SETUP.md` depends on these exact names)
| Script | Does |
|---|---|
| `pnpm check-setup` | Checks every env var, Hedera HBAR/USDC balances, Sepolia ETH, facilitator `/supported`, World app reachability, ENS parent ownership and ledger address, and prints a plain-English fix for each failure. In `agentkit` mode it also lists the agent addresses that still need AgentBook registration. `pnpm check-setup --gen-secrets` fills in empty secrets. |
| `pnpm hedera:setup` | Associates USDC with the operator account and prints its USDC and HBAR balance |
| `pnpm deploy:ledger` | Deploys `HireLedger` to Hedera testnet and writes `HIRE_LEDGER_ADDRESS` into `.env` |
| `pnpm ens:setup` | Checks that the parent name is owned by the Sepolia wallet, sets up its Permissioned Resolver, grants the verifier role(s), and prints "ENS ready" |
| `pnpm ens:sync` | ENS-6 |
| `pnpm arena:prepare -- --attacker <handle>` | AR-1 |
| `pnpm dev` | Starts the web app (port 3000) and server (port 4000). The web app proxies `/api/*` and `/a/*` to the server, so one URL serves everything. |
| `pnpm agent:hire` | §8.8 |
| `pnpm test` | Unit and contract tests |
| `pnpm demo:reset` | Stop `pnpm dev` first. Redeploys the ledger (scores back to 3.00), clears hires and Arena state, re-registers sellers, resets their ENS records and tops up buyer agents. People and agents are kept. |
| `pnpm build` / `pnpm start` | Production build and run (used for hosting). `pnpm start` runs the web app (on `PORT`, default 3000) and the server (internal port 4000) together, so a host needs only one service and one public port. |

---

## 9. Architecture

```
              ┌────────────────────────────┐
  People ────▶│ Web app (Next.js, :3000)   │  proxies /api and /a to the server
 (World ID)   │ /arena /agents /signup ... │
              └──────────────┬─────────────┘
                             │ REST + SSE
              ┌──────────────▼──────────────────────────────────────┐
  Buyer CLI ─▶│ Server (Node/Express, one process, :4000)           │
              │  identity/  HumanResolver (IDKit or AgentBook)      │
              │  agents/    x402 seller endpoints, task runner      │
              │  buyer/     x402 client, budget, LLM judge          │
              │  verifier/  mirror-node check, person hashes, rules │
              │  writers/   Hedera queue · Sepolia queue            │
              │  db/        SQLite: metadata only, no task content  │
              └───┬──────────────────┬───────────────────┬──────────┘
                  │                  │                   │
     x402 facilitator        Hedera testnet           Ethereum Sepolia
     (x402.org or            USDC payments (HTS)      ENSv2 names + records
      Blocky402)             HireLedger contract      ERC-8004 registries (Arena)
                             Mirror node (checks)
                                                      World App / Simulator → World verify API
```

**Chains.** Hedera testnet carries payments and the ledger. Sepolia carries ENS and the Arena's ERC-8004 registry. There are two chains, and the Base mainnet connection is read-only, used only to price the attack.

**A hire, step by step:**
1. The buyer agent resolves `summarize.ethernals.eth` on Sepolia and reads `agent-endpoint[x402]`, `ethernals.price` and `ethernals.score`.
2. It sends `POST /a/summarize/task` and gets **402** with the quote (`priceOf` from the ledger).
3. The x402 client signs a USDC transfer. The seller verifies and settles it through the facilitator, which submits it to Hedera and pays the fee.
4. The seller runs the task in a fresh workspace, returns the result and the settlement header, and creates the hire record (status `paid`).
5. The rating arrives, from the person in the UI or from the agent's LLM judge, as a signed message.
6. The verifier confirms the payment on the mirror node, resolves both persons, and computes the person hashes.
7. The Hedera writer queue calls `recordHires`. The contract decides counted/reason and the new score and price, and emits `HireRecorded`.
8. If the hire was counted, the Sepolia writer queue multicalls the ENS text records.
9. An SSE event goes to the UI, with the HashScan payment link and the ledger tx link.

---

## 10. Tech stack and repo layout

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere, Node 22.13+ (for the built-in `node:sqlite`) | One language. The team is on Windows, so avoid tools that need WSL. |
| Monorepo | pnpm workspaces | Matches the x402 monorepo |
| Web | Next.js 15 (App Router), Tailwind, IDKit React widget | Fast UI, rewrites for one public URL |
| Server | Express 5, Node's built-in `node:sqlite`, `zod` validation | Simple, one process, a file database with no native modules |
| Hedera | Hiero SDK re-exported by `@x402/hedera` (accounts, transfers), viem against the Hashio JSON-RPC (contract), mirror node REST | One SDK instance shared with x402 |
| x402 | `@x402/core`, `@x402/hedera` (vendored) | |
| Ethereum | viem for ENS reads, ENSv2 writes (Permissioned Resolver `multicall` of `setText`) and ERC-8004 | No extra SDK; the calls follow the ENSv2 docs |
| Contracts | Solidity ^0.8.24, **Hardhat** (TS tests) | Works natively on Windows |
| LLM | Anthropic API, `@anthropic-ai/sdk`, `LLM_MODEL=claude-haiku-5-5` (fast and cheap; configurable) | API inputs are not used for training under Anthropic's commercial terms |
| Tests | Vitest (TS), Hardhat tests (contract) | |

```
ethernals/
├─ apps/
│  ├─ web/                 Next.js app (pages in §8.7)
│  └─ server/
│     └─ src/{identity,agents,buyer,verifier,writers,arena,db,api}/
├─ packages/
│  ├─ contracts/           HireLedger.sol, Hardhat config, deploy script, tests
│  └─ shared/              scoring.ts (R3/R4 mirror), reasons.ts, ens-keys.ts, types.ts
├─ scripts/                doctor, vendor-x402, hedera-setup, ens-setup, ens-sync, arena-prepare, demo-reset, agent-hire
├─ demo/                   sample inputs for the demo
├─ data/                   SQLite file (git-ignored)
├─ .env.example
├─ PRD.md  SETUP.md  README.md  AI_USAGE.md  WORLD_INTEGRATION.md
```

---

## 11. Interfaces

### 11.1 `HireLedger.sol` (Hedera testnet EVM)
```solidity
enum Reason { COUNTED, COUNTED_REPLACED_VOTE, SAME_PERSON, UNVERIFIED_BUYER,
              DUPLICATE_PAYMENT, NO_RATING, INVALID_RATING, UNKNOWN_AGENT }

struct HireInput {
  bytes32 agentKey;          // namehash(ens name)
  bytes32 buyerPersonHash;   // 0x0 = buyer not verified
  bytes32 paymentRef;        // keccak256(normalized Hedera tx id)
  string  paymentTxId;       // for humans and explorers
  uint256 amountPaid;        // smallest units (USDC: 6 decimals)
  uint8   rating;            // 0 = no rating, 1..5
  bytes32 consentHash;
  bytes32 parentHireRef;     // 0x0 unless this is a sub-hire
}

function registerAgent(bytes32 agentKey, bytes32 providerKey,
                       bytes32 providerPersonHash, uint256 basePrice) external; // onlyVerifier
function recordHire(HireInput calldata h) external returns (bool counted, Reason reason); // onlyVerifier
function recordHires(HireInput[] calldata hs) external;                           // onlyVerifier
function scoreOf(bytes32 agentKey) external view returns (uint256 scoreX1e6);     // (9+Σ)*1e6/(3+n)
function priceOf(bytes32 agentKey) external view returns (uint256);               // base*(9+Σ)/(3*(3+n))
function statsOf(bytes32 agentKey) external view returns (uint32 votes, uint32 sumVotes,
                                     uint32 hiresTotal, uint32 hiresCounted, uint256 basePrice);
function setVerifier(address v) external; // onlyOwner

event AgentRegistered(bytes32 indexed agentKey, bytes32 indexed providerKey, uint256 basePrice);
event HireRecorded(bytes32 indexed agentKey, uint256 indexed hireNo, bytes32 buyerPersonHash,
                   string paymentTxId, uint256 amountPaid, uint8 rating, bool counted,
                   Reason reason, bytes32 consentHash, bytes32 parentHireRef,
                   uint256 newScoreX1e6, uint256 newPrice);
```
Storage: `agents[agentKey]`, `lastVote[agentKey][buyerPersonHash]`, `usedPayment[paymentRef]`.

Decision order:
1. Unknown agent → `UNKNOWN_AGENT`.
2. Payment already used → `DUPLICATE_PAYMENT`.
3. Buyer hash is zero → `UNVERIFIED_BUYER`.
4. Buyer hash equals the provider hash → `SAME_PERSON`.
5. Rating 0 → `NO_RATING`.
6. Rating above 5 → `INVALID_RATING`.
7. The buyer has an earlier vote → `COUNTED_REPLACED_VOTE`.
8. Otherwise → `COUNTED`.

Every path except `UNKNOWN_AGENT` increments `hiresTotal`. A recorded hire still marks its payment as used, so a refused one cannot be replayed.

### 11.2 Server API (all JSON; sessions are HTTP-only cookies signed with `SESSION_SECRET`)
| Method and path | Purpose |
|---|---|
| `POST /api/auth/world/verify` | IDKit proof → create or sign in a person → session |
| `GET /api/me` | Person, buyer agent, balance, budget |
| `POST /api/agents` | Create a seller agent `{label, taskType, basePrice}` (session) |
| `GET /api/agents` · `GET /api/agents/:label` | Ledger stats, recent hires, ENS name (the UI reads the records from ENS itself) |
| `POST /api/hires` | Web hire `{agent, input, translateTo?, consent}`. Runs the person's buyer agent and returns `{hireId, result, paymentTxId, paymentUrl}` |
| `POST /api/hires/:id/rate` | `{rating}` with a session, or `{rating, signature}` from a buyer agent |
| `GET /api/hires/:id` | Status, reason, links |
| `GET /api/events` | SSE feed |
| `POST /api/arena/open/run` · `POST /api/arena/ethernals/run` · `GET /api/arena/state` | Arena |
| `POST /api/admin/expire-pass` | Demo control (F6). Requires `ADMIN_TOKEN` and works only when `DEMO_MODE=true` |
| `POST /a/:label/task` | x402-protected seller endpoint `{input, translateTo?, mandateId?}` |

### 11.3 ENS record schema (per agent subname)
| Key | Example | Written by |
|---|---|---|
| `description` | "Summarizes text in 5 bullet points" | platform (P2: provider) |
| `agent-endpoint[x402]` | `https://<public>/a/summarize/task` | platform (ENSIP-26-style key) |
| `agent-context` | "summarize · input: text ≤ 8k chars · output: 5 bullets" | platform |
| `ethernals.provider` | first 10 hex characters of the provider key | platform |
| `ethernals.basePrice` | `0.100000` | platform |
| `ethernals.price` | `0.116666` | verifier |
| `ethernals.score` | `3.50` | verifier |
| `ethernals.votes` | `1` | verifier |
| `ethernals.hires.counted` | `1` | verifier |
| `ethernals.hires.total` | `22` (debounced) | verifier |
| `ethernals.ledger` | `hedera:testnet:<HireLedger address>` | platform |
| `ethernals.updated` | ISO timestamp | verifier |
| `agent-registration[…][…]` | `1` (ENSIP-25 link to ERC-8004, P2) | platform |

### 11.4 Data model (SQLite). The database stores **no task content**, only hashes.
- `persons(id, world_nullifier UNIQUE, handle UNIQUE, mode, credential_expires_at, created_at)`
- `agents(key PK, ens_name UNIQUE, label, kind ['seller'|'buyer'], person_id, hedera_account_id, evm_address, enc_private_key, base_price, task_type, budget_remaining, status, erc8004_agent_id, created_at)`
- `hires(id PK, agent_key, buyer_agent_key, quoted_price, paid_amount, payment_tx_id UNIQUE, payment_status, input_hash, output_hash, mandate_id, rating, rated_at, counted, reason, ledger_tx_hash, ens_tx_hash, parent_hire_id, created_at)`
- `mandates(id, hire_id, forward, sub_budget, spent, expires_at)`
- `events(id, type, payload_json, created_at)`
- `arena_wallets(address, enc_private_key, side, funded_at)`

Private keys are encrypted at rest with AES-256-GCM using `KEYSTORE_SECRET`.

### 11.5 Environment variables (`.env.example` must list all of these with one-line comments)
| Variable | Default / example | Notes |
|---|---|---|
| `APP_NAME` | `Ethernals` | |
| `PUBLIC_BASE_URL` | `http://localhost:3000` | The public URL (tunnel or host) once online |
| `DEMO_MODE` | `true` | Enables demo controls |
| `DEV_FAKE_PERSONS` | `false` | Local development only |
| `SESSION_SECRET`, `PERSON_HASH_SECRET`, `KEYSTORE_SECRET`, `ADMIN_TOKEN` | (generated) | `pnpm check-setup --gen-secrets` |
| `DATABASE_PATH` | `./data/ethernals.db` | |
| `ANTHROPIC_API_KEY` | — | |
| `LLM_MODEL` | `claude-haiku-5-5` | |
| `WORLD_APP_ID` | `app_…` | World Developer Portal |
| `WORLD_RP_ID` | `rp_…` | If the portal shows one (v4 verify prefers it) |
| `WORLD_RP_SIGNING_KEY` | — | Only if the portal issues one |
| `WORLD_ACTION` | `ethernals-signup` | |
| `WORLD_ENV` | `staging` | `staging` = Simulator; `production` = real World App |
| `HUMAN_MODE` | `idkit` | `idkit` or `agentkit` |
| `WORLD_CHAIN_RPC_URL` | — | `agentkit` mode only (AgentBook lookups) |
| `HEDERA_NETWORK` | `testnet` | |
| `HEDERA_OPERATOR_ID` | `0.0.…` | Hedera portal |
| `HEDERA_OPERATOR_KEY` | `0x…` | ECDSA hex private key |
| `HEDERA_RPC_URL` | `https://testnet.hashio.io/api` | |
| `HEDERA_MIRROR_URL` | `https://testnet.mirrornode.hedera.com` | |
| `PAYMENT_ASSET` | `USDC` | `USDC` or `HBAR` |
| `HEDERA_USDC_TOKEN_ID` | `0.0.429274` | Circle's testnet USDC on Hedera |
| `BUYER_STARTING_USDC` | `1.00` | Given to each new buyer agent |
| `X402_FACILITATOR_URL` | `https://x402.org/facilitator` | Fallback `https://api.testnet.blocky402.com` |
| `HIRE_LEDGER_ADDRESS` | (written by `deploy:ledger`) | |
| `SEPOLIA_RPC_URL` | — | Alchemy, Infura or similar |
| `SEPOLIA_PRIVATE_KEY` | `0x…` | Platform wallet that owns the ENS parent name |
| `ENS_PARENT_NAME` | `ethernals.eth` | Any name you registered on Sepolia |
| `ERC8004_IDENTITY_REGISTRY` | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | Sepolia testnet |
| `ERC8004_REPUTATION_REGISTRY` | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | Sepolia testnet |
| `ARENA_FAKE_REVIEWERS` · `ARENA_FARM_HIRES` | `20` · `20` | |
| `BASE_MAINNET_RPC_URL` | `https://mainnet.base.org` | Read-only, for the cost counter |
| `ETH_USD_PRICE` | e.g. `3500` | A fixed number keeps the counter predictable |

---

## 12. Privacy and security requirements (the data promise, enforced in code)

The public promise, word for word in the README:

> *Task data is used only to perform the task that was paid for. Apart from the model API that runs the task, it never trains a model and never reaches another agent unless the hirer consents for that hire. Isolation is enforced by our software, not by secure hardware, and the model provider sees the task data it processes.*

| ID | Requirement |
|---|---|
| SEC-1 | **Fresh workspace per hire:** `os.tmpdir()/ethernals/<hireId>`, deleted in a `finally` block. A test asserts that it is deleted after both success and failure. |
| SEC-2 | **No shared memory:** the agent runtime is stateless across hires. No vector store, no conversation history, no caching that includes hire content. A system prompt with no user data may be cached. |
| SEC-3 | **Outbound allowlist:** all outbound HTTP from the agent runtime goes through `safeFetch()`, which allows only the LLM API host, the facilitator, and the endpoint named in an active mandate. Anything else throws and logs `EGRESS_BLOCKED`. |
| SEC-4 | **Consent is off by default** and checked in code (`subHire()`), never left to the model. |
| SEC-5 | **The database holds no task content:** only `input_hash` and `output_hash`. Logs never print input or output text, and there is a log-redaction test. |
| SEC-6 | **Prompt-injection posture:** task input is wrapped as data. The seller agent has **no** tools except the code-gated sub-hire. The LLM judge gets the result as quoted data. This follows the "Rule of Two": never combine untrusted input, private data and free outbound communication. |
| SEC-7 | Keys are encrypted at rest (§11.4). `.env` and `data/` are git-ignored, and a pre-commit check refuses to commit files that contain `PRIVATE_KEY=0x` with a value. |
| SEC-8 | Testnets only. A server running in `production` mode with `HEDERA_NETWORK=mainnet` refuses to start in v1. |
| SEC-9 | **What we don't claim** (README and Q&A): World ID stops one person posing as many, not two people colluding; one vote per person limits what collusion buys. The backend is a trusted verifier in v1. There is no hardware confidentiality. |

---

## 13. Sponsor requirement checklist (from the Mumbai prize pages)

**World: Agent Pass ($5,000) and Best Use of IDKit ($2,500).** Picking World as a partner enters both.
- [ ] The full journey from request to protected action: a hire gains or does not gain a reputation vote.
- [ ] A denied path where the action does not happen: `SAME_PERSON` (F5), plus expired or unregistered credentials (F6).
- [ ] Proofs validated on the backend (ID-1), never trusted from the client.
- [ ] Official Agent Pass / AgentKit integration (ID-5). **⚠ CHECK AT HOUR 0**
- [ ] IDKit: the minimum sufficient credential (proof of uniqueness only), with the reason explained in the README (ID-4).
- [ ] `WORLD_INTEGRATION.md`: the integration write-up / debrief the track asks for.

**ENS: Best Use of ENSv2 ($7,000; bonus for AI agents)**
- [ ] ENSv2 is central: the subnames *are* the agents, buyers discover and price through ENS, and records update after every counted hire (ENS-1 to ENS-4).
- [ ] Built on Sepolia (allowed), with a functional demo that is not hard-coded (records read live).
- [ ] A live demo link and open-source code.

**Hedera: AI Agents That Pay, x402 on Hedera ($6,500)**
- [ ] An x402-protected endpoint that settles on Hedera testnet (PAY-1).
- [ ] An agent that pays end to end with no human approval (F4).
- [ ] A public repo whose README includes at least one **Hedera transaction ID**, with HashScan links.
- [ ] A demo of 5 minutes or less linking to HashScan.
- [ ] Extra points: spending controls (PAY-7, mandates), agent identity (ENS + World), audit logs (ledger events), HTS token (USDC).

**ETHGlobal rules**
- [ ] All code is written after hacking started (Classic track).
- [ ] Commit small and often, since large single commits risk disqualification.
- [ ] `AI_USAGE.md` lists the AI tools used. Spec files and prompts are committed, including this PRD.
- [ ] Video 2–4 min, at least 720p, not sped up.
- [ ] No more than 3 partner prizes selected.

---

## 14. Demo script (4:00) and video

| Time | Beat | On screen |
|---|---|---|
| 0:00–0:20 | Hook: "AI agents can pay each other now. But 59–91% of agent reviewers on the open standard look fake, and a fake review costs under six cents. Watch." | `/arena` |
| 0:20–0:55 | **Left attack:** 20 fresh wallets → average 3.0 → about 4.8, "≈ $0.0X on Base mainnet" | Left panel, Etherscan link |
| 0:55–1:25 | **Right attack:** Alice's 20 agents hire her own agent and rate it 5. All paid, "0 counted", score 3.00. "Bots can pay. Only people can vouch." | Right panel, HashScan link, log badges |
| 1:25–2:20 | **Real hire:** Bob (a different World ID) hires `summarize.ethernals.eth` from his laptop and rates it 5 → 3.50 and 0.117 appear in ENS | Agent page; then the **official ENS app** showing the same records |
| 2:20–3:10 | **Autonomous and consent:** the CLI buyer agent hires with "translate to Hindi". Consent off → `SUBHIRE_BLOCKED`; consent on → `translate.ethernals.eth` paid and counted for Carol | Terminal and log |
| 3:10–3:40 | Proof, not trust: the HireLedger events on HashScan; "the counting rule lives in the contract" | HashScan |
| 3:40–4:00 | Close: "Agent factories make agents. Ethernals tells you which ones to pay." Plus what we don't claim, in one sentence | Title card |

Video (2–4 min): the same beats, recorded from a clean `pnpm demo:reset` run, with no speed-up.

**Prepared Q&A answers.**
- "Can two real people collude?" Yes, but each gets one vote and pays real fees.
- "Why trust your backend?" In v1 you have to. The contract enforces the counting, and moving the proof checks on-chain is next.
- "Is the data private?" From other agents and other hirers, yes, enforced in code. From the model provider, no, and we say so.

---

## 15. Build plan (about 20 hours) and cut order

Count back from the **07:00 IST Saturday** freeze. If fewer than 20 hours remain, cut from the bottom of the cut list.

| Hours | Build | Done when |
|---|---|---|
| 0–1 | **Spikes (each must pass):** World ID staging proof verified server-side; one x402 USDC payment on Hedera testnet through the facilitator; one ENSv2 subname record written on Sepolia and read back with viem; one ERC-8004 `register` + `giveFeedback` on Sepolia; one LLM call; HashScan links open for a payment and a contract call | Each spike prints a link or value |
| 1–5 | `HireLedger` + tests + deploy; `shared/scoring.ts` + fixture tests (§6.3); SQLite schema; verifier (mirror-node check, person hashes) | Contract tests are green; a scripted `SAME_PERSON` and `COUNTED` hire land on testnet |
| 5–9 | Seller endpoint (x402, dynamic price, workspace, `safeFetch`); buyer runtime (x402 client, budget, LLM judge); rating → record loop; `pnpm agent:hire` | F4 works end to end and prints a HashScan link |
| 9–12 | ENS subname issuance, record writes after counted hires, live reads; `ens:sync` | The official ENS app shows the score change after a hire |
| 12–15 | Arena: `arena:prepare`, both attacks, SSE, split-screen page | Both attacks finish in 45 s or less, with correct counts |
| 15–17 | Web: `/signup`, `/agents/[label]`, hire form, rating, log, `/provider` | A judge can follow F3 without a terminal |
| 17–18.5 | P1: sub-hire + mandates (F7); expire pass (F6); different-person toggle | F7 shows both blocked and allowed outcomes |
| 18.5–19.5 | `README.md` (architecture, Hedera tx IDs, HashScan links, data promise, what we don't claim), `AI_USAGE.md`, `WORLD_INTEGRATION.md`, video | Every §13 box is ticked |
| 19.5–20 | Submit by 07:00 IST | Submission confirmed |

**Cut order if behind** (cut the first item first): P2 items → sub-hire (F7) → expire pass (F6) → `/provider` cross-agent history → UI polish (fall back to terminal + ENS app + HashScan tabs). **Never cut:** the counting rule, the Arena, ENS live records, or the HashScan links.

**Team split**
- **Solo:** do everything in the order above and cut F6/F7.
- **Two people:** A takes the ledger, verifier, Hedera payments and agents; B takes the web app, World ID, ENS and the Arena.
- **Three people:** A takes the ledger, verifier and Hedera; B takes the agents, x402, CLI and sub-hire; C takes the web app, World ID, ENS, the Arena UI and the video.

---

## 16. Testing and definition of done

- **Unit tests (Vitest):**
  - scoring and pricing against the §6.3 fixtures;
  - the full R1 reason matrix;
  - person-hash unlinkability (same person and different agents give different hashes);
  - mandate checks;
  - `safeFetch` blocking;
  - workspace deletion;
  - log redaction.
- **Contract tests (Hardhat):** every `Reason` path, vote replacement, batch recording, `onlyVerifier`, and event fields.
- **Testnet end-to-end check (`pnpm agent:hire` scripted):** one `COUNTED` and one `SAME_PERSON` hire, asserting the ledger events and the ENS record change.
- **Rehearsal:** run the §14 script twice from `pnpm demo:reset`, timed.

**v1 is done when:**
1. `pnpm demo:reset` followed by the §14 script runs end to end on testnets in 4:00 or less, with every link working.
2. `pnpm test` is green.
3. Every §13 box is ticked.
4. The submission is in before 09:00 IST.

---

## 17. Risks and first-hour checks

| Risk | Check / mitigation |
|---|---|
| `@x402/hedera` is brand new (v2.30) | Pinned version. ✔ Verified during the build: the 402 quote comes back with the x402.org facilitator's Hedera fee payer. Spike one real payment at hour 0. |
| The facilitator is down or rejects payments | `/supported` check on boot; switch `X402_FACILITATOR_URL` to Blocky402 |
| USDC association and faucet limits (10 USDC per address per 24 h) | Auto-association on created accounts; the operator funds agents; teammates can request faucet USDC to their own accounts; `PAYMENT_ASSET=HBAR` as a fallback |
| World staging/production mismatch causes failed proofs | Keep `WORLD_ENV` and the action's environment the same; use the Simulator for test persons |
| Agent Pass = AgentKit? An Orb is needed, and there are no Orbs in India | Ask World's booth at hour 0. `HUMAN_MODE=idkit` keeps the IDKit prize and the counting rule either way. |
| ENSv2 write path and roles are brand new (live since 27 Oct) | Use ENSjs helpers; test resolution with the exact viem version used in the demo; fall back to the platform writing every key |
| Nonce collisions under parallel hires | One writer queue per chain, plus batching (LED-4) |
| Not enough Sepolia ETH for the Arena | `arena:prepare` prints the requirement; lower `ARENA_FAKE_REVIEWERS` |
| LLM latency on stage | Haiku model, low `max_tokens`, short demo inputs in `demo/` |
| The deadline | Freeze at 07:00 IST; record the video before polishing |

---

## 18. After Mumbai (not v1)

- Scores personalized to each buyer and capped by real payment flow, the Anduin approach ([arXiv 2611.05586](https://arxiv.org/abs/2611.05586)).
- Moving proof checks and payment verification on-chain to remove the trusted backend.
- Escrow with refunds (the x402 job-escrow proposal, ERC-8183).
- Self (Aadhaar or passport) as a second proof of personhood for India.
- Rating any x402 seller, including agents from other platforms, through the ERC-8004 bridge (AR-6, ENS-7).
- Optional TEE execution, priced and caveated.

## 19. Sources
- Mumbai prizes and rules: [ethglobal.com/events/mumbai/prizes](https://ethglobal.com/events/mumbai/prizes), [rules & judging](https://ethglobal.com/events/mumbai/info/details)
- ERC-8004 spec: [EIP-8004](https://eips.ethereum.org/EIPS/eip-8004). Testnet registries: [QuickNode contracts](https://erc-8004.quicknode.com/docs/contracts), [Base docs](https://docs.base.org/ai-agents/reference/contracts). Sybil study: [arXiv 2606.26028](https://arxiv.org/abs/2606.26028)
- x402 on Hedera: [Hedera x402 docs](https://docs.hedera.com/solutions/ai/x402), [facilitators](https://docs.hedera.com/solutions/ai/x402/facilitators), [merchant integration](https://docs.hedera.com/solutions/ai/x402/merchant-integration)
- USDC on Hedera (testnet token 0.0.429274) and the faucet: [Circle](https://www.circle.com/multi-chain-usdc/hedera), [faucet.circle.com](https://faucet.circle.com)
- World: [AgentKit announcement](https://world.org/blog/announcements/now-available-agentkit-proof-of-human-for-the-agentic-web), [IDKit repo](https://github.com/worldcoin/idkit)
- ENSv2: [subnames](https://docs.ens.domains/ensv2/subnames), [app-developer tutorial](https://docs.ens.domains/ensv2/tutorial-app-developers)
- Wash volume and real spend: [TRM Labs](https://www.trmlabs.com/trm-tech-blog/whos-actually-paying-measuring-ai-agent-payments-onchain); marketplace collapse: [ChainWard](https://chainward.ai/decodes/virtuals-top-dog)
