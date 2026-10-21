"use client";
import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Database, Flame, MessageCircle, PhoneForwarded, Snowflake, Sparkles, UserPlus } from "lucide-react";
import { useApp } from "@/components/ctx";
import { post, useApi } from "@/components/useApi";
import { ErrorNote, Kpi, Loading } from "@/components/ui";
import type { handoffList } from "@/lib/handoffs";
import { SLA_HOURS } from "@/lib/handoffs";
import { TEAM } from "@/lib/team";
import { can } from "@/lib/roles";
import { inr, num } from "@/lib/format";

type Item = ReturnType<typeof handoffList>[number];
type Lane = "Waiting" | "With telecaller" | "Resolved";
const LANES: { key: Lane; title: string; hint: string; tone: string }[] = [
  { key: "Waiting", title: "Waiting for a person", hint: `Handed over by the AI agents. Target: picked up within ${SLA_HOURS} hours.`, tone: "border-t-bad" },
  { key: "With telecaller", title: "With a telecaller", hint: "Taken, with or without the AI summary.", tone: "border-t-warn" },
  { key: "Resolved", title: "Resolved", hint: "Closed with an outcome.", tone: "border-t-good" },
];
const OUTCOMES = ["Promise to pay agreed", "Paid during the call", "Part-payment plan agreed", "Settlement request logged", "Dispute logged for review", "Hardship: paused for 30 days", "Could not reach"];
const REASONS: [string, RegExp][] = [["Hardship", /hardship|lost job|medical/i], ["Dispute", /dispute|paid|charges/i], ["Settlement", /settle/i], ["Asked for a person", /human|person|agent/i]];
const reasonGroup = (r: string) => REASONS.find(([, re]) => re.test(r))?.[0] ?? "Other";
const ownerName = (o?: string) => (o ? TEAM.find((t) => t.username === o)?.name ?? o : "");

