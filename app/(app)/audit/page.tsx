"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff, X } from "lucide-react";
import { useApp } from "@/components/ctx";
import { useApi } from "@/components/useApi";
import { localStore } from "@/components/local";
import { Badge, Card, Empty, ErrorNote, Loading, Offline, Pager } from "@/components/ui";
import { scoped } from "@/lib/metrics";
import { can } from "@/lib/roles";
import { dt, dur } from "@/lib/format";
import type { Call } from "@/lib/types";

export default function AuditPage() {
  return <Suspense fallback={<Loading rows={1} />}><Audit /></Suspense>;
}

function Audit() {
  const { qs, filters, scope, user, openBorrower } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const { data, setData, offline, error } = useApi<{ calls: Call[]; total: number }>(`/api/calls?${qs}`, () => {
    const calls = scoped(localStore(), filters, scope).calls;
    return { calls: calls.slice(0, 2000), total: calls.length };
  });
  const [campaign, setCampaign] = useState("all");
  const [disp, setDisp] = useState(params.get("classification") ?? "all");
  const [drop, setDrop] = useState(params.get("drop") ?? "all");
  const [minDur, setMinDur] = useState("");
  const [hiddenOnly, setHiddenOnly] = useState(false);
  const [page, setPage] = useState(0);
  const canHide = can(user.role, "hideCall");

  useEffect(() => { setDisp(params.get("classification") ?? "all"); setDrop(params.get("drop") ?? "all"); }, [params]);
  useEffect(() => setPage(0), [campaign, disp, drop, minDur, hiddenOnly]);

  const campaigns = useMemo(() => [...new Set((data?.calls ?? []).map((c) => c.campaign))].sort(), [data]);
  const drops = useMemo(() => [...new Set((data?.calls ?? []).map((c) => c.dropReason).filter(Boolean))] as string[], [data]);
  const rows = useMemo(() => (data?.calls ?? []).filter((c) =>
    (campaign === "all" || c.campaign === campaign) && (disp === "all" || c.classification === disp) && (drop === "all" || c.dropReason === drop) &&
    (!minDur || c.durationSec >= Number(minDur)) && (!hiddenOnly || !c.visible)), [data, campaign, disp, drop, minDur, hiddenOnly]);

  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading rows={1} />;
  const PAGE = 25, pages = Math.max(1, Math.ceil(rows.length / PAGE));

  async function toggle(c: Call) {
    const visible = !c.visible;
    setData((cur) => cur && { ...cur, calls: cur.calls.map((x) => (x.id === c.id ? { ...x, visible } : x)) });
    try { await fetch("/api/calls", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, visible }) }); } catch { /* kept locally */ }
  }
  const drilled = params.get("classification") || params.get("drop");

  return (
    <>
      <Offline show={offline} />
      {drilled && (
        <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[13px]">
          <span className="label">Showing</span><span className="font-medium">{params.get("classification") ? `${params.get("classification")} calls` : `Calls dropped: ${params.get("drop")?.replace(/_/g, " ")}`}</span>
          <button className="btn btn-ghost ml-auto min-h-7 px-2" onClick={() => router.replace("/audit")}><X size={14} aria-hidden="true" />Clear</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Campaign" className="input" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
          <option value="all">All campaigns</option>{campaigns.map((c) => <option key={c}>{c}</option>)}
        </select>
        <select aria-label="Classification" className="input" value={disp} onChange={(e) => setDisp(e.target.value)}>
          <option value="all">All classifications</option>
          {["Paid", "PTP", "Partial", "Callback", "Dispute", "No Contact", "Escalated"].map((x) => <option key={x}>{x}</option>)}
        </select>
        <select aria-label="Drop-off reason" className="input" value={drop} onChange={(e) => setDrop(e.target.value)}>
          <option value="all">Any drop-off</option>{drops.map((x) => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}
        </select>
        <label className="sr-only" htmlFor="mind">Minimum duration in seconds</label>
        <input id="mind" className="input w-40" type="number" min={0} placeholder="Min duration (s)" value={minDur} onChange={(e) => setMinDur(e.target.value)} />
        {user.role !== "client" && <label className="flex items-center gap-1.5 text-[13px]"><input type="checkbox" className="h-4 w-4 accent-[var(--color-brand)]" checked={hiddenOnly} onChange={(e) => setHiddenOnly(e.target.checked)} />Hidden from client only</label>}
      </div>
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="table w-full whitespace-nowrap">
            <thead><tr><th>Date / time (IST)</th><th>Phone</th><th>Loan ID</th><th>Call ID</th><th>Campaign</th><th className="text-right">Duration</th><th>Classification</th><th>Drop-off</th><th>Client view</th></tr></thead>
            <tbody>
              {rows.slice(page * PAGE, page * PAGE + PAGE).map((c) => (
                <tr key={c.id} className="hover:bg-sunk/40">
                  <td className="num">{dt(c.ts)}</td>
                  <td className="font-mono text-[12px] text-muted">{c.phone}</td>
                  <td><button className="font-mono text-[12.5px] hover:text-brand hover:underline" onClick={() => openBorrower(c.loanId)}>{c.loanId}</button></td>
                  <td className="font-mono text-[12px]">{c.callId}</td>
                  <td className="font-mono text-[12px] text-ink-2">{c.campaign}</td>
                  <td className="text-right num">{dur(c.durationSec)}</td>
                  <td><Badge>{c.classification}</Badge></td>
                  <td className="text-[12.5px] text-muted">{c.dropReason?.replace(/_/g, " ") ?? "—"}</td>
                  <td>
                    {canHide
                      ? <button onClick={() => toggle(c)} className="inline-flex items-center gap-1.5" aria-label={c.visible ? "Hide from client" : "Show to client"}>
                          <Badge>{c.visible ? "Visible" : "Hidden"}</Badge>{c.visible ? <EyeOff size={13} className="text-muted" aria-hidden="true" /> : <Eye size={13} className="text-muted" aria-hidden="true" />}
                        </button>
                      : <Badge>{c.visible ? "Visible" : "Hidden"}</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!rows.length && <Empty title="No calls match">Widen the date range or clear a filter.</Empty>}
        </div>
        <Pager page={page} pages={pages} setPage={setPage} total={rows.length} />
      </Card>
      {data.total > data.calls.length && <p className="text-[12px] text-muted">Showing the latest {data.calls.length.toLocaleString("en-IN")} of {data.total.toLocaleString("en-IN")} calls in range. Narrow the date range to see older ones.</p>}
    </>
  );
}
