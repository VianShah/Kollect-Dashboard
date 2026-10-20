"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Copy, Download, Pause, Play, Plus, Rocket, Save, Square, Trash2, Upload } from "lucide-react";
import { useApp } from "@/components/ctx";
import { post, useApi } from "@/components/useApi";
import { Badge, Card, Empty, ErrorNote, Kpi, Loading, Tabs } from "@/components/ui";
import type { AgentOption } from "@/components/WorkflowCanvas";
import { After, AgentStep, ChannelsByRisk, During, StageBar, stageFor, type Stage } from "@/components/CampaignStages";
import { CHANNEL_INFO, CONNECTOR_DEFS, channelsInUse, stepDef, workflowFromChannels } from "@/lib/campaigns";
import { can } from "@/lib/roles";
import { d, inr, num } from "@/lib/format";
import type { Campaign, CampaignAudience, Connector, StepEdge, StepNode } from "@/lib/types";

const WhatsAppPanel = dynamic(() => import("@/components/WhatsAppPanel"), { ssr: false, loading: () => <div className="card h-40 animate-pulse bg-sunk/60" /> });
const WorkflowCanvas = dynamic(() => import("@/components/WorkflowCanvas"), { ssr: false, loading: () => <div className="card h-[520px] animate-pulse bg-sunk/60" /> });

type CampaignView = Omit<Campaign, "members"> & { memberCount: number; audienceSize: number };
interface PromptOption { id: string; client: string; product: string; tone: string; version: number }
interface Data { campaigns: CampaignView[]; connectors: Connector[]; agents: AgentOption[]; prompts: PromptOption[]; companies: string[]; options: { products: string[]; portfolios: string[]; languages: string[] } }
interface Check { errors: string[]; warnings: string[]; audience: { total: number; eligible: number; outstanding: number; excluded: { disputed: number; doNotCall: number; noWhatsApp: number }; unmatched: number; tiers?: Record<"High" | "Medium" | "Low", number> } }

const SEGMENTS = ["Pre Due", "Post Due (0–30)", "Post Due (30–90)", "Post Due (90+)"];
const channelsOf = (c: { nodes: StepNode[] }) => [...new Set(c.nodes.filter((n) => !["start", "end", "wait", "branch"].includes(n.kind)).map((n) => stepDef(n.kind).title))];
const download = (name: string, body: unknown) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
};

export default function CampaignsPage() {
  const { user } = useApp();
  const [tab, setTab] = useState<"Campaigns" | "WhatsApp" | "Integrations">("Campaigns");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, error, reload, setData } = useApi<Data>("/api/campaigns", () => ({ campaigns: [], connectors: [], agents: [], prompts: [], companies: [], options: { products: [], portfolios: [], languages: [] } }));
  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading rows={1} />;
  const open = data.campaigns.find((c) => c.id === openId);
  if (open) return <Editor key={open.id} campaign={open} data={data} onBack={() => { setOpenId(null); reload(); }} onSaved={(c) => setData({ ...data, campaigns: data.campaigns.map((x) => (x.id === c.id ? c : x)) })} />;
  return (
    <>
      <Tabs tabs={["Campaigns", "WhatsApp", "Integrations"] as const} value={tab} onChange={setTab} />
      {tab === "Campaigns" ? <List data={data} canManage={can(user.role, "manageCampaigns")} onOpen={setOpenId} reload={reload} />
        : tab === "WhatsApp" ? <WhatsAppPanel />
        : <Integrations connectors={data.connectors} canEdit={can(user.role, "manageConnectors")} reload={reload} />}
    </>
  );
}

