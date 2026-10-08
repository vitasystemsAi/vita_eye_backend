'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from './api';
import type { PageMeta } from './types';

type Query = Parameters<typeof api.get>[1];

interface ApiState<T> {
  data: T | null;
  meta?: PageMeta;
  raw?: Record<string, unknown>;
  error: ApiError | null;
  loading: boolean;
  reload: () => Promise<void>;
  setData: (fn: (prev: T | null) => T | null) => void;
}

/** Fetches `path` with `query`; re-fetches when either changes. Pass `null` to skip. */
export function useApi<T>(path: string | null, query?: Query): ApiState<T> {
  const [data, setDataState] = useState<T | null>(null);
  const [meta, setMeta] = useState<PageMeta | undefined>();
  const [raw, setRaw] = useState<Record<string, unknown> | undefined>();
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const key = path ? `${path}|${JSON.stringify(query ?? {})}` : null;
  const controller = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!path) return;
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    setLoading(true);
    try {
      const res = await api.get<T>(path, query, ac.signal);
      if (ac.signal.aborted) return;
      setDataState(res.data);
      setMeta(res.meta);
      setRaw(res.raw);
      setError(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError(err instanceof ApiError ? err : new ApiError(0, 'ERROR', (err as Error).message));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    void load();
    return () => controller.current?.abort();
  }, [load]);

  const setData = useCallback((fn: (prev: T | null) => T | null) => setDataState(fn), []);
  return { data, meta, raw, error, loading, reload: load, setData };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const t = setInterval(() => ref.current(), ms);
    return () => clearInterval(t);
  }, [ms]);
}
