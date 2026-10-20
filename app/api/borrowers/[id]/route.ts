import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import { deskScope } from "@/lib/calldesk";
import { computeBorrowerProfile } from "@/lib/metrics";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const a = await requireUser(undefined, ["borrowers", "calldesk", "campaigns"]);
  if ("res" in a) return a.res;
  const id = (await params).id;
  // A telecaller can only open accounts allocated to them.
  const desk = deskScope(a.store, a.user);
  const b = a.store.borrowers.find((x) => x.id === id || x.loanId === id);
  if (desk && (!b || !desk.has(b.id))) return bad("Not found", 404);
  const profile = computeBorrowerProfile(a.store, id, a.scope);
  return profile ? NextResponse.json(profile) : bad("Not found", 404);
}