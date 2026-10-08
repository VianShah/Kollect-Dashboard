import { NextResponse } from "next/server";
import { filtersFrom, requireUser } from "@/lib/api";
import { computeUsage } from "@/lib/metrics";

export async function GET(req: Request) {
  const a = await requireUser(undefined, "usage");
  if ("res" in a) return a.res;
  return NextResponse.json(computeUsage(a.store, filtersFrom(new URL(req.url)), a.scope));
}