function List({ data, canManage, onOpen, reload }: { data: Data; canManage: boolean; onOpen: (id: string) => void; reload: () => void }) {
  const [msg, setMsg] = useState("");
  const file = useRef<HTMLInputElement>(null);
  async function act(body: object, done: string) {
    const r = await post("/api/campaigns", body);
    setMsg(r.ok ? done : r.json.error ? `${r.json.error}${r.json.errors?.length ? `: ${r.json.errors.join(" ")}` : ""}` : "That didn't work.");
    reload();
    return r;
  }
  async function importFile(f: File) {
    try { const json = JSON.parse(await f.text()); const r = await act({ import: json }, "Imported as a draft."); if (r.ok) onOpen(r.json.campaign.id); }
    catch { setMsg("That file isn't a campaign export (JSON)."); }
  }
  const running = data.campaigns.filter((c) => c.status === "Running");
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Running" value={num(running.length)} sub={`${num(running.reduce((s, c) => s + c.memberCount, 0))} borrowers in flight`} />
        <Kpi label="Scheduled or draft" value={num(data.campaigns.filter((c) => c.status === "Scheduled" || c.status === "Draft").length)} sub="Waiting to start" />
        <Kpi label="Promises from campaigns" value={num(data.campaigns.reduce((s, c) => s + c.stats.promises, 0))} sub="Across all campaigns" />
        <Kpi label="Collected by campaigns" value={inr(data.campaigns.reduce((s, c) => s + c.stats.collected, 0))} tone="good" sub="Payments credited to a campaign" />
      </div>
      <Card pad={false} title="Campaigns" sub="Build a workflow across WhatsApp, SMS, AI voice, IVR and telecallers, choose who it reaches, then launch."
        right={canManage ? (
          <div className="flex flex-wrap gap-2">
            <input ref={file} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
            <button className="btn" onClick={() => file.current?.click()}><Upload size={14} aria-hidden="true" />Import config</button>
            <button className="btn" onClick={() => act({ create: { name: "New campaign", from: "blank" } }, "Empty draft created.").then((r) => r.ok && onOpen(r.json.campaign.id))}>Start empty</button>
            <button className="btn btn-primary" onClick={() => act({ create: { name: "New campaign", from: "demo" } }, "Demo campaign created with every step filled in. Review it, then launch.").then((r) => r.ok && onOpen(r.json.campaign.id))}><Plus size={14} aria-hidden="true" />New campaign</button>
          </div>) : undefined}>
        <div className="overflow-x-auto">
          <table className="table w-full whitespace-nowrap">
            <thead><tr><th>Campaign</th><th>Status</th><th>Channels</th><th className="text-right">Borrowers</th><th className="text-right">Reached</th><th className="text-right">Promises</th><th className="text-right">Collected / target</th><th>Runs</th><th /></tr></thead>
            <tbody>
              {data.campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-sunk/40">
                  <td><button className="text-left font-medium hover:text-brand hover:underline" onClick={() => onOpen(c.id)}>{c.name}</button><div className="max-w-[300px] truncate text-[12px] text-muted">{c.goal || "—"}</div></td>
                  <td><Badge>{c.status}</Badge></td>
                  <td className="text-[12.5px]">{channelsOf(c).join(", ") || "—"}</td>
                  <td className="text-right num">{num(c.status === "Running" || c.status === "Paused" || c.status === "Completed" ? c.memberCount : c.audienceSize)}</td>
                  <td className="text-right num">{num(c.stats.reached)}</td><td className="text-right num">{num(c.stats.promises)}</td><td className="text-right num">{inr(c.stats.collected)}<span className="text-muted"> / {inr(c.target)}</span>{c.target > 0 && c.stats.collected > 0 && <div className="text-[11.5px] text-muted">{Math.round((c.stats.collected / c.target) * 100)}%</div>}</td>
                  <td className="text-[12.5px] num">{d(c.startAt)} – {d(c.endAt)}</td>
                  <td className="text-right">
                    {canManage && (
                      <span className="inline-flex gap-1">
                        {c.status === "Running" && <button className="btn min-h-8 px-2" title="Pause" onClick={() => act({ id: c.id, action: "pause" }, "Paused.")}><Pause size={13} aria-label="Pause" /></button>}
                        {c.status === "Paused" && <button className="btn min-h-8 px-2" title="Resume" onClick={() => act({ id: c.id, action: "resume" }, "Resumed.")}><Play size={13} aria-label="Resume" /></button>}
                        <button className="btn min-h-8 px-2" title="Duplicate" onClick={() => act({ id: c.id, action: "duplicate" }, "Copied as a draft.")}><Copy size={13} aria-label="Duplicate" /></button>
                        <button className="btn min-h-8 px-2" title="Export config" onClick={() => download(`${c.name.replace(/[^\w-]+/g, "-")}.json`, { name: c.name, goal: c.goal, audience: c.audience, nodes: c.nodes, edges: c.edges, salaryWeekBoost: c.salaryWeekBoost, dailyCap: c.dailyCap })}><Download size={13} aria-label="Export config" /></button>
                        {c.status === "Draft" && <button className="btn min-h-8 px-2" title="Delete draft" onClick={() => window.confirm(`Delete the draft "${c.name}"?`) && act({ id: c.id, action: "delete" }, "Draft deleted.")}><Trash2 size={13} aria-label="Delete" /></button>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.campaigns.length && <Empty title="No campaigns yet">Create one to get started: choose who to reach, then the channels for each risk tier.</Empty>}
        </div>
        {msg && <p className="px-4 pb-3 text-[12.5px] text-ink-2" role="status">{msg}</p>}
      </Card>
    </>
  );
}

function Chips({ label, options, value, onChange, disabled }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void; disabled: boolean }) {
  return (
    <div>
      <div className="label mb-1.5">{label} <span className="normal-case tracking-normal text-muted">{value.length ? "" : "(all)"}</span></div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = value.includes(o);
          return <button key={o} type="button" disabled={disabled} aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={`rounded-full border px-2.5 py-1 text-[12.5px] ${on ? "border-brand bg-brand-soft font-medium text-brand" : "border-line bg-surface text-ink-2 hover:border-line-strong"}`}>{o}</button>;
        })}
      </div>
    </div>
  );
}

