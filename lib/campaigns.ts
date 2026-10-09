import type { Borrower, Campaign, CampaignAudience, Connector, ConnectorKind, StepEdge, StepKind, StepNode, Store } from "./types";
import { DAY } from "./time";
import { LEGAL_WINDOW } from "./contact";

export interface ConnectorField { key: string; label: string; secret?: boolean; placeholder?: string }
export interface ConnectorDef { kind: ConnectorKind; title: string; purpose: string; provider: string; providers: string[]; fields: ConnectorField[] }

/** Integrations a campaign can use. Titles stay generic; the provider is a setting on each card. */
export const CONNECTOR_DEFS: ConnectorDef[] = [
  { kind: "telephony", title: "Telephony", purpose: "Places AI voice calls and transfers to telecallers", provider: "Voiz (Predixion)", providers: ["Voiz (Predixion)", "Other SIP provider"],
    fields: [{ key: "account", label: "Account ID" }, { key: "apiKey", label: "API key", secret: true }, { key: "callerId", label: "Caller ID", placeholder: "+91 80 0000 0000" }] },
  { kind: "ivr", title: "IVR", purpose: "Recorded reminder calls with keypad options", provider: "Vobiz", providers: ["Vobiz", "Other IVR provider"],
    fields: [{ key: "account", label: "Account ID" }, { key: "apiKey", label: "API key", secret: true }, { key: "flowId", label: "Default IVR flow ID" }] },
  { kind: "whatsapp", title: "WhatsApp Business", purpose: "Templates, bot conversations and payment links to opted-in borrowers", provider: "Interakt", providers: ["Interakt", "Other WhatsApp BSP"],
    fields: [{ key: "number", label: "WhatsApp number", placeholder: "+91 …" }, { key: "apiKey", label: "API key", secret: true }, { key: "webhook", label: "Callback URL" }] },
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
export function checkCampaign(s: Store, c: Campaign) {
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
  const aud = audienceSummary(s, c.audience);
  if (!aud.eligible) errors.push("The audience is empty.");
  if (aud.excluded.disputed) warnings.push(`${aud.excluded.disputed} disputed account${aud.excluded.disputed === 1 ? "" : "s"} will be left out.`);
  if (c.nodes.some((n) => n.kind === "voice") && aud.excluded.doNotCall) warnings.push(`${aud.excluded.doNotCall} borrower${aud.excluded.doNotCall === 1 ? "" : "s"} asked not to be called; voice and IVR steps skip them.`);
  if (c.nodes.some((n) => n.kind === "whatsapp") && aud.excluded.noWhatsApp) warnings.push(`${aud.excluded.noWhatsApp} borrower${aud.excluded.noWhatsApp === 1 ? " has" : "s have"} no WhatsApp opt-in; WhatsApp steps skip them.`);
  if (Date.parse(c.endAt) <= Date.parse(c.startAt)) errors.push("The end date must be after the start date.");
  warnings.push(`Every step only runs between ${LEGAL_WINDOW.start}:00 and ${s.compliance.windowEnd}:00 IST and respects the daily cap of ${s.compliance.maxPerDay} attempts.`);
  return { errors, warnings, audience: aud };
}

export function seedCampaigns(s: Store, now: number): Campaign[] {
  const wf = starterWorkflow();
  const base = (id: string, name: string, goal: string, status: Campaign["status"], audience: Partial<CampaignAudience>, startOffset: number, days: number): Campaign => ({
    id, name, goal, status, audience: { ...blankAudience(), ...audience }, nodes: wf.nodes, edges: wf.edges,
    startAt: new Date(now + startOffset * DAY).toISOString(), endAt: new Date(now + (startOffset + days) * DAY).toISOString(),
    salaryWeekBoost: true, dailyCap: 3, members: [], stats: { reached: 0, attempts: 0, promises: 0, paid: 0, collected: 0 },
    createdBy: "admin", updatedAt: new Date(now).toISOString(),
  });
  const list = [
    base("C1", "Salary-week push · BNPL", "Collect before the money is spent: links in the afternoon, calls after 5 pm", "Running", { products: ["BNPL"], segments: ["Pre Due", "Post Due (0–30)"] }, -3, 10),
    base("C2", "Credit card due-date reminders", "Remind before the mid-month statement due date", "Scheduled", { products: ["Credit Card"] }, 4, 7),
    base("C3", "31+ DPD recovery · Personal Loan", "Get promises from borrowers 31 days or more overdue", "Draft", { products: ["Personal Loan"], minDpd: 31 }, 1, 14),
  ];
  const running = list[0];
  running.members = audienceOf(s, running.audience).filter((b) => b.disposition !== "Dispute").map((b) => b.id);
  running.launchedAt = running.startAt;
  running.stats = { reached: Math.round(running.members.length * 0.62), attempts: running.members.length * 2, promises: Math.round(running.members.length * 0.21), paid: Math.round(running.members.length * 0.14), collected: Math.round(running.members.length * 0.14 * 2800) };
  return list;
}
