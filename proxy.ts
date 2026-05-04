import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  SESSION_COOKIE_NAME,
  getAppAuthSecret,
  hasAppAuthConfigured,
  verifySessionToken,
} from "@/lib/security/session";

const PUBLIC_PATH_PREFIXES = ["/_next", "/favicon.ico", "/public", "/login"];

const PUBLIC_API_PATHS = [
  "/api/line/webhook",
  "/api/cron/scheduled-messages",
  "/api/cron/automation-jobs",
  "/api/cron/maintenance",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/bridge/inbound",
  "/api/bridge/scheduled-messages/dispatch",
  "/api/bridge/outbound-tasks/claim",
];

function isPublicPath(pathname: string) {
  if (PUBLIC_PATH_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return true;
  }

  if (PUBLIC_API_PATHS.some((path) => pathname === path)) return true;

  if (pathname.startsWith("/api/bridge/outbound-tasks/") && pathname.endsWith("/complete")) {
    return true;
  }

  if (/\.(?:png|jpg|jpeg|gif|webp|svg|ico|txt|xml|woff2?)$/i.test(pathname)) return true;
  return false;
}

function isApiPath(pathname: string) {
  return pathname.startsWith("/api/");
}

function buildUnauthorizedResponse(request: NextRequest) {
  if (isApiPath(request.nextUrl.pathname)) {
    return NextResponse.json(
      { ok: false, error: "未登录或登录已过期" },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  const loginUrl = new URL("/login", request.url);
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (next && next !== "/login") loginUrl.searchParams.set("next", next);

  const response = NextResponse.redirect(loginUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) return NextResponse.next();

  if (!hasAppAuthConfigured()) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("Missing APP_LOGIN_USERNAME / APP_LOGIN_PASSWORD / APP_AUTH_SECRET", {
        status: 500,
      });
    }
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value || "";
  const session = await verifySessionToken(token, getAppAuthSecret());
  if (!session) return buildUnauthorizedResponse(request);

  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
