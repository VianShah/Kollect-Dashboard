"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const DEMO = [
  ["admin", "Super Admin", "Everything, including data upload and rules"],
  ["supervisor", "Supervisor", "Capacity, QA and the audit trail"],
  ["operator", "Operator", "Borrower queue, follow-ups and call audit"],
  ["client", "Client", "Their own portfolio, read-only"],
] as const;

export default function Login() {
  const router = useRouter();
  const [username, setU] = useState("admin");
  const [password, setP] = useState("kollect123");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr("");
    const res = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) }).catch(() => null);
    setBusy(false);
    if (res?.ok) { router.replace("/home"); router.refresh(); return; }
    const body = await res?.json().catch(() => null);
    setErr(!res ? "The server isn't responding." : res.status === 401 ? "That username and password don't match." : body?.error ?? "Sign-in failed. Try again.");
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="hidden flex-col justify-between bg-night p-12 text-night-text lg:flex">
        <div className="flex items-center gap-2.5">
          <svg width="30" height="30" viewBox="0 0 26 26" aria-hidden="true"><rect width="26" height="26" rx="6" fill="#0e6b50" /><path d="M8 6.5v13M8 13.5l7.5-7M11 11l6 8.5" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none" /></svg>
          <span className="text-[18px] font-semibold text-white">Kollect</span><span className="text-[13px]">by Predixion AI</span>
        </div>
        <div className="max-w-md">
          <h1 className="text-[34px] font-semibold leading-[1.15] tracking-tight text-white">Every call, message and promise in one place.</h1>
          <p className="mt-4 text-[15px] leading-relaxed">AI voice and WhatsApp outreach, human escalation and compliance for NBFCs, banks and BNPL lenders.</p>
        </div>
        <dl className="grid max-w-md grid-cols-3 gap-6 border-t border-white/10 pt-6 text-[12px]">
          <div><dt>Channels</dt><dd className="mt-1 text-[14px] text-white">Voice · WhatsApp · Human</dd></div>
          <div><dt>Languages</dt><dd className="mt-1 text-[14px] text-white">Hindi · English · and 8 more</dd></div>
          <div><dt>Guardrails</dt><dd className="mt-1 text-[14px] text-white">Hours, caps, consent</dd></div>
        </dl>
      </section>
      <section className="flex items-center justify-center bg-ground p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <h2 className="text-[22px] font-semibold tracking-tight">Sign in</h2>
          <p className="mt-1 text-[13px] text-muted">Use one of the demo accounts below.</p>
          <label className="mt-6 block text-[13px] font-medium" htmlFor="u">Username</label>
          <input id="u" className="input mt-1 w-full" autoComplete="username" value={username} onChange={(e) => setU(e.target.value)} />
          <label className="mt-4 block text-[13px] font-medium" htmlFor="p">Password</label>
          <input id="p" type="password" className="input mt-1 w-full" autoComplete="current-password" value={password} onChange={(e) => setP(e.target.value)} />
          {err && <p className="mt-3 text-[13px] text-bad" role="alert">{err}</p>}
          <button className="btn btn-primary mt-5 w-full min-h-10" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          <fieldset className="mt-8">
            <legend className="label">Demo accounts · password kollect123</legend>
            <div className="mt-2 divide-y divide-line rounded-md border border-line bg-surface">
              {DEMO.map(([u, role, what]) => (
                <button type="button" key={u} onClick={() => { setU(u); setP("kollect123"); }} aria-pressed={username === u}
                  className={`flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-sunk/60 ${username === u ? "bg-brand-soft" : ""}`}>
                  <span className="w-20 font-mono text-[12.5px]">{u}</span>
                  <span className="min-w-0"><span className="block text-[13px] font-medium">{role}</span><span className="block text-[12px] text-muted">{what}</span></span>
                </button>
              ))}
            </div>
          </fieldset>
        </form>
      </section>
    </main>
  );
}
