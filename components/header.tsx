"use client";

import { useState } from "react";
import { useToast } from "./toast-provider";

const links = [
  { href: "#market", label: "MARKET" },
  { href: "#arena", label: "ARENA" },
  { href: "#protocol", label: "PROTOCOL" },
];

export function Header() {
  const toast = useToast();
  const [connected, setConnected] = useState(false);

  function connectWallet() {
    setConnected(true);
    toast("Demo wallet connected.");
  }

  return (
    <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-ink bg-paper/94 px-[2.2vw] backdrop-blur-[12px]">
      <a
        className="flex items-center gap-2.5 font-medium tracking-[.1em]"
        href="#home"
        aria-label="Ethernals home"
      >
        <span className="grid size-[34px] place-items-center rounded-full bg-yellow font-serif text-[25px] italic">
          E
        </span>{" "}
        ETHERNALS
      </a>
      <nav className="flex gap-[3vw] max-md:hidden" aria-label="Main navigation">
        {links.map((link) => (
          <a
            key={link.href}
            className="transition-opacity duration-200 hover:opacity-50"
            href={link.href}
          >
            {link.label}
          </a>
        ))}
      </nav>
      <button
        className="cursor-pointer border-b py-1.5 transition-opacity duration-200 hover:opacity-50"
        onClick={connectWallet}
      >
        {connected ? "0x71…2E9" : "CONNECT"}{" "}
        <span>{connected ? "●" : "↗"}</span>
      </button>
    </header>
  );
}
