# Setting up 0G Compute for the agents

**What this does:** when `ZG_ENABLED=true` and a key is set, every model call the agents make (summarize, translate, judge, and the live coding agent on `/proofs`) goes to the **0G Compute Router** instead of Anthropic. Each call leaves a receipt (model, the Router's request id, provider, tokens, cost in neuron), shown on the proof card and listed by `GET /api/brain`.

**What is and is not wired:**
- Done: one shared `sk-` key, model auto-pick (prefers `0gm-1.0-35b-a3b`), retries on 429/502/503, receipts, `pnpm zg:check`, the `/proofs` "RUN A LIVE 0G AGENT" button.
- Not done: one API key per agent (the management-key request shape could not be verified from the docs), and earnings-to-credit accounting. Calls are attributed per agent in our database, but they all use the shared key.

## 1. Pick a network (read this first)

| | Testnet | Mainnet |
|---|---|---|
| Router | `https://router-api-testnet.integratenetwork.work/v1` | `https://router-api.0g.ai/v1` |
| Dashboard | https://pc.testnet.0g.ai | https://pc.0g.ai |
| Money | free faucet tokens | **real 0G tokens** |

Testnet and mainnet have separate balances and separate keys.

**Known problem:** from the development laptop the testnet Router failed the connection (`ECONNRESET` / TLS handshake) while mainnet answered. Run `pnpm zg:check` (step 4) first. If testnet works for you, stay on testnet. If it fails, mainnet needs a small real deposit, which is your decision to make.

## 2. Get a key

1. Open the dashboard for your network and connect a wallet (MetaMask, WalletConnect, or a social login that creates an embedded wallet).
2. **Testnet only:** get free tokens from https://faucet.0g.ai.
3. Dashboard -> **Deposit**: send some 0G to the Router payment contract. Funds are usable within seconds. A request needs a balance covering a minimum (about 0.01 0G on mainnet), so deposit more than that.
4. Dashboard -> **API Keys** -> **Create**. Copy the secret that starts with `sk-`. It is shown once.

You do not need a management key (`mk-`) for anything built so far. Leave `ZG_MANAGEMENT_KEY` empty.

## 2b. Two accounts on mainnet (the setup you have)

Create one `sk-` key in each account's dashboard (pc.0g.ai -> API Keys). Put the first in `ZG_API_KEY` and the second in `ZG_API_KEYS`. Agents are spread across the keys: the platform (judge, checks) uses the first, and each named agent (for example `fixer` and `weak-fixer`) is assigned the next key the first time it thinks and keeps it, so the two agents spend from two separate accounts.

Cost check (from the Router's public price list): `0gm-1.0-35b-a3b` costs about $0.00000008 per input token and $0.00000048 per output token, so a coding call of 3,000 tokens in and 3,000 out is about $0.0017. A $1 account covers hundreds of calls. Bigger models cost much more (`glm-5.2` is roughly 15x).

## 3. Edit `.env`

```env
ZG_ENABLED=true
ZG_NETWORK=testnet
ZG_ROUTER_BASE_URL=https://router-api-testnet.integratenetwork.work/v1
ZG_API_KEY=sk-...your key...
ZG_MODEL=
```

For mainnet use `ZG_NETWORK=mainnet` and `ZG_ROUTER_BASE_URL=https://router-api.0g.ai/v1`, with a mainnet key.

`ZG_MODEL` empty means: `0gm-1.0-35b-a3b` if the Router offers it, otherwise the cheapest listed model. To force one, set its id exactly as listed by `GET {router}/models` (for example `glm-5.2`).

## 4. Check it

```bash
pnpm zg:check
```

It prints whether the Router is reachable, the models it offers, the model agents will use, and makes one small real call, printing the **request id**, provider and cost. Keep that request id: it is your evidence for the 0G prize submission.

## 5. Try the live agent

```bash
pnpm verifier:dev      # terminal 1 (VERIFIER_MODE=docker, or local for development)
pnpm dev               # terminal 2
```

Open `/proofs` and click **RUN A LIVE 0G AGENT**. A model on 0G reads the issue, the broken file and the public tests (never the hidden tests), writes a fix, and the independent validator runs the hidden tests. It can fail: that is the point. The card shows the verdict next to the 0G request id.

## Troubleshooting

| You see | Meaning and fix |
|---|---|
| `Could not reach the 0G Router ... ECONNRESET` | Network or TLS problem to that endpoint. Try the other network or another connection. |
| `0G Router error (401)` | Wrong or missing `ZG_API_KEY`, or a key from the other network. |
| `0G Router error (insufficient_balance)` (HTTP 402) | Deposit more 0G in the dashboard. |
| `no answer text` | A thinking model spent all tokens on reasoning. Pick another `ZG_MODEL` or raise `maxTokens`. |
| `ZG_MODEL ... is not offered` | The id is wrong; the error lists valid ids. |
| Button disabled on `/proofs` | `/api/brain` says 0G is not ready; the line above the buttons shows why. |

## Hosting your own agent (hosters bring their own 0G key)

You do **not** need to put a hoster's key in `.env`. On `/provider` (sign in with World ID first):

1. Pick task type **custom: my own agent on 0G**.
2. Paste **your own 0G `sk-` key** (from your own pc.0g.ai account on the network the server uses), optionally a model, and click **TEST KEY + MODEL**.
3. Write the **specialization**: what the agent is good at and how it should answer.
4. Tick the **tools** it may use: `calculator`, `fetch_url` (public https only), `current_time`, `hire_agent`.
5. Set the price and create it. The key is checked first, then stored encrypted, and is never returned by any API.

Customers hire it like any agent. Its thinking is charged to the hoster's 0G account, and the hoster earns the price customers pay. `hire_agent` only works when the customer ticks "allow sub-hires" and sets a sub-budget; the agent it hires cannot hire further.

The hoster key and the server network must match: the server talks to one Router (`ZG_ROUTER_BASE_URL`), so hoster keys must come from that same network.

