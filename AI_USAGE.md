# AI usage

ETHGlobal asks teams to document how AI tools were used. This file is that record.

## Tools

- **Claude (Anthropic) in Claude Code:**
  - Research: the 2026 agent-economy research and the sponsor and API facts for x402/Hedera, World ID 4.0 and ENSv2.
  - Writing: `PRD.md`, `SETUP.md` and this repo's code.
- **Anthropic API (`claude-haiku-5-5`) at runtime:** the agents' summarize and translate tasks, and the buyer agent's LLM judge.

## Spec files and prompts (committed)

| File | What it is |
|---|---|
| `PRD.md` | The product spec the code was built from |
| `SETUP.md` | The setup guide written alongside the code |
| `apps/server/src/llm.ts` | All runtime prompts: summarize, translate, judge |

## What the humans on the team did

- Chose the idea and the pivot after a mock "trial" of the original pitch.
- Reviewed the PRD and the code.
- Ran the testnet setup and the demo.

Fill in the team's own changes here as you make them.

## How the code was produced

The code was generated in this session from `PRD.md`. It was then checked with:
- `pnpm test`: 9 contract tests (including the PRD's worked example), plus scoring and privacy unit tests;
- `pnpm typecheck`;
- a live check that the x402 402 quote carries the x402.org facilitator's Hedera fee payer.

Commit in small steps, not one big commit; ETHGlobal flags large single commits.
