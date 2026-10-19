import { NextResponse } from "next/server";
import { bad, requireUser } from "@/lib/api";
import { can } from "@/lib/auth";
import { CONDITION_LABEL, SLOT_LABEL, STEP_DEFS, TEMPLATES, audienceOf, audienceSummary, blankAudience, campaignDetail, checkCampaign, maskConnector, starterWorkflow } from "@/lib/campaigns";
import { riskScore, tierOf, type RiskTier } from "@/lib/portfolio";
import { audit, saveStore } from "@/lib/store";
import { DAY } from "@/lib/time";
import type { Campaign, CampaignAudience, StepEdge, StepKind, StepNode, Store } from "@/lib/types";

const KINDS = STEP_DEFS.map((s) => s.kind);
const EDITABLE: Campaign["status"][] = ["Draft", "Scheduled", "Paused"];
const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v: unknown, max = 50) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, max).map((x) => x.slice(0, 60)) : []);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);

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
const view = (s: Store, c: Campaign) => ({ ...c, members: undefined, memberCount: c.members.length, audienceSize: audienceSummary(s, c.audience).eligible });

export async function GET(req: Request) {
  const a = await requireUser(undefined, "campaigns");
  if ("res" in a) return a.res;
  const { store } = a;
  const id = new URL(req.url).searchParams.get("id");
  if (id) {
    const c = store.campaigns.find((x) => x.id === id);
    if (!c) return bad("Campaign not found", 404);
    const plan = audienceOf(store, c.audience).filter((b) => b.disposition !== "Dispute");
    const tiers = { High: 0, Medium: 0, Low: 0 } as Record<RiskTier, number>;
    for (const b of plan) tiers[tierOf(riskScore(b))]++;
    return NextResponse.json({ detail: campaignDetail(store, c), plan: { tiers, accounts: plan.length } });
  }
  return NextResponse.json({
    prompts: store.prompts.filter((p) => p.status === "Published").map((p) => ({ id: p.id, client: p.client, product: p.product, tone: p.tone, version: p.current })),
    companies: store.portfolios,
    campaigns: store.campaigns.map((c) => view(store, c)),
    connectors: store.connectors.map(maskConnector),
    agents: store.agents.filter((x) => x.channel === "AI Voice" || x.channel === "IVR").map((x) => ({ code: x.code, name: x.name, channel: x.channel, language: x.language, product: x.product })),
    options: { products: store.products, portfolios: store.portfolios, languages: store.languages },
  });
}

