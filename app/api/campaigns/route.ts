import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import { can } from "@/lib/auth";
import { ALLOCATION_FIELDS, DEMO_HEADERS, demoRow, matchColumns, parseSegmentKey } from "@/lib/allocation";
import { AGENTS, bestAgents } from "@/lib/agentLibrary";
import { CHANNELS, CONDITION_LABEL, SLOT_LABEL, STEP_DEFS, TEMPLATES, TIER_KEYS, audienceOf, audienceSummary, blankAudience, campaignDetail, checkCampaign, maskConnector, starterWorkflow } from "@/lib/campaigns";
import { campaignCompliance, campaignConversations, campaignEscalations, campaignGrievances } from "@/lib/campaignTabs";
import { campaignPlan, defaultChannelConfig, planChannels, workflowFromPlan } from "@/lib/campaignPlan";
import { riskScore, tierOf, type RiskTier } from "@/lib/portfolio";
import { audit, saveStore } from "@/lib/store";
import { DAY } from "@/lib/time";
import type { Campaign, CampaignAudience, ChannelConfig, ChannelKind, Slot, StepEdge, StepKind, StepNode, Store, TierKey } from "@/lib/types";

/** How many contactable (undisputed) borrowers in an audience fall in each risk tier. */
function tierCounts(s: Store, a: CampaignAudience) {
  const tiers = { High: 0, Medium: 0, Low: 0 } as Record<RiskTier, number>;
  for (const b of audienceOf(s, a)) if (b.disposition !== "Dispute") tiers[tierOf(riskScore(b))]++;
  return tiers;
}

const cleanChannels = (v: unknown): ChannelKind[] => (Array.isArray(v) ? CHANNELS.filter((k) => v.includes(k)) : []);

/** Per known tier, only channels the campaign itself uses, no duplicates. */
function cleanTierChannels(v: unknown, allowed: ChannelKind[]): Campaign["tierChannels"] {
  const out: Partial<Record<TierKey, ChannelKind[]>> = {};
  if (!v || typeof v !== "object") return out;
  for (const t of TIER_KEYS) {
    const list = (v as Record<string, unknown>)[t];
    if (Array.isArray(list)) out[t] = allowed.filter((k) => list.includes(k));
  }
  return out;
}

const KINDS = STEP_DEFS.map((s) => s.kind);
const EDITABLE: Campaign["status"][] = ["Draft", "Scheduled", "Paused"];
const SLOTS: Slot[] = ["morning", "afternoon", "evening"];
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v: unknown, max = 50) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, max).map((x) => x.slice(0, 60)) : []);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
const slots = (v: unknown, d: Slot[]) => { const l = SLOTS.filter((x) => Array.isArray(v) && v.includes(x)); return l.length ? l : d; };

