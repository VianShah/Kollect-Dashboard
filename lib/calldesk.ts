// Call desk: what a telecaller needs before and during a call, and what they log after it.
// Telecallers only work borrowers from running campaigns that use Telecallers as a channel.
import type { SessionUser } from "./auth";
import { channelsInUse } from "./campaigns";
import { canContact } from "./contact";
import { aiSummary, SLA_HOURS } from "./handoffs";
import { computeBorrowerProfile } from "./metrics";
import { riskScore, tierOf } from "./portfolio";
import { istMidnight } from "./time";
import type { Campaign, Scope, Store } from "./types";
import { waState } from "./whatsapp";
import { personaOf, riskOf, DEFAULT_RULES, segmentKey, bucketFor } from "./allocation";
import { TEAM, presenceOf, teammateFor } from "./team";
import { windowOpen } from "./contact";

const DAY = 86_400_000;

export const usesTelecaller = (c: Campaign) => channelsInUse(c).includes("telecaller") || c.nodes.some((n) => n.kind === "telecaller");

/** Running or paused campaigns that hand borrowers to telecallers. */
export const telecallerCampaigns = (s: Store) => s.campaigns.filter((c) => (c.status === "Running" || c.status === "Paused") && usesTelecaller(c));

/** Borrower ids a telecaller may work: members of a campaign that uses Telecallers. Other roles see everyone (null). */
export function deskScope(s: Store, user: SessionUser): Set<string> | null {
  if (user.role !== "telecaller") return null;
  return new Set(telecallerCampaigns(s).flatMap((c) => c.members));
}
export const inDesk = (scope: Set<string> | null, borrowerId: string) => !scope || scope.has(borrowerId);

const campaignsOf = (s: Store, borrowerId: string) => telecallerCampaigns(s).filter((c) => c.members.includes(borrowerId)).map((c) => c.name);

export function deskQueue(s: Store, user: SessionUser, scope: Scope) {
  const allowed = deskScope(s, user);
  const now = Date.now();
  const endOfDay = istMidnight(now) + DAY;
  const ok = (id: string, portfolio: string) => inDesk(allowed, id) && (!scope.portfolio || portfolio === scope.portfolio);
  const escalations = s.borrowers.filter((b) => b.disposition === "Escalated" && ok(b.id, b.portfolio)).map((b) => {
    const h = s.handoffs[b.id] ?? { status: "Waiting" as const };
    const waitingHours = b.escalatedAt ? Math.round((now - Date.parse(b.escalatedAt)) / 3_600_000) : 0;
    return {
      kind: "escalation" as const, borrowerId: b.id, loanId: b.loanId, name: b.name, product: b.product, portfolio: b.portfolio,
      reason: b.escalationReason ?? "Asked for a person", at: b.escalatedAt, waitingHours, overdue: waitingHours > SLA_HOURS && h.status === "Waiting",
      status: h.status, owner: h.owner, mine: h.owner === user.username, outstanding: b.outstanding, campaigns: campaignsOf(s, b.id),
    };
  }).filter((x) => x.status !== "Resolved").sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.waitingHours - a.waitingHours);
  const callbacks = s.followUps.filter((f) => f.status === "Scheduled" && Date.parse(f.at) < endOfDay && ok(f.borrowerId, f.portfolio)).map((f) => {
    const b = s.borrowers.find((x) => x.id === f.borrowerId);
    return {
      kind: "callback" as const, borrowerId: f.borrowerId, loanId: f.loanId, name: f.name, product: f.product, portfolio: f.portfolio,
      reason: f.note, at: f.at, overdue: Date.parse(f.at) < now, followUpId: f.id, outstanding: b?.outstanding ?? 0, campaigns: campaignsOf(s, f.borrowerId),
    };
  }).sort((a, b) => a.at.localeCompare(b.at));
  const allocations = allocationsFor(s, user, scope, new Set([...escalations.map((x) => x.borrowerId), ...callbacks.map((x) => x.borrowerId)]));
  return { escalations, callbacks, allocations, scopedToCampaigns: !!allowed, campaigns: allowed ? telecallerCampaigns(s).map((c) => c.name) : null, team: teamBoard(s, user) };
}

const hash = (v: string) => { let h = 2166136261; for (let i = 0; i < v.length; i++) h = Math.imul(h ^ v.charCodeAt(i), 16777619); return h >>> 0; };

/** Who on the team works an account: someone who speaks the borrower's language, spread evenly. */
export function ownerOf(language: string, borrowerId: string) {
  const pool = TEAM.filter((t) => !t.lead && t.languages.includes(language));
  const list = pool.length ? pool : TEAM.filter((t) => !t.lead);
  return list[hash(borrowerId) % list.length];
}

