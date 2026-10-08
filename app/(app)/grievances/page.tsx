"use client";
import { useMemo, useState } from "react";
import { useApp } from "@/components/ctx";
import { post, useApi } from "@/components/useApi";
import { Badge, Card, Empty, ErrorNote, Kpi, Loading, Pager } from "@/components/ui";
import { can } from "@/lib/roles";
import { dt, d, num } from "@/lib/format";
import type { Grievance, GrievanceOfficer, GrievanceStatus } from "@/lib/types";

type Item = Grievance & { overdue: boolean };
interface Data {
  items: Item[]; gro: GrievanceOfficer; categories: string[]; slaDays: number; canEditOfficer: boolean;
  counts: { open: number; inProgress: number; resolved: number; overdue: number };
}

export default function Grievances() {
  const { user, openBorrower } = useApp();
  const { data, error, reload } = useApi<Data>("/api/grievances", () => ({
    items: [], gro: { name: "", email: "", phone: "" }, categories: [], slaDays: 30, canEditOfficer: false, counts: { open: 0, inProgress: 0, resolved: 0, overdue: 0 },
  }));
  const [status, setStatus] = useState<"all" | GrievanceStatus | "overdue">("all");
  const [page, setPage] = useState(0);
  const [closing, setClosing] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const canAct = can(user.role, "grievance");

  const rows = useMemo(() => (data?.items ?? []).filter((g) => status === "all" || (status === "overdue" ? g.overdue : g.status === status)), [data, status]);
  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading rows={1} />;
  const PAGE = 15, pages = Math.max(1, Math.ceil(rows.length / PAGE));

  async function update(id: string, next: GrievanceStatus, resolution?: string) {
    const r = await post("/api/grievances", { id, status: next, resolution }, "PATCH");
    setMsg(r.ok ? "Updated." : r.json.error ?? "Couldn't update.");
    if (r.ok) { setClosing(null); reload(); }
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Open" value={num(data.counts.open)} sub="Not started" />
        <Kpi label="In progress" value={num(data.counts.inProgress)} sub="Being worked on" />
        <Kpi label="Resolved" value={num(data.counts.resolved)} tone="good" sub="Closed with a resolution" />
        <Kpi label={`Past ${data.slaDays}-day deadline`} value={num(data.counts.overdue)} tone={data.counts.overdue ? "bad" : "good"} sub="Still unresolved" />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card pad={false} title="Complaints" sub={`Every complaint must be resolved within ${data.slaDays} days. Log new ones from a borrower's profile.`}
          right={
            <select aria-label="Status" className="input" value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(0); }}>
              <option value="all">All complaints</option><option value="Open">Open</option><option value="In progress">In progress</option>
              <option value="Resolved">Resolved</option><option value="overdue">Past deadline</option>
            </select>}>
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead><tr><th>Raised</th><th>Borrower</th><th>Category</th><th>Detail</th><th>Due</th><th>Status</th>{canAct && <th>Action</th>}</tr></thead>
              <tbody>
                {rows.slice(page * PAGE, page * PAGE + PAGE).map((g) => (
                  <tr key={g.id}>
                    <td className="whitespace-nowrap num">{dt(g.raisedAt)}</td>
                    <td className="whitespace-nowrap">
                      <button className="font-medium hover:text-brand hover:underline" onClick={() => openBorrower(g.borrowerId)}>{g.name}</button>
                      <div className="font-mono text-[11.5px] text-muted">{g.loanId}</div>
                    </td>
                    <td className="text-[12.5px]">{g.category}</td>
                    <td className="max-w-[280px] text-[12.5px] text-ink-2">
                      {g.detail}
                      {g.resolution && <div className="mt-1 text-muted">Resolved: {g.resolution}</div>}
                    </td>
                    <td className={`whitespace-nowrap num ${g.overdue ? "font-medium text-bad" : ""}`}>{d(g.dueAt)}{g.overdue ? " · overdue" : ""}</td>
                    <td><Badge>{g.status}</Badge></td>
                    {canAct && (
                      <td className="whitespace-nowrap">
                        {g.status === "Open" && <button className="btn min-h-8" onClick={() => update(g.id, "In progress")}>Start</button>}
                        {g.status === "In progress" && closing !== g.id && <button className="btn min-h-8" onClick={() => setClosing(g.id)}>Resolve</button>}
                        {g.status === "In progress" && closing === g.id && (
                          <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); update(g.id, "Resolved", String(new FormData(e.currentTarget).get("resolution") ?? "")); }}>
                            <input name="resolution" className="input w-44" placeholder="How was it resolved?" required minLength={5} />
                            <button className="btn btn-primary min-h-8">Close</button>
                          </form>
                        )}
                        {g.status === "Resolved" && <button className="btn btn-ghost min-h-8" onClick={() => update(g.id, "In progress")}>Reopen</button>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && <Empty title="No complaints here">Nothing matches this filter.</Empty>}
          </div>
          <Pager page={page} pages={pages} setPage={setPage} total={rows.length} />
          {msg && <p className="px-4 pb-3 text-[12.5px] text-muted" role="status">{msg}</p>}
        </Card>

        <OfficerCard gro={data.gro} editable={data.canEditOfficer} onSaved={reload} />
      </div>
    </>
  );
}

function OfficerCard({ gro, editable, onSaved }: { gro: GrievanceOfficer; editable: boolean; onSaved: () => void }) {
  const [form, setForm] = useState(gro);
  const [msg, setMsg] = useState("");
  return (
    <Card title="Grievance Redressal Officer" sub="Borrowers can escalate here if a complaint isn't resolved. Share these details in every borrower message and on request.">
      <form className="space-y-3" onSubmit={async (e) => {
        e.preventDefault();
        const r = await post("/api/grievances", { gro: form }, "PATCH");
        setMsg(r.ok ? "Saved." : r.json.error ?? "Couldn't save.");
        if (r.ok) onSaved();
      }}>
        <fieldset disabled={!editable} className="space-y-3">
          {([["name", "Name"], ["email", "Email"], ["phone", "Phone"]] as const).map(([k, label]) => (
            <label key={k} className="block text-[12px] text-muted">{label}
              <input className="input mt-1 block w-full" value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
        </fieldset>
        {editable ? <div className="flex items-center gap-3"><button className="btn btn-primary">Save</button>{msg && <span className="text-[13px] text-muted" role="status">{msg}</span>}</div>
          : <p className="text-[12px] text-muted">Only a Super Admin can change these details.</p>}
      </form>
    </Card>
  );
}
