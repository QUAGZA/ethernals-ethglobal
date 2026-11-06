import type { NextFunction, Request, Response } from "express";
import { isDormant } from "./brain";
import { getAgentByLabel } from "./db";

/**
 * Runs before the x402 middleware, so nobody is quoted or charged here:
 * unknown agents get a plain 404, and an agent too low on credit to think gets a 503.
 */
export function agentGate(req: Request, res: Response, next: NextFunction): void {
  const agent = getAgentByLabel(String(req.params.label));
  if (!agent || agent.kind !== "seller") {
    res.status(404).json({ error: `No agent named ${req.params.label}.` });
    return;
  }
  if (isDormant(agent)) {
    res.status(503).json({ error: "agent_dormant", hint: `${agent.ens_name} is out of brain credit and needs a paid hire to wake.` });
    return;
  }
  next();
}
