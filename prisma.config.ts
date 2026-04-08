import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    // Prisma CLI（migrate / db pull 等）优先走 DIRECT_URL；
    // 如果你暂时还没配置 DIRECT_URL，就回退到 DATABASE_URL。
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? "",
  },
});
