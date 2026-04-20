import type { WorkspaceRenderableMessage } from "@/app/workbench/workspace/types";

export type RenderableDeliveryState = "sending" | "retrying" | "pending" | "sent" | "failed" | null;

export function resolveDeliveryState(message: WorkspaceRenderableMessage, retryingMessageId = ""): RenderableDeliveryState {
  if (message.role !== "OPERATOR") {
    return null;
  }
  if (retryingMessageId && message.id === retryingMessageId) {
    return "retrying";
  }
  if (message.deliveryStatus === "FAILED") {
    return "failed";
  }
  if (message.deliveryStatus === "SENT") {
    return "sent";
  }
  if (message.deliveryStatus === "PENDING") {
    return message.isOptimistic ? "sending" : "pending";
  }
  if (message.isOptimistic) {
    return "sending";
  }
  return null;
}

export function formatBubbleTime(dateString: string) {
  return new Date(dateString).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function getDeliveryStatusMeta(state: RenderableDeliveryState) {
  switch (state) {
    case "retrying":
      return { label: "重试中", className: "text-amber-500" };
    case "sending":
      return { label: "发送中", className: "text-amber-500" };
    case "pending":
      return { label: "发送中", className: "text-amber-500" };
    case "sent":
      return { label: "已发送", className: "text-gray-400" };
    case "failed":
      return { label: "发送失败", className: "text-red-500" };
    default:
      return null;
  }
}

export function formatDividerTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleString("ja-JP", {
    ...(sameYear ? {} : { year: "numeric" }),
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function shouldShowMessageDivider(
  previousMessage: WorkspaceRenderableMessage | null,
  currentMessage: WorkspaceRenderableMessage,
) {
  if (!previousMessage) return true;
  const previousDate = new Date(previousMessage.sentAt);
  const currentDate = new Date(currentMessage.sentAt);
  const previousDayKey = `${previousDate.getFullYear()}-${previousDate.getMonth()}-${previousDate.getDate()}`;
  const currentDayKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}-${currentDate.getDate()}`;
  if (previousDayKey !== currentDayKey) return true;
  const gap = currentDate.getTime() - previousDate.getTime();
  return gap >= 30 * 60 * 1000;
}
