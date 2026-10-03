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
| | Channels | Live concurrency per agent, grouped by product; rebalance capacity |
| Act | Borrowers | Queue with drill-down filters; select a borrower for **Borrower 360** |
| | Follow-ups | Calendar of call-backs borrowers asked for; mark done / missed |
| Assure | Call Audit | Call log, client-visibility toggle |
| | Compliance | Calling window, daily/weekly caps, do-not-call requests, WhatsApp opt-in; flags feed; editable rules; **audit trail** |
| | Usage | Billable minutes by day and campaign |
| Setup | Data | Excel import/template, ingest webhook docs |

**Borrower 360**: full history across voice, WhatsApp, SMS and email; answer rate by time of day; channel response; a contact playbook derived from that history; masked phone with reason-gated, logged reveal; send link / schedule follow-up / escalate.

**Notifications**: bell + toasts for every completed call, promises, payments, call-back requests and escalations. Escalations auto-download an `.xlsx` hand-off file (configurable in the bell panel).

**Demo mode** (admin, supervisor): switch lender type (NBFC, Bank, BNPL; each with its own products and campaigns), toggle simulated live traffic, reset.

## Data flow
- Mock store generated per scenario (`lib/mock.ts`), kept in memory and persisted to `data/store.json`.
- Excel: sheets `Borrowers`, `Calls`, `Messages`, `FollowUps`, `Agents` (`lib/excel.ts`).
- Live: `POST /api/ingest/events` with `x-api-key: $INGEST_KEY`.
- If the server is unreachable, pages compute from a local copy of the mock.

## Roles
| Role | Modules | Can |
|---|---|---|
| admin | all | everything, incl. upload and compliance rules |
| supervisor | all but Data | capacity, hide calls, audit trail, demo controls, reveal |
| operator | Home, Borrowers, Follow-ups, Call Audit | send link, escalate, follow-ups, reveal |
| client | Home, Performance, Borrowers, Follow-ups, Compliance, Usage | read-only, own portfolio, visible calls only |

Auth is demo-grade (hardcoded users, signed cookie). Swap `lib/auth.ts` for SSO/JWT and the store for a database before production. All times are IST.
