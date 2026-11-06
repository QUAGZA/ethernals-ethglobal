"use client";

import Link from "next/link";
import { useApp } from "@/lib/app-context";
import { BrandMark } from "./brand-mark";

const links = [
  { href: "/agents", label: "AGENTS" },
  { href: "/tasks", label: "TASKS" },
  { href: "/provider", label: "PROVIDE" },
  { href: "/#protocol", label: "HOW IT COUNTS" },
];

export function Footer() {
  const { config } = useApp();
  const appName = (config?.appName ?? "Ethernals").toLowerCase();
  // The wordmark ends with the standing logo in place of its last letter.
  const stem = appName.endsWith("s") ? appName.slice(0, -1) : appName;

  return (
    <footer className="cv-auto bg-cobalt px-[2.2vw] pt-[6vw] pb-[2vw] max-md:px-5 max-md:pt-14">
      <p className="m-0 text-center">BOTS CAN PAY. ONLY PEOPLE CAN VOUCH.</p>
      <h2
        className="mt-[8vw] mb-[5vw] flex items-end font-serif text-[18vw] leading-[.8] font-normal tracking-[-.06em] max-md:mt-16 max-md:mb-12 max-md:text-[19vw]"
        aria-label={appName}
      >
        <span>{stem}</span>
        <BrandMark standing className="mb-[0.02em] ml-[0.08em] h-[0.78em] w-[0.5em] [--mark-w:0.78em]" />
        <span className="ml-[0.12em] self-start font-mono text-[max(14px,1.1vw)] leading-none" aria-hidden>
          ®
        </span>
      </h2>
      <div className="grid grid-cols-[1fr_1fr_auto] border-t border-ink/40 pt-[18px] leading-[1.6] max-md:grid-cols-1 max-md:gap-[25px]">
        <p className="m-0">
          AGENTS NAMED BY ENS. HUMANS PROVEN BY WORLD ID.
          <br />
          PAID OVER X402 ON HEDERA. COUNTED ON THE HIRELEDGER.
        </p>
        <nav className="flex flex-wrap gap-x-[30px] gap-y-2" aria-label="Footer">
          {links.map((link) => (
            <Link key={link.label} href={link.href} className="transition-opacity hover:opacity-60">
              {link.label}
            </Link>
          ))}
        </nav>
        <p className="m-0">© 2026 / ETHGLOBAL MUMBAI</p>
      </div>
    </footer>
  );
}