function cleanAudience(a: Record<string, unknown> | undefined): CampaignAudience {
  const b = blankAudience();
  if (!a) return b;
  return {
    source: a.source === "list" ? "list" : "filters",
    products: strs(a.products), segments: strs(a.segments), languages: strs(a.languages), portfolios: strs(a.portfolios),
    minDpd: num(a.minDpd, 0, 999, 0), maxDpd: num(a.maxDpd, 0, 999, 365),
    loanIds: strs(a.loanIds, 20000).map((x) => x.trim()).filter(Boolean),
  };
}
function cleanFlow(nodes: unknown, edges: unknown): { nodes: StepNode[]; edges: StepEdge[] } | string {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return "Workflow is missing";
  if (nodes.length > 60 || edges.length > 120) return "Workflow is too large (60 steps max)";
  const ns: StepNode[] = [];
  for (const n of nodes as Record<string, unknown>[]) {
    const kind = n.kind as StepKind, d = (n.data ?? {}) as Record<string, unknown>;
    if (!KINDS.includes(kind) || typeof n.id !== "string") return "Unknown step in workflow";
    ns.push({
      id: n.id.slice(0, 40), kind, x: num(n.x, -5000, 5000, 0), y: num(n.y, -5000, 5000, 0),
      data: {
        label: str(d.label, 60) || STEP_DEFS.find((s) => s.kind === kind)!.title,
        template: TEMPLATES.includes(d.template as string) ? (d.template as string) : undefined,
        agent: str(d.agent, 60) || undefined,
        seats: d.seats === undefined ? undefined : num(d.seats, 1, 25, 1),
        waitHours: d.waitHours === undefined ? undefined : num(d.waitHours, 1, 24 * 14, 24),
        slot: (Object.keys(SLOT_LABEL) as string[]).includes(d.slot as string) ? (d.slot as StepNode["data"]["slot"]) : undefined,
        condition: (Object.keys(CONDITION_LABEL) as string[]).includes(d.condition as string) ? (d.condition as StepNode["data"]["condition"]) : undefined,
      },
    });
  }
  const ids = new Set(ns.map((n) => n.id));
  const es: StepEdge[] = (edges as Record<string, unknown>[])
    .filter((e) => typeof e.source === "string" && typeof e.target === "string" && ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
    .map((e, i) => ({ id: typeof e.id === "string" ? e.id.slice(0, 60) : `e${i}`, source: e.source as string, target: e.target as string, label: e.label === "yes" || e.label === "no" ? e.label : undefined }));
  return { nodes: ns, edges: es };
}

function cleanSegments(v: unknown): Campaign["segments"] {
  if (!v || typeof v !== "object") return undefined;
  const out: Record<string, ChannelKind[]> = {};
  for (const [k, list] of Object.entries(v as Record<string, unknown>).slice(0, 30)) if (/^[\w–+]+\|(High|Medium|Low)$/.test(k)) out[k] = cleanChannels(list);
  return out;
}
function cleanConfig(v: unknown, s: Store): ChannelConfig {
  const c = (v ?? {}) as Record<string, Record<string, unknown> | undefined>;
  const out: ChannelConfig = {};
  const langs = (x: unknown) => strs(x, 12).filter((l) => s.languages.includes(l) || l.length < 20);
  if (c.voice) out.voice = { slots: slots(c.voice.slots, ["evening"]), concurrency: num(c.voice.concurrency, 1, 1000, 100), languages: langs(c.voice.languages), agents: strs(c.voice.agents, 40).filter((code) => AGENTS.some((a) => a.id === code) || s.agents.some((a) => a.code === code)) };
  if (c.ivr) out.ivr = { voice: str(c.ivr.voice, 60) || "Female · borrower's language", slots: slots(c.ivr.slots, ["morning"]) };
  if (c.whatsapp) out.whatsapp = { template: TEMPLATES.includes(c.whatsapp.template as string) ? (c.whatsapp.template as string) : "Payment link", slots: slots(c.whatsapp.slots, ["afternoon"]), reminderHours: num(c.whatsapp.reminderHours, 1, 168, 24) };
  if (c.telecaller) out.telecaller = { seats: num(c.telecaller.seats, 1, 50, 2), languages: langs(c.telecaller.languages), priorityFirst: c.telecaller.priorityFirst !== false };
  return out;
}

const voiceAgents = (s: Store) => s.agents.filter((x) => x.channel === "AI Voice" || x.channel === "IVR");
/** Agent library picks: for each DPD bucket the voice segments cover, the best agents for that stage, product and language. */
function agentCodesFor(s: Store, c: Campaign, languages: string[]) {
  const product = c.audience.products[0] ?? audienceOf(s, c.audience)[0]?.product;
  const buckets = [...new Set(Object.entries(c.segments ?? {}).filter(([, l]) => l.includes("voice")).map(([k]) => parseSegmentKey(k).bucket))];
  const ids = buckets.flatMap((bucket) => {
    const exact = bestAgents({ product, bucket, languages, limit: 2 });
    return exact.length ? exact : bestAgents({ bucket, languages, limit: 2 });
  }).map((a) => a.id);
  return [...new Set(ids)].slice(0, 8);
}

/** Builds the segments, channel settings and workflow from the data, for a demo or freshly ingested campaign. */
function fillPlan(s: Store, c: Campaign) {
  const plan = campaignPlan(s, c);
  c.segments = Object.fromEntries(plan.segments.map((x) => [x.key, x.suggested]));
  const channels = planChannels(c);
  c.channels = channels;
  c.channelConfig = defaultChannelConfig(channels, plan, agentCodesFor(s, c, plan.languages.map((l) => l.name)));
  const flow = workflowFromPlan(channels, c.channelConfig);
  c.nodes = flow.nodes; c.edges = flow.edges; c.flowEdited = false;
  // Voice and IVR need a prompt: start from the best published one for the product, changeable in Channels.
  if (!c.promptId && (channels.includes("voice") || channels.includes("ivr"))) {
    const product = audienceOf(s, c.audience)[0]?.product;
    c.promptId = (s.prompts.find((p) => p.status === "Published" && p.product === product) ?? s.prompts.find((p) => p.status === "Published"))?.id;
  }
}

function demoIngest(s: Store, c: Campaign, by: string) {
  const people = audienceOf(s, c.audience);
  const sample = people.slice(0, 50).map(demoRow);
  c.ingest = { source: "demo", fileName: `${c.company === "All companies" ? "all-companies" : c.company.replace(/\W+/g, "-").toLowerCase()}-allocation.csv`, rows: people.length, matched: people.length,
    columns: matchColumns(DEMO_HEADERS, sample), confirmed: false, at: new Date().toISOString(), by };
}

/** Older campaigns (and the seeded ones) get the same data, segments and settings a new one is built with. */
function upgrade(s: Store, c: Campaign) {
  if (c.segments && c.ingest) return false;
  if (!c.ingest) { demoIngest(s, c, c.createdBy); c.ingest!.confirmed = true; }
  if (!c.segments) {
    const keepFlow = c.status !== "Draft";
    const { nodes, edges } = c;
    fillPlan(s, c);
    if (keepFlow) { c.nodes = nodes; c.edges = edges; c.flowEdited = true; }
  }
  return true;
}

const view = (s: Store, c: Campaign) => ({ ...c, members: undefined, memberCount: c.members.length, audienceSize: audienceSummary(s, c.audience).eligible });

export async function GET(req: Request) {
  const a = await requireUser(undefined, "campaigns");
  if ("res" in a) return a.res;
  const { store } = a;
  const url = new URL(req.url);

  // The demo allocation file for a company, so the upload path can be tried with a realistic file.
  const alloc = url.searchParams.get("allocation");
  if (alloc !== null) {
    const people = store.borrowers.filter((b) => b.disposition !== "Paid" && (alloc === "All companies" || b.portfolio === alloc));
    const cell = (v: string) => `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
    const csv = [DEMO_HEADERS, ...people.map(demoRow)].map((r) => r.map(cell).join(",")).join("\n");
    return new NextResponse("﻿" + csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${alloc.replace(/\W+/g, "-").toLowerCase()}-allocation.csv"` } });
  }

  const id = url.searchParams.get("id");
  if (id) {
    const c = store.campaigns.find((x) => x.id === id);
    if (!c) return bad("Campaign not found", 404);
    if (url.searchParams.get("plan")) return NextResponse.json({ plan: campaignPlan(store, c) });
    const tab = url.searchParams.get("tab");
    if (tab === "conversations") return NextResponse.json(campaignConversations(store, c));
    if (tab === "compliance") return NextResponse.json(campaignCompliance(store, c));
    if (tab === "grievances") return NextResponse.json({ grievances: campaignGrievances(store, c) });
    if (tab === "escalations") return NextResponse.json({ escalations: campaignEscalations(store, c) });
    const tiers = tierCounts(store, c.audience);
    return NextResponse.json({ detail: campaignDetail(store, c), plan: { tiers, accounts: tiers.High + tiers.Medium + tiers.Low } });
  }
  if (store.campaigns.map((c) => upgrade(store, c)).some(Boolean)) saveStore(store);
  return NextResponse.json({
    prompts: store.prompts.filter((p) => p.status === "Published").map((p) => ({ id: p.id, client: p.client, product: p.product, tone: p.tone, version: p.current })),
    companies: store.portfolios,
    campaigns: store.campaigns.map((c) => view(store, c)),
    connectors: store.connectors.map(maskConnector),
    agents: voiceAgents(store).map((x) => ({ code: x.code, name: x.name, channel: x.channel, language: x.language, product: x.product, resolved: x.resolved, max: x.max })),
    options: { products: store.products, portfolios: store.portfolios, languages: store.languages },
    fields: ALLOCATION_FIELDS.map((f) => ({ key: f.key, label: f.label, required: !!f.required })),
    templates: TEMPLATES,
  });
}

