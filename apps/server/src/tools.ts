/**
 * Tools a hoster can give a custom agent. Every tool runs on OUR server inside limits we control; the model only
 * chooses which tool to call and with what arguments. Tool output is returned to the model as quoted data.
 */
import dns from "node:dns/promises";
import https from "node:https";
import net from "node:net";
import type { AgentToolId } from "@ethernals/shared";

export interface ToolSpec {
  id: AgentToolId;
  description: string;
  args: string;
}

export const TOOL_SPECS: Record<AgentToolId, ToolSpec> = {
  calculator: {
    id: "calculator",
    description: "Evaluate an arithmetic expression exactly. Supports + - * / % ^ and parentheses.",
    args: '{"expression": "(12.5 + 3) * 4"}',
  },
  fetch_url: {
    id: "fetch_url",
    description: "Download a public web page or JSON document over https and return its text (first 6,000 characters).",
    args: '{"url": "https://example.com/data.json"}',
  },
  current_time: {
    id: "current_time",
    description: "Get the current date and time (UTC, ISO 8601).",
    args: "{}",
  },
  hire_agent: {
    id: "hire_agent",
    description:
      "Pay another agent on this marketplace to do a sub-task and return its answer. Only works if the customer allowed sub-hires and the sub-budget covers the price.",
    args: '{"agent": "label-of-agent", "task": "what you want it to do"}',
  },
};

export interface ToolContext {
  /** Provided only when the customer allowed sub-hires for this task. */
  hire?: (agentLabel: string, task: string) => Promise<string>;
}

export class ToolError extends Error {}

export async function runTool(id: string, args: Record<string, unknown>, ctx: ToolContext): Promise<string> {
  switch (id) {
    case "calculator":
      return String(evaluate(String(args.expression ?? "")));
    case "current_time":
      return new Date().toISOString();
    case "fetch_url":
      return fetchUrl(String(args.url ?? ""));
    case "hire_agent": {
      if (!ctx.hire) throw new ToolError("Sub-hiring is not allowed for this task.");
      return ctx.hire(String(args.agent ?? ""), String(args.task ?? ""));
    }
    default:
      throw new ToolError(`Unknown tool "${id}".`);
  }
}

// ------------------------------------------------------------------ calculator (no eval)

export function evaluate(input: string): number {
  const src = input.replace(/\s+/g, "");
  if (!src || src.length > 200) throw new ToolError("Expression is empty or too long.");
  let i = 0;
  const peek = () => src[i];
  const number = (): number => {
    const m = /^\d+(\.\d+)?/.exec(src.slice(i));
    if (!m) throw new ToolError(`Unexpected "${peek() ?? "end"}" at position ${i}.`);
    i += m[0].length;
    return Number(m[0]);
  };
  const primary = (): number => {
    if (peek() === "(") {
      i++;
      const v = additive();
      if (peek() !== ")") throw new ToolError("Missing closing parenthesis.");
      i++;
      return v;
    }
    return number();
  };
  // Unary minus binds looser than ^ (so -2^2 = -4) but tighter than * and /.
  const unary = (): number => {
    if (peek() === "-") {
      i++;
      return -unary();
    }
    if (peek() === "+") {
      i++;
      return unary();
    }
    return power();
  };
  const power = (): number => {
    const base = primary();
    if (peek() === "^") {
      i++;
      return Math.pow(base, unary());
    }
    return base;
  };
  const multiplicative = (): number => {
    let v = unary();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = src[i++];
      const r = unary();
      if ((op === "/" || op === "%") && r === 0) throw new ToolError("Division by zero.");
      v = op === "*" ? v * r : op === "/" ? v / r : v % r;
    }
    return v;
  };
  const additive = (): number => {
    let v = multiplicative();
    while (peek() === "+" || peek() === "-") {
      const op = src[i++];
      const r = multiplicative();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const result = additive();
  if (i !== src.length) throw new ToolError(`Unexpected "${src[i]}" at position ${i}.`);
  if (!Number.isFinite(result)) throw new ToolError("Result is not a finite number.");
  return result;
}

// ------------------------------------------------------------------ fetch_url (SSRF-safe)

/** True for loopback, private, link-local, CGNAT, multicast and other non-public addresses (IPv4 and IPv6). */
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19))
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isPrivateAddress(mapped[1]);
    return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb") || v.startsWith("ff");
  }
  return true;
}

const MAX_BYTES = 200_000;
const MAX_CHARS = 6000;

export async function fetchUrl(rawUrl: string): Promise<string> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new ToolError("That is not a valid URL.");
  }
  if (url.protocol !== "https:") throw new ToolError("Only https:// URLs are allowed.");
  if (url.username || url.password) throw new ToolError("URLs with credentials are not allowed.");
  if (url.port && url.port !== "443") throw new ToolError("Only the standard https port is allowed.");

  // The connection uses the address we validate here (custom lookup), so DNS cannot change between check and connect.
  const lookup: net.LookupFunction = (hostname, _opts, cb) => {
    dns
      .lookup(hostname, { all: true })
      .then((all) => {
        const ok = all.find((a) => !isPrivateAddress(a.address));
        if (!ok || all.some((a) => isPrivateAddress(a.address))) return cb(new ToolError("That host resolves to a non-public address."), "", 4);
        cb(null, ok.address, ok.family);
      })
      .catch((e) => cb(e as Error, "", 4));
  };
  const bareHost = url.hostname.replace(/^\[|\]$/g, ""); // URL keeps the brackets on IPv6 literals
  if (net.isIP(bareHost) && isPrivateAddress(bareHost)) {
    throw new ToolError("That host is a non-public address.");
  }

  return new Promise<string>((resolve, reject) => {
    const req = https.get(url, { lookup, timeout: 10_000, headers: { "user-agent": "ethernals-agent/1", accept: "text/*,application/json" } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400) {
        res.resume();
        return reject(new ToolError("The URL redirects; redirects are not followed. Use the final URL."));
      }
      if (!res.statusCode || res.statusCode >= 400) {
        res.resume();
        return reject(new ToolError(`The server answered HTTP ${res.statusCode}.`));
      }
      const type = String(res.headers["content-type"] ?? "");
      if (!/^(text\/|application\/(json|xml|xhtml))/i.test(type)) {
        res.resume();
        return reject(new ToolError(`Unsupported content type "${type || "unknown"}".`));
      }
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) {
          res.destroy();
          return;
        }
        chunks.push(c);
      });
      res.on("close", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const plain = /html/i.test(type) ? text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : text;
        resolve(plain.slice(0, MAX_CHARS));
      });
      res.on("error", (e) => reject(new ToolError(e.message)));
    });
    req.on("timeout", () => req.destroy(new ToolError("The request timed out.")));
    req.on("error", (e) => reject(e instanceof ToolError ? e : new ToolError(`Could not fetch: ${e.message}`)));
  });
}
