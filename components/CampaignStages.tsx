"use client";
import Link from "next/link";
import { CheckCircle2, Circle, CircleDot, Copy, Download } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApi } from "./useApi";
import { C, Card, Empty, Kpi, Loading, axisProps, tooltipStyle } from "./ui";
import type { campaignDetail } from "@/lib/campaigns";
import { TIER_PLAYBOOK, type RiskTier } from "@/lib/portfolio";
import { TONES } from "@/lib/prompts";
import { d, dt, inr, num, shortDay } from "@/lib/format";
import type { Campaign, CampaignStatus } from "@/lib/types";

export type Stage = "Before" | "During" | "After";
export const stageFor = (s: CampaignStatus): Stage => (s === "Running" || s === "Paused" ? "During" : s === "Completed" ? "After" : "Before");
type Detail = ReturnType<typeof campaignDetail>;
type CampaignLike = Omit<Campaign, "members"> & { memberCount: number; audienceSize: number };
interface DetailResponse { detail: Detail; plan: { tiers: Record<RiskTier, number>; accounts: number } }

const STAGES: { key: Stage; title: string; hint: string }[] = [
  { key: "Before", title: "Before", hint: "Goal, agent, workflow, audience, checks" },
  { key: "During", title: "During", hint: "Live progress, channels, escalations" },
  { key: "After", title: "After", hint: "Results, cost, learnings, report" },
];

