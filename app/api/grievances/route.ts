import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import { can } from "@/lib/auth";
import { GRIEVANCE_CATEGORIES, GRIEVANCE_SLA_DAYS } from "@/lib/mock";
import { audit, saveStore } from "@/lib/store";
import { DAY } from "@/lib/time";
import type { GrievanceStatus } from "@/lib/types";

const STATUSES: GrievanceStatus[] = ["Open", "In progress", "Resolved"];

export async function GET() {
  const a = await requireUser(undefined, "grievances");
  if ("res" in a) return a.res;
  const { store } = a;
  const now = Date.now();
  const items = [...store.grievances]
    .sort((x, y) => y.raisedAt.localeCompare(x.raisedAt))
    .map((g) => ({ ...g, overdue: g.status !== "Resolved" && Date.parse(g.dueAt) < now }));
  return NextResponse.json({
    items, gro: store.gro, categories: GRIEVANCE_CATEGORIES, slaDays: GRIEVANCE_SLA_DAYS,
    counts: {
      open: items.filter((g) => g.status === "Open").length,
      inProgress: items.filter((g) => g.status === "In progress").length,
      resolved: items.filter((g) => g.status === "Resolved").length,
      overdue: items.filter((g) => g.overdue).length,
    },
    canEditOfficer: can(a.user, "editCompliance"),
  });
}

// Create: { borrowerId, category, detail }
export async function POST(req: Request) {
  const a = await requireUser("grievance");
  if ("res" in a) return a.res;
  const { store, user } = a;
  const body = await req.json().catch(() => ({}));
  const b = store.borrowers.find((x) => x.id === body.borrowerId || x.loanId === body.borrowerId);
  if (!b) return bad("Choose a borrower", 404);
  const category = typeof body.category === "string" && GRIEVANCE_CATEGORIES.includes(body.category) ? body.category : undefined;
  const detail = typeof body.detail === "string" ? body.detail.trim().slice(0, 1000) : "";
  if (!category) return bad("Choose a category");
  if (detail.length < 5) return bad("Describe the complaint in a few words");
  const now = Date.now();
  const g = {
    id: `G${++store.grievanceSeq}`, borrowerId: b.id, loanId: b.loanId, name: b.name, portfolio: b.portfolio, product: b.product,
    category, detail, raisedAt: new Date(now).toISOString(), dueAt: new Date(now + GRIEVANCE_SLA_DAYS * DAY).toISOString(),
    status: "Open" as const, raisedBy: user.username,
  };
  store.grievances.unshift(g);
  audit(store, user, "grievance_create", b.loanId, category);
  saveStore(store);
  return NextResponse.json({ grievance: g });
}

// Update: { id, status, resolution? }   Officer: { gro: { name, email, phone } }
export async function PATCH(req: Request) {
  const a = await requireUser(undefined, "grievances");
  if ("res" in a) return a.res;
  const { store, user } = a;
  const body = await req.json().catch(() => ({}));
  if (body.gro) {
    if (!can(user, "editCompliance")) return bad("Only a Super Admin can change the grievance officer", 403);
    const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
    const gro = { name: s(body.gro.name, 80), email: s(body.gro.email, 120), phone: s(body.gro.phone, 30) };
    if (!gro.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(gro.email) || !gro.phone) return bad("Enter the officer's name, a valid email and a phone number");
    store.gro = gro;
    audit(store, user, "grievance_officer", "Officer", gro.name);
    saveStore(store);
    return NextResponse.json({ gro });
  }
  if (!can(user, "grievance")) return bad("Forbidden", 403);
  const g = store.grievances.find((x) => x.id === body.id);
  if (!g) return bad("Not found", 404);
  if (!STATUSES.includes(body.status)) return bad("Invalid status");
  const resolution = typeof body.resolution === "string" ? body.resolution.trim().slice(0, 1000) : "";
  if (body.status === "Resolved" && resolution.length < 5) return bad("Say how it was resolved before closing it");
  g.status = body.status;
  g.resolution = body.status === "Resolved" ? resolution : undefined;
  g.resolvedAt = body.status === "Resolved" ? new Date().toISOString() : undefined;
  audit(store, user, "grievance_status", g.loanId, body.status);
  saveStore(store);
  return NextResponse.json({ grievance: g });
}
