import type {
  Agent, Borrower, Bucket, Call, Channel, Disposition, FollowUp, Grievance, LinkStatus, LiveEvent, ScenarioKey, Segment, Store, Touch, TouchStatus,
} from "./types";
import { BANDS, DAY, IST, istDay, istMidnight } from "./time";
import { DEFAULT_LANGUAGES, FALLBACK_LANGUAGE, REGION_LANGUAGES, langCode, voiceOf } from "./languages";
import { renderMessage, type TemplateName } from "./messages";
import { COMM_CHANNELS, DEFAULT_LINES, rebalance } from "./lines";

export const STORE_VERSION = 5;

// Seeded RNG so the server and the offline fallback produce the same dataset.
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
type R = () => number;
const pick = <T,>(r: R, a: readonly T[]) => a[Math.floor(r() * a.length)];
const weighted = <T,>(r: R, items: readonly [T, number][]) => {
  let x = r() * items.reduce((s, [, w]) => s + w, 0);
  for (const [v, w] of items) if ((x -= w) < 0) return v;
  return items[items.length - 1][0];
};
const between = (r: R, a: number, b: number) => a + r() * (b - a);

export interface ProductDef { name: string; code: string; emi: [number, number]; tenor: [number, number] }
export const SCENARIOS: Record<ScenarioKey, { label: string; seed: number; portfolios: string[]; products: ProductDef[] }> = {
  nbfc: {
    label: "NBFC", seed: 42, portfolios: ["Alpha NBFC", "Sahyog Finance", "Northgate Credit"],
    products: [
      { name: "BNPL", code: "BNPL", emi: [600, 5000], tenor: [1, 3] },
      { name: "Personal Loan", code: "PL", emi: [4000, 30000], tenor: [3, 12] },
      { name: "Credit Card", code: "CC", emi: [3000, 25000], tenor: [2, 8] },
      { name: "Two-Wheeler Loan", code: "TW", emi: [2500, 6500], tenor: [4, 14] },
    ],
  },
  bank: {
    label: "Bank", seed: 7, portfolios: ["Meridian Bank", "Harbor Co-op Bank", "Lakeview Bank"],
    products: [
      { name: "Credit Card", code: "CC", emi: [3000, 25000], tenor: [2, 8] },
      { name: "Personal Loan", code: "PL", emi: [6000, 35000], tenor: [3, 12] },
      { name: "Auto Loan", code: "AL", emi: [9000, 28000], tenor: [5, 15] },
      { name: "Home Loan", code: "HL", emi: [20000, 70000], tenor: [6, 20] },
    ],
  },
  bnpl: {
    label: "BNPL", seed: 99, portfolios: ["Kinara Pay", "CartLater", "Nimbus EMI"],
    products: [
      { name: "Pay Later", code: "PAYL", emi: [600, 5000], tenor: [1, 3] },
      { name: "Consumer Durable EMI", code: "CD", emi: [1500, 9000], tenor: [2, 6] },
      { name: "EMI Card", code: "EC", emi: [1000, 7000], tenor: [2, 5] },
    ],
  },
};

/** early = 1–30 days past due, late = 31+ days past due (including 90+). */
export type CampaignStage = "predue" | "ivr" | "early" | "late" | "esc";
export interface CampaignDef { code: string; product: string; channel: Channel; language: string; stage: CampaignStage }
export const STAGE_LABEL: Record<CampaignStage, string> = { predue: "Pre-due", ivr: "IVR reminders", early: "1–30 DPD", late: "31+ DPD", esc: "Escalation" };

