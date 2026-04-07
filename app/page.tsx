"use client";

import * as Ably from "ably";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  aiCustomerInfo: string | null;
  aiCurrentStrategy: string | null;
  aiLastAnalyzedAt: string | null;
  lastMessageAt: string | null;
  tags: {
    id: string;
    name: string;
    color: string | null;
  }[];
  latestMessage: {
    id: string;
    role: "CUSTOMER" | "OPERATOR";
    type: "TEXT" | "IMAGE";
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
  type: "TEXT" | "IMAGE";
  source: "LINE" | "MANUAL" | "AI_SUGGESTION";
  lineMessageId: string | null;
  japaneseText: string;
  chineseText: string | null;
  imageUrl: string | null;
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
  selectedVariant: "STABLE" | "ADVANCING" | null;
  selectedAt: string | null;
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
    aiCustomerInfo: string | null;
    aiCurrentStrategy: string | null;
    aiLastAnalyzedAt: string | null;
    lastMessageAt: string | null;
  };
  tags: {
    id: string;
    name: string;
    color: string | null;
  }[];
  messages: WorkspaceMessage[];
  latestCustomerMessageId: string | null;
  latestReplyDraftSet: ReplyDraftSet | null;
};

type RewriteResult = {
  suggestion1Ja: string;
  suggestion1Zh: string;
  suggestion2Ja: string;
  suggestion2Zh: string;
};

type CustomerContextMenuState = {
  customerId: string;
  x: number;
  y: number;
};

function getDisplayName(customer: Pick<CustomerListItem, "remarkName" | "originalName"> | null | undefined) {
  if (!customer) return "未选择顾客";
  return customer.remarkName?.trim() || customer.originalName || "未命名顾客";
}

