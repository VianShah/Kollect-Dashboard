"use client";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, CheckCircle2, Copy, Download, Pause, Play, Plus, RefreshCw, Rocket, Save, Send, Square, Trash2, Undo2, Upload } from "lucide-react";
import { useApp } from "@/components/ctx";
import { post, useApi } from "@/components/useApi";
import { Badge, Card, Empty, ErrorNote, Kpi, Loading, Tabs } from "@/components/ui";
import type { AgentOption } from "@/components/WorkflowCanvas";
import { After, During, StageBar, stageFor, type Stage } from "@/components/CampaignStages";
import { CampaignTabs, type DetailTab } from "@/components/CampaignTabs";
import {
  ChannelsStep, CompanyStep, DataStep, FieldsStep, NextBar, ReviewStep, RiskStep, SegmentsStep, Stepper,
  type CampaignView, type PlanData, type PlanStep,
} from "@/components/CampaignPlan";
import { CONNECTOR_DEFS, channelsInUse, stepDef } from "@/lib/campaigns";
import { channelTitle, type CampaignPlan } from "@/lib/campaignPlan";
import { can } from "@/lib/roles";
import { d, inr, num } from "@/lib/format";
import type { Connector, StepEdge, StepNode } from "@/lib/types";

const WorkflowCanvas = dynamic(() => import("@/components/WorkflowCanvas"), { ssr: false, loading: () => <div className="card h-[520px] animate-pulse bg-sunk/60" /> });

interface Data extends PlanData { campaigns: CampaignView[]; connectors: Connector[]; agents: (AgentOption & { resolved: number; max: number })[]; options: { products: string[]; portfolios: string[]; languages: string[] } }
interface Check { errors: string[]; warnings: string[] }
const EDITABLE = ["Draft", "Scheduled", "Paused"];

const channelsOf = (c: { nodes: StepNode[] }) => [...new Set(c.nodes.filter((n) => !["start", "end", "wait", "branch"].includes(n.kind)).map((n) => stepDef(n.kind).title))];
const download = (name: string, body: unknown) => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(body, null, 2)], { type: "application/json" }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
};

export default function CampaignsPage() {
  const { user } = useApp();
  const [tab, setTab] = useState<"Campaigns" | "Integrations">("Campaigns");
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, error, reload, setData } = useApi<Data>("/api/campaigns", () => ({ campaigns: [], connectors: [], agents: [], prompts: [], companies: [], templates: [], options: { products: [], portfolios: [], languages: [] } }));
  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading rows={1} />;
  const open = data.campaigns.find((c) => c.id === openId);
  if (open) return <Editor key={open.id} campaign={open} data={data} onBack={() => { setOpenId(null); reload(); }} onSaved={(c) => setData({ ...data, campaigns: data.campaigns.map((x) => (x.id === c.id ? c : x)) })} />;
  return (
    <>
      <Tabs tabs={["Campaigns", "Integrations"] as const} value={tab} onChange={setTab} />
      {tab === "Campaigns" ? <List data={data} canManage={can(user.role, "manageCampaigns")} canApprove={can(user.role, "approveCampaigns")} onOpen={setOpenId} reload={reload} />
        : <Integrations connectors={data.connectors} canEdit={can(user.role, "manageConnectors")} reload={reload} />}
    </>
  );
}

