"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowRightLeft, CalendarClock, Clock, Eye, Headset, Inbox, Mic, MicOff, Pause, Phone, PhoneForwarded, PhoneOff, Play, Send, ShieldAlert, Sparkles, UserRound } from "lucide-react";
import { useApp } from "@/components/ctx";
import { post, useApi } from "@/components/useApi";
import { Badge, Card, Empty, ErrorNote, Loading, Tabs } from "@/components/ui";
import { REVEAL_REASONS, can } from "@/lib/roles";
import type { Borrower, WaMessage, WaTemplate } from "@/lib/types";
import type { TimelineItem } from "@/lib/metrics";

type Kind = "escalation" | "callback" | "allocation";
interface QueueItem {
  kind: Kind; borrowerId: string; loanId: string; name: string; product: string; portfolio: string; reason: string;
  at?: string; waitingHours?: number; overdue: boolean; status?: string; owner?: string; mine?: boolean; outstanding: number; campaigns: string[]; followUpId?: string; priority?: "High" | "Normal"; language?: string;
}
interface Person { id: string; name: string; languages: string[]; lead: boolean; me: boolean; status: "Free" | "On a call" | "Wrap-up" | "Break" | "Offline"; since: string; today: { calls: number; connected: number; promises: number } }
interface Team { people: Person[]; languages: { language: string; free: number; total: number }[]; counts: { free: number; onCall: number; wrapUp: number; away: number } }
interface Queue { escalations: QueueItem[]; callbacks: QueueItem[]; allocations: QueueItem[]; scopedToCampaigns: boolean; campaigns: string[] | null; team: Team }
interface Workspace {
  borrower: Borrower; risk: "High" | "Medium" | "Low"; summary: string[] | null; handoff: { status: string; owner?: string; mode?: string } | null; campaigns: string[];
  intent: { label: string; value: string; source: string; tone?: "good" | "warn" | "bad" }[];
  playbook: string[]; timeline: TimelineItem[]; whatsapp: WaMessage[]; canCall: boolean; callBlockedReason: string | null;
  stats: { attempts: number; answered: number; answerRate: number; promises: number; touches: number };
  told: { ts: string; channel: string; outcome: string; text: string }[];
  offers: { label: string; detail: string; status: string }[];
  owner: string;
}
type Outcome = "ptp" | "callback" | "paid" | "dispute" | "no_answer" | "wrong_number" | "resolved";
const OUTCOMES: { key: Outcome; label: string }[] = [
  { key: "ptp", label: "Promise to pay" }, { key: "callback", label: "Call back later" }, { key: "paid", label: "Paid on the call" },
  { key: "dispute", label: "Disputes the amount" }, { key: "resolved", label: "Resolved, no payment due" },
  { key: "no_answer", label: "No answer" }, { key: "wrong_number", label: "Wrong number" },
];
const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }) : "—");
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const TONE = { good: "text-good", warn: "text-warn", bad: "text-bad" } as const;
const RISK = { High: "bg-bad-soft text-bad", Medium: "bg-warn-soft text-warn", Low: "bg-good-soft text-good" } as const;
const KIND: Record<Kind, { label: string; cls: string; icon: typeof Inbox }> = {
  escalation: { label: "Escalation", cls: "bg-bad-soft text-bad", icon: ShieldAlert },
  callback: { label: "Call-back due", cls: "bg-warn-soft text-warn", icon: CalendarClock },
  allocation: { label: "Allocated", cls: "bg-info-soft text-info", icon: Inbox },
};
const DOT: Record<Person["status"], string> = { Free: "bg-good", "On a call": "bg-bad", "Wrap-up": "bg-warn", Break: "bg-muted", Offline: "bg-line-strong" };

