"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Bell, CalendarClock, Download, IndianRupee, Phone, PhoneMissed, Siren, Handshake, X } from "lucide-react";
import type { LiveEvent } from "@/lib/types";
import { ago } from "@/lib/format";
import { useApp } from "./ctx";

interface Prefs { calls: boolean; outcomes: boolean; escalations: boolean; autoDownload: boolean }
const DEFAULT_PREFS: Prefs = { calls: true, outcomes: true, escalations: true, autoDownload: true };
const PREFS_KEY = "kollect.notify";

interface Toast { id: number; tone: "bad" | "good" | "neutral"; title: string; detail: string; borrowerId?: string; file?: string }

const ICON = { call: Phone, escalation: Siren, payment: IndianRupee, ptp: Handshake, followup: CalendarClock };
const iconFor = (e: LiveEvent) => (e.type === "call" && e.title.endsWith("No answer") ? PhoneMissed : ICON[e.type]);
const toneFor = (e: LiveEvent) => (e.type === "escalation" ? "text-bad bg-bad-soft" : e.type === "payment" || e.type === "ptp" ? "text-good bg-good-soft" : e.type === "followup" ? "text-warn bg-warn-soft" : "text-ink-2 bg-sunk");

function download(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Polls the live feed, raises toasts, keeps the bell's history and auto-downloads escalation files. */
export default function Notifications() {
  const { openBorrower, bump } = useApp();
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const last = useRef<number | null>(null);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { const raw = localStorage.getItem(PREFS_KEY); if (raw) setPrefs({ ...DEFAULT_PREFS, ...JSON.parse(raw) }); } catch { /* storage blocked */ }
  }, []);
  const updatePrefs = (p: Partial<Prefs>) => {
    const next = { ...prefs, ...p };
    setPrefs(next);
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(next)); } catch { /* storage blocked */ }
  };

  const toast = useCallback((t: Omit<Toast, "id">, ms: number) => {
    const id = Date.now() + Math.random();
    setToasts((cur) => [...cur.slice(-3), { ...t, id }]);
    setTimeout(() => setToasts((cur) => cur.filter((x) => x.id !== id)), ms);
  }, []);

  const handle = useCallback((fresh: LiveEvent[]) => {
    const p = prefsRef.current;
    const calls = fresh.filter((e) => e.type === "call");
    const escalations = fresh.filter((e) => e.type === "escalation");
    const outcomes = fresh.filter((e) => e.type === "payment" || e.type === "ptp" || e.type === "followup");
    if (p.calls && calls.length === 1) toast({ tone: "neutral", title: `Call completed · ${calls[0].title}`, detail: calls[0].detail, borrowerId: calls[0].borrowerId }, 5000);
    else if (p.calls && calls.length > 1) toast({ tone: "neutral", title: `${calls.length} calls completed`, detail: calls.map((c) => c.title).join(" · ") }, 5000);
    if (p.outcomes) for (const e of outcomes) toast({ tone: e.type === "followup" ? "neutral" : "good", title: e.title, detail: e.detail, borrowerId: e.borrowerId }, 6000);
    if (escalations.length) {
      const ids = escalations.map((e) => e.borrowerId).filter(Boolean) as string[];
      const file = ids.length ? `/api/escalations/file?ids=${ids.join(",")}` : undefined;
      if (p.escalations) for (const e of escalations) toast({ tone: "bad", title: e.title, detail: e.detail, borrowerId: e.borrowerId, file }, 10000);
      if (p.autoDownload && file) download(file);
    }
  }, [toast]);

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const res = await fetch(`/api/live?since=${last.current ?? -1}`, { cache: "no-store" });
        if (!res.ok) return;
        const { events: got, lastId } = (await res.json()) as { events: LiveEvent[]; lastId: number };
        if (stop) return;
        if (last.current === null || lastId < last.current) { // first load, or the demo data was reset
          setEvents([...got].reverse());
          last.current = lastId;
          return;
        }
        last.current = lastId;
        if (!got.length) return;
        setEvents((cur) => [...[...got].reverse(), ...cur].slice(0, 80));
        setUnread((n) => n + got.length);
        handle(got);
        bump();
      } catch { /* offline: try again next tick */ }
    }
    poll();
    const t = setInterval(poll, 5000);
    return () => { stop = true; clearInterval(t); };
  }, [handle, bump]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <>
      <div className="relative" ref={panel}>
        <button className="btn btn-ghost relative h-9 w-9 px-0" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`} aria-expanded={open}
          onClick={() => { setOpen(!open); setUnread(0); }}>
          <Bell size={17} aria-hidden="true" />
          {unread > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-bad px-1 text-center text-[10px] font-semibold leading-4 text-white num">{unread > 99 ? "99+" : unread}</span>}
        </button>
        {open && (
          <div className="absolute right-0 top-11 z-40 w-[380px] max-w-[calc(100vw-24px)] overflow-hidden rounded-lg border border-line bg-surface shadow-[0_12px_40px_rgba(16,23,20,.14)]">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="text-[14px] font-semibold">Activity</div>
              <span className="text-[12px] text-muted">Updates every 5 seconds</span>
            </div>
            <ul className="max-h-[360px] overflow-y-auto">
              {events.length === 0 && <li className="px-4 py-8 text-center text-[13px] text-muted">Nothing yet. Calls and escalations will appear here as they happen.</li>}
              {events.map((e) => {
                const Icon = iconFor(e);
                return (
                  <li key={e.id}>
                    <button className="flex w-full gap-3 border-b border-line px-4 py-2.5 text-left hover:bg-sunk/60" onClick={() => { if (e.borrowerId) { openBorrower(e.borrowerId); setOpen(false); } }}>
                      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${toneFor(e)}`}><Icon size={14} aria-hidden="true" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{e.title}</span>
                        <span className="block truncate text-[12px] text-muted">{e.detail}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-muted num">{ago(e.ts)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <fieldset className="space-y-1.5 border-t border-line bg-sunk/40 px-4 py-3 text-[13px]">
              <legend className="label mb-1">Notify me about</legend>
              {([["calls", "Every completed call"], ["outcomes", "Payments, promises and call-back requests"], ["escalations", "Escalations to the human desk"], ["autoDownload", "Download the escalation file automatically"]] as const).map(([k, label]) => (
                <label key={k} className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={prefs[k]} onChange={(e) => updatePrefs({ [k]: e.target.checked })} />
                  {label}
                </label>
              ))}
            </fieldset>
          </div>
        )}
      </div>

      {mounted && createPortal(<div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-[360px] max-w-[calc(100vw-32px)] flex-col gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-in pointer-events-auto rounded-lg border bg-surface p-3 shadow-[0_10px_30px_rgba(16,23,20,.16)] ${t.tone === "bad" ? "border-bad/40" : "border-line"}`}>
            <div className="flex items-start gap-2.5">
              <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${t.tone === "bad" ? "bg-bad" : t.tone === "good" ? "bg-good" : "bg-muted"}`} aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">{t.title}</div>
                <div className="line-clamp-2 text-[12px] text-muted">{t.detail}</div>
                {(t.borrowerId || t.file) && (
                  <div className="mt-2 flex gap-2">
                    {t.borrowerId && <button className="btn min-h-7 px-2 text-[12px]" onClick={() => openBorrower(t.borrowerId!)}>Open borrower</button>}
                    {t.file && <a className="btn min-h-7 px-2 text-[12px]" href={t.file}><Download size={13} aria-hidden="true" />Escalation file</a>}
                  </div>
                )}
              </div>
              <button aria-label="Dismiss" className="text-muted hover:text-ink" onClick={() => setToasts((cur) => cur.filter((x) => x.id !== t.id))}><X size={15} /></button>
            </div>
          </div>
        ))}
      </div>, document.body)}
    </>
  );
}
