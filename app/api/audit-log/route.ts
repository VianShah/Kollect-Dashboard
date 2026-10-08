import { NextResponse } from "next/server";
import { requireUser } from "@/lib/api";
import { verifyAudit } from "@/lib/store";

export async function GET() {
  const a = await requireUser("viewAudit");
  if ("res" in a) return a.res;
  return NextResponse.json({ entries: a.store.audit.slice(0, 500), total: a.store.audit.length, intact: verifyAudit(a.store) });
}
