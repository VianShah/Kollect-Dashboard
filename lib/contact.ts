import type { Borrower, ComplianceRules, Store } from "./types";
import { DAY, istHour, istMidnight } from "./time";

/** RBI's recovery-agent guidance allows contact between 8am and 7pm. A lender may narrow this window, never widen it. */
export const LEGAL_WINDOW = { start: 8, end: 19 } as const;

export type ContactChannel = "voice" | "whatsapp" | "sms" | "email";
export interface Verdict { ok: boolean; reason?: string }

export const windowOpen = (rules: ComplianceRules, at = Date.now()) => {
  const h = istHour(at);
  return h >= rules.windowStart && h < rules.windowEnd;
};

/** Brings stored rules back inside the legal limits (for data saved before the limits existed). */
export function clampRules(r: ComplianceRules): ComplianceRules {
  const windowStart = Math.max(LEGAL_WINDOW.start, Math.min(r.windowStart, LEGAL_WINDOW.end - 1));
  const windowEnd = Math.min(LEGAL_WINDOW.end, Math.max(r.windowEnd, windowStart + 1));
  return { ...r, windowStart, windowEnd, respectDnd: true, requireWaConsent: true };
}

/** Decides whether a contact may happen right now. Used before sending, so a breach is stopped rather than reported afterwards. */
export function canContact(s: Store, b: Borrower, channel: ContactChannel, at = Date.now()): Verdict {
  const rules = s.compliance;
  if (b.disposition === "Dispute") return { ok: false, reason: "This account is disputed. Automated outreach is paused until the dispute is resolved." };
  if (!windowOpen(rules, at)) return { ok: false, reason: `Outside the calling window (${rules.windowStart}:00–${rules.windowEnd}:00 IST).` };
  if (channel === "voice" && b.dnd) return { ok: false, reason: "The borrower asked not to be called." };
  if (channel === "whatsapp" && !b.waConsent) return { ok: false, reason: "No WhatsApp opt-in on file for this borrower." };
  if (channel === "voice") {
    const dayStart = istMidnight(at);
    const mine = s.calls.filter((c) => c.loanId === b.loanId && c.channel !== "WhatsApp");
    if (mine.filter((c) => Date.parse(c.ts) >= dayStart).length >= rules.maxPerDay) return { ok: false, reason: `Daily cap of ${rules.maxPerDay} attempts reached.` };
    if (mine.filter((c) => Date.parse(c.ts) > at - 7 * DAY).length >= rules.maxPerWeek) return { ok: false, reason: `Weekly cap of ${rules.maxPerWeek} attempts reached.` };
  }
  return { ok: true };
}
