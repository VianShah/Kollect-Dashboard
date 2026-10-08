"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, X } from "lucide-react";
import { useApp } from "@/components/ctx";
import { useApi } from "@/components/useApi";
import { localStore } from "@/components/local";
import { Badge, Card, Empty, ErrorNote, Loading, Offline, Pager } from "@/components/ui";
import { publicBorrower, scoped } from "@/lib/metrics";
import { bucketOf } from "@/lib/mock";
import { d, inrFull } from "@/lib/format";
import type { Borrower, Bucket } from "@/lib/types";

const SEGMENTS = ["All", "Pre Due", "Post Due (0–30)", "Post Due (30–90)", "Post Due (90+)"];
const DISPOSITIONS = ["Paid", "PTP", "Partial", "Callback", "Dispute", "No Contact", "Escalated"];
const STAGES = ["Assigned", "Contacted", "Engaged", "PTP", "Recovered"];
const BUCKETS: Bucket[] = ["Current", "1–30", "31–60", "61–90", "90+"];
const tier = (s: number) => (s >= 750 ? "Prime" : s >= 650 ? "Near-prime" : "Subprime");

/** Drill-down filters arrive as URL params from KPI cards, funnels, charts and the roll-rate matrix. */
function drill(params: URLSearchParams) {
  const parts: string[] = [];
  const tests: ((b: Borrower) => boolean)[] = [];
  const disp = params.get("disposition");
  if (disp) { parts.push(disp === "Paid" ? "Paid" : disp); tests.push((b) => b.disposition === disp); }
  const link = params.get("link");
  if (link === "shared") { parts.push("Payment link shared"); tests.push((b) => b.paymentLink !== "Not shared"); }
  const ptp = params.get("ptp");
  if (ptp) { parts.push(`Promises ${ptp}`); tests.push((b) => b.ptpOutcome === ptp); }
  const stage = params.get("stage");
  if (stage && Number(stage) > 0) { parts.push(`Reached ${STAGES[Number(stage)]}`); tests.push((b) => b.stage >= Number(stage)); }
  const prev = params.get("prev"), bucket = params.get("bucket");
  if (prev && bucket) { parts.push(`${prev} last month → ${bucket} now`); tests.push((b) => b.prevBucket === prev && bucketOf(b.dpd) === bucket); }
  const roll = params.get("roll");
  const idx = (x?: Bucket) => (x ? BUCKETS.indexOf(x) : -1);
  if (roll === "cured") { parts.push("Cured since last month"); tests.push((b) => !!b.prevBucket && idx(bucketOf(b.dpd)) < idx(b.prevBucket)); }
  if (roll === "forward") { parts.push("Rolled forward since last month"); tests.push((b) => !!b.prevBucket && idx(bucketOf(b.dpd)) > idx(b.prevBucket)); }
  const sort = params.get("sort");
  if (sort === "dpd") parts.push("Sorted by DPD");
  if (sort === "outstanding") parts.push("Sorted by outstanding");
  return { label: parts.join(" · "), test: (b: Borrower) => tests.every((t) => t(b)), sort, segment: params.get("segment") };
}

export default function BorrowersPage() {
  return <Suspense fallback={<Loading />}><Borrowers /></Suspense>;
}

