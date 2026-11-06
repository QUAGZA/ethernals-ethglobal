"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toApiError, type ApiRequestError } from "./api";

/** Runs `fn` every `ms` milliseconds; pass null to pause. */
export function useInterval(fn: () => void, ms: number | null): void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => fnRef.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

export interface Loadable<T> {
  data: T | undefined;
  error: ApiRequestError | null;
  loading: boolean;
  /** Re-runs the loader, keeping the current data on screen. Resolves with the new data. */
  reload: () => Promise<T | undefined>;
}

/**
 * Loads data on mount (client-side only) and whenever `key` changes; pass a null key to skip.
 * Only the newest response is applied, so a slow old request never overwrites fresh data.
 */
export function useLoad<T>(loader: () => Promise<T>, key: string | null): Loadable<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [loading, setLoading] = useState(key !== null);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const keyRef = useRef(key);
  keyRef.current = key;
  const generation = useRef(0); // bumps when the key changes
  const started = useRef(0); // sequence of started requests
  const applied = useRef(0); // newest sequence applied

  const run = useCallback(async (): Promise<T | undefined> => {
    if (keyRef.current === null) return undefined;
    const gen = generation.current;
    const seq = ++started.current;
    setLoading(true);
    try {
      const value = await loaderRef.current();
      if (gen !== generation.current || seq < applied.current) return undefined;
      applied.current = seq;
      setData(value);
      setError(null);
      return value;
    } catch (err) {
      if (gen === generation.current && seq >= applied.current) {
        applied.current = seq;
        setError(toApiError(err));
      }
      return undefined;
    } finally {
      if (gen === generation.current && seq === started.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    generation.current++;
    applied.current = 0;
    started.current = 0;
    setData(undefined);
    setError(null);
    if (key === null) {
      setLoading(false);
      return;
    }
    void run();
  }, [key, run]);

  return { data, error, loading, reload: run };
}

/** Returns a function that calls `fn` at most once per `ms` (trailing call). */
export function useDebounced(fn: () => void, ms: number): () => void {
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return useCallback(() => {
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      fnRef.current();
    }, ms);
  }, [ms]);
}

/** Seconds since `since` (a timestamp), ticking every second while `since` is set. */
export function useElapsed(since: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useInterval(() => setNow(Date.now()), since === null ? null : 1000);
  useEffect(() => {
    if (since !== null) setNow(Date.now());
  }, [since]);
  return since === null ? 0 : Math.max(0, Math.floor((now - since) / 1000));
}
