"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "./ctx";

/**
 * Fetches an API route and refetches whenever the app's data version changes (new live events, actions).
 * If the server is unreachable it computes the same view from the local mock so the demo never dies.
 */
export function useApi<T>(url: string, fallback: () => T, pollMs?: number) {
  const { version } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fb = useRef(fallback);
  fb.current = fallback;
  const full = `${url}${url.includes("?") ? "&" : "?"}v=${version}`;

  const load = useCallback(async () => {
    try {
      const res = await fetch(full, { cache: "no-store" });
      if (res.status === 401) { window.location.href = "/login"; return; }
      if (res.status === 403) { setError("You don't have access to this view."); return; }
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json());
      setOffline(false);
      setError(null);
    } catch {
      setData(fb.current());
      setOffline(true);
    }
  }, [full]);

  useEffect(() => {
    load();
    if (!pollMs) return;
    const t = setInterval(load, pollMs);
    return () => clearInterval(t);
  }, [load, pollMs]);

  return { data, setData, offline, error, loading: data === null && !error, reload: load };
}

export async function post(url: string, body: unknown, method = "POST") {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: { error: "Server unreachable" } };
  }
}
