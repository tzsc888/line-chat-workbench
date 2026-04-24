function readErrorMessage(input: unknown) {
  if (!input) return "";
  if (input instanceof Error) return input.message;
  if (typeof input === "string") return input;
  if (typeof input === "object" && input && "error" in input && typeof (input as { error?: unknown }).error === "string") {
    return (input as { error: string }).error;
  }
  return String(input || "");
}

function readStructuredMeta(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const value = input as {
    errorCode?: unknown;
    stage?: unknown;
    mode?: unknown;
  };
  const errorCode = typeof value.errorCode === "string" ? value.errorCode : "";
  const stage = typeof value.stage === "string" ? value.stage : "";
  const mode = typeof value.mode === "string" ? value.mode : "";
  if (!errorCode && !stage && !mode) return null;
  return { errorCode, stage, mode };
}

export function formatGenerateRepliesError(error: unknown) {
  const structuredMeta = readStructuredMeta(error);
  if (structuredMeta?.errorCode) {
    if (structuredMeta.errorCode === "generation_structured_timeout") {
      return "Generation failed: Japanese A/B generation timed out.";
    }
    if (structuredMeta.errorCode === "translation_structured_timeout") {
      return "Generation failed: Chinese meaning translation timed out.";
    }
    if (structuredMeta.errorCode === "generation_structured_failed") {
      return "Generation failed: Japanese A/B structured output failed.";
    }
    if (structuredMeta.errorCode === "translation_structured_failed") {
      return "Generation failed: Chinese meaning structured output failed.";
    }
    if (structuredMeta.errorCode === "MODEL_JSON_PARSE_ERROR") {
      return "Generation failed: model returned malformed JSON content. Please retry.";
    }
    if (structuredMeta.errorCode === "MODEL_TIMEOUT") {
      return "Generation timed out before getting valid structured output. Please retry.";
    }
    const stageText = structuredMeta.stage || "generation";
    const modeText = structuredMeta.mode ? ` (${structuredMeta.mode})` : "";
    return `Generation failed at ${stageText}${modeText}: ${structuredMeta.errorCode}.`;
  }

  const raw = readErrorMessage(error);
  const normalized = raw.replace(/^error:\s*/i, "").trim();
  if (normalized.includes("translation_missing_reply_meaning")) {
    return "Generation failed: reply meaning translation is missing. Please retry.";
  }
  if (normalized.includes("generation_missing_japanese_reply")) {
    return "Generation failed: Japanese reply content is missing. Please retry.";
  }
  if (normalized.includes("generation_empty_reply")) {
    return "Generation failed: AI returned empty suggestions. Please retry.";
  }
  return normalized || "Generation failed: unknown error.";
}
