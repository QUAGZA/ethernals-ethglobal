"use client";

import { useApp } from "@/lib/app-context";

/** App-wide banners: DEV MODE (persons without World ID) and "server not reachable". */
export function StatusBanners() {
  const { config, configError } = useApp();
  return (
    <>
      {config?.devFakePersons && (
        <div role="alert" className="bg-bad px-[2.2vw] py-2 text-center font-medium tracking-[.08em] text-white max-md:px-5">
          DEV MODE: NOT VERIFIED — persons can be created without World ID (DEV_FAKE_PERSONS=true). Never demo like this.
        </div>
      )}
      {configError && (
        <div role="alert" className="bg-ink px-[2.2vw] py-2 text-center text-paper max-md:px-5">
          <span className="text-yellow">●</span> {configError.message} {configError.hint ?? ""}
        </div>
      )}
    </>
  );
}
