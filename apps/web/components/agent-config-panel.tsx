"use client";

import { useCallback, useState, type FormEvent } from "react";
import type { AddAgentToolRequest, TaskType, ZgModelType } from "@ethernals/shared";
import { modelTypeFor } from "@ethernals/shared";
import { ApiRequestError, api, toApiError } from "@/lib/api";
import { useLoad } from "@/lib/hooks";
import { ErrorNotice } from "./error-notice";
import { Panel } from "./page-heading";
import { useToast } from "./toast-provider";

const MODEL_TYPES: { id: ZgModelType; label: string; endpoint: string }[] = [
  { id: "text", label: "Text", endpoint: "/v1/chat/completions" },
  { id: "image", label: "Image", endpoint: "/v1/images/generations" },
  { id: "decision", label: "Decision", endpoint: "/v1/decisions" },
  { id: "embedding", label: "Embedding", endpoint: "/v1/embeddings" },
  { id: "video", label: "Video", endpoint: "/v1/videos" },
];

const field = "mt-1 block w-full border-b border-ink bg-transparent py-2 text-[13px] normal-case tracking-normal outline-none focus:bg-white/60";
const button = "cursor-pointer border border-ink bg-yellow px-4 py-2 text-[12px] tracking-[.08em] text-ink hover:bg-ink hover:text-yellow disabled:cursor-not-allowed disabled:opacity-40";