export default function CallDeskPage() {
  const { user } = useApp();
  const lead = can(user.role, "assignWork");
  const [view, setView] = useState<"My desk" | "Team board">("My desk");
  const { data: queue, error, reload, setData: setQueue } = useApi<Queue>("/api/calldesk", () => null as unknown as Queue, 15000);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | Kind>("all");
  const [logged, setLogged] = useState<{ id: string; name: string; text: string } | null>(null);
  if (error) return <ErrorNote text={error} />;
  if (!queue) return <Loading rows={3} />;
  const all = [...queue.escalations, ...queue.callbacks, ...queue.allocations];
  const shown = filter === "all" ? all : all.filter((x) => x.kind === filter);
  const current = selected ?? shown[0]?.borrowerId ?? null;
  const item = all.find((x) => x.borrowerId === current);
  const next = shown.find((x) => x.borrowerId !== current);

  return (
    <>
      <TopBar team={queue.team} queue={queue} />
      {lead && <Tabs tabs={["My desk", "Team board"] as const} value={view} onChange={setView} />}
      {view === "Team board" ? <TeamBoard team={queue.team} /> : (
        <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)] 2xl:grid-cols-[300px_minmax(0,1fr)_280px]">
          <div className="space-y-3">
            <div className="seg flex" role="group" aria-label="Show">
              {([["all", `All ${all.length}`], ["escalation", `Escalations ${queue.escalations.length}`], ["callback", `Due ${queue.callbacks.length}`], ["allocation", `Allocated ${queue.allocations.length}`]] as const).map(([k, l]) => (
                <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)} className="flex-1 text-[12px]">{l}</button>
              ))}
            </div>
            <QueueList items={shown} current={current} onPick={(id) => { setSelected(id); setLogged(null); }} />
            {queue.scopedToCampaigns && <p className="text-[11.5px] text-muted">From campaigns that use telecallers: {queue.campaigns?.length ? queue.campaigns.join(", ") : "none running right now"}.</p>}
          </div>
          <div className="min-w-0 space-y-3">
            {logged && logged.id === current && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-good/30 bg-good-soft px-3 py-2 text-[13px] text-good" role="status">
                <span>{logged.text}</span>
                {next && <button className="btn min-h-8" onClick={() => { setLogged(null); setSelected(next.borrowerId); }}>Next: {next.name} →</button>}
              </div>
            )}
            {current && item ? <CallScreen key={current} item={item} team={queue.team} onDone={(q, text) => { setSelected(current); setLogged({ id: current, name: item.name, text }); setQueue(q); reload(); }} />
              : <Card><Empty title="Nothing to work right now">Escalations, call-backs due today and accounts allocated to you appear here.</Empty></Card>}
          </div>
          <div className="hidden 2xl:block"><Speakers team={queue.team} language={item?.language} /></div>
        </div>
      )}
    </>
  );
}

function TopBar({ team, queue }: { team: Team; queue: Queue }) {
  const me = team.people.find((p) => p.me);
  return (
    <section className="card flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-sunk"><UserRound size={17} aria-hidden="true" /></span>
        <div className="leading-tight">
          <div className="text-[13.5px] font-semibold">{me?.name ?? "Team lead view"}</div>
          <div className="flex items-center gap-1.5 text-[12px] text-muted">{me ? <><span className={`h-2 w-2 rounded-full ${DOT[me.status]}`} aria-hidden="true" />{me.status}{me.languages.length ? ` · ${me.languages.join(", ")}` : ""}</> : "Watching the whole desk"}</div>
        </div>
      </div>
      {me && <dl className="flex gap-5 text-[12px]">
        {[["Calls today", me.today.calls], ["Connected", me.today.connected], ["Promises", me.today.promises], ["In my queue", queue.escalations.length + queue.callbacks.length + queue.allocations.length]].map(([k, v]) => (
          <div key={k}><dt className="text-muted">{k}</dt><dd className="text-[16px] font-semibold num">{v}</dd></div>
        ))}
      </dl>}
      <div className="ml-auto flex flex-wrap items-center gap-3 text-[12.5px]">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-good" aria-hidden="true" /><b className="num">{team.counts.free}</b> free</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-bad" aria-hidden="true" /><b className="num">{team.counts.onCall}</b> on a call</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-warn" aria-hidden="true" /><b className="num">{team.counts.wrapUp}</b> wrap-up</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-muted" aria-hidden="true" /><b className="num">{team.counts.away}</b> away</span>
      </div>
    </section>
  );
}

