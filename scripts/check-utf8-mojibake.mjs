import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.cwd();
const TARGET_DIRS = ["app", "lib", "tests", "scripts"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".md"]);
const EXCLUDED_FILES = new Set([
  path.normalize("tests/ai/mojibake-guard.test.ts"),
  path.normalize("scripts/check-utf8-mojibake.mjs"),
]);

// Common UTF-8/GBK mojibake fragments observed in this repo.
const MOJIBAKE_MARKERS = [
  "閺堫亪",
  "鐠囧嘲鍘?",
  "閸欐垿",
  "閸旂姾娴?",
  "妞ゆ儳",
  "缂傚搫鐨?",
  "閿?",
  "\uFFFD",
];

const REQUIRED_TOKENS = {
  "lib/ai/prompts/reply-generation.ts": [
    "JSON",
    "## 1. システム上の役割・業務背景",
    "## 2. 接客・成約の考え方 + 内部判断順",
    "## 3. 料金表・料金案内ルール",
    "## 4. 現在時刻",
    "## 5. 実際のチャット履歴",
    "## 6. 直前の運営メッセージ + 今回返信すべき顧客メッセージ",
    "## 7. 禁止事項・絶対ルール",
    "## 8. 出力ルール",
    "{{CURRENT_TIME_JST}}",
    "{{CHAT_HISTORY}}",
    "{{LAST_OPERATOR_MESSAGE}}",
    "{{CURRENT_MESSAGE_COUNT}}",
    "{{CURRENT_CUSTOMER_MESSAGES}}",
    "{{OPERATOR_NOTE_OPTIONAL}}",
    "reply_ja",
    "【生成返信前の内部判断】",
    "【竹】本格リーディング鑑定：4,980円",
    "【松】完全オーダーメイド鑑定：9,980円",
    "【梅】ミニ鑑定：2,980円",
    "初回の料金案内では、基本的に【竹】と【松】を同時に出してください。",
    "大多数の場合は【竹】を主におすすめします。",
    "その後で【竹】と【松】を案内します。",
    "【直前の運営メッセージ】",
    "【今回返信すべき顧客メッセージ】",
    "【今回だけの補足指示】",
    "【竹】4,980円",
    "【松】9,980円",
    "【梅】2,980円",
    "鑑定文のお届け",
    "申込みにつながる流れ",
  ],
};

function walk(dir, out = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
      continue;
    }
    if (!EXTENSIONS.has(path.extname(entry.name))) continue;
    out.push(full);
  }
  return out;
}

export function collectTargetFiles() {
  const all = [];
  for (const relative of TARGET_DIRS) {
    const abs = path.join(ROOT, relative);
    if (!fs.existsSync(abs)) continue;
    all.push(...walk(abs));
  }
  return all;
}

export function scanMojibake(files) {
  const hits = [];
  for (const file of files) {
    const rel = path.normalize(path.relative(ROOT, file));
    if (EXCLUDED_FILES.has(rel)) continue;
    const text = fs.readFileSync(file, "utf8");
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const marker of MOJIBAKE_MARKERS) {
        if (line.includes(marker)) {
          hits.push({
            file: rel,
            line: index + 1,
            marker,
            snippet: line.trim().slice(0, 120),
          });
          break;
        }
      }
    });
  }
  return hits;
}

export function checkRequiredTokens() {
  const missing = [];
  for (const [relativePath, tokens] of Object.entries(REQUIRED_TOKENS)) {
    const abs = path.join(ROOT, relativePath);
    if (!fs.existsSync(abs)) {
      missing.push({ file: relativePath, token: "(file missing)" });
      continue;
    }
    const text = fs.readFileSync(abs, "utf8");
    for (const token of tokens) {
      if (!text.includes(token)) {
        missing.push({ file: relativePath, token });
      }
    }
  }
  return missing;
}

function run() {
  const files = collectTargetFiles();
  const mojibakeHits = scanMojibake(files);
  const missingTokens = checkRequiredTokens();

  if (mojibakeHits.length === 0 && missingTokens.length === 0) {
    console.log("check:mojibake passed");
    return;
  }

  if (mojibakeHits.length > 0) {
    console.error("Mojibake markers detected:");
    for (const hit of mojibakeHits) {
      console.error(`- ${hit.file}:${hit.line} marker=${hit.marker} :: ${hit.snippet}`);
    }
  }

  if (missingTokens.length > 0) {
    console.error("Required token missing:");
    for (const miss of missingTokens) {
      console.error(`- ${miss.file} missing "${miss.token}"`);
    }
  }

  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  run();
}
