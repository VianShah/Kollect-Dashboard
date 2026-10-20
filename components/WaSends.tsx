"use client";
import { useState } from "react";
import { Download, Pause, Play, RotateCcw, Square } from "lucide-react";
import { post } from "@/components/useApi";
import { Card, Empty } from "@/components/ui";

export interface JobView {
  id: string; createdAt: string; by: string; template: string; language: string; source: string; state: "running" | "paused" | "waiting" | "done" | "cancelled";
  note?: string; waitingUntil?: string; total: number; sent: number; failed: number; skipped: number; queued: number;
  items: { label: string; to: string; loanId?: string; status: string; error?: string; at?: string }[];
}

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const STATE: Record<JobView["state"], { label: string; cls: string }> = {
  running: { label: "Sending", cls: "bg-info-soft text-info" }, waiting: { label: "Waiting", cls: "bg-warn-soft text-warn" }, paused: { label: "Paused", cls: "bg-warn-soft text-warn" },
  done: { label: "Done", cls: "bg-good-soft text-good" }, cancelled: { label: "Cancelled", cls: "bg-sunk text-ink-2" },
};

export default function WaSends({ jobs, onChange }: { jobs: JobView[]; onChange: (view: unknown) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  async function control(jobId: string, op: string) {
    setMsg("");
    const r = await post("/api/whatsapp", { action: "jobControl", jobId, op });
    if (r.ok) onChange(r.json); else setMsg(r.json.error ?? "That didn't work.");
  }
  function report(j: JobView) {
    const head = ["Name", "Number", "Loan ID", "Status", "Reason", "Time"];
    const lines = j.items.map((i) => [i.label, i.to, i.loanId ?? "", i.status, i.error ?? "", when(i.at)].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const url = URL.createObjectURL(new Blob(["﻿" + [head.join(","), ...lines].join("\n")], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: `whatsapp-${j.template}-${j.id}.csv` }).click();
    URL.revokeObjectURL(url);
  }
  return (
    <Card pad={false} title="Sends" sub="Every send to more than one person, worked through in the background. Delivery and read status show in Chats once Meta reports them.">
      {!jobs.length ? <Empty title="No sends yet">Sends you start from “Send a template” appear here with live progress.</Empty> : (
        <ul className="divide-y divide-line">
          {jobs.map((j) => {
            const done = j.sent + j.failed + j.skipped;
            const pct = j.total ? (done / j.total) * 100 : 0;
            return (
              <li key={j.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-[11.5px] font-medium ${STATE[j.state].cls}`}>{STATE[j.state].label}</span>
                  <span className="font-mono text-[12.5px]">{j.template} · {j.language}</span>
                  <span className="text-[12px] text-muted">{j.source} · {j.by} · {when(j.createdAt)}</span>
                  <span className="ml-auto flex gap-1.5">
                    {(j.state === "running" || j.state === "waiting") && <button className="btn min-h-7 px-2 text-[12px]" onClick={() => control(j.id, "pause")}><Pause size={12} aria-hidden="true" />Pause</button>}
                    {j.state === "paused" && <button className="btn min-h-7 px-2 text-[12px]" onClick={() => control(j.id, "resume")}><Play size={12} aria-hidden="true" />Resume</button>}
                    {j.failed > 0 && j.state !== "running" && <button className="btn min-h-7 px-2 text-[12px]" onClick={() => control(j.id, "retryFailed")}><RotateCcw size={12} aria-hidden="true" />Retry {j.failed} failed</button>}
                    {j.state !== "done" && j.state !== "cancelled" && <button className="btn min-h-7 px-2 text-[12px]" onClick={() => window.confirm("Cancel this send? Messages already sent stay sent.") && control(j.id, "cancel")}><Square size={12} aria-hidden="true" />Cancel</button>}
                    {j.items.length > 0 && <button className="btn min-h-7 px-2 text-[12px]" onClick={() => report(j)}><Download size={12} aria-hidden="true" />Report</button>}
                  </span>
                </div>
                <div className="mt-2 h-2 rounded-full bg-sunk">
                  <div className="flex h-2 overflow-hidden rounded-full" style={{ width: `${pct}%` }}>
                    <div className="bg-brand" style={{ flex: j.sent }} /><div className="bg-bad" style={{ flex: j.failed }} /><div className="bg-[#c9c4b9]" style={{ flex: j.skipped }} />
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap gap-3 text-[12px] text-muted num">
                  <span>{j.total} total</span><span className="text-good">{j.sent} sent</span>{j.failed > 0 && <span className="text-bad">{j.failed} failed</span>}
                  {j.skipped > 0 && <span>{j.skipped} skipped</span>}{j.queued > 0 && <span>{j.queued} to go</span>}
                  {(j.failed > 0 || j.skipped > 0) && j.items.length > 0 && <button className="text-brand hover:underline" onClick={() => setOpen(open === j.id ? null : j.id)}>{open === j.id ? "Hide" : "Show"} who and why</button>}
                </div>
                {j.note && <p className="mt-1 text-[12px] text-warn">{j.note}{j.waitingUntil ? ` (around ${when(j.waitingUntil)})` : ""}</p>}
                {open === j.id && (
                  <ul className="mt-2 max-h-60 space-y-0.5 overflow-y-auto rounded-md border border-line p-2 text-[12px]">
                    {j.items.filter((i) => i.status === "failed" || i.status === "skipped").map((i, k) => (
                      <li key={k} className="flex justify-between gap-3"><span>{i.label} <span className="text-muted">{i.to}{i.loanId ? ` · ${i.loanId}` : ""}</span></span><span className={i.status === "failed" ? "text-bad" : "text-muted"}>{i.error}</span></li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {msg && <p className="px-4 pb-3 text-[12.5px] text-bad" role="alert">{msg}</p>}
    </Card>
  );
}
