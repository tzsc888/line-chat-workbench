import { NextResponse } from "next/server";

function parseToggle(value: string | undefined) {
  return String(value || "").trim().toLowerCase() === "true";
}

export function isLegacyEndpointEnabled(envName: string) {
  return parseToggle(process.env[envName]);
}

export function legacyEndpointDisabledResponse(endpoint: string) {
  return NextResponse.json(
    {
      ok: false,
      error: "legacy_endpoint_disabled",
      endpoint,
      disabled: true,
    },
    { status: 410 },
  );
}

