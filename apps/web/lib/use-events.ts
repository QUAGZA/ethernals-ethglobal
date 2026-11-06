"use client";

/**
 * One shared Server-Sent Events connection to /api/events for the whole tab.
 * Components subscribe with useEvents(); on a dropped connection we reconnect
 * with ?since=<last id> so no event is missed.
 */
import { useEffect, useRef, useSyncExternalStore } from "react";
import type { EventMessage, EventType } from "@ethernals/shared";

export type EventStatus = "idle" | "connecting" | "live" | "reconnecting";

type Listener = (message: EventMessage) => void;

const EVENT_TYPES: EventType[] = [
  "agent.created",
  "hire.delivered",
  "hire.rated",
  "hire.recorded",
  "hire.payment_not_verified",
  "subhire.blocked",
  "egress.blocked",
  "ens.updated",
  "arena.open.feedback",
  "arena.open.done",
  "arena.ethernals.progress",
  "arena.ethernals.done",
  "task.created",
  "task.accepted",
  "task.submitted",
  "verify.status",
  "verify.log",
  "verify.result",
  "task.settled",
  "task.refunded",
  "agent.born",
  "inference.receipt",
  "spend.allowed",
  "spend.blocked",
  "info",
];

const listeners = new Set<Listener>();
const statusListeners = new Set<() => void>();
let source: EventSource | null = null;
let status: EventStatus = "idle";
let lastId: number | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 1000;
let seen = new Set<number>();

function setStatus(next: EventStatus) {
  if (status === next) return;
  status = next;
  statusListeners.forEach((l) => l());
}

function deliver(raw: string) {
  let message: EventMessage;
  try {
    message = JSON.parse(raw) as EventMessage;
  } catch {
    return;
  }
  if (!message || typeof message.type !== "string") return;
  if (typeof message.id === "number") {
    // The same message can reach both onmessage and a named listener; deliver it once.
    if (seen.has(message.id)) return;
    seen.add(message.id);
    if (seen.size > 2000) seen = new Set([...seen].slice(-500));
    lastId = message.id;
  }
  if (!message.data || typeof message.data !== "object") message.data = {};
  listeners.forEach((l) => {
    try {
      l(message);
    } catch (err) {
      console.error("event listener failed", err);
    }
  });
}

function connect() {
  if (typeof window === "undefined" || source) return;
  const url = lastId === null ? "/api/events" : `/api/events?since=${lastId}`;
  setStatus(lastId === null ? "connecting" : "reconnecting");
  const es = new EventSource(url, { withCredentials: true });
  source = es;
  seen = new Set();
  es.onopen = () => {
    retryDelay = 1000;
    setStatus("live");
  };
  es.onmessage = (e) => deliver(e.data);
  // Also accept named events, in case the server sets `event: <type>`.
  for (const type of EVENT_TYPES) es.addEventListener(type, (e) => deliver((e as MessageEvent<string>).data));
  es.onerror = () => {
    // Reconnect ourselves so the URL carries ?since=<last id>.
    es.close();
    if (source === es) source = null;
    setStatus("reconnecting");
    if (listeners.size === 0) return;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (listeners.size > 0) connect();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 10_000);
  };
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  connect();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && !closeTimer) {
      // Keep the connection briefly so page navigations don't drop and reopen it.
      closeTimer = setTimeout(() => {
        closeTimer = null;
        if (listeners.size > 0) return;
        source?.close();
        source = null;
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
        setStatus("idle");
      }, 5000);
    }
  };
}

/** Calls `handler` for every event (optionally only the given types). The latest handler is always used. */
export function useEvents(handler: (message: EventMessage) => void, types?: EventType[]): void {
  const handlerRef = useRef(handler);
  const typesRef = useRef(types);
  handlerRef.current = handler;
  typesRef.current = types;
  useEffect(
    () =>
      subscribe((message) => {
        const only = typesRef.current;
        if (only && !only.includes(message.type)) return;
        handlerRef.current(message);
      }),
    [],
  );
}

/** Connection status of the shared event stream. */
export function useEventStatus(): EventStatus {
  return useSyncExternalStore(
    (onChange) => {
      statusListeners.add(onChange);
      return () => statusListeners.delete(onChange);
    },
    () => status,
    () => "idle",
  );
}

/** Reads a string field from an event's data (the data object also carries untyped extras such as txUrl). */
export function eventString(message: EventMessage, key: string): string | null {
  const value = message.data[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}
