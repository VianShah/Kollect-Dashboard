"use client";
// The "Before" steps of a campaign, in order: company, data, fields, risk, segments, channels, workflow, review.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Sparkles, Upload } from "lucide-react";
import { Card, Empty, Kpi, Loading } from "./ui";
import { post } from "./useApi";
import { ALLOCATION_FIELDS, matchColumns, missingRequired, type ColumnMatch } from "@/lib/allocation";
import { SLOT_TIME, channelTitle, type CampaignPlan } from "@/lib/campaignPlan";
import { CHANNELS } from "@/lib/campaigns";
import { renderMessage, type TemplateName } from "@/lib/messages";
import { TONES } from "@/lib/prompts";
import { TEAM } from "@/lib/team";
import { AGENTS, STAGE_LABEL, bestAgents } from "@/lib/agentLibrary";
import { parseSegmentKey } from "@/lib/allocation";
import { d, inr, num } from "@/lib/format";
import type { Campaign, ChannelConfig, ChannelKind, Slot, TierKey } from "@/lib/types";

export type CampaignView = Omit<Campaign, "members"> & { memberCount: number; audienceSize: number };
export interface PlanData {
  companies: string[];
  agents: { code: string; name: string; channel: string; language: string; product: string; resolved: number; max: number }[];
  prompts: { id: string; client: string; product: string; tone: string; version: number }[];
  templates: string[];
}
export const PLAN_STEPS = ["Company", "Data", "Fields", "Risk", "Segments", "Channels", "Workflow", "Review"] as const;
export type PlanStep = (typeof PLAN_STEPS)[number];
type Patch = (body: Record<string, unknown>) => Promise<boolean>;

const TIER_TONE: Record<TierKey, string> = { High: "text-bad", Medium: "text-warn", Low: "text-good" };
const TIER_BG: Record<TierKey, string> = { High: "bg-bad", Medium: "bg-warn", Low: "bg-good" };
const SLOTS: Slot[] = ["morning", "afternoon", "evening"];
const SLOT_NAME: Record<Slot, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };
const IVR_VOICES = ["Female · borrower's language", "Male · borrower's language", "Recorded by the lender"];

function Chip({ on, onClick, children, disabled }: { on: boolean; onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} aria-pressed={on} onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[12.5px] ${on ? "border-brand bg-brand-soft font-medium text-brand" : "border-line bg-surface text-ink-2 hover:border-line-strong"} disabled:cursor-default disabled:opacity-70`}>
      {children}
    </button>
  );
}
const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/** Which steps are done, so the stepper can tick them. */
export function stepDone(c: CampaignView, step: PlanStep) {
  switch (step) {
    case "Company": return c.company !== "All companies" || !!c.ingest;
    case "Data": return !!c.ingest;
    case "Fields": return !!c.ingest?.confirmed;
    case "Risk": case "Segments": return !!c.segments;
    case "Channels": return !!c.segments && !!c.channelConfig;
    case "Workflow": return c.nodes.length > 2;
    default: return c.status !== "Draft";
  }
}

export function Stepper({ c, step, onChange }: { c: CampaignView; step: PlanStep; onChange: (s: PlanStep) => void }) {
  return (
    <nav aria-label="Campaign set-up" className="no-scrollbar flex gap-1 overflow-x-auto rounded-lg border border-line bg-surface p-1">
      {PLAN_STEPS.map((s, i) => {
        const done = stepDone(c, s);
        return (
          <button key={s} onClick={() => onChange(s)} aria-current={step === s ? "step" : undefined}
            className={`flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] ${step === s ? "bg-ink font-medium text-white" : "text-ink-2 hover:bg-sunk"}`}>
            <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10.5px] font-semibold ${step === s ? "bg-white text-ink" : done ? "bg-good-soft text-good" : "bg-sunk text-muted"}`}>{done && step !== s ? "✓" : i + 1}</span>
            {s}
          </button>
        );
      })}
    </nav>
  );
}

export function NextBar({ step, onChange, disabled, hint }: { step: PlanStep; onChange: (s: PlanStep) => void; disabled?: boolean; hint?: string }) {
  const i = PLAN_STEPS.indexOf(step);
  return (
    <div className="flex items-center justify-between gap-2">
      {i > 0 ? <button className="btn btn-ghost" onClick={() => onChange(PLAN_STEPS[i - 1])}>← {PLAN_STEPS[i - 1]}</button> : <span />}
      <span className="flex items-center gap-2">
        {hint && <span className="text-[12px] text-muted">{hint}</span>}
        {i < PLAN_STEPS.length - 1 && <button className="btn btn-primary" disabled={disabled} onClick={() => onChange(PLAN_STEPS[i + 1])}>Next: {PLAN_STEPS[i + 1]} →</button>}
      </span>
    </div>
  );
}

