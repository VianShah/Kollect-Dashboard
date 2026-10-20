import { NextResponse } from "next/server";
import { bad, filtersFrom, requireUser } from "@/lib/api";
import { audienceOf } from "@/lib/campaigns";
import { deskScope } from "@/lib/calldesk";
import { scoped } from "@/lib/metrics";
import { audit, saveStore } from "@/lib/store";

// ?campaign=C1 narrows to that campaign's borrowers. Telecallers only ever see calls for the accounts they work.
export async function GET(req: Request) {
  const a = await requireUser(undefined, ["audit", "borrowers", "campaigns"]);
  if ("res" in a) return a.res;
  const url = new URL(req.url);
  let { calls } = scoped(a.store, filtersFrom(url), a.scope);
  const desk = deskScope(a.store, a.user);
  if (desk) {
    const loans = new Set(a.store.borrowers.filter((b) => desk.has(b.id)).map((b) => b.loanId));
    calls = calls.filter((c) => loans.has(c.loanId));
  }
  const cid = url.searchParams.get("campaign");
  if (cid) {
    const c = a.store.campaigns.find((x) => x.id === cid);
    if (!c) return bad("Campaign not found", 404);
    const ids = new Set(c.members.length ? c.members : audienceOf(a.store, c.audience).map((b) => b.id));
    const loans = new Set(a.store.borrowers.filter((b) => ids.has(b.id)).map((b) => b.loanId));
    calls = calls.filter((x) => loans.has(x.loanId));
  }
  return NextResponse.json({ calls: calls.slice(0, 2000), total: calls.length });
}

// { id, visible }
export async function PATCH(req: Request) {
  const a = await requireUser("hideCall");
  if ("res" in a) return a.res;
  const { id, visible } = await req.json().catch(() => ({}));
  const c = a.store.calls.find((x) => x.id === id);
  if (!c) return bad("Not found", 404);
  c.visible = !!visible;
  audit(a.store, a.user, visible ? "call_show_client" : "call_hide_client", c.callId, c.loanId);
  saveStore(a.store);
  return NextResponse.json({ call: c });
}
