export type BridgeInboundMode = "live" | "non_live";

export function normalizeBridgeInboundMode(value: unknown): BridgeInboundMode {
  const mode = String(value || "").trim().toLowerCase();
  return mode === "live" ? "live" : "non_live";
}

export function resolveBridgeInboundNotifyPolicy(input: {
  mode: BridgeInboundMode;
  notify?: boolean;
}) {
  const shouldNotifyInboundSound =
    typeof input.notify === "boolean" ? input.notify : input.mode === "live";

  return {
    shouldNotifyInboundSound,
    inboundRefreshReason: shouldNotifyInboundSound
      ? ("bridge-inbound-message" as const)
      : ("bridge-inbound-history" as const),
  };
}