/** One WhatsApp bot per product (it speaks each borrower's language) and one voice campaign per product, stage and enabled language. */
export function campaignsFor(s: ScenarioKey, languages: string[] = DEFAULT_LANGUAGES): CampaignDef[] {
  const out: CampaignDef[] = [];
  for (const p of SCENARIOS[s].products) {
    out.push({ code: `KOLLECT_${p.code}_PREDUE_WA`, product: p.name, channel: "WhatsApp", language: "Multilingual", stage: "predue" });
    out.push({ code: `KOLLECT_${p.code}_IVR`, product: p.name, channel: "IVR", language: "Multilingual", stage: "ivr" });
    for (const stage of ["early", "late"] as const)
      for (const lang of languages)
        out.push({ code: `KOLLECT_${p.code}_${stage === "early" ? "PD1_30" : "PD31P"}_VOICE_${langCode(lang)}`, product: p.name, channel: "AI Voice", language: lang, stage });
  }
  out.push({ code: "KOLLECT_ESC_HUMAN", product: "All", channel: "Human Desk", language: "Multilingual", stage: "esc" });
  return out;
}

/** Picks the campaign in the borrower's language; if that language isn't switched on, falls back to English. */
export function pickCampaign(b: Borrower, camps: CampaignDef[], r: R): CampaignDef {
  const mine = camps.filter((c) => c.product === b.product);
  const voice = (stage: "early" | "late") => {
    const here = mine.filter((c) => c.stage === stage);
    return here.find((c) => c.language === b.language) ?? here.find((c) => c.language === FALLBACK_LANGUAGE) ?? here[0];
  };
  if (b.disposition === "Escalated" && r() < 0.5) return camps[camps.length - 1];
  const wa = mine.find((c) => c.stage === "predue")!, ivr = mine.find((c) => c.stage === "ivr") ?? wa;
  const x = r();
  if (b.segment === "Pre Due") return x < 0.45 ? wa : x < 0.65 ? ivr : voice("early");
  if (b.segment === "Post Due (0–30)") return x < 0.15 ? wa : x < 0.3 ? ivr : voice("early");
  return voice("late");
}

/** True when the borrower's own language has no voice campaign, so they would be called in the fallback language. */
export const languageUnserved = (b: Borrower, enabled: string[]) => !enabled.includes(b.language);

const FIRST = ["Aarav", "Priya", "Rohan", "Sneha", "Vikram", "Anjali", "Karan", "Neha", "Rahul", "Pooja", "Amit", "Divya", "Suresh", "Kavita", "Manoj", "Ritu", "Arjun", "Meera", "Sanjay", "Isha", "Farhan", "Lakshmi", "Gurpreet", "Deepa", "Tenzin", "Joseph"];
const LAST = ["Sharma", "Patel", "Singh", "Reddy", "Iyer", "Gupta", "Nair", "Joshi", "Verma", "Mehta", "Das", "Khan", "Rao", "Kulkarni", "Bose", "Fernandes", "Gill", "Pillai"];
export const REGIONS = ["North", "South", "East", "West"];
const NO_CONTACT = ["no_answer", "switched_off", "customer_busy", "call_rejected", "wrong_number"] as const;
export const ESCALATION_REASONS = [
  "Asked for a human agent",
  "Disputes late-payment charges",
  "Hardship: lost job",
  "Requests settlement",
  "Claims amount already paid",
  "Medical emergency in family",
];
export const FOLLOWUP_NOTES = [
  "Call after salary credit on the 7th",
  "At work in the day, call in the evening",
  "Wants to discuss a part payment",
  "Asked for a callback from a human agent",
  "Will confirm the payment date after speaking to spouse",
  "Travelling, call back next week",
  "Needs a fresh payment link before paying",
];

/** Books a call-back at a time that honours what the borrower asked for, always inside 8:00–19:00 IST. */
export function followupSlot(note: string, prefBand: number | undefined, now: number, r: R, offsetDays: number): number {
  const band = BANDS[prefBand ?? 4];
  let from = band.from, to = band.to - 0.5, midnight = istMidnight(now + offsetDays * DAY);
  if (/evening|spouse/i.test(note)) { from = 17; to = 18.5; }
  if (/next week/i.test(note)) midnight = istMidnight(now + Math.max(offsetDays, 7) * DAY);
  if (/salary credit on the 7th/i.test(note)) {
    const [y, m, d] = istDay(now).split("-").map(Number);
    midnight = Date.UTC(y, d < 7 ? m - 1 : m, 7) - IST;
    from = 10; to = 12;
  }
  return Math.round((midnight + (from + r() * (to - from)) * 3_600_000) / 900_000) * 900_000;
}

