import { NextResponse } from "next/server";
import { filtersFrom, requireUser } from "@/lib/api";
import { computeOverview } from "@/lib/metrics";

export async function GET(req: Request) {
  const a = await requireUser(undefined, "home");
  if ("res" in a) return a.res;
  return NextResponse.json(computeOverview(a.store, filtersFrom(new URL(req.url)), a.scope));
}
