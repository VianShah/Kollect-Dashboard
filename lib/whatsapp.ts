// Server-only client for Meta's WhatsApp Cloud API (graph.facebook.com), ported from the
// GFF demo. Credentials come from env vars, never from data/store.json.
import crypto from "crypto";
import type { Store, WaMessage, WaState, WaTemplate } from "./types";

export type WaMode = "test" | "live";

/** The sending number picked on the WhatsApp page, read from the in-memory store so every caller of waConfig() sees it. */
const selectedNumber = () => (globalThis as unknown as { __kollect?: Store }).__kollect?.wa?.phoneNumberId ?? "";

/** Opaque id for a conversation, so the browser can reply without ever holding the full phone number. */
export const chatId = (phone: string) => `c_${crypto.createHash("sha256").update(phone).digest("hex").slice(0, 16)}`;

export interface WaNumber { id: string; display_phone_number: string; verified_name?: string; quality_rating?: string; status?: string; code_verification_status?: string }

/** Every phone number on the WhatsApp Business account, so the sending number can be switched. */
export async function fetchPhoneNumbers(): Promise<{ ok: true; numbers: WaNumber[] } | { ok: false; error: GraphError }> {
  const r = await graph(`${waConfig().wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating,status,code_verification_status`);
  return r.ok ? { ok: true, numbers: r.json.data ?? [] } : { ok: false, error: graphError(r.json) };
}

export function waConfig() {
  const env = process.env;
  const cfg = {
    token: env.WHATSAPP_ACCESS_TOKEN ?? "",
    appSecret: env.WHATSAPP_APP_SECRET ?? "",
    verifyToken: env.WHATSAPP_VERIFY_TOKEN ?? "",
    appId: env.WHATSAPP_APP_ID ?? "",
    wabaId: env.WHATSAPP_WABA_ID ?? "",
    // A Super Admin can switch the sending number on the WhatsApp page; that choice wins over the env default.
    phoneNumberId: selectedNumber() || (env.WHATSAPP_PHONE_NUMBER_ID ?? ""),
    defaultPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID ?? "",
    version: env.WHATSAPP_GRAPH_VERSION || "v26.0",
    mode: (env.WHATSAPP_MODE === "live" ? "live" : "test") as WaMode,
    testNumbers: (env.WHATSAPP_TEST_NUMBERS ?? "").split(",").map((n) => normalizePhone(n)).filter(Boolean) as string[],
  };
  const required: [string, string][] = [
    ["WHATSAPP_ACCESS_TOKEN", cfg.token], ["WHATSAPP_APP_SECRET", cfg.appSecret], ["WHATSAPP_VERIFY_TOKEN", cfg.verifyToken],
    ["WHATSAPP_WABA_ID", cfg.wabaId], ["WHATSAPP_PHONE_NUMBER_ID", cfg.phoneNumberId],
  ];
  return { ...cfg, missing: required.filter(([, v]) => !v).map(([k]) => k) };
}

/** Digits only, with India's 91 added to a bare 10-digit mobile number. Returns "" when it can't be a phone number. */
export function normalizePhone(raw: string | undefined | null): string {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 10) return `91${d}`;
  return d.length >= 11 && d.length <= 15 ? d : "";
}
export const maskPhone = (p: string) => (p.length > 4 ? `+${p.slice(0, 2)} •••••${p.slice(-4)}` : p);

export function waState(s: Store): WaState {
  return (s.wa ??= { templates: [], messages: [], contacts: {}, lastWebhookAt: undefined, health: undefined, templatesSyncedAt: undefined });
}

/**
 * Keeps the WhatsApp integration card honest. With the WHATSAPP_* env vars set, its status comes from the
 * last real check against Meta; without them it is left as the demo connection so demo launches still work.
 */