export const bucketOf = (dpd: number): Bucket => (dpd <= 0 ? "Current" : dpd <= 30 ? "1–30" : dpd <= 60 ? "31–60" : dpd <= 90 ? "61–90" : "90+");
const PREV_BUCKET: Record<Bucket, [Bucket, number][]> = {
  Current: [["Current", 88], ["1–30", 10], ["31–60", 2]],
  "1–30": [["Current", 14], ["1–30", 66], ["31–60", 20]],
  "31–60": [["1–30", 35], ["31–60", 50], ["61–90", 15]],
  "61–90": [["31–60", 40], ["61–90", 55], ["1–30", 5]],
  "90+": [["61–90", 30], ["90+", 68], ["31–60", 2]],
};

const digits = (r: R, n: number) => Array.from({ length: n }, () => Math.floor(r() * 10)).join("");
export const maskPhone = (full: string) => {
  const d = full.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "");
  return d.length >= 10 ? `+91 ${d.slice(0, 2)}••• ••${d.slice(-2)}` : full;
};

export function inPrefBand(b: Borrower, hour: number) {
  const band = BANDS[b.prefBand ?? 4];
  return hour >= band.from - 0.5 && hour < band.to + 0.5;
}

/**
 * How each product's borrowers pay: share in the salary week (days 1–7), share around a mid-month due date (15–21),
 * share after 5 pm, and share through the payment link. Credit cards follow their statement due date
 * mid-month; BNPL is the most evening- and link-driven; two-wheeler borrowers pay more in cash during the day.
 */
export const PAY_PROFILE: Record<string, { salary: number; mid: number; evening: number; link: number }> = {
  BNPL: { salary: 0.64, mid: 0.12, evening: 0.8, link: 0.88 },
  "Personal Loan": { salary: 0.56, mid: 0.16, evening: 0.72, link: 0.74 },
  "Credit Card": { salary: 0.3, mid: 0.44, evening: 0.68, link: 0.82 },
  "Two-Wheeler Loan": { salary: 0.44, mid: 0.18, evening: 0.5, link: 0.48 },
};
const DEFAULT_PROFILE = { salary: 0.48, mid: 0.18, evening: 0.65, link: 0.66 };
export const payProfile = (product: string) => PAY_PROFILE[product] ?? DEFAULT_PROFILE;

/** A payment time in the last two months that follows the product's salary-week and evening pattern. */
function paymentTime(product: string, now: number, r: R): number {
  const p = payProfile(product);
  const x = r();
  const day = x < p.salary ? 1 + Math.floor(r() * 7) : x < p.salary + p.mid ? 15 + Math.floor(r() * 7) : 8 + Math.floor(r() * 21);
  const hour = r() < p.evening ? 17 + r() * 4.5 : 9 + r() * 8;
  const [y, m] = istDay(now).split("-").map(Number);
  for (const back of r() < 0.5 ? [0, 1, 2] : [1, 2]) {
    const t = Date.UTC(y, m - 1 - back, Math.min(day, 28)) - IST + hour * 3_600_000;
    if (t <= now) return t;
  }
  return now - DAY;
}

export function connectChance(b: Borrower, channel: Channel, hour: number) {
  const inBand = inPrefBand(b, hour);
  // Most borrowers are at work in the day: voice goes unanswered until the evening, WhatsApp gets read either way.
  let p = channel === "WhatsApp" ? (inBand ? 0.9 : 0.78) : inBand ? 0.8 : hour >= 17 ? 0.62 : 0.34;
  if (channel !== "WhatsApp" && b.prefChannel === "WhatsApp") p *= 0.75;
  return p;
}

