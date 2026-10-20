// The lender's telecalling team: who speaks what, and who is free right now. Demo roster; a real desk reports
// presence from the dialer. The signed-in demo telecaller is Omkar Patil.

export type Presence = "Free" | "On a call" | "Wrap-up" | "Break" | "Offline";
export interface Teammate { id: string; username?: string; name: string; languages: string[]; lead?: boolean }

export const TEAM: Teammate[] = [
  { id: "T01", username: "telecaller", name: "Omkar Patil", languages: ["Marathi", "Hindi", "English"] },
  { id: "T02", name: "Priya Nair", languages: ["Malayalam", "Tamil", "English"] },
  { id: "T03", name: "Rahul Verma", languages: ["Hindi", "Punjabi", "English"] },
  { id: "T04", name: "Sneha Reddy", languages: ["Telugu", "Hindi", "English"] },
  { id: "T05", name: "Arjun Iyer", languages: ["Tamil", "English"] },
  { id: "T06", name: "Moumita Das", languages: ["Bengali", "Hindi"] },
  { id: "T07", name: "Kavya Gowda", languages: ["Kannada", "Telugu", "English"] },
  { id: "T08", name: "Farhan Shaikh", languages: ["Hindi", "Marathi", "Gujarati"] },
  { id: "T09", name: "Hetal Shah", languages: ["Gujarati", "Hindi", "English"] },
  { id: "T10", name: "Gurpreet Kaur", languages: ["Punjabi", "Hindi"] },
  { id: "T11", name: "Sameer Kapoor", username: "supervisor", languages: ["Hindi", "English"], lead: true },
];

const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };

/** Presence changes every few minutes so the desk looks alive; outside calling hours everyone is offline. */
export function presenceOf(t: Teammate, windowOpen: boolean, now = Date.now()): { status: Presence; since: string; with?: string } {
  if (!windowOpen) return { status: "Offline", since: new Date(now).toISOString() };
  if (t.username === "telecaller") return { status: "Free", since: new Date(now - 60_000).toISOString() };
  const slot = Math.floor(now / 240_000); // 4-minute slots
  const r = hash(`${t.id}:${slot}`);
  const status: Presence = t.lead ? (r < 0.5 ? "Free" : "On a call") : r < 0.42 ? "On a call" : r < 0.72 ? "Free" : r < 0.84 ? "Wrap-up" : "Break";
  return { status, since: new Date(slot * 240_000 + Math.floor(hash(`${t.id}:s${slot}`) * 200_000)).toISOString() };
}

export const speakers = (language: string) => TEAM.filter((t) => t.languages.includes(language));
export const teammateFor = (username: string) => TEAM.find((t) => t.username === username);
