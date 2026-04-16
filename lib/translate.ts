import { translateCustomerJapaneseMessage } from "@/lib/ai/translation-service";

export async function translateJapaneseToChinese(japanese: string) {
  const result = await translateCustomerJapaneseMessage({ japaneseText: japanese });
  return {
    ok: true,
    line: result.line,
    model: result.model,
    chinese: result.parsed.translation,
    toneNotes: result.parsed.tone_notes,
    ambiguityNotes: result.parsed.ambiguity_notes,
    attentionPoints: result.parsed.attention_points,
  };
}
