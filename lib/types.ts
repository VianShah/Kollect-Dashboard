export type Role = "admin" | "supervisor" | "operator" | "client";
export type ScenarioKey = "nbfc" | "bank" | "bnpl";
export type Segment = "Pre Due" | "Post Due (0–30)" | "Post Due (30–90)" | "Post Due (90+)";
export type Bucket = "Current" | "1–30" | "31–60" | "61–90" | "90+";
export type Disposition = "Paid" | "PTP" | "Partial" | "Callback" | "Dispute" | "No Contact" | "Escalated";
export type LinkStatus = "Not shared" | "Shared" | "Link clicked" | "Paid via link";
export type Channel = "AI Voice" | "WhatsApp" | "Human Desk";
export type TouchChannel = "WhatsApp" | "SMS" | "Email";
export type TouchStatus = "Sent" | "Delivered" | "Read" | "Opened" | "Clicked" | "Replied" | "Failed";

export interface Borrower {
  id: string;
  name: string;
  phone: string; // masked, safe to show
  phoneFull?: string; // server-only; never sent to the browser except through an audited reveal
  loanId: string;
  product: string;
  segment: Segment;
  portfolio: string;
  region: string;
  language: string;
  emi: number;
  outstanding: number;
  dpd: number;
  prevBucket?: Bucket;
  disposition: Disposition;
  stage: 0 | 1 | 2 | 3 | 4; // assigned, contacted, engaged, PTP, recovered
  paymentLink: LinkStatus;
  experian: number;
  channel: Channel;
  dnd: boolean;
  waConsent: boolean;
  ptpDate?: string;
  ptpAmount?: number;
  ptpOutcome?: "kept" | "broken" | "pending";
  recoveredAmount: number;
  recoveredAt?: string;
  escalatedAt?: string;
  escalationReason?: string;
  // mock-only behavioural seeds used by the live simulator
  prefBand?: number;
  prefChannel?: Channel;
}

export interface Call {
  id: string;
  ts: string;
  phone: string;
  loanId: string;
  callId: string;
  campaign: string;
  product: string;
  portfolio: string;
  channel: Channel;
  durationSec: number;
  classification: Disposition;
  connected: boolean;
  dropReason?: string;
  attemptNo: number;
  visible: boolean;
  language?: string;
  /** The AI-agent and call-recording disclosure was played at the start of the call. */
  disclosed?: boolean;
  recordingUrl?: string;
}

export interface Touch {
  id: string;
  ts: string;
  loanId: string;
  channel: TouchChannel;
  template: string;
  status: TouchStatus;
  text: string;
  language?: string;
}

export type GrievanceStatus = "Open" | "In progress" | "Resolved";
export interface Grievance {
  id: string;
  borrowerId: string;
  loanId: string;
  name: string;
  portfolio: string;
  product: string;
  category: string;
  detail: string;
  raisedAt: string;
  dueAt: string;
  status: GrievanceStatus;
  resolvedAt?: string;
  resolution?: string;
  raisedBy: string;
}

export interface GrievanceOfficer { name: string; email: string; phone: string }

export interface FollowUp {
  id: string;
  borrowerId: string;
  loanId: string;
  name: string;
  portfolio: string;
  product: string;
  at: string;
  requestedAt: string;
  requestedVia: Channel;
  note: string;
  status: "Scheduled" | "Done" | "Missed";
}

export interface Agent {
  id: string;
  name: string;
  code: string;
  business: string;
  product: string;
  language: string;
  voice: string;
  channel: Channel;
  live: number;
  max: number;
  resolved: number;
  open: number;
}

export interface LiveEvent {
  id: number;
  ts: string;
  type: "call" | "escalation" | "payment" | "ptp" | "followup";
  portfolio: string;
  borrowerId?: string;
  loanId?: string;
  title: string;
  detail: string;
}

export interface AuditEntry {
  id: number;
  ts: string;
  user: string;
  role: Role;
  action: string;
  target: string;
  detail: string;
  prev: string;
  hash: string;
}

export interface ComplianceRules {
  windowStart: number;
  windowEnd: number;
  maxPerDay: number;
  maxPerWeek: number;
  respectDnd: boolean;
  requireWaConsent: boolean;
}

export interface Store {
  v: number;
  scenario: ScenarioKey;
  portfolios: string[];
  products: string[];
  borrowers: Borrower[];
  calls: Call[];
  touches: Touch[];
  followUps: FollowUp[];
  agents: Agent[];
  globalMax: number;
  recoveryTargetPct: number;
  compliance: ComplianceRules;
  /** Languages the lender has switched on for outreach; one voice campaign exists per language and product. */
  languages: string[];
  grievances: Grievance[];
  grievanceSeq: number;
  gro: GrievanceOfficer;
  events: LiveEvent[];
  eventSeq: number;
  audit: AuditEntry[];
  auditSeq: number;
  demo: { live: boolean; lastTick: number };
  source: "mock" | "excel" | "api";
  updatedAt: string;
}

export interface Filters {
  range: "today" | "7d" | "30d" | "mtd" | "custom";
  from?: string;
  to?: string;
  portfolio?: string;
  product?: string;
  channel?: string;
}

export interface Scope {
  portfolio?: string; // client users are pinned to a portfolio
  visibleOnly?: boolean;
}