export function syncWaConnector(s: Store) {
  const c = s.connectors.find((x) => x.kind === "whatsapp");
  if (!c) return;
  const cfg = waConfig();
  if (cfg.missing.length) return;
  const h = waState(s).health;
  c.provider = "Meta Cloud API";
  c.config = { number: h?.number?.display_phone_number ?? "", phoneNumberId: cfg.phoneNumberId, wabaId: cfg.wabaId };
  c.status = !h ? "Not connected" : h.ok ? "Connected" : "Error";
  c.lastTest = h?.checkedAt;
  c.lastResult = !h ? "Run a connection check on the WhatsApp page." : h.ok ? `${h.number?.verified_name ?? "Number"} · ${h.number?.status ?? ""}` : `${h.error?.code ?? ""} ${h.error?.title ?? "Check failed"}`.trim();
}

export function addWaMessage(s: Store, m: WaMessage) {
  const st = waState(s);
  st.messages.unshift(m);
  if (st.messages.length > 2000) st.messages.length = 2000;
}

async function graph(path: string, init: RequestInit = {}) {
  const cfg = waConfig();
  const res = await fetch(`https://graph.facebook.com/${cfg.version}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export interface GraphError { code?: number; title: string; detail?: string }
export const graphError = (json: { error?: { code?: number; message?: string; error_user_msg?: string; error_data?: { details?: string } } }): GraphError => ({
  code: json?.error?.code,
  title: json?.error?.message ?? "Meta rejected the request",
  detail: json?.error?.error_data?.details ?? json?.error?.error_user_msg,
});

/** The sending number as Meta sees it: name, review state, verification, quality and daily limit. */
export async function fetchHealth() {
  const cfg = waConfig();
  const fields = "display_phone_number,verified_name,name_status,status,code_verification_status,quality_rating,messaging_limit_tier,platform_type,account_mode";
  const r = await graph(`${cfg.phoneNumberId}?fields=${fields}`);
  return r.ok ? { ok: true as const, number: r.json } : { ok: false as const, error: graphError(r.json) };
}

/** Placeholders in a template text: positional {{1}} or named {{customer_name}}, in order of first appearance. */
export function placeholders(text: string | undefined): string[] {
  const out: string[] = [];
  for (const m of (text ?? "").matchAll(/\{\{\s*([\w]+)\s*\}\}/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

interface RawComponent { type: string; format?: string; text?: string }
export async function fetchTemplates(): Promise<{ ok: true; templates: WaTemplate[] } | { ok: false; error: GraphError }> {
  const cfg = waConfig();
  const r = await graph(`${cfg.wabaId}/message_templates?fields=name,language,status,category,components,rejected_reason&limit=200`);
  if (!r.ok) return { ok: false, error: graphError(r.json) };
  const templates: WaTemplate[] = (r.json.data ?? []).map((t: { id: string; name: string; language: string; status: string; category: string; rejected_reason?: string; components?: RawComponent[] }) => {
    const body = t.components?.find((c) => c.type === "BODY");
    const header = t.components?.find((c) => c.type === "HEADER" && c.format === "TEXT");
    return {
      id: t.id, name: t.name, language: t.language, status: t.status, category: t.category,
      rejectedReason: t.rejected_reason && t.rejected_reason !== "NONE" ? t.rejected_reason : undefined,
      body: body?.text ?? "", header: header?.text, bodyParams: placeholders(body?.text), headerParams: placeholders(header?.text),
    };
  });
  return { ok: true, templates };
}

export interface NewTemplate {
  name: string; language: string; category: "UTILITY" | "MARKETING";
  header?: string; headerExample?: string; body: string; bodyExamples: string[]; footer?: string;
  quickReplies: string[]; url?: { text: string; url: string };
}

/** Submits a template for Meta's review. Variables are positional ({{1}}, {{2}}…) and each needs a sample value. */
export async function createTemplate(t: NewTemplate): Promise<{ ok: true; id: string; status: string } | { ok: false; error: GraphError }> {
  const components: object[] = [];
  if (t.header) components.push({ type: "HEADER", format: "TEXT", text: t.header, ...(t.headerExample ? { example: { header_text: [t.headerExample] } } : {}) });
  components.push({ type: "BODY", text: t.body, ...(t.bodyExamples.length ? { example: { body_text: [t.bodyExamples] } } : {}) });
  if (t.footer) components.push({ type: "FOOTER", text: t.footer });
  const buttons = [...t.quickReplies.map((text) => ({ type: "QUICK_REPLY", text })), ...(t.url ? [{ type: "URL", text: t.url.text, url: t.url.url }] : [])];
  if (buttons.length) components.push({ type: "BUTTONS", buttons });
  const r = await graph(`${waConfig().wabaId}/message_templates`, {
    method: "POST",
    body: JSON.stringify({ name: t.name, language: t.language, category: t.category, components }),
  });
  return r.ok && r.json?.id ? { ok: true, id: r.json.id, status: r.json.status ?? "PENDING" } : { ok: false, error: graphError(r.json) };
}

/** Fills a template's text with the values that will be sent, for previews and the message log. */
export function renderTemplate(t: WaTemplate, body: string[], header: string[] = []) {
  const fill = (text: string | undefined, names: string[], vals: string[]) =>
    (text ?? "").replace(/\{\{\s*([\w]+)\s*\}\}/g, (_, k) => vals[names.indexOf(k)] ?? `{{${k}}}`);
  return [t.header ? fill(t.header, t.headerParams, header) : "", fill(t.body, t.bodyParams, body)].filter(Boolean).join("\n\n");
}

const paramList = (names: string[], vals: string[]) =>
  names.map((n, i) => (/^\d+$/.test(n) ? { type: "text", text: vals[i] ?? "" } : { type: "text", parameter_name: n, text: vals[i] ?? "" }));

export type SendResult = { ok: true; id: string } | { ok: false; error: GraphError };

export async function sendTemplate(to: string, t: WaTemplate, body: string[], header: string[] = []): Promise<SendResult> {
  const components: object[] = [];
  if (t.headerParams.length) components.push({ type: "header", parameters: paramList(t.headerParams, header) });
  if (t.bodyParams.length) components.push({ type: "body", parameters: paramList(t.bodyParams, body) });
  const r = await graph(`${waConfig().phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template", template: { name: t.name, language: { code: t.language }, ...(components.length ? { components } : {}) } }),
  });
  const id = r.json?.messages?.[0]?.id;
  return r.ok && id ? { ok: true, id } : { ok: false, error: graphError(r.json) };
}

