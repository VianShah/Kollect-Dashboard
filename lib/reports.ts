// Campaign report: one row per campaign run. A run is one allocation file worked by one campaign code on one day.
// Demo data: runs are generated at the size real allocation files come in (hundreds of accounts, 100+ calls each),
// stable for a given day, and follow the page's date, company, product and channel filters.
import { matchers, rangeBounds } from "./metrics";
import { DAY, istDay, istMidnight } from "./time";
import type { Channel, Filters, Scope, Store } from "./types";

export const BUCKET_NAMES = ["Pre-due", "Bucket X", "Bucket 1", "Bucket 2", "Bucket 3"] as const;
export const BUCKET_DPD: Record<string, string> = { "Pre-due": "not yet due", "Bucket X": "1–30 DPD", "Bucket 1": "31–60 DPD", "Bucket 2": "61–90 DPD", "Bucket 3": "90+ DPD" };

export interface RunRow {
  id: string;
  code: string;
  product: string;
  portfolio: string;
  channel: Channel;
  language: string;
  day: string;            // IST yyyy-mm-dd
  start: string;          // first call (ISO)
  end: string;            // last call ends (ISO)
  accounts: number;       // rows in the allocation file
  due: number;            // ₹ due across the file
  buckets: { name: string; share: number }[]; // DPD buckets in the file, largest first
  mixed: boolean;
  calls: number;
  connected: number;
  promises: number;
  promised: number;       // ₹ promised
  paid: number;           // accounts that paid
  collected: number;      // ₹ collected
  ror: number;            // % of the amount due that was recovered
  talkMinutes: number;
  outcomes: Record<string, number>;
  hours: number[];        // calls started in each IST hour, 8 to 18
}

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };
const between = (r: number, lo: number, hi: number) => lo + r * (hi - lo);

/** How each channel tends to perform: share of calls answered, answered calls that promise, promises that pay. */
const CHANNEL_RATES: Record<Channel, { connect: [number, number]; promise: [number, number]; pay: [number, number]; attempts: [number, number]; mins: [number, number] }> = {
  "AI Voice": { connect: [0.38, 0.56], promise: [0.2, 0.32], pay: [0.42, 0.62], attempts: [1.3, 2.4], mins: [1.6, 3.2] },
  IVR: { connect: [0.24, 0.4], promise: [0.1, 0.18], pay: [0.35, 0.55], attempts: [1.1, 1.8], mins: [0.6, 1.2] },
  WhatsApp: { connect: [0.5, 0.72], promise: [0.14, 0.24], pay: [0.5, 0.7], attempts: [1, 1.5], mins: [0.4, 0.9] },
  "Human Desk": { connect: [0.45, 0.62], promise: [0.26, 0.4], pay: [0.45, 0.65], attempts: [1.4, 2.6], mins: [3, 6] },
};
/** Which buckets a campaign stage usually carries. */
const STAGE_BUCKETS: [RegExp, string[]][] = [
  [/PREDUE/, ["Pre-due"]], [/PD1_30/, ["Bucket X", "Bucket 1"]], [/PD31P/, ["Bucket 1", "Bucket 2", "Bucket 3"]],
  [/IVR/, ["Pre-due", "Bucket X", "Bucket 1"]], [/ESC/, ["Bucket X", "Bucket 1", "Bucket 2", "Bucket 3"]],
];

