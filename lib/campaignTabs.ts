// What the Conversations, Compliance, Grievances and Escalations tabs of one campaign show.
import { audienceOf } from "./campaigns";
import { aiSummary, SLA_HOURS } from "./handoffs";
import { DAY, istDay, istHour } from "./time";
import type { Campaign, Store } from "./types";

function scope(s: Store, c: Campaign) {
  const ids = new Set(c.members.length ? c.members : audienceOf(s, c.audience).map((b) => b.id));
  const members = s.borrowers.filter((b) => ids.has(b.id));
  const loans = new Set(members.map((b) => b.loanId));
  const from = Date.parse(c.launchedAt ?? c.startAt), to = c.status === "Completed" ? Date.parse(c.endAt) : Date.now();
  const inWin = (ts: string) => { const t = Date.parse(ts); return t >= from && t <= to; };
  return { ids, members, loans, inWin, from, to };
}

/** Every touchpoint: calls by channel, messages by status, and the latest interactions with an AI summary. */
export function campaignConversations(s: Store, c: Campaign) {
  const { members, loans, inWin } = scope(s, c);
  const calls = s.calls.filter((x) => loans.has(x.loanId) && inWin(x.ts));
  const touches = s.touches.filter((x) => loans.has(x.loanId) && inWin(x.ts));
  const byLoan = new Map(members.map((b) => [b.loanId, b]));
  const channelRow = (name: string, n: number, reached: number) => ({ name, touchpoints: n, reached });
  const latest = [
    ...calls.filter((x) => x.connected).map((x) => ({ ts: x.ts, kind: x.channel === "Human Desk" ? "Telecaller call" : x.channel === "AI Voice" ? "AI voice call" : x.channel === "IVR" ? "IVR call" : "WhatsApp bot", loanId: x.loanId, outcome: x.classification, durationSec: x.durationSec, recording: x.recordingUrl ?? null, text: "" })),
    ...touches.map((t) => ({ ts: t.ts, kind: `${t.channel} · ${t.template}`, loanId: t.loanId, outcome: t.status, durationSec: 0, recording: null, text: t.text })),
  ].sort((a, b) => b.ts.localeCompare(a.ts)).slice(0, 40).map((x) => {
    const b = byLoan.get(x.loanId);
    const summary = x.text ? "" : x.outcome === "PTP" ? `Promised to pay${b?.ptpAmount ? ` ₹${b.ptpAmount.toLocaleString("en-IN")}` : ""}${b?.ptpDate ? ` by ${new Date(b.ptpDate).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}` : ""}.`
      : x.outcome === "Dispute" ? "Disputed the amount; outreach paused and the account flagged for review."
      : x.outcome === "Escalated" ? `Asked for a person: ${b?.escalationReason ?? "handed to the desk"}.`
      : x.outcome === "Callback" ? "Asked to be called back later." : x.outcome === "Paid" ? "Paid during the call." : "No commitment.";
    return { ...x, name: b?.name ?? x.loanId, language: b?.language ?? "", summary };
  });
  return {
    totals: { touchpoints: calls.length + touches.length, calls: calls.length, connected: calls.filter((x) => x.connected).length, messages: touches.length, replies: touches.filter((t) => t.status === "Replied").length, recordings: calls.filter((x) => x.recordingUrl).length, talkMinutes: Math.round(calls.reduce((n, x) => n + x.durationSec, 0) / 60) },
    channels: [
      channelRow("AI voice", calls.filter((x) => x.channel === "AI Voice").length, calls.filter((x) => x.channel === "AI Voice" && x.connected).length),
      channelRow("IVR", calls.filter((x) => x.channel === "IVR").length, calls.filter((x) => x.channel === "IVR" && x.connected).length),
      channelRow("Telecallers", calls.filter((x) => x.channel === "Human Desk").length, calls.filter((x) => x.channel === "Human Desk" && x.connected).length),
      channelRow("WhatsApp", touches.filter((t) => t.channel === "WhatsApp").length + calls.filter((x) => x.channel === "WhatsApp").length, touches.filter((t) => t.channel === "WhatsApp" && ["Read", "Replied", "Clicked"].includes(t.status)).length),
      channelRow("SMS", touches.filter((t) => t.channel === "SMS").length, touches.filter((t) => t.channel === "SMS" && t.status === "Clicked").length),
    ].filter((r) => r.touchpoints > 0),
    latest,
  };
}

