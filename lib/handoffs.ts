import type { Store } from "./types";
import { DAY } from "./time";
import { riskScore, tierOf } from "./portfolio";

const TELECALLERS = ["telecaller", "Priya N.", "Imran S.", "Deepa R."];

/** Simulated AI summary for a hot transfer: what happened, what they said, what to do next. */
export function aiSummary(s: Store, borrowerId: string) {
  const b = s.borrowers.find((x) => x.id === borrowerId)!;
  const calls = s.calls.filter((c) => c.loanId === b.loanId);
  const answered = calls.filter((c) => c.connected);
  const last = answered[0];
  const tier = tierOf(riskScore(b));
  return [
    `${b.name}, ${b.product}, ${b.dpd} days past due, ₹${b.outstanding.toLocaleString("en-IN")} outstanding (${tier.toLowerCase()} risk).`,
    `Escalated because: ${b.escalationReason ?? "asked for a person"}.`,
    `${answered.length} of ${calls.length} calls answered${last ? `; last spoke ${new Date(last.ts).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })} (${last.classification})` : ""}.`,
    b.ptpOutcome === "broken" ? "Broke the last promise to pay." : b.ptpDate ? `Has a promise of ₹${(b.ptpAmount ?? b.emi).toLocaleString("en-IN")}.` : "No promise on record.",
    /hardship|medical/i.test(b.escalationReason ?? "") ? "Suggest: acknowledge the hardship, offer a part-payment plan, avoid pressure." :
      /settle/i.test(b.escalationReason ?? "") ? "Suggest: confirm settlement eligibility before quoting any number." :
      /dispute|paid/i.test(b.escalationReason ?? "") ? "Suggest: pause collection, verify the account, log a grievance if unresolved." : "Suggest: confirm the amount and agree a date this week.",
  ];
}

export function handoffList(s: Store, me: string) {
  const now = Date.now();
  return s.borrowers.filter((b) => b.disposition === "Escalated").map((b) => {
    const h = s.handoffs[b.id] ?? { status: "Waiting" as const };
    const waiting = b.escalatedAt ? Math.round((now - Date.parse(b.escalatedAt)) / 3_600_000) : 0;
    const suggested = b.outstanding > 150_000 || /hardship|medical|settle/i.test(b.escalationReason ?? "") ? "hot" : "cold";
    const n = parseInt(b.id.replace(/\D/g, ""), 10) || 0;
    return {
      borrowerId: b.id, loanId: b.loanId, name: b.name, product: b.product, portfolio: b.portfolio, dpd: b.dpd, outstanding: b.outstanding,
      reason: b.escalationReason ?? "Asked for a person", escalatedAt: b.escalatedAt, waitingHours: waiting, overdueSla: waiting > 4 && h.status === "Waiting",
      suggested, ...h, owner: h.owner ?? (h.status === "Waiting" ? undefined : TELECALLERS[n % TELECALLERS.length]), mine: h.owner === me,
      summary: aiSummary(s, b.id),
    };
  }).sort((a, b) => Number(b.status === "Waiting") - Number(a.status === "Waiting") || (b.waitingHours - a.waitingHours));
}

export const SLA_HOURS = 4;
export const daysAgo = (iso?: string) => (iso ? Math.round((Date.now() - Date.parse(iso)) / DAY) : 0);
