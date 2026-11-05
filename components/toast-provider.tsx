"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

const TOAST_DURATION_MS = 2600;

type Toast = { id: number; message: string };

const ToastContext = createContext<(message: string) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const toast = useCallback((message: string) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { id, message }]);
    setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {toasts.map((t) => (
        <div
          key={t.id}
          className="fixed right-5 bottom-5 z-50 border-l-[5px] border-yellow bg-ink px-5 py-[15px] text-white"
        >
          {t.message}
        </div>
      ))}
    </ToastContext.Provider>
  );
}
