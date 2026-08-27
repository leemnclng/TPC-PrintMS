import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../lib/apiClient";

export type ResourceState = "loading" | "ready" | "error";

/** Shared data-fetching hook so every page reports honest loading/error/ready
 *  states instead of quietly rendering empty or stale content. */
export function useResource<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [state, setState] = useState<ResourceState>("loading");
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    let retried = false;
    setState("loading");

    function attempt() {
      fetcher()
        .then((result) => {
          if (cancelled) return;
          setData(result);
          setState("ready");
        })
        .catch((err) => {
          if (cancelled) return;
          // The desktop app's backend can still be finishing startup for a
          // moment after the window appears — one silent retry absorbs that
          // without making a real, lasting failure look instant.
          if (!retried) {
            retried = true;
            setTimeout(attempt, 1500);
            return;
          }
          setError(err instanceof ApiError ? err.message : "Unexpected error.");
          setState("error");
        });
    }

    attempt();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadToken]);

  return { data, state, error, reload };
}