function Editor({ campaign, data, onBack, onSaved }: { campaign: CampaignView; data: Data; onBack: () => void; onSaved: (c: CampaignView) => void }) {
  const { user } = useApp();
  const editable = can(user.role, "manageCampaigns") && ["Draft", "Scheduled", "Paused"].includes(campaign.status);
  const [step, setStep] = useState<"Audience" | "Channels" | "Workflow" | "Agent" | "Schedule" | "Review & launch">("Audience");
  const [flowKey, setFlowKey] = useState(0); // remounts the canvas after "Build from chosen channels"
  const [stage, setStage] = useState<Stage>(stageFor(campaign.status));
  const [c, setC] = useState(campaign);
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const [aud, setAud] = useState<Check["audience"] | null>(null);
  const flowRef = useRef<{ nodes: StepNode[]; edges: StepEdge[] }>({ nodes: campaign.nodes, edges: campaign.edges });

  const set = (patch: Partial<CampaignView>) => { setC((x) => ({ ...x, ...patch })); setDirty(true); };
  const onFlow = useCallback((nodes: StepNode[], edges: StepEdge[]) => {
    const before = flowRef.current;
    flowRef.current = { nodes, edges };
    if (JSON.stringify(before) !== JSON.stringify({ nodes, edges })) setDirty(true);
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => { const r = await post("/api/campaigns", { preview: c.audience }); if (r.ok) setAud(r.json); }, 250);
    return () => clearTimeout(t);
  }, [c.audience]);

  async function save() {
    const r = await post("/api/campaigns", { id: c.id, name: c.name, promptId: c.promptId ?? "", channels: channelsInUse(c), tierChannels: c.tierChannels ?? {}, audience: c.audience, ...flowRef.current, startAt: c.startAt, endAt: c.endAt, salaryWeekBoost: c.salaryWeekBoost, dailyCap: c.dailyCap }, "PATCH");
    if (r.ok) { setC(r.json.campaign); onSaved(r.json.campaign); setDirty(false); setMsg("Saved."); } else setMsg(r.json.error ?? "Couldn't save.");
    return r.ok;
  }
  async function runCheck() { if (dirty && !(await save())) return; const r = await post("/api/campaigns", { id: c.id, action: "check" }); if (r.ok) setCheck(r.json); }
  async function action(a: string, done: string) {
    if (a === "launch" && dirty && !(await save())) return;
    const r = await post("/api/campaigns", { id: c.id, action: a });
    if (r.ok) { setC(r.json.campaign); onSaved(r.json.campaign); setMsg(done); } else { setMsg(r.json.error ?? "That didn't work."); if (r.json.errors) setCheck(r.json); }
  }
  const setAudience = (patch: Partial<CampaignAudience>) => set({ audience: { ...c.audience, ...patch } });
  const local = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16);
  const fromLocal = (v: string) => new Date(`${v}:00+05:30`).toISOString();

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-ghost" onClick={() => { if (!dirty || window.confirm("Leave without saving your changes?")) onBack(); }}><ArrowLeft size={14} aria-hidden="true" />All campaigns</button>
        <input className="input min-w-64 flex-1 text-[15px] font-semibold" value={c.name} disabled={!editable} maxLength={80} onChange={(e) => set({ name: e.target.value })} aria-label="Campaign name" />
        <Badge>{c.status}</Badge>
        {editable && <button className="btn" disabled={!dirty} onClick={save}><Save size={14} aria-hidden="true" />{dirty ? "Save draft" : "Saved"}</button>}
        {can(user.role, "manageCampaigns") && c.status === "Running" && <button className="btn" onClick={() => action("pause", "Paused. You can edit it now.")}><Pause size={14} aria-hidden="true" />Pause</button>}
        {can(user.role, "manageCampaigns") && c.status === "Paused" && <button className="btn" onClick={() => action("resume", "Running again.")}><Play size={14} aria-hidden="true" />Resume</button>}
        {can(user.role, "manageCampaigns") && ["Running", "Paused", "Scheduled"].includes(c.status) && <button className="btn" onClick={() => window.confirm("Stop this campaign for good?") && action("stop", "Stopped.")}><Square size={14} aria-hidden="true" />Stop</button>}
      </div>
      {msg && <p className="text-[12.5px] text-ink-2" role="status">{msg}</p>}

      <StageBar stage={stage} status={c.status} onChange={setStage} />

      {stage === "During" && <During campaign={c} />}
      {stage === "After" && <After campaign={c} canManage={can(user.role, "manageCampaigns")} onDuplicate={async () => { const r = await post("/api/campaigns", { id: c.id, action: "duplicate" }); setMsg(r.ok ? "Copied as a new draft. Find it in the campaign list." : r.json.error ?? "Couldn't copy it."); }} />}

      {stage === "Before" && <Tabs tabs={["Audience", "Channels", "Workflow", "Agent", "Schedule", "Review & launch"] as const} value={step} onChange={setStep} />}

      {stage === "Before" && step === "Channels" && (
        <ChannelsByRisk c={c} editable={editable} set={set} tiers={aud?.tiers} connectors={data.connectors} />
      )}

      {stage === "Before" && step === "Workflow" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 rounded-md bg-sunk px-3 py-2 text-[12.5px] text-ink-2">
            <span className="min-w-0 flex-1">
              {channelsInUse(c).length
                ? <>This campaign&apos;s channels: <b>{channelsInUse(c).map((k) => CHANNEL_INFO[k].title).join(", ")}</b>. Only these can be added, and each step only runs for the risk tiers given that channel.</>
                : "No channels chosen yet. Pick the campaign's channels in Channels first."}
            </span>
            {editable && (
              <button className="btn" disabled={!channelsInUse(c).length} onClick={() => {
                if (flowRef.current.nodes.length > 2 && !window.confirm("Replace the current workflow with one built from the chosen channels?")) return;
                const wf = workflowFromChannels(channelsInUse(c));
                flowRef.current = wf; setC((x) => ({ ...x, nodes: wf.nodes, edges: wf.edges })); setDirty(true); setFlowKey((k) => k + 1);
              }}>Build from chosen channels</button>
            )}
          </div>
          <WorkflowCanvas key={`${flowKey}-${channelsInUse(c).join(",")}`} nodes={flowRef.current.nodes} edges={flowRef.current.edges} agents={data.agents} readOnly={!editable} onChange={onFlow} allowed={channelsInUse(c)} />
        </div>
      )}

      {stage === "Before" && step === "Agent" && (
        <AgentStep c={{ ...c, nodes: flowRef.current.nodes, edges: flowRef.current.edges }} editable={editable} set={set} prompts={data.prompts} />
      )}

      {stage === "Before" && step === "Audience" && (
        <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
          <Card title="Who this campaign reaches">
            <div className="space-y-4">
              <div className="seg" role="group" aria-label="Audience source">
                <button type="button" disabled={!editable} aria-pressed={c.audience.source === "filters"} onClick={() => setAudience({ source: "filters" })}>Filters</button>
                <button type="button" disabled={!editable} aria-pressed={c.audience.source === "list"} onClick={() => setAudience({ source: "list" })}>Upload a list</button>
              </div>
              {c.audience.source === "filters" ? (
                <>
                  <Chips label="Products" options={data.options.products} value={c.audience.products} onChange={(v) => setAudience({ products: v })} disabled={!editable} />
                  <Chips label="Segments" options={SEGMENTS} value={c.audience.segments} onChange={(v) => setAudience({ segments: v })} disabled={!editable} />
                  <Chips label="Languages" options={data.options.languages} value={c.audience.languages} onChange={(v) => setAudience({ languages: v })} disabled={!editable} />
                  <Chips label="Portfolios" options={data.options.portfolios} value={c.audience.portfolios} onChange={(v) => setAudience({ portfolios: v })} disabled={!editable} />
                  <div className="flex flex-wrap gap-3">
                    <label className="text-[12px] text-muted">Days past due from<input type="number" min={0} max={999} className="input mt-1 block w-28" disabled={!editable} value={c.audience.minDpd} onChange={(e) => setAudience({ minDpd: Number(e.target.value) })} /></label>
                    <label className="text-[12px] text-muted">to<input type="number" min={0} max={999} className="input mt-1 block w-28" disabled={!editable} value={c.audience.maxDpd} onChange={(e) => setAudience({ maxDpd: Number(e.target.value) })} /></label>
                  </div>
                </>
              ) : (
                <div className="space-y-2">
                  <p className="text-[12.5px] text-muted">Paste loan IDs, or upload a .csv or .txt file with one loan ID per line.</p>
                  <input type="file" accept=".csv,.txt" disabled={!editable} className="text-[13px]" onChange={async (e) => {
                    const f = e.target.files?.[0]; if (!f) return;
                    setAudience({ loanIds: [...new Set((await f.text()).split(/[^A-Za-z0-9_-]+/).filter((x) => /^LN\d+$/i.test(x)).map((x) => x.toUpperCase()))] });
                  }} />
                  <textarea rows={6} className="input block w-full font-mono text-[12px]" disabled={!editable} value={c.audience.loanIds.join("\n")} placeholder={"LN2024000123\nLN2024000456"}
                    onChange={(e) => setAudience({ loanIds: e.target.value.split(/[\s,;]+/).filter(Boolean) })} />
                </div>
              )}
            </div>
          </Card>
          <Card title="Audience">
            {!aud ? <p className="text-[13px] text-muted">Counting…</p> : (
              <dl className="divide-y divide-line text-[13px]">
                {[
                  ["Will be contacted", num(aud.eligible)], ["Outstanding at stake", inr(aud.outstanding)], ["Left out: disputed", num(aud.excluded.disputed)],
                  ["Skipped on voice/IVR: do-not-call", num(aud.excluded.doNotCall)], ["Skipped on WhatsApp: no opt-in", num(aud.excluded.noWhatsApp)],
                  ...(c.audience.source === "list" ? [["Loan IDs not found", num(aud.unmatched)]] : []),
                ].map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-2"><dt className="text-muted">{k}</dt><dd className="font-medium num">{v}</dd></div>)}
              </dl>
            )}
          </Card>
        </div>
      )}

      {stage === "Before" && step === "Schedule" && (
        <Card title="When it runs" sub="Steps only send inside the calling window, and never more than the daily cap per borrower.">
          <fieldset disabled={!editable} className="grid max-w-2xl gap-4 sm:grid-cols-2">
            <label className="text-[13px] font-medium">Start (IST)<input type="datetime-local" className="input mt-1 block w-full" value={local(c.startAt)} onChange={(e) => e.target.value && set({ startAt: fromLocal(e.target.value) })} /></label>
            <label className="text-[13px] font-medium">End (IST)<input type="datetime-local" className="input mt-1 block w-full" value={local(c.endAt)} onChange={(e) => e.target.value && set({ endAt: fromLocal(e.target.value) })} /></label>
            <label className="text-[13px] font-medium">Attempts per borrower per day<input type="number" min={1} max={20} className="input mt-1 block w-full" value={c.dailyCap} onChange={(e) => set({ dailyCap: Number(e.target.value) })} /></label>
            <label className="flex items-start gap-2 self-end text-[13px] font-medium">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]" checked={c.salaryWeekBoost} onChange={(e) => set({ salaryWeekBoost: e.target.checked })} />
              <span>Salary-week boost<span className="block text-[12px] font-normal text-muted">Send more on days 1–7, when most borrowers pay.</span></span>
            </label>
          </fieldset>
        </Card>
      )}

      {stage === "Before" && step === "Review & launch" && (
        <Card title="Check and launch" sub="Every step, connector and the audience are checked against the compliance rules before anything goes out.">
          <div className="flex flex-wrap gap-2">
            <button className="btn" onClick={runCheck}>Run checks</button>
            {editable && <button className="btn btn-primary" onClick={() => action("launch", Date.parse(c.startAt) <= Date.now() ? "Launched. It's running now." : `Scheduled for ${d(c.startAt)}.`)}><Rocket size={14} aria-hidden="true" />{Date.parse(c.startAt) <= Date.now() ? "Launch now" : "Schedule"}</button>}
          </div>
          {check && (
            <div className="mt-4 space-y-3">
              {check.errors.length ? (
                <ul className="space-y-1.5">{check.errors.map((e) => <li key={e} className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-[12.5px] text-bad">{e}</li>)}</ul>
              ) : <p className="rounded-md border border-good/30 bg-good-soft px-3 py-2 text-[12.5px] text-good">No blocking issues. {num(check.audience.eligible)} borrowers, {inr(check.audience.outstanding)} outstanding.</p>}
              <ul className="space-y-1.5">{check.warnings.map((w) => <li key={w} className="rounded-md bg-sunk px-3 py-2 text-[12.5px] text-ink-2">{w}</li>)}</ul>
            </div>
          )}
        </Card>
      )}
    </>
  );
}

