"use client";
import { useEffect, useRef, useState } from "react";
import { CalendarClock, Copy, Eye, IndianRupee, Link2, Mail, MessageCircle, MessageSquare, MessageSquareWarning, Phone, Siren, X } from "lucide-react";
import { computeBorrowerProfile, type TimelineItem } from "@/lib/metrics";
import { ESCALATION_REASONS, GRIEVANCE_CATEGORIES, GRIEVANCE_SLA_DAYS } from "@/lib/mock";
import { REVEAL_REASONS, can } from "@/lib/roles";
import { dt, inrFull } from "@/lib/format";
import { useApp } from "./ctx";
import { localStore } from "./local";
import { Badge } from "./ui";
import { post } from "./useApi";

type Profile = NonNullable<ReturnType<typeof computeBorrowerProfile>>;
const KIND_ICON = { call: Phone, whatsapp: MessageCircle, sms: MessageSquare, email: Mail, payment: IndianRupee, escalation: Siren, followup: CalendarClock };
const FILTERS = ["All", "Calls", "WhatsApp", "SMS", "Email", "Other"] as const;
const inFilter = (t: TimelineItem, f: (typeof FILTERS)[number]) =>
  f === "All" || (f === "Calls" && t.kind === "call") || (f === "WhatsApp" && t.kind === "whatsapp") || (f === "SMS" && t.kind === "sms") ||
  (f === "Email" && t.kind === "email") || (f === "Other" && ["payment", "escalation", "followup"].includes(t.kind));
const tier = (s: number) => (s >= 750 ? "Prime" : s >= 650 ? "Near-prime" : "Subprime");

