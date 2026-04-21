export type ModelRequestOptions = {
  apiKey: string;
  baseUrl: string;
  backupBaseUrl?: string | null;
  model: string;
  system: string;
  user: string;
  temperature?: number;
};

export type StructuredMode = "json_schema" | "json_object" | "fallback_extract";
export type StructuredErrorCode =
  | "MODEL_HTTP_ERROR"
  | "MODEL_TIMEOUT"
  | "MODEL_RESPONSE_SHAPE_ERROR"
  | "MODEL_JSON_PARSE_ERROR"
  | "MODEL_SCHEMA_INVALID";

export class AiStructuredOutputError extends Error {
  code: StructuredErrorCode;
  stage: string;
  mode: StructuredMode;
  status: number | null;
  snippet: string;
  details: string[];

  constructor(input: {
    code: StructuredErrorCode;
    stage: string;
    mode: StructuredMode;
    status?: number | null;
    snippet?: string;
    details?: string[];
    message?: string;
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
    this.snippet = input.snippet || "";
    this.details = input.details || [];
  }
}

export function isAiStructuredOutputError(error: unknown): error is AiStructuredOutputError {
  return error instanceof AiStructuredOutputError;
}

const unsupportedJsonSchemaBaseUrls = new Set<string>();
const structuredDebugEnabled = process.env.AI_STRUCTURED_DEBUG === "1";
const DEFAULT_STRUCTURED_TOTAL_BUDGET_MS = 60_000;
const DEFAULT_STRUCTURED_ATTEMPT_TIMEOUT_MS = 15_000;
const MIN_ATTEMPT_TIMEOUT_MS = 3_000;
const BUDGET_HEADROOM_MS = 500;
const DEFAULT_MAX_STRUCTURED_ATTEMPTS = 4;

const STAGE_LIMITS = {
  generation: {
    totalBudgetMs: 75_000,
    attemptTimeoutMs: 30_000,
    maxAttempts: 3,
  },
} as const;

function cleanJsonText(content: string) {
  return content.replace(/```json/gi, "").replace(/```/g, "").trim();
}

function safeSnippet(value: string, max = 240) {
  return String(value || "").replace(/\s+/g, " ").slice(0, max);
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

async function postChatCompletions(
  url: string,
  options: ModelRequestOptions,
  mode: StructuredMode,
  extraUserInstruction = "",
  schemaInput?: { name: string; schema: Record<string, unknown> },
  signal?: AbortSignal,
) {
  const userContent = extraUserInstruction
    ? `${options.user}\n\n${extraUserInstruction}`
    : options.user;

  const body: Record<string, unknown> = {
    model: options.model,
    messages: [
      { role: "system", content: options.system },
      { role: "user", content: userContent },
    ],
    temperature: options.temperature ?? 0.2,
  };

  if (mode === "json_schema" && schemaInput) {
    body.response_format = buildSchemaResponseFormat(schemaInput.name, schemaInput.schema);
  } else if (mode === "json_object") {
    body.response_format = { type: "json_object" };
  }

  return fetch(`${url}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${options.apiKey}`,
    },
    body: JSON.stringify(body),
    signal,
  });
}

function parsePositiveIntEnv(name: string, fallback: number, input?: { min?: number; max?: number }) {
  const raw = Number(process.env[name] || "");
  const value = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
  const min = input?.min ?? 1;
  const max = input?.max ?? Number.MAX_SAFE_INTEGER;
  return Math.min(max, Math.max(min, value));
}

