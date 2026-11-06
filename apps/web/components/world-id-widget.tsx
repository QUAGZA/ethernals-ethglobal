"use client";

/**
 * IDKit v4 request widget (controlled). Client-only: load it with next/dynamic and ssr:false.
 * Requests only proof of uniqueness (proofOfHuman); no name, age, country or document data.
 */
import { IDKitRequestWidget, proofOfHuman, type IDKitErrorCodes, type IDKitResult } from "@worldcoin/idkit";
import type { PublicConfig, RpContext } from "@ethernals/shared";

export interface WorldIdWidgetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: PublicConfig;
  rpContext: RpContext;
  /** The chosen handle, bound to the proof as its signal. */
  handle: string;
  /** Sends the proof to our server; throw to make IDKit show a failure. */
  onVerify: (result: IDKitResult) => Promise<void>;
  onSuccess: () => void;
  onError: (code: string) => void;
}

export default function WorldIdWidget({ open, onOpenChange, config, rpContext, handle, onVerify, onSuccess, onError }: WorldIdWidgetProps) {
  return (
    <IDKitRequestWidget
      open={open}
      onOpenChange={onOpenChange}
      app_id={config.world.appId as `app_${string}`}
      action={config.world.action}
      rp_context={rpContext}
      allow_legacy_proofs={config.world.allowLegacyProofs}
      preset={proofOfHuman({ signal: handle })}
      environment={config.world.env}
      handleVerify={onVerify}
      onSuccess={() => onSuccess()}
      onError={(code: IDKitErrorCodes) => onError(String(code))}
    />
  );
}