function Borrowers() {
  const { qs, filters, scope, openBorrower } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const dr = useMemo(() => drill(new URLSearchParams(params.toString())), [params]);
  const { data, offline, error } = useApi<{ borrowers: Borrower[] }>(`/api/borrowers?${qs}`, () => ({ borrowers: scoped(localStore(), filters, scope).borrowers.map(publicBorrower) }));
  const [seg, setSeg] = useState(dr.segment ?? "All");
  const [q, setQ] = useState("");
  const [disp, setDisp] = useState("all");
  const [lang, setLang] = useState("all");
  const [page, setPage] = useState(0);

  useEffect(() => { const open = params.get("open"); if (open) openBorrower(open); }, [params, openBorrower]);
  useEffect(() => setPage(0), [params, seg, q, disp, lang]);

  const languages = useMemo(() => [...new Set((data?.borrowers ?? []).map((b) => b.language))].sort(), [data]);
  const rows = useMemo(() => {
    const list = (data?.borrowers ?? []).filter((b) =>
      dr.test(b) && (seg === "All" || b.segment === seg) && (disp === "all" || b.disposition === disp) && (lang === "all" || b.language === lang) &&
      (!q || `${b.name} ${b.loanId} ${b.id}`.toLowerCase().includes(q.toLowerCase())));
    if (dr.sort === "dpd") list.sort((a, b) => b.dpd - a.dpd);
    else if (dr.sort === "outstanding") list.sort((a, b) => b.outstanding - a.outstanding);
    return list;
  }, [data, dr, seg, disp, q, lang]);

  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading rows={1} />;
  const PAGE = 25, pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice(page * PAGE, page * PAGE + PAGE);

  function exportCsv() {
    const head = ["Name", "Phone", "LoanID", "Product", "Portfolio", "Segment", "Language", "EMI", "Outstanding", "DPD", "Disposition", "PaymentLink", "Experian", "Channel", "PTPDate", "PTPAmount"];
    const safe = (v: unknown) => { const s = String(v); return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; }; // stops spreadsheets running text as a formula
    const lines = rows.map((b) => [b.name, b.phone, b.loanId, b.product, b.portfolio, b.segment, b.language, b.emi, b.outstanding, b.dpd, b.disposition, b.paymentLink, b.experian, b.channel, b.ptpDate?.slice(0, 10) ?? "", b.ptpAmount ?? ""]
      .map((v) => `"${safe(v).replace(/"/g, '""')}"`).join(","));
    const url = URL.createObjectURL(new Blob(["﻿" + [head.join(","), ...lines].join("\n")], { type: "text/csv" }));
    Object.assign(document.createElement("a"), { href: url, download: "borrowers.csv" }).click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <Offline show={offline} />
      {dr.label && (
        <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-[13px]">
          <span className="label">Showing</span><span className="font-medium">{dr.label}</span>
          <button className="btn btn-ghost ml-auto min-h-7 px-2" onClick={() => router.replace("/borrowers")}><X size={14} aria-hidden="true" />Clear</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg" role="group" aria-label="Segment">
          {SEGMENTS.map((s) => <button key={s} aria-pressed={seg === s} onClick={() => setSeg(s)}>{s}</button>)}
        </div>
        <label className="sr-only" htmlFor="bq">Search</label>
        <input id="bq" className="input w-64" placeholder="Search name or loan ID" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Disposition" className="input" value={disp} onChange={(e) => setDisp(e.target.value)}>
          <option value="all">All dispositions</option>
          {DISPOSITIONS.map((x) => <option key={x}>{x}</option>)}
        </select>
        <select aria-label="Language" className="input" value={lang} onChange={(e) => setLang(e.target.value)}>
          <option value="all">All languages</option>
          {languages.map((x) => <option key={x}>{x}</option>)}
        </select>
        <button className="btn ml-auto" onClick={exportCsv}><Download size={14} aria-hidden="true" />Export CSV</button>
      </div>
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="table w-full whitespace-nowrap">
            <thead><tr><th>Borrower</th><th>Loan ID</th><th>Product</th><th>Segment</th><th>Language</th><th className="text-right">EMI</th><th className="text-right">Outstanding</th><th className="text-right">DPD</th><th>Disposition</th><th>Payment link</th><th>Experian</th><th>Channel</th><th>PTP</th></tr></thead>
            <tbody>
              {view.map((b) => (
                <tr key={b.id} className="cursor-pointer hover:bg-sunk/40" onClick={() => openBorrower(b.id)}>
                  <td>
                    <button className="text-left font-medium hover:text-brand hover:underline" onClick={(e) => { e.stopPropagation(); openBorrower(b.id); }}>{b.name}</button>
                    <div className="font-mono text-[11.5px] text-muted">{b.phone}</div>
                  </td>
                  <td className="font-mono text-[12.5px]">{b.loanId}</td>
                  <td>{b.product}</td>
                  <td className="text-[12.5px] text-ink-2">{b.segment}</td>
                  <td className="text-[12.5px]">{b.language}</td>
                  <td className="text-right num">{inrFull(b.emi)}</td><td className="text-right num">{inrFull(b.outstanding)}</td><td className="text-right num">{b.dpd}</td>
                  <td><Badge>{b.disposition}</Badge></td><td><Badge>{b.paymentLink}</Badge></td>
                  <td className="num">{b.experian} <Badge>{tier(b.experian)}</Badge></td>
                  <td>{b.channel}</td>
                  <td className="num">{b.ptpDate ? `${d(b.ptpDate)} · ${inrFull(b.ptpAmount ?? 0)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!view.length && <Empty title="No borrowers match">Try clearing the drill-down or widening the filters above.</Empty>}
        </div>
        <Pager page={page} pages={pages} setPage={setPage} total={rows.length} />
      </Card>
    </>
  );
}