/**
 * Accounts allocated straight to the telecaller: borrowers in a running campaign whose segment goes to telecallers,
 * who speak a language the telecaller speaks. High priority first, then the biggest balances.
 */
function allocationsFor(s: Store, user: SessionUser, scope: Scope, skip: Set<string>) {
  const me = teammateFor(user.username);
  const rows: { kind: "allocation"; borrowerId: string; loanId: string; name: string; product: string; portfolio: string; reason: string; overdue: boolean; outstanding: number; campaigns: string[]; priority: "High" | "Normal"; language: string; dpd: number }[] = [];
  for (const c of telecallerCampaigns(s)) {
    const toPeople = new Set(Object.entries(c.segments ?? {}).filter(([, l]) => l.includes("telecaller")).map(([k]) => k));
    for (const id of c.members) {
      if (skip.has(id) || rows.some((r) => r.borrowerId === id)) continue;
      const b = s.borrowers.find((x) => x.id === id);
      if (!b || ["Paid", "Dispute", "Escalated"].includes(b.disposition) || (scope.portfolio && b.portfolio !== scope.portfolio)) continue;
      const v = riskOf(b, personaOf(b), { ...DEFAULT_RULES, ...(c.risk ?? {}) });
      if (c.segments && !toPeople.has(segmentKey(bucketFor(b), v.tier))) continue;
      if (me && !me.languages.includes(b.language)) continue; // the signed-in telecaller gets accounts in the languages they speak
      rows.push({ kind: "allocation", borrowerId: b.id, loanId: b.loanId, name: b.name, product: b.product, portfolio: b.portfolio,
        reason: `${v.tier} risk · ${b.dpd} DPD · ${v.reasons[0]}`, overdue: false, outstanding: b.outstanding, campaigns: [c.name], priority: v.priority, language: b.language, dpd: b.dpd });
    }
  }
  return rows.sort((a, b) => Number(b.priority === "High") - Number(a.priority === "High") || b.outstanding - a.outstanding).slice(0, 40);
}

/** Everyone on the desk right now, and who speaks what, for transfers. */
export function teamBoard(s: Store, user: SessionUser) {
  const open = windowOpen(s.compliance);
  const me = teammateFor(user.username);
  const day = new Date().toISOString().slice(0, 10);
  const people = TEAM.map((t) => {
    const p = presenceOf(t, open);
    const r = (k: string) => (hash(`${t.id}:${day}:${k}`) % 1000) / 1000;
    const calls = open ? 18 + Math.floor(r("calls") * 30) : 0;
    return { id: t.id, name: t.name, languages: t.languages, lead: !!t.lead, me: t.id === me?.id, ...p,
      today: { calls, connected: Math.round(calls * (0.45 + r("conn") * 0.2)), promises: Math.round(calls * (0.08 + r("ptp") * 0.08)) } };
  });
  const languages = [...new Set(TEAM.flatMap((t) => t.languages))].sort().map((language) => {
    const ps = people.filter((p) => p.languages.includes(language) && !p.me);
    return { language, free: ps.filter((p) => p.status === "Free").length, total: ps.length };
  });
  const count = (st: string) => people.filter((p) => p.status === st).length;
  return { people, languages, counts: { free: count("Free"), onCall: count("On a call"), wrapUp: count("Wrap-up"), away: count("Break") + count("Offline") } };
}

const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" });

