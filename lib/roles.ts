import type { Role } from "./types";

export type ModuleKey = "home" | "performance" | "borrowers" | "followups" | "channels" | "audit" | "compliance" | "usage" | "data";
export type ModuleGroup = "Monitor" | "Act" | "Assure" | "Setup";

export const MODULES: { key: ModuleKey; label: string; href: string; group: ModuleGroup; filters: boolean }[] = [
  { key: "home", label: "Home", href: "/home", group: "Monitor", filters: true },
  { key: "performance", label: "Performance", href: "/performance", group: "Monitor", filters: true },
  { key: "channels", label: "Channels", href: "/channels", group: "Monitor", filters: false },
  { key: "borrowers", label: "Borrowers", href: "/borrowers", group: "Act", filters: true },
  { key: "followups", label: "Follow-ups", href: "/followups", group: "Act", filters: true },
  { key: "audit", label: "Call Audit", href: "/audit", group: "Assure", filters: true },
  { key: "compliance", label: "Compliance", href: "/compliance", group: "Assure", filters: true },
  { key: "usage", label: "Usage", href: "/usage", group: "Assure", filters: true },
  { key: "data", label: "Data", href: "/data", group: "Setup", filters: false },
];

export const ACCESS: Record<Role, ModuleKey[]> = {
  admin: ["home", "performance", "channels", "borrowers", "followups", "audit", "compliance", "usage", "data"],
  supervisor: ["home", "performance", "channels", "borrowers", "followups", "audit", "compliance", "usage"],
  operator: ["home", "borrowers", "followups", "audit"],
  client: ["home", "performance", "borrowers", "followups", "compliance", "usage"],
};

export type Action =
  | "sendLink" | "escalate" | "editCapacity" | "hideCall" | "upload"
  | "revealPii" | "editCompliance" | "viewAudit" | "demo" | "followup";

export const CAN: Record<Action, Role[]> = {
  sendLink: ["admin", "supervisor", "operator"],
  escalate: ["admin", "supervisor", "operator"],
  followup: ["admin", "supervisor", "operator"],
  revealPii: ["admin", "supervisor", "operator"],
  editCapacity: ["admin", "supervisor"],
  hideCall: ["admin", "supervisor"],
  viewAudit: ["admin", "supervisor"],
  demo: ["admin", "supervisor"],
  editCompliance: ["admin"],
  upload: ["admin"],
};

export const can = (role: Role, a: Action) => CAN[a].includes(role);

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Super Admin",
  supervisor: "Supervisor",
  operator: "Operator",
  client: "Client",
};

export const REVEAL_REASONS = ["Customer asked to verify identity", "Returning a requested call-back", "Resolving a dispute", "Handling an escalation"];