// ---------- 1. Company ----------
export function CompanyStep({ c, data, editable, patch }: { c: CampaignView; data: PlanData; editable: boolean; patch: Patch }) {
  return (
    <Card title="Which portfolio is this campaign for?" sub="Pick the lender first. The data, risk rules, segments and reports all belong to this company.">
      <fieldset disabled={!editable} className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {data.companies.map((co) => (
          <button key={co} type="button" aria-pressed={c.company === co}
            onClick={() => c.company !== co && (!c.ingest || window.confirm("Changing the company clears the data loaded for this campaign. Continue?")) && patch({ company: co })}
            className={`rounded-lg border p-3 text-left ${c.company === co ? "border-brand bg-brand-soft" : "border-line hover:border-line-strong"}`}>
            <div className={`text-[14px] font-semibold ${c.company === co ? "text-brand" : ""}`}>{co}</div>
            <div className="text-[12px] text-muted">{c.company === co ? "Selected" : "Select"}</div>
          </button>
        ))}
      </fieldset>
      <div className="mt-4 grid max-w-2xl gap-3 sm:grid-cols-2">
        <label className="text-[12px] text-muted sm:col-span-2">Goal<input className="input mt-1 block w-full" disabled={!editable} defaultValue={c.goal} maxLength={200} placeholder="e.g. Get promises from 31–60 DPD Personal Loan borrowers before the 15th" onBlur={(e) => e.target.value !== c.goal && patch({ goal: e.target.value })} /></label>
        <label className="text-[12px] text-muted">Collection target (₹)<input type="number" min={0} className="input mt-1 block w-full" disabled={!editable} defaultValue={c.target || ""} onBlur={(e) => Number(e.target.value) !== c.target && patch({ target: Number(e.target.value) })} /></label>
      </div>
    </Card>
  );
}

// ---------- 2. Data ----------
export function DataStep({ c, plan, editable, patch, ingest, rowsRef }: {
  c: CampaignView; plan: CampaignPlan | null; editable: boolean; patch: Patch;
  ingest: (body: Record<string, unknown>) => Promise<string | null>;
  rowsRef: React.MutableRefObject<{ headers: string[]; rows: string[][] } | null>;
}) {
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  void patch;
  async function read(f: File) {
    setBusy(true); setMsg("");
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
      const grid = (XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" }) as unknown[][]).map((r) => r.map((v) => String(v ?? "").trim()));
      const [headers, ...rows] = grid.filter((r) => r.some(Boolean));
      if (!headers?.length || !rows.length) { setMsg("That file has no rows under a header row."); return; }
      if (rows.length > 20000) { setMsg("Up to 20,000 rows per campaign. Split the file."); return; }
      rowsRef.current = { headers, rows };
      const cols = matchColumns(headers, rows.slice(0, 50));
      const li = cols.findIndex((x) => x.field === "loanId");
      const err = await ingest({ source: "file", fileName: f.name, headers, sample: rows.slice(0, 50), rows: rows.length, loanIds: li >= 0 ? rows.map((r) => r[li]).filter(Boolean) : [] });
      setMsg(err ?? "");
    } catch { setMsg("Couldn't read that file. Use .xlsx, .xls or .csv."); }
    finally { setBusy(false); }
  }
  const sampleHref = `/api/campaigns?allocation=${encodeURIComponent(c.company)}`;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="card p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sunk"><Upload size={17} aria-hidden="true" /></span>
            <div className="min-w-0">
              <h3 className="text-[14.5px] font-semibold">Upload the allocation file</h3>
              <p className="text-[12.5px] text-muted">The file {c.company} sent for this campaign: Excel or CSV, one borrower per row. Columns are read automatically and you confirm them next.</p>
              <input ref={file} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) read(f); e.target.value = ""; }} />
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="btn btn-primary" disabled={!editable || busy} onClick={() => file.current?.click()}><FileSpreadsheet size={14} aria-hidden="true" />{busy ? "Reading…" : "Choose file"}</button>
                <a className="btn btn-ghost" href={sampleHref}><Download size={14} aria-hidden="true" />Sample file for {c.company}</a>
              </div>
            </div>
          </div>
        </section>
        <section className="card p-4">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-sunk"><Sparkles size={17} aria-hidden="true" /></span>
            <div>
              <h3 className="text-[14.5px] font-semibold">Dummy data ingest</h3>
              <p className="text-[12.5px] text-muted">Loads {c.company}&apos;s open accounts from the demo book as if they had arrived in an allocation file, with the columns lenders usually send.</p>
              <button className="btn mt-3" disabled={!editable || busy} onClick={async () => { setBusy(true); rowsRef.current = null; setMsg((await ingest({ source: "demo" })) ?? ""); setBusy(false); }}>Use dummy data</button>
            </div>
          </div>
        </section>
      </div>
      {msg && <p className="text-[12.5px] text-bad" role="alert">{msg}</p>}
      {c.ingest ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Loaded from" value={<span className="text-[16px]">{c.ingest.source === "demo" ? "Dummy data" : "File"}</span>} sub={c.ingest.fileName ?? ""} />
          <Kpi label="Rows" value={num(c.ingest.rows)} sub={`Read ${d(c.ingest.at)}`} />
          <Kpi label="Matched to accounts" value={num(c.ingest.matched)} tone={c.ingest.matched < c.ingest.rows ? "bad" : "good"} sub={c.ingest.matched < c.ingest.rows ? `${num(c.ingest.rows - c.ingest.matched)} loan IDs not in the book` : "Every loan ID found"} />
          <Kpi label="Will be worked" value={plan ? num(plan.accounts) : "…"} sub={plan ? `${num(plan.excluded.disputed)} disputed left out · ${c.ingest.columns.filter((x) => x.field).length} of ${c.ingest.columns.length} columns read` : ""} />
        </div>
      ) : <Card><Empty title="No data yet">Upload {c.company}&apos;s allocation file, or use dummy data to see the whole flow.</Empty></Card>}
    </div>
  );
}

