import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import type { SessionUser } from "@/lib/auth";
import { audienceOf } from "@/lib/campaigns";
import { audit, saveStore } from "@/lib/store";
import type { Borrower, Campaign, Store, WaMessage, WaTemplate } from "@/lib/types";
import { WA_FIELDS, fieldValue, mapValue, type WaMapping } from "@/lib/waFields";
import {
  addWaMessage, fetchHealth, fetchTemplates, maskPhone, normalizePhone, renderTemplate, sendTemplate, sendText,
  syncWaConnector, waConfig, waState, windowOpenFor,
} from "@/lib/whatsapp";
import { canContact } from "@/lib/contact";

const now = () => new Date().toISOString();
const MAX_LIVE_BATCH = 250; // Meta's current daily limit for new conversations on this number
const MAX_TEST_BATCH = 5;   // test mode sends every campaign message to the test numbers; keep it small

/** Things still blocking or worth doing, from the setup decisions plus what the live checks show. */
function todos(s: Store) {
  const cfg = waConfig(), st = waState(s), n = st.health?.number;
  const own = st.templates.filter((t) => t.name !== "3p_direct_integration_test_template");
  const list: { title: string; detail: string; state: "blocker" | "todo" | "parked" | "done"; due?: string }[] = [];
  if (cfg.missing.length) list.push({ state: "blocker", title: "Add the WhatsApp env vars to this server", detail: `Missing: ${cfg.missing.join(", ")}.` });
  list.push({ state: "blocker", title: "Add a payment method to the \"Vian Shah\" WhatsApp account", due: "21 Oct 2026",
    detail: "Templates from +91 98676 76954 are accepted by Meta but not delivered. The ₹40 balance sits on the Predixion.AI account, which doesn't pay for this number. WhatsApp Manager → switch to Vian Shah → Payment settings → Add payment method." });
  if (!own.some((t) => t.status === "APPROVED"))
    list.push({ state: "todo", title: "Wait for our own templates to be approved", detail: own.length ? own.map((t) => `${t.name} (${t.language}): ${t.status}${t.rejectedReason ? ` · ${t.rejectedReason}` : ""}`).join("; ") : "Sync templates to see their review status." });
  if (n && n.code_verification_status && n.code_verification_status !== "VERIFIED")
    list.push({ state: "todo", title: "Verify +91 98676 76954 in WhatsApp Manager", detail: `Meta shows it as ${n.code_verification_status}. Phone numbers → the number → Verify, and enter the code Meta sends by SMS or call.` });
  if (n && n.verified_name && n.verified_name !== "Predixion AI")
    list.push({ state: "todo", title: "Change the display name to Predixion AI", detail: `Borrowers currently see "${n.verified_name}" (${n.name_status ?? "status unknown"}). Edit it in WhatsApp Manager → Phone numbers → Profile, then wait for Meta's review.` });
  if (!st.lastWebhookAt)
    list.push({ state: "todo", title: "Point Meta's webhook at this dashboard", detail: "MessageX → WhatsApp → Configuration → Callback URL: this site's /api/whatsapp/webhook, with the same verify token. Until then, delivery updates and replies go to the GFF demo." });
  if (!cfg.testNumbers.length) list.push({ state: "todo", title: "Set WHATSAPP_TEST_NUMBERS", detail: "Test-mode campaign sends go to these numbers instead of borrowers." });
  list.push({ state: "parked", title: "Predixion.AI number +1 711-510-8860", detail: "Meta-provided number, being dropped. If it's ever needed: submit the display name for review (error 131037) and give the MessageX system user access to the Predixion.AI WhatsApp account." });
  list.push({ state: "todo", title: "Rotate the keys that were shared in chat", detail: "Meta access token and app secret (also Sarvam and Vobiz on the GFF demo). Update the env vars after." });
  list.push({ state: "parked", title: "WhatsApp opt-in for real borrowers", detail: "Decide where waConsent comes from before UAT (lender file, form or IVR)." });
  return list;
}

