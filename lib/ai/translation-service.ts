import type { TranslationResult } from "./ai-types";
import { requestStructuredJson } from "./model-client";
import { translationPrompt } from "./prompts/translation";
import { resolveTranslationStrategy } from "./strategy";

export async function translateCustomerJapaneseMessage(input: {
  japaneseText: string;
  previousJapanese?: string;
  previousChinese?: string;
}) {
  const apiKey = process.env.EKAN8_API_KEY;
  const baseUrl = process.env.EKAN8_BASE_URL;
  const backupBaseUrl = process.env.EKAN8_BACKUP_BASE_URL;
  const model = process.env.HELPER_MODEL;

  if (!apiKey || !baseUrl || !model) {
    throw new Error("translation service missing env");
  }

  const strategy = resolveTranslationStrategy();

  const user = JSON.stringify(
    {
      latest_message: { japanese_text: input.japaneseText },
      minimal_context: {
        previous_message_japanese: input.previousJapanese || "",
        previous_message_chinese: input.previousChinese || "",
      },
      translation_rules: {
        special_terms: strategy.specialTerms,
        style_notes: strategy.preserveToneNotes,
      },
    },
    null,
    2,
  );

  const result = await requestStructuredJson<TranslationResult>({
    apiKey,
    baseUrl,
    backupBaseUrl,
    model,
    system: translationPrompt.system,
    user,
    temperature: strategy.temperature,
  });

  return {
    ...result,
    model,
    promptVersion: translationPrompt.version,
  };
}
