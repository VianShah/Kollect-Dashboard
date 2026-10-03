import type {
  Agent, Borrower, Bucket, Call, Channel, Disposition, FollowUp, LinkStatus, LiveEvent, ScenarioKey, Segment, Store, Touch, TouchStatus,
} from "./types";
import { BANDS, DAY, istDay, istMidnight } from "./time";

export const STORE_VERSION = 2;

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
      { name: "Personal Loan", code: "PL", emi: [4000, 30000], tenor: [3, 12] },
      { name: "Two-Wheeler Loan", code: "TW", emi: [2500, 6500], tenor: [4, 14] },
      { name: "Gold Loan", code: "GL", emi: [3000, 15000], tenor: [2, 6] },
      { name: "MSME Loan", code: "MSME", emi: [15000, 60000], tenor: [4, 12] },
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

export interface CampaignDef { code: string; product: string; channel: Channel; language: string; stage: "predue" | "pd30" | "pd90" | "esc" }
export function campaignsFor(s: ScenarioKey): CampaignDef[] {
  const out: CampaignDef[] = [];
  for (const p of SCENARIOS[s].products) {
    out.push({ code: `KOLLECT_${p.code}_PREDUE_WA`, product: p.name, channel: "WhatsApp", language: "Hindi/English", stage: "predue" });
    out.push({ code: `KOLLECT_${p.code}_PD30_VOICE_HI`, product: p.name, channel: "AI Voice", language: "Hindi", stage: "pd30" });
    out.push({ code: `KOLLECT_${p.code}_PD30_VOICE_EN`, product: p.name, channel: "AI Voice", language: "English", stage: "pd30" });
    out.push({ code: `KOLLECT_${p.code}_PD90_VOICE_HI`, product: p.name, channel: "AI Voice", language: "Hindi", stage: "pd90" });
  }
  out.push({ code: "KOLLECT_ESC_HUMAN", product: "All", channel: "Human Desk", language: "Multi", stage: "esc" });
  return out;
}

export function pickCampaign(b: Borrower, camps: CampaignDef[], r: R): CampaignDef {
  const mine = camps.filter((c) => c.product === b.product);
  const voice = (stage: "pd30" | "pd90") =>
    mine.find((c) => c.stage === stage && c.language === b.language) ?? mine.find((c) => c.stage === "pd30" && c.language === b.language) ?? mine[1];
  if (b.disposition === "Escalated" && r() < 0.5) return camps[camps.length - 1];
  if (b.segment === "Pre Due") return r() < 0.6 ? mine.find((c) => c.stage === "predue")! : voice("pd30");
  if (b.segment === "Post Due (0–30)") return r() < 0.2 ? mine.find((c) => c.stage === "predue")! : voice("pd30");
  return voice("pd90");
}

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

