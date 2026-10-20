import type { Borrower, Campaign, CampaignAudience, ChannelKind, Connector, ConnectorKind, StepEdge, StepKind, StepNode, Store, TierKey } from "./types";
import { DAY, istDay, istHour, istMonthStart } from "./time";

const monthName = (t: number) => new Date(t + 330 * 60_000).toLocaleString("en-IN", { month: "long", timeZone: "UTC" });
import { LEGAL_WINDOW } from "./contact";

export interface ConnectorField { key: string; label: string; secret?: boolean; placeholder?: string }
export interface ConnectorDef { kind: ConnectorKind; title: string; purpose: string; provider: string; providers: string[]; fields: ConnectorField[] }

/** Integrations a campaign can use. Titles stay generic; the provider is a setting on each card. */
export const CONNECTOR_DEFS: ConnectorDef[] = [
  { kind: "telephony", title: "Telephony", purpose: "Places AI voice calls and transfers to telecallers", provider: "Voiz (Predixion)", providers: ["Voiz (Predixion)", "Other SIP provider"],
    fields: [{ key: "account", label: "Account ID" }, { key: "apiKey", label: "API key", secret: true }, { key: "callerId", label: "Caller ID", placeholder: "+91 80 0000 0000" }] },
  { kind: "ivr", title: "IVR", purpose: "Recorded reminder calls with keypad options", provider: "Vobiz", providers: ["Vobiz", "Other IVR provider"],
    fields: [{ key: "account", label: "Account ID" }, { key: "apiKey", label: "API key", secret: true }, { key: "flowId", label: "Default IVR flow ID" }] },
  { kind: "whatsapp", title: "WhatsApp Business", purpose: "Approved templates and replies to opted-in borrowers, sent through Meta's WhatsApp Cloud API", provider: "Meta Cloud API", providers: ["Meta Cloud API"],
    // Keys live in env vars (WHATSAPP_*), never here. These fields are shown for reference only.
    fields: [{ key: "number", label: "WhatsApp number" }, { key: "phoneNumberId", label: "Phone number ID" }, { key: "wabaId", label: "WhatsApp account ID" }] },
  { kind: "sms", title: "SMS gateway", purpose: "DLT-registered reminder and payment-link texts", provider: "Vobiz", providers: ["Vobiz", "Other SMS gateway"],
    fields: [{ key: "senderId", label: "Sender ID (DLT header)" }, { key: "entityId", label: "DLT entity ID" }, { key: "apiKey", label: "API key", secret: true }] },
  { kind: "payments", title: "Payment links", purpose: "Creates payment links and reports payments back", provider: "Not set", providers: ["Not set", "Payment gateway"],
    fields: [{ key: "keyId", label: "Key ID" }, { key: "secret", label: "Key secret", secret: true }, { key: "webhookSecret", label: "Webhook secret", secret: true }] },
  { kind: "crm", title: "Loan system / CRM", purpose: "Syncs borrowers, dues and payment status", provider: "Not set", providers: ["Not set", "LOS / LMS", "CRM"],
    fields: [{ key: "baseUrl", label: "Base URL", placeholder: "https://…" }, { key: "token", label: "Access token", secret: true }, { key: "syncEvery", label: "Sync every (minutes)", placeholder: "60" }] },
  { kind: "webhook", title: "Outbound webhooks", purpose: "Sends promises, payments and escalations to your systems", provider: "Custom", providers: ["Custom"],
    fields: [{ key: "url", label: "Endpoint URL", placeholder: "https://…" }, { key: "signing", label: "Signing secret", secret: true }] },
];
export const connectorDef = (k: ConnectorKind) => CONNECTOR_DEFS.find((d) => d.kind === k)!;

export function defaultConnectors(): Connector[] {
  const live: ConnectorKind[] = ["telephony", "ivr", "whatsapp", "sms"];
  return CONNECTOR_DEFS.map((d) => ({
    kind: d.kind, provider: d.provider, status: live.includes(d.kind) ? "Connected" : "Not connected",
    config: live.includes(d.kind) ? Object.fromEntries(d.fields.map((f) => [f.key, f.secret ? "demo-key-0000" : f.placeholder ?? "configured"])) : {},
    lastResult: live.includes(d.kind) ? "Demo connection" : undefined,
  }));
}

