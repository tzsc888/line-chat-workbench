"use client";
import * as Ably from "ably";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { MessageSource } from "@prisma/client";
import { AiAssistantPanel } from "@/app/components/ai-assistant-panel";
type FollowupSummary = {
  bucket: "UNCONVERTED" | "VIP";
  tier: "A" | "B" | "C";
  state: "ACTIVE" | "OBSERVING" | "WAITING_WINDOW" | "POST_PURCHASE_CARE" | "DONE" | "PAUSED";
  reason: string;
  nextFollowupAt: string | null;
  isOverdue: boolean;
};
type CustomerTag = {
  id: string;
  name: string;
  color: string | null;
};
type CustomerListItem = {
  id: string;
  lineUserId: string | null;
  remarkName: string | null;
  originalName: string;
  avatarUrl: string | null;
  stage: string;
  isVip: boolean;
  pinnedAt: string | null;
  unreadCount: number;
  lineRelationshipStatus: "ACTIVE" | "UNFOLLOWED";
  lineRefollowedAt: string | null;
  lastMessageAt: string | null;
  followup: FollowupSummary | null;
  tags: CustomerTag[];
  latestMessage: {
    id: string;
    role: "CUSTOMER" | "OPERATOR";
    type: "TEXT" | "IMAGE" | "STICKER";
    source: "LINE" | "MANUAL" | "AI_SUGGESTION";
    japaneseText: string;
    chineseText: string | null;
    deliveryStatus: "PENDING" | "SENT" | "FAILED" | null;
    sendError: string | null;
    sentAt: string;
    previewText: string;
  } | null;
};
type WorkspaceMessage = {
  id: string;
  customerId: string;
  role: "CUSTOMER" | "OPERATOR";
  type: "TEXT" | "IMAGE" | "STICKER";
  source: "LINE" | "MANUAL" | "AI_SUGGESTION";
  lineMessageId: string | null;
  japaneseText: string;
  chineseText: string | null;
  imageUrl: string | null;
  stickerPackageId: string | null;
  stickerId: string | null;
  deliveryStatus: "PENDING" | "SENT" | "FAILED" | null;
  sendError: string | null;
  lastAttemptAt: string | null;
  failedAt: string | null;
  retryCount: number;
  sentAt: string;
  createdAt: string;
  updatedAt: string;
};
type ReplyDraftSet = {
  id: string;
  customerId: string;
  targetCustomerMessageId: string | null;
  extraRequirement: string | null;
  stableJapanese: string;
  stableChinese: string;
  advancingJapanese: string;
  advancingChinese: string;
  modelName: string;
  translationPromptVersion: string | null;
  generationPromptVersion: string | null;
  isStale: boolean;
  staleReason: string | null;
  staleAt: string | null;
  selectedVariant: "STABLE" | "ADVANCING" | null;
  selectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
type ScheduledMessageItem = {
  id: string;
  type: "TEXT" | "IMAGE" | "STICKER";
  source: "LINE" | "MANUAL" | "AI_SUGGESTION";
  japaneseText: string;
  chineseText: string | null;
  imageUrl: string | null;
  scheduledFor: string;
  status: "PENDING" | "PROCESSING" | "FAILED" | "CANCELED";
  sendError: string | null;
  retryCount: number;
  createdAt: string;
  updatedAt: string;
};
type WorkspaceData = {
  customer: {
    id: string;
    lineUserId: string | null;
    remarkName: string | null;
    originalName: string;
    avatarUrl: string | null;
    stage: string;
    isVip: boolean;
    pinnedAt: string | null;
    unreadCount: number;
    lineRelationshipStatus: "ACTIVE" | "UNFOLLOWED";
    lineRefollowedAt: string | null;
    lastMessageAt: string | null;
    followup: FollowupSummary | null;
    tags: CustomerTag[];
  };
  tags: CustomerTag[];
  messages: WorkspaceMessage[];
  scheduledMessages: ScheduledMessageItem[];
  latestCustomerMessageId: string | null;
  latestReplyDraftSet: ReplyDraftSet | null;
};
type RewriteResult = {
  suggestion1Ja: string;
  suggestion1Zh: string;
  translationStatus?: "succeeded" | "failed";
  translationErrorCode?: string;
};
type CopyPromptStatus = "idle" | "copying" | "copied" | "failed";
type GenerationTaskView = {
  id: string;
  customerId: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
  stage: string;
  errorCode: string | null;
  errorMessage: string | null;
};
type CustomerContextMenuState = {
  customer: CustomerListItem;
  x: number;
  y: number;
};
type MessageContextMenuState = {
  messageId: string;
  customerId: string;
  x: number;
  y: number;
};

function normalizeMessageType(value: unknown): "TEXT" | "IMAGE" | "STICKER" | "UNKNOWN" {
  const normalized = String(value || "").trim().toUpperCase();
  if (normalized === "TEXT") return "TEXT";
  if (normalized === "IMAGE") return "IMAGE";
  if (normalized === "STICKER") return "STICKER";
  return "UNKNOWN";
}
type PresetSnippet = {
  id: string;
  title: string;
  content: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};
type PendingUploadImage = {
  url: string;
  originalName: string;
  size: number;
  contentType: string | null;
};
type OptimisticWorkspaceMessage = WorkspaceMessage & {
  isOptimistic: true;
  replyDraftSetId?: string;
  suggestionVariant?: "STABLE" | "ADVANCING" | null;
};
type CustomerListStats = {
  overdueFollowupCount: number;
  totalUnreadCount: number;
};
type WorkspaceCacheEntry = {
  workspace: WorkspaceData;
  loadedAt: number;
  lastAccessedAt: number;
};
type CustomerTagItem = {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
};
type CustomerListViewportAnchor =
  | {
      kind: "customer";
      customerId: string;
      offsetTop: number;
      scrollTop: number;
    }
  | {
      kind: "scrollTop";
      scrollTop: number;
    };

type PreserveCustomerListViewportOptions = {
  excludeCustomerIdFromAnchor?: string | null;
  excludeCustomerIdsFromAnchor?: string[];
};
type MarkReadPendingEntry = {
  startedAt: number;
  startedRequestId: number;
};
const CUSTOMER_PAGE_SIZE = 30;
const CUSTOMER_REFRESH_LIMIT_MAX = 50;
const OPTIMISTIC_ID_PREFIX = "optimistic:";
const WORKSPACE_CACHE_MAX = 30;
const WORKSPACE_CACHE_TTL_MS = 30 * 60 * 1000;
const WORKSPACE_PREFETCH_TOP_MAX = 0;
const WORKSPACE_PREFETCH_NEAR_MAX = 0;
const MANUAL_MESSAGE_MAX_CHARS = 4500;

function countManualMessageChars(value: string) {
  return Array.from(value.replace(/\r\n/g, "\n")).length;
}
const WORKSPACE_PREFETCH_QUEUE_MAX = 20;
const WORKSPACE_PREFETCH_CONCURRENCY = 1;
const DEBUG_CUSTOMER_SCROLL_DEFER_STATS =
  process.env.NODE_ENV !== "production" &&
  String(process.env.NEXT_PUBLIC_DEBUG_CUSTOMER_SCROLL_DEFER || "").trim() === "1";
const WORKSPACE_PREFETCH_IDLE_DELAY_MS = 300;
const DEBUG_STATE_LOGS =
  process.env.NODE_ENV !== "production" &&
  String(process.env.NEXT_PUBLIC_DEBUG_STATE_LOGS || "").trim() === "1";

function isAbortError(error: unknown) {
  return (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError");
}
function getDisplayName(customer: Pick<CustomerListItem, "remarkName" | "originalName"> | null | undefined) {
  if (!customer) return "未选择顾客";
  return customer.remarkName?.trim() || customer.originalName || "未命名顾客";
}
function getAvatarText(customer: Pick<CustomerListItem, "remarkName" | "originalName" | "followup"> | null) {
  if (customer?.followup?.tier) return customer.followup.tier;
  const text = getDisplayName(customer);
  return text.slice(0, 1).toUpperCase();
}
function getAvatarTone(tier?: FollowupSummary["tier"] | null) {
  if (tier === "A") {
    return "bg-emerald-100 text-emerald-700 ring-1 ring-emerald-200";
  }
  if (tier === "B") {
    return "bg-amber-100 text-amber-700 ring-1 ring-amber-200";
  }
  if (tier === "C") {
    return "bg-slate-200 text-slate-700 ring-1 ring-slate-300";
  }
  return "bg-pink-100 text-pink-700";
}
function getFollowupBucketLabel(bucket?: FollowupSummary["bucket"] | null) {
  return bucket === "VIP" ? "VIP已成交" : "未成交";
}
function getFollowupTierLabel(tier?: FollowupSummary["tier"] | null) {
  return tier ? `${tier}级` : "未分层";
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
function shouldShowRefollowNotice(dateString: string | null, status?: "ACTIVE" | "UNFOLLOWED") {
  if (status !== "ACTIVE" || !dateString) return false;
  const time = new Date(dateString).getTime();
  if (!Number.isFinite(time)) return false;
  return Date.now() - time < 1000 * 60 * 60 * 24 * 3;
}
function getRelationshipBadge(status?: "ACTIVE" | "UNFOLLOWED") {
  if (status === "UNFOLLOWED") {
    return { text: "已取消关注", className: "bg-rose-50 text-rose-700 border border-rose-200" };
  }
  return null;
}
function getSecondaryName(customer: Pick<CustomerListItem, "remarkName" | "originalName"> | null | undefined) {
  if (!customer) return "";
  const remark = customer.remarkName?.trim() || "";
  if (remark) return "";
  return customer.originalName || "";
}
function getListMetaText(customer: Pick<CustomerListItem, "stage" | "isVip">) {
  if (customer.isVip) return "VIP";
  if (customer.stage === "NEW") return "";
  return customer.stage || "";
}
function formatListTime(dateString: string | null) {
  if (!dateString) return "";
  const date = new Date(dateString);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString("ja-JP", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function formatBubbleTime(dateString: string) {
  return new Date(dateString).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function getDeliveryStatusMeta(message: WorkspaceMessage) {
  if (message.role !== "OPERATOR") {
    return null;
  }
  switch (message.deliveryStatus) {
    case "FAILED":
      return { label: "发送失败", className: "text-red-500" };
    case "PENDING":
      return { label: "发送中", className: "text-amber-500" };
    case "SENT":
      return { label: "已发送", className: "text-gray-400" };
    default:
      return null;
  }
}
function buildPreviewTextFromMessage(message: Pick<WorkspaceMessage, "role" | "type" | "japaneseText">) {
  const baseText =
    message.type === "IMAGE"
      ? "[图片]"
      : message.type === "STICKER"
        ? "[贴图]"
        : message.japaneseText.trim() || "[空消息]";
  return `${message.role === "OPERATOR" ? "我：" : ""}${baseText}`;
}
function buildCustomerLatestMessage(message: WorkspaceMessage | OptimisticWorkspaceMessage): CustomerListItem["latestMessage"] {
  return {
    id: message.id,
    role: message.role,
    type: message.type,
    source: message.source,
    japaneseText: message.japaneseText,
    chineseText: message.chineseText,
    deliveryStatus: message.deliveryStatus,
    sendError: message.sendError,
    sentAt: message.sentAt,
    previewText: buildPreviewTextFromMessage(message),
  };
}
function sortCustomerList(list: CustomerListItem[]) {
  return [...list].sort((a, b) => {
    const aPinned = a.pinnedAt ? new Date(a.pinnedAt).getTime() : 0;
    const bPinned = b.pinnedAt ? new Date(b.pinnedAt).getTime() : 0;

    if (aPinned || bPinned) {
      if (!aPinned) return 1;
      if (!bPinned) return -1;
      if (bPinned !== aPinned) return bPinned - aPinned;
    }

    const aLast = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const bLast = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    if (bLast !== aLast) return bLast - aLast;

    return a.originalName.localeCompare(b.originalName, "zh-CN");
  });
}
function mergeWorkspaceMessages(
  baseMessages: WorkspaceMessage[],
  optimisticMessages: OptimisticWorkspaceMessage[]
) {
  const merged = [...baseMessages, ...optimisticMessages];
  merged.sort((a, b) => {
    const aTime = new Date(a.sentAt).getTime();
    const bTime = new Date(b.sentAt).getTime();
    if (aTime !== bTime) return aTime - bTime;
    return a.id.localeCompare(b.id);
  });
  return merged;
}
function isOptimisticMessageId(messageId: string) {
  return messageId.startsWith(OPTIMISTIC_ID_PREFIX);
}
function normalizeWorkspaceMessagePayload(payload: unknown): WorkspaceMessage | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const value = payload as Record<string, unknown>;
  if (typeof value.id !== "string") {
    return null;
  }
  return {
    id: String(value.id),
    customerId: String(value.customerId || ""),
    role: value.role as WorkspaceMessage["role"],
    type: value.type as WorkspaceMessage["type"],
    source: value.source as WorkspaceMessage["source"],
    lineMessageId: typeof value.lineMessageId === "string" ? value.lineMessageId : null,
    japaneseText: typeof value.japaneseText === "string" ? value.japaneseText : "",
    chineseText: typeof value.chineseText === "string" ? value.chineseText : null,
    imageUrl: typeof value.imageUrl === "string" ? value.imageUrl : null,
    stickerPackageId: typeof value.stickerPackageId === "string" ? value.stickerPackageId : null,
    stickerId: typeof value.stickerId === "string" ? value.stickerId : null,
    deliveryStatus: (value.deliveryStatus as WorkspaceMessage["deliveryStatus"]) ?? null,
    sendError: typeof value.sendError === "string" ? value.sendError : null,
    lastAttemptAt: typeof value.lastAttemptAt === "string" ? value.lastAttemptAt : null,
    failedAt: typeof value.failedAt === "string" ? value.failedAt : null,
    retryCount: Number(value.retryCount ?? 0),
    sentAt: String(value.sentAt || ""),
    createdAt: typeof value.createdAt === "string" ? value.createdAt : String(value.sentAt || ""),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : String(value.sentAt || ""),
  };
}
function debugStateLog(label: string, payload: Record<string, unknown>) {
  if (!DEBUG_STATE_LOGS) return;
  console.info(label, payload);
}
function formatDateTimeForInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function buildDefaultScheduledInputValue() {
  const date = new Date();
  date.setMinutes(date.getMinutes() + 30);
  date.setSeconds(0, 0);
  const minutes = date.getMinutes();
  const roundedMinutes = minutes <= 30 ? 30 : 0;
  if (roundedMinutes === 0) {
    date.setHours(date.getHours() + 1);
  }
  date.setMinutes(roundedMinutes, 0, 0);
  return formatDateTimeForInput(date);
}
function formatScheduledTime(dateString: string) {
  const date = new Date(dateString);
  if (!Number.isFinite(date.getTime())) return "时间格式错误";
  return date.toLocaleString("ja-JP", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function getScheduledMessageStatusMeta(status: ScheduledMessageItem["status"]) {
  switch (status) {
    case "PENDING":
      return { label: "待发送", className: "bg-amber-50 text-amber-700 border border-amber-200" };
    case "PROCESSING":
      return { label: "发送中", className: "bg-sky-50 text-sky-700 border border-sky-200" };
    case "FAILED":
      return { label: "发送失败", className: "bg-rose-50 text-rose-700 border border-rose-200" };
    default:
      return { label: status, className: "bg-slate-50 text-slate-700 border border-slate-200" };
  }
}
function formatDividerTime(dateString: string) {
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
function shouldShowMessageDivider(previousMessage: WorkspaceMessage | null, currentMessage: WorkspaceMessage) {
  if (!previousMessage) return true;
  const previousDate = new Date(previousMessage.sentAt);
  const currentDate = new Date(currentMessage.sentAt);
  const previousDayKey = `${previousDate.getFullYear()}-${previousDate.getMonth()}-${previousDate.getDate()}`;
  const currentDayKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}-${currentDate.getDate()}`;
  if (previousDayKey !== currentDayKey) return true;
  const gap = currentDate.getTime() - previousDate.getTime();
  return gap >= 30 * 60 * 1000;
}
function HomePageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requestedCustomerId = searchParams.get("customerId") || "";
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [customerStats, setCustomerStats] = useState<CustomerListStats>({ overdueFollowupCount: 0, totalUnreadCount: 0 });
  const [customerPage, setCustomerPage] = useState(1);
  const [hasMoreCustomers, setHasMoreCustomers] = useState(false);
  const [regularNextCursor, setRegularNextCursor] = useState<string | null>(null);
  const [isLoadingMoreCustomers, setIsLoadingMoreCustomers] = useState(false);
  const [optimisticMessagesByCustomer, setOptimisticMessagesByCustomer] = useState<Record<string, OptimisticWorkspaceMessage[]>>({});
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [loggingOut, setLoggingOut] = useState(false);
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);
  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");
  const [rewriteInput, setRewriteInput] = useState("");
  const [manualReply, setManualReply] = useState("");
  const [customReply, setCustomReply] = useState<RewriteResult | null>(null);
  const [customerContextMenu, setCustomerContextMenu] =
    useState<CustomerContextMenuState | null>(null);
  const [messageContextMenu, setMessageContextMenu] = useState<MessageContextMenuState | null>(null);
  const [allTags, setAllTags] = useState<CustomerTagItem[]>([]);
  const [isLoadingTags, setIsLoadingTags] = useState(false);
  const [isTagSubmenuOpen, setIsTagSubmenuOpen] = useState(false);
  const [isTagCreateDialogOpen, setIsTagCreateDialogOpen] = useState(false);
  const [tagDialogTargetCustomerId, setTagDialogTargetCustomerId] = useState("");
  const [newTagName, setNewTagName] = useState("");
  const [isCreatingTag, setIsCreatingTag] = useState(false);
  const [tagCreateError, setTagCreateError] = useState("");
  const [updatingCustomerTagKey, setUpdatingCustomerTagKey] = useState("");
  const [isTagDeleteDialogOpen, setIsTagDeleteDialogOpen] = useState(false);
  const [tagDeleteTarget, setTagDeleteTarget] = useState<CustomerTagItem | null>(null);
  const [tagDeleteTargetCustomerId, setTagDeleteTargetCustomerId] = useState("");
  const [isDeletingTag, setIsDeletingTag] = useState(false);
  const [tagDeleteError, setTagDeleteError] = useState("");
  const [isComposerMenuOpen, setIsComposerMenuOpen] = useState(false);
  const [isPresetPanelOpen, setIsPresetPanelOpen] = useState(false);
  const [presetSnippets, setPresetSnippets] = useState<PresetSnippet[]>([]);
  const [isPresetLoading, setIsPresetLoading] = useState(false);
  const [isPresetSaving, setIsPresetSaving] = useState(false);
  const [editingPresetId, setEditingPresetId] = useState("");
  const [presetTitle, setPresetTitle] = useState("");
  const [presetContent, setPresetContent] = useState("");
  const [pendingImages, setPendingImages] = useState<PendingUploadImage[]>([]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isComposerDragOver, setIsComposerDragOver] = useState(false);
  const [isListLoading, setIsListLoading] = useState(true);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [generatingByCustomer, setGeneratingByCustomer] = useState<Record<string, boolean>>({});
  const [isSchedulingManual, setIsSchedulingManual] = useState(false);
  const [isSchedulePanelOpen, setIsSchedulePanelOpen] = useState(false);
  const [scheduleAtInput, setScheduleAtInput] = useState(() => buildDefaultScheduledInputValue());
  const [retryingMessageId, setRetryingMessageId] = useState("");
  const [isSendingAi, setIsSendingAi] = useState<"stable" | "advancing" | "">("");
  const [isPostGenerateSyncing, setIsPostGenerateSyncing] = useState(false);
  const [postGenerateSyncMessage, setPostGenerateSyncMessage] = useState("");
  const [pageError, setPageError] = useState("");
  const [apiError, setApiError] = useState("");
  const [aiNotice, setAiNotice] = useState("");
  const [copyPromptStatus, setCopyPromptStatus] = useState<CopyPromptStatus>("idle");
  const [opNotice, setOpNotice] = useState("");
  const [translatingMessageIds, setTranslatingMessageIds] = useState<Record<string, boolean>>({});
  const messageContextMenuRef = useRef<HTMLDivElement | null>(null);
  const tagSubmenuCloseTimerRef = useRef<number | null>(null);
  const clearCustomerQuery = useCallback(() => {
    if (!requestedCustomerId) return;
    router.replace(pathname, { scroll: false });
  }, [pathname, requestedCustomerId, router]);
  const showOpNotice = useCallback((text: string) => {
    setOpNotice(text);
    if (opNoticeTimerRef.current != null) {
      window.clearTimeout(opNoticeTimerRef.current);
    }
    opNoticeTimerRef.current = window.setTimeout(() => {
      setOpNotice("");
      opNoticeTimerRef.current = null;
    }, 1800);
  }, []);
  const clearCopyPromptResetTimer = useCallback(() => {
    if (copyPromptResetTimerRef.current != null) {
      window.clearTimeout(copyPromptResetTimerRef.current);
      copyPromptResetTimerRef.current = null;
    }
  }, []);
  const scheduleCopyPromptStatusReset = useCallback((delayMs = 2000) => {
    clearCopyPromptResetTimer();
    copyPromptResetTimerRef.current = window.setTimeout(() => {
      setCopyPromptStatus("idle");
      copyPromptResetTimerRef.current = null;
    }, delayMs);
  }, [clearCopyPromptResetTimer]);
  const closeMessageContextMenu = useCallback(() => {
    setMessageContextMenu(null);
  }, []);
  const cancelTagSubmenuClose = useCallback(() => {
    if (tagSubmenuCloseTimerRef.current != null) {
      window.clearTimeout(tagSubmenuCloseTimerRef.current);
      tagSubmenuCloseTimerRef.current = null;
    }
  }, []);
  const scheduleTagSubmenuClose = useCallback(() => {
    cancelTagSubmenuClose();
    tagSubmenuCloseTimerRef.current = window.setTimeout(() => {
      setIsTagSubmenuOpen(false);
      tagSubmenuCloseTimerRef.current = null;
    }, 120);
  }, [cancelTagSubmenuClose]);
  const resetTagCreateDialogState = useCallback(() => {
    setIsTagCreateDialogOpen(false);
    setNewTagName("");
    setTagCreateError("");
    setTagDialogTargetCustomerId("");
    setIsCreatingTag(false);
  }, []);
  const resetTagDeleteDialogState = useCallback(() => {
    setIsTagDeleteDialogOpen(false);
    setTagDeleteTarget(null);
    setTagDeleteTargetCustomerId("");
    setTagDeleteError("");
    setIsDeletingTag(false);
  }, []);
  const ensureAudioReady = useCallback(async () => {
    try {
      const AudioContextClass =
        typeof window !== "undefined"
          ? (window.AudioContext ||
              (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
          : undefined;
      if (!AudioContextClass) return null;
      const context = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = context;
      if (context.state === "suspended") {
        await context.resume();
      }
      audioEnabledRef.current = true;
      return context;
    } catch (error) {
      console.error("audio ensure error:", error);
      return null;
    }
  }, []);
  const playDingDongSound = useCallback(async () => {
    const now = Date.now();
    if (now - lastIncomingSoundAtRef.current < 900) return;
    lastIncomingSoundAtRef.current = now;
    try {
      const context = await ensureAudioReady();
      if (!context) return;

      const buildNote = (params: {
        start: number;
        duration: number;
        mainFreq: number;
        bodyFreq: number;
        peak: number;
      }) => {
        const { start, duration, mainFreq, bodyFreq, peak } = params;
        const end = start + duration;

        const mainGain = context.createGain();
        mainGain.gain.setValueAtTime(0.0001, start);
        mainGain.connect(context.destination);
        const mainOsc = context.createOscillator();
        mainOsc.type = "sine";
        mainOsc.frequency.setValueAtTime(mainFreq, start);
        mainOsc.connect(mainGain);
        mainGain.gain.exponentialRampToValueAtTime(peak, start + 0.014);
        mainGain.gain.exponentialRampToValueAtTime(0.0001, end);
        mainOsc.start(start);
        mainOsc.stop(end);

        const bodyGain = context.createGain();
        bodyGain.gain.setValueAtTime(0.0001, start);
        bodyGain.connect(context.destination);
        const bodyOsc = context.createOscillator();
        bodyOsc.type = "sine";
        bodyOsc.frequency.setValueAtTime(bodyFreq, start);
        bodyOsc.connect(bodyGain);
        bodyGain.gain.exponentialRampToValueAtTime(peak * 0.2, start + 0.016);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, end);
        bodyOsc.start(start);
        bodyOsc.stop(end);
      };

      const note1Start = context.currentTime;
      const note2Start = note1Start + 0.18;
      buildNote({
        start: note1Start,
        duration: 0.2,
        mainFreq: 660,
        bodyFreq: 294,
        peak: 0.3,
      });
      buildNote({
        start: note2Start,
        duration: 0.28,
        mainFreq: 520,
        bodyFreq: 220,
        peak: 0.25,
      });
    } catch (error) {
      console.error("incoming sound error:", error);
    }
  }, [ensureAudioReady]);
  const playSoftTickSound = useCallback(async (kind: "tap" | "success" = "tap") => {
    try {
      const context = await ensureAudioReady();
      if (!context) return;
      const osc = context.createOscillator();
      const gain = context.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(kind === "success" ? 460 : 400, context.currentTime);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(kind === "success" ? 0.075 : 0.055, context.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + (kind === "success" ? 0.09 : 0.07));
      osc.connect(gain);
      gain.connect(context.destination);
      osc.start(context.currentTime);
      osc.stop(context.currentTime + (kind === "success" ? 0.09 : 0.07));
    } catch (error) {
      console.error("ui sound error:", error);
    }
  }, [ensureAudioReady]);
  const resizeManualReplyTextarea = useCallback(() => {
    const textarea = manualReplyTextareaRef.current;
    if (!textarea) return;
    const minHeight = 44;
    const maxHeight = 176;
    textarea.style.height = "auto";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), maxHeight);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
  }, []);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const customerListScrollRef = useRef<HTMLDivElement | null>(null);
  const customerListLoadMoreRef = useRef<HTMLDivElement | null>(null);
  const manualReplyTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerInputRowRef = useRef<HTMLDivElement | null>(null);
  const manualReplyResizeFrameRef = useRef<number | null>(null);
  const customersRef = useRef<CustomerListItem[]>([]);
  const customerPageRef = useRef(1);
  const hasMoreCustomersRef = useRef(false);
  const regularNextCursorRef = useRef<string | null>(null);
  const requestedRegularCursorsRef = useRef<Set<string>>(new Set());
  const searchKeywordRef = useRef("");
  const isCustomerListRequestInFlightRef = useRef(false);
  const customerListInFlightKindRef = useRef<"loadMore" | "refresh" | "initial" | null>(null);
  const customerListRequestIdRef = useRef(0);
  const customerListAbortControllerRef = useRef<AbortController | null>(null);
  const isSilentRefreshingRef = useRef(false);
  const workspaceRequestIdRef = useRef(0);
  const workspaceAbortControllerRef = useRef<AbortController | null>(null);
  const isRealtimeRefreshInFlightRef = useRef(false);
  const pendingRealtimeRefreshRef = useRef(false);
  const pendingRealtimeRefreshCustomerIdRef = useRef<string | null>(null);
  const selectedCustomerIdRef = useRef("");
  const copyPromptRequestSeqRef = useRef(0);
  const copyPromptActiveRef = useRef<{ requestId: number; customerId: string } | null>(null);
  const copyPromptResetTimerRef = useRef<number | null>(null);
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const ablyClientRef = useRef<Ably.Realtime | null>(null);
  const markReadInFlightRef = useRef(new Set<string>());
  const markReadPendingRef = useRef<Map<string, MarkReadPendingEntry>>(new Map());
  const markReadConfirmedAtRef = useRef<Map<string, number>>(new Map());
  const markReadAwaitingAuthoritativeRef = useRef<Set<string>>(new Set());
  const composerMenuRef = useRef<HTMLDivElement | null>(null);
  const schedulePanelRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const manualSendInFlightKeysRef = useRef<Set<string>>(new Set());
  const openChatToBottomRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const lastOpenedCustomerIdRef = useRef("");
  const playedInboundMessageIdsRef = useRef<Set<string>>(new Set());
  const opNoticeTimerRef = useRef<number | null>(null);
  const audioEnabledRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastIncomingSoundAtRef = useRef(0);
  const generationPollersRef = useRef<Record<string, {
    taskId: string;
    timerId: number | null;
    abortController: AbortController | null;
  }>>({});
  const customerListLatestScrollTopRef = useRef(0);
  const customerListUserScrollUntilRef = useRef(0);
  const customerSummaryDeferredTimerRef = useRef<number | null>(null);
  const customerSummaryDeferredCountRef = useRef(0);
  const customerSummaryDeferredDelayTotalMsRef = useRef(0);
  const recentLocalRefreshAtRef = useRef<Record<string, number>>({});
  const workspaceCacheRef = useRef<Map<string, WorkspaceCacheEntry>>(new Map());
  const workspacePrefetchQueueRef = useRef<string[]>([]);
  const workspacePrefetchInFlightRef = useRef<Set<string>>(new Set());
  const workspacePrefetchRunningRef = useRef(false);
  const workspaceTopPrefetchTriggeredRef = useRef(false);
  const workspacePrefetchTimerRef = useRef<number | null>(null);
  const workspacePrefetchBatchIdRef = useRef(0);
  const customerSummaryRequestSeqRef = useRef<Map<string, number>>(new Map());
  const customerStatsRequestIdRef = useRef(0);
  const customerStatsRefreshTimerRef = useRef<number | null>(null);
  const customerSummaryPreferredReasonsRef = useRef(
    new Set([
      "inbound-message",
      "bridge-inbound-message",
      "inbound-message-created",
      "bridge-inbound-history",
      "outbound-message-queued",
      "bridge-outbound-sent",
      "bridge-outbound-failed",
      "bridge-outbound-timeout",
      "customer-meta-updated",
      "bridge-customer-updated",
      "bridge-thread-status",
    ])
  );
  const workspaceRefreshReasonsRef = useRef(
    new Set([
      "translation-updated",
      "generation-updated",
      "generation-reused",
      "outbound-message-queued",
      "bridge-outbound-sent",
      "bridge-outbound-failed",
      "bridge-outbound-timeout",
      "inbound-message",
      "bridge-inbound-message",
    ])
  );
  const inboundSoundReasonsRef = useRef(
    new Set(["inbound-message"])
  );
  useEffect(() => {
    return () => {
      if (tagSubmenuCloseTimerRef.current != null) {
        window.clearTimeout(tagSubmenuCloseTimerRef.current);
      }
      customerListAbortControllerRef.current?.abort();
      workspaceAbortControllerRef.current?.abort();
      if (workspacePrefetchTimerRef.current != null) {
        window.clearTimeout(workspacePrefetchTimerRef.current);
      }
      Object.values(generationPollersRef.current).forEach((poller) => {
        if (poller.timerId != null) {
          window.clearTimeout(poller.timerId);
        }
        poller.abortController?.abort();
      });
      generationPollersRef.current = {};
      if (opNoticeTimerRef.current != null) {
        window.clearTimeout(opNoticeTimerRef.current);
      }
      if (copyPromptResetTimerRef.current != null) {
        window.clearTimeout(copyPromptResetTimerRef.current);
      }
      if (customerStatsRefreshTimerRef.current != null) {
        window.clearTimeout(customerStatsRefreshTimerRef.current);
      }
      if (customerSummaryDeferredTimerRef.current != null) {
        window.clearTimeout(customerSummaryDeferredTimerRef.current);
      }
    };
  }, []);
  const captureCustomerListAnchor = useCallback((options?: PreserveCustomerListViewportOptions): CustomerListViewportAnchor | null => {
    const container = customerListScrollRef.current;
    if (!container) return null;
    const excludedIds = new Set(
      [
        options?.excludeCustomerIdFromAnchor || "",
        ...(options?.excludeCustomerIdsFromAnchor || []),
      ]
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    );
    const cards = Array.from(container.querySelectorAll<HTMLElement>("[data-customer-id]"));
    if (!cards.length) return null;
    const containerTop = container.getBoundingClientRect().top;
    let anchorCard: HTMLElement | null = null;
    for (const card of cards) {
      const customerId = String(card.dataset.customerId || "").trim();
      if (!customerId || excludedIds.has(customerId)) {
        continue;
      }
      const rect = card.getBoundingClientRect();
      if (rect.bottom >= containerTop) {
        anchorCard = card;
        break;
      }
    }
    if (!anchorCard) {
      for (let i = cards.length - 1; i >= 0; i -= 1) {
        const customerId = String(cards[i]?.dataset.customerId || "").trim();
        if (!customerId || excludedIds.has(customerId)) {
          continue;
        }
        anchorCard = cards[i] ?? null;
        break;
      }
    }
    if (!anchorCard) {
      return {
        kind: "scrollTop",
        scrollTop: container.scrollTop,
      };
    }
    const customerId = anchorCard?.dataset.customerId || "";
    if (!customerId) {
      return {
        kind: "scrollTop",
        scrollTop: container.scrollTop,
      };
    }
    return {
      kind: "customer",
      customerId,
      offsetTop: anchorCard.getBoundingClientRect().top - containerTop,
      scrollTop: container.scrollTop,
    };
  }, []);
  const restoreCustomerListAnchor = useCallback((anchor: CustomerListViewportAnchor | null) => {
    if (!anchor) return;
    requestAnimationFrame(() => {
      const container = customerListScrollRef.current;
      if (!container) return;
      const threshold = 4;
      const latestScrollTop = customerListLatestScrollTopRef.current;
      const currentScrollTop = container.scrollTop;
      const userMovedByLatest = Math.abs(latestScrollTop - anchor.scrollTop) > threshold;
      const userMovedNow = Math.abs(currentScrollTop - anchor.scrollTop) > threshold;
      if (userMovedByLatest || userMovedNow) return;
      if (anchor.kind === "scrollTop") {
        container.scrollTop = anchor.scrollTop;
        customerListLatestScrollTopRef.current = container.scrollTop;
        return;
      }

      const anchorCard = Array.from(
        container.querySelectorAll<HTMLElement>("[data-customer-id]")
      ).find((item) => item.dataset.customerId === anchor.customerId);
      if (!anchorCard) {
        container.scrollTop = anchor.scrollTop;
        customerListLatestScrollTopRef.current = container.scrollTop;
        return;
      }
      const containerTop = container.getBoundingClientRect().top;
      const nextOffsetTop = anchorCard.getBoundingClientRect().top - containerTop;
      container.scrollTop += nextOffsetTop - anchor.offsetTop;
      customerListLatestScrollTopRef.current = container.scrollTop;
    });
  }, []);
  const preserveCustomerListViewport = useCallback((
    apply: () => void,
    options?: PreserveCustomerListViewportOptions
  ) => {
    const anchor = captureCustomerListAnchor(options);
    apply();
    restoreCustomerListAnchor(anchor);
  }, [captureCustomerListAnchor, restoreCustomerListAnchor]);
  const scheduleManualReplyTextareaResize = useCallback(() => {
    if (typeof window === "undefined") return;
    if (manualReplyResizeFrameRef.current != null) {
      window.cancelAnimationFrame(manualReplyResizeFrameRef.current);
    }
    manualReplyResizeFrameRef.current = window.requestAnimationFrame(() => {
      manualReplyResizeFrameRef.current = null;
      resizeManualReplyTextarea();
    });
  }, [resizeManualReplyTextarea]);
  const cleanupWorkspaceCache = useCallback(() => {
    const now = Date.now();
    const cache = workspaceCacheRef.current;

    for (const [customerId, entry] of cache.entries()) {
      if (now - entry.loadedAt > WORKSPACE_CACHE_TTL_MS) {
        cache.delete(customerId);
      }
    }

    if (cache.size <= WORKSPACE_CACHE_MAX) return;

    const sorted = [...cache.entries()].sort((a, b) => a[1].lastAccessedAt - b[1].lastAccessedAt);
    const overflow = cache.size - WORKSPACE_CACHE_MAX;
    for (let i = 0; i < overflow; i += 1) {
      const customerId = sorted[i]?.[0];
      if (customerId) {
        cache.delete(customerId);
      }
    }
  }, []);
  const getCachedWorkspace = useCallback((customerId: string) => {
    if (!customerId) return null;
    cleanupWorkspaceCache();
    const cache = workspaceCacheRef.current;
    const entry = cache.get(customerId);
    if (!entry) return null;
    const now = Date.now();
    if (now - entry.loadedAt > WORKSPACE_CACHE_TTL_MS) {
      cache.delete(customerId);
      return null;
    }
    entry.lastAccessedAt = now;
    cache.set(customerId, entry);
    debugStateLog("[workspace-cache] hit", {
      requestedCustomerId: customerId,
      cachedCustomerId: entry.workspace?.customer?.id || null,
    });
    if (entry.workspace?.customer?.id && entry.workspace.customer.id !== customerId) {
      debugStateLog("[workspace-cache] mismatch", {
        requestedCustomerId: customerId,
        cachedCustomerId: entry.workspace.customer.id,
      });
    }
    return entry.workspace;
  }, [cleanupWorkspaceCache]);
  const setCachedWorkspace = useCallback((customerId: string, workspaceValue: WorkspaceData | null) => {
    if (!customerId || !workspaceValue) return;
    const now = Date.now();
    workspaceCacheRef.current.set(customerId, {
      workspace: workspaceValue,
      loadedAt: now,
      lastAccessedAt: now,
    });
    cleanupWorkspaceCache();
  }, [cleanupWorkspaceCache]);
  const patchWorkspaceCache = useCallback((customerId: string, updater: (workspaceValue: WorkspaceData) => WorkspaceData) => {
    if (!customerId) return;
    const cache = workspaceCacheRef.current;
    const entry = cache.get(customerId);
    if (!entry) return;
    const now = Date.now();
    if (now - entry.loadedAt > WORKSPACE_CACHE_TTL_MS) {
      cache.delete(customerId);
      return;
    }
    const nextWorkspace = updater(entry.workspace);
    cache.set(customerId, {
      workspace: nextWorkspace,
      loadedAt: now,
      lastAccessedAt: now,
    });
    cleanupWorkspaceCache();
  }, [cleanupWorkspaceCache]);
  const invalidateWorkspaceCache = useCallback((customerId: string) => {
    if (!customerId) return;
    workspaceCacheRef.current.delete(customerId);
  }, []);
  const getUnreadProtectionReason = useCallback((customerId: string, requestStartedAt?: number) => {
    if (!customerId) return null as string | null;
    if (customerId === selectedCustomerIdRef.current) {
      return "selected-customer";
    }
    if (markReadPendingRef.current.has(customerId)) {
      return "mark-read-pending";
    }
    if (markReadAwaitingAuthoritativeRef.current.has(customerId)) {
      const confirmedAt = markReadConfirmedAtRef.current.get(customerId) ?? 0;
      if (requestStartedAt && requestStartedAt <= confirmedAt) {
        return "awaiting-authoritative-refresh";
      }
      markReadAwaitingAuthoritativeRef.current.delete(customerId);
      markReadConfirmedAtRef.current.delete(customerId);
    }
    return null;
  }, []);
  const applyReadProtectionToCustomer = useCallback(
    (
      customer: CustomerListItem,
      options?: { requestId?: number; requestStartedAt?: number; enableLog?: boolean }
    ) => {
      const reason = getUnreadProtectionReason(customer.id, options?.requestStartedAt);
      const protectedUnread = reason && customer.unreadCount > 0 ? 0 : customer.unreadCount;
      if (options?.enableLog && process.env.NODE_ENV !== "production" && customer.unreadCount > 0) {
        console.info("[customers-load] response-customer", {
          requestId: options.requestId,
          customerId: customer.id,
          returnedUnread: customer.unreadCount,
          protectedUnread,
        });
      }
      if (reason && customer.unreadCount > 0) {
        debugStateLog("[unread-protection] applied", {
          customerId: customer.id,
          reason,
          originalUnread: customer.unreadCount,
        });
        if (options?.enableLog && process.env.NODE_ENV !== "production") {
          console.info("[customers-load] stale-unread-ignored", {
            requestId: options.requestId,
            customerId: customer.id,
            returnedUnread: customer.unreadCount,
            reason,
          });
          console.info("[sound] incoming-suppressed", {
            customerId: customer.id,
            reason,
          });
        }
        return {
          ...customer,
          unreadCount: 0,
        };
      }
      return customer;
    },
    [getUnreadProtectionReason]
  );
  const applyReadProtectionToCustomers = useCallback(
    (items: CustomerListItem[], options?: { requestId?: number; requestStartedAt?: number; enableLog?: boolean }) =>
      items.map((item) => applyReadProtectionToCustomer(item, options)),
    [applyReadProtectionToCustomer]
  );
  const scheduleWorkspacePrefetchDrain = useCallback(() => {
    if (workspacePrefetchTimerRef.current != null) return;
    const run = () => {
      workspacePrefetchTimerRef.current = null;
      if (workspacePrefetchRunningRef.current) return;
      if (workspacePrefetchInFlightRef.current.size >= WORKSPACE_PREFETCH_CONCURRENCY) return;
      const customerId = workspacePrefetchQueueRef.current.shift();
      if (!customerId) return;
      const batchId = workspacePrefetchBatchIdRef.current;
      workspacePrefetchRunningRef.current = true;
      workspacePrefetchInFlightRef.current.add(customerId);
      debugStateLog("[workspace-prefetch] start", { customerId, batchId });
      void (async () => {
        try {
          const response = await fetch(`/api/customers/${customerId}/workspace`, { cache: "no-store" });
          const data = await response.json();
          if (!response.ok || !data?.ok) {
            debugStateLog("[workspace-prefetch] failed", { customerId, batchId, error: data?.error || `http_${response.status}` });
            return;
          }
          const nextWorkspace: WorkspaceData | null = data.workspace || null;
          if (nextWorkspace) {
            setCachedWorkspace(customerId, nextWorkspace);
            debugStateLog("[workspace-prefetch] cached", {
              customerId,
              workspaceCustomerId: nextWorkspace.customer?.id || null,
              batchId,
            });
          } else {
            debugStateLog("[workspace-prefetch] skipped", { customerId, reason: "empty-workspace", batchId });
          }
        } catch (error) {
          debugStateLog("[workspace-prefetch] failed", {
            customerId,
            batchId,
            error: error instanceof Error ? error.message : String(error),
          });
          // Keep prefetch failures silent.
        } finally {
          workspacePrefetchInFlightRef.current.delete(customerId);
          workspacePrefetchRunningRef.current = false;
          if (workspacePrefetchQueueRef.current.length > 0) {
            scheduleWorkspacePrefetchDrain();
          }
        }
      })();
    };

    if (typeof window !== "undefined") {
      const requestIdleCallbackFn = (window as Window & {
        requestIdleCallback?: (callback: () => void) => number;
      }).requestIdleCallback;
      if (typeof requestIdleCallbackFn === "function") {
        requestIdleCallbackFn(run);
        return;
      }
    }
    if (typeof window !== "undefined") {
      workspacePrefetchTimerRef.current = window.setTimeout(run, WORKSPACE_PREFETCH_IDLE_DELAY_MS);
      return;
    }
  }, [setCachedWorkspace]);
  const enqueueWorkspacePrefetch = useCallback(
    (customerIds: string[], options?: { replacePending?: boolean; selectedId?: string | null }) => {
      if (WORKSPACE_PREFETCH_NEAR_MAX <= 0) {
        if (options?.replacePending) {
          workspacePrefetchQueueRef.current = [];
          workspacePrefetchBatchIdRef.current += 1;
        }
        return;
      }
      const selectedId = options?.selectedId || null;
      const candidateBatch = customerIds
        .map((item) => item.trim())
        .filter((item) => !!item)
        .slice(0, WORKSPACE_PREFETCH_NEAR_MAX);
      const nextIds: string[] = [];
      for (const customerId of candidateBatch) {
        if (!customerId) continue;
        if (selectedId && customerId === selectedId) {
          debugStateLog("[workspace-prefetch] skipped", { customerId, reason: "selected-customer" });
          continue;
        }
        if (workspacePrefetchInFlightRef.current.has(customerId)) {
          debugStateLog("[workspace-prefetch] skipped", { customerId, reason: "in-flight" });
          continue;
        }
        if (workspacePrefetchQueueRef.current.includes(customerId) || nextIds.includes(customerId)) {
          debugStateLog("[workspace-prefetch] skipped", { customerId, reason: "already-queued" });
          continue;
        }
        if (getCachedWorkspace(customerId)) {
          debugStateLog("[workspace-prefetch] skipped", { customerId, reason: "cache-hit" });
          continue;
        }
        nextIds.push(customerId);
      }
      if (!nextIds.length && !options?.replacePending) return;
      if (options?.replacePending) {
        workspacePrefetchQueueRef.current = [];
        workspacePrefetchBatchIdRef.current += 1;
      }
      workspacePrefetchQueueRef.current = [...workspacePrefetchQueueRef.current, ...nextIds];
      if (workspacePrefetchQueueRef.current.length > WORKSPACE_PREFETCH_QUEUE_MAX) {
        workspacePrefetchQueueRef.current = workspacePrefetchQueueRef.current.slice(
          workspacePrefetchQueueRef.current.length - WORKSPACE_PREFETCH_QUEUE_MAX
        );
      }
      for (const customerId of nextIds) {
        debugStateLog("[workspace-prefetch] queued", { customerId, batchId: workspacePrefetchBatchIdRef.current });
      }
      scheduleWorkspacePrefetchDrain();
    },
    [getCachedWorkspace, scheduleWorkspacePrefetchDrain]
  );
  const loadPresetSnippets = useCallback(async () => {
    try {
      setIsPresetLoading(true);
      const response = await fetch("/api/preset-messages", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "读取预设信息失败");
      }
      setPresetSnippets(data.items || []);
    } catch (error) {
      console.error(error);
      window.alert("读取预设信息失败，请查看终端报错");
    } finally {
      setIsPresetLoading(false);
    }
  }, []);
  const loadCustomers = useCallback(
    async (options?: {
      silent?: boolean;
      preserveUi?: boolean;
      loadMore?: boolean;
      reset?: boolean;
      search?: string;
      limitOverride?: number;
      debugCustomerId?: string;
      excludeCustomerIdFromAnchor?: string | null;
    }) => {
      const shouldPreserveListUi = !!options?.silent || !!options?.preserveUi || !!options?.loadMore;
      const listAnchor = shouldPreserveListUi
        ? captureCustomerListAnchor({
            excludeCustomerIdFromAnchor: options?.excludeCustomerIdFromAnchor,
          })
        : null;
      const isLoadMore = !!options?.loadMore;
      const activeSearch = options?.search ?? searchKeywordRef.current;
      const isSearching = !!activeSearch.trim();
      const isPreserveUiRefresh = !isLoadMore && shouldPreserveListUi;
      const useCursorLoadMore = isLoadMore && !isSearching;
      const limit = Math.max(options?.limitOverride ?? CUSTOMER_PAGE_SIZE, CUSTOMER_PAGE_SIZE);
      const page = isLoadMore ? customerPageRef.current + 1 : 1;
      const cursorToUse = useCursorLoadMore ? regularNextCursorRef.current : null;

      if (isCustomerListRequestInFlightRef.current && isLoadMore) {
        return;
      }
      if (
        isPreserveUiRefresh &&
        isCustomerListRequestInFlightRef.current &&
        customerListInFlightKindRef.current === "loadMore"
      ) {
        return;
      }
      if (useCursorLoadMore) {
        if (!cursorToUse) return;
        if (requestedRegularCursorsRef.current.has(cursorToUse)) {
          return;
        }
        requestedRegularCursorsRef.current.add(cursorToUse);
      }

      const requestId = customerListRequestIdRef.current + 1;
      const requestStartedAt = Date.now();
      customerListRequestIdRef.current = requestId;
      if (process.env.NODE_ENV !== "production") {
        console.info("[customers-load] start", { requestId });
      }
      const abortController = new AbortController();
      if (!(isPreserveUiRefresh && customerListInFlightKindRef.current === "loadMore")) {
        customerListAbortControllerRef.current?.abort();
      }
      customerListAbortControllerRef.current = abortController;
      let requestSucceeded = false;

      try {
        isCustomerListRequestInFlightRef.current = true;
        customerListInFlightKindRef.current = isLoadMore ? "loadMore" : shouldPreserveListUi ? "refresh" : "initial";
        if (isLoadMore) {
          setIsLoadingMoreCustomers(true);
        } else if (!options?.silent && !shouldPreserveListUi) {
          setIsListLoading(true);
        }
        setPageError("");

        const params = new URLSearchParams();
        params.set("limit", String(limit));
        if (isSearching) {
          params.set("page", String(page));
          params.set("q", activeSearch);
        } else if (useCursorLoadMore && cursorToUse) {
          params.set("cursor", cursorToUse);
        }
        if (options?.debugCustomerId) {
          params.set("debugCustomerId", options.debugCustomerId);
        }

        const response = await fetch(`/api/customers?${params.toString()}`, {
          cache: "no-store",
          signal: abortController.signal,
        });
        const data = await response.json();
        if (response.status === 400 && data?.error === "invalid_cursor") {
          console.error("load customers invalid cursor:", {
            isLoadMore,
            cursor: cursorToUse,
            search: activeSearch,
          });
          if (useCursorLoadMore) {
            setHasMoreCustomers(false);
            setRegularNextCursor(null);
            hasMoreCustomersRef.current = false;
            regularNextCursorRef.current = null;
          }
          return;
        }
        if (!response.ok || !data.ok) {
          throw new Error(data?.error || "读取顾客列表失败");
        }

        if (requestId !== customerListRequestIdRef.current) {
          return;
        }

        const rawList: CustomerListItem[] = data.customers || [];
        const list = applyReadProtectionToCustomers(rawList, {
          requestId,
          requestStartedAt,
          enableLog: true,
        });
        const nextHasMore = !!data.hasMore;
        const nextPage = Number(data.page || page);
        const nextCursor = typeof data.nextCursor === "string" && data.nextCursor.trim() ? data.nextCursor.trim() : null;
        const shouldPreserveExistingCustomers =
          !isLoadMore &&
          !isSearching &&
          shouldPreserveListUi;

        setCustomers((prev) => {
          const prevUnreadMap = new Map(prev.map((item) => [item.id, item.unreadCount]));
          if (isLoadMore) {
            const merged = new Map<string, CustomerListItem>();
            for (const item of prev) merged.set(item.id, item);
            for (const item of list) merged.set(item.id, item);
            const next = sortCustomerList(applyReadProtectionToCustomers(Array.from(merged.values())));
            debugStateLog("[customers-state] set", { source: "loadCustomers:loadMore", count: next.length });
            for (const item of next) {
              if (item.unreadCount > 0) {
                debugStateLog("[customers-state] customer-unread", {
                  source: "loadCustomers:loadMore",
                  customerId: item.id,
                  unreadCount: item.unreadCount,
                  selectedCustomerId: selectedCustomerIdRef.current || null,
                });
              }
              const previousUnread = prevUnreadMap.get(item.id) ?? 0;
              if (previousUnread === 0 && item.unreadCount > 0) {
                debugStateLog("[customers-state] unread-reappeared", {
                  customerId: item.id,
                  previousUnread,
                  nextUnread: item.unreadCount,
                  source: "loadCustomers:loadMore",
                });
              }
            }
            return next;
          }
          const fetchedIds = new Set(list.map((item) => item.id));
          const preservedExistingCustomers = shouldPreserveExistingCustomers
            ? prev.filter((item) => !item.pinnedAt && !fetchedIds.has(item.id))
            : [];
          const replaceBase = [...list, ...preservedExistingCustomers];
          const next = sortCustomerList(applyReadProtectionToCustomers(replaceBase));
          debugStateLog("[customers-state] set", { source: "loadCustomers:replace", count: next.length });
          for (const item of next) {
            if (item.unreadCount > 0) {
              debugStateLog("[customers-state] customer-unread", {
                source: "loadCustomers:replace",
                customerId: item.id,
                unreadCount: item.unreadCount,
                selectedCustomerId: selectedCustomerIdRef.current || null,
              });
            }
            const previousUnread = prevUnreadMap.get(item.id) ?? 0;
            if (previousUnread === 0 && item.unreadCount > 0) {
              debugStateLog("[customers-state] unread-reappeared", {
                customerId: item.id,
                previousUnread,
                nextUnread: item.unreadCount,
                source: "loadCustomers:replace",
              });
            }
          }
          return next;
        });

        const loadedPinnedCountAfterFetch = list.filter((item) => !!item.pinnedAt).length;
        const loadedRegularCountAfterFetch = Math.max(0, list.length - loadedPinnedCountAfterFetch);
        const nextPageValue =
          !isSearching && !isLoadMore
            ? Math.max(1, Math.ceil(loadedRegularCountAfterFetch / CUSTOMER_PAGE_SIZE))
            : nextPage;
        const nextRegularCursorValue = isSearching ? null : nextCursor;

        setCustomerPage(nextPageValue);
        setRegularNextCursor(nextRegularCursorValue);
        setHasMoreCustomers(nextHasMore);
        customerPageRef.current = nextPageValue;
        regularNextCursorRef.current = nextRegularCursorValue;
        hasMoreCustomersRef.current = nextHasMore;
        searchKeywordRef.current = activeSearch;
        if (!useCursorLoadMore) {
          requestedRegularCursorsRef.current.clear();
        }
        requestSucceeded = true;

        setSelectedCustomerId((prev) => {
          if (prev && list.some((item) => item.id === prev)) return prev;
          if (prev && customersRef.current.some((item) => item.id === prev)) return prev;
          return prev;
        });

        if (shouldPreserveListUi) {
          restoreCustomerListAnchor(listAnchor);
        }
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        console.error(error);
        if (requestId === customerListRequestIdRef.current) {
          setPageError(String(error));
        }
      } finally {
        if (useCursorLoadMore && cursorToUse && !requestSucceeded) {
          requestedRegularCursorsRef.current.delete(cursorToUse);
        }
        if (requestId === customerListRequestIdRef.current) {
          isCustomerListRequestInFlightRef.current = false;
          customerListInFlightKindRef.current = null;
          if (customerListAbortControllerRef.current === abortController) {
            customerListAbortControllerRef.current = null;
          }
          setIsLoadingMoreCustomers(false);
          if (!isLoadMore) {
            setIsListLoading(false);
          }
        }
      }
    },
    [applyReadProtectionToCustomers, captureCustomerListAnchor, restoreCustomerListAnchor]
  );
  const loadCustomerStats = useCallback(async (options?: { debounceMs?: number }) => {
    const debounceMs = Math.max(0, options?.debounceMs ?? 0);
    const run = async () => {
      const requestId = customerStatsRequestIdRef.current + 1;
      customerStatsRequestIdRef.current = requestId;
      try {
        const response = await fetch("/api/customers/stats", {
          cache: "no-store",
        });
        const data = await response.json();
        if (!response.ok || !data?.ok || !data?.stats) {
          throw new Error(data?.error || "读取顾客统计失败");
        }
        if (requestId !== customerStatsRequestIdRef.current) {
          return;
        }
        setCustomerStats({
          overdueFollowupCount: Number(data.stats.overdueFollowupCount || 0),
          totalUnreadCount: Number(data.stats.totalUnreadCount || 0),
        });
      } catch (error) {
        console.error("load customer stats error:", error);
      }
    };

    if (debounceMs <= 0) {
      await run();
      return;
    }
    if (customerStatsRefreshTimerRef.current != null) {
      window.clearTimeout(customerStatsRefreshTimerRef.current);
    }
    customerStatsRefreshTimerRef.current = window.setTimeout(() => {
      customerStatsRefreshTimerRef.current = null;
      void run();
    }, debounceMs);
  }, []);
  const loadAllTags = useCallback(async () => {
    try {
      setIsLoadingTags(true);
      const response = await fetch("/api/tags", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !data?.ok || !Array.isArray(data.tags)) {
        throw new Error(data?.error || "failed_to_load_tags");
      }
      setAllTags(
        data.tags
          .map((item: { id?: unknown; name?: unknown; color?: unknown; sortOrder?: unknown }) => ({
            id: String(item?.id || ""),
            name: String(item?.name || ""),
            color: item?.color == null ? null : String(item.color),
            sortOrder: Number(item?.sortOrder || 0),
          }))
          .filter((item: CustomerTagItem) => !!item.id && !!item.name)
          .sort((a: CustomerTagItem, b: CustomerTagItem) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
      );
    } catch (error) {
      console.error("load all tags error:", error);
    } finally {
      setIsLoadingTags(false);
    }
  }, []);
  const markCustomerRead = useCallback(async (
    customerId: string,
    options?: { reason?: string; previousUnread?: number }
  ) => {
    const reason = options?.reason || "unknown";
    const previousUnread = options?.previousUnread ?? null;
    if (!customerId) {
      debugStateLog("[mark-read] skipped", { customerId, reason: "empty-customer-id" });
      return;
    }
    if (markReadInFlightRef.current.has(customerId)) {
      debugStateLog("[mark-read] skipped", { customerId, reason: "in-flight" });
      return;
    }
    const startedAt = Date.now();
    const startedRequestId = customerListRequestIdRef.current;
    markReadInFlightRef.current.add(customerId);
    markReadPendingRef.current.set(customerId, { startedAt, startedRequestId });
    debugStateLog("[mark-read] start", { customerId, previousUnread, reason });
    try {
      const response = await fetch(`/api/customers/${customerId}/workspace`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          markRead: true,
        }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "mark read failed");
      }
      debugStateLog("[mark-read] success", { customerId });
      markReadPendingRef.current.delete(customerId);
      markReadConfirmedAtRef.current.set(customerId, Date.now());
      markReadAwaitingAuthoritativeRef.current.add(customerId);
      recentLocalRefreshAtRef.current[customerId] = Date.now();
      void loadCustomerStats({ debounceMs: 120 });
    } catch (error) {
      debugStateLog("[mark-read] failed", {
        customerId,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error("mark customer read error:", error);
      markReadPendingRef.current.delete(customerId);
      markReadConfirmedAtRef.current.delete(customerId);
      markReadAwaitingAuthoritativeRef.current.delete(customerId);
    } finally {
      markReadInFlightRef.current.delete(customerId);
    }
  }, [loadCustomerStats]);
  const loadWorkspace = useCallback(
    async (customerId: string, options?: { preserveUi?: boolean; source?: string; cacheOnly?: boolean }) => {
      const source = options?.source || "unknown";
      const cacheOnly = !!options?.cacheOnly;
      if (!customerId) {
        workspaceAbortControllerRef.current?.abort();
        workspaceAbortControllerRef.current = null;
        setWorkspace(null);
        return;
      }

      const preserveUi = !!options?.preserveUi;
      const isSelectedAtStart = selectedCustomerIdRef.current === customerId;
      const canMutateUiAtStart = !cacheOnly && isSelectedAtStart;
      debugStateLog("[workspace-load] guard-check", {
        requestId: workspaceRequestIdRef.current + (canMutateUiAtStart ? 1 : 0),
        requestedCustomerId: customerId,
        currentSelectedCustomerId: selectedCustomerIdRef.current,
        source,
        cacheOnly,
        allowUiUpdate: canMutateUiAtStart,
      });
      const cachedWorkspace = getCachedWorkspace(customerId);
      const shouldUseCachedUi = !!cachedWorkspace && canMutateUiAtStart;
      if (cachedWorkspace) {
        debugStateLog("[workspace-load] cache-hit", {
          customerId,
          workspaceCustomerId: cachedWorkspace.customer?.id || null,
          source,
        });
        if (cachedWorkspace.customer?.id && cachedWorkspace.customer.id !== customerId) {
          debugStateLog("[workspace-load] mismatch", {
            requestId: "cache-hit",
            requestedCustomerId: customerId,
            workspaceCustomerId: cachedWorkspace.customer.id,
          });
        }
        if (canMutateUiAtStart) {
          setWorkspace(cachedWorkspace);
          setPageError("");
          setIsWorkspaceLoading(false);
        } else {
          debugStateLog("[workspace-load] ignored-stale", {
            requestedCustomerId: customerId,
            currentSelectedCustomerId: selectedCustomerIdRef.current,
            source: "cache-hit",
          });
        }
      }

      const shouldPreserveUi = preserveUi || shouldUseCachedUi;
      const requestId = canMutateUiAtStart
        ? workspaceRequestIdRef.current + 1
        : workspaceRequestIdRef.current;
      if (canMutateUiAtStart) {
        workspaceRequestIdRef.current = requestId;
      }
      debugStateLog("[workspace-load] start", { requestId, customerId, source });
      const abortController = new AbortController();
      if (canMutateUiAtStart) {
        workspaceAbortControllerRef.current?.abort();
        workspaceAbortControllerRef.current = abortController;
      }

      const container = chatScrollRef.current;
      let previousScrollTop = 0;
      let previousScrollHeight = 0;
      let wasNearBottom = false;
      if (canMutateUiAtStart && shouldPreserveUi && container) {
        previousScrollTop = container.scrollTop;
        previousScrollHeight = container.scrollHeight;
        wasNearBottom =
          container.scrollHeight - container.scrollTop - container.clientHeight < 80;
        isSilentRefreshingRef.current = true;
      }

      try {
        if (canMutateUiAtStart && !shouldPreserveUi) {
          setIsWorkspaceLoading(true);
          setPageError("");
          setCustomReply(null);
          setRewriteInput("");
          setManualReply("");
          setPendingImages([]);
          setApiError("");
          setAiNotice("");
        }
        const response = await fetch(`/api/customers/${customerId}/workspace`, {
          cache: "no-store",
          signal: abortController.signal,
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data?.error || "读取顾客会话失败");
        }

        if (canMutateUiAtStart && requestId !== workspaceRequestIdRef.current) {
          debugStateLog("[workspace-load] ignored-stale", {
            requestId,
            requestedCustomerId: customerId,
            currentSelectedCustomerId: selectedCustomerIdRef.current,
            source,
          });
          return;
        }

        const nextWorkspace: WorkspaceData | null = data.workspace || null;
        if (nextWorkspace?.customer?.id && nextWorkspace.customer.id !== customerId) {
          debugStateLog("[workspace-load] mismatch", {
            requestId,
            requestedCustomerId: customerId,
            workspaceCustomerId: nextWorkspace.customer.id,
          });
        }
        debugStateLog("[workspace-load] workspace-customer-unread", {
          customerId: nextWorkspace?.customer?.id || customerId,
          unreadCount: nextWorkspace?.customer?.unreadCount ?? null,
          source,
        });
        setCachedWorkspace(customerId, nextWorkspace);

        const isStillSelected = selectedCustomerIdRef.current === customerId;
        const canMutateUiNow = canMutateUiAtStart && !cacheOnly && isStillSelected;
        if (!canMutateUiNow) {
          debugStateLog("[workspace-load] ignored-stale", {
            requestId,
            requestedCustomerId: customerId,
            currentSelectedCustomerId: selectedCustomerIdRef.current,
            source,
          });
          if (nextWorkspace?.customer) {
            debugStateLog("[customers-state] workspace-customer-merge-skipped", {
              source,
              customerId: nextWorkspace.customer.id,
              currentSelectedCustomerId: selectedCustomerIdRef.current,
              reason: cacheOnly ? "cache-only" : "not-selected",
            });
          }
          return;
        }

        debugStateLog("[workspace-load] set", {
          requestId,
          requestedCustomerId: customerId,
          workspaceCustomerId: nextWorkspace?.customer?.id || null,
          currentSelectedCustomerId: selectedCustomerIdRef.current,
          source,
        });
        setWorkspace(nextWorkspace);
        if (nextWorkspace?.customer) {
          preserveCustomerListViewport(
            () => {
              setCustomers((prev) => {
                const merged = prev.map((item) =>
                  item.id === nextWorkspace.customer.id
                    ? {
                        ...item,
                        remarkName: nextWorkspace.customer.remarkName,
                        pinnedAt: nextWorkspace.customer.pinnedAt,
                        unreadCount: item.id === customerId ? 0 : nextWorkspace.customer.unreadCount,
                        followup: nextWorkspace.customer.followup,
                      }
                    : item
                );
                debugStateLog("[customers-state] workspace-customer-merge", {
                  source,
                  customerId: nextWorkspace.customer.id,
                  unreadCount: nextWorkspace.customer.unreadCount,
                });
                return sortCustomerList(applyReadProtectionToCustomers(merged));
              });
            },
            {
              excludeCustomerIdFromAnchor: nextWorkspace.customer.id,
            }
          );
        } else {
          debugStateLog("[customers-state] workspace-customer-merge-skipped", {
            source,
            customerId,
            currentSelectedCustomerId: selectedCustomerIdRef.current,
            reason: "no-customer-in-workspace",
          });
        }
        if (shouldPreserveUi) {
          requestAnimationFrame(() => {
            const el = chatScrollRef.current;
            if (!el) return;
            if (wasNearBottom) {
              el.scrollTop = el.scrollHeight;
            } else {
              const heightDiff = el.scrollHeight - previousScrollHeight;
              el.scrollTop = previousScrollTop + heightDiff;
            }
          });
        }
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        console.error(error);
        if (canMutateUiAtStart && !shouldPreserveUi && requestId === workspaceRequestIdRef.current) {
          setWorkspace(null);
          setPageError(String(error));
        } else if (canMutateUiAtStart && requestId === workspaceRequestIdRef.current) {
          setPageError(String(error));
        }
      } finally {
        if (canMutateUiAtStart && requestId === workspaceRequestIdRef.current) {
          if (!shouldUseCachedUi) {
            setIsWorkspaceLoading(false);
          }
          if (workspaceAbortControllerRef.current === abortController) {
            workspaceAbortControllerRef.current = null;
          }
          isSilentRefreshingRef.current = false;
        }
      }
    },
    [applyReadProtectionToCustomers, getCachedWorkspace, preserveCustomerListViewport, setCachedWorkspace]
  );
  const runRealtimeRefresh = useCallback(
    async (targetCustomerId?: string | null) => {
      const nextTargetCustomerId = targetCustomerId || selectedCustomerIdRef.current || null;
      if (isRealtimeRefreshInFlightRef.current) {
        pendingRealtimeRefreshRef.current = true;
        if (nextTargetCustomerId) {
          pendingRealtimeRefreshCustomerIdRef.current = nextTargetCustomerId;
        }
        return;
      }

      isRealtimeRefreshInFlightRef.current = true;
      try {
        const activeCustomerId = selectedCustomerIdRef.current;
        if (nextTargetCustomerId && activeCustomerId && nextTargetCustomerId !== activeCustomerId) {
          invalidateWorkspaceCache(nextTargetCustomerId);
        }
        const loadedRegularCount = Math.max(
          0,
          customersRef.current.filter((item) => !item.pinnedAt).length
        );
        await loadCustomers({
          silent: true,
          preserveUi: true,
          limitOverride: Math.min(Math.max(loadedRegularCount, CUSTOMER_PAGE_SIZE), CUSTOMER_REFRESH_LIMIT_MAX),
          search: searchKeywordRef.current,
          excludeCustomerIdFromAnchor: nextTargetCustomerId,
        });
        void loadCustomerStats({ debounceMs: 200 });
        if (activeCustomerId && (!nextTargetCustomerId || nextTargetCustomerId === activeCustomerId)) {
          await loadWorkspace(activeCustomerId, { preserveUi: true, source: "realtime-refresh" });
        }
      } finally {
        isRealtimeRefreshInFlightRef.current = false;
        if (pendingRealtimeRefreshRef.current) {
          const queuedCustomerId = pendingRealtimeRefreshCustomerIdRef.current;
          pendingRealtimeRefreshRef.current = false;
          pendingRealtimeRefreshCustomerIdRef.current = null;
          void runRealtimeRefresh(queuedCustomerId);
        }
      }
    },
    [invalidateWorkspaceCache, loadCustomerStats, loadCustomers, loadWorkspace]
  );
  const refreshCustomerSummary = useCallback(
    async (customerId: string, options?: { preserveUi?: boolean }) => {
      const normalizedId = String(customerId || "").trim();
      if (!normalizedId) return;
      const lastSeq = customerSummaryRequestSeqRef.current.get(normalizedId) ?? 0;
      const localSeq = lastSeq + 1;
      customerSummaryRequestSeqRef.current.set(normalizedId, localSeq);
      try {
        const response = await fetch(`/api/customers/${normalizedId}/summary`, {
          cache: "no-store",
        });
        const latestSeq = customerSummaryRequestSeqRef.current.get(normalizedId) ?? 0;
        if (latestSeq !== localSeq) {
          return;
        }
        const data = await response.json();
        if (response.status === 404) {
          return;
        }
        if (!response.ok || !data?.ok || !data?.customer) {
          throw new Error(data?.error || "refresh customer summary failed");
        }
        const nextCustomer = data.customer as CustomerListItem;
        const applySummary = () => {
          const latestSeq = customerSummaryRequestSeqRef.current.get(normalizedId) ?? 0;
          if (latestSeq !== localSeq) return;
          setCustomers((prev) => {
            const targetIndex = prev.findIndex((item) => item.id === normalizedId);
            if (targetIndex < 0) {
              return sortCustomerList(applyReadProtectionToCustomers([...prev, nextCustomer]));
            }

            const target = prev[targetIndex];
            const sortKeyUnchanged =
              target.pinnedAt === nextCustomer.pinnedAt &&
              target.lastMessageAt === nextCustomer.lastMessageAt &&
              target.originalName === nextCustomer.originalName;

            const next = [...prev];
            next[targetIndex] = nextCustomer;
            if (sortKeyUnchanged) {
              return applyReadProtectionToCustomers(next);
            }
            return sortCustomerList(applyReadProtectionToCustomers(next));
          });
        };
        const shouldDeferForUserScroll =
          !!options?.preserveUi && Date.now() < customerListUserScrollUntilRef.current;
        if (options?.preserveUi) {
          const applyWithViewport = () =>
            preserveCustomerListViewport(applySummary, {
              excludeCustomerIdFromAnchor: normalizedId,
            });
          if (shouldDeferForUserScroll) {
            if (customerSummaryDeferredTimerRef.current != null) {
              window.clearTimeout(customerSummaryDeferredTimerRef.current);
            }
            const delayMs = Math.max(80, customerListUserScrollUntilRef.current - Date.now());
            if (DEBUG_CUSTOMER_SCROLL_DEFER_STATS) {
              customerSummaryDeferredCountRef.current += 1;
              customerSummaryDeferredDelayTotalMsRef.current += delayMs;
              const count = customerSummaryDeferredCountRef.current;
              if (count === 1 || count % 10 === 0) {
                console.info("[customer-summary] deferred-during-scroll", {
                  count,
                  avgDelayMs: Math.round(customerSummaryDeferredDelayTotalMsRef.current / count),
                  latestDelayMs: delayMs,
                });
              }
            }
            customerSummaryDeferredTimerRef.current = window.setTimeout(() => {
              customerSummaryDeferredTimerRef.current = null;
              applyWithViewport();
            }, delayMs);
          } else {
            applyWithViewport();
          }
        } else {
          applySummary();
        }
        void loadCustomerStats({ debounceMs: 200 });
      } catch (error) {
        console.error("refresh customer summary error:", error);
      }
    },
    [applyReadProtectionToCustomers, loadCustomerStats, preserveCustomerListViewport]
  );
  const addOptimisticMessage = useCallback((customerId: string, message: OptimisticWorkspaceMessage) => {
    setOptimisticMessagesByCustomer((prev) => {
      const nextList = [...(prev[customerId] || []).filter((item) => item.id !== message.id), message];
      return {
        ...prev,
        [customerId]: nextList,
      };
    });
  }, []);
  const updateOptimisticMessage = useCallback(
    (
      customerId: string,
      messageId: string,
      updater: (message: OptimisticWorkspaceMessage) => OptimisticWorkspaceMessage
    ) => {
      setOptimisticMessagesByCustomer((prev) => {
        const currentList = prev[customerId] || [];
        const nextList = currentList.map((item) => (item.id === messageId ? updater(item) : item));
        return {
          ...prev,
          [customerId]: nextList,
        };
      });
    },
    []
  );
  const removeOptimisticMessage = useCallback((customerId: string, messageId: string) => {
    setOptimisticMessagesByCustomer((prev) => {
      const currentList = prev[customerId] || [];
      const nextList = currentList.filter((item) => item.id !== messageId);
      if (!nextList.length) {
        const nextState = { ...prev };
        delete nextState[customerId];
        return nextState;
      }
      return {
        ...prev,
        [customerId]: nextList,
      };
    });
  }, []);
  const upsertWorkspaceMessage = useCallback((customerId: string, message: WorkspaceMessage) => {
    setWorkspace((prev) => {
      if (!prev || prev.customer.id !== customerId) return prev;
      const nextMessages = [...prev.messages.filter((item) => item.id !== message.id), message].sort((a, b) => {
        const aTime = new Date(a.sentAt).getTime();
        const bTime = new Date(b.sentAt).getTime();
        if (aTime !== bTime) return aTime - bTime;
        return a.id.localeCompare(b.id);
      });
      return {
        ...prev,
        customer: {
          ...prev.customer,
          lastMessageAt: message.sentAt,
        },
        messages: nextMessages,
      };
    });
    patchWorkspaceCache(customerId, (workspaceValue) => {
      const nextMessages = [...workspaceValue.messages.filter((item) => item.id !== message.id), message].sort((a, b) => {
        const aTime = new Date(a.sentAt).getTime();
        const bTime = new Date(b.sentAt).getTime();
        if (aTime !== bTime) return aTime - bTime;
        return a.id.localeCompare(b.id);
      });
      return {
        ...workspaceValue,
        customer: {
          ...workspaceValue.customer,
          lastMessageAt: message.sentAt,
        },
        messages: nextMessages,
      };
    });
  }, [patchWorkspaceCache]);
  const updateWorkspaceMessage = useCallback(
    (
      customerId: string,
      messageId: string,
      updater: (message: WorkspaceMessage) => WorkspaceMessage
    ) => {
      setWorkspace((prev) => {
        if (!prev || prev.customer.id !== customerId) return prev;
        return {
          ...prev,
          messages: prev.messages.map((item) => (item.id === messageId ? updater(item) : item)),
        };
      });
      patchWorkspaceCache(customerId, (workspaceValue) => ({
        ...workspaceValue,
        messages: workspaceValue.messages.map((item) => (item.id === messageId ? updater(item) : item)),
      }));
    },
    [patchWorkspaceCache]
  );
  const updateCustomerLatestMessage = useCallback(
    (customerId: string, message: WorkspaceMessage | OptimisticWorkspaceMessage) => {
      preserveCustomerListViewport(
        () => {
          setCustomers((prev) =>
            sortCustomerList(
              applyReadProtectionToCustomers(prev.map((item) =>
                item.id === customerId
                  ? {
                      ...item,
                      lastMessageAt: message.sentAt,
                      latestMessage: buildCustomerLatestMessage(message),
                    }
                  : item
              ))
            )
          );
          debugStateLog("[customers-state] set", { source: "updateCustomerLatestMessage" });
        },
        {
          excludeCustomerIdFromAnchor: customerId,
        }
      );
    },
    [applyReadProtectionToCustomers, preserveCustomerListViewport]
  );
  const attachAsyncTranslation = useCallback(async (messageId: string, japaneseText: string) => {
    if (!messageId || !japaneseText.trim()) return;
    try {
      const translateResponse = await fetch("/api/translate-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          japanese: japaneseText,
        }),
      });
      const translateData = await translateResponse.json();
      if (!translateResponse.ok || !translateData.ok || !translateData.chinese) {
        return;
      }
      await fetch(`/api/messages/${messageId}/translation`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          chineseText: translateData.chinese,
        }),
      });
    } catch (error) {
      console.error("translate patch error:", error);
    }
  }, []);
  const submitOutboundMessage = useCallback(
    async (params: {
      customerId: string;
      japaneseText: string;
      chineseText?: string | null;
      imageUrl?: string | null;
      stickerPackageId?: string | null;
      stickerId?: string | null;
      type: "TEXT" | "IMAGE" | "STICKER";
      source: MessageSource;
      replyDraftSetId?: string;
      suggestionVariant?: "STABLE" | "ADVANCING";
      optimisticMessageId?: string;
    }) => {
      debugStateLog("[user-action] send-message", { customerId: params.customerId, source: params.source, type: params.type });
      const sentAt = new Date().toISOString();
      const optimisticId = params.optimisticMessageId || `${OPTIMISTIC_ID_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const baseOptimisticMessage: OptimisticWorkspaceMessage = {
        id: optimisticId,
        customerId: params.customerId,
        role: "OPERATOR",
        type: params.type,
        source: params.source,
        lineMessageId: null,
        japaneseText: params.japaneseText,
        chineseText: params.chineseText ?? null,
        imageUrl: params.type === "IMAGE" ? params.imageUrl ?? null : null,
        stickerPackageId: params.type === "STICKER" ? params.stickerPackageId ?? null : null,
        stickerId: params.type === "STICKER" ? params.stickerId ?? null : null,
        deliveryStatus: "PENDING",
        sendError: null,
        lastAttemptAt: sentAt,
        failedAt: null,
        retryCount: 0,
        sentAt,
        createdAt: sentAt,
        updatedAt: sentAt,
        isOptimistic: true,
        replyDraftSetId: params.replyDraftSetId,
        suggestionVariant: params.suggestionVariant ?? null,
      };

      if (params.optimisticMessageId) {
        updateOptimisticMessage(params.customerId, params.optimisticMessageId, () => baseOptimisticMessage);
      } else {
        addOptimisticMessage(params.customerId, baseOptimisticMessage);
      }
      updateCustomerLatestMessage(params.customerId, baseOptimisticMessage);

      try {
        const response = await fetch(`/api/customers/${params.customerId}/messages`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            japaneseText: params.japaneseText,
            chineseText: params.chineseText ?? "",
            imageUrl: params.imageUrl || "",
            stickerPackageId: params.stickerPackageId || "",
            stickerId: params.stickerId || "",
            source: params.source,
            type: params.type,
            replyDraftSetId: params.replyDraftSetId || "",
            suggestionVariant: params.suggestionVariant || "",
          }),
        });
        const data = await response.json();
        const serverMessage = normalizeWorkspaceMessagePayload(data?.message);

        if (!response.ok || !data.ok) {
          if (serverMessage) {
            upsertWorkspaceMessage(params.customerId, serverMessage);
            updateCustomerLatestMessage(params.customerId, serverMessage);
            removeOptimisticMessage(params.customerId, optimisticId);
          } else {
            const errorMessage = data?.error || "消息发送失败";
            updateOptimisticMessage(params.customerId, optimisticId, (message) => ({
              ...message,
              deliveryStatus: "FAILED",
              sendError: errorMessage,
              failedAt: new Date().toISOString(),
              lastAttemptAt: new Date().toISOString(),
            }));
          }
          return { ok: false };
        }

        if (serverMessage) {
          upsertWorkspaceMessage(params.customerId, serverMessage);
          updateCustomerLatestMessage(params.customerId, serverMessage);
          removeOptimisticMessage(params.customerId, optimisticId);
          const hasProvidedChinese = typeof params.chineseText === "string" && !!params.chineseText.trim();
          if (params.type === "TEXT" && !hasProvidedChinese) {
            void attachAsyncTranslation(serverMessage.id, params.japaneseText);
          }
        }

        return { ok: true };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        updateOptimisticMessage(params.customerId, optimisticId, (message) => ({
          ...message,
          deliveryStatus: "FAILED",
          sendError: errorMessage,
          failedAt: new Date().toISOString(),
          lastAttemptAt: new Date().toISOString(),
        }));
        return { ok: false };
      }
    },
    [
      addOptimisticMessage,
      attachAsyncTranslation,
      removeOptimisticMessage,
      updateCustomerLatestMessage,
      updateOptimisticMessage,
      upsertWorkspaceMessage,
    ]
  );
  const patchCustomerMeta = useCallback(
    async (
      customerId: string,
      payload: { pinned?: boolean; remarkName?: string | null; markRead?: boolean }
    ) => {
      const previousCustomers = customersRef.current;
      const previousWorkspace = workspace;

      preserveCustomerListViewport(
        () => {
          setCustomers((prev) =>
            sortCustomerList(
              applyReadProtectionToCustomers(prev.map((item) => {
                if (item.id !== customerId) return item;
                return {
                  ...item,
                  ...(payload.remarkName !== undefined
                    ? { remarkName: payload.remarkName?.trim() || null }
                    : {}),
                  ...(payload.pinned !== undefined
                    ? { pinnedAt: payload.pinned ? new Date().toISOString() : null }
                    : {}),
                  ...(payload.markRead ? { unreadCount: 0 } : {}),
                };
              }))
            )
          );
        },
        {
          excludeCustomerIdFromAnchor: customerId,
        }
      );
      if (selectedCustomerIdRef.current === customerId) {
        setWorkspace((prev) => {
          if (!prev || prev.customer.id !== customerId) return prev;
          return {
            ...prev,
            customer: {
              ...prev.customer,
              ...(payload.remarkName !== undefined
                ? { remarkName: payload.remarkName?.trim() || null }
                : {}),
              ...(payload.pinned !== undefined
                ? { pinnedAt: payload.pinned ? new Date().toISOString() : null }
                : {}),
              ...(payload.markRead ? { unreadCount: 0 } : {}),
            },
          };
        });
        patchWorkspaceCache(customerId, (workspaceValue) => ({
          ...workspaceValue,
          customer: {
            ...workspaceValue.customer,
            ...(payload.remarkName !== undefined
              ? { remarkName: payload.remarkName?.trim() || null }
              : {}),
            ...(payload.pinned !== undefined
              ? { pinnedAt: payload.pinned ? new Date().toISOString() : null }
              : {}),
            ...(payload.markRead ? { unreadCount: 0 } : {}),
          },
        }));
      }

      const response = await fetch(`/api/customers/${customerId}/workspace`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        setCustomers(applyReadProtectionToCustomers(previousCustomers));
        setWorkspace(previousWorkspace);
        if (previousWorkspace?.customer?.id === customerId) {
          setCachedWorkspace(customerId, previousWorkspace);
        }
        throw new Error(data?.error || "更新顾客信息失败");
      }

      const nextCustomer = data.customer;
      preserveCustomerListViewport(
        () => {
          setCustomers((prev) =>
            sortCustomerList(
              applyReadProtectionToCustomers(prev.map((item) =>
                item.id === customerId
                  ? {
                      ...item,
                      remarkName: nextCustomer.remarkName,
                      pinnedAt: nextCustomer.pinnedAt,
                      unreadCount: nextCustomer.unreadCount,
                    }
                  : item
              ))
            )
          );
        },
        {
          excludeCustomerIdFromAnchor: customerId,
        }
      );
      if (selectedCustomerIdRef.current === customerId) {
        setWorkspace((prev) => {
          if (!prev || prev.customer.id !== customerId) return prev;
          return {
            ...prev,
            customer: {
              ...prev.customer,
              remarkName: nextCustomer.remarkName,
              pinnedAt: nextCustomer.pinnedAt,
              unreadCount: nextCustomer.unreadCount,
            },
          };
        });
        patchWorkspaceCache(customerId, (workspaceValue) => ({
          ...workspaceValue,
          customer: {
            ...workspaceValue.customer,
            remarkName: nextCustomer.remarkName,
            pinnedAt: nextCustomer.pinnedAt,
            unreadCount: nextCustomer.unreadCount,
          },
        }));
      }
    },
    [applyReadProtectionToCustomers, patchWorkspaceCache, preserveCustomerListViewport, setCachedWorkspace, workspace]
  );
  useEffect(() => {
    customersRef.current = customers;
  }, [customers]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearchText(searchText.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchText]);
  useEffect(() => {
    customerPageRef.current = customerPage;
    hasMoreCustomersRef.current = hasMoreCustomers;
    regularNextCursorRef.current = regularNextCursor;
    searchKeywordRef.current = debouncedSearchText;
  }, [customerPage, hasMoreCustomers, regularNextCursor, debouncedSearchText]);
  useEffect(() => {
    void loadCustomers({ reset: true, search: debouncedSearchText });
  }, [debouncedSearchText, loadCustomers]);
  useEffect(() => {
    void loadCustomerStats();
  }, [loadCustomerStats]);
  useEffect(() => {
    void loadAllTags();
  }, [loadAllTags]);
  useEffect(() => {
    selectedCustomerIdRef.current = selectedCustomerId;
    void loadWorkspace(selectedCustomerId, {
      source: "user-select",
      cacheOnly: false,
    });
  }, [selectedCustomerId, loadWorkspace]);
  useEffect(() => {
    selectedCustomerIdRef.current = selectedCustomerId;
  }, [selectedCustomerId]);
  useEffect(() => {
    if (selectedCustomerId) return;
    if (!customers.length) return;
    if (workspaceTopPrefetchTriggeredRef.current) return;
    workspaceTopPrefetchTriggeredRef.current = true;
    const topIds = customers
      .map((item) => item.id)
      .filter((item) => !!item)
      .slice(0, WORKSPACE_PREFETCH_TOP_MAX);
    enqueueWorkspacePrefetch(topIds, { selectedId: null });
  }, [customers, enqueueWorkspacePrefetch, selectedCustomerId]);
  useEffect(() => {
    if (!selectedCustomerId) return;
    const selectedIndex = customers.findIndex((item) => item.id === selectedCustomerId);
    if (selectedIndex < 0) return;
    const start = Math.max(0, selectedIndex - 5);
    const end = Math.min(customers.length, selectedIndex + 8);
    const nearIds = customers
      .slice(start, end)
      .map((item) => item.id)
      .filter((item) => item && item !== selectedCustomerId)
      .slice(0, WORKSPACE_PREFETCH_NEAR_MAX);
    enqueueWorkspacePrefetch(nearIds, { replacePending: true, selectedId: selectedCustomerId });
  }, [customers, enqueueWorkspacePrefetch, selectedCustomerId]);
  useEffect(() => {
    setIsSchedulePanelOpen(false);
    setScheduleAtInput(buildDefaultScheduledInputValue());
  }, [selectedCustomerId]);
  useEffect(() => {
    customerListLatestScrollTopRef.current = customerListScrollRef.current?.scrollTop ?? 0;
  }, [customers.length]);
  useEffect(() => {
    scheduleManualReplyTextareaResize();
  }, [manualReply, scheduleManualReplyTextareaResize]);
  useEffect(() => {
    scheduleManualReplyTextareaResize();
  }, [selectedCustomerId, scheduleManualReplyTextareaResize]);
  useEffect(() => {
    scheduleManualReplyTextareaResize();
  }, [workspace, scheduleManualReplyTextareaResize]);
  useEffect(() => {
    const target = composerInputRowRef.current;
    if (!target || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      scheduleManualReplyTextareaResize();
    });
    observer.observe(target);
    return () => observer.disconnect();
  }, [scheduleManualReplyTextareaResize]);
  useEffect(() => {
    return () => {
      if (manualReplyResizeFrameRef.current != null) {
        window.cancelAnimationFrame(manualReplyResizeFrameRef.current);
      }
    };
  }, []);
  useEffect(() => {
    const enableAudio = () => {
      audioEnabledRef.current = true;
      try {
        const AudioContextClass =
          window.AudioContext ||
          (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!AudioContextClass) return;
        const context = audioContextRef.current ?? new AudioContextClass();
        audioContextRef.current = context;
        if (context.state === "suspended") {
          void context.resume();
        }
      } catch (error) {
        console.error("audio init error:", error);
      }
    };
    window.addEventListener("pointerdown", enableAudio, { once: true });
    window.addEventListener("keydown", enableAudio, { once: true });
    return () => {
      window.removeEventListener("pointerdown", enableAudio);
      window.removeEventListener("keydown", enableAudio);
    };
  }, []);
  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      const target = event.target as Node;
      if (messageContextMenuRef.current?.contains(target)) {
        return;
      }
      if (composerMenuRef.current && !composerMenuRef.current.contains(target)) {
        setIsComposerMenuOpen(false);
      }
      if (schedulePanelRef.current && !schedulePanelRef.current.contains(target)) {
        setIsSchedulePanelOpen(false);
      }
      closeMessageContextMenu();
    }
    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, [closeMessageContextMenu]);
  useEffect(() => {
    const selectedCustomer = customers.find((item) => item.id === selectedCustomerId);
    if (!selectedCustomerId || !selectedCustomer?.unreadCount) return;
    debugStateLog("[user-action] mark-read", { customerId: selectedCustomerId });
    setCustomers((prev) =>
      applyReadProtectionToCustomers(prev.map((item) =>
        item.id === selectedCustomerId ? { ...item, unreadCount: 0 } : item
      ))
    );
    void markCustomerRead(selectedCustomerId, {
      reason: "selected-customer-effect",
      previousUnread: selectedCustomer.unreadCount,
    });
  }, [customers, selectedCustomerId, markCustomerRead]);
  useEffect(() => {
    const handleCloseContextMenu = () => {
      if (tagSubmenuCloseTimerRef.current != null) {
        window.clearTimeout(tagSubmenuCloseTimerRef.current);
        tagSubmenuCloseTimerRef.current = null;
      }
      setCustomerContextMenu(null);
      setMessageContextMenu(null);
      setIsTagSubmenuOpen(false);
      setIsTagDeleteDialogOpen(false);
      setTagDeleteTarget(null);
      setTagDeleteTargetCustomerId("");
      setTagDeleteError("");
      setIsDeletingTag(false);
    };
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (tagSubmenuCloseTimerRef.current != null) {
        window.clearTimeout(tagSubmenuCloseTimerRef.current);
        tagSubmenuCloseTimerRef.current = null;
      }
      setCustomerContextMenu(null);
      setMessageContextMenu(null);
      setIsTagSubmenuOpen(false);
      setIsTagCreateDialogOpen(false);
      setNewTagName("");
      setTagCreateError("");
      setTagDialogTargetCustomerId("");
      setIsCreatingTag(false);
      setIsTagDeleteDialogOpen(false);
      setTagDeleteTarget(null);
      setTagDeleteTargetCustomerId("");
      setTagDeleteError("");
      setIsDeletingTag(false);
    };
    const handleScrollClose = () => setMessageContextMenu(null);
    const chatContainer = chatScrollRef.current;
    window.addEventListener("click", handleCloseContextMenu);
    window.addEventListener("resize", handleCloseContextMenu);
    window.addEventListener("keydown", handleEscape);
    chatContainer?.addEventListener("scroll", handleScrollClose, { passive: true });
    return () => {
      window.removeEventListener("click", handleCloseContextMenu);
      window.removeEventListener("resize", handleCloseContextMenu);
      window.removeEventListener("keydown", handleEscape);
      chatContainer?.removeEventListener("scroll", handleScrollClose);
    };
  }, []);
  useEffect(() => {
    setMessageContextMenu(null);
  }, [selectedCustomerId]);
  useEffect(() => {
    const sentinel = customerListLoadMoreRef.current;
    const container = customerListScrollRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (!first?.isIntersecting) return;
        if (isListLoading || isLoadingMoreCustomers || !hasMoreCustomersRef.current) return;
        void loadCustomers({ loadMore: true, preserveUi: true, search: searchKeywordRef.current });
      },
      {
        root: container,
        rootMargin: "160px 0px",
      }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [isListLoading, isLoadingMoreCustomers, loadCustomers]);
  useEffect(() => {
    let timer: number | null = null;
    const pingPresence = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      try {
        await fetch("/api/operator-presence", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            selectedCustomerId: selectedCustomerIdRef.current || null,
          }),
        });
      } catch (error) {
        console.error("operator presence ping error:", error);
      }
    };
    void pingPresence();
    timer = window.setInterval(() => {
      void pingPresence();
    }, 15000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void pingPresence();
        void runRealtimeRefresh(selectedCustomerIdRef.current || null);
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [runRealtimeRefresh, selectedCustomerId]);
  useEffect(() => {
    const client = new Ably.Realtime({
      authUrl: "/api/ably/token",
      authMethod: "GET",
    });
    ablyClientRef.current = client;
    const channel = client.channels.get("line-chat-workbench");
    const handleRefresh = (message: unknown) => {
      if (realtimeRefreshTimerRef.current) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }
      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        const payload =
          message && typeof message === "object"
            ? ((message as { data?: Record<string, unknown> }).data || {})
            : {};
        const reason = typeof payload.reason === "string" ? payload.reason.trim() : "";
        const tagId = typeof payload.tagId === "string" ? payload.tagId.trim() : "";
        const inboundMessageIdCandidate =
          typeof payload.messageId === "string" && payload.messageId.trim()
            ? payload.messageId.trim()
            : typeof payload.inboundMessageId === "string" && payload.inboundMessageId.trim()
              ? payload.inboundMessageId.trim()
              : "";
        const targetCustomerId =
          payload && typeof payload.customerId === "string" && payload.customerId.trim()
            ? payload.customerId.trim()
            : null;
        if (reason === "tags-updated") {
          if (tagId) {
            setAllTags((prev) => prev.filter((item) => item.id !== tagId));
            setCustomers((prev) =>
              prev.map((customer) => ({
                ...customer,
                tags: customer.tags.filter((item) => item.id !== tagId),
              }))
            );
            setWorkspace((prev) =>
              prev
                ? {
                    ...prev,
                    customer: {
                      ...prev.customer,
                      tags: prev.customer.tags.filter((item) => item.id !== tagId),
                    },
                  }
                : prev
            );
          }
          void loadAllTags();
          void runRealtimeRefresh(null);
          return;
        }
        if (
          targetCustomerId &&
          reason &&
          inboundSoundReasonsRef.current.has(reason) &&
          inboundMessageIdCandidate &&
          !playedInboundMessageIdsRef.current.has(inboundMessageIdCandidate)
        ) {
          playedInboundMessageIdsRef.current.add(inboundMessageIdCandidate);
          if (playedInboundMessageIdsRef.current.size > 3000) {
            const iterator = playedInboundMessageIdsRef.current.values();
            for (let i = 0; i < 1000; i += 1) {
              const next = iterator.next();
              if (next.done) break;
              playedInboundMessageIdsRef.current.delete(next.value);
            }
          }
          void playDingDongSound();
        }
        const isSearching = !!searchKeywordRef.current.trim();
        if (targetCustomerId) {
          const lastLocalRefreshAt = recentLocalRefreshAtRef.current[targetCustomerId] ?? 0;
          if (Date.now() - lastLocalRefreshAt < 1200) {
            return;
          }
        }
        if (!targetCustomerId) {
          void runRealtimeRefresh(null);
          return;
        }
        if (isSearching) {
          void runRealtimeRefresh(targetCustomerId);
          return;
        }
        if (!reason || customerSummaryPreferredReasonsRef.current.has(reason)) {
          void refreshCustomerSummary(targetCustomerId, { preserveUi: true });
          if (
            selectedCustomerIdRef.current === targetCustomerId &&
            (!reason || workspaceRefreshReasonsRef.current.has(reason))
          ) {
            void loadWorkspace(targetCustomerId, { preserveUi: true, source: "realtime-targeted" });
          }
          return;
        }
        void refreshCustomerSummary(targetCustomerId, { preserveUi: true });
        if (selectedCustomerIdRef.current === targetCustomerId && workspaceRefreshReasonsRef.current.has(reason)) {
          void loadWorkspace(targetCustomerId, { preserveUi: true, source: "realtime-targeted" });
        }
      }, 250);
    };
    const handleConnectionStateChange = (stateChange: Ably.ConnectionStateChange) => {
      if (
        stateChange.current === "connected" &&
        ["disconnected", "suspended", "connecting"].includes(stateChange.previous || "")
      ) {
        void runRealtimeRefresh(selectedCustomerIdRef.current || null);
      }
    };
    channel.subscribe("refresh", handleRefresh);
    client.connection.on(handleConnectionStateChange);
    return () => {
      if (realtimeRefreshTimerRef.current) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }
      channel.unsubscribe("refresh", handleRefresh);
      client.connection.off(handleConnectionStateChange);
      client.close();
      ablyClientRef.current = null;
    };
  }, [loadAllTags, loadWorkspace, playDingDongSound, refreshCustomerSummary, runRealtimeRefresh]);
  const displayedCustomers = useMemo(() => {
    return sortCustomerList(
      customers.map((customer) => {
        const optimisticList = optimisticMessagesByCustomer[customer.id] || [];
        if (!optimisticList.length) return customer;
        const latestOptimistic = [...optimisticList].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime())[0];
        const latestBaseTime = customer.latestMessage?.sentAt ? new Date(customer.latestMessage.sentAt).getTime() : 0;
        const latestOptimisticTime = new Date(latestOptimistic.sentAt).getTime();
        if (latestOptimisticTime < latestBaseTime) {
          return customer;
        }
        return {
          ...customer,
          latestMessage: buildCustomerLatestMessage(latestOptimistic),
          lastMessageAt: latestOptimistic.sentAt,
        };
      })
    );
  }, [customers, optimisticMessagesByCustomer]);
  const displayedWorkspaceMessages = useMemo(() => {
    if (!workspace) return [] as Array<WorkspaceMessage | OptimisticWorkspaceMessage>;
    return mergeWorkspaceMessages(
      workspace.messages,
      optimisticMessagesByCustomer[workspace.customer.id] || []
    );
  }, [workspace, optimisticMessagesByCustomer]);
  const currentListCustomer =
    displayedCustomers.find((item) => item.id === selectedCustomerId) ||
    customers.find((item) => item.id === selectedCustomerId) ||
    null;
  useEffect(() => {
    if (!requestedCustomerId) return;
    if (!customers.some((item) => item.id === requestedCustomerId)) return;
    if (selectedCustomerId !== requestedCustomerId) {
      openChatToBottomRef.current = true;
      shouldStickToBottomRef.current = true;
      setSelectedCustomerId(requestedCustomerId);
    }
    clearCustomerQuery();
  }, [requestedCustomerId, customers, selectedCustomerId, clearCustomerQuery]);
  useEffect(() => {
    if (!workspace || !selectedCustomerId) return;
    const container = chatScrollRef.current;
    if (!container) return;
    const customerChanged = lastOpenedCustomerIdRef.current !== workspace.customer.id;
    if (customerChanged || openChatToBottomRef.current || shouldStickToBottomRef.current) {
      requestAnimationFrame(() => {
        const el = chatScrollRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
      });
    }
    if (customerChanged) {
      lastOpenedCustomerIdRef.current = workspace.customer.id;
    }
    openChatToBottomRef.current = false;
  }, [selectedCustomerId, workspace?.customer.id, displayedWorkspaceMessages.length]);
  const displayedSuggestion1Ja =
    customReply?.suggestion1Ja ||
    workspace?.latestReplyDraftSet?.stableJapanese ||
    "";
  const displayedSuggestion1Zh =
    customReply?.suggestion1Zh ||
    workspace?.latestReplyDraftSet?.stableChinese ||
    "";
  const latestDraft = workspace?.latestReplyDraftSet || null;
  const hasLatestDraftTranslationFailure =
    !!latestDraft &&
    (!!latestDraft.stableJapanese.trim() || !!latestDraft.advancingJapanese.trim()) &&
    (!latestDraft.stableChinese.trim() || !latestDraft.advancingChinese.trim());
  const effectiveAiNotice =
    aiNotice ||
    (hasLatestDraftTranslationFailure
      ? "日语建议已生成，中文释义暂不可用。"
      : "");
  const isLatestDraftUsed = !!latestDraft?.selectedVariant;
  const isLatestDraftStale =
    !!latestDraft?.isStale ||
    (!!latestDraft &&
      !!workspace?.latestCustomerMessageId &&
      !!latestDraft.targetCustomerMessageId &&
      latestDraft.targetCustomerMessageId !== workspace.latestCustomerMessageId);
  const shouldDimDraft = isLatestDraftUsed || isLatestDraftStale;
  const latestDraftPrimaryActionLabel = "生成回复";
  const latestDraftPrimaryActionHint = !latestDraft
    ? "当前还没有建议，点击生成回复后会给出两种回复方案。"
    : isLatestDraftStale
      ? "当前建议可能不是基于最新对话生成，请重新生成回复。"
      : "可重新生成回复，调整语气、推进力度或约束。";
  useEffect(() => {
    setCustomReply(null);
    setAiNotice("");
    setIsPostGenerateSyncing(false);
    setPostGenerateSyncMessage("");
    copyPromptActiveRef.current = null;
    clearCopyPromptResetTimer();
    setCopyPromptStatus("idle");
  }, [clearCopyPromptResetTimer, selectedCustomerId]);
  const runPostGenerateRefresh = useCallback((customerId: string) => {
    setIsPostGenerateSyncing(true);
    setPostGenerateSyncMessage("");
    recentLocalRefreshAtRef.current[customerId] = Date.now();
    void (async () => {
      const [workspaceResult, customersResult] = await Promise.allSettled([
        loadWorkspace(customerId, {
          preserveUi: true,
          source: "post-generate-refresh",
          cacheOnly: selectedCustomerIdRef.current !== customerId,
        }),
        refreshCustomerSummary(customerId, { preserveUi: true }),
      ]);
      const failures = [workspaceResult, customersResult].filter((result) => result.status === "rejected");
      if (failures.length > 0) {
        const hasNonAbortFailure = failures.some((result) => {
          const reason = (result as PromiseRejectedResult).reason;
          return !isAbortError(reason);
        });
        if (hasNonAbortFailure) {
          setPostGenerateSyncMessage("建议已可用，后台同步失败，稍后会自动重试。");
        }
      } else {
        setPostGenerateSyncMessage("");
      }
      setIsPostGenerateSyncing(false);
    })();
  }, [loadWorkspace, refreshCustomerSummary]);
  const stopGenerationPollingByCustomer = useCallback((customerId: string) => {
    const poller = generationPollersRef.current[customerId];
    if (!poller) return;
    if (poller.timerId != null) {
      window.clearTimeout(poller.timerId);
    }
    poller.abortController?.abort();
    delete generationPollersRef.current[customerId];
    setGeneratingByCustomer((prev) => {
      if (!prev[customerId]) return prev;
      const next = { ...prev };
      delete next[customerId];
      return next;
    });
  }, []);
  const buildMessageCopyText = useCallback((message: WorkspaceMessage | OptimisticWorkspaceMessage) => {
    const japanese = message.japaneseText.trim();
    const chinese = (message.chineseText || "").trim();
    if (japanese && chinese) {
      return `\u539f\u6587\uff1a\n${japanese}\n\n\u7ffb\u8bd1\uff1a\n${chinese}`;
    }
    if (japanese) return japanese;
    if (chinese) return chinese;
    if (message.type === "IMAGE") return message.imageUrl ? `\u56fe\u7247\uff1a${message.imageUrl}` : "";
    if (message.type === "STICKER") {
      const packageId = message.stickerPackageId || "-";
      const stickerId = message.stickerId || "-";
      return `\u8d34\u56fe packageId: ${packageId}\n\u8d34\u56fe stickerId: ${stickerId}`;
    }
    return "";
  }, []);
  const handleCopyMessage = useCallback(async (message: WorkspaceMessage | OptimisticWorkspaceMessage) => {
    const text = buildMessageCopyText(message);
    if (!text) {
      showOpNotice("\u5f53\u524d\u6d88\u606f\u6ca1\u6709\u53ef\u590d\u5236\u7684\u6587\u672c\u3002");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      void playSoftTickSound("success");
      showOpNotice("\u5df2\u590d\u5236\u6d88\u606f\u5185\u5bb9\u3002");
    } catch (error) {
      console.error("copy message failed:", error);
      showOpNotice("\u590d\u5236\u5931\u8d25\uff0c\u8bf7\u624b\u52a8\u9009\u62e9\u6587\u672c\u590d\u5236\u3002");
    }
  }, [buildMessageCopyText, playSoftTickSound, showOpNotice]);
  const getMessageSourceText = useCallback((message: WorkspaceMessage | OptimisticWorkspaceMessage) => {
    const japaneseText = typeof message.japaneseText === "string" ? message.japaneseText : "";
    if (japaneseText.trim()) return japaneseText.trim();
    return "";
  }, []);
  const handleTranslateSingleMessage = useCallback(async (message: WorkspaceMessage | OptimisticWorkspaceMessage) => {
    const normalizedType = normalizeMessageType(message.type);
    const sourceText = getMessageSourceText(message);
    console.info("[manual-translation] handler-start", {
      messageId: message.id,
      type: message.type,
      normalizedType,
      role: message.role,
      hasJapaneseText: Boolean(sourceText),
      japaneseTextLength: sourceText.length,
    });
    if (isOptimisticMessageId(message.id)) {
      console.info("[manual-translation] early-return optimistic", { messageId: message.id });
      showOpNotice("\u6d88\u606f\u53d1\u9001\u4e2d\uff0c\u6682\u65f6\u65e0\u6cd5\u7ffb\u8bd1\u3002");
      return;
    }
    if (normalizedType !== "TEXT") {
      console.info("[manual-translation] early-return non-text", {
        messageId: message.id,
        type: message.type,
        normalizedType,
      });
      showOpNotice("\u8be5\u6d88\u606f\u6682\u4e0d\u652f\u6301\u7ffb\u8bd1\u3002");
      return;
    }
    const japanese = sourceText;
    if (!japanese) {
      console.info("[manual-translation] early-return empty-source-text", { messageId: message.id });
      showOpNotice("\u5f53\u524d\u6d88\u606f\u6ca1\u6709\u53ef\u7ffb\u8bd1\u6587\u672c\u3002");
      return;
    }
    if (translatingMessageIds[message.id]) {
      console.info("[manual-translation] early-return inflight", { messageId: message.id });
      return;
    }
    console.info("[manual-translation] set-spinner", { messageId: message.id });
    setTranslatingMessageIds((prev) => ({ ...prev, [message.id]: true }));
    try {
      console.info("[manual-translation] request-translate:start", {
        messageId: message.id,
        textLength: japanese.length,
      });
      const translateResponse = await fetch("/api/translate-message", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ japanese }),
      });
      const translateData = await translateResponse.json();
      console.info("[manual-translation] request-translate:done", {
        messageId: message.id,
        ok: translateResponse.ok && !!translateData?.ok,
        status: translateResponse.status,
        hasChinese: Boolean(translateData?.chinese),
      });
      if (!translateResponse.ok || !translateData.ok || !translateData.chinese) {
        throw new Error(translateData?.error || "translate_failed");
      }
      const chineseText = String(translateData.chinese || "").trim();
      if (!chineseText) {
        throw new Error("translate_empty");
      }
      console.info("[manual-translation] request-save:start", {
        messageId: message.id,
        chineseTextLength: chineseText.length,
      });
      const patchResponse = await fetch(`/api/messages/${message.id}/translation`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ chineseText }),
      });
      const patchData = await patchResponse.json().catch(() => ({}));
      console.info("[manual-translation] request-save:done", {
        messageId: message.id,
        ok: patchResponse.ok && !!patchData?.ok,
        status: patchResponse.status,
      });
      if (!patchResponse.ok || !patchData.ok) {
        throw new Error(patchData?.error || "save_translation_failed");
      }
      updateWorkspaceMessage(message.customerId, message.id, (prev) => ({
        ...prev,
        chineseText,
      }));
      console.info("[manual-translation] patch-local-message:done", { messageId: message.id });
      void playSoftTickSound("success");
      showOpNotice("\u7ffb\u8bd1\u5df2\u66f4\u65b0\u3002");
    } catch (error) {
      console.error("translate single message failed:", {
        messageId: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
      showOpNotice("\u7ffb\u8bd1\u5931\u8d25\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5\u3002");
    } finally {
      console.info("[manual-translation] clear-spinner", { messageId: message.id });
      setTranslatingMessageIds((prev) => {
        const next = { ...prev };
        delete next[message.id];
        return next;
      });
    }
  }, [getMessageSourceText, playSoftTickSound, showOpNotice, translatingMessageIds, updateWorkspaceMessage]);
  const handleCopyFullPrompt = useCallback(async () => {
    if (!workspace) {
      showOpNotice("请先选择顾客。");
      return;
    }
    const customerId = String(workspace.customer.id || "").trim();
    if (!customerId) {
      showOpNotice("请先选择顾客。");
      return;
    }

    const requestId = copyPromptRequestSeqRef.current + 1;
    copyPromptRequestSeqRef.current = requestId;
    copyPromptActiveRef.current = { requestId, customerId };
    clearCopyPromptResetTimer();
    setCopyPromptStatus("copying");

    const isLatestRequest = () => {
      const active = copyPromptActiveRef.current;
      return (
        !!active &&
        active.requestId === requestId &&
        active.customerId === customerId &&
        selectedCustomerIdRef.current === customerId
      );
    };

    try {
      const response = await fetch("/api/copy-reply-prompt", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerId,
          rewriteInput,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!isLatestRequest()) return;
      if (!response.ok || !data?.ok || typeof data?.copyText !== "string" || !data.copyText.trim()) {
        throw new Error(String(data?.error || "copy_prompt_failed"));
      }
      await navigator.clipboard.writeText(data.copyText);
      if (!isLatestRequest()) return;
      setCopyPromptStatus("copied");
      void playSoftTickSound("success");
      scheduleCopyPromptStatusReset(2000);
    } catch (error) {
      if (!isLatestRequest()) return;
      setCopyPromptStatus("failed");
      showOpNotice("复制失败，请稍后重试。");
      scheduleCopyPromptStatusReset(1200);
      console.error("copy full prompt failed:", error instanceof Error ? error.message : String(error));
    }
  }, [clearCopyPromptResetTimer, playSoftTickSound, rewriteInput, scheduleCopyPromptStatusReset, showOpNotice, workspace]);
  const formatGenerationTaskError = useCallback((task: GenerationTaskView) => {
    const code = String(task.errorCode || "").trim();
    const message = String(task.errorMessage || "").trim();
    if (code === "generation_structured_timeout") return "生成失败：日语 A/B 回复生成超时。";
    if (code === "translation_structured_timeout") return "生成失败：中文释义翻译超时。";
    if (code === "generation_structured_failed") return "生成失败：日语 A/B 结构化输出失败。";
    if (code === "translation_structured_failed") return "生成失败：中文释义结构化输出失败。";
    if (code === "MODEL_TIMEOUT") return "生成失败：模型响应超时。";
    if (code === "MODEL_JSON_PARSE_ERROR") return "生成失败：模型 JSON 输出格式错误。";
    if (code === "MODEL_SCHEMA_INVALID") return "生成失败：模型输出未通过结构校验。";
    if (code === "generation_missing_japanese_reply") return "生成失败：缺少日语回复内容。";
    if (code === "translation_missing_reply_meaning") return "生成失败：缺少中文释义。";
    if (code === "TASK_STALE_TIMEOUT") return "生成失败：任务轮询超时并达到重试上限。";
    if (message) return message;
    return code ? ("生成失败：" + code) : "生成失败：未知错误。";
  }, []);
  const startGenerationPolling = useCallback((taskId: string, customerId: string) => {
    stopGenerationPollingByCustomer(customerId);
    generationPollersRef.current[customerId] = {
      taskId,
      timerId: null,
      abortController: null,
    };
    setGeneratingByCustomer((prev) => ({ ...prev, [customerId]: true }));

    const poll = async () => {
      const active = generationPollersRef.current[customerId];
      if (!active || active.taskId !== taskId) return;

      const controller = new AbortController();
      active.abortController = controller;

      try {
        const response = await fetch(
          "/api/generate-replies/tasks/" + encodeURIComponent(taskId) + "?customerId=" + encodeURIComponent(customerId),
          { method: "GET", signal: controller.signal },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok || !payload?.task) {
          throw new Error(payload?.error || ("task_status_http_" + response.status));
        }

        const task = payload.task as GenerationTaskView;
        if (task.status === "SUCCEEDED") {
          stopGenerationPollingByCustomer(customerId);
          const taskErrorCode = String(task.errorCode || "").trim();
          const translationFailed =
            String(task.stage || "").includes("translation-failure") ||
            taskErrorCode.startsWith("translation_");
          if (selectedCustomerIdRef.current === customerId) {
            setApiError("");
            setAiNotice(
              translationFailed
                ? "日语建议已生成，中文释义暂不可用。"
                : "建议已生成。",
            );
            setRewriteInput("");
          }
          runPostGenerateRefresh(customerId);
          return;
        }

        if (task.status === "FAILED") {
          stopGenerationPollingByCustomer(customerId);
          const errorText = formatGenerationTaskError(task);
          if (selectedCustomerIdRef.current === customerId) {
            setApiError(errorText);
            setAiNotice("");
          }
          showOpNotice("生成失败，请稍后重试。");
          return;
        }

        if (selectedCustomerIdRef.current === customerId) {
          setAiNotice("正在生成回复...");
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        stopGenerationPollingByCustomer(customerId);
        if (selectedCustomerIdRef.current === customerId) {
          setApiError(String(error instanceof Error ? error.message : error));
          setAiNotice("");
        }
        return;
      } finally {
        const current = generationPollersRef.current[customerId];
        if (current && current.taskId === taskId) {
          current.abortController = null;
        }
      }

      const current = generationPollersRef.current[customerId];
      if (!current || current.taskId !== taskId) return;
      current.timerId = window.setTimeout(poll, 1200);
    };

    void poll();
  }, [formatGenerationTaskError, runPostGenerateRefresh, showOpNotice, stopGenerationPollingByCustomer]);
  async function handleRewrite() {
    if (!workspace) {
      showOpNotice("请先选择顾客。");
      return;
    }
    const customerId = workspace.customer.id;
    debugStateLog("[user-action] generate-replies", { customerId });
    if (generatingByCustomer[customerId]) return;
    try {
      void playSoftTickSound("tap");
      setGeneratingByCustomer((prev) => ({ ...prev, [customerId]: true }));
      setApiError("");
      setAiNotice("");
      setCustomReply(null);
      setPostGenerateSyncMessage("");
      stopGenerationPollingByCustomer(customerId);
      const response = await fetch("/api/generate-replies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerId,
          rewriteInput,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "generate_failed");
      }
      const taskId = String(data?.taskId || "").trim();
      if (!taskId) throw new Error("missing taskId");
      const immediateSucceeded = String(data?.status || "").toUpperCase() === "SUCCEEDED";
      if (immediateSucceeded) {
        if (selectedCustomerIdRef.current !== customerId) {
          setGeneratingByCustomer((prev) => {
            const next = { ...prev };
            delete next[customerId];
            return next;
          });
          return;
        }
        setCustomReply({
          suggestion1Ja: String(data?.suggestion1Ja || ""),
          suggestion1Zh: String(data?.suggestion1Zh || ""),
          translationStatus:
            String(data?.translationStatus || "").trim() === "failed" ? "failed" : "succeeded",
          translationErrorCode: String(data?.translationErrorCode || "").trim(),
        });
        setGeneratingByCustomer((prev) => {
          const next = { ...prev };
          delete next[customerId];
          return next;
        });
        setApiError("");
        setAiNotice(
          String(data?.translationStatus || "").trim() === "failed"
            ? "日语建议已生成，中文释义暂不可用。"
            : "建议已生成。",
        );
        setRewriteInput("");
        void runPostGenerateRefresh(customerId);
        return;
      }
      setAiNotice("正在生成回复...");
      startGenerationPolling(taskId, customerId);
    } catch (error) {
      console.error(error);
      setGeneratingByCustomer((prev) => {
        const next = { ...prev };
        delete next[customerId];
        return next;
      });
      setApiError(String(error));
      showOpNotice("生成失败，请稍后重试。");
    }
  }
  async function addAiReplyToChat(
    replyJa: string,
    replyZh: string,
    variant: "stable" | "advancing"
  ) {
    if (!workspace) {
      window.alert("当前没有选中的顾客");
      return;
    }
    if (!replyJa.trim()) {
      window.alert("当前没有可发送的建议回复");
      return;
    }
    try {
      setIsSendingAi(variant);
      setCustomReply(null);
      await submitOutboundMessage({
        customerId: workspace.customer.id,
        japaneseText: replyJa,
        chineseText: replyZh,
        source: "AI_SUGGESTION",
        type: "TEXT",
        replyDraftSetId: workspace.latestReplyDraftSet?.id || "",
        suggestionVariant: variant === "stable" ? "STABLE" : "ADVANCING",
      });
    } catch (error) {
      console.error(error);
    } finally {
      setIsSendingAi("");
    }
  }
  function openPresetPanel() {
    setIsComposerMenuOpen(false);
    setIsSchedulePanelOpen(false);
    setIsPresetPanelOpen(true);
    setEditingPresetId("");
    setPresetTitle("");
    setPresetContent("");
    void loadPresetSnippets();
  }
  function applyPresetSnippet(item: PresetSnippet) {
    setManualReply(item.content);
    setIsPresetPanelOpen(false);
  }
  function startEditPreset(item: PresetSnippet) {
    setEditingPresetId(item.id);
    setPresetTitle(item.title);
    setPresetContent(item.content);
  }
  function resetPresetForm() {
    setEditingPresetId("");
    setPresetTitle("");
    setPresetContent("");
  }
  async function handleSavePreset() {
    if (!presetTitle.trim()) {
      window.alert("预设名称不能为空");
      return;
    }
    if (!presetContent.trim()) {
      window.alert("预设内容不能为空");
      return;
    }
    try {
      setIsPresetSaving(true);
      const response = await fetch(
        editingPresetId ? `/api/preset-messages/${editingPresetId}` : "/api/preset-messages",
        {
          method: editingPresetId ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: presetTitle,
            content: presetContent,
          }),
        }
      );
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "保存预设信息失败");
      }
      resetPresetForm();
      await loadPresetSnippets();
    } catch (error) {
      console.error(error);
      window.alert("保存预设信息失败，请查看终端报错");
    } finally {
      setIsPresetSaving(false);
    }
  }
  async function handleDeletePreset(id: string) {
    if (!window.confirm("确认删除这条预设信息吗？")) return;
    try {
      const response = await fetch(`/api/preset-messages/${id}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "删除预设信息失败");
      }
      if (editingPresetId === id) {
        resetPresetForm();
      }
      await loadPresetSnippets();
    } catch (error) {
      console.error(error);
      window.alert("删除预设信息失败，请查看终端报错");
    }
  }
  function handleAddImage() {
    setIsComposerMenuOpen(false);
    setIsSchedulePanelOpen(false);
    imageInputRef.current?.click();
  }
  async function uploadImageFiles(files: File[]) {
    const validFiles = files.filter((file) => file.type.startsWith("image/"));
    if (!validFiles.length) {
      window.alert("只能上传图片文件");
      return;
    }
    if (validFiles.length !== files.length) {
      window.alert("已自动忽略非图片文件");
    }

    try {
      setIsUploadingImage(true);
      const uploaded: PendingUploadImage[] = [];
      for (const file of validFiles) {
        const formData = new FormData();
        formData.append("file", file);
        const response = await fetch("/api/uploads/images", {
          method: "POST",
          body: formData,
        });
        const data = await response.json();
        if (!response.ok || !data.ok || !data.image?.url) {
          throw new Error(data?.error || `上传图片失败：${file.name}`);
        }
        uploaded.push({
          url: data.image.url,
          originalName: data.image.originalName || file.name,
          size: Number(data.image.size || file.size || 0),
          contentType: typeof data.image.contentType === "string" ? data.image.contentType : file.type,
        });
      }
      setPendingImages((current) => [...current, ...uploaded]);
      setIsComposerMenuOpen(false);
    } catch (error) {
      console.error(error);
      window.alert("上传图片失败，请检查 Blob 配置或终端报错");
    } finally {
      setIsUploadingImage(false);
    }
  }
  function handleImageInputChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    void uploadImageFiles(files);
    event.target.value = "";
  }
  function removePendingImage(targetUrl: string) {
    setPendingImages((current) => current.filter((item) => item.url !== targetUrl));
  }
  function clearPendingImages() {
    setPendingImages([]);
  }
  function handleComposerDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsComposerDragOver(true);
  }
  function handleComposerDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsComposerDragOver(false);
  }
  function handleComposerDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsComposerDragOver(false);
    const files = Array.from(event.dataTransfer.files || []);
    if (!files.length) return;
    void uploadImageFiles(files);
  }
  function handleManualReplyKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (isUploadingImage || !workspace) return;
    if (!manualReply.trim() && pendingImages.length === 0) return;
    void handleManualSend();
  }
  async function handleManualSend() {
    if (!workspace) {
      window.alert("当前没有选中的顾客");
      return;
    }
    if (!manualReply.trim() && pendingImages.length === 0) {
      window.alert("请先输入文本或选择图片");
      return;
    }
    const japaneseText = manualReply.replace(/\r\n/g, "\n").trim();
    const manualMessageChars = countManualMessageChars(japaneseText);
    if (manualMessageChars > MANUAL_MESSAGE_MAX_CHARS) {
      window.alert(
        `消息内容过长，当前约 ${manualMessageChars} 个字，最多可发送 ${MANUAL_MESSAGE_MAX_CHARS} 个字。请删减后再发送。`
      );
      return;
    }
    const nextImages = [...pendingImages];
    const dedupeKey = JSON.stringify({
      customerId: workspace.customer.id,
      japaneseText,
      imageUrls: nextImages.map((item) => item.url),
    });
    if (manualSendInFlightKeysRef.current.has(dedupeKey)) return;
    manualSendInFlightKeysRef.current.add(dedupeKey);
    setManualReply("");
    setPendingImages([]);

    try {
      if (nextImages.length > 0) {
        for (let index = 0; index < nextImages.length; index += 1) {
          const imageItem = nextImages[index];
          const imageResult = await submitOutboundMessage({
            customerId: workspace.customer.id,
            japaneseText: "",
            imageUrl: imageItem.url,
            source: "MANUAL",
            type: "IMAGE",
          });
          if (!imageResult.ok) {
            const remainingImages = nextImages.slice(index);
            if (japaneseText) {
              setManualReply(japaneseText);
            }
            setPendingImages(remainingImages);
            window.alert(remainingImages.length > 1 ? "部分图片发送失败，剩余图片已保留，请重试" : "图片发送失败，请重试");
            return;
          }
        }

        if (japaneseText) {
          const textResult = await submitOutboundMessage({
            customerId: workspace.customer.id,
            japaneseText,
            source: "MANUAL",
            type: "TEXT",
          });
          if (!textResult.ok) {
            setManualReply(japaneseText);
            window.alert("图片已排队发送，但补充文字发送失败，请重试文字消息");
          }
        }
        return;
      }

      await submitOutboundMessage({
        customerId: workspace.customer.id,
        japaneseText,
        source: "MANUAL",
        type: "TEXT",
      });
    } finally {
      manualSendInFlightKeysRef.current.delete(dedupeKey);
    }
  }
  async function handleSendSticker() {
    if (!workspace) {
      window.alert("当前没有选中的顾客");
      return;
    }

    const packageIdInput = window.prompt("请输入 LINE 贴图 packageId", "11537");
    if (packageIdInput === null) return;
    const stickerIdInput = window.prompt("请输入 LINE 贴图 stickerId", "52002734");
    if (stickerIdInput === null) return;

    const stickerPackageId = packageIdInput.trim();
    const stickerId = stickerIdInput.trim();

    if (!stickerPackageId || !stickerId) {
      window.alert("packageId 和 stickerId 都不能为空");
      return;
    }

    setIsComposerMenuOpen(false);
    const result = await submitOutboundMessage({
      customerId: workspace.customer.id,
      japaneseText: "[璐村浘]",
      source: "MANUAL",
      type: "STICKER",
      stickerPackageId,
      stickerId,
    });

    if (!result.ok) {
      window.alert("贴图发送失败，请重试");
    }
  }
  async function handleScheduleManualSend() {
    if (!workspace) {
      window.alert("当前没有选中的顾客");
      return;
    }
    if (pendingImages.length > 0) {
      window.alert("定时发送当前只支持文字。图片请直接发送，不要加入定时发送。");
      return;
    }
    if (!manualReply.trim()) {
      window.alert("请先输入要定时发送的文字内容");
      return;
    }
    if (!scheduleAtInput) {
      window.alert("请选择定时发送时间");
      return;
    }
    const scheduledFor = new Date(scheduleAtInput);
    if (!Number.isFinite(scheduledFor.getTime())) {
      window.alert("定时发送时间格式不正确");
      return;
    }
    const diffMs = scheduledFor.getTime() - Date.now();
    if (diffMs < 5 * 60 * 1000) {
      window.alert("请至少提前 5 分钟设置定时发送。");
      return;
    }
    if (diffMs > 24 * 60 * 60 * 1000) {
      window.alert("当前定时发送最多支持 24 小时以内。");
      return;
    }
    const japaneseText = manualReply.replace(/\r\n/g, "\n");
    try {
      setIsSchedulingManual(true);
      const response = await fetch(`/api/customers/${workspace.customer.id}/scheduled-messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          japaneseText,
          imageUrl: "",
          source: "MANUAL",
          type: "TEXT",
          scheduledFor: scheduledFor.toISOString(),
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "创建定时发送失败");
      }
      setManualReply("");
      setPendingImages([]);
      setIsSchedulePanelOpen(false);
      setScheduleAtInput(buildDefaultScheduledInputValue());
      await loadWorkspace(workspace.customer.id, { preserveUi: true, source: "schedule-refresh" });
      await refreshCustomerSummary(workspace.customer.id, { preserveUi: true });
    } catch (error) {
      console.error(error);
      window.alert(error instanceof Error ? error.message : "创建定时发送失败");
    } finally {
      setIsSchedulingManual(false);
    }
  }
  async function handleCancelScheduledMessage(scheduledMessageId: string) {
    if (!workspace) return;
    if (!window.confirm("确认取消这条定时发送吗？")) return;
    try {
      const response = await fetch(`/api/scheduled-messages/${scheduledMessageId}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "取消定时发送失败");
      }
      await loadWorkspace(workspace.customer.id, { preserveUi: true, source: "schedule-refresh" });
      await refreshCustomerSummary(workspace.customer.id, { preserveUi: true });
    } catch (error) {
      console.error(error);
      window.alert(error instanceof Error ? error.message : "取消定时发送失败");
    }
  }
  async function handleRetryMessage(messageId: string) {
    if (!workspace || !messageId || retryingMessageId) return;

    if (isOptimisticMessageId(messageId)) {
      const optimisticMessage = (optimisticMessagesByCustomer[workspace.customer.id] || []).find((item) => item.id === messageId);
      if (!optimisticMessage) return;
      try {
        setRetryingMessageId(messageId);
        await submitOutboundMessage({
          customerId: workspace.customer.id,
          japaneseText: optimisticMessage.japaneseText,
          chineseText: optimisticMessage.chineseText,
          imageUrl: optimisticMessage.imageUrl,
          stickerPackageId: optimisticMessage.stickerPackageId,
          stickerId: optimisticMessage.stickerId,
          source: optimisticMessage.source,
          type: optimisticMessage.type,
          replyDraftSetId: optimisticMessage.replyDraftSetId,
          suggestionVariant: optimisticMessage.suggestionVariant ?? undefined,
          optimisticMessageId: optimisticMessage.id,
        });
      } finally {
        setRetryingMessageId("");
      }
      return;
    }

    try {
      setRetryingMessageId(messageId);
      updateWorkspaceMessage(workspace.customer.id, messageId, (message) => ({
        ...message,
        deliveryStatus: "PENDING",
        sendError: null,
        failedAt: null,
        lastAttemptAt: new Date().toISOString(),
      }));
      const response = await fetch(`/api/messages/${messageId}/retry`, {
        method: "POST",
      });
      const data = await response.json();
      const serverMessage = normalizeWorkspaceMessagePayload(data?.message);
      if (serverMessage) {
        upsertWorkspaceMessage(workspace.customer.id, serverMessage);
        updateCustomerLatestMessage(workspace.customer.id, serverMessage);
      }
      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "重发失败");
      }
    } catch (error) {
      console.error(error);
      updateWorkspaceMessage(workspace.customer.id, messageId, (message) => ({
        ...message,
        deliveryStatus: "FAILED",
        sendError: error instanceof Error ? error.message : String(error),
        failedAt: new Date().toISOString(),
        lastAttemptAt: new Date().toISOString(),
      }));
    } finally {
      setRetryingMessageId("");
    }
  }
  function handleSelectCustomer(customerId: string) {
    debugStateLog("[user-action] select-customer", { customerId });
    const previousUnread = customersRef.current.find((item) => item.id === customerId)?.unreadCount ?? 0;
    if (previousUnread > 0) {
      void markCustomerRead(customerId, {
        reason: "select-customer",
        previousUnread,
      });
    } else {
      debugStateLog("[mark-read] skipped", { customerId, reason: "previous-unread-zero" });
    }
    void playSoftTickSound("tap");
    openChatToBottomRef.current = true;
    shouldStickToBottomRef.current = true;
    selectedCustomerIdRef.current = customerId;
    setSelectedCustomerId(customerId);
    setCustomerContextMenu(null);
    clearCustomerQuery();
    setCustomers((prev) =>
      applyReadProtectionToCustomers(prev.map((item) =>
        item.id === customerId ? { ...item, unreadCount: 0 } : item
      ))
    );
  }
  function handleCollapseChat() {
    setSelectedCustomerId("");
    setIsSchedulePanelOpen(false);
    setWorkspace(null);
    setCustomerContextMenu(null);
    clearCustomerQuery();
  }
  async function handleTogglePin(customer: CustomerListItem) {
    setCustomerContextMenu(null);
    try {
      await patchCustomerMeta(customer.id, {
        pinned: !customer.pinnedAt,
      });
    } catch (error) {
      console.error(error);
      window.alert("置顶状态更新失败");
    }
  }
  function closeCustomerTagMenus() {
    cancelTagSubmenuClose();
    setCustomerContextMenu(null);
    setIsTagSubmenuOpen(false);
  }
  function handleOpenTagCreateDialog() {
    const customerId = contextMenuCustomer?.id || "";
    if (!customerId) {
      setTagCreateError("请先选择顾客");
      return;
    }
    setTagDialogTargetCustomerId(customerId);
    setTagCreateError("");
    setNewTagName("");
    closeCustomerTagMenus();
    setIsTagCreateDialogOpen(true);
  }
  function handleCloseTagCreateDialog() {
    if (isCreatingTag) return;
    resetTagCreateDialogState();
  }
  function handleOpenTagDeleteDialog(tag: CustomerTagItem) {
    const customerId = contextMenuCustomer?.id || "";
    setTagDeleteTarget(tag);
    setTagDeleteTargetCustomerId(customerId);
    setTagDeleteError("");
    closeCustomerTagMenus();
    setIsTagDeleteDialogOpen(true);
  }
  function handleCloseTagDeleteDialog() {
    if (isDeletingTag) return;
    resetTagDeleteDialogState();
  }
  async function handleToggleCustomerTag(customer: CustomerListItem, tag: CustomerTagItem) {
    const tagKey = `${customer.id}:${tag.id}`;
    if (updatingCustomerTagKey) return;
    setUpdatingCustomerTagKey(tagKey);
    try {
      const hasTag = customer.tags.some((item) => item.id === tag.id);
      const response = await fetch(
        hasTag
          ? `/api/customers/${customer.id}/tags/${tag.id}`
          : `/api/customers/${customer.id}/tags`,
        hasTag
          ? { method: "DELETE" }
          : {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ tagId: tag.id }),
            }
      );
      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || "failed_to_update_customer_tags");
      }
      await refreshCustomerSummary(customer.id, { preserveUi: true });
      closeCustomerTagMenus();
    } catch (error) {
      console.error("toggle customer tag error:", error);
      showOpNotice("标签更新失败");
    } finally {
      setUpdatingCustomerTagKey("");
    }
  }
  async function handleCreateTagAndAttach() {
    const targetCustomerId = tagDialogTargetCustomerId.trim();
    const trimmedName = newTagName.trim();
    if (!trimmedName) {
      setTagCreateError("请输入 1-20 个字符的标签名");
      return;
    }
    if (trimmedName.length > 20) {
      setTagCreateError("请输入 1-20 个字符的标签名");
      return;
    }
    if (allTags.length >= 10) {
      setTagCreateError("最多只能创建 10 个标签");
      return;
    }
    setIsCreatingTag(true);
    setTagCreateError("");
    try {
      const createResponse = await fetch("/api/tags", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: trimmedName }),
      });
      const createData = await createResponse.json();
      if (!createResponse.ok || !createData?.ok || !createData?.tag?.id) {
        const code = String(createData?.error || "");
        if (code === "tag_limit_reached") {
          setTagCreateError("最多只能创建 10 个标签");
        } else if (code === "tag_name_exists") {
          setTagCreateError("标签名已存在");
        } else if (code === "invalid_tag_name") {
          setTagCreateError("请输入 1-20 个字符的标签名");
        } else {
          setTagCreateError("创建标签失败");
        }
        return;
      }
      const createdTag: CustomerTagItem = {
        id: String(createData.tag.id),
        name: String(createData.tag.name || ""),
        color: createData.tag.color == null ? null : String(createData.tag.color),
        sortOrder: Number(createData.tag.sortOrder || 0),
      };
      setAllTags((prev) =>
        [...prev.filter((item) => item.id !== createdTag.id), createdTag].sort(
          (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)
        )
      );

      if (!targetCustomerId) {
        setTagCreateError("标签已创建，但添加到顾客失败");
        return;
      }
      const bindResponse = await fetch(`/api/customers/${targetCustomerId}/tags`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tagId: createdTag.id }),
      });
      const bindData = await bindResponse.json();
      if (!bindResponse.ok || !bindData?.ok) {
        setTagCreateError("标签已创建，但添加到顾客失败");
        return;
      }
      await refreshCustomerSummary(targetCustomerId, { preserveUi: true });
      resetTagCreateDialogState();
      closeCustomerTagMenus();
    } catch (error) {
      console.error("create tag error:", error);
      setTagCreateError("创建标签失败");
    } finally {
      setIsCreatingTag(false);
    }
  }
  async function handleDeleteTagGlobally() {
    const targetTag = tagDeleteTarget;
    const targetTagId = String(targetTag?.id || "").trim();
    if (!targetTagId) {
      setTagDeleteError("请选择要删除的标签");
      return;
    }
    setIsDeletingTag(true);
    setTagDeleteError("");
    try {
      const response = await fetch(`/api/tags/${targetTagId}`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.ok) {
        const code = String(data?.error || "");
        if (code === "tag_not_found") {
          setTagDeleteError("标签不存在，可能已被删除");
        } else if (code === "invalid_tag_id") {
          setTagDeleteError("标签标识无效");
        } else {
          setTagDeleteError("删除标签失败");
        }
        return;
      }
      setAllTags((prev) => prev.filter((item) => item.id !== targetTagId));
      setCustomers((prev) =>
        prev.map((customer) => ({
          ...customer,
          tags: customer.tags.filter((item) => item.id !== targetTagId),
        }))
      );
      if (workspace?.customer?.id) {
        setWorkspace((prev) =>
          prev
            ? {
                ...prev,
                customer: {
                  ...prev.customer,
                  tags: prev.customer.tags.filter((item) => item.id !== targetTagId),
                },
              }
            : prev
        );
      }
      if (tagDeleteTargetCustomerId) {
        await refreshCustomerSummary(tagDeleteTargetCustomerId, { preserveUi: true });
      }
      resetTagDeleteDialogState();
    } catch (error) {
      console.error("delete tag error:", error);
      setTagDeleteError("删除标签失败");
    } finally {
      setIsDeletingTag(false);
    }
  }
  async function handleRenameCustomer(customer: CustomerListItem) {
    setCustomerContextMenu(null);
    const nextRemarkName = window.prompt(
      "请输入备注名（留空会清除备注）",
      customer.remarkName || ""
    );
    if (nextRemarkName === null) return;
    try {
      await patchCustomerMeta(customer.id, {
        remarkName: nextRemarkName,
      });
    } catch (error) {
      console.error(error);
      window.alert("备注名更新失败");
    }
  }
  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } catch (error) {
      console.error(error);
      window.alert("Logout failed, please retry.");
    } finally {
      setLoggingOut(false);
    }
  }
  function handleChatScroll() {
    const container = chatScrollRef.current;
    if (!container) return;
    const nearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    shouldStickToBottomRef.current = nearBottom;
    setMessageContextMenu(null);
  }
  function handleCustomerListScroll() {
    const container = customerListScrollRef.current;
    if (!container) return;
    customerListLatestScrollTopRef.current = container.scrollTop;
    customerListUserScrollUntilRef.current = Date.now() + 320;
  }
  const contextMenuCustomer = customerContextMenu?.customer || null;
  const canCreateMoreTags = allTags.length < 10;
  const customerTagMenuPosition = useMemo(() => {
    if (!customerContextMenu) return null;
    const menuWidth = 160;
    const submenuWidth = 220;
    const rowHeight = 36;
    const menuHeight = rowHeight * 3 + 16;
    const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1200;
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 800;
    const baseLeft = Math.max(8, Math.min(customerContextMenu.x, viewportWidth - menuWidth - 8));
    const baseTop = Math.max(8, Math.min(customerContextMenu.y, viewportHeight - menuHeight - 8));
    const openSubmenuLeft = baseLeft + menuWidth + 8 <= viewportWidth - submenuWidth - 8;
    const submenuLeft = openSubmenuLeft ? baseLeft + menuWidth + 8 : Math.max(8, baseLeft - submenuWidth - 8);
    const submenuTop = Math.max(8, Math.min(baseTop, viewportHeight - 320));
    return {
      menuLeft: baseLeft,
      menuTop: baseTop,
      submenuLeft,
      submenuTop,
    };
  }, [customerContextMenu]);
  const contextMenuMessage =
    messageContextMenu
      ? displayedWorkspaceMessages.find(
          (item) => item.id === messageContextMenu.messageId && item.customerId === messageContextMenu.customerId
        ) || null
      : null;
  const canTranslateContextMenuMessage =
    !!contextMenuMessage &&
    normalizeMessageType(contextMenuMessage.type) === "TEXT" &&
    !translatingMessageIds[contextMenuMessage.id];
  const overdueFollowupCount = customerStats.overdueFollowupCount;
  const totalUnreadCount = customerStats.totalUnreadCount;
  const isGeneratingCurrentCustomer = !!(selectedCustomerId && generatingByCustomer[selectedCustomerId]);
  const canManualSend = !!workspace && !isUploadingImage && (pendingImages.length > 0 || !!manualReply.trim());
  const canScheduleManual = !!workspace && !isSchedulingManual && !isUploadingImage && pendingImages.length === 0 && !!manualReply.trim();
  return (
    <div className="h-screen bg-gray-100 flex">
      <div
        ref={customerListScrollRef}
        onScroll={handleCustomerListScroll}
        style={{ overflowAnchor: "none" }}
        className="w-[24%] bg-gray-50 border-r border-gray-200 p-4 overflow-y-auto"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button onClick={handleCollapseChat} className="text-lg font-bold text-left text-gray-900 hover:text-emerald-700 transition">顾客列表</button>
            {totalUnreadCount > 0 ? (
              <span className="inline-flex min-w-6 items-center justify-center rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold text-white">
                {totalUnreadCount > 99 ? "99+" : totalUnreadCount}
              </span>
            ) : null}
          </div>
          <Link
            href="/followups"
            className="inline-flex shrink-0 items-center gap-2 rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs font-medium text-neutral-700 shadow-sm transition hover:bg-neutral-50"
          >
            <span>跟进列表</span>
            {overdueFollowupCount > 0 ? (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {overdueFollowupCount > 99 ? "99+" : overdueFollowupCount}
              </span>
            ) : null}
          </Link>
        </div>
        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="搜索备注、昵称、标签、最后一条消息"
          className="w-full border border-gray-200 bg-white rounded-xl px-3 py-2 text-sm mb-4 shadow-sm outline-none focus:border-green-300"
        />
        {pageError ? (
          <div className="mb-3 text-xs text-red-500 break-all">{pageError}</div>
        ) : null}
        {isListLoading ? (
          <div className="text-sm text-gray-500">顾客列表加载中...</div>
        ) : (
          <div className="space-y-2">
            {displayedCustomers.map((customer) => {
              const isActive = customer.id === selectedCustomerId;
              const latestPreview = customer.latestMessage?.previewText || "暂时还没有消息";
              const latestDeliveryFailed =
                customer.latestMessage?.role === "OPERATOR" && customer.latestMessage?.deliveryStatus === "FAILED";
              const latestSendError = latestDeliveryFailed ? customer.latestMessage?.sendError?.trim() || "" : "";
              return (
                <div
                  key={customer.id}
                  data-customer-id={customer.id}
                  onClick={() => handleSelectCustomer(customer.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    void playSoftTickSound("tap");
                    setCustomerContextMenu({
                      customer,
                      x: event.clientX,
                      y: event.clientY,
                    });
                    cancelTagSubmenuClose();
                    setIsTagSubmenuOpen(false);
                    setTagCreateError("");
                    setNewTagName("");
                  }}
                  className={`group h-[76px] px-3 rounded-xl cursor-pointer border transition-all ${
                    isActive
                      ? "bg-emerald-50 border-emerald-300 shadow-sm shadow-emerald-200/70 ring-1 ring-emerald-200/80"
                      : "bg-white border-slate-200 shadow-sm hover:bg-slate-50 hover:border-slate-300"
                  }`}
                >
                  <div className="h-full flex items-center gap-3">
                    <div className={`relative h-10 w-10 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold ${getAvatarTone(customer.followup?.tier)}`}>
                      {getAvatarText(customer)}
                      {customer.unreadCount > 0 ? (
                        <div className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-green-500 text-white text-[11px] flex items-center justify-center font-medium">
                          {customer.unreadCount > 99 ? "99+" : customer.unreadCount}
                        </div>
                      ) : null}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0 flex items-center gap-1.5">
                          {customer.pinnedAt ? (
                            <span className="text-[12px] leading-none" title="已置顶">📌</span>
                          ) : null}
                          {customer.followup?.isOverdue ? (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" title="跟进已到期" />
                          ) : null}
                        <div className={`truncate text-[14px] font-semibold ${customer.unreadCount > 0 ? "text-slate-950" : "text-gray-900"}`}>
                          {getDisplayName(customer)}
                        </div>
                        </div>
                        <div className="shrink-0 text-[11px] text-gray-400">
                          {formatListTime(customer.lastMessageAt)}
                        </div>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className={`min-w-0 flex-1 truncate text-[12px] ${customer.unreadCount > 0 ? "text-slate-700" : "text-gray-500"}`}>
                          {latestPreview}
                        </div>
                        {latestDeliveryFailed ? (
                          <span
                            className="shrink-0 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-600"
                            title={latestSendError || "发送失败"}
                          >
                            发送失败
                          </span>
                        ) : null}
                        {customer.tags.length > 0 ? (
                          <div className="shrink-0 flex max-w-[140px] items-center gap-1 overflow-hidden whitespace-nowrap">
                            {customer.tags.slice(0, 2).map((tag) => (
                              <span
                                key={tag.id}
                                className="inline-block max-w-[56px] truncate rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none text-white"
                                style={{ backgroundColor: tag.color || "#94A3B8" }}
                              >
                                {tag.name}
                              </span>
                            ))}
                            {customer.tags.length > 2 ? (
                              <span className="inline-block shrink-0 rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium leading-none text-slate-700">
                                +{customer.tags.length - 2}
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        {customer.isVip ? (
                          <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200">
                            VIP
                          </span>
                        ) : null}
                        {getRelationshipBadge(customer.lineRelationshipStatus) ? (
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${getRelationshipBadge(customer.lineRelationshipStatus)?.className}`}>
                            {getRelationshipBadge(customer.lineRelationshipStatus)?.text}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {displayedCustomers.length === 0 && (
              <div className="text-sm text-gray-500 p-3">没有搜索到相关顾客</div>
            )}
            <div ref={customerListLoadMoreRef} className="h-6 flex items-center justify-center text-xs text-gray-400">
              {isLoadingMoreCustomers
                ? "正在加载更多顾客..."
                : hasMoreCustomers
                  ? "下滑继续加载更多"
                  : displayedCustomers.length > 0
                    ? "已经到底了"
                    : ""}
            </div>
          </div>
        )}
      </div>
      <div className="w-[46%] flex flex-col bg-gray-50">
        <div className="border-b bg-white px-4 py-3 flex flex-wrap items-center gap-2">
          <div className="font-bold">{selectedCustomerId ? getDisplayName(workspace?.customer || null) : "未打开顾客会话"}</div>
          {workspace?.customer && getSecondaryName(workspace.customer) ? (
            <div className="order-3 w-full text-xs text-gray-500">
              {getSecondaryName(workspace.customer)}
            </div>
          ) : null}
          {workspace?.customer?.lineRelationshipStatus === "UNFOLLOWED" ? (
            <div className="order-2 inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-[11px] font-medium text-rose-700">
              顾客已取消关注
            </div>
          ) : workspace?.customer && shouldShowRefollowNotice(workspace.customer.lineRefollowedAt, workspace.customer.lineRelationshipStatus) ? (
            <div className="order-2 inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700">
              顾客重新加为好友
            </div>
          ) : null}
          {workspace?.customer?.followup ? (
            <div className="order-4 w-full flex flex-wrap items-center gap-2 border-t border-gray-100 pt-1.5 text-[12px] text-gray-600">
              <span className={`rounded-full px-2 py-0.5 font-medium ${workspace.customer.followup.bucket === "VIP" ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-sky-50 text-sky-700 border border-sky-200"}`}>
                {getFollowupBucketLabel(workspace.customer.followup.bucket)}
              </span>
              <span className={`rounded-full px-2 py-0.5 font-medium ${workspace.customer.followup.tier === "A" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : workspace.customer.followup.tier === "B" ? "bg-amber-50 text-amber-700 border border-amber-200" : "bg-slate-100 text-slate-700 border border-slate-200"}`}>
                {getFollowupTierLabel(workspace.customer.followup.tier)}
              </span>
              <span className={workspace.customer.followup.isOverdue ? "text-red-600 font-medium" : "text-gray-600"}>
                下次跟进：{formatFollowupTime(workspace.customer.followup.nextFollowupAt)}
              </span>
              <span className="truncate">原因：{workspace.customer.followup.reason}</span>
              <Link
                href={`/followups?customerId=${workspace.customer.id}`}
                className="rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50 sm:ml-auto"
              >
                编辑跟进
              </Link>
            </div>
          ) : null}
        </div>
        <div
          ref={chatScrollRef}
          onScroll={handleChatScroll}
          className="flex-1 p-4 space-y-4 overflow-y-auto"
        >
          {isWorkspaceLoading ? (
            <div className="text-sm text-gray-500">聊天内容加载中...</div>
          ) : !selectedCustomerId ? (
            <div className="flex h-full items-center justify-center">
              <div className="rounded-2xl border border-dashed border-gray-300 bg-white/70 px-6 py-8 text-center text-sm text-gray-500 shadow-sm">
                请先从左侧顾客列表中手动选择一位顾客
              </div>
            </div>
          ) : !workspace ? (
            <div className="text-sm text-gray-500">当前没有顾客数据</div>
          ) : displayedWorkspaceMessages.length === 0 ? (
            <div className="text-sm text-gray-500">当前顾客还没有聊天记录</div>
          ) : (
            displayedWorkspaceMessages.map((msg, index) => {
              const previousMessage = index > 0 ? displayedWorkspaceMessages[index - 1] : null;
              const showDivider = shouldShowMessageDivider(previousMessage, msg);
              return (
                <div key={msg.id}>
                  {showDivider ? (
                    <div className="flex justify-center mb-3">
                      <div className="text-[11px] text-gray-500 bg-white border border-gray-200 rounded-full px-3 py-1 shadow-sm">
                        {formatDividerTime(msg.sentAt)}
                      </div>
                    </div>
                  ) : null}
                  <div
                    className={`flex ${
                      msg.role === "CUSTOMER" ? "justify-start" : "justify-end"
                    }`}
                  >
                    <div className="max-w-md">
                      <div
                        onContextMenu={(event) => {
                          event.preventDefault();
                          console.info("[manual-translation] menu-open", {
                            messageId: msg.id,
                            type: msg.type,
                            normalizedType: normalizeMessageType(msg.type),
                            role: msg.role,
                            hasJapaneseText: Boolean(typeof msg.japaneseText === "string" && msg.japaneseText.trim()),
                            japaneseTextLength: msg.japaneseText?.length ?? 0,
                          });
                          const menuWidth = 184;
                          const menuHeight = 116;
                          const maxLeft = Math.max(8, window.innerWidth - menuWidth - 8);
                          const maxTop = Math.max(8, window.innerHeight - menuHeight - 8);
                          const left = Math.max(8, Math.min(event.clientX, maxLeft));
                          const top = Math.max(8, Math.min(event.clientY, maxTop));
                          setMessageContextMenu({
                            messageId: msg.id,
                            customerId: msg.customerId,
                            x: left,
                            y: top,
                          });
                          void playSoftTickSound("tap");
                        }}
                        className={`p-3 rounded-2xl shadow text-sm ${
                          msg.role === "CUSTOMER"
                            ? "bg-white text-black"
                            : "bg-green-500 text-white"
                        }`}
                      >
                        {msg.type === "TEXT" ? (
                          <>
                            <div className="whitespace-pre-wrap">{msg.japaneseText}</div>
                            <div
                              className={`mt-2 text-xs ${
                                msg.role === "CUSTOMER"
                                  ? "text-gray-500"
                                  : "text-green-100"
                              }`}
                            >
                              {msg.chineseText || ""}
                            </div>
                          </>
                        ) : msg.type === "IMAGE" ? (
                          <>
                            {msg.imageUrl ? (
                              <a href={msg.imageUrl} target="_blank" rel="noreferrer" className="block">
                                <img
                                  src={msg.imageUrl}
                                  alt="聊天图片"
                                  className="rounded-xl max-h-72 w-auto max-w-[240px] object-cover border border-black/5"
                                />
                              </a>
                            ) : (
                              <div className="rounded-lg bg-gray-200 h-36 w-56 flex items-center justify-center text-gray-600">
                                图片不可用
                              </div>
                            )}
                            {msg.japaneseText ? (
                              <div className="mt-2 whitespace-pre-wrap">{msg.japaneseText}</div>
                            ) : null}
                            {msg.chineseText ? (
                              <div
                                className={`mt-2 text-xs ${
                                  msg.role === "CUSTOMER"
                                    ? "text-gray-500"
                                    : "text-green-100"
                                }`}
                              >
                                {msg.chineseText}
                              </div>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <div className={`rounded-xl border px-3 py-2 ${msg.role === "CUSTOMER" ? "border-gray-200 bg-gray-50 text-gray-700" : "border-white/20 bg-white/15 text-white"}`}>
                              <div className="text-xs font-semibold tracking-wide">LINE璐村浘</div>
                              <div className="mt-1 text-xs opacity-80">packageId: {msg.stickerPackageId || "-"}</div>
                              <div className="text-xs opacity-80">stickerId: {msg.stickerId || "-"}</div>
                            </div>
                            {msg.japaneseText && msg.japaneseText !== "[璐村浘]" ? (
                              <div className="mt-2 whitespace-pre-wrap">{msg.japaneseText}</div>
                            ) : null}
                          </>
                        )}
                      </div>
                      <div
                        className={`mt-1 flex items-center gap-2 text-[11px] text-gray-400 ${
                          msg.role === "CUSTOMER" ? "justify-start" : "justify-end"
                        }`}
                      >
                        <span>{formatBubbleTime(msg.sentAt)}</span>
                        {translatingMessageIds[msg.id] ? (
                          <span
                            className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500"
                            aria-label="translating"
                          />
                        ) : null}
                        {getDeliveryStatusMeta(msg) ? (
                          <span className={getDeliveryStatusMeta(msg)?.className}>
                            {getDeliveryStatusMeta(msg)?.label}
                          </span>
                        ) : null}
                        {msg.role === "OPERATOR" && msg.deliveryStatus === "FAILED" ? (
                          <button
                            type="button"
                            onClick={() => handleRetryMessage(msg.id)}
                            disabled={retryingMessageId === msg.id}
                            className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-medium text-red-600 transition hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {retryingMessageId === msg.id ? "重发中..." : "重发"}
                          </button>
                        ) : null}
                      </div>
                      {msg.role === "OPERATOR" && msg.deliveryStatus === "FAILED" && msg.sendError ? (
                        <div className="mt-1 text-[11px] text-red-500 text-right line-clamp-2">
                          {msg.sendError}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div className="p-4 border-t bg-white relative">
          <input
            ref={imageInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleImageInputChange}
          />
          <div
            onDragOver={handleComposerDragOver}
            onDragLeave={handleComposerDragLeave}
            onDrop={handleComposerDrop}
            className={`rounded-2xl transition ${
              isComposerDragOver ? "bg-green-50 ring-2 ring-green-300" : ""
            }`}
          >
            {pendingImages.length > 0 ? (
              <div className="mb-3 rounded-2xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900">已上传 {pendingImages.length} 张图片</div>
                    <div className="mt-1 text-xs text-gray-500">发送时会按顺序逐张发送；你也可以补充一条文字，系统会拆成“多张图片 + 文字”消息。</div>
                  </div>
                  <button
                    onClick={clearPendingImages}
                    className="rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-50"
                  >
                    清空
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {pendingImages.map((image) => (
                    <div key={image.url} className="rounded-xl border border-gray-200 bg-white p-2">
                      <img
                        src={image.url}
                        alt={image.originalName}
                        className="h-24 w-full rounded-lg object-cover border border-gray-200 bg-gray-50"
                      />
                      <div className="mt-2 truncate text-xs text-gray-700">{image.originalName}</div>
                      <button
                        onClick={() => removePendingImage(image.url)}
                        className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50"
                      >
                        移除
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div ref={composerInputRowRef} className="flex gap-2 items-end">
              <div className="relative" ref={composerMenuRef}>
                <button
                  onClick={() => setIsComposerMenuOpen((prev) => !prev)}
                  className="h-10 w-10 rounded-full border border-gray-300 bg-white text-xl text-gray-700 hover:bg-gray-50"
                  title="更多操作"
                >
                  +
                </button>
                {isComposerMenuOpen ? (
                  <div className="absolute bottom-12 left-0 z-20 w-52 rounded-xl border border-gray-200 bg-white shadow-lg overflow-hidden">
                    <button
                      onClick={handleAddImage}
                      className="w-full px-4 py-3 text-left text-sm hover:bg-gray-50"
                    >
                      添加图片
                      <div className="text-[11px] text-gray-400 mt-1">支持点击选择，也支持把图片拖到输入区</div>
                    </button>
                    <button
                      onClick={openPresetPanel}
                      className="w-full px-4 py-3 text-left text-sm hover:bg-gray-50 border-t border-gray-100"
                    >
                      预设信息
                      <div className="text-[11px] text-gray-400 mt-1">鐐逛竴涓嬪～鍏ヨ緭鍏ユ</div>
                    </button>
                  </div>
                ) : null}
              </div>
              <textarea
                ref={manualReplyTextareaRef}
                value={manualReply}
                onChange={(e) => setManualReply(e.target.value)}
                onKeyDown={handleManualReplyKeyDown}
                rows={1}
                placeholder={pendingImages.length > 0 ? "可选填写补充文字；发送时会拆成“多张图片 + 文字”多条消息。" : "输入要发送给顾客的日语内容"}
                className="min-h-[44px] max-h-44 flex-1 rounded-xl border border-gray-300 bg-white px-4 py-[10px] leading-6 resize-none whitespace-pre-wrap break-words outline-none focus:border-green-300 focus:ring-2 focus:ring-green-100"
              />
              <div className="relative" ref={schedulePanelRef}>
                <button
                  type="button"
                  onClick={() => {
                    if (!workspace) return;
                    setIsSchedulePanelOpen((prev) => !prev);
                  }}
                  disabled={!workspace}
                  className="rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  定时发送
                </button>
                {isSchedulePanelOpen ? (
                  <div className="absolute bottom-14 right-0 z-20 w-[320px] rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl">
                    <div className="text-sm font-semibold text-gray-900">定时发送</div>
                    <div className="mt-1 text-xs text-gray-500">请至少提前 5 分钟，且不超过 24 小时。到点后系统会自动发送，就算你关闭页面也照常会发。当前定时发送只支持文字。</div>
                    <input
                      type="datetime-local"
                      step={1800}
                      value={scheduleAtInput}
                      min={buildDefaultScheduledInputValue()}
                      onChange={(e) => setScheduleAtInput(e.target.value)}
                      className="mt-3 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-green-300 focus:ring-2 focus:ring-green-100"
                    />
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setIsSchedulePanelOpen(false)}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={handleScheduleManualSend}
                        disabled={!canScheduleManual}
                        className="rounded-xl bg-green-600 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isSchedulingManual ? "加入中..." : "加入定时发送"}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <button
                onClick={handleManualSend}
                disabled={!canManualSend}
                className="bg-green-600 text-white px-4 py-2.5 rounded-xl disabled:opacity-60"
              >
                {isUploadingImage ? "上传中..." : pendingImages.length > 0 ? `发送 ${pendingImages.length} 张图片` : "发送"}
              </button>
            </div>
            {workspace?.scheduledMessages?.length ? (
              <div className="mt-4 rounded-2xl border border-gray-200 bg-gray-50 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-900">已排队的定时发送</div>
                    <div className="mt-1 text-[11px] text-gray-500">这里只显示还没完成的任务。发出去后，它会正常出现在聊天记录里。</div>
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-[11px] text-gray-500 border border-gray-200">
                    {workspace.scheduledMessages.length} 条
                  </span>
                </div>
                <div className="mt-3 space-y-2">
                  {workspace.scheduledMessages.map((item) => {
                    const statusMeta = getScheduledMessageStatusMeta(item.status);
                    return (
                      <div key={item.id} className="rounded-2xl border border-gray-200 bg-white p-3 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusMeta.className}`}>
                                {statusMeta.label}
                              </span>
                              <span className="text-[11px] text-gray-500">{formatScheduledTime(item.scheduledFor)}</span>
                              {item.type === "IMAGE" ? (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600 border border-slate-200">图片</span>
                              ) : null}
                            </div>
                            <div className="mt-2 whitespace-pre-wrap break-words text-sm text-gray-900">{item.japaneseText || "（仅图片，无补充文字）"}</div>
                            {item.sendError ? (
                              <div className="mt-2 text-[11px] text-rose-500 break-all">{item.sendError}</div>
                            ) : null}
                          </div>
                          {item.status !== "PROCESSING" ? (
                            <button
                              type="button"
                              onClick={() => handleCancelScheduledMessage(item.id)}
                              className="shrink-0 rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                            >
                              取消
                            </button>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>
          {isPresetPanelOpen ? (
            <div className="absolute bottom-20 left-4 z-30 w-[420px] max-w-[calc(100%-2rem)] rounded-2xl border border-gray-200 bg-white shadow-2xl overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b bg-gray-50">
                <div>
                  <div className="font-semibold text-gray-900">预设信息</div>
                  <div className="text-xs text-gray-500 mt-1">点击左侧预设，可直接填入输入框</div>
                </div>
                <button
                  onClick={() => {
                    setIsPresetPanelOpen(false);
                    resetPresetForm();
                  }}
                  className="text-sm text-gray-500 hover:text-gray-800"
                >
                  关闭
                </button>
              </div>
              <div className="grid grid-cols-[1.2fr_1fr] max-h-[440px]">
                <div className="border-r border-gray-100 overflow-y-auto p-3 space-y-2">
                  {isPresetLoading ? (
                    <div className="text-sm text-gray-500 px-2 py-3">读取中...</div>
                  ) : presetSnippets.length === 0 ? (
                    <div className="text-sm text-gray-500 px-2 py-3">还没有预设信息，右侧先新增一条。</div>
                  ) : (
                    presetSnippets.map((item) => (
                      <div key={item.id} className="rounded-xl border border-gray-200 bg-white p-3 hover:border-gray-300">
                        <button
                          onClick={() => applyPresetSnippet(item)}
                          className="w-full text-left"
                        >
                          <div className="font-medium text-sm text-gray-900 truncate">{item.title}</div>
                          <div className="mt-1 text-xs text-gray-500 line-clamp-2 break-all">{item.content}</div>
                        </button>
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => startEditPreset(item)}
                            className="text-xs px-2 py-1 rounded-lg border border-gray-200 bg-gray-50 hover:bg-gray-100"
                          >
                            编辑
                          </button>
                          <button
                            onClick={() => handleDeletePreset(item.id)}
                            className="text-xs px-2 py-1 rounded-lg border border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <div className="p-3 space-y-3 bg-gray-50/60">
                  <div className="text-sm font-medium text-gray-900">
                    {editingPresetId ? "编辑预设" : "新增预设"}
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">名称（只给你自己看）</div>
                    <input
                      type="text"
                      value={presetTitle}
                      onChange={(e) => setPresetTitle(e.target.value)}
                      className="w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                      placeholder="例如：报价链接"
                    />
                  </div>
                  <div>
                    <div className="text-xs text-gray-500 mb-1">内容（点击预设会填入输入框）</div>
                    <textarea
                      value={presetContent}
                      onChange={(e) => setPresetContent(e.target.value)}
                      className="w-full min-h-[160px] rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm resize-none"
                      placeholder="例如：这里填写固定报价说明或链接"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSavePreset}
                      disabled={isPresetSaving}
                      className="flex-1 rounded-xl bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-60"
                    >
                      {isPresetSaving ? "保存中..." : editingPresetId ? "保存修改" : "新增预设"}
                    </button>
                    <button
                      onClick={resetPresetForm}
                      className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700"
                    >
                      清空
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      <div className="flex h-full min-h-0 min-w-0 w-[30%] flex-col border-l border-gray-200 bg-white">
      <AiAssistantPanel
        hasCustomer={!!workspace?.customer}
        hasDraft={!!latestDraft}
        latestDraftPrimaryActionLabel={latestDraftPrimaryActionLabel}
        latestDraftPrimaryActionHint={latestDraftPrimaryActionHint}
        isLatestDraftUsed={isLatestDraftUsed}
        isLatestDraftStale={isLatestDraftStale}
        shouldDimDraft={shouldDimDraft}
        displayedSuggestion1Ja={displayedSuggestion1Ja}
        displayedSuggestion1Zh={displayedSuggestion1Zh}
        rewriteInput={rewriteInput}
        onRewriteInputChange={setRewriteInput}
        onRewrite={handleRewrite}
        onSendReply={() => addAiReplyToChat(displayedSuggestion1Ja, displayedSuggestion1Zh, "stable")}
        isGenerating={isGeneratingCurrentCustomer}
        isSendingAi={isSendingAi}
        apiError={apiError}
        aiNotice={effectiveAiNotice}
        copyPromptStatus={copyPromptStatus}
        onCopyPrompt={handleCopyFullPrompt}
        onLogout={handleLogout}
        loggingOut={loggingOut}
        isPostGenerateSyncing={isPostGenerateSyncing}
        postGenerateSyncMessage={postGenerateSyncMessage}
      />
      </div>
      {messageContextMenu && contextMenuMessage ? (
        <div
          ref={messageContextMenuRef}
          className="fixed z-50 min-w-44 rounded-xl border border-gray-200 bg-white py-2 shadow-xl"
          style={{ top: messageContextMenu.y, left: messageContextMenu.x }}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void handleCopyMessage(contextMenuMessage);
              closeMessageContextMenu();
            }}
            onClick={() => {
              void handleCopyMessage(contextMenuMessage);
              closeMessageContextMenu();
            }}
            className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
          >
                            复制此消息
          </button>
          <button
            type="button"
            aria-disabled={!canTranslateContextMenuMessage}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (!canTranslateContextMenuMessage) {
                console.info("[manual-translation] disabled-non-text", {
                  messageId: contextMenuMessage.id,
                  type: contextMenuMessage.type,
                  normalizedType: normalizeMessageType(contextMenuMessage.type),
                });
                showOpNotice("\u8be5\u6d88\u606f\u6682\u4e0d\u652f\u6301\u7ffb\u8bd1\u3002");
                return;
              }
              console.info("[manual-translation] clicked", {
                messageId: contextMenuMessage.id,
                type: contextMenuMessage.type,
                normalizedType: normalizeMessageType(contextMenuMessage.type),
                role: contextMenuMessage.role,
                hasJapaneseText: Boolean(
                  typeof contextMenuMessage.japaneseText === "string" && contextMenuMessage.japaneseText.trim(),
                ),
                japaneseTextLength: contextMenuMessage.japaneseText?.length ?? 0,
                disabled: !canTranslateContextMenuMessage,
              });
              void playSoftTickSound("tap");
              const message = contextMenuMessage;
              closeMessageContextMenu();
              void handleTranslateSingleMessage(message);
            }}
            onClick={() => {
              if (!canTranslateContextMenuMessage) return;
              console.info("[manual-translation] clicked", {
                messageId: contextMenuMessage.id,
                type: contextMenuMessage.type,
                normalizedType: normalizeMessageType(contextMenuMessage.type),
                role: contextMenuMessage.role,
                hasJapaneseText: Boolean(
                  typeof contextMenuMessage.japaneseText === "string" && contextMenuMessage.japaneseText.trim(),
                ),
                japaneseTextLength: contextMenuMessage.japaneseText?.length ?? 0,
                disabled: !canTranslateContextMenuMessage,
              });
              void playSoftTickSound("tap");
              void handleTranslateSingleMessage(contextMenuMessage);
              closeMessageContextMenu();
            }}
            className={`w-full px-4 py-2 text-left text-sm ${
              canTranslateContextMenuMessage ? "hover:bg-gray-50" : "cursor-not-allowed text-gray-400"
            }`}
          >
            翻译此消息
          </button>
        </div>
      ) : null}
      {customerContextMenu && contextMenuCustomer && customerTagMenuPosition ? (
        <>
          <div
            className="fixed z-50 min-w-40 rounded-xl border border-gray-200 bg-white shadow-xl py-2"
            style={{ top: customerTagMenuPosition.menuTop, left: customerTagMenuPosition.menuLeft }}
            onClick={(event) => event.stopPropagation()}
            onMouseEnter={cancelTagSubmenuClose}
            onMouseLeave={scheduleTagSubmenuClose}
          >
            <button
              onClick={() => handleTogglePin(contextMenuCustomer)}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
            >
              {contextMenuCustomer.pinnedAt ? "取消置顶" : "置顶到顶部"}
            </button>
            <button
              onClick={() => handleRenameCustomer(contextMenuCustomer)}
              className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
            >
              备注名字
            </button>
            <button
              onMouseEnter={() => {
                cancelTagSubmenuClose();
                setIsTagSubmenuOpen(true);
              }}
              className="flex w-full items-center justify-between px-4 py-2 text-left text-sm hover:bg-gray-50"
            >
              <span>标签</span>
              <span className="text-gray-400">&gt;</span>
            </button>
          </div>
          {isTagSubmenuOpen ? (
            <div
              className="fixed z-[60] w-[220px] rounded-xl border border-gray-200 bg-white py-2 shadow-xl"
              style={{ top: customerTagMenuPosition.submenuTop, left: customerTagMenuPosition.submenuLeft }}
              onMouseEnter={() => {
                cancelTagSubmenuClose();
                setIsTagSubmenuOpen(true);
              }}
              onMouseLeave={scheduleTagSubmenuClose}
              onClick={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => {
                  if (!canCreateMoreTags) {
                    showOpNotice("最多只能创建 10 个标签");
                    return;
                  }
                  handleOpenTagCreateDialog();
                }}
                disabled={!canCreateMoreTags}
                className="w-full border-b border-gray-100 px-4 py-2 text-left text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
              >
                + 添加标签
              </button>
              {isLoadingTags ? (
                <div className="px-4 py-2 text-xs text-gray-400">加载标签中...</div>
              ) : allTags.length === 0 ? (
                <div className="px-4 py-2 text-xs text-gray-400">暂无标签</div>
              ) : (
                <div className="max-h-64 overflow-y-auto py-1">
                  {allTags.map((tag) => {
                    const hasTag = contextMenuCustomer.tags.some((item) => item.id === tag.id);
                    const updatingKey = `${contextMenuCustomer.id}:${tag.id}`;
                    const isUpdating = updatingCustomerTagKey === updatingKey;
                    return (
                      <div key={tag.id} className="flex items-center gap-1 px-2 py-1">
                        <button
                          type="button"
                          onClick={() => {
                            void handleToggleCustomerTag(contextMenuCustomer, tag);
                          }}
                          disabled={!!updatingCustomerTagKey || isDeletingTag}
                          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
                            style={{ backgroundColor: tag.color || "#94A3B8" }}
                          />
                          <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                          <span className="text-xs text-gray-500">{isUpdating ? "..." : hasTag ? "✓" : ""}</span>
                        </button>
                        <button
                          type="button"
                          aria-label={`删除标签 ${tag.name}`}
                          title={`删除标签 ${tag.name}`}
                          onClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            handleOpenTagDeleteDialog(tag);
                          }}
                          disabled={!!updatingCustomerTagKey || isDeletingTag}
                          className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-xs text-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          删
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : null}
        </>
      ) : null}
      {isTagCreateDialogOpen ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/20 px-4"
          onClick={() => {
            handleCloseTagCreateDialog();
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-sm font-semibold text-gray-900">添加标签</div>
            <input
              type="text"
              value={newTagName}
              onChange={(event) => setNewTagName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  handleCloseTagCreateDialog();
                  return;
                }
                if (event.key === "Enter" && !isCreatingTag) {
                  event.preventDefault();
                  void handleCreateTagAndAttach();
                }
              }}
              placeholder="请输入标签名称"
              maxLength={20}
              className="mt-3 w-full rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-green-300 focus:ring-2 focus:ring-green-100"
            />
            {tagCreateError ? (
              <div className="mt-2 text-xs text-rose-600">{tagCreateError}</div>
            ) : null}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  handleCloseTagCreateDialog();
                }}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleCreateTagAndAttach();
                }}
                disabled={isCreatingTag}
                className="rounded-xl bg-green-600 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isCreatingTag ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isTagDeleteDialogOpen && tagDeleteTarget ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 px-4"
          onClick={() => {
            handleCloseTagDeleteDialog();
          }}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-gray-200 bg-white p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="text-sm font-semibold text-gray-900">删除标签</div>
            <div className="mt-3 text-sm text-gray-700">
              删除标签“{tagDeleteTarget.name}”？<br />
              删除后会从所有客户身上移除该标签。
            </div>
            {tagDeleteError ? (
              <div className="mt-2 text-xs text-rose-600">{tagDeleteError}</div>
            ) : null}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  handleCloseTagDeleteDialog();
                }}
                className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleDeleteTagGlobally();
                }}
                disabled={isDeletingTag}
                className="rounded-xl bg-rose-600 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isDeletingTag ? "删除中..." : "删除"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {opNotice ? (
        <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-900/90 px-4 py-2 text-xs text-white shadow-lg">
          {opNotice}
        </div>
      ) : null}
    </div>
  );
}
export default function Home() {
  return (
    <Suspense
      fallback={
        <div className="h-screen bg-gray-100 flex items-center justify-center">
          <div className="rounded-2xl border border-gray-200 bg-white px-6 py-4 text-sm text-gray-500 shadow-sm">
            页面加载中...
          </div>
        </div>
      }
    >
      <HomePageContent />
    </Suspense>
  );
}

