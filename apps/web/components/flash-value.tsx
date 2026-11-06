"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Shows a value and flashes it when it changes. Numeric values also count up/down
 * to the new number, so a climbing average is visible on a projector.
 */
export function FlashValue({ value, className = "", tween = true }: { value: string; className?: string; tween?: boolean }) {
  const previous = useRef(value);
  const [flashKey, setFlashKey] = useState(0);
  const [shown, setShown] = useState(value);

  useEffect(() => {
    const from = previous.current;
    previous.current = value;
    if (from === value) return;
    setFlashKey((k) => k + 1);

    const a = Number(from);
    const b = Number(value);
    const decimals = value.includes(".") ? value.split(".")[1].length : 0;
    const isNumeric = tween && from.trim() !== "" && value.trim() !== "" && Number.isFinite(a) && Number.isFinite(b);
    if (!isNumeric || typeof window === "undefined" || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    const duration = 700;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(t >= 1 ? value : (a + (b - a) * eased).toFixed(decimals));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, tween]);

  return (
    <span key={flashKey} className={`${flashKey > 0 ? "animate-flash" : ""} ${className}`}>
      {shown}
    </span>
  );
}
