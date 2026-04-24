import { buildChatCompletionsUrl, requestStructuredJsonWithContract } from "./model-client";
import { normalizeGenerationReply, validateMainBrainGenerationResult } from "./protocol-validator";
import { replyGenerationPrompt } from "./prompts/reply-generation";
import { resolveGenerationStrategy } from "./strategy";

const GENERATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply_a_ja", "reply_b_ja"],
  properties: {
    reply_a_ja: { type: "string" },
    reply_b_ja: { type: "string" },
  },
} as const;

function validateGenerationContract(raw: unknown) {
  const normalized = normalizeGenerationReply(raw);
  const errors: string[] = [];
  if (!normalized.reply_a_ja.trim()) {
    errors.push("reply_a_ja must be non-empty string");
  }
  if (!normalized.reply_b_ja.trim()) {
    errors.push("reply_b_ja must be non-empty string");
  }
  return errors;
}

export async function runReplyGeneration(context: Record<string, unknown>) {
  const apiKey = process.env.EKAN8_API_KEY || process.env.AI_API_KEY;
  const baseUrl = process.env.EKAN8_BASE_URL || process.env.AI_BASE_URL;
  const backupBaseUrl = process.env.EKAN8_BACKUP_BASE_URL || process.env.AI_BACKUP_BASE_URL;
  const model = process.env.MAIN_MODEL || process.env.AI_MAIN_MODEL;

  if (!apiKey || !baseUrl || !model) {
    throw new Error("generation service missing env");
  }

  // Fail fast for obvious endpoint configuration mistakes (for example docs URLs).
  buildChatCompletionsUrl({ baseOrEndpoint: baseUrl, preferEnvEndpoint: true });
  if (backupBaseUrl) {
    buildChatCompletionsUrl({ baseOrEndpoint: backupBaseUrl, preferEnvEndpoint: false });
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
    schemaName: "main_brain_reply_generation_result",
    schema: GENERATION_JSON_SCHEMA as unknown as Record<string, unknown>,
    validateParsed: validateGenerationContract,
  });

  return {
    ...response,
    model,
    promptVersion: replyGenerationPrompt.version,
    parsed: validateMainBrainGenerationResult(normalizeGenerationReply(response.parsed)),
  };
}

