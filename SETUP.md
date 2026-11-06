# Setting up Ethernals: a plain-English guide

This guide is for anyone on the team, including people who have never set up a blockchain project. Do the steps in order, from top to bottom. The first time takes about **60–90 minutes**, mostly spent waiting for websites and downloads.

**Cost:** about **$5** of credit for the AI model. Everything else is free, because we only use *test* networks, where the money is pretend.

---

## The big picture

To run, Ethernals needs six things.

| Thing | What it is, in plain words | Why Ethernals needs it |
|---|---|---|
| Node.js and pnpm | The engine that runs the code, and the tool that installs its parts | Without them, nothing runs |
| A test wallet on Ethereum's practice network (Sepolia) | A practice bank account holding pretend money | Pays the small fees for agent names and for the Arena attack demo |
| A Hedera test account | A second practice account, on a different network (Hedera) | Agents pay each other here, and the scoreboard lives here |
| An ENS name | A web address, but for agents | Every agent gets a name like `summarize.yourname.eth` |
| A World ID app | A "prove you're a real, unique person" button | So one person can't pretend to be many people |
| An Anthropic API key | A key that lets the agents use an AI model | The agents need a "brain" to do their tasks |

## Words you'll see

- **Testnet:** a practice copy of a blockchain. Its money is free and worthless. This project only uses testnets.
- **Faucet:** a website that gives out free testnet money.
- **Wallet address:** like an account number. It's safe to share. It starts with `0x…`, or on Hedera looks like `0.0.12345`.
- **Private key:** like the master password to a wallet. **Never share it.** It goes only into your `.env` file.
- **RPC URL:** the address the app uses to talk to a blockchain, a bit like a phone number.
- **`.env` file:** a private settings file on your computer that holds all your keys. It never gets uploaded.
- **Terminal:** the window where you type commands. On Windows, use **PowerShell**: press the Windows key, type `PowerShell`, and press Enter.

## Safety rules (read these once)

1. **Make a brand-new wallet just for this project.** Never put the key of a wallet that holds real money anywhere in this project.
2. **Never share your `.env` file,** and never paste keys into chat, Discord or GitHub. The project is already set up so `.env` can't be uploaded to GitHub, so leave that setting alone.
3. **Everything here is test money.** If anything asks for real money, other than the $5 of AI credit, stop and ask the team.

## Checklist

- [ ] Step 1: tools installed
- [ ] Step 2: code downloaded
- [ ] Step 3: settings file created
- [ ] Step 4: Ethereum test wallet, test ETH and RPC URL
- [ ] Step 5: ENS name registered
- [ ] Step 6: Hedera test account and test USDC
- [ ] Step 7: World ID app
- [ ] Step 8: AI key
- [ ] Step 9: payment helper (nothing to do unless it breaks)
- [ ] Step 10: first run
- [ ] Step 11: online link for judges
- [ ] Step 12: pre-demo checklist

---

## Step 1: Install the tools (about 10 min)

**On Windows:**
1. **Node.js:** go to **nodejs.org**, download the **LTS** version (22 or newer), run the installer and keep clicking *Next*.
2. **Git:** go to **git-scm.com**, click *Download for Windows*, and install with the default options.
3. Open **PowerShell** and install pnpm:
   ```powershell
   npm install -g pnpm
   ```
4. Check that everything worked. Each command should print a version number:
   ```powershell
   node -v
   pnpm -v
   git --version
   ```
   `node -v` must show **v22.13** or higher.

**On Mac:** install Node.js (LTS) from nodejs.org and Git from git-scm.com, or with Homebrew run `brew install node git`. Then run `npm install -g pnpm`.

> If PowerShell says a command "is not recognized", close PowerShell, open it again, and retry. New installs only show up in new windows.

## Step 2: Get the code (about 10 min)

In PowerShell, run these one at a time. Replace `<repo URL>` with your team's GitHub link.
```powershell
git clone <repo URL> ethernals
cd ethernals
pnpm install
```

The first install can take a few minutes. Let it finish.

From now on, **always run commands from inside the `ethernals` folder.**

## Step 3: Create your settings file (2 min)

```powershell
Copy-Item .env.example .env
pnpm check-setup --gen-secrets
```
(On a Mac, use `cp .env.example .env` instead of `Copy-Item`.)

- This creates your private `.env` file and fills in four random passwords for you: `SESSION_SECRET`, `PERSON_HASH_SECRET`, `KEYSTORE_SECRET` and `ADMIN_TOKEN`.
- Open `.env` in Notepad or VS Code. You'll fill in the blanks during the next steps. Each line looks like `NAME=value`, with no spaces around the `=`.

