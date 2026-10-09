// Server-only in-memory store, persisted to data/store.json (swap for a database later).
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DAY, istMidnight } from "./time";
import { ESCALATION_REASONS, FOLLOWUP_NOTES, STORE_VERSION, campaignsFor, connectChance, followupSlot, generateStore, pickCampaign } from "./mock";
import { canContact, clampRules, windowOpen } from "./contact";
import { rebalance } from "./lines";
import type { AuditEntry, Disposition, LiveEvent, Role, ScenarioKey, Store } from "./types";

const FILE = path.join(process.cwd(), "data", "store.json");
const g = globalThis as unknown as { __kollect?: Store; __kollectSaved?: number };

export function getStore(): Store {
  if (g.__kollect) return g.__kollect;
  try {
    if (fs.existsSync(FILE)) {
      const s = JSON.parse(fs.readFileSync(FILE, "utf8")) as Store;
      if (s.v === STORE_VERSION) { s.compliance = clampRules(s.compliance); g.__kollect = s; }
    }
  } catch { /* fall through to mock */ }
  return (g.__kollect ??= generateStore());
}

/** Persist. `throttle` is for high-frequency simulator writes: at most one disk write every 30s. */
export function saveStore(s: Store, opts: { throttle?: boolean } = {}) {
  s.updatedAt = new Date().toISOString();
  g.__kollect = s;
  const now = Date.now();
  if (opts.throttle && now - (g.__kollectSaved ?? 0) < 30_000) return;
  g.__kollectSaved = now;
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(s));
  } catch { /* read-only filesystem: memory only */ }
}

export function loadScenario(scenario: ScenarioKey) {
  const prev = g.__kollect;
  const s = generateStore(scenario, Date.now(), prev?.languages);
  if (prev) {
    s.audit = prev.audit; s.auditSeq = prev.auditSeq; s.compliance = prev.compliance; s.gro = prev.gro; s.lines = prev.lines;
    s.grievances = prev.grievances; s.grievanceSeq = prev.grievanceSeq;
    rebalance(s); // campaigns share the lender's own line counts, not the defaults
  }
  saveStore(s);
  return s;
}

export function addEvent(s: Store, e: Omit<LiveEvent, "id" | "ts"> & { ts?: string }) {
  const ev: LiveEvent = { id: ++s.eventSeq, ts: e.ts ?? new Date().toISOString(), ...e };
  s.events.push(ev);
  if (s.events.length > 300) s.events.splice(0, s.events.length - 300);
  return ev;
}

const digest = (e: Omit<AuditEntry, "hash">) =>
  crypto.createHash("sha256").update([e.prev, e.id, e.ts, e.user, e.role, e.action, e.target, e.detail].join("|")).digest("hex");

/** Each entry carries the hash of the one before it, so an edited or removed entry breaks the chain. */
export function audit(s: Store, user: { username: string; role: Role }, action: string, target: string, detail = "") {
  const base = { id: ++s.auditSeq, ts: new Date().toISOString(), user: user.username, role: user.role, action, target, detail, prev: s.audit[0]?.hash ?? "genesis" };
  const entry: AuditEntry = { ...base, hash: digest(base) };
  s.audit.unshift(entry);
  if (s.audit.length > 20000) s.audit.length = 20000;
  return entry;
}

/** True when every entry still matches its hash and points at its predecessor. */
export function verifyAudit(s: Store): boolean {
  const list = s.audit;
  for (let i = 0; i < list.length; i++) {
    const { hash, ...rest } = list[i];
    if (digest(rest) !== hash) return false;
    if (i < list.length - 1 && list[i + 1].hash !== rest.prev) return false;
  }
  return true;
}

const pick = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];

/** Demo traffic: while live simulation is on, every poll advances the clock by a few calls. */
export function tick(s: Store): boolean {
  if (!s.demo.live || s.source !== "mock") return false;
  const now = Date.now();
  const elapsed = now - s.demo.lastTick;
  if (elapsed < 3500) return false;
  s.demo.lastTick = now;
  if (!windowOpen(s.compliance, now)) return false; // like a real dialler, nothing goes out after hours
  const n = Math.min(3, Math.max(1, Math.floor(elapsed / 4500)));
  const camps = campaignsFor(s.scenario, s.languages);
  for (let i = 0; i < n; i++) simulateCall(s, camps, now - (n - 1 - i) * 1200);
  return true;
}

