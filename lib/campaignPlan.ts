// What a campaign will do before it launches: who is in it, how risky each borrower is and why, the segments,
// the language for each borrower, each segment's channel mix, the channel settings and the workflow built from them.
import { BUCKETS, BUCKET_LABEL, DEFAULT_RULES, bucketFor, guessLanguage, personaOf, riskOf, segmentKey, segmentName, suggestChannels, type RiskRules } from "./allocation";
import { CHANNELS, audienceOf, stepDef } from "./campaigns";
import { TEAM } from "./team";
import type { Campaign, ChannelConfig, ChannelKind, Slot, StepEdge, StepNode, Store, TierKey } from "./types";

const TIER_KEYS: TierKey[] = ["High", "Medium", "Low"];
export const SLOT_TIME: Record<Slot, string> = { morning: "08:00–12:00", afternoon: "12:00–17:00", evening: "17:00–19:00" };

export const rulesOf = (c: Pick<Campaign, "risk">): RiskRules => ({ ...DEFAULT_RULES, ...(c.risk ?? {}) });
/** The channels the campaign uses: everything any segment gets (older drafts: their own list). */
export const planChannels = (c: Pick<Campaign, "segments" | "channels">): ChannelKind[] =>
  c.segments ? CHANNELS.filter((k) => Object.values(c.segments!).some((l) => l.includes(k))) : c.channels ?? [];

export function campaignPlan(s: Store, c: Campaign, rulesOverride?: Partial<RiskRules>) {
  const rules = { ...rulesOf(c), ...(rulesOverride ?? {}) };
  const all = audienceOf(s, c.audience);
  const people = all.filter((b) => b.disposition !== "Dispute");
  const sorted = people.map((b) => b.outstanding).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const fromFile = !!c.ingest?.columns.some((x) => x.field === "language");

  const rows = people.map((b) => {
    const p = personaOf(b);
    const v = riskOf(b, p, rules, median);
    const g = guessLanguage(p, b);
    return { b, p, v, bucket: bucketFor(b), language: fromFile ? b.language : g.language, languageWhy: fromFile ? "From the file" : g.why };
  });

  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, x) => a + x, 0) / xs.length) : 0);
  const tiers = Object.fromEntries(TIER_KEYS.map((t) => {
    const rs = rows.filter((r) => r.v.tier === t);
    return [t, {
      accounts: rs.length, outstanding: rs.reduce((n, r) => n + r.b.outstanding, 0),
      avgBureau: avg(rs.map((r) => r.b.experian)), avgDpd: avg(rs.map((r) => r.b.dpd)), avgLate: rs.length ? +(rs.reduce((n, r) => n + r.p.latePayments, 0) / rs.length).toFixed(1) : 0,
      highPriority: rs.filter((r) => r.v.priority === "High").length,
      brokenPromises: rs.filter((r) => r.b.ptpOutcome === "broken").length,
    }];
  })) as Record<TierKey, { accounts: number; outstanding: number; avgBureau: number; avgDpd: number; avgLate: number; highPriority: number; brokenPromises: number }>;

  const segments = BUCKETS.flatMap((bucket) => TIER_KEYS.map((tier) => {
    const key = segmentKey(bucket, tier);
    const rs = rows.filter((r) => r.bucket === bucket && r.v.tier === tier);
    if (!rs.length) return null;
    const langs = new Map<string, number>();
    rs.forEach((r) => langs.set(r.language, (langs.get(r.language) ?? 0) + 1));
    return {
      key, name: segmentName(key), bucket, bucketLabel: BUCKET_LABEL[bucket], tier,
      accounts: rs.length, outstanding: rs.reduce((n, r) => n + r.b.outstanding, 0), highPriority: rs.filter((r) => r.v.priority === "High").length,
      avgBureau: avg(rs.map((r) => r.b.experian)), avgLate: rs.length ? +(rs.reduce((n, r) => n + r.p.latePayments, 0) / rs.length).toFixed(1) : 0,
      languages: [...langs.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      suggested: suggestChannels(bucket, tier),
      channels: c.segments?.[key] ?? suggestChannels(bucket, tier),
    };
  }).filter(<T,>(x: T | null): x is T => !!x));

  const langCount = new Map<string, number>();
  rows.forEach((r) => langCount.set(r.language, (langCount.get(r.language) ?? 0) + 1));
  const sameAsRecord = rows.filter((r) => r.language === r.b.language).length;

  // A spread of examples so the reasons can be checked: a few from each tier.
  const samples = TIER_KEYS.flatMap((t) => rows.filter((r) => r.v.tier === t).slice(0, 4)).map((r) => ({
    id: r.b.id, loanId: r.b.loanId, name: r.b.name, product: r.b.product, outstanding: r.b.outstanding, dpd: r.b.dpd, bureau: r.b.experian,
    latePayments: r.p.latePayments, loansHeld: r.p.loansHeld, city: r.p.city, state: r.p.state,
    tier: r.v.tier, points: r.v.points, priority: r.v.priority, reasons: r.v.reasons, language: r.language, languageWhy: r.languageWhy,
  }));

  return {
    rules, accounts: rows.length, outstanding: rows.reduce((n, r) => n + r.b.outstanding, 0),
    excluded: { disputed: all.length - people.length, doNotCall: people.filter((b) => b.dnd).length, noWhatsApp: people.filter((b) => !b.waConsent).length },
    tiers, segments,
    buckets: BUCKETS.map((bucket) => { const rs = rows.filter((r) => r.bucket === bucket); return { bucket, label: BUCKET_LABEL[bucket], accounts: rs.length, outstanding: rs.reduce((n, r) => n + r.b.outstanding, 0) }; }),
    languages: [...langCount.entries()].map(([name, count]) => ({ name, count, speakers: TEAM.filter((t) => t.languages.includes(name)).length })).sort((a, b) => b.count - a.count),
    languageSource: fromFile ? "file" as const : "location" as const,
    languageAgreement: rows.length ? Math.round((sameAsRecord / rows.length) * 100) : 0,
    highPriority: rows.filter((r) => r.v.priority === "High").length,
    samples,
  };
}
export type CampaignPlan = ReturnType<typeof campaignPlan>;

