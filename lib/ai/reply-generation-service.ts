import { buildChatCompletionsUrl, requestStructuredJsonWithContract } from "./model-client";
import { normalizeGenerationReply, validateMainBrainGenerationResult } from "./protocol-validator";
import { FINAL_PROMPT_TEMPLATE, replyGenerationPrompt } from "./prompts/reply-generation";
import type { ContextMessage } from "./ai-types";
import fs from "node:fs";
import path from "node:path";

const GENERATION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply_ja"],
  properties: {
    reply_ja: { type: "string" },
  },
} as const;

function validateGenerationContract(raw: unknown) {
  const normalized = normalizeGenerationReply(raw);
  const errors: string[] = [];
  if (!normalized.reply_ja.trim()) errors.push("reply_ja must be non-empty string");
  return errors;
}

function formatJstNow() {
  return (
    new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date()) + " JST"
  );
}

function toMessageText(message: ContextMessage) {
  const type = String(message.type || "TEXT").toUpperCase();
  if (type === "IMAGE") return "[画像が送信されています]";
  if (type === "STICKER") return "[スタンプが送信されています]";
  const text = String(message.japaneseText || "").trim();
  return text || "[空メッセージ]";
}

function formatMessageLine(message: ContextMessage) {
  const role = message.role === "OPERATOR" ? "運営" : "顧客";
  const sentAt = message.sentAt ? new Date(message.sentAt) : new Date();
  const ts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(sentAt);
  return `${ts} ${role}：\n${toMessageText(message)}`;
}

function buildCurrentTurnMessages(messagesAsc: ContextMessage[], latestCustomerId: string) {
  const idx = messagesAsc.findIndex((m) => m.id === latestCustomerId);
  if (idx < 0) return [];
  const out: ContextMessage[] = [];
  for (let i = idx; i >= 0; i -= 1) {
    const m = messagesAsc[i];
    if (m.role === "OPERATOR") break;
    if (m.role === "CUSTOMER") out.unshift(m);
  }
  return out;
}

export function buildPromptPayload(context: Record<string, unknown>) {
  const latestMessage = (context.latestMessage || {}) as ContextMessage;
  const recentMessages = (Array.isArray(context.recentMessages) ? context.recentMessages : []) as ContextMessage[];
  const rewriteInput = String(context.rewriteInput || "").trim();
  const messagesAsc = [...recentMessages].sort((a, b) => {
    return new Date(a.sentAt || 0).getTime() - new Date(b.sentAt || 0).getTime();
  });
  const chatHistory = messagesAsc.map(formatMessageLine).join("\n\n") || "（チャット履歴なし）";
  const latestCustomerId = String(latestMessage.id || "");
  const currentTurn = latestCustomerId ? buildCurrentTurnMessages(messagesAsc, latestCustomerId) : [];
  const latestMessageTs = new Date(latestMessage.sentAt || 0).getTime();
  const lastOperator = [...messagesAsc].reverse().find((m) => {
    if (m.role !== "OPERATOR") return false;
    if (!latestCustomerId) return true;
    return new Date(m.sentAt || 0).getTime() <= latestMessageTs;
  });
  const lastOperatorText = lastOperator ? toMessageText(lastOperator) : "（直前の運営メッセージはありません）";
  const currentMessagesText =
    currentTurn.map((m, i) => `${i + 1}.\n${toMessageText(m)}`).join("\n\n") || "1.\n[顧客メッセージなし]";

  return FINAL_PROMPT_TEMPLATE
    .replaceAll("{{CURRENT_TIME_JST}}", formatJstNow())
    .replaceAll("{{CHAT_HISTORY}}", chatHistory)
    .replaceAll("{{LAST_OPERATOR_MESSAGE}}", lastOperatorText)
    .replaceAll("{{CURRENT_MESSAGE_COUNT}}", String(Math.max(1, currentTurn.length)))
    .replaceAll("{{CURRENT_CUSTOMER_MESSAGES}}", currentMessagesText)
    .replaceAll("{{OPERATOR_NOTE_OPTIONAL}}", rewriteInput);
}

function extractBetween(payload: string, start: string, end: string) {
  const startIndex = payload.indexOf(start);
  if (startIndex < 0) return "";
  const fromStart = payload.slice(startIndex + start.length);
  const endIndex = fromStart.indexOf(end);
  if (endIndex < 0) return fromStart.trim();
  return fromStart.slice(0, endIndex).trim();
}

