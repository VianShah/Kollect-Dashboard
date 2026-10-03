"use client";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/components/ctx";
import { useApi } from "@/components/useApi";
import { localStore } from "@/components/local";
import { C, Card, DISP_COLOR, Delta, ErrorNote, Kpi, Loading, Offline, axisProps, tooltipStyle } from "@/components/ui";
import { computeOverview } from "@/lib/metrics";
import { inr, num, pct, shortDay, time } from "@/lib/format";

export default function Home() {
  const { qs, filters, scope, openBorrower } = useApp();
  const { data, offline, error } = useApi(`/api/overview?${qs}`, () => computeOverview(localStore(), filters, scope));
  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading />;
  const { kpis: k, deltas, trend, notes } = data;
  const spark = (key: "connectRate" | "recovered" | "ptp") => trend.map((t) => t[key]);

  return (
    <>
      <Offline show={offline} />
      <section className="card px-5 py-4">
        <div className="label">What changed</div>
        <ol className="mt-2 grid gap-x-8 gap-y-1.5 lg:grid-cols-2">
          {notes.map((n, i) => (
            <li key={i} className="flex gap-2.5 text-[13.5px] leading-snug">
              <span className="text-muted num">{String(i + 1).padStart(2, "0")}</span>
              <span>{n.text}{n.href && <> <Link href={n.href} className="whitespace-nowrap font-medium text-brand underline-offset-2 hover:underline">View</Link></>}</span>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Portfolio outstanding" value={inr(k.outstanding)} sub="Largest balances first" href="/borrowers?sort=outstanding" />
        <Kpi label="Recovered" value={inr(k.recovered)} delta={<Delta value={deltas.recovered} unit="%" />} spark={spark("recovered")} href="/borrowers?disposition=Paid" />
        <Kpi label="Recovery rate" value={pct(k.recoveryRate)} delta={<Delta value={deltas.recoveryRate} unit="pts" />} sub="Month-end forecast" href="/performance?tab=Forecast" />
        <Kpi label="Active PTPs" value={num(k.activePtp)} sub="Promises awaiting payment" href="/borrowers?disposition=PTP" />
        <Kpi label="PTP kept rate" value={pct(k.ptpKeptRate)} tone={k.ptpKeptRate < 70 ? "bad" : undefined} sub="See broken promises" href="/borrowers?ptp=broken" />
        <Kpi label="Contact rate" value={pct(k.contactRate)} delta={<Delta value={deltas.contactRate} unit="pts" />} spark={spark("connectRate")} href="/audit" />
        <Kpi label="Contact → PTP" value={pct(k.contactToPtp)} delta={<Delta value={deltas.contactToPtp} unit="pts" />} spark={spark("ptp")} href="/audit?classification=PTP" />
        <Kpi label="Payment links shared" value={num(k.linksShared)} sub={`${pct(k.linkConversion)} paid via link`} href="/borrowers?link=shared" />
        <Kpi label="Average DPD" value={`${k.avgDpd.toFixed(0)} days`} sub="Most overdue first" href="/borrowers?sort=dpd" />
        <Kpi label="Open escalations" value={num(k.openEscalations)} tone={k.openEscalations > 40 ? "bad" : undefined} sub="With the human desk" href="/borrowers?disposition=Escalated" />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Daily contact trend" sub="Attempted and connected calls, with connect rate">
          <ResponsiveContainer width="100%" height={270}>
            <ComposedChart data={trend} margin={{ left: -12, right: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDay} {...axisProps} minTickGap={24} />
              <YAxis yAxisId="l" {...axisProps} />
              <YAxis yAxisId="r" orientation="right" unit="%" domain={[0, 100]} {...axisProps} />
              <Tooltip {...tooltipStyle} labelFormatter={(l) => shortDay(String(l))} formatter={(v, n) => (n === "Connect rate" ? `${Number(v).toFixed(1)}%` : v)} />
              <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              <Bar yAxisId="l" dataKey="attempted" name="Attempted" fill={C.brandLight} isAnimationActive={false} />
              <Bar yAxisId="l" dataKey="connected" name="Connected" fill={C.brand} isAnimationActive={false} />
              <Line yAxisId="r" dataKey="connectRate" name="Connect rate" stroke={C.rust} strokeWidth={2} dot={false} isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Disposition trend" sub="Call outcomes per day">
          <ResponsiveContainer width="100%" height={270}>
            <BarChart data={trend} margin={{ left: -12, right: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDay} {...axisProps} minTickGap={24} />
              <YAxis {...axisProps} />
              <Tooltip {...tooltipStyle} labelFormatter={(l) => shortDay(String(l))} />
              <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="paid" name="Paid" stackId="a" fill={DISP_COLOR.Paid} isAnimationActive={false} />
              <Bar dataKey="ptp" name="PTP" stackId="a" fill={DISP_COLOR.PTP} isAnimationActive={false} />
              <Bar dataKey="dispute" name="Dispute" stackId="a" fill={DISP_COLOR.Dispute} isAnimationActive={false} />
              <Bar dataKey="other" name="Other" stackId="a" fill={C.greyDark} isAnimationActive={false} />
              <Bar dataKey="noContact" name="No contact" stackId="a" fill={C.grey} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Follow-ups booked for today" sub="Call-backs borrowers asked for" right={<Link href="/followups" className="btn btn-ghost">Calendar <ArrowRight size={14} aria-hidden="true" /></Link>} pad={false}>
          <ul>
            {data.followUpsToday.length === 0 && <li className="px-4 pb-6 pt-2 text-[13px] text-muted">No call-backs left for today.</li>}
            {data.followUpsToday.map((f) => (
              <li key={f.id} className="border-t border-line first:border-t-0">
                <button className="grid w-full grid-cols-[52px_1fr] gap-3 px-4 py-2.5 text-left hover:bg-sunk/50" onClick={() => openBorrower(f.borrowerId)}>
                  <span className="font-mono text-[13px] num">{time(f.at)}</span>
                  <span className="min-w-0"><span className="block truncate text-[13px] font-medium">{f.name} <span className="font-normal text-muted">· {f.product}</span></span><span className="block truncate text-[12px] text-muted">{f.note}</span></span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Latest escalations" sub="Most recent hand-offs to the human desk" right={<Link href="/borrowers?disposition=Escalated" className="btn btn-ghost">All <ArrowRight size={14} aria-hidden="true" /></Link>} pad={false}>
          <ul>
            {data.escalations.length === 0 && <li className="px-4 pb-6 pt-2 text-[13px] text-muted">No open escalations.</li>}
            {data.escalations.map((b) => (
              <li key={b.id} className="border-t border-line first:border-t-0">
                <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-sunk/50" onClick={() => openBorrower(b.id)}>
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium">{b.name} <span className="font-normal text-muted">· {b.loanId}</span></span><span className="block truncate text-[12px] text-muted">{b.escalationReason}</span></span>
                  <span className="text-[12.5px] num">{inr(b.outstanding)}</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
