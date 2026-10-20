"use client";
import { useEffect, useRef, useState } from "react";
import { Clock, Eye, Headset, Mic, MicOff, Pause, Phone, PhoneOff, Play, Send, Sparkles } from "lucide-react";
import { post, useApi } from "@/components/useApi";
import { Badge, Card, Empty, ErrorNote, Loading } from "@/components/ui";
import { REVEAL_REASONS } from "@/lib/roles";
import type { Borrower, WaMessage, WaTemplate } from "@/lib/types";
import type { TimelineItem } from "@/lib/metrics";

interface QueueItem {
  kind: "escalation" | "callback"; borrowerId: string; loanId: string; name: string; product: string; portfolio: string; reason: string;
  at?: string; waitingHours?: number; overdue: boolean; status?: string; owner?: string; mine?: boolean; outstanding: number; campaigns: string[]; followUpId?: string;
}
interface Queue { escalations: QueueItem[]; callbacks: QueueItem[]; scopedToCampaigns: boolean; campaigns: string[] | null }
interface Workspace {
  borrower: Borrower; risk: "High" | "Medium" | "Low"; summary: string[] | null; handoff: { status: string; owner?: string; mode?: string } | null; campaigns: string[];
  intent: { label: string; value: string; source: string; tone?: "good" | "warn" | "bad" }[];
  playbook: string[]; timeline: TimelineItem[]; whatsapp: WaMessage[]; canCall: boolean; callBlockedReason: string | null;
  stats: { attempts: number; answered: number; answerRate: number; promises: number; touches: number };
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

export default function CallDeskPage() {
  const { data: queue, error, reload, setData: setQueue } = useApi<Queue>("/api/calldesk", () => ({ escalations: [], callbacks: [], scopedToCampaigns: false, campaigns: null }), 15000);
  const [selected, setSelected] = useState<string | null>(null);
  const [logged, setLogged] = useState<{ id: string; name: string } | null>(null);
  if (error) return <ErrorNote text={error} />;
  if (!queue) return <Loading rows={3} />;
  const all = [...queue.escalations, ...queue.callbacks];
  const current = selected ?? all[0]?.borrowerId ?? null;
  const next = all.find((x) => x.borrowerId !== current);

  return (
    <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
      <div className="space-y-3">
        {queue.scopedToCampaigns && (
          <p className="rounded-md bg-sunk px-3 py-2 text-[12px] text-ink-2">
            Showing borrowers from campaigns that use telecallers: {queue.campaigns?.length ? queue.campaigns.join(", ") : "none running right now"}.
          </p>
        )}
        <QueueList title="Escalations" sub="Handed over by the AI agents" items={queue.escalations} current={current} onPick={setSelected} />
        <QueueList title="Call-backs due today" sub="Borrowers who asked to be called back" items={queue.callbacks} current={current} onPick={setSelected} />
      </div>
      <div className="min-w-0 space-y-3">
        {logged && logged.id === current && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-good/30 bg-good-soft px-3 py-2 text-[13px] text-good" role="status">
            <span>Call logged for {logged.name}.</span>
            {next && <button className="btn min-h-8" onClick={() => { setLogged(null); setSelected(next.borrowerId); }}>Next in queue: {next.name} →</button>}
          </div>
        )}
        {current ? <CallScreen key={current} borrowerId={current} onLogged={(q, name) => { setSelected(current); setLogged({ id: current, name }); setQueue(q); reload(); }} />
          : <Card><Empty title="Nothing to call right now">Escalations and due call-backs from your campaigns appear here.</Empty></Card>}
      </div>
    </div>
  );
}

