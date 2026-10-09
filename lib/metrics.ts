import type { Borrower, Bucket, Call, Filters, FollowUp, Scope, Store, Touch } from "./types";
import { BANDS, DAY, bandOf, dayList, istDay, istHour, istMidnight, istMonthEnd, istMonthStart, istWeekday } from "./time";
import { bucketOf, languageUnserved } from "./mock";

const all = (v?: string) => !v || v === "all";
const ratio = (a: number, b: number) => (b ? (a / b) * 100 : 0);
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

export function rangeBounds(f: Filters, now = Date.now()): [number, number] {
  const s = istMidnight(now);
  switch (f.range) {
    case "today": return [s, now];
    case "7d": return [s - 6 * DAY, now];
    case "mtd": return [istMonthStart(now), now];
    case "custom": return [
      f.from ? Date.parse(`${f.from}T00:00:00+05:30`) : s - 29 * DAY,
      f.to ? Date.parse(`${f.to}T23:59:59+05:30`) : now,
    ];
    default: return [s - 29 * DAY, now];
  }
}

/** Predicates for the global filters (portfolio, product, channel) and the viewer's scope; date range kept separate. */
export function matchers(f: Filters, scope: Scope) {
  const portfolio = scope.portfolio ?? f.portfolio;
  const okP = (p: string) => all(portfolio) || p === portfolio;
  const okPr = (p: string) => all(f.product) || p === f.product;
  const okC = (c: string) => all(f.channel) || c === f.channel;
  return {
    borrower: (b: Borrower) => okP(b.portfolio) && okPr(b.product) && okC(b.channel),
    call: (c: Call) => okP(c.portfolio) && okPr(c.product) && okC(c.channel) && (!scope.visibleOnly || c.visible),
    followUp: (x: FollowUp) => okP(x.portfolio) && okPr(x.product),
    portfolio: okP,
  };
}

export function scoped(store: Store, f: Filters, scope: Scope, now = Date.now()) {
  const [from, to] = rangeBounds(f, now);
  const m = matchers(f, scope);
  const inRange = (ts: string) => { const t = Date.parse(ts); return t >= from && t <= to; };
  const borrowers = store.borrowers.filter(m.borrower);
  const calls = store.calls.filter((c) => m.call(c) && inRange(c.ts));
  return { borrowers, calls, from, to, inRange, m };
}

/** Strip server-only and simulator-only fields before a borrower leaves the server. */
export function publicBorrower(b: Borrower): Borrower {
  const { phoneFull: _p, prefBand: _b, prefChannel: _c, ...rest } = b;
  return rest;
}

function callKpis(calls: Call[]) {
  const connected = calls.filter((c) => c.connected);
  return {
    attempted: calls.length,
    connected: connected.length,
    contactRate: ratio(connected.length, calls.length),
    contactToPtp: ratio(connected.filter((c) => c.classification === "PTP").length, connected.length),
  };
}
const recoveredIn = (borrowers: Borrower[], from: number, to: number) =>
  sum(borrowers.filter((b) => b.recoveredAt && Date.parse(b.recoveredAt) >= from && Date.parse(b.recoveredAt) <= to).map((b) => b.recoveredAmount));

function bandRates(calls: Call[]) {
  return BANDS.map((band, i) => {
    const inBand = calls.filter((c) => c.channel !== "WhatsApp" && bandOf(istHour(c.ts)) === i);
    const answered = inBand.filter((c) => c.connected).length;
    return { band: band.label, attempts: inBand.length, answered, rate: ratio(answered, inBand.length) };
  });
}