// { create: { name, from: "starter" | "blank" } } | { import: Campaign-like } | { preview: audience } | { id, action }
export async function POST(req: Request) {
  const a = await requireUser(undefined, "campaigns");
  if ("res" in a) return a.res;
  const { store, user } = a;
  const body = await req.json().catch(() => ({}));
  if (body.preview) return NextResponse.json(audienceSummary(store, cleanAudience(body.preview)));
  if (!can(user, "manageCampaigns")) return bad("Only Super Admins and supervisors can change campaigns", 403);

  if (body.create || body.import) {
    const src = body.import ?? {};
    const flow = body.import ? cleanFlow(src.nodes, src.edges) : body.create.from === "blank"
      ? { nodes: [{ id: "n1", kind: "start", x: 40, y: 160, data: { label: "Start" } }, { id: "n2", kind: "end", x: 360, y: 160, data: { label: "Done" } }] as StepNode[], edges: [] as StepEdge[] }
      : starterWorkflow();
    if (typeof flow === "string") return bad(flow);
    const now = Date.now();
    const c: Campaign = {
      id: `C${++store.campaignSeq}`, name: str(body.import ? src.name : body.create.name, 80) || "Untitled campaign", goal: str(src.goal, 200),
      company: store.portfolios.includes(src.company) ? src.company : "All companies", target: num(src.target, 0, 1e10, 0),
      promptId: store.prompts.find((p) => p.id === src.promptId && p.status === "Published")?.id,
      status: "Draft", audience: cleanAudience(src.audience), nodes: flow.nodes, edges: flow.edges,
      startAt: new Date(now + DAY).toISOString(), endAt: new Date(now + 8 * DAY).toISOString(),
      salaryWeekBoost: src.salaryWeekBoost !== false, dailyCap: num(src.dailyCap, 1, store.compliance.maxPerDay, store.compliance.maxPerDay),
      members: [], stats: { reached: 0, attempts: 0, promises: 0, paid: 0, collected: 0 }, createdBy: user.username, updatedAt: new Date(now).toISOString(),
    };
    store.campaigns.unshift(c);
    audit(store, user, body.import ? "campaign_import" : "campaign_create", c.id, c.name);
    saveStore(store);
    return NextResponse.json({ campaign: view(store, c) });
  }

  const c = store.campaigns.find((x) => x.id === body.id);
  if (!c) return bad("Campaign not found", 404);
  const now = Date.now();
  switch (body.action) {
    case "check": return NextResponse.json(checkCampaign(store, c));
    case "launch": {
      if (!EDITABLE.includes(c.status)) return bad(`A ${c.status.toLowerCase()} campaign can't be launched`);
      const result = checkCampaign(store, c);
      if (result.errors.length) return NextResponse.json({ error: "Fix these before launching", ...result }, { status: 422 });
      const startNow = Date.parse(c.startAt) <= now;
      c.status = startNow ? "Running" : "Scheduled";
      if (startNow) { c.members = audienceOf(store, c.audience).filter((b) => b.disposition !== "Dispute").map((b) => b.id); c.launchedAt = new Date(now).toISOString(); }
      break;
    }
    case "pause": if (c.status !== "Running") return bad("Only a running campaign can be paused"); c.status = "Paused"; break;
    case "resume": if (c.status !== "Paused") return bad("Only a paused campaign can be resumed"); c.status = "Running"; break;
    case "stop": if (!["Running", "Paused", "Scheduled"].includes(c.status)) return bad("Nothing to stop"); c.status = "Completed"; break;
    case "duplicate": {
      const copy: Campaign = { ...structuredClone(c), id: `C${++store.campaignSeq}`, name: `${c.name} (copy)`.slice(0, 80), status: "Draft", members: [], launchedAt: undefined,
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

// Edit a draft, scheduled or paused campaign: { id, name?, goal?, audience?, nodes?, edges?, startAt?, endAt?, salaryWeekBoost?, dailyCap? }
export async function PATCH(req: Request) {
  const a = await requireUser("manageCampaigns");
  if ("res" in a) return a.res;
  const { store, user } = a;
  const body = await req.json().catch(() => ({}));
  const c = store.campaigns.find((x) => x.id === body.id);
  if (!c) return bad("Campaign not found", 404);
  if (!EDITABLE.includes(c.status)) return bad("Pause the campaign before editing it");
  if (body.name !== undefined) c.name = str(body.name, 80) || c.name;
  if (body.goal !== undefined) c.goal = str(body.goal, 200);
  if (body.company !== undefined) c.company = store.portfolios.includes(body.company) ? body.company : "All companies";
  if (body.target !== undefined) c.target = num(body.target, 0, 1e10, c.target);
  if (body.promptId !== undefined) {
    if (body.promptId && !store.prompts.some((p) => p.id === body.promptId && p.status === "Published")) return bad("Choose a published prompt");
    c.promptId = body.promptId || undefined;
  }
  if (body.audience) c.audience = cleanAudience(body.audience);
  if (body.nodes || body.edges) {
    const flow = cleanFlow(body.nodes ?? c.nodes, body.edges ?? c.edges);
    if (typeof flow === "string") return bad(flow);
    c.nodes = flow.nodes; c.edges = flow.edges;
  }
  for (const k of ["startAt", "endAt"] as const) if (body[k] !== undefined) { const t = Date.parse(body[k]); if (Number.isNaN(t)) return bad("Invalid date"); c[k] = new Date(t).toISOString(); }
  if (typeof body.salaryWeekBoost === "boolean") c.salaryWeekBoost = body.salaryWeekBoost;
  if (body.dailyCap !== undefined) c.dailyCap = num(body.dailyCap, 1, store.compliance.maxPerDay, c.dailyCap);
  c.updatedAt = new Date().toISOString();
  audit(store, user, "campaign_edit", c.id, c.name);
  saveStore(store, { throttle: true });
  return NextResponse.json({ campaign: view(store, c) });
}
