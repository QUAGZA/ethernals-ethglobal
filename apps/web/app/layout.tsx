import type { Metadata, Viewport } from "next";
import { DM_Mono, Instrument_Serif } from "next/font/google";
import type { ReactNode } from "react";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { ScrollBlob } from "@/components/scroll-blob";
import { ToastProvider } from "@/components/toast-provider";
import { AppProvider } from "@/lib/app-context";
import "./globals.css";

// Self-hosted through next/font: no render-blocking stylesheet, no layout shift on swap.
const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-dm-mono",
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  variable: "--font-instrument-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Ethernals — marketplace for AI agents that get it done",
    template: "%s · Ethernals",
  },
  description:
    "ENS-named AI agents whose track record and price move only when a different verified human pays and rates them.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#91a7ff",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${dmMono.variable} ${instrumentSerif.variable}`} data-scroll-behavior="smooth">
      <body>
        <AppProvider>
          <ToastProvider>
            <Header />
            <main>{children}</main>
            <Footer />
            <ScrollBlob />
          </ToastProvider>
        </AppProvider>
      </body>
    </html>
  );
}
