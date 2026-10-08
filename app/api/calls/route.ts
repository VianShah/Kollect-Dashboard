import { NextResponse } from "next/server";
import { bad, filtersFrom, requireUser } from "@/lib/api";
import { scoped } from "@/lib/metrics";
import { audit, saveStore } from "@/lib/store";

export async function GET(req: Request) {
  const a = await requireUser(undefined, "audit");
  if ("res" in a) return a.res;
  const { calls } = scoped(a.store, filtersFrom(new URL(req.url)), a.scope);
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