function view(s: Store, user: SessionUser) {
  const cfg = waConfig(), st = waState(s);
  syncWaConnector(s);
  return {
    configured: !cfg.missing.length, missing: cfg.missing, mode: cfg.mode, testNumbers: cfg.testNumbers.map(maskPhone),
    appId: cfg.appId, wabaId: cfg.wabaId, phoneNumberId: cfg.phoneNumberId, version: cfg.version, source: s.source,
    health: st.health, templates: st.templates, templatesSyncedAt: st.templatesSyncedAt, lastWebhookAt: st.lastWebhookAt,
    messages: st.messages.slice(0, 200).map((m) => ({ ...m, to: maskPhone(m.to), redirectedFrom: m.redirectedFrom ? maskPhone(m.redirectedFrom) : undefined })),
    openWindows: Object.entries(st.contacts).filter(([p]) => windowOpenFor(s, p)).map(([p, c]) => ({ to: maskPhone(p), until: new Date(Date.parse(c.lastInboundAt) + 86_400_000).toISOString() })),
    campaigns: s.campaigns.map((c) => ({ id: c.id, name: c.name, status: c.status, members: c.members.length || audienceOf(s, c.audience).filter((b) => b.disposition !== "Dispute").length })),
    fields: WA_FIELDS, todos: todos(s), canSend: true, user: user.username,
  };
}

export async function GET() {
  const a = await requireUser(undefined, "campaigns");
  if ("res" in a) return a.res;
  return NextResponse.json(view(a.store, a.user));
}

/** Who a borrower-linked message really goes to. Test mode sends to the test numbers; live mode refuses mock data. */
function recipientFor(s: Store, b: Borrower, i: number): { to: string; redirectedFrom?: string } | { error: string } {
  const cfg = waConfig();
  const real = normalizePhone(b.phoneFull ?? "");
  if (cfg.mode === "test") {
    if (!cfg.testNumbers.length) return { error: "Test mode needs WHATSAPP_TEST_NUMBERS." };
    return { to: cfg.testNumbers[i % cfg.testNumbers.length], redirectedFrom: real || undefined };
  }
  if (s.source === "mock") return { error: "These are demo borrowers with made-up numbers. Upload real data, or switch WHATSAPP_MODE to test." };
  return real ? { to: real } : { error: "No valid phone number on file." };
}

/** Consent and dispute always apply. The calling-hours window applies in live mode only, since test sends go to our own numbers. */
function allowed(s: Store, b: Borrower): string | null {
  if (waConfig().mode === "test") {
    if (b.disposition === "Dispute") return "Disputed account";
    if (!b.waConsent) return "No WhatsApp opt-in";
    return null;
  }
  const v = canContact(s, b, "whatsapp");
  return v.ok ? null : v.reason ?? "Not allowed right now";
}

type SendSpec = { mode: "template"; template: WaTemplate; body: string[]; header: string[] } | { mode: "text"; text: string };

async function deliver(s: Store, user: SessionUser, to: string, spec: SendSpec, ctx: { borrower?: Borrower; campaign?: Campaign; redirectedFrom?: string }) {
  const res = spec.mode === "template" ? await sendTemplate(to, spec.template, spec.body, spec.header) : await sendText(to, spec.text);
  const text = spec.mode === "template" ? renderTemplate(spec.template, spec.body, spec.header) : spec.text;
  const msg: WaMessage = {
    id: res.ok ? res.id : `failed_${Date.now()}_${Math.floor(Math.random() * 1e6)}`, ts: now(), direction: "out", to, kind: spec.mode,
    template: spec.mode === "template" ? spec.template.name : undefined, language: spec.mode === "template" ? spec.template.language : undefined,
    text, status: res.ok ? "accepted" : "failed", statusAt: now(), error: res.ok ? undefined : res.error,
    borrowerId: ctx.borrower?.id, loanId: ctx.borrower?.loanId, campaignId: ctx.campaign?.id, redirectedFrom: ctx.redirectedFrom, by: user.username,
  };
  addWaMessage(s, msg);
  if (ctx.borrower) {
    s.touches.unshift({ id: `T${Date.now()}${Math.floor(Math.random() * 1000)}`, ts: msg.ts, loanId: ctx.borrower.loanId, channel: "WhatsApp",
      template: msg.template ?? "Free text", status: res.ok ? "Sent" : "Failed", text, waId: res.ok ? res.id : undefined, error: res.ok ? undefined : `${res.error.code ?? ""} ${res.error.title}`.trim() });
  }
  return msg;
}