/** Sensible starting settings for each channel the segments use. */
export function defaultChannelConfig(channels: ChannelKind[], plan: Pick<CampaignPlan, "languages">, agentCodes: string[]): ChannelConfig {
  const langs = plan.languages.map((l) => l.name);
  const cfg: ChannelConfig = {};
  if (channels.includes("voice")) cfg.voice = { slots: ["evening"], concurrency: 100, languages: langs, agents: agentCodes };
  if (channels.includes("ivr")) cfg.ivr = { voice: "Female · borrower's language", slots: ["morning"] };
  if (channels.includes("whatsapp")) cfg.whatsapp = { template: "Payment link", slots: ["afternoon"], reminderHours: 24 };
  if (channels.includes("telecaller")) cfg.telecaller = { seats: Math.min(6, Math.max(2, Math.ceil(plan.languages.length / 2) + 1)), languages: langs.slice(0, 4), priorityFirst: true };
  return cfg;
}

/**
 * The workflow drawn from the chosen channels, least intrusive first: WhatsApp, then IVR, then the AI voice call,
 * then a telecaller. After each step it waits and checks for payment, so people who pay leave the campaign.
 * Each step only runs for the segments given that channel.
 */
export function workflowFromPlan(channels: ChannelKind[], cfg: ChannelConfig = {}): { nodes: StepNode[]; edges: StepEdge[] } {
  const order: ChannelKind[] = ["whatsapp", "ivr", "voice", "telecaller"];
  const steps = order.filter((k) => channels.includes(k));
  const nodes: StepNode[] = [{ id: "n1", kind: "start", x: 0, y: 140, data: { label: "Start" } }];
  const edges: StepEdge[] = [];
  const add = (n: Omit<StepNode, "id">) => { const id = `n${nodes.length + 1}`; nodes.push({ ...n, id }); return id; };
  const link = (source: string, target: string, label?: "yes" | "no") => edges.push({ id: `e${edges.length + 1}`, source, target, label });
  const done = add({ kind: "end", x: 220 + steps.length * 420, y: 0, data: { label: "Paid · leaves" } });
  let prev = "n1", prevLabel: "no" | undefined, x = 200;
  steps.forEach((k, i) => {
    const slot = (k === "voice" ? cfg.voice?.slots[0] : k === "ivr" ? cfg.ivr?.slots[0] : k === "whatsapp" ? cfg.whatsapp?.slots[0] : undefined);
    const data: StepNode["data"] = { label: k === "whatsapp" ? `WhatsApp · ${cfg.whatsapp?.template ?? "Payment link"}` : k === "voice" ? "AI voice call" : k === "ivr" ? "IVR reminder" : "Telecaller", slot };
    if (k === "whatsapp") data.template = cfg.whatsapp?.template ?? "Payment link";
    if (k === "voice" || k === "ivr") data.agent = "auto";
    if (k === "telecaller") data.seats = cfg.telecaller?.seats ?? 2;
    const step = add({ kind: k, x, y: 130, data });
    link(prev, step, prevLabel);
    if (i < steps.length - 1) {
      const hours = k === "whatsapp" ? cfg.whatsapp?.reminderHours ?? 24 : 24;
      const wait = add({ kind: "wait", x: x + 140, y: 250, data: { label: `Wait ${hours >= 24 ? `${Math.round(hours / 24)} day${hours >= 48 ? "s" : ""}` : `${hours} h`}`, waitHours: hours } });
      const branch = add({ kind: "branch", x: x + 280, y: 130, data: { label: "Paid?", condition: "paid" } });
      link(step, wait); link(wait, branch); link(branch, done, "yes");
      prev = branch; prevLabel = "no"; x += 420; // the next step hangs off the "no" path
    } else {
      const end = add({ kind: "end", x: x + 220, y: 140, data: { label: "Campaign ends" } });
      link(step, end);
    }
  });
  if (!steps.length) link("n1", done);
  return { nodes, edges };
}

export const channelTitle = (k: ChannelKind) => (k === "voice" ? "AI voice" : stepDef(k).title === "Telecaller" ? "Telecallers" : stepDef(k).title === "IVR call" ? "IVR" : stepDef(k).title);
