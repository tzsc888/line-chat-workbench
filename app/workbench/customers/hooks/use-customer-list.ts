import { useCallback, useEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from "react";

type FollowupLike = {
  tier?: "A" | "B" | "C" | null;
};

type LatestMessageLike = {
  id: string;
  role: "CUSTOMER" | "OPERATOR";
  type: "TEXT" | "IMAGE" | "STICKER";
  source: "LINE" | "MANUAL" | "AI_SUGGESTION";
  japaneseText: string;
  chineseText: string | null;
  sentAt: string;
  previewText: string;
} | null;

export type CustomerListItemLike = {
  id: string;
  originalName: string;
  remarkName: string | null;
  pinnedAt: string | null;
  unreadCount: number;
  followup: FollowupLike | null;
  lastMessageAt: string | null;
  latestMessage: LatestMessageLike;
};

type WorkspaceLike = {
  customer: {
    id: string;
    remarkName: string | null;
    pinnedAt: string | null;
    unreadCount: number;
  };
};

type WorkspaceCustomerLike = {
  id: string;
  remarkName: string | null;
  pinnedAt: string | null;
  unreadCount: number;
  followup: FollowupLike | null;
};

type UpdateCustomerLikeMessage = {
  id: string;
  role: "CUSTOMER" | "OPERATOR";
  type: "TEXT" | "IMAGE" | "STICKER";
  source: "LINE" | "MANUAL" | "AI_SUGGESTION";
  japaneseText: string;
  chineseText: string | null;
  sentAt: string;
  previewText: string;
};

type CustomerContextMenuState<TCustomer extends CustomerListItemLike> = {
  customer: TCustomer;
  x: number;
  y: number;
};

function sortCustomerList<TCustomer extends CustomerListItemLike>(list: TCustomer[]) {
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

export function useCustomerList<TCustomer extends CustomerListItemLike, TWorkspace extends WorkspaceLike>(input: {
  customerPageSize: number;
  customerListScrollRef: RefObject<HTMLDivElement | null>;
  customerListLoadMoreRef: RefObject<HTMLDivElement | null>;
  selectedCustomerId: string;
  setSelectedCustomerId: Dispatch<SetStateAction<string>>;
  selectedCustomerIdRef: RefObject<string>;
  workspace: TWorkspace | null;
  setWorkspace: Dispatch<SetStateAction<TWorkspace | null>>;
  isAbortError: (error: unknown) => boolean;
}) {
  const {
    customerPageSize,
    customerListScrollRef,
    customerListLoadMoreRef,
    selectedCustomerId,
    setSelectedCustomerId,
    selectedCustomerIdRef,
    workspace,
    setWorkspace,
    isAbortError,
  } = input;

  const [customers, setCustomers] = useState<TCustomer[]>([]);
  const [customerStats, setCustomerStats] = useState({ overdueFollowupCount: 0 });
  const [customerPage, setCustomerPage] = useState(1);
  const [hasMoreCustomers, setHasMoreCustomers] = useState(false);
  const [isLoadingMoreCustomers, setIsLoadingMoreCustomers] = useState(false);
  const [isListLoading, setIsListLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [searchText, setSearchText] = useState("");
  const [debouncedSearchText, setDebouncedSearchText] = useState("");
  const [customerContextMenu, setCustomerContextMenu] = useState<CustomerContextMenuState<TCustomer> | null>(null);

  const customersRef = useRef<TCustomer[]>([]);
  const customerPageRef = useRef(1);
  const hasMoreCustomersRef = useRef(false);
  const searchKeywordRef = useRef("");
  const isCustomerListRequestInFlightRef = useRef(false);
  const customerListRequestIdRef = useRef(0);
  const customerListAbortControllerRef = useRef<AbortController | null>(null);
  const markReadInFlightRef = useRef(new Set<string>());

  useEffect(() => {
    return () => {
      customerListAbortControllerRef.current?.abort();
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
  }, [customerListScrollRef]);

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
      const limit = Math.max(options?.limitOverride ?? customerPageSize, customerPageSize);
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

        const list: TCustomer[] = data.customers || [];
        const nextHasMore = !!data.hasMore;
        const nextPage = Number(data.page || page);
        const nextStats = data.stats || { overdueFollowupCount: 0 };

        setCustomers((prev) => {
          if (isLoadMore) {
            const merged = new Map<string, TCustomer>();
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
            ? Math.max(1, Math.ceil(loadedRegularCountAfterFetch / customerPageSize))
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
    [customerListScrollRef, customerPageSize, isAbortError, setSelectedCustomerId],
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

  const applyWorkspaceCustomerMeta = useCallback((nextWorkspaceCustomer: WorkspaceCustomerLike | null | undefined) => {
    if (!nextWorkspaceCustomer) return;
    setCustomers((prev) => {
      const targetIndex = prev.findIndex((item) => item.id === nextWorkspaceCustomer.id);
      if (targetIndex < 0) return prev;

      const target = prev[targetIndex];
      const currentFollowupTier = target.followup?.tier ?? null;
      const nextFollowupTier = nextWorkspaceCustomer.followup?.tier ?? null;
      const hasChanges =
        target.remarkName !== nextWorkspaceCustomer.remarkName ||
        target.pinnedAt !== nextWorkspaceCustomer.pinnedAt ||
        target.unreadCount !== nextWorkspaceCustomer.unreadCount ||
        currentFollowupTier !== nextFollowupTier;

      if (!hasChanges) return prev;

      const next = [...prev];
      next[targetIndex] = {
        ...target,
        remarkName: nextWorkspaceCustomer.remarkName,
        pinnedAt: nextWorkspaceCustomer.pinnedAt,
        unreadCount: nextWorkspaceCustomer.unreadCount,
        followup: nextWorkspaceCustomer.followup,
      };
      return next;
    });
  }, []);

  const updateCustomerLatestMessage = useCallback((customerId: string, message: UpdateCustomerLikeMessage) => {
    preserveCustomerListViewport(() => {
      setCustomers((prev) =>
        sortCustomerList(
          prev.map((item) =>
            item.id === customerId
              ? {
                  ...item,
                  lastMessageAt: message.sentAt,
                  latestMessage: {
                    id: message.id,
                    role: message.role,
                    type: message.type,
                    source: message.source,
                    japaneseText: message.japaneseText,
                    chineseText: message.chineseText,
                    sentAt: message.sentAt,
                    previewText: message.previewText,
                  },
                }
              : item,
          ),
        ),
      );
    });
  }, [preserveCustomerListViewport]);

  const patchCustomerMeta = useCallback(
    async (customerId: string, payload: { pinned?: boolean; remarkName?: string | null; markRead?: boolean }) => {
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
            }),
          ),
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
                : item,
            ),
          ),
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
    [preserveCustomerListViewport, selectedCustomerIdRef, setWorkspace, workspace],
  );

  const handleTogglePin = useCallback(async (customer: TCustomer) => {
    setCustomerContextMenu(null);
    try {
      await patchCustomerMeta(customer.id, {
        pinned: !customer.pinnedAt,
      });
    } catch (error) {
      console.error(error);
      window.alert("置顶状态更新失败");
    }
  }, [patchCustomerMeta]);

  const handleRenameCustomer = useCallback(async (customer: TCustomer) => {
    setCustomerContextMenu(null);
    const nextRemarkName = window.prompt(
      "请输入备注名（留空会清除备注）",
      customer.remarkName || "",
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
  }, [patchCustomerMeta]);

  const markCustomerLocallyRead = useCallback((customerId: string) => {
    if (!customerId) return;
    setCustomers((prev) =>
      prev.map((item) =>
        item.id === customerId ? { ...item, unreadCount: 0 } : item,
      ),
    );
  }, []);

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
    const selectedCustomer = customers.find((item) => item.id === selectedCustomerId);
    if (!selectedCustomerId || !selectedCustomer?.unreadCount) return;
    setCustomers((prev) =>
      prev.map((item) =>
        item.id === selectedCustomerId ? { ...item, unreadCount: 0 } : item,
      ),
    );
    void markCustomerRead(selectedCustomerId);
  }, [customers, markCustomerRead, selectedCustomerId]);

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
      },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [customerListLoadMoreRef, customerListScrollRef, isListLoading, isLoadingMoreCustomers, loadCustomers]);

  return {
    state: {
      customers,
      customerStats,
      searchText,
      isListLoading,
      isLoadingMoreCustomers,
      hasMoreCustomers,
      pageError,
      customerContextMenu,
    },
    refs: {
      customersRef,
      searchKeywordRef,
      hasMoreCustomersRef,
    },
    actions: {
      setPageError,
      setSearchText,
      setCustomers,
      setCustomerContextMenu,
      loadCustomers,
      refreshList: loadCustomers,
      applyWorkspaceCustomerMeta,
      updateCustomerLatestMessage,
      patchCustomerMeta,
      handleTogglePin,
      handleRenameCustomer,
      markCustomerRead,
      markCustomerLocallyRead,
    },
  };
}