// { create: { name, from: "demo" | "starter" | "blank", company? } } | { import } | { preview: audience } | { planPreview: { id, risk } } | { id, action }
export async function POST(req: Request) {
  const a = await requireUser(undefined, "campaigns");
  if ("res" in a) return a.res;
  const { store, user } = a;
  const body = await req.json().catch(() => ({}));
  if (body.preview) { const aud = cleanAudience(body.preview); return NextResponse.json({ ...audienceSummary(store, aud), tiers: tierCounts(store, aud) }); }
  if (body.planPreview) {
    const c = store.campaigns.find((x) => x.id === body.planPreview.id);
    if (!c) return bad("Campaign not found", 404);
    const r = body.planPreview.risk ?? {};
    return NextResponse.json({ plan: campaignPlan(store, c, { bureauBelow: num(r.bureauBelow, 300, 900, 650), dpdAbove: num(r.dpdAbove, 0, 365, 60), lateAtLeast: num(r.lateAtLeast, 1, 12, 3), loansAtLeast: num(r.loansAtLeast, 1, 10, 3) }) });
  }

  const c0 = body.id ? store.campaigns.find((x) => x.id === body.id) : undefined;
  // Approval is the Manager's (or a Super Admin's) call; everything else needs campaign rights.
  if (["approve", "return"].includes(body.action)) {
    if (!can(user, "approveCampaigns")) return bad("Only a Manager can approve a campaign.", 403);
  } else if (!can(user, "manageCampaigns")) return bad("Only Super Admins and supervisors can change campaigns", 403);

  if (body.create || body.import) {
    const src = body.import ?? {};
    const flow = body.import ? cleanFlow(src.nodes, src.edges) : body.create.from === "blank"
      ? { nodes: [{ id: "n1", kind: "start", x: 40, y: 160, data: { label: "Start" } }, { id: "n2", kind: "end", x: 360, y: 160, data: { label: "Done" } }] as StepNode[], edges: [] as StepEdge[] }
      : starterWorkflow();
    if (typeof flow === "string") return bad(flow);
    const now = Date.now();
    const company = store.portfolios.includes(body.create?.company ?? src.company) ? (body.create?.company ?? src.company) : body.create?.from === "demo" ? store.portfolios[0] : "All companies";
    const c: Campaign = {
      id: `C${++store.campaignSeq}`, name: str(body.import ? src.name : body.create.name, 80) || "Untitled campaign", goal: str(src.goal, 200),
      company, target: num(src.target, 0, 1e10, 0),
      promptId: store.prompts.find((p) => p.id === src.promptId && p.status === "Published")?.id,
      channels: cleanChannels(src.channels),
      tierChannels: cleanTierChannels(src.tierChannels, cleanChannels(src.channels)),
      status: "Draft", audience: cleanAudience(src.audience), nodes: flow.nodes, edges: flow.edges,
      startAt: new Date(now + DAY).toISOString(), endAt: new Date(now + 8 * DAY).toISOString(),
      salaryWeekBoost: src.salaryWeekBoost !== false, dailyCap: num(src.dailyCap, 1, store.compliance.maxPerDay, store.compliance.maxPerDay),
      members: [], stats: { reached: 0, attempts: 0, promises: 0, paid: 0, collected: 0 }, createdBy: user.username, updatedAt: new Date(now).toISOString(),
    };
    if (body.create?.from === "demo") {
      // Every step filled in from demo data for the first company, ready to review.
      c.audience = { ...blankAudience(), portfolios: [company] };
      demoIngest(store, c, user.username);
      c.ingest!.confirmed = true;
      fillPlan(store, c);
      const product = audienceOf(store, c.audience)[0]?.product;
      c.promptId = (store.prompts.find((p) => p.status === "Published" && p.product === product) ?? store.prompts.find((p) => p.status === "Published"))?.id;
      c.name = `${company} recovery · ${new Date(now + 330 * 60_000).toISOString().slice(0, 10)}`;
      c.goal = "Messages first for those likely to pay, calls in the evening, people for the late and risky.";
      c.startAt = new Date(now).toISOString(); c.endAt = new Date(now + 7 * DAY).toISOString();
      c.target = Math.round((campaignPlan(store, c).outstanding * 0.06) / 10000) * 10000;
    }
    store.campaigns.unshift(c);
    audit(store, user, body.import ? "campaign_import" : body.create?.from === "demo" ? "campaign_create_demo" : "campaign_create", c.id, c.name);
    saveStore(store);
    return NextResponse.json({ campaign: view(store, c) });
  }

  const c = c0;
  if (!c) return bad("Campaign not found", 404);
  const now = Date.now();
  const launch = () => {
    const startNow = Date.parse(c.startAt) <= now;
    c.status = startNow ? "Running" : "Scheduled";
    if (startNow) { c.members = audienceOf(store, c.audience).filter((b) => b.disposition !== "Dispute").map((b) => b.id); c.launchedAt = new Date(now).toISOString(); }
  };
  switch (body.action) {
    case "check": return NextResponse.json(checkCampaign(store, c, tierCounts(store, c.audience)));
    case "ingest": {
      if (!EDITABLE.includes(c.status)) return bad("Pause the campaign before changing its data");
      const ing = body.ingest ?? {};
      if (ing.source === "demo") {
        c.audience = { ...blankAudience(), portfolios: c.company === "All companies" ? [] : [c.company] };
        demoIngest(store, c, user.username);
      } else {
        const headers = strs(ing.headers, 80);
        const sample: string[][] = Array.isArray(ing.sample) ? ing.sample.slice(0, 50).map((r: unknown) => strs(r, 80)) : [];
        const loanIds = strs(ing.loanIds, 20000).map((x) => x.toUpperCase());
        if (!headers.length) return bad("That file has no header row.");
        c.audience = { ...blankAudience(), source: "list", loanIds };
        const matched = audienceOf(store, c.audience).length;
        c.ingest = { source: "file", fileName: str(ing.fileName, 120), rows: num(ing.rows, 0, 1e6, loanIds.length), matched, columns: matchColumns(headers, sample), confirmed: false, at: new Date(now).toISOString(), by: user.username };
      }
      c.segments = undefined; c.channelConfig = undefined; c.flowEdited = false;
      break;
    }
    case "launch": {
      if (!EDITABLE.includes(c.status)) return bad(`A ${c.status.toLowerCase()} campaign can't be launched`);
      if (!can(user, "approveCampaigns")) return bad("Send it to your Manager for approval instead.", 403);
      const result = checkCampaign(store, c, tierCounts(store, c.audience));
      if (result.errors.length) return NextResponse.json({ error: "Fix these before launching", ...result }, { status: 422 });
      launch();
      break;
    }
    case "submit": {
      if (!["Draft", "Paused", "Scheduled"].includes(c.status)) return bad("Only a draft can be sent for approval");
      const result = checkCampaign(store, c, tierCounts(store, c.audience));
      if (result.errors.length) return NextResponse.json({ error: "Fix these before sending it for approval", ...result }, { status: 422 });
      c.status = "Awaiting approval";
      c.approval = { submittedBy: user.name, submittedAt: new Date(now).toISOString(), note: str(body.note, 300) || undefined };
      break;
    }
    case "approve": {
      if (c.status !== "Awaiting approval") return bad("This campaign isn't waiting for approval");
      const result = checkCampaign(store, c, tierCounts(store, c.audience));
      if (result.errors.length) return NextResponse.json({ error: "It no longer passes the checks", ...result }, { status: 422 });
      c.approval = { ...c.approval, decidedBy: user.name, decidedAt: new Date(now).toISOString(), decision: "approved", note: str(body.note, 300) || c.approval?.note };
      launch();
      break;
    }
    case "return": {
      if (c.status !== "Awaiting approval") return bad("This campaign isn't waiting for approval");
      if (!str(body.note, 300)) return bad("Say what needs to change.");
      c.status = "Draft";
      c.approval = { ...c.approval, decidedBy: user.name, decidedAt: new Date(now).toISOString(), decision: "returned", note: str(body.note, 300) };
      break;
    }
    case "withdraw": if (c.status !== "Awaiting approval") return bad("Nothing to withdraw"); c.status = "Draft"; break;
    case "pause": if (c.status !== "Running") return bad("Only a running campaign can be paused"); c.status = "Paused"; break;
    case "resume": if (c.status !== "Paused") return bad("Only a paused campaign can be resumed"); c.status = "Running"; break;
    case "stop": if (!["Running", "Paused", "Scheduled"].includes(c.status)) return bad("Nothing to stop"); c.status = "Completed"; break;
    case "duplicate": {
      const copy: Campaign = { ...structuredClone(c), id: `C${++store.campaignSeq}`, name: `${c.name} (copy)`.slice(0, 80), status: "Draft", members: [], launchedAt: undefined, approval: undefined,
        stats: { reached: 0, attempts: 0, promises: 0, paid: 0, collected: 0 }, createdBy: user.username, updatedAt: new Date(now).toISOString() };
      store.campaigns.unshift(copy);
      audit(store, user, "campaign_duplicate", copy.id, c.name);
      saveStore(store);
      return NextResponse.json({ campaign: view(store, copy) });
    }
    case "delete":
      if (c.status !== "Draft") return bad("Only drafts can be deleted. Stop the campaign instead.");
      store.campaigns = store.campaigns.filter((x) => x.id !== c.id);
      audit(store, user, "campaign_delete", c.id, c.name);
      saveStore(store);
      return NextResponse.json({ ok: true });
    default: return bad("Unknown action");
  }
  c.updatedAt = new Date(now).toISOString();
  audit(store, user, `campaign_${body.action}`, c.id, c.name);
  saveStore(store);
  return NextResponse.json({ campaign: view(store, c) });
}

