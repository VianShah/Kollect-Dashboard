"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, ChevronRight } from "lucide-react";

// Chart palette: distinct in lightness as well as hue so series survive greyscale and colour-blindness.
export const C = {
  brand: "#0e6b50",
  brandLight: "#a8cdbd",
  ink: "#16181c",
  info: "#2456c2",
  infoLight: "#8fb0ec",
  amber: "#c47a1c",
  rust: "#8a4307",
  bad: "#b42318",
  grey: "#c9c4b9",
  greyDark: "#8b8f96",
  grid: "#e7e3db",
  axis: "#5c6068",
};
export const DISP_COLOR: Record<string, string> = {
  Paid: C.brand, PTP: C.info, Partial: C.infoLight, Callback: C.amber, Dispute: C.rust, Escalated: C.bad, "No Contact": C.grey,
};
export const axisProps = { stroke: C.axis, fontSize: 11, tickLine: false, axisLine: { stroke: C.grid } } as const;
export const tooltipStyle = { contentStyle: { borderRadius: 6, border: `1px solid ${C.grid}`, fontSize: 12, boxShadow: "0 4px 16px rgba(0,0,0,.06)" } };

export function Spark({ values, color = C.brand }: { values: number[]; color?: string }) {
  if (values.length < 3) return null;
  const w = 88, h = 26, max = Math.max(...values), min = Math.min(...values), span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - 2 - ((v - min) / span) * (h - 4)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" className="shrink-0">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function Delta({ value, unit, goodWhenUp = true }: { value: number | null | undefined; unit: "pts" | "%"; goodWhenUp?: boolean }) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const up = value >= 0;
  const good = up === goodWhenUp;
  const Icon = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1 py-px text-[11px] font-semibold num ${Math.abs(value) < 0.05 ? "bg-sunk text-muted" : good ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>
      <Icon size={12} aria-hidden="true" />{Math.abs(value).toFixed(unit === "%" ? 0 : 1)}{unit === "%" ? "%" : " pts"}
    </span>
  );
}

export function Kpi({ label, value, sub, href, delta, spark, tone }: {
  label: string; value: ReactNode; sub?: ReactNode; href?: string; delta?: ReactNode; spark?: number[]; tone?: "bad" | "good";
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="label">{label}</span>
        {href && <ChevronRight size={14} className="text-muted opacity-0 transition-opacity group-hover:opacity-100" aria-hidden="true" />}
      </div>
      <div className={`mt-2 whitespace-nowrap text-[26px] font-semibold leading-none tracking-tight num ${tone === "bad" ? "text-bad" : tone === "good" ? "text-good" : ""}`}>{value}</div>
      <div className="mt-2 flex min-h-[26px] items-center gap-1.5 text-[12px] text-muted">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">{delta}{sub}</span>
        {spark && <span className="ml-auto"><Spark values={spark} /></span>}
      </div>
    </>
  );
  const cls = "card group block p-4";
  return href ? <Link href={href} className={`${cls} transition-colors hover:border-line-strong hover:bg-[#fcfbf9]`}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function Card({ title, sub, children, right, className = "", pad = true }: { title?: ReactNode; sub?: ReactNode; children: ReactNode; right?: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card ${className}`}>
      {(title || right) && (
        <header className="flex flex-wrap items-start justify-between gap-2 px-4 pt-4">
          <div>
            {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
            {sub && <p className="mt-0.5 text-[12px] text-muted">{sub}</p>}
          </div>
          {right}
        </header>
      )}
      <div className={pad ? "p-4" : "pt-3"}>{children}</div>
    </section>
  );
}

const BADGE: Record<string, string> = {
  Paid: "bg-good-soft text-good", "Paid via link": "bg-good-soft text-good", Done: "bg-good-soft text-good", Answered: "bg-good-soft text-good",
  Read: "bg-good-soft text-good", Replied: "bg-good-soft text-good", Clicked: "bg-good-soft text-good", Opened: "bg-good-soft text-good", Visible: "bg-good-soft text-good", Prime: "bg-good-soft text-good",
  PTP: "bg-info-soft text-info", Partial: "bg-info-soft text-info", Shared: "bg-info-soft text-info", Scheduled: "bg-info-soft text-info", Delivered: "bg-info-soft text-info",
  Callback: "bg-warn-soft text-warn", "Link clicked": "bg-warn-soft text-warn", Dispute: "bg-warn-soft text-warn", "Near-prime": "bg-warn-soft text-warn",
  Open: "bg-warn-soft text-warn", "In progress": "bg-info-soft text-info", Resolved: "bg-good-soft text-good",
  Escalated: "bg-bad-soft text-bad", Missed: "bg-bad-soft text-bad", Failed: "bg-bad-soft text-bad", Subprime: "bg-bad-soft text-bad",
};
export const Badge = ({ children }: { children: string }) => (
  <span className={`inline-flex items-center whitespace-nowrap rounded px-1.5 py-0.5 text-[11.5px] font-medium ${BADGE[children] ?? "bg-sunk text-ink-2"}`}>{children}</span>
);

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: readonly T[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-5 overflow-x-auto border-b border-line">
      {tabs.map((t) => (
        <button key={t} role="tab" aria-selected={value === t} onClick={() => onChange(t)}
          className={`-mb-px min-h-10 whitespace-nowrap border-b-2 text-[13px] font-medium ${value === t ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink"}`}>
          {t}
        </button>
      ))}
    </div>
  );
}

export const Offline = ({ show }: { show: boolean }) =>
  show ? <div className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-warn">The server isn&apos;t responding. You&apos;re seeing local demo data; changes stay in this browser.</div> : null;

export const Loading = ({ rows = 3 }: { rows?: number }) => (
  <div className="space-y-3" aria-busy="true" aria-label="Loading">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <div key={i} className="card h-[104px] animate-pulse bg-sunk/60" />)}</div>
    {Array.from({ length: rows }, (_, i) => <div key={i} className="card h-56 animate-pulse bg-sunk/60" />)}
  </div>
);

export const Empty = ({ title, children }: { title: string; children?: ReactNode }) => (
  <div className="px-4 py-10 text-center">
    <div className="text-[14px] font-medium">{title}</div>
    {children && <div className="mx-auto mt-1 max-w-sm text-[13px] text-muted">{children}</div>}
  </div>
);

export const ErrorNote = ({ text }: { text: string }) => <div className="card p-6 text-[13px] text-muted">{text}</div>;

export function Pager({ page, pages, setPage, total }: { page: number; pages: number; setPage: (n: number) => void; total: number }) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[13px] text-muted">
      <span className="num">{total.toLocaleString("en-IN")} rows</span>
      <div className="flex items-center gap-2">
        <button className="btn" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
        <span className="num">{page + 1} / {pages}</span>
        <button className="btn" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