function Integrations({ connectors, canEdit, reload }: { connectors: Connector[]; canEdit: boolean; reload: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<{ provider: string; config: Record<string, string> }>({ provider: "", config: {} });
  const [msg, setMsg] = useState<Record<string, string>>({});
  async function call(kind: string, body: object, done?: string) {
    const r = await post("/api/connectors", { kind, ...body }, "PATCH");
    setMsg((m) => ({ ...m, [kind]: r.ok ? done ?? r.json.connector.lastResult ?? "Saved." : r.json.error ?? "That didn't work." }));
    reload();
    return r;
  }
  return (
    <>
      <p className="text-[13px] text-muted">Where campaigns send from and where results flow to. {canEdit ? "Keys are kept on the server and only the last four characters are shown." : "Only a Super Admin can change integrations."}</p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {CONNECTOR_DEFS.map((def) => {
          const c = connectors.find((x) => x.kind === def.kind);
          const status = c?.status ?? "Not connected";
          return (
            <section key={def.kind} className="card flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <div><h3 className="text-[14.5px] font-semibold">{def.title}</h3><p className="text-[12px] text-muted">{def.purpose}</p></div>
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11.5px] font-medium ${status === "Connected" ? "bg-good-soft text-good" : status === "Error" ? "bg-bad-soft text-bad" : "bg-sunk text-ink-2"}`}>{status}</span>
              </div>
              <div className="mt-2 text-[12.5px]"><span className="text-muted">Provider: </span><span className="font-medium">{c?.provider ?? def.provider}</span></div>
              {c?.lastResult && <div className="mt-1 text-[12px] text-muted">{c.lastResult}{c.lastTest ? ` · ${d(c.lastTest)}` : ""}</div>}
              {editing === def.kind ? (
                <form className="mt-3 space-y-2" onSubmit={async (e) => { e.preventDefault(); const r = await call(def.kind, form, "Saved. Run a test to connect."); if (r.ok) setEditing(null); }}>
                  <label className="block text-[12px] text-muted">Provider
                    <select className="input mt-1 block w-full" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>{def.providers.map((p) => <option key={p}>{p}</option>)}</select>
                  </label>
                  {def.fields.map((f) => (
                    <label key={f.key} className="block text-[12px] text-muted">{f.label}
                      <input className="input mt-1 block w-full" type={f.secret ? "password" : "text"} autoComplete="off" placeholder={f.placeholder} value={form.config[f.key] ?? ""}
                        onChange={(e) => setForm({ ...form, config: { ...form.config, [f.key]: e.target.value } })} />
                    </label>
                  ))}
                  <div className="flex gap-2"><button className="btn btn-primary">Save</button><button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>Cancel</button></div>
                </form>
              ) : canEdit && def.kind === "whatsapp" && c?.provider === "Meta Cloud API" ? (
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-3">
                  <button className="btn" onClick={() => call(def.kind, { test: true })}>Test connection</button>
                  <span className="text-[12px] text-muted">Keys are set in the server's environment. Send and track messages on the WhatsApp tab.</span>
                </div>
              ) : canEdit && (
                <div className="mt-auto flex flex-wrap gap-2 pt-3">
                  <button className="btn" onClick={() => { setForm({ provider: c?.provider ?? def.provider, config: { ...(c?.config ?? {}) } }); setEditing(def.kind); }}>{status === "Not connected" ? "Set up" : "Edit"}</button>
                  <button className="btn" onClick={() => call(def.kind, { test: true })}>Test connection</button>
                  {status !== "Not connected" && <button className="btn btn-ghost" onClick={() => window.confirm(`Disconnect ${def.title}? Campaign steps that use it will stop.`) && call(def.kind, { disconnect: true }, "Disconnected.")}>Disconnect</button>}
                </div>
              )}
              {msg[def.kind] && <p className="mt-2 text-[12px] text-ink-2" role="status">{msg[def.kind]}</p>}
            </section>
          );
        })}
      </div>
    </>
  );
}