export function makeAgent(c: CampaignDef, id: string, business: string): Agent {
  const max = c.stage === "esc" ? 5 : c.stage === "late" ? 2 : 3;
  const name = c.stage === "esc" ? "Human desk"
    : c.channel === "WhatsApp" ? `${c.product} · WhatsApp bot`
    : c.channel === "IVR" ? `${c.product} · IVR reminders`
    : `${c.product} · Voice ${c.language}${c.stage === "late" ? " (31+ DPD)" : ""}`;
  return {
    id, name, code: c.code, business, product: c.product, language: c.language,
    voice: c.channel === "AI Voice" ? voiceOf(c.language) : "—", channel: c.channel, live: 0, max, resolved: 0, open: 0,
  };
}

/** Adds and removes voice campaigns so the agent list matches the enabled languages; existing agents keep their live counts and limits. */
export function syncAgents(s: Store) {
  const wanted = campaignsFor(s.scenario, s.languages);
  const have = new Map(s.agents.map((a) => [a.code, a]));
  let n = s.agents.length;
  s.agents = wanted.map((c) => have.get(c.code) ?? makeAgent(c, `A${++n}`, s.agents[0]?.business ?? SCENARIOS[s.scenario].label));
  rebalance(s, "Voice agents");
}

export const DEFAULT_GRO ={ name: "Grievance Redressal Officer", email: "grievance@kollect.example", phone: "1800 000 0000" };
export const GRIEVANCE_CATEGORIES = ["Harassment or abusive language", "Contacted at a wrong time", "Wrong amount or charges", "Payment not credited", "Data or privacy concern", "Other"];
export const GRIEVANCE_SLA_DAYS = 30;
const CATEGORY_FOR_REASON: Record<string, string> = {
  "Disputes late-payment charges": "Wrong amount or charges",
  "Claims amount already paid": "Payment not credited",
  "Hardship: lost job": "Other",
  "Medical emergency in family": "Other",
  "Requests settlement": "Other",
  "Asked for a human agent": "Other",
};

