import type { AnalysisContextPack, AnalysisResult } from "./ai-types";
import { requestStructuredJson } from "./model-client";
import { validateAnalysisResult } from "./protocol-validator";
import { analysisRouterPrompt } from "./prompts/analysis-router";

export async function runAnalysisRouter(context: AnalysisContextPack) {
  const apiKey = process.env.EKAN8_API_KEY;
  const baseUrl = process.env.EKAN8_BASE_URL;
  const backupBaseUrl = process.env.EKAN8_BACKUP_BASE_URL;
  const model = process.env.MAIN_MODEL;

  if (!apiKey || !baseUrl || !model) {
    throw new Error("第二层环境变量缺失");
  }

  const response = await requestStructuredJson<AnalysisResult>({
    apiKey,
    baseUrl,
    backupBaseUrl,
    model,
    system: analysisRouterPrompt.system,
    user: JSON.stringify(context, null, 2),
    temperature: 0.15,
  });

  return {
    ...response,
    model,
    promptVersion: analysisRouterPrompt.version,
    parsed: validateAnalysisResult(response.parsed),
  };
}