function getAvatarText(customer: Pick<CustomerListItem, "remarkName" | "originalName"> | null) {
  const text = getDisplayName(customer);
  return text.slice(0, 1).toUpperCase();
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

export default function Home() {
  const [customers, setCustomers] = useState<CustomerListItem[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [workspace, setWorkspace] = useState<WorkspaceData | null>(null);

  const [searchText, setSearchText] = useState("");
  const [rewriteInput, setRewriteInput] = useState("");
  const [manualReply, setManualReply] = useState("");
  const [customReply, setCustomReply] = useState<RewriteResult | null>(null);
  const [customerContextMenu, setCustomerContextMenu] =
    useState<CustomerContextMenuState | null>(null);

  const [isListLoading, setIsListLoading] = useState(true);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isSendingManual, setIsSendingManual] = useState(false);
  const [isSendingAi, setIsSendingAi] = useState<"stable" | "advancing" | "">("");

  const [pageError, setPageError] = useState("");
  const [apiError, setApiError] = useState("");
  const [helperError, setHelperError] = useState("");

  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const isSilentRefreshingRef = useRef(false);
  const selectedCustomerIdRef = useRef("");
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const ablyClientRef = useRef<Ably.Realtime | null>(null);
  const markReadInFlightRef = useRef(new Set<string>());

  const loadCustomers = useCallback(async (options?: { silent?: boolean }) => {
    try {
      if (!options?.silent) {
        setIsListLoading(true);
      }

      setPageError("");

      const response = await fetch("/api/customers", {
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "读取顾客列表失败");
      }

      const list: CustomerListItem[] = data.customers || [];
      setCustomers(list);

      setSelectedCustomerId((prev) => {
        if (prev && list.some((item) => item.id === prev)) return prev;
        return list[0]?.id || "";
      });
    } catch (error) {
      console.error(error);
      setPageError(String(error));
    } finally {
      if (!options?.silent) {
        setIsListLoading(false);
      }
    }
  }, []);

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
        setWorkspace(null);
        return;
      }

      const preserveUi = !!options?.preserveUi;
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
          setApiError("");
          setHelperError("");
        }

        const response = await fetch(`/api/customers/${customerId}/workspace`, {
          cache: "no-store",
        });

        const data = await response.json();

        if (!response.ok || !data.ok) {
          throw new Error(data?.error || "读取顾客工作台失败");
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
        console.error(error);
        if (!preserveUi) {
          setWorkspace(null);
          setPageError(String(error));
        }
      } finally {
        if (!preserveUi) {
          setIsWorkspaceLoading(false);
        }
        isSilentRefreshingRef.current = false;
      }
    },
    []
  );

  const patchCustomerMeta = useCallback(
    async (
      customerId: string,
      payload: { pinned?: boolean; remarkName?: string | null; markRead?: boolean }
    ) => {
      const response = await fetch(`/api/customers/${customerId}/workspace`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "更新顾客信息失败");
      }

      await loadCustomers({ silent: true });
      if (selectedCustomerIdRef.current === customerId) {
        await loadWorkspace(customerId, { preserveUi: true });
      }
    },
    [loadCustomers, loadWorkspace]
  );

  useEffect(() => {
    loadCustomers();
  }, [loadCustomers]);

  useEffect(() => {
    if (!selectedCustomerId) return;
    loadWorkspace(selectedCustomerId);
  }, [selectedCustomerId, loadWorkspace]);

  useEffect(() => {
    selectedCustomerIdRef.current = selectedCustomerId;
  }, [selectedCustomerId]);

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
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [selectedCustomerId]);

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
        if (isSilentRefreshingRef.current) return;

        const payload =
          message && typeof message === "object" ? message.data || {} : {};
        const activeCustomerId = selectedCustomerIdRef.current;

        loadCustomers({ silent: true });

        if (
          activeCustomerId &&
          (!payload.customerId || payload.customerId === activeCustomerId)
        ) {
          loadWorkspace(activeCustomerId, { preserveUi: true });
        }
      }, 250);
    };

    channel.subscribe("refresh", handleRefresh);

    return () => {
      if (realtimeRefreshTimerRef.current) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }

      channel.unsubscribe("refresh", handleRefresh);
      client.close();
      ablyClientRef.current = null;
    };
  }, [loadCustomers, loadWorkspace]);

  const filteredCustomers = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();

    if (!keyword) return customers;

    return customers.filter((customer) => {
      const displayName = getDisplayName(customer);
      const tagText = customer.tags.map((tag) => tag.name).join(" ");
      const latestPreview = customer.latestMessage?.previewText || "";
      return (
        displayName.toLowerCase().includes(keyword) ||
        customer.originalName.toLowerCase().includes(keyword) ||
        tagText.toLowerCase().includes(keyword) ||
        latestPreview.toLowerCase().includes(keyword)
      );
    });
  }, [customers, searchText]);

  const currentListCustomer =
    filteredCustomers.find((item) => item.id === selectedCustomerId) ||
    filteredCustomers[0] ||
    customers.find((item) => item.id === selectedCustomerId) ||
    customers[0] ||
    null;

  useEffect(() => {
    if (!currentListCustomer) return;
    if (currentListCustomer.id !== selectedCustomerId) {
      setSelectedCustomerId(currentListCustomer.id);
    }
  }, [currentListCustomer, selectedCustomerId]);

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
  const isLatestDraftUsed = !!latestDraft?.selectedVariant;
  const isLatestDraftStale =
    !!latestDraft &&
    !!workspace?.latestCustomerMessageId &&
    !!latestDraft.targetCustomerMessageId &&
    latestDraft.targetCustomerMessageId !== workspace.latestCustomerMessageId;
  const shouldDimDraft = isLatestDraftUsed || isLatestDraftStale;

  async function handleRewrite() {
    if (!workspace) {
      window.alert("当前没有选中的顾客");
      return;
    }

    if (!rewriteInput.trim()) {
      window.alert("请先输入你的要求");
      return;
    }

    try {
      setIsGenerating(true);
      setApiError("");

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
        throw new Error(data?.error || "生成失败");
      }

      setCustomReply({
        suggestion1Ja: data.suggestion1Ja || "",
        suggestion1Zh: data.suggestion1Zh || "",
        suggestion2Ja: data.suggestion2Ja || "",
        suggestion2Zh: data.suggestion2Zh || "",
      });

      await loadWorkspace(workspace.customer.id);
      await loadCustomers();
    } catch (error) {
      console.error(error);
      setApiError(String(error));
      window.alert("生成失败，请看右侧错误提示或终端报错");
    } finally {
      setIsGenerating(false);
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

      await loadWorkspace(workspace.customer.id);
      await loadCustomers();
    } catch (error) {
      console.error(error);
      setHelperError(String(error));
      window.alert("副模型分析失败，请看右侧错误提示或终端报错");
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

      const response = await fetch(
        `/api/customers/${workspace.customer.id}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            japaneseText: replyJa,
            chineseText: replyZh,
            source: "AI_SUGGESTION",
            type: "TEXT",
            replyDraftSetId: workspace.latestReplyDraftSet?.id || "",
            suggestionVariant: variant === "stable" ? "STABLE" : "ADVANCING",
          }),
        }
      );

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data?.error || "发送失败");
      }

      setCustomReply(null);
    } catch (error) {
      console.error(error);
      window.alert("AI 建议发送失败，请看终端报错");
    } finally {
      setIsSendingAi("");
    }
  }

  function handleAddImage() {
    window.alert("图片发送会放到下一步功能里，这一步先做聊天体验。");
  }

  async function handleManualSend() {
    if (!workspace) {
      window.alert("当前没有选中的顾客");
      return;
    }

    if (!manualReply.trim()) {
      window.alert("你还没有输入日语回复内容");
      return;
    }

    const japaneseText = manualReply.trim();

    try {
      setIsSendingManual(true);

      const sendResponse = await fetch(
        `/api/customers/${workspace.customer.id}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            japaneseText,
            source: "MANUAL",
            type: "TEXT",
          }),
        }
      );

      const sendData = await sendResponse.json();

      if (!sendResponse.ok || !sendData.ok) {
        throw new Error(sendData?.error || "消息发送失败");
      }

      setManualReply("");

      const messageId = String(sendData?.message?.id || "").trim();

      if (messageId) {
        void (async () => {
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

            if (
              !translateResponse.ok ||
              !translateData.ok ||
              !translateData.chinese
            ) {
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
            console.error("Manual send translate patch error:", error);
          }
        })();
      }
    } catch (error) {
      console.error(error);
      window.alert("发送失败，请看终端报错");
    } finally {
      setIsSendingManual(false);
    }
  }

  function handleSelectCustomer(customerId: string) {
    setSelectedCustomerId(customerId);
    setCustomerContextMenu(null);
    setCustomers((prev) =>
      prev.map((item) =>
        item.id === customerId ? { ...item, unreadCount: 0 } : item
      )
    );
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

  const contextMenuCustomer = customerContextMenu
    ? customers.find((item) => item.id === customerContextMenu.customerId) || null
    : null;

  return (
    <div className="h-screen bg-gray-100 flex">
      <div className="w-[24%] bg-white border-r border-gray-200 p-4 overflow-y-auto">
        <h2 className="text-lg font-bold mb-3">顾客列表</h2>

        <input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder="搜索备注、昵称、标签、最后一条消息"
          className="w-full border rounded-lg px-3 py-2 text-sm mb-4"
        />

        {pageError ? (
          <div className="mb-3 text-xs text-red-500 break-all">{pageError}</div>
        ) : null}

        {isListLoading ? (
          <div className="text-sm text-gray-500">顾客列表加载中...</div>
        ) : (
          <div className="space-y-3">
            {filteredCustomers.map((customer) => {
              const isActive = customer.id === currentListCustomer?.id;
              const latestPreview = customer.latestMessage?.previewText || "暂时还没有消息";

              return (
                <div
                  key={customer.id}
                  onClick={() => handleSelectCustomer(customer.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setCustomerContextMenu({
                      customerId: customer.id,
                      x: event.clientX,
                      y: event.clientY,
                    });
                  }}
                  className={`p-3 rounded-xl cursor-pointer border transition ${
                    isActive
                      ? "bg-gray-100 border-gray-300"
                      : "bg-white border-gray-200"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className="relative h-11 w-11 shrink-0 rounded-full bg-pink-100 text-pink-700 flex items-center justify-center font-semibold">
                      {getAvatarText(customer)}
                      {customer.unreadCount > 0 ? (
                        <div className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-green-500 text-white text-[11px] flex items-center justify-center font-medium">
                          {customer.unreadCount > 99 ? "99+" : customer.unreadCount}
                        </div>
                      ) : null}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium truncate flex items-center gap-1">
                            {customer.pinnedAt ? <span className="text-xs">📌</span> : null}
                            <span>{getDisplayName(customer)}</span>
                          </div>
                          <div className="text-xs text-gray-500 truncate">
                            原昵称：{customer.originalName}
                          </div>
                        </div>
                        <div className="text-[11px] text-gray-400 shrink-0">
                          {formatListTime(customer.lastMessageAt)}
                        </div>
                      </div>

                      <div className="mt-2 text-sm text-gray-700 truncate">{latestPreview}</div>
                      <div className="text-[11px] text-gray-500 mt-1">
                        {customer.stage} · {customer.isVip ? "VIP" : "普通"}
                      </div>

                      {customer.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {customer.tags.map((tag) => (
                            <span
                              key={tag.id}
                              className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-100"
                            >
                              {tag.name}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {filteredCustomers.length === 0 && (
              <div className="text-sm text-gray-500 p-3">没有搜索到相关顾客</div>
            )}
          </div>
        )}
      </div>

      <div className="w-[46%] flex flex-col bg-gray-50">
        <div className="p-4 border-b bg-white">
          <div className="font-bold">{getDisplayName(workspace?.customer || null)}</div>
          {workspace?.customer ? (
            <div className="text-xs text-gray-500 mt-1">
              原昵称：{workspace.customer.originalName}
            </div>
          ) : null}
        </div>

        <div
          ref={chatScrollRef}
          className="flex-1 p-4 space-y-4 overflow-y-auto"
        >
          {isWorkspaceLoading ? (
            <div className="text-sm text-gray-500">聊天内容加载中...</div>
          ) : !workspace ? (
            <div className="text-sm text-gray-500">当前没有顾客数据</div>
          ) : workspace.messages.length === 0 ? (
            <div className="text-sm text-gray-500">当前顾客还没有聊天记录</div>
          ) : (
            workspace.messages.map((msg, index) => {
              const previousMessage = index > 0 ? workspace.messages[index - 1] : null;
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
                        ) : (
                          <>
                            <div className="rounded-lg bg-gray-200 h-36 w-56 flex items-center justify-center text-gray-600">
                              图片示例
                            </div>
                            <div className="mt-2 whitespace-pre-wrap">{msg.japaneseText}</div>
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
                        )}
                      </div>
                      <div
                        className={`mt-1 text-[11px] text-gray-400 ${
                          msg.role === "CUSTOMER" ? "text-left" : "text-right"
                        }`}
                      >
                        {formatBubbleTime(msg.sentAt)}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        <div className="p-4 border-t bg-white">
          <div className="flex gap-2">
            <button
              onClick={handleAddImage}
              className="border rounded-lg px-3 py-2 text-sm bg-white"
            >
              添加图片
            </button>
            <input
              type="text"
              value={manualReply}
              onChange={(e) => setManualReply(e.target.value)}
              className="flex-1 border rounded-lg px-4 py-2"
            />
            <button
              onClick={handleManualSend}
              disabled={isSendingManual || !workspace}
              className="bg-green-600 text-white px-4 py-2 rounded-lg disabled:opacity-60"
            >
              {isSendingManual ? "发送中..." : "发送"}
            </button>
          </div>
        </div>
      </div>

      <div className="w-[30%] bg-white border-l border-gray-200 p-4 overflow-y-auto">
        <h2 className="text-lg font-bold mb-4">AI 助理</h2>

        <div className="space-y-5">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-semibold text-amber-900">客户信息</div>
              <button
                onClick={handleAnalyzeCustomer}
                disabled={isAnalyzing || !workspace}
                className="text-xs px-3 py-1 rounded-lg bg-amber-900 text-white disabled:opacity-60"
              >
                {isAnalyzing ? "分析中..." : "副模型整理"}
              </button>
            </div>
            <div className="text-sm text-amber-900/90">
              <div>{workspace?.customer.aiCustomerInfo || ""}</div>
              <div className="mt-2">{workspace?.customer.aiCurrentStrategy || ""}</div>
            </div>
            {helperError ? (
              <div className="text-xs text-red-500 mt-2 break-all">{helperError}</div>
            ) : null}
          </div>

          <div
            className={`rounded-xl border p-4 ${
              shouldDimDraft ? "border-gray-200 bg-gray-50 opacity-70" : "border-gray-200 bg-white"
            }`}
          >
            <div className="font-semibold mb-2">更稳回复</div>
            <div
              className={`text-sm p-3 rounded-lg whitespace-pre-wrap min-h-[72px] ${
                shouldDimDraft ? "bg-gray-200 text-gray-600" : "bg-gray-100"
              }`}
            >
              {displayedSuggestion1Ja}
            </div>
            <div
              className={`text-sm p-3 rounded-lg mt-2 whitespace-pre-wrap min-h-[72px] ${
                shouldDimDraft ? "bg-gray-100 text-gray-500" : "bg-gray-50 text-gray-700"
              }`}
            >
              {displayedSuggestion1Zh}
            </div>
            <button
              onClick={() =>
                addAiReplyToChat(
                  displayedSuggestion1Ja,
                  displayedSuggestion1Zh,
                  "stable"
                )
              }
              disabled={
                !workspace || !displayedSuggestion1Ja || isSendingAi !== "" || shouldDimDraft
              }
              className="w-full mt-3 bg-blue-600 text-white py-2 rounded-lg disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
            >
              {isSendingAi === "stable"
                ? "发送中..."
                : isLatestDraftUsed
                  ? "已使用"
                  : isLatestDraftStale
                    ? "已失效"
                    : "发送"}
            </button>
          </div>

          <div
            className={`rounded-xl border p-4 ${
              shouldDimDraft ? "border-gray-200 bg-gray-50 opacity-70" : "border-gray-200 bg-white"
            }`}
          >
            <div className="font-semibold mb-2">更推进成交</div>
            <div
              className={`text-sm p-3 rounded-lg whitespace-pre-wrap min-h-[72px] ${
                shouldDimDraft ? "bg-gray-200 text-gray-600" : "bg-gray-100"
              }`}
            >
              {displayedSuggestion2Ja}
            </div>
            <div
              className={`text-sm p-3 rounded-lg mt-2 whitespace-pre-wrap min-h-[72px] ${
                shouldDimDraft ? "bg-gray-100 text-gray-500" : "bg-gray-50 text-gray-700"
              }`}
            >
              {displayedSuggestion2Zh}
            </div>
            <button
              onClick={() =>
                addAiReplyToChat(
                  displayedSuggestion2Ja,
                  displayedSuggestion2Zh,
                  "advancing"
                )
              }
              disabled={
                !workspace || !displayedSuggestion2Ja || isSendingAi !== "" || shouldDimDraft
              }
              className="w-full mt-3 bg-blue-600 text-white py-2 rounded-lg disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-500"
            >
              {isSendingAi === "advancing"
                ? "发送中..."
                : isLatestDraftUsed
                  ? "已使用"
                  : isLatestDraftStale
                    ? "已失效"
                    : "发送"}
            </button>
          </div>

          <div className="rounded-xl border border-gray-200 p-4 bg-white">
            <div className="font-semibold mb-2">要求重写</div>
            <input
              type="text"
              value={rewriteInput}
              onChange={(e) => setRewriteInput(e.target.value)}
              placeholder="例如：更自然一点，不要太销售"
              className="w-full border rounded-lg px-3 py-2 text-sm"
            />
            <button
              onClick={handleRewrite}
              disabled={isGenerating || !workspace}
              className="w-full mt-2 bg-black text-white py-2 rounded-lg disabled:opacity-60"
            >
              {isGenerating ? "生成中..." : "重新生成"}
            </button>
            {apiError ? (
              <div className="text-xs text-red-500 mt-2 break-all">{apiError}</div>
            ) : null}
          </div>
        </div>
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