export function generateStore(scenario: ScenarioKey = "nbfc", now = Date.now(), languages: string[] = DEFAULT_LANGUAGES): Store {
  const def = SCENARIOS[scenario];
  const r = rng(def.seed);
  const camps = campaignsFor(scenario, languages);
  const borrowers: Borrower[] = [];

  for (let i = 0; i < 600; i++) {
    const product = weighted(r, def.products.map((p, k) => [p, 4 - Math.min(k, 2)] as [ProductDef, number]));
    const segment: Segment = pick(r, ["Pre Due", "Post Due (0–30)", "Post Due (0–30)", "Post Due (30–90)", "Post Due (90+)"] as const);
    const dpd = segment === "Pre Due" ? 0 : segment === "Post Due (0–30)" ? 1 + Math.floor(r() * 29) : segment === "Post Due (30–90)" ? 31 + Math.floor(r() * 59) : 91 + Math.floor(r() * 60);
    const emi = Math.round(between(r, ...product.emi) / 50) * 50;
    const outstanding = Math.round(emi * between(r, ...product.tenor));
    const x = r();
    const stage = (x < 0.3 ? 0 : x < 0.58 ? 1 : x < 0.74 ? 2 : x < 0.84 ? 3 : 4) as Borrower["stage"];
    let disposition: Disposition;
    if (stage === 0) disposition = "No Contact";
    else if (stage === 1) disposition = "Callback";
    else if (stage === 2) disposition = pick(r, ["Dispute", "Escalated", "Escalated", "Callback"] as const);
    else if (stage === 3) disposition = r() < 0.8 ? "PTP" : "Partial";
    else disposition = "Paid";

    const pc = r();
    const prefChannel: Channel = pc < 0.35 ? "WhatsApp" : pc < 0.5 ? "IVR" : "AI Voice";
    const channel: Channel = disposition === "Escalated" ? "Human Desk" : prefChannel;
    let paymentLink: LinkStatus = "Not shared";
    if (stage >= 2) paymentLink = stage === 4 && r() < payProfile(product.name).link ? "Paid via link" : pick(r, ["Shared", "Link clicked", "Not shared"] as const);
    const recoveredAmount = stage === 4 ? Math.round(outstanding * (0.5 + r() * 0.5)) : disposition === "Partial" ? Math.round(outstanding * 0.25) : 0;
    const phoneFull = `+91 ${pick(r, ["98", "97", "96", "93", "90", "88", "79", "70"])}${digits(r, 3)} ${digits(r, 5)}`;
    const current = bucketOf(dpd);
    const region = pick(r, REGIONS);
    borrowers.push({
      id: `B${1000 + i}`,
      name: `${pick(r, FIRST)} ${pick(r, LAST)}`,
      phone: maskPhone(phoneFull),
      phoneFull,
      loanId: `LN${String(2024000000 + Math.floor(r() * 999999))}`,
      product: product.name,
      segment,
      portfolio: pick(r, def.portfolios),
      region,
      language: weighted(r, REGION_LANGUAGES[region]),
      emi,
      outstanding,
      dpd,
      prevBucket: weighted(r, PREV_BUCKET[current]),
      disposition,
      stage,
      paymentLink,
      experian: 520 + Math.floor(r() * 330),
      channel,
      dnd: r() < 0.03,
      waConsent: r() > 0.05,
      ptpDate: stage === 3 ? new Date(now + between(r, -2, 9) * DAY).toISOString() : undefined,
      ptpAmount: stage === 3 ? emi : undefined,
      ptpOutcome: stage === 3 ? pick(r, ["pending", "pending", "kept", "broken"] as const) : stage === 4 ? (r() < 0.6 ? "kept" : undefined) : undefined,
      recoveredAmount,
      recoveredAt: recoveredAmount ? new Date(paymentTime(product.name, now, r)).toISOString() : undefined,
      escalatedAt: disposition === "Escalated" ? new Date(now - r() * 6 * DAY).toISOString() : undefined,
      escalationReason: disposition === "Escalated" ? pick(r, ESCALATION_REASONS) : undefined,
      prefBand: weighted(r, [[0, 2], [1, 1], [2, 1], [3, 2], [4, 4]]),
      prefChannel,
    });
  }

  // Calls: 45 days of history. Answer odds depend on each borrower's preferred time band and channel,
  // so the Borrower 360 view has a real pattern to find.
  const calls: Call[] = [];
  let seq = 0;
  const pushCall = (b: Borrower, ts: number, attemptNo: number) => {
    const camp = pickCampaign(b, camps, r);
    const hour = ((ts + 330 * 60_000) % DAY) / 3_600_000;
    const connected = r() < connectChance(b, camp.channel, hour);
    const classification: Disposition = connected
      ? pick(r, ["PTP", "PTP", "Paid", "Partial", "Callback", "Callback", "Dispute", "Escalated"] as const)
      : "No Contact";
    calls.push({
      id: `C${++seq}`,
      ts: new Date(ts).toISOString(),
      phone: b.phone,
      loanId: b.loanId,
      callId: `call_${(100000 + seq * 7919).toString(36)}`,
      campaign: camp.code,
      product: b.product,
      portfolio: b.portfolio,
      channel: camp.channel,
      durationSec: connected ? 25 + Math.floor(r() * 260) : Math.floor(r() * 18),
      classification,
      connected,
      dropReason: connected ? undefined : pick(r, NO_CONTACT),
      attemptNo,
      visible: r() > 0.07,
      language: camp.language === "Multilingual" ? b.language : camp.language,
      disclosed: camp.channel === "Human Desk" ? true : r() > 0.03,
    });
  };
  for (let day = 44; day >= 0; day--) {
    const midnight = istMidnight(now - day * DAY);
    const sunday = new Date(midnight + 330 * 60_000).getUTCDay() === 0;
    const perDay = Math.round((70 + r() * 50) * (sunday ? 0.45 : 1));
    const attempts = new Map<string, number>();
    const slot = (b: Borrower, hour: number) => {
      const ts = midnight + hour * 3_600_000;
      if (ts > now || (b.dnd && r() < 0.93)) return;
      const n = (attempts.get(b.id) ?? 0) + 1;
      attempts.set(b.id, n);
      pushCall(b, ts, n);
    };
    for (let k = 0; k < perDay; k++) {
      const b = borrowers[Math.floor(r() * borrowers.length)];
      const hour = r() < 0.006 ? pick(r, [7.4, 7.75, 19.2, 19.6, 20.1]) : 9 + r() * 10; // a handful fall outside the window
      slot(b, hour);
    }
    if (r() < 0.35) { // an over-eager retry burst: a compliance flag to find
      const b = borrowers[Math.floor(r() * borrowers.length)];
      const start = 10 + r() * 4;
      for (let k = 0; k < 4; k++) slot(b, start + k * 0.9);
    }
  }
  calls.sort((a, b) => b.ts.localeCompare(a.ts));

  // Messages: WhatsApp, SMS and email touches with engagement that follows each borrower's preferences.
  const touches: Touch[] = [];
  let tseq = 0;
  for (const b of borrowers) {
    const n = 2 + Math.floor(r() * 5);
    const first = b.name.split(" ")[0];
    for (let k = 0; k < n; k++) {
      const ts = istMidnight(now - Math.floor(r() * 44) * DAY) + (10 + r() * 9) * 3_600_000;
      if (ts > now) continue;
      const channel = weighted(r, [["WhatsApp", 55], ["SMS", 25], ["Email", 20]] as [Touch["channel"], number][]);
      if (channel === "WhatsApp" && !b.waConsent && r() < 0.85) continue;
      const template = b.segment === "Pre Due"
        ? pick(r, ["EMI reminder", "Payment link"])
        : pick(r, b.ptpDate ? ["PTP reminder", "Payment link", "Overdue notice"] : ["Overdue notice", "Payment link"]);
      const likesWa = b.prefChannel === "WhatsApp";
      let status: TouchStatus;
      if (channel === "WhatsApp") {
        status = r() < 0.03 ? "Failed" : "Delivered";
        if (status === "Delivered" && r() < (likesWa ? 0.9 : 0.6)) status = "Read";
        if (status === "Read" && template === "Payment link" && r() < 0.4) status = "Clicked";
        if (status === "Read" && r() < (likesWa ? 0.5 : 0.15)) status = "Replied";
      } else if (channel === "SMS") {
        status = r() < 0.15 ? "Clicked" : "Delivered";
      } else {
        status = r() < 0.3 ? (r() < 0.35 ? "Clicked" : "Opened") : "Sent";
      }
      const { text, language } = renderMessage(template as TemplateName, b.language, {
        first, product: b.product, amt: `₹${b.emi.toLocaleString("en-IN")}`, link: `pay.kollect.in/${b.loanId.slice(-6)}`, dpd: b.dpd, lender: b.portfolio,
      });
      touches.push({ id: `T${++tseq}`, ts: new Date(ts).toISOString(), loanId: b.loanId, channel, template, status, text, language });
    }
  }
  touches.sort((a, b) => b.ts.localeCompare(a.ts));

  // Follow-ups the borrowers asked for.
  const followUps: FollowUp[] = [];
  let fseq = 0;
  for (const b of borrowers) {
    const wants = b.disposition === "Callback" || (b.disposition === "PTP" && r() < 0.3) || (b.disposition === "Escalated" && r() < 0.4);
    if (!wants) continue;
    const offset = Math.round(between(r, -6, 15));
    const note = pick(r, FOLLOWUP_NOTES);
    const at = followupSlot(note, b.prefBand, now, r, offset);
    const requestedAt = Math.min(now, at - between(r, /next week/i.test(note) ? 7 : 1, /next week/i.test(note) ? 9 : 4) * DAY);
    followUps.push({
      id: `F${++fseq}`,
      borrowerId: b.id,
      loanId: b.loanId,
      name: b.name,
      portfolio: b.portfolio,
      product: b.product,
      at: new Date(at).toISOString(),
      requestedAt: new Date(requestedAt).toISOString(),
      requestedVia: b.disposition === "Escalated" ? "Human Desk" : pick(r, ["AI Voice", "AI Voice", "WhatsApp"] as const),
      note,
      status: at > now ? "Scheduled" : r() < 0.75 ? "Done" : "Missed",
    });
  }
  followUps.sort((a, b) => a.at.localeCompare(b.at));

  const agents: Agent[] = camps.map((c, k) => ({ ...makeAgent(c, `A${k + 1}`, def.label), resolved: Math.floor(r() * 4), open: Math.floor(r() * 3) }));
  const lines = Object.fromEntries(COMM_CHANNELS.map((c) => [c.key, { lines: DEFAULT_LINES[c.key], live: 0 }])) as Store["lines"];

  const byLoan = new Map(borrowers.map((b) => [b.loanId, b]));
  const events: LiveEvent[] = calls.slice(0, 12).reverse().map((c, k) => {
    const b = byLoan.get(c.loanId)!;
    return {
      id: k + 1, ts: c.ts, type: "call", portfolio: c.portfolio, borrowerId: b.id, loanId: c.loanId,
      title: `${b.name} · ${c.connected ? c.classification : "No answer"}`,
      detail: `${c.campaign} · ${c.connected ? `${Math.floor(c.durationSec / 60)}:${String(c.durationSec % 60).padStart(2, "0")}` : c.dropReason}`,
    };
  });

  const grievances: Grievance[] = [];
  const complainers = borrowers.filter((b) => b.disposition === "Dispute" || b.disposition === "Escalated").slice(0, 9);
  complainers.forEach((b, k) => {
    const raised = now - between(r, 1, 38) * DAY;
    const status = k % 3 === 0 ? "Resolved" : k % 3 === 1 ? "In progress" : "Open";
    grievances.push({
      id: `G${k + 1}`, borrowerId: b.id, loanId: b.loanId, name: b.name, portfolio: b.portfolio, product: b.product,
      category: CATEGORY_FOR_REASON[b.escalationReason ?? ""] ?? "Wrong amount or charges", detail: b.escalationReason ?? "Borrower disputes the amount shown on the reminder.",
      raisedAt: new Date(raised).toISOString(), dueAt: new Date(raised + GRIEVANCE_SLA_DAYS * DAY).toISOString(), status,
      resolvedAt: status === "Resolved" ? new Date(Math.min(now, raised + between(r, 2, 20) * DAY)).toISOString() : undefined,
      resolution: status === "Resolved" ? "Reviewed with the borrower and corrected the account." : undefined, raisedBy: "supervisor",
    });
  });

  const store: Store = {
    v: STORE_VERSION,
    scenario,
    portfolios: def.portfolios,
    products: def.products.map((p) => p.name),
    borrowers, calls, touches, followUps, agents,
    lines,
    recoveryTargetPct: 7,
    compliance: { windowStart: 8, windowEnd: 19, maxPerDay: 3, maxPerWeek: 10, respectDnd: true, requireWaConsent: true },
    languages: [...languages],
    grievances,
    grievanceSeq: grievances.length,
    gro: { ...DEFAULT_GRO },
    events,
    eventSeq: events.length,
    audit: [],
    auditSeq: 0,
    demo: { live: true, lastTick: now },
    source: "mock",
    updatedAt: new Date(now).toISOString(),
  };
  rebalance(store);
  for (const a of store.agents) a.live = Math.floor(a.max * (0.35 + r() * 0.35));
  for (const c of COMM_CHANNELS) if (!c.agentChannel) store.lines[c.key].live = Math.floor(store.lines[c.key].lines * c.perLine * (0.35 + r() * 0.35));
  return store;
}

export const todayKey = (now = Date.now()) => istDay(now);
