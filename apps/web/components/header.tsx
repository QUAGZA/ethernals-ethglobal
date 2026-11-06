"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/lib/app-context";
import { BrandMark } from "./brand-mark";
import { StatusBanners } from "./status-banners";

const links = [
  { href: "/agents", label: "AGENTS" },
  { href: "/tasks", label: "TASKS" },
  { href: "/duel", label: "DUEL" },
  { href: "/proofs", label: "PROOFS" },
  { href: "/provider", label: "PROVIDE" },
];

function AccountLink({ className = "" }: { className?: string }) {
  const { me } = useApp();
  if (me === undefined) return <span className={`py-1.5 opacity-40 ${className}`}>…</span>;
  if (me.person) {
    return (
      <Link className={`border-b border-ink py-1.5 transition-opacity duration-200 hover:opacity-50 ${className}`} href="/me">
        @{me.person.handle.toUpperCase()} <span className={me.person.credentialExpired ? "text-bad" : ""}>●</span>
      </Link>
    );
  }
  return (
    <Link className={`border-b border-ink py-1.5 transition-opacity duration-200 hover:opacity-50 ${className}`} href="/signup">
      GET STARTED <span>↗</span>
    </Link>
  );
}

export function Header() {
  const pathname = usePathname();
  const { config } = useApp();
  const [open, setOpen] = useState(false);
  const appName = (config?.appName ?? "Ethernals").toUpperCase();

  // Close the mobile menu whenever the route changes.
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="sticky top-0 z-30">
      <StatusBanners />
      <header className="relative flex h-[76px] items-center justify-between border-b border-white/70 bg-white/70 px-[2.2vw] shadow-[0_6px_30px_rgb(17_17_17_/_0.06)] backdrop-blur-xl backdrop-saturate-150 max-md:px-5">
        <Link className="flex items-center gap-3 font-medium tracking-[.1em]" href="/" aria-label={`${appName} home`}>
          <BrandMark priority className="w-[46px] max-md:w-[40px]" />
          <span>{appName}</span>
        </Link>

        <nav className="flex gap-[3vw] max-md:hidden" aria-label="Main navigation">
          {links.map((link) => {
            const active = pathname?.startsWith(link.href);
            return (
              <Link
                key={link.href}
                className={`py-1.5 transition-opacity duration-200 hover:opacity-50 ${active ? "border-b border-ink" : ""}`}
                href={link.href}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <AccountLink className="max-md:hidden" />

        <button
          type="button"
          className="hidden size-10 cursor-pointer flex-col items-center justify-center gap-[5px] max-md:flex"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          <span className={`block h-px w-5 bg-ink transition-transform duration-200 ${open ? "translate-y-[6px] rotate-45" : ""}`} />
          <span className={`block h-px w-5 bg-ink transition-opacity duration-200 ${open ? "opacity-0" : ""}`} />
          <span className={`block h-px w-5 bg-ink transition-transform duration-200 ${open ? "-translate-y-[6px] -rotate-45" : ""}`} />
        </button>

        {open && (
          <nav
            id="mobile-menu"
            aria-label="Main navigation"
            className="absolute inset-x-0 top-full hidden flex-col border-b border-line bg-white px-5 py-4 shadow-[0_20px_40px_rgb(17_17_17_/_0.08)] max-md:flex"
          >
            {links.map((link) => (
              <Link
                key={link.href}
                className={`border-b border-line py-4 text-[13px] tracking-[.1em] ${pathname?.startsWith(link.href) ? "font-medium" : ""}`}
                href={link.href}
              >
                {link.label}
              </Link>
            ))}
            <div className="pt-4">
              <AccountLink />
            </div>
          </nav>
        )}
      </header>
    </div>
  );
}