export default function BorrowerDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { user, scope, version, bump } = useApp();
  const [p, setP] = useState<Profile | null>(null);
  const [missing, setMissing] = useState(false);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const [panel, setPanel] = useState<null | "reveal" | "followup" | "escalate" | "complaint">(null);
  const [revealed, setRevealed] = useState<{ phone: string; until: number } | null>(null);
  const [, setTick] = useState(0);
  const [msg, setMsg] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/borrowers/${encodeURIComponent(id)}?v=${version}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? r.json() : r.status === 404 ? null : Promise.reject()))
      .catch(() => computeBorrowerProfile(localStore(), id, scope))
      .then((data) => { if (!live) return; setP(data); setMissing(!data); });
    return () => { live = false; };
  }, [id, version, scope]);

  useEffect(() => { setRevealed(null); setPanel(null); setFilter("All"); setMsg(""); closeRef.current?.focus(); }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => {
    if (!revealed) return;
    const t = setInterval(() => { if (Date.now() > revealed.until) setRevealed(null); else setTick((n) => n + 1); }, 1000);
    return () => clearInterval(t);
  }, [revealed]);

  const b = p?.borrower;
  const act = async (url: string, body: object, done: string) => {
    const r = await post(url, body);
    setMsg(r.ok ? done : r.json.error ?? "That didn't go through.");
    setPanel(null);
    if (r.ok) bump();
    return r;
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={b ? `Borrower ${b.name}` : "Borrower"}>
      <button className="absolute inset-0 bg-[#101714]/35" aria-label="Close borrower panel" onClick={onClose} />
      <div className="relative flex h-full w-[680px] max-w-full flex-col bg-ground shadow-[-16px_0_40px_rgba(16,23,20,.18)]">
        <div className="flex items-start gap-3 border-b border-line bg-surface px-5 py-4">
          <div className="min-w-0 flex-1">
            {b ? (
              <>
                <h2 className="text-[19px] font-semibold tracking-tight">{b.name}</h2>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
                  <button className="inline-flex items-center gap-1 font-mono text-ink-2 hover:text-ink" onClick={() => navigator.clipboard?.writeText(b.loanId)} title="Copy loan ID">{b.loanId}<Copy size={12} aria-hidden="true" /></button>
                  <span>{b.product}</span><span>{b.portfolio}</span><span>{b.segment}</span><span className="num">DPD {b.dpd}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge>{b.disposition}</Badge><Badge>{b.paymentLink}</Badge>
                  <span className="rounded bg-sunk px-1.5 py-0.5 text-[11.5px] font-medium text-ink-2">{b.language}</span>
                  {b.disposition === "Dispute" && <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[11.5px] font-medium text-warn">Outreach paused</span>}
                  {b.dnd && <span className="rounded bg-bad-soft px-1.5 py-0.5 text-[11.5px] font-medium text-bad">Do not call</span>}
                  {!b.waConsent && <span className="rounded bg-warn-soft px-1.5 py-0.5 text-[11.5px] font-medium text-warn">No WhatsApp opt-in</span>}
                </div>
              </>
            ) : <div className="h-14 text-[13px] text-muted">{missing ? "This borrower isn't in your view." : "Loading…"}</div>}
          </div>
          <button ref={closeRef} className="btn btn-ghost h-9 w-9 px-0" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </div>

        {p && b && (
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3">
              <Phone size={15} className="text-muted" aria-hidden="true" />
              <span className="font-mono text-[14px] num">{revealed ? revealed.phone : b.phone}</span>
              {revealed && <span className="text-[12px] text-muted num">Hides in {Math.max(0, Math.ceil((revealed.until - Date.now()) / 1000))}s · logged to the audit trail</span>}
              {!revealed && can(user.role, "revealPii") && (
                <button className="btn ml-auto min-h-8" onClick={() => setPanel(panel === "reveal" ? null : "reveal")}><Eye size={14} aria-hidden="true" />Reveal number</button>
              )}
              {panel === "reveal" && (
                <form className="flex w-full flex-wrap items-center gap-2" onSubmit={async (e) => {
                  e.preventDefault();
                  const reason = new FormData(e.currentTarget).get("reason") as string;
                  const r = await post("/api/pii/reveal", { borrowerId: b.id, reason });
                  if (r.ok) setRevealed({ phone: r.json.phone, until: Date.now() + r.json.expiresInSec * 1000 }); else setMsg(r.json.error ?? "Couldn't reveal the number.");
                  setPanel(null);
                }}>
                  <label className="text-[12.5px] text-muted" htmlFor="reveal-reason">Reason</label>
                  <select id="reveal-reason" name="reason" className="input flex-1" required defaultValue="">
                    <option value="" disabled>Choose why you need it</option>
                    {REVEAL_REASONS.map((r) => <option key={r}>{r}</option>)}
                  </select>
                  <button className="btn btn-primary">Reveal for 30s</button>
                </form>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {[
                ["Outstanding", inrFull(b.outstanding)], ["EMI", inrFull(b.emi)], ["Experian", `${b.experian}`],
                ["Answered", `${p.stats.answered} of ${p.stats.attempts}`], ["Avg talk", `${Math.floor(p.stats.avgTalkSec / 60)}:${String(Math.round(p.stats.avgTalkSec % 60)).padStart(2, "0")}`],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-line bg-surface px-3 py-2.5">
                  <div className="label">{k}</div>
                  <div className="mt-1 text-[15px] font-semibold num">{v}</div>
                  {k === "Experian" && <div className="mt-0.5"><Badge>{tier(b.experian)}</Badge></div>}
                </div>
              ))}
            </div>

            <section className="rounded-lg border border-line bg-surface p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-[14px] font-semibold">Next time you reach out</h3>
                <span className="text-[12px] text-muted num">From {p.stats.attempts} calls and {p.stats.touches} messages</span>
              </div>
              <ol className="mt-2.5 space-y-2">
                {p.playbook.map((line, i) => (
                  <li key={i} className="flex gap-2.5 text-[13.5px] leading-snug">
                    <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded bg-sunk text-[11px] font-semibold text-ink-2 num">{i + 1}</span>{line}
                  </li>
                ))}
              </ol>
            </section>

            <div className="grid gap-4 sm:grid-cols-2">
              <section className="rounded-lg border border-line bg-surface p-4">
                <h3 className="text-[14px] font-semibold">When they pick up</h3>
                <p className="text-[12px] text-muted">Voice calls answered, by time of day (IST)</p>
                <div className="mt-3 space-y-1.5">
                  {p.bands.map((x) => (
                    <div key={x.band} className="grid grid-cols-[44px_1fr_44px] items-center gap-2 text-[12px]">
                      <span className="text-muted num">{x.band}</span>
                      <div className="h-3.5 rounded-sm bg-sunk">
                        <div className={`h-3.5 rounded-sm ${x.band === p.bestBand ? "bg-brand" : "bg-[#a8cdbd]"}`} style={{ width: `${x.attempts ? Math.max(4, x.rate) : 0}%` }} />
                      </div>
                      <span className="text-right num">{x.attempts ? `${x.answered}/${x.attempts}` : "–"}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[12px] text-muted num">Weekdays {p.stats.weekdayRate.toFixed(0)}% · Weekends {p.stats.weekendRate.toFixed(0)}%{p.stats.lastAnswered ? ` · Last answered ${dt(p.stats.lastAnswered)}` : ""}</p>
              </section>
              <section className="rounded-lg border border-line bg-surface p-4">
                <h3 className="text-[14px] font-semibold">How each channel lands</h3>
                <p className="text-[12px] text-muted">Share of touches that got a response</p>
                <div className="mt-3 space-y-2.5">
                  {p.channelStats.map((c) => (
                    <div key={c.channel}>
                      <div className="flex justify-between text-[12.5px]"><span className="font-medium">{c.channel}</span><span className="text-muted num">{c.engaged} of {c.sent} {c.label}</span></div>
                      <div className="mt-1 h-1.5 rounded-full bg-sunk"><div className="h-1.5 rounded-full bg-ink" style={{ width: `${c.rate}%` }} /></div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <section className="rounded-lg border border-line bg-surface">
              <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
                <h3 className="text-[14px] font-semibold">History</h3>
                <div className="seg" role="group" aria-label="Filter history">
                  {FILTERS.map((f) => <button key={f} className="min-h-8 px-2.5 text-[12px]" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f}</button>)}
                </div>
              </div>
              <ol className="mt-3 px-4 pb-2">
                {p.timeline.filter((t) => inFilter(t, filter)).slice(0, 60).map((t, i) => {
                  const Icon = KIND_ICON[t.kind];
                  return (
                    <li key={i} className="relative flex gap-3 pb-4 pl-0">
                      <span className={`relative z-10 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${t.kind === "escalation" ? "border-bad/30 bg-bad-soft text-bad" : t.good ? "border-brand/25 bg-brand-soft text-brand" : "border-line bg-sunk text-muted"}`}>
                        <Icon size={13} aria-hidden="true" />
                      </span>
                      <div className="min-w-0 flex-1 border-b border-line pb-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                          <span className="text-[13px] font-medium">{t.title}</span>
                          <span className="text-[11.5px] text-muted num">{dt(t.ts)}</span>
                        </div>
                        <div className="mt-0.5 text-[12.5px] text-muted">{t.detail}</div>
                        {t.status && t.kind !== "call" && <div className="mt-1"><Badge>{t.status}</Badge></div>}
                      </div>
                    </li>
                  );
                })}
                {!p.timeline.some((t) => inFilter(t, filter)) && <li className="py-6 text-center text-[13px] text-muted">Nothing on this channel yet.</li>}
              </ol>
            </section>
          </div>
        )}

        {b && user.role !== "client" && (
          <div className="border-t border-line bg-surface px-5 py-3">
            {msg && <p className="mb-2 text-[12.5px] text-ink-2" role="status">{msg}</p>}
            {panel === "followup" && (
              <form className="mb-3 flex flex-wrap items-end gap-2" onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                const at = new Date(`${fd.get("at")}:00+05:30`).toISOString();
                await act("/api/followups", { borrowerId: b.id, at, note: fd.get("note") }, "Follow-up added to the calendar.");
              }}>
                <label className="text-[12px] text-muted">When (IST)<input name="at" type="datetime-local" required className="input mt-1 block" /></label>
                <label className="min-w-40 flex-1 text-[12px] text-muted">Note<input name="note" className="input mt-1 block w-full" placeholder="e.g. Call after salary credit" /></label>
                <button className="btn btn-primary">Save</button>
              </form>
            )}
            {panel === "escalate" && (
              <form className="mb-3 flex flex-wrap items-end gap-2" onSubmit={async (e) => {
                e.preventDefault();
                await act("/api/borrowers", { id: b.id, action: "escalate", reason: new FormData(e.currentTarget).get("reason") }, "Escalated. The human desk has been notified.");
              }}>
                <label className="min-w-48 flex-1 text-[12px] text-muted">Reason
                  <select name="reason" className="input mt-1 block w-full" required defaultValue="">
                    <option value="" disabled>Choose a reason</option>
                    {ESCALATION_REASONS.map((r) => <option key={r}>{r}</option>)}
                  </select>
                </label>
                <button className="btn btn-danger">Escalate</button>
              </form>
            )}
            {panel === "complaint" && (
              <form className="mb-3 grid gap-2" onSubmit={async (e) => {
                e.preventDefault();
                const fd = new FormData(e.currentTarget);
                await act("/api/grievances", { borrowerId: b.id, category: fd.get("category"), detail: fd.get("detail") }, `Complaint logged. It must be resolved within ${GRIEVANCE_SLA_DAYS} days.`);
              }}>
                <label className="text-[12px] text-muted">Category
                  <select name="category" className="input mt-1 block w-full" required defaultValue="">
                    <option value="" disabled>Choose a category</option>
                    {GRIEVANCE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </select>
                </label>
                <label className="text-[12px] text-muted">What happened
                  <textarea name="detail" required minLength={5} maxLength={1000} rows={3} className="input mt-1 block w-full" placeholder="Describe the complaint in the borrower's words" />
                </label>
                <div><button className="btn btn-primary">Log complaint</button></div>
              </form>
            )}
            <div className="flex flex-wrap gap-2">
              {can(user.role, "grievance") && (
                <button className="btn" aria-expanded={panel === "complaint"} onClick={() => setPanel(panel === "complaint" ? null : "complaint")}><MessageSquareWarning size={14} aria-hidden="true" />Log complaint</button>
              )}
              {can(user.role, "sendLink") && b.disposition !== "Paid" && (
                <button className="btn btn-primary" onClick={() => act("/api/borrowers", { id: b.id, action: "sendLink" }, "Payment link sent on WhatsApp.")}><Link2 size={14} aria-hidden="true" />Send payment link</button>
              )}
              {can(user.role, "followup") && <button className="btn" aria-expanded={panel === "followup"} onClick={() => setPanel(panel === "followup" ? null : "followup")}><CalendarClock size={14} aria-hidden="true" />Schedule follow-up</button>}
              {can(user.role, "escalate") && b.disposition !== "Escalated" && b.disposition !== "Paid" && (
                <button className="btn" aria-expanded={panel === "escalate"} onClick={() => setPanel(panel === "escalate" ? null : "escalate")}><Siren size={14} aria-hidden="true" />Escalate to human</button>
              )}
              {b.disposition === "Escalated" && <a className="btn" href={`/api/escalations/file?ids=${b.id}`}>Escalation file</a>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
