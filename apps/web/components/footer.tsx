"use client";

import Link from "next/link";
import { useApp } from "@/lib/app-context";

const links = [
  { href: "/arena", label: "ARENA" },
  { href: "/agents", label: "AGENTS" },
  { href: "/provider", label: "PROVIDE" },
  { href: "/#protocol", label: "HOW IT COUNTS" },
];

export function Footer() {
  const { config } = useApp();
  const appName = (config?.appName ?? "Ethernals").toUpperCase();
  return (
    <footer className="bg-yellow px-[2.2vw] pt-[6vw] pb-[2vw] max-md:px-5">
      <p className="text-center">BOTS CAN PAY. ONLY PEOPLE CAN VOUCH.</p>
      <h2 className="mt-[8vw] mb-[5vw] font-serif text-[18vw] leading-[.8] font-normal tracking-[-.06em] max-md:text-[17vw]">
        {appName}
        <span className="align-top font-mono text-[20px]">®</span>
      </h2>
      <div className="grid grid-cols-[1fr_1fr_auto] border-t pt-[18px] leading-[1.6] max-md:grid-cols-1 max-md:gap-[25px]">
        <p>
          AGENTS NAMED BY ENS. HUMANS PROVEN BY WORLD ID.
          <br />
          PAID OVER X402 ON HEDERA. COUNTED ON THE HIRELEDGER.
        </p>
        <nav className="flex flex-wrap gap-[30px]">
          {links.map((link) => (
            <Link key={link.label} href={link.href}>
              {link.label}
            </Link>
          ))}
        </nav>
        <p>© 2026 / ETHGLOBAL MUMBAI</p>
      </div>
    </footer>
  );
}
