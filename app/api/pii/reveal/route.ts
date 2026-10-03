import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import { audit, saveStore } from "@/lib/store";


// { borrowerId, reason } -> full phone number. Every reveal is written to the audit trail.
export async function POST(req: Request) {
  const a = await requireUser("revealPii");
  if ("res" in a) return a.res;
  const { borrowerId, reason } = await req.json().catch(() => ({}));
  if (!reason || typeof reason !== "string") return bad("A reason is required");
  const b = a.store.borrowers.find((x) => x.id === borrowerId);
  if (!b || (a.scope.portfolio && b.portfolio !== a.scope.portfolio)) return bad("Not found", 404);
  audit(a.store, a.user, "pii_reveal", b.loanId, reason.slice(0, 200));
  saveStore(a.store);
  return NextResponse.json({ phone: b.phoneFull ?? b.phone, expiresInSec: 30 });
}
