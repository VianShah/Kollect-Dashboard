export type Role = "superadmin" | "manager" | "supervisor" | "telecaller" | "client";
export type ScenarioKey = "nbfc" | "bank" | "bnpl";
export type Segment = "Pre Due" | "Post Due (0–30)" | "Post Due (30–90)" | "Post Due (90+)";
export type Bucket = "Current" | "1–30" | "31–60" | "61–90" | "90+";
export type Disposition = "Paid" | "PTP" | "Partial" | "Callback" | "Dispute" | "No Contact" | "Escalated";
export type LinkStatus = "Not shared" | "Shared" | "Link clicked" | "Paid via link";
export type Channel = "AI Voice" | "IVR" | "WhatsApp" | "Human Desk";
export type CommChannel = "Voice agents" | "IVR" | "WhatsApp" | "SMS" | "Telecallers";
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

export type StepKind = "start" | "whatsapp" | "sms" | "voice" | "ivr" | "telecaller" | "wait" | "branch" | "end";
export interface StepData {
  label: string;
  template?: string;      // whatsapp / sms
  agent?: string;         // voice / ivr: agent code, or "auto" for the borrower's language
  seats?: number;         // telecaller
  waitHours?: number;     // wait
  slot?: "any" | "morning" | "afternoon" | "evening"; // when to send, inside the calling window
  condition?: "answered" | "paid" | "promised" | "replied" | "disputed"; // branch
}
export interface StepNode { id: string; kind: StepKind; x: number; y: number; data: StepData }
export interface StepEdge { id: string; source: string; target: string; label?: "yes" | "no" }

export type CampaignStatus = "Draft" | "Scheduled" | "Running" | "Paused" | "Completed";
export interface CampaignAudience {
  source: "filters" | "list";
  products: string[]; segments: string[]; languages: string[]; portfolios: string[];
  minDpd: number; maxDpd: number;
  loanIds: string[];
}
export interface CampaignStats { reached: number; attempts: number; promises: number; paid: number; collected: number }
export interface Campaign {
  id: string;
  name: string;
  goal: string;
  status: CampaignStatus;
  audience: CampaignAudience;
  nodes: StepNode[];
  edges: StepEdge[];
  startAt: string;
  endAt: string;
  salaryWeekBoost: boolean;
  dailyCap: number;
  members: string[]; // borrower ids frozen at launch
  stats: CampaignStats;
  createdBy: string;
  updatedAt: string;
  launchedAt?: string;
}

/** A monthly collection target for one company, either across the book or for one product. */
export interface Goal { id: string; company: string; product: string; target: number; month: string; setBy: string }

/** Escalation handoff. Cold = transfer only. Hot = transfer plus an AI summary sent to the telecaller on WhatsApp or the CRM. */
export interface HandoffState { mode?: "cold" | "hot"; owner?: string; status: "Waiting" | "With telecaller" | "Resolved"; summarySentVia?: "WhatsApp" | "CRM"; outcome?: string; updatedAt?: string }

export type BlockCategory =
  | "identity" | "opening" | "verification" | "reason" | "negotiation" | "objection" | "complaint"
  | "escalation" | "payment" | "callback" | "closing" | "guardrails";
export type Tone = "aggressive" | "pushy" | "silent" | "supportive" | "compliant";
export interface PromptBlock {
  id: string; category: BlockCategory; source: string; product: string; tone: Tone;
  text: string; testCalls: number; passRate: number; locked?: boolean;
}
export interface PromptVersion {
  v: number; blocks: { blockId: string; category: BlockCategory; text: string }[]; note: string; by: string; at: string;
  test?: { passed: boolean; score: number; at: string; failedBlocks: string[] };
}
export interface PromptDoc {
  id: string; client: string; product: string; tone: Tone; languages: string[]; ticket: number; dpd: string;
  status: "Draft" | "Tested" | "Published"; current: number; versions: PromptVersion[]; tools: string[]; source?: boolean; updatedAt: string;
}

export type ConnectorKind = "telephony" | "ivr" | "whatsapp" | "sms" | "payments" | "crm" | "webhook";
export interface Connector {
  kind: ConnectorKind;
  provider: string;
  status: "Connected" | "Not connected" | "Error";
  config: Record<string, string>; // secret fields stay on the server; API responses mask them
  lastTest?: string;
  lastResult?: string;
}

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
  /** Lines (or telecaller seats) per communication channel; live is only used for channels without campaigns. */
  lines: Record<CommChannel, { lines: number; live: number }>;
  recoveryTargetPct: number;
  compliance: ComplianceRules;
  /** Languages the lender has switched on for outreach; one voice campaign exists per language and product. */
  languages: string[];
  grievances: Grievance[];
  grievanceSeq: number;
  campaigns: Campaign[];
  campaignSeq: number;
  goals: Goal[];
  handoffs: Record<string, HandoffState>;
  prompts: PromptDoc[];
  connectors: Connector[];
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
