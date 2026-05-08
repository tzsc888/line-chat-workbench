import { buildPromptPayload } from "@/lib/ai/reply-generation-service";
import { manualReplyCopyPrompt } from "@/lib/ai/prompts/reply-generation";

function buildManualOutputSection() {
  return [
    "## 8. 最終出力形式",
    "返信本文には、顧客へそのまま送れる日本語LINE返信だけを書いてください。",
    manualReplyCopyPrompt.finalOutputInstruction,
    "この返信は、いまこのLINE会話で顧客に送る次の一通です。",
  ].join("\n");
}

export function buildManualCopyUserPrompt(context: Record<string, unknown>) {
  const payload = buildPromptPayload(context);
  const replacedReplyField = payload.replaceAll("reply_ja", "返信本文");
  return replacedReplyField.replace(/## 8\.[\s\S]*$/u, buildManualOutputSection());
}

export function buildManualCopyPromptBundle(context: Record<string, unknown>) {
  const userPrompt = buildManualCopyUserPrompt(context);
  return ["【SYSTEM】", manualReplyCopyPrompt.system, "", "【USER】", userPrompt].join("\n");
}

