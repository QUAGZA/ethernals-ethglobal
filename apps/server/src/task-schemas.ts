/** Request validation for the tasks API: plain data, no side effects. */
import { z } from "zod";

export const MIN_BOUNTY = 0.01;
/** One tUSDC faucet mint. Higher bounties could never be funded. */
export const MAX_BOUNTY = 1000;

const bounty = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "Bounty must be a number like 2.00.")
  .refine((value) => Number(value) >= MIN_BOUNTY, `The smallest bounty is ${MIN_BOUNTY} tUSDC.`)
  .refine((value) => Number(value) <= MAX_BOUNTY, `The largest bounty is ${MAX_BOUNTY} tUSDC.`);

const relativePath = z
  .string()
  .min(1)
  .max(200)
  .refine((p) => !p.startsWith("/") && !p.includes("\\") && !p.split("/").some((part) => part === ".." || part === ".git"), "Test paths must stay inside the repo.");

const specSchema = z.object({
  title: z.string().min(3).max(120),
  repoUrl: z.string().regex(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+?(\.git)?\/?$/, "Only public https://github.com repositories are allowed."),
  baseCommit: z.string().regex(/^[0-9a-f]{40}$/, "Use the full 40-character commit SHA."),
  issue: z.string().min(10).max(4000),
  testCommand: z.string().regex(/^pytest[\w\s./=:-]*$/, "The test command must be a pytest command.").optional(),
});

export const createTaskSchema = z
  .object({
    template: z.literal("slugify").optional(),
    spec: specSchema.optional(),
    hiddenTests: z.object({ files: z.array(z.object({ path: relativePath, content: z.string().min(1).max(40_000) })).min(1).max(10) }).optional(),
    bounty,
    deadlineMinutes: z.number().int().min(5, "The deadline must be at least 5 minutes.").max(1440, "The deadline can be at most 24 hours."),
    specialist: z.string().min(1).optional(),
  })
  .refine((body) => body.template || (body.spec && body.hiddenTests), "Pick a template, or give a spec with hidden tests.");

export const hireForTaskSchema = z.object({ specialist: z.string().min(1) });

export const createDuelSchema = z.object({
  template: z.literal("slugify"),
  specialists: z.tuple([z.string().min(1), z.string().min(1)]),
  bounty,
});

export const connectNameraSchema = z.object({
  apiKey: z.string().min(1, "Paste your Namera API key."),
  walletId: z.string().min(1, "Paste your wallet id."),
  sessionKeyId: z.string().min(1, "Paste your session key id."),
});
