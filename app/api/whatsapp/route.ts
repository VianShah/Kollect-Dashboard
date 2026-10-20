import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import { can, type SessionUser } from "@/lib/auth";
import { audienceOf } from "@/lib/campaigns";
import { audit, saveStore } from "@/lib/store";
import type { Borrower, Campaign, Store, WaMessage, WaTemplate } from "@/lib/types";
import { WA_FIELDS, fieldValue, mapValue, type WaMapping } from "@/lib/waFields";
import {
  addWaMessage, borrowerByPhone, chatId, createTemplate, fetchHealth, fetchPhoneNumbers, fetchTemplates, maskPhone, normalizePhone, renderTemplate, sendTemplate, sendText,
  placeholders, syncWaConnector, waConfig, waState, windowOpenFor,
} from "@/lib/whatsapp";

/** One row per person messaged: latest message, delivery state of our last send, their replies, and the thread. */
function chats(s: Store) {
  const st = waState(s);
  const byPhone = new Map<string, WaMessage[]>();
  for (const m of st.messages) { const list = byPhone.get(m.to) ?? []; list.push(m); byPhone.set(m.to, list); } // newest first
  const saved = new Map((st.recipients ?? []).map((r) => [r.phone, r.name]));
  return [...byPhone.entries()].map(([phone, ms]) => {
    const id = chatId(phone);
    const linked = ms.find((m) => m.borrowerId);
    const b = linked ? s.borrowers.find((x) => x.id === linked.borrowerId) : borrowerByPhone(s, phone);
    const readAt = st.chatsReadAt?.[id];
    const lastIn = st.contacts[phone]?.lastInboundAt;
    return {
      id, phone: maskPhone(phone), name: saved.get(phone) || st.contacts[phone]?.name || b?.name || maskPhone(phone), loanId: b?.loanId,
      lastAt: ms[0].ts, lastText: ms[0].text, lastDirection: ms[0].direction, lastOutStatus: ms.find((m) => m.direction === "out")?.status,
      replies: ms.filter((m) => m.direction === "in").length, unread: ms.filter((m) => m.direction === "in" && (!readAt || m.ts > readAt)).length,
      windowOpen: windowOpenFor(s, phone), windowUntil: lastIn ? new Date(Date.parse(lastIn) + 86_400_000).toISOString() : undefined,
      messages: ms.slice(0, 80).reverse().map((m) => ({ id: m.id, ts: m.ts, direction: m.direction, text: m.text, status: m.status, template: m.template, error: m.error, by: m.by })),
    };
  }).sort((a, b) => b.lastAt.localeCompare(a.lastAt)).slice(0, 80);
}
const phoneForChat = (s: Store, id: string) => waState(s).messages.map((m) => m.to).find((p) => chatId(p) === id);

const MAX_JOB_ROWS = 2000;
const fieldsOf = (b: Borrower) => Object.fromEntries(WA_FIELDS.map((f) => [f.key, fieldValue(b, f.key)]));
import { canContact } from "@/lib/contact";
import { dailyUsage, jobCounts, jobView, kickJobs } from "@/lib/waJobs";
import { checkParam, doubledCurrency } from "@/lib/waValues";
import type { WaJob, WaJobItem } from "@/lib/types";

const now = () => new Date().toISOString();
const MAX_LIVE_BATCH = 250; // Meta's current daily limit for new conversations on this number
const MAX_TEST_BATCH = 5;   // test mode sends every campaign message to the test numbers; keep it small
const MAX_DIRECT_BATCH = 50; // typed or saved numbers in one "Send message"
const LANGUAGES = ["en_US", "en", "en_GB", "hi", "mr", "gu", "ta", "te", "kn", "bn", "ml", "pa"];

