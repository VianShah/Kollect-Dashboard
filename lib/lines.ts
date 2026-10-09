import type { Agent, Channel, CommChannel, Store } from "./types";

export const SESSIONS_PER_LINE = 100;

export interface CommChannelDef { key: CommChannel; use: string; unit: "line" | "seat"; perLine: number; agentChannel?: Channel; maxLines: number }

/** Automated channels run on lines of 100 concurrent sessions. Telecallers are people, so each seat holds one call. */
export const COMM_CHANNELS: CommChannelDef[] = [
  { key: "Voice agents", use: "AI voice calls in the borrower's language: reminders, promises to pay, call-backs", unit: "line", perLine: SESSIONS_PER_LINE, agentChannel: "AI Voice", maxLines: 50 },
  { key: "IVR", use: "Recorded reminder calls with keypad options, such as press 1 to get a payment link", unit: "line", perLine: SESSIONS_PER_LINE, maxLines: 50 },
  { key: "WhatsApp", use: "Bot conversations, payment links and reminders, only to borrowers who opted in", unit: "line", perLine: SESSIONS_PER_LINE, agentChannel: "WhatsApp", maxLines: 50 },
  { key: "SMS", use: "Reminders and payment links by text", unit: "line", perLine: SESSIONS_PER_LINE, maxLines: 50 },
  { key: "Telecallers", use: "People on the human desk for escalations, disputes and hardship cases", unit: "seat", perLine: 1, agentChannel: "Human Desk", maxLines: 25 },
];

export const DEFAULT_LINES: Record<CommChannel, number> = { "Voice agents": 4, IVR: 2, WhatsApp: 3, SMS: 2, Telecallers: 6 };

export const defOf = (key: CommChannel) => COMM_CHANNELS.find((c) => c.key === key)!;
export const capacityOf = (s: Store, key: CommChannel) => s.lines[key].lines * defOf(key).perLine;
const agentsOf = (s: Store, key: CommChannel) => { const ch = defOf(key).agentChannel; return ch ? s.agents.filter((a) => a.channel === ch) : []; };

/** Live sessions on a channel: the sum of its campaigns, or its own counter for channels without campaigns (IVR, SMS). */
export const liveOf = (s: Store, key: CommChannel) => (defOf(key).agentChannel ? agentsOf(s, key).reduce((n, a) => n + a.live, 0) : s.lines[key].live);

/** Splits a channel's capacity evenly across its campaigns so their limits always add up to what the lines can carry. */
export function rebalance(s: Store, key?: CommChannel) {
  for (const def of key ? [defOf(key)] : COMM_CHANNELS) {
    const list: Agent[] = agentsOf(s, def.key);
    if (!list.length) continue;
    const cap = capacityOf(s, def.key);
    const base = Math.floor(cap / list.length);
    let extra = cap - base * list.length;
    for (const a of list) { a.max = base + (extra-- > 0 ? 1 : 0); a.live = Math.min(a.live, a.max); }
  }
}

/** Demo only: moves live counts toward a busy-but-not-full level during calling hours, and to zero outside them. */
export function drift(s: Store, open: boolean) {
  for (const a of s.agents) {
    if (!open) { a.live = 0; continue; }
    const target = a.max * 0.6;
    a.live = Math.max(0, Math.min(a.max, Math.round(a.live + (target - a.live) * 0.25 + (Math.random() - 0.5) * Math.max(1, a.max * 0.1))));
  }
  for (const def of COMM_CHANNELS) {
    if (def.agentChannel) continue;
    const row = s.lines[def.key];
    const cap = row.lines * def.perLine;
    row.live = !open ? 0 : Math.max(0, Math.min(cap, Math.round(row.live + (cap * 0.55 - row.live) * 0.25 + (Math.random() - 0.5) * cap * 0.08)));
  }
}

export function channelRows(s: Store) {
  return COMM_CHANNELS.map((def) => ({
    key: def.key, use: def.use, unit: def.unit, perLine: def.perLine, maxLines: def.maxLines,
    lines: s.lines[def.key].lines, capacity: capacityOf(s, def.key), live: liveOf(s, def.key), campaigns: agentsOf(s, def.key).length,
  }));
}
