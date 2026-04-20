import { MessageAiPipelineMini } from "@/app/workbench/workspace/components/message-ai-pipeline-mini";
import { formatBubbleTime, getDeliveryStatusMeta, resolveDeliveryState } from "@/app/workbench/workspace/helpers/message-view";
import type { WorkspaceRenderableMessage } from "@/app/workbench/workspace/types";

type Props = {
  message: WorkspaceRenderableMessage;
  retryingMessageId: string;
  onRetryMessage: (messageId: string) => void;
};

export function MessageBubble({ message, retryingMessageId, onRetryMessage }: Props) {
  const deliveryState = resolveDeliveryState(message, retryingMessageId);
  const deliveryMeta = getDeliveryStatusMeta(deliveryState);
  const canRetry = deliveryState === "failed" || deliveryState === "retrying";
  const isRetrying = deliveryState === "retrying";

  return (
    <div
      className={`flex min-w-0 ${
        message.role === "CUSTOMER" ? "justify-start" : "justify-end"
      }`}
    >
      <div className="min-w-0 max-w-full sm:max-w-md">
        <div
          className={`rounded-2xl p-3 text-sm shadow ${
            message.role === "CUSTOMER"
              ? "bg-white text-black"
              : "bg-green-500 text-white"
          }`}
        >
          {message.type === "TEXT" ? (
            <>
              <div className="whitespace-pre-wrap break-words">{message.japaneseText}</div>
              <div
                className={`mt-2 text-xs ${
                  message.role === "CUSTOMER"
                    ? "text-gray-500"
                    : "text-green-100"
                }`}
              >
                {message.chineseText || ""}
              </div>
            </>
          ) : message.type === "IMAGE" ? (
            <>
              {message.imageUrl ? (
                <a href={message.imageUrl} target="_blank" rel="noreferrer" className="block">
                  <img
                    src={message.imageUrl}
                    alt="聊天图片"
                    className="max-h-72 w-auto max-w-[240px] rounded-xl border border-black/5 object-cover"
                  />
                </a>
              ) : (
                <div className="flex h-36 w-56 items-center justify-center rounded-lg bg-gray-200 text-gray-600">
                  图片不可用
                </div>
              )}
              {message.japaneseText ? (
                <div className="mt-2 whitespace-pre-wrap break-words">{message.japaneseText}</div>
              ) : null}
              {message.chineseText ? (
                <div
                  className={`mt-2 text-xs ${
                    message.role === "CUSTOMER"
                      ? "text-gray-500"
                      : "text-green-100"
                  }`}
                >
                  {message.chineseText}
                </div>
              ) : null}
            </>
          ) : (
            <>
              <div className={`rounded-xl border px-3 py-2 ${message.role === "CUSTOMER" ? "border-gray-200 bg-gray-50 text-gray-700" : "border-white/20 bg-white/15 text-white"}`}>
                <div className="text-xs font-semibold tracking-wide">LINE贴图</div>
                <div className="mt-1 text-xs opacity-80">packageId: {message.stickerPackageId || "-"}</div>
                <div className="text-xs opacity-80">stickerId: {message.stickerId || "-"}</div>
              </div>
              {message.japaneseText && message.japaneseText !== "[贴图]" ? (
                <div className="mt-2 whitespace-pre-wrap break-words">{message.japaneseText}</div>
              ) : null}
            </>
          )}
        </div>
        <div
          className={`mt-1 flex items-center gap-2 text-[11px] text-gray-400 ${
            message.role === "CUSTOMER" ? "justify-start" : "justify-end"
          }`}
        >
          <span>{formatBubbleTime(message.sentAt)}</span>
          {deliveryMeta ? (
            <span className={deliveryMeta.className}>
              {deliveryMeta.label}
            </span>
          ) : null}
          {message.role === "OPERATOR" && canRetry ? (
            <button
              type="button"
              onClick={() => onRetryMessage(message.id)}
              disabled={isRetrying}
              className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isRetrying ? "重发中..." : "重发"}
            </button>
          ) : null}
        </div>
        {message.role === "OPERATOR" && deliveryState === "failed" && message.sendError ? (
          <div className="mt-1 break-all text-right text-[11px] text-red-500 line-clamp-2">
            {message.sendError}
          </div>
        ) : null}
        {message.role === "CUSTOMER" ? (
          <MessageAiPipelineMini pipeline={message.aiPipeline || null} />
        ) : null}
      </div>
    </div>
  );
}
