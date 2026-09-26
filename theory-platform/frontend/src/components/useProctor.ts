import { useEffect, useRef } from "react";

type Props = {
  enabled: boolean;
  onEvent: (event_type: string, detail?: string, duration_seconds?: number) => void | Promise<void>;
  onPaste?: () => void;
};

function isModKey(e: KeyboardEvent) {
  return e.ctrlKey || e.metaKey;
}

/** Strict exam proctoring: short grace, clipboard blocked, window switches counted. */
export function useProctor({ enabled, onEvent, onPaste }: Props) {
  const hiddenAt = useRef<number | null>(null);
  const blurAt = useRef<number | null>(null);
  const fsExitAt = useRef<number | null>(null);
  const focusEvents = useRef<number[]>([]);
  const lastWindowSwitchAt = useRef(0);
  const altHeld = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    const reportWindowSwitch = (detail: string) => {
      const now = Date.now();
      // One Alt+Tab fires both blur + visibility; count once.
      if (now - lastWindowSwitchAt.current < 1500) return;
      lastWindowSwitchAt.current = now;
      void onEvent("window_switch", detail);
    };

    const requestFs = () => {
      if (!document.fullscreenElement) {
        void document.documentElement.requestFullscreen?.().catch(() => undefined);
      }
    };
    requestFs();

    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt.current = Date.now();
        reportWindowSwitch(altHeld.current ? "alt_tab_or_app_switch" : "tab_or_window_hidden");
      } else if (hiddenAt.current) {
        hiddenAt.current = null;
      }
    };

    const onBlur = () => {
      blurAt.current = Date.now();
      const now = Date.now();
      focusEvents.current = [...focusEvents.current.filter((t) => now - t < 12000), now];
      if (focusEvents.current.length >= 4) void onEvent("focus_thrash");
      // Alt+Tab / Win+Tab / clicking another app — count immediately.
      reportWindowSwitch(altHeld.current ? "alt_tab" : "focus_lost");
    };
    const onFocus = () => {
      blurAt.current = null;
      // Try to pull student back into fullscreen after a switch.
      requestFs();
    };

    const onFs = () => {
      if (!document.fullscreenElement) {
        fsExitAt.current = Date.now();
        window.setTimeout(() => {
          if (!document.fullscreenElement && fsExitAt.current) {
            const dur = (Date.now() - fsExitAt.current) / 1000;
            void onEvent("fullscreen_exit", undefined, dur);
            requestFs();
          }
          fsExitAt.current = null;
        }, 800);
      }
    };

    const onCopy = (e: ClipboardEvent) => {
      e.preventDefault();
      void onEvent("copy");
    };
    const onCut = (e: ClipboardEvent) => {
      e.preventDefault();
      void onEvent("cut");
    };
    const onPasteHandler = (e: ClipboardEvent) => {
      e.preventDefault();
      onPaste?.();
    };
    const onContext = (e: Event) => e.preventDefault();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Alt") altHeld.current = true;

      const key = e.key.toLowerCase();

      // Alt+Tab / Alt+Esc — OS usually still switches, but we flag + try prevent.
      if (e.altKey && (key === "tab" || key === "escape" || e.code === "Tab")) {
        e.preventDefault();
        e.stopPropagation();
        reportWindowSwitch("alt_tab_keydown");
        return;
      }
      // Win+Tab / Cmd+Tab style switches when we can see them.
      if ((e.metaKey || e.key === "Meta") && key === "tab") {
        e.preventDefault();
        e.stopPropagation();
        reportWindowSwitch("meta_tab_keydown");
        return;
      }

      // Block copy / cut / paste shortcuts (Ctrl/Cmd + C/X/V, and Insert variants).
      if (isModKey(e) && (key === "c" || key === "x" || key === "v" || key === "insert")) {
        e.preventDefault();
        e.stopPropagation();
        if (key === "c" || key === "insert") void onEvent("copy", "keyboard");
        else if (key === "x") void onEvent("cut", "keyboard");
        else onPaste?.();
        return;
      }
      if (e.shiftKey && key === "insert") {
        e.preventDefault();
        e.stopPropagation();
        onPaste?.();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Alt") altHeld.current = false;
    };

    const heartbeat = window.setInterval(() => {
      void onEvent("heartbeat");
    }, 30000);

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPasteHandler);
    document.addEventListener("contextmenu", onContext);
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("keyup", onKeyUp, true);

    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("fullscreenchange", onFs);
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPasteHandler);
      document.removeEventListener("contextmenu", onContext);
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("keyup", onKeyUp, true);
    };
  }, [enabled, onEvent, onPaste]);
}
