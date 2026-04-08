import { NextRequest, NextResponse } from "next/server";

export async function POST(_: NextRequest) {
  // 这个接口之前把“当前选中顾客”频繁写入数据库，
  // 对实际业务价值很低，却会放大 Neon/Prisma 连接压力。
  // 先收紧成轻量 no-op，保留前端调用兼容性。
  return NextResponse.json({ ok: true });
}
