export type ModelRequestOptions = {
  apiKey: string;
  baseUrl: string;
  backupBaseUrl?: string | null;
  model: string;
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
};

export type StructuredMode = "json_schema" | "json_object" | "fallback_extract";
export type StructuredErrorCode =
  | "MODEL_HTTP_ERROR"
  | "MODEL_TIMEOUT"
  | "MODEL_RESPONSE_SHAPE_ERROR"
  | "MODEL_JSON_PARSE_ERROR"
  | "MODEL_SCHEMA_INVALID";

export type JsonRetryErrorCode =
  | "JSON_TIMEOUT"
  | "JSON_TRANSIENT_RETRY_EXHAUSTED"
  | "JSON_PROVIDER_ERROR"
  | "JSON_INVALID_OUTPUT";

export class AiStructuredOutputError extends Error {
  code: StructuredErrorCode;
  stage: string;
  mode: StructuredMode;
  status: number | null;
  failureReason: string;
  parsePhase: string;
  elapsedMs: number | null;
  providerElapsedMs: number | null;
  timeoutMs: number | null;
  retryable: boolean | null;
  providerRole: "primary" | "backup" | "";
  attempt: number | null;
  maxAttempts: number | null;
  fetchErrorName: string;
  fetchErrorMessage: string;
  fetchCauseName: string;
  fetchCauseCode: string;
  fetchCauseMessage: string;
  snippet: string;
  upstreamBodySnippet: string;
  modelContentSnippet: string;
  details: string[];
  finalUrl: string;
  finalUrlHostAndPath: string;
  contentType: string;
  responseFormatSent: boolean | null;
  streamSent: boolean | null;
  topLevelKeys: string[];
  choicesLength: number | null;
  sseEventCount: number | null;
  assembledContentLength: number | null;

  constructor(input: {
    code: StructuredErrorCode;
    stage: string;
    mode: StructuredMode;
    status?: number | null;
    failureReason?: string;
    parsePhase?: string;
    elapsedMs?: number | null;
    providerElapsedMs?: number | null;
    timeoutMs?: number | null;
    retryable?: boolean | null;
    providerRole?: "primary" | "backup" | "";
    attempt?: number | null;
    maxAttempts?: number | null;
    fetchErrorName?: string;
    fetchErrorMessage?: string;
    fetchCauseName?: string;
    fetchCauseCode?: string;
    fetchCauseMessage?: string;
    snippet?: string;
    upstreamBodySnippet?: string;
    modelContentSnippet?: string;
    details?: string[];
    message?: string;
    finalUrl?: string;
    finalUrlHostAndPath?: string;
    contentType?: string;
    responseFormatSent?: boolean | null;
    streamSent?: boolean | null;
    topLevelKeys?: string[];
    choicesLength?: number | null;
    sseEventCount?: number | null;
    assembledContentLength?: number | null;
  }) {
    super(
      input.message ||
        `structured_output_error:${input.code}:${input.stage}:${input.mode}`,
    );
    this.name = "AiStructuredOutputError";
    this.code = input.code;
    this.stage = input.stage;
    this.mode = input.mode;
    this.status = typeof input.status === "number" ? input.status : null;
    this.failureReason = String(input.failureReason || "").trim();
    this.parsePhase = String(input.parsePhase || "").trim();
    this.elapsedMs = typeof input.elapsedMs === "number" ? Math.max(0, input.elapsedMs) : null;
    this.providerElapsedMs =
      typeof input.providerElapsedMs === "number" ? Math.max(0, input.providerElapsedMs) : null;
    this.timeoutMs = typeof input.timeoutMs === "number" ? Math.max(0, input.timeoutMs) : null;
    this.retryable =
      typeof input.retryable === "boolean" ? input.retryable : null;
    this.providerRole = input.providerRole || "";
    this.attempt = typeof input.attempt === "number" ? Math.max(1, Math.floor(input.attempt)) : null;
    this.maxAttempts =
      typeof input.maxAttempts === "number" ? Math.max(1, Math.floor(input.maxAttempts)) : null;
    this.fetchErrorName = String(input.fetchErrorName || "").trim();
    this.fetchErrorMessage = String(input.fetchErrorMessage || "").trim();
    this.fetchCauseName = String(input.fetchCauseName || "").trim();
    this.fetchCauseCode = String(input.fetchCauseCode || "").trim();
    this.fetchCauseMessage = String(input.fetchCauseMessage || "").trim();
    this.snippet = input.snippet || "";
    this.upstreamBodySnippet = input.upstreamBodySnippet || this.snippet;
    this.modelContentSnippet = input.modelContentSnippet || "";
    this.details = input.details || [];
    this.finalUrl = input.finalUrl || "";
    this.finalUrlHostAndPath = input.finalUrlHostAndPath || "";
    this.contentType = input.contentType || "";
    this.responseFormatSent =
      typeof input.responseFormatSent === "boolean" ? input.responseFormatSent : null;
    this.streamSent = typeof input.streamSent === "boolean" ? input.streamSent : null;
    this.topLevelKeys = input.topLevelKeys || [];
    this.choicesLength = typeof input.choicesLength === "number" ? input.choicesLength : null;
    this.sseEventCount = typeof input.sseEventCount === "number" ? input.sseEventCount : null;
    this.assembledContentLength =
      typeof input.assembledContentLength === "number" ? input.assembledContentLength : null;
  }
}

export function isAiStructuredOutputError(error: unknown): error is AiStructuredOutputError {
  return error instanceof AiStructuredOutputError;
}

export class AiJsonRetryError extends Error {
  code: JsonRetryErrorCode;
  stage: string;
  status: number | null;
  elapsedMs: number;
  attempts: number;
  details: string[];

  constructor(input: {
    code: JsonRetryErrorCode;
    stage: string;
    status?: number | null;
    elapsedMs: number;
    attempts: number;
    details?: string[];
    message?: string;
  }) {
    super(input.message || `json_retry_error:${input.code}:${input.stage}`);
    this.name = "AiJsonRetryError";
    this.code = input.code;
    this.stage = input.stage;
    this.status = typeof input.status === "number" ? input.status : null;
    this.elapsedMs = Math.max(0, input.elapsedMs);
    this.attempts = Math.max(0, input.attempts);
    this.details = input.details || [];
  }
}

export function isAiJsonRetryError(error: unknown): error is AiJsonRetryError {
  return error instanceof AiJsonRetryError;
}

const unsupportedJsonSchemaBaseUrls = new Set<string>();
const structuredDebugEnabled = process.env.AI_STRUCTURED_DEBUG === "1";
const DEFAULT_STRUCTURED_TOTAL_BUDGET_MS = 60_000;
const DEFAULT_STRUCTURED_ATTEMPT_TIMEOUT_MS = 15_000;
const MIN_ATTEMPT_TIMEOUT_MS = 3_000;
const BUDGET_HEADROOM_MS = 500;
const DEFAULT_MAX_STRUCTURED_ATTEMPTS = 4;
const DEFAULT_PROVIDER_MAX_RETRIES = 1;
const DEFAULT_UPSTREAM_STREAM_CONCURRENCY = 1;
let upstreamStreamInFlight = 0;
const upstreamStreamQueue: Array<() => void> = [];

