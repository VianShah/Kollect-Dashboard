"use client";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useApp } from "@/components/ctx";
import { post, useApi } from "@/components/useApi";
import { localStore } from "@/components/local";
import { Card, ErrorNote, Loading, Offline } from "@/components/ui";
import { FALLBACK_LANGUAGE, LANGUAGES } from "@/lib/languages";
import { languageUnserved } from "@/lib/mock";
import { can } from "@/lib/roles";
import type { Agent } from "@/lib/types";

interface LangRow { name: string; code: string; voice: string; script: string; enabled: boolean; borrowers: number }
interface Data { agents: Agent[]; globalMax: number; live: number; languages: LangRow[]; fallback: string; unserved: number }

function Meter({ live, max }: { live: number; max: number }) {
  const p = Math.min(100, (live / (max || 1)) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 rounded-full bg-sunk"><div className={`h-1.5 rounded-full ${p >= 85 ? "bg-bad" : "bg-brand"}`} style={{ width: `${p}%` }} /></div>
      <span className="text-[12px] num">{live}/{max}</span>
    </div>
  );
}

export default function Channels() {
  const { user, meta, refreshMeta } = useApp();
  const canEdit = can(user.role, "editCapacity");
  const fallback = (): Data => {
    const s = localStore();
    return {
      agents: s.agents, globalMax: s.globalMax, live: s.agents.reduce((a, x) => a + x.live, 0), fallback: FALLBACK_LANGUAGE,
      languages: LANGUAGES.map((l) => ({ ...l, enabled: s.languages.includes(l.name), borrowers: s.borrowers.filter((b) => b.language === l.name).length })),
      unserved: s.borrowers.filter((b) => languageUnserved(b, s.languages)).length,
    };
  };
  const { data, setData, offline, error } = useApi<Data>("/api/channels", fallback, 5000);
  const [gm, setGm] = useState("");
  const [product, setProduct] = useState("all");
  const [lang, setLang] = useState("all");
  const [langMsg, setLangMsg] = useState("");
  useEffect(() => { if (data && gm === "") setGm(String(data.globalMax)); }, [data, gm]);
  const groups = useMemo(() => {
    const list = (data?.agents ?? []).filter((a) => (product === "all" || a.product === product || a.product === "All") && (lang === "all" || a.language === lang || a.language === "Multilingual"));
    const m = new Map<string, Agent[]>();
    list.forEach((a) => m.set(a.product, [...(m.get(a.product) ?? []), a]));
    return [...m.entries()];
  }, [data, product, lang]);
  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading rows={1} />;

  async function patch(body: object, local: (d: Data) => Data) {
    const r = await post("/api/channels", body, "PATCH");
    if (r.ok) { setData(r.json); setGm(String(r.json.globalMax)); refreshMeta(); } else setData((cur) => (cur ? local(cur) : cur));
  }
  async function toggleLanguage(name: string, on: boolean) {
    if (!data) return;
    const next = data.languages.filter((l) => (l.name === name ? on : l.enabled)).map((l) => l.name);
    const r = await post("/api/channels", { languages: next }, "PATCH");
    if (r.ok) { setData(r.json); setLangMsg(`${name} ${on ? "switched on. Voice campaigns were added for every product." : "switched off. Its voice campaigns were removed."}`); refreshMeta(); }
    else setLangMsg(r.json.error ?? "Couldn't change the language.");
  }
  const recalcLocal = (cur: Data, globalMax: number): Data => {
    const total = cur.agents.reduce((s, a) => s + a.max, 0) || 1;
    const agents = cur.agents.map((a) => { const max = Math.max(1, Math.round((a.max / total) * globalMax)); return { ...a, max, live: Math.min(a.live, max) }; });
    return { ...cur, agents, globalMax, live: agents.reduce((s, a) => s + a.live, 0) };
  };
  const pctUsed = Math.min(100, (data.live / data.globalMax) * 100);

  return (
    <>
      <Offline show={offline} />
      <Card title="Global capacity" sub="Concurrent calls across every agent. Refreshes every 5 seconds.">
        <div className="flex flex-wrap items-end gap-6">
          <div className="min-w-64 flex-1">
            <div className="flex items-baseline gap-2"><span className="text-[32px] font-semibold leading-none num">{data.live}</span><span className="text-muted num">of {data.globalMax} lines in use</span></div>
            <div className="mt-3 h-2.5 rounded-full bg-sunk"><div className={`h-2.5 rounded-full ${pctUsed >= 85 ? "bg-bad" : "bg-brand"}`} style={{ width: `${pctUsed}%` }} /></div>
          </div>
          {canEdit && (
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); const v = Number(gm); if (v > 0) patch({ globalMax: v, recalculate: true }, (c) => recalcLocal(c, v)); }}>
              <label className="text-[12px] text-muted">Global max<input className="input mt-1 block w-24" type="number" min={1} value={gm} onChange={(e) => setGm(e.target.value)} /></label>
              <button className="btn btn-primary"><RefreshCw size={14} aria-hidden="true" />Rebalance agents</button>
            </form>
          )}
        </div>
      </Card>
      <Card title="Languages" sub={canEdit
        ? "Switch on the languages you will call and message in. Each one gets its own voice campaign for every product. Borrowers are reached in their own language when it is on."
        : "Languages the lender has switched on for calls and messages."}>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {data.languages.map((l) => (
            <label key={l.name} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[13px] ${l.enabled ? "border-brand/40 bg-brand-soft" : "border-line bg-surface"} ${canEdit && l.name !== data.fallback ? "cursor-pointer" : ""}`}>
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]" checked={l.enabled}
                disabled={!canEdit || offline || l.name === data.fallback} onChange={(e) => toggleLanguage(l.name, e.target.checked)} />
              <span className="min-w-0">
                <span className="block font-medium">{l.name} <span className="font-normal text-muted">{l.script !== l.name ? `· ${l.script}` : ""}</span></span>
                <span className="block text-[12px] text-muted num">{l.borrowers} borrowers · voice {l.voice}</span>
                {l.name === data.fallback && <span className="block text-[11.5px] text-muted">Always on, used as the fallback</span>}
              </span>
            </label>
          ))}
        </div>
        {data.unserved > 0 && (
          <p className="mt-3 rounded-md border border-warn/30 bg-warn-soft px-3 py-2 text-[12.5px] text-warn">
            {data.unserved} borrowers speak a language that isn&apos;t switched on. They are contacted in {data.fallback} until you enable it.
          </p>
        )}
        {langMsg && <p className="mt-2 text-[12.5px] text-ink-2" role="status">{langMsg}</p>}
      </Card>
      <div className="flex flex-wrap items-center gap-2">
        <div className="seg" role="group" aria-label="Product">
          <button aria-pressed={product === "all"} onClick={() => setProduct("all")}>All products</button>
          {meta.products.map((p) => <button key={p} aria-pressed={product === p} onClick={() => setProduct(p)}>{p}</button>)}
        </div>
        <select aria-label="Language" className="input" value={lang} onChange={(e) => setLang(e.target.value)}>
          <option value="all">All languages</option>
          {data.languages.filter((l) => l.enabled).map((l) => <option key={l.name} value={l.name}>{l.name}</option>)}
        </select>
      </div>
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="table w-full whitespace-nowrap">
            <thead><tr><th>Agent</th><th>Campaign code</th><th>Language</th><th>Voice</th><th>Live / max</th>{canEdit && <th>Max</th>}<th>Feedback</th></tr></thead>
            {groups.map(([prod, agents]) => (
              <tbody key={prod}>
                <tr><td colSpan={canEdit ? 7 : 6} className="bg-sunk/60 py-1.5 text-[11.5px] font-semibold uppercase tracking-[0.05em] text-muted">{prod === "All" ? "Shared" : prod}</td></tr>
                {agents.map((a) => (
                  <tr key={a.id}>
                    <td className="font-medium">{a.name}</td>
                    <td className="font-mono text-[12px] text-ink-2">{a.code}</td><td>{a.language}</td><td>{a.voice}</td>
                    <td><Meter live={a.live} max={a.max} /></td>
                    {canEdit && <td><input aria-label={`Max for ${a.name}`} className="input w-16" type="number" min={0} defaultValue={a.max} key={a.max}
                      onBlur={(e) => { const v = Number(e.target.value); if (v !== a.max && v >= 0) patch({ agentId: a.id, max: v }, (c) => ({ ...c, agents: c.agents.map((x) => (x.id === a.id ? { ...x, max: v, live: Math.min(x.live, v) } : x)) })); }} /></td>}
                    <td className="space-x-1 text-[12px]">
                      <span className="rounded bg-good-soft px-1.5 py-0.5 text-good num">{a.resolved} resolved</span>
                      {a.open > 0 && <span className="rounded bg-warn-soft px-1.5 py-0.5 text-warn num">{a.open} open</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
      </Card>
    </>
  );
}
