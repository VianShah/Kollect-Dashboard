import { NextResponse } from "next/server";
import { audit, getStore, saveStore } from "@/lib/store";
import type { TouchStatus, WaStatus } from "@/lib/types";
import { addWaMessage, advances, borrowerByPhone, normalizePhone, safeEqual, validSignature, waConfig, waState } from "@/lib/whatsapp";

// Meta's WhatsApp webhook. Public on purpose (Meta can't log in); every POST must carry a valid signature.
export const dynamic = "force-dynamic";

/** Meta's one-time check when the callback URL is saved: echo hub.challenge if the verify token matches. */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  const expected = waConfig().verifyToken;
  const token = p.get("hub.verify_token") ?? "";
  if (expected && p.get("hub.mode") === "subscribe" && safeEqual(token, expected)) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

const TOUCH: Partial<Record<WaStatus, TouchStatus>> = { sent: "Sent", delivered: "Delivered", read: "Read", failed: "Failed" };
const OPT_OUT = /^\s*(stop|unsubscribe|opt[\s-]?out|band karo|बंद)\s*$/i;
const SYSTEM = { username: "whatsapp-webhook", role: "superadmin" as const };

interface MetaError { code?: number; title?: string; message?: string; error_data?: { details?: string } }

export async function POST(req: Request) {
  if (!waConfig().appSecret) return new NextResponse("WhatsApp app secret not configured", { status: 503 });
  const raw = await req.text();
  if (!validSignature(raw, req.headers.get("x-hub-signature-256"))) return new NextResponse("Invalid signature", { status: 401 });

  let payload: { entry?: { changes?: { field?: string; value?: Record<string, unknown> }[] }[] };
  try { payload = JSON.parse(raw); } catch { return new NextResponse("Bad JSON", { status: 400 }); }

  const s = getStore();
  const st = waState(s);
  st.lastWebhookAt = new Date().toISOString();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = (change.value ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

      if (change.field === "message_template_status_update") {
        const t = st.templates.find((x) => x.name === v.message_template_name && (!v.message_template_language || x.language === v.message_template_language));
        if (t && v.event) { t.status = String(v.event); t.rejectedReason = v.reason && v.reason !== "NONE" ? String(v.reason) : undefined; }
        continue;
      }
      if (change.field !== "messages") continue;

      // Delivery updates for messages we sent.
      for (const u of (v.statuses ?? []) as { id: string; status: WaStatus; timestamp?: string; recipient_id?: string; errors?: MetaError[] }[]) {
        const at = u.timestamp ? new Date(Number(u.timestamp) * 1000).toISOString() : new Date().toISOString();
        const err = u.errors?.[0];
        const m = st.messages.find((x) => x.id === u.id);
        if (m && (advances(m.status, u.status) || u.status === "failed")) {
          m.status = u.status; m.statusAt = at;
          if (err) m.error = { code: err.code, title: err.title ?? err.message ?? "Failed", detail: err.error_data?.details ?? err.message };
        }
        const touch = s.touches.find((x) => x.waId === u.id);
        const ts = TOUCH[u.status];
        if (touch && ts && touch.status !== "Replied") {
          touch.status = ts;
          if (err) touch.error = `${err.code ?? ""} ${err.title ?? err.message ?? ""}`.trim();
        }
      }

      // Messages people sent us: log them, open the 24-hour window, honour opt-outs.
      const names: Record<string, string> = {};
      for (const c of (v.contacts ?? []) as { wa_id: string; profile?: { name?: string } }[]) if (c.profile?.name) names[c.wa_id] = c.profile.name;
      for (const m of (v.messages ?? []) as { id: string; from: string; timestamp?: string; type: string; text?: { body?: string }; button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } } }[]) {
        const from = normalizePhone(m.from);
        const at = m.timestamp ? new Date(Number(m.timestamp) * 1000).toISOString() : new Date().toISOString();
        const text = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? `[${m.type}]`;
        if (st.messages.some((x) => x.id === m.id)) continue; // Meta retries; don't log twice
        st.contacts[from] = { lastInboundAt: at, name: names[m.from] ?? st.contacts[from]?.name };
        const b = borrowerByPhone(s, from);
        addWaMessage(s, { id: m.id, ts: at, direction: "in", to: from, kind: "text", text, status: "received", borrowerId: b?.id, loanId: b?.loanId });
        if (b) {
          const last = s.touches.find((x) => x.loanId === b.loanId && x.channel === "WhatsApp");
          if (last) last.status = "Replied";
          if (OPT_OUT.test(text) && b.waConsent) {
            b.waConsent = false;
            audit(s, SYSTEM, "wa_opt_out", b.loanId, `Replied "${text.trim()}" on WhatsApp`);
          }
        }
      }
    }
  }
  saveStore(s);
  return new NextResponse("OK", { status: 200 });
}