function List({ data, canManage, canApprove, onOpen, reload }: { data: Data; canManage: boolean; canApprove: boolean; onOpen: (id: string) => void; reload: () => void }) {
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
  const waiting = data.campaigns.filter((c) => c.status === "Awaiting approval");
  return (
    <>
      {canApprove && waiting.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[13px] text-warn">
          <span className="font-medium">{waiting.length} campaign{waiting.length === 1 ? " is" : "s are"} waiting for your approval:</span>
          {waiting.map((c) => <button key={c.id} className="underline" onClick={() => onOpen(c.id)}>{c.name}</button>)}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Running" value={num(running.length)} sub={`${num(running.reduce((s, c) => s + c.memberCount, 0))} borrowers in flight`} />
        <Kpi label="Waiting to start" value={num(data.campaigns.filter((c) => ["Scheduled", "Draft", "Awaiting approval"].includes(c.status)).length)} sub={`${waiting.length} awaiting approval`} />
        <Kpi label="Promises from campaigns" value={num(data.campaigns.reduce((s, c) => s + c.stats.promises, 0))} sub="Across all campaigns" />
        <Kpi label="Collected by campaigns" value={inr(data.campaigns.reduce((s, c) => s + c.stats.collected, 0))} tone="good" sub="Payments credited to a campaign" />
      </div>
      <Card pad={false} title="Campaigns" sub="Pick the portfolio, load its allocation file, check risk and segments, choose channels per segment, then send it for approval."
        right={canManage ? (
          <div className="flex flex-wrap gap-2">
            <input ref={file} type="file" accept=".json,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
            <button className="btn" onClick={() => file.current?.click()}><Upload size={14} aria-hidden="true" />Import config</button>
            <button className="btn" onClick={() => act({ create: { name: "Demo campaign", from: "demo" } }, "Demo campaign created with every step filled in.").then((r) => r.ok && onOpen(r.json.campaign.id))}>Demo campaign</button>
            <button className="btn btn-primary" onClick={() => act({ create: { name: "New campaign", from: "blank" } }, "New draft created.").then((r) => r.ok && onOpen(r.json.campaign.id))}><Plus size={14} aria-hidden="true" />New campaign</button>
          </div>) : undefined}>
        <div className="overflow-x-auto">
          <table className="table w-full whitespace-nowrap">
            <thead><tr><th>Campaign</th><th>Company</th><th>Status</th><th>Channels</th><th className="text-right">Borrowers</th><th className="text-right">Reached</th><th className="text-right">Promises</th><th className="text-right">Collected / target</th><th>Runs</th><th /></tr></thead>
            <tbody>
              {data.campaigns.map((c) => (
                <tr key={c.id} className="hover:bg-sunk/40">
                  <td><button className="text-left font-medium hover:text-brand hover:underline" onClick={() => onOpen(c.id)}>{c.name}</button><div className="max-w-[300px] truncate text-[12px] text-muted">{c.goal || "—"}</div></td>
                  <td className="text-[12.5px]">{c.company}</td>
                  <td><Badge>{c.status}</Badge></td>
                  <td className="text-[12.5px]">{channelsInUse(c).map(channelTitle).join(", ") || channelsOf(c).join(", ") || "—"}</td>
                  <td className="text-right num">{num(["Running", "Paused", "Completed"].includes(c.status) ? c.memberCount : c.audienceSize)}</td>
                  <td className="text-right num">{num(c.stats.reached)}</td><td className="text-right num">{num(c.stats.promises)}</td><td className="text-right num">{inr(c.stats.collected)}<span className="text-muted"> / {inr(c.target)}</span>{c.target > 0 && c.stats.collected > 0 && <div className="text-[11.5px] text-muted">{Math.round((c.stats.collected / c.target) * 100)}%</div>}</td>
                  <td className="text-[12.5px] num">{d(c.startAt)} – {d(c.endAt)}</td>
                  <td className="text-right">
                    {canManage && (
                      <span className="inline-flex gap-1">
                        {c.status === "Running" && <button className="btn min-h-8 px-2" title="Pause" onClick={() => act({ id: c.id, action: "pause" }, "Paused.")}><Pause size={13} aria-label="Pause" /></button>}
                        {c.status === "Paused" && <button className="btn min-h-8 px-2" title="Resume" onClick={() => act({ id: c.id, action: "resume" }, "Resumed.")}><Play size={13} aria-label="Resume" /></button>}
                        <button className="btn min-h-8 px-2" title="Duplicate" onClick={() => act({ id: c.id, action: "duplicate" }, "Copied as a draft.")}><Copy size={13} aria-label="Duplicate" /></button>
                        <button className="btn min-h-8 px-2" title="Export config" onClick={() => download(`${c.name.replace(/[^\w-]+/g, "-")}.json`, { name: c.name, goal: c.goal, company: c.company, audience: c.audience, risk: c.risk, segments: c.segments, channelConfig: c.channelConfig, nodes: c.nodes, edges: c.edges, salaryWeekBoost: c.salaryWeekBoost, dailyCap: c.dailyCap })}><Download size={13} aria-label="Export config" /></button>
                        {c.status === "Draft" && <button className="btn min-h-8 px-2" title="Delete draft" onClick={() => window.confirm(`Delete the draft "${c.name}"?`) && act({ id: c.id, action: "delete" }, "Draft deleted.")}><Trash2 size={13} aria-label="Delete" /></button>}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data.campaigns.length && <Empty title="No campaigns yet">Create one to get started: pick the portfolio, then load its allocation file.</Empty>}
        </div>
        {msg && <p className="px-4 pb-3 text-[12.5px] text-ink-2" role="status">{msg}</p>}
      </Card>
    </>
  );
}

function firstStep(c: CampaignView): PlanStep {
  if (!c.ingest) return c.company === "All companies" ? "Company" : "Data";
  if (!c.ingest.confirmed) return "Fields";
  return "Review";
}

function Editor({ campaign, data, onBack, onSaved }: { campaign: CampaignView; data: Data; onBack: () => void; onSaved: (c: CampaignView) => void }) {
  const { user } = useApp();
  const canManage = can(user.role, "manageCampaigns"), canApprove = can(user.role, "approveCampaigns");
  const [c, setC] = useState(campaign);
  const editable = canManage && EDITABLE.includes(c.status);
  const [stage, setStage] = useState<Stage>(stageFor(campaign.status));
  const [step, setStep] = useState<PlanStep>(firstStep(campaign));
  const [detailTab, setDetailTab] = useState<DetailTab>("Overview");
  const [plan, setPlan] = useState<CampaignPlan | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [msg, setMsg] = useState("");
  const [flowDirty, setFlowDirty] = useState(false);
  const [flowKey, setFlowKey] = useState(0);
  const [note, setNote] = useState("");
  const rowsRef = useRef<{ headers: string[]; rows: string[][] } | null>(null);
  const flowRef = useRef<{ nodes: StepNode[]; edges: StepEdge[] }>({ nodes: campaign.nodes, edges: campaign.edges });

  const loadPlan = useCallback(async () => {
    try { const r = await fetch(`/api/campaigns?id=${c.id}&plan=1`, { cache: "no-store" }); if (r.ok) setPlan((await r.json()).plan); } catch { /* keep the last plan */ }
  }, [c.id]);
  useEffect(() => { loadPlan(); }, [loadPlan, c.updatedAt]);

  const accept = (next: CampaignView) => {
    setC(next); onSaved(next);
    if (!flowDirty) { flowRef.current = { nodes: next.nodes, edges: next.edges }; setFlowKey((k) => k + 1); }
  };
  const patch = useCallback(async (body: Record<string, unknown>) => {
    const r = await post("/api/campaigns", { id: c.id, ...body }, "PATCH");
    if (r.ok) { accept(r.json.campaign); setMsg(""); } else setMsg(r.json.error ?? "Couldn't save.");
    return r.ok;
  }, [c.id, flowDirty]); // eslint-disable-line react-hooks/exhaustive-deps
  async function ingest(body: Record<string, unknown>) {
    const r = await post("/api/campaigns", { id: c.id, action: "ingest", ingest: body });
    if (!r.ok) return r.json.error ?? "Couldn't load that data.";
    accept(r.json.campaign); setStep("Fields");
    return null;
  }
  async function previewRisk(risk: CampaignPlan["rules"]) {
    const r = await post("/api/campaigns", { planPreview: { id: c.id, risk } });
    if (r.ok) setPlan(r.json.plan);
  }
  async function runCheck() { const r = await post("/api/campaigns", { id: c.id, action: "check" }); if (r.ok) setCheck(r.json); }
  async function action(a: string, done: string, extra: object = {}) {
    if (flowDirty && !(await saveFlow())) return;
    const r = await post("/api/campaigns", { id: c.id, action: a, ...extra });
    if (r.ok) { accept(r.json.campaign); setMsg(done); setStage(stageFor(r.json.campaign.status)); }
    else { setMsg(r.json.error ?? "That didn't work."); if (r.json.errors) setCheck(r.json); }
  }
  async function saveFlow() {
    const r = await post("/api/campaigns", { id: c.id, ...flowRef.current }, "PATCH");
    if (r.ok) { setC(r.json.campaign); onSaved(r.json.campaign); setFlowDirty(false); }
    else setMsg(r.json.error ?? "Couldn't save the workflow.");
    return r.ok;
  }
  // The canvas reports its layout once when it mounts; only changes after that count as edits.
  const baseline = useRef<string | null>(null);
  useEffect(() => { baseline.current = null; }, [flowKey, step]);
  const onFlow = useCallback((nodes: StepNode[], edges: StepEdge[]) => {
    flowRef.current = { nodes, edges };
    const now = JSON.stringify({ nodes, edges });
    if (baseline.current === null) { baseline.current = now; return; }
    if (now !== baseline.current) setFlowDirty(true);
  }, []);
  const go = (s: PlanStep) => setStep(s);
  const startsNow = Date.parse(c.startAt) <= Date.now();

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <button className="btn btn-ghost" onClick={() => { if (!flowDirty || window.confirm("Leave without saving the workflow?")) onBack(); }}><ArrowLeft size={14} aria-hidden="true" />All campaigns</button>
        <input className="input min-w-64 flex-1 text-[15px] font-semibold" defaultValue={c.name} disabled={!editable} maxLength={80} onBlur={(e) => e.target.value !== c.name && patch({ name: e.target.value })} aria-label="Campaign name" />
        <span className="text-[12.5px] text-muted">{c.company}</span>
        <Badge>{c.status}</Badge>
        {canManage && c.status === "Running" && <button className="btn" onClick={() => action("pause", "Paused. You can edit it now.")}><Pause size={14} aria-hidden="true" />Pause</button>}
        {canManage && c.status === "Paused" && <button className="btn" onClick={() => action("resume", "Running again.")}><Play size={14} aria-hidden="true" />Resume</button>}
        {canManage && ["Running", "Paused", "Scheduled"].includes(c.status) && <button className="btn" onClick={() => window.confirm("Stop this campaign for good?") && action("stop", "Stopped.")}><Square size={14} aria-hidden="true" />Stop</button>}
      </div>
      {msg && <p className="text-[12.5px] text-ink-2" role="status">{msg}</p>}
      {c.approval && (c.status === "Awaiting approval" || c.approval.decision === "returned") && (
        <div className={`rounded-md border px-3 py-2 text-[12.5px] ${c.status === "Awaiting approval" ? "border-warn/30 bg-warn-soft text-warn" : "border-bad/30 bg-bad-soft text-bad"}`}>
          {c.status === "Awaiting approval"
            ? <>Sent for approval by {c.approval.submittedBy} on {d(c.approval.submittedAt)}. {canApprove ? "Review it below, then approve or send it back." : "Your Manager will approve it or send it back."}</>
            : <>Sent back by {c.approval.decidedBy}: “{c.approval.note}”</>}
        </div>
      )}

      <StageBar stage={stage} status={c.status} onChange={setStage} />

      {stage !== "Before" && <CampaignTabs value={detailTab} onChange={setDetailTab} campaignId={c.id} />}
      {stage === "During" && detailTab === "Overview" && <During campaign={c} />}
      {stage === "After" && detailTab === "Overview" && <After campaign={c} canManage={canManage} onDuplicate={async () => { const r = await post("/api/campaigns", { id: c.id, action: "duplicate" }); setMsg(r.ok ? "Copied as a new draft. Find it in the campaign list." : r.json.error ?? "Couldn't copy it."); }} />}
      {stage !== "Before" && detailTab !== "Overview" && <CampaignTabs.Body tab={detailTab} campaignId={c.id} />}

      {stage === "Before" && (
        <>
          <Stepper c={c} step={step} onChange={go} />
          {step === "Company" && <CompanyStep c={c} data={data} editable={editable} patch={patch} />}
          {step === "Data" && <DataStep c={c} plan={plan} editable={editable} patch={patch} ingest={ingest} rowsRef={rowsRef} />}
          {step === "Fields" && <FieldsStep c={c} editable={editable} patch={patch} rowsRef={rowsRef} />}
          {step === "Risk" && <RiskStep c={c} plan={plan} editable={editable} patch={patch} preview={previewRisk} />}
          {step === "Segments" && <SegmentsStep plan={plan} />}
          {step === "Channels" && <ChannelsStep c={c} plan={plan} data={data} editable={editable} patch={patch} />}
          {step === "Workflow" && (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 rounded-md bg-sunk px-3 py-2 text-[12.5px] text-ink-2">
                <span className="min-w-0 flex-1">
                  {channelsInUse(c).length
                    ? <>Drawn from the channels you chose: <b>{channelsInUse(c).map(channelTitle).join(", ")}</b>, least intrusive first, checking for payment after each. Each step only runs for the segments given that channel. {c.flowEdited ? "You've edited it by hand, so it no longer follows the channels." : "It updates when the channels change."}</>
                    : "No channels chosen yet. Pick them per segment in Channels."}
                </span>
                {editable && flowDirty && <button className="btn btn-primary" onClick={saveFlow}><Save size={14} aria-hidden="true" />Save workflow</button>}
                {editable && <button className="btn" disabled={!channelsInUse(c).length} onClick={() => (!c.flowEdited || window.confirm("Replace your edited workflow with one drawn from the channels?")) && (setFlowDirty(false), patch({ rebuildFlow: true }))}><RefreshCw size={14} aria-hidden="true" />Redraw from channels</button>}
              </div>
              <WorkflowCanvas key={flowKey} nodes={flowRef.current.nodes} edges={flowRef.current.edges} agents={data.agents} readOnly={!editable} onChange={onFlow} allowed={channelsInUse(c)} />
            </div>
          )}
          {step === "Review" && (
            <>
              <ReviewStep c={c} plan={plan} data={data} check={check} onCheck={runCheck} />
              <Card title={c.status === "Awaiting approval" ? "Approval" : "Launch"}>
                <div className="flex flex-wrap items-center gap-2">
                  {editable && canApprove && <button className="btn btn-primary" onClick={() => action("launch", startsNow ? "Launched. It's running now." : `Scheduled for ${d(c.startAt)}.`)}><Rocket size={14} aria-hidden="true" />{startsNow ? "Launch now" : "Schedule"}</button>}
                  {editable && !canApprove && c.status === "Draft" && <>
                    <input className="input min-w-64 flex-1" placeholder="Note for your Manager (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
                    <button className="btn btn-primary" onClick={() => action("submit", "Sent to your Manager for approval.", { note })}><Send size={14} aria-hidden="true" />Send for approval</button>
                  </>}
                  {c.status === "Awaiting approval" && canApprove && <>
                    <input className="input min-w-64 flex-1" placeholder="Note (needed to send it back)" value={note} onChange={(e) => setNote(e.target.value)} />
                    <button className="btn btn-primary" onClick={() => action("approve", startsNow ? "Approved and launched." : `Approved. It starts ${d(c.startAt)}.`, { note })}><CheckCircle2 size={14} aria-hidden="true" />Approve and {startsNow ? "launch" : "schedule"}</button>
                    <button className="btn" onClick={() => action("return", "Sent back to the supervisor.", { note })}><Undo2 size={14} aria-hidden="true" />Send back</button>
                  </>}
                  {c.status === "Awaiting approval" && canManage && !canApprove && <button className="btn" onClick={() => action("withdraw", "Withdrawn. You can edit it again.")}><Undo2 size={14} aria-hidden="true" />Withdraw to edit</button>}
                  {!canManage && !canApprove && <span className="text-[12.5px] text-muted">Only supervisors build campaigns and Managers approve them.</span>}
                  {canApprove && !canManage && c.status !== "Awaiting approval" && <span className="text-[12.5px] text-muted">Supervisors build campaigns and send them to you for approval.</span>}
                </div>
              </Card>
            </>
          )}
          {step !== "Review" && <NextBar step={step} onChange={go} disabled={(step === "Data" && !c.ingest) || (step === "Fields" && !c.ingest?.confirmed)}
            hint={step === "Fields" && !c.ingest?.confirmed ? "Confirm the fields to continue" : step === "Data" && !c.ingest ? "Load data to continue" : undefined} />}
        </>
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
                  <span className="text-[12px] text-muted">Keys are set in the server's environment. Send and track messages on the WhatsApp page.</span>
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