function QueueList({ items, current, onPick }: { items: QueueItem[]; current: string | null; onPick: (id: string) => void }) {
  return (
    <Card pad={false}>
      <ul className="max-h-[calc(100vh-260px)] min-h-[200px] divide-y divide-line overflow-y-auto">
        {items.map((x) => {
          const k = KIND[x.kind];
          return (
            <li key={`${x.kind}-${x.borrowerId}-${x.followUpId ?? ""}`}>
              <button onClick={() => onPick(x.borrowerId)} className={`w-full px-3.5 py-2.5 text-left hover:bg-sunk/50 ${current === x.borrowerId ? "bg-brand-soft" : ""}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[13px] font-medium">{x.name}</span>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-semibold ${k.cls}`}><k.icon size={11} aria-hidden="true" />{k.label}</span>
                </div>
                <div className="truncate text-[12px] text-ink-2">{x.reason}</div>
                <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11.5px] text-muted">
                  <span>{x.product} · {inr(x.outstanding)}</span>
                  {x.kind === "escalation" && <span className={x.overdue ? "font-medium text-bad" : ""}>waiting {x.waitingHours}h{x.overdue ? " · past SLA" : ""}</span>}
                  {x.kind === "callback" && <span className={x.overdue ? "font-medium text-bad" : ""}>{x.overdue ? "overdue · " : ""}{when(x.at)}</span>}
                  {x.kind === "allocation" && x.priority === "High" && <span className="font-medium text-bad">High priority</span>}
                </div>
              </button>
            </li>
          );
        })}
        {!items.length && <li className="px-4 py-8 text-center text-[12.5px] text-muted">None.</li>}
      </ul>
    </Card>
  );
}

