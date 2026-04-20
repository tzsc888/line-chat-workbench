"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

export function AppShellHeader() {
  const pathname = usePathname();
  const [loggingOut, setLoggingOut] = useState(false);

  if (pathname === "/login" || pathname === "/") return null;

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <header className="border-b border-slate-200 bg-white/80 backdrop-blur">
      <div className="mx-auto flex h-12 w-full max-w-[1800px] items-center justify-between px-4">
        <div className="flex items-center gap-4 text-sm text-slate-700">
          <Link href="/" className="font-semibold text-slate-900">
            LINE Chat Workbench
          </Link>
          <Link href="/followups" className="hover:text-slate-900">
            跟进中心
          </Link>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="rounded-lg border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {loggingOut ? "退出中..." : "退出登录"}
        </button>
      </div>
    </header>
  );
}