function getStageLimit(stage: string) {
  return stage === "generation" ? STAGE_LIMITS.generation : null;
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
  action: (signal: AbortSignal) => Promise<T>;
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  return input
    .action(controller.signal)
    .catch((error) => {
      if (error instanceof Error && error.name === "AbortError") {
        throw new AiStructuredOutputError({
          code: "MODEL_TIMEOUT",
          stage: input.stage,
          mode: input.mode,
          details: [`attempt-timeout-ms:${input.timeoutMs}`],
          message: "structured_attempt_timeout",
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

function logStructuredFailure(input: {
  stage: string;
  mode: StructuredMode;
  status?: number | null;
  snippet?: string;
  reason: string;
  details?: string[];
}) {
  if (!structuredDebugEnabled) return;
  console.error("[ai-structured-output-failure]", {
    stage: input.stage,
    mode: input.mode,
    status: typeof input.status === "number" ? input.status : null,
    snippet: safeSnippet(input.snippet || ""),
    reason: input.reason,
    details: input.details || [],
  });
}

async function parseUpstreamPayload(response: Response, stage: string, mode: StructuredMode) {
  const text = await response.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    if (!response.ok) {
      throw new AiStructuredOutputError({
        code: "MODEL_HTTP_ERROR",
        stage,
        mode,
        status: response.status,
        snippet: text,
        message: `upstream_http_error:${response.status}`,
      });
    }
    throw new AiStructuredOutputError({
      code: "MODEL_RESPONSE_SHAPE_ERROR",
      stage,
      mode,
      status: response.status,
      snippet: text,
      message: "upstream_response_not_json",
    });
  }
  if (!response.ok) {
    throw new AiStructuredOutputError({
      code: "MODEL_HTTP_ERROR",
      stage,
      mode,
      status: response.status,
      snippet: text,
      message: `upstream_http_error:${response.status}`,
    });
  }
  return data;
}

function parseWithMode<T>(content: string, mode: StructuredMode, stage: string): T {
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
          throw new AiStructuredOutputError({
            code: "MODEL_JSON_PARSE_ERROR",
            stage,
            mode,
            snippet: content,
            details: [String(primaryError), String(fallbackError)],
            message: "json_parse_error_after_fallback_extract",
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
    });
  }
}

function getMessageContent(data: any) {
  return String(data?.choices?.[0]?.message?.content || "");
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
  const maxAttempts = buildMaxStructuredAttempts(stage);
  let attempts = 0;
  let stopAfterCurrentBaseUrl = false;

  let lastError: unknown = null;
  for (const baseUrl of baseUrls) {
    if (stopAfterCurrentBaseUrl) break;
    const modes: StructuredMode[] = unsupportedJsonSchemaBaseUrls.has(baseUrl)
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
        });
        break;
      }
      try {
        attempts += 1;
        const attemptTimeoutMs = buildAttemptTimeoutMs(startedAt, budgetMs, stage);
        const response = await withAttemptTimeout({
          stage,
          mode,
          timeoutMs: attemptTimeoutMs,
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
            ),
        });
        const data = await parseUpstreamPayload(response, stage, mode);
        const content = getMessageContent(data);
        const parsed = parseWithMode<T>(content, mode, stage);
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
          });
        }
        return {
          line: baseUrl === options.baseUrl ? "main" : "backup",
          mode,
          parsed,
          raw: data,
        };
      } catch (error) {
        lastError = error;
        if (isAiStructuredOutputError(error)) {
          logStructuredFailure({
            stage,
            mode,
            status: error.status,
            snippet: error.snippet,
            reason: error.code,
            details: error.details,
          });
          if (error.code === "MODEL_TIMEOUT") {
            if (mode === "json_schema") {
              // Schema mode timeout should degrade to json_object instead of failing the whole request.
              unsupportedJsonSchemaBaseUrls.add(baseUrl);
              continue;
            }
            stopAfterCurrentBaseUrl = true;
            break;
          }
          if (
            error.code === "MODEL_HTTP_ERROR" &&
            error.status &&
            isUnsupportedStructuredStatus(error.status) &&
            mode !== "fallback_extract"
          ) {
            if (mode === "json_schema") {
              unsupportedJsonSchemaBaseUrls.add(baseUrl);
            }
            continue;
          }
          const shouldRetrySameMode =
            (error.code === "MODEL_JSON_PARSE_ERROR" || error.code === "MODEL_SCHEMA_INVALID") &&
            mode === "json_object";
          if (shouldRetrySameMode) {
            const retryInstruction = buildRetryInstruction({
              parseError:
                error.code === "MODEL_JSON_PARSE_ERROR"
                  ? error.details.join(" | ")
                  : undefined,
              schemaErrors:
                error.code === "MODEL_SCHEMA_INVALID" ? error.details : undefined,
            });
            try {
              const elapsedForRetry = Date.now() - startedAt;
              if (elapsedForRetry >= budgetMs || attempts >= maxAttempts) {
                throw new AiStructuredOutputError({
                  code: "MODEL_TIMEOUT",
                  stage,
                  mode,
                  details: [`elapsed-ms:${elapsedForRetry}`, `budget-ms:${budgetMs}`, `attempts:${attempts}`, `max-attempts:${maxAttempts}`],
                  message: "structured_retry_budget_exceeded",
                });
              }
              attempts += 1;
              const retryTimeoutMs = buildAttemptTimeoutMs(startedAt, budgetMs, stage);
              const retryResponse = await withAttemptTimeout({
                stage,
                mode,
                timeoutMs: retryTimeoutMs,
                action: (signal) =>
                  postChatCompletions(
                    baseUrl,
                    options,
                    mode,
                    retryInstruction,
                    undefined,
                    signal,
                  ),
              });
              const retryData = await parseUpstreamPayload(retryResponse, stage, mode);
              const retryContent = getMessageContent(retryData);
              const retryParsed = parseWithMode<T>(retryContent, mode, stage);
              const retrySchemaErrors = options.validateParsed(retryParsed);
              if (retrySchemaErrors.length > 0) {
                throw new AiStructuredOutputError({
                  code: "MODEL_SCHEMA_INVALID",
                  stage,
                  mode,
                  status: retryResponse.status,
                  snippet: retryContent,
                  details: retrySchemaErrors,
                  message: "schema_validation_failed_after_retry",
                });
              }
              return {
                line: baseUrl === options.baseUrl ? "main" : "backup",
                mode,
                parsed: retryParsed,
                raw: retryData,
              };
            } catch (retryError) {
              lastError = retryError;
              if (isAiStructuredOutputError(retryError)) {
                logStructuredFailure({
                  stage,
                  mode,
                  status: retryError.status,
                  snippet: retryError.snippet,
                  reason: retryError.code,
                  details: retryError.details,
                });
              }
            }
          }
        }
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
    message: "unknown_structured_output_failure",
  });
}
