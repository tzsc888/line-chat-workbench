import {
  AiStructuredOutputError,
  buildChatCompletionsUrl,
  requestStructuredJsonWithContract,
} from "../lib/ai/model-client";
import { normalizeGenerationReply } from "../lib/ai/protocol-validator";

function maskKey(value: string) {
  const key = String(value || "").trim();
  if (!key) return "(missing)";
  if (key.length <= 8) return `${key.slice(0, 2)}***`;
  return `${key.slice(0, 4)}***${key.slice(-4)}`;
}

function safeSnippet(value: unknown, max = 800) {
  return String(value || "").replace(/\s+/g, " ").slice(0, max);
}

function looksLikeDocsUrl(urlLike: string) {
  try {
    const u = new URL(urlLike);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.toLowerCase();
    return host.startsWith("docs.") || host.includes("docs.newapi.pro") || path.includes("/docs");
  } catch {
    return false;
  }
}

function toHostAndPath(urlLike: string) {
  try {
    const u = new URL(urlLike);
    return `${u.host}${u.pathname}`;
  } catch {
    return "";
  }
}

async function main() {
  const apiKey = String(process.env.EKAN8_API_KEY || process.env.AI_API_KEY || "").trim();
  const model = String(process.env.MAIN_MODEL || process.env.AI_MAIN_MODEL || "").trim();
  const baseUrl = String(process.env.EKAN8_BASE_URL || process.env.AI_BASE_URL || "").trim();
  const backupBaseUrl = String(process.env.EKAN8_BACKUP_BASE_URL || process.env.AI_BACKUP_BASE_URL || "").trim();
  const explicitEndpoint = String(
    process.env.AI_CHAT_COMPLETIONS_URL || process.env.EKAN8_CHAT_COMPLETIONS_URL || "",
  ).trim();
  const sendResponseFormat = process.env.AI_USE_RESPONSE_FORMAT === "1";
  const providerMaxRetries = Number(process.env.AI_PROVIDER_MAX_RETRIES || "1");
  const providerTimeoutMs = Number(process.env.AI_GENERATION_STRUCTURED_ATTEMPT_TIMEOUT_MS || "120000");

  let finalUrl = "";
  let buildUrlError = "";
  try {
    finalUrl = buildChatCompletionsUrl({
      baseOrEndpoint: baseUrl || explicitEndpoint,
      preferEnvEndpoint: true,
    });
  } catch (error) {
    buildUrlError = error instanceof Error ? error.message : String(error);
  }

  console.log("[check:ai] config");
  console.log({
    hasApiKey: !!apiKey,
    apiKeyMasked: maskKey(apiKey),
    model,
    baseUrl,
    backupBaseUrl,
    explicitEndpoint,
    finalUrl,
    finalUrlHostAndPath: toHostAndPath(finalUrl),
    docsLikeUrlDetected: looksLikeDocsUrl(baseUrl || explicitEndpoint || finalUrl),
    responseFormatSent: sendResponseFormat,
    streamSent: false,
    providerMaxRetries,
    providerTimeoutMs,
    buildUrlError,
  });

  if (!apiKey || !model || !finalUrl) {
    console.log("FAIL: missing required env/config (EKAN8_API_KEY / MAIN_MODEL / endpoint)");
    if (buildUrlError) {
      console.log(`FAIL detail: ${buildUrlError}`);
    }
    process.exitCode = 1;
    return;
  }

  try {
    const result = await requestStructuredJsonWithContract({
      apiKey,
      baseUrl,
      backupBaseUrl,
      model,
      stage: "generation",
      schemaName: "check_ai_provider_contract",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["reply_a_ja", "reply_b_ja"],
        properties: {
          reply_a_ja: { type: "string" },
          reply_b_ja: { type: "string" },
        },
      },
      validateParsed: (raw) => {
        const normalized = normalizeGenerationReply(raw);
        const errors: string[] = [];
        if (!normalized.reply_a_ja.trim()) errors.push("reply_a_ja is empty");
        if (!normalized.reply_b_ja.trim()) errors.push("reply_b_ja is empty");
        return errors;
      },
      system:
        "You are a strict JSON responder. Return exactly one JSON object and nothing else.",
      user: "Return exactly this JSON: {\"reply_a_ja\":\"はい\",\"reply_b_ja\":\"はい\"}",
      temperature: 0,
      maxTokens: 100,
    });

    const normalized = normalizeGenerationReply(result.parsed);
    console.log("[check:ai] result");
    console.log({
      line: result.line,
      mode: result.mode,
      replyA: normalized.reply_a_ja,
      replyB: normalized.reply_b_ja,
    });
    console.log("OK: provider returned usable OpenAI-compatible chat completion");
  } catch (error) {
    if (error instanceof AiStructuredOutputError) {
      console.log("[check:ai] failure");
      console.log({
        code: error.code,
        failureReason: error.failureReason,
        parsePhase: error.parsePhase,
        retryable: error.retryable,
        providerRole: error.providerRole,
        attempt: error.attempt,
        maxAttempts: error.maxAttempts,
        timeoutMs: error.timeoutMs,
        status: error.status,
        finalUrlHostAndPath: error.finalUrlHostAndPath,
        contentType: error.contentType,
        responseFormatSent: error.responseFormatSent,
        streamSent: error.streamSent,
        topLevelKeys: error.topLevelKeys,
        choicesLength: error.choicesLength,
        sseEventCount: error.sseEventCount,
        assembledContentLength: error.assembledContentLength,
        upstreamBodySnippet: safeSnippet(error.upstreamBodySnippet || error.snippet || ""),
        modelContentSnippet: safeSnippet(error.modelContentSnippet || ""),
        fetchErrorName: error.fetchErrorName,
        fetchErrorMessage: safeSnippet(error.fetchErrorMessage || ""),
        fetchCauseName: error.fetchCauseName,
        fetchCauseCode: error.fetchCauseCode,
        fetchCauseMessage: safeSnippet(error.fetchCauseMessage || ""),
      });
      if (error.failureReason === "upstream_returned_html") {
        console.log("FAIL: endpoint returned HTML, likely wrong base URL");
      } else if (error.status === 401 || error.status === 403) {
        console.log("FAIL: auth error");
      } else if (error.failureReason === "upstream_sse_empty") {
        console.log("FAIL: provider returned SSE");
      } else if (error.failureReason === "upstream_json_unsupported_shape") {
        console.log("FAIL: provider returned JSON but unsupported shape");
      } else if (error.failureReason === "assistant_content_not_json") {
        console.log("FAIL: model content not parseable as required JSON");
      } else {
        console.log(`FAIL: ${error.code}`);
      }
      process.exitCode = 1;
      return;
    }

    console.error("[check:ai] fatal", error);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[check:ai] fatal", error);
  process.exitCode = 1;
});
