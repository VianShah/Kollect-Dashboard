import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import { computeBorrowerProfile } from "@/lib/metrics";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  const profile = computeBorrowerProfile(a.store, (await params).id, a.scope);
  return profile ? NextResponse.json(profile) : bad("Not found", 404);
}
