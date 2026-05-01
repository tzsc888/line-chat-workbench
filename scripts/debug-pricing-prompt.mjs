import { replyGenerationPrompt } from "../lib/ai/prompts/reply-generation.ts";

const system = replyGenerationPrompt.system;
const startMarker = "4. pricing_or_payment:";
const endMarker = "Few-shot example 1 (money/life):";
const start = system.indexOf(startMarker);
const end = system.indexOf(endMarker);

if (start < 0 || end < 0 || end <= start) {
  console.error("Failed to locate pricing segment", { start, end });
  process.exit(1);
}

const pricingSegment = system.slice(start, end).trimEnd();

const goodStrings = [
  "【竹】",
  "【松】",
  "【梅】",
  "【竹希望】",
  "【松希望】",
  "【竹】本格リーディング鑑定",
  "【松】完全オーダーメイド鑑定",
  "【梅】ミニ鑑定",
  "初回の料金案内では【竹】と【松】を同時に出す",
  "基本は【竹】を主におすすめする",
  "【梅】は最初から提示しない",
  "【竹希望】または【松希望】",
  "まずは【竹】がいちばん入りやすいです",
  "まず一番自然なのは【竹】です",
  "必要でしたら【竹希望】と送ってくださいね",
  "初回の料金案内では【梅】を出さない",
];

const badStrings = [
  "初回の料金案内ではとを同時に出す",
  "基本はを主におすすめする",
  "時だけ寄りにしてよい",
  "は最初から提示しない",
  "まずはがいちばん入りやすい",
  "まず一番自然なのはです",
  "必要でしたらと送ってください",
  "初回の料金案内ではを出さない",
  "を出す時も",
];

const goodMap = Object.fromEntries(goodStrings.map((s) => [s, pricingSegment.includes(s)]));
const badMap = Object.fromEntries(badStrings.map((s) => [s, pricingSegment.includes(s)]));

console.log("JSON_ESCAPED=", JSON.stringify(pricingSegment));
console.log("BASE64=", Buffer.from(pricingSegment, "utf8").toString("base64"));
console.log("GOOD_CONTAINS_MAP=", JSON.stringify(goodMap, null, 2));
console.log("BAD_CONTAINS_MAP=", JSON.stringify(badMap, null, 2));

const keywordSet = [
  "初回の料金案内",
  "固定価格",
  "本格リーディング",
  "完全オーダーメイド",
  "ミニ鑑定",
  "まずは",
  "必要でしたら",
];

console.log("CHAR_CODE_LINES_START");
for (const line of pricingSegment.split("\n")) {
  if (!keywordSet.some((k) => line.includes(k))) continue;
  const codes = Array.from(line).map((ch) => `${ch}:${ch.codePointAt(0).toString(16)}`);
  console.log("LINE_JSON=", JSON.stringify(line));
  console.log("LINE_CODES=", JSON.stringify(codes));
}
console.log("CHAR_CODE_LINES_END");
