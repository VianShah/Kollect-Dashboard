"use client";
// Inside a running or finished campaign: its own conversations, compliance score, grievances and escalations.
import Link from "next/link";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { useApp } from "./ctx";
import { useApi } from "./useApi";
import { Badge, Card, Empty, Kpi, Loading, Tabs } from "./ui";
import Conversations from "./Conversations";
import type { campaignCompliance, campaignConversations, campaignEscalations } from "@/lib/campaignTabs";
import { dt, dur, num } from "@/lib/format";
import type { Grievance } from "@/lib/types";

export const DETAIL_TABS = ["Overview", "Conversations", "Compliance", "Grievances", "Escalations"] as const;
export type DetailTab = (typeof DETAIL_TABS)[number];

export function CampaignTabs({ value, onChange }: { value: DetailTab; onChange: (t: DetailTab) => void; campaignId: string }) {
  return <Tabs tabs={DETAIL_TABS} value={value} onChange={onChange} />;
}

function Body({ tab, campaignId }: { tab: DetailTab; campaignId: string }) {
  if (tab === "Conversations") return <ConversationsTab id={campaignId} />;
  if (tab === "Compliance") return <ComplianceTab id={campaignId} />;
  if (tab === "Grievances") return <GrievancesTab id={campaignId} />;
  if (tab === "Escalations") return <EscalationsTab id={campaignId} />;
  return null;
}
CampaignTabs.Body = Body;

function ConversationsTab({ id }: { id: string }) {
  const { openBorrower } = useApp();
  const { data } = useApi<ReturnType<typeof campaignConversations>>(`/api/campaigns?id=${id}&tab=conversations`, () => null as never);
  if (!data) return <Loading rows={1} />;
  const t = data.totals;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Touchpoints" value={num(t.touchpoints)} sub={`${num(t.calls)} calls · ${num(t.messages)} messages`} />
        <Kpi label="Calls answered" value={num(t.connected)} sub={`${num(t.talkMinutes)} talk minutes`} />
        <Kpi label="Replies" value={num(t.replies)} sub="WhatsApp and SMS" />
        <Kpi label="Recordings" value={num(t.recordings)} sub="Linked to calls" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <Card title="By channel" sub="Touchpoints and how many reached the borrower">
          <ul className="space-y-2 text-[12.5px]">
            {data.channels.map((c) => (
              <li key={c.name}>
                <div className="flex justify-between"><span className="font-medium">{c.name}</span><span className="num text-muted">{num(c.reached)} / {num(c.touchpoints)}</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-sunk"><div className="h-1.5 rounded-full bg-brand" style={{ width: `${c.touchpoints ? (c.reached / c.touchpoints) * 100 : 0}%` }} /></div>
              </li>
            ))}
          </ul>
        </Card>
        <Card pad={false} title="Latest interactions" sub="With the AI summary of each answered call">
          <ul className="max-h-[420px] divide-y divide-line overflow-y-auto">
            {data.latest.map((x, i) => (
              <li key={i} className="flex gap-3 px-4 py-2.5 text-[12.5px]">
                <span className="w-24 shrink-0 text-muted num">{dt(x.ts)}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5"><button className="font-medium hover:text-brand hover:underline" onClick={() => openBorrower(x.loanId)}>{x.name}</button><span className="text-muted">· {x.kind}</span><Badge>{x.outcome}</Badge>{x.durationSec > 0 && <span className="text-muted num">{dur(x.durationSec)}</span>}</span>
                  <span className="block text-ink-2">{x.text || x.summary}</span>
                </span>
                {x.recording ? <a className="shrink-0 text-brand hover:underline" href={x.recording} target="_blank" rel="noopener noreferrer">Listen</a> : null}
              </li>
            ))}
            {!data.latest.length && <li className="px-4 py-8 text-center text-muted">No interactions yet.</li>}
          </ul>
        </Card>
      </div>
      <Conversations campaignId={id} clearHref="/campaigns" />
    </>
  );
}

