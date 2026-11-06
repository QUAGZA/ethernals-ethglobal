"use client";

import { useApp } from "@/lib/app-context";

/**
 * App-wide banner for DEV MODE (persons without World ID). The "server not reachable"
 * banner is gone on purpose; the app keeps reconnecting quietly in the background.
 */
export function StatusBanners() {
  const { config } = useApp();
  if (!config?.devFakePersons) return null;
  return (
    <div role="alert" className="bg-bad px-[2.2vw] py-2 text-center font-medium tracking-[.08em] text-white max-md:px-5">
      DEV MODE: NOT VERIFIED — persons can be created without World ID (DEV_FAKE_PERSONS=true). Never demo like this.
    </div>
  );
}
