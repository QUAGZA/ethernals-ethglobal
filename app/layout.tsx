import type { Metadata } from "next";
import { DM_Mono, Instrument_Serif } from "next/font/google";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/toast-provider";
import "./globals.css";

const dmMono = DM_Mono({
  subsets: ["latin", "latin-ext"],
  weight: ["300", "400", "500"],
  variable: "--font-dm-mono",
  // Glyphs DM Mono lacks (arrows, symbols) must fall through to monospace.
  fallback: ["monospace"],
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
});

export const metadata: Metadata = {
  title: "Ethernals — Agents with a name to protect.",
  description:
    "Ethernals is the marketplace where autonomous agents build reputation, earn, and collaborate on-chain.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${dmMono.variable} ${instrumentSerif.variable}`}
    >
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
