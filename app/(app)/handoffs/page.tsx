"use client";
import { useMemo, useState } from "react";
import { Flame, MessageCircle, PhoneForwarded, Snowflake, Database, Sparkles } from "lucide-react";
import { useApp } from "@/components/ctx";
import { post, useApi } from "@/components/useApi";
import { Card, Empty, ErrorNote, Kpi, Loading } from "@/components/ui";
import type { handoffList } from "@/lib/handoffs";
import { SLA_HOURS } from "@/lib/handoffs";
import { can } from "@/lib/roles";
import { inr, num } from "@/lib/format";

type Item = ReturnType<typeof handoffList>[number];

export default function Handoffs() {
  const { user, openBorrower } = useApp();
  const { data, error, setData } = useApi<{ items: Item[] }>("/api/handoffs", () => ({ items: [] }), 15000);
  const [view, setView] = useState<"Waiting" | "Mine" | "With telecaller" | "Resolved">(user.role === "telecaller" ? "Mine" : "Waiting");
  const [openId, setOpenId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const canAct = can(user.role, "handoff");
  const items = data?.items ?? [];
  const rows = useMemo(() => items.filter((i) => (view === "Mine" ? i.mine && i.status !== "Resolved" : i.status === view)), [items, view]);
  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading rows={1} />;

  async function act(borrowerId: string, body: object, done: string) {
    const r = await post("/api/handoffs", { borrowerId, ...body });
    if (r.ok) { setData({ items: r.json.items }); setMsg(done); } else setMsg(r.json.error ?? "That didn't work.");
  }
  const sel = items.find((i) => i.borrowerId === openId) ?? rows[0];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Waiting for a person" value={num(items.filter((i) => i.status === "Waiting").length)} tone={items.some((i) => i.overdueSla) ? "bad" : undefined} sub={`${items.filter((i) => i.overdueSla).length} past the ${SLA_HOURS}-hour target`} />
        <Kpi label="With telecallers" value={num(items.filter((i) => i.status === "With telecaller").length)} sub={`${items.filter((i) => i.mine && i.status === "With telecaller").length} with you`} />
        <Kpi label="Hot transfers" value={num(items.filter((i) => i.mode === "hot").length)} sub="Sent with an AI summary" />
        <Kpi label="Resolved" value={num(items.filter((i) => i.status === "Resolved").length)} tone="good" sub="Closed with an outcome" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.25fr_1fr]">
        <Card pad={false} title="Escalation queue" sub="Cold transfer hands the borrower over as is. Hot transfer also sends the telecaller an AI summary on WhatsApp or into the CRM."
          right={<div className="seg" role="group" aria-label="Queue">{(["Waiting", "Mine", "With telecaller", "Resolved"] as const).map((v) => <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v === "Mine" ? "My queue" : v}</button>)}</div>}>
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead><tr><th>Borrower</th><th>Reason</th><th className="text-right">Outstanding</th><th>Waiting</th><th>Transfer</th></tr></thead>
              <tbody>
                {rows.map((i) => (
                  <tr key={i.borrowerId} onClick={() => setOpenId(i.borrowerId)} className={`cursor-pointer ${sel?.borrowerId === i.borrowerId ? "bg-brand-soft/60" : "hover:bg-sunk/40"}`}>
                    <td className="whitespace-nowrap"><div className="font-medium">{i.name}</div><div className="text-[11.5px] text-muted">{i.product} · {i.portfolio} · DPD {i.dpd}</div></td>
                    <td className="text-[12.5px]">{i.reason}</td>
                    <td className="whitespace-nowrap text-right num">{inr(i.outstanding)}</td>
                    <td className={`whitespace-nowrap num ${i.overdueSla ? "font-medium text-bad" : ""}`}>{i.waitingHours < 48 ? `${i.waitingHours} h` : `${Math.round(i.waitingHours / 24)} d`}</td>
                    <td className="whitespace-nowrap text-[12px]">
                      {i.mode ? <span className="inline-flex items-center gap-1">{i.mode === "hot" ? <Flame size={12} className="text-bad" aria-hidden="true" /> : <Snowflake size={12} className="text-info" aria-hidden="true" />}{i.mode === "hot" ? `Hot · ${i.summarySentVia}` : "Cold"}</span>
                        : <span className="text-muted">Suggested: {i.suggested}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <Empty title="Nothing here">{view === "Mine" ? "Escalations you take will show here." : "No escalations in this state."}</Empty>}
          </div>
        </Card>

        {sel ? (
          <Card title={sel.name} sub={`${sel.loanId} · ${sel.product} · ${sel.portfolio}`} right={<button className="btn min-h-8" onClick={() => openBorrower(sel.borrowerId)}>Borrower 360</button>}>
            <div className="rounded-md border border-line bg-sunk/50 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold"><Sparkles size={13} className="text-brand" aria-hidden="true" />AI summary</div>
              <ul className="space-y-1 text-[12.5px]">{sel.summary.map((s, k) => <li key={k}>{s}</li>)}</ul>
            </div>
            <div className="mt-3 text-[12.5px] text-muted">
              Status: <span className="font-medium text-ink">{sel.status}</span>{sel.owner ? ` · ${sel.owner === user.username ? "you" : sel.owner}` : ""}{sel.outcome ? ` · ${sel.outcome}` : ""}
            </div>
            {canAct && sel.status !== "Resolved" && (
              <div className="mt-3 space-y-3">
                {sel.status === "Waiting" && (
                  <div className="flex flex-wrap gap-2">
                    <button className="btn" onClick={() => act(sel.borrowerId, { action: "cold" }, "Cold transfer: the borrower is with you, no summary sent.")}><Snowflake size={14} aria-hidden="true" />Cold transfer</button>
                    <button className="btn btn-primary" onClick={() => act(sel.borrowerId, { action: "hot", via: "WhatsApp" }, "Hot transfer: summary sent to the telecaller on WhatsApp.")}><MessageCircle size={14} aria-hidden="true" />Hot · WhatsApp</button>
                    <button className="btn" onClick={() => act(sel.borrowerId, { action: "hot", via: "CRM" }, "Hot transfer: summary pushed to the CRM.")}><Database size={14} aria-hidden="true" />Hot · CRM</button>
                  </div>
                )}
                {sel.status === "With telecaller" && !sel.mine && <button className="btn" onClick={() => act(sel.borrowerId, { action: "accept" }, "Taken. It's in your queue.")}><PhoneForwarded size={14} aria-hidden="true" />Take it</button>}
                {sel.status === "With telecaller" && (
                  <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); act(sel.borrowerId, { action: "resolve", outcome: new FormData(e.currentTarget).get("outcome") }, "Resolved and logged."); }}>
                    <label className="min-w-48 flex-1 text-[12px] text-muted">Outcome
                      <select name="outcome" className="input mt-1 block w-full" required defaultValue="">
                        <option value="" disabled>Choose an outcome</option>
                        {["Promise to pay agreed", "Paid during the call", "Part-payment plan agreed", "Settlement request logged", "Dispute logged for review", "Hardship: paused for 30 days", "Could not reach"].map((o) => <option key={o}>{o}</option>)}
                      </select>
                    </label>
                    <button className="btn btn-primary">Resolve</button>
                  </form>
                )}
              </div>
            )}
            {msg && <p className="mt-3 text-[12.5px] text-ink-2" role="status">{msg}</p>}
          </Card>
        ) : <Card><Empty title="Pick an escalation">Its AI summary and transfer options appear here.</Empty></Card>}
      </div>
    </>
  );
}