export const bucketOf = (dpd: number): Bucket => (dpd <= 0 ? "Current" : dpd <= 30 ? "1–30" : dpd <= 60 ? "31–60" : "61–90");
const PREV_BUCKET: Record<Bucket, [Bucket, number][]> = {
  Current: [["Current", 88], ["1–30", 10], ["31–60", 2]],
  "1–30": [["Current", 14], ["1–30", 66], ["31–60", 20]],
  "31–60": [["1–30", 35], ["31–60", 50], ["61–90", 15]],
  "61–90": [["31–60", 40], ["61–90", 55], ["1–30", 5]],
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

export function connectChance(b: Borrower, channel: Channel, hour: number) {
  const inBand = inPrefBand(b, hour);
  let p = channel === "WhatsApp" ? (inBand ? 0.88 : 0.66) : inBand ? 0.86 : 0.52;
  if (channel !== "WhatsApp" && b.prefChannel === "WhatsApp") p *= 0.75;
  return p;
}

export function generateStore(scenario: ScenarioKey = "nbfc", now = Date.now()): Store {
  const def = SCENARIOS[scenario];
  const r = rng(def.seed);
  const camps = campaignsFor(scenario);
  const borrowers: Borrower[] = [];

  for (let i = 0; i < 600; i++) {
    const product = weighted(r, def.products.map((p, k) => [p, 4 - Math.min(k, 2)] as [ProductDef, number]));
    const segment: Segment = pick(r, ["Pre Due", "Post Due (0–30)", "Post Due (0–30)", "Post Due (30–90)"] as const);
    const dpd = segment === "Pre Due" ? 0 : segment === "Post Due (0–30)" ? 1 + Math.floor(r() * 29) : 31 + Math.floor(r() * 59);
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

    const prefChannel: Channel = r() < 0.35 ? "WhatsApp" : "AI Voice";
    const channel: Channel = disposition === "Escalated" ? "Human Desk" : prefChannel;
    let paymentLink: LinkStatus = "Not shared";
    if (stage >= 2) paymentLink = stage === 4 && r() < 0.55 ? "Paid via link" : pick(r, ["Shared", "Link clicked", "Not shared"] as const);
    const recoveredAmount = stage === 4 ? Math.round(outstanding * (0.5 + r() * 0.5)) : disposition === "Partial" ? Math.round(outstanding * 0.25) : 0;
    const phoneFull = `+91 ${pick(r, ["98", "97", "96", "93", "90", "88", "79", "70"])}${digits(r, 3)} ${digits(r, 5)}`;
    const current = bucketOf(dpd);
    borrowers.push({
      id: `B${1000 + i}`,
      name: `${pick(r, FIRST)} ${pick(r, LAST)}`,
      phone: maskPhone(phoneFull),
      phoneFull,
      loanId: `LN${String(2024000000 + Math.floor(r() * 999999))}`,
      product: product.name,
      segment,
      portfolio: pick(r, def.portfolios),
      region: pick(r, REGIONS),
      language: r() < 0.65 ? "Hindi" : "English",
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
      ptpOutcome: stage === 3 ? pick(r, ["pending", "pending", "kept", "broken"] as const) : stage === 4 ? "kept" : undefined,
      recoveredAmount,
      recoveredAt: recoveredAmount ? new Date(now - Math.pow(r(), 1.35) * 58 * DAY).toISOString() : undefined,
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
      const amt = `₹${b.emi.toLocaleString("en-IN")}`;
      const text = {
        "EMI reminder": `Hi ${first}, your ${b.product} EMI of ${amt} is due on the 5th.`,
        "Payment link": `Hi ${first}, pay your ${amt} ${b.product} EMI securely: pay.kollect.in/${b.loanId.slice(-6)}`,
        "PTP reminder": `Hi ${first}, a reminder of your promise to pay ${amt}. Pay here: pay.kollect.in/${b.loanId.slice(-6)}`,
        "Overdue notice": `Hi ${first}, your ${b.product} account is ${b.dpd} days overdue. Please pay ${amt} to avoid further charges.`,
      }[template]!;
      touches.push({ id: `T${++tseq}`, ts: new Date(ts).toISOString(), loanId: b.loanId, channel, template, status, text });
    }
  }
  touches.sort((a, b) => b.ts.localeCompare(a.ts));

  // Follow-ups the borrowers asked for.
  const followUps: FollowUp[] = [];
  let fseq = 0;
  for (const b of borrowers) {
    const wants = b.disposition === "Callback" || (b.disposition === "PTP" && r() < 0.3) || (b.disposition === "Escalated" && r() < 0.4);
    if (!wants) continue;
    const band = BANDS[b.prefBand ?? 4];
    const offset = Math.round(between(r, -6, 15));
    const at = istMidnight(now + offset * DAY) + (band.from + r() * (band.to - band.from - 0.5)) * 3_600_000;
    const requestedAt = Math.min(now, at - between(r, 1, 4) * DAY);
    followUps.push({
      id: `F${++fseq}`,
      borrowerId: b.id,
      loanId: b.loanId,
      name: b.name,
      portfolio: b.portfolio,
      product: b.product,
      at: new Date(Math.round(at / 900_000) * 900_000).toISOString(),
      requestedAt: new Date(requestedAt).toISOString(),
      requestedVia: b.disposition === "Escalated" ? "Human Desk" : pick(r, ["AI Voice", "AI Voice", "WhatsApp"] as const),
      note: pick(r, FOLLOWUP_NOTES),
      status: at > now ? "Scheduled" : r() < 0.75 ? "Done" : "Missed",
    });
  }
  followUps.sort((a, b) => a.at.localeCompare(b.at));

  const agents: Agent[] = camps.map((c, k) => {
    const max = c.stage === "esc" ? 5 : c.stage === "pd90" ? 2 : 3;
    return {
      id: `A${k + 1}`,
      name: c.stage === "esc" ? "Human desk" : c.channel === "WhatsApp" ? `${c.product} · WhatsApp bot` : `${c.product} · Voice ${c.language === "Hindi" ? "HI" : "EN"}${c.stage === "pd90" ? " (30–90)" : ""}`,
      code: c.code,
      business: def.label,
      product: c.product,
      language: c.language,
      voice: c.channel === "AI Voice" ? (c.language === "Hindi" ? "Aarohi" : "Ethan") : "—",
      channel: c.channel,
      live: Math.floor(r() * (max + 1)),
      max,
      resolved: Math.floor(r() * 4),
      open: Math.floor(r() * 3),
    };
  });
  const totalMax = agents.reduce((s, a) => s + a.max, 0);

  const byLoan = new Map(borrowers.map((b) => [b.loanId, b]));
  const events: LiveEvent[] = calls.slice(0, 12).reverse().map((c, k) => {
    const b = byLoan.get(c.loanId)!;
    return {
      id: k + 1, ts: c.ts, type: "call", portfolio: c.portfolio, borrowerId: b.id, loanId: c.loanId,
      title: `${b.name} · ${c.connected ? c.classification : "No answer"}`,
      detail: `${c.campaign} · ${c.connected ? `${Math.floor(c.durationSec / 60)}:${String(c.durationSec % 60).padStart(2, "0")}` : c.dropReason}`,
    };
  });

  return {
    v: STORE_VERSION,
    scenario,
    portfolios: def.portfolios,
    products: def.products.map((p) => p.name),
    borrowers, calls, touches, followUps, agents,
    globalMax: Math.round(totalMax * 0.8),
    recoveryTargetPct: 7,
    compliance: { windowStart: 8, windowEnd: 19, maxPerDay: 3, maxPerWeek: 10, respectDnd: true, requireWaConsent: true },
    events,
    eventSeq: events.length,
    audit: [],
    auditSeq: 0,
    demo: { live: true, lastTick: now },
    source: "mock",
    updatedAt: new Date(now).toISOString(),
  };
}

export const todayKey = (now = Date.now()) => istDay(now);