/** Never send secrets to the browser: only the last four characters. */
export const maskConnector = (c: Connector): Connector => {
  const def = connectorDef(c.kind);
  return { ...c, config: Object.fromEntries(Object.entries(c.config).map(([k, v]) => [k, def.fields.find((f) => f.key === k)?.secret && v ? `••••${v.slice(-4)}` : v])) };
};

export interface StepDef { kind: StepKind; title: string; color: string; needs?: ConnectorKind; hint: string }
export const STEP_DEFS: StepDef[] = [
  { kind: "start", title: "Start", color: "#16181c", hint: "Borrowers enter here" },
  { kind: "whatsapp", title: "WhatsApp", color: "#0e6b50", needs: "whatsapp", hint: "Template or payment link, opted-in borrowers only" },
  { kind: "sms", title: "SMS", color: "#2456c2", needs: "sms", hint: "DLT template" },
  { kind: "voice", title: "AI voice call", color: "#8a4307", needs: "telephony", hint: "Voice agent in the borrower's language" },
  { kind: "ivr", title: "IVR call", color: "#c47a1c", needs: "ivr", hint: "Recorded reminder with keypad options" },
  { kind: "telecaller", title: "Telecaller", color: "#b42318", needs: "telephony", hint: "Hand to the human desk" },
  { kind: "wait", title: "Wait", color: "#5c6068", hint: "Pause before the next step" },
  { kind: "branch", title: "If / else", color: "#5c6068", hint: "Split on what the borrower did" },
  { kind: "end", title: "End", color: "#16181c", hint: "Leaves the campaign" },
];
export const stepDef = (k: StepKind) => STEP_DEFS.find((s) => s.kind === k)!;
export const TEMPLATES = ["EMI reminder", "Payment link", "PTP reminder", "Overdue notice"];
export const SLOT_LABEL = { any: "Any time in the window", morning: "08:00–12:00", afternoon: "12:00–17:00", evening: "17:00–19:00" } as const;
export const CONDITION_LABEL = { answered: "Answered the call", paid: "Paid", promised: "Promised to pay", replied: "Replied on WhatsApp", disputed: "Raised a dispute" } as const;

/** The four outreach channels a campaign can use, in the order they're shown. */
export const CHANNELS: ChannelKind[] = ["telecaller", "whatsapp", "voice", "ivr"];
export const CHANNEL_INFO: Record<ChannelKind, { title: string; hint: string }> = {
  telecaller: { title: "Telecallers", hint: "Human desk calls and hand-offs" },
  whatsapp: { title: "WhatsApp", hint: "Approved templates and payment links" },
  voice: { title: "AI voice", hint: "Voice agent in the borrower's language" },
  ivr: { title: "IVR", hint: "Recorded reminder with keypad options" },
};
/** Order a workflow built from the channels uses: least intrusive first, people last. */
const BUILD_ORDER: ChannelKind[] = ["whatsapp", "ivr", "voice", "telecaller"];
export const TIER_KEYS: TierKey[] = ["High", "Medium", "Low"];
/** The campaign's channels. Older drafts without a list fall back to whatever their tiers use. */
export const channelsInUse = (c: Pick<Campaign, "channels" | "tierChannels">) =>
  c.channels ? CHANNELS.filter((k) => c.channels!.includes(k)) : CHANNELS.filter((k) => TIER_KEYS.some((t) => c.tierChannels?.[t]?.includes(k)));
export const usesVoice = (c: Pick<Campaign, "channels" | "tierChannels" | "nodes">) =>
  channelsInUse(c).some((k) => k === "voice" || k === "ivr") || c.nodes.some((n) => n.kind === "voice" || n.kind === "ivr");

