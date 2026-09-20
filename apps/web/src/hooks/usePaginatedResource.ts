import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../lib/apiClient";
import type { PaginatedResponse } from "../types/domain";
import type { ResourceState } from "./useResource";

export function usePaginatedResource<T, TPage extends PaginatedResponse<T> = PaginatedResponse<T>>(
  fetchPage: (page: number, pageSize: number) => Promise<TPage>,
  queryKey: string,
  initialPageSize = 25,
) {
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const cacheRef = useRef(new Map<string, TPage>());
  const requestRef = useRef(0);
  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(initialPageSize);
  const [data, setData] = useState<TPage | null>(null);
  const dataRef = useRef<TPage | null>(null);
  dataRef.current = data;
  const [state, setState] = useState<ResourceState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const cacheKey = useCallback((targetPage: number, targetSize = pageSize) => `${queryKey}|${targetSize}|${targetPage}`, [pageSize, queryKey]);

  useEffect(() => {
    cacheRef.current.clear();
    setPageState(1);
  }, [queryKey]);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++requestRef.current;
    const key = cacheKey(page);
    const cached = cacheRef.current.get(key);
    if (cached) {
      setData(cached);
      setState("ready");
      setError(null);
    } else if (dataRef.current) {
      setPageLoading(true);
    } else {
      setState("loading");
    }

    async function load() {
      try {
        const result = cached ?? await fetchRef.current(page, pageSize);
        if (cancelled || requestId !== requestRef.current) return;
        cacheRef.current.set(key, result);
        setData(result);
        if (result.page !== page) setPageState(result.page);
        setState("ready");
        setError(null);
        setPageLoading(false);
        if (result.hasNext) {
          const nextKey = cacheKey(result.page + 1);
          if (!cacheRef.current.has(nextKey)) {
            void fetchRef.current(result.page + 1, pageSize).then((next) => {
              if (!cancelled) cacheRef.current.set(nextKey, next);
            }).catch(() => undefined);
          }
        }
      } catch (caught) {
        if (cancelled || requestId !== requestRef.current) return;
        setError(caught instanceof ApiError ? caught.message : "Unexpected error.");
        setState("error");
        setPageLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [cacheKey, page, pageSize, queryKey, reloadToken]);

  const setPage = useCallback((next: number) => {
    setPageState((current) => Math.max(1, data ? Math.min(next, data.totalPages) : next || current));
  }, [data]);
  const setPageSize = useCallback((next: number) => {
    cacheRef.current.clear();
    setPageSizeState(next);
    setPageState(1);
  }, []);
  const reload = useCallback(() => {
    cacheRef.current.clear();
    setReloadToken((token) => token + 1);
  }, []);

  return { data, state, error, reload, page, setPage, pageSize, setPageSize, pageLoading };
}
