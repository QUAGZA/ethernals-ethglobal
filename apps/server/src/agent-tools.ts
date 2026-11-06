/**
 * Tools a provider attaches to their agent: remote MCP servers (Streamable HTTP JSON-RPC) and plain HTTP tools.
 * Both are exposed to the model as OpenAI-style function tools; think() runs the tool-call loop.
 * Auth headers are stored encrypted and only decrypted when a tool is called. Private/loopback hosts are refused.
 */
import { isIP } from "node:net";
import { decryptSecret } from "./crypto";
import { listAgentTools, type AgentToolRow } from "./db";
import { createSafeFetch } from "./sandbox";

const TIMEOUT_MS = 20_000;
const MAX_RESULT_CHARS = 8000;
const LIST_TTL_MS = 5 * 60 * 1000;

export interface FunctionTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ToolBundle {
  defs: FunctionTool[];
  call: (name: string, args: Record<string, unknown>) => Promise<string>;
}

/** Throws unless the URL is a public http(s) address. */
export function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That is not a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) URLs are allowed.");
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const privateV4 = /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
  const isPrivate =
    host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") ||
    (isIP(host) === 4 && privateV4.test(host)) ||
    (isIP(host) === 6 && (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")));
  if (isPrivate) throw new Error("Private and local addresses are not allowed. Use a public URL.");
  return url;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "tool";

function headersFor(row: Pick<AgentToolRow, "auth_enc">): Record<string, string> {
  const h: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (row.auth_enc) h.authorization = decryptSecret(row.auth_enc);
  return h;
}

function fetchFor(url: URL): typeof fetch {
  return createSafeFetch([url.host]);
}

// ---------------------------------------------------------------- MCP client (Streamable HTTP)

interface Rpc {
  result?: any;
  error?: { message?: string };
}

async function readRpc(res: Response, id: number | undefined): Promise<Rpc> {
  const type = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (type.includes("text/event-stream")) {
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        const msg = JSON.parse(line.slice(5).trim());
        if (id === undefined || msg.id === id) return msg;
      } catch {
        /* keep scanning */
      }
    }
    throw new Error("The MCP server's event stream held no answer.");
  }
  return text ? (JSON.parse(text) as Rpc) : {};
}

async function mcpSession<T>(row: Pick<AgentToolRow, "url" | "auth_enc">, fn: (rpc: (method: string, params?: unknown) => Promise<any>) => Promise<T>): Promise<T> {
  const url = assertPublicUrl(row.url);
  const doFetch = fetchFor(url);
  const base = headersFor(row);
  let session: string | undefined;
  let next = 1;
  const send = async (method: string, params: unknown, notify = false) => {
    const id = notify ? undefined : next++;
    const res = await doFetch(url, {
      method: "POST",
      headers: { ...base, ...(session ? { "mcp-session-id": session } : {}) },
      body: JSON.stringify({ jsonrpc: "2.0", ...(id !== undefined ? { id } : {}), method, params }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    session = res.headers.get("mcp-session-id") ?? session;
    if (notify) {
      await res.body?.cancel();
      return undefined;
    }
    if (!res.ok) throw new Error(`MCP server answered HTTP ${res.status}`);
    const msg = await readRpc(res, id);
    if (msg.error) throw new Error(msg.error.message ?? "MCP error");
    return msg.result;
  };
  await send("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "ethernals", version: "1.0.0" } });
  await send("notifications/initialized", {}, true);
  return fn((m, p) => send(m, p));
}

interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export async function listMcpTools(row: Pick<AgentToolRow, "url" | "auth_enc">): Promise<McpTool[]> {
  return mcpSession(row, async (rpc) => ((await rpc("tools/list", {})).tools ?? []) as McpTool[]);
}

const listCache = new Map<string, { at: number; tools: McpTool[] }>();

// ---------------------------------------------------------------- bundle for think()

/** Every tool of one agent as function definitions plus a dispatcher. Broken servers are skipped, not fatal. */
export async function loadToolBundle(agentKey: string): Promise<ToolBundle | null> {
  const rows = listAgentTools(agentKey);
  if (rows.length === 0) return null;
  const defs: FunctionTool[] = [];
  const routes = new Map<string, { row: AgentToolRow; remote: string }>();
  const add = (fnName: string, description: string, parameters: Record<string, unknown>, row: AgentToolRow, remote: string) => {
    const name = fnName.slice(0, 64);
    if (routes.has(name)) return;
    routes.set(name, { row, remote });
    defs.push({ type: "function", function: { name, description: description.slice(0, 1000), parameters } });
  };

  await Promise.all(
    rows.map(async (row) => {
      if (row.kind === "http") {
        let params: Record<string, unknown> = { type: "object", properties: {} };
        try {
          if (row.schema_json) params = JSON.parse(row.schema_json);
        } catch {
          /* keep the empty schema */
        }
        add(slug(row.name), row.description || row.name, params, row, row.name);
        return;
      }
      try {
        let cached = listCache.get(row.id);
        if (!cached || Date.now() - cached.at > LIST_TTL_MS) {
          cached = { at: Date.now(), tools: await listMcpTools(row) };
          listCache.set(row.id, cached);
        }
        for (const t of cached.tools) {
          add(`${slug(row.name)}__${slug(t.name)}`, t.description ?? t.name, t.inputSchema ?? { type: "object", properties: {} }, row, t.name);
        }
      } catch {
        /* an unreachable MCP server just offers no tools this time */
      }
    }),
  );
  if (defs.length === 0) return null;

  return {
    defs,
    call: async (name, args) => {
      const route = routes.get(name);
      if (!route) return `Unknown tool ${name}.`;
      try {
        const out = route.row.kind === "http" ? await callHttp(route.row, args) : await callMcp(route.row, route.remote, args);
        return out.length > MAX_RESULT_CHARS ? `${out.slice(0, MAX_RESULT_CHARS)}\n…(truncated)` : out;
      } catch (err) {
        return `Tool error: ${(err as Error).message}`;
      }
    },
  };
}

async function callMcp(row: AgentToolRow, remote: string, args: Record<string, unknown>): Promise<string> {
  const result = await mcpSession(row, (rpc) => rpc("tools/call", { name: remote, arguments: args }));
  const parts = ((result?.content ?? []) as { type: string; text?: string }[]).map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type}]`));
  const text = parts.join("\n").trim() || JSON.stringify(result ?? {});
  return result?.isError ? `Tool error: ${text}` : text;
}

async function callHttp(row: AgentToolRow, args: Record<string, unknown>): Promise<string> {
  const url = assertPublicUrl(row.url);
  const res = await fetchFor(url)(url, {
    method: "POST",
    headers: headersFor(row),
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  return res.ok ? text : `HTTP ${res.status}: ${text.slice(0, 500)}`;
}
