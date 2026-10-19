"use client";
import Link from "next/link";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/components/ctx";
import { post, useApi } from "@/components/useApi";
import { localStore } from "@/components/local";
import { C, Card, ErrorNote, Kpi, Loading, Offline, axisProps, tooltipStyle } from "@/components/ui";
import { computePortfolio, type RiskTier } from "@/lib/portfolio";
import { can } from "@/lib/roles";
import { inr, num } from "@/lib/format";

type Data = ReturnType<typeof computePortfolio>;
const TIER_COLOR: Record<RiskTier, string> = { High: C.bad, Medium: C.amber, Low: C.brand };
const STATUS_CLS: Record<string, string> = { "On track": "bg-good-soft text-good", "At risk": "bg-warn-soft text-warn", Behind: "bg-bad-soft text-bad" };

export default function Portfolio() {
  const { user } = useApp();
  const [company, setCompany] = useState("all");
  const { data, offline, error, reload } = useApi<Data>(`/api/portfolio?company=${encodeURIComponent(company)}`, () => computePortfolio(localStore(), company));
  const canEdit = can(user.role, "editGoals") && !offline;
  const [msg, setMsg] = useState("");
  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading />;

  async function setTarget(companyName: string, product: string, value: string) {
    const target = Number(value.replace(/[^\d.]/g, "")) * 100000;
    if (!Number.isFinite(target)) return;
    const r = await post("/api/portfolio", { company: companyName, product, target }, "PATCH");
    setMsg(r.ok ? `Goal saved for ${companyName} · ${product}.` : r.json.error ?? "Couldn't save the goal.");
    if (r.ok) reload();
  }
  const pace = (data.elapsed / data.days) * 100;

  return (
    <>
      <Offline show={offline} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg" role="group" aria-label="Company">
          <button aria-pressed={company === "all"} onClick={() => setCompany("all")}>All companies</button>
          {data.companies.map((c) => <button key={c} aria-pressed={company === c} onClick={() => setCompany(c)}>{c}</button>)}
        </div>
        <span className="text-[12px] text-muted">Day {data.elapsed} of {data.days} this month</span>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Book under collection" value={inr(data.book)} sub={`${num(data.accounts)} accounts`} />
        <Kpi label="Collected this month" value={inr(data.collectedMtd)} sub={data.target ? `${((data.collectedMtd / data.target) * 100).toFixed(0)}% of the ${inr(data.target)} goal` : "No book-level goal"} />
        <Kpi label="High-risk share" value={`${data.tiers[0].share.toFixed(0)}%`} tone={data.tiers[0].share > 35 ? "bad" : undefined} sub={`${inr(data.tiers[0].outstanding)} of the book`} />
        <Kpi label="Goals on track" value={`${data.goals.filter((g) => g.status === "On track").length} of ${data.goals.length}`} sub="At today's pace" />
      </div>

      <Card title="Book by risk" sub="Scored on bureau score, how many days late the account is, and past payments (broken promises, rolling into a worse bucket, recent payments).">
        <div className="grid gap-3 lg:grid-cols-3">
          {data.tiers.map((t) => (
            <div key={t.tier} className="rounded-lg border border-line p-4" style={{ borderTop: `3px solid ${TIER_COLOR[t.tier]}` }}>
              <div className="flex items-baseline justify-between">
                <span className="text-[14px] font-semibold">{t.tier} risk</span>
                <span className="text-[12px] text-muted num">{t.share.toFixed(0)}% of book</span>
              </div>
              <div className="mt-1 text-[24px] font-semibold num">{inr(t.outstanding)}</div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[12.5px]">
                <dt className="text-muted">Accounts</dt><dd className="text-right num">{num(t.accounts)}</dd>
                <dt className="text-muted">Avg bureau score</dt><dd className="text-right num">{t.avgBureau}</dd>
                <dt className="text-muted">Avg days late</dt><dd className="text-right num">{t.avgDpd}</dd>
                <dt className="text-muted">Broken promises</dt><dd className="text-right num">{t.brokenRate.toFixed(0)}%</dd>
                <dt className="text-muted">Collected this month</dt><dd className="text-right num">{inr(t.collectedMtd)}</dd>
              </dl>
              <div className="mt-3 rounded-md bg-sunk px-3 py-2 text-[12px]">
                <div className="font-medium">{t.channels}</div>
                <div className="text-muted">{t.approach}</div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Product portfolios" sub="Outstanding by product, split by risk">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.products.map((p) => ({ product: p.product, ...Object.fromEntries(p.mix.map((m) => [m.tier, Math.round(m.outstanding / 100000)])) }))} margin={{ left: -10 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="product" {...axisProps} />
              <YAxis {...axisProps} unit=" L" />
              <Tooltip {...tooltipStyle} formatter={(v, n) => [`₹${v} L`, `${n} risk`]} cursor={{ fill: "#f1eee8" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {(["High", "Medium", "Low"] as RiskTier[]).map((t) => <Bar key={t} dataKey={t} stackId="r" fill={TIER_COLOR[t]} isAnimationActive={false} />)}
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Channel mix" sub="Share of contacts in the last 30 days">
          <div className="space-y-2.5">
            {data.channelMix.map((c) => (
              <div key={c.channel}>
                <div className="flex justify-between text-[12.5px]"><span className="font-medium">{c.channel}</span><span className="text-muted num">{num(c.contacts)} · {c.share.toFixed(0)}%</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-sunk"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${c.share}%` }} /></div>
              </div>
            ))}
          </div>
          <Link href="/channels" className="mt-4 inline-block text-[12.5px] text-brand hover:underline">Agents and capacity →</Link>
        </Card>
      </div>

      <Card pad={false} title={`Goals for ${data.month}`} sub={canEdit ? "Set monthly collection targets per company and product. Targets are in lakh (₹ L); press Enter or click away to save." : "Monthly collection targets per company and product."}>
        <div className="overflow-x-auto">
          <table className="table w-full whitespace-nowrap">
            <thead><tr><th>Company</th><th>Product</th><th className="text-right">Target</th><th className="text-right">Collected</th><th>Progress</th><th className="text-right">Projected</th><th>Status</th></tr></thead>
            <tbody>
              {data.goals.map((g) => (
                <tr key={g.id} className={g.product === "All products" ? "bg-sunk/40 font-medium" : ""}>
                  <td>{g.company}</td><td>{g.product}</td>
                  <td className="text-right">
                    {canEdit
                      ? <span className="inline-flex items-center gap-1"><span className="text-muted">₹</span><input aria-label={`Target for ${g.company} ${g.product} in lakh`} className="input w-20 text-right" defaultValue={(g.target / 100000).toFixed(1)} key={g.target}
                          onBlur={(e) => { if (Number(e.target.value) * 100000 !== g.target) setTarget(g.company, g.product, e.target.value); }} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} /><span className="text-muted">L</span></span>
                      : <span className="num">{inr(g.target)}</span>}
                  </td>
                  <td className="text-right num">{inr(g.actual)}</td>
                  <td>
                    <div className="relative h-2 w-40 rounded-full bg-sunk">
                      <div className={`h-2 rounded-full ${g.status === "Behind" ? "bg-bad" : g.status === "At risk" ? "bg-warn" : "bg-brand"}`} style={{ width: `${Math.min(100, g.pct)}%` }} />
                      <div className="absolute top-[-3px] h-3.5 w-px bg-ink" style={{ left: `${Math.min(100, pace)}%` }} title="Where you should be today" />
                    </div>
                  </td>
                  <td className="text-right num">{inr(g.projected)}</td>
                  <td><span className={`rounded px-1.5 py-0.5 text-[11.5px] font-medium ${STATUS_CLS[g.status]}`}>{g.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {msg && <p className="px-4 pb-3 text-[12.5px] text-ink-2" role="status">{msg}</p>}
      </Card>
    </>
  );
}