/** Who speaks what, who's free right now, for transfers. */
function Speakers({ team, language, onTransfer }: { team: Team; language?: string; onTransfer?: (p: Person) => void }) {
  const others = team.people.filter((p) => !p.me && !p.lead);
  const sorted = [...others].sort((a, b) => Number(!!language && b.languages.includes(language)) - Number(!!language && a.languages.includes(language)) || Number(b.status === "Free") - Number(a.status === "Free"));
  return (
    <Card pad={false} title="Language speakers" sub={language ? `Speakers of ${language} first. Transfer to someone who's free.` : "Who speaks what, and who's free."}>
      <div className="flex flex-wrap gap-1.5 px-4 pb-3">
        {team.languages.map((l) => (
          <span key={l.language} className={`rounded px-1.5 py-0.5 text-[11.5px] ${l.language === language ? "bg-brand-soft font-medium text-brand" : "bg-sunk text-ink-2"}`}>{l.language} <span className="num">{l.free}/{l.total}</span></span>
        ))}
      </div>
      <ul className="max-h-[480px] divide-y divide-line overflow-y-auto border-t border-line">
        {sorted.map((p) => {
          const speaks = !!language && p.languages.includes(language);
          return (
            <li key={p.id} className={`flex items-center gap-2 px-4 py-2 ${speaks ? "" : "opacity-70"}`}>
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[p.status]}`} title={p.status} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-medium">{p.name}</span>
                <span className="block truncate text-[11.5px] text-muted">{p.status} · {p.languages.join(", ")}</span>
              </span>
              {onTransfer && <button className="btn min-h-7 px-2 text-[12px]" disabled={p.status !== "Free"} onClick={() => onTransfer(p)} title={p.status === "Free" ? `Transfer to ${p.name}` : `${p.name} is ${p.status.toLowerCase()}`}><ArrowRightLeft size={12} aria-hidden="true" />Transfer</button>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function TeamBoard({ team }: { team: Team }) {
  return (
    <Card pad={false} title="Team board" sub="Everyone on the desk, live. Reassign work from Escalations or a campaign's allocation.">
      <div className="overflow-x-auto">
        <table className="table w-full">
          <thead><tr><th>Telecaller</th><th>Status</th><th>Languages</th><th className="text-right">Calls today</th><th className="text-right">Connected</th><th className="text-right">Promises</th></tr></thead>
          <tbody>
            {team.people.map((p) => (
              <tr key={p.id}>
                <td className="font-medium">{p.name}{p.lead && <span className="ml-1.5 text-[11.5px] text-muted">Team lead</span>}</td>
                <td><span className="inline-flex items-center gap-1.5 text-[12.5px]"><span className={`h-2 w-2 rounded-full ${DOT[p.status]}`} aria-hidden="true" />{p.status}<span className="text-muted">· since {when(p.since).split(", ")[1]}</span></span></td>
                <td className="text-[12.5px]">{p.languages.join(", ")}</td>
                <td className="text-right num">{p.today.calls}</td><td className="text-right num">{p.today.connected}</td><td className="text-right num">{p.today.promises}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CallScreen({ item, team, onDone }: { item: QueueItem; team: Team; onDone: (q: Queue, text: string) => void }) {
  const { data: w, error, setData } = useApi<Workspace | null>(`/api/calldesk?id=${item.borrowerId}`, () => null);
  const [tab, setTab] = useState<"What they've told us" | "Contact history" | "Talk track">("What they've told us");
  const [msg, setMsg] = useState<string | null>(null);
  if (error) return <ErrorNote text={error} />;
  if (!w) return <Loading rows={4} />;
  const b = w.borrower;
  const k = KIND[item.kind];
  async function transfer(to: Person | "supervisor") {
    const note = window.prompt(to === "supervisor" ? "What should the supervisor know?" : `Note for ${to.name} (optional)`) ?? null;
    if (note === null) return;
    const r = await post("/api/calldesk", to === "supervisor" ? { borrowerId: b.id, action: "toSupervisor", note } : { borrowerId: b.id, action: "transfer", to: to.id, note });
    if (r.ok) { setData(r.json.workspace); onDone(r.json.queue, `${b.name} handed to ${r.json.to} with the AI summary.`); } else setMsg(r.json.error ?? "Couldn't transfer.");
  }
  return (
    <div className="space-y-3">
      <section className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[18px] font-semibold">{b.name}</h2>
              <span className={`rounded px-1.5 py-0.5 text-[11.5px] font-medium ${RISK[w.risk]}`}>{w.risk} risk</span>
              <Badge>{b.disposition}</Badge>
            </div>
            <div className="mt-1 text-[12.5px] text-muted">{b.loanId} · {b.product} · {b.portfolio} · speaks {b.language}</div>
          </div>
          <dl className="grid grid-cols-4 gap-4 text-right">
            {[["Outstanding", inr(b.outstanding)], ["EMI", inr(b.emi)], ["Days late", String(b.dpd)], ["Answered", `${w.stats.answered}/${w.stats.attempts}`]].map(([kk, v]) => (
              <div key={kk}><dt className="text-[11px] uppercase tracking-wide text-muted">{kk}</dt><dd className="text-[15px] font-semibold num">{v}</dd></div>
            ))}
          </dl>
        </div>
        <div className={`mt-3 flex items-start gap-2 rounded-md px-3 py-2 text-[12.5px] ${k.cls}`}>
          <k.icon size={15} className="mt-px shrink-0" aria-hidden="true" />
          <span><b>Why you have this account: {k.label.toLowerCase()}.</b> {item.reason}{item.kind === "callback" && item.at ? ` · due ${when(item.at)}` : ""}{item.campaigns.length ? ` · ${item.campaigns.join(", ")}` : ""}</span>
        </div>
        {w.summary && (
          <div className="mt-3 rounded-md border border-brand/30 bg-brand-soft/60 px-3 py-2.5">
            <div className="mb-1 inline-flex items-center gap-1.5 text-[12px] font-semibold text-brand"><Sparkles size={14} aria-hidden="true" />Escalation summary from the AI agent</div>
            <ul className="space-y-0.5 text-[13px] leading-relaxed">{w.summary.map((l) => <li key={l}>{l}</li>)}</ul>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11.5px]">
          <span className={`rounded px-1.5 py-0.5 ${b.dnd ? "bg-bad-soft text-bad" : "bg-sunk text-ink-2"}`}>{b.dnd ? "Do not call" : "Calls allowed"}</span>
          <span className={`rounded px-1.5 py-0.5 ${b.waConsent ? "bg-good-soft text-good" : "bg-sunk text-ink-2"}`}>{b.waConsent ? "WhatsApp opt-in" : "No WhatsApp opt-in"}</span>
          {w.handoff && <span className="rounded bg-sunk px-1.5 py-0.5 text-ink-2">{w.handoff.status}{w.handoff.owner ? ` · ${w.handoff.owner}` : ""}</span>}
          <button className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] text-bad hover:bg-bad-soft" onClick={() => transfer("supervisor")}><PhoneForwarded size={12} aria-hidden="true" />Escalate to supervisor</button>
        </div>
        {msg && <p className="mt-2 text-[12.5px] text-bad" role="alert">{msg}</p>}
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        <Dialer w={w} onLogged={(r) => { setData(r.workspace); onDone(r.queue, `Call logged for ${b.name}.`); }} />
        <WhatsAppTool w={w} />
      </div>

      <div className="2xl:hidden"><Speakers team={team} language={b.language} onTransfer={(p) => transfer(p)} /></div>
      <div className="hidden 2xl:block"><TransferStrip team={team} language={b.language} onTransfer={(p) => transfer(p)} /></div>

      <Tabs tabs={["What they've told us", "Contact history", "Talk track"] as const} value={tab} onChange={setTab} />
      {tab === "What they've told us" && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card title="Their side" sub="Intent and facts from earlier calls and messages">
            {w.intent.length ? (
              <dl className="space-y-2.5">
                {w.intent.map((i) => (
                  <div key={i.label}>
                    <dt className="flex items-center justify-between text-[11.5px] uppercase tracking-wide text-muted"><span>{i.label}</span><span className="normal-case tracking-normal">{i.source}</span></dt>
                    <dd className={`text-[13px] ${i.tone ? TONE[i.tone] : ""}`}>{i.value}</dd>
                  </div>
                ))}
              </dl>
            ) : <p className="text-[13px] text-muted">Nothing collected yet.</p>}
          </Card>
          <div className="space-y-3">
            <Card title="What we've told them" sub="The last answered calls">
              <ul className="space-y-2 text-[12.5px]">
                {w.told.map((t, i) => <li key={i}><div className="text-[11.5px] text-muted">{when(t.ts)} · {t.channel} · {t.outcome}</div>{t.text}</li>)}
                {!w.told.length && <li className="text-muted">No answered calls yet.</li>}
              </ul>
            </Card>
            <Card title="Offers and promises">
              <ul className="space-y-1.5 text-[12.5px]">
                {w.offers.map((o) => <li key={o.label} className="flex items-start justify-between gap-2"><span><b>{o.label}</b> · {o.detail}</span><span className="shrink-0 rounded bg-sunk px-1.5 py-0.5 text-[11px] text-ink-2">{o.status}</span></li>)}
                {!w.offers.length && <li className="text-muted">No offers made.</li>}
              </ul>
            </Card>
          </div>
        </div>
      )}
      {tab === "Contact history" && (
        <Card pad={false} sub={`${w.timeline.length} events: calls, messages, promises, payments`}>
          <ol className="max-h-[560px] divide-y divide-line overflow-y-auto">
            {w.timeline.map((t, i) => (
              <li key={`${t.ts}-${i}`} className="px-4 py-2.5">
                <div className="flex items-center justify-between gap-2"><span className="text-[13px] font-medium">{t.title}</span><span className="shrink-0 text-[11.5px] text-muted num">{when(t.ts)}</span></div>
                <div className="mt-0.5 line-clamp-2 text-[12px] text-muted">{t.detail}</div>
                {t.status && <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] ${t.good ? "bg-good-soft text-good" : "bg-sunk text-ink-2"}`}>{t.status}</span>}
              </li>
            ))}
            {!w.timeline.length && <li className="px-4 py-5 text-center text-[12.5px] text-muted">No contact yet.</li>}
          </ol>
        </Card>
      )}
      {tab === "Talk track" && (
        <Card sub="Suggested from how this borrower has responded so far">
          <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed">{w.playbook.map((p) => <li key={p}>{p}</li>)}</ol>
        </Card>
      )}
    </div>
  );
}

