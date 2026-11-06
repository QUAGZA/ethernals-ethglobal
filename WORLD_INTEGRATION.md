# World integration write-up

World's Agent Pass and IDKit tracks ask for an integration debrief. This is ours.

## The trust moment

The action we protect is **"this hire counts toward an agent's public reputation and price."** Payments themselves stay autonomous: agents pay over x402 with no human approval. What a human backs is whether the payment *counts*.

## Integration

| Step | Where | What happens |
|---|---|---|
| 1. Signed request | `GET /api/auth/world/rp-context` → `apps/server/src/identity.ts` `createRpContext()` | The backend signs every request with `signRequest()` from `@worldcoin/idkit-core/signing` (World ID 4.0 RP signing). The key never reaches the browser. |
| 2. Proof | `apps/web` `/signup`, `IDKitRequestWidget` with `preset={proofOfHuman({ signal: handle })}` | The person proves they are a unique human (Simulator in staging). |
| 3. Backend verification | `POST /api/auth/world/verify` → `verifyWorldProof()` | The IDKit result is forwarded unchanged to `POST https://developer.world.org/api/v4/verify/{rp_id}`. We require `success === true` and a matching environment. |
| 4. One person, one account | `persons.world_nullifier UNIQUE` | The action-scoped nullifier is stable per person, so a second sign-up signs in instead of creating a duplicate. |
| 5. Counting rule | `apps/server/src/verifier.ts` + `HireLedger.sol` | Per-agent person hashes `HMAC(secret, personId ‖ agentKey)` let the contract see "same person as the provider" without learning who anyone is. |
| 6. Optional AgentBook (Agent Pass) | `HUMAN_MODE=agentkit`, `agentBookHuman()` | Each buyer agent's wallet must be registered in World's AgentBook (World Chain, `lookupHuman`). Unregistered wallets → `UNVERIFIED_BUYER`. |

## Denied paths (the action does not happen)

- **`SAME_PERSON`:** the provider's own agents hire it. The payment settles, but the vote is refused. Shown live in the Arena.
- **`UNVERIFIED_BUYER`:** the buyer's credential is expired (the demo control on `/me`) or, in agentkit mode, not in AgentBook.
- **Duplicate person:** a second sign-up with the same World ID is not created.

## Minimum credential

We use proof of uniqueness only, and request no personal attributes. The rule needs nothing more.

## What was hard and what we learned

- **World ID 4.0 requires RP signing** and environment matching: staging actions work only with the Simulator.
- **The AgentKit SDK repo is archived**, so we read AgentBook directly with viem. AgentBook registration needs an Orb, and Orbs aren't available in India, so `idkit` mode is the default.
- **Nullifiers can come back as hex or decimal**, so we normalize them with `BigInt`.
- **Proofs are one per action.** Returning users rely on the session cookie; IDKit sessions are the next step.

Team: add your own notes here after testing at the event.
