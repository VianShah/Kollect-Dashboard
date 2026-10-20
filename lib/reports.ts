// Campaign report: one row per campaign run (a campaign code on one day), worked out from the calls it made.
import { istDay } from "./time";
import type { Call, Channel, Store } from "./types";

export interface RunRow {
  id: string;            // code|day
  code: string;
  product: string;
  portfolio: string;     // the company, or "Several" when a run served more than one
  channel: Channel;
  language: string;
  day: string;           // IST yyyy-mm-dd
  start: string;         // first call (ISO)
  end: string;           // last call ends (ISO)
  calls: number;
  connected: number;
  promises: number;
  paid: number;
  talkMinutes: number;
  peak: number;          // most calls live at the same moment
  concurrency: number;   // concurrency set on the campaign
  outcomes: Record<string, number>;
  hours: number[];       // calls started in each IST hour, 8 to 18
}

/** The most calls that overlapped at any moment, from each call's start and duration. */
function peakOf(calls: Call[]) {
  const edges: [number, number][] = [];
  for (const c of calls) { const t = Date.parse(c.ts); edges.push([t, 1], [t + Math.max(1, c.durationSec) * 1000, -1]); }
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let live = 0, peak = 0;
  for (const [, d] of edges) { live += d; if (live > peak) peak = live; }
  return peak;
}

export function campaignRuns(s: Store, calls: Call[]): RunRow[] {
  const groups = new Map<string, Call[]>();
  for (const c of calls) {
    const k = `${c.campaign}|${istDay(c.ts)}`;
    const g = groups.get(k);
    if (g) g.push(c); else groups.set(k, [c]);
  }
  const agents = new Map(s.agents.map((a) => [a.code, a]));
  return [...groups.entries()].map(([id, cs]) => {
    cs.sort((a, b) => a.ts.localeCompare(b.ts));
    const first = cs[0], last = cs.reduce((m, c) => Math.max(m, Date.parse(c.ts) + c.durationSec * 1000), 0);
    const outcomes: Record<string, number> = {};
    const hours = Array.from({ length: 11 }, () => 0);
    for (const c of cs) {
      outcomes[c.classification] = (outcomes[c.classification] ?? 0) + 1;
      const h = Number(new Date(Date.parse(c.ts) + 330 * 60_000).getUTCHours());
      if (h >= 8 && h <= 18) hours[h - 8]++;
    }
    const portfolios = new Set(cs.map((c) => c.portfolio));
    const agent = agents.get(first.campaign);
    return {
      id, code: first.campaign, product: first.product, portfolio: portfolios.size === 1 ? first.portfolio : "Several",
      channel: first.channel, language: agent?.language ?? first.language ?? "—", day: istDay(first.ts),
      start: first.ts, end: new Date(last).toISOString(),
      calls: cs.length, connected: cs.filter((c) => c.connected).length,
      promises: outcomes.PTP ?? 0, paid: (outcomes.Paid ?? 0) + (outcomes.Partial ?? 0),
      talkMinutes: Math.round(cs.reduce((n, c) => n + c.durationSec, 0) / 60),
      peak: peakOf(cs), concurrency: agent?.max ?? 0, outcomes, hours,
    };
  }).sort((a, b) => b.start.localeCompare(a.start));
}
