"use client";
import { useRef, useState } from "react";
import { Download, RotateCcw, Upload } from "lucide-react";
import { useApp } from "@/components/ctx";
import { Card } from "@/components/ui";

interface Report { sheet: string; rows: number; imported: number; errors: string[] }

const SHEETS: [string, string, string][] = [
  ["Borrowers", "LoanID, Outstanding", "Name, Phone, Product, Segment, Portfolio, Region, Language, EMI, DPD, PrevDPD, Disposition, PaymentLink, ExperianScore, Channel, DoNotCall, WhatsAppConsent, PTPDate, PTPAmount, RecoveredAmount, RecoveredAt"],
  ["Calls", "Timestamp, Campaign", "LoanID, CallID, Product, Portfolio, Channel, DurationSec, Disposition, DropReason, AttemptNo, Visible"],
  ["Messages", "Timestamp, LoanID", "Channel (WhatsApp, SMS, Email), Template, Status, Text"],
  ["FollowUps", "LoanID, FollowUpAt", "Timestamp, Channel, Note, Status"],
  ["Agents", "Code", "AgentName, Product, Language, Voice, Channel, Live, Max"],
];

export default function DataPage() {
  const { refreshMeta, bump } = useApp();
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [report, setReport] = useState<Report[]>([]);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const f = ref.current?.files?.[0];
    if (!f) return setMsg("Choose an .xlsx file first.");
    setBusy(true); setMsg("");
    const fd = new FormData(); fd.append("file", f);
    const res = await fetch("/api/upload", { method: "POST", body: fd }).catch(() => null);
    setBusy(false);
    if (!res) return setMsg("The server isn't responding.");
    const body = await res.json();
    if (!res.ok) return setMsg(body.error ?? "Upload failed.");
    setReport(body.report);
    setMsg(body.applied ? "Imported. Every module now reads from this file." : "Nothing was imported. See the report below.");
    await refreshMeta(); bump();
  }
  async function reset() {
    await fetch("/api/reset", { method: "POST" });
    setReport([]); setMsg("Back on demo data.");
    await refreshMeta(); bump();
  }

  return (
    <>
      <Card title="Import from Excel" sub="Each sheet you include replaces that dataset. Headers are matched loosely, so “Loan No” or “Loan ID” both work.">
        <form className="flex flex-wrap items-center gap-2" onSubmit={upload}>
          <label className="sr-only" htmlFor="file">Workbook</label>
          <input id="file" ref={ref} type="file" accept=".xlsx,.xls" className="text-[13px] file:mr-3 file:rounded-md file:border file:border-line-strong file:bg-surface file:px-3 file:py-1.5 file:text-[13px]" />
          <button className="btn btn-primary" disabled={busy}><Upload size={14} aria-hidden="true" />{busy ? "Importing…" : "Import"}</button>
          <a className="btn" href="/api/template"><Download size={14} aria-hidden="true" />Template</a>
          <button type="button" className="btn btn-ghost" onClick={reset}><RotateCcw size={14} aria-hidden="true" />Back to demo data</button>
        </form>
        {msg && <p className="mt-3 text-[13px] font-medium" role="status">{msg}</p>}
        {report.length > 0 && (
          <table className="table mt-3 w-full">
            <thead><tr><th>Sheet</th><th className="text-right">Rows</th><th className="text-right">Imported</th><th>Issues</th></tr></thead>
            <tbody>{report.map((r) => (
              <tr key={r.sheet}><td className="font-medium">{r.sheet}</td><td className="text-right num">{r.rows}</td><td className="text-right num">{r.imported}</td><td className="text-[12px] text-bad">{r.errors.join("; ") || "—"}</td></tr>
            ))}</tbody>
          </table>
        )}
      </Card>
      <Card title="What the workbook can hold" pad={false}>
        <table className="table w-full">
          <thead><tr><th>Sheet</th><th>Required</th><th>Optional</th></tr></thead>
          <tbody>{SHEETS.map(([s, req, opt]) => <tr key={s}><td className="font-medium">{s}</td><td className="whitespace-nowrap">{req}</td><td className="text-[12.5px] text-muted">{opt}</td></tr>)}</tbody>
        </table>
      </Card>
      <Card title="Push live events from your dialer" sub="Calls and live capacity can be sent as they happen. They raise the same notifications as demo traffic.">
        <pre className="overflow-x-auto rounded-md bg-night p-4 font-mono text-[12px] leading-relaxed text-[#d7e0db]">{`POST /api/ingest/events
x-api-key: <INGEST_KEY>

{
  "calls":  [{ "callId": "c_9f2k", "ts": "2026-10-03T10:15:00Z", "campaign": "KOLLECT_PL_PD30_VOICE_HI",
               "loanId": "LN2024000123", "channel": "AI Voice", "durationSec": 120, "classification": "PTP" }],
  "agents": [{ "code": "KOLLECT_PL_PD30_VOICE_HI", "live": 2, "max": 3 }]
}`}</pre>
      </Card>
    </>
  );
}