function templateFrom(s: Store, name: unknown, language: unknown) {
  return waState(s).templates.find((t) => t.name === name && (!language || t.language === language));
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const gate = action === "campaignSend" || action === "campaignPreview" ? "manageCampaigns" : action === "send" || action === "borrower" ? "sendLink" : undefined;
  const a = await requireUser(gate, "campaigns");
  if ("res" in a) return a.res;
  const { store: s, user } = a;
  const cfg = waConfig();
  const st = waState(s);

  if (action !== "borrower" && cfg.missing.length) return bad(`WhatsApp isn't configured on this server. Missing: ${cfg.missing.join(", ")}.`, 503);

  if (action === "health") {
    const h = await fetchHealth();
    st.health = { checkedAt: now(), ok: h.ok, ...(h.ok ? { number: h.number } : { error: h.error }) };
    syncWaConnector(s);
    saveStore(s);
    return NextResponse.json(view(s, user));
  }

  if (action === "syncTemplates") {
    const r = await fetchTemplates();
    if (!r.ok) return bad(`Meta: ${r.error.title}`, 502);
    st.templates = r.templates; st.templatesSyncedAt = now();
    audit(s, user, "wa_sync_templates", "WhatsApp", `${r.templates.length} templates`);
    saveStore(s);
    return NextResponse.json(view(s, user));
  }

  if (action === "borrower") {
    const b = s.borrowers.find((x) => x.loanId.toUpperCase() === String(body.loanId ?? "").trim().toUpperCase());
    if (!b) return bad("No borrower with that loan ID.", 404);
    return NextResponse.json({
      borrower: { id: b.id, name: b.name, loanId: b.loanId, product: b.product, portfolio: b.portfolio, phone: b.phone, waConsent: b.waConsent, disposition: b.disposition },
      values: Object.fromEntries(WA_FIELDS.map((f) => [f.key, fieldValue(b, f.key)])),
      blocked: allowed(s, b), recipient: (() => { const r = recipientFor(s, b, 0); return "error" in r ? { error: r.error } : { to: maskPhone(r.to), redirected: !!r.redirectedFrom }; })(),
    });
  }

  if (action === "send") {
    let spec: SendSpec;
    if (body.mode === "text") {
      const text = String(body.text ?? "").trim();
      if (!text) return bad("Write the message first.");
      spec = { mode: "text", text: text.slice(0, 4096) };
    } else {
      const t = templateFrom(s, body.template, body.language);
      if (!t) return bad("Pick a template. Sync templates if the list is empty.");
      if (t.status !== "APPROVED") return bad(`"${t.name}" is ${t.status.toLowerCase()} at Meta; only approved templates can be sent.`);
      const vals = (k: unknown) => (Array.isArray(k) ? k.map((v) => String(v ?? "").trim()) : []);
      const bodyVals = vals(body.params), headerVals = vals(body.headerParams);
      if (bodyVals.length < t.bodyParams.length || bodyVals.some((v) => !v)) return bad("Fill in every template variable.");
      if (headerVals.length < t.headerParams.length || headerVals.some((v) => !v)) return bad("Fill in the header variable.");
      if (bodyVals.some((v) => /[\n\t]| {5,}/.test(v))) return bad("Variables can't contain line breaks, tabs or more than four spaces in a row (Meta rejects them).");
      spec = { mode: "template", template: t, body: bodyVals, header: headerVals };
    }
    let to: string, borrower: Borrower | undefined, redirectedFrom: string | undefined;
    if (body.loanId) {
      borrower = s.borrowers.find((x) => x.loanId.toUpperCase() === String(body.loanId).trim().toUpperCase());
      if (!borrower) return bad("No borrower with that loan ID.", 404);
      const blocked = allowed(s, borrower);
      if (blocked) { audit(s, user, "contact_blocked", borrower.loanId, blocked); saveStore(s); return bad(blocked, 409); }
      const r = recipientFor(s, borrower, 0);
      if ("error" in r) return bad(r.error, 409);
      ({ to, redirectedFrom } = r);
    } else {
      to = normalizePhone(body.to);
      if (!to) return bad("Enter a valid phone number, with the country code for non-Indian numbers.");
    }
    if (spec.mode === "text" && !windowOpenFor(s, to))
      return bad("Free text only reaches someone who has messaged our WhatsApp number in the last 24 hours. Send an approved template instead, or ask them to send \"Hi\" first.", 409);
    const msg = await deliver(s, user, to, spec, { borrower, redirectedFrom });
    audit(s, user, msg.status === "failed" ? "wa_send_failed" : "wa_send", borrower?.loanId ?? maskPhone(to), `${spec.mode === "template" ? spec.template.name : "text"}${msg.error ? ` · ${msg.error.code ?? ""} ${msg.error.title}` : ""}`);
    saveStore(s);
    return NextResponse.json({ message: { ...msg, to: maskPhone(msg.to) }, ...view(s, user) }, { status: msg.status === "failed" ? 502 : 200 });
  }

  if (action === "campaignPreview" || action === "campaignSend") {
    const c = s.campaigns.find((x) => x.id === body.campaignId);
    if (!c) return bad("Pick a campaign.", 404);
    const t = templateFrom(s, body.template, body.language);
    if (!t) return bad("Pick a template. Sync templates if the list is empty.");
    const mapping: WaMapping[] = Array.isArray(body.mapping) ? body.mapping : [];
    const headerMapping: WaMapping[] = Array.isArray(body.headerMapping) ? body.headerMapping : [];
    if (mapping.length < t.bodyParams.length || headerMapping.length < t.headerParams.length) return bad("Map every template variable.");

    const members = c.members.length ? c.members.map((id) => s.borrowers.find((b) => b.id === id)).filter(Boolean) as Borrower[]
      : audienceOf(s, c.audience).filter((b) => b.disposition !== "Dispute");
    const skipped: Record<string, number> = {};
    const eligible = members.filter((b) => { const why = allowed(s, b); if (why) skipped[why] = (skipped[why] ?? 0) + 1; return !why; });
    const cap = cfg.mode === "test" ? MAX_TEST_BATCH : MAX_LIVE_BATCH;
    const limit = Math.max(1, Math.min(Number(body.limit) || cap, cap, eligible.length || 1));
    const batch = eligible.slice(0, limit);
    const sample = batch[0];
    const summary = {
      campaign: c.name, members: members.length, eligible: eligible.length, willSend: batch.length, skipped, mode: cfg.mode, cap,
      testNumbers: cfg.testNumbers.map(maskPhone), template: t.name, language: t.language,
      sample: sample ? { name: sample.name, loanId: sample.loanId, text: renderTemplate(t, mapping.map((m) => mapValue(sample, m)), headerMapping.map((m) => mapValue(sample, m))) } : null,
      liveBlocked: cfg.mode === "live" && s.source === "mock" ? "Live mode can't send to demo borrowers. Upload real data first." : null,
    };
    if (t.status !== "APPROVED") return bad(`"${t.name}" is ${t.status.toLowerCase()} at Meta; only approved templates can be sent.`);
    if (action === "campaignPreview") return NextResponse.json({ preview: summary });
    if (summary.liveBlocked) return bad(summary.liveBlocked, 409);
    if (!batch.length) return bad("No one in this campaign can be messaged right now.", 409);

    const results = { sent: 0, failed: 0, errors: {} as Record<string, number> };
    for (let i = 0; i < batch.length; i++) {
      const b = batch[i];
      const r = recipientFor(s, b, i);
      if ("error" in r) { results.failed++; results.errors[r.error] = (results.errors[r.error] ?? 0) + 1; continue; }
      const vals = mapping.map((m) => mapValue(b, m)), hvals = headerMapping.map((m) => mapValue(b, m));
      const msg = await deliver(s, user, r.to, { mode: "template", template: t, body: vals, header: hvals }, { borrower: b, campaign: c, redirectedFrom: r.redirectedFrom });
      if (msg.status === "failed") { results.failed++; const k = `${msg.error?.code ?? ""} ${msg.error?.title ?? "Failed"}`.trim(); results.errors[k] = (results.errors[k] ?? 0) + 1; }
      else { results.sent++; c.stats.attempts++; }
      if (i < batch.length - 1) await new Promise((r2) => setTimeout(r2, 250));
    }
    audit(s, user, "wa_campaign_send", c.name, `${t.name} · ${cfg.mode} · sent ${results.sent}, failed ${results.failed}`);
    saveStore(s);
    return NextResponse.json({ result: { ...results, mode: cfg.mode }, ...view(s, user) });
  }

  return bad("Unknown action");
}
