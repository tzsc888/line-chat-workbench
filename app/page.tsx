"use client";
import * as Ably from "ably";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { MessageSource } from "@prisma/client";
import { deriveDraftPresentation } from "@/lib/ai/draft-presentation";
import { AiAssistantPanel } from "@/app/components/ai-assistant-panel";
type FollowupSummary = {
  bucket: "UNCONVERTED" | "VIP";
  tier: "A" | "B" | "C";
  state: "ACTIVE" | "OBSERVING" | "WAITING_WINDOW" | "POST_PURCHASE_CARE" | "DONE" | "PAUSED";
  reason: string;
  nextFollowupAt: string | null;
  isOverdue: boolean;
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
  aiCustomerInfo: string | null;
  aiCurrentStrategy: string | null;
  aiLastAnalyzedAt: string | null;
  lastMessageAt: string | null;
  riskTags?: string[];
  followup: FollowupSummary | null;
  tags: {
    id: string;
    name: string;
    color: string | null;
  }[];
  latestMessage: {
    id: string;
    role: "CUSTOMER" | "OPERATOR";
    type: "TEXT" | "IMAGE" | "STICKER";
    source: "LINE" | "MANUAL" | "AI_SUGGESTION";
    japaneseText: string;
    chineseText: string | null;
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
  analysisPromptVersion: string | null;
  generationPromptVersion: string | null;
  reviewPromptVersion: string | null;
  sceneType: string | null;
  routeType: string | null;
  replyGoal: string | null;
  pushLevel: string | null;
  differenceNote: string | null;
  generationBriefJson: string | null;
  reviewFlagsJson: string | null;
  programChecksJson: string | null;
  aiReviewJson: string | null;
  finalGateJson: string | null;
  selfCheckJson: string | null;
  recommendedVariant: "STABLE" | "ADVANCING" | null;
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
    aiCustomerInfo: string | null;
    aiCurrentStrategy: string | null;
    aiLastAnalyzedAt: string | null;
    lastMessageAt: string | null;
    riskTags?: string[];
    followup: FollowupSummary | null;
  };
  tags: {
    id: string;
    name: string;
    color: string | null;
  }[];
  messages: WorkspaceMessage[];
  scheduledMessages: ScheduledMessageItem[];
  latestCustomerMessageId: string | null;
  latestReplyDraftSet: ReplyDraftSet | null;
};
type RewriteResult = {
  suggestion1Ja: string;
  suggestion1Zh: string;
  suggestion2Ja: string;
  suggestion2Zh: string;
};
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
};
const CUSTOMER_PAGE_SIZE = 50;
const OPTIMISTIC_ID_PREFIX = "optimistic:";

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
function normalizeWorkspaceMessagePayload(payload: any): WorkspaceMessage | null {
  if (!payload || typeof payload !== "object" || typeof payload.id !== "string") {
    return null;
  }
  return {
    id: payload.id,
    customerId: payload.customerId,
    role: payload.role,
    type: payload.type,
    source: payload.source,
    lineMessageId: payload.lineMessageId ?? null,
    japaneseText: payload.japaneseText ?? "",
    chineseText: payload.chineseText ?? null,
    imageUrl: payload.imageUrl ?? null,
    stickerPackageId: payload.stickerPackageId ?? null,
    stickerId: payload.stickerId ?? null,
    deliveryStatus: payload.deliveryStatus ?? null,
    sendError: payload.sendError ?? null,
    lastAttemptAt: payload.lastAttemptAt ?? null,
    failedAt: payload.failedAt ?? null,
    retryCount: Number(payload.retryCount ?? 0),
    sentAt: payload.sentAt,
    createdAt: payload.createdAt ?? payload.sentAt,
    updatedAt: payload.updatedAt ?? payload.sentAt,
  };
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
  const [customerStats, setCustomerStats] = useState<CustomerListStats>({ overdueFollowupCount: 0 });
  const [customerPage, setCustomerPage] = useState(1);
  const [hasMoreCustomers, setHasMoreCustomers] = useState(false);
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
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSchedulingManual, setIsSchedulingManual] = useState(false);
  const [isSchedulePanelOpen, setIsSchedulePanelOpen] = useState(false);
  const [scheduleAtInput, setScheduleAtInput] = useState(() => buildDefaultScheduledInputValue());
  const [retryingMessageId, setRetryingMessageId] = useState("");
  const [isSendingAi, setIsSendingAi] = useState<"stable" | "advancing" | "">("");
  const [isPostGenerateSyncing, setIsPostGenerateSyncing] = useState(false);
  const [postGenerateSyncMessage, setPostGenerateSyncMessage] = useState("");
  const [pageError, setPageError] = useState("");
  const [apiError, setApiError] = useState("");
  const [helperError, setHelperError] = useState("");
  const [aiNotice, setAiNotice] = useState("");
  const clearCustomerQuery = useCallback(() => {
    if (!requestedCustomerId) return;
    router.replace(pathname, { scroll: false });
  }, [pathname, requestedCustomerId, router]);
  const playIncomingSound = useCallback(() => {
    if (!audioEnabledRef.current) return;
    const now = Date.now();
    if (now - lastIncomingSoundAtRef.current < 900) return;
    lastIncomingSoundAtRef.current = now;
    try {
      const AudioContextClass =
        typeof window !== "undefined"
          ? (window.AudioContext ||
              (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)
          : undefined;
      if (!AudioContextClass) return;
      const context = audioContextRef.current ?? new AudioContextClass();
      audioContextRef.current = context;
      if (context.state === "suspended") {
        void context.resume();
      }
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, context.currentTime);
      gain.gain.setValueAtTime(0.0001, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.06, context.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(context.currentTime);
      oscillator.stop(context.currentTime + 0.18);
    } catch (error) {
      console.error("incoming sound error:", error);
    }
  }, []);
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
  const customersRef = useRef<CustomerListItem[]>([]);
  const customerPageRef = useRef(1);
  const hasMoreCustomersRef = useRef(false);
  const searchKeywordRef = useRef("");
  const isCustomerListRequestInFlightRef = useRef(false);
  const customerListRequestIdRef = useRef(0);
  const customerListAbortControllerRef = useRef<AbortController | null>(null);
  const isSilentRefreshingRef = useRef(false);
  const workspaceRequestIdRef = useRef(0);
  const workspaceAbortControllerRef = useRef<AbortController | null>(null);
  const isRealtimeRefreshInFlightRef = useRef(false);
  const pendingRealtimeRefreshRef = useRef(false);
  const pendingRealtimeRefreshCustomerIdRef = useRef<string | null>(null);
  const selectedCustomerIdRef = useRef("");
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const ablyClientRef = useRef<Ably.Realtime | null>(null);
  const markReadInFlightRef = useRef(new Set<string>());
  const composerMenuRef = useRef<HTMLDivElement | null>(null);
  const schedulePanelRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const openChatToBottomRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const lastOpenedCustomerIdRef = useRef("");
  const hasInitializedUnreadSnapshotRef = useRef(false);
  const previousUnreadMapRef = useRef<Record<string, number>>({});
  const audioEnabledRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastIncomingSoundAtRef = useRef(0);
  const generationPollTimerRef = useRef<number | null>(null);
  const generationPollAbortRef = useRef<AbortController | null>(null);
  const activeGenerationTaskRef = useRef<{ taskId: string; customerId: string } | null>(null);
  useEffect(() => {
    return () => {
      customerListAbortControllerRef.current?.abort();
      workspaceAbortControllerRef.current?.abort();
    };
  }, []);
  const preserveCustomerListViewport = useCallback((apply: () => void) => {
    const container = customerListScrollRef.current;
    const previousScrollTop = container?.scrollTop ?? null;
    apply();
    if (previousScrollTop === null) return;
    requestAnimationFrame(() => {
      const current = customerListScrollRef.current;
      if (!current) return;
      current.scrollTop = previousScrollTop;
    });
  }, []);
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
      window.alert("读取预设信息失败，请看终端报错");
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
    }) => {
      const shouldPreserveListUi = !!options?.silent || !!options?.preserveUi || !!options?.loadMore;
      const listScrollTop = shouldPreserveListUi
        ? customerListScrollRef.current?.scrollTop ?? 0
        : 0;
      const isLoadMore = !!options?.loadMore;
      const activeSearch = options?.search ?? searchKeywordRef.current;
      const limit = Math.max(options?.limitOverride ?? CUSTOMER_PAGE_SIZE, CUSTOMER_PAGE_SIZE);
      const page = isLoadMore ? customerPageRef.current + 1 : 1;

      if (isCustomerListRequestInFlightRef.current && isLoadMore) {
        return;
      }

      const requestId = customerListRequestIdRef.current + 1;
      customerListRequestIdRef.current = requestId;
      const abortController = new AbortController();
      customerListAbortControllerRef.current?.abort();
      customerListAbortControllerRef.current = abortController;

      try {
        isCustomerListRequestInFlightRef.current = true;
        if (isLoadMore) {
          setIsLoadingMoreCustomers(true);
        } else if (!options?.silent && !shouldPreserveListUi) {
          setIsListLoading(true);
        }
        setPageError("");

        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("limit", String(limit));
        if (activeSearch) {
          params.set("q", activeSearch);
        }

        const response = await fetch(`/api/customers?${params.toString()}`, {
          cache: "no-store",
          signal: abortController.signal,
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data?.error || "读取顾客列表失败");
        }

        if (requestId !== customerListRequestIdRef.current) {
          return;
        }

        const list: CustomerListItem[] = data.customers || [];
        const nextHasMore = !!data.hasMore;
        const nextPage = Number(data.page || page);
        const nextStats: CustomerListStats = data.stats || { overdueFollowupCount: 0 };

        setCustomers((prev) => {
          if (isLoadMore) {
            const merged = new Map<string, CustomerListItem>();
            for (const item of prev) merged.set(item.id, item);
            for (const item of list) merged.set(item.id, item);
            return sortCustomerList(Array.from(merged.values()));
          }
          return sortCustomerList(list);
        });

        const loadedPinnedCountAfterFetch = list.filter((item) => !!item.pinnedAt).length;
        const loadedRegularCountAfterFetch = Math.max(0, list.length - loadedPinnedCountAfterFetch);
        const nextPageValue =
          !activeSearch && !isLoadMore
            ? Math.max(1, Math.ceil(loadedRegularCountAfterFetch / CUSTOMER_PAGE_SIZE))
            : nextPage;

        setCustomerStats(nextStats);
        setCustomerPage(nextPageValue);
        setHasMoreCustomers(nextHasMore);
        customerPageRef.current = nextPageValue;
        hasMoreCustomersRef.current = nextHasMore;
        searchKeywordRef.current = activeSearch;

        setSelectedCustomerId((prev) => {
          if (prev && list.some((item) => item.id === prev)) return prev;
          if (prev && customersRef.current.some((item) => item.id === prev)) return prev;
          return prev;
        });

        if (shouldPreserveListUi) {
          requestAnimationFrame(() => {
            const container = customerListScrollRef.current;
            if (!container) return;
            container.scrollTop = listScrollTop;
          });
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
        if (requestId === customerListRequestIdRef.current) {
          isCustomerListRequestInFlightRef.current = false;
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
    []
  );
  const markCustomerRead = useCallback(async (customerId: string) => {
    if (!customerId || markReadInFlightRef.current.has(customerId)) return;
    markReadInFlightRef.current.add(customerId);
    try {
      await fetch(`/api/customers/${customerId}/workspace`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          markRead: true,
        }),
      });
    } catch (error) {
      console.error("mark customer read error:", error);
    } finally {
      markReadInFlightRef.current.delete(customerId);
    }
  }, []);
  const loadWorkspace = useCallback(
    async (customerId: string, options?: { preserveUi?: boolean }) => {
      if (!customerId) {
        workspaceAbortControllerRef.current?.abort();
        workspaceAbortControllerRef.current = null;
        setWorkspace(null);
        return;
      }
      const preserveUi = !!options?.preserveUi;
      const requestId = workspaceRequestIdRef.current + 1;
      workspaceRequestIdRef.current = requestId;
      const abortController = new AbortController();
      workspaceAbortControllerRef.current?.abort();
      workspaceAbortControllerRef.current = abortController;

      const container = chatScrollRef.current;
      let previousScrollTop = 0;
      let previousScrollHeight = 0;
      let wasNearBottom = false;
      if (preserveUi && container) {
        previousScrollTop = container.scrollTop;
        previousScrollHeight = container.scrollHeight;
        wasNearBottom =
          container.scrollHeight - container.scrollTop - container.clientHeight < 80;
        isSilentRefreshingRef.current = true;
      }
      try {
        if (!preserveUi) {
          setIsWorkspaceLoading(true);
          setPageError("");
          setCustomReply(null);
          setRewriteInput("");
          setManualReply("");
          setPendingImages([]);
          setApiError("");
          setHelperError("");
          setAiNotice("");
        }
        const response = await fetch(`/api/customers/${customerId}/workspace`, {
          cache: "no-store",
          signal: abortController.signal,
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data?.error || "读取顾客工作台失败");
        }

        if (requestId !== workspaceRequestIdRef.current) {
          return;
        }

        const nextWorkspace: WorkspaceData | null = data.workspace || null;
        setWorkspace(nextWorkspace);
        if (nextWorkspace?.customer) {
          setCustomers((prev) =>
            prev.map((item) =>
              item.id === nextWorkspace.customer.id
                ? {
                    ...item,
                    remarkName: nextWorkspace.customer.remarkName,
                    pinnedAt: nextWorkspace.customer.pinnedAt,
                    unreadCount: nextWorkspace.customer.unreadCount,
                    followup: nextWorkspace.customer.followup,
                  }
                : item
            )
          );
        }
        if (preserveUi) {
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
        if (!preserveUi && requestId === workspaceRequestIdRef.current) {
          setWorkspace(null);
          setPageError(String(error));
        }
      } finally {
        if (requestId === workspaceRequestIdRef.current) {
          setIsWorkspaceLoading(false);
          if (workspaceAbortControllerRef.current === abortController) {
            workspaceAbortControllerRef.current = null;
          }
          isSilentRefreshingRef.current = false;
        }
      }
    },
    []
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
        const loadedRegularCount = Math.max(
          0,
          customersRef.current.filter((item) => !item.pinnedAt).length
        );
        await loadCustomers({
          silent: true,
          preserveUi: true,
          limitOverride: Math.max(loadedRegularCount, CUSTOMER_PAGE_SIZE),
          search: searchKeywordRef.current,
        });
        const activeCustomerId = selectedCustomerIdRef.current;
        if (activeCustomerId && (!nextTargetCustomerId || nextTargetCustomerId === activeCustomerId)) {
          await loadWorkspace(activeCustomerId, { preserveUi: true });
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
    [loadCustomers, loadWorkspace]
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
  }, []);
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
    },
    []
  );
  const updateCustomerLatestMessage = useCallback(
    (customerId: string, message: WorkspaceMessage | OptimisticWorkspaceMessage) => {
      preserveCustomerListViewport(() => {
        setCustomers((prev) =>
          sortCustomerList(
            prev.map((item) =>
              item.id === customerId
                ? {
                    ...item,
                    lastMessageAt: message.sentAt,
                    latestMessage: buildCustomerLatestMessage(message),
                  }
                : item
            )
          )
        );
      });
    },
    [preserveCustomerListViewport]
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
          if (params.type === "TEXT") {
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

      preserveCustomerListViewport(() => {
        setCustomers((prev) =>
          sortCustomerList(
            prev.map((item) => {
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
            })
          )
        );
      });
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
        setCustomers(previousCustomers);
        setWorkspace(previousWorkspace);
        throw new Error(data?.error || "更新顾客信息失败");
      }

      const nextCustomer = data.customer;
      preserveCustomerListViewport(() => {
        setCustomers((prev) =>
          sortCustomerList(
            prev.map((item) =>
              item.id === customerId
                ? {
                    ...item,
                    remarkName: nextCustomer.remarkName,
                    pinnedAt: nextCustomer.pinnedAt,
                    unreadCount: nextCustomer.unreadCount,
                  }
                : item
            )
          )
        );
      });
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
      }
    },
    [preserveCustomerListViewport, workspace]
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
    searchKeywordRef.current = debouncedSearchText;
  }, [customerPage, hasMoreCustomers, debouncedSearchText]);
  useEffect(() => {
    void loadCustomers({ reset: true, search: debouncedSearchText });
  }, [debouncedSearchText, loadCustomers]);
  useEffect(() => {
    void loadWorkspace(selectedCustomerId);
  }, [selectedCustomerId, loadWorkspace]);
  useEffect(() => {
    selectedCustomerIdRef.current = selectedCustomerId;
  }, [selectedCustomerId]);
  useEffect(() => {
    setIsSchedulePanelOpen(false);
    setScheduleAtInput(buildDefaultScheduledInputValue());
  }, [selectedCustomerId]);
  useEffect(() => {
    resizeManualReplyTextarea();
  }, [manualReply, resizeManualReplyTextarea]);
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
    if (!customers.length) {
      previousUnreadMapRef.current = {};
      hasInitializedUnreadSnapshotRef.current = true;
      return;
    }
    const nextUnreadMap = Object.fromEntries(customers.map((customer) => [customer.id, customer.unreadCount]));
    if (!hasInitializedUnreadSnapshotRef.current) {
      previousUnreadMapRef.current = nextUnreadMap;
      hasInitializedUnreadSnapshotRef.current = true;
      return;
    }
    const hasIncomingUnread = customers.some((customer) => {
      const previousUnread = previousUnreadMapRef.current[customer.id] ?? 0;
      const latestPreviewFromCustomer = customer.latestMessage?.role === "CUSTOMER";
      return latestPreviewFromCustomer && customer.unreadCount > previousUnread;
    });
    if (hasIncomingUnread) {
      playIncomingSound();
    }
    previousUnreadMapRef.current = nextUnreadMap;
  }, [customers, playIncomingSound]);
  useEffect(() => {
    function handleDocumentClick(event: MouseEvent) {
      const target = event.target as Node;
      if (composerMenuRef.current && !composerMenuRef.current.contains(target)) {
        setIsComposerMenuOpen(false);
      }
      if (schedulePanelRef.current && !schedulePanelRef.current.contains(target)) {
        setIsSchedulePanelOpen(false);
      }
    }
    document.addEventListener("mousedown", handleDocumentClick);
    return () => document.removeEventListener("mousedown", handleDocumentClick);
  }, []);
  useEffect(() => {
    const selectedCustomer = customers.find((item) => item.id === selectedCustomerId);
    if (!selectedCustomerId || !selectedCustomer?.unreadCount) return;
    setCustomers((prev) =>
      prev.map((item) =>
        item.id === selectedCustomerId ? { ...item, unreadCount: 0 } : item
      )
    );
    void markCustomerRead(selectedCustomerId);
  }, [customers, selectedCustomerId, markCustomerRead]);
  useEffect(() => {
    const handleCloseContextMenu = () => setCustomerContextMenu(null);
    window.addEventListener("click", handleCloseContextMenu);
    window.addEventListener("resize", handleCloseContextMenu);
    return () => {
      window.removeEventListener("click", handleCloseContextMenu);
      window.removeEventListener("resize", handleCloseContextMenu);
    };
  }, []);
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
    const handleRefresh = (message: any) => {
      if (realtimeRefreshTimerRef.current) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }
      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        const payload =
          message && typeof message === "object" ? message.data || {} : {};
        const targetCustomerId =
          payload && typeof payload.customerId === "string" && payload.customerId.trim()
            ? payload.customerId.trim()
            : null;
        void runRealtimeRefresh(targetCustomerId);
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
  }, [runRealtimeRefresh]);
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
  const displayedSuggestion2Ja =
    customReply?.suggestion2Ja ||
    workspace?.latestReplyDraftSet?.advancingJapanese ||
    "";
  const displayedSuggestion2Zh =
    customReply?.suggestion2Zh ||
    workspace?.latestReplyDraftSet?.advancingChinese ||
    "";
  const latestDraft = workspace?.latestReplyDraftSet || null;
  const draftPresentation = useMemo(
    () => deriveDraftPresentation(latestDraft, workspace?.latestCustomerMessageId || null),
    [latestDraft, workspace?.latestCustomerMessageId]
  );
  const latestDraftGenerationBrief = draftPresentation.generationBrief;
  const latestDraftReviewFlags = draftPresentation.reviewFlags;
  const latestDraftAiReview = draftPresentation.aiReview;
  const latestDraftSelfCheck = draftPresentation.selfCheck;
  const isLatestDraftUsed = draftPresentation.isUsed;
  const isLatestDraftStale = draftPresentation.isStale;
  const isLatestDraftBlocked = draftPresentation.isBlocked;
  const shouldDimDraft = draftPresentation.shouldDimDraft;
  const latestDraftIssues = draftPresentation.issues;
  const latestDraftStatusNote = draftPresentation.statusNote;
  const latestDraftReviewSummary = draftPresentation.reviewSummary;
  const latestDraftPrimaryActionLabel = draftPresentation.primaryActionLabel;
  const latestDraftPrimaryActionHint = draftPresentation.primaryActionHint;
  useEffect(() => {
    setCustomReply(null);
    setAiNotice("");
    setIsPostGenerateSyncing(false);
    setPostGenerateSyncMessage("");
  }, [selectedCustomerId, workspace?.latestReplyDraftSet?.id, workspace?.latestCustomerMessageId]);
  const runPostGenerateRefresh = useCallback((customerId: string) => {
    setIsPostGenerateSyncing(true);
    setPostGenerateSyncMessage("");
    void (async () => {
      const [workspaceResult, customersResult] = await Promise.allSettled([
        loadWorkspace(customerId, { preserveUi: true }),
        loadCustomers({ preserveUi: true }),
      ]);
      const failures = [workspaceResult, customersResult].filter((result) => result.status === "rejected");
      if (failures.length > 0) {
        const hasNonAbortFailure = failures.some((result) => {
          const reason = (result as PromiseRejectedResult).reason;
          return !isAbortError(reason);
        });
        if (hasNonAbortFailure) {
          setPostGenerateSyncMessage("建议已可用，后台同步失败；稍后会自动重试。");
        }
      } else {
        setPostGenerateSyncMessage("");
      }
      setIsPostGenerateSyncing(false);
    })();
  }, [loadCustomers, loadWorkspace]);
  const stopGenerationPolling = useCallback(() => {
    if (generationPollTimerRef.current != null) {
      window.clearTimeout(generationPollTimerRef.current);
      generationPollTimerRef.current = null;
    }
    if (generationPollAbortRef.current) {
      generationPollAbortRef.current.abort();
      generationPollAbortRef.current = null;
    }
    activeGenerationTaskRef.current = null;
  }, []);
  const formatGenerationTaskError = useCallback((task: GenerationTaskView) => {
    const code = String(task.errorCode || "").trim();
    const message = String(task.errorMessage || "").trim();
    if (code === "MODEL_TIMEOUT") return "Generation failed: model timeout.";
    if (code === "MODEL_JSON_PARSE_ERROR") return "Generation failed: malformed JSON output.";
    if (code === "MODEL_SCHEMA_INVALID") return "Generation failed: schema validation failed.";
    if (code === "generation_missing_japanese_reply") return "Generation failed: missing Japanese reply.";
    if (code === "generation_missing_chinese_meaning") return "Generation failed: missing Chinese meaning.";
    if (code === "TASK_STALE_TIMEOUT") return "Generation failed: task timed out and reached retry limit.";
    if (message) return message;
    return code ? `Generation failed: ${code}` : "Generation failed: unknown error.";
  }, []);
  const startGenerationPolling = useCallback((taskId: string, customerId: string) => {
    stopGenerationPolling();
    activeGenerationTaskRef.current = { taskId, customerId };

    const poll = async () => {
      const active = activeGenerationTaskRef.current;
      if (!active || active.taskId !== taskId || active.customerId !== customerId) return;

      const controller = new AbortController();
      generationPollAbortRef.current = controller;

      try {
        const response = await fetch(
          `/api/generate-replies/tasks/${encodeURIComponent(taskId)}?customerId=${encodeURIComponent(customerId)}`,
          { method: "GET", signal: controller.signal },
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.ok || !payload?.task) {
          throw new Error(payload?.error || `task_status_http_${response.status}`);
        }

        const task = payload.task as GenerationTaskView;
        if (task.status === "SUCCEEDED") {
          stopGenerationPolling();
          if (selectedCustomerIdRef.current !== customerId) return;
          setIsGenerating(false);
          setApiError("");
          setAiNotice("Suggestions are ready.");
          setRewriteInput("");
          runPostGenerateRefresh(customerId);
          return;
        }

        if (task.status === "FAILED") {
          stopGenerationPolling();
          if (selectedCustomerIdRef.current !== customerId) return;
          setIsGenerating(false);
          const errorText = formatGenerationTaskError(task);
          setApiError(errorText);
          setAiNotice("");
          window.alert(errorText);
          return;
        }

        if (selectedCustomerIdRef.current === customerId) {
          setAiNotice("Generating reply suggestions...");
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        stopGenerationPolling();
        if (selectedCustomerIdRef.current === customerId) {
          setIsGenerating(false);
          setApiError(String(error instanceof Error ? error.message : error));
        }
        return;
      } finally {
        generationPollAbortRef.current = null;
      }

      generationPollTimerRef.current = window.setTimeout(poll, 1200);
    };

    void poll();
  }, [formatGenerationTaskError, runPostGenerateRefresh, stopGenerationPolling]);
  useEffect(() => {
    stopGenerationPolling();
    setIsGenerating(false);
  }, [selectedCustomerId, stopGenerationPolling]);
  useEffect(() => {
    return () => {
      stopGenerationPolling();
    };
  }, [stopGenerationPolling]);
  async function handleRewrite() {
    if (!workspace) {
      window.alert("No customer selected.");
      return;
    }
    try {
      setIsGenerating(true);
      setApiError("");
      setAiNotice("");
      setCustomReply(null);
      setPostGenerateSyncMessage("");
      stopGenerationPolling();
      const response = await fetch("/api/generate-replies", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerId: workspace.customer.id,
          rewriteInput,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "generate_failed");
      }
      const taskId = String(data?.taskId || "").trim();
      if (!taskId) throw new Error("missing taskId");
      setAiNotice("Generating reply suggestions...");
      startGenerationPolling(taskId, workspace.customer.id);
    } catch (error) {
      console.error(error);
      stopGenerationPolling();
      setIsGenerating(false);
      setApiError(String(error));
      window.alert("Generate failed. Please check the error panel.");
    }
  }
  async function handleAnalyzeCustomer() {
    if (!workspace) {
      window.alert("当前没有选中的顾客");
      return;
    }
    try {
      setIsAnalyzing(true);
      setHelperError("");
      setAiNotice("");
      setCustomReply(null);
      const response = await fetch("/api/analyze-customer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerId: workspace.customer.id,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "分析失败");
      }
      if (data?.analysis?.routing_decision?.should_generate_reply === false) {
        setAiNotice(data?.analysis?.routing_decision?.route_reason || "当前局面不建议自动生成建议回复，已刷新判断结果");
      } else {
        setAiNotice("已刷新当前判断与跟进状态");
      }
      await loadWorkspace(workspace.customer.id);
      await loadCustomers({ preserveUi: true });
    } catch (error) {
      console.error(error);
      setHelperError(String(error));
      window.alert("分析刷新失败，请看右侧错误提示或终端报错");
    } finally {
      setIsAnalyzing(false);
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
      window.alert("保存预设信息失败，请看终端报错");
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
      window.alert("删除预设信息失败，请看终端报错");
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
    const nextImages = [...pendingImages];
    setManualReply("");
    setPendingImages([]);

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

    void submitOutboundMessage({
      customerId: workspace.customer.id,
      japaneseText,
      source: "MANUAL",
      type: "TEXT",
    });
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
      japaneseText: "[贴图]",
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
    if (scheduledFor.getTime() - Date.now() < 30 * 60 * 1000) {
      window.alert("定时发送至少要比当前时间晚 30 分钟");
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
      await loadWorkspace(workspace.customer.id, { preserveUi: true });
      await loadCustomers({ preserveUi: true });
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
      await loadWorkspace(workspace.customer.id, { preserveUi: true });
      await loadCustomers({ preserveUi: true });
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
    openChatToBottomRef.current = true;
    shouldStickToBottomRef.current = true;
    setSelectedCustomerId(customerId);
    setCustomerContextMenu(null);
    clearCustomerQuery();
    setCustomers((prev) =>
      prev.map((item) =>
        item.id === customerId ? { ...item, unreadCount: 0 } : item
      )
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
  }
  const contextMenuCustomer = customerContextMenu?.customer || null;
  const overdueFollowupCount = customerStats.overdueFollowupCount;
  const canManualSend = !!workspace && !isUploadingImage && (pendingImages.length > 0 || !!manualReply.trim());
  const canScheduleManual = !!workspace && !isSchedulingManual && !isUploadingImage && pendingImages.length === 0 && !!manualReply.trim();
  return (
    <div className="h-screen bg-gray-100 flex">
      <div ref={customerListScrollRef} className="w-[24%] bg-gray-50 border-r border-gray-200 p-4 overflow-y-auto">
        <div className="mb-3 flex items-center justify-between gap-3">
          <button onClick={handleCollapseChat} className="text-lg font-bold text-left hover:text-green-700 transition">顾客列表</button>
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
              return (
                <div
                  key={customer.id}
                  onClick={() => handleSelectCustomer(customer.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setCustomerContextMenu({
                      customer,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  className={`group h-[76px] px-3 rounded-xl cursor-pointer border transition-all shadow-sm ${
                    isActive
                      ? "bg-green-50 border-green-200 shadow-green-100/80"
                      : "bg-white border-gray-200 hover:bg-gray-50 hover:border-gray-300"
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
                          <div className="truncate text-[14px] font-semibold text-gray-900">
                            {getDisplayName(customer)}
                          </div>
                        </div>
                        <div className="shrink-0 text-[11px] text-gray-400">
                          {formatListTime(customer.lastMessageAt)}
                        </div>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <div className="min-w-0 flex-1 truncate text-[12px] text-gray-500">
                          {latestPreview}
                        </div>
                        {customer.followup ? (
                          <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 border border-slate-200">
                            {getFollowupTierLabel(customer.followup.tier)}
                          </span>
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
              {isLoadingMoreCustomers ? "正在加载更多顾客..." : hasMoreCustomers ? "下滑继续加载更多" : displayedCustomers.length > 0 ? "已经到底了" : ""}
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
                              <div className="text-xs font-semibold tracking-wide">LINE贴图</div>
                              <div className="mt-1 text-xs opacity-80">packageId: {msg.stickerPackageId || "-"}</div>
                              <div className="text-xs opacity-80">stickerId: {msg.stickerId || "-"}</div>
                            </div>
                            {msg.japaneseText && msg.japaneseText !== "[贴图]" ? (
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
            <div className="flex gap-2 items-end">
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
                      onClick={handleSendSticker}
                      className="w-full px-4 py-3 text-left text-sm hover:bg-gray-50 border-t border-gray-100"
                    >
                      发送贴图
                      <div className="text-[11px] text-gray-400 mt-1">输入 packageId 和 stickerId 后立即发送</div>
                    </button>
                    <button
                      onClick={openPresetPanel}
                      className="w-full px-4 py-3 text-left text-sm hover:bg-gray-50 border-t border-gray-100"
                    >
                      预设信息
                      <div className="text-[11px] text-gray-400 mt-1">点一下填入输入框</div>
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
                placeholder={pendingImages.length > 0 ? "可选填写补充文字；发送时会拆成“多张图片 + 文字”多条消息…" : "输入要发送给顾客的日语内容…"}
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
                    <div className="mt-1 text-xs text-gray-500">至少比当前时间晚 30 分钟。到点后系统会自动发送，就算你关掉页面也照样会发。当前定时发送只支持文字。</div>
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
                {isUploadingImage ? "上传中..." : pendingImages.length > 0 ? `发送${pendingImages.length}张图片` : "发送"}
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
        workspace={workspace}
        latestDraft={latestDraft}
        latestDraftGenerationBrief={latestDraftGenerationBrief}
        latestDraftReviewFlags={latestDraftReviewFlags}
        latestDraftAiReview={latestDraftAiReview}
        latestDraftSelfCheck={latestDraftSelfCheck}
        latestDraftIssues={latestDraftIssues}
        latestDraftStatusNote={latestDraftStatusNote}
        latestDraftReviewSummary={latestDraftReviewSummary}
        latestDraftPrimaryActionLabel={latestDraftPrimaryActionLabel}
        latestDraftPrimaryActionHint={latestDraftPrimaryActionHint}
        isLatestDraftUsed={isLatestDraftUsed}
        isLatestDraftStale={isLatestDraftStale}
        isLatestDraftBlocked={isLatestDraftBlocked}
        shouldDimDraft={shouldDimDraft}
        displayedSuggestion1Ja={displayedSuggestion1Ja}
        displayedSuggestion1Zh={displayedSuggestion1Zh}
        displayedSuggestion2Ja={displayedSuggestion2Ja}
        displayedSuggestion2Zh={displayedSuggestion2Zh}
        rewriteInput={rewriteInput}
        onRewriteInputChange={setRewriteInput}
        onAnalyzeCustomer={handleAnalyzeCustomer}
        onRewrite={handleRewrite}
        onSendStable={() => addAiReplyToChat(displayedSuggestion1Ja, displayedSuggestion1Zh, "stable")}
        onSendAdvancing={() => addAiReplyToChat(displayedSuggestion2Ja, displayedSuggestion2Zh, "advancing")}
        isAnalyzing={isAnalyzing}
        isGenerating={isGenerating}
        isSendingAi={isSendingAi}
        helperError={helperError}
        apiError={apiError}
        aiNotice={aiNotice}
        onLogout={handleLogout}
        loggingOut={loggingOut}
        isPostGenerateSyncing={isPostGenerateSyncing}
        postGenerateSyncMessage={postGenerateSyncMessage}
      />
      </div>
      {customerContextMenu && contextMenuCustomer ? (
        <div
          className="fixed z-50 min-w-40 rounded-xl border border-gray-200 bg-white shadow-xl py-2"
          style={{ top: customerContextMenu.y, left: customerContextMenu.x }}
          onClick={(event) => event.stopPropagation()}
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
