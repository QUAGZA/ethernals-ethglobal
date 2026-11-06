/**
 * Agent sandbox runs: a lead agent works toward a goal inside hard limits, thinking on 0G and recruiting other agents
 * over x402. The goal and results stay in the run's workspace and memory; everything here except `goal` and `result`
 * is metadata, and those two are only ever sent to the person who started the run.
 */
import type { InferenceReceipt } from "./tasks";

export type SandboxRunStatus = "running" | "finished" | "incomplete" | "stopped" | "failed";

/** Why the sandbox refused something the agent tried. The limit is enforced in code, whatever the model says. */
export type SandboxRefusal =
  | "not_on_roster"
  | "self_recruit"
  | "over_budget"
  | "no_consent"
  | "recruit_limit"
  | "repeat_recruit"
  | "bad_plan"
  | "hire_failed";

export interface SandboxStepView {
  n: number;
  kind: "thought" | "recruit" | "refused" | "finish";
  agentEnsName: string | null;
  amountUsdc: string | null;
  refusal: SandboxRefusal | null;
  requestId: string | null;
  hireId: string | null;
  paymentUrl: string | null;
  at: string;
}

export interface SandboxLimits {
  maxSteps: number;
  maxRecruits: number;
  timeLimitSeconds: number;
}

export interface SandboxRunView {
  id: string;
  leadEnsName: string;
  ownerHandle: string;
  status: SandboxRunStatus;
  /** Where the lead agent thinks: "0g-router", or "offline" for a scripted development plan. */
  brain: "0g-router" | "offline";
  budgetUsdc: string;
  spentUsdc: string;
  shareWithRecruits: boolean;
  limits: SandboxLimits;
  steps: SandboxStepView[];
  inference: InferenceReceipt[];
  /** Only for the person who started the run, and only until the server forgets it. */
  goal: string | null;
  result: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** POST /api/sandbox/runs */
export interface StartSandboxRunRequest {
  /** Label or ENS name of a seller agent you own. */
  agent: string;
  goal: string;
  budgetUsdc: string;
  /** Lets the lead agent share the goal with the agents it recruits. Without it, every recruit is refused. */
  shareWithRecruits: boolean;
}
