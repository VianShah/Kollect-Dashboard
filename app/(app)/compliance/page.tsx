"use client";
import { useEffect, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/components/ctx";
import { post, useApi } from "@/components/useApi";
import { localStore } from "@/components/local";
import { C, Card, Empty, ErrorNote, Kpi, Loading, Offline, Pager, Tabs, axisProps, tooltipStyle } from "@/components/ui";
import { RULE_NAMES, computeCompliance, type RuleName } from "@/lib/metrics";
import { LEGAL_WINDOW } from "@/lib/contact";
import { ROLE_LABEL, can } from "@/lib/roles";
import { dt, num, shortDay } from "@/lib/format";
import type { AuditEntry, ComplianceRules } from "@/lib/types";

const RULES = RULE_NAMES;
const ACTION_LABEL: Record<string, string> = {
  pii_reveal: "Revealed phone number", send_payment_link: "Sent payment link", escalate: "Escalated", escalation_file: "Downloaded escalation file",
  call_hide_client: "Hid call from client", call_show_client: "Showed call to client", capacity_agent: "Changed agent capacity", capacity_global: "Recalculated capacity",
  compliance_rules: "Changed compliance rules", data_upload: "Uploaded data", data_reset: "Reset data", demo_scenario: "Switched demo lender",
  demo_reset: "Reset demo", demo_live_traffic: "Toggled live traffic", followup_create: "Scheduled follow-up", followup_status: "Updated follow-up",
  login: "Signed in", login_failed: "Failed sign-in", contact_blocked: "Blocked a contact", languages_changed: "Changed languages",
  grievance_create: "Logged a complaint", grievance_status: "Updated a complaint", grievance_officer: "Changed grievance officer", ingest: "Dialler feed received",
};

export default function Compliance() {
  const { qs, filters, scope, user } = useApp();
  const tabs = (can(user.role, "viewAudit") ? ["Overview", "Flags", "Audit trail", "Rules"] : ["Overview", "Flags", "Rules"]) as readonly string[];
  const [tab, setTab] = useState("Overview");
  const { data, offline, error, reload } = useApi(`/api/compliance?${qs}`, () => computeCompliance(localStore(), filters, scope));
  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading />;

  return (
    <>
      <Offline show={offline} />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === "Overview" && <Overview data={data} onOpenFlags={() => setTab("Flags")} />}
      {tab === "Flags" && <Flags data={data} />}
      {tab === "Audit trail" && <AuditTrail />}
      {tab === "Rules" && <RulesForm rules={data.rules} editable={can(user.role, "editCompliance") && !offline} onSaved={reload} />}
    </>
  );
}

type Data = ReturnType<typeof computeCompliance>;