function ComplianceTab({ id }: { id: string }) {
  const { data } = useApi<ReturnType<typeof campaignCompliance>>(`/api/campaigns?id=${id}&tab=compliance`, () => null as never);
  if (!data) return <Loading rows={1} />;
  const tone = data.score >= 95 ? "text-good" : data.score >= 85 ? "text-warn" : "text-bad";
  return (
    <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
      <Card title="Compliance score">
        <div className={`text-[48px] font-semibold leading-none num ${tone}`}>{data.score}</div>
        <p className="mt-2 text-[12.5px] text-muted">{num(data.checked)} checks across this campaign&apos;s calls and messages, {num(data.breaches)} breach{data.breaches === 1 ? "" : "es"}.</p>
        <p className="mt-2 text-[12px] text-muted">The rules are set in <Link className="text-brand hover:underline" href="/compliance">Compliance rules</Link> and are enforced before anything is sent.</p>
      </Card>
      <div className="space-y-4">
        <Card pad={false} title="Rules">
          <table className="table w-full">
            <thead><tr><th>Rule</th><th>What it means</th><th className="text-right">Checked</th><th className="text-right">Breaches</th></tr></thead>
            <tbody>
              {data.rules.map((r) => (
                <tr key={r.name}>
                  <td className="whitespace-nowrap font-medium"><span className="inline-flex items-center gap-1.5">{r.ok ? <CheckCircle2 size={14} className="text-good" aria-hidden="true" /> : <ShieldAlert size={14} className="text-bad" aria-hidden="true" />}{r.name}</span></td>
                  <td className="text-[12.5px] text-ink-2">{r.detail}</td>
                  <td className="text-right num">{num(r.checked)}</td>
                  <td className={`text-right num ${r.breaches ? "font-medium text-bad" : "text-muted"}`}>{num(r.breaches)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Active guardrails">
          <ul className="grid gap-1.5 text-[12.5px] sm:grid-cols-2">{data.guardrails.map((g) => <li key={g} className="flex gap-2"><CheckCircle2 size={14} className="mt-0.5 shrink-0 text-good" aria-hidden="true" />{g}</li>)}</ul>
        </Card>
      </div>
    </div>
  );
}

function GrievancesTab({ id }: { id: string }) {
  const { openBorrower } = useApp();
  const { data } = useApi<{ grievances: Grievance[] }>(`/api/campaigns?id=${id}&tab=grievances`, () => null as never);
  if (!data) return <Loading rows={1} />;
  const open = data.grievances.filter((g) => g.status !== "Resolved");
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Grievances" value={num(data.grievances.length)} sub="Raised by borrowers in this campaign" />
        <Kpi label="Open" value={num(open.length)} tone={open.length ? "bad" : undefined} sub={`${open.filter((g) => Date.parse(g.dueAt) < Date.now()).length} past due`} />
        <Kpi label="Resolved" value={num(data.grievances.length - open.length)} tone="good" sub="Closed with a resolution" />
      </div>
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead><tr><th>Raised</th><th>Borrower</th><th>Category</th><th>Detail</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {data.grievances.map((g) => (
                <tr key={g.id}>
                  <td className="whitespace-nowrap num">{dt(g.raisedAt)}</td>
                  <td><button className="font-medium hover:text-brand hover:underline" onClick={() => openBorrower(g.borrowerId)}>{g.name}</button><div className="font-mono text-[11.5px] text-muted">{g.loanId}</div></td>
                  <td className="text-[12.5px]">{g.category}</td>
                  <td className="max-w-[320px] text-[12.5px] text-ink-2">{g.detail}</td>
                  <td className="whitespace-nowrap num text-[12.5px]">{dt(g.dueAt)}</td>
                  <td><Badge>{g.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.grievances.length && <Empty title="No grievances">None of this campaign&apos;s borrowers has raised a complaint.</Empty>}
        </div>
      </Card>
    </>
  );
}

function EscalationsTab({ id }: { id: string }) {
  const { openBorrower } = useApp();
  const { data } = useApi<{ escalations: ReturnType<typeof campaignEscalations> }>(`/api/campaigns?id=${id}&tab=escalations`, () => null as never);
  if (!data) return <Loading rows={1} />;
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {data.escalations.map((e) => (
        <section key={e.id} className={`card p-4 ${e.overdue ? "border-bad/40" : ""}`}>
          <div className="flex items-start justify-between gap-2">
            <div><button className="text-[14px] font-semibold hover:text-brand hover:underline" onClick={() => openBorrower(e.id)}>{e.name}</button><div className="text-[12px] text-muted">{e.reason}</div></div>
            <span className="text-right"><Badge>{e.status}</Badge><div className={`mt-1 text-[11.5px] num ${e.overdue ? "font-medium text-bad" : "text-muted"}`}>{e.waitingHours} h{e.overdue ? " · past SLA" : ""}</div></span>
          </div>
          <ul className="mt-2 space-y-0.5 text-[12.5px] text-ink-2">{e.summary.map((l, i) => <li key={i}>{l}</li>)}</ul>
          {e.owner && <div className="mt-2 text-[12px] text-muted">With {e.owner}</div>}
        </section>
      ))}
      {!data.escalations.length && <Card className="lg:col-span-2"><Empty title="No escalations">No one in this campaign has asked for a person yet.</Empty></Card>}
    </div>
  );
}
