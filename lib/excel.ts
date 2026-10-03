import * as XLSX from "xlsx";
import type { Agent, Borrower, Call, Channel, Disposition, FollowUp, LinkStatus, Segment, Store, Touch, TouchStatus } from "./types";
import { bucketOf, maskPhone } from "./mock";
import { computeBorrowerProfile } from "./metrics";

type Row = Record<string, unknown>;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// canonical field -> accepted header aliases (normalised)
const ALIASES: Record<string, string[]> = {
  id: ["id", "borrowerid", "customerid"],
  name: ["name", "borrowername", "customername"],
  phone: ["phone", "mobile", "phonenumber", "mobilenumber"],
  loanId: ["loanid", "loanno", "loannumber", "accountno"],
  product: ["product", "productname", "loantype"],
  segment: ["segment", "bucket"],
  portfolio: ["portfolio", "client", "lender"],
  region: ["region", "zone"],
  language: ["language", "preferredlanguage"],
  emi: ["emi", "emiamount"],
  outstanding: ["outstanding", "pos", "principaloutstanding", "outstandingamount"],
  dpd: ["dpd", "dayspastdue"],
  prevDpd: ["prevdpd", "previousdpd", "lastmonthdpd", "dpdlastmonth"],
  disposition: ["disposition", "status", "classification", "outcome"],
  paymentLink: ["paymentlink", "paymentlinkstatus", "linkstatus"],
  experian: ["experian", "experianscore", "creditscore", "bureauscore"],
  channel: ["channel"],
  dnd: ["donotcall", "dnc", "dnd", "ondnd"],
  waConsent: ["whatsappconsent", "waconsent", "consent", "optin"],
  ptpDate: ["ptpdate", "promisedate"],
  ptpAmount: ["ptpamount", "promiseamount"],
  recoveredAmount: ["recoveredamount", "recovered", "collected", "collectedamount"],
  recoveredAt: ["recoveredat", "recoverydate", "collecteddate"],
  ts: ["ts", "timestamp", "datetime", "calltime", "senttime", "date"],
  callId: ["callid", "callref"],
  campaign: ["campaign", "campaigncode"],
  duration: ["duration", "durationsec", "durationseconds", "calldurationsec"],
  dropReason: ["dropreason", "dropoffreason", "reason", "disconnectreason"],
  attemptNo: ["attemptno", "attempt", "attemptnumber"],
  visible: ["visible", "clientvisible", "visibility"],
  template: ["template", "messagetype"],
  text: ["text", "message", "body"],
  at: ["at", "followupat", "callbackat", "scheduledfor"],
  note: ["note", "notes", "comment"],
  agentName: ["agentname", "agent"],
  code: ["code", "campaigncode"],
  voice: ["voice", "voicepersona", "persona"],
  live: ["live", "livecalls"],
  max: ["max", "maxcapacity", "capacity"],
};

