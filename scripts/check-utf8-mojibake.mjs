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
  "鏈",
  "璇峰厛",
  "鍙戦",
  "鍔犺浇",
  "椤惧",
  "缂哄皯",
  "锟",
  "\uFFFD",
];

const REQUIRED_TOKENS = {
  "lib/ai/prompts/reply-generation.ts": [
    "JSON",
    "reply_a_ja",
    "reply_b_ja",
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
