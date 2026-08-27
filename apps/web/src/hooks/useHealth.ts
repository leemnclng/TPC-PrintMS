import { useEffect, useRef, useState } from "react";
import { api } from "../lib/apiClient";
import type { HealthStatus } from "../types/domain";

export type ConnectionState = "checking" | "online" | "offline";

/** Polls the local FastAPI backend so the shell can show an honest
 *  connected/offline indicator instead of assuming the backend is up. */
export function useHealth(pollMs = 4000) {
  const [state, setState] = useState<ConnectionState>("checking");
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let timer: ReturnType<typeof setTimeout>;

    async function check() {
      try {
        const result = await api.get<HealthStatus>("/health");
        if (!mounted.current) return;
        setHealth(result);
        setState("online");
      } catch {
        if (!mounted.current) return;
        setHealth(null);
        setState("offline");
      } finally {
        if (mounted.current) timer = setTimeout(check, pollMs);
      }
    }

    check();
    return () => {
      mounted.current = false;
      clearTimeout(timer);
    };
  }, [pollMs]);

  return { state, health };
}
