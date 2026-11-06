"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

const TOAST_DURATION_MS = 4000;

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
      <div className="fixed right-5 bottom-5 z-50 flex max-w-[min(440px,90vw)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="border-l-[5px] border-cobalt bg-ink px-5 py-[15px] leading-[1.5] text-white">
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