function Overview({ data, onOpenFlags }: { data: Data; onOpenFlags: () => void }) {
  const r = data.rules;
  const desc: Record<RuleName, string> = {
    "Calling window": `Calls or messages outside ${r.windowStart}:00–${r.windowEnd}:00 IST`,
    "Daily cap": `Borrower-days with more than ${r.maxPerDay} attempts`,
    "Weekly cap": `Borrowers over ${r.maxPerWeek} attempts in any 7 days`,
    "Do-not-call": `Calls to the ${data.dndBorrowers} borrowers who asked not to be called`,
    "WhatsApp consent": `Messages to ${data.noConsent} borrowers without opt-in`,
    Disclosure: "Connected calls where the AI and recording notice was not played",
  };
  const breaches = (rule: RuleName) => (data.counts[rule] ? `${num(data.counts[rule])} breach${data.counts[rule] === 1 ? "" : "es"} in this period` : "No breaches in this period");
  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        <Kpi label="Compliance score" value={`${data.score.toFixed(2)}%`} tone={data.score >= 98 ? "good" : data.score < 95 ? "bad" : undefined} sub={`${num(data.checks)} contacts checked`} />
        {RULES.map((rule) => (
          <button key={rule} onClick={onOpenFlags} className="card p-4 text-left transition-colors hover:border-line-strong hover:bg-[#fcfbf9]">
            <div className="label">{rule}</div>
            <div className={`mt-2 text-[26px] font-semibold leading-none num ${data.counts[rule] ? "text-bad" : "text-good"}`}>{num(data.counts[rule])}</div>
            <div className="mt-2 text-[12px] text-muted">{desc[rule]}</div>
          </button>
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Flags per day" sub="Every contact is checked against the active rules">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.daily} margin={{ left: -16 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="date" tickFormatter={shortDay} {...axisProps} minTickGap={20} />
              <YAxis allowDecimals={false} {...axisProps} />
              <Tooltip {...tooltipStyle} labelFormatter={(l) => shortDay(String(l))} cursor={{ fill: "#f1eee8" }} />
              <Bar dataKey="flags" name="Flags" fill={C.bad} radius={[2, 2, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card title="Active guardrails">
          <dl className="divide-y divide-line text-[13px]">
            {[
              ["Calling window", `${r.windowStart}:00 – ${r.windowEnd}:00 IST (legal limit ${LEGAL_WINDOW.start}:00–${LEGAL_WINDOW.end}:00)`],
              ["Attempts per borrower", `${r.maxPerDay} a day · ${r.maxPerWeek} in any 7 days`],
              ["Do-not-call requests", `Always enforced · ${breaches("Do-not-call")}`],
              ["WhatsApp opt-in", `Always required · ${breaches("WhatsApp consent")}`],
              ["Disputed accounts", "Automated outreach paused until resolved"],
              ["Phone numbers", "Masked; reveals need a listed reason, are limited per hour and logged"],
              ["Client visibility", "QA can hide calls from client view"],
              ["Open complaints", `${data.grievances.open} open · ${data.grievances.overdue} past the 30-day deadline`],
            ].map(([k, v]) => <div key={k} className="flex justify-between gap-4 py-2"><dt className="text-muted">{k}</dt><dd className="text-right font-medium">{v}</dd></div>)}
          </dl>
          {data.languageGaps.length > 0 && (
            <p className="mt-3 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
              {num(data.languageGaps.reduce((s, g) => s + g.count, 0))} borrowers speak a language that isn&apos;t switched on ({data.languageGaps.map((g) => `${g.language} ${g.count}`).join(", ")}). They are contacted in English until it is enabled on the Channels page.
            </p>
          )}
        </Card>
      </div>
    </>
  );
}

function Flags({ data }: { data: Data }) {
  const { openBorrower } = useApp();
  const [rule, setRule] = useState<RuleName | "all">("all");
  const [page, setPage] = useState(0);
  const rows = useMemo(() => data.violations.filter((v) => rule === "all" || v.rule === rule), [data, rule]);
  useEffect(() => setPage(0), [rule]);
  const PAGE = 25, pages = Math.max(1, Math.ceil(rows.length / PAGE));
  return (
    <Card pad={false} title="Flagged contacts" sub="Newest first" right={
      <select aria-label="Rule" className="input" value={rule} onChange={(e) => setRule(e.target.value as RuleName | "all")}>
        <option value="all">All rules</option>{RULES.map((r) => <option key={r}>{r}</option>)}
      </select>}>
      <div className="overflow-x-auto">
        <table className="table w-full whitespace-nowrap">
          <thead><tr><th>When</th><th>Rule</th><th>Borrower</th><th>Loan ID</th><th>Campaign</th><th>Detail</th></tr></thead>
          <tbody>{rows.slice(page * PAGE, page * PAGE + PAGE).map((v, i) => (
            <tr key={i}>
              <td className="num">{dt(v.ts)}</td>
              <td><span className="rounded bg-bad-soft px-1.5 py-0.5 text-[11.5px] font-medium text-bad">{v.rule}</span></td>
              <td><button className="font-medium hover:text-brand hover:underline" onClick={() => openBorrower(v.borrowerId)}>{v.name}</button></td>
              <td className="font-mono text-[12.5px]">{v.loanId}</td><td className="font-mono text-[12px] text-muted">{v.campaign}</td><td className="text-ink-2">{v.detail}</td>
            </tr>
          ))}</tbody>
        </table>
        {!rows.length && <Empty title="No flags in this period">Every contact in range passed the active rules.</Empty>}
      </div>
      <Pager page={page} pages={pages} setPage={setPage} total={rows.length} />
    </Card>
  );
}

function AuditTrail() {
  const { data, error } = useApi<{ entries: AuditEntry[]; total?: number; intact?: boolean }>("/api/audit-log", () => ({ entries: [] }));
  const [action, setAction] = useState("all");
  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading rows={1} />;
  const rows = data.entries.filter((e) => action === "all" || e.action === action);
  const actions = [...new Set(data.entries.map((e) => e.action))];
  function exportCsv() {
    const lines = rows.map((e) => [e.ts, e.user, e.role, ACTION_LABEL[e.action] ?? e.action, e.target, e.detail].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const url = URL.createObjectURL(new Blob([["Time,User,Role,Action,Target,Detail", ...lines].join("\n")], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "kollect-audit-trail.csv" }).click();
    URL.revokeObjectURL(url);
  }
  return (
    <Card pad={false} title="Audit trail"
      sub={<>Every sign-in, phone reveal, blocked contact, outreach action and settings change, with who did it.{" "}
        {data.intact === undefined ? null : data.intact
          ? <span className="font-medium text-good">Integrity check passed ({num(data.total ?? 0)} entries).</span>
          : <span className="font-medium text-bad">Integrity check failed: an entry was changed or removed.</span>}</>}
      right={<div className="flex gap-2">
        <select aria-label="Action" className="input" value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="all">All actions</option>{actions.map((a) => <option key={a} value={a}>{ACTION_LABEL[a] ?? a}</option>)}
        </select>
        <button className="btn" onClick={exportCsv}><Download size={14} aria-hidden="true" />CSV</button>
      </div>}>
      <div className="overflow-x-auto">
        <table className="table w-full">
          <thead><tr><th>When</th><th>User</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
          <tbody>{rows.slice(0, 200).map((e) => (
            <tr key={e.id}>
              <td className="whitespace-nowrap num">{dt(e.ts)}</td>
              <td className="whitespace-nowrap"><span className="font-medium">{e.user}</span> <span className="text-muted">· {ROLE_LABEL[e.role]}</span></td>
              <td className={`whitespace-nowrap ${e.action === "pii_reveal" ? "font-medium text-warn" : ""}`}>{ACTION_LABEL[e.action] ?? e.action}</td>
              <td className="font-mono text-[12.5px]">{e.target}</td><td className="text-ink-2">{e.detail}</td>
            </tr>
          ))}</tbody>
        </table>
        {!rows.length && <Empty title="Nothing logged yet">Reveal a phone number, send a link or change a setting and it will be recorded here.</Empty>}
      </div>
    </Card>
  );
}

function RulesForm({ rules, editable, onSaved }: { rules: ComplianceRules; editable: boolean; onSaved: () => void }) {
  const [form, setForm] = useState(rules);
  const [msg, setMsg] = useState("");
  useEffect(() => setForm(rules), [rules]);
  const hours = Array.from({ length: LEGAL_WINDOW.end - LEGAL_WINDOW.start + 1 }, (_, i) => LEGAL_WINDOW.start + i);
  const set = <K extends keyof ComplianceRules>(k: K, v: ComplianceRules[K]) => setForm({ ...form, [k]: v });
  return (
    <Card title="Contact rules" sub={editable ? `You can narrow the calling window but not widen it beyond ${LEGAL_WINDOW.start}:00–${LEGAL_WINDOW.end}:00 IST. Changes apply immediately and are written to the audit trail.` : "Only a Super Admin can change these."}>
      <form className="grid max-w-2xl gap-5 sm:grid-cols-2" onSubmit={async (e) => {
        e.preventDefault();
        const r = await post("/api/compliance", form, "PATCH");
        setMsg(r.ok ? "Saved." : r.json.error ?? "Couldn't save.");
        if (r.ok) onSaved();
      }}>
        <fieldset disabled={!editable} className="contents">
          <label className="text-[13px] font-medium">Calls allowed from
            <select className="input mt-1 block w-full" value={form.windowStart} onChange={(e) => set("windowStart", Number(e.target.value))}>{hours.slice(0, -1).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select>
          </label>
          <label className="text-[13px] font-medium">Calls allowed until
            <select className="input mt-1 block w-full" value={form.windowEnd} onChange={(e) => set("windowEnd", Number(e.target.value))}>{hours.slice(1).map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}</select>
          </label>
          <label className="text-[13px] font-medium">Max attempts per borrower per day
            <input type="number" min={1} max={20} className="input mt-1 block w-full" value={form.maxPerDay} onChange={(e) => set("maxPerDay", Number(e.target.value))} />
          </label>
          <label className="text-[13px] font-medium">Max attempts per borrower per week
            <input type="number" min={1} max={100} className="input mt-1 block w-full" value={form.maxPerWeek} onChange={(e) => set("maxPerWeek", Number(e.target.value))} />
          </label>
          <p className="rounded-md bg-sunk px-3 py-2 text-[12.5px] text-ink-2 sm:col-span-2">
            Always on, and not editable: borrowers who asked not to be called are never called, WhatsApp needs a recorded opt-in, and disputed accounts are paused.
          </p>
          {editable && <div className="flex items-center gap-3 sm:col-span-2"><button className="btn btn-primary">Save rules</button>{msg && <span className="text-[13px] text-muted" role="status">{msg}</span>}</div>}
        </fieldset>
      </form>
    </Card>
  );
}
