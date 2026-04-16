import type { Metadata } from "next";
import "./globals.css";
import { AppShellHeader } from "@/app/components/app-shell-header";

export const metadata: Metadata = {
  title: "LINE Chat Workbench",
  description: "日本 LINE 私域销售工作台",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col"><AppShellHeader />{children}</body>
    </html>
  );
}
