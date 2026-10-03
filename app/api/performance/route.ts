import { NextResponse } from "next/server";
import { filtersFrom, requireUser } from "@/lib/api";
import { computePerformance } from "@/lib/metrics";

export async function GET(req: Request) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  return NextResponse.json(computePerformance(a.store, filtersFrom(new URL(req.url)), a.scope));
}
