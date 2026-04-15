"use client";

import { FormEvent, useEffect, useState } from "react";

export default function LoginPage() {
  const [nextPath, setNextPath] = useState("/");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const next = params.get("next") || "/";
    setNextPath(next.startsWith("/") ? next : "/");
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok || !json?.ok) {
        setError(json?.error || "登录失败");
        setSubmitting(false);
        return;
      }
      window.location.href = nextPath;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-lg border border-slate-200">
        <h1 className="text-2xl font-semibold text-slate-900">员工登录</h1>
        <p className="mt-2 text-sm text-slate-600">登录后进入 LINE 销售工作台。</p>
        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <label className="block">
            <div className="mb-1 text-sm text-slate-700">账号</div>
            <input
              className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="block">
            <div className="mb-1 text-sm text-slate-700">密码</div>
            <input
              className="w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-slate-500"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
            />
          </label>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-slate-900 px-4 py-2 text-white disabled:opacity-60"
          >
            {submitting ? "登录中..." : "登录"}
          </button>
        </form>
      </div>
    </main>
  );
}