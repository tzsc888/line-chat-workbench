import * as Ably from "ably";
import { useCallback, useEffect, useRef, type RefObject } from "react";

type CustomerLike = {
  pinnedAt: string | null;
};

export function useRealtimeSync(input: {
  selectedCustomerIdRef: RefObject<string>;
  customersRef: RefObject<CustomerLike[]>;
  searchKeywordRef: RefObject<string>;
  customerPageSize: number;
  refreshList: (options?: {
    silent?: boolean;
    preserveUi?: boolean;
    loadMore?: boolean;
    reset?: boolean;
    search?: string;
    limitOverride?: number;
  }) => Promise<void>;
  refreshWorkspace: (customerId: string, options?: { preserveUi?: boolean }) => Promise<void>;
}) {
  const {
    selectedCustomerIdRef,
    customersRef,
    searchKeywordRef,
    customerPageSize,
    refreshList,
    refreshWorkspace,
  } = input;
  const isRealtimeRefreshInFlightRef = useRef(false);
  const pendingRealtimeRefreshRef = useRef(false);
  const pendingRealtimeRefreshCustomerIdRef = useRef<string | null>(null);
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const ablyClientRef = useRef<Ably.Realtime | null>(null);

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
          (customersRef.current || []).filter((item) => !item.pinnedAt).length,
        );
        await refreshList({
          silent: true,
          preserveUi: true,
          limitOverride: Math.max(loadedRegularCount, customerPageSize),
          search: searchKeywordRef.current || "",
        });
        const activeCustomerId = selectedCustomerIdRef.current || "";
        if (activeCustomerId && (!nextTargetCustomerId || nextTargetCustomerId === activeCustomerId)) {
          await refreshWorkspace(activeCustomerId, { preserveUi: true });
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
    [customerPageSize, customersRef, refreshList, refreshWorkspace, searchKeywordRef, selectedCustomerIdRef],
  );

  useEffect(() => {
    const client = new Ably.Realtime({
      authUrl: "/api/ably/token",
      authMethod: "GET",
    });
    ablyClientRef.current = client;
    const channel = client.channels.get("line-chat-workbench");

    const handleRefresh = (message: Ably.Message) => {
      if (realtimeRefreshTimerRef.current) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }
      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        const payload = message && typeof message === "object" ? message.data || {} : {};
        const targetCustomerId =
          payload && typeof payload === "object" && typeof (payload as { customerId?: unknown }).customerId === "string"
            ? ((payload as { customerId: string }).customerId || "").trim() || null
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
  }, [runRealtimeRefresh, selectedCustomerIdRef]);

  return {
    actions: {
      runRealtimeRefresh,
    },
  };
}
