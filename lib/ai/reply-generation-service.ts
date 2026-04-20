import type { GenerationContextPack } from "./ai-types";
import { requestStructuredJsonWithContract } from "./model-client";
import { validateGenerationResult } from "./protocol-validator";
import { replyGenerationPrompt } from "./prompts/reply-generation";
import { resolveGenerationStrategy } from "./strategy";

const GENERATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply_a", "reply_b"],
  properties: {
    reply_a: {
      type: "object",
      additionalProperties: true,
      required: ["japanese"],
      properties: {
        japanese: { type: "string" },
        chinese_meaning: { type: "string" },
      },
    },
    reply_b: {
      type: "object",
      additionalProperties: true,
      required: ["japanese"],
      properties: {
        japanese: { type: "string" },
        chinese_meaning: { type: "string" },
      },
    },
    difference_note: { type: "string" },
    self_check: { type: "object" },
  },
} as const;

function validateGenerationContract(raw: unknown) {
  const errors: string[] = [];
  const root = raw && typeof raw === "object" ? (raw as Record<string, any>) : null;
  if (!root) return ["root must be object"];

  const readChineseMeaning = (value: Record<string, any>) => {
    const candidates = [
      value.chinese_meaning,
      value.chinese_explanation,
      value.chineseMeaning,
      value.chineseExplanation,
      value.chinese,
      value.translation,
      value.zh,
    ];
    for (const item of candidates) {
      if (typeof item === "string") return item;
    }
    return null;
  };

  const replyA = root.reply_a && typeof root.reply_a === "object" ? (root.reply_a as Record<string, any>) : null;
  const replyB = root.reply_b && typeof root.reply_b === "object" ? (root.reply_b as Record<string, any>) : null;

  if (!replyA) errors.push("reply_a must be object");
  if (!replyB) errors.push("reply_b must be object");
  if (root.difference_note != null && typeof root.difference_note !== "string") errors.push("difference_note must be string");
  if (root.self_check != null && typeof root.self_check !== "object") errors.push("self_check must be object");

  if (replyA) {
    if (typeof replyA.japanese !== "string" || !replyA.japanese.trim()) {
      errors.push("reply_a.japanese must be non-empty string");
    }
    const replyAChineseMeaning = readChineseMeaning(replyA);
    if (typeof replyAChineseMeaning !== "string" || !replyAChineseMeaning.trim()) {
      errors.push("reply_a.chinese_meaning must be non-empty string");
    }
  }
  if (replyB) {
    if (typeof replyB.japanese !== "string" || !replyB.japanese.trim()) {
      errors.push("reply_b.japanese must be non-empty string");
    }
    const replyBChineseMeaning = readChineseMeaning(replyB);
    if (typeof replyBChineseMeaning !== "string" || !replyBChineseMeaning.trim()) {
      errors.push("reply_b.chinese_meaning must be non-empty string");
    }
  }

  return errors;
}

export async function runReplyGeneration(context: GenerationContextPack) {
  const apiKey = process.env.EKAN8_API_KEY;
  const baseUrl = process.env.EKAN8_BASE_URL;
  const backupBaseUrl = process.env.EKAN8_BACKUP_BASE_URL;
  const model = process.env.MAIN_MODEL;

  if (!apiKey || !baseUrl || !model) {
    throw new Error("generation service missing env");
  }

  const strategy = resolveGenerationStrategy();

  const response = await requestStructuredJsonWithContract({
    apiKey,
    baseUrl,
    backupBaseUrl,
    model,
    system: replyGenerationPrompt.system,
    user: JSON.stringify(context, null, 2),
    temperature: strategy.temperature,
    stage: "generation",
    schemaName: "reply_generation_result",
    schema: GENERATION_JSON_SCHEMA as unknown as Record<string, unknown>,
    validateParsed: validateGenerationContract,
  });

  return {
    ...response,
    model,
    promptVersion: replyGenerationPrompt.version,
    parsed: validateGenerationResult(response.parsed),
  };
}