export function campaignRuns(s: Store, f: Filters, scope: Scope, now = Date.now()): RunRow[] {
  const [from, to] = rangeBounds(f, now);
  const m = matchers(f, scope);
  const companies = s.portfolios.filter(m.portfolio);
  // Average EMI and balance per product from the book, so amounts look like the lender's.
  const avg = new Map<string, { emi: number; out: number }>();
  for (const p of s.products) {
    const bs = s.borrowers.filter((b) => b.product === p);
    avg.set(p, { emi: bs.length ? bs.reduce((n, b) => n + b.emi, 0) / bs.length : 3000, out: bs.length ? bs.reduce((n, b) => n + b.outstanding, 0) / bs.length : 20000 });
  }
  const codes = s.agents.filter((a) => a.product === "All" || s.products.includes(a.product));
  const rows: RunRow[] = [];
  for (let d = istMidnight(Math.max(from, now - 120 * DAY)); d <= to; d += DAY) {
    const day = istDay(d);
    const weekday = new Date(d + 330 * 60_000).getUTCDay();
    for (const product of s.products) {
      const pool = codes.filter((a) => a.product === product || (a.product === "All" && product === s.products[0]));
      const n = weekday === 0 ? 0 : 1 + Math.floor(hash(`${day}:${product}:n`) * 3); // no runs on Sundays
      for (let i = 0; i < n && pool.length; i++) {
        const r = (k: string) => hash(`${day}:${product}:${i}:${k}`);
        const agent = pool[Math.floor(r("code") * pool.length)];
        const channel = agent.channel;
        const company = companies.length ? companies[Math.floor(r("co") * companies.length)] : "";
        if (!company || !m.portfolio(company) || (f.channel && f.channel !== "all" && f.channel !== channel) || (f.product && f.product !== "all" && f.product !== product)) continue;
        const rate = CHANNEL_RATES[channel];
        // The allocation file: hundreds of accounts, from one bucket or a mix.
        const accounts = Math.round(channel === "Human Desk" ? between(r("acc"), 120, 400) : between(r("acc"), 180, 1400));
        const allowed = STAGE_BUCKETS.find(([re]) => re.test(agent.code))?.[1] ?? ["Bucket X", "Bucket 1", "Bucket 2"];
        const single = allowed.length === 1 || r("mix") < 0.4;
        const picks = single ? [allowed[Math.floor(r("b0") * allowed.length)]] : allowed.slice(0, 2 + Math.floor(r("bn") * (allowed.length - 1)));
        const weights = picks.map((_, j) => 1 + r(`w${j}`) * 3);
        const total = weights.reduce((a, b) => a + b, 0);
        const buckets = picks.map((name, j) => ({ name, share: Math.round((weights[j] / total) * 100) })).sort((a, b) => b.share - a.share);
        if (buckets.length > 1) buckets[0].share += 100 - buckets.reduce((a, b) => a + b.share, 0);
        const late = buckets.reduce((a, b) => a + b.share * BUCKET_NAMES.indexOf(b.name as (typeof BUCKET_NAMES)[number]), 0) / 100; // 0 pre-due … 4 = 90+
        const a = avg.get(product)!;
        const due = Math.round(accounts * a.emi * (1 + late * 0.6));
        const calls = Math.max(100, Math.round(accounts * between(r("att"), ...rate.attempts)));
        const connected = Math.round(calls * between(r("con"), ...rate.connect) * (1 - late * 0.05));
        const promises = Math.round(connected * between(r("ptp"), ...rate.promise) * (1 - late * 0.06));
        const paid = Math.min(accounts, Math.round(promises * between(r("pay"), ...rate.pay) + accounts * 0.02 * (1 - late / 4)));
        const collected = Math.round(paid * a.emi * between(r("amt"), 0.85, 1.25));
        const promised = Math.round(promises * a.emi * between(r("pamt"), 0.9, 1.2));
        const startH = channel === "WhatsApp" ? 12 : channel === "IVR" ? 9 : channel === "Human Desk" ? 10 : between(r("sh"), 9, 13) | 0;
        const span = Math.max(2, Math.min(18 - startH, Math.round(calls / (channel === "Human Desk" ? 60 : 250)) + 2));
        const hours = Array.from({ length: 11 }, (_, h) => (8 + h >= startH && 8 + h < startH + span ? 1 : 0));
        // Evenings answer better: weight later hours up.
        const w = hours.map((on, h) => (on ? 1 + (8 + h >= 17 ? 0.8 : 0) + r(`h${h}`) * 0.5 : 0));
        const wsum = w.reduce((x, y) => x + y, 0) || 1;
        const perHour = w.map((x) => Math.round((x / wsum) * calls));
        const startAt = d + startH * 3_600_000 + Math.floor(r("sm") * 30) * 60_000;
        const endAt = Math.min(d + 19 * 3_600_000, startAt + span * 3_600_000 - Math.floor(r("em") * 40) * 60_000);
        if (startAt > now) continue;
        const outcomes: Record<string, number> = { PTP: promises, Paid: paid, Callback: Math.round(connected * 0.12), Dispute: Math.round(connected * 0.03 * (1 + late)), Escalated: Math.round(connected * (channel === "Human Desk" ? 0.01 : 0.04)) };
        outcomes["No commitment"] = Math.max(0, connected - Object.values(outcomes).reduce((x, y) => x + y, 0));
        outcomes["Not answered"] = calls - connected;
        rows.push({
          id: `${agent.code}|${day}|${i}`, code: agent.code, product, portfolio: company, channel, language: agent.language, day,
          start: new Date(startAt).toISOString(), end: new Date(Math.min(endAt, now)).toISOString(),
          accounts, due, buckets, mixed: buckets.length > 1,
          calls, connected, promises, promised, paid, collected, ror: due ? (collected / due) * 100 : 0,
          talkMinutes: Math.round(connected * between(r("tm"), ...rate.mins)),
          outcomes, hours: perHour,
        });
      }
    }
  }
  return rows.sort((a, b) => b.start.localeCompare(a.start));
}

export const bucketText = (r: Pick<RunRow, "buckets" | "mixed">) =>
  r.mixed ? `Mixed: ${r.buckets.map((b) => `${b.name} ${b.share}%`).join(" · ")}` : `Single bucket: ${r.buckets[0].name} (${BUCKET_DPD[r.buckets[0].name]})`;
