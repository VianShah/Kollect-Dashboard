import { NextResponse } from "next/server";
import { addEvent, getStore, saveStore } from "@/lib/store";
import type { Call } from "@/lib/types";

// Webhook for dialer / WhatsApp platforms. Auth: `x-api-key` header = INGEST_KEY.
// Body: { calls?: Partial<Call>[], agents?: { code: string; live?: number; max?: number }[] }
export async function POST(req: Request) {
  if (req.headers.get("x-api-key") !== (process.env.INGEST_KEY ?? "dev-key"))
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const store = getStore();
  const byLoan = new Map(store.borrowers.map((b) => [b.loanId, b]));
  let calls = 0, agents = 0;
  if (Array.isArray(body.calls)) {
    const known = new Set(store.calls.map((c) => c.callId));
    for (const c of body.calls as Partial<Call>[]) {
      if (!c.callId || !c.ts || !c.campaign || known.has(c.callId)) continue;
      const b = c.loanId ? byLoan.get(c.loanId) : undefined;
      const durationSec = Number(c.durationSec ?? 0);
      const connected = c.connected ?? durationSec > 0;
      const call: Call = {
        id: `I${store.calls.length + 1}`, ts: c.ts, callId: c.callId, campaign: c.campaign,
        phone: b?.phone ?? c.phone ?? "", loanId: c.loanId ?? "", product: c.product ?? b?.product ?? "Unknown",
        portfolio: c.portfolio ?? b?.portfolio ?? "Default", channel: c.channel ?? "AI Voice", durationSec,
        classification: c.classification ?? (connected ? "Callback" : "No Contact"), connected,
        dropReason: connected ? undefined : c.dropReason ?? "no_answer", attemptNo: c.attemptNo ?? 1, visible: c.visible ?? true,
      };
      store.calls.unshift(call);
      known.add(call.callId);
      addEvent(store, {
        type: call.classification === "Escalated" ? "escalation" : "call", portfolio: call.portfolio, borrowerId: b?.id, loanId: call.loanId,
        title: `${b?.name ?? call.loanId} · ${call.connected ? call.classification : "No answer"}`, detail: `${call.channel} · ${call.campaign}`,
      });
      if (b && call.classification === "Escalated") Object.assign(b, { disposition: "Escalated", channel: "Human Desk", escalatedAt: call.ts });
      calls++;
    }
  }
  if (Array.isArray(body.agents)) {
    for (const u of body.agents as { code: string; live?: number; max?: number }[]) {
      const ag = store.agents.find((x) => x.code === u.code);
      if (!ag) continue;
      if (typeof u.max === "number") ag.max = u.max;
      if (typeof u.live === "number") ag.live = Math.min(u.live, ag.max);
      agents++;
    }
  }
  if (calls || agents) { store.source = "api"; saveStore(store); }
  return NextResponse.json({ calls, agents });
}
