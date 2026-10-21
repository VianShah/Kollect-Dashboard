import { NextResponse } from "next/server";
import { bad, filtersFrom, requireUser } from "@/lib/api";
import { audienceOf } from "@/lib/campaigns";
import { computePerformance } from "@/lib/metrics";

// ?campaign=C1 narrows everything to that campaign's borrowers and their calls and messages.
export async function GET(req: Request) {
  const a = await requireUser(undefined, "performance");
  if ("res" in a) return a.res;
  const url = new URL(req.url);
  const cid = url.searchParams.get("campaign");
  let store = a.store;
  if (cid) {
    const c = store.campaigns.find((x) => x.id === cid);
    if (!c) return bad("Campaign not found", 404);
    const ids = new Set(c.members.length ? c.members : audienceOf(store, c.audience).map((b) => b.id));
    const borrowers = store.borrowers.filter((b) => ids.has(b.id));
    const loans = new Set(borrowers.map((b) => b.loanId));
    store = { ...store, borrowers, calls: store.calls.filter((x) => loans.has(x.loanId)), touches: store.touches.filter((t) => loans.has(t.loanId)), followUps: store.followUps.filter((f) => ids.has(f.borrowerId)) };
  }
  return NextResponse.json(computePerformance(store, filtersFrom(url), a.scope));
}
