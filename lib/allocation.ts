// The allocation file a lender hands over for a campaign, and what Kollect works out from it before anything is sent:
// which column is which, how risky each borrower is (and why), the segments, and the language to use.
import type { Borrower, Bucket, ChannelKind, TierKey } from "./types";
import { bucketOf } from "./mock";

// ---------- Borrower persona: behaviour the file carries besides the dues ----------

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };

const STATES: Record<string, [string, string, string][]> = {
  // language → [state, city, pincode prefix]
  Hindi: [["Uttar Pradesh", "Lucknow", "226"], ["Madhya Pradesh", "Indore", "452"], ["Rajasthan", "Jaipur", "302"], ["Bihar", "Patna", "800"], ["Delhi", "New Delhi", "110"]],
  Punjabi: [["Punjab", "Ludhiana", "141"], ["Punjab", "Amritsar", "143"]],
  Marathi: [["Maharashtra", "Pune", "411"], ["Maharashtra", "Nagpur", "440"], ["Maharashtra", "Mumbai", "400"]],
  Gujarati: [["Gujarat", "Ahmedabad", "380"], ["Gujarat", "Surat", "395"]],
  Tamil: [["Tamil Nadu", "Chennai", "600"], ["Tamil Nadu", "Coimbatore", "641"]],
  Telugu: [["Telangana", "Hyderabad", "500"], ["Andhra Pradesh", "Vijayawada", "520"]],
  Kannada: [["Karnataka", "Mysuru", "570"], ["Karnataka", "Bengaluru", "560"]],
  Malayalam: [["Kerala", "Kochi", "682"], ["Kerala", "Thiruvananthapuram", "695"]],
  Bengali: [["West Bengal", "Kolkata", "700"], ["West Bengal", "Howrah", "711"]],
};
const ENGLISH_CITY: Record<string, [string, string, string]> = {
  North: ["Delhi", "New Delhi", "110"], South: ["Karnataka", "Bengaluru", "560"], East: ["West Bengal", "Kolkata", "700"], West: ["Maharashtra", "Mumbai", "400"],
};
const METROS = new Set(["New Delhi", "Bengaluru", "Kolkata", "Mumbai", "Chennai", "Hyderabad", "Pune"]);
const STATE_LANGUAGE: Record<string, string> = {
  "Uttar Pradesh": "Hindi", "Madhya Pradesh": "Hindi", Rajasthan: "Hindi", Bihar: "Hindi", Delhi: "Hindi", Haryana: "Hindi",
  Punjab: "Punjabi", Maharashtra: "Marathi", Gujarat: "Gujarati", "Tamil Nadu": "Tamil", Telangana: "Telugu", "Andhra Pradesh": "Telugu",
  Karnataka: "Kannada", Kerala: "Malayalam", "West Bengal": "Bengali",
};

export interface Persona {
  latePayments: number;   // EMIs paid late in the last 12 months
  loansHeld: number;      // active loans with any lender (bureau)
  state: string; city: string; pincode: string;
  dueDay: number;         // day of the month the EMI falls due
  monthsOnBook: number;
}

/** Stable, realistic behaviour for a demo borrower: worse bureau scores and later accounts have more late payments. */
export function personaOf(b: Borrower): Persona {
  const r = (k: string) => hash(`${b.id}:${k}`);
  const stress = Math.min(1, (Math.max(0, 760 - b.experian) / 260) * 0.6 + (Math.min(b.dpd, 120) / 120) * 0.4);
  const latePayments = Math.min(12, Math.floor(stress * 5 + r("late") * 1.6 + (b.ptpOutcome === "broken" ? 1 : 0)));
  const loansHeld = 1 + Math.floor(r("loans") * (b.experian < 650 ? 4 : 3));
  const [state, city, pin] = b.language === "English" ? ENGLISH_CITY[b.region] ?? ENGLISH_CITY.West : (STATES[b.language] ?? STATES.Hindi)[Math.floor(r("state") * (STATES[b.language] ?? STATES.Hindi).length)];
  return {
    latePayments, loansHeld, state, city, pincode: `${pin}${String(Math.floor(r("pin") * 900) + 100)}`,
    dueDay: [1, 5, 7, 10, 15][Math.floor(r("due") * 5)], monthsOnBook: 3 + Math.floor(r("mob") * 30),
  };
}

/** Language from where the borrower lives: the state's language, or English in a metro for card and prime borrowers. */
export function guessLanguage(p: Pick<Persona, "state" | "city">, b?: Pick<Borrower, "product" | "experian">): { language: string; why: string } {
  if (METROS.has(p.city) && b && (b.product === "Credit Card" || b.experian >= 760)) return { language: "English", why: `${p.city} metro, ${b.product === "Credit Card" ? "card holder" : "prime bureau score"}` };
  const lang = STATE_LANGUAGE[p.state];
  return lang ? { language: lang, why: `Lives in ${p.state}` } : { language: "Hindi", why: "State not recognised; Hindi as the default" };
}

