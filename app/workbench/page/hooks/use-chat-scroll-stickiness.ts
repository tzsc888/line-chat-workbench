import { useCallback, useEffect, useRef, type RefObject } from "react";

function isNearBottom(container: HTMLDivElement) {
  return container.scrollHeight - container.scrollTop - container.clientHeight < 80;
}

export function useChatScrollStickiness(input: {
  chatScrollRef: RefObject<HTMLDivElement | null>;
  selectedCustomerId: string;
  workspaceCustomerId: string;
  messageCount: number;
}) {
  const { chatScrollRef, selectedCustomerId, workspaceCustomerId, messageCount } = input;
  const openChatToBottomRef = useRef(false);
  const shouldStickToBottomRef = useRef(true);
  const lastOpenedCustomerIdRef = useRef("");

  const prepareNextCustomerOpen = useCallback(() => {
    openChatToBottomRef.current = true;
    shouldStickToBottomRef.current = true;
  }, []);

  const handleChatScroll = useCallback(() => {
    const container = chatScrollRef.current;
    if (!container) return;
    shouldStickToBottomRef.current = isNearBottom(container);
  }, [chatScrollRef]);

  useEffect(() => {
    if (!workspaceCustomerId || !selectedCustomerId) return;
    const container = chatScrollRef.current;
    if (!container) return;

    const customerChanged = lastOpenedCustomerIdRef.current !== workspaceCustomerId;
    if (customerChanged || openChatToBottomRef.current || shouldStickToBottomRef.current) {
      requestAnimationFrame(() => {
        const el = chatScrollRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
      });
    }

    if (customerChanged) {
      lastOpenedCustomerIdRef.current = workspaceCustomerId;
    }
    openChatToBottomRef.current = false;
  }, [chatScrollRef, messageCount, selectedCustomerId, workspaceCustomerId]);

  return {
    actions: {
      prepareNextCustomerOpen,
      handleChatScroll,
    },
  };
}
