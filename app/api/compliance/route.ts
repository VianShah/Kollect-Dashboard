import { NextResponse } from "next/server";
import { bad, filtersFrom, requireUser } from "@/lib/api";
import { computeCompliance } from "@/lib/metrics";
import { audit, saveStore } from "@/lib/store";

export async function GET(req: Request) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  return NextResponse.json(computeCompliance(a.store, filtersFrom(new URL(req.url)), a.scope));
}

export async function PATCH(req: Request) {
  const a = await requireUser("editCompliance");
  if ("res" in a) return a.res;
  const body = await req.json().catch(() => null);
  if (!body) return bad("Invalid JSON");
  const r = a.store.compliance;
  const int = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);
  const next = {
    windowStart: int(body.windowStart, 0, 23) ?? r.windowStart,
    windowEnd: int(body.windowEnd, 1, 24) ?? r.windowEnd,
    maxPerDay: int(body.maxPerDay, 1, 20) ?? r.maxPerDay,
    maxPerWeek: int(body.maxPerWeek, 1, 100) ?? r.maxPerWeek,
    respectDnd: typeof body.respectDnd === "boolean" ? body.respectDnd : r.respectDnd,
    requireWaConsent: typeof body.requireWaConsent === "boolean" ? body.requireWaConsent : r.requireWaConsent,
  };
  if (next.windowEnd <= next.windowStart) return bad("Calling window must end after it starts");
  const changed = Object.entries(next).filter(([k, v]) => r[k as keyof typeof r] !== v).map(([k, v]) => `${k}: ${r[k as keyof typeof r]} → ${v}`);
  a.store.compliance = next;
  if (changed.length) audit(a.store, a.user, "compliance_rules", "Rules", changed.join("; "));
  saveStore(a.store);
  return NextResponse.json({ rules: next });
}
