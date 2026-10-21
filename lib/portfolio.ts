import type { Borrower, Goal, Store } from "./types";
import { DAY, istDay, istMonthEnd, istMonthStart } from "./time";
import { bucketOf } from "./mock";
import { DEFAULT_RULES, personaOf, riskOf } from "./allocation";

export type RiskTier = "High" | "Medium" | "Low";
export const TIERS: RiskTier[] = ["High", "Medium", "Low"];
const BUCKET_ORDER = ["Current", "1–30", "31–60", "61–90", "90+"];

/**
 * 0–100, higher is riskier. Bureau score carries the most weight, then how late the account is now,
 * then its payment history: broken promises and rolling into a worse bucket push it up, a recent payment pulls it down.
 */
export function riskScore(b: Borrower, now = Date.now()) {
  const bureau = ((850 - Math.max(500, Math.min(850, b.experian))) / 350) * 45;
  const late = (Math.min(b.dpd, 120) / 120) * 35;
  let history = 0;
  if (b.ptpOutcome === "broken") history += 12;
  if (b.prevBucket && BUCKET_ORDER.indexOf(bucketOf(b.dpd)) > BUCKET_ORDER.indexOf(b.prevBucket)) history += 8;
  if (b.recoveredAt && Date.parse(b.recoveredAt) > now - 45 * DAY) history -= 10;
  return Math.max(0, Math.min(100, Math.round(bureau + late + history)));
}
export const tierOf = (score: number): RiskTier => (score >= 50 ? "High" : score >= 28 ? "Medium" : "Low");

export const TIER_PLAYBOOK: Record<RiskTier, { channels: string; approach: string }> = {
  High: { channels: "Telecaller + AI voice (firm)", approach: "Call early in the cycle, push for a part-payment or settlement plan, hand hardship cases to the human desk." },
  Medium: { channels: "AI voice in the evening + WhatsApp link", approach: "Link in the afternoon, call after 5 pm, follow up broken promises within 48 hours." },
  Low: { channels: "WhatsApp + IVR reminders", approach: "Reminders before the due date and in salary week; most pay from the link without a call." },
};

/**
 * The book for one company (or all), with collections over a date range. Risk comes only from how borrowers behave:
 * credit score, days late, late EMIs in the last 12 months and broken promises (same rules as campaigns).
 */