/** A simple linear workflow from the chosen channels: each one in turn with a day's wait between, then End. */
export function workflowFromChannels(channels: ChannelKind[]): { nodes: StepNode[]; edges: StepEdge[] } {
  const nodes: StepNode[] = [{ id: "n1", kind: "start", x: 40, y: 160, data: { label: "Start" } }];
  const defaults: Record<ChannelKind, Partial<StepNode["data"]>> = {
    whatsapp: { template: "Payment link", slot: "afternoon" },
    ivr: { agent: "auto", slot: "evening" }, voice: { agent: "auto", slot: "evening" }, telecaller: { seats: 2 },
  };
  const ordered = BUILD_ORDER.filter((k) => channels.includes(k));
  let x = 230;
  ordered.forEach((k, i) => {
    nodes.push({ id: `n${nodes.length + 1}`, kind: k, x, y: 150, data: { label: stepDef(k).title, ...defaults[k] } });
    x += 200;
    if (i < ordered.length - 1) { nodes.push({ id: `n${nodes.length + 1}`, kind: "wait", x, y: 160, data: { label: "Wait 1 day", waitHours: 24 } }); x += 200; }
  });
  nodes.push({ id: `n${nodes.length + 1}`, kind: "end", x, y: 160, data: { label: "Done" } });
  const edges = nodes.slice(1).map((n, i) => ({ id: `e${i + 1}`, source: nodes[i].id, target: n.id }));
  return { nodes, edges };
}

export const blankAudience = (): CampaignAudience => ({ source: "filters", products: [], segments: [], languages: [], portfolios: [], minDpd: 0, maxDpd: 365, loanIds: [] });

/** The starter flow follows what the data shows: WhatsApp link in the afternoon, voice in the evening, IVR as a fallback. */
export function starterWorkflow(): { nodes: StepNode[]; edges: StepEdge[] } {
  const nodes: StepNode[] = [
    { id: "n1", kind: "start", x: 40, y: 160, data: { label: "Start" } },
    { id: "n2", kind: "whatsapp", x: 230, y: 150, data: { label: "Payment link", template: "Payment link", slot: "afternoon" } },
    { id: "n3", kind: "wait", x: 430, y: 160, data: { label: "Wait 1 day", waitHours: 24 } },
    { id: "n4", kind: "branch", x: 620, y: 150, data: { label: "Paid?", condition: "paid" } },
    { id: "n5", kind: "end", x: 830, y: 40, data: { label: "Done" } },
    { id: "n6", kind: "voice", x: 830, y: 230, data: { label: "Evening call", agent: "auto", slot: "evening" } },
    { id: "n7", kind: "branch", x: 1040, y: 230, data: { label: "Disputed?", condition: "disputed" } },
    { id: "n8", kind: "telecaller", x: 1250, y: 130, data: { label: "Human desk", seats: 2 } },
    { id: "n9", kind: "ivr", x: 1250, y: 330, data: { label: "IVR reminder", agent: "auto", slot: "evening" } },
    { id: "n10", kind: "end", x: 1460, y: 230, data: { label: "Done" } },
  ];
  const edges: StepEdge[] = [
    { id: "e1", source: "n1", target: "n2" }, { id: "e2", source: "n2", target: "n3" }, { id: "e3", source: "n3", target: "n4" },
    { id: "e4", source: "n4", target: "n5", label: "yes" }, { id: "e5", source: "n4", target: "n6", label: "no" },
    { id: "e6", source: "n6", target: "n7" }, { id: "e7", source: "n7", target: "n8", label: "yes" }, { id: "e8", source: "n7", target: "n9", label: "no" },
    { id: "e9", source: "n8", target: "n10" }, { id: "e10", source: "n9", target: "n10" },
  ];
  return { nodes, edges };
}

export function audienceOf(s: Store, a: CampaignAudience): Borrower[] {
  if (a.source === "list") { const ids = new Set(a.loanIds); return s.borrowers.filter((b) => ids.has(b.loanId)); }
  const has = (list: string[], v: string) => !list.length || list.includes(v);
  return s.borrowers.filter((b) => b.disposition !== "Paid" && has(a.products, b.product) && has(a.segments, b.segment) && has(a.languages, b.language)
    && has(a.portfolios, b.portfolio) && b.dpd >= a.minDpd && b.dpd <= a.maxDpd);
}

