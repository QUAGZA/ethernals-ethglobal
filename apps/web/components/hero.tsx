"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const section = sectionRef.current;
      if (!section) return;
      const rect = section.getBoundingClientRect();
      const distance = section.offsetHeight - window.innerHeight;
      setProgress(Math.min(1, Math.max(0, -rect.top / Math.max(1, distance))));
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  const reach = 1 - Math.min(1, progress * 1.35);

  return (
    <section ref={sectionRef} className="relative h-[260vh] bg-[#1532d8]" id="home" aria-label="A halftone handoff">
      <div className="handoff-sky sticky top-[76px] h-[calc(100vh-76px)] overflow-hidden border-b">
        <div className="absolute inset-0 flex items-center justify-center">
          <Image
            aria-hidden
            alt=""
            className="pointer-events-none absolute top-[41%] left-[29%] w-[62vw] max-w-none select-none max-md:left-[25%] max-md:w-[86vw]"
            height={900}
            priority
            src="/art/newspaper-upper-hand-v1.png"
            style={{
              transform: `translate(-50%, calc(-50% - ${reach * 18}vh))`,
            }}
            width={1680}
          />
          <Image
            aria-hidden
            alt=""
            className="pointer-events-none absolute top-[61%] left-[71%] w-[72vw] max-w-none select-none max-md:left-[74%] max-md:w-[98vw]"
            height={724}
            priority
            src="/art/newspaper-lower-hand-v1.png"
            style={{
              transform: `translate(-50%, calc(-50% + ${reach * 18}vh))`,
            }}
            width={2172}
          />
          <h1 className="handoff-title pointer-events-none relative z-10 m-0 max-w-[620px] px-6 text-left text-[clamp(32px,4.5vw,64px)] leading-[.86] font-normal tracking-[-.055em]">
            <span>from my agents</span>
            <span>to yours</span>
          </h1>
        </div>
      </div>
    </section>
  );
}
