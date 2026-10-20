// Background sender for template messages to many people. Works through each job one message at a time,
// survives page reloads (state lives in the store), and pauses itself for Meta's daily limit and, for
// borrowers in live mode, outside calling hours.
import { audit, getStore, saveStore } from "./store";
import { windowOpen } from "./contact";
import { DAY, istMidnight } from "./time";
import type { Store, WaJob } from "./types";
import { tierLimit } from "./waValues";
import { addWaMessage, maskPhone, renderTemplate, sendTemplate, waConfig, waState } from "./whatsapp";

const g = globalThis as unknown as { __waRunner?: boolean };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const GAP_MS = 200; // about five messages a second, far under Meta's throughput limit

/** How many different people got a business-started template in the last 24 hours, against the number's tier. */
export function dailyUsage(s: Store, now = Date.now()) {
  const st = waState(s);
  const recent = st.messages.filter((m) => m.direction === "out" && m.kind === "template" && m.status !== "failed" && Date.parse(m.ts) > now - DAY);
  const people = new Set(recent.map((m) => m.to));
  const limit = tierLimit(st.health?.number?.messaging_limit_tier);
  const oldest = recent.reduce((t, m) => Math.min(t, Date.parse(m.ts)), now);
  return { used: people.size, limit, remaining: Math.max(0, limit - people.size), people, freesAt: new Date(oldest + DAY).toISOString(), tier: st.health?.number?.messaging_limit_tier };
}

const nextWindowStart = (s: Store, now = Date.now()) => {
  const start = istMidnight(now) + s.compliance.windowStart * 3_600_000;
  return new Date(start > now ? start : start + DAY).toISOString();
};

export const jobCounts = (j: WaJob) => ({
  total: j.items.length,
  sent: j.items.filter((i) => i.status === "sent").length,
  failed: j.items.filter((i) => i.status === "failed").length,
  skipped: j.items.filter((i) => i.status === "skipped").length,
  queued: j.items.filter((i) => i.status === "queued").length,
});

/** Starts the background loop if there is work and it isn't already running. Safe to call on every request. */
export function kickJobs() {
  if (g.__waRunner) return;
  const jobs = getStore().wa?.jobs ?? [];
  if (!jobs.some((j) => j.state === "running" || j.state === "waiting")) return;
  g.__waRunner = true;
  run().catch(() => undefined).finally(() => { g.__waRunner = false; });
}

async function run() {
  for (;;) {
    const s = getStore();
    const st = waState(s);
    const now = Date.now();
    const jobs = st.jobs ?? [];
    const due = jobs.find((j) => j.state === "running") ?? jobs.find((j) => j.state === "waiting" && Date.parse(j.waitingUntil ?? "") <= now);
    if (!due) {
      if (jobs.some((j) => j.state === "waiting")) { await sleep(60_000); continue; }
      saveStore(s);
      return;
    }
    const job = due;
    if (job.state === "waiting") { job.state = "running"; job.note = undefined; job.waitingUntil = undefined; }
    const item = job.items.find((i) => i.status === "queued");
    if (!item) {
      job.state = "done";
      const c = jobCounts(job);
      audit(s, { username: job.by, role: job.byRole }, "wa_job_done", job.template, `sent ${c.sent}, failed ${c.failed}, skipped ${c.skipped}`);
      saveStore(s);
      continue;
    }

    const t = st.templates.find((x) => x.name === job.template && x.language === job.language);
    if (!t || t.status !== "APPROVED") {
      job.state = "paused"; job.note = `"${job.template}" is no longer approved at Meta. Nothing else will send until it is; then resume.`;
      saveStore(s); continue;
    }
    if (waConfig().missing.length) { job.state = "paused"; job.note = "WhatsApp keys are missing on this server."; saveStore(s); continue; }

    // Borrowers can opt out or raise a dispute while a long send is running.
    if (item.borrowerId) {
      const b = s.borrowers.find((x) => x.id === item.borrowerId);
      if (b && !b.waConsent) { item.status = "skipped"; item.error = "Opted out of WhatsApp"; continue; }
      if (b && b.disposition === "Dispute") { item.status = "skipped"; item.error = "Disputed account"; continue; }
      if (waConfig().mode === "live" && !windowOpen(s.compliance, now)) {
        job.state = "waiting"; job.waitingUntil = nextWindowStart(s, now); job.note = `Outside calling hours (${s.compliance.windowStart}:00–${s.compliance.windowEnd}:00 IST). Resumes at the next window.`;
        saveStore(s); continue;
      }
    }

    const usage = dailyUsage(s, now);
    if (!usage.people.has(item.to) && usage.used >= usage.limit) {
      job.state = "waiting"; job.waitingUntil = usage.freesAt;
      job.note = `Meta's daily limit of ${usage.limit} new conversations is used up. Resumes on its own as the limit frees up.`;
      saveStore(s); continue;
    }

    const res = await sendTemplate(item.to, t, item.body, item.header);
    const at = new Date().toISOString();
    const text = renderTemplate(t, item.body, item.header);
    const id = res.ok ? res.id : `failed_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    addWaMessage(s, {
      id, ts: at, direction: "out", to: item.to, kind: "template", template: t.name, language: t.language, text,
      status: res.ok ? "accepted" : "failed", statusAt: at, error: res.ok ? undefined : res.error,
      borrowerId: item.borrowerId, loanId: item.loanId, campaignId: job.campaignId, redirectedFrom: item.redirectedFrom, by: job.by,
    });
    if (item.loanId) {
      s.touches.unshift({ id: `T${Date.now()}${Math.floor(Math.random() * 1000)}`, ts: at, loanId: item.loanId, channel: "WhatsApp", template: t.name,
        status: res.ok ? "Sent" : "Failed", text, waId: res.ok ? res.id : undefined, error: res.ok ? undefined : `${res.error.code ?? ""} ${res.error.title}`.trim() });
    }
    item.at = at;
    if (res.ok) {
      item.status = "sent"; item.wamid = res.id;
      const c = job.campaignId ? s.campaigns.find((x) => x.id === job.campaignId) : undefined;
      if (c) c.stats.attempts++;
    } else {
      item.status = "failed"; item.error = `${res.error.code ?? ""} ${res.error.title}`.trim();
      // A payment or account problem fails every message the same way; stop instead of burning the whole list.
      const recent = job.items.filter((i) => i.status === "failed").slice(-5);
      if (recent.length === 5 && job.items.filter((i) => i.status === "sent").length === 0 && new Set(recent.map((i) => i.error)).size === 1) {
        job.state = "paused"; job.note = `The first five messages all failed with "${item.error}". Fix that, then resume or retry failed.`;
      }
    }
    saveStore(s, { throttle: true });
    await sleep(GAP_MS);
  }
}

/** What the page shows for each job. Numbers are masked; the newest jobs come first. */
export function jobView(j: WaJob, withItems: boolean) {
  return {
    id: j.id, createdAt: j.createdAt, by: j.by, template: j.template, language: j.language, source: j.source, campaignId: j.campaignId,
    state: j.state, note: j.note, waitingUntil: j.waitingUntil, ...jobCounts(j),
    items: withItems ? j.items.map((i) => ({ label: i.label, to: maskPhone(i.to), loanId: i.loanId, status: i.status, error: i.error, at: i.at })) : [],
  };
}