const STAGE_LIMITS = {
  generation: {
    totalBudgetMs: parsePositiveIntEnv(
      "AI_GENERATION_STRUCTURED_TOTAL_BUDGET_MS",
      240_000,
      { min: 30_000, max: 280_000 },
    ),
    attemptTimeoutMs: parsePositiveIntEnv(
      "AI_GENERATION_STRUCTURED_ATTEMPT_TIMEOUT_MS",
      120_000,
      { min: 15_000, max: 240_000 },
    ),
    maxAttempts: parsePositiveIntEnv(
      "AI_GENERATION_STRUCTURED_MAX_ATTEMPTS",
      2,
      { min: 1, max: 4 },
    ),
  },
  reply_translation: {
    totalBudgetMs: parsePositiveIntEnv(
      "AI_REPLY_TRANSLATION_STRUCTURED_TOTAL_BUDGET_MS",
      15_000,
      { min: 10_000, max: 120_000 },
    ),
    attemptTimeoutMs: parsePositiveIntEnv(
      "AI_REPLY_TRANSLATION_STRUCTURED_ATTEMPT_TIMEOUT_MS",
      12_000,
      { min: 5_000, max: 60_000 },
    ),
    maxAttempts: parsePositiveIntEnv(
      "AI_REPLY_TRANSLATION_STRUCTURED_MAX_ATTEMPTS",
      1,
      { min: 1, max: 4 },
    ),
  },
} as const;

function cleanJsonText(content: string) {
  return content.replace(/```json/gi, "").replace(/```/g, "").trim();
}

function safeSnippet(value: string, max = 240) {
  return String(value || "").replace(/\s+/g, " ").slice(0, max);
}

function isDebugAiRawResponseEnabled() {
  return process.env.DEBUG_AI_RAW_RESPONSE === "1";
}

function isDebugAiRawResponseFullEnabled() {
  return process.env.DEBUG_AI_RAW_RESPONSE_FULL === "1";
}

function debugAiRawResponse(input: {
  stage: string;
  contentType?: string;
  bodyText?: string;
  eventCount?: number;
  sseContent?: string;
  assistantContent?: string;
}) {
  if (!isDebugAiRawResponseEnabled()) return;
  const full = isDebugAiRawResponseFullEnabled();
  const clip = (value: string) => (full ? value : value.slice(0, 2000));
  const payload: Record<string, unknown> = {
    stage: input.stage,
    contentType: String(input.contentType || ""),
  };
  if (typeof input.bodyText === "string") {
    payload.bodyTextLength = input.bodyText.length;
    payload.bodyText = clip(input.bodyText);
  }
  if (typeof input.eventCount === "number") {
    payload.eventCount = input.eventCount;
  }
  if (typeof input.sseContent === "string") {
    payload.sseContentLength = input.sseContent.length;
    payload.sseContent = clip(input.sseContent);
  }
  if (typeof input.assistantContent === "string") {
    payload.assistantContentLength = input.assistantContent.length;
    payload.assistantContent = clip(input.assistantContent);
  }
  console.info("[debug-ai-raw-response]", JSON.stringify(payload));
}

function extractFirstBalancedJsonObject(text: string) {
  const content = cleanJsonText(text);
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        return content.slice(start, i + 1);
      }
    }
  }

  return "";
}

export function extractJsonObject(content: string) {
  const extracted = extractFirstBalancedJsonObject(content);
  if (!extracted) {
    throw new Error(`model did not return valid json object: ${safeSnippet(content)}`);
  }
  return extracted;
}

export function parseJsonObject<T>(content: string): T {
  return JSON.parse(extractJsonObject(content)) as T;
}

function buildSchemaResponseFormat(schemaName: string, schema: Record<string, unknown>) {
  return {
    type: "json_schema",
    json_schema: {
      name: schemaName,
      strict: true,
      schema,
    },
  } as const;
}

function sanitizeUrlLike(value: string) {
  return String(value || "").trim().replace(/\s+/g, "");
}

function trimTrailingSlashes(value: string) {
  return value.replace(/\/+$/, "");
}

function toHostAndPath(urlLike: string) {
  try {
    const url = new URL(urlLike);
    return `${url.host}${url.pathname}`;
  } catch {
    return "";
  }
}

function getProviderMaxRetries() {
  const raw = Number(process.env.AI_PROVIDER_MAX_RETRIES || "");
  const value = Number.isFinite(raw) ? Math.floor(raw) : DEFAULT_PROVIDER_MAX_RETRIES;
  return Math.max(0, Math.min(3, value));
}

function sleepWithJitter(baseMs = 1000) {
  const jitter = Math.floor(Math.random() * 700);
  return sleep(baseMs + jitter);
}

function toErrorRecord(error: unknown) {
  if (!error || typeof error !== "object") return null;
  return error as Record<string, unknown>;
}

function classifyTransportFailure(error: unknown) {
  const err = error instanceof Error ? error : null;
  if (!err) return null;
  const rec = toErrorRecord(error);
  const causeRec = toErrorRecord(rec?.cause);
  const fetchErrorName = String(err.name || "");
  const fetchErrorMessage = String(err.message || "");
  const fetchCauseName = String(causeRec?.name || "");
  const fetchCauseCode = String(causeRec?.code || causeRec?.errno || "");
  const fetchCauseMessage = String(causeRec?.message || "");
  const normalized = `${fetchErrorName} ${fetchErrorMessage} ${fetchCauseName} ${fetchCauseCode} ${fetchCauseMessage}`.toLowerCase();

  const code = fetchCauseCode.toUpperCase();
  if (fetchErrorName === "AbortError") {
    return {
      code: "MODEL_TIMEOUT" as StructuredErrorCode,
      failureReason: "provider_abort_timeout",
      retryable: true,
      fetchErrorName,
      fetchErrorMessage,
      fetchCauseName,
      fetchCauseCode,
      fetchCauseMessage,
    };
  }
  if (code === "UND_ERR_CONNECT_TIMEOUT") {
    return {
      code: "MODEL_TIMEOUT" as StructuredErrorCode,
      failureReason: "provider_connection_timeout",
      retryable: true,
      fetchErrorName,
      fetchErrorMessage,
      fetchCauseName,
      fetchCauseCode,
      fetchCauseMessage,
    };
  }
  if (code === "UND_ERR_HEADERS_TIMEOUT") {
    return {
      code: "MODEL_TIMEOUT" as StructuredErrorCode,
      failureReason: "provider_headers_timeout",
      retryable: true,
      fetchErrorName,
      fetchErrorMessage,
      fetchCauseName,
      fetchCauseCode,
      fetchCauseMessage,
    };
  }
  if (code === "ECONNRESET" || normalized.includes("socket hang up")) {
    return {
      code: "MODEL_HTTP_ERROR" as StructuredErrorCode,
      failureReason: "provider_connection_reset",
      retryable: true,
      fetchErrorName,
      fetchErrorMessage,
      fetchCauseName,
      fetchCauseCode,
      fetchCauseMessage,
    };
  }
  if (code === "ETIMEDOUT") {
    return {
      code: "MODEL_TIMEOUT" as StructuredErrorCode,
      failureReason: "provider_request_timeout",
      retryable: true,
      fetchErrorName,
      fetchErrorMessage,
      fetchCauseName,
      fetchCauseCode,
      fetchCauseMessage,
    };
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return {
      code: "MODEL_HTTP_ERROR" as StructuredErrorCode,
      failureReason: "provider_dns_error",
      retryable: true,
      fetchErrorName,
      fetchErrorMessage,
      fetchCauseName,
      fetchCauseCode,
      fetchCauseMessage,
    };
  }
  if (normalized.includes("fetch failed")) {
    return {
      code: "MODEL_HTTP_ERROR" as StructuredErrorCode,
      failureReason: "provider_fetch_failed",
      retryable: true,
      fetchErrorName,
      fetchErrorMessage,
      fetchCauseName,
      fetchCauseCode,
      fetchCauseMessage,
    };
  }
  if (normalized.includes("abort")) {
    return {
      code: "MODEL_TIMEOUT" as StructuredErrorCode,
      failureReason: "provider_request_timeout",
      retryable: true,
      fetchErrorName,
      fetchErrorMessage,
      fetchCauseName,
      fetchCauseCode,
      fetchCauseMessage,
    };
  }
  if (normalized.includes("network")) {
    return {
      code: "MODEL_HTTP_ERROR" as StructuredErrorCode,
      failureReason: "provider_network_error",
      retryable: true,
      fetchErrorName,
      fetchErrorMessage,
      fetchCauseName,
      fetchCauseCode,
      fetchCauseMessage,
    };
  }
  return null;
}

