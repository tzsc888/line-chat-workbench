"use client";

type SuggestionCardProps = {
  title: string;
  shouldDimDraft: boolean;
  japanese: string;
  chinese: string;
  isSending: boolean;
  isUsed: boolean;
  isStale: boolean;
  disabled: boolean;
  onSend: () => void;
};

type AiAssistantPanelProps = {
  hasDraft: boolean;
  latestDraftPrimaryActionLabel: string;
  latestDraftPrimaryActionHint: string;
  isLatestDraftUsed: boolean;
  isLatestDraftStale: boolean;
  shouldDimDraft: boolean;
  displayedSuggestion1Ja: string;
  displayedSuggestion1Zh: string;
  displayedSuggestion2Ja: string;
  displayedSuggestion2Zh: string;
  rewriteInput: string;
  onRewriteInputChange: (value: string) => void;
  onRewrite: () => void;
  onSendStable: () => void;
  onSendAdvancing: () => void;
  isGenerating: boolean;
  isSendingAi: string;
  apiError: string;
  aiNotice: string;
  onLogout: () => void;
  loggingOut: boolean;
  isPostGenerateSyncing?: boolean;
  postGenerateSyncMessage?: string;
};

function SuggestionCard(props: SuggestionCardProps) {
  return (
    <div
      className={`rounded-xl border p-4 ${
        props.shouldDimDraft
          ? "border-gray-200 bg-gray-50 opacity-70"
          : "border-gray-200 bg-white"
      }`}
    >
      <div className="mb-2 font-semibold">{props.title}</div>
      <div className={`min-h-[72px] whitespace-pre-wrap rounded-lg p-3 text-sm ${props.shouldDimDraft ? "bg-gray-200 text-gray-600" : "bg-gray-100"}`}>
        {props.japanese}
      </div>
      <div className={`mt-2 min-h-[72px] whitespace-pre-wrap rounded-lg p-3 text-sm ${props.shouldDimDraft ? "bg-gray-100 text-gray-500" : "bg-gray-50 text-gray-700"}`}>
        {props.chinese || (props.japanese ? "中文意思暂不可用" : "")}
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
              : "发送"}
      </button>
    </div>
  );
}

export function AiAssistantPanel(props: AiAssistantPanelProps) {
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto bg-white p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">AI 助理</h2>
        <button
          type="button"
          onClick={props.onLogout}
          disabled={props.loggingOut}
          className="shrink-0 rounded-lg border border-slate-300 px-3 py-1 text-xs text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          {props.loggingOut ? "退出中..." : "退出登录"}
        </button>
      </div>

      <div className="space-y-5">
        {!props.hasDraft ? (
          <div className="space-y-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">
            <div className="font-semibold text-gray-900">当前还没有建议草稿</div>
            <div>点击生成，主脑会基于最新高保真上下文输出 A/B 建议。</div>
          </div>
        ) : null}
        {props.aiNotice ? <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800">{props.aiNotice}</div> : null}

        <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="font-semibold">本轮操作</div>
              <div className="mt-1 text-xs text-gray-500">{props.latestDraftPrimaryActionHint}</div>
            </div>
            <button
              onClick={props.onRewrite}
              disabled={props.isGenerating}
              className="rounded-lg bg-black px-3 py-2 text-sm text-white disabled:opacity-60"
            >
              {props.isGenerating ? "生成中..." : props.latestDraftPrimaryActionLabel}
            </button>
          </div>
          {props.isPostGenerateSyncing ? (
            <div className="text-[11px] text-slate-500">建议已更新，正在后台同步列表与会话...</div>
          ) : props.postGenerateSyncMessage ? (
            <div className="text-[11px] text-amber-600">{props.postGenerateSyncMessage}</div>
          ) : null}
        </div>

        <SuggestionCard
          title="A 稳妥版"
          shouldDimDraft={props.shouldDimDraft}
          japanese={props.displayedSuggestion1Ja}
          chinese={props.displayedSuggestion1Zh}
          isSending={props.isSendingAi === "stable"}
          isUsed={props.isLatestDraftUsed}
          isStale={props.isLatestDraftStale}
          disabled={!props.displayedSuggestion1Ja || props.isSendingAi !== "" || props.shouldDimDraft}
          onSend={props.onSendStable}
        />

        <SuggestionCard
          title="B 推进版"
          shouldDimDraft={props.shouldDimDraft}
          japanese={props.displayedSuggestion2Ja}
          chinese={props.displayedSuggestion2Zh}
          isSending={props.isSendingAi === "advancing"}
          isUsed={props.isLatestDraftUsed}
          isStale={props.isLatestDraftStale}
          disabled={!props.displayedSuggestion2Ja || props.isSendingAi !== "" || props.shouldDimDraft}
          onSend={props.onSendAdvancing}
        />

        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="mb-2 font-semibold">重写要求（可留空）</div>
          <div className="mb-2 text-xs text-gray-500">
            可补充语气、长度、推进力度、避雷点；留空时将基于最新上下文直接重生。
          </div>
          <input
            type="text"
            value={props.rewriteInput}
            onChange={(event) => props.onRewriteInputChange(event.target.value)}
            placeholder="例如：更自然一点，避免太硬推销"
            className="w-full rounded-lg border px-3 py-2 text-sm"
          />
          <button
            onClick={props.onRewrite}
            disabled={props.isGenerating}
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

