"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard, BarChart3, Users, Radio, ShieldCheck, Gauge, Database, LogOut, CalendarDays, Scale, FlaskConical, Menu, X, MessageSquareWarning,
} from "lucide-react";
import { ACCESS, MODULES, ROLE_LABEL, can, type ModuleGroup } from "@/lib/roles";
import type { Filters } from "@/lib/types";
import type { SessionUser } from "@/lib/auth";
import { AppCtx, type Meta } from "./ctx";
import { localMeta } from "./local";
import Notifications from "./Notifications";
import BorrowerDrawer from "./BorrowerDrawer";

const ICONS = { home: LayoutDashboard, performance: BarChart3, borrowers: Users, followups: CalendarDays, channels: Radio, audit: ShieldCheck, compliance: Scale, grievances: MessageSquareWarning, usage: Gauge, data: Database };
const GROUPS: ModuleGroup[] = ["Monitor", "Act", "Assure", "Setup"];
const RANGE_LABEL: Record<Filters["range"], string> = { today: "Today", "7d": "Last 7 days", "30d": "Last 30 days", mtd: "Month to date", custom: "Custom range" };
const DEFAULT_FILTERS: Filters = { range: "30d", portfolio: "all", product: "all", channel: "all" };

export default function Shell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [meta, setMeta] = useState<Meta>(localMeta);
  const [version, setVersion] = useState(0);
  const [borrowerId, setBorrowerId] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const allowed = ACCESS[user.role];
  const current = MODULES.find((m) => path.startsWith(m.href));

  const refreshMeta = useCallback(async () => {
    try { const r = await fetch("/api/meta", { cache: "no-store" }); if (r.ok) setMeta(await r.json()); } catch { /* keep local meta */ }
  }, []);
  useEffect(() => {
    refreshMeta();
    const t = setInterval(refreshMeta, 60_000); // keeps the calling-hours status current
    return () => clearInterval(t);
  }, [refreshMeta]);
  useEffect(() => setNavOpen(false), [path]);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const qs = useMemo(() => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => v && v !== "all" && p.set(k, String(v)));
    return p.toString();
  }, [filters]);
  const scope = useMemo(() => (user.role === "client" ? { portfolio: meta.clientPortfolio ?? user.portfolio, visibleOnly: true } : {}), [user, meta.clientPortfolio]);

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login"); router.refresh();
  }

  const scenarioLabel = meta.scenarios.find((s) => s.key === meta.scenario)?.label ?? "";
  const context = [
    meta.source === "mock" ? `${scenarioLabel} demo data` : meta.source === "excel" ? "Uploaded data" : "Live data",
    user.role === "client" ? meta.clientPortfolio : filters.portfolio !== "all" ? filters.portfolio : "All portfolios",
    filters.product !== "all" ? filters.product : "All products",
    current?.filters ? RANGE_LABEL[filters.range] : null,
  ].filter(Boolean).join(" · ");

  const initials = user.name.split(" ").map((w) => w[0]).slice(0, 2).join("");

  return (
    <AppCtx.Provider value={{ user, filters, setFilters, qs, meta, refreshMeta, scope, version, bump, openBorrower: setBorrowerId }}>
      <div className="flex min-h-screen">
        <aside className={`fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col bg-night text-night-text transition-transform lg:sticky lg:top-0 lg:h-screen lg:translate-x-0 ${navOpen ? "translate-x-0" : "-translate-x-full"}`}>
          <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
            <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
              <rect width="26" height="26" rx="6" fill="#0e6b50" />
              <path d="M8 6.5v13M8 13.5l7.5-7M11 11l6 8.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
            <div className="leading-tight">
              <div className="text-[16px] font-semibold tracking-tight text-white">Kollect</div>
              <div className="text-[11px] text-night-text/80">by Predixion AI</div>
            </div>
            <button className="ml-auto text-night-text lg:hidden" aria-label="Close menu" onClick={() => setNavOpen(false)}><X size={18} /></button>
          </div>
          <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Main">
            {GROUPS.map((g) => {
              const items = MODULES.filter((m) => m.group === g && allowed.includes(m.key));
              if (!items.length) return null;
              return (
                <div key={g} className="mt-3">
                  <div className="px-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-night-text/60">{g}</div>
                  {items.map((m) => {
                    const Icon = ICONS[m.key];
                    const active = path.startsWith(m.href);
                    return (
                      <Link key={m.key} href={m.href} aria-current={active ? "page" : undefined}
                        className={`flex min-h-9 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] ${active ? "bg-night-2 font-medium text-white" : "hover:bg-night-2/60 hover:text-white"}`}>
                        <Icon size={16} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
                        {m.label}
                        {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#4fbf95]" aria-hidden="true" />}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </nav>
          <div className="flex items-center gap-2.5 border-t border-white/10 px-4 py-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-night-2 text-[12px] font-semibold text-white">{initials}</span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[13px] text-white">{user.name}</div>
              <div className="text-[11px]">{ROLE_LABEL[user.role]}</div>
            </div>
            <button onClick={logout} className="rounded p-1.5 hover:bg-night-2 hover:text-white" aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
          </div>
        </aside>
        {navOpen && <button className="fixed inset-0 z-30 bg-black/30 lg:hidden" aria-label="Close menu" onClick={() => setNavOpen(false)} />}

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-line bg-ground/95 backdrop-blur">
            <div className="flex items-center gap-3 px-4 pb-2 pt-3 sm:px-6">
              <button className="btn btn-ghost h-9 w-9 px-0 lg:hidden" aria-label="Open menu" onClick={() => setNavOpen(true)}><Menu size={18} /></button>
              <div className="min-w-0 flex-1">
                <h1 className="text-[20px] font-semibold tracking-tight">{current?.label}</h1>
                <p className="truncate text-[12.5px] text-muted">{context}</p>
              </div>
              {meta.source === "mock" && meta.live && (
                <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-2 sm:inline-flex">
                  {meta.windowOpen
                    ? <><span className="pulse-dot h-2 w-2 rounded-full bg-[#1f9d6e]" aria-hidden="true" />Live traffic</>
                    : <><span className="h-2 w-2 rounded-full bg-muted" aria-hidden="true" />Paused · outside calling hours</>}
                </span>
              )}
              {can(user.role, "demo") && (
                <a className="btn" href="https://kollect-statemachine.onrender.com/" target="_blank" rel="noopener noreferrer">
                  <FlaskConical size={15} aria-hidden="true" /><span className="hidden sm:inline">Statemachine</span>
                </a>
              )}
              <Notifications />
            </div>
            {current?.filters && allowed.includes(current.key) && (
              <div className="flex flex-wrap items-center gap-2 px-4 pb-3 sm:px-6">
                <div className="seg" role="group" aria-label="Date range">
                  {(["today", "7d", "30d", "mtd", "custom"] as const).map((r) => (
                    <button key={r} aria-pressed={filters.range === r} onClick={() => setFilters({ ...filters, range: r })}>
                      {r === "today" ? "Today" : r === "mtd" ? "MTD" : r === "custom" ? "Custom" : r.toUpperCase()}
                    </button>
                  ))}
                </div>
                {filters.range === "custom" && (
                  <>
                    <label className="sr-only" htmlFor="from">From</label>
                    <input id="from" type="date" className="input" value={filters.from ?? ""} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
                    <label className="sr-only" htmlFor="to">To</label>
                    <input id="to" type="date" className="input" value={filters.to ?? ""} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
                  </>
                )}
                {user.role !== "client" && (
                  <select aria-label="Portfolio" className="input" value={filters.portfolio} onChange={(e) => setFilters({ ...filters, portfolio: e.target.value })}>
                    <option value="all">All portfolios</option>
                    {meta.portfolios.map((p) => <option key={p}>{p}</option>)}
                  </select>
                )}
                <select aria-label="Product" className="input" value={filters.product} onChange={(e) => setFilters({ ...filters, product: e.target.value })}>
                  <option value="all">All products</option>
                  {meta.products.map((p) => <option key={p}>{p}</option>)}
                </select>
                <select aria-label="Channel" className="input" value={filters.channel} onChange={(e) => setFilters({ ...filters, channel: e.target.value })}>
                  <option value="all">All channels</option>
                  <option>AI Voice</option><option>WhatsApp</option><option>Human Desk</option>
                </select>
                {(filters.portfolio !== "all" || filters.product !== "all" || filters.channel !== "all" || filters.range !== "30d") && (
                  <button className="btn btn-ghost" onClick={() => setFilters(DEFAULT_FILTERS)}>Clear filters</button>
                )}
              </div>
            )}
          </header>
          <main className="mx-auto max-w-[1440px] space-y-4 px-4 py-5 sm:px-6">
            {current && !allowed.includes(current.key)
              ? <div className="card p-8 text-center"><div className="font-medium">This area isn&apos;t part of your role.</div><p className="mt-1 text-[13px] text-muted">Ask a Super Admin if you need access.</p></div>
              : children}
          </main>
        </div>
      </div>
      {borrowerId && <BorrowerDrawer id={borrowerId} onClose={() => setBorrowerId(null)} />}
    </AppCtx.Provider>
  );
}