function normalizePath(pathname: string) {
  const cleaned = pathname.replace(/\/+/g, "/");
  if (!cleaned.startsWith("/")) return `/${cleaned}`;
  return cleaned;
}

function looksLikeDocsUrl(url: URL) {
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  if (host.startsWith("docs.")) return true;
  if (host.includes("docs.newapi.pro")) return true;
  if (path.includes("/docs")) return true;
  return false;
}

export function buildChatCompletionsUrl(input: { baseOrEndpoint: string; preferEnvEndpoint?: boolean }) {
  const explicitEndpoint = sanitizeUrlLike(
    process.env.AI_CHAT_COMPLETIONS_URL || process.env.EKAN8_CHAT_COMPLETIONS_URL || "",
  );
  const raw = sanitizeUrlLike(
    input.preferEnvEndpoint !== false && explicitEndpoint ? explicitEndpoint : input.baseOrEndpoint,
  );
  if (!raw) {
    throw new Error("missing ai provider base URL");
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`invalid ai provider URL: ${raw}`);
  }

  if (looksLikeDocsUrl(parsed)) {
    throw new Error("AI provider base URL looks like documentation site, not API endpoint.");
  }

  const fullPath = `${parsed.pathname}${parsed.search}${parsed.hash}`.toLowerCase();
  if (fullPath.endsWith("/v1/chat/completions") || fullPath.endsWith("/chat/completions")) {
    return trimTrailingSlashes(raw);
  }

  const pathname = normalizePath(parsed.pathname);
  if (pathname.endsWith("/v1")) {
    parsed.pathname = `${pathname}/chat/completions`;
    parsed.search = "";
    parsed.hash = "";
    return trimTrailingSlashes(parsed.toString());
  }

  if (pathname.endsWith("/chat/completions")) {
    parsed.search = "";
    parsed.hash = "";
    return trimTrailingSlashes(parsed.toString());
  }

  parsed.pathname = `${pathname}/v1/chat/completions`.replace(/\/v1\/v1\//g, "/v1/");
  parsed.search = "";
  parsed.hash = "";
  return trimTrailingSlashes(parsed.toString());
}

function shouldSendResponseFormat() {
  return process.env.AI_USE_RESPONSE_FORMAT === "1";
}

function isUpstreamStreamEnabled() {
  return process.env.AI_UPSTREAM_STREAM === "1";
}

function resolveUpstreamStreamConcurrency() {
  const raw = Number(process.env.AI_UPSTREAM_CONCURRENCY || "");
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_UPSTREAM_STREAM_CONCURRENCY;
  return Math.max(1, Math.floor(raw));
}

function buildAbortError() {
  const error = new Error("upstream_request_aborted_while_waiting_queue");
  error.name = "AbortError";
  return error;
}

async function withUpstreamStreamConcurrencyLimit<T>(action: () => Promise<T>, signal?: AbortSignal) {
  if (!isUpstreamStreamEnabled()) return action();
  const limit = resolveUpstreamStreamConcurrency();
  if (limit <= 1 && signal?.aborted) throw buildAbortError();

  const acquire = async () => {
    if (upstreamStreamInFlight < limit) {
      upstreamStreamInFlight += 1;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(buildAbortError());
        return;
      }
      const waiter = () => {
        signal?.removeEventListener("abort", onAbort);
        upstreamStreamInFlight += 1;
        resolve();
      };
      const onAbort = () => {
        const idx = upstreamStreamQueue.indexOf(waiter);
        if (idx >= 0) upstreamStreamQueue.splice(idx, 1);
        reject(buildAbortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      upstreamStreamQueue.push(waiter);
    });
  };

  const release = () => {
    upstreamStreamInFlight = Math.max(0, upstreamStreamInFlight - 1);
    const next = upstreamStreamQueue.shift();
    if (next) next();
  };

  await acquire();
  try {
    return await action();
  } finally {
    release();
  }
}

function resolveMaxTokens(options: ModelRequestOptions) {
  if (typeof options.maxTokens === "number" && options.maxTokens > 0) return Math.floor(options.maxTokens);
  return parsePositiveIntEnv("AI_MAX_TOKENS", 500, { min: 32, max: 8192 });
}

async function postChatCompletions(
  url: string,
  options: ModelRequestOptions,
  mode: StructuredMode,
  extraUserInstruction = "",
  schemaInput?: { name: string; schema: Record<string, unknown> },
  signal?: AbortSignal,
  requestMeta?: {
    providerRole?: "primary" | "backup";
    attempt?: number;
    maxAttempts?: number;
    timeoutMs?: number;
  },
) {
  const finalUrl = buildChatCompletionsUrl({ baseOrEndpoint: url, preferEnvEndpoint: true });
  const userContent = extraUserInstruction
    ? `${options.user}\n\n${extraUserInstruction}`
    : options.user;

  const streamSent = isUpstreamStreamEnabled();
  const responseFormatSent = shouldSendResponseFormat();
  const body: Record<string, unknown> = {
    model: options.model,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: userContent },
    ],
    temperature: options.temperature ?? 0.2,
    max_tokens: resolveMaxTokens(options),
    stream: streamSent,
  };

  if (responseFormatSent) {
    if (mode === "json_schema" && schemaInput) {
      body.response_format = buildSchemaResponseFormat(schemaInput.name, schemaInput.schema);
    } else if (mode === "json_object") {
      body.response_format = { type: "json_object" };
    }
  }

  if (structuredDebugEnabled) {
    console.info("[ai-provider-request]", {
      stage_mode: mode,
      finalUrl,
      responseFormatSent,
      streamSent,
      maxTokens: body.max_tokens,
    });
  }

  const sizeMetrics = buildRequestSizeMetrics(options, userContent);
  const providerRole = requestMeta?.providerRole || "primary";
  const attempt = requestMeta?.attempt ?? 1;
  const maxAttempts = requestMeta?.maxAttempts ?? 1;
  console.info(
    `[ai-request-size] customerId=${sizeMetrics.customerId || ""} model=${sizeMetrics.model} messagesCount=${sizeMetrics.messagesCount} systemPromptChars=${sizeMetrics.systemPromptChars} userPromptChars=${sizeMetrics.userPromptChars} totalPromptChars=${sizeMetrics.totalPromptChars} currentCustomerTurnMessageCount=${sizeMetrics.currentCustomerTurnMessageCount} currentCustomerTurnChars=${sizeMetrics.currentCustomerTurnChars} timelineMessageCount=${sizeMetrics.timelineMessageCount} timelineChars=${sizeMetrics.timelineChars} maxTokens=${sizeMetrics.maxTokens} providerRole=${providerRole} attempt=${attempt}/${maxAttempts}`,
  );
  if (sizeMetrics.totalPromptChars >= 30_000) {
    console.warn(
      `[ai-request-size-warning] customerId=${sizeMetrics.customerId || ""} totalPromptChars=${sizeMetrics.totalPromptChars} providerRole=${providerRole} attempt=${attempt}/${maxAttempts}`,
    );
  }

  return withUpstreamStreamConcurrencyLimit(
    () =>
      fetch(finalUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(body),
        signal,
      }),
    signal,
  );
}

