import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

export function useWorkspace<TWorkspace>(input: {
  chatScrollRef: RefObject<HTMLDivElement | null>;
  isAbortError: (error: unknown) => boolean;
  onBeforeHardLoad?: () => void;
  onWorkspaceLoaded?: (workspace: TWorkspace | null) => void;
}) {
  const { chatScrollRef, isAbortError, onBeforeHardLoad, onWorkspaceLoaded } = input;
  const [workspace, setWorkspace] = useState<TWorkspace | null>(null);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");

  const requestIdRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const refreshWorkspace = useCallback(
    async (customerId: string, options?: { preserveUi?: boolean }) => {
      if (!customerId) {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setWorkspace(null);
        setWorkspaceError("");
        return;
      }

      const preserveUi = !!options?.preserveUi;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      const abortController = new AbortController();
      abortControllerRef.current?.abort();
      abortControllerRef.current = abortController;

      const container = chatScrollRef.current;
      let previousScrollTop = 0;
      let previousScrollHeight = 0;
      let wasNearBottom = false;
      if (preserveUi && container) {
        previousScrollTop = container.scrollTop;
        previousScrollHeight = container.scrollHeight;
        wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
      }

      try {
        if (!preserveUi) {
          setIsWorkspaceLoading(true);
          setWorkspaceError("");
          onBeforeHardLoad?.();
        }

        const response = await fetch(`/api/customers/${customerId}/workspace`, {
          cache: "no-store",
          signal: abortController.signal,
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          throw new Error(data?.error || "读取顾客工作台失败");
        }

        if (requestId !== requestIdRef.current) {
          return;
        }

        const nextWorkspace = (data.workspace || null) as TWorkspace | null;
        setWorkspace(nextWorkspace);
        onWorkspaceLoaded?.(nextWorkspace);

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
        if (!preserveUi && requestId === requestIdRef.current) {
          setWorkspace(null);
          setWorkspaceError(String(error));
        }
      } finally {
        if (requestId === requestIdRef.current) {
          setIsWorkspaceLoading(false);
          if (abortControllerRef.current === abortController) {
            abortControllerRef.current = null;
          }
        }
      }
    },
    [chatScrollRef, isAbortError, onBeforeHardLoad, onWorkspaceLoaded],
  );

  return {
    workspace,
    setWorkspace,
    isWorkspaceLoading,
    workspaceError,
    refreshWorkspace,
  };
}
