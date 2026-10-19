# Kollect · collections command center (by Predixion AI)

Next.js 15 + Tailwind 4 + Recharts. Built as a client-facing demo that also runs on real data (Excel upload or a live ingest webhook).

```bash
npm install && npm run dev   # http://localhost:3000
```

Demo logins (password `kollect123`): `superadmin`, `manager`, `supervisor`, `telecaller`, `client`.

**Phase 2 is a front-end POC on realistic mock data.** The LLM prompt assembly, tone rewrite, AI handoff summaries and prompt test calls are simulated in `lib/prompts.ts` and `lib/handoffs.ts`; engineering replaces them with the real model, Voiz test lines and backend services.

## Phase 2 additions
- **Five roles** (`lib/roles.ts`): Super Admin (Predixion, everything plus the Prompt Library), Manager (all companies: portfolio, goals, channel mix, agents, reports), Supervisor, Telecaller (own queue, escalations, call-backs, dispositions) and Client (read-only results, compliance, usage). Navigation, pages and APIs are gated per role.
- **Portfolio & goals**: book split into high / medium / low risk from bureau score, days late and payment history (`lib/portfolio.ts`), with the channel approach for each tier; monthly goals per company and product with pace and status; product portfolios and channel mix.
- **Escalations**: handoff queue with cold transfer (transfer only) and hot transfer (transfer plus an AI summary via WhatsApp or CRM), a 4-hour waiting target, "my queue" and resolution outcomes.
- **Prompt Library** (Super Admin): three anonymised production prompts (Northwind Finserv, Cartwheel Pay, Lumen Credit, invented names) split into 12 tagged block types with test-call counts and pass rates; a new-client wizard (product, ticket size, DPD bucket, languages, tone) that assembles the best-proven blocks and rewrites them for the tone, listing tools and variables; a drag-and-drop editor with side-by-side diff against the source block, versions and rollback, a test call that must pass before publishing, a length meter against the ~13-page target, and QC failures from Conversations linked back to the block that caused them. Disclosure, complaint and compliance blocks are locked and never rewritten. Replace the placeholder block text with the real anonymised prompts.
- **Campaign journey**: every campaign opens on a Before / During / After bar. Before = goal and target, voice agent (published prompt + voices + tools), audience risk mix, workflow, audience, schedule and launch checks. During = collected vs target and pace, funnel, connect rate by hour, channel activity and cost, escalations and a live feed. After = attainment, cost and return, cumulative collections against target, what worked, results by channel, product and language, a downloadable report and "run again as a draft".

## Modules
| Group | Module | What it does |
|---|---|---|
| Monitor | Home | "What changed" notes, 10 KPIs with period deltas and sparklines; every card drills into the records behind it; today's follow-ups and latest escalations |
| | Performance | Funnel, dispositions, non-contact reasons, connect rate by time of day, **month-end forecast**, **roll-rate matrix**, breakdowns by segment / product / channel / region |
| | Channels | Global concurrency; languages; **communication channels** (Voice agents, IVR, WhatsApp, SMS on lines of 100 concurrent sessions each, plus a few telecaller seats at one call each); campaigns share their channel's capacity |
| Act | Campaigns | Create, draft, edit, import/export (JSON config) and run campaigns. Visual workflow canvas (WhatsApp, SMS, AI voice, IVR, telecaller, wait, if/else) with agent and template selection; audience by filters or uploaded loan-ID list; schedule, salary-week boost and daily cap; compliance checks before launch; pause / resume / stop; live results. **Integrations** tab: telephony (Voiz), IVR and SMS (Vobiz), WhatsApp (Interakt), payment links, loan system / CRM and webhooks, with masked keys and test connection (simulated in the demo) |
| | Borrowers | Queue with drill-down filters; select a borrower for **Borrower 360** |
| | Follow-ups | Calendar of call-backs borrowers asked for; mark done / missed |
| Assure | Call Audit | Call log with language, AI/recording notice and recording link; client-visibility toggle |
| | Compliance | Calling window, daily/weekly caps, do-not-call, WhatsApp opt-in, disclosure; flags feed; narrowable rules; **audit trail** with integrity check |
| | Grievances | Complaint log with 30-day deadline, resolution notes, grievance officer details |
| | Usage | Billable minutes by day and campaign |
| Setup | Data | Excel import/template, ingest webhook docs |