## Step 4: Ethereum test wallet, Sepolia (about 15 min)

**4a. Make the wallet.** Install the **MetaMask** browser extension from metamask.io and choose *Create a new wallet*. Write down the recovery phrase and keep it private, even though this is only a test wallet.

**4b. Switch to the test network.** In MetaMask, open the network menu, turn on **Show test networks**, and pick **Sepolia**.

**4c. Copy the private key into `.env`.**
1. In MetaMask, open the account menu (⋮), then *Account details*, then *Show private key*.
2. Enter your password and copy the key.
3. In `.env`, set:
   ```
   SEPOLIA_PRIVATE_KEY=0x...your key...
   ```
   If the key doesn't start with `0x`, type `0x` in front of it.

**4d. Get free test ETH.**
1. Open Google's free faucet: **cloud.google.com/application/web3/faucet/ethereum/sepolia** and sign in with Google.
2. Paste your **wallet address**: the `0x…` shown at the top of MetaMask, *not* the private key.
3. Aim for about **0.2 Sepolia ETH** in total. Faucets give a small amount per day, so ask teammates to request some and send it to your address.

**4e. Get an RPC URL.**
1. Sign up free at **alchemy.com** and choose *Create new app*.
2. Pick **Ethereum**, network **Sepolia**, and copy the **HTTPS** URL.
3. In `.env`, set:
   ```
   SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/...
   ```

## Step 5: Register your ENS name on Sepolia (about 5 min)

This is the "family name" that all your agents will live under. For example, if you register `ethernals-team42.eth`, your agents become `summarize.ethernals-team42.eth`.

1. Open the ENS app's **Sepolia** (test) version: **sepolia.app.ens.domains**. If that address has moved, the ENS docs link the current testnet app. Connect MetaMask, with Sepolia selected.
2. Search for a free name and register it. One year is plenty. ENS asks you to confirm **twice, about a minute apart**. That's normal.
   - ENS's new version (ENSv2) runs on Sepolia, so registering may ask you to pay with a **test stablecoin** (pretend dollars) instead of test ETH. Follow the app's prompts. If it needs test tokens and you can't find a way to get them, ask the ENS team at their booth.
3. In `.env`, set:
   ```
   ENS_PARENT_NAME=ethernals-team42.eth
   ```
   Use your real name choice.
4. That's all for now. In Step 10, `pnpm ens:setup` prepares the name automatically: it creates a record store for your agents and saves its address as `ENS_RESOLVER_ADDRESS` in `.env`.

## Step 6: Hedera test account and test USDC (about 10 min)

**6a. Create the account.** Go to **portal.hedera.com**, sign up, and create a **Testnet** account. If it asks for a key type, choose **ECDSA**. This matters: the other option won't work with this project.

**6b. Copy two values into `.env`.**
```
HEDERA_OPERATOR_ID=0.0.12345           ← the "Account ID"
HEDERA_OPERATOR_KEY=0x...              ← the "HEX Encoded Private Key" (add 0x if missing)
```
The portal also gives you free test **HBAR**, Hedera's own coin, which pays network fees.

**6c. Let your account accept USDC.** On Hedera, an account has to opt in to a token before it can receive it (this is called "associating"). Run:
```powershell
pnpm hedera:setup
```
It should end by printing your HBAR and USDC balances.

**6d. Get free test USDC.**
1. Go to **faucet.circle.com**, choose **USDC**, then **Hedera Testnet**.
2. Paste your **Account ID** (the `0.0.…` one) and send.
3. You get **10 USDC per day**. Run 6c *before* this step, or the USDC can't arrive.
4. Teammates can each request 10 more and send it to the same account.

**6e. Leave these as they are:** `HEDERA_USDC_TOKEN_ID=0.0.429274`, `HEDERA_RPC_URL` and `HEDERA_MIRROR_URL`.

## Step 7: World ID, proving people are real (about 15 min)

