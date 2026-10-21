import { NextResponse } from "next/server";
import { bad, filtersFrom, requireUser } from "@/lib/api";
import { deskScope, inDesk } from "@/lib/calldesk";
import { computeFollowUps } from "@/lib/metrics";
import { windowOpen } from "@/lib/contact";
import { audit, saveStore } from "@/lib/store";
import { istDay } from "@/lib/time";
import { REACH_CHANNELS, reachOf } from "@/lib/followups";
import type { FollowUp, ReachChannel, Store } from "@/lib/types";

const withReach = (s: Store, f: FollowUp) => ({ ...f, reachVia: reachOf(f, s.borrowers.find((b) => b.id === f.borrowerId)) });

export async function GET(req: Request) {
  const a = await requireUser(undefined, "followups");
  if ("res" in a) return a.res;
  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? istDay(Date.now()).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return bad("month must be YYYY-MM");
  const r0 = computeFollowUps(a.store, filtersFrom(url), a.scope, month);
  const r = { ...r0, items: r0.items.map((f) => withReach(a.store, f)), upcoming: r0.upcoming.map((f) => withReach(a.store, f)) };
  const desk = deskScope(a.store, a.user);
  if (!desk) return NextResponse.json(r);
  // Telecallers only see call-backs for borrowers in campaigns that use telecallers.
  const items = r.items.filter((f) => inDesk(desk, f.borrowerId));
  return NextResponse.json({ ...r, items, upcoming: r.upcoming.filter((f) => inDesk(desk, f.borrowerId)),
    counts: { scheduled: items.filter((x) => x.status === "Scheduled").length, done: items.filter((x) => x.status === "Done").length, missed: items.filter((x) => x.status === "Missed").length } });
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
    if (body.reachVia !== undefined) {
      if (!REACH_CHANNELS.includes(body.reachVia)) return bad("Unknown channel");
      const b = store.borrowers.find((x) => x.id === f.borrowerId);
      if (b?.dnd && body.reachVia !== "WhatsApp") return bad("This borrower asked not to be called, so only WhatsApp is allowed.", 409);
      if (body.reachVia === "WhatsApp" && b && !b.waConsent) return bad("No WhatsApp opt-in on file for this borrower.", 409);
      f.reachVia = body.reachVia as ReachChannel;
      audit(store, user, "followup_channel", f.loanId, f.reachVia);
      saveStore(store);
      return NextResponse.json({ followUp: withReach(store, f) });
    }
    if (!["Scheduled", "Done", "Missed"].includes(body.status)) return bad("Invalid status");
    f.status = body.status;
    audit(store, user, "followup_status", f.loanId, body.status);
    saveStore(store);
    return NextResponse.json({ followUp: f });
  }
  const b = store.borrowers.find((x) => x.id === body.borrowerId);
  const at = Date.parse(body.at);
  if (!b || Number.isNaN(at)) return bad("borrowerId and a valid time are required");
  if (!windowOpen(store.compliance, at)) return bad(`Follow-ups must be booked inside calling hours (${store.compliance.windowStart}:00–${store.compliance.windowEnd}:00 IST).`);
  const via: ReachChannel = REACH_CHANNELS.includes(body.reachVia) ? body.reachVia : "Telecaller";
  if (b.dnd && via !== "WhatsApp") return bad("This borrower asked not to be called. Book a WhatsApp follow-up instead.", 409);
  const f = {
    id: `F${Date.now()}`, borrowerId: b.id, loanId: b.loanId, name: b.name, portfolio: b.portfolio, product: b.product,
    at: new Date(at).toISOString(), requestedAt: new Date().toISOString(), requestedVia: "Human Desk" as const,
    note: String(body.note ?? "").slice(0, 200) || `Scheduled by ${user.name}`, status: "Scheduled" as const, reachVia: via,
  };
  store.followUps.push(f);
  store.followUps.sort((x, y) => x.at.localeCompare(y.at));
  audit(store, user, "followup_create", b.loanId, f.at);
  saveStore(store);
  return NextResponse.json({ followUp: f });
}
