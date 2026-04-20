import type { AiReviewResult, AnalysisResult, GenerationResult, ReviewContextPack } from "./ai-types";
import { requestStructuredJson } from "./model-client";
import { buildReviewPipelineResult, validateAiReviewResult } from "./protocol-validator";
import { replyReviewPrompt } from "./prompts/reply-review";
import { resolveReviewStrategy } from "./strategy";

function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function runProgramChecks(input: {
  analysis: AnalysisResult;
  generation: GenerationResult;
}) {
  const issues: string[] = [];
  const { analysis, generation } = input;

  if (!generation.reply_a.japanese || !generation.reply_b.japanese) {
    issues.push("回复文本缺失");
  }
  if (!generation.reply_a.chinese_meaning || !generation.reply_b.chinese_meaning) {
    issues.push("中文释义缺失");
  }
  if (!generation.difference_note) {
    issues.push("两版差异说明缺失");
  }

  const aText = normalize(generation.reply_a.japanese);
  const bText = normalize(generation.reply_b.japanese);
  if (aText && bText && (aText === bText || aText.includes(bText) || bText.includes(aText))) {
    issues.push("A/B 两版差异过弱");
  }

  if (generation.reply_a.japanese.length > 220 || generation.reply_b.japanese.length > 220) {
    issues.push("回复偏长，不适合 LINE 短聊");
  }

  if (analysis.routing_decision.route_type === "DO_NOT_PUSH" || analysis.generation_brief.push_level === "NO_PUSH") {
    const riskySignals = ["ご購入", "お申し込み", "料金", "今なら", "申请"];
    if (riskySignals.some((signal) => aText.includes(signal) || bText.includes(signal))) {
      issues.push("上游判定不推进，但生成文本带有推进信号");
    }
  }

  if (analysis.scene_assessment.industry_stage === "INTAKE_RECEPTION") {
    if (generation.reply_a.japanese.length > 140 || generation.reply_b.japanese.length > 140) {
      issues.push("首轮接待回复过长");
    }
  }

  if (
    analysis.scene_assessment.industry_stage === "POST_FREE_READING_CONVERSION" &&
    ["BUILD_PAID_NECESSITY", "INVITE_INDIVIDUAL"].includes(analysis.generation_brief.conversion_step) &&
    !analysis.generation_brief.boundary_to_establish
  ) {
    issues.push("免费文后承接缺少边界提醒");
  }

  return {
    passed: issues.length === 0,
    issues,
    needs_ai_review: issues.length > 0,
  };
}

export async function runAiReview(context: ReviewContextPack): Promise<{ line: string; model: string; parsed: AiReviewResult; promptVersion: string }> {
  const apiKey = process.env.EKAN8_API_KEY;
  const baseUrl = process.env.EKAN8_BASE_URL;
  const backupBaseUrl = process.env.EKAN8_BACKUP_BASE_URL;
  const model = process.env.MAIN_MODEL;

  if (!apiKey || !baseUrl || !model) {
    throw new Error("review service missing env");
  }

  const strategy = resolveReviewStrategy();

  const response = await requestStructuredJson({
    apiKey,
    baseUrl,
    backupBaseUrl,
    model,
    system: replyReviewPrompt.system,
    user: JSON.stringify(context, null, 2),
    temperature: strategy.temperature,
  });

  return {
    ...response,
    model,
    promptVersion: replyReviewPrompt.version,
    parsed: validateAiReviewResult(response.parsed),
  };
}

export function buildReviewGate(programIssues: string[], aiReview?: AiReviewResult | null) {
  return buildReviewPipelineResult(programIssues, aiReview);
}