export async function sendText(to: string, text: string): Promise<SendResult> {
  const r = await graph(`${waConfig().phoneNumberId}/messages`, {
    method: "POST",
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: true } }),
  });
  const id = r.json?.messages?.[0]?.id;
  return r.ok && id ? { ok: true, id } : { ok: false, error: graphError(r.json) };
}

/** Meta signs every webhook POST: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(raw body, app secret). */
export function validSignature(raw: string, header: string | null) {
  const secret = waConfig().appSecret;
  if (!secret || !header) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const a = Buffer.from(header), b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

/** Free text is only allowed within 24 hours of the person's last message to us (Meta's customer-service window). */
export function windowOpenFor(s: Store, phone: string, now = Date.now()) {
  const last = waState(s).contacts[phone]?.lastInboundAt;
  return !!last && now - Date.parse(last) < 24 * 3600_000;
}

/** Matches a WhatsApp number to a borrower by the last 10 digits of their full number. */
export function borrowerByPhone(s: Store, phone: string) {
  const tail = phone.slice(-10);
  return s.borrowers.find((b) => normalizePhone(b.phoneFull ?? "").slice(-10) === tail);
}

/** Status only moves forward: a late "delivered" never overwrites "read", and "failed" always wins. */
const RANK: Record<string, number> = { accepted: 0, sent: 1, delivered: 2, read: 3, failed: 9 };
export const advances = (from: string, to: string) => (RANK[to] ?? 0) > (RANK[from] ?? 0);
