import { NextResponse } from "next/server";
import { bad, filtersFrom, requireUser } from "@/lib/api";
import { computeFollowUps } from "@/lib/metrics";
import { audit, saveStore } from "@/lib/store";
import { istDay } from "@/lib/time";

export async function GET(req: Request) {
  const a = await requireUser();
  if ("res" in a) return a.res;
  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? istDay(Date.now()).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return bad("month must be YYYY-MM");
  return NextResponse.json(computeFollowUps(a.store, filtersFrom(url), a.scope, month));
}

// Create: { borrowerId, at (ISO), note }   Update: { id, status }
export async function POST(req: Request) {
  const a = await requireUser("followup");
  if ("res" in a) return a.res;
  const body = await req.json().catch(() => ({}));
  const { store, user } = a;
  if (body.id) {
    const f = store.followUps.find((x) => x.id === body.id);
    if (!f) return bad("Not found", 404);
    if (!["Scheduled", "Done", "Missed"].includes(body.status)) return bad("Invalid status");
    f.status = body.status;
    audit(store, user, "followup_status", f.loanId, body.status);
    saveStore(store);
    return NextResponse.json({ followUp: f });
  }
  const b = store.borrowers.find((x) => x.id === body.borrowerId);
  const at = Date.parse(body.at);
  if (!b || Number.isNaN(at)) return bad("borrowerId and a valid time are required");
  const f = {
    id: `F${Date.now()}`, borrowerId: b.id, loanId: b.loanId, name: b.name, portfolio: b.portfolio, product: b.product,
    at: new Date(at).toISOString(), requestedAt: new Date().toISOString(), requestedVia: "Human Desk" as const,
    note: String(body.note ?? "").slice(0, 200) || `Scheduled by ${user.name}`, status: "Scheduled" as const,
  };
  store.followUps.push(f);
  store.followUps.sort((x, y) => x.at.localeCompare(y.at));
  audit(store, user, "followup_create", b.loanId, f.at);
  saveStore(store);
  return NextResponse.json({ followUp: f });
}
