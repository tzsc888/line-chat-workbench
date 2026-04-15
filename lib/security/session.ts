const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const SESSION_COOKIE_NAME = "lcw_session";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 12;

type SessionPayload = {
  sub: string;
  exp: number;
  v: 1;
};

function bytesToBinary(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return binary;
}

function binaryToBytes(binary: string) {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64Url(bytes: Uint8Array) {
  return btoa(bytesToBinary(bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = normalized.length % 4 === 0 ? 0 : 4 - (normalized.length % 4);
  return binaryToBytes(atob(normalized + "=".repeat(pad)));
}

function timingSafeEqualBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return new Uint8Array(signature);
}

export function getAppLoginUsername() {
  return process.env.APP_LOGIN_USERNAME || process.env.ADMIN_BASIC_AUTH_USERNAME || "";
}

export function getAppLoginPassword() {
  return process.env.APP_LOGIN_PASSWORD || process.env.ADMIN_BASIC_AUTH_PASSWORD || "";
}

export function getAppAuthSecret() {
  return process.env.APP_AUTH_SECRET || process.env.CRON_SECRET || "";
}

export function hasAppAuthConfigured() {
  return !!(getAppLoginUsername() && getAppLoginPassword() && getAppAuthSecret());
}

export async function createSessionToken(username: string, secret: string, ttlSeconds = DEFAULT_SESSION_TTL_SECONDS) {
  const payload: SessionPayload = {
    sub: username,
    exp: Date.now() + ttlSeconds * 1000,
    v: 1,
  };
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = toBase64Url(await sign(encodedPayload, secret));
  return `${encodedPayload}.${signature}`;
}

export async function verifySessionToken(token: string, secret: string) {
  if (!token || !secret) return null;
  const [encodedPayload, encodedSignature] = token.split(".");
  if (!encodedPayload || !encodedSignature) return null;

  const expectedSignature = await sign(encodedPayload, secret);
  const providedSignature = fromBase64Url(encodedSignature);
  if (!timingSafeEqualBytes(expectedSignature, providedSignature)) return null;

  try {
    const payload = JSON.parse(decoder.decode(fromBase64Url(encodedPayload))) as SessionPayload;
    if (!payload?.sub || typeof payload.exp !== "number" || payload.v !== 1) return null;
    if (payload.exp <= Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}