function logProviderAdapter(input: {
  stage: string;
  mode: StructuredMode;
  finalUrl: string;
  providerRole: "primary" | "backup";
  attempt: number;
  maxAttempts: number;
  responseFormatSent: boolean;
  streamSent: boolean;
  timeoutMs: number;
}) {
  console.info(
    `[ai-provider-adapter] version=provider-diagnostics-v2 stage=${input.stage} mode=${input.mode} providerRole=${input.providerRole} attempt=${input.attempt}/${input.maxAttempts} finalUrlHostAndPath=${toHostAndPath(input.finalUrl)} responseFormatSent=${input.responseFormatSent} streamSent=${input.streamSent} timeoutMs=${input.timeoutMs}`,
  );
}

function buildRequestSizeMetrics(options: ModelRequestOptions, userContent: string) {
  let parsed: Record<string, unknown> | null = null;
  try {
    const maybeParsed = JSON.parse(userContent);
    if (maybeParsed && typeof maybeParsed === "object") {
      parsed = maybeParsed as Record<string, unknown>;
    }
  } catch {
    parsed = null;
  }

  const currentTurn = parsed?.current_customer_turn as Record<string, unknown> | undefined;
  const timeline = parsed?.timeline as Record<string, unknown> | undefined;
  const customer = parsed?.customer as Record<string, unknown> | undefined;
  const timelineMessages = Array.isArray(timeline?.messages) ? (timeline?.messages as Array<Record<string, unknown>>) : [];
  const timelineChars = timelineMessages.reduce((acc, item) => {
    return acc + String(item?.japanese_text || "").length;
  }, 0);
  const currentTurnChars = String(currentTurn?.joined_text || "").length;
  const totalPromptChars = options.system.length + userContent.length;
  const metrics = {
    customerId: String(customer?.customer_id || customer?.id || ""),
    model: options.model,
    messagesCount: 2,
    systemPromptChars: options.system.length,
    userPromptChars: userContent.length,
    totalPromptChars,
    currentCustomerTurnMessageCount: Number(currentTurn?.message_count || 0),
    currentCustomerTurnChars: currentTurnChars,
    timelineMessageCount: Number(timeline?.message_window_size || timelineMessages.length || 0),
    timelineChars,
    maxTokens: resolveMaxTokens(options),
  };
  return metrics;
}

function parsePositiveIntEnv(name: string, fallback: number, input?: { min?: number; max?: number }) {
  const raw = Number(process.env[name] || "");
  const value = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
  const min = input?.min ?? 1;
  const max = input?.max ?? Number.MAX_SAFE_INTEGER;
  return Math.min(max, Math.max(min, value));
}

function getStageLimit(stage: string) {
  if (stage === "generation") return STAGE_LIMITS.generation;
  if (stage === "reply_translation") return STAGE_LIMITS.reply_translation;
  return null;
}

function buildAttemptTimeoutMs(startedAt: number, budgetMs: number, stage: string) {
  const elapsed = Date.now() - startedAt;
  const remaining = Math.max(0, budgetMs - elapsed);
  const stageLimit = getStageLimit(stage);
  const perAttemptDefault = stageLimit
    ? stageLimit.attemptTimeoutMs
    : parsePositiveIntEnv(
        "AI_STRUCTURED_ATTEMPT_TIMEOUT_MS",
        DEFAULT_STRUCTURED_ATTEMPT_TIMEOUT_MS,
        { min: MIN_ATTEMPT_TIMEOUT_MS, max: 30_000 },
      );
  return Math.max(
    MIN_ATTEMPT_TIMEOUT_MS,
    Math.min(perAttemptDefault, Math.max(MIN_ATTEMPT_TIMEOUT_MS, remaining - BUDGET_HEADROOM_MS)),
  );
}

function buildStructuredBudgetMs(stage: string) {
  const stageLimit = getStageLimit(stage);
  if (stageLimit) return stageLimit.totalBudgetMs;
  return parsePositiveIntEnv(
    "AI_STRUCTURED_TOTAL_BUDGET_MS",
    DEFAULT_STRUCTURED_TOTAL_BUDGET_MS,
    { min: 10_000, max: 120_000 },
  );
}

function buildMaxStructuredAttempts(stage: string) {
  const stageLimit = getStageLimit(stage);
  if (stageLimit) return stageLimit.maxAttempts;
  return parsePositiveIntEnv(
    "AI_STRUCTURED_MAX_ATTEMPTS",
    DEFAULT_MAX_STRUCTURED_ATTEMPTS,
    { min: 1, max: 8 },
  );
}

function withAttemptTimeout<T>(input: {
  stage: string;
  mode: StructuredMode;
  timeoutMs: number;
  providerRole?: "primary" | "backup";
  attempt?: number;
  maxAttempts?: number;
  finalUrl?: string;
  action: (signal: AbortSignal) => Promise<T>;
}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  return input
    .action(controller.signal)
    .catch((error) => {
      if (error instanceof Error && error.name === "AbortError") {
        const elapsed = Math.max(0, Date.now() - startedAt);
        throw new AiStructuredOutputError({
          code: "MODEL_TIMEOUT",
          stage: input.stage,
          mode: input.mode,
          details: [`attempt-timeout-ms:${input.timeoutMs}`],
          message: "structured_attempt_timeout",
          failureReason: "provider_request_timeout",
          parsePhase: "provider_request",
          elapsedMs: elapsed,
          providerElapsedMs: elapsed,
          timeoutMs: input.timeoutMs,
          retryable: true,
          providerRole: input.providerRole || "",
          attempt: input.attempt ?? null,
          maxAttempts: input.maxAttempts ?? null,
          finalUrl: input.finalUrl || "",
          finalUrlHostAndPath: toHostAndPath(input.finalUrl || ""),
          fetchErrorName: error.name,
          fetchErrorMessage: String(error.message || ""),
        });
      }
      throw error;
    })
    .finally(() => {
      clearTimeout(timer);
    });
}

function buildRetryInstruction(input: {
  parseError?: string;
  schemaErrors?: string[];
}) {
  const parsePart = input.parseError ? `Parse error: ${input.parseError}` : "";
  const schemaPart = input.schemaErrors?.length
    ? `Schema errors: ${input.schemaErrors.join(" | ")}`
    : "";
  const detail = [parsePart, schemaPart].filter(Boolean).join("; ");
  return [
    "Your previous output was not accepted as strict JSON.",
    detail,
    "Re-output ONLY one valid JSON object and nothing else.",
    "Do not include markdown fences or explanation text.",
  ]
    .join(" ")
    .trim();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function isTransientHttpStatus(status: number | null) {
  if (typeof status !== "number") return false;
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function logStructuredFailure(input: {
  error: AiStructuredOutputError;
}) {
  if (!structuredDebugEnabled) return;
  console.error("[ai-structured-output-failure]", {
    stage: input.error.stage,
    mode: input.error.mode,
    status: input.error.status,
    failureReason: input.error.failureReason || "",
    parsePhase: input.error.parsePhase || "",
    elapsedMs: input.error.elapsedMs,
    providerElapsedMs: input.error.providerElapsedMs,
    timeoutMs: input.error.timeoutMs,
    retryable: input.error.retryable,
    providerRole: input.error.providerRole,
    attempt: input.error.attempt,
    maxAttempts: input.error.maxAttempts,
    fetchErrorName: input.error.fetchErrorName,
    fetchErrorMessage: input.error.fetchErrorMessage,
    fetchCauseName: input.error.fetchCauseName,
    fetchCauseCode: input.error.fetchCauseCode,
    fetchCauseMessage: input.error.fetchCauseMessage,
    finalUrlHostAndPath: input.error.finalUrlHostAndPath || toHostAndPath(input.error.finalUrl || ""),
    finalUrl: input.error.finalUrl || "",
    contentType: input.error.contentType || "",
    responseFormatSent: input.error.responseFormatSent,
    streamSent: input.error.streamSent,
    topLevelKeys: input.error.topLevelKeys,
    choicesLength: input.error.choicesLength,
    sseEventCount: input.error.sseEventCount,
    assembledContentLength: input.error.assembledContentLength,
    upstreamBodySnippet: safeSnippet(input.error.upstreamBodySnippet || input.error.snippet || "", 800),
    modelContentSnippet: safeSnippet(input.error.modelContentSnippet || "", 800),
    reason: input.error.code,
    details: input.error.details || [],
  });
}

function toContentString(value: unknown) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const objectValue = value as Record<string, unknown>;
    if (typeof objectValue.text === "string") return objectValue.text;
    if (typeof objectValue.content === "string") return objectValue.content;
    const serialized = JSON.stringify(objectValue);
    return serialized === "{}" ? "" : serialized;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const node = item as Record<string, unknown>;
          if (typeof node.text === "string") return node.text;
          if (node.type === "text" && typeof node.text === "string") return node.text;
          if (typeof node.content === "string") return node.content;
          return "";
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  return "";
}

function looksLikeHtml(contentType: string, bodyText: string) {
  if (/text\/html/i.test(contentType)) return true;
  const trimmed = bodyText.trim().toLowerCase();
  return trimmed.startsWith("<!doctype html") || trimmed.startsWith("<html");
}

function looksLikeSse(contentType: string, bodyText: string) {
  if (/text\/event-stream/i.test(contentType)) return true;
  return bodyText.trimStart().startsWith("data:");
}

function looksLikeJson(contentType: string, bodyText: string) {
  if (/application\/json/i.test(contentType)) return true;
  const trimmed = bodyText.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function parseSseTextToContent(bodyText: string) {
  const lines = bodyText.split(/\r?\n/);
  let eventCount = 0;
  const chunks: string[] = [];
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line.startsWith("data:")) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    eventCount += 1;
    try {
      const parsed = JSON.parse(payload);
      const choice = parsed?.choices?.[0];
      const delta = toContentString(choice?.delta?.content);
      const message = toContentString(choice?.message?.content);
      const outputText = toContentString(parsed?.output_text);
      const content = toContentString(parsed?.content);
      const choiceText = toContentString(choice?.text);
      const text = delta || message || outputText || content || choiceText;
      if (text) chunks.push(text);
    } catch {
      continue;
    }
  }
  return {
    eventCount,
    content: chunks.join("").trim(),
  };
}

