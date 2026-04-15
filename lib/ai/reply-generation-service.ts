import type { GenerationContextPack } from "./ai-types";
import { requestStructuredJson } from "./model-client";
import { validateGenerationResult } from "./protocol-validator";
import { replyGenerationPrompt } from "./prompts/reply-generation";

export async function runReplyGeneration(context: GenerationContextPack) {
  const apiKey = process.env.EKAN8_API_KEY;
  const baseUrl = process.env.EKAN8_BASE_URL;
  const backupBaseUrl = process.env.EKAN8_BACKUP_BASE_URL;
  const model = process.env.MAIN_MODEL;

  if (!apiKey || !baseUrl || !model) {
    throw new Error("第三层环境变量缺失");
  }

  const response = await requestStructuredJson({
    apiKey,
    baseUrl,
    backupBaseUrl,
    model,
    system: replyGenerationPrompt.system,
    user: JSON.stringify(context, null, 2),
    temperature: 0.35,
  });

  return {
    ...response,
    model,
    promptVersion: replyGenerationPrompt.version,
    parsed: validateGenerationResult(response.parsed),
  };
}