export function audienceSummary(s: Store, a: CampaignAudience) {
  const all = audienceOf(s, a);
  const eligible = all.filter((b) => b.disposition !== "Dispute");
  return {
    total: all.length,
    eligible: eligible.length,
    outstanding: eligible.reduce((x, b) => x + b.outstanding, 0),
    excluded: { disputed: all.length - eligible.length, doNotCall: eligible.filter((b) => b.dnd).length, noWhatsApp: eligible.filter((b) => !b.waConsent).length },
    unmatched: a.source === "list" ? a.loanIds.length - all.length : 0,
  };
}

/** Errors block launch; warnings are shown but allowed. */
/** `tiers` is how many borrowers in the audience fall in each risk tier (computed by the caller). */
export function checkCampaign(s: Store, c: Campaign, tiers?: Record<TierKey, number>) {
  const errors: string[] = [], warnings: string[] = [];
  const starts = c.nodes.filter((n) => n.kind === "start");
  if (starts.length !== 1) errors.push("The workflow needs exactly one Start step.");
  if (!c.nodes.some((n) => n.kind === "end")) errors.push("Add an End step.");
  const out = new Map<string, StepEdge[]>();
  c.edges.forEach((e) => out.set(e.source, [...(out.get(e.source) ?? []), e]));
  const seen = new Set<string>(), queue = starts.map((n) => n.id);
  while (queue.length) { const id = queue.shift()!; if (seen.has(id)) continue; seen.add(id); (out.get(id) ?? []).forEach((e) => queue.push(e.target)); }
  const orphans = c.nodes.filter((n) => !seen.has(n.id));
  if (orphans.length) errors.push(`${orphans.length} step${orphans.length === 1 ? " isn't" : "s aren't"} connected to Start: ${orphans.map((n) => n.data.label).join(", ")}.`);
  for (const n of c.nodes) {
    const outs = out.get(n.id) ?? [];
    if (n.kind !== "end" && !outs.length) errors.push(`"${n.data.label}" has no next step.`);
    if (n.kind === "branch" && (!outs.some((e) => e.label === "yes") || !outs.some((e) => e.label === "no"))) errors.push(`"${n.data.label}" needs both a yes and a no path.`);
    if ((n.kind === "whatsapp" || n.kind === "sms") && !n.data.template) errors.push(`Choose a template for "${n.data.label}".`);
    if ((n.kind === "voice" || n.kind === "ivr") && !n.data.agent) errors.push(`Choose an agent for "${n.data.label}".`);
    const needs = stepDef(n.kind).needs;
    if (needs && s.connectors.find((x) => x.kind === needs)?.status !== "Connected") errors.push(`"${n.data.label}" needs the ${connectorDef(needs).title} integration connected.`);
  }
  if (usesVoice(c) && !s.prompts.some((p) => p.id === c.promptId && p.status === "Published"))
    errors.push("Choose a published prompt for the AI voice and IVR steps (Agent).");
  const inUse = channelsInUse(c);
  if (!inUse.length) errors.push("Choose the channels for this campaign (Channels).");
  for (const n of c.nodes) {
    const isChannel = !["start", "end", "wait", "branch"].includes(n.kind);
    if (isChannel && !inUse.includes(n.kind as ChannelKind))
      errors.push(`"${n.data.label}" uses ${stepDef(n.kind).title}, which isn't one of this campaign's channels. Add it in Channels or remove the step.`);
  }
  for (const t of TIER_KEYS) {
    const n = tiers?.[t] ?? 0;
    const mine = (c.tierChannels?.[t] ?? []).filter((k) => inUse.includes(k));
    if (inUse.length && n && !mine.length) warnings.push(`${n} ${t.toLowerCase()}-risk borrower${n === 1 ? " has" : "s have"} no channel and won't be contacted.`);
  }
  for (const k of inUse) if (!c.nodes.some((n) => n.kind === k)) warnings.push(`${CHANNEL_INFO[k].title} is one of the campaign's channels but isn't in the workflow, so it won't run.`);
  const aud = audienceSummary(s, c.audience);
  if (!aud.eligible) errors.push("The audience is empty.");
  if (aud.excluded.disputed) warnings.push(`${aud.excluded.disputed} disputed account${aud.excluded.disputed === 1 ? "" : "s"} will be left out.`);
  if (c.nodes.some((n) => n.kind === "voice") && aud.excluded.doNotCall) warnings.push(`${aud.excluded.doNotCall} borrower${aud.excluded.doNotCall === 1 ? "" : "s"} asked not to be called; voice and IVR steps skip them.`);
  if (c.nodes.some((n) => n.kind === "whatsapp") && aud.excluded.noWhatsApp) warnings.push(`${aud.excluded.noWhatsApp} borrower${aud.excluded.noWhatsApp === 1 ? " has" : "s have"} no WhatsApp opt-in; WhatsApp steps skip them.`);
  if (Date.parse(c.endAt) <= Date.parse(c.startAt)) errors.push("The end date must be after the start date.");
  warnings.push(`Every step only runs between ${LEGAL_WINDOW.start}:00 and ${s.compliance.windowEnd}:00 IST and respects the daily cap of ${s.compliance.maxPerDay} attempts.`);
  return { errors, warnings, audience: aud };
}

