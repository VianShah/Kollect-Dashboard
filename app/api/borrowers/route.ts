import { NextResponse } from "next/server";
import { bad, filtersFrom, requireUser } from "@/lib/api";
import { canContact } from "@/lib/contact";
import { renderMessage } from "@/lib/messages";
import { publicBorrower, scoped } from "@/lib/metrics";
import { addEvent, audit, saveStore } from "@/lib/store";

export async function GET(req: Request) {
  const a = await requireUser(undefined, "borrowers");
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
    const verdict = canContact(store, b, "whatsapp");
    if (!verdict.ok) {
      audit(store, user, "contact_blocked", b.loanId, verdict.reason ?? "");
      saveStore(store, { throttle: true });
      return bad(verdict.reason ?? "This contact is not allowed right now.", 409);
    }
    b.paymentLink = "Shared";
    const { text, language } = renderMessage("Payment link", b.language, {
      first: b.name.split(" ")[0], product: b.product, amt: `₹${b.emi.toLocaleString("en-IN")}`, link: `pay.kollect.in/${b.loanId.slice(-6)}`, dpd: b.dpd, lender: b.portfolio,
    });
    store.touches.unshift({ id: `T${Date.now()}`, ts: new Date().toISOString(), loanId: b.loanId, channel: "WhatsApp", template: "Payment link", status: "Delivered", text, language });
    audit(store, user, "send_payment_link", b.loanId, `WhatsApp · ${language}`);
  } else if (action === "escalate") {
    Object.assign(b, { disposition: "Escalated", channel: "Human Desk", stage: Math.max(b.stage, 2), escalatedAt: new Date().toISOString(), escalationReason: reason || `Escalated by ${user.name}` });
    addEvent(store, { type: "escalation", portfolio: b.portfolio, borrowerId: b.id, loanId: b.loanId, title: `Escalated to human desk · ${b.name}`, detail: `${b.escalationReason} · ${b.loanId}` });
    audit(store, user, "escalate", b.loanId, b.escalationReason);
  } else return bad("Unknown action");
  saveStore(store);
  return NextResponse.json({ borrower: publicBorrower(b) });
}
