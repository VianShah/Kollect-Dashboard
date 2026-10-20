import type { Role } from "./types";

export type ModuleKey =
  | "home" | "portfolio" | "performance" | "channels" | "campaigns" | "borrowers" | "followups" | "handoffs"
  | "calldesk" | "whatsapp" | "audit" | "compliance" | "grievances" | "usage" | "prompts" | "data" | "capacity";
export type ModuleGroup = "Plan" | "Monitor" | "Act" | "Assure" | "Agent Studio" | "Setup";

/**
 * Pages in the sidebar. `nav: false` pages still exist (campaign tabs and Accounts link to them) but aren't listed:
 * conversations live in Accounts, and compliance and grievances live inside each campaign.
 */
export const MODULES: { key: ModuleKey; label: string; href: string; group: ModuleGroup; filters: boolean; nav?: false }[] = [
  { key: "portfolio", label: "Portfolio & goals", href: "/portfolio", group: "Plan", filters: false },
  { key: "home", label: "Home", href: "/home", group: "Monitor", filters: true },
  { key: "performance", label: "Performance", href: "/performance", group: "Monitor", filters: true },
  { key: "channels", label: "Campaign report", href: "/channels", group: "Monitor", filters: true },
  { key: "campaigns", label: "Campaigns", href: "/campaigns", group: "Act", filters: false },
  { key: "calldesk", label: "Call desk", href: "/calldesk", group: "Act", filters: false },
  { key: "borrowers", label: "Accounts", href: "/borrowers", group: "Act", filters: true },
  { key: "handoffs", label: "Escalations", href: "/handoffs", group: "Act", filters: false },
  { key: "followups", label: "Call-backs", href: "/followups", group: "Act", filters: true },
  { key: "whatsapp", label: "WhatsApp", href: "/whatsapp", group: "Act", filters: false },
  { key: "usage", label: "Usage & billing", href: "/usage", group: "Assure", filters: true },
  { key: "audit", label: "Conversations", href: "/audit", group: "Assure", filters: true, nav: false },
  { key: "grievances", label: "Grievances", href: "/grievances", group: "Assure", filters: false, nav: false },
  { key: "prompts", label: "Agent Studio", href: "/prompts", group: "Agent Studio", filters: false },
  { key: "data", label: "Data", href: "/data", group: "Setup", filters: false },
  { key: "capacity", label: "Lines & languages", href: "/capacity", group: "Setup", filters: false },
  { key: "compliance", label: "Compliance rules", href: "/compliance", group: "Setup", filters: true },
];

/**
 * Which pages each role can open.
 * Super Admin is Predixion staff. Manager (head of collections), Supervisor (team lead and campaign manager) and
 * Telecaller belong to the lender. Client is a read-only reports view.
 */
export const ACCESS: Record<Role, ModuleKey[]> = {
  superadmin: MODULES.map((m) => m.key),
  manager: ["portfolio", "home", "performance", "channels", "campaigns", "usage", "audit", "grievances", "compliance"],
  supervisor: ["portfolio", "home", "performance", "channels", "campaigns", "calldesk", "borrowers", "handoffs", "followups", "whatsapp", "audit", "grievances", "capacity", "compliance"],
  telecaller: ["calldesk", "home", "borrowers", "handoffs", "followups", "whatsapp"],
  client: ["home", "performance", "channels", "usage"],
};

/** Pages hidden from a role's sidebar even though the role can open them (reached from inside other pages). */
const HIDDEN: Partial<Record<Role, ModuleKey[]>> = {
  manager: ["compliance"],
  supervisor: ["compliance"],
};
export const inNav = (role: Role, key: ModuleKey) =>
  ACCESS[role].includes(key) && MODULES.find((m) => m.key === key)?.nav !== false && !HIDDEN[role]?.includes(key);

/** Where each role lands after signing in. */
export const LANDING: Record<Role, string> = {
  superadmin: "/home",
  manager: "/portfolio",
  supervisor: "/campaigns",
  telecaller: "/calldesk",
  client: "/home",
};

export type Action =
  | "sendLink" | "escalate" | "editCapacity" | "hideCall" | "upload" | "revealPii" | "editCompliance" | "viewAudit" | "demo"
  | "followup" | "grievance" | "editLanguages" | "manageCampaigns" | "manageConnectors" | "editGoals" | "handoff" | "managePrompts"
  | "approveCampaigns" | "bulkWhatsApp" | "assignWork" | "transfer";

export const CAN: Record<Action, Role[]> = {
  managePrompts: ["superadmin"],
  manageConnectors: ["superadmin"],
  editCompliance: ["superadmin"],
  upload: ["superadmin"],
  editGoals: ["superadmin", "manager"],
  approveCampaigns: ["superadmin", "manager"],
  manageCampaigns: ["superadmin", "supervisor"],
  bulkWhatsApp: ["superadmin", "supervisor"],
  assignWork: ["superadmin", "supervisor"],
  editLanguages: ["superadmin", "supervisor"],
  editCapacity: ["superadmin", "supervisor"],
  hideCall: ["superadmin", "supervisor"],
  demo: ["superadmin", "supervisor"],
  viewAudit: ["superadmin", "manager", "supervisor"],
  handoff: ["superadmin", "supervisor", "telecaller"],
  transfer: ["superadmin", "supervisor", "telecaller"],
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
  superadmin: "Predixion only: every client, Agent Studio, integrations, lines and compliance rules",
  manager: "Head of collections: portfolio, goals, results, campaign reports and launch approval",
  supervisor: "Team lead and campaign manager: builds and runs campaigns, watches the team, handles escalations",
  telecaller: "Call desk: own queue, calls and WhatsApp, promises, call-backs and transfers",
  client: "Read-only: targets vs achieved, return on spend and reports",
};

export const REVEAL_REASONS = ["Customer asked to verify identity", "Returning a requested call-back", "Resolving a dispute", "Handling an escalation"];
