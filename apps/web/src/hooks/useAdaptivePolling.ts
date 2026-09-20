import { useEffect, useRef } from "react";

/** Runs one async poll at a time, pauses completely while the app is hidden,
 * and lets the result choose the next delay (active vs idle work). */
export function useAdaptivePolling(task: () => Promise<number | void>, defaultDelayMs: number, wakeEvent?: string) {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    let disposed = false;
    let running = false;
    let timer: number | undefined;

    const schedule = (delayMs: number) => {
      if (disposed || document.hidden) return;
      timer = window.setTimeout(run, delayMs);
    };

    const run = async () => {
      if (disposed || running || document.hidden) return;
      running = true;
      let nextDelay = defaultDelayMs;
      try {
        nextDelay = (await taskRef.current()) ?? defaultDelayMs;
      } catch {
        nextDelay = defaultDelayMs;
      } finally {
        running = false;
        schedule(nextDelay);
      }
    };

    const handleVisibility = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      if (!document.hidden) void run();
    };

    const handleWake = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      if (!document.hidden) void run();
    };

    document.addEventListener("visibilitychange", handleVisibility);
    if (wakeEvent) window.addEventListener(wakeEvent, handleWake);
    void run();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
      if (wakeEvent) window.removeEventListener(wakeEvent, handleWake);
    };
  }, [defaultDelayMs, wakeEvent]);
}
