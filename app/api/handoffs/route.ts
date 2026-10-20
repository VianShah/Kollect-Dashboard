import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import { deskScope, inDesk } from "@/lib/calldesk";
import { handoffList } from "@/lib/handoffs";
import { audit, saveStore } from "@/lib/store";

export async function GET() {
  const a = await requireUser(undefined, "handoffs");
  if ("res" in a) return a.res;
  const scope = deskScope(a.store, a.user);
  return NextResponse.json({ items: handoffList(a.store, a.user.username).filter((x) => inDesk(scope, x.borrowerId)) });
}

// { borrowerId, action: "cold" | "hot" | "accept" | "resolve", via?: "WhatsApp" | "CRM", outcome? }
export async function POST(req: Request) {
  const a = await requireUser("handoff");
  if ("res" in a) return a.res;
  const { store, user } = a;
  const { borrowerId, action, via, outcome } = await req.json().catch(() => ({}));
  const b = store.borrowers.find((x) => x.id === borrowerId && x.disposition === "Escalated");
  if (!b || !inDesk(deskScope(store, user), b.id)) return bad("Not in the escalation queue", 404);
  const h = (store.handoffs[b.id] ??= { status: "Waiting" });
  const now = new Date().toISOString();
  if (action === "cold") Object.assign(h, { mode: "cold", status: "With telecaller", owner: user.username, summarySentVia: undefined });
  else if (action === "hot") {
    if (via !== "WhatsApp" && via !== "CRM") return bad("Choose WhatsApp or CRM for the summary");
    Object.assign(h, { mode: "hot", status: "With telecaller", owner: user.username, summarySentVia: via });
  } else if (action === "accept") Object.assign(h, { status: "With telecaller", owner: user.username });
  else if (action === "resolve") {
    const o = typeof outcome === "string" ? outcome.trim().slice(0, 200) : "";
    if (o.length < 3) return bad("Add the outcome before resolving");
    Object.assign(h, { status: "Resolved", outcome: o });
  } else return bad("Unknown action");
  h.updatedAt = now;
  audit(store, user, `handoff_${action}`, b.loanId, action === "hot" ? `AI summary via ${via}` : action === "resolve" ? h.outcome ?? "" : "");
  saveStore(store);
  const scope = deskScope(store, user);
  return NextResponse.json({ items: handoffList(store, user.username).filter((x) => inDesk(scope, x.borrowerId)) });
}
