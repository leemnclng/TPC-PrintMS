import { useSyncExternalStore } from "react";
import { api } from "../lib/apiClient";
import type { HealthStatus } from "../types/domain";

export type ConnectionState = "checking" | "online" | "offline";

interface HealthSnapshot {
  state: ConnectionState;
  health: HealthStatus | null;
}

const listeners = new Set<() => void>();
let snapshot: HealthSnapshot = { state: "checking", health: null };
let timer: number | undefined;
let polling = false;
let failureCount = 0;

function publish(next: HealthSnapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}

function schedule(delayMs: number) {
  if (listeners.size === 0 || document.hidden) return;
  timer = window.setTimeout(check, delayMs);
}

async function check() {
  if (polling || listeners.size === 0 || document.hidden) return;
  polling = true;
  try {
    const health = await api.get<HealthStatus>("/health");
    failureCount = 0;
    publish({ state: "online", health });
    schedule(15_000);
  } catch {
    failureCount += 1;
    publish({ state: "offline", health: null });
    schedule(Math.min(4_000 * (2 ** (failureCount - 1)), 30_000));
  } finally {
    polling = false;
  }
}

function handleVisibility() {
  if (timer !== undefined) window.clearTimeout(timer);
  timer = undefined;
  if (!document.hidden) void check();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", handleVisibility);
    void check();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      document.removeEventListener("visibilitychange", handleVisibility);
    }
  };
}

/** One shared health poll serves every mounted consumer. It pauses completely
 * while the app is hidden and backs off when the backend is unavailable. */
export function useHealth() {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}
