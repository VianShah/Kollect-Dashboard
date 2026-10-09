# Kollect · collections command center (by Predixion AI)

Next.js 15 + Tailwind 4 + Recharts. Built as a client-facing demo that also runs on real data (Excel upload or a live ingest webhook).

```bash
npm install && npm run dev   # http://localhost:3000
```

Demo logins (password `kollect123`): `admin`, `supervisor`, `operator`, `client`.

## Modules
| Group | Module | What it does |
|---|---|---|
| Monitor | Home | "What changed" notes, 10 KPIs with period deltas and sparklines; every card drills into the records behind it; today's follow-ups and latest escalations |
| | Performance | Funnel, dispositions, non-contact reasons, connect rate by time of day, **month-end forecast**, **roll-rate matrix**, breakdowns by segment / product / channel / region |
| | Channels | Global concurrency; languages; **communication channels** (Voice agents, IVR, WhatsApp, SMS on lines of 100 concurrent sessions each, plus a few telecaller seats at one call each); campaigns share their channel's capacity |
| Act | Borrowers | Queue with drill-down filters; select a borrower for **Borrower 360** |
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
| admin | all | everything, incl. upload and compliance rules |
| supervisor | all but Data | capacity, languages, hide calls, audit trail, complaints, reveal |
| operator | Home, Borrowers, Follow-ups, Call Audit, Grievances | send link, escalate, follow-ups, complaints, reveal |
| client | Home, Performance, Borrowers, Follow-ups, Compliance, Usage | read-only, own portfolio, visible calls only |

Every data route also checks that the role may open the matching page, not just the action. Auth is demo-grade (hardcoded users, signed cookie, 5 failed sign-ins lock for 15 minutes). Swap `lib/auth.ts` for SSO/JWT and the store for a database before production. All times are IST.