const COST = { voicePerMin: 2.5, ivrPerMin: 0.6, whatsapp: 0.8, sms: 0.2, telecallerPerCall: 15, platformPerAccount: 40 };

/** Everything the During and After stages show, computed from the campaign's own borrowers, calls and payments. */
export function campaignDetail(s: Store, c: Campaign, now = Date.now()) {
  const from = Date.parse(c.launchedAt ?? c.startAt);
  const to = c.status === "Completed" ? Math.min(now, Date.parse(c.endAt)) : now;
  const inWin = (ts: string) => { const t = Date.parse(ts); return t >= from && t <= to; };
  const ids = new Set(c.members);
  const members = s.borrowers.filter((b) => ids.has(b.id));
  const loans = new Set(members.map((b) => b.loanId));
  const calls = s.calls.filter((x) => loans.has(x.loanId) && inWin(x.ts));
  const touches = s.touches.filter((x) => loans.has(x.loanId) && inWin(x.ts));
  const paid = members.filter((b) => b.recoveredAt && b.recoveredAmount && inWin(b.recoveredAt));
  const collected = paid.reduce((n, b) => n + b.recoveredAmount, 0);
  const mins = (cs: typeof calls) => cs.reduce((n, x) => n + Math.ceil(x.durationSec / 60), 0);

  const voice = calls.filter((x) => x.channel === "AI Voice"), ivr = calls.filter((x) => x.channel === "IVR"), human = calls.filter((x) => x.channel === "Human Desk");
  const waBot = calls.filter((x) => x.channel === "WhatsApp"), waMsg = touches.filter((t) => t.channel === "WhatsApp"), sms = touches.filter((t) => t.channel === "SMS");
  const engaged = (ts: typeof touches) => ts.filter((t) => ["Read", "Replied", "Clicked"].includes(t.status)).length;
  const row = (channel: string, attempts: number, reached: number, promises: number, payments: number, cost: number) => ({ channel, attempts, reached, promises, payments, cost: Math.round(cost), reachRate: attempts ? (reached / attempts) * 100 : 0 });
  const ptp = (cs: typeof calls) => cs.filter((x) => x.classification === "PTP").length;
  const pays = (cs: typeof calls) => cs.filter((x) => x.classification === "Paid").length;
  const channels = [
    row("WhatsApp", waBot.length + waMsg.length, waBot.filter((x) => x.connected).length + engaged(waMsg), ptp(waBot), pays(waBot) + paid.filter((b) => b.paymentLink === "Paid via link").length, (waBot.length + waMsg.length) * COST.whatsapp),
    row("AI voice", voice.length, voice.filter((x) => x.connected).length, ptp(voice), pays(voice), mins(voice) * COST.voicePerMin),
    row("IVR", ivr.length, ivr.filter((x) => x.connected).length, ptp(ivr), pays(ivr), mins(ivr) * COST.ivrPerMin),
    row("SMS", sms.length, sms.filter((t) => t.status === "Clicked").length, 0, 0, sms.length * COST.sms),
    row("Telecaller", human.length, human.filter((x) => x.connected).length, ptp(human), pays(human), human.length * COST.telecallerPerCall),
  ].filter((r) => r.attempts > 0);
  const platformCost = members.length * COST.platformPerAccount;
  const cost = channels.reduce((n, r) => n + r.cost, 0) + platformCost;

  const contacted = new Set([...calls.map((x) => x.loanId), ...touches.map((t) => t.loanId)]);
  const reached = new Set([...calls.filter((x) => x.connected).map((x) => x.loanId), ...touches.filter((t) => ["Read", "Replied", "Clicked"].includes(t.status)).map((t) => t.loanId)]);
  const promised = new Set(calls.filter((x) => x.classification === "PTP").map((x) => x.loanId));
  const funnel = [
    { stage: "In campaign", value: members.length }, { stage: "Contacted", value: contacted.size }, { stage: "Reached", value: reached.size },
    { stage: "Promised", value: promised.size }, { stage: "Paid", value: paid.length },
  ];

  const hours = Array.from({ length: 11 }, (_, i) => 8 + i).map((h) => {
    const at = calls.filter((x) => x.channel !== "WhatsApp" && Math.floor(istHour(x.ts)) === h);
    return { hour: `${String(h).padStart(2, "0")}:00`, attempts: at.length, connectRate: at.length ? (at.filter((x) => x.connected).length / at.length) * 100 : 0 };
  });
  const days = new Map<string, { date: string; collected: number; attempts: number }>();
  for (let t = from; t <= to; t += DAY) days.set(istDay(t), { date: istDay(t), collected: 0, attempts: 0 });
  for (const b of paid) { const r = days.get(istDay(b.recoveredAt!)); if (r) r.collected += b.recoveredAmount; }
  for (const x of calls) { const r = days.get(istDay(x.ts)); if (r) r.attempts++; }
  let cum = 0;
  const daily = [...days.values()].map((r) => ({ ...r, cumulative: (cum += r.collected) }));

  const group = (key: (b: Borrower) => string) => [...new Set(members.map(key))].map((k) => {
    const bs = members.filter((b) => key(b) === k), l = new Set(bs.map((b) => b.loanId));
    return { name: k, accounts: bs.length, promises: calls.filter((x) => l.has(x.loanId) && x.classification === "PTP").length, collected: paid.filter((b) => key(b) === k).reduce((n, b) => n + b.recoveredAmount, 0) };
  }).sort((a, b) => b.collected - a.collected);

  const span = Math.max(1, Date.parse(c.endAt) - from);
  const elapsedShare = Math.min(1, Math.max(0, (to - from) / span));
  const bestChannel = [...channels].filter((r) => r.attempts >= 10).sort((a, b) => b.payments / b.attempts - a.payments / a.attempts)[0];
  const bestHour = [...hours].filter((h) => h.attempts >= 5).sort((a, b) => b.connectRate - a.connectRate)[0];
  const worstHour = [...hours].filter((h) => h.attempts >= 5).sort((a, b) => a.connectRate - b.connectRate)[0];
  const salary = paid.filter((b) => Number(istDay(b.recoveredAt!).slice(8)) <= 7).reduce((n, b) => n + b.recoveredAmount, 0);
  const learnings = [
    bestChannel ? `${bestChannel.channel} turned the most attempts into payments (${((bestChannel.payments / bestChannel.attempts) * 100).toFixed(1)}%).` : "",
    bestHour && worstHour ? `Calls connected best at ${bestHour.hour} (${bestHour.connectRate.toFixed(0)}%) and worst at ${worstHour.hour} (${worstHour.connectRate.toFixed(0)}%).` : "",
    collected ? `${((salary / collected) * 100).toFixed(0)}% of the money came in during salary week (days 1–7).` : "",
    cost ? `Every ₹1 spent on outreach brought back ₹${(collected / cost).toFixed(0)}.` : "",
  ].filter(Boolean);

  const escalations = members.filter((b) => b.disposition === "Escalated").map((b) => ({ id: b.id, name: b.name, reason: b.escalationReason ?? "", status: s.handoffs[b.id]?.status ?? "Waiting" }));
  const events = s.events.filter((e) => e.borrowerId && ids.has(e.borrowerId)).slice(-12).reverse();
  return {
    collected, target: c.target, attainment: c.target ? (collected / c.target) * 100 : 0, expectedByNow: c.target * elapsedShare, elapsedShare,
    cost, platformCost, roi: cost ? collected / cost : 0, funnel, channels, hours, daily, byProduct: group((b) => b.product), byLanguage: group((b) => b.language),
    escalations, events, learnings, stats: { reached: reached.size, attempts: calls.length + touches.length, promises: promised.size, paid: paid.length, collected },
  };
}

