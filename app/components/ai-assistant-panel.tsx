"use client";
import {
  getConfidenceLabel,
  getPushLevelLabel,
  getReviewResultLabel,
  getRiskLevelLabel,
  getRouteTypeLabel,
  getSceneTypeLabel,
  type DraftAiReview,
  type DraftGenerationBrief,
  type DraftReviewFlags,
  type DraftSelfCheck,
} from "@/lib/ai/draft-presentation";

type FollowupSummary = {
  bucket: "UNCONVERTED" | "VIP";
  tier: "A" | "B" | "C";
  state: "ACTIVE" | "OBSERVING" | "WAITING_WINDOW" | "POST_PURCHASE_CARE" | "DONE" | "PAUSED";
  reason: string;
  nextFollowupAt: string | null;
  isOverdue: boolean;
};

type ReplyDraftSet = {
  id: string;
  stableJapanese: string;
  stableChinese: string;
  advancingJapanese: string;
  advancingChinese: string;
  analysisPromptVersion?: string | null;
  generationPromptVersion?: string | null;
  reviewPromptVersion?: string | null;
  sceneType: string | null;
  routeType: string | null;
  replyGoal: string | null;
  pushLevel: string | null;
  differenceNote: string | null;
  recommendedVariant: "STABLE" | "ADVANCING" | null;
  isStale: boolean;
  staleReason: string | null;
  staleAt: string | null;
  selectedVariant: "STABLE" | "ADVANCING" | null;
  selectedAt: string | null;
  createdAt: string;
};

type WorkspaceSummary = {
  customer: {
    aiCustomerInfo: string | null;
    aiCurrentStrategy: string | null;
    riskTags?: string[];
    followup: FollowupSummary | null;
  };
} | null;

type SuggestionCardProps = {
  title: string;
  recommended: boolean;
  shouldDimDraft: boolean;
  japanese: string;
  chinese: string;
  isSending: boolean;
  isUsed: boolean;
  isStale: boolean;
  isBlocked: boolean;
  disabled: boolean;
  onSend: () => void;
};

type AiAssistantPanelProps = {
  workspace: WorkspaceSummary;
  latestDraft: ReplyDraftSet | null;
  latestDraftGenerationBrief: DraftGenerationBrief | null;
  latestDraftReviewFlags: DraftReviewFlags | null;
  latestDraftAiReview: DraftAiReview | null;
  latestDraftSelfCheck: DraftSelfCheck | null;
  latestDraftIssues: string[];
  latestDraftStatusNote: string;
  latestDraftReviewSummary: string;
  latestDraftPrimaryActionLabel: string;
  latestDraftPrimaryActionHint: string;
  isLatestDraftUsed: boolean;
  isLatestDraftStale: boolean;
  isLatestDraftBlocked: boolean;
  shouldDimDraft: boolean;
  displayedSuggestion1Ja: string;
  displayedSuggestion1Zh: string;
  displayedSuggestion2Ja: string;
  displayedSuggestion2Zh: string;
  rewriteInput: string;
  onRewriteInputChange: (value: string) => void;
  onAnalyzeCustomer: () => void;
  onRewrite: () => void;
  onSendStable: () => void;
  onSendAdvancing: () => void;
  isAnalyzing: boolean;
  isGenerating: boolean;
  isSendingAi: string;
  helperError: string;
  apiError: string;
  aiNotice: string;
};

function getFollowupBucketLabel(bucket?: FollowupSummary["bucket"] | null) {
  return bucket === "VIP" ? "VIP已成交" : "未成交";
}

function getFollowupTierLabel(tier?: FollowupSummary["tier"] | null) {
  return tier ? `${tier}类` : "未分层";
}