/** On wide screens the speaker list sits on the right; this keeps a one-line transfer shortcut by the actions. */
function TransferStrip({ team, language, onTransfer }: { team: Team; language: string; onTransfer: (p: Person) => void }) {
  const free = team.people.filter((p) => !p.me && !p.lead && p.status === "Free" && p.languages.includes(language));
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md bg-sunk px-3 py-2 text-[12.5px]">
      <ArrowRightLeft size={14} aria-hidden="true" />
      <span className="text-ink-2">{free.length ? `Free ${language} speakers:` : `No ${language} speaker is free right now.`}</span>
      {free.map((p) => <button key={p.id} className="btn min-h-7 px-2 text-[12px]" onClick={() => onTransfer(p)}>Transfer to {p.name}</button>)}
    </div>
  );
}

function Dialer({ w, onLogged }: { w: Workspace; onLogged: (r: { workspace: Workspace; queue: Queue }) => void }) {
  const [state, setState] = useState<"idle" | "dialing" | "live" | "ended">("idle");
  const [secs, setSecs] = useState(0);
  const [muted, setMuted] = useState(false);
  const [held, setHeld] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);
  const [reason, setReason] = useState(REVEAL_REASONS[3]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [outcome, setOutcome] = useState<Outcome>("ptp");
  const [amount, setAmount] = useState(String(w.borrower.emi));
  const [date, setDate] = useState(new Date(Date.now() + 2 * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10));
  const [cbAt, setCbAt] = useState(new Date(Date.now() + 86_400_000 + 330 * 60_000).toISOString().slice(0, 16));
  const [cbVia, setCbVia] = useState<"Telecaller" | "AI voice" | "WhatsApp" | "IVR">(w.borrower.dnd ? "WhatsApp" : "Telecaller");
  const [note, setNote] = useState("");
  const [resolve, setResolve] = useState(w.borrower.disposition === "Escalated");
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  async function reveal() {
    const r = await post("/api/pii/reveal", { borrowerId: w.borrower.id, reason });
    if (r.ok) { setPhone(r.json.phone); setTimeout(() => setPhone(null), (r.json.expiresInSec ?? 30) * 1000); } else setMsg({ ok: false, text: r.json.error ?? "Couldn't reveal the number." });
  }
  async function dial() {
    setMsg(null);
    const r = await post("/api/calldesk", { borrowerId: w.borrower.id, action: "start" });
    if (!r.ok) { setMsg({ ok: false, text: r.json.error ?? "Can't call right now." }); return; }
    setState("dialing"); setSecs(0);
    setTimeout(() => { setState("live"); timer.current = setInterval(() => setSecs((x) => x + 1), 1000); }, 1800);
  }
  function hangUp() { if (timer.current) clearInterval(timer.current); timer.current = null; setState("ended"); setMuted(false); setHeld(false); }
  async function save() {
    const body: Record<string, unknown> = { borrowerId: w.borrower.id, action: "outcome", outcome, durationSec: secs, note, resolveEscalation: resolve };
    if (outcome === "ptp") Object.assign(body, { amount: Number(amount), date: new Date(`${date}T12:00:00+05:30`).toISOString() });
    if (outcome === "paid") body.amount = Number(amount);
    if (outcome === "callback") Object.assign(body, { date: new Date(`${cbAt}:00+05:30`).toISOString(), via: cbVia });
    const r = await post("/api/calldesk", body);
    if (r.ok) { setMsg({ ok: true, text: "Call logged." }); setState("idle"); setSecs(0); setNote(""); onLogged(r.json); }
    else setMsg({ ok: false, text: r.json.error ?? "Couldn't save the outcome." });
  }

  return (
    <Card title={<span className="inline-flex items-center gap-1.5"><Headset size={15} aria-hidden="true" />Dialer</span>} sub="Demo dialer: logs the call and its outcome. It isn't connected to a phone line yet.">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sunk px-3 py-2.5">
          <span className="font-mono text-[15px] num">{phone ?? w.borrower.phone}</span>
          {!phone && (
            <span className="flex items-center gap-1.5">
              <select className="input h-8 max-w-[190px] text-[12px]" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason to reveal">{REVEAL_REASONS.map((r) => <option key={r}>{r}</option>)}</select>
              <button className="btn min-h-8 px-2" onClick={reveal} title="Reveal the full number (logged)"><Eye size={14} aria-label="Reveal number" /></button>
            </span>
          )}
        </div>
        {!w.canCall && <p className="rounded-md bg-bad-soft px-3 py-2 text-[12.5px] text-bad">{w.callBlockedReason}</p>}

        {state === "idle" && (
          <div className="flex flex-wrap gap-2">
            <button className="btn btn-primary" disabled={!w.canCall} onClick={dial}><Phone size={14} aria-hidden="true" />Call {w.borrower.name.split(" ")[0]}</button>
            <button className="btn" onClick={() => { setOutcome("no_answer"); setState("ended"); }}>Log a missed call</button>
          </div>
        )}
        {(state === "dialing" || state === "live") && (
          <div className="rounded-lg border border-line p-3">
            <div className="flex items-center justify-between">
              <span className={`text-[13px] font-medium ${state === "live" ? "text-good" : "text-muted"}`}>{state === "dialing" ? "Ringing…" : held ? "On hold" : "Connected"}</span>
              <span className="inline-flex items-center gap-1 font-mono text-[15px] num"><Clock size={13} aria-hidden="true" />{clock(secs)}</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="btn" disabled={state !== "live"} aria-pressed={muted} onClick={() => setMuted((x) => !x)}>{muted ? <MicOff size={14} aria-hidden="true" /> : <Mic size={14} aria-hidden="true" />}{muted ? "Unmute" : "Mute"}</button>
              <button className="btn" disabled={state !== "live"} aria-pressed={held} onClick={() => setHeld((x) => !x)}>{held ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{held ? "Resume" : "Hold"}</button>
              <button className="btn bg-bad text-white hover:bg-bad/90" onClick={hangUp}><PhoneOff size={14} aria-hidden="true" />End call</button>
            </div>
          </div>
        )}
        {state === "ended" && (
          <form className="space-y-2.5 rounded-lg border border-line p-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className="text-[13px] font-medium">How did the call end?{secs ? <span className="font-normal text-muted"> · {clock(secs)}</span> : null}</div>
            <div className="flex flex-wrap gap-1.5">
              {OUTCOMES.map((o) => (
                <button key={o.key} type="button" aria-pressed={outcome === o.key} onClick={() => setOutcome(o.key)}
                  className={`rounded-full border px-2.5 py-1 text-[12.5px] ${outcome === o.key ? "border-brand bg-brand-soft font-medium text-brand" : "border-line bg-surface text-ink-2"}`}>{o.label}</button>
              ))}
            </div>
            {(outcome === "ptp" || outcome === "paid") && (
              <label className="block text-[12px] text-muted">{outcome === "ptp" ? "Promised amount (₹)" : "Amount paid (₹)"}
                <input type="number" min={1} className="input mt-1 block w-40" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
            )}
            {outcome === "ptp" && <label className="block text-[12px] text-muted">Pay by<input type="date" className="input mt-1 block w-44" value={date} onChange={(e) => setDate(e.target.value)} /></label>}
            {outcome === "callback" && <div className="flex flex-wrap gap-3">
              <label className="block text-[12px] text-muted">Reach out at (IST)<input type="datetime-local" className="input mt-1 block w-56" value={cbAt} onChange={(e) => setCbAt(e.target.value)} /></label>
              <label className="block text-[12px] text-muted">By<select className="input mt-1 block w-40" value={cbVia} onChange={(e) => setCbVia(e.target.value as typeof cbVia)}>
                {(["Telecaller", "AI voice", "WhatsApp", "IVR"] as const).map((v) => <option key={v} disabled={w.borrower.dnd && v !== "WhatsApp"}>{v}</option>)}</select></label>
            </div>}
            <textarea className="input block w-full" rows={2} maxLength={300} placeholder="Note for the next person who calls" value={note} onChange={(e) => setNote(e.target.value)} />
            {w.borrower.disposition === "Escalated" && !["no_answer", "wrong_number"].includes(outcome) && (
              <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" className="h-4 w-4" checked={resolve} onChange={(e) => setResolve(e.target.checked)} />Close the escalation</label>
            )}
            <div className="flex gap-2"><button className="btn btn-primary">Save outcome</button><button type="button" className="btn btn-ghost" onClick={() => { setState("idle"); setSecs(0); }}>Cancel</button></div>
          </form>
        )}
        {msg && <p className={`text-[12.5px] ${msg.ok ? "text-good" : "text-bad"}`} role="status">{msg.text}</p>}
      </div>
    </Card>
  );
}

function WhatsAppTool({ w }: { w: Workspace }) {
  const { data } = useApi<{ configured: boolean; templates: WaTemplate[]; mode: string } | null>("/api/whatsapp", () => null);
  const [key, setKey] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const approved = (data?.templates ?? []).filter((t) => t.status === "APPROVED");
  const t = approved.find((x) => `${x.name}|${x.language}` === key);
  async function send() {
    setMsg(null);
    const params = (t?.bodyParams ?? []).map((_, i) => [w.borrower.name.split(" ")[0], new Date().toLocaleDateString("en-IN"), w.borrower.loanId.slice(-4), inr(w.borrower.emi)][i] ?? "-");
    const r = await post("/api/whatsapp", { action: "send", mode: "template", loanId: w.borrower.loanId, template: t?.name, language: t?.language, params, headerParams: [] });
    setMsg(r.ok ? { ok: true, text: `Sent${data?.mode === "test" ? " (test mode: to the test number)" : ""}.` } : { ok: false, text: r.json.message?.error?.title ?? r.json.error ?? "Couldn't send." });
  }
  return (
    <Card title="WhatsApp" sub={w.borrower.waConsent ? "Send an approved template, for example the payment link, while you're on the call." : "No WhatsApp opt-in, so messages can't be sent."}>
      {!data ? <Loading rows={1} /> : !data.configured ? <p className="text-[13px] text-muted">WhatsApp isn&apos;t connected on this server yet.</p> : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <select className="input block w-full" value={key} disabled={!w.borrower.waConsent} onChange={(e) => setKey(e.target.value)}>
              <option value="">Choose an approved template…</option>
              {approved.map((x) => <option key={`${x.name}|${x.language}`} value={`${x.name}|${x.language}`}>{x.name} · {x.language}</option>)}
            </select>
            <button className="btn btn-primary" disabled={!t || !w.borrower.waConsent} onClick={send}><Send size={14} aria-hidden="true" />Send</button>
          </div>
          {w.whatsapp.length > 0 && (
            <ul className="max-h-40 space-y-1 overflow-y-auto text-[12px]">
              {w.whatsapp.map((m) => <li key={m.id} className={m.direction === "in" ? "text-brand" : "text-ink-2"}>{m.direction === "in" ? "They replied: " : "Sent: "}{m.text.slice(0, 120)} <span className="text-muted">· {m.status}</span></li>)}
            </ul>
          )}
          {msg && <p className={`text-[12.5px] ${msg.ok ? "text-good" : "text-bad"}`} role="status">{msg.text}</p>}
        </div>
      )}
    </Card>
  );
}
