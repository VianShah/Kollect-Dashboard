"use client";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useApp } from "@/components/ctx";
import { post, useApi } from "@/components/useApi";
import { localStore } from "@/components/local";
import { Badge, Card, ErrorNote, Kpi, Loading, Offline } from "@/components/ui";
import { computeFollowUps } from "@/lib/metrics";
import { can } from "@/lib/roles";
import { istDay } from "@/lib/time";
import { time } from "@/lib/format";
import type { FollowUp } from "@/lib/types";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function shiftMonth(m: string, by: number) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export default function FollowUps() {
  const { qs, filters, scope, user, openBorrower, bump } = useApp();
  const today = istDay(Date.now());
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState(today);
  const { data, setData, offline, error } = useApi(`/api/followups?month=${month}&${qs}`, () => computeFollowUps(localStore(), filters, scope, month));

  const byDay = useMemo(() => {
    const m = new Map<string, FollowUp[]>();
    for (const f of data?.items ?? []) { const k = istDay(f.at); m.set(k, [...(m.get(k) ?? []), f]); }
    return m;
  }, [data]);

  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading rows={1} />;

  const [y, mo] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, mo - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first grid
  const daysIn = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const cells = Array.from({ length: Math.ceil((lead + daysIn) / 7) * 7 }, (_, i) => {
    const n = i - lead + 1;
    return n >= 1 && n <= daysIn ? `${month}-${String(n).padStart(2, "0")}` : null;
  });
  const agenda = (byDay.get(day) ?? []).sort((a, b) => a.at.localeCompare(b.at));
  const canEdit = can(user.role, "followup");

  async function setStatus(f: FollowUp, status: FollowUp["status"]) {
    setData((cur) => cur && { ...cur, items: cur.items.map((x) => (x.id === f.id ? { ...x, status } : x)) });
    const r = await post("/api/followups", { id: f.id, status });
    if (r.ok) bump();
  }

  return (
    <>
      <Offline show={offline} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Kpi label={`Scheduled in ${MONTHS[mo - 1]}`} value={data.counts.scheduled} sub="Still to be made" />
        <Kpi label="Completed" value={data.counts.done} tone="good" sub="Call-backs made on time" />
        <Kpi label="Missed" value={data.counts.missed} tone={data.counts.missed ? "bad" : undefined} sub="Time passed with no call" />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card pad={false}
          title={`${MONTHS[mo - 1]} ${y}`}
          sub="Call-backs borrowers asked for, in IST"
          right={
            <div className="flex items-center gap-1">
              <button className="btn btn-ghost h-9 w-9 px-0" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft size={16} /></button>
              <button className="btn" onClick={() => { setMonth(today.slice(0, 7)); setDay(today); }}>Today</button>
              <button className="btn btn-ghost h-9 w-9 px-0" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight size={16} /></button>
            </div>
          }>
          <div className="grid grid-cols-7 border-t border-line text-[11px] font-semibold uppercase tracking-[0.05em] text-muted">
            {WEEKDAYS.map((w) => <div key={w} className="px-2 py-2">{w}</div>)}
          </div>
          <div className="grid grid-cols-7 border-t border-line">
            {cells.map((c, i) => {
              if (!c) return <div key={i} className="min-h-[92px] border-b border-r border-line bg-sunk/40" />;
              const list = byDay.get(c) ?? [];
              const sched = list.filter((x) => x.status === "Scheduled").length;
              const missed = list.filter((x) => x.status === "Missed").length;
              const done = list.filter((x) => x.status === "Done").length;
              const selected = c === day;
              return (
                <button key={c} onClick={() => setDay(c)} aria-pressed={selected} aria-label={`${Number(c.slice(8))} ${MONTHS[mo - 1]}: ${list.length} follow-ups`}
                  className={`min-h-[92px] border-b border-r border-line p-1.5 text-left align-top transition-colors ${selected ? "bg-brand-soft" : "hover:bg-sunk/50"}`}>
                  <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[12px] num ${c === today ? "bg-ink font-semibold text-white" : "text-ink-2"}`}>{Number(c.slice(8))}</span>
                  <span className="mt-1 flex flex-col gap-0.5">
                    {sched > 0 && <span className="rounded bg-info-soft px-1 text-[11px] font-medium text-info num">{sched} scheduled</span>}
                    {missed > 0 && <span className="rounded bg-bad-soft px-1 text-[11px] font-medium text-bad num">{missed} missed</span>}
                    {done > 0 && <span className="px-1 text-[11px] text-muted num">{done} done</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </Card>

        <Card pad={false} title={new Date(`${day}T12:00:00+05:30`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" })}
          sub={`${agenda.length} follow-up${agenda.length === 1 ? "" : "s"}`}>
          <ul className="max-h-[620px] overflow-y-auto">
            {agenda.length === 0 && <li className="px-4 pb-8 pt-2 text-[13px] text-muted">Nothing booked for this day.</li>}
            {agenda.map((f) => (
              <li key={f.id} className="border-t border-line px-4 py-3">
                <div className="flex items-start gap-3">
                  <span className="w-11 shrink-0 font-mono text-[13px] num">{time(f.at)}</span>
                  <div className="min-w-0 flex-1">
                    <button className="text-left text-[13.5px] font-medium hover:text-brand hover:underline" onClick={() => openBorrower(f.borrowerId)}>{f.name}</button>
                    <div className="text-[12px] text-muted">{f.product} · asked via {f.requestedVia}</div>
                    <p className="mt-1 text-[13px] text-ink-2">“{f.note}”</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge>{f.status}</Badge>
                      {canEdit && f.status !== "Done" && <button className="btn min-h-7 px-2 text-[12px]" onClick={() => setStatus(f, "Done")}>Mark done</button>}
                      {canEdit && f.status === "Scheduled" && Date.parse(f.at) < Date.now() && <button className="btn min-h-7 px-2 text-[12px]" onClick={() => setStatus(f, "Missed")}>Mark missed</button>}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {data.upcoming.length > 0 && (
            <div className="border-t border-line bg-sunk/40 px-4 py-3">
              <div className="label mb-1.5">Coming up next</div>
              <ul className="space-y-1">
                {data.upcoming.slice(0, 5).map((f) => (
                  <li key={f.id}><button className="flex w-full gap-2 text-left text-[12.5px] hover:text-brand" onClick={() => openBorrower(f.borrowerId)}>
                    <span className="w-24 shrink-0 text-muted num">{new Date(f.at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })} {time(f.at)}</span>
                    <span className="truncate">{f.name}</span>
                  </button></li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