export function seedCampaigns(s: Store, now: number): Campaign[] {
  const wf = starterWorkflow();
  const base = (id: string, name: string, goal: string, status: Campaign["status"], audience: Partial<CampaignAudience>, startOffset: number, days: number, promptId: string): Campaign => ({
    id, name, goal, company: "All companies", target: 0, promptId, status, audience: { ...blankAudience(), ...audience }, nodes: wf.nodes, edges: wf.edges,
    startAt: new Date(now + startOffset * DAY).toISOString(), endAt: new Date(now + (startOffset + days) * DAY).toISOString(),
    salaryWeekBoost: true, dailyCap: 3, members: [], stats: { reached: 0, attempts: 0, promises: 0, paid: 0, collected: 0 },
    createdBy: "superadmin", updatedAt: new Date(now).toISOString(),
  });
  // Runs line up with the salary cycle: this month's push started on the 1st, last month's ran from the 1st to the 12th.
  const thisMonth = istMonthStart(now), lastMonth = istMonthStart(thisMonth - 1);
  const daysFrom = (t: number) => (t - now) / DAY;
  const list = [
    base("C1", `${monthName(thisMonth)} salary-week push · BNPL`, "Collect before the money is spent: links in the afternoon, calls after 5 pm", "Running", { products: ["BNPL"] }, daysFrom(thisMonth), 25, "P2"),
    base("C2", "Credit card due-date reminders", "Remind before the mid-month statement due date", "Scheduled", { products: ["Credit Card"] }, 4, 7, "P3"),
    base("C3", "31+ DPD recovery · Personal Loan", "Get promises from borrowers 31 days or more overdue", "Draft", { products: ["Personal Loan"], minDpd: 31 }, 1, 14, "P1"),
    base("C4", `${monthName(lastMonth)} salary-week push · Personal Loan`, "Collect in the first twelve days after salary credit", "Completed", { products: ["Personal Loan"] }, daysFrom(lastMonth), 12, "P1"),
  ];
  for (const c of list) c.target = Math.round((audienceSummary(s, c.audience).outstanding * 0.04) / 10000) * 10000;
  for (const c of list.filter((x) => x.status === "Running" || x.status === "Completed")) {
    // Past campaigns keep everyone who matched at launch, including those who have since paid.
    const a = c.audience, has = (l: string[], v: string) => !l.length || l.includes(v);
    c.members = s.borrowers.filter((b) => b.disposition !== "Dispute" && has(a.products, b.product) && has(a.segments, b.segment)).map((b) => b.id);
    c.launchedAt = c.startAt;
    const det = campaignDetail(s, c, now);
    c.stats = det.stats;
    // A completed run lands just over target; a running one is a little behind pace, which is the realistic mid-month picture.
    c.target = Math.max(10000, Math.round((c.status === "Completed" ? det.collected * 0.94 : (det.collected / Math.max(0.2, det.elapsedShare)) * 1.12) / 10000) * 10000);
  }
  return list;
}