/** Compliance for this campaign only: each guardrail with how many contacts kept to it, and an overall score. */
export function campaignCompliance(s: Store, c: Campaign) {
  const { members, loans, inWin } = scope(s, c);
  const r = s.compliance;
  const calls = s.calls.filter((x) => loans.has(x.loanId) && inWin(x.ts) && x.channel !== "WhatsApp");
  const wa = s.touches.filter((t) => loans.has(t.loanId) && inWin(t.ts) && t.channel === "WhatsApp");
  const byLoan = new Map(members.map((b) => [b.loanId, b]));
  const outside = calls.filter((x) => { const h = istHour(x.ts); return h < r.windowStart || h >= r.windowEnd; }).length;
  const perDay = new Map<string, number>(), perWeek = new Map<string, number[]>();
  for (const x of calls) {
    const k = `${x.loanId}|${istDay(x.ts)}`; perDay.set(k, (perDay.get(k) ?? 0) + 1);
    perWeek.set(x.loanId, [...(perWeek.get(x.loanId) ?? []), Date.parse(x.ts)]);
  }
  const overDay = [...perDay.values()].filter((n) => n > r.maxPerDay).length;
  let overWeek = 0;
  for (const ts of perWeek.values()) { ts.sort((a, b) => a - b); for (let i = 0, j = 0; j < ts.length; j++) { while (ts[j] - ts[i] > 7 * DAY) i++; if (j - i + 1 > r.maxPerWeek) { overWeek++; break; } } }
  const dndCalls = calls.filter((x) => byLoan.get(x.loanId)?.dnd).length;
  const noConsent = wa.filter((t) => byLoan.get(t.loanId) && !byLoan.get(t.loanId)!.waConsent).length;
  const noNotice = calls.filter((x) => x.connected && x.disclosed === false).length;
  const connected = calls.filter((x) => x.connected).length;
  const rule = (name: string, detail: string, checked: number, breaches: number) => ({ name, detail, checked, breaches, ok: breaches === 0 });
  const rules = [
    rule("Calling window", `${r.windowStart}:00–${r.windowEnd}:00 IST`, calls.length, outside),
    rule("Daily cap", `At most ${r.maxPerDay} attempts per borrower per day`, perDay.size, overDay),
    rule("Weekly cap", `At most ${r.maxPerWeek} attempts per borrower in 7 days`, perWeek.size, overWeek),
    rule("Do not call", "No calls to borrowers who asked not to be called", calls.length, dndCalls),
    rule("WhatsApp consent", "Only opted-in borrowers get WhatsApp", wa.length, noConsent),
    rule("AI and recording notice", "Played at the start of every connected call", connected, noNotice),
  ];
  const checked = rules.reduce((n, x) => n + x.checked, 0), breaches = rules.reduce((n, x) => n + x.breaches, 0);
  const score = checked ? Math.max(0, Math.round(100 - (breaches / checked) * 100 * 4)) : 100;
  return {
    score, checked, breaches, rules,
    guardrails: [
      "Disputed accounts are left out automatically",
      "No threats, abuse or contacting family and friends (locked prompt blocks)",
      "The borrower can ask for a person at any time",
      "Payment only through the lender's official link",
      "Stop words (STOP, do not call) end outreach at once",
      `Grievance officer: ${s.gro.name}`,
    ],
  };
}

export function campaignGrievances(s: Store, c: Campaign) {
  const { ids } = scope(s, c);
  return s.grievances.filter((g) => ids.has(g.borrowerId)).sort((a, b) => b.raisedAt.localeCompare(a.raisedAt));
}

export function campaignEscalations(s: Store, c: Campaign) {
  const { members } = scope(s, c);
  const now = Date.now();
  return members.filter((b) => b.disposition === "Escalated").map((b) => {
    const h = s.handoffs[b.id] ?? { status: "Waiting" as const };
    const waitingHours = b.escalatedAt ? Math.round((now - Date.parse(b.escalatedAt)) / 3_600_000) : 0;
    return { id: b.id, name: b.name, loanId: b.loanId, reason: b.escalationReason ?? "Asked for a person", status: h.status, owner: h.owner, waitingHours, overdue: h.status === "Waiting" && waitingHours > SLA_HOURS, summary: aiSummary(s, b.id) };
  }).sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.waitingHours - a.waitingHours);
}
