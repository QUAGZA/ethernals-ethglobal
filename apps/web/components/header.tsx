"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useApp } from "@/lib/app-context";
import { StatusBanners } from "./status-banners";

const links = [
  { href: "/arena", label: "ARENA" },
  { href: "/agents", label: "AGENTS" },
  { href: "/tasks", label: "TASKS" },
  { href: "/duel", label: "DUEL" },
  { href: "/sandbox", label: "SANDBOX" },
  { href: "/proofs", label: "PROOFS" },
  { href: "/provider", label: "PROVIDE" },
  { href: "/#protocol", label: "HOW IT COUNTS" },
];

function AccountLink() {
  const { me } = useApp();
  if (me === undefined) return <span className="py-1.5 opacity-40">…</span>;
  if (me.person) {
    return (
      <Link className="border-b py-1.5 transition-opacity duration-200 hover:opacity-50" href="/me">
        @{me.person.handle.toUpperCase()} <span className={me.person.credentialExpired ? "text-bad" : ""}>●</span>
      </Link>
    );
  }
  return (
    <Link className="border-b py-1.5 transition-opacity duration-200 hover:opacity-50" href="/signup">
      CONNECT <span>↗</span>
    </Link>
  );
}

export function Header() {
  const pathname = usePathname();
  const { config } = useApp();
  const appName = (config?.appName ?? "Ethernals").toUpperCase();

  return (
    <div className="sticky top-0 z-20">
      <StatusBanners />
      <header className="flex h-[76px] items-center justify-between border-b border-ink bg-paper/94 px-[2.2vw] backdrop-blur-[12px] max-md:px-5">
        <Link className="flex items-center gap-2.5 font-medium tracking-[.1em]" href="/" aria-label={`${appName} home`}>
          <span className="grid size-[34px] place-items-center rounded-full bg-yellow font-serif text-[25px] italic">
            {appName.charAt(0)}
          </span>{" "}
          {appName}
        </Link>
        <nav className="flex gap-[3vw] max-md:hidden" aria-label="Main navigation">
          {links.map((link) => {
            const active = link.href !== "/#protocol" && pathname?.startsWith(link.href);
            return (
              <Link
                key={link.href}
                className={`transition-opacity duration-200 hover:opacity-50 ${active ? "border-b border-ink" : ""}`}
                href={link.href}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <AccountLink />
      </header>
    </div>
  );
}
