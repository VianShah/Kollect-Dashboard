"use client";
import { useEffect, useMemo, useState } from "react";
import { Download, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/components/ctx";
import { useApi } from "@/components/useApi";
import { localStore } from "@/components/local";
import { C, Card, DISP_COLOR, Empty, ErrorNote, Kpi, Loading, Offline, Pager, axisProps, tooltipStyle } from "@/components/ui";
import { scoped } from "@/lib/metrics";
import { campaignRuns, type RunRow } from "@/lib/reports";
import { num, shortDay, time } from "@/lib/format";

interface Data { runs: RunRow[]; total: number; products: string[] }
const CHANNEL_LABEL: Record<string, string> = { "AI Voice": "AI voice", IVR: "IVR", WhatsApp: "WhatsApp bot", "Human Desk": "Telecallers" };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

/** One row per campaign run: which product, when it ran, the campaign code, how hard it ran and what it got. */
export default function CampaignReport() {
  const { qs, filters, scope } = useApp();
  const { data, offline, error } = useApi<Data>(`/api/reports?${qs}`, () => {
    const s = localStore();
    const runs = campaignRuns(s, scoped(s, filters, scope).calls);
    return { runs, total: runs.length, products: s.products };
  });
  const [product, setProduct] = useState("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setPage(0), [product, q, qs]);

  const rows = useMemo(() => (data?.runs ?? []).filter((r) => (product === "all" || r.product === product) && (!q || r.code.toLowerCase().includes(q.toLowerCase()))), [data, product, q]);
  const byProduct = useMemo(() => (data?.products ?? []).map((p) => {
    const rs = (data?.runs ?? []).filter((r) => r.product === p);
    return { product: p, runs: rs.length, calls: rs.reduce((n, r) => n + r.calls, 0), connected: rs.reduce((n, r) => n + r.connected, 0), promises: rs.reduce((n, r) => n + r.promises, 0), peak: Math.max(0, ...rs.map((r) => r.peak)) };
  }), [data]);

  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading rows={1} />;
  const PAGE = 25, pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const calls = rows.reduce((n, r) => n + r.calls, 0), connected = rows.reduce((n, r) => n + r.connected, 0);
  const sel = rows.find((r) => r.id === open) ?? data.runs.find((r) => r.id === open);

  function exportCsv() {
    const head = ["Product", "Company", "Date", "Start", "End", "Campaign code", "Channel", "Language", "Peak concurrency", "Concurrency set", "Calls made", "Connected", "Promises", "Payments", "Talk minutes"];
    const lines = rows.map((r) => [r.product, r.portfolio, r.day, time(r.start), time(r.end), r.code, CHANNEL_LABEL[r.channel] ?? r.channel, r.language, r.peak, r.concurrency, r.calls, r.connected, r.promises, r.paid, r.talkMinutes].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const url = URL.createObjectURL(new Blob(["﻿" + [head.join(","), ...lines].join("\n")], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "campaign-report.csv" }).click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Offline show={offline} />
      <p className="text-[13px] text-muted">Every campaign run in the selected dates: one row per campaign code per day, with when it ran, how many calls ran at once and what it achieved. Use the date and product filters above.</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Campaign runs" value={num(rows.length)} sub={`${new Set(rows.map((r) => r.code)).size} campaign codes`} />
        <Kpi label="Calls made" value={num(calls)} sub={`${num(rows.reduce((n, r) => n + r.talkMinutes, 0))} talk minutes`} />
        <Kpi label="Connected" value={pct(connected, calls)} sub={`${num(connected)} calls answered`} />
        <Kpi label="Peak concurrency" value={num(Math.max(0, ...rows.map((r) => r.peak)))} sub="Most calls live at once in one run" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {byProduct.map((p) => (
          <button key={p.product} onClick={() => setProduct(product === p.product ? "all" : p.product)} aria-pressed={product === p.product}
            className={`card p-3 text-left ${product === p.product ? "border-brand bg-brand-soft" : "hover:border-line-strong"}`}>
            <div className="text-[13.5px] font-semibold">{p.product}</div>
            <div className="mt-1 text-[12px] text-muted num">{num(p.runs)} runs · {num(p.calls)} calls · {pct(p.connected, p.calls)} connected</div>
            <div className="text-[12px] text-muted num">{num(p.promises)} promises · peak {num(p.peak)} at once</div>
          </button>
        ))}
      </div>

      {sel && (
        <Card title={<span className="font-mono text-[14px]">{sel.code}</span>} sub={`${sel.product} · ${sel.portfolio} · ${shortDay(sel.day)}, ${time(sel.start)}–${time(sel.end)} IST · ${CHANNEL_LABEL[sel.channel] ?? sel.channel} · ${sel.language}`}
          right={<button className="btn btn-ghost min-h-8 px-2" onClick={() => setOpen(null)} aria-label="Close run"><X size={15} /></button>}>
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr_260px]">
            <div>
              <div className="label mb-1">Calls started by hour</div>
              <ResponsiveContainer width="100%" height={170}>
                <BarChart data={sel.hours.map((v, i) => ({ hour: `${String(8 + i).padStart(2, "0")}:00`, calls: v }))} margin={{ left: -20 }}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="hour" {...axisProps} interval={1} />
                  <YAxis {...axisProps} allowDecimals={false} />
                  <Tooltip {...tooltipStyle} cursor={{ fill: "#f1eee8" }} />
                  <Bar dataKey="calls" fill={C.brand} radius={[2, 2, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <div className="label mb-2">Outcomes</div>
              <ul className="space-y-1.5">
                {Object.entries(sel.outcomes).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <li key={k}>
                    <div className="flex justify-between text-[12.5px]"><span>{k}</span><span className="num text-muted">{num(v)} · {pct(v, sel.calls)}</span></div>
                    <div className="mt-0.5 h-1.5 rounded-full bg-sunk"><div className="h-1.5 rounded-full" style={{ width: pct(v, sel.calls), background: DISP_COLOR[k] ?? C.grey }} /></div>
                  </li>
                ))}
              </ul>
            </div>
            <dl className="divide-y divide-line text-[12.5px]">
              {[["Calls made", num(sel.calls)], ["Connected", `${num(sel.connected)} (${pct(sel.connected, sel.calls)})`], ["Promises", num(sel.promises)], ["Payments", num(sel.paid)],
                ["Peak concurrency", `${num(sel.peak)} of ${num(sel.concurrency)} set`], ["Talk time", `${num(sel.talkMinutes)} min`]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 py-1.5"><dt className="text-muted">{k}</dt><dd className="font-medium num">{v}</dd></div>
              ))}
            </dl>
          </div>
        </Card>
      )}

      <Card pad={false} title="Runs" sub="Click a run to see its hours and outcomes."
        right={<div className="flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="rq">Search campaign code</label>
          <input id="rq" className="input w-56" placeholder="Search campaign code" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn" onClick={exportCsv}><Download size={14} aria-hidden="true" />Export CSV</button>
        </div>}>
        <div className="overflow-x-auto">
          <table className="table w-full whitespace-nowrap">
            <thead><tr><th>Product</th><th>Date</th><th>Time (IST)</th><th>Campaign code</th><th>Channel</th><th className="text-right">Concurrency</th><th className="text-right">Calls made</th><th className="text-right">Connected</th><th className="text-right">Promises</th><th className="text-right">Payments</th></tr></thead>
            <tbody>
              {rows.slice(page * PAGE, page * PAGE + PAGE).map((r) => (
                <tr key={r.id} className={`cursor-pointer hover:bg-sunk/40 ${open === r.id ? "bg-brand-soft/50" : ""}`} onClick={() => setOpen(r.id)}>
                  <td className="font-medium">{r.product}</td>
                  <td className="num">{shortDay(r.day)}</td>
                  <td className="num text-[12.5px]">{time(r.start)}–{time(r.end)}</td>
                  <td className="font-mono text-[12px] text-ink-2">{r.code}</td>
                  <td className="text-[12.5px]">{CHANNEL_LABEL[r.channel] ?? r.channel}</td>
                  <td className="text-right num">{num(r.peak)}<span className="text-muted"> / {num(r.concurrency)}</span></td>
                  <td className="text-right num">{num(r.calls)}</td>
                  <td className="text-right num">{num(r.connected)} <span className="text-[11.5px] text-muted">{pct(r.connected, r.calls)}</span></td>
                  <td className="text-right num">{num(r.promises)}</td>
                  <td className="text-right num">{num(r.paid)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty title="No runs in these dates">Widen the date range or pick another product.</Empty>}
        </div>
        <Pager page={page} pages={pages} setPage={setPage} total={rows.length} />
      </Card>
      {data.total > data.runs.length && <p className="text-[12px] text-muted">Showing the latest {num(data.runs.length)} of {num(data.total)} runs. Narrow the dates to see older ones.</p>}
    </>
  );
}