/** Owner-only: the agent's 0G model, system prompt, own key, and the MCP servers and HTTP tools it can call. */
export function AgentConfigPanel({ label, taskType }: { label: string; taskType: TaskType | null }) {
  const toast = useToast();
  const loader = useCallback(() => api.agentConfig(label), [label]);
  const cfg = useLoad(loader, `config:${label}`);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [busy, setBusy] = useState(false);

  const [modelType, setModelType] = useState<ZgModelType | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<string | null>(null);
  const [key, setKey] = useState("");

  const [tool, setTool] = useState<AddAgentToolRequest>({ kind: "mcp", name: "", url: "" });

  const data = cfg.data;
  async function run(fn: () => Promise<unknown>, done: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      toast(done);
      await cfg.reload();
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setBusy(false);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api.updateAgentConfig(label, {
        modelType: modelType ?? undefined,
        model: model ?? undefined,
        systemPrompt: prompt ?? undefined,
        zgApiKey: key.trim() || undefined,
      });
      setKey("");
    }, "Agent settings saved.");
  }

  function addTool(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api.addAgentTool(label, { ...tool, authHeader: tool.authHeader || undefined, schemaJson: tool.schemaJson || undefined });
      setTool({ kind: tool.kind, name: "", url: "" });
    }, "Tool added.");
  }

  if (cfg.error) return <ErrorNotice error={cfg.error} title="Could not load the agent settings" onRetry={() => void cfg.reload()} />;
  if (!data) return null;
  const type = modelType ?? data.modelType;
  const endpoint = MODEL_TYPES.find((t) => t.id === type)?.endpoint;

  return (
    <Panel title="Agent settings" right={<span className="opacity-70">only you can see this</span>}>
      <form className="flex flex-col gap-4" onSubmit={save}>
        <div className="grid grid-cols-[1fr_2fr] gap-5 max-md:grid-cols-1">
          <label className="eyebrow block">
            Model type
            <select className={`${field} cursor-pointer`} value={type} onChange={(e) => setModelType(e.target.value as ZgModelType)}>
              {MODEL_TYPES.filter((t) => !taskType || t.id === modelTypeFor(taskType)).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
            <span className="mt-1 block normal-case tracking-normal opacity-60">{endpoint}</span>
          </label>
          <label className="eyebrow block">
            Model name
            <input className={field} value={model ?? data.model} spellCheck={false} onChange={(e) => setModel(e.target.value)} />
          </label>
        </div>
        <label className="eyebrow block">
          System prompt
          <textarea
            className={`${field} h-28 resize-y`}
            placeholder="You are a careful agent that…"
            maxLength={4000}
            value={prompt ?? data.systemPrompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </label>
        <label className="eyebrow block">
          0G API key {data.keyLabel ? `(current: ${data.keyLabel})` : "(using the shared key)"}
          <input className={field} type="password" autoComplete="off" placeholder="sk-… leave blank to keep the current key" value={key} onChange={(e) => setKey(e.target.value)} />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button className={button} type="submit" disabled={busy}>
            SAVE SETTINGS
          </button>
          <button className={button} type="button" disabled={busy} onClick={() => void run(() => api.hostHere(label), "ENS endpoint now points at this server.")}>
            HOST THIS AGENT HERE
          </button>
          <span className="text-[11px] opacity-60">Saved settings are also published to ENS, so any server with the platform secret can run this agent.</span>
        </div>
      </form>

      <div className="mt-6 border-t pt-5">
        <p className="eyebrow m-0 mb-3">Tools · MCP servers and HTTP tools</p>
        {data.tools.length === 0 ? (
          <p className="m-0 text-[12px] opacity-60">No tools yet. The agent answers from its model alone.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {data.tools.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 border px-3 py-2 text-[12px]">
                <span className="min-w-0 break-all">
                  <b>{t.name}</b> <span className="opacity-60">· {t.kind.toUpperCase()}{t.hasAuth ? " · auth" : ""} · {t.url}</span>
                  {t.description && <span className="block opacity-70">{t.description}</span>}
                </span>
                <button className="cursor-pointer border-b text-bad" disabled={busy} onClick={() => void run(() => api.deleteAgentTool(label, t.id), "Tool removed.")}>
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}

        <form className="mt-4 grid grid-cols-2 gap-4 max-md:grid-cols-1" onSubmit={addTool}>
          <label className="eyebrow block">
            Kind
            <select className={`${field} cursor-pointer`} value={tool.kind} onChange={(e) => setTool({ ...tool, kind: e.target.value as "mcp" | "http" })}>
              <option value="mcp">MCP server (Streamable HTTP)</option>
              <option value="http">HTTP tool (POST JSON)</option>
            </select>
          </label>
          <label className="eyebrow block">
            Name
            <input className={field} required value={tool.name} onChange={(e) => setTool({ ...tool, name: e.target.value })} placeholder={tool.kind === "mcp" ? "github" : "get_price"} />
          </label>
          <label className="eyebrow col-span-2 block max-md:col-span-1">
            URL (public)
            <input className={field} required type="url" value={tool.url} onChange={(e) => setTool({ ...tool, url: e.target.value })} placeholder="https://mcp.example.com/mcp" />
          </label>
          <label className="eyebrow block">
            Authorization header (optional)
            <input className={field} type="password" autoComplete="off" value={tool.authHeader ?? ""} onChange={(e) => setTool({ ...tool, authHeader: e.target.value })} placeholder="Bearer …" />
          </label>
          <label className="eyebrow block">
            Description
            <input className={field} value={tool.description ?? ""} onChange={(e) => setTool({ ...tool, description: e.target.value })} placeholder="What it does, for the model" />
          </label>
          {tool.kind === "http" && (
            <label className="eyebrow col-span-2 block max-md:col-span-1">
              Argument schema (JSON Schema)
              <textarea
                className={`${field} h-20 resize-y font-mono`}
                value={tool.schemaJson ?? ""}
                onChange={(e) => setTool({ ...tool, schemaJson: e.target.value })}
                placeholder='{"type":"object","properties":{"symbol":{"type":"string"}},"required":["symbol"]}'
              />
            </label>
          )}
          <div className="col-span-2 max-md:col-span-1">
            <button className={button} type="submit" disabled={busy}>
              {busy ? "WORKING…" : "ADD TOOL"}
            </button>
          </div>
        </form>
        <ErrorNotice error={error} title="That did not work" className="mt-3" />
        <p className="m-0 mt-3 text-[11px] leading-[1.5] opacity-70">
          Tool calls run on the server during a task. Auth headers are stored encrypted. Only public URLs are allowed.
        </p>
      </div>
    </Panel>
  );
}