function formatFollowupTime(dateString: string | null) {
  if (!dateString) return "未设置";
  const date = new Date(dateString);
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function SuggestionCard(props: SuggestionCardProps) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        props.shouldDimDraft
          ? "border-gray-200 bg-gray-50 opacity-70"
          : props.recommended
            ? "border-emerald-300 bg-emerald-50/40"
            : "border-gray-200 bg-white"
      }`}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="font-semibold">{props.title}</div>
        {props.recommended ? (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
            推荐
          </span>
        ) : null}
      </div>
      <div className={`min-h-[72px] whitespace-pre-wrap rounded-lg p-3 text-sm ${props.shouldDimDraft ? "bg-gray-200 text-gray-600" : "bg-gray-100"}`}>
        {props.japanese}
      </div>
      <div className={`mt-2 min-h-[72px] whitespace-pre-wrap rounded-lg p-3 text-sm ${props.shouldDimDraft ? "bg-gray-100 text-gray-500" : "bg-gray-50 text-gray-700"}`}>
        {props.chinese}
      </div>
      <button
        onClick={props.onSend}
        disabled={props.disabled}
        className="mt-3 w-full rounded-lg bg-blue-600 py-2 text-white disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
      >
        {props.isSending
          ? "发送中..."
          : props.isUsed
            ? "已使用"
            : props.isStale
              ? "已失效"
              : props.isBlocked
                ? "需重生"
                : "发送"}
      </button>
    </div>
  );
}

export function AiAssistantPanel(props: AiAssistantPanelProps) {
  const followup = props.workspace?.customer.followup || null;

  return (
    <div className="w-[30%] overflow-y-auto border-l border-gray-200 bg-white p-4">
      <h2 className="mb-4 text-lg font-bold">AI 助理</h2>
      <div className="space-y-5">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 flex items-center justify-between">
            <div className="font-semibold text-amber-900">客户信息</div>
            <button
              onClick={props.onAnalyzeCustomer}
              disabled={props.isAnalyzing || !props.workspace}
              className="rounded-lg bg-amber-900 px-3 py-1 text-xs text-white disabled:opacity-60"
            >
              {props.isAnalyzing ? "分析中..." : "刷新判断"}
            </button>
          </div>
          <div className="text-sm text-amber-900/90">
            <div>{props.workspace?.customer.aiCustomerInfo || ""}</div>
            <div className="mt-2">{props.workspace?.customer.aiCurrentStrategy || ""}</div>
          </div>
          {props.helperError ? <div className="mt-2 break-all text-xs text-red-500">{props.helperError}</div> : null}
        </div>

        {props.latestDraft ? (
          <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="font-semibold text-sky-900">本轮判断</div>
              <div className="text-[11px] text-sky-700">
                {props.latestDraftReviewFlags?.confidence ? `把握度：${getConfidenceLabel(props.latestDraftReviewFlags.confidence)}` : ""}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-sky-800">
              {props.latestDraft.sceneType ? <span className="rounded-full border border-sky-200 bg-white px-2 py-1">场景：{getSceneTypeLabel(props.latestDraft.sceneType)}</span> : null}
              {props.latestDraft.routeType ? <span className="rounded-full border border-sky-200 bg-white px-2 py-1">路线：{getRouteTypeLabel(props.latestDraft.routeType)}</span> : null}
              {props.latestDraft.pushLevel ? <span className="rounded-full border border-sky-200 bg-white px-2 py-1">推进：{getPushLevelLabel(props.latestDraft.pushLevel)}</span> : null}
              {props.latestDraft.recommendedVariant ? (
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">
                  建议优先：{props.latestDraft.recommendedVariant === "STABLE" ? "A 更稳" : "B 半步推进"}
                </span>
              ) : null}
            </div>
            <div className="space-y-1 rounded-lg border border-sky-100 bg-white px-3 py-2 text-xs text-sky-900/80">
              <div>{props.latestDraftStatusNote}</div>
              {props.latestDraft.createdAt ? <div className="text-[11px] text-sky-900/60">生成时间：{formatFollowupTime(props.latestDraft.createdAt)}</div> : null}
              {props.latestDraft.staleAt ? <div className="text-[11px] text-sky-900/60">失效时间：{formatFollowupTime(props.latestDraft.staleAt)}</div> : null}
            </div>
            {props.latestDraft.replyGoal ? <div className="text-sm text-sky-900/90">目标：{props.latestDraft.replyGoal}</div> : null}
            {props.latestDraftGenerationBrief?.mission ? <div className="text-sm text-sky-900/90">任务：{props.latestDraftGenerationBrief.mission}</div> : null}
            {props.latestDraftGenerationBrief?.must_cover?.length ? <div className="text-xs text-sky-900/80">必须覆盖：{props.latestDraftGenerationBrief.must_cover.join(" / ")}</div> : null}
            {props.latestDraftGenerationBrief?.must_avoid?.length ? <div className="text-xs text-sky-900/80">避雷：{props.latestDraftGenerationBrief.must_avoid.join(" / ")}</div> : null}
            {props.workspace?.customer.riskTags?.length ? <div className="text-xs text-sky-900/80">风险标签：{props.workspace.customer.riskTags.join(" / ")}</div> : null}
            {props.latestDraftSelfCheck?.avoided_risks?.length ? <div className="text-xs text-sky-900/70">生成自检：已规避 {props.latestDraftSelfCheck.avoided_risks.join(" / ")}</div> : null}
            {props.latestDraftAiReview?.overall_result ? (
              <div className="space-y-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700">
                <div>
                  复检：{getReviewResultLabel(props.latestDraftAiReview.overall_result)}
                  {props.latestDraftAiReview.risk_level ? ` · 风险 ${getRiskLevelLabel(props.latestDraftAiReview.risk_level)}` : ""}
                </div>
                {(props.latestDraft.analysisPromptVersion || props.latestDraft.generationPromptVersion || props.latestDraft.reviewPromptVersion) ? (
                  <div className="text-[11px] text-slate-500">
                    Prompt 版本：分析 {props.latestDraft.analysisPromptVersion || "-"} / 生成 {props.latestDraft.generationPromptVersion || "-"} / 复检 {props.latestDraft.reviewPromptVersion || "-"}
                  </div>
                ) : null}
              </div>
            ) : null}
            {followup ? (
              <div className="space-y-1 rounded-lg border border-sky-100 bg-white px-3 py-2 text-xs text-sky-900/80">
                <div className="font-medium text-sky-900">跟进提示</div>
                <div>{getFollowupBucketLabel(followup.bucket)} / {getFollowupTierLabel(followup.tier)}</div>
                <div>状态：{followup.state} · 下次：{formatFollowupTime(followup.nextFollowupAt)}</div>
                <div>{followup.reason}</div>
              </div>
            ) : null}
            {props.isLatestDraftBlocked ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                当前草稿已被质检拦截，不建议继续发送，请优先重新生成。
              </div>
            ) : props.latestDraftReviewFlags?.needs_human_attention || props.latestDraftAiReview?.human_attention_note ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {props.latestDraftAiReview?.human_attention_note || props.latestDraftReviewFlags?.review_reason || "当前结果需要人工特别注意"}
              </div>
            ) : null}
            {props.aiNotice ? <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">{props.aiNotice}</div> : null}
            {props.latestDraftIssues.length ? (
              <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-800">
                <div className="font-medium">风险提示</div>
                <ul className="list-disc space-y-1 pl-4">
                  {props.latestDraftIssues.slice(0, 4).map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">
            <div className="font-semibold text-gray-900">当前还没有建议草稿</div>
            <div>可以先刷新判断，再基于最新消息生成两版建议回复。</div>
            {props.workspace?.customer.aiCurrentStrategy ? (
              <div className="space-y-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700">
                <div className="font-medium text-gray-900">当前经营策略</div>
                <div className="whitespace-pre-wrap">{props.workspace.customer.aiCurrentStrategy}</div>
              </div>
            ) : null}
            {props.workspace?.customer.aiCustomerInfo ? (
              <div className="space-y-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700">
                <div className="font-medium text-gray-900">客户信息摘要</div>
                <div className="whitespace-pre-wrap">{props.workspace.customer.aiCustomerInfo}</div>
              </div>
            ) : null}
            {props.aiNotice ? <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">{props.aiNotice}</div> : null}
          </div>
        )}

        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">本轮操作</div>
              <div className="mt-1 text-xs text-gray-500">{props.latestDraftPrimaryActionHint}</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={props.onAnalyzeCustomer}
                disabled={props.isAnalyzing || !props.workspace}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 disabled:opacity-60"
              >
                {props.isAnalyzing ? "分析中..." : "刷新判断"}
              </button>
              <button
                onClick={props.onRewrite}
                disabled={props.isGenerating || !props.workspace}
                className="rounded-lg bg-black px-3 py-2 text-sm text-white disabled:opacity-60"
              >
                {props.isGenerating ? "生成中..." : props.latestDraftPrimaryActionLabel}
              </button>
            </div>
          </div>
          {props.latestDraftReviewSummary ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">{props.latestDraftReviewSummary}</div> : null}
        </div>

        <SuggestionCard
          title="更稳回复"
          recommended={props.latestDraft?.recommendedVariant === "STABLE"}
          shouldDimDraft={props.shouldDimDraft}
          japanese={props.displayedSuggestion1Ja}
          chinese={props.displayedSuggestion1Zh}
          isSending={props.isSendingAi === "stable"}
          isUsed={props.isLatestDraftUsed}
          isStale={props.isLatestDraftStale}
          isBlocked={props.isLatestDraftBlocked}
          disabled={!props.workspace || !props.displayedSuggestion1Ja || props.isSendingAi !== "" || props.shouldDimDraft || props.isLatestDraftBlocked}
          onSend={props.onSendStable}
        />

        <SuggestionCard
          title="更推进成交"
          recommended={props.latestDraft?.recommendedVariant === "ADVANCING"}
          shouldDimDraft={props.shouldDimDraft}
          japanese={props.displayedSuggestion2Ja}
          chinese={props.displayedSuggestion2Zh}
          isSending={props.isSendingAi === "advancing"}
          isUsed={props.isLatestDraftUsed}
          isStale={props.isLatestDraftStale}
          isBlocked={props.isLatestDraftBlocked}
          disabled={!props.workspace || !props.displayedSuggestion2Ja || props.isSendingAi !== "" || props.shouldDimDraft || props.isLatestDraftBlocked}
          onSend={props.onSendAdvancing}
        />

        {props.latestDraft?.differenceNote ? (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="mb-2 font-semibold">两版差异</div>
            <div className="whitespace-pre-wrap text-sm text-gray-700">{props.latestDraft.differenceNote}</div>
          </div>
        ) : null}

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-2 font-semibold">重写要求（可留空）</div>
          <div className="mb-2 text-xs text-gray-500">
            可补充语气、长度、推进力度、避雷点；留空时会按当前最新判断直接重新生成。{props.isLatestDraftStale ? " 当前草稿已过期，建议按最新消息重跑。" : ""}
          </div>
          <input
            type="text"
            value={props.rewriteInput}
            onChange={(event) => props.onRewriteInputChange(event.target.value)}
            placeholder="例如：更自然一点，不要太销售；留空则直接按当前判断重生"
            className="w-full rounded-lg border px-3 py-2 text-sm"
          />
          <button
            onClick={props.onRewrite}
            disabled={props.isGenerating || !props.workspace}
            className="mt-2 w-full rounded-lg bg-black py-2 text-white disabled:opacity-60"
          >
            {props.isGenerating ? "生成中..." : props.latestDraftPrimaryActionLabel}
          </button>
          {props.apiError ? <div className="mt-2 break-all text-xs text-red-500">{props.apiError}</div> : null}
        </div>
      </div>
    </div>
  );
}