// ---------- Column matching ----------

export interface FieldDef { key: string; label: string; required?: boolean; aliases: string[]; kind: "id" | "text" | "phone" | "amount" | "number" | "date" | "location" }
export const ALLOCATION_FIELDS: FieldDef[] = [
  { key: "loanId", label: "Loan ID", required: true, kind: "id", aliases: ["loanid", "loanno", "loannumber", "accountno", "accountnumber", "lan", "agreementno"] },
  { key: "name", label: "Borrower name", required: true, kind: "text", aliases: ["name", "borrowername", "customername", "custname", "fullname"] },
  { key: "phone", label: "Mobile number", required: true, kind: "phone", aliases: ["phone", "mobile", "mobileno", "mobilenumber", "phonenumber", "contactno", "msisdn"] },
  { key: "product", label: "Product", kind: "text", aliases: ["product", "productname", "loantype", "scheme"] },
  { key: "outstanding", label: "Outstanding", required: true, kind: "amount", aliases: ["outstanding", "pos", "principaloutstanding", "totaloutstanding", "tos", "outstandingamount"] },
  { key: "emi", label: "EMI / amount due", kind: "amount", aliases: ["emi", "emiamount", "amountdue", "overdueamount", "dueamount", "minimumdue"] },
  { key: "dpd", label: "Days past due", required: true, kind: "number", aliases: ["dpd", "dayspastdue", "overduedays", "currentdpd"] },
  { key: "bucket", label: "DPD bucket", kind: "text", aliases: ["bucket", "dpdbucket", "segment"] },
  { key: "bureau", label: "Credit score", kind: "number", aliases: ["experian", "creditscore", "bureauscore", "cibil", "cibilscore", "score"] },
  { key: "latePayments", label: "Late payments (12 months)", kind: "number", aliases: ["latepayments", "latepayments12m", "bounces", "bouncecount", "emibounces", "delinquencies"] },
  { key: "loansHeld", label: "Loans held", kind: "number", aliases: ["loansheld", "activeloans", "noofloans", "numberofloans", "totalloans"] },
  { key: "dueDate", label: "EMI due date", kind: "date", aliases: ["duedate", "emidate", "emiduedate", "nextduedate"] },
  { key: "state", label: "State", kind: "location", aliases: ["state", "statename"] },
  { key: "city", label: "City", kind: "location", aliases: ["city", "district", "town"] },
  { key: "pincode", label: "Pincode", kind: "location", aliases: ["pincode", "pin", "zip", "postalcode"] },
  { key: "language", label: "Language", kind: "text", aliases: ["language", "preferredlanguage", "lang"] },
];
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export interface ColumnMatch { column: string; field: string | null; how: "name" | "values" | "none"; sample: string }

/** Matches each column by its header, then by what its values look like (phone numbers, loan IDs, scores, DPD). */
export function matchColumns(headers: string[], rows: string[][]): ColumnMatch[] {
  const used = new Set<string>();
  const col = (i: number) => rows.slice(0, 50).map((r) => String(r[i] ?? "").trim()).filter(Boolean);
  const out: ColumnMatch[] = headers.map((h, i) => {
    const f = ALLOCATION_FIELDS.find((x) => !used.has(x.key) && x.aliases.includes(norm(h)));
    if (f) used.add(f.key);
    return { column: h, field: f?.key ?? null, how: f ? "name" : "none", sample: col(i).slice(0, 3).join(" · ") };
  });
  out.forEach((m, i) => {
    if (m.field) return;
    const v = col(i);
    if (!v.length) return;
    const all = (t: (s: string) => boolean) => v.every(t);
    const nums = v.map((s) => Number(s.replace(/[₹,\s]/g, "")));
    const guess =
      all((s) => { const d = s.replace(/\D/g, ""); return d.length >= 10 && d.length <= 12; }) ? "phone"
      : all((s) => /^[A-Z]{2,4}\d{6,}$/i.test(s)) ? "loanId"
      : nums.every((n) => Number.isFinite(n) && n >= 300 && n <= 900) ? "bureau"
      : nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 999) && nums.some((n) => n > 12) ? "dpd"
      : all((s) => /^\d{6}$/.test(s)) ? "pincode"
      : null;
    if (guess && !used.has(guess)) { used.add(guess); m.field = guess; m.how = "values"; }
  });
  return out;
}
export const missingRequired = (cols: ColumnMatch[]) => ALLOCATION_FIELDS.filter((f) => f.required && !cols.some((c) => c.field === f.key));

