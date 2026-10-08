import crypto from "crypto";
import { NextResponse } from "next/server";
import { maskPhone } from "@/lib/mock";
import { addEvent, audit, getStore, saveStore } from "@/lib/store";
import type { Call, Channel, Disposition } from "@/lib/types";

const CLASSES: Disposition[] = ["Paid", "PTP", "Partial", "Callback", "Dispute", "No Contact", "Escalated"];
const CHANNELS: Channel[] = ["AI Voice", "WhatsApp", "Human Desk"];
const MAX_CALLS = 500;

const sameKey = (given: string | null, expected: string) => {
  const h = (v: string) => crypto.createHash("sha256").update(v).digest();
  return !!given && crypto.timingSafeEqual(h(given), h(expected));
};
const str = (v: unknown, max = 80) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);
const int = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);

// Webhook for dialer / WhatsApp platforms. Auth: `x-api-key` header = INGEST_KEY.
// Body: { calls?: Partial<Call>[], agents?: { code: string; live?: number; max?: number }[] }
export async function POST(req: Request) {
  const key = process.env.INGEST_KEY ?? (process.env.NODE_ENV === "production" ? "" : "dev-key");
  if (!key || (process.env.NODE_ENV === "production" && key === "dev-key"))
    return NextResponse.json({ error: "Ingest is not configured. Set INGEST_KEY." }, { status: 503 });
  if (!sameKey(req.headers.get("x-api-key"), key)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  if (Array.isArray(body.calls) && body.calls.length > MAX_CALLS) return NextResponse.json({ error: `At most ${MAX_CALLS} calls per request` }, { status: 413 });

  const store = getStore();
  const byLoan = new Map(store.borrowers.map((b) => [b.loanId, b]));
  let calls = 0, agents = 0, rejected = 0;
  if (Array.isArray(body.calls)) {
    const known = new Set(store.calls.map((c) => c.callId));
    for (const c of body.calls as Record<string, unknown>[]) {
      const callId = str(c.callId, 64), campaign = str(c.campaign, 64), ts = str(c.ts, 40);
      const t = ts ? Date.parse(ts) : NaN;
      const duration = c.durationSec === undefined ? 0 : int(c.durationSec, 0, 4 * 3600);
      if (!callId || !campaign || !Number.isFinite(t) || t > Date.now() + 5 * 60_000 || duration === undefined || known.has(callId)) { rejected++; continue; }
      const loanId = str(c.loanId, 40);
      const b = loanId ? byLoan.get(loanId) : undefined;
      const connected = typeof c.connected === "boolean" ? c.connected : duration > 0;
      const classification = CLASSES.includes(c.classification as Disposition) ? (c.classification as Disposition) : connected ? "Callback" : "No Contact";
      const channel = CHANNELS.includes(c.channel as Channel) ? (c.channel as Channel) : "AI Voice";
      const recording = str(c.recordingUrl, 500);
      const call: Call = {
        id: `I${Date.now().toString(36)}_${calls}`, ts: new Date(t).toISOString(), callId, campaign,
        phone: b?.phone ?? maskPhone(str(c.phone, 20) ?? ""), loanId: loanId ?? "", product: b?.product ?? str(c.product) ?? "Unknown",
        portfolio: b?.portfolio ?? str(c.portfolio) ?? "Default", channel, durationSec: duration,
        classification, connected, dropReason: connected ? undefined : str(c.dropReason, 40) ?? "no_answer",
        attemptNo: int(c.attemptNo, 1, 50) ?? 1, visible: typeof c.visible === "boolean" ? c.visible : true,
        language: str(c.language, 30), disclosed: typeof c.disclosed === "boolean" ? c.disclosed : undefined,
        recordingUrl: recording && recording.startsWith("https://") ? recording : undefined,
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
    for (const u of body.agents as Record<string, unknown>[]) {
      const ag = store.agents.find((x) => x.code === u.code);
      if (!ag) { rejected++; continue; }
      const max = u.max === undefined ? undefined : int(u.max, 0, 1000), live = u.live === undefined ? undefined : int(u.live, 0, 1000);
      if ((u.max !== undefined && max === undefined) || (u.live !== undefined && live === undefined)) { rejected++; continue; }
      if (max !== undefined) ag.max = max;
      if (live !== undefined) ag.live = Math.min(live, ag.max);
      agents++;
    }
  }
  if (calls || agents) {
    store.source = "api";
    audit(store, { username: "dialer-api", role: "operator" }, "ingest", "events", `${calls} call(s), ${agents} agent update(s), ${rejected} rejected`);
    saveStore(store);
  }
  return NextResponse.json({ calls, agents, rejected });
}
