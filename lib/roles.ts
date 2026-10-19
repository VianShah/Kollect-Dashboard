import type { Role } from "./types";

export type ModuleKey =
  | "home" | "portfolio" | "performance" | "channels" | "campaigns" | "borrowers" | "followups" | "handoffs"
  | "audit" | "compliance" | "grievances" | "usage" | "prompts" | "data";
export type ModuleGroup = "Plan" | "Monitor" | "Act" | "Assure" | "Studio" | "Setup";

export const MODULES: { key: ModuleKey; label: string; href: string; group: ModuleGroup; filters: boolean }[] = [
  { key: "portfolio", label: "Portfolio & goals", href: "/portfolio", group: "Plan", filters: false },
  { key: "home", label: "Home", href: "/home", group: "Monitor", filters: true },
  { key: "performance", label: "Performance", href: "/performance", group: "Monitor", filters: true },
  { key: "channels", label: "Channels & agents", href: "/channels", group: "Monitor", filters: false },
  { key: "campaigns", label: "Campaigns", href: "/campaigns", group: "Act", filters: false },
  { key: "borrowers", label: "Accounts", href: "/borrowers", group: "Act", filters: true },
  { key: "handoffs", label: "Escalations", href: "/handoffs", group: "Act", filters: false },
  { key: "followups", label: "Call-backs", href: "/followups", group: "Act", filters: true },
  { key: "audit", label: "Conversations", href: "/audit", group: "Assure", filters: true },
  { key: "compliance", label: "Compliance", href: "/compliance", group: "Assure", filters: true },
  { key: "grievances", label: "Grievances", href: "/grievances", group: "Assure", filters: false },
  { key: "usage", label: "Usage & billing", href: "/usage", group: "Assure", filters: true },
  { key: "prompts", label: "Prompt Library", href: "/prompts", group: "Studio", filters: false },
  { key: "data", label: "Data", href: "/data", group: "Setup", filters: false },
];

/** Which pages each role sees. Super Admin is Predixion staff; everyone else belongs to a lender. */
export const ACCESS: Record<Role, ModuleKey[]> = {
  superadmin: MODULES.map((m) => m.key),
  manager: ["portfolio", "home", "performance", "channels", "campaigns", "compliance", "usage"],
  supervisor: ["home", "performance", "channels", "campaigns", "borrowers", "handoffs", "followups", "audit", "compliance", "grievances", "usage"],
  telecaller: ["home", "campaigns", "channels", "borrowers", "handoffs", "followups", "audit"],
  client: ["home", "performance", "compliance", "usage"],
};

export type Action =
  | "sendLink" | "escalate" | "editCapacity" | "hideCall" | "upload" | "revealPii" | "editCompliance" | "viewAudit" | "demo"
  | "followup" | "grievance" | "editLanguages" | "manageCampaigns" | "manageConnectors" | "editGoals" | "handoff" | "managePrompts";

export const CAN: Record<Action, Role[]> = {
  managePrompts: ["superadmin"],
  manageConnectors: ["superadmin"],
  editCompliance: ["superadmin"],
  upload: ["superadmin"],
  editGoals: ["superadmin", "manager"],
  manageCampaigns: ["superadmin", "supervisor"],
  editLanguages: ["superadmin", "supervisor"],
  editCapacity: ["superadmin", "supervisor"],
  hideCall: ["superadmin", "supervisor"],
  demo: ["superadmin", "supervisor"],
  viewAudit: ["superadmin", "manager", "supervisor"],
  handoff: ["superadmin", "supervisor", "telecaller"],
  grievance: ["superadmin", "supervisor", "telecaller"],
  sendLink: ["superadmin", "supervisor", "telecaller"],
  escalate: ["superadmin", "supervisor", "telecaller"],
  followup: ["superadmin", "supervisor", "telecaller"],
  revealPii: ["superadmin", "supervisor", "telecaller"],
};

export const can = (role: Role, a: Action) => CAN[a].includes(role);

export const ROLE_LABEL: Record<Role, string> = {
  superadmin: "Super Admin",
  manager: "Manager",
  supervisor: "Supervisor",
  telecaller: "Telecaller",
  client: "Client",
};

export const ROLE_SUMMARY: Record<Role, string> = {
  superadmin: "Predixion only: everything, plus the Prompt Library, integrations and onboarding",
  manager: "Every company: portfolio risk, goals, channel mix, agents and reports",
  supervisor: "Campaigns, channels, accounts, conversations, compliance and escalations",
  telecaller: "Own queue, escalations handed over, call-backs and dispositions",
  client: "Read-only: results, compliance and usage",
};

export const REVEAL_REASONS = ["Customer asked to verify identity", "Returning a requested call-back", "Resolving a dispute", "Handling an escalation"];
