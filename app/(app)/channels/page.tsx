"use client";
import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/components/ctx";
import { useApi } from "@/components/useApi";
import { localStore } from "@/components/local";
import { C, Card, Empty, ErrorNote, Kpi, Loading, Offline, Pager, axisProps, tooltipStyle } from "@/components/ui";
import { campaignRuns, bucketText, type RunRow } from "@/lib/reports";
import { inr, num, shortDay, time } from "@/lib/format";

interface Data { runs: RunRow[]; total: number }
const CHANNEL_LABEL: Record<string, string> = { "AI Voice": "AI voice", IVR: "IVR", WhatsApp: "WhatsApp bot", "Human Desk": "Telecallers" };
const OUTCOME_COLOR: Record<string, string> = { Paid: C.brand, PTP: C.info, Callback: C.amber, Dispute: C.rust, Escalated: C.bad, "No commitment": C.greyDark, "Not answered": C.grey };
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const rorTone = (v: number) => (v >= 12 ? "text-good" : v >= 6 ? "" : "text-bad");

/** One row per campaign run: the allocation file it worked, when it ran, its buckets, and what it recovered. */
export default function CampaignReport() {
  const { qs, filters, scope } = useApp();
  const { data, offline, error } = useApi<Data>(`/api/reports?${qs}`, () => {
    const runs = campaignRuns(localStore(), filters, scope);
    return { runs, total: runs.length };
  });
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => setPage(0), [qs]);

  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading rows={1} />;
  const rows = data.runs;
  const PAGE = 25, pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const sum = (k: "calls" | "connected" | "due" | "collected" | "accounts" | "promises") => rows.reduce((n, r) => n + r[k], 0);
  const sel = rows.find((r) => r.id === open);

  function exportCsv() {
    const head = ["Product", "Company", "Date", "Start", "End", "Campaign code", "Channel", "Language", "Buckets", "Accounts in file", "Amount due", "Calls made", "Connected", "Promises", "Amount promised", "Paid accounts", "Collected", "RoR %", "Talk minutes"];
    const lines = rows.map((r) => [r.product, r.portfolio, r.day, time(r.start), time(r.end), r.code, CHANNEL_LABEL[r.channel] ?? r.channel, r.language, bucketText(r), r.accounts, r.due, r.calls, r.connected, r.promises, r.promised, r.paid, r.collected, r.ror.toFixed(1), r.talkMinutes]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const url = URL.createObjectURL(new Blob(["﻿" + [head.join(","), ...lines].join("\n")], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "campaign-report.csv" }).click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Offline show={offline} />
      <p className="text-[13px] text-muted">Every campaign run in the selected dates: one allocation file worked by one campaign code on one day. RoR is the share of the amount due in the file that was recovered. Use the date, company, product and channel filters above.</p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Campaign runs" value={num(rows.length)} sub={`${num(sum("accounts"))} accounts allocated`} />
        <Kpi label="Calls made" value={num(sum("calls"))} sub={`${pct(sum("connected"), sum("calls"))} connected`} />
        <Kpi label="Promises" value={num(sum("promises"))} sub={`${pct(sum("promises"), sum("connected"))} of answered calls`} />
        <Kpi label="Collected" value={inr(sum("collected"))} tone="good" sub={`of ${inr(sum("due"))} due`} />
        <Kpi label="RoR" value={`${sum("due") ? ((sum("collected") / sum("due")) * 100).toFixed(1) : "0"}%`} sub="Recovered ÷ amount due" />
      </div>

      {sel && (
        <Card title={<span className="font-mono text-[14px]">{sel.code}</span>}
          sub={`${sel.product} · ${sel.portfolio} · ${shortDay(sel.day)}, ${time(sel.start)}–${time(sel.end)} IST · ${CHANNEL_LABEL[sel.channel] ?? sel.channel} · ${sel.language}`}
          right={<button className="btn btn-ghost min-h-8 px-2" onClick={() => setOpen(null)} aria-label="Close run"><X size={15} /></button>}>
          <div className={`mb-4 rounded-md px-3 py-2 text-[12.5px] ${sel.mixed ? "bg-info-soft text-info" : "bg-sunk text-ink-2"}`}>
            <b>{sel.mixed ? "Mixed buckets" : "Single bucket"}</b> · {num(sel.accounts)} accounts in the file ·{" "}
            {sel.buckets.map((b) => `${b.name} (${b.share}%)`).join(", ")}
          </div>
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr_280px]">
            <div>
              <div className="label mb-1">Calls started by hour</div>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={sel.hours.map((v, i) => ({ hour: `${String(8 + i).padStart(2, "0")}:00`, calls: v }))} margin={{ left: -14 }}>
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
                {Object.entries(sel.outcomes).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                  <li key={k}>
                    <div className="flex justify-between text-[12.5px]"><span>{k === "PTP" ? "Promise to pay" : k}</span><span className="num text-muted">{num(v)} · {pct(v, sel.calls)}</span></div>
                    <div className="mt-0.5 h-1.5 rounded-full bg-sunk"><div className="h-1.5 rounded-full" style={{ width: pct(v, sel.calls), background: OUTCOME_COLOR[k] ?? C.grey }} /></div>
                  </li>
                ))}
              </ul>
            </div>
            <dl className="divide-y divide-line text-[12.5px]">
              {[["Amount due", inr(sel.due)], ["Calls made", num(sel.calls)], ["Connected", `${num(sel.connected)} (${pct(sel.connected, sel.calls)})`],
                ["Promises", `${num(sel.promises)} · ${inr(sel.promised)}`], ["Paid", `${num(sel.paid)} accounts`], ["Collected", inr(sel.collected)],
                ["RoR", `${sel.ror.toFixed(1)}%`], ["Talk time", `${num(sel.talkMinutes)} min`]].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-2 py-1.5"><dt className="text-muted">{k}</dt><dd className={`font-medium num ${k === "RoR" ? rorTone(sel.ror) : ""}`}>{v}</dd></div>
              ))}
            </dl>
          </div>
        </Card>
      )}

      <Card pad={false} title="Runs" sub="Click a run for its hours, outcomes and buckets."
        right={<button className="btn" onClick={exportCsv}><Download size={14} aria-hidden="true" />Export CSV</button>}>
        <div className="overflow-x-auto">
          <table className="table w-full whitespace-nowrap">
            <thead><tr><th>Product</th><th>Company</th><th>Date</th><th>Time (IST)</th><th>Campaign code</th><th>Channel</th><th>Buckets</th><th className="text-right">Accounts</th><th className="text-right">Calls made</th><th className="text-right">Connected</th><th className="text-right">Promises</th><th className="text-right">Collected</th><th className="text-right">RoR</th></tr></thead>
            <tbody>
              {rows.slice(page * PAGE, page * PAGE + PAGE).map((r) => (
                <tr key={r.id} className={`cursor-pointer hover:bg-sunk/40 ${open === r.id ? "bg-brand-soft/50" : ""}`} onClick={() => { setOpen(r.id); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                  <td className="font-medium">{r.product}</td>
                  <td className="text-[12.5px]">{r.portfolio}</td>
                  <td className="num">{shortDay(r.day)}</td>
                  <td className="num text-[12.5px]">{time(r.start)}–{time(r.end)}</td>
                  <td className="font-mono text-[12px] text-ink-2">{r.code}</td>
                  <td className="text-[12.5px]">{CHANNEL_LABEL[r.channel] ?? r.channel}</td>
                  <td className="text-[12px]" title={bucketText(r)}>{r.mixed ? <span className="rounded bg-info-soft px-1.5 py-0.5 text-info">Mixed · {r.buckets.length}</span> : <span className="rounded bg-sunk px-1.5 py-0.5 text-ink-2">{r.buckets[0].name}</span>}</td>
                  <td className="text-right num">{num(r.accounts)}</td>
                  <td className="text-right num">{num(r.calls)}</td>
                  <td className="text-right num">{num(r.connected)} <span className="text-[11.5px] text-muted">{pct(r.connected, r.calls)}</span></td>
                  <td className="text-right num">{num(r.promises)}</td>
                  <td className="text-right num">{inr(r.collected)}</td>
                  <td className={`text-right font-medium num ${rorTone(r.ror)}`}>{r.ror.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty title="No runs in these dates">Widen the date range or clear a filter above.</Empty>}
        </div>
        <Pager page={page} pages={pages} setPage={setPage} total={rows.length} />
      </Card>
    </>
  );
}
