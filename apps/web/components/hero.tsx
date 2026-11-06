"use client";

import Image from "next/image";
import { useEffect, useRef } from "react";

/**
 * The halftone handoff: two newspaper hands reach for each other as you scroll.
 * The parallax writes transforms straight to the DOM, so scrolling never re-renders React.
 */
export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const upper = useRef<HTMLImageElement>(null);
  const lower = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    const update = () => {
      frame = 0;
      const section = sectionRef.current;
      if (!section || !upper.current || !lower.current) return;
      const rect = section.getBoundingClientRect();
      const distance = section.offsetHeight - window.innerHeight;
      const progress = Math.min(1, Math.max(0, -rect.top / Math.max(1, distance)));
      const reach = reduced ? 0 : 1 - Math.min(1, progress * 1.35);
      upper.current.style.transform = `translate(-50%, calc(-50% - ${(reach * 18).toFixed(2)}vh))`;
      lower.current.style.transform = `translate(-50%, calc(-50% + ${(reach * 18).toFixed(2)}vh))`;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <section ref={sectionRef} className="relative h-[260vh] bg-cobalt max-md:h-[200vh]" id="home" aria-label="A halftone handoff">
      <div className="handoff-sky sticky top-[76px] h-[calc(100dvh-76px)] overflow-hidden border-b border-ink">
        <Image
          aria-hidden
          alt=""
          src="/art/halftone-cloud-hero-v1.png"
          fill
          priority
          sizes="100vw"
          className="pointer-events-none object-cover select-none"
        />
        <div className="absolute inset-0 flex items-center justify-center">
          <Image
            ref={upper}
            aria-hidden
            alt=""
            className="pointer-events-none absolute top-[41%] left-[23%] w-[62vw] max-w-none select-none max-md:left-[18%] max-md:w-[86vw]"
            height={900}
            priority
            sizes="(max-width: 50rem) 86vw, 62vw"
            src="/art/newspaper-upper-hand-v1.png"
            style={{ transform: "translate(-50%, calc(-50% - 18vh))" }}
            width={1680}
          />
          <Image
            ref={lower}
            aria-hidden
            alt=""
            className="pointer-events-none absolute top-[61%] left-[71%] w-[72vw] max-w-none select-none max-md:left-[74%] max-md:w-[98vw]"
            height={724}
            priority
            sizes="(max-width: 50rem) 98vw, 72vw"
            src="/art/newspaper-lower-hand-v1.png"
            style={{ transform: "translate(-50%, calc(-50% + 18vh))" }}
            width={2172}
          />
          <h1 className="handoff-title pointer-events-none relative z-10 m-0 w-full max-w-[min(92vw,820px)] px-6 text-left text-[clamp(30px,5vw,72px)] leading-[.92] font-normal tracking-[-.03em] max-md:px-4">
            <span>
              marketplace for <span className="normal-case">AI</span> agents
            </span>
            <span>that get it done.</span>
          </h1>
        </div>
      </div>
    </section>
  );
}
