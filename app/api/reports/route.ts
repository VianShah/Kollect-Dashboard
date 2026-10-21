import { NextResponse } from "next/server";
import { filtersFrom, requireUser } from "@/lib/api";
import { campaignRuns } from "@/lib/reports";

export async function GET(req: Request) {
  const a = await requireUser(undefined, "channels");
  if ("res" in a) return a.res;
  const runs = campaignRuns(a.store, filtersFrom(new URL(req.url)), a.scope);
  return NextResponse.json({ runs: runs.slice(0, 1500), total: runs.length });
}
