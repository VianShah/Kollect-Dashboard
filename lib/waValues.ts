// Formatting and safety checks for WhatsApp template values. Shared by the browser (live preview) and the
// server (final check before anything is sent), so what you see is exactly what Meta receives.

export type ValueFormat = "text" | "date" | "amount" | "number";

/** True when the template already writes ₹ / Rs / INR right before this variable, so the value must not repeat it. */
export const hasCurrencyBefore = (text: string | undefined, param: string) =>
  new RegExp(`(₹|rs\\.?|inr)\\s*\\{\\{\\s*${param.replace(/\W/g, "")}\\s*\\}\\}`, "i").test(text ?? "");

/** A filled-in message that shows the currency twice, e.g. "₹₹20,000" or "Rs ₹20,000". */
export const doubledCurrency = (text: string) => /(₹|\brs\.?|\binr)\s*(₹|rs\.?\s*\d|inr\s*\d)/i.test(text);

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function validDay(y: number, m: number, d: number) {
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}
const fmtDate = (y: number, m: number, d: number) => `${d} ${MONTH_NAMES[m - 1]} ${y}`;

/** Reads the date formats people actually type or export from Excel. Day comes before month (Indian order). */
export function parseDate(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  let m = v.match(/^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})$/); // 21/10/2026, 21-10-26
  if (m) { const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]); return validDay(y, +m[2], +m[1]) ? fmtDate(y, +m[2], +m[1]) : null; }
  m = v.match(/^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})$/); // 2026-10-21
  if (m) return validDay(+m[1], +m[2], +m[3]) ? fmtDate(+m[1], +m[2], +m[3]) : null;
  m = v.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s\-]+([A-Za-z]{3,9})[,\s\-]+(\d{4})$/); // 21 Oct 2026, 21st October, 2026
  if (m) { const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1; return mo && validDay(+m[3], mo, +m[1]) ? fmtDate(+m[3], mo, +m[1]) : null; }
  m = v.match(/^([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/); // Oct 21, 2026
  if (m) { const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1; return mo && validDay(+m[3], mo, +m[2]) ? fmtDate(+m[3], mo, +m[2]) : null; }
  if (/^\d{5}$/.test(v)) { // Excel serial date
    const t = Math.round((Number(v) - 25569) * 86_400_000), d = new Date(t);
    return fmtDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  return null;
}

/** "20000", "20,000", "Rs. 20000.50", "₹ 20,000" all become "₹20,000" (or "₹20,000.50"). */
export function parseAmount(raw: string): string | null {
  const v = raw.trim().replace(/^(₹|rs\.?|inr)\s*/i, "").replace(/\/-$/, "").replace(/,/g, "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return null;
  const n = Number(v);
  const paise = Math.round(n * 100) % 100;
  return `₹${Math.floor(n).toLocaleString("en-IN")}${paise ? `.${String(paise).padStart(2, "0")}` : ""}`;
}

export function formatValue(raw: string, format: ValueFormat): { value: string; error?: string } {
  const v = String(raw ?? "").trim();
  if (!v) return { value: "", error: "Empty" };
  if (format === "date") { const d = parseDate(v); return d ? { value: d } : { value: v, error: `"${v}" isn't a date (try 21/10/2026)` }; }
  if (format === "amount" || format === "number") {
    const a = parseAmount(v);
    if (!a) return { value: v, error: `"${v}" isn't an amount (try 20000)` };
    return { value: format === "number" ? a.slice(1) : a };
  }
  return { value: v.replace(/\s+/g, " ") };
}

/** Meta rejects parameters with line breaks, tabs or more than four spaces in a row. */
export function checkParam(v: string): string | undefined {
  if (!v.trim()) return "Empty";
  if (/[\n\r\t]/.test(v)) return "Has a line break or tab";
  if (/ {5,}/.test(v)) return "Has more than four spaces in a row";
  if (v.length > 300) return "Longer than 300 characters";
  return undefined;
}

/** Guesses a column's format from its name or its values. */
export function guessFormat(name: string, samples: string[] = []): ValueFormat {
  const n = name.toLowerCase();
  if (/date|due|day|dt\b|deadline|by_/.test(n)) return "date";
  if (/amount|amt|emi|rs|inr|₹|outstanding|due_amount|balance|price|fee/.test(n)) return "amount";
  const filled = samples.filter((s) => s.trim()).slice(0, 10);
  if (filled.length && filled.every((s) => parseDate(s) && !/^\d+$/.test(s.trim()))) return "date";
  if (filled.length && filled.every((s) => /^(₹|rs\.?)/i.test(s.trim()))) return "amount";
  return "text";
}

/** Reads the template's own words just before a variable ("Date: {{2}}", "Amount: {{4}}") to pick its format. */
export function contextFormat(text: string | undefined, param: string): ValueFormat | undefined {
  const at = (text ?? "").search(new RegExp(`\\{\\{\\s*${param.replace(/\W/g, "")}\\s*\\}\\}`));
  if (at < 0) return undefined;
  const before = (text ?? "").slice(Math.max(0, at - 30), at).toLowerCase();
  if (/(₹|rs\.?|inr)\s*$/.test(before)) return "number";
  if (/(amount|emi|balance|outstanding|payment of|pay|dues?)\W*$/.test(before)) return "amount";
  if (/(date|due on|due by|on|by|before|till|until)\W*$/.test(before)) return "date";
  return undefined;
}

export interface ParsedTable { headers: string[]; rows: string[][]; phoneCol: number; nameCol: number; errors: string[] }

const isPhoneLike = (s: string) => { const d = s.replace(/\D/g, ""); return d.length >= 10 && d.length <= 15; };

/** Reads pasted cells from Excel / Sheets (tabs) or CSV (commas, quoted values allowed). Finds the phone and name columns. */
export function parseTable(text: string): ParsedTable {
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim());
  const sep = lines.some((l) => l.includes("\t")) ? "\t" : ",";
  const split = (line: string) => {
    if (sep === "\t") return line.split("\t").map((c) => c.trim());
    const out: string[] = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { out.push(cur.trim()); cur = ""; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  const grid = lines.map(split);
  if (!grid.length) return { headers: [], rows: [], phoneCol: -1, nameCol: -1, errors: ["Nothing to read."] };
  const first = grid[0];
  const hasHeader = !first.some(isPhoneLike);
  const width = Math.max(...grid.map((r) => r.length));
  const rows = (hasHeader ? grid.slice(1) : grid).map((r) => Array.from({ length: width }, (_, i) => r[i] ?? ""));
  let phoneCol = hasHeader ? first.findIndex((h) => /phone|mobile|whats|number|contact|msisdn/i.test(h)) : -1;
  if (phoneCol < 0) phoneCol = Array.from({ length: width }, (_, i) => i).find((i) => rows.length > 0 && rows.filter((r) => isPhoneLike(r[i])).length >= Math.ceil(rows.length * 0.8)) ?? -1;
  // Plain pasted lines have no header: call the columns after the number Value 1, Value 2… so they read as {{1}}, {{2}}….
  let v = 0;
  const headers = hasHeader ? Array.from({ length: width }, (_, i) => first[i] || `Column ${i + 1}`)
    : Array.from({ length: width }, (_, i) => (i === phoneCol ? "Phone" : `Value ${++v}`));
  const nameCol = headers.findIndex((h, i) => i !== phoneCol && /name|customer|borrower/i.test(h));
  const errors: string[] = [];
  if (phoneCol < 0) errors.push("Couldn't find a phone number column. Add a column called Phone.");
  return { headers, rows, phoneCol, nameCol, errors };
}

/** Meta's daily cap on new conversations for a number, from its messaging tier. */
export function tierLimit(tier: string | undefined): number {
  switch (tier) {
    case "TIER_50": return 50;
    case "TIER_250": return 250;
    case "TIER_1K": return 1000;
    case "TIER_2K": return 2000;
    case "TIER_10K": return 10000;
    case "TIER_100K": return 100000;
    case "TIER_UNLIMITED": return Infinity;
    default: return 250;
  }
}
