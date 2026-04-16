import { NextRequest, NextResponse } from "next/server";
import { constantTimeEqual } from "@/lib/security/secret";
import {
  SESSION_COOKIE_NAME,
  createSessionToken,
  getAppAuthSecret,
  getAppLoginPassword,
  getAppLoginUsername,
  hasAppAuthConfigured,
} from "@/lib/security/session";

export async function POST(request: NextRequest) {
  try {
    if (!hasAppAuthConfigured()) {
      return NextResponse.json({ ok: false, error: "缺少登录配置" }, { status: 500 });
    }

    const body = await request.json().catch(() => ({}));
    const username = String(body?.username || "").trim();
    const password = String(body?.password || "");

    const expectedUser = getAppLoginUsername();
    const expectedPassword = getAppLoginPassword();
    if (!constantTimeEqual(username, expectedUser) || !constantTimeEqual(password, expectedPassword)) {
      return NextResponse.json({ ok: false, error: "账号或密码错误" }, { status: 401 });
    }

    const token = await createSessionToken(username, getAppAuthSecret());
    const response = NextResponse.json({ ok: true });
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    return response;
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
