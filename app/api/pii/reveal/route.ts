import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import { REVEAL_REASONS } from "@/lib/roles";
import { audit, saveStore } from "@/lib/store";

const MAX_REVEALS_PER_HOUR = 30;

// { borrowerId, reason } -> full phone number. Every reveal is written to the audit trail.
export async function POST(req: Request) {
  const a = await requireUser("revealPii");
  if ("res" in a) return a.res;
  const { borrowerId, reason } = await req.json().catch(() => ({}));
  if (typeof reason !== "string" || !REVEAL_REASONS.includes(reason)) return bad("Choose one of the listed reasons");
  const recent = a.store.audit.filter((e) => e.action === "pii_reveal" && e.user === a.user.username && Date.now() - Date.parse(e.ts) < 3_600_000).length;
  if (recent >= MAX_REVEALS_PER_HOUR) return bad("Reveal limit reached for this hour. Ask a supervisor if you need more.", 429);
  const b = a.store.borrowers.find((x) => x.id === borrowerId);
  if (!b || (a.scope.portfolio && b.portfolio !== a.scope.portfolio)) return bad("Not found", 404);
  audit(a.store, a.user, "pii_reveal", b.loanId, reason.slice(0, 200));
  saveStore(a.store);
  return NextResponse.json({ phone: b.phoneFull ?? b.phone, expiresInSec: 30 });
}
