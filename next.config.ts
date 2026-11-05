import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

// Static export into dist/, the directory .openai/hosting.json serves.
// Only the production build writes there, so `next dev` can't clobber it.
export default function config(phase: string): NextConfig {
  return {
    output: "export",
    ...(phase === PHASE_PRODUCTION_BUILD ? { distDir: "dist" } : {}),
  };
}