function field(row: Row, f: string): unknown {
  const wanted = ALIASES[f] ?? [norm(f)];
  for (const k of Object.keys(row)) if (wanted.includes(norm(k))) return row[k];
  return undefined;
}
const str = (v: unknown, d = "") => (v == null || v === "" ? d : String(v).trim());
const numv = (v: unknown, d = 0) => { const n = Number(String(v ?? "").replace(/[₹,\s]/g, "")); return v !== "" && v != null && Number.isFinite(n) ? n : d; };
const yes = (v: unknown, d: boolean) => { const n = norm(str(v)); return n ? ["yes", "y", "true", "1", "registered"].includes(n) : d; };
const iso = (v: unknown): string | undefined => {
  if (v == null || v === "") return undefined;
  if (typeof v === "number") return new Date(Math.round((v - 25569) * 86400 * 1000) - 330 * 60_000).toISOString(); // Excel serial, read as IST
  const s = String(v).trim();
  const d = new Date(/^\d{4}-\d{2}-\d{2}( |T)\d{2}:\d{2}(:\d{2})?$/.test(s) ? `${s.replace(" ", "T")}+05:30` : /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T10:00:00+05:30` : s);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
};

const DISPOSITIONS: Disposition[] = ["Paid", "PTP", "Partial", "Callback", "Dispute", "No Contact", "Escalated"];
const toDisposition = (v: unknown): Disposition => {
  const n = norm(str(v));
  return DISPOSITIONS.find((x) => norm(x) === n) ?? (n.includes("nocontact") || n.includes("noanswer") ? "No Contact" : "Callback");
};
const toChannel = (v: unknown): Channel => {
  const n = norm(str(v));
  return n.includes("whatsapp") || n === "wa" ? "WhatsApp" : n.includes("human") || n.includes("desk") ? "Human Desk" : "AI Voice";
};
const toSegment = (v: unknown, dpd: number): Segment => {
  const n = norm(str(v));
  if (n.includes("pre")) return "Pre Due";
  if (n.includes("3090")) return "Post Due (30–90)";
  if (n.includes("030")) return "Post Due (0–30)";
  return dpd <= 0 ? "Pre Due" : dpd <= 30 ? "Post Due (0–30)" : "Post Due (30–90)";
};
const toLink = (v: unknown): LinkStatus => {
  const n = norm(str(v));
  return n.includes("paid") ? "Paid via link" : n.includes("click") ? "Link clicked" : n.includes("shared") || n === "sent" ? "Shared" : "Not shared";
};
const TOUCH_STATUSES: TouchStatus[] = ["Sent", "Delivered", "Read", "Opened", "Clicked", "Replied", "Failed"];
const stageOf = (d: Disposition): Borrower["stage"] =>
  d === "Paid" ? 4 : d === "PTP" || d === "Partial" ? 3 : d === "Dispute" || d === "Escalated" ? 2 : d === "Callback" ? 1 : 0;

export interface SheetReport { sheet: string; rows: number; imported: number; errors: string[] }
export interface ParseResult {
  borrowers?: Borrower[]; calls?: Call[]; agents?: Agent[]; touches?: Touch[]; followUps?: FollowUp[];
  report: SheetReport[];
}

function sheet(wb: XLSX.WorkBook, ...names: string[]) {
  const key = wb.SheetNames.find((s) => names.some((n) => norm(s) === norm(n)));
  return key ? XLSX.utils.sheet_to_json<Row>(wb.Sheets[key], { defval: "" }) : undefined;
}

export function parseWorkbook(buf: Buffer): ParseResult {
  const wb = XLSX.read(buf, { type: "buffer" });
  const out: ParseResult = { report: [] };
  const run = <T,>(name: string, rows: Row[] | undefined, map: (row: Row, i: number) => T | string): T[] | undefined => {
    if (!rows) return undefined;
    const errors: string[] = [];
    const list: T[] = [];
    rows.forEach((row, i) => {
      const r = map(row, i);
      if (typeof r === "string") { if (errors.length < 10) errors.push(`Row ${i + 2}: ${r}`); } else list.push(r);
    });
    out.report.push({ sheet: name, rows: rows.length, imported: list.length, errors });
    return list;
  };

  out.borrowers = run("Borrowers", sheet(wb, "Borrowers", "Borrower"), (row, i) => {
    const loanId = str(field(row, "loanId")), outstanding = field(row, "outstanding");
    if (!loanId || outstanding === undefined || outstanding === "") return "missing LoanID or Outstanding";
    const dpd = numv(field(row, "dpd"));
    const disposition = toDisposition(field(row, "disposition"));
    const emi = numv(field(row, "emi"));
    const recoveredAmount = numv(field(row, "recoveredAmount"), disposition === "Paid" ? emi : 0);
    const rawPhone = str(field(row, "phone"));
    const prevDpd = field(row, "prevDpd");
    return {
      id: str(field(row, "id"), `B${i + 1}`),
      name: str(field(row, "name"), "Unknown"),
      phone: maskPhone(rawPhone),
      phoneFull: rawPhone.includes("•") ? undefined : rawPhone,
      loanId,
      product: str(field(row, "product"), "Loan"),
      segment: toSegment(field(row, "segment"), dpd),
      portfolio: str(field(row, "portfolio"), "Default"),
      region: str(field(row, "region"), "—"),
      language: str(field(row, "language"), "Hindi"),
      emi,
      outstanding: numv(outstanding),
      dpd,
      prevBucket: prevDpd === undefined || prevDpd === "" ? undefined : bucketOf(numv(prevDpd)),
      disposition,
      stage: stageOf(disposition),
      paymentLink: toLink(field(row, "paymentLink")),
      experian: numv(field(row, "experian"), 700),
      channel: toChannel(field(row, "channel")),
      dnd: yes(field(row, "dnd"), false),
      waConsent: yes(field(row, "waConsent"), true),
      ptpDate: iso(field(row, "ptpDate")),
      ptpAmount: numv(field(row, "ptpAmount")) || undefined,
      ptpOutcome: disposition === "PTP" ? "pending" : disposition === "Paid" ? "kept" : undefined,
      recoveredAmount,
      recoveredAt: iso(field(row, "recoveredAt")) ?? (recoveredAmount ? new Date().toISOString() : undefined),
      escalatedAt: disposition === "Escalated" ? new Date().toISOString() : undefined,
    } satisfies Borrower;
  });

  out.calls = run("Calls", sheet(wb, "Calls", "Call"), (row, i) => {
    const ts = iso(field(row, "ts"));
    if (!ts || !str(field(row, "campaign"))) return "missing or invalid Timestamp / Campaign";
    const classification = toDisposition(field(row, "disposition"));
    const durationSec = numv(field(row, "duration"));
    const connected = classification !== "No Contact" && durationSec > 0;
    return {
      id: `X${i + 1}`, ts,
      phone: maskPhone(str(field(row, "phone"))),
      loanId: str(field(row, "loanId")),
      callId: str(field(row, "callId"), `call_${i + 1}`),
      campaign: str(field(row, "campaign")),
      product: str(field(row, "product"), "Loan"),
      portfolio: str(field(row, "portfolio"), "Default"),
      channel: toChannel(field(row, "channel")),
      durationSec, classification, connected,
      dropReason: connected ? undefined : str(field(row, "dropReason"), "no_answer"),
      attemptNo: numv(field(row, "attemptNo"), 1),
      visible: yes(field(row, "visible"), true),
    } satisfies Call;
  })?.sort((a, b) => b.ts.localeCompare(a.ts));

  out.touches = run("Messages", sheet(wb, "Messages", "Message", "Touches"), (row, i) => {
    const ts = iso(field(row, "ts")), loanId = str(field(row, "loanId"));
    if (!ts || !loanId) return "missing Timestamp or LoanID";
    const ch = norm(str(field(row, "channel")));
    const status = TOUCH_STATUSES.find((s) => norm(s) === norm(str(field(row, "disposition")))) ?? "Delivered";
    return {
      id: `M${i + 1}`, ts, loanId,
      channel: ch.includes("sms") ? "SMS" : ch.includes("mail") ? "Email" : "WhatsApp",
      template: str(field(row, "template"), "Message"), status, text: str(field(row, "text")),
    } satisfies Touch;
  })?.sort((a, b) => b.ts.localeCompare(a.ts));

  const byLoan = new Map((out.borrowers ?? []).map((b) => [b.loanId, b]));
  out.followUps = run("FollowUps", sheet(wb, "FollowUps", "Follow-ups", "Callbacks"), (row, i) => {
    const at = iso(field(row, "at")), loanId = str(field(row, "loanId"));
    if (!at || !loanId) return "missing FollowUpAt or LoanID";
    const b = byLoan.get(loanId);
    const s = norm(str(field(row, "disposition")));
    return {
      id: `FU${i + 1}`, borrowerId: b?.id ?? loanId, loanId, name: b?.name ?? str(field(row, "name"), loanId),
      portfolio: b?.portfolio ?? "Default", product: b?.product ?? "Loan", at,
      requestedAt: iso(field(row, "ts")) ?? at, requestedVia: toChannel(field(row, "channel")), note: str(field(row, "note")),
      status: s === "done" ? "Done" : s === "missed" ? "Missed" : Date.parse(at) < Date.now() ? "Missed" : "Scheduled",
    } satisfies FollowUp;
  });

  out.agents = run("Agents", sheet(wb, "Agents", "Agent"), (row, i) => {
    const code = str(field(row, "code"));
    if (!code) return "missing Code";
    const max = numv(field(row, "max"), 10);
    return {
      id: `A${i + 1}`, name: str(field(row, "agentName"), code), code,
      business: str(field(row, "portfolio"), "Kollect"), product: str(field(row, "product"), "—"),
      language: str(field(row, "language"), "—"), voice: str(field(row, "voice"), "—"),
      channel: toChannel(field(row, "channel")), live: Math.min(numv(field(row, "live")), max), max, resolved: 0, open: 0,
    } satisfies Agent;
  });

  if (!out.report.length) out.report.push({ sheet: "(none)", rows: 0, imported: 0, errors: ["No sheets named Borrowers, Calls, Messages, FollowUps or Agents were found."] });
  return out;
}

export function buildTemplate(): Buffer {
  const wb = XLSX.utils.book_new();
  const add = (name: string, rows: Row[]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
  add("Borrowers", [
    { BorrowerID: "B1001", Name: "Aarav Sharma", Phone: "9876543210", LoanID: "LN2024000123", Product: "Personal Loan", Segment: "Post Due (0–30)", Portfolio: "Alpha NBFC", Region: "North", Language: "Hindi", EMI: 12500, Outstanding: 245000, DPD: 12, PrevDPD: 0, Disposition: "PTP", PaymentLink: "Link clicked", ExperianScore: 702, Channel: "AI Voice", DoNotCall: "no", WhatsAppConsent: "yes", PTPDate: "2026-10-10", PTPAmount: 12500, RecoveredAmount: 0, RecoveredAt: "" },
    { BorrowerID: "B1002", Name: "Priya Iyer", Phone: "9123456780", LoanID: "LN2024000456", Product: "Two-Wheeler Loan", Segment: "Pre Due", Portfolio: "Alpha NBFC", Region: "South", Language: "English", EMI: 8200, Outstanding: 98000, DPD: 0, PrevDPD: 14, Disposition: "Paid", PaymentLink: "Paid via link", ExperianScore: 781, Channel: "WhatsApp", DoNotCall: "no", WhatsAppConsent: "yes", PTPDate: "", PTPAmount: "", RecoveredAmount: 8200, RecoveredAt: "2026-10-02" },
  ]);
  add("Calls", [
    { Timestamp: "2026-10-02 11:20", LoanID: "LN2024000123", CallID: "call_abc123", Campaign: "KOLLECT_PL_PD30_VOICE_HI", Product: "Personal Loan", Portfolio: "Alpha NBFC", Channel: "AI Voice", DurationSec: 142, Disposition: "PTP", DropReason: "", AttemptNo: 2, Visible: "yes" },
    { Timestamp: "2026-10-02 11:42", LoanID: "LN2024000456", CallID: "call_abc124", Campaign: "KOLLECT_TW_PD30_VOICE_EN", Product: "Two-Wheeler Loan", Portfolio: "Alpha NBFC", Channel: "AI Voice", DurationSec: 0, Disposition: "No Contact", DropReason: "no_answer", AttemptNo: 1, Visible: "yes" },
  ]);
  add("Messages", [
    { Timestamp: "2026-10-01 18:05", LoanID: "LN2024000123", Channel: "WhatsApp", Template: "Payment link", Status: "Read", Text: "Hi Aarav, pay your ₹12,500 EMI securely: pay.kollect.in/000123" },
  ]);
  add("FollowUps", [
    { LoanID: "LN2024000123", FollowUpAt: "2026-10-09 18:00", Timestamp: "2026-10-02 11:20", Channel: "AI Voice", Note: "Call after salary credit", Status: "Scheduled" },
  ]);
  add("Agents", [
    { AgentName: "Personal Loan · Voice HI", Code: "KOLLECT_PL_PD30_VOICE_HI", Product: "Personal Loan", Language: "Hindi", Voice: "Aarohi", Channel: "AI Voice", Live: 0, Max: 3 },
  ]);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** Hand-off pack for the human desk: who, why, how to reach them, and their recent call history. */
export function buildEscalationFile(store: Store, borrowers: Borrower[]): Buffer {
  const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: false }) : "");
  const summary = borrowers.map((b) => {
    const p = computeBorrowerProfile(store, b.id, {});
    const last = store.calls.find((c) => c.loanId === b.loanId);
    return {
      "Escalated at": fmt(b.escalatedAt), Borrower: b.name, "Loan ID": b.loanId, Phone: b.phone, Product: b.product, Portfolio: b.portfolio,
      Segment: b.segment, DPD: b.dpd, Outstanding: b.outstanding, EMI: b.emi, Reason: b.escalationReason ?? "",
      "Last call": last ? `${fmt(last.ts)} · ${last.connected ? last.classification : "not answered"}` : "",
      "Answer rate": p ? `${p.stats.answered}/${p.stats.attempts}` : "", "Best window": p?.bestBand ?? "", Language: b.language,
      "Suggested approach": p?.playbook.join(" ") ?? "",
    };
  });
  const history = borrowers.flatMap((b) =>
    store.calls.filter((c) => c.loanId === b.loanId).slice(0, 15).map((c) => ({
      "Loan ID": c.loanId, Borrower: b.name, Time: fmt(c.ts), Channel: c.channel, Campaign: c.campaign,
      Outcome: c.connected ? c.classification : `Not answered (${c.dropReason})`, "Duration (s)": c.durationSec,
    })));
  const wb = XLSX.utils.book_new();
  const s1 = XLSX.utils.json_to_sheet(summary);
  s1["!cols"] = [18, 20, 15, 16, 18, 16, 16, 6, 12, 10, 30, 30, 11, 11, 10, 80].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, s1, "Escalations");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(history), "Call history");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
