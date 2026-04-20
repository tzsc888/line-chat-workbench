import { useEffect, type RefObject } from "react";

export function usePresenceHeartbeat(input: {
  selectedCustomerId: string;
  selectedCustomerIdRef: RefObject<string>;
  onVisibleRefresh?: () => void;
}) {
  const { selectedCustomerId, selectedCustomerIdRef, onVisibleRefresh } = input;
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
        onVisibleRefresh?.();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      if (timer) window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [onVisibleRefresh, selectedCustomerId, selectedCustomerIdRef]);
}
