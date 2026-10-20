// Borrower details that can fill a WhatsApp template's variables. Shared by the WhatsApp tab and the send API.
import type { Borrower } from "./types";

export const WA_FIELDS = [
  { key: "first", label: "First name" },
  { key: "name", label: "Full name" },
  { key: "emi", label: "EMI amount (₹)" },
  { key: "outstanding", label: "Outstanding (₹)" },
  { key: "dpd", label: "Days past due" },
  { key: "dueDate", label: "EMI due date" },
  { key: "loanId", label: "Loan ID" },
  { key: "loanLast4", label: "Loan ID, last 4" },
  { key: "product", label: "Product" },
  { key: "lender", label: "Lender" },
  { key: "payLink", label: "Payment link" },
  { key: "today", label: "Today's date" },
] as const;
export type WaFieldKey = (typeof WA_FIELDS)[number]["key"];

/** One template variable is filled either from a borrower detail or with fixed text. */
export type WaMapping = { source: "field"; key: WaFieldKey } | { source: "text"; value: string };

const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const day = (t: number) => new Date(t).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

export function fieldValue(b: Borrower, key: WaFieldKey, now = Date.now()): string {
  switch (key) {
    case "first": return b.name.split(" ")[0];
    case "name": return b.name;
    case "emi": return inr(b.emi);
    case "outstanding": return inr(b.outstanding);
    case "dpd": return String(b.dpd);
    case "dueDate": return day(now - b.dpd * 86_400_000);
    case "loanId": return b.loanId;
    case "loanLast4": return b.loanId.slice(-4);
    case "product": return b.product;
    case "lender": return b.portfolio;
    case "payLink": return `pay.kollect.in/${b.loanId.slice(-6)}`;
    case "today": return day(now);
  }
}

export const mapValue = (b: Borrower | undefined, m: WaMapping, now = Date.now()) =>
  m.source === "text" ? m.value : b ? fieldValue(b, m.key, now) : `[${WA_FIELDS.find((f) => f.key === m.key)?.label ?? m.key}]`;

/** A sensible starting mapping for a template's variables, guessed from their names and position. */
export function guessMapping(params: string[]): WaMapping[] {
  const byName: Record<string, WaFieldKey> = {
    name: "first", first_name: "first", customer_name: "first", user_name: "first", full_name: "name",
    amount: "emi", emi: "emi", emi_amount: "emi", outstanding: "outstanding", dpd: "dpd", due_date: "dueDate", date: "dueDate",
    loan_id: "loanId", account: "loanLast4", product: "product", lender: "lender", link: "payLink", payment_link: "payLink",
  };
  const order: WaFieldKey[] = ["first", "dueDate", "loanLast4", "emi", "payLink", "lender"];
  return params.map((p, i) => ({ source: "field", key: byName[p.toLowerCase()] ?? order[i] ?? "first" }));
}