/** Everything the telecaller should know before dialling: summary, what the borrower has told us, history and the talk track. */
export function deskWorkspace(s: Store, user: SessionUser, borrowerId: string, scope: Scope) {
  if (!inDesk(deskScope(s, user), borrowerId)) return null;
  const profile = computeBorrowerProfile(s, borrowerId, scope);
  if (!profile) return null;
  const b = s.borrowers.find((x) => x.id === borrowerId)!;
  const calls = s.calls.filter((c) => c.loanId === b.loanId && c.connected).sort((a, c) => c.ts.localeCompare(a.ts));
  const wa = waState(s).messages.filter((m) => m.borrowerId === b.id);
  const lastReply = wa.find((m) => m.direction === "in") ?? null;
  const touchReply = s.touches.find((t) => t.loanId === b.loanId && t.status === "Replied");
  const nextCallback = s.followUps.filter((f) => f.borrowerId === b.id && f.status === "Scheduled").sort((a, c) => a.at.localeCompare(c.at))[0];

  const intent: { label: string; value: string; source: string; tone?: "good" | "warn" | "bad" }[] = [];
  if (b.escalationReason) intent.push({ label: "Why they were escalated", value: b.escalationReason, source: "AI agent", tone: /hardship|medical|lost job/i.test(b.escalationReason) ? "warn" : undefined });
  if (calls[0]) intent.push({ label: "Last conversation", value: `${calls[0].classification} on ${day(calls[0].ts)} (${calls[0].channel})`, source: "Call log" });
  if (b.ptpDate) intent.push({ label: "Promise to pay", value: `₹${(b.ptpAmount ?? b.emi).toLocaleString("en-IN")} by ${day(b.ptpDate)}${b.ptpOutcome ? ` · ${b.ptpOutcome}` : ""}`, source: "Agent", tone: b.ptpOutcome === "broken" ? "bad" : b.ptpOutcome === "kept" ? "good" : undefined });
  if (nextCallback) intent.push({ label: "Asked to be called back", value: `${new Date(nextCallback.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}: “${nextCallback.note}”`, source: `Via ${nextCallback.requestedVia}` });
  if (lastReply) intent.push({ label: "Last WhatsApp reply", value: `“${lastReply.text}” on ${day(lastReply.ts)}`, source: "WhatsApp" });
  else if (touchReply) intent.push({ label: "Replied on WhatsApp", value: `To “${touchReply.template}” on ${day(touchReply.ts)}`, source: "WhatsApp" });
  if (b.paymentLink !== "Not shared") intent.push({ label: "Payment link", value: b.paymentLink, source: "Payments", tone: b.paymentLink === "Paid via link" ? "good" : b.paymentLink === "Link clicked" ? "warn" : undefined });
  if (profile.bestBand) intent.push({ label: "Best time to reach", value: profile.bestBand, source: "Answer pattern" });
  if (b.disposition === "Dispute") intent.push({ label: "Dispute", value: "Disputes the amount. Don't push for payment; verify the account.", source: "Agent", tone: "bad" });

  const voice = canContact(s, b, "voice");
  return {
    ...profile,
    risk: tierOf(riskScore(b)),
    summary: b.disposition === "Escalated" ? aiSummary(s, b.id) : null,
    handoff: s.handoffs[b.id] ?? null,
    campaigns: campaignsOf(s, b.id),
    intent,
    whatsapp: wa.slice(0, 20),
    canCall: voice.ok, callBlockedReason: voice.ok ? null : voice.reason,
    told: calls.slice(0, 4).map((c) => ({ ts: c.ts, channel: c.channel === "Human Desk" ? "Telecaller" : c.channel, outcome: c.classification,
      text: c.classification === "PTP" ? "Agreed a payment date; reminded of the amount due and the payment link."
        : c.classification === "Callback" ? "Asked to be called back; told the amount due and that charges may apply."
        : c.classification === "Dispute" ? "Raised a dispute; told the account will be checked and outreach paused."
        : c.classification === "Escalated" ? "Asked for a person; told a telecaller would call back."
        : c.classification === "Paid" ? "Paid; thanked and confirmed the receipt." : "Reminded of the dues and the payment options." })),
    offers: [
      ...(b.ptpDate ? [{ label: "Promise to pay", detail: `₹${(b.ptpAmount ?? b.emi).toLocaleString("en-IN")} by ${day(b.ptpDate)}`, status: b.ptpOutcome ?? "pending" }] : []),
      ...(/hardship|lost job|medical/i.test(b.escalationReason ?? "") ? [{ label: "Part-payment plan", detail: `₹${Math.round(b.emi / 2).toLocaleString("en-IN")} now, rest in 30 days`, status: "offered" }] : []),
      ...(/settle/i.test(b.escalationReason ?? "") || b.dpd > 90 ? [{ label: "Settlement", detail: "Eligibility to be confirmed by the lender before quoting", status: "not quoted" }] : []),
      ...(b.paymentLink !== "Not shared" ? [{ label: "Payment link", detail: b.paymentLink, status: b.paymentLink === "Paid via link" ? "used" : "sent" }] : []),
    ],
    owner: ownerOf(b.language, b.id).name,
  };
}

export type DeskOutcome = "ptp" | "callback" | "paid" | "dispute" | "no_answer" | "wrong_number" | "resolved";
export const OUTCOME_LABEL: Record<DeskOutcome, string> = {
  ptp: "Promise to pay", callback: "Call back later", paid: "Paid on the call", dispute: "Disputes the amount",
  no_answer: "No answer", wrong_number: "Wrong number", resolved: "Resolved, no payment due",
};
