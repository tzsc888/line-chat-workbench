import type { TranslationResult } from "./ai-types";

const DEFAULT_DEEPLX_BASE_URL = "https://deeplx.jayogo.com";
const DEFAULT_TRANSLATION_LENGTH_THRESHOLD = 300;
const DEFAULT_DEEPLX_CHAT_MODEL_SHORT = "gpt-4o";
const DEFAULT_DEEPLX_CHAT_MODEL_LONG = "gpt-4o-mini";
const DEFAULT_DEEPLX_REPLY_MODEL = "gpt-4o";
const TRANSLATION_PROMPT_VERSION = "deeplx.v1";

type TranslationError = Error & {
  code?: string;
  details?: Record<string, unknown>;
};

type DeepLXTranslateInput = {
  text: string;
  model: string;
  sourceLang?: string;
  targetLang?: string;
};

function toPositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value || "");
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function buildTranslationError(code: string, message: string, details?: Record<string, unknown>) {
  const error = new Error(message) as TranslationError;
  error.code = code;
  if (details) {
    error.details = details;
  }
  return error;
}

function getDeepLXConfig() {
  const apiKey = String(process.env.DEEPLX_API_KEY || process.env.EKAN8_API_KEY || "").trim();
  const baseUrl = String(process.env.DEEPLX_BASE_URL || DEFAULT_DEEPLX_BASE_URL).trim().replace(/\/+$/, "");

  if (!apiKey) {
    throw buildTranslationError("translation_missing_env", "translation service missing DEEPLX_API_KEY");
  }

  if (!baseUrl) {
    throw buildTranslationError("translation_missing_env", "translation service missing DEEPLX_BASE_URL");
  }

  return {
    apiKey,
    baseUrl,
    shortModel: String(process.env.DEEPLX_CHAT_MODEL_SHORT || DEFAULT_DEEPLX_CHAT_MODEL_SHORT).trim(),
    longModel: String(process.env.DEEPLX_CHAT_MODEL_LONG || DEFAULT_DEEPLX_CHAT_MODEL_LONG).trim(),
    replyModel: String(process.env.DEEPLX_REPLY_MODEL || DEFAULT_DEEPLX_REPLY_MODEL).trim(),
    threshold: toPositiveInt(process.env.TRANSLATION_LENGTH_THRESHOLD, DEFAULT_TRANSLATION_LENGTH_THRESHOLD),
  };
}

function buildDeepLXEndpoint(baseUrl: string, apiKey: string, model: string) {
  const encodedApiKey = encodeURIComponent(apiKey);
  const trimmedModel = model.trim();
  if (!trimmedModel) {
    return `${baseUrl}/translate/${encodedApiKey}`;
  }
  return `${baseUrl}/translate/${encodedApiKey}/${encodeURIComponent(trimmedModel)}`;
}

function parseDeepLXData(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const root = payload as Record<string, unknown>;
  return String(root.data || "").trim();
}

async function requestDeepLXTranslation(input: DeepLXTranslateInput) {
  const config = getDeepLXConfig();
  const endpoint = buildDeepLXEndpoint(config.baseUrl, config.apiKey, input.model);
  const body = {
    text: input.text,
    source_lang: input.sourceLang || "JA",
    target_lang: input.targetLang || "ZH-HANS",
  };

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const responseText = await response.text();
  let payload: unknown = {};
  if (responseText) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = { raw: responseText };
    }
  }

  if (!response.ok) {
    throw buildTranslationError("translation_provider_error", `translation_provider_error_http_${response.status}`, {
      status: response.status,
      endpoint,
      payload,
    });
  }

  const translated = parseDeepLXData(payload);
  if (!translated) {
    throw buildTranslationError("translation_invalid_output", "translation_invalid_output", {
      endpoint,
      payload,
    });
  }

  return {
    text: translated,
    model: input.model.trim(),
  };
}

function resolveChatTranslationModel(text: string) {
  const config = getDeepLXConfig();
  const length = text.trim().length;
  return length <= config.threshold ? config.shortModel : config.longModel;
}

export async function translateCustomerJapaneseMessage(input: {
  japaneseText: string;
  previousJapanese?: string;
  previousChinese?: string;
}) {
  const japaneseText = String(input.japaneseText || "");
  const model = resolveChatTranslationModel(japaneseText);
  const translated = await requestDeepLXTranslation({
    text: japaneseText,
    model,
    sourceLang: "JA",
    targetLang: "ZH-HANS",
  });

  return {
    line: "deeplx-translate-customer",
    model: translated.model,
    promptVersion: TRANSLATION_PROMPT_VERSION,
    parsed: {
      translation: translated.text,
    } satisfies TranslationResult,
  };
}

export async function translateGeneratedReplies(input: {
  replyAJa: string;
  replyBJa: string;
}) {
  const config = getDeepLXConfig();
  const model = config.replyModel;

  const [replyA, replyB] = await Promise.all([
    requestDeepLXTranslation({
      text: String(input.replyAJa || ""),
      model,
      sourceLang: "JA",
      targetLang: "ZH-HANS",
    }),
    requestDeepLXTranslation({
      text: String(input.replyBJa || ""),
      model,
      sourceLang: "JA",
      targetLang: "ZH-HANS",
    }),
  ]);

  return {
    line: "deeplx-translate-replies",
    model,
    promptVersion: `${TRANSLATION_PROMPT_VERSION}-reply`,
    parsed: {
      reply_a_zh: replyA.text,
      reply_b_zh: replyB.text,
    },
  };
}