export function computeOverview(store: Store, f: Filters, scope: Scope) {
  const now = Date.now();
  const { borrowers, calls, from, to, m } = scoped(store, f, scope, now);
  const span = to - from;
  const prevFrom = from - span - 1, prevTo = from - 1;
  const prevCalls = store.calls.filter((c) => m.call(c) && Date.parse(c.ts) >= prevFrom && Date.parse(c.ts) <= prevTo);

  const cur = callKpis(calls), prev = callKpis(prevCalls);
  const outstanding = sum(borrowers.map((b) => b.outstanding));
  const recovered = recoveredIn(borrowers, from, to);
  const prevRecovered = recoveredIn(borrowers, prevFrom, prevTo);
  const kept = borrowers.filter((b) => b.ptpOutcome === "kept").length;
  const broken = borrowers.filter((b) => b.ptpOutcome === "broken").length;
  const links = borrowers.filter((b) => b.paymentLink !== "Not shared");

  const kpis = {
    outstanding,
    recovered,
    recoveryRate: ratio(recovered, outstanding),
    activePtp: borrowers.filter((b) => b.disposition === "PTP").length,
    ptpKeptRate: ratio(kept, kept + broken),
    contactRate: cur.contactRate,
    contactToPtp: cur.contactToPtp,
    linksShared: links.length,
    linkConversion: ratio(links.filter((b) => b.paymentLink === "Paid via link").length, links.length),
    avgDpd: borrowers.length ? sum(borrowers.map((b) => b.dpd)) / borrowers.length : 0,
    openEscalations: borrowers.filter((b) => b.disposition === "Escalated").length,
  };
  const deltas = {
    recovered: prevRecovered ? ((recovered - prevRecovered) / prevRecovered) * 100 : null,
    recoveryRate: outstanding ? kpis.recoveryRate - ratio(prevRecovered, outstanding) : null,
    contactRate: prevCalls.length ? cur.contactRate - prev.contactRate : null,
    contactToPtp: prevCalls.length ? cur.contactToPtp - prev.contactToPtp : null,
  };

  const byDay = new Map<string, { attempted: number; connected: number; paid: number; ptp: number; noContact: number; dispute: number; other: number; recovered: number }>();
  for (const d of dayList(from, to)) byDay.set(d, { attempted: 0, connected: 0, paid: 0, ptp: 0, noContact: 0, dispute: 0, other: 0, recovered: 0 });
  for (const c of calls) {
    const row = byDay.get(istDay(c.ts));
    if (!row) continue;
    row.attempted++;
    if (c.connected) row.connected++;
    if (c.classification === "Paid") row.paid++;
    else if (c.classification === "PTP") row.ptp++;
    else if (c.classification === "No Contact") row.noContact++;
    else if (c.classification === "Dispute") row.dispute++;
    else row.other++;
  }
  for (const b of borrowers) if (b.recoveredAt) { const row = byDay.get(istDay(b.recoveredAt)); if (row) row.recovered += b.recoveredAmount; }
  const trend = [...byDay.entries()].map(([date, v]) => ({ date, ...v, connectRate: ratio(v.connected, v.attempted) }));

  const bands = bandRates(calls).filter((b) => b.attempts >= 20);
  const best = [...bands].sort((a, b) => b.rate - a.rate)[0];
  const worst = [...bands].sort((a, b) => a.rate - b.rate)[0];

  const today = istDay(now);
  const fu = store.followUps.filter(m.followUp);
  const followUpsToday = fu.filter((x) => istDay(x.at) === today && x.status === "Scheduled");
  const missedWeek = fu.filter((x) => x.status === "Missed" && Date.parse(x.at) > now - 7 * DAY).length;
  const escalations = borrowers.filter((b) => b.disposition === "Escalated" && b.escalatedAt)
    .sort((a, b) => b.escalatedAt!.localeCompare(a.escalatedAt!)).slice(0, 5).map(publicBorrower);

  const periodWord = f.range === "today" ? "yesterday" : "the previous period";
  const notes: { text: string; href?: string }[] = [];
  if (deltas.contactRate !== null)
    notes.push({ text: `Contact rate is ${pct1(cur.contactRate)}, ${deltas.contactRate >= 0 ? "up" : "down"} ${Math.abs(deltas.contactRate).toFixed(1)} pts on ${periodWord}.`, href: "/audit" });
  if (deltas.recovered !== null)
    notes.push({ text: `Recovered ${fmtCr(recovered)}, ${deltas.recovered >= 0 ? "up" : "down"} ${Math.abs(deltas.recovered).toFixed(0)}% on ${periodWord}.`, href: "/borrowers?disposition=Paid" });
  if (best && worst && best.band !== worst.band)
    notes.push({ text: `Calls between ${best.band} connect best (${pct1(best.rate)}); ${worst.band} is weakest (${pct1(worst.rate)}). Shift retry slots toward ${best.band}.` });
  notes.push(kpis.ptpKeptRate >= 70
    ? { text: `PTP kept rate is ${pct1(kpis.ptpKeptRate)}, above the 70% mark.`, href: "/borrowers?ptp=kept" }
    : { text: `PTP kept rate is ${pct1(kpis.ptpKeptRate)}, under 70%. Earlier reminders before promise dates would help.`, href: "/borrowers?ptp=broken" });
  if (followUpsToday.length || missedWeek)
    notes.push({ text: `${followUpsToday.length} follow-up${followUpsToday.length === 1 ? "" : "s"} booked for today; ${missedWeek} missed in the last 7 days.`, href: "/followups" });

  return { kpis, deltas, trend, notes, followUpsToday: followUpsToday.slice(0, 6), escalations };
}
const pct1 = (n: number) => `${n.toFixed(1)}%`;
const fmtCr = (n: number) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(2)} Cr` : `₹${(n / 1e5).toFixed(1)} L`);

function group(borrowers: Borrower[], key: (b: Borrower) => string) {
  const m = new Map<string, Borrower[]>();
  borrowers.forEach((b) => m.set(key(b), [...(m.get(key(b)) ?? []), b]));
  return [...m.entries()].map(([name, bs]) => ({
    name,
    assigned: bs.length,
    contacted: bs.filter((b) => b.stage >= 1).length,
    ptp: bs.filter((b) => b.stage >= 3).length,
    recovered: bs.filter((b) => b.stage >= 4).length,
    outstanding: sum(bs.map((b) => b.outstanding)),
    recoveredAmount: sum(bs.map((b) => b.recoveredAmount)),
  })).sort((a, b) => b.outstanding - a.outstanding);
}

export function computePerformance(store: Store, f: Filters, scope: Scope) {
  const { borrowers, calls } = scoped(store, f, scope);
  const funnel = [
    { stage: "Assigned", value: borrowers.length, min: 0 },
    { stage: "Contacted", value: borrowers.filter((b) => b.stage >= 1).length, min: 1 },
    { stage: "Engaged", value: borrowers.filter((b) => b.stage >= 2).length, min: 2 },
    { stage: "PTP", value: borrowers.filter((b) => b.stage >= 3).length, min: 3 },
    { stage: "Recovered", value: borrowers.filter((b) => b.stage >= 4).length, min: 4 },
  ];
  const count = <T,>(items: T[], key: (t: T) => string) => {
    const m = new Map<string, number>();
    items.forEach((i) => m.set(key(i), (m.get(key(i)) ?? 0) + 1));
    return [...m.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  };
  const attempts = [1, 2, 3, 4, 5].map((n) => {
    const at = calls.filter((c) => (n === 5 ? c.attemptNo >= 5 : c.attemptNo === n));
    return { attempt: n === 5 ? "5th+" : `${n}${["st", "nd", "rd", "th"][n - 1]}`, calls: at.length, connected: at.filter((c) => c.connected).length };
  });
  return {
    funnel,
    dispositions: count(borrowers, (b) => b.disposition),
    nonContact: count(calls.filter((c) => !c.connected), (c) => c.dropReason ?? "unknown"),
    attempts,
    bands: bandRates(calls),
    stages: group(borrowers, (b) => b.segment),
    products: group(borrowers, (b) => b.product),
    channels: group(borrowers, (b) => b.channel),
    regions: group(borrowers, (b) => b.region),
    escalations: borrowers.filter((b) => b.disposition === "Escalated").sort((a, b) => b.outstanding - a.outstanding).slice(0, 50).map(publicBorrower),
    patterns: computePatterns(store, f, scope),
    forecast: computeForecast(store, f, scope),
    roll: computeRoll(store, f, scope),
  };
}

export function computeForecast(store: Store, f: Filters, scope: Scope) {
  const now = Date.now();
  const m = matchers(f, scope);
  const borrowers = store.borrowers.filter(m.borrower);
  const ms = istMonthStart(now), me = istMonthEnd(now);
  const days = dayList(ms, me);
  const today = istDay(now);
  const elapsed = days.indexOf(today) + 1;
  const remaining = days.length - elapsed;

  const actualByDay = new Map<string, number>();
  let organicMtd = 0, organic30 = 0;
  // Baseline = payments that did not come from a kept promise, so promises are not counted twice.
  for (const b of borrowers) {
    if (!b.recoveredAt) continue;
    const t = Date.parse(b.recoveredAt);
    const unpromised = b.disposition === "Paid" && b.ptpOutcome !== "kept";
    if (t >= ms && t <= now) {
      actualByDay.set(istDay(t), (actualByDay.get(istDay(t)) ?? 0) + b.recoveredAmount);
      if (unpromised) organicMtd += b.recoveredAmount;
    }
    if (t > now - 30 * DAY && unpromised) organic30 += b.recoveredAmount;
  }
  // Early in the month a few days of data are noisy, so lean on the trailing 30-day run-rate.
  const organicDaily = elapsed < 7 ? organic30 / 30 : organicMtd / elapsed;

  const segs = [...new Set(borrowers.map((b) => b.segment))];
  const keepRates = segs.map((segment) => {
    const bs = borrowers.filter((b) => b.segment === segment);
    const kept = bs.filter((b) => b.ptpOutcome === "kept").length, broken = bs.filter((b) => b.ptpOutcome === "broken").length;
    return { segment, rate: kept + broken >= 5 ? kept / (kept + broken) : 0.7, n: kept + broken };
  });
  const keepOf = (seg: string) => keepRates.find((k) => k.segment === seg)?.rate ?? 0.7;

  const ptpByDay = new Map<string, { amount: number; expected: number; count: number }>();
  for (const b of borrowers) {
    if (b.disposition !== "PTP" || b.ptpOutcome !== "pending" || !b.ptpDate || !b.ptpAmount) continue;
    const t = Math.max(Date.parse(b.ptpDate), now);
    if (t > me) continue;
    const key = istDay(t);
    const row = ptpByDay.get(key) ?? { amount: 0, expected: 0, count: 0 };
    row.amount += b.ptpAmount; row.expected += b.ptpAmount * keepOf(b.segment); row.count++;
    ptpByDay.set(key, row);
  }
  const ptpExpected = sum([...ptpByDay.values()].map((v) => v.expected));
  const ptpAmount = sum([...ptpByDay.values()].map((v) => v.amount));
  const ptpCount = sum([...ptpByDay.values()].map((v) => v.count));
  const avgKeep = ptpAmount ? ptpExpected / ptpAmount : 0.7;

  let cum = 0, proj = 0, lo = 0, hi = 0;
  const series = days.map((date) => {
    if (date < today) { cum += actualByDay.get(date) ?? 0; return { date, actual: cum }; }
    if (date === today) {
      cum += actualByDay.get(date) ?? 0;
      const p = ptpByDay.get(date); // promises due or overdue count toward today
      proj = cum + (p?.expected ?? 0);
      lo = cum + (p ? p.amount * Math.max(0, avgKeep - 0.1) : 0);
      hi = cum + (p ? p.amount * Math.min(1, avgKeep + 0.1) : 0);
      return { date, actual: cum, projected: Math.round(proj), range: [Math.round(lo), Math.round(hi)] as [number, number] };
    }
    const p = ptpByDay.get(date);
    proj += organicDaily + (p?.expected ?? 0);
    lo += organicDaily * 0.85 + (p ? p.amount * Math.max(0, avgKeep - 0.1) : 0);
    hi += organicDaily * 1.15 + (p ? p.amount * Math.min(1, avgKeep + 0.1) : 0);
    return { date, projected: Math.round(proj), range: [Math.round(lo), Math.round(hi)] as [number, number] };
  });
  const recoveredMtd = sum([...actualByDay.values()]);
  const outstanding = sum(borrowers.map((b) => b.outstanding));
  const target = (outstanding * store.recoveryTargetPct) / 100;

  const weeks: { label: string; count: number; amount: number; expected: number }[] = [];
  for (let i = elapsed - 1; i < days.length; i += 7) {
    const chunk = days.slice(i, i + 7);
    const rows = chunk.map((d) => ptpByDay.get(d)).filter(Boolean) as { amount: number; expected: number; count: number }[];
    weeks.push({
      label: chunk.length > 1 ? `${Number(chunk[0].slice(8))}–${Number(chunk[chunk.length - 1].slice(8))}` : `${Number(chunk[0].slice(8))}`,
      count: sum(rows.map((r) => r.count)), amount: sum(rows.map((r) => r.amount)), expected: sum(rows.map((r) => r.expected)),
    });
  }

  return {
    monthStart: days[0], daysInMonth: days.length, elapsed, remaining,
    recoveredMtd, projected: proj, low: lo, high: hi, target, targetPct: store.recoveryTargetPct,
    organicDaily, ptpExpected, ptpAmount, ptpCount, avgKeep,
    series, weeks, keepRates: keepRates.map((k) => ({ ...k, rate: k.rate * 100 })),
  };
}

const BUCKETS: Bucket[] = ["Current", "1–30", "31–60", "61–90", "90+"];
export function computeRoll(store: Store, f: Filters, scope: Scope) {
  const m = matchers(f, scope);
  const borrowers = store.borrowers.filter((b) => m.borrower(b) && b.prevBucket);
  const idx = (b: Bucket) => BUCKETS.indexOf(b);
  const matrix = BUCKETS.map(() => BUCKETS.map(() => 0));
  for (const b of borrowers) matrix[idx(b.prevBucket!)][idx(bucketOf(b.dpd))]++;
  const rowTotals = matrix.map((r) => sum(r));
  const pctM = matrix.map((r, i) => r.map((v) => ratio(v, rowTotals[i])));
  let cured = 0, delinquentPrev = 0, rolled = 0, stable = 0;
  matrix.forEach((r, i) => r.forEach((v, j) => {
    if (i > 0) { delinquentPrev += v; if (j < i) cured += v; }
    if (j > i) rolled += v;
    if (i === j) stable += v;
  }));
  const total = borrowers.length;
  const products = [...new Set(borrowers.map((b) => b.product))].map((name) => {
    const bs = borrowers.filter((b) => b.product === name);
    const fwd = bs.filter((b) => idx(bucketOf(b.dpd)) > idx(b.prevBucket!)).length;
    const del = bs.filter((b) => b.prevBucket !== "Current");
    const cure = del.filter((b) => idx(bucketOf(b.dpd)) < idx(b.prevBucket!)).length;
    return { name, n: bs.length, rollForward: ratio(fwd, bs.length), cure: ratio(cure, del.length) };
  }).sort((a, b) => b.rollForward - a.rollForward);
  return {
    available: total > 0, buckets: BUCKETS, matrix, pct: pctM, rowTotals, total,
    cure: ratio(cured, delinquentPrev), rollForward: ratio(rolled, total), stable: ratio(stable, total), products,
  };
}

export function computeUsage(store: Store, f: Filters, scope: Scope) {
  const { calls, from, to } = scoped(store, f, scope);
  const connected = calls.filter((c) => c.connected);
  const secs = sum(connected.map((c) => c.durationSec));
  const billable = (cs: Call[]) => sum(cs.map((c) => Math.ceil(c.durationSec / 60))); // telecom bills each call rounded up
  const dayMap = new Map<string, number>(dayList(from, to).map((d) => [d, 0]));
  connected.forEach((c) => dayMap.set(istDay(c.ts), (dayMap.get(istDay(c.ts)) ?? 0) + c.durationSec));
  const byCampaign = new Map<string, { product: string; calls: number; seconds: number; billableMinutes: number }>();
  connected.forEach((c) => {
    const row = byCampaign.get(c.campaign) ?? { product: c.product, calls: 0, seconds: 0, billableMinutes: 0 };
    row.calls++; row.seconds += c.durationSec; row.billableMinutes += Math.ceil(c.durationSec / 60);
    byCampaign.set(c.campaign, row);
  });
  return {
    kpis: {
      minutes: billable(connected),
      connectedCalls: connected.length,
      avgMinPerCall: connected.length ? secs / 60 / connected.length : 0,
      verticals: new Set(connected.map((c) => c.portfolio)).size,
    },
    dailyMinutes: [...dayMap.entries()].map(([date, s]) => ({ date, minutes: Math.round(s / 60) })),
    campaigns: [...byCampaign.entries()].map(([campaign, v]) => ({ campaign, ...v })).sort((a, b) => b.seconds - a.seconds),
  };
}

const DOM_BUCKETS = [
  { label: "1–7 (salary week)", from: 1, to: 7 }, { label: "8–14", from: 8, to: 14 },
  { label: "15–21", from: 15, to: 21 }, { label: "22–31", from: 22, to: 31 },
];
const PAY_HOURS = [
  { label: "8–12", from: 8, to: 12 }, { label: "12–17", from: 12, to: 17 },
  { label: "17–21", from: 17, to: 21 }, { label: "21–24", from: 21, to: 24 }, { label: "0–8", from: 0, to: 8 },
];

/**
 * When and how money comes in: day of month, hour of payment, payment-link share, and whether voice or WhatsApp
 * gets a response by time of day. Uses the last 90 days of payments so the pattern is stable whatever range is picked.
 */
export function computePatterns(store: Store, f: Filters, scope: Scope) {
  const now = Date.now();
  const m = matchers({ ...f, product: "all" }, scope);
  const borrowers = store.borrowers.filter(m.borrower);
  const byLoan = new Map(borrowers.map((b) => [b.loanId, b]));
  const calls = store.calls.filter((c) => m.call(c) && byLoan.has(c.loanId) && Date.parse(c.ts) > now - 30 * DAY);
  const touches = store.touches.filter((t) => byLoan.has(t.loanId) && Date.parse(t.ts) > now - 30 * DAY);

  const build = (product: string | null) => {
    const bs = borrowers.filter((b) => !product || b.product === product);
    const paid = bs.filter((b) => b.recoveredAt && b.recoveredAmount && Date.parse(b.recoveredAt) > now - 90 * DAY);
    const total = sum(paid.map((b) => b.recoveredAmount));
    const share = (test: (b: Borrower) => boolean) => ratio(sum(paid.filter(test).map((b) => b.recoveredAmount)), total);
    const dom = (b: Borrower) => Number(istDay(b.recoveredAt!).slice(8));
    const hr = (b: Borrower) => istHour(b.recoveredAt!);
    const loans = new Set(bs.map((b) => b.loanId));
    const voice = calls.filter((c) => c.channel !== "WhatsApp" && loans.has(c.loanId));
    const answer = (from: number, to: number) => { const v = voice.filter((c) => { const h = istHour(c.ts); return h >= from && h < to; }); return { rate: ratio(v.filter((c) => c.connected).length, v.length), n: v.length }; };
    const wa = touches.filter((t) => t.channel === "WhatsApp" && loans.has(t.loanId));
    const waBot = calls.filter((c) => c.channel === "WhatsApp" && loans.has(c.loanId));
    const waEngaged = wa.filter((t) => ["Read", "Replied", "Clicked"].includes(t.status)).length + waBot.filter((c) => c.connected).length;
    return {
      product: product ?? "All products",
      payments: paid.length,
      recovered: total,
      dayOfMonth: DOM_BUCKETS.map((d) => ({ label: d.label, share: share((b) => dom(b) >= d.from && dom(b) <= d.to) })),
      payHour: PAY_HOURS.map((h) => ({ label: h.label, share: share((b) => hr(b) >= h.from && hr(b) < h.to) })),
      salaryWeek: share((b) => dom(b) <= 7),
      afterFive: share((b) => hr(b) >= 17),
      viaLink: ratio(paid.filter((b) => b.paymentLink === "Paid via link").length, paid.length),
      voiceDay: answer(9, 17),
      voiceEvening: answer(17, 19),
      waResponse: { rate: ratio(waEngaged, wa.length + waBot.length), n: wa.length + waBot.length },
    };
  };
  const products = [...new Set(borrowers.map((b) => b.product))];
  return { overall: build(null), products: products.map(build).sort((a, b) => b.recovered - a.recovered) };
}

export type RuleName = "Calling window" | "Daily cap" | "Weekly cap" | "Do-not-call" | "WhatsApp consent" | "Disclosure";
export interface Violation { ts: string; rule: RuleName; loanId: string; borrowerId: string; name: string; campaign: string; detail: string }
export const RULE_NAMES: RuleName[] = ["Calling window", "Daily cap", "Weekly cap", "Do-not-call", "WhatsApp consent", "Disclosure"];

const pad2 = (n: number) => String(n).padStart(2, "0");
const hhmm = (h: number) => { const m = Math.round(h * 60); return `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`; };

export function computeCompliance(store: Store, f: Filters, scope: Scope) {
  const rules = store.compliance;
  const now = Date.now();
  const { borrowers, calls, from, to, inRange, m } = scoped(store, f, scope, now);
  const byLoan = new Map(borrowers.map((b) => [b.loanId, b]));
  const dialled = calls.filter((c) => c.channel !== "WhatsApp" && byLoan.has(c.loanId));
  const msgs = store.touches.filter((t) => byLoan.has(t.loanId) && inRange(t.ts));
  const v: Violation[] = [];
  const flaggedContacts = new Set<string>();
  const base = (b: Borrower) => ({ loanId: b.loanId, borrowerId: b.id, name: b.name });
  const win = `${rules.windowStart}:00–${rules.windowEnd}:00`;

  for (const c of dialled) {
    const b = byLoan.get(c.loanId)!;
    const h = istHour(c.ts);
    if (h < rules.windowStart || h >= rules.windowEnd) {
      v.push({ ts: c.ts, rule: "Calling window", ...base(b), campaign: c.campaign, detail: `Called at ${hhmm(h)}, outside ${win}` });
      flaggedContacts.add(c.id);
    }
    if (rules.respectDnd && b.dnd) {
      v.push({ ts: c.ts, rule: "Do-not-call", ...base(b), campaign: c.campaign, detail: "Borrower asked not to be called" });
      flaggedContacts.add(c.id);
    }
    if (c.connected && c.disclosed === false) {
      v.push({ ts: c.ts, rule: "Disclosure", ...base(b), campaign: c.campaign, detail: "AI-agent and call-recording notice was not played" });
      flaggedContacts.add(c.id);
    }
  }
  for (const t of msgs) {
    const b = byLoan.get(t.loanId)!;
    const h = istHour(t.ts);
    if (h < rules.windowStart || h >= rules.windowEnd) {
      v.push({ ts: t.ts, rule: "Calling window", ...base(b), campaign: t.template, detail: `${t.channel} message sent at ${hhmm(h)}, outside ${win}` });
      flaggedContacts.add(t.id);
    }
    if (rules.requireWaConsent && t.channel === "WhatsApp" && !b.waConsent) {
      v.push({ ts: t.ts, rule: "WhatsApp consent", ...base(b), campaign: t.template, detail: "WhatsApp message sent without opt-in on file" });
      flaggedContacts.add(t.id);
    }
  }

  const perLoan = new Map<string, Call[]>();
  for (const c of dialled) perLoan.set(c.loanId, [...(perLoan.get(c.loanId) ?? []), c]);
  for (const [loanId, list] of perLoan) {
    const b = byLoan.get(loanId)!;
    const sorted = [...list].sort((a, c) => a.ts.localeCompare(c.ts));
    const days = new Map<string, Call[]>();
    for (const c of sorted) days.set(istDay(c.ts), [...(days.get(istDay(c.ts)) ?? []), c]);
    for (const [day, cs] of days) {
      if (cs.length <= rules.maxPerDay) continue;
      cs.slice(rules.maxPerDay).forEach((c) => flaggedContacts.add(c.id));
      v.push({ ts: cs[rules.maxPerDay].ts, rule: "Daily cap", ...base(b), campaign: cs[0].campaign, detail: `${cs.length} attempts on ${day} (cap ${rules.maxPerDay})` });
    }
    // Rolling 7 days, not calendar weeks, so a burst across a week boundary is still caught.
    let lo = 0, inStreak = false;
    sorted.forEach((c, i) => {
      const t = Date.parse(c.ts);
      while (Date.parse(sorted[lo].ts) <= t - 7 * DAY) lo++;
      const n = i - lo + 1;
      if (n > rules.maxPerWeek) {
        flaggedContacts.add(c.id);
        if (!inStreak) v.push({ ts: c.ts, rule: "Weekly cap", ...base(b), campaign: c.campaign, detail: `${n} attempts in the last 7 days (cap ${rules.maxPerWeek})` });
        inStreak = true;
      } else inStreak = false;
    });
  }
  v.sort((a, b) => b.ts.localeCompare(a.ts));

  const byRule = (r: RuleName) => v.filter((x) => x.rule === r).length;
  const checks = dialled.length + msgs.length;
  const daily = dayList(from, to).map((date) => ({ date, flags: v.filter((x) => istDay(x.ts) === date).length }));

  const gaps = new Map<string, number>();
  for (const b of borrowers) if (languageUnserved(b, store.languages)) gaps.set(b.language, (gaps.get(b.language) ?? 0) + 1);
  const openGrievances = store.grievances.filter((g) => m.portfolio(g.portfolio) && g.status !== "Resolved");

  return {
    rules,
    score: checks ? Math.max(0, 100 - ratio(flaggedContacts.size, checks)) : 100,
    checks,
    counts: Object.fromEntries(RULE_NAMES.map((r) => [r, byRule(r)])) as Record<RuleName, number>,
    dndBorrowers: borrowers.filter((b) => b.dnd).length,
    noConsent: borrowers.filter((b) => !b.waConsent).length,
    languageGaps: [...gaps.entries()].map(([language, count]) => ({ language, count })).sort((a, b) => b.count - a.count),
    grievances: { open: openGrievances.length, overdue: openGrievances.filter((g) => Date.parse(g.dueAt) < now).length },
    daily,
    violations: v.slice(0, 300),
    period: [new Date(from).toISOString(), new Date(to).toISOString()],
  };
}


export interface TimelineItem { ts: string; kind: "call" | "whatsapp" | "sms" | "email" | "payment" | "escalation" | "followup"; title: string; detail: string; status?: string; good?: boolean }

export function computeBorrowerProfile(store: Store, id: string, scope: Scope) {
  const b = store.borrowers.find((x) => x.id === id || x.loanId === id);
  if (!b || (scope.portfolio && b.portfolio !== scope.portfolio)) return null;
  const calls = store.calls.filter((c) => c.loanId === b.loanId && (!scope.visibleOnly || c.visible));
  const touches = store.touches.filter((t) => t.loanId === b.loanId);
  const followUps = store.followUps.filter((x) => x.borrowerId === b.id);

  const voice = calls.filter((c) => c.channel !== "WhatsApp");
  const answered = voice.filter((c) => c.connected);
  const bands = bandRates(calls);
  const other = (i: number) => {
    const rest = voice.filter((c) => bandOf(istHour(c.ts)) !== i);
    return { attempts: rest.length, answered: rest.filter((c) => c.connected).length };
  };
  const ranked = bands.map((x, i) => ({ ...x, i })).filter((x) => x.attempts >= 2).sort((a, c) => c.rate - a.rate || c.attempts - a.attempts);
  const best = ranked[0];
  const weekend = voice.filter((c) => [0, 6].includes(istWeekday(c.ts)));
  const weekday = voice.filter((c) => ![0, 6].includes(istWeekday(c.ts)));

  const waTouches = touches.filter((t) => t.channel === "WhatsApp");
  const waBot = calls.filter((c) => c.channel === "WhatsApp");
  const read = waTouches.filter((t) => ["Read", "Replied", "Clicked"].includes(t.status)).length;
  const replied = waTouches.filter((t) => t.status === "Replied").length + waBot.filter((c) => c.connected).length;
  const waSent = waTouches.length + waBot.length;
  const sms = touches.filter((t) => t.channel === "SMS");
  const email = touches.filter((t) => t.channel === "Email");
  const channelStats = [
    { channel: "Voice", sent: voice.length, engaged: answered.length, label: "answered", rate: ratio(answered.length, voice.length) },
    { channel: "WhatsApp", sent: waSent, engaged: read + waBot.filter((c) => c.connected).length, label: "read or replied", rate: ratio(read + waBot.filter((c) => c.connected).length, waSent) },
    { channel: "SMS", sent: sms.length, engaged: sms.filter((t) => t.status === "Clicked").length, label: "clicked", rate: ratio(sms.filter((t) => t.status === "Clicked").length, sms.length) },
    { channel: "Email", sent: email.length, engaged: email.filter((t) => t.status !== "Sent").length, label: "opened", rate: ratio(email.filter((t) => t.status !== "Sent").length, email.length) },
  ];

  const playbook: string[] = [];
  if (best && voice.length >= 4) {
    const o = other(best.i);
    if (best.rate - ratio(o.answered, o.attempts) >= 15)
      playbook.push(`Call between ${best.band}. They answered ${best.answered} of ${best.attempts} calls in that window, against ${o.answered} of ${o.attempts} at other times.`);
    else playbook.push(`No strong time preference yet: ${answered.length} of ${voice.length} calls answered across the day.`);
  } else playbook.push(`Too few calls to read a time pattern (${voice.length} so far).`);
  const voiceRate = ratio(answered.length, voice.length), waRate = channelStats[1].rate;
  if (!b.waConsent) playbook.push("No WhatsApp opt-in on file. Use voice or SMS.");
  else if (waSent >= 2 && waRate - voiceRate >= 15) playbook.push(`Lead with WhatsApp. They read or replied to ${channelStats[1].engaged} of ${waSent} messages; voice reaches them ${voiceRate.toFixed(0)}% of the time.`);
  else if (voice.length >= 2) playbook.push(`Voice works. ${answered.length} of ${voice.length} calls answered; WhatsApp engagement ${waRate.toFixed(0)}%.`);
  if (b.disposition === "Dispute") playbook.unshift("Disputed account. Automated outreach is paused. Route this to the human desk and log a grievance if they complain.");
  playbook.push(languageUnserved(b, store.languages)
    ? `Their language is ${b.language}, which isn't switched on yet. Calls fall back to English until it is enabled on the Channels page.`
    : `Use the ${b.language} voice agent.`);
  if (b.disposition === "PTP" && b.ptpDate && b.ptpOutcome === "pending")
    playbook.push(`Promise of ₹${(b.ptpAmount ?? b.emi).toLocaleString("en-IN")} due ${new Date(b.ptpDate).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}. Send a reminder the evening before.`);
  if (b.ptpOutcome === "broken") playbook.push("Their last promise was broken. Agree a smaller part-payment before setting a new date.");
  if (b.dnd) playbook.push("They asked not to be called. Use WhatsApp, SMS or email only.");
  const nextFu = followUps.find((x) => x.status === "Scheduled");
  if (nextFu) playbook.push(`They asked for a call back on ${new Date(nextFu.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}: “${nextFu.note}”.`);

  const timeline: TimelineItem[] = [
    ...calls.map((c): TimelineItem => ({
      ts: c.ts, kind: c.channel === "WhatsApp" ? "whatsapp" : "call",
      title: c.channel === "WhatsApp" ? `WhatsApp bot conversation · ${c.connected ? c.classification : "no reply"}` : `${c.channel} call · ${c.connected ? c.classification : "not answered"}`,
      detail: c.connected ? `${c.campaign}${c.language ? ` · ${c.language}` : ""} · ${Math.floor(c.durationSec / 60)}:${String(c.durationSec % 60).padStart(2, "0")} talk time · attempt ${c.attemptNo}` : `${c.campaign} · ${c.dropReason?.replace(/_/g, " ")} · attempt ${c.attemptNo}`,
      status: c.connected ? "Answered" : "Missed", good: c.connected,
    })),
    ...touches.map((t: Touch): TimelineItem => ({
      ts: t.ts, kind: t.channel === "WhatsApp" ? "whatsapp" : t.channel === "SMS" ? "sms" : "email",
      title: `${t.channel} · ${t.template}`, detail: t.text, status: t.status, good: ["Read", "Replied", "Clicked", "Opened"].includes(t.status),
    })),
    ...followUps.map((x): TimelineItem => ({
      ts: x.requestedAt, kind: "followup", title: `Asked for a follow-up via ${x.requestedVia}`,
      detail: `For ${new Date(x.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}: ${x.note}`, status: x.status,
    })),
  ];
  if (b.recoveredAt && b.recoveredAmount) timeline.push({ ts: b.recoveredAt, kind: "payment", title: `Payment received · ₹${b.recoveredAmount.toLocaleString("en-IN")}`, detail: b.paymentLink === "Paid via link" ? "Paid through payment link" : "Paid", good: true });
  if (b.escalatedAt) timeline.push({ ts: b.escalatedAt, kind: "escalation", title: "Escalated to human desk", detail: b.escalationReason ?? "" });
  timeline.sort((a, c) => c.ts.localeCompare(a.ts));

  const lastAnswered = answered.sort((a, c) => c.ts.localeCompare(a.ts))[0];
  return {
    borrower: publicBorrower(b),
    stats: {
      attempts: voice.length,
      answered: answered.length,
      answerRate: voiceRate,
      avgTalkSec: answered.length ? sum(answered.map((c) => c.durationSec)) / answered.length : 0,
      lastAnswered: lastAnswered?.ts,
      weekdayRate: ratio(weekday.filter((c) => c.connected).length, weekday.length),
      weekendRate: ratio(weekend.filter((c) => c.connected).length, weekend.length),
      promises: calls.filter((c) => c.classification === "PTP").length,
      touches: touches.length,
    },
    bands,
    bestBand: best && voice.length >= 4 ? best.band : null,
    channelStats,
    playbook,
    timeline,
    followUps,
  };
}

export function computeFollowUps(store: Store, f: Filters, scope: Scope, month: string) {
  const m = matchers(f, scope);
  const start = Date.parse(`${month}-01T00:00:00+05:30`);
  const end = istMonthEnd(start);
  const items = store.followUps.filter((x) => m.followUp(x) && Date.parse(x.at) >= start && Date.parse(x.at) <= end);
  const now = Date.now();
  const upcoming = store.followUps.filter((x) => m.followUp(x) && x.status === "Scheduled" && Date.parse(x.at) >= now).slice(0, 8);
  return {
    month,
    items,
    upcoming,
    counts: {
      scheduled: items.filter((x) => x.status === "Scheduled").length,
      done: items.filter((x) => x.status === "Done").length,
      missed: items.filter((x) => x.status === "Missed").length,
    },
  };
}
