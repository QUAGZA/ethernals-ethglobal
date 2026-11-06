/**
 * In-process event bus feeding the Server-Sent Events stream (/api/events) and the Arena.
 * Never put task content (inputs/outputs) in events (PRD SEC-5).
 */
import { EventEmitter } from "node:events";
import type { EventMessage, EventType } from "@ethernals/shared";

const bus = new EventEmitter();
bus.setMaxListeners(200);
const recent: EventMessage[] = [];
let nextId = 1;

export function emit(type: EventType, data: EventMessage["data"]): EventMessage {
  const message: EventMessage = { id: nextId++, type, at: new Date().toISOString(), data };
  recent.push(message);
  if (recent.length > 300) recent.shift();
  bus.emit("event", message);
  return message;
}

export function recentEvents(sinceId = 0): EventMessage[] {
  return recent.filter((m) => m.id > sinceId);
}

export function subscribe(listener: (message: EventMessage) => void): () => void {
  bus.on("event", listener);
  return () => bus.off("event", listener);
}

/** Small structured logger that never prints task content. */
export const log = {
  info: (msg: string, extra?: Record<string, unknown>) => console.log(`[ethernals] ${msg}`, extra ? JSON.stringify(extra) : ""),
  warn: (msg: string, extra?: Record<string, unknown>) => console.warn(`[ethernals] ⚠ ${msg}`, extra ? JSON.stringify(extra) : ""),
  error: (msg: string, err?: unknown) =>
    console.error(`[ethernals] ✖ ${msg}`, err instanceof Error ? err.message : err ? JSON.stringify(err) : ""),
};
