import crypto from "crypto";
import { cookies } from "next/headers";
import type { Role, Scope, Store } from "./types";
import { can as roleCan, type Action } from "./roles";

export interface SessionUser { username: string; name: string; role: Role; portfolio?: string }

const DEV_SECRET = "dev-secret-change-me";
export const COOKIE = "kollect_session";
export const isProduction = process.env.NODE_ENV === "production";

/** Refuses to sign sessions in production with a missing, default or short secret. Checked on use so `next build` still works. */
function secret() {
  const s = process.env.SESSION_SECRET ?? DEV_SECRET;
  if (isProduction && (s === DEV_SECRET || s === "change-me" || s.length < 24))
    throw new Error("SESSION_SECRET must be set to a random value of at least 24 characters in production.");
  return s;
}

/** The demo accounts only exist outside production unless ALLOW_DEMO_USERS=1 is set deliberately. */
export const demoUsersEnabled = !isProduction || process.env.ALLOW_DEMO_USERS === "1";

export const passwordMatches = (given: string, expected: string) => {
  const h = (v: string) => crypto.createHash("sha256").update(v).digest();
  return crypto.timingSafeEqual(h(given), h(expected));
};

export const USERS: (SessionUser & { password: string })[] = [
  { username: "admin", password: "kollect123", name: "Asha Menon", role: "admin" },
  { username: "supervisor", password: "kollect123", name: "Sameer Kapoor", role: "supervisor" },
  { username: "operator", password: "kollect123", name: "Omkar Patil", role: "operator" },
  { username: "client", password: "kollect123", name: "Client viewer", role: "client", portfolio: "Alpha NBFC" },
];

const sign = (payload: string) => crypto.createHmac("sha256", secret()).update(payload).digest("base64url");

export function makeToken(u: SessionUser) {
  const payload = Buffer.from(JSON.stringify({ ...u, exp: Date.now() + 8 * 3600_000 })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function parseToken(token?: string): SessionUser | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (expected.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) return null;
  try {
    const { exp, ...u } = JSON.parse(Buffer.from(payload, "base64url").toString());
    return exp > Date.now() ? (u as SessionUser) : null;
  } catch { return null; }
}

export async function getSession(): Promise<SessionUser | null> {
  return parseToken((await cookies()).get(COOKIE)?.value);
}

/** Client users see one portfolio; if the demo scenario changed, they follow its first portfolio. */
export function clientPortfolio(u: SessionUser, store: Store) {
  return u.portfolio && store.portfolios.includes(u.portfolio) ? u.portfolio : store.portfolios[0];
}

export function scopeFor(u: SessionUser, store: Store): Scope {
  return u.role === "client" ? { portfolio: clientPortfolio(u, store), visibleOnly: true } : {};
}

export const can = (u: SessionUser, a: Action) => roleCan(u.role, a);
