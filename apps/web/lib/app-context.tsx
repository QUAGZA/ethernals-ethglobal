"use client";

/**
 * App-wide state: the public server config and the signed-in person (GET /api/me).
 * Both load in the browser, so `next build` never needs the server.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { MeResponse, PublicConfig } from "@ethernals/shared";
import { api, toApiError, type ApiRequestError } from "./api";

interface AppState {
  config: PublicConfig | null;
  configError: ApiRequestError | null;
  /** undefined while loading; person is null when signed out. */
  me: MeResponse | undefined;
  meError: ApiRequestError | null;
  refreshMe: () => Promise<MeResponse | undefined>;
  setMe: (me: MeResponse) => void;
  retryConfig: () => void;
}

const SIGNED_OUT: MeResponse = { person: null, buyerAgent: null, agents: [], hires: [] };

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [configError, setConfigError] = useState<ApiRequestError | null>(null);
  const [me, setMeState] = useState<MeResponse | undefined>(undefined);
  const [meError, setMeError] = useState<ApiRequestError | null>(null);
  const [configAttempt, setConfigAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api
      .config()
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        setConfigError(null);
      })
      .catch((err: unknown) => {
        if (!cancelled) setConfigError(toApiError(err));
      });
    return () => {
      cancelled = true;
    };
  }, [configAttempt]);

  const refreshMe = useCallback(async () => {
    try {
      const next = await api.me();
      setMeState(next);
      setMeError(null);
      return next;
    } catch (err) {
      const e = toApiError(err);
      // A 401 just means "signed out".
      if (e.status === 401) {
        setMeState(SIGNED_OUT);
        setMeError(null);
        return SIGNED_OUT;
      }
      setMeError(e);
      setMeState((current) => current ?? SIGNED_OUT);
      return undefined;
    }
  }, []);

  useEffect(() => {
    void refreshMe();
  }, [refreshMe]);

  const setMe = useCallback((next: MeResponse) => {
    setMeState(next);
    setMeError(null);
  }, []);

  const retryConfig = useCallback(() => setConfigAttempt((n) => n + 1), []);

  // If the server is down, keep retrying quietly so the app recovers once it starts.
  useEffect(() => {
    if (!configError) return;
    const t = setTimeout(() => {
      retryConfig();
      void refreshMe();
    }, 5000);
    return () => clearTimeout(t);
  }, [configError, retryConfig, refreshMe]);

  const value = useMemo(
    () => ({ config, configError, me, meError, refreshMe, setMe, retryConfig }),
    [config, configError, me, meError, refreshMe, setMe, retryConfig],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppProvider>");
  return ctx;
}

export { SIGNED_OUT };