/** Things still blocking or worth doing, from the setup decisions plus what the live checks show. */
function todos(s: Store) {
  const cfg = waConfig(), st = waState(s), n = st.health?.number;
  const own = st.templates.filter((t) => t.name !== "3p_direct_integration_test_template");
  const list: { title: string; detail: string; state: "blocker" | "todo" | "parked" | "done"; due?: string }[] = [];
  if (cfg.missing.length) list.push({ state: "blocker", title: "Add the WhatsApp env vars to this server", detail: `Missing: ${cfg.missing.join(", ")}.` });
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
    recipients: st.recipients ?? [], languages: LANGUAGES,
    chats: chats(s), numbers: st.numbers ?? [], defaultPhoneNumberId: cfg.defaultPhoneNumberId,
    jobs: (st.jobs ?? []).slice(0, 10).map((j, i) => jobView(j, i < 3)),
    usage: (({ used, limit, remaining, freesAt, tier }) => ({ used, limit: Number.isFinite(limit) ? limit : null, remaining: Number.isFinite(remaining) ? remaining : null, freesAt, tier }))(dailyUsage(s)),
    fields: WA_FIELDS, todos: todos(s), canSend: true, user: user.username,
  };
}

export async function GET() {
  const a = await requireUser(undefined, "whatsapp");
  if ("res" in a) return a.res;
  kickJobs(); // picks up unfinished sends after a restart
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
  const gate = ["campaignSend", "campaignPreview", "createTemplate"].includes(action) ? "manageCampaigns"
    : ["listNumbers", "setNumber"].includes(action) ? "manageConnectors"
    : ["send", "borrower", "saveRecipient", "removeRecipient", "reply", "prepare", "startJob", "jobControl"].includes(action) ? "sendLink" : undefined;
  const a = await requireUser(gate, "whatsapp");
  if ("res" in a) return a.res;
  const { store: s, user } = a;
  const cfg = waConfig();
  const st = waState(s);

  if (action === "markRead") {
    const id = String(body.chatId ?? "");
    if (!phoneForChat(s, id)) return bad("Chat not found", 404);
    (st.chatsReadAt ??= {})[id] = now();
    saveStore(s, { throttle: true });
    return NextResponse.json(view(s, user));
  }

  if (action !== "borrower" && cfg.missing.length) return bad(`WhatsApp isn't configured on this server. Missing: ${cfg.missing.join(", ")}.`, 503);

  if (action === "listNumbers") {
    const r = await fetchPhoneNumbers();
    if (!r.ok) return bad(`Meta: ${r.error.title}`, 502);
    st.numbers = r.numbers;
    saveStore(s);
    return NextResponse.json(view(s, user));
  }

  if (action === "setNumber") {
    const pick = (st.numbers ?? []).find((n) => n.id === body.phoneNumberId);
    if (!pick) return bad("Load the account's numbers first, then pick one of them.");
    const before = cfg.phoneNumberId;
    st.phoneNumberId = pick.id === cfg.defaultPhoneNumberId ? undefined : pick.id;
    const h = await fetchHealth();
    st.health = { checkedAt: now(), ok: h.ok, ...(h.ok ? { number: h.number } : { error: h.error }) };
    syncWaConnector(s);
    audit(s, user, "wa_sending_number", "WhatsApp", `${before} → ${pick.id} (${pick.display_phone_number})`);
    saveStore(s);
    return NextResponse.json(view(s, user));
  }

  // Reply from the chat panel: free text inside the 24-hour window, otherwise an approved template.
  if (action === "reply") {
    const id = String(body.chatId ?? "");
    const phone = phoneForChat(s, id);
    if (!phone) return bad("Chat not found", 404);
    const history = st.messages.find((m) => m.to === phone && m.borrowerId);
    const borrower = history ? s.borrowers.find((x) => x.id === history.borrowerId) : undefined;
    if (borrower && !borrower.waConsent) return bad("This borrower has opted out of WhatsApp.", 409);
    let spec: SendSpec;
    if (body.mode === "template") {
      const t = templateFrom(s, body.template, body.language);
      if (!t || t.status !== "APPROVED") return bad("Pick an approved template.");
      const vals = (k: unknown) => (Array.isArray(k) ? k.map((v) => String(v ?? "").trim()) : []);
      const bv = vals(body.params), hv = vals(body.headerParams);
      if (bv.length < t.bodyParams.length || bv.some((v) => !v) || hv.length < t.headerParams.length || hv.some((v) => !v)) return bad("Fill in every template variable.");
      spec = { mode: "template", template: t, body: bv, header: hv };
    } else {
      const text = String(body.text ?? "").trim().slice(0, 4096);
      if (!text) return bad("Write a reply first.");
      if (!windowOpenFor(s, phone)) return bad("It's been more than 24 hours since they last messaged, so WhatsApp only allows an approved template. Switch to Template.", 409);
      spec = { mode: "text", text };
    }
    const msg = await deliver(s, user, phone, spec, { borrower: cfg.mode === "live" ? borrower : undefined });
    (st.chatsReadAt ??= {})[id] = now();
    audit(s, user, msg.status === "failed" ? "wa_send_failed" : "wa_reply", borrower?.loanId ?? maskPhone(phone), spec.mode === "template" ? spec.template.name : "text");
    saveStore(s);
    return NextResponse.json({ message: { ...msg, to: maskPhone(msg.to) }, ...view(s, user) }, { status: msg.status === "failed" ? 502 : 200 });
  }

  // Who a send goes to, with borrower details for filling variables and any reason they can't be messaged.
  if (action === "prepare") {
    const usage = dailyUsage(s);
    const meta = { mode: cfg.mode, testNumbers: cfg.testNumbers.map(maskPhone), usage: { used: usage.used, limit: Number.isFinite(usage.limit) ? usage.limit : null, freesAt: usage.freesAt } };
    if (body.source === "campaign") {
      if (!can(user, "bulkWhatsApp")) return bad("Only Super Admins and supervisors can message a whole campaign.", 403);
      const c = s.campaigns.find((x) => x.id === body.campaignId);
      if (!c) return bad("Pick a campaign.", 404);
      const members = (c.members.length ? c.members.map((id) => s.borrowers.find((b) => b.id === id)).filter(Boolean) as Borrower[]
        : audienceOf(s, c.audience).filter((b) => b.disposition !== "Dispute")).slice(0, MAX_JOB_ROWS);
      return NextResponse.json({ ...meta, rows: members.map((b) => ({ key: b.id, kind: "borrower", phone: b.phone, name: b.name, loanId: b.loanId, fields: fieldsOf(b), blocked: allowed(s, b) ?? undefined })) });
    }
    const raw: unknown[] = Array.isArray(body.phones) ? body.phones : [];
    if (raw.length > 1 && !can(user, "bulkWhatsApp")) return bad("Telecallers send to one person at a time. Ask a supervisor to send to a list.", 403);
    if (raw.length > MAX_JOB_ROWS) return bad(`At most ${MAX_JOB_ROWS} numbers in one send. Split the list.`);
    const seen = new Set<string>();
    const rows = raw.map((x) => {
      const phone = normalizePhone(String(x ?? ""));
      if (!phone) return { key: String(x ?? ""), kind: "phone", phone: String(x ?? ""), invalid: "Not a valid phone number" };
      if (seen.has(phone)) return { key: phone, kind: "phone", phone: `+${phone}`, invalid: "Duplicate of an earlier row" };
      seen.add(phone);
      const b = borrowerByPhone(s, phone);
      return { key: phone, kind: "phone", phone: `+${phone}`, name: b?.name, loanId: b?.loanId, fields: b ? fieldsOf(b) : undefined, blocked: b && !b.waConsent ? "Opted out of WhatsApp" : undefined };
    });
    return NextResponse.json({ ...meta, rows });
  }

  // Final check on every row, then queue it. Nothing reaches Meta unless the template, its variable count and every value pass.
  if (action === "startJob") {
    const t = templateFrom(s, body.template, body.language);
    if (!t) return bad("Pick a template. Sync templates if the list is empty.");
    if (t.status !== "APPROVED") return bad(`"${t.name}" is ${t.status.toLowerCase()} at Meta; only approved templates can be sent.`);
    const rowsIn: { key: string; kind: string; label?: string; body: unknown; header: unknown }[] = Array.isArray(body.rows) ? body.rows : [];
    if (!rowsIn.length) return bad("No one to send to.");
    if (rowsIn.length > MAX_JOB_ROWS) return bad(`At most ${MAX_JOB_ROWS} people in one send.`);
    if (rowsIn.length > 1 && !can(user, "bulkWhatsApp")) return bad("Telecallers send to one person at a time. Ask a supervisor to send to a list.", 403);
    const campaign = body.campaignId ? s.campaigns.find((x) => x.id === body.campaignId) : undefined;
    if (rowsIn.some((r) => r.kind === "borrower") && !can(user, "bulkWhatsApp")) return bad("Only Super Admins and supervisors can message a whole campaign.", 403);

    const items: WaJobItem[] = [];
    const problems: string[] = [];
    let testRedirects = 0;
    rowsIn.forEach((r, i) => {
      const strs = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()) : []);
      const bv = strs(r.body), hv = strs(r.header);
      const row = `Row ${i + 1}`;
      if (bv.length !== t.bodyParams.length || hv.length !== t.headerParams.length) { problems.push(`${row}: needs exactly ${t.bodyParams.length} value(s) for the body${t.headerParams.length ? ` and ${t.headerParams.length} for the header` : ""}`); return; }
      const bad1 = [...hv, ...bv].map(checkParam).find(Boolean);
      if (bad1) { problems.push(`${row}: ${bad1}`); return; }
      const filled = renderTemplate(t, bv, hv);
      if (filled.length > 1024) { problems.push(`${row}: the filled-in message is over 1,024 characters`); return; }
      if (doubledCurrency(filled)) { problems.push(`${row}: the currency symbol would show twice`); return; }
      if (r.kind === "borrower") {
        const b = s.borrowers.find((x) => x.id === r.key);
        if (!b) { problems.push(`${row}: borrower not found`); return; }
        const why = allowed(s, b);
        if (why) { items.push({ to: "", label: b.name, borrowerId: b.id, loanId: b.loanId, body: bv, header: hv, status: "skipped", error: why }); return; }
        const rec = recipientFor(s, b, i);
        if ("error" in rec) { items.push({ to: "", label: b.name, borrowerId: b.id, loanId: b.loanId, body: bv, header: hv, status: "skipped", error: rec.error }); return; }
        if (rec.redirectedFrom) testRedirects++;
        items.push({ to: rec.to, label: b.name, borrowerId: b.id, loanId: b.loanId, redirectedFrom: rec.redirectedFrom, body: bv, header: hv, status: "queued" });
      } else {
        const phone = normalizePhone(r.key);
        if (!phone) { problems.push(`${row}: not a valid phone number`); return; }
        const b = borrowerByPhone(s, phone);
        const label = String(r.label ?? "").slice(0, 60) || b?.name || maskPhone(phone);
        if (b && !b.waConsent) { items.push({ to: phone, label, borrowerId: b.id, loanId: b.loanId, body: bv, header: hv, status: "skipped", error: "Opted out of WhatsApp" }); return; }
        items.push({ to: phone, label, borrowerId: b?.id, loanId: b?.loanId, body: bv, header: hv, status: "queued" });
      }
    });
    if (problems.length) return NextResponse.json({ error: `Nothing was sent. Fix ${problems.length} row(s) first.`, problems: problems.slice(0, 50) }, { status: 422 });
    // Test mode sends every borrower's message to our own test numbers, so keep those runs small.
    if (cfg.mode === "test" && testRedirects > MAX_TEST_BATCH) {
      let kept = 0;
      for (const it of items) if (it.redirectedFrom && it.status === "queued" && ++kept > MAX_TEST_BATCH) { it.status = "skipped"; it.error = `Test mode sends at most ${MAX_TEST_BATCH} borrower messages to the test numbers`; }
    }
    if (!items.some((it) => it.status === "queued")) return bad("Everyone on this list is blocked or skipped. Check the reasons in the table.", 409);
    const job: WaJob = {
      id: `J${Date.now().toString(36)}`, createdAt: now(), by: user.username, byRole: user.role, template: t.name, language: t.language,
      campaignId: campaign?.id, source: campaign ? `Campaign · ${campaign.name}` : String(body.source ?? "numbers"), state: "running", items,
    };
    (st.jobs ??= []).unshift(job);
    if (st.jobs.length > 50) st.jobs.length = 50;
    const c0 = jobCounts(job);
    audit(s, user, "wa_job_start", t.name, `${job.source} · ${c0.queued} to send, ${c0.skipped} skipped · ${cfg.mode}`);
    saveStore(s);
    kickJobs();
    return NextResponse.json({ jobId: job.id, ...view(s, user) });
  }

  if (action === "jobControl") {
    const job = (st.jobs ?? []).find((j) => j.id === body.jobId);
    if (!job) return bad("Send not found", 404);
    if (job.by !== user.username && !can(user, "manageCampaigns")) return bad("Only the person who started this send, or a supervisor, can change it.", 403);
    const op = String(body.op ?? "");
    if (op === "pause" && (job.state === "running" || job.state === "waiting")) { job.state = "paused"; job.note = `Paused by ${user.username}`; }
    else if (op === "resume" && job.state === "paused") { job.state = "running"; job.note = undefined; }
    else if (op === "cancel" && job.state !== "done" && job.state !== "cancelled") {
      job.state = "cancelled"; job.note = `Cancelled by ${user.username}`;
      for (const it of job.items) if (it.status === "queued") { it.status = "skipped"; it.error = "Cancelled"; }
    } else if (op === "retryFailed") {
      const failed = job.items.filter((it) => it.status === "failed");
      if (!failed.length) return bad("No failed messages to retry.");
      for (const it of failed) { it.status = "queued"; it.error = undefined; }
      job.state = "running"; job.note = `Retrying ${failed.length} failed`;
    } else return bad("That isn't possible for this send right now.");
    audit(s, user, `wa_job_${op}`, job.template, job.id);
    saveStore(s);
    kickJobs();
    return NextResponse.json(view(s, user));
  }

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

  if (action === "saveRecipient") {
    const phone = normalizePhone(body.phone);
    if (!phone) return bad("Enter a valid phone number, with the country code for non-Indian numbers.");
    const list = (st.recipients ??= []);
    const name = String(body.name ?? "").trim().slice(0, 60) || undefined;
    const existing = list.find((r) => r.phone === phone);
    if (existing) existing.name = name ?? existing.name;
    else list.push({ phone, name, addedAt: now(), by: user.username });
    audit(s, user, "wa_save_number", maskPhone(phone), name ?? "");
    saveStore(s);
    return NextResponse.json(view(s, user));
  }

  if (action === "removeRecipient") {
    const phone = normalizePhone(body.phone);
    st.recipients = (st.recipients ?? []).filter((r) => r.phone !== phone);
    audit(s, user, "wa_remove_number", maskPhone(phone), "");
    saveStore(s);
    return NextResponse.json(view(s, user));
  }

  if (action === "createTemplate") {
    const name = String(body.name ?? "").trim();
    if (!/^[a-z0-9_]{1,512}$/.test(name)) return bad("Name: lowercase letters, numbers and underscores only (e.g. emi_reminder_v2).");
    const language = String(body.language ?? "");
    if (!LANGUAGES.includes(language)) return bad("Pick a language.");
    const category = body.category === "MARKETING" ? "MARKETING" : "UTILITY";
    const text = (v: unknown) => String(v ?? "").trim();
    const tBody = text(body.body), header = text(body.header), footer = text(body.footer);
    if (!tBody) return bad("Write the message body.");
    if (tBody.length > 1024) return bad("The body can be at most 1,024 characters.");
    if (header.length > 60 || footer.length > 60) return bad("Header and footer can be at most 60 characters each.");
    // Meta wants positional variables numbered 1, 2, 3… in order, not at the very start or end, with a sample for each.
    const bodyVars = placeholders(tBody), headerVars = placeholders(header);
    if ([...bodyVars, ...headerVars].some((v) => !/^\d+$/.test(v))) return bad("Use numbered variables like {{1}}, {{2}}.");
    if (bodyVars.some((v, i) => Number(v) !== i + 1)) return bad("Number the body variables in order: {{1}}, then {{2}}, and so on.");
    if (headerVars.length > 1 || (headerVars[0] && headerVars[0] !== "1")) return bad("The header can have one variable, {{1}}.");
    if (/^\s*\{\{|\}\}\s*$/.test(tBody)) return bad("The body can't start or end with a variable; add some words around it.");
    if (/\{\{|\}\}/.test(footer)) return bad("The footer can't contain variables.");
    const bodyExamples: string[] = (Array.isArray(body.bodyExamples) ? body.bodyExamples : []).map(text).slice(0, bodyVars.length);
    if (bodyExamples.length < bodyVars.length || bodyExamples.some((v) => !v)) return bad("Give a sample value for every body variable; Meta reviews with them.");
    const headerExample = headerVars.length ? text(body.headerExample) : undefined;
    if (headerVars.length && !headerExample) return bad("Give a sample value for the header variable.");
    const quickReplies: string[] = (Array.isArray(body.quickReplies) ? body.quickReplies : []).map(text).filter(Boolean).slice(0, 3);
    if (quickReplies.some((q) => q.length > 25)) return bad("Quick reply buttons can be at most 25 characters.");
    let url: { text: string; url: string } | undefined;
    if (text(body.urlText) || text(body.url)) {
      url = { text: text(body.urlText), url: text(body.url) };
      if (!url.text || url.text.length > 25) return bad("The link button needs a label of up to 25 characters.");
      if (!/^https:\/\/\S+$/.test(url.url)) return bad("The link button needs a full https:// address.");
    }
    if (st.templates.some((t) => t.name === name && t.language === language)) return bad(`A template called ${name} (${language}) already exists.`);
    const r = await createTemplate({ name, language, category, header: header || undefined, headerExample, body: tBody, bodyExamples, footer: footer || undefined, quickReplies, url });
    if (!r.ok) return bad(`Meta: ${r.error.title}${r.error.detail ? ` (${r.error.detail})` : ""}`, 502);
    audit(s, user, "wa_create_template", name, `${language} · ${category} · ${r.status}`);
    const synced = await fetchTemplates();
    if (synced.ok) { st.templates = synced.templates; st.templatesSyncedAt = now(); }
    saveStore(s);
    return NextResponse.json({ created: { id: r.id, status: r.status, name, language }, ...view(s, user) });
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
    if (!body.loanId) {
      const raw: unknown[] = Array.isArray(body.to) ? body.to : String(body.to ?? "").split(/[\s,;]+/);
      const list = [...new Set(raw.map((x) => normalizePhone(String(x))).filter(Boolean))];
      if (!list.length) return bad("Enter a valid phone number, with the country code for non-Indian numbers.");
      if (list.length > MAX_DIRECT_BATCH) return bad(`At most ${MAX_DIRECT_BATCH} numbers per send.`);
      if (spec.mode === "text" && list.length === 1 && !windowOpenFor(s, list[0]))
        return bad("Free text only reaches someone who has messaged our WhatsApp number in the last 24 hours. Send an approved template instead, or ask them to send \"Hi\" first.", 409);
      const results: { to: string; ok: boolean; error?: string }[] = [];
      let first: WaMessage | undefined;
      for (let i = 0; i < list.length; i++) {
        const to = list[i];
        if (spec.mode === "text" && !windowOpenFor(s, to)) { results.push({ to: maskPhone(to), ok: false, error: "No open 24-hour window" }); continue; }
        const msg = await deliver(s, user, to, spec, {});
        first ??= msg;
        audit(s, user, msg.status === "failed" ? "wa_send_failed" : "wa_send", maskPhone(to), `${spec.mode === "template" ? spec.template.name : "text"}${msg.error ? ` · ${msg.error.code ?? ""} ${msg.error.title}` : ""}`);
        results.push({ to: maskPhone(to), ok: msg.status !== "failed", error: msg.error ? `${msg.error.code ?? ""} ${msg.error.title}`.trim() : undefined });
        if (i < list.length - 1) await new Promise((r2) => setTimeout(r2, 250));
      }
      saveStore(s);
      const failed = results.filter((r) => !r.ok).length;
      return NextResponse.json({ results, message: first ? { ...first, to: maskPhone(first.to) } : undefined, ...view(s, user) }, { status: failed === results.length ? 502 : 200 });
    }
    let to: string, borrower: Borrower | undefined, redirectedFrom: string | undefined;
    {
      borrower = s.borrowers.find((x) => x.loanId.toUpperCase() === String(body.loanId).trim().toUpperCase());
      if (!borrower) return bad("No borrower with that loan ID.", 404);
      const blocked = allowed(s, borrower);
      if (blocked) { audit(s, user, "contact_blocked", borrower.loanId, blocked); saveStore(s); return bad(blocked, 409); }
      const r = recipientFor(s, borrower, 0);
      if ("error" in r) return bad(r.error, 409);
      ({ to, redirectedFrom } = r);
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
