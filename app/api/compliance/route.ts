import { NextResponse } from "next/server";
import { bad, filtersFrom, requireUser } from "@/lib/api";
import { LEGAL_WINDOW } from "@/lib/contact";
import { computeCompliance } from "@/lib/metrics";
import { audit, saveStore } from "@/lib/store";

export async function GET(req: Request) {
  const a = await requireUser(undefined, "compliance");
  if ("res" in a) return a.res;
  return NextResponse.json(computeCompliance(a.store, filtersFrom(new URL(req.url)), a.scope));
}

export async function PATCH(req: Request) {
  const a = await requireUser("editCompliance");
  if ("res" in a) return a.res;
  const body = await req.json().catch(() => null);
  if (!body) return bad("Invalid JSON");
  // Do-not-call and WhatsApp opt-in checks are legal requirements, so they cannot be switched off.
  if (body.respectDnd === false || body.requireWaConsent === false) return bad("Do-not-call and WhatsApp opt-in checks are required and cannot be turned off");
  const r = a.store.compliance;
  const int = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
  if ((body.windowStart !== undefined && int(body.windowStart, LEGAL_WINDOW.start, LEGAL_WINDOW.end - 1) === undefined)
    || (body.windowEnd !== undefined && int(body.windowEnd, LEGAL_WINDOW.start + 1, LEGAL_WINDOW.end) === undefined))
    return bad(`The calling window must stay within ${LEGAL_WINDOW.start}:00–${LEGAL_WINDOW.end}:00 IST`);
  const next = {
    windowStart: int(body.windowStart, LEGAL_WINDOW.start, LEGAL_WINDOW.end - 1) ?? r.windowStart,
    windowEnd: int(body.windowEnd, LEGAL_WINDOW.start + 1, LEGAL_WINDOW.end) ?? r.windowEnd,
    maxPerDay: int(body.maxPerDay, 1, 20) ?? r.maxPerDay,
    maxPerWeek: int(body.maxPerWeek, 1, 100) ?? r.maxPerWeek,
    respectDnd: true,
    requireWaConsent: true,
  };
  if (next.windowEnd <= next.windowStart) return bad("Calling window must end after it starts");
  if (next.maxPerWeek < next.maxPerDay) return bad("The weekly cap cannot be lower than the daily cap");
  const changed = Object.entries(next).filter(([k, v]) => r[k as keyof typeof r] !== v).map(([k, v]) => `${k}: ${r[k as keyof typeof r]} → ${v}`);
  a.store.compliance = next;
  if (changed.length) audit(a.store, a.user, "compliance_rules", "Rules", changed.join("; "));
  saveStore(a.store);
  return NextResponse.json({ rules: next });
}
