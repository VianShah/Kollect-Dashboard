import { NextResponse } from "next/server";
import { COOKIE, USERS, demoUsersEnabled, isProduction, makeToken, passwordMatches } from "@/lib/auth";
import { audit, getStore, saveStore } from "@/lib/store";

const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const g = globalThis as unknown as { __kollectLogins?: Map<string, { n: number; first: number }> };
const attempts = (g.__kollectLogins ??= new Map());

export async function POST(req: Request) {
  if (!demoUsersEnabled)
    return NextResponse.json({ error: "Sign-in is not configured. Connect your identity provider before going live." }, { status: 503 });
  const { username, password } = await req.json().catch(() => ({}));
  const name = typeof username === "string" ? username.slice(0, 40) : "";
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const key = `${name}|${ip}`;
  const now = Date.now();
  const seen = attempts.get(key);
  if (seen && now - seen.first < LOCK_MS && seen.n >= MAX_FAILURES)
    return NextResponse.json({ error: "Too many failed attempts. Try again in 15 minutes." }, { status: 429 });

  const u = USERS.find((x) => x.username === name);
  const ok = !!u && typeof password === "string" && passwordMatches(password, u.password);
  const store = getStore();
  if (!u || !ok) {
    attempts.set(key, seen && now - seen.first < LOCK_MS ? { n: seen.n + 1, first: seen.first } : { n: 1, first: now });
    audit(store, { username: name || "unknown", role: u?.role ?? "client" }, "login_failed", "Sign-in", "Wrong username or password");
    saveStore(store, { throttle: true });
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  attempts.delete(key);
  audit(store, u, "login", "Sign-in", "");
  saveStore(store, { throttle: true });
  const { password: _pw, ...user } = u;
  const res = NextResponse.json({ user });
  res.cookies.set(COOKIE, makeToken(user), { httpOnly: true, sameSite: "lax", secure: isProduction, path: "/", maxAge: 8 * 3600 });
  return res;
}
