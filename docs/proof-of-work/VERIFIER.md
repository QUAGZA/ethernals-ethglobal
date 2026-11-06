# Verified work: escrow, sandbox verifier, validation receipts

Principle: **agents generate work; deterministic infrastructure validates it; smart contracts enforce the money.**

## Pieces

| Piece | Where | What it does |
|---|---|---|
| `TaskEscrow`, `MockUSDC` | `packages/contracts/contracts` | Locks a tUSDC bounty. Only the validator address can `settle`: PASS pays the specialist, FAIL refunds the client, a task settles once. The settlement stores `resultHash` (the commitment). |
| Sandbox verifier | `apps/verifier` | Applies the patch to the base commit, adds the hidden tests, runs them in Docker (`--network none`, CPU/memory/pid limits, all caps dropped), grades from JUnit, signs the result, settles the escrow, answers the ERC-8004 validation request. |
| Test calibration | `apps/verifier/src/calibrate.ts` | Before funding, runs custom tests against the unfixed code (at least one hidden test must fail a real check, not an import error), then any reference fix (must pass) and naive patch (must not). Rules out bad tests; can't prove tests are good. Keeps counts only, not patches. |
| Validation receipt | `packages/shared/src/receipt.ts` | Compact, deterministic projection of the signed result: hashes, test counts, status, score. Canonical JSON (RFC 8785 rules) then Keccak-256. Raw inputs, outputs and hidden tests never go in it. |
| Receipt store + check | `apps/server/src/proofs.ts` | Stores the receipt in SQLite. Each read re-hashes it, compares with the stored hash, then with `TaskEscrow.getTask(id).resultHash` on Sepolia. Returns `verified`, `unanchored` (not settled on-chain yet) or `invalid`. |
| Capabilities | `capabilitiesFromReceipts` | Per-category track record (verified, passed, failed, success rate) derived only from receipts, with bronze/silver/gold credentials. No single universal score. |
| UI | `/proofs` | Shows agent execution (untrusted) beside independent validation, the receipt, and the live integrity check. |

## Integrity chain

1. receipt JSON in the database, canonicalized and Keccak-256 hashed, must equal the stored `receipt_hash`;
2. `receipt.result_hash` (hash of the signed `VerificationResult`) must equal the value `settle()` anchored on-chain.

A match proves the committed receipt was not altered. It does not prove the validator is correct. The validator is one trusted key (visible on-chain as `validator`); passing hidden tests proves the patch meets those tests only.

## Run it locally (no chain, no GitHub)

```bash
pnpm verifier:setup                 # creates VERIFIER_PRIVATE_KEY and VERIFIER_TOKEN in .env
pnpm verifier:image                 # builds the Docker sandbox (or set VERIFIER_MODE=local for development)
pnpm --filter @ethernals/verifier selftest   # good patch = PASS, weak patch = FAIL
pnpm verifier:dev                   # then pnpm dev in another terminal and open /proofs
```

`VERIFIER_MODE=local` runs tests on your machine with no isolation (needs `pytest` on PATH). Never use it for the recorded demo.

The bundled task uses `repoUrl: demo://slugify`, which the verifier serves from `demo/tasks/slugify/repo`. Disable that with `VERIFIER_ALLOW_DEMO_REPO=0`.

## Go on-chain (Sepolia)

```bash
pnpm deploy:escrow                  # deploys MockUSDC + TaskEscrow, writes MOCK_USDC_ADDRESS / TASK_ESCROW_ADDRESS
```

With `TASK_ESCROW_ADDRESS` set, the verifier checks the on-chain patch/test commitments before grading, then calls `settle` and the ERC-8004 `validationResponse`.

## Patches that change how tests run

A patch fails with `patch_changes_test_setup`, without running tests, if it changes `conftest.py`, pytest config (`pytest.ini`, `.pytest.ini`, `pytest.toml`, `.pytest.toml`, `pyproject.toml`, `setup.cfg`, `tox.ini`) or a binary file, or adds a line naming pytest's internals (`_pytest`, `TestReport`, `hookimpl`, `hookwrapper`, `pytest_*`). Paths come from `git apply --numstat`, so quoting and renames don't hide them.

Patched code still runs in the same process as pytest, so disguised code can get past those checks. Every run therefore adds a control test, written after the patch with a random file and test name, that must fail (`apps/verifier/src/canary.ts`). If it reports anything but a failure, or vanishes from a clean run, the run fails as `results_tampered`. Its failure is removed from the counts, so signed results cover only the real tests, and the runner adds `--maxfail=0` so it can't end a run early. The live log shows "1 failed" on a passing run for this reason, and says so.

This catches a patch that forces every test to pass, however it is disguised. A patch that first works out which test is the canary, for example by reading test source at runtime, could still force only the others. Calibration runs the canary too, so tests or commands that stop it running are refused before funding.

## Not built yet

- Server-side task creation that funds the escrow, the x402 attempt-fee hire and the settlement watcher that feeds HireLedger (the contract flow is tested; the REST wiring for escrowed tasks is not).
- The Namera spend guard (`@ethernals/spend-guard`) and x402-paid verification (`/verify-paid`).
- Subcontract payments over x402: `/api/proofs/subcontract` validates both pieces of work but does not move money.
- Research, data-extraction and API-task validators: only code-fix has a deterministic validator.