function readSseMeta(data: unknown) {
  const meta =
    data && typeof data === "object"
      ? ((data as Record<string, unknown>)._sse_meta as Record<string, unknown> | undefined)
      : undefined;
  return {
    eventCount: typeof meta?.eventCount === "number" ? meta.eventCount : null,
    assembledContentLength:
      typeof meta?.assembledContentLength === "number" ? meta.assembledContentLength : null,
  };
}

function parseJsonSafe(text: string) {
  try {
    return { ok: true as const, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false as const, error };
  }
}

async function parseUpstreamPayload(
  response: Response,
  stage: string,
  mode: StructuredMode,
  input?: {
    requestStartedAt?: number;
    timeoutMs?: number;
    providerRole?: "primary" | "backup";
    attempt?: number;
    maxAttempts?: number;
  },
) {
  const finalUrl = response.url || "";
  const finalUrlHostAndPath = toHostAndPath(finalUrl);
  const contentType = String(response.headers.get("content-type") || "");
  const text = await response.text();
  debugAiRawResponse({
    stage: "after-response-text",
    contentType,
    bodyText: text,
  });
  const providerElapsedMs =
    typeof input?.requestStartedAt === "number"
      ? Math.max(0, Date.now() - input.requestStartedAt)
      : null;
  const responseFormatSent = shouldSendResponseFormat();
  const streamSent = isUpstreamStreamEnabled();

  if (!response.ok) {
    const parsedError = parseJsonSafe(text);
    const errDetails: string[] = [];
    if (parsedError.ok) {
      const message = String(
        parsedError.value?.error?.message ||
          parsedError.value?.message ||
          "",
      ).trim();
      if (message) errDetails.push(`upstream-error-message:${safeSnippet(message, 240)}`);
    }
    throw new AiStructuredOutputError({
      code: "MODEL_HTTP_ERROR",
      stage,
      mode,
      status: response.status,
      snippet: text,
      details: errDetails,
      message: `upstream_http_error:${response.status}`,
      failureReason: "upstream_http_error",
      parsePhase: "http_status",
      providerElapsedMs,
      timeoutMs: input?.timeoutMs ?? null,
      retryable: response.status === 429 || response.status === 502 || response.status === 503 || response.status === 504,
      providerRole: input?.providerRole || "",
      attempt: input?.attempt ?? null,
      maxAttempts: input?.maxAttempts ?? null,
      finalUrl,
      finalUrlHostAndPath,
      contentType,
      responseFormatSent,
      streamSent,
      upstreamBodySnippet: text,
    });
  }

  if (looksLikeHtml(contentType, text)) {
    throw new AiStructuredOutputError({
      code: "MODEL_RESPONSE_SHAPE_ERROR",
      stage,
      mode,
      status: response.status,
      snippet: text,
      message: "upstream_returned_html",
      failureReason: "upstream_returned_html",
      parsePhase: "http_body",
      providerElapsedMs,
      timeoutMs: input?.timeoutMs ?? null,
      retryable: false,
      providerRole: input?.providerRole || "",
      attempt: input?.attempt ?? null,
      maxAttempts: input?.maxAttempts ?? null,
      finalUrl,
      finalUrlHostAndPath,
      contentType,
      responseFormatSent,
      streamSent,
      upstreamBodySnippet: text,
    });
  }

  if (looksLikeSse(contentType, text)) {
    const sse = parseSseTextToContent(text);
    debugAiRawResponse({
      stage: "after-sse-parse",
      contentType,
      eventCount: sse.eventCount,
      sseContent: sse.content,
    });
    if (!sse.content) {
      throw new AiStructuredOutputError({
        code: "MODEL_RESPONSE_SHAPE_ERROR",
        stage,
        mode,
        status: response.status,
        snippet: text,
        message: "upstream_sse_without_content",
        failureReason: "upstream_sse_empty",
        parsePhase: "sse_parse",
        providerElapsedMs,
        timeoutMs: input?.timeoutMs ?? null,
        retryable: false,
        providerRole: input?.providerRole || "",
        attempt: input?.attempt ?? null,
        maxAttempts: input?.maxAttempts ?? null,
        finalUrl,
        finalUrlHostAndPath,
        contentType,
        responseFormatSent,
        streamSent,
        sseEventCount: sse.eventCount,
        assembledContentLength: 0,
        upstreamBodySnippet: text,
      });
    }
    return {
      choices: [
        {
          message: {
            content: sse.content,
          },
        },
      ],
      _sse_meta: {
        eventCount: sse.eventCount,
        assembledContentLength: sse.content.length,
      },
    };
  }

  if (!looksLikeJson(contentType, text)) {
    throw new AiStructuredOutputError({
      code: "MODEL_RESPONSE_SHAPE_ERROR",
      stage,
      mode,
      status: response.status,
      snippet: text,
      message: "upstream_non_json_response",
      failureReason: "upstream_non_json",
      parsePhase: "http_body",
      providerElapsedMs,
      timeoutMs: input?.timeoutMs ?? null,
      retryable: false,
      providerRole: input?.providerRole || "",
      attempt: input?.attempt ?? null,
      maxAttempts: input?.maxAttempts ?? null,
      finalUrl,
      finalUrlHostAndPath,
      contentType,
      responseFormatSent,
      streamSent,
      upstreamBodySnippet: text,
    });
  }

  const parsed = parseJsonSafe(text);
  if (!parsed.ok) {
    throw new AiStructuredOutputError({
      code: "MODEL_JSON_PARSE_ERROR",
      stage,
      mode,
      status: response.status,
      snippet: text,
      details: [String(parsed.error)],
      message: "upstream_json_parse_failed",
      failureReason: "upstream_json_parse_error",
      parsePhase: "json_parse",
      providerElapsedMs,
      timeoutMs: input?.timeoutMs ?? null,
      retryable: false,
      providerRole: input?.providerRole || "",
      attempt: input?.attempt ?? null,
      maxAttempts: input?.maxAttempts ?? null,
      finalUrl,
      finalUrlHostAndPath,
      contentType,
      responseFormatSent,
      streamSent,
      upstreamBodySnippet: text,
    });
  }

  const root =
    parsed.value && typeof parsed.value === "object"
      ? (parsed.value as Record<string, unknown>)
      : {};
  const topLevelKeys = Object.keys(root).slice(0, 30);
  const choicesLength = Array.isArray(root.choices) ? root.choices.length : null;

  if (structuredDebugEnabled) {
    console.info("[ai-provider-response]", {
      stage,
      mode,
      finalUrl,
      status: response.status,
      contentType,
      responseFormatSent,
      streamSent,
      topLevelKeys,
      choicesLength,
      bodySnippet: safeSnippet(text, 800),
    });
  }

  return parsed.value;
}

