import { NextResponse } from "next/server";
import { bad, filtersFrom, requireUser } from "@/lib/api";
import { publicBorrower, scoped } from "@/lib/metrics";
import { addEvent, audit, saveStore } from "@/lib/store";

export async function GET(req: Request) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  const { borrowers } = scoped(a.store, filtersFrom(new URL(req.url)), a.scope);
  return NextResponse.json({ borrowers: borrowers.map(publicBorrower) });
}

// Actions: { id, action: "sendLink" | "escalate", reason? }
export async function POST(req: Request) {
  const { id, action, reason } = await req.json().catch(() => ({}));
  const a = await requireUser(action === "escalate" ? "escalate" : "sendLink");
  if ("res" in a) return a.res;
  const { store, user } = a;
  const b = store.borrowers.find((x) => x.id === id);
  if (!b) return bad("Not found", 404);
  if (action === "sendLink") {
    b.paymentLink = "Shared";
    store.touches.unshift({
      id: `T${Date.now()}`, ts: new Date().toISOString(), loanId: b.loanId, channel: "WhatsApp", template: "Payment link", status: "Delivered",
      text: `Hi ${b.name.split(" ")[0]}, pay your ₹${b.emi.toLocaleString("en-IN")} ${b.product} EMI securely: pay.kollect.in/${b.loanId.slice(-6)}`,
    });
    audit(store, user, "send_payment_link", b.loanId, "WhatsApp");
  } else if (action === "escalate") {
    Object.assign(b, { disposition: "Escalated", channel: "Human Desk", stage: Math.max(b.stage, 2), escalatedAt: new Date().toISOString(), escalationReason: reason || `Escalated by ${user.name}` });
    addEvent(store, { type: "escalation", portfolio: b.portfolio, borrowerId: b.id, loanId: b.loanId, title: `Escalated to human desk · ${b.name}`, detail: `${b.escalationReason} · ${b.loanId}` });
    audit(store, user, "escalate", b.loanId, b.escalationReason);
  } else return bad("Unknown action");
  saveStore(store);
  return NextResponse.json({ borrower: publicBorrower(b) });
}
