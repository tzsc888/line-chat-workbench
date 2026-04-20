import { useCallback, useEffect, useRef } from "react";

type CustomerWithUnread = {
  id: string;
  unreadCount: number;
  latestMessage: {
    role: "CUSTOMER" | "OPERATOR";
  } | null;
};

export function useNotificationSound(input: {
  customers: CustomerWithUnread[];
}) {
  const hasInitializedUnreadSnapshotRef = useRef(false);
  const previousUnreadMapRef = useRef<Record<string, number>>({});
  const audioEnabledRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastIncomingSoundAtRef = useRef(0);

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
    if (!input.customers.length) {
      previousUnreadMapRef.current = {};
      hasInitializedUnreadSnapshotRef.current = true;
      return;
    }
    const nextUnreadMap = Object.fromEntries(input.customers.map((customer) => [customer.id, customer.unreadCount]));
    if (!hasInitializedUnreadSnapshotRef.current) {
      previousUnreadMapRef.current = nextUnreadMap;
      hasInitializedUnreadSnapshotRef.current = true;
      return;
    }
    const hasIncomingUnread = input.customers.some((customer) => {
      const previousUnread = previousUnreadMapRef.current[customer.id] ?? 0;
      const latestPreviewFromCustomer = customer.latestMessage?.role === "CUSTOMER";
      return latestPreviewFromCustomer && customer.unreadCount > previousUnread;
    });
    if (hasIncomingUnread) {
      playIncomingSound();
    }
    previousUnreadMapRef.current = nextUnreadMap;
  }, [input.customers, playIncomingSound]);
}
