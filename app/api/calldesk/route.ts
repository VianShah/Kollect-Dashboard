import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import { OUTCOME_LABEL, deskQueue, deskScope, deskWorkspace, inDesk, type DeskOutcome } from "@/lib/calldesk";
import { canContact } from "@/lib/contact";
import { addEvent, audit, creditCampaigns, saveStore } from "@/lib/store";
import { istMidnight } from "@/lib/time";
import type { Disposition } from "@/lib/types";

// GET: the queue.  GET ?id=<borrowerId>: the call screen for one borrower.
export async function GET(req: Request) {
  const a = await requireUser(undefined, "calldesk");
  if ("res" in a) return a.res;
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const w = deskWorkspace(a.store, a.user, id, a.scope);
    return w ? NextResponse.json(w) : bad("This borrower isn't in your call desk.", 404);
  }
  return NextResponse.json(deskQueue(a.store, a.user, a.scope));
}

const CLASS: Record<DeskOutcome, Disposition> = {
  ptp: "PTP", callback: "Callback", paid: "Paid", dispute: "Dispute", no_answer: "No Contact", wrong_number: "No Contact", resolved: "Partial",
};

// { borrowerId, action: "start" }  |  { borrowerId, action: "outcome", outcome, durationSec, amount?, date?, note?, resolveEscalation? }
export async function POST(req: Request) {
  const a = await requireUser("handoff", "calldesk");
  if ("res" in a) return a.res;
  const { store: s, user } = a;
  const body = await req.json().catch(() => ({}));
  const b = s.borrowers.find((x) => x.id === body.borrowerId);
  if (!b || !inDesk(deskScope(s, user), b.id) || (a.scope.portfolio && b.portfolio !== a.scope.portfolio)) return bad("This borrower isn't in your call desk.", 404);

  if (body.action === "start") {
    const v = canContact(s, b, "voice");
    if (!v.ok) { audit(s, user, "contact_blocked", b.loanId, v.reason ?? ""); saveStore(s); return bad(v.reason ?? "This call isn't allowed right now.", 409); }
    audit(s, user, "desk_call_start", b.loanId, "Telecaller call");
    saveStore(s);
    return NextResponse.json({ ok: true, startedAt: new Date().toISOString() });
  }
  if (body.action !== "outcome") return bad("Unknown action");

  const outcome = body.outcome as DeskOutcome;
  if (!(outcome in OUTCOME_LABEL)) return bad("Choose how the call ended.");
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
  const now = Date.now(), ts = new Date(now).toISOString();
  const connected = outcome !== "no_answer" && outcome !== "wrong_number";
  const durationSec = connected ? Math.max(5, Math.min(7200, Math.round(Number(body.durationSec) || 0))) : 0;
  const amount = Math.round(Number(body.amount) || 0);
  const date = typeof body.date === "string" ? Date.parse(body.date) : NaN;

  if (outcome === "ptp") {
    if (amount <= 0) return bad("Enter the promised amount.");
    if (Number.isNaN(date) || date < istMidnight(now)) return bad("Choose a promise date from today onwards.");
    Object.assign(b, { disposition: "PTP", stage: 3, ptpAmount: amount, ptpDate: new Date(date).toISOString(), ptpOutcome: "pending" });
    addEvent(s, { type: "ptp", portfolio: b.portfolio, borrowerId: b.id, loanId: b.loanId, title: `Promise to pay · ${b.name}`, detail: `₹${amount.toLocaleString("en-IN")} by ${new Date(date).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })} · telecaller` });
  } else if (outcome === "callback") {
    if (Number.isNaN(date) || date < now) return bad("Choose a call-back time in the future.");
    s.followUps.push({ id: `F${now}`, borrowerId: b.id, loanId: b.loanId, name: b.name, portfolio: b.portfolio, product: b.product, at: new Date(date).toISOString(), requestedAt: ts, requestedVia: "Human Desk", note: note || "Asked to be called back", status: "Scheduled" });
    s.followUps.sort((x, y) => x.at.localeCompare(y.at));
    if (b.disposition !== "Escalated") Object.assign(b, { disposition: "Callback", stage: Math.max(b.stage, 1) });
  } else if (outcome === "paid") {
    const paid = amount > 0 ? amount : b.emi;
    Object.assign(b, { disposition: "Paid", stage: 4, ptpOutcome: b.ptpOutcome === "pending" ? "kept" : b.ptpOutcome, recoveredAmount: Math.max(b.recoveredAmount, paid), recoveredAt: ts });
    addEvent(s, { type: "payment", portfolio: b.portfolio, borrowerId: b.id, loanId: b.loanId, title: `Payment received · ${b.name}`, detail: `₹${paid.toLocaleString("en-IN")} · telecaller` });
  } else if (outcome === "dispute") {
    Object.assign(b, { disposition: "Dispute", stage: Math.max(b.stage, 2), ptpDate: undefined, ptpAmount: undefined, ptpOutcome: undefined });
  }

  // A telecaller call is a call like any other: it lands in the log, the timeline and the campaign's results.
  const attemptNo = s.calls.filter((c) => c.loanId === b.loanId && Date.parse(c.ts) > istMidnight(now)).length + 1;
  s.calls.unshift({
    id: `D${now}`, ts, phone: b.phone, loanId: b.loanId, callId: `desk_${now.toString(36)}`, campaign: "TELECALLER_DESK", product: b.product, portfolio: b.portfolio,
    channel: "Human Desk", durationSec, classification: CLASS[outcome], connected, dropReason: connected ? undefined : outcome === "wrong_number" ? "wrong_number" : "no_answer",
    attemptNo, visible: true, language: b.language, disclosed: true,
  });
  creditCampaigns(s, b.id, connected, CLASS[outcome], outcome === "paid" ? (amount > 0 ? amount : b.emi) : 0);

  // Close the escalation when the telecaller says it's handled.
  const h = s.handoffs[b.id];
  if (body.resolveEscalation && connected && (b.disposition !== "Escalated" || outcome !== "callback")) {
    s.handoffs[b.id] = { ...(h ?? {}), status: "Resolved", owner: h?.owner ?? user.username, outcome: `${OUTCOME_LABEL[outcome]}${note ? `: ${note}` : ""}`, updatedAt: ts };
    if (b.disposition === "Escalated") b.disposition = CLASS[outcome];
  } else if (h && h.status === "Waiting") {
    s.handoffs[b.id] = { ...h, status: "With telecaller", owner: user.username, updatedAt: ts };
  }

  addEvent(s, { type: "call", portfolio: b.portfolio, borrowerId: b.id, loanId: b.loanId, title: `${b.name} · ${OUTCOME_LABEL[outcome]}`, detail: `Telecaller ${user.name}${connected ? ` · ${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, "0")}` : ""}` });
  audit(s, user, "desk_call_outcome", b.loanId, `${OUTCOME_LABEL[outcome]}${note ? ` · ${note}` : ""}`);
  saveStore(s);
  return NextResponse.json({ ok: true, workspace: deskWorkspace(s, user, b.id, a.scope), queue: deskQueue(s, user, a.scope) });
}
