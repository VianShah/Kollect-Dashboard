import { NextResponse } from "next/server";
import { filtersFrom, requireUser } from "@/lib/api";
import { scoped } from "@/lib/metrics";
import { campaignRuns } from "@/lib/reports";

export async function GET(req: Request) {
  const a = await requireUser(undefined, "channels");
  if ("res" in a) return a.res;
  const { calls } = scoped(a.store, filtersFrom(new URL(req.url)), a.scope);
  const runs = campaignRuns(a.store, calls);
  return NextResponse.json({ runs: runs.slice(0, 1500), total: runs.length, products: a.store.products });
}