export function computePortfolio(s: Store, company: string, now = Date.now(), range?: { from: number; to: number }) {
  const inCo = (p: string) => company === "all" || p === company;
  const bs = s.borrowers.filter((b) => inCo(b.portfolio));
  const scored = bs.map((b) => { const p = personaOf(b); const v = riskOf(b, p, DEFAULT_RULES); return { b, p, v, tier: v.tier as RiskTier }; });
  const book = bs.reduce((n, b) => n + b.outstanding, 0);
  const ms = istMonthStart(now), me = istMonthEnd(now);
  const from = range?.from ?? ms, to = range?.to ?? now;
  const paidInRange = (list: Borrower[]) => list.filter((b) => b.recoveredAt && Date.parse(b.recoveredAt) >= from && Date.parse(b.recoveredAt) <= to).reduce((n, b) => n + b.recoveredAmount, 0);
  const paidIn = (list: Borrower[]) => list.filter((b) => b.recoveredAt && Date.parse(b.recoveredAt) >= ms).reduce((n, b) => n + b.recoveredAmount, 0);
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, c) => a + c, 0) / xs.length : 0);

  const tiers = TIERS.map((tier) => {
    const sc = scored.filter((x) => x.tier === tier);
    const rows = sc.map((x) => x.b);
    const outstanding = rows.reduce((n, b) => n + b.outstanding, 0);
    const pctOf = (f: (x: (typeof sc)[number]) => boolean) => (sc.length ? Math.round((sc.filter(f).length / sc.length) * 100) : 0);
    const lowScore = pctOf((x) => x.b.experian < DEFAULT_RULES.bureauBelow), manyLate = pctOf((x) => x.p.latePayments >= DEFAULT_RULES.lateAtLeast);
    const veryLate = pctOf((x) => x.b.dpd > DEFAULT_RULES.dpdAbove), clean = pctOf((x) => x.p.latePayments === 0 && x.b.dpd <= 30);
    // The borrower persona behind the tier, in plain words.
    const persona = tier === "High"
      ? `Mostly repeat late payers: ${manyLate}% have ${DEFAULT_RULES.lateAtLeast}+ late EMIs in a year, ${lowScore}% score under ${DEFAULT_RULES.bureauBelow}, ${veryLate}% are over ${DEFAULT_RULES.dpdAbove} days late.`
      : tier === "Medium"
      ? `Occasionally late: usually one or two late EMIs a year and a borderline score. ${veryLate}% are over ${DEFAULT_RULES.dpdAbove} days late; most were paying until recently.`
      : `Good payers who slipped: ${clean}% have no late EMIs and are under 30 days late. Credit scores are mostly healthy.`;
    return {
      tier, accounts: rows.length, outstanding, share: book ? (outstanding / book) * 100 : 0,
      avgBureau: Math.round(avg(rows.map((b) => b.experian))), avgDpd: Math.round(avg(rows.map((b) => b.dpd))),
      avgLate: +avg(sc.map((x) => x.p.latePayments)).toFixed(1), avgLoans: +avg(sc.map((x) => x.p.loansHeld)).toFixed(1),
      brokenRate: rows.length ? (rows.filter((b) => b.ptpOutcome === "broken").length / rows.length) * 100 : 0,
      lowScore, manyLate, veryLate, persona,
      collectedMtd: paidInRange(rows),
    };
  });

  const products = [...new Set(bs.map((b) => b.product))].map((product) => {
    const rows = scored.filter((x) => x.b.product === product);
    const outstanding = rows.reduce((n, x) => n + x.b.outstanding, 0);
    return {
      product, accounts: rows.length, outstanding, collectedMtd: paidInRange(rows.map((x) => x.b)),
      mix: TIERS.map((t) => ({ tier: t, outstanding: rows.filter((x) => x.tier === t).reduce((n, x) => n + x.b.outstanding, 0) })),
    };
  }).sort((a, b) => b.outstanding - a.outstanding);

  const loans = new Set(bs.map((b) => b.loanId));
  const since = from, until = to;
  const mixCount = new Map<string, number>();
  for (const c of s.calls) if (loans.has(c.loanId) && Date.parse(c.ts) > since && Date.parse(c.ts) <= until) mixCount.set(c.channel === "Human Desk" ? "Telecaller" : c.channel, (mixCount.get(c.channel === "Human Desk" ? "Telecaller" : c.channel) ?? 0) + 1);
  for (const t of s.touches) if (loans.has(t.loanId) && Date.parse(t.ts) > since && Date.parse(t.ts) <= until) mixCount.set(t.channel === "WhatsApp" ? "WhatsApp" : t.channel, (mixCount.get(t.channel) ?? 0) + 1);
  const totalMix = [...mixCount.values()].reduce((a, c) => a + c, 0);
  const channelMix = [...mixCount.entries()].map(([channel, n]) => ({ channel, contacts: n, share: totalMix ? (n / totalMix) * 100 : 0 })).sort((a, b) => b.contacts - a.contacts);

  const elapsed = Math.max(1, Math.round((now - ms) / DAY));
  const days = Math.round((me - ms) / DAY);
  const goals = s.goals.filter((g) => inCo(g.company)).map((g) => {
    const rows = s.borrowers.filter((b) => b.portfolio === g.company && (g.product === "All products" || b.product === g.product));
    const actual = paidIn(rows);
    const projected = (actual / elapsed) * days;
    const pct = g.target ? (actual / g.target) * 100 : 0;
    const status = projected >= g.target ? "On track" : projected >= g.target * 0.85 ? "At risk" : "Behind";
    return { ...g, actual, projected, pct, status };
  });

  return {
    company, companies: s.portfolios, month: istDay(now).slice(0, 7), elapsed, days,
    book, accounts: bs.length, collectedMtd: paidInRange(bs), collectedThisMonth: paidIn(bs), range: { from: new Date(from).toISOString(), to: new Date(to).toISOString() }, tiers, products, channelMix, goals,
    target: goals.reduce((n, g) => n + (g.product === "All products" ? g.target : 0), 0),
  };
}

export function seedGoals(s: Store, now: number): Goal[] {
  const ms = istMonthStart(now);
  const out: Goal[] = [];
  let n = 0;
  for (const company of s.portfolios) {
    const bs = s.borrowers.filter((b) => b.portfolio === company);
    const book = bs.reduce((a, b) => a + b.outstanding, 0);
    out.push({ id: `G${++n}`, company, product: "All products", target: Math.round((book * 0.06) / 10000) * 10000, month: istDay(ms).slice(0, 7), setBy: "manager" });
    for (const product of s.products) {
      const pb = bs.filter((b) => b.product === product).reduce((a, b) => a + b.outstanding, 0);
      if (pb) out.push({ id: `G${++n}`, company, product, target: Math.round((pb * 0.06) / 10000) * 10000, month: istDay(ms).slice(0, 7), setBy: "manager" });
    }
  }
  return out;
}