// ---------- 3. Fields ----------
export function FieldsStep({ c, editable, patch, rowsRef }: { c: CampaignView; editable: boolean; patch: Patch; rowsRef: React.MutableRefObject<{ headers: string[]; rows: string[][] } | null> }) {
  const [cols, setCols] = useState<ColumnMatch[]>(c.ingest?.columns.map((x) => ({ ...x, how: x.how === "user" ? "name" : x.how })) ?? []);
  useEffect(() => setCols(c.ingest?.columns.map((x) => ({ ...x, how: x.how === "user" ? "name" : x.how })) ?? []), [c.ingest]);
  if (!c.ingest) return <Card><Empty title="Load the data first">Upload the allocation file or use dummy data in the Data step.</Empty></Card>;
  const missing = missingRequired(cols);
  const used = (key: string) => cols.filter((x) => x.field === key).length;
  async function confirm() {
    const body: Record<string, unknown> = { columns: cols.map((x) => ({ column: x.column, field: x.field })), confirm: true };
    const li = cols.findIndex((x) => x.field === "loanId");
    if (rowsRef.current && li >= 0) body.loanIds = rowsRef.current.rows.map((r) => r[li]).filter(Boolean);
    await patch(body);
  }
  return (
    <Card pad={false} title="Check how the columns were read" sub="Each column is matched by its name, or by what its values look like. Fix anything wrong, then confirm. Risk, segments and languages are worked out from these.">
      <div className="overflow-x-auto">
        <table className="table w-full">
          <thead><tr><th>Column in the file</th><th>Sample values</th><th>Kollect field</th><th>How</th></tr></thead>
          <tbody>
            {cols.map((x, i) => (
              <tr key={x.column}>
                <td className="font-medium">{x.column}</td>
                <td className="max-w-[260px] truncate text-[12.5px] text-muted">{x.sample || "—"}</td>
                <td>
                  <select className="input" disabled={!editable} value={x.field ?? ""} aria-label={`Field for ${x.column}`} onChange={(e) => setCols(cols.map((y, j) => (j === i ? { ...y, field: e.target.value || null, how: "name" } : y)))}>
                    <option value="">Not used</option>
                    {ALLOCATION_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}{f.required ? " *" : ""}</option>)}
                  </select>
                  {x.field && used(x.field) > 1 && <span className="ml-2 text-[11.5px] text-bad">Used twice</span>}
                </td>
                <td className="text-[12.5px]">
                  {x.field ? <span className="inline-flex items-center gap-1 text-good"><CheckCircle2 size={13} aria-hidden="true" />{x.how === "values" ? "From the values" : "From the name"}</span> : <span className="text-muted">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line px-4 py-3">
        {missing.length
          ? <span className="inline-flex items-center gap-1.5 text-[12.5px] text-bad"><AlertTriangle size={14} aria-hidden="true" />Needed: {missing.map((f) => f.label).join(", ")}</span>
          : <span className="text-[12.5px] text-muted">All required fields found. {cols.some((x) => x.field === "language") ? "Language comes from the file." : "No language column: it will be guessed from where each borrower lives."}</span>}
        {editable && <button className="btn btn-primary ml-auto" disabled={missing.length > 0 || cols.some((x) => x.field && used(x.field) > 1)} onClick={confirm}>
          {c.ingest.confirmed ? "Save changes" : "Confirm fields"}</button>}
        {c.ingest.confirmed && <span className="text-[12.5px] text-good">Confirmed</span>}
      </div>
    </Card>
  );
}

// ---------- 4. Risk ----------
export function RiskStep({ c, plan, editable, patch, preview }: { c: CampaignView; plan: CampaignPlan | null; editable: boolean; patch: Patch; preview: (risk: CampaignPlan["rules"]) => void }) {
  const [rules, setRules] = useState(plan?.rules);
  useEffect(() => { if (plan && !rules) setRules(plan.rules); }, [plan, rules]);
  if (!c.ingest?.confirmed) return <Card><Empty title="Confirm the fields first">Risk is worked out from the credit score, days past due, late payments and loans held in the file.</Empty></Card>;
  if (!plan || !rules) return <Loading rows={1} />;
  const set = (k: keyof typeof rules, v: number) => { const next = { ...rules, [k]: v }; setRules(next); preview(next); };
  const changed = JSON.stringify(rules) !== JSON.stringify({ bureauBelow: 650, dpdAbove: 60, lateAtLeast: 3, loansAtLeast: 3, ...(c.risk ?? {}) });
  const total = plan.accounts || 1;
  return (
    <div className="space-y-4">
      <Card title="How risk is decided" sub="From how the borrower behaves, never from the channel. Each account scores points; 4 or more is high risk, 2–3 medium, 0–1 low.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {([
            ["bureauBelow", "Credit score under", "2 points under it, 1 within 70 of it", 500, 800, 10],
            ["dpdAbove", "Days past due over", "2 points over it, 1 over half of it", 15, 180, 5],
            ["lateAtLeast", "Late EMIs in 12 months, at least", "2 points at it, 1 for fewer", 1, 8, 1],
            ["loansAtLeast", "High priority from loans held", "Also: twice the median outstanding", 2, 6, 1],
          ] as const).map(([k, label, hint, lo, hi, step]) => (
            <label key={k} className="rounded-lg border border-line p-3">
              <span className="flex items-baseline justify-between gap-2"><span className="text-[13px] font-medium">{label}</span><span className="text-[18px] font-semibold num">{rules[k]}</span></span>
              <input type="range" className="mt-2 w-full accent-[var(--color-brand)]" min={lo} max={hi} step={step} value={rules[k]} disabled={!editable} onChange={(e) => set(k, Number(e.target.value))} />
              <span className="block text-[11.5px] text-muted">{hint}</span>
            </label>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-muted">A broken promise to pay adds 1 point.</p>
        {editable && changed && <div className="mt-3 flex gap-2"><button className="btn btn-primary" onClick={() => patch({ risk: rules })}>Use these rules</button><button className="btn btn-ghost" onClick={() => { const r = { bureauBelow: 650, dpdAbove: 60, lateAtLeast: 3, loansAtLeast: 3, ...(c.risk ?? {}) }; setRules(r); preview(r); }}>Undo</button></div>}
      </Card>
      <div className="grid gap-3 lg:grid-cols-3">
        {(["High", "Medium", "Low"] as TierKey[]).map((t) => {
          const x = plan.tiers[t];
          return (
            <section key={t} className="card p-4">
              <div className="flex items-baseline justify-between"><h3 className={`text-[15px] font-semibold ${TIER_TONE[t]}`}>{t} risk</h3><span className="text-[12px] text-muted num">{((x.accounts / total) * 100).toFixed(0)}% of accounts</span></div>
              <div className="mt-1 text-[24px] font-semibold num">{num(x.accounts)}</div>
              <div className="text-[12px] text-muted num">{inr(x.outstanding)} outstanding</div>
              <dl className="mt-3 grid grid-cols-2 gap-y-1 text-[12.5px]">
                <dt className="text-muted">Avg credit score</dt><dd className="text-right num">{x.avgBureau || "—"}</dd>
                <dt className="text-muted">Avg days late</dt><dd className="text-right num">{x.avgDpd}</dd>
                <dt className="text-muted">Avg late EMIs (12m)</dt><dd className="text-right num">{x.avgLate}</dd>
                <dt className="text-muted">Broken promises</dt><dd className="text-right num">{num(x.brokenPromises)}</dd>
                <dt className="text-muted">High priority</dt><dd className="text-right num">{num(x.highPriority)}</dd>
              </dl>
            </section>
          );
        })}
      </div>
      <Card pad={false} title="Why accounts landed where they did" sub="A few examples from each tier.">
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead><tr><th>Borrower</th><th>Risk</th><th>Priority</th><th className="text-right">Score</th><th className="text-right">DPD</th><th className="text-right">Late EMIs</th><th className="text-right">Loans</th><th>Reasons</th></tr></thead>
            <tbody>
              {plan.samples.map((s) => (
                <tr key={s.id}>
                  <td><div className="font-medium">{s.name}</div><div className="font-mono text-[11.5px] text-muted">{s.loanId}</div></td>
                  <td className={`font-medium ${TIER_TONE[s.tier]}`}>{s.tier} <span className="text-[11.5px] text-muted">({s.points} pts)</span></td>
                  <td className="text-[12.5px]">{s.priority}</td>
                  <td className="text-right num">{s.bureau}</td><td className="text-right num">{s.dpd}</td><td className="text-right num">{s.latePayments}</td><td className="text-right num">{s.loansHeld}</td>
                  <td className="min-w-[260px] text-[12.5px] text-ink-2">{s.reasons.join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ---------- 5. Segments ----------
export function SegmentsStep({ plan }: { plan: CampaignPlan | null }) {
  if (!plan) return <Loading rows={1} />;
  if (!plan.segments.length) return <Card><Empty title="No accounts to segment">Load data and confirm the fields first.</Empty></Card>;
  const maxB = Math.max(1, ...plan.buckets.map((b) => b.accounts));
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <Card title="DPD buckets in the file" sub="Taken straight from the days past due in the allocation file.">
          <div className="space-y-2">
            {plan.buckets.map((b) => (
              <div key={b.bucket} className="grid grid-cols-[90px_1fr_150px] items-center gap-3 text-[12.5px]">
                <span className="font-medium">{b.label}</span>
                <div className="h-2.5 rounded-full bg-sunk"><div className="h-2.5 rounded-full bg-brand" style={{ width: `${(b.accounts / maxB) * 100}%` }} /></div>
                <span className="text-right text-muted num">{num(b.accounts)} · {inr(b.outstanding)}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Languages" sub={plan.languageSource === "file" ? "From the language column in the file." : "Guessed from each borrower's state and city: the state's language, or English in a metro for card and prime borrowers."}>
          <ul className="space-y-1.5 text-[12.5px]">
            {plan.languages.map((l) => (
              <li key={l.name} className="flex items-center justify-between gap-2">
                <span className="font-medium">{l.name}</span>
                <span className="text-muted num">{num(l.count)} borrowers · {l.speakers ? `${l.speakers} telecaller${l.speakers === 1 ? "" : "s"}` : <span className="text-warn">no telecaller</span>}</span>
              </li>
            ))}
          </ul>
          {plan.languageSource === "location" && <p className="mt-3 text-[12px] text-muted">{plan.languageAgreement}% match the language already on the account. Agents switch language on the call if the borrower asks.</p>}
        </Card>
      </div>
      <Card pad={false} title="Segments" sub="Each DPD bucket split by risk. Every segment gets its own channel mix in the next step.">
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead><tr><th>Segment</th><th className="text-right">Accounts</th><th className="text-right">Outstanding</th><th className="text-right">High priority</th><th className="text-right">Avg score</th><th className="text-right">Avg late EMIs</th><th>Main languages</th></tr></thead>
            <tbody>
              {plan.segments.map((s) => (
                <tr key={s.key}>
                  <td><span className="inline-flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${TIER_BG[s.tier]}`} aria-hidden="true" /><span className="font-medium">{s.bucketLabel}</span><span className={`text-[12.5px] ${TIER_TONE[s.tier]}`}>{s.tier} risk</span></span></td>
                  <td className="text-right num">{num(s.accounts)}</td><td className="text-right num">{inr(s.outstanding)}</td>
                  <td className="text-right num">{num(s.highPriority)}</td><td className="text-right num">{s.avgBureau}</td><td className="text-right num">{s.avgLate}</td>
                  <td className="text-[12.5px] text-ink-2">{s.languages.slice(0, 3).map((l) => `${l.name} ${l.count}`).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ---------- 6. Channels ----------
export function ChannelsStep({ c, plan, data, editable, patch }: { c: CampaignView; plan: CampaignPlan | null; data: PlanData; editable: boolean; patch: Patch }) {
  const [cfg, setCfg] = useState<ChannelConfig>(c.channelConfig ?? {});
  useEffect(() => setCfg(c.channelConfig ?? {}), [c.channelConfig]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  if (!plan) return <Loading rows={1} />;
  if (!c.segments) return <Card><Empty title="Confirm the fields first">Segments come from the data; each one then gets its channels here.</Empty></Card>;
  const seg = c.segments;
  const used = CHANNELS.filter((k) => Object.values(seg).some((l) => l.includes(k)));
  const setSeg = (key: string, k: ChannelKind) => patch({ segments: { ...seg, [key]: CHANNELS.filter((x) => toggle(seg[key] ?? [], k).includes(x)) } });
  const saveCfg = (next: ChannelConfig) => { setCfg(next); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => patch({ channelConfig: next }), 500); };
  const langs = plan.languages.map((l) => l.name);
  // Make sure every used channel has settings to edit.
  const full: ChannelConfig = {
    ...cfg,
    voice: used.includes("voice") ? cfg.voice ?? { slots: ["evening"], concurrency: 100, languages: langs, agents: [] } : undefined,
    ivr: used.includes("ivr") ? cfg.ivr ?? { voice: IVR_VOICES[0], slots: ["morning"] } : undefined,
    whatsapp: used.includes("whatsapp") ? cfg.whatsapp ?? { template: "Payment link", slots: ["afternoon"], reminderHours: 24 } : undefined,
    telecaller: used.includes("telecaller") ? cfg.telecaller ?? { seats: 2, languages: langs.slice(0, 3), priorityFirst: true } : undefined,
  };
  // From the Agent library: the best agents for each DPD bucket that AI voice covers, in the chosen languages.
  const voiceBuckets = [...new Set(plan.segments.filter((x) => (seg[x.key] ?? []).includes("voice")).map((x) => parseSegmentKey(x.key).bucket))];
  const agents = [...new Map(voiceBuckets.flatMap((bucket) => bestAgents({ bucket, languages: full.voice?.languages, limit: 4 })).concat(AGENTS.filter((a) => full.voice?.agents.includes(a.id))).map((a) => [a.id, a])).values()];
  const local = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16);
  const fromLocal = (v: string) => new Date(`${v}:00+05:30`).toISOString();
  return (
    <div className="space-y-4">
      <Card pad={false} title="Channel mix for each segment" sub="Started from what usually works: messages for early and low-risk accounts, calls and people for the late and risky. Change any segment.">
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead><tr><th>Segment</th><th className="text-right">Accounts</th><th>Channels</th><th /></tr></thead>
            <tbody>
              {plan.segments.map((s) => {
                const mine = seg[s.key] ?? [];
                const isSuggested = JSON.stringify(mine) === JSON.stringify(s.suggested);
                return (
                  <tr key={s.key}>
                    <td className="whitespace-nowrap"><span className="font-medium">{s.bucketLabel}</span> <span className={`text-[12.5px] ${TIER_TONE[s.tier]}`}>{s.tier} risk</span>{s.highPriority > 0 && <div className="text-[11.5px] text-muted">{s.highPriority} high priority</div>}</td>
                    <td className="text-right num">{num(s.accounts)}</td>
                    <td><div className="flex flex-wrap gap-1.5">{CHANNELS.map((k) => <Chip key={k} on={mine.includes(k)} disabled={!editable} onClick={() => setSeg(s.key, k)}>{channelTitle(k)}</Chip>)}</div>
                      {!mine.length && <div className="mt-1 text-[11.5px] text-bad">No channel: these accounts won&apos;t be contacted.</div>}</td>
                    <td className="text-right">{!isSuggested && editable && <button className="text-[12px] text-brand hover:underline" onClick={() => patch({ segments: { ...seg, [s.key]: s.suggested } })}>Use suggested</button>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        {full.voice && (
          <Card title="AI voice" sub="When to call, how many at once, in which languages and with which agents.">
            <fieldset disabled={!editable} className="space-y-3">
              <div><div className="label mb-1">Time</div><div className="flex flex-wrap gap-1.5">{SLOTS.map((sl) => <Chip key={sl} on={full.voice!.slots.includes(sl)} onClick={() => saveCfg({ ...full, voice: { ...full.voice!, slots: toggle(full.voice!.slots, sl).length ? toggle(full.voice!.slots, sl) : full.voice!.slots } })}>{SLOT_NAME[sl]} {SLOT_TIME[sl]}</Chip>)}</div></div>
              <label className="block text-[12px] text-muted">Calls at once (each line carries 100)<input type="number" min={1} max={1000} className="input mt-1 block w-32" value={full.voice.concurrency} onChange={(e) => saveCfg({ ...full, voice: { ...full.voice!, concurrency: Number(e.target.value) } })} /></label>
              <div><div className="label mb-1">Languages</div><div className="flex flex-wrap gap-1.5">{langs.map((l) => <Chip key={l} on={full.voice!.languages.includes(l)} onClick={() => saveCfg({ ...full, voice: { ...full.voice!, languages: toggle(full.voice!.languages, l) } })}>{l}</Chip>)}</div></div>
              <div><div className="label mb-1">Agents, best first</div>
                <div className="flex flex-wrap gap-1.5">{agents.map((a) => <Chip key={a.id} on={full.voice!.agents.includes(a.id)} onClick={() => saveCfg({ ...full, voice: { ...full.voice!, agents: toggle(full.voice!.agents, a.id) } })}><b>{a.name}</b> · {a.stage ? STAGE_LABEL[a.stage]?.split(" · ")[0] ?? a.stage : ""} · {a.personaTone} <span className="text-muted">{a.performance?.qcScore ? `QC ${a.performance.qcScore}%` : a.rating ? `★ ${a.rating}` : ""}</span></Chip>)}</div>
                {!agents.length && <p className="text-[12px] text-muted">No library agents for these stages and languages yet.</p>}
                <p className="mt-1 text-[11.5px] text-muted">From the Agent library, matched to each segment&apos;s DPD stage and the languages above.</p></div>
              <label className="block text-[12px] text-muted">Prompt the agents speak from
                <select className="input mt-1 block w-full" value={c.promptId ?? ""} onChange={(e) => patch({ promptId: e.target.value })}>
                  <option value="">Choose a published prompt</option>
                  {data.prompts.map((p) => <option key={p.id} value={p.id}>{p.client} · {p.product} · {TONES.find((t) => t.key === p.tone)?.label} · v{p.version}</option>)}
                </select>
              </label>
              <p className="text-[12px] text-muted">Prompts are built in <Link href="/prompts" className="text-brand hover:underline">Agent Studio</Link>.</p>
            </fieldset>
          </Card>
        )}
        {full.ivr && (
          <Card title="IVR" sub="A recorded reminder with keypad options: 1 to get a payment link, 2 to talk to someone.">
            <fieldset disabled={!editable} className="space-y-3">
              <div><div className="label mb-1">Voice</div><div className="flex flex-wrap gap-1.5">{IVR_VOICES.map((v) => <Chip key={v} on={full.ivr!.voice === v} onClick={() => saveCfg({ ...full, ivr: { ...full.ivr!, voice: v } })}>{v}</Chip>)}</div></div>
              <div><div className="label mb-1">Time</div><div className="flex flex-wrap gap-1.5">{SLOTS.map((sl) => <Chip key={sl} on={full.ivr!.slots.includes(sl)} onClick={() => saveCfg({ ...full, ivr: { ...full.ivr!, slots: toggle(full.ivr!.slots, sl).length ? toggle(full.ivr!.slots, sl) : full.ivr!.slots } })}>{SLOT_NAME[sl]} {SLOT_TIME[sl]}</Chip>)}</div></div>
            </fieldset>
          </Card>
        )}
        {full.whatsapp && (
          <Card title="WhatsApp" sub="Approved templates only, to borrowers who opted in.">
            <fieldset disabled={!editable} className="space-y-3">
              <div><div className="label mb-1">Template</div><div className="flex flex-wrap gap-1.5">{data.templates.map((t) => <Chip key={t} on={full.whatsapp!.template === t} onClick={() => saveCfg({ ...full, whatsapp: { ...full.whatsapp!, template: t } })}>{t}</Chip>)}</div></div>
              <div><div className="label mb-1">Time</div><div className="flex flex-wrap gap-1.5">{SLOTS.map((sl) => <Chip key={sl} on={full.whatsapp!.slots.includes(sl)} onClick={() => saveCfg({ ...full, whatsapp: { ...full.whatsapp!, slots: toggle(full.whatsapp!.slots, sl).length ? toggle(full.whatsapp!.slots, sl) : full.whatsapp!.slots } })}>{SLOT_NAME[sl]} {SLOT_TIME[sl]}</Chip>)}</div></div>
              <label className="block text-[12px] text-muted">Wait before the next channel (hours)<input type="number" min={1} max={168} className="input mt-1 block w-32" value={full.whatsapp.reminderHours} onChange={(e) => saveCfg({ ...full, whatsapp: { ...full.whatsapp!, reminderHours: Number(e.target.value) } })} /></label>
            </fieldset>
          </Card>
        )}
        {full.telecaller && (
          <Card title="Telecallers" sub="How many people, and which languages they need to speak.">
            <fieldset disabled={!editable} className="space-y-3">
              <label className="block text-[12px] text-muted">Telecallers on this campaign<input type="number" min={1} max={50} className="input mt-1 block w-32" value={full.telecaller.seats} onChange={(e) => saveCfg({ ...full, telecaller: { ...full.telecaller!, seats: Number(e.target.value) } })} /></label>
              <div><div className="label mb-1">Languages</div><div className="flex flex-wrap gap-1.5">{langs.map((l) => { const n = TEAM.filter((t) => t.languages.includes(l)).length; return <Chip key={l} on={full.telecaller!.languages.includes(l)} onClick={() => saveCfg({ ...full, telecaller: { ...full.telecaller!, languages: toggle(full.telecaller!.languages, l) } })}>{l} <span className="text-muted">· {n} on the team</span></Chip>; })}</div></div>
              <label className="flex items-start gap-2 text-[13px]"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]" checked={full.telecaller.priorityFirst} onChange={(e) => saveCfg({ ...full, telecaller: { ...full.telecaller!, priorityFirst: e.target.checked } })} />
                <span>High-priority accounts go to telecallers first<span className="block text-[12px] text-muted">{num(plan.highPriority)} accounts hold several loans or a large balance.</span></span></label>
            </fieldset>
          </Card>
        )}
      </div>

      <Card title="Schedule" sub="Every channel only runs inside the calling window and the daily cap per borrower.">
        <fieldset disabled={!editable} className="grid max-w-3xl gap-4 sm:grid-cols-3">
          <label className="text-[12px] text-muted">Start (IST)<input type="datetime-local" className="input mt-1 block w-full" value={local(c.startAt)} onChange={(e) => e.target.value && patch({ startAt: fromLocal(e.target.value) })} /></label>
          <label className="text-[12px] text-muted">End (IST)<input type="datetime-local" className="input mt-1 block w-full" value={local(c.endAt)} onChange={(e) => e.target.value && patch({ endAt: fromLocal(e.target.value) })} /></label>
          <label className="text-[12px] text-muted">Attempts per borrower per day<input type="number" min={1} max={20} className="input mt-1 block w-full" defaultValue={c.dailyCap} onBlur={(e) => Number(e.target.value) !== c.dailyCap && patch({ dailyCap: Number(e.target.value) })} /></label>
          <label className="flex items-start gap-2 text-[13px] sm:col-span-3"><input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]" checked={c.salaryWeekBoost} onChange={(e) => patch({ salaryWeekBoost: e.target.checked })} />
            <span>Salary-week boost<span className="block text-[12px] text-muted">Send more on days 1–7, when most borrowers pay.</span></span></label>
        </fieldset>
      </Card>
    </div>
  );
}

// ---------- 8. Review ----------
export function ReviewStep({ c, plan, data, check, onCheck }: {
  c: CampaignView; plan: CampaignPlan | null; data: PlanData;
  check: { errors: string[]; warnings: string[] } | null; onCheck: () => void;
}) {
  useEffect(() => { onCheck(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!plan) return <Loading rows={1} />;
  const cfg = c.channelConfig ?? {};
  const prompt = data.prompts.find((p) => p.id === c.promptId);
  const sampleFor = (tier: TierKey) => plan.samples.find((s) => s.tier === tier) ?? plan.samples[0];
  const used = CHANNELS.filter((k) => Object.values(c.segments ?? {}).some((l) => l.includes(k)));
  const reach = (k: ChannelKind) => plan.segments.filter((s) => (c.segments?.[s.key] ?? []).includes(k)).reduce((n, s) => n + s.accounts, 0);
  const when = (k: ChannelKind) => k === "voice" ? cfg.voice?.slots : k === "ivr" ? cfg.ivr?.slots : k === "whatsapp" ? cfg.whatsapp?.slots : undefined;
  const firstMessage = (k: ChannelKind, tier: TierKey) => {
    const s = sampleFor(tier);
    if (!s) return "";
    const first = s.name.split(" ")[0], amt = `₹${Math.round(s.outstanding * 0.08).toLocaleString("en-IN")}`;
    if (k === "whatsapp") return renderMessage((cfg.whatsapp?.template ?? "Payment link") as TemplateName, s.language, { first, product: s.product, amt, link: `pay.kollect.in/${s.loanId.slice(-6)}`, dpd: s.dpd, lender: c.company }).text;
    if (k === "voice") return `“Hello ${first}, I'm an AI assistant calling on behalf of ${c.company}, and this call is recorded. It's about your ${s.product} account, ${s.dpd} days overdue with ${amt} due. Can you make the payment today?”`;
    if (k === "ivr") return `“Namaste. This is a reminder from ${c.company}: your ${s.product} payment of ${amt} is overdue. Press 1 to get a payment link on WhatsApp, press 2 to speak to us.”`;
    return `Telecaller sees the AI summary first: ${s.reasons.join(" · ")}. They confirm the amount and agree a date.`;
  };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Who" value={num(plan.accounts)} sub={`${plan.segments.length} segments · ${inr(plan.outstanding)}`} />
        <Kpi label="Target" value={c.target ? inr(c.target) : "—"} sub={c.target && plan.outstanding ? `${((c.target / plan.outstanding) * 100).toFixed(1)}% of outstanding` : "Set it in Company"} />
        <Kpi label="When" value={<span className="text-[17px]">{d(c.startAt)} – {d(c.endAt)}</span>} sub={`${c.dailyCap} attempts a day max${c.salaryWeekBoost ? " · salary-week boost" : ""}`} />
        <Kpi label="How" value={`${used.length} channel${used.length === 1 ? "" : "s"}`} sub={<span>{used.map(channelTitle).join(", ")}{prompt ? ` · ${prompt.client} prompt v${prompt.version}` : used.includes("voice") ? " · no prompt chosen" : ""}</span>} />
      </div>
      <Card pad={false} title="Each channel" sub="Who it reaches, when, and the first thing they hear or read.">
        <div className="divide-y divide-line">
          {used.map((k) => (
            <div key={k} className="grid gap-3 px-4 py-3 lg:grid-cols-[200px_1fr]">
              <div>
                <div className="text-[14px] font-semibold">{channelTitle(k)}</div>
                <div className="text-[12px] text-muted num">{num(reach(k))} accounts</div>
                <div className="text-[12px] text-muted">{when(k)?.map((s) => `${SLOT_NAME[s]} ${SLOT_TIME[s]}`).join(", ") ?? (k === "telecaller" ? `${cfg.telecaller?.seats ?? 0} telecallers · ${(cfg.telecaller?.languages ?? []).join(", ")}` : "")}</div>
                {k === "voice" && <div className="text-[12px] text-muted">{cfg.voice?.concurrency} at once · {cfg.voice?.agents.length ?? 0} agents</div>}
                {k === "ivr" && <div className="text-[12px] text-muted">{cfg.ivr?.voice}</div>}
              </div>
              <div className="space-y-2">
                {(["High", "Low"] as TierKey[]).filter((t) => plan.segments.some((s) => s.tier === t && (c.segments?.[s.key] ?? []).includes(k))).map((t) => (
                  <div key={t} className="rounded-md bg-sunk px-3 py-2 text-[12.5px]">
                    <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">First message · {t.toLowerCase()} risk · {sampleFor(t)?.language}</div>
                    {firstMessage(k, t)}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {!used.length && <Empty title="No channels yet">Choose channels for the segments in Channels.</Empty>}
        </div>
      </Card>
      <Card title="Checks" sub="Every step, integration and the audience are checked against the compliance rules before anything goes out." right={<button className="btn" onClick={onCheck}>Run checks again</button>}>
        {!check ? <p className="text-[13px] text-muted">Checking…</p> : (
          <div className="space-y-3">
            {check.errors.length
              ? <ul className="space-y-1.5">{check.errors.map((e) => <li key={e} className="rounded-md border border-bad/30 bg-bad-soft px-3 py-2 text-[12.5px] text-bad">{e}</li>)}</ul>
              : <p className="rounded-md border border-good/30 bg-good-soft px-3 py-2 text-[12.5px] text-good">No blocking issues.</p>}
            <ul className="space-y-1.5">{check.warnings.map((w) => <li key={w} className="rounded-md bg-sunk px-3 py-2 text-[12.5px] text-ink-2">{w}</li>)}</ul>
          </div>
        )}
      </Card>
    </div>
  );
}