function parseWithMode<T>(
  content: string,
  mode: StructuredMode,
  stage: string,
  meta?: {
    finalUrl?: string;
    contentType?: string;
    responseFormatSent?: boolean;
    streamSent?: boolean;
    sseEventCount?: number | null;
    assembledContentLength?: number | null;
    providerElapsedMs?: number | null;
    timeoutMs?: number | null;
  },
) {
  const normalized = cleanJsonText(content);
  try {
    return JSON.parse(normalized) as T;
  } catch (primaryError) {
    if (mode === "fallback_extract" || mode === "json_object") {
      const extracted = extractFirstBalancedJsonObject(content);
      if (extracted) {
        try {
          return JSON.parse(extracted) as T;
        } catch (fallbackError) {
          debugAiRawResponse({
            stage: "before-assistant-content-json-extract-failed",
            contentType: meta?.contentType,
            assistantContent: content,
          });
          throw new AiStructuredOutputError({
            code: "MODEL_JSON_PARSE_ERROR",
            stage,
            mode,
            snippet: content,
            details: [String(primaryError), String(fallbackError)],
            message: "json_parse_error_after_fallback_extract",
            failureReason: "assistant_content_json_extract_failed",
            parsePhase: "assistant_content_parse",
            providerElapsedMs: meta?.providerElapsedMs ?? null,
            timeoutMs: meta?.timeoutMs ?? null,
            finalUrl: meta?.finalUrl,
            finalUrlHostAndPath: toHostAndPath(meta?.finalUrl || ""),
            contentType: meta?.contentType,
            responseFormatSent: meta?.responseFormatSent,
            streamSent: meta?.streamSent,
            sseEventCount: meta?.sseEventCount ?? null,
            assembledContentLength: meta?.assembledContentLength ?? null,
            modelContentSnippet: content,
          });
        }
      }
    }
    throw new AiStructuredOutputError({
      code: "MODEL_JSON_PARSE_ERROR",
      stage,
      mode,
      snippet: content,
      details: [String(primaryError)],
      message: "json_parse_error",
      failureReason: "assistant_content_not_json",
      parsePhase: "assistant_content_parse",
      providerElapsedMs: meta?.providerElapsedMs ?? null,
      timeoutMs: meta?.timeoutMs ?? null,
      finalUrl: meta?.finalUrl,
      finalUrlHostAndPath: toHostAndPath(meta?.finalUrl || ""),
      contentType: meta?.contentType,
      responseFormatSent: meta?.responseFormatSent,
      streamSent: meta?.streamSent,
      sseEventCount: meta?.sseEventCount ?? null,
      assembledContentLength: meta?.assembledContentLength ?? null,
      modelContentSnippet: content,
    });
  }
}

function getMessageContent(data: any) {
  const choice = data?.choices?.[0];
  const messageContent = toContentString(choice?.message?.content);
  if (messageContent) return messageContent;

  const choiceText = toContentString(choice?.text);
  if (choiceText) return choiceText;

  const outputText = toContentString(data?.output_text);
  if (outputText) return outputText;

  const outputNodeText = toContentString(data?.output?.[0]?.content?.[0]?.text);
  if (outputNodeText) return outputNodeText;

  const topContent = toContentString(data?.content);
  if (topContent) return topContent;

  const directReplyA =
    typeof data?.reply_ja === "string" ||
    typeof data?.reply_a_ja === "string" ||
    typeof data?.replyAJa === "string" ||
    typeof data?.reply_a === "string";
  const directReplyB =
    typeof data?.reply_b_ja === "string" ||
    typeof data?.replyBJa === "string" ||
    typeof data?.reply_b === "string";
  if (directReplyA && (directReplyB || typeof data?.reply_ja === "string")) {
    return JSON.stringify(data);
  }

  return "";
}

function isUnsupportedStructuredStatus(status: number) {
  return [400, 404, 415, 422].includes(status);
}