/** The demo allocation file for a company: the columns a lender usually sends. */
export const DEMO_HEADERS = ["Loan No", "Customer Name", "Mobile No", "Product", "POS", "EMI Amount", "DPD", "CIBIL Score", "EMI Bounces", "Active Loans", "EMI Due Date", "City", "State", "Pincode"];
export function demoRow(b: Borrower): string[] {
  const p = personaOf(b);
  return [b.loanId, b.name, b.phone, b.product, String(b.outstanding), String(b.emi), String(b.dpd), String(b.experian), String(p.latePayments), String(p.loansHeld), `${String(p.dueDay).padStart(2, "0")}/${String(new Date().getMonth() + 1).padStart(2, "0")}/${new Date().getFullYear()}`, p.city, p.state, p.pincode];
}

// ---------- Risk: borrower behaviour only ----------

export interface RiskRules {
  bureauBelow: number;   // a score under this counts against the borrower
  dpdAbove: number;      // more days late than this counts against them
  lateAtLeast: number;   // this many late EMIs in 12 months counts against them
  loansAtLeast: number;  // holding this many loans makes the account high priority
}
export const DEFAULT_RULES: RiskRules = { bureauBelow: 650, dpdAbove: 60, lateAtLeast: 3, loansAtLeast: 3 };

export interface RiskVerdict { tier: TierKey; points: number; reasons: string[]; priority: "High" | "Normal" }

/**
 * Points from three behaviours. Credit score: 2 under the threshold, 1 within 70 of it.
 * Days late: 2 over the threshold, 1 over half of it. Late EMIs: 2 at the threshold, 1 for one or two.
 * A broken promise adds 1. High risk at 4 or more, medium at 2 or 3.
 */
export function riskOf(b: Borrower, p: Persona, r: RiskRules, medianOutstanding = 0): RiskVerdict {
  const reasons: string[] = [];
  let pts = 0;
  if (b.experian < r.bureauBelow) { pts += 2; reasons.push(`Credit score ${b.experian}, under ${r.bureauBelow}`); }
  else if (b.experian < r.bureauBelow + 70) { pts += 1; reasons.push(`Credit score ${b.experian}, borderline`); }
  if (b.dpd > r.dpdAbove) { pts += 2; reasons.push(`${b.dpd} days late`); }
  else if (b.dpd > r.dpdAbove / 2) { pts += 1; reasons.push(`${b.dpd} days late`); }
  if (p.latePayments >= r.lateAtLeast) { pts += 2; reasons.push(`${p.latePayments} late EMIs in 12 months`); }
  else if (p.latePayments > 0) { pts += 1; reasons.push(`${p.latePayments} late EMI${p.latePayments === 1 ? "" : "s"} in 12 months`); }
  if (b.ptpOutcome === "broken") { pts += 1; reasons.push("Broke a promise to pay"); }
  if (!reasons.length) reasons.push("Good credit score, pays on time");
  const priority = p.loansHeld >= r.loansAtLeast || (medianOutstanding > 0 && b.outstanding > medianOutstanding * 2) ? "High" : "Normal";
  return { tier: pts >= 4 ? "High" : pts >= 2 ? "Medium" : "Low", points: pts, reasons, priority };
}

// ---------- Segments: DPD bucket from the file × risk ----------

export const BUCKETS: Bucket[] = ["Current", "1–30", "31–60", "61–90", "90+"];
export const BUCKET_LABEL: Record<Bucket, string> = { Current: "Pre-due", "1–30": "1–30 DPD", "31–60": "31–60 DPD", "61–90": "61–90 DPD", "90+": "90+ DPD" };
export const segmentKey = (bucket: Bucket, tier: TierKey) => `${bucket}|${tier}`;
export const parseSegmentKey = (k: string) => { const [bucket, tier] = k.split("|") as [Bucket, TierKey]; return { bucket, tier }; };
export const segmentName = (k: string) => { const { bucket, tier } = parseSegmentKey(k); return `${BUCKET_LABEL[bucket]} · ${tier} risk`; };
export const bucketFor = (b: Borrower) => bucketOf(b.dpd);

/**
 * The starting channel mix for a segment: gentle and cheap early and for good payers, people for the late and risky.
 * Every segment gets its own mix; high-priority accounts inside it can also go to telecallers first.
 */
export function suggestChannels(bucket: Bucket, tier: TierKey): ChannelKind[] {
  const late = BUCKETS.indexOf(bucket); // 0 pre-due … 4 = 90+
  if (late === 0) return tier === "High" ? ["whatsapp", "voice"] : tier === "Medium" ? ["whatsapp", "ivr"] : ["whatsapp"];
  if (late === 1) return tier === "High" ? ["voice", "telecaller"] : tier === "Medium" ? ["whatsapp", "voice"] : ["whatsapp", "ivr"];
  if (late === 2) return tier === "Low" ? ["whatsapp", "voice"] : tier === "Medium" ? ["voice", "whatsapp"] : ["telecaller", "voice"];
  return tier === "Low" ? ["voice", "whatsapp"] : ["telecaller", "voice", "whatsapp"];
}
