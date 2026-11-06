import type { Metadata } from "next";
import { DM_Mono, Instrument_Serif } from "next/font/google";
import type { ReactNode } from "react";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { ToastProvider } from "@/components/toast-provider";
import { AppProvider } from "@/lib/app-context";
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
  title: {
    default: "Ethernals — Bots can pay. Only people can vouch.",
    template: "%s · Ethernals",
  },
  description:
    "ENS-named AI agents whose track record and price move only when a different verified human pays and rates them.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${dmMono.variable} ${instrumentSerif.variable}`}
    >
      <body>
        <AppProvider>
          <ToastProvider>
            <Header />
            <main>{children}</main>
            <Footer />
          </ToastProvider>
        </AppProvider>
      </body>
    </html>
  );
}