function buildPayloadTraceReport(input: {
  context: Record<string, unknown>;
  system: string;
  userPayload: string;
}) {
  const { context, system, userPayload } = input;
  const taskId = String(context.taskId || "").trim() || "(unavailable)";
  const customerId = String(context.customerId || "").trim() || "(unavailable)";
  const targetMessageId = String(context.targetMessageId || "").trim() || "(unavailable)";
  const latestMessageId =
    typeof context.latestMessage === "object" && context.latestMessage && "id" in context.latestMessage
      ? String((context.latestMessage as { id?: unknown }).id || "").trim() || "(unavailable)"
      : "(unavailable)";

  const hasLegacyJsonFields = /"stage":|"simple_context":|"selected_option":|"pain_anchors":|"bridge_meaning":|"post_free_option_reply_focus":/.test(
    userPayload,
  );
  const currentTimeReplaced = !userPayload.includes("{{CURRENT_TIME_JST}}");

  const chatHistory = extractBetween(
    userPayload,
    "## 5. 実際のチャット履歴",
    "## 6. 直前の運営メッセージ + 今回返信すべき顧客メッセージ",
  );
  const lastOperatorBlock = extractBetween(userPayload, "【直前の運営メッセージ】", "【今回返信すべき顧客メッセージ】");
  const currentCustomerMessagesBlock = extractBetween(userPayload, "【今回返信すべき顧客メッセージ】", "【今回だけの補足指示】");
  const operatorNoteBlock = extractBetween(userPayload, "【今回だけの補足指示】", "---");

  const lines = [
    "[ai-payload-trace] begin",
    `taskId: ${taskId}`,
    `customerId: ${customerId}`,
    `targetMessageId: ${targetMessageId}`,
    `latestMessageId: ${latestMessageId}`,
    `currentTimeReplaced: ${currentTimeReplaced}`,
    `hasLegacyJsonFields: ${hasLegacyJsonFields}`,
    "system:",
    system,
    "userPayload:",
    userPayload,
    "chatHistoryBlock:",
    chatHistory,
    "lastOperatorMessageBlock:",
    lastOperatorBlock,
    "currentCustomerMessagesBlock:",
    currentCustomerMessagesBlock,
    "operatorNoteBlock:",
    operatorNoteBlock,
    "[ai-payload-trace] end",
  ];
  return lines.join("\n");
}

function maybeTracePayload(input: {
  context: Record<string, unknown>;
  system: string;
  userPayload: string;
  env?: Record<string, string | undefined>;
  log?: (text: string) => void;
  writeFile?: (filePath: string, content: string, encoding: BufferEncoding) => void;
  ensureDir?: (dirPath: string) => void;
  resolveCwd?: () => string;
}) {
  const env = input.env || process.env;
  if (env.AI_PAYLOAD_TRACE !== "1") return false;
  const report = buildPayloadTraceReport({
    context: input.context,
    system: input.system,
    userPayload: input.userPayload,
  });
  const log = input.log || ((text: string) => console.log(text));
  const writeFile = input.writeFile || fs.writeFileSync;
  const ensureDir = input.ensureDir || ((dirPath: string) => fs.mkdirSync(dirPath, { recursive: true }));
  const cwd = input.resolveCwd ? input.resolveCwd() : process.cwd();
  const logPath = path.join(cwd, "logs", "ai-payload-trace-last.txt");
  ensureDir(path.dirname(logPath));
  writeFile(logPath, report, "utf8");
  log(report);
  return true;
}

export const __testOnly = {
  buildPromptPayload,
  buildPayloadTraceReport,
  maybeTracePayload,
};

export async function runReplyGeneration(context: Record<string, unknown>) {
  const apiKey = process.env.EKAN8_API_KEY || process.env.AI_API_KEY;
  const baseUrl = process.env.EKAN8_BASE_URL || process.env.AI_BASE_URL;
  const backupBaseUrl = process.env.EKAN8_BACKUP_BASE_URL || process.env.AI_BACKUP_BASE_URL;
  const model = process.env.MAIN_MODEL || process.env.AI_MAIN_MODEL;
  if (!apiKey || !baseUrl || !model) throw new Error("generation service missing env");

  buildChatCompletionsUrl({ baseOrEndpoint: baseUrl, preferEnvEndpoint: true });
  if (backupBaseUrl) buildChatCompletionsUrl({ baseOrEndpoint: backupBaseUrl, preferEnvEndpoint: false });

  const userPayload = buildPromptPayload(context);
  maybeTracePayload({
    context,
    system: replyGenerationPrompt.system,
    userPayload,
  });

  const response = await requestStructuredJsonWithContract({
    apiKey,
    baseUrl,
    backupBaseUrl,
    model,
    system: replyGenerationPrompt.system,
    user: userPayload,
    temperature: 0.7,
    stage: "generation",
    schemaName: "conversation_first_reply_generation_result",
    schema: GENERATION_JSON_SCHEMA as unknown as Record<string, unknown>,
    validateParsed: validateGenerationContract,
  });
  const parsed = validateMainBrainGenerationResult(normalizeGenerationReply(response.parsed));
  return {
    ...response,
    model,
    promptVersion: replyGenerationPrompt.version,
    parsed: {
      reply_ja: parsed.reply_ja.trim(),
    },
  };
}