// Edit a draft, scheduled or paused campaign. Any of: name, goal, company, target, promptId, audience, channels,
// tierChannels, nodes/edges, startAt, endAt, salaryWeekBoost, dailyCap, risk, segments, channelConfig, columns, confirm, loanIds, rebuildFlow.
export async function PATCH(req: Request) {
  const a = await requireUser("manageCampaigns");
  if ("res" in a) return a.res;
  const { store, user } = a;
  const body = await req.json().catch(() => ({}));
  const c = store.campaigns.find((x) => x.id === body.id);
  if (!c) return bad("Campaign not found", 404);
  if (!EDITABLE.includes(c.status)) return bad(c.status === "Awaiting approval" ? "Withdraw it from approval before editing" : "Pause the campaign before editing it");
  if (body.name !== undefined) c.name = str(body.name, 80) || c.name;
  if (body.goal !== undefined) c.goal = str(body.goal, 200);
  if (body.company !== undefined && body.company !== c.company) {
    c.company = store.portfolios.includes(body.company) ? body.company : "All companies";
    // A new company means new data: start the plan again from Data.
    c.ingest = undefined; c.segments = undefined; c.channelConfig = undefined; c.audience = blankAudience(); c.flowEdited = false;
  }
  if (body.target !== undefined) c.target = num(body.target, 0, 1e10, c.target);
  if (body.promptId !== undefined) {
    if (body.promptId && !store.prompts.some((p) => p.id === body.promptId && p.status === "Published")) return bad("Choose a published prompt");
    c.promptId = body.promptId || undefined;
  }
  if (body.audience) c.audience = cleanAudience(body.audience);
  if (body.channels !== undefined) c.channels = cleanChannels(body.channels);
  if (body.tierChannels !== undefined || body.channels !== undefined) c.tierChannels = cleanTierChannels(body.tierChannels ?? c.tierChannels, c.channels ?? []);
  if (c.ingest && Array.isArray(body.columns)) {
    const keys = new Set(ALLOCATION_FIELDS.map((f) => f.key));
    c.ingest.columns = c.ingest.columns.map((col) => {
      const m = (body.columns as { column: string; field: string | null }[]).find((x) => x.column === col.column);
      if (!m) return col;
      const field = m.field && keys.has(m.field) ? m.field : null;
      return field === col.field ? col : { ...col, field, how: "user" as const };
    });
    if (Array.isArray(body.loanIds) && c.ingest.source === "file") {
      c.audience = { ...blankAudience(), source: "list", loanIds: strs(body.loanIds, 20000).map((x) => x.toUpperCase()) };
      c.ingest.matched = audienceOf(store, c.audience).length;
    }
  }
  if (c.ingest && typeof body.confirm === "boolean") {
    c.ingest.confirmed = body.confirm;
    if (body.confirm && !c.segments) fillPlan(store, c);
  }
  if (body.risk) c.risk = { bureauBelow: num(body.risk.bureauBelow, 300, 900, 650), dpdAbove: num(body.risk.dpdAbove, 0, 365, 60), lateAtLeast: num(body.risk.lateAtLeast, 1, 12, 3), loansAtLeast: num(body.risk.loansAtLeast, 1, 10, 3) };
  if (body.segments !== undefined) { c.segments = cleanSegments(body.segments); c.channels = planChannels(c); }
  if (body.channelConfig !== undefined) c.channelConfig = cleanConfig(body.channelConfig, store);
  if (body.nodes || body.edges) {
    const flow = cleanFlow(body.nodes ?? c.nodes, body.edges ?? c.edges);
    if (typeof flow === "string") return bad(flow);
    c.nodes = flow.nodes; c.edges = flow.edges; c.flowEdited = true;
  }
  // The workflow follows the channels until someone edits it by hand.
  if (body.rebuildFlow || ((body.segments !== undefined || body.channelConfig !== undefined) && !c.flowEdited && !body.nodes)) {
    const flow = workflowFromPlan(planChannels(c), c.channelConfig);
    c.nodes = flow.nodes; c.edges = flow.edges; c.flowEdited = false;
  }
  for (const k of ["startAt", "endAt"] as const) if (body[k] !== undefined) { const t = Date.parse(body[k]); if (Number.isNaN(t)) return bad("Invalid date"); c[k] = new Date(t).toISOString(); }
  if (typeof body.salaryWeekBoost === "boolean") c.salaryWeekBoost = body.salaryWeekBoost;
  if (body.dailyCap !== undefined) c.dailyCap = num(body.dailyCap, 1, store.compliance.maxPerDay, c.dailyCap);
  c.updatedAt = new Date().toISOString();
  audit(store, user, "campaign_edit", c.id, c.name);
  saveStore(store, { throttle: true });
  return NextResponse.json({ campaign: view(store, c) });
}
