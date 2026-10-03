"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useApp } from "@/components/ctx";
import { useApi } from "@/components/useApi";
import { localStore } from "@/components/local";
import { Badge, C, Card, DISP_COLOR, ErrorNote, Kpi, Loading, Offline, Tabs, axisProps, tooltipStyle } from "@/components/ui";
import { computePerformance } from "@/lib/metrics";
import { inr, inrFull, num, pct, shortDay } from "@/lib/format";

const TABS = ["Overview", "Forecast", "Roll rates", "Segments", "Products", "Channels", "Regions", "Escalations"] as const;
type Tab = (typeof TABS)[number];
type Data = ReturnType<typeof computePerformance>;

export default function PerformancePage() {
  return <Suspense fallback={<Loading />}><Performance /></Suspense>;
}

function Performance() {
  const { qs, filters, scope, openBorrower } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const initial = TABS.find((t) => t === params.get("tab")) ?? "Overview";
  const [tab, setTabState] = useState<Tab>(initial);
  const setTab = (t: Tab) => { setTabState(t); router.replace(`/performance?tab=${encodeURIComponent(t)}`, { scroll: false }); };
  const { data, offline, error } = useApi(`/api/performance?${qs}`, () => computePerformance(localStore(), filters, scope));
  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading />;

  return (
    <>
      <Offline show={offline} />
      <Tabs tabs={TABS} value={tab} onChange={setTab} />
      {tab === "Overview" && <Overview data={data} />}
      {tab === "Forecast" && <Forecast f={data.forecast} />}
      {tab === "Roll rates" && <Roll r={data.roll} />}
      {tab === "Segments" && <GroupTable rows={data.stages} label="Segment" param="segment" />}
      {tab === "Products" && <GroupTable rows={data.products} label="Product" />}
      {tab === "Channels" && <GroupTable rows={data.channels} label="Channel" />}
      {tab === "Regions" && <GroupTable rows={data.regions} label="Region" />}
      {tab === "Escalations" && (
        <Card title="Open escalations" sub="Largest balances first. Select a borrower for their full history." pad={false}>
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead><tr><th>Borrower</th><th>Loan ID</th><th>Product</th><th>Reason</th><th className="text-right">DPD</th><th className="text-right">Outstanding</th></tr></thead>
              <tbody>{data.escalations.map((b) => (
                <tr key={b.id} className="hover:bg-sunk/40">
                  <td><button className="font-medium hover:text-brand hover:underline" onClick={() => openBorrower(b.id)}>{b.name}</button></td>
                  <td className="font-mono text-[12.5px]">{b.loanId}</td><td>{b.product}</td><td className="text-muted">{b.escalationReason}</td>
                  <td className="text-right num">{b.dpd}</td><td className="text-right num">{inrFull(b.outstanding)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

function Overview({ data }: { data: Data }) {
  const router = useRouter();
  const top = data.funnel[0].value || 1;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Recovery funnel" sub="Select a stage to see those borrowers">
        <div className="space-y-2">
          {data.funnel.map((f, i) => (
            <Link key={f.stage} href={`/borrowers?stage=${f.min}`} className="group block rounded-md px-2 py-1.5 hover:bg-sunk/60">
              <div className="mb-1 flex justify-between text-[13px]">
                <span className="font-medium group-hover:text-brand">{f.stage}</span>
                <span className="num">{num(f.value)} <span className="text-muted">· {((f.value / top) * 100).toFixed(0)}%</span>
                  {i > 0 && <span className="ml-2 text-[11.5px] text-bad">−{num(data.funnel[i - 1].value - f.value)}</span>}</span>
              </div>
              <div className="h-2.5 rounded-sm bg-sunk"><div className="h-2.5 rounded-sm" style={{ width: `${(f.value / top) * 100}%`, background: i === 4 ? C.brand : i === 3 ? C.info : "#5f7f74" }} /></div>
            </Link>
          ))}
        </div>
      </Card>
      <Card title="Dispositions" sub="Select a slice to open the matching borrowers">
        <div className="grid items-center gap-4 sm:grid-cols-[1fr_180px]">
          <ResponsiveContainer width="100%" height={240}>
            <PieChart>
              <Pie data={data.dispositions} dataKey="value" nameKey="name" innerRadius={62} outerRadius={100} paddingAngle={1} stroke="#fff" isAnimationActive={false}
                onClick={(d: { name?: string }) => d.name && router.push(`/borrowers?disposition=${encodeURIComponent(d.name)}`)} className="cursor-pointer">
                {data.dispositions.map((d) => <Cell key={d.name} fill={DISP_COLOR[d.name] ?? C.grey} />)}
              </Pie>
              <Tooltip {...tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
          <ul className="space-y-1 text-[13px]">
            {data.dispositions.map((d) => (
              <li key={d.name}><Link href={`/borrowers?disposition=${encodeURIComponent(d.name)}`} className="flex items-center gap-2 rounded px-1.5 py-0.5 hover:bg-sunk">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: DISP_COLOR[d.name] }} aria-hidden="true" /><span className="flex-1">{d.name}</span><span className="num text-muted">{num(d.value)}</span>
              </Link></li>
            ))}
          </ul>
        </div>
      </Card>
      <Card title="Why calls don't connect" sub="Select a reason to audit those calls">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data.nonContact.map((d) => ({ ...d, label: d.name.replace(/_/g, " ") }))} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid stroke={C.grid} horizontal={false} />
            <XAxis type="number" {...axisProps} /><YAxis type="category" dataKey="label" {...axisProps} width={100} />
            <Tooltip {...tooltipStyle} cursor={{ fill: "#f1eee8" }} />
            <Bar dataKey="value" name="Calls" fill={C.rust} radius={[0, 3, 3, 0]} isAnimationActive={false} className="cursor-pointer"
              onClick={(d: { name?: string }) => d.name && router.push(`/audit?drop=${d.name}`)} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card title="Connect rate by time of day" sub="Voice calls, IST. Use it to place retry slots.">
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={data.bands} margin={{ left: -12 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="band" {...axisProps} /><YAxis yAxisId="l" {...axisProps} /><YAxis yAxisId="r" orientation="right" unit="%" domain={[0, 100]} {...axisProps} />
            <Tooltip {...tooltipStyle} formatter={(v, n) => (n === "Connect rate" ? `${Number(v).toFixed(1)}%` : v)} />
            <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="l" dataKey="attempts" name="Calls" fill={C.brandLight} isAnimationActive={false} />
            <Line yAxisId="r" dataKey="rate" name="Connect rate" stroke={C.brand} strokeWidth={2} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
      <Card title="Connectivity by attempt" sub="Does the 3rd try still earn its cost?" className="xl:col-span-2">
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data.attempts.map((a) => ({ ...a, rate: a.calls ? (a.connected / a.calls) * 100 : 0 }))} margin={{ left: -12 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="attempt" {...axisProps} /><YAxis {...axisProps} />
            <Tooltip {...tooltipStyle} />
            <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="calls" name="Calls" fill={C.brandLight} isAnimationActive={false} /><Bar dataKey="connected" name="Connected" fill={C.brand} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}

function Forecast({ f }: { f: Data["forecast"] }) {
  const gap = f.projected - f.target;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Kpi label="Recovered this month" value={inr(f.recoveredMtd)} sub={`${f.elapsed} of ${f.daysInMonth} days gone`} href="/borrowers?disposition=Paid" />
        <Kpi label="Projected month-end" value={inr(f.projected)} sub={`Likely range ${inr(f.low)} – ${inr(f.high)}`} />
        <Kpi label="Expected from PTPs" value={inr(f.ptpExpected)} sub={`${num(f.ptpCount)} promises worth ${inr(f.ptpAmount)}`} href="/borrowers?disposition=PTP" />
        <Kpi label={`Target · ${f.targetPct}% of book`} value={inr(f.target)} tone={gap < 0 ? "bad" : "good"} sub={gap < 0 ? `${inr(-gap)} short at current pace` : `${inr(gap)} ahead of target`} />
      </div>
      <Card title="Month-end recovery projection" sub="Solid line is actual cumulative recovery. Dashed line and band are the projection.">
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={f.series} margin={{ left: 8, right: 8 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDay} {...axisProps} minTickGap={20} />
            <YAxis tickFormatter={(v) => inr(Number(v))} {...axisProps} width={78} />
            <Tooltip {...tooltipStyle} labelFormatter={(l) => shortDay(String(l))}
              formatter={(v, n) => (Array.isArray(v) ? `${inr(Number(v[0]))} – ${inr(Number(v[1]))}` : inr(Number(v))) as string} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 12 }} />
            <Area dataKey="range" name="Likely range" fill={C.brand} fillOpacity={0.1} stroke="none" isAnimationActive={false} />
            <Line dataKey="actual" name="Actual" stroke={C.ink} strokeWidth={2.2} dot={false} isAnimationActive={false} />
            <Line dataKey="projected" name="Projected" stroke={C.brand} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
            <ReferenceLine y={f.target} stroke={C.rust} strokeDasharray="2 3" label={{ value: "Target", position: "insideTopLeft", fill: C.rust, fontSize: 11 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
      <div className="grid gap-4 xl:grid-cols-[1.3fr_1fr]">
        <Card title="Promises falling due" sub="By week, with the amount we expect to land" pad={false}>
          <table className="table w-full">
            <thead><tr><th>Days</th><th className="text-right">Promises</th><th className="text-right">Promised</th><th className="text-right">Expected</th></tr></thead>
            <tbody>{f.weeks.map((w) => (
              <tr key={w.label}><td className="num">{w.label} {shortDay(f.monthStart).split(" ")[1]}</td><td className="text-right num">{num(w.count)}</td><td className="text-right num">{inr(w.amount)}</td><td className="text-right font-medium num">{inr(w.expected)}</td></tr>
            ))}</tbody>
          </table>
        </Card>
        <Card title="How the projection is built">
          <ul className="space-y-2 text-[13px] leading-snug text-ink-2">
            <li><span className="font-medium text-ink">Recovered so far</span> this month: {inr(f.recoveredMtd)}.</li>
            <li><span className="font-medium text-ink">Promises</span> due before month-end, each weighted by how often that segment keeps its word:
              <span className="mt-1 flex flex-wrap gap-1.5">{f.keepRates.map((k) => <span key={k.segment} className="rounded bg-sunk px-1.5 py-0.5 text-[12px] num">{k.segment} {k.rate.toFixed(0)}%</span>)}</span>
            </li>
            <li><span className="font-medium text-ink">Baseline</span> payments without a promise: {inr(f.organicDaily)} a day for the {f.remaining} days left.</li>
            <li className="text-muted">The band assumes keep rates 10 points either side and baseline ±15%.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}

function Roll({ r }: { r: Data["roll"] }) {
  if (!r.available) return <Card title="Roll rates"><p className="text-[13px] text-muted">Add a PrevDPD column to the Borrowers sheet on the Data page to see how accounts move between DPD buckets.</p></Card>;
  const cellBg = (i: number, j: number, v: number) => {
    const a = Math.min(0.9, v / 100 + 0.08);
    if (i === j) return `rgba(22,24,28,${a * 0.18})`;
    return j < i ? `rgba(14,107,80,${a * 0.55})` : `rgba(180,35,24,${a * 0.5})`;
  };
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label="Cure rate" value={pct(r.cure)} tone="good" sub="Overdue last month, better now" href="/borrowers?roll=cured" />
        <Kpi label="Roll-forward rate" value={pct(r.rollForward)} tone="bad" sub="Slipped into a worse bucket" href="/borrowers?roll=forward" />
        <Kpi label="Stayed in bucket" value={pct(r.stable)} sub={`${num(r.total)} accounts compared`} />
      </div>
      <Card title="Bucket movement since last month" sub="Rows are last month's DPD bucket, columns are today's. Select a cell to see those borrowers.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-separate border-spacing-1 text-[13px]">
            <thead><tr><th className="label px-2 text-left">Last month ↓ / Now →</th>{r.buckets.map((b) => <th key={b} className="label px-2 text-center">{b}</th>)}<th className="label px-2 text-right">Accounts</th></tr></thead>
            <tbody>
              {r.buckets.map((from, i) => (
                <tr key={from}>
                  <th className="px-2 text-left font-medium">{from}</th>
                  {r.buckets.map((to, j) => (
                    <td key={to} className="p-0">
                      <Link href={`/borrowers?prev=${encodeURIComponent(from)}&bucket=${encodeURIComponent(to)}`}
                        className="block rounded px-2 py-3 text-center hover:outline hover:outline-2 hover:outline-ink" style={{ background: cellBg(i, j, r.pct[i][j]) }}>
                        <span className="block text-[15px] font-semibold num">{r.pct[i][j].toFixed(0)}%</span>
                        <span className="block text-[11.5px] text-ink-2 num">{num(r.matrix[i][j])}</span>
                      </Link>
                    </td>
                  ))}
                  <td className="px-2 text-right num text-muted">{num(r.rowTotals[i])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-[12px] text-muted">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: "rgba(14,107,80,.45)" }} />Cured or improved</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: "rgba(22,24,28,.12)" }} />No change</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ background: "rgba(180,35,24,.4)" }} />Rolled forward</span>
        </div>
      </Card>
      <Card title="Roll-forward by product" pad={false}>
        <table className="table w-full">
          <thead><tr><th>Product</th><th className="text-right">Accounts</th><th className="text-right">Rolled forward</th><th className="text-right">Cured</th></tr></thead>
          <tbody>{r.products.map((p) => (
            <tr key={p.name}><td className="font-medium">{p.name}</td><td className="text-right num">{num(p.n)}</td>
              <td className="text-right num"><span className={p.rollForward > r.rollForward ? "font-semibold text-bad" : ""}>{pct(p.rollForward)}</span></td>
              <td className="text-right num">{pct(p.cure)}</td></tr>
          ))}</tbody>
        </table>
      </Card>
    </>
  );
}

function GroupTable({ rows, label, param }: { rows: Data["stages"]; label: string; param?: string }) {
  return (
    <Card title={`By ${label.toLowerCase()}`} pad={false}>
      <div className="overflow-x-auto">
        <table className="table w-full">
          <thead><tr><th>{label}</th><th className="text-right">Assigned</th><th className="text-right">Contacted</th><th className="text-right">PTP</th><th className="text-right">Recovered</th><th className="text-right">Outstanding</th><th className="text-right">Recovered ₹</th><th className="text-right">Contact rate</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.name}>
              <td className="font-medium">{param ? <Link className="hover:text-brand hover:underline" href={`/borrowers?${param}=${encodeURIComponent(r.name)}`}>{r.name}</Link> : r.name}</td>
              <td className="text-right num">{num(r.assigned)}</td><td className="text-right num">{num(r.contacted)}</td><td className="text-right num">{num(r.ptp)}</td>
              <td className="text-right num">{num(r.recovered)}</td><td className="text-right num">{inr(r.outstanding)}</td><td className="text-right num">{inr(r.recoveredAmount)}</td>
              <td className="text-right num">{r.assigned ? <Badge>{pct((r.contacted / r.assigned) * 100, 0)}</Badge> : "–"}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </Card>
  );
}
