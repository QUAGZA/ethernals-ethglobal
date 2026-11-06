"use client";

import { useEffect, useRef } from "react";

const PILL = 56; // must match .scroll-blob height
const MARGIN = 12; // must match .scroll-blob top

/**
 * The page's only scrollbar: one fixed-size white pill that slides down the right edge
 * with the scroll progress. No track, no arrows; it never grows on long pages.
 * It writes transforms directly (no React state) so scrolling never re-renders.
 */
export function ScrollBlob() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      if (max <= 1) {
        el.style.opacity = "0";
        return;
      }
      el.style.opacity = "1";
      const progress = Math.min(1, Math.max(0, window.scrollY / max));
      const travel = window.innerHeight - PILL - MARGIN * 2;
      el.style.transform = `translate3d(0, ${Math.round(progress * travel)}px, 0)`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return <div ref={ref} className="scroll-blob" aria-hidden />;
}