export default function Handoffs() {
  const { user, openBorrower } = useApp();
  const { data, error, setData } = useApi<{ items: Item[] }>("/api/handoffs", () => ({ items: [] }), 15000);
  const [mineOnly, setMineOnly] = useState(user.role === "telecaller");
  const [reason, setReason] = useState("all");
  const [lang, setLang] = useState("all");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const canAct = can(user.role, "handoff"), canAssign = can(user.role, "assignWork");
  const items = useMemo(() => data?.items ?? [], [data]);
  const languages = useMemo(() => [...new Set(items.map((i) => i.language))].sort(), [items]);
  const rows = useMemo(() => items.filter((i) => (!mineOnly || i.mine || i.status === "Waiting") && (reason === "all" || reasonGroup(i.reason) === reason) && (lang === "all" || i.language === lang)
    && (!q || `${i.name} ${i.loanId}`.toLowerCase().includes(q.toLowerCase()))), [items, mineOnly, reason, lang, q]);
  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading rows={1} />;

  async function act(borrowerId: string, body: object, done: string) {
    const r = await post("/api/handoffs", { borrowerId, ...body });
    if (r.ok) { setData({ items: r.json.items }); setMsg(done); } else setMsg(r.json.error ?? "That didn't work.");
  }
  const waiting = items.filter((i) => i.status === "Waiting");

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Waiting for a person" value={num(waiting.length)} tone={items.some((i) => i.overdueSla) ? "bad" : undefined} sub={`${items.filter((i) => i.overdueSla).length} past the ${SLA_HOURS}-hour target`} />
        <Kpi label="With telecallers" value={num(items.filter((i) => i.status === "With telecaller").length)} sub={`${items.filter((i) => i.mine && i.status === "With telecaller").length} with you`} />
        <Kpi label="Hot transfers" value={num(items.filter((i) => i.mode === "hot").length)} sub="Sent with the AI summary" />
        <Kpi label="Resolved" value={num(items.filter((i) => i.status === "Resolved").length)} tone="good" sub="Closed with an outcome" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="seg" role="group" aria-label="Whose">
          <button aria-pressed={!mineOnly} onClick={() => setMineOnly(false)}>Everyone&apos;s</button>
          <button aria-pressed={mineOnly} onClick={() => setMineOnly(true)}>Mine and waiting</button>
        </div>
        <div className="seg" role="group" aria-label="Reason">
          {["all", ...REASONS.map(([r]) => r), "Other"].map((r) => <button key={r} aria-pressed={reason === r} onClick={() => setReason(r)}>{r === "all" ? "All reasons" : r}</button>)}
        </div>
        <select aria-label="Language" className="input" value={lang} onChange={(e) => setLang(e.target.value)}>
          <option value="all">All languages</option>{languages.map((l) => <option key={l}>{l}</option>)}
        </select>
        <input className="input w-56" placeholder="Search name or loan ID" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
        {msg && <span className="text-[12.5px] text-ink-2" role="status">{msg}</span>}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {LANES.map((lane) => {
          const list = rows.filter((i) => i.status === lane.key);
          return (
            <section key={lane.key} className={`rounded-lg border border-line border-t-4 bg-sunk/40 ${lane.tone}`}>
              <header className="px-3 pb-2 pt-3">
                <div className="flex items-baseline justify-between"><h2 className="text-[14px] font-semibold">{lane.title}</h2><span className="text-[13px] font-semibold num">{list.length}</span></div>
                <p className="text-[11.5px] text-muted">{lane.hint}</p>
              </header>
              <div className="max-h-[calc(100vh-330px)] min-h-[160px] space-y-2 overflow-y-auto px-2 pb-2">
                {list.map((i) => <EscalationCard key={i.borrowerId} i={i} me={user.username} canAct={canAct} canAssign={canAssign} act={act} open={() => openBorrower(i.borrowerId)} />)}
                {!list.length && <p className="px-2 py-6 text-center text-[12.5px] text-muted">None.</p>}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}

function EscalationCard({ i, me, canAct, canAssign, act, open }: { i: Item; me: string; canAct: boolean; canAssign: boolean; act: (id: string, body: object, done: string) => void; open: () => void }) {
  const [more, setMore] = useState(false);
  const [outcome, setOutcome] = useState("");
  const slaPct = Math.min(100, (i.waitingHours / SLA_HOURS) * 100);
  const speakers = TEAM.filter((t) => !t.lead && t.languages.includes(i.language));
  return (
    <article className={`rounded-md border bg-surface p-3 shadow-sm ${i.overdueSla ? "border-bad/40" : "border-line"}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <button className="truncate text-[13.5px] font-semibold hover:text-brand hover:underline" onClick={open}>{i.name}</button>
          <div className="truncate text-[11.5px] text-muted">{i.product} · {i.portfolio} · {i.language} · {inr(i.outstanding)} · {i.dpd} DPD</div>
        </div>
        <span className="shrink-0 rounded bg-sunk px-1.5 py-0.5 text-[11px] text-ink-2">{reasonGroup(i.reason)}</span>
      </div>
      <p className="mt-1.5 text-[12.5px] font-medium">{i.reason}</p>
      <div className="mt-2 rounded bg-brand-soft/50 px-2.5 py-2 text-[12.5px]">
        <div className="mb-0.5 inline-flex items-center gap-1 text-[11px] font-semibold text-brand"><Sparkles size={12} aria-hidden="true" />AI summary</div>
        <ul className="space-y-0.5 text-ink-2">{(more ? i.summary : i.summary.slice(-2)).map((s, k) => <li key={k}>{s}</li>)}</ul>
        <button className="mt-1 inline-flex items-center gap-0.5 text-[11.5px] text-brand" onClick={() => setMore((m) => !m)}>{more ? <>Less<ChevronUp size={12} /></> : <>Full summary<ChevronDown size={12} /></>}</button>
      </div>
      {i.status === "Waiting" && (
        <div className="mt-2">
          <div className="flex justify-between text-[11px]"><span className={i.overdueSla ? "font-medium text-bad" : "text-muted"}>Waiting {i.waitingHours < 48 ? `${i.waitingHours} h` : `${Math.round(i.waitingHours / 24)} d`}</span><span className="text-muted">Target {SLA_HOURS} h</span></div>
          <div className="mt-0.5 h-1 rounded-full bg-sunk"><div className={`h-1 rounded-full ${i.overdueSla ? "bg-bad" : "bg-warn"}`} style={{ width: `${slaPct}%` }} /></div>
        </div>
      )}
      {i.status !== "Waiting" && (
        <div className="mt-2 flex items-center gap-1.5 text-[12px] text-muted">
          {i.mode === "hot" ? <Flame size={12} className="text-bad" aria-hidden="true" /> : <Snowflake size={12} className="text-info" aria-hidden="true" />}
          {i.mode === "hot" ? `Hot${i.summarySentVia ? ` · ${i.summarySentVia}` : ""}` : "Cold"} · {i.owner === me ? "you" : ownerName(i.owner)}{i.outcome ? ` · ${i.outcome}` : ""}
        </div>
      )}
      {canAct && i.status === "Waiting" && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <button className="btn min-h-8 px-2 text-[12px] btn-primary" onClick={() => act(i.borrowerId, { action: "hot", via: "WhatsApp" }, `${i.name}: yours, with the summary on WhatsApp.`)}><MessageCircle size={13} aria-hidden="true" />Take · hot</button>
          <button className="btn min-h-8 px-2 text-[12px]" onClick={() => act(i.borrowerId, { action: "hot", via: "CRM" }, `${i.name}: yours, summary in the CRM.`)}><Database size={13} aria-hidden="true" />Hot · CRM</button>
          <button className="btn min-h-8 px-2 text-[12px]" onClick={() => act(i.borrowerId, { action: "cold" }, `${i.name}: yours, no summary sent.`)}><Snowflake size={13} aria-hidden="true" />Cold</button>
        </div>
      )}
      {canAssign && i.status !== "Resolved" && (
        <label className="mt-2 flex items-center gap-1.5 text-[12px] text-muted"><UserPlus size={13} aria-hidden="true" />Assign to
          <select className="input h-8 flex-1 text-[12px]" value="" onChange={(e) => e.target.value && act(i.borrowerId, { action: "assign", to: e.target.value }, `${i.name} assigned.`)}>
            <option value="">{speakers.length ? `${i.language} speakers…` : "Anyone…"}</option>
            {(speakers.length ? speakers : TEAM.filter((t) => !t.lead)).map((t) => <option key={t.id} value={t.id}>{t.name} · {t.languages.join(", ")}</option>)}
          </select>
        </label>
      )}
      {canAct && i.status === "With telecaller" && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {!i.mine && <button className="btn min-h-8 px-2 text-[12px]" onClick={() => act(i.borrowerId, { action: "accept" }, "Taken. It's in your queue.")}><PhoneForwarded size={13} aria-hidden="true" />Take it</button>}
          <select className="input h-8 min-w-0 flex-1 text-[12px]" value={outcome} onChange={(e) => setOutcome(e.target.value)} aria-label="Outcome">
            <option value="">Outcome…</option>{OUTCOMES.map((o) => <option key={o}>{o}</option>)}
          </select>
          <button className="btn min-h-8 px-2 text-[12px]" disabled={!outcome} onClick={() => act(i.borrowerId, { action: "resolve", outcome }, `${i.name}: resolved and logged.`)}>Resolve</button>
        </div>
      )}
      {i.campaigns.length > 0 && <div className="mt-2 truncate text-[11px] text-muted">{i.campaigns.join(", ")}</div>}
    </article>
  );
}