function simulateCall(s: Store, camps: ReturnType<typeof campaignsFor>, t: number) {
  const pool = s.borrowers.filter((b) => b.disposition !== "Paid");
  const b = pool[Math.floor(Math.random() * pool.length)];
  if (!b) return;
  const camp = pickCampaign(b, camps, Math.random);
  if (!canContact(s, b, camp.channel === "WhatsApp" ? "whatsapp" : "voice", t).ok) return;
  const hour = ((t + 330 * 60_000) % DAY) / 3_600_000;
  const connected = Math.random() < connectChance(b, camp.channel, hour);
  const x = Math.random();
  const cls: Disposition = !connected ? "No Contact"
    : x < 0.32 ? "PTP" : x < 0.42 ? "Paid" : x < 0.62 ? "Callback" : x < 0.72 ? "Partial" : x < 0.86 ? "Dispute" : x < 0.93 ? "Escalated" : "PTP";
  const durationSec = connected ? 30 + Math.floor(Math.random() * 240) : Math.floor(Math.random() * 15);
  const ts = new Date(t).toISOString();
  const attemptNo = s.calls.filter((c) => c.loanId === b.loanId && Date.parse(c.ts) > istMidnight(t)).length + 1;
  s.calls.unshift({
    id: `S${s.eventSeq + 1}_${Math.floor(Math.random() * 1e6)}`, ts, phone: b.phone, loanId: b.loanId,
    callId: `call_${Math.floor(Math.random() * 36 ** 6).toString(36)}`, campaign: camp.code, product: b.product, portfolio: b.portfolio,
    channel: camp.channel, durationSec, classification: cls, connected,
    dropReason: connected ? undefined : pick(["no_answer", "switched_off", "customer_busy", "call_rejected"]), attemptNo, visible: true,
    language: camp.language === "Multilingual" ? b.language : camp.language, disclosed: true,
  });
  const ref = { portfolio: b.portfolio, borrowerId: b.id, loanId: b.loanId, ts };
  addEvent(s, {
    ...ref, type: "call",
    title: `${b.name} · ${connected ? cls : "No answer"}`,
    detail: `${camp.channel} · ${camp.code} · ${connected ? `${Math.floor(durationSec / 60)}:${String(durationSec % 60).padStart(2, "0")}` : "not answered"}`,
  });
  if (!connected) return;

  if (cls === "PTP") {
    Object.assign(b, { disposition: "PTP", stage: 3, ptpOutcome: "pending", ptpAmount: b.emi, ptpDate: new Date(t + (2 + Math.random() * 6) * DAY).toISOString() });
    addEvent(s, { ...ref, type: "ptp", title: `Promise to pay · ${b.name}`, detail: `₹${b.emi.toLocaleString("en-IN")} by ${new Date(b.ptpDate!).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}` });
  } else if (cls === "Paid") {
    Object.assign(b, { disposition: "Paid", stage: 4, ptpOutcome: b.ptpOutcome === "pending" ? "kept" : b.ptpOutcome, recoveredAmount: Math.max(b.recoveredAmount, b.emi), recoveredAt: ts });
    addEvent(s, { ...ref, type: "payment", title: `Payment received · ${b.name}`, detail: `₹${b.recoveredAmount.toLocaleString("en-IN")} · ${b.product}` });
  } else if (cls === "Escalated") {
    Object.assign(b, { disposition: "Escalated", stage: Math.max(b.stage, 2), channel: "Human Desk", escalatedAt: ts, escalationReason: pick(ESCALATION_REASONS) });
    addEvent(s, { ...ref, type: "escalation", title: `Escalated to human desk · ${b.name}`, detail: `${b.escalationReason} · ${b.loanId}` });
  } else if (cls === "Callback") {
    const note = pick(FOLLOWUP_NOTES);
    const at = followupSlot(note, b.prefBand, t, Math.random, 1 + Math.floor(Math.random() * 3));
    s.followUps.push({
      id: `F${s.eventSeq}_${Math.floor(Math.random() * 1e5)}`, borrowerId: b.id, loanId: b.loanId, name: b.name, portfolio: b.portfolio, product: b.product,
      at: new Date(at).toISOString(), requestedAt: ts, requestedVia: camp.channel, note, status: "Scheduled",
    });
    s.followUps.sort((a, c) => a.at.localeCompare(c.at));
    Object.assign(b, { disposition: "Callback", stage: Math.max(b.stage, 1) });
    addEvent(s, { ...ref, type: "followup", title: `Call-back requested · ${b.name}`, detail: note });
  } else if (cls === "Dispute" || cls === "Partial") {
    Object.assign(b, { disposition: cls, stage: Math.max(b.stage, cls === "Partial" ? 3 : 2) });
    if (cls === "Dispute") Object.assign(b, { ptpDate: undefined, ptpAmount: undefined, ptpOutcome: undefined }); // a disputed account has no live promise
  }
}