**Borrower 360**: full history across voice, WhatsApp, SMS and email; answer rate by time of day; channel response; a contact playbook derived from that history; masked phone with reason-gated, logged reveal; send link / schedule follow-up / escalate.

**Notifications**: bell + toasts for every completed call, promises, payments, call-back requests and escalations. Escalations auto-download an `.xlsx` hand-off file (configurable in the bell panel).

**Demo data**: BNPL, Personal Loan, Credit Card and Two-Wheeler Loan. Simulated live traffic only runs inside calling hours. The header's Statemachine button opens the separate Statemachine app.

## Languages
Ten languages: Hindi, English, Marathi, Gujarati, Tamil, Telugu, Kannada, Bengali, Malayalam, Punjabi (`lib/languages.ts`). On **Channels → Languages** an admin or supervisor switches each one on or off. Each enabled language gets its own voice campaign per product and stage (for example `KOLLECT_PL_PD1_30_VOICE_TA`). A borrower is reached in their own language when it is on; otherwise in English (always on), and the gap is flagged on Channels, Compliance and in the borrower's playbook. Borrower messages are localised (`lib/messages.ts`) and always carry the lender name and an opt-out line. Have a native speaker approve the wording before go-live.

## Compliance guardrails
- **Checked before contact** (`lib/contact.ts`): calling window, daily and rolling 7-day caps, do-not-call, WhatsApp opt-in, and disputed accounts (outreach paused). A blocked contact is refused with a reason and logged.
- The window is clamped to the legal 08:00-19:00 IST; lenders can narrow it, not widen it. Do-not-call and opt-in checks cannot be turned off.
- Complaints (**Grievances** module) carry a 30-day deadline and the Grievance Redressal Officer details.
- Every sign-in, failed sign-in, phone reveal (listed reason, hourly limit), blocked contact and settings change goes to a hash-chained audit trail; the Compliance page shows whether the chain is intact.
- Calls carry language, an AI/recording-notice flag and an optional recording link.

## Going live
Set `SESSION_SECRET` (24+ random characters) and `INGEST_KEY`; the app refuses to sign sessions or accept ingest with the defaults in production. The four demo accounts are disabled in production unless `ALLOW_DEMO_USERS=1`; connect SSO first. Demo and reset routes are disabled in production and on real data. Still needed for production: a database instead of `data/store.json`, a retention and erasure policy, call-recording storage, and a legal review of the language wording and rules.

## Data flow
- Mock store generated per scenario (`lib/mock.ts`), kept in memory and persisted to `data/store.json`.
- Excel: sheets `Borrowers`, `Calls`, `Messages`, `FollowUps`, `Agents` (`lib/excel.ts`).
- Live: `POST /api/ingest/events` with `x-api-key: $INGEST_KEY`.
- If the server is unreachable, pages compute from a local copy of the mock.

## Roles
| Role | Modules | Can |
|---|---|---|
| superadmin | all, incl. Prompt Library and Data | everything: prompts, integrations, compliance rules, upload |
| manager | Portfolio & goals, Home, Performance, Channels & agents, Campaigns, Compliance, Usage | set goals; view campaigns, agents and reports across companies |
| supervisor | Home, Performance, Channels & agents, Campaigns, Accounts, Escalations, Call-backs, Conversations, Compliance, Grievances, Usage | run campaigns, capacity, languages, hide calls, audit trail, handoffs |
| telecaller | Home, Campaigns, Channels & agents, Accounts (my queue), Escalations, Call-backs, Conversations | send link, escalate, handoffs, follow-ups, complaints, reveal |
| client | Home, Performance, Compliance, Usage | read-only, own portfolio, visible calls only |

Every data route also checks that the role may open the matching page, not just the action. Auth is demo-grade (hardcoded users, signed cookie, 5 failed sign-ins lock for 15 minutes). Swap `lib/auth.ts` for SSO/JWT and the store for a database before production. All times are IST.
