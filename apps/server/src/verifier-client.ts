/** Client for the sandbox verifier's HTTP API (types in @ethernals/shared/tasks). */
import type {
  HiddenTestsBundle,
  UploadTestsResponse,
  VerifierEvent,
  VerifierHealth,
  VerifyAccepted,
  VerifyJob,
  VerifyRequest,
} from "@ethernals/shared";
import { config } from "./config";
import { AppError } from "./errors";
import { emit, log } from "./events";

const base = () => config.verifierService.url();
const authHeaders = () => ({ "content-type": "application/json", "x-verifier-token": config.verifierService.token() });

async function call<T>(path: string, init: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base()}${path}`, init);
  } catch (err) {
    throw new AppError(503, "The sandbox verifier is not reachable.", `Start it with pnpm verifier:dev. (${(err as Error).message})`);
  }
  if (!res.ok) {
    throw new AppError(502, `The verifier answered HTTP ${res.status}.`, (await res.text()).slice(0, 300));
  }
  return (await res.json()) as T;
}

export const verifierHealth = () => call<VerifierHealth>("/health", {});

/** The hidden tests go to the verifier and nowhere else. Only the id and hash come back. */
export const uploadHiddenTests = (bundle: HiddenTestsBundle) =>
  call<UploadTestsResponse>("/tests", { method: "POST", headers: authHeaders(), body: JSON.stringify(bundle) });

export const startVerify = (request: VerifyRequest) =>
  call<VerifyAccepted>("/verify", { method: "POST", headers: authHeaders(), body: JSON.stringify(request) });

export const getVerifyJob = (jobId: string) => call<VerifyJob>(`/jobs/${encodeURIComponent(jobId)}`, { headers: authHeaders() });

/** Turns one verifier event into server events, so the web app only needs /api/events. */
export function relayVerifierEvent(taskId: string, event: VerifierEvent): void {
  switch (event.type) {
    case "status":
      emit("verify.status", { taskId, status: event.status, message: `Verifier: ${event.status}` });
      break;
    case "log":
      emit("verify.log", { taskId, line: event.line });
      break;
    case "result":
      emit("verify.result", { taskId, passed: event.result.passed, resultUrl: event.resultUrl, message: event.result.passed ? "Hidden tests passed" : "Hidden tests failed" });
      break;
    case "settled":
      emit("verify.status", { taskId, status: "settled", settleTxHash: event.settleTxHash, message: "Verifier settled the escrow" });
      break;
    case "erc8004":
      emit("verify.status", { taskId, status: "erc8004", txHash: event.txHash, message: "ERC-8004 validation answered" });
      break;
    case "error":
      emit("verify.status", { taskId, status: "error", message: `Verifier error: ${event.message}` });
      break;
  }
}

/** Reads `data:` lines out of a Server-Sent Events chunk; returns the events and the unfinished tail. */
export function parseSseChunk(buffer: string): { events: VerifierEvent[]; rest: string } {
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: VerifierEvent[] = [];
  for (const block of blocks) {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) continue;
    try {
      events.push(JSON.parse(data) as VerifierEvent);
    } catch {
      /* skip a malformed event */
    }
  }
  return { events, rest };
}

/** Streams a job's events into the event bus until the verifier closes the stream. The watcher settles regardless. */
export async function relayJobEvents(jobId: string, taskId: string): Promise<void> {
  try {
    const res = await fetch(`${base()}/jobs/${encodeURIComponent(jobId)}/events`, { headers: authHeaders() });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, "\n");
      const { events, rest } = parseSseChunk(buffer);
      buffer = rest;
      events.forEach((event) => relayVerifierEvent(taskId, event));
    }
  } catch (err) {
    log.warn("verifier event stream ended early", { jobId, error: (err as Error).message });
  }
}