export function StageBar({ stage, status, onChange }: { stage: Stage; status: CampaignStatus; onChange: (s: Stage) => void }) {
  const at = STAGES.findIndex((s) => s.key === stageFor(status));
  return (
    <nav aria-label="Campaign stage" className="grid grid-cols-3 gap-2">
      {STAGES.map((s, i) => {
        const Icon = i < at ? CheckCircle2 : i === at ? CircleDot : Circle;
        return (
          <button key={s.key} onClick={() => onChange(s.key)} aria-current={stage === s.key ? "step" : undefined}
            className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-left ${stage === s.key ? "border-ink bg-surface" : "border-line bg-surface/60 hover:border-line-strong"}`}>
            <Icon size={18} className={`mt-0.5 shrink-0 ${i < at ? "text-good" : i === at ? "text-brand" : "text-muted"}`} aria-hidden="true" />
            <span><span className="block text-[13.5px] font-semibold">{i + 1}. {s.title} the campaign</span><span className="block text-[12px] text-muted">{s.hint}</span></span>
          </button>
        );
      })}
    </nav>
  );
}

function useDetail(id: string, poll?: number) {
  return useApi<DetailResponse>(`/api/campaigns?id=${id}`, () => null as unknown as DetailResponse, poll);
}

export function GoalAndAgent({ c, data, editable, set }: {
  c: CampaignLike; editable: boolean; set: (p: Partial<CampaignLike>) => void;
  data: { prompts: { id: string; client: string; product: string; tone: string; version: number }[]; companies: string[] };
}) {
  const { data: det } = useDetail(c.id);
  const prompt = data.prompts.find((p) => p.id === c.promptId);
  const tiers = det?.plan.tiers;
  const total = tiers ? tiers.High + tiers.Medium + tiers.Low : 0;
  const lead = tiers ? (Object.entries(tiers) as [RiskTier, number][]).sort((a, b) => b[1] - a[1])[0][0] : undefined;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card title="Goal" sub="What this campaign must achieve. It feeds the company's monthly goal on Portfolio & goals.">
        <fieldset disabled={!editable} className="grid gap-3 sm:grid-cols-2">
          <label className="text-[12px] text-muted">Company
            <select className="input mt-1 block w-full" value={c.company} onChange={(e) => set({ company: e.target.value })}>
              <option>All companies</option>{data.companies.map((x) => <option key={x}>{x}</option>)}
            </select>
          </label>
          <label className="text-[12px] text-muted">Collection target (₹ lakh)
            <input type="number" min={0} step={0.5} className="input mt-1 block w-full" value={(c.target / 100000).toString()} onChange={(e) => set({ target: Math.round(Number(e.target.value) * 100000) })} />
          </label>
        </fieldset>
        {det && <p className="mt-3 text-[12.5px] text-muted">The audience today is {num(det.plan.accounts)} accounts. A target of {inr(c.target)} needs about {inr(det.plan.accounts ? c.target / det.plan.accounts : 0)} per account.</p>}
        <Link href="/portfolio" className="mt-2 inline-block text-[12.5px] text-brand hover:underline">See company goals →</Link>
      </Card>

      <Card title="Voice agent" sub="An agent is a published prompt version, plus the voice for each borrower's language, plus its tools.">
        <fieldset disabled={!editable}>
          <label className="block text-[12px] text-muted">Prompt from the Prompt Library
            <select className="input mt-1 block w-full" value={c.promptId ?? ""} onChange={(e) => set({ promptId: e.target.value || undefined })}>
              <option value="">Choose a published prompt</option>
              {data.prompts.map((p) => <option key={p.id} value={p.id}>{p.client} · {p.product} · {TONES.find((t) => t.key === p.tone)?.label} · v{p.version}</option>)}
            </select>
          </label>
        </fieldset>
        {prompt ? (
          <dl className="mt-3 grid grid-cols-2 gap-y-1 text-[12.5px]">
            <dt className="text-muted">Prompt</dt><dd>{prompt.client} v{prompt.version}</dd>
            <dt className="text-muted">Tone</dt><dd>{TONES.find((t) => t.key === prompt.tone)?.label}</dd>
            <dt className="text-muted">Voices</dt><dd>One per enabled language (Channels &amp; agents)</dd>
            <dt className="text-muted">Tools</dt><dd>Payment link, callback, escalate, transfer, WhatsApp summary</dd>
          </dl>
        ) : <p className="mt-3 text-[12.5px] text-warn">No prompt chosen. AI voice steps can&apos;t run without one.</p>}
      </Card>

      <Card title="Who you're reaching, by risk" sub="From the Portfolio risk model: bureau score, days late and payment history." className="xl:col-span-2">
        {!tiers ? <Loading rows={1} /> : (
          <div className="grid gap-3 md:grid-cols-3">
            {(["High", "Medium", "Low"] as RiskTier[]).map((t) => (
              <div key={t} className={`rounded-lg border p-3 ${t === lead ? "border-ink" : "border-line"}`}>
                <div className="flex items-baseline justify-between"><span className="font-semibold">{t} risk</span><span className="text-[12px] text-muted num">{num(tiers[t])} · {total ? ((tiers[t] / total) * 100).toFixed(0) : 0}%</span></div>
                <div className="mt-1 text-[12.5px] font-medium">{TIER_PLAYBOOK[t].channels}</div>
                <div className="text-[12px] text-muted">{TIER_PLAYBOOK[t].approach}</div>
              </div>
            ))}
          </div>
        )}
        {lead && <p className="mt-3 text-[12.5px]">Most of this audience is <b>{lead.toLowerCase()} risk</b>. Shape the workflow around: {TIER_PLAYBOOK[lead].channels.toLowerCase()}.</p>}
      </Card>
    </div>
  );
}

export function During({ campaign }: { campaign: CampaignLike }) {
  const live = campaign.status === "Running" || campaign.status === "Paused";
  const { data } = useDetail(campaign.id, live ? 10000 : undefined);
  if (campaign.status === "Draft" || campaign.status === "Scheduled")
    return <Card><Empty title={campaign.status === "Scheduled" ? `Starts ${dt(campaign.startAt)}` : "Not launched yet"}>Once it runs, this shows money collected against the target, the funnel, each channel&apos;s activity, connect rate by hour, escalations and a live feed.</Empty></Card>;
  if (!data) return <Loading />;
  const x = data.detail;
  const behind = x.collected < x.expectedByNow * 0.9;
  return (
    <>
      {campaign.status === "Paused" && <p className="rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] text-warn">Paused. Nothing goes out until you resume.</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Collected" value={inr(x.collected)} tone={behind ? "bad" : "good"} sub={`${x.attainment.toFixed(0)}% of ${inr(x.target)}`} />
        <Kpi label="Should be at" value={inr(x.expectedByNow)} sub={`${(x.elapsedShare * 100).toFixed(0)}% of the run done`} />
        <Kpi label="Promises" value={num(x.stats.promises)} sub={`${num(x.stats.reached)} borrowers reached`} />
        <Kpi label="Open escalations" value={num(x.escalations.filter((e) => e.status !== "Resolved").length)} sub="Waiting for or with telecallers" />
        <Kpi label="Spent so far" value={inr(x.cost)} sub={x.cost ? `₹${x.roi.toFixed(0)} back per ₹1` : ""} />
      </div>
      <Card title="Progress to target">
        <div className="relative h-3 rounded-full bg-sunk">
          <div className={`h-3 rounded-full ${behind ? "bg-warn" : "bg-brand"}`} style={{ width: `${Math.min(100, x.attainment)}%` }} />
          <div className="absolute top-[-4px] h-5 w-0.5 bg-ink" style={{ left: `${Math.min(100, x.elapsedShare * 100)}%` }} title="Where it should be by now" />
        </div>
        <p className="mt-2 text-[12.5px] text-muted">{behind ? "Behind pace. Consider adding an evening voice step or raising the daily cap within the rules." : "On pace for the target."}</p>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Funnel" sub="Borrowers at each stage since launch">
          <div className="space-y-2">
            {x.funnel.map((f) => (
              <div key={f.stage}>
                <div className="flex justify-between text-[12.5px]"><span>{f.stage}</span><span className="num text-muted">{num(f.value)}</span></div>
                <div className="mt-1 h-2 rounded-full bg-sunk"><div className="h-2 rounded-full bg-brand" style={{ width: `${x.funnel[0].value ? (f.value / x.funnel[0].value) * 100 : 0}%` }} /></div>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Connect rate by hour" sub="Voice and IVR calls (IST)">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={x.hours} margin={{ left: -16 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="hour" {...axisProps} interval={1} />
              <YAxis unit="%" {...axisProps} />
              <Tooltip {...tooltipStyle} formatter={(v) => [`${Number(v).toFixed(0)}%`, "Connect rate"]} cursor={{ fill: "#f1eee8" }} />
              <Bar dataKey="connectRate" fill={C.brand} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
      <ChannelTable rows={x.channels} />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card pad={false} title="Escalations from this campaign" right={<Link href="/handoffs" className="text-[12.5px] text-brand hover:underline">Escalations queue →</Link>}>
          <ul className="divide-y divide-line">
            {x.escalations.slice(0, 8).map((e) => <li key={e.id} className="flex justify-between gap-3 px-4 py-2 text-[12.5px]"><span><b>{e.name}</b> · {e.reason}</span><span className="text-muted">{e.status}</span></li>)}
            {!x.escalations.length && <li className="px-4 py-6 text-center text-[12.5px] text-muted">None yet.</li>}
          </ul>
        </Card>
        <Card pad={false} title="Live feed">
          <ul className="divide-y divide-line">
            {x.events.map((e) => <li key={e.id} className="px-4 py-2 text-[12.5px]"><div className="font-medium">{e.title}</div><div className="text-muted">{e.detail} · {dt(e.ts)}</div></li>)}
            {!x.events.length && <li className="px-4 py-6 text-center text-[12.5px] text-muted">Calls and payments from this campaign appear here as they happen.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}

function ChannelTable({ rows }: { rows: Detail["channels"] }) {
  return (
    <Card pad={false} title="By channel" sub="Attempts, responses and outcomes per channel, with estimated cost">
      <div className="overflow-x-auto">
        <table className="table w-full whitespace-nowrap">
          <thead><tr><th>Channel</th><th className="text-right">Attempts</th><th className="text-right">Reached</th><th className="text-right">Reach rate</th><th className="text-right">Promises</th><th className="text-right">Payments</th><th className="text-right">Cost</th><th className="text-right">Cost per payment</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.channel}>
                <td className="font-medium">{r.channel}</td><td className="text-right num">{num(r.attempts)}</td><td className="text-right num">{num(r.reached)}</td>
                <td className="text-right num">{r.reachRate.toFixed(0)}%</td><td className="text-right num">{num(r.promises)}</td><td className="text-right num">{num(r.payments)}</td>
                <td className="text-right num">{inr(r.cost)}</td><td className="text-right num">{r.payments ? inr(r.cost / r.payments) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function After({ campaign, canManage, onDuplicate }: { campaign: CampaignLike; canManage: boolean; onDuplicate: () => void }) {
  const { data } = useDetail(campaign.id);
  if (campaign.status === "Draft" || campaign.status === "Scheduled")
    return <Card><Empty title="No results yet">After the campaign runs, this shows collected against target, cost and return, channel and product results, what worked, and a downloadable report.</Empty></Card>;
  if (!data) return <Loading />;
  const x = data.detail;
  const final = campaign.status === "Completed";
  function report() {
    const lines = [
      ["Campaign", campaign.name], ["Status", campaign.status], ["Ran", `${d(campaign.launchedAt ?? campaign.startAt)} to ${d(campaign.endAt)}`],
      ["Target", String(x.target)], ["Collected", String(x.collected)], ["Attainment %", x.attainment.toFixed(1)], ["Cost", String(x.cost)], ["Return per ₹1", x.roi.toFixed(1)],
      [], ["Channel", "Attempts", "Reached", "Promises", "Payments", "Cost"], ...x.channels.map((r) => [r.channel, r.attempts, r.reached, r.promises, r.payments, r.cost].map(String)),
      [], ["Product", "Accounts", "Promises", "Collected"], ...x.byProduct.map((r) => [r.name, r.accounts, r.promises, r.collected].map(String)),
      [], ["What worked"], ...x.learnings.map((l) => [l]),
    ];
    const csv = lines.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: `${campaign.name.replace(/[^\w-]+/g, "-")}-report.csv` }).click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      {!final && <p className="rounded-md bg-sunk px-3 py-2 text-[12.5px] text-ink-2">Still running: these are results so far. They become final when the campaign ends on {d(campaign.endAt)}.</p>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Collected" value={inr(x.collected)} tone="good" sub={`${num(x.stats.paid)} payments`} />
        <Kpi label="Against target" value={`${x.attainment.toFixed(0)}%`} tone={x.attainment >= 100 ? "good" : x.attainment < 80 ? "bad" : undefined} sub={`Target ${inr(x.target)}`} />
        <Kpi label="Cost" value={inr(x.cost)} sub={`Channels ${inr(x.cost - x.platformCost)} + platform ${inr(x.platformCost)}`} />
        <Kpi label="Return" value={`₹${x.roi.toFixed(0)} per ₹1`} sub="Collected ÷ cost" />
        <Kpi label="Promises" value={num(x.stats.promises)} sub={`${num(x.stats.reached)} borrowers reached`} />
      </div>
      <Card title="Money collected over the run" sub="Cumulative, with the target line"
        right={<div className="flex gap-2"><button className="btn" onClick={report}><Download size={14} aria-hidden="true" />Download report</button>{canManage && <button className="btn" onClick={onDuplicate}><Copy size={14} aria-hidden="true" />Run again as a draft</button>}</div>}>
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={x.daily} margin={{ left: 0 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDay} {...axisProps} minTickGap={16} />
            <YAxis {...axisProps} tickFormatter={(v) => `₹${(Number(v) / 100000).toFixed(1)}L`} />
            <Tooltip {...tooltipStyle} labelFormatter={(l) => shortDay(String(l))} formatter={(v, n) => [inr(Number(v)), n === "cumulative" ? "Collected so far" : "Calls"]} />
            <ReferenceLine y={x.target} stroke={C.bad} strokeDasharray="4 4" label={{ value: "Target", fontSize: 11, fill: C.bad, position: "insideTopRight" }} />
            <Line dataKey="cumulative" stroke={C.brand} strokeWidth={2} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </Card>
      <Card title="What worked">
        <ol className="space-y-2">
          {x.learnings.map((l, i) => <li key={i} className="flex gap-2.5 text-[13.5px]"><span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded bg-sunk text-[11px] font-semibold text-ink-2 num">{i + 1}</span>{l}</li>)}
        </ol>
      </Card>
      <ChannelTable rows={x.channels} />
      <div className="grid gap-4 xl:grid-cols-2">
        {([["By product", x.byProduct], ["By language", x.byLanguage]] as const).map(([title, rows]) => (
          <Card key={title} pad={false} title={title}>
            <table className="table w-full">
              <thead><tr><th>{title.replace("By ", "")}</th><th className="text-right">Accounts</th><th className="text-right">Promises</th><th className="text-right">Collected</th></tr></thead>
              <tbody>{rows.map((r) => <tr key={r.name}><td>{r.name}</td><td className="text-right num">{num(r.accounts)}</td><td className="text-right num">{num(r.promises)}</td><td className="text-right num">{inr(r.collected)}</td></tr>)}</tbody>
            </table>
          </Card>
        ))}
      </div>
    </>
  );
}
