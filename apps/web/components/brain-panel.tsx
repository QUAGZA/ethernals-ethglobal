"use client";

import { useCallback } from "react";
import { api, type AgentDetailPlus } from "@/lib/api";
import { useApp } from "@/lib/app-context";
import { neuronTo0g, shortHex, usdc2 } from "@/lib/format";
import { useDebounced, useLoad } from "@/lib/hooks";
import { useEvents } from "@/lib/use-events";
import { ErrorNotice } from "./error-notice";
import { Panel, Stat } from "./page-heading";
import { ReceiptTable } from "./task-bits";

const BACKENDS = { "0g-router": "0G Compute", anthropic: "Anthropic (development)", offline: "Offline (development)" };

export function BrainPanel({ agent }: { agent: AgentDetailPlus }) {
  const { me } = useApp();
  const isOwner = Boolean(me?.person && me.person.handle === agent.ownerHandle);
  const loader = useCallback(async () => {
    const [brain, receipts] = await Promise.all([api.agentBrain(agent.label), api.agentInference(agent.label)]);
    return { brain, receipts };
  }, [agent.label]);
  const data = useLoad(loader, `brain:${agent.label}`);
  const refresh = useDebounced(() => void data.reload(), 800);
  useEvents(
    (event) => {
      if (event.data.agentEnsName === agent.ensName) refresh();
    },
    ["inference.receipt", "hire.recorded", "task.settled"],
  );

  const brain = data.data?.brain;
  return (
    <Panel
      title="Brain"
      right={brain && (brain.status === "dormant" ? <span className="text-bad">dormant, needs a paid hire to wake</span> : <span className="text-good">awake</span>)}
    >
      <ErrorNotice error={data.error} title="Could not load the brain" onRetry={() => void data.reload()} />
      {brain && (
        <>
          <div className="grid grid-cols-4 gap-5 max-md:grid-cols-2">
            <Stat label="Backend" value={`${BACKENDS[brain.backend]}${brain.network ? ` · ${brain.network}` : ""}`} />
            {isOwner && <Stat label="Model" value={<span className="text-[12px] break-all">{brain.model}</span>} />}
            {isOwner && <Stat label="Key" value={brain.keyLabel ? "Its own key" : "Shared key"} />}
            <Stat label="Thoughts" value={brain.receipts} />
            {isOwner && <Stat label="Credit (0G)" value={neuronTo0g(brain.creditNeuron)} />}
            {isOwner && <Stat label="Spent (0G)" value={neuronTo0g(brain.spentNeuron)} />}
            {isOwner && <Stat label="From earnings (0G)" value={neuronTo0g(brain.creditedFromEarningsNeuron)} />}
            <Stat label="Earned" value={`${usdc2(brain.earnedUsdc)} USDC`} />
            {agent.taskType === "code-fix" && (
              <>
                <Stat label="Tasks passed" value={<span className="text-good">{agent.tasksPassed}</span>} />
                <Stat label="Tasks failed" value={<span className="text-bad">{agent.tasksFailed}</span>} />
                <Stat label="ERC-8004 id" value={agent.erc8004AgentId ?? "—"} />
              </>
            )}
            {isOwner && brain.lastRequestId && <Stat label="Last request id" value={<span className="text-[12px]">{shortHex(brain.lastRequestId, 10)}</span>} />}
          </div>
          {isOwner && (data.data?.receipts.length ?? 0) > 0 && (
            <div className="mt-5">
              <p className="eyebrow m-0 mb-2 opacity-60">Recent receipts</p>
              <ReceiptTable receipts={data.data!.receipts.slice(0, 8)} showPurpose />
            </div>
          )}
          <p className="m-0 mt-4 text-[11px] leading-[1.5] opacity-70">
            {isOwner
              ? "Credit is internal accounting of what this agent earned and spent. The Router balance is the platform's treasury."
              : "Model, keys and settings are visible only to the agent's creator."}
          </p>
        </>
      )}
    </Panel>
  );
}
