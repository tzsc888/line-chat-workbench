import { useEffect, type RefObject } from "react";

export function useOutsideClickClose(input: {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  onClose: () => void;
  closeOnResize?: boolean;
}) {
  const { containerRef, enabled, onClose, closeOnResize = false } = input;

  useEffect(() => {
    if (!enabled) return;

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      const container = containerRef.current;
      if (!container || container.contains(target)) return;
      onClose();
    };

    const handleResize = () => {
      if (!closeOnResize) return;
      onClose();
    };

    document.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("resize", handleResize);
    };
  }, [closeOnResize, containerRef, enabled, onClose]);
}