**7a. Create the app.** Go to **developer.world.org** (older links say developer.worldcoin.org; it's the same place). Sign in and create a new app. If it asks for a type, choose **External** (not Mini App). The portal shows an **App ID**, an **RP ID** and a **signing key**. **Copy the signing key straight away: it is shown only once.**

**7b. Copy the IDs into `.env`.**
```
WORLD_APP_ID=app_...
WORLD_RP_ID=rp_...
WORLD_RP_SIGNING_KEY=...          ← the key shown only once; keep it secret
```

**7c. Create an action.**
- Create it in the **Staging** environment, name it exactly `ethernals-signup`, and allow **1 verification per person** if the portal offers that setting.
- Staging works only with the Simulator (below). For real phones later, create the same action in **Production** and set `WORLD_ENV=production`.
- Then set:
  ```
  WORLD_ACTION=ethernals-signup
  WORLD_ENV=staging
  HUMAN_MODE=idkit
  ```

**7d. Make pretend people for testing.**
- In staging mode you don't use the real World App. You use the **World ID Simulator**, a website that pretends to be the World App: **simulator.worldcoin.org**.
- **Each identity in the Simulator counts as a different person.**
- For the demo you need at least three: **Alice** (owns the `summarize` agent), **Bob** (hires it) and **Carol** (owns the `translate` agent).
- Tip: use a different browser, or a different browser profile, for each person so their logins don't mix.
- If the Simulator says it can't make a "World ID 4.0" proof, set `WORLD_ALLOW_LEGACY_PROOFS=true` in `.env` and restart `pnpm dev`.

> **Staging and production must match.** A *staging* app works only with the *Simulator*, and a *production* app works only with the *real World App*. Mixing them makes verification fail with no clear message.

**7e. Optional: World's "Agent Pass" prize (AgentKit).** World has marked its AgentKit toolkit as deprecated, so treat this as a bonus, and ask World's team which tool the Mumbai "Agent Pass" prize expects.
- This needs a teammate with an **Orb-verified** World ID. Orbs are World's eye-scanning devices, and they generally haven't been available in India since 2023. **Ask the World team at their booth first.** They may have a way to do it at the event.
- If you get one:
  1. Set `HUMAN_MODE=agentkit` and add `WORLD_CHAIN_RPC_URL` (the World team or the docs can give you one).
  2. Run `pnpm check-setup`. It lists your agents' addresses.
  3. For each address, run the command below and approve it in the World App:
     ```powershell
     npx @worldcoin/agentkit-cli register <address>
     ```
- If you can't get one, stay on `HUMAN_MODE=idkit`. Everything still works, and you still qualify for the IDKit prize.

## Step 8: AI key, Anthropic (about 5 min)

1. Go to **console.anthropic.com** and sign up.
2. Under **Billing**, add **$5** of credit. That's plenty for a hackathon.
3. Under **API keys**, choose **Create key** and copy it.
4. In `.env`, set:
   ```
   ANTHROPIC_API_KEY=sk-ant-...
   ```
5. Leave `LLM_MODEL=claude-haiku-5-5` as it is. It's fast and cheap.

## Step 9: The payment helper (nothing to sign up for)

Agent payments go through a free public helper service, called a "facilitator", that pays Hedera's network fee and delivers the payment. The default needs no account:
```
X402_FACILITATOR_URL=https://x402.org/facilitator
```
If `pnpm check-setup` ever says the facilitator is down, switch to the backup, then restart the app:
```
X402_FACILITATOR_URL=https://api.testnet.blocky402.com
```

## Step 10: First run (about 15 min)

Run these one at a time:
```powershell
pnpm check-setup
pnpm deploy:ledger
pnpm ens:setup
pnpm dev
```

| Command | What it does | You'll know it worked when… |
|---|---|---|
| `pnpm check-setup` | Checks every setting and balance | Every line says **OK**. If one doesn't, it tells you in plain words what to fix. |
| `pnpm deploy:ledger` | Puts the scoreboard contract on Hedera | It prints an address and fills in `HIRE_LEDGER_ADDRESS` in `.env` for you |
| `pnpm ens:setup` | Prepares your ENS name to hold agent names | It prints "ENS ready" |
| `pnpm dev` | Starts the app | It prints `http://localhost:3000`. Leave this window open while you use the app. |

Open **http://localhost:3000** in your browser. Then try the whole thing once:

1. **Sign up three people** at `/signup` using three Simulator identities: Alice, Bob and Carol.
2. **As Alice,** go to `/provider` and create an agent called `summarize` with base price `0.10`.
3. **As Carol,** create an agent called `translate` with base price `0.05`.
4. **Check ENS:** open the ENS app (Sepolia) and search `summarize.<your ENS name>`. You should see **score 3.00** and **price 0.100000**.
5. **As Bob,** open `/agents/summarize`, paste some text, click **Hire**, and give it **5 stars**. Within about a minute the score becomes **3.50** and the price **0.116666**, both on the page and in the ENS app.
6. **Prepare the Arena** (the attack demo). Open a **second** PowerShell window in the `ethernals` folder and run:
   ```powershell
   pnpm arena:prepare -- --attacker alice
   ```
   It tells you how much test money it needs, and stops if you don't have enough.
7. **Try the robot buyer,** where an agent pays with no human clicking:
   ```powershell
   pnpm agent:hire --as bob-buyer --agent summarize.<your ENS name> --input demo/sample.txt
   ```
   It prints a **HashScan** link. Click it to see the real payment on Hedera's explorer.

## Step 10b: Proof-of-work tasks (about 45 min)

This adds tasks, the Duel, 0G brains and spending controls. Do it after Step 10 works.

**Docker Desktop.** The verifier runs hidden tests inside Docker, so a patch can't touch your machine.

1. Install Docker Desktop from docker.com and start it.
2. Build the test image:

   ```bash
   pnpm verifier:image
   ```

**0G Compute: where agents think.**

Testnet and mainnet are separate: each has its own console, Router, keys and balance. Start on testnet if its Router answers:

```bash
curl https://router-api-testnet.integratenetwork.work/v1/models
```

If that fails with a TLS or connection error from every machine you try, tell the team. Mainnet spends real money, so only a person may approve it.

| | Testnet | Mainnet |
|---|---|---|
| Console | pc.testnet.0g.ai | pc.0g.ai |
| `ZG_NETWORK` | `testnet` | `mainnet` |
| `ZG_ROUTER_BASE_URL` | `https://router-api-testnet.integratenetwork.work/v1` | `https://router-api.0g.ai/v1` |

1. Open the console and connect a wallet (Google sign-in works).
2. Add funds. On testnet, get tokens at faucet.0g.ai and deposit them.
3. Go to Management Keys. Create a key with the scopes `keys:create` and `keys:read`. Paste it into `ZG_MANAGEMENT_KEY` in `.env`.
4. Go to API Keys. Create a key with the trust mode set to **Private**, and paste it into `ZG_API_KEY`. Agents use it if they can't get their own.
5. Set `ZG_NETWORK` and `ZG_ROUTER_BASE_URL` to match your console. If you set `ZG_MODEL`, pick a model listed as `TeeML`.

The server creates each text agent's key as Private and pins every text call to Private mode. If no sealed provider is free, 0G answers 503 and the agent's call fails. It never falls back to a weaker provider.

Image and video agents get a standard key, because no video model has a sealed provider. They need `ZG_MANAGEMENT_KEY` or their own key: a Private `ZG_API_KEY` can't reach them. Each request costs real money.

**Namera: spending limits.** You can skip this: people who don't connect use the weaker server-side limits.

1. Sign up at dashboard.namera.ai and create an account (a smart account).
2. Create a session key for **Ethereum Sepolia** with a tUSDC limit and an expiry, allowing the tUSDC and TaskEscrow contracts, then approve its installation.
3. Create an API key that can read wallets and session keys and run executions.
4. Paste the API key, wallet id and session key id into **Connect Namera**, on `/me` or in the hire form.

**The verifier and the escrow.**

1. Create the verifier's keys:

   ```bash
   pnpm verifier:setup
   ```

2. Deploy the escrow and the test token:

   ```bash
   pnpm deploy:escrow
   ```

**The two coders.** Sign up two people who won't be the client in your demo, then create the agents. Replace the handles with theirs:

```bash
pnpm --filter @ethernals/server exec tsx scripts/seed-coders.ts --strong alice --weak carol
```

If the client owns one of these agents, its votes won't count.

**Run the Duel.** Start `pnpm dev`, sign in as your client, open `/duel` and press Start duel. Check everything with:

```bash
pnpm check-setup
```

## Step 11: Put it online so judges can open it

Judges need a link that works. There are two ways to get one.

**Option A, quick tunnel (good for the live demo at your table).**
1. Install the tunnel tool:
   ```powershell
   winget install --id Cloudflare.cloudflared
   ```
2. With `pnpm dev` running, open another window and run:
   ```powershell
   cloudflared tunnel --url http://localhost:3000
   ```
3. It prints an address like `https://something.trycloudflare.com`. Put it in `.env` as `PUBLIC_BASE_URL=...`.
4. Restart `pnpm dev`, then run `pnpm ens:sync` so your agents' ENS records point at the new address.
5. Downside: the link stops working when your laptop sleeps, and you get a **new** address every time you restart the tunnel. Run `pnpm ens:sync` again each time.

**Option B, hosting that stays up (best for judges who check after the event).**
1. Make an account at **railway.app** and choose **New Project**, then **Deploy from GitHub repo**, and pick your repo.
2. In the service's **Settings**, set:
   - **Build command:** `pnpm install && pnpm build`
   - **Start command:** `pnpm start`
3. In **Variables**, add every line from your `.env`. Railway has a "raw editor" where you can paste them all at once.
4. Add a **Volume** (storage that survives restarts) mounted at `/app/data`, and set `DATABASE_PATH=/app/data/ethernals.db`.
5. Under **Networking**, choose **Generate Domain** with port **3000**, and copy the address.
6. Set `PUBLIC_BASE_URL` to that address, both in Railway and in your local `.env`. Then run `pnpm ens:sync` once from your laptop.

## Step 12: Before the demo (checklist)

- [ ] Stop `pnpm dev`, then run `pnpm demo:reset`: every score goes back to 3.00. Your people and agents are kept. Start `pnpm dev` again afterwards.
- [ ] `pnpm arena:prepare -- --attacker alice`
- [ ] `pnpm check-setup`: everything **OK**, with enough HBAR, USDC and Sepolia ETH
- [ ] Alice, Bob and Carol are signed in, in three different browsers or profiles
- [ ] Tabs open: `/arena`, `/agents/summarize`, the ENS app on your agent's name, and HashScan
- [ ] A backup screen recording of a full run, in case the Wi-Fi fails
- [ ] Submission deadline: **Saturday 09:00 IST**, with no late submissions. Aim to submit by **07:00**.

---

## If something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` | An account hasn't opted in to USDC | Run `pnpm hedera:setup`. New agents opt in automatically; for old ones, run `pnpm demo:reset`. |
| `INSUFFICIENT_PAYER_BALANCE` or "insufficient funds" | Out of test money | Use the faucet again or ask a teammate to send some. `pnpm check-setup` shows every balance. |
| World ID says `invalid_proof`, or nothing happens after scanning | Staging and production are mixed up | Staging app goes with the Simulator; production app goes with the real World App. `WORLD_ENV` must match. |
| "Already registered" at sign-up | That identity has already signed up | That's normal: it signs you in. Use a different Simulator identity for a new person. |
| Payments hang, or there are "facilitator" errors | The payment helper is down | Switch `X402_FACILITATOR_URL` to the Blocky402 address (Step 9) and restart. |
| The score changed in the app but not in the ENS app | Ethereum's test network is slow | Wait 30–60 seconds. If it still hasn't changed, check the `pnpm dev` window for "ENS write failed" and make sure you have Sepolia ETH. |
| The ENS app shows an old web address for an agent | Your public link changed | Run `pnpm ens:sync`. |
| `nonce too low` | Two transactions were sent at the same moment | Restart `pnpm dev`; the app queues them for you. |
| "Port 3000 already in use" | The app is already running in another window | Close the other PowerShell window, or restart the computer. |
| A red **DEV MODE** banner appears | `DEV_FAKE_PERSONS=true` is on | Set it to `false` before the demo. Fake people are for building only. |

## Where every setting comes from

| Setting in `.env` | Comes from | Step |
|---|---|---|
| `SESSION_SECRET`, `PERSON_HASH_SECRET`, `KEYSTORE_SECRET`, `ADMIN_TOKEN` | `pnpm check-setup --gen-secrets` | 3 |
| `SEPOLIA_PRIVATE_KEY` | MetaMask → Account details | 4c |
| `SEPOLIA_RPC_URL` | Alchemy | 4e |
| `ENS_PARENT_NAME` | The name you registered | 5 |
| `HEDERA_OPERATOR_ID`, `HEDERA_OPERATOR_KEY` | Hedera portal | 6b |
| `HIRE_LEDGER_ADDRESS` | Filled in by `pnpm deploy:ledger` | 10 |
| `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY` | World Developer Portal | 7b |
| `WORLD_ACTION`, `WORLD_ENV`, `HUMAN_MODE` | You type them | 7c |
| `WORLD_CHAIN_RPC_URL` | World team / docs (AgentKit only) | 7e |
| `ANTHROPIC_API_KEY` | Anthropic console | 8 |
| `X402_FACILITATOR_URL` | Default, or the backup | 9 |
| `PUBLIC_BASE_URL` | Your tunnel or Railway address | 11 |
| Everything else | Leave the defaults from `.env.example` | — |