function QueueList({ title, sub, items, current, onPick }: { title: string; sub: string; items: QueueItem[]; current: string | null; onPick: (id: string) => void }) {
  return (
    <Card pad={false} title={`${title} (${items.length})`} sub={sub}>
      <ul className="max-h-[360px] divide-y divide-line overflow-y-auto">
        {items.map((x) => (
          <li key={`${x.kind}-${x.borrowerId}-${x.followUpId ?? ""}`}>
            <button onClick={() => onPick(x.borrowerId)} className={`w-full px-4 py-2.5 text-left hover:bg-sunk/50 ${current === x.borrowerId ? "bg-brand-soft" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[13px] font-medium">{x.name}</span>
                {x.overdue && <span className="shrink-0 rounded bg-bad-soft px-1.5 py-0.5 text-[11px] font-medium text-bad">{x.kind === "escalation" ? "Past SLA" : "Overdue"}</span>}
              </div>
              <div className="truncate text-[12px] text-muted">{x.reason}</div>
              <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11.5px] text-muted">
                <span>{x.product} · {inr(x.outstanding)}</span>
                <span>{x.kind === "escalation" ? `waiting ${x.waitingHours}h${x.owner ? ` · ${x.mine ? "yours" : x.owner}` : ""}` : when(x.at)}</span>
              </div>
            </button>
          </li>
        ))}
        {!items.length && <li className="px-4 py-5 text-center text-[12.5px] text-muted">None.</li>}
      </ul>
    </Card>
  );
}

function CallScreen({ borrowerId, onLogged }: { borrowerId: string; onLogged: (q: Queue, name: string) => void }) {
  const { data: w, error, setData } = useApi<Workspace | null>(`/api/calldesk?id=${borrowerId}`, () => null);
  if (error) return <ErrorNote text={error} />;
  if (!w) return <Loading rows={4} />;
  const b = w.borrower;
  return (
    <div className="space-y-4">
      <section className="card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[18px] font-semibold">{b.name}</h2>
              <span className={`rounded px-1.5 py-0.5 text-[11.5px] font-medium ${RISK[w.risk]}`}>{w.risk} risk</span>
              <Badge>{b.disposition}</Badge>
              {w.handoff && <span className="rounded bg-sunk px-1.5 py-0.5 text-[11.5px] text-ink-2">{w.handoff.status}{w.handoff.owner ? ` · ${w.handoff.owner}` : ""}</span>}
            </div>
            <div className="mt-1 text-[12.5px] text-muted">{b.loanId} · {b.product} · {b.portfolio} · speaks {b.language}{w.campaigns.length ? ` · ${w.campaigns.join(", ")}` : ""}</div>
          </div>
          <dl className="grid grid-cols-4 gap-4 text-right">
            {[["Outstanding", inr(b.outstanding)], ["EMI", inr(b.emi)], ["Days late", String(b.dpd)], ["Calls answered", `${w.stats.answered}/${w.stats.attempts}`]].map(([k, v]) => (
              <div key={k}><dt className="text-[11px] uppercase tracking-wide text-muted">{k}</dt><dd className="text-[15px] font-semibold num">{v}</dd></div>
            ))}
          </dl>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11.5px]">
          <span className={`rounded px-1.5 py-0.5 ${b.dnd ? "bg-bad-soft text-bad" : "bg-sunk text-ink-2"}`}>{b.dnd ? "Do not call" : "Calls allowed"}</span>
          <span className={`rounded px-1.5 py-0.5 ${b.waConsent ? "bg-good-soft text-good" : "bg-sunk text-ink-2"}`}>{b.waConsent ? "WhatsApp opt-in" : "No WhatsApp opt-in"}</span>
          {b.ptpDate && <span className="rounded bg-info-soft px-1.5 py-0.5 text-info">Promise {inr(b.ptpAmount ?? b.emi)} by {when(b.ptpDate).split(",")[0]}</span>}
        </div>
      </section>

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,420px)_1fr]">
        <div className="space-y-4">
          <Dialer w={w} onLogged={(r) => { setData(r.workspace); onLogged(r.queue, b.name); }} />
          {w.summary && (
            <Card title={<span className="inline-flex items-center gap-1.5"><Sparkles size={15} className="text-brand" aria-hidden="true" />Escalation summary</span>} sub="Written by the AI agent when it handed over">
              <ul className="space-y-1.5 text-[13px]">{w.summary.map((l) => <li key={l} className="leading-relaxed">{l}</li>)}</ul>
            </Card>
          )}
          <Card title="What they've told us" sub="Intent and facts collected on earlier calls and messages">
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
          <WhatsAppTool w={w} />
        </div>
        <div className="space-y-4">
          <Card title="Talk track" sub="Suggested from how this borrower has responded so far">
            <ol className="list-decimal space-y-1.5 pl-5 text-[13px] leading-relaxed">{w.playbook.map((p) => <li key={p}>{p}</li>)}</ol>
          </Card>
          <Card pad={false} title="Contact history" sub={`${w.timeline.length} events: calls, messages, promises, payments`}>
            <ol className="max-h-[560px] divide-y divide-line overflow-y-auto">
              {w.timeline.map((t, i) => (
                <li key={`${t.ts}-${i}`} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium">{t.title}</span>
                    <span className="shrink-0 text-[11.5px] text-muted num">{when(t.ts)}</span>
                  </div>
                  <div className="mt-0.5 line-clamp-2 text-[12px] text-muted">{t.detail}</div>
                  {t.status && <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[11px] ${t.good ? "bg-good-soft text-good" : "bg-sunk text-ink-2"}`}>{t.status}</span>}
                </li>
              ))}
              {!w.timeline.length && <li className="px-4 py-5 text-center text-[12.5px] text-muted">No contact yet.</li>}
            </ol>
          </Card>
        </div>
      </div>
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
    if (outcome === "callback") body.date = new Date(`${cbAt}:00+05:30`).toISOString();
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
            {outcome === "callback" && <label className="block text-[12px] text-muted">Call back at (IST)<input type="datetime-local" className="input mt-1 block w-56" value={cbAt} onChange={(e) => setCbAt(e.target.value)} /></label>}
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