async function requestOnce(url: string, options: ModelRequestOptions) {
  let response = await postChatCompletions(url, options, "json_object");
  let text = await response.text();

  if (!response.ok && [400, 404, 415, 422].includes(response.status)) {
    const retry = await postChatCompletions(url, options, "fallback_extract");
    const retryText = await retry.text();
    if (retry.ok) {
      return JSON.parse(retryText);
    }
    response = retry;
    text = retryText;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} - ${text}`);
  }

  return JSON.parse(text);
}

export async function requestStructuredJson<T>(options: ModelRequestOptions) {
  let line = "main";
  try {
    const data = await requestOnce(options.baseUrl, options);
    return {
      line,
      parsed: parseJsonObject<T>(getMessageContent(data)),
      raw: data,
    };
  } catch (mainError) {
    if (!options.backupBaseUrl) {
      throw mainError;
    }
    const data = await requestOnce(options.backupBaseUrl, options);
    line = "backup";
    return {
      line,
      parsed: parseJsonObject<T>(getMessageContent(data)),
      raw: data,
    };
  }
}

export async function requestStructuredJsonWithContract<T>(
  options: ModelRequestOptions & {
    stage: string;
    schemaName: string;
    schema: Record<string, unknown>;
    validateParsed: (raw: unknown) => string[];
  },
) {
  const stage = String(options.stage || "unknown");
  const baseUrls = [options.baseUrl, options.backupBaseUrl || ""].filter(Boolean);
  const startedAt = Date.now();
  const budgetMs = buildStructuredBudgetMs(stage);
  const maxAttempts = Math.max(
    buildMaxStructuredAttempts(stage),
    baseUrls.length * (1 + getProviderMaxRetries()),
  );
  let attempts = 0;
  let stopAfterCurrentBaseUrl = false;

  let lastError: unknown = null;
  for (const baseUrl of baseUrls) {
    if (stopAfterCurrentBaseUrl) break;
    const modes: StructuredMode[] =
      stage === "generation" || stage === "reply_translation"
        ? ["json_object"]
        : unsupportedJsonSchemaBaseUrls.has(baseUrl)
          ? ["json_object"]
          : ["json_schema", "json_object"];

    for (const mode of modes) {
      const elapsed = Date.now() - startedAt;
      if (elapsed >= budgetMs) {
        lastError = new AiStructuredOutputError({
          code: "MODEL_TIMEOUT",
          stage,
          mode,
          details: [`elapsed-ms:${elapsed}`, `budget-ms:${budgetMs}`],
          message: "structured_total_budget_exceeded",
          failureReason: "request_timeout",
          parsePhase: "provider_request",
          elapsedMs: elapsed,
          timeoutMs: budgetMs,
        });
        break;
      }
      if (attempts >= maxAttempts) {
        lastError = new AiStructuredOutputError({
          code: "MODEL_TIMEOUT",
          stage,
          mode,
          details: [`attempts:${attempts}`, `max-attempts:${maxAttempts}`],
          message: "structured_max_attempts_exceeded",
          failureReason: "request_timeout",
          parsePhase: "provider_request",
          elapsedMs: elapsed,
        });
        break;
      }
      const providerRole: "primary" | "backup" = baseUrl === options.baseUrl ? "primary" : "backup";
      const providerMaxAttempts = 1 + getProviderMaxRetries();
      let providerAttempt = 0;
      let providerExhausted = false;

      while (providerAttempt < providerMaxAttempts) {
        providerAttempt += 1;
        attempts += 1;
        const attemptTimeoutMs = buildAttemptTimeoutMs(startedAt, budgetMs, stage);
        const finalUrl = buildChatCompletionsUrl({ baseOrEndpoint: baseUrl, preferEnvEndpoint: true });
        logProviderAdapter({
          stage,
          mode,
          finalUrl,
          providerRole,
          attempt: providerAttempt,
          maxAttempts: providerMaxAttempts,
          responseFormatSent: shouldSendResponseFormat(),
          streamSent: isUpstreamStreamEnabled(),
          timeoutMs: attemptTimeoutMs,
        });
        const requestStartedAt = Date.now();

        try {
          const response = await withAttemptTimeout({
            stage,
            mode,
            timeoutMs: attemptTimeoutMs,
            providerRole,
            attempt: providerAttempt,
            maxAttempts: providerMaxAttempts,
            finalUrl,
            action: (signal) =>
              postChatCompletions(
                baseUrl,
                options,
                mode,
                "",
                mode === "json_schema"
                  ? { name: options.schemaName, schema: options.schema }
                  : undefined,
                signal,
                {
                  providerRole,
                  attempt: providerAttempt,
                  maxAttempts: providerMaxAttempts,
                  timeoutMs: attemptTimeoutMs,
                },
              ),
          });

          const data = await parseUpstreamPayload(response, stage, mode, {
            requestStartedAt,
            timeoutMs: attemptTimeoutMs,
            providerRole,
            attempt: providerAttempt,
            maxAttempts: providerMaxAttempts,
          });
          const content = getMessageContent(data);
          if (!content) {
            throw new AiStructuredOutputError({
              code: "MODEL_RESPONSE_SHAPE_ERROR",
              stage,
              mode,
              status: response.status,
              message: "provider_no_message_content",
              failureReason: "provider_no_message_content",
              parsePhase: "openai_shape",
              providerElapsedMs: Math.max(0, Date.now() - requestStartedAt),
              timeoutMs: attemptTimeoutMs,
              retryable: false,
              providerRole,
              attempt: providerAttempt,
              maxAttempts: providerMaxAttempts,
              finalUrl: response.url,
              finalUrlHostAndPath: toHostAndPath(response.url || ""),
              contentType: String(response.headers.get("content-type") || ""),
              responseFormatSent: shouldSendResponseFormat(),
              streamSent: isUpstreamStreamEnabled(),
              topLevelKeys:
                data && typeof data === "object"
                  ? Object.keys(data as Record<string, unknown>).slice(0, 30)
                  : [],
              choicesLength:
                data && typeof data === "object" && Array.isArray((data as Record<string, unknown>).choices)
                  ? ((data as Record<string, unknown>).choices as unknown[]).length
                  : null,
            });
          }
          const sseMeta = readSseMeta(data);
          const parsed = parseWithMode<T>(content, mode, stage, {
            finalUrl: response.url,
            contentType: String(response.headers.get("content-type") || ""),
            responseFormatSent: shouldSendResponseFormat(),
            streamSent: isUpstreamStreamEnabled(),
            sseEventCount: sseMeta.eventCount,
            assembledContentLength: sseMeta.assembledContentLength,
            providerElapsedMs: Math.max(0, Date.now() - requestStartedAt),
            timeoutMs: attemptTimeoutMs,
          });
          const schemaErrors = options.validateParsed(parsed);
          if (schemaErrors.length > 0) {
            throw new AiStructuredOutputError({
              code: "MODEL_SCHEMA_INVALID",
              stage,
              mode,
              status: response.status,
              snippet: content,
              details: schemaErrors,
              message: "schema_validation_failed",
              failureReason: "assistant_content_schema_invalid",
              parsePhase: "schema_validation",
              providerElapsedMs: Math.max(0, Date.now() - requestStartedAt),
              timeoutMs: attemptTimeoutMs,
              retryable: false,
              providerRole,
              attempt: providerAttempt,
              maxAttempts: providerMaxAttempts,
              finalUrl: response.url,
              finalUrlHostAndPath: toHostAndPath(response.url || ""),
              contentType: String(response.headers.get("content-type") || ""),
              responseFormatSent: shouldSendResponseFormat(),
              streamSent: isUpstreamStreamEnabled(),
              modelContentSnippet: content,
            });
          }
          return {
            line: baseUrl === options.baseUrl ? "main" : "backup",
            mode,
            parsed,
            raw: data,
          };
        } catch (error) {
          let structuredError: AiStructuredOutputError;
          if (isAiStructuredOutputError(error)) {
            structuredError = error;
          } else {
            const classified = classifyTransportFailure(error);
            if (classified) {
              const providerElapsedMs = Math.max(0, Date.now() - requestStartedAt);
              structuredError = new AiStructuredOutputError({
                code: classified.code,
                stage,
                mode,
                message: classified.failureReason,
                failureReason: classified.failureReason,
                parsePhase: "provider_request",
                providerElapsedMs,
                timeoutMs: attemptTimeoutMs,
                retryable: classified.retryable,
                providerRole,
                attempt: providerAttempt,
                maxAttempts: providerMaxAttempts,
                finalUrl,
                finalUrlHostAndPath: toHostAndPath(finalUrl),
                responseFormatSent: shouldSendResponseFormat(),
                streamSent: isUpstreamStreamEnabled(),
                snippet: classified.fetchErrorMessage || "fetch failed",
                upstreamBodySnippet: classified.fetchErrorMessage || "fetch failed",
                fetchErrorName: classified.fetchErrorName,
                fetchErrorMessage: classified.fetchErrorMessage,
                fetchCauseName: classified.fetchCauseName,
                fetchCauseCode: classified.fetchCauseCode,
                fetchCauseMessage: classified.fetchCauseMessage,
              });
            } else {
              structuredError = new AiStructuredOutputError({
                code: "MODEL_HTTP_ERROR",
                stage,
                mode,
                snippet: String(error instanceof Error ? error.message : error),
                details: ["non_structured_provider_error"],
                message: "provider_network_error",
                failureReason: "provider_network_error",
                parsePhase: "provider_request",
                providerElapsedMs: Math.max(0, Date.now() - requestStartedAt),
                timeoutMs: attemptTimeoutMs,
                retryable: true,
                providerRole,
                attempt: providerAttempt,
                maxAttempts: providerMaxAttempts,
                finalUrl,
                finalUrlHostAndPath: toHostAndPath(finalUrl),
                responseFormatSent: shouldSendResponseFormat(),
                streamSent: isUpstreamStreamEnabled(),
              });
            }
          }

          lastError = structuredError;
          logStructuredFailure({ error: structuredError });

          const retryableHttp =
            structuredError.code === "MODEL_HTTP_ERROR" &&
            [429, 502, 503, 504].includes(Number(structuredError.status || 0));
          const retryableTransport = structuredError.parsePhase === "provider_request" && structuredError.retryable === true;
          const willRetry = (retryableHttp || retryableTransport) && providerAttempt < providerMaxAttempts;
          const hasBackup = !!options.backupBaseUrl && providerRole === "primary";
          console.warn(
            `[ai-provider-attempt] stage=${stage} mode=${mode} providerRole=${providerRole} attempt=${providerAttempt}/${providerMaxAttempts} failureReason=${structuredError.failureReason || structuredError.code} willRetry=${willRetry} willTryBackup=${!willRetry && hasBackup}`,
          );

          if (willRetry) {
            await sleepWithJitter(800);
            continue;
          }

          if (
            structuredError.code === "MODEL_HTTP_ERROR" &&
            structuredError.status &&
            isUnsupportedStructuredStatus(structuredError.status) &&
            mode === "json_schema"
          ) {
            unsupportedJsonSchemaBaseUrls.add(baseUrl);
          }

          providerExhausted = true;
          break;
        }
      }

      if (providerExhausted) {
        continue;
      }
    }
  }

  if (isAiStructuredOutputError(lastError)) {
    throw lastError;
  }
  throw new AiStructuredOutputError({
    code: "MODEL_RESPONSE_SHAPE_ERROR",
    stage,
    mode: "fallback_extract",
    details: [safeSnippet(String(lastError || "unknown_structured_output_failure"), 320)],
    message: "unknown_structured_output_failure",
    failureReason: "upstream_json_unsupported_shape",
    parsePhase: "provider_request",
  });
}

export async function requestJsonObjectWithRetry<T>(
  options: ModelRequestOptions & {
    stage: string;
    totalBudgetMs: number;
    attemptTimeoutMs: number;
    maxAttempts: number;
    backoffBaseMs?: number;
    backoffMaxMs?: number;
  },
) {
  const stage = String(options.stage || "json");
  const baseUrls = [options.baseUrl, options.backupBaseUrl || ""].filter(Boolean);
  const startedAt = Date.now();
  const budgetMs = Math.max(3_000, Math.floor(options.totalBudgetMs));
  const maxAttempts = Math.max(1, Math.floor(options.maxAttempts));
  const perAttemptTimeout = Math.max(2_000, Math.floor(options.attemptTimeoutMs));
  const backoffBaseMs = Math.max(0, Math.floor(options.backoffBaseMs ?? 400));
  const backoffMaxMs = Math.max(backoffBaseMs, Math.floor(options.backoffMaxMs ?? 2_000));
  const attemptHeadroomMs = 250;

  let attempts = 0;
  let lastTransient: AiStructuredOutputError | null = null;

  while (attempts < maxAttempts) {
    const elapsed = Date.now() - startedAt;
    const remaining = budgetMs - elapsed;
    if (remaining <= attemptHeadroomMs) {
      throw new AiJsonRetryError({
        code: "JSON_TIMEOUT",
        stage,
        elapsedMs: elapsed,
        attempts,
        details: [`budget-ms:${budgetMs}`],
      });
    }

    attempts += 1;
    const timeoutMs = Math.max(2_000, Math.min(perAttemptTimeout, remaining - attemptHeadroomMs));

    for (const baseUrl of baseUrls) {
      try {
        const finalUrl = buildChatCompletionsUrl({ baseOrEndpoint: baseUrl, preferEnvEndpoint: true });
        logProviderAdapter({
          stage,
          mode: "json_object",
          finalUrl,
          providerRole: baseUrl === options.baseUrl ? "primary" : "backup",
          attempt: attempts,
          maxAttempts,
          responseFormatSent: shouldSendResponseFormat(),
          streamSent: isUpstreamStreamEnabled(),
          timeoutMs,
        });
        const requestStartedAt = Date.now();
        const response = await withAttemptTimeout({
          stage,
          mode: "json_object",
          timeoutMs,
          action: (signal) =>
            postChatCompletions(baseUrl, options, "json_object", "", undefined, signal, {
              providerRole: baseUrl === options.baseUrl ? "primary" : "backup",
              attempt: attempts,
              maxAttempts,
              timeoutMs,
            }),
        });
        const data = await parseUpstreamPayload(response, stage, "json_object", {
          requestStartedAt,
          timeoutMs,
          providerRole: baseUrl === options.baseUrl ? "primary" : "backup",
          attempt: attempts,
          maxAttempts,
        });
        const content = getMessageContent(data);
        if (!content) {
          throw new AiStructuredOutputError({
            code: "MODEL_RESPONSE_SHAPE_ERROR",
            stage,
            mode: "json_object",
            status: response.status,
            message: "provider_no_message_content",
            failureReason: "provider_no_message_content",
            parsePhase: "openai_shape",
            providerElapsedMs: Math.max(0, Date.now() - requestStartedAt),
            timeoutMs,
            finalUrl: response.url,
            finalUrlHostAndPath: toHostAndPath(response.url || ""),
            contentType: String(response.headers.get("content-type") || ""),
            responseFormatSent: shouldSendResponseFormat(),
            streamSent: isUpstreamStreamEnabled(),
          });
        }
        const sseMeta = readSseMeta(data);
        const parsed = parseWithMode<T>(content, "json_object", stage, {
          finalUrl: response.url,
          contentType: String(response.headers.get("content-type") || ""),
          responseFormatSent: shouldSendResponseFormat(),
          streamSent: isUpstreamStreamEnabled(),
          sseEventCount: sseMeta.eventCount,
          assembledContentLength: sseMeta.assembledContentLength,
          providerElapsedMs: Math.max(0, Date.now() - requestStartedAt),
          timeoutMs,
        });
        return {
          line: baseUrl === options.baseUrl ? "main" : "backup",
          mode: "json_object" as const,
          parsed,
          raw: data,
          attempts,
          elapsedMs: Math.max(0, Date.now() - startedAt),
        };
      } catch (error) {
        if (!isAiStructuredOutputError(error)) {
          throw new AiJsonRetryError({
            code: "JSON_PROVIDER_ERROR",
            stage,
            elapsedMs: Math.max(0, Date.now() - startedAt),
            attempts,
            details: [String(error)],
          });
        }

        const elapsedNow = Math.max(0, Date.now() - startedAt);
        const transient =
          error.code === "MODEL_TIMEOUT" ||
          (error.code === "MODEL_HTTP_ERROR" && isTransientHttpStatus(error.status));

        if (!transient) {
          const isInvalidOutput =
            error.code === "MODEL_JSON_PARSE_ERROR" || error.code === "MODEL_RESPONSE_SHAPE_ERROR";
          throw new AiJsonRetryError({
            code: isInvalidOutput ? "JSON_INVALID_OUTPUT" : "JSON_PROVIDER_ERROR",
            stage,
            status: error.status,
            elapsedMs: elapsedNow,
            attempts,
            details: [...(error.details || []), `mode:${error.mode}`, `code:${error.code}`],
          });
        }

        lastTransient = error;
      }
    }

    const elapsedAfterAttempt = Date.now() - startedAt;
    const remainingAfterAttempt = budgetMs - elapsedAfterAttempt;
    if (attempts >= maxAttempts || remainingAfterAttempt <= attemptHeadroomMs) {
      break;
    }

    const backoffMs = Math.min(backoffMaxMs, backoffBaseMs * 2 ** (attempts - 1));
    if (remainingAfterAttempt > backoffMs + attemptHeadroomMs) {
      await sleep(backoffMs);
    }
  }

  const elapsed = Math.max(0, Date.now() - startedAt);
  if (elapsed >= budgetMs) {
    throw new AiJsonRetryError({
      code: "JSON_TIMEOUT",
      stage,
      status: lastTransient?.status ?? null,
      elapsedMs: elapsed,
      attempts,
      details: [...(lastTransient?.details || []), `budget-ms:${budgetMs}`],
    });
  }

  throw new AiJsonRetryError({
    code: "JSON_TRANSIENT_RETRY_EXHAUSTED",
    stage,
    status: lastTransient?.status ?? null,
    elapsedMs: elapsed,
    attempts,
    details: [...(lastTransient?.details || []), `max-attempts:${maxAttempts}`],
  });
}
