"use client";
import { useMemo, useState } from "react";
import { Bot, Headphones, MessageCircle, MessageSquare, PhoneCall, RefreshCw } from "lucide-react";
import { useApp } from "@/components/ctx";
import { post, useApi } from "@/components/useApi";
import { localStore } from "@/components/local";
import { Card, ErrorNote, Loading, Offline } from "@/components/ui";
import { FALLBACK_LANGUAGE, LANGUAGES } from "@/lib/languages";
import { SESSIONS_PER_LINE, channelRows } from "@/lib/lines";
import { languageUnserved } from "@/lib/mock";
import { can } from "@/lib/roles";
import type { Agent, CommChannel } from "@/lib/types";

interface LangRow { name: string; code: string; voice: string; script: string; enabled: boolean; borrowers: number }
type ChannelRow = ReturnType<typeof channelRows>[number];
interface Data {
  agents: Agent[]; channels: ChannelRow[]; total: { live: number; capacity: number; lines: number; seats: number };
  languages: LangRow[]; fallback: string; unserved: number;
}

const ICON: Record<CommChannel, typeof Bot> = { "Voice agents": Bot, IVR: PhoneCall, WhatsApp: MessageCircle, SMS: MessageSquare, Telecallers: Headphones };
const n = (v: number) => v.toLocaleString("en-IN");

function Meter({ live, max, wide = false }: { live: number; max: number; wide?: boolean }) {
  const p = Math.min(100, (live / (max || 1)) * 100);
  return (
    <div className="flex items-center gap-2">
      <div className={`h-1.5 rounded-full bg-sunk ${wide ? "w-32" : "w-24"}`}><div className={`h-1.5 rounded-full ${p >= 85 ? "bg-bad" : "bg-brand"}`} style={{ width: `${p}%` }} /></div>
      <span className="text-[12px] num">{n(live)}/{n(max)}</span>
    </div>
  );
}

export default function Channels() {
  const { user, meta, refreshMeta } = useApp();
  const canEdit = can(user.role, "editCapacity");
  const fallback = (): Data => {
    const s = localStore();
    const channels = channelRows(s);
    return {
      agents: s.agents, channels,
      total: {
        live: channels.reduce((x, c) => x + c.live, 0), capacity: channels.reduce((x, c) => x + c.capacity, 0),
        lines: channels.filter((c) => c.unit === "line").reduce((x, c) => x + c.lines, 0), seats: channels.filter((c) => c.unit === "seat").reduce((x, c) => x + c.lines, 0),
      },
      fallback: FALLBACK_LANGUAGE,
      languages: LANGUAGES.map((l) => ({ ...l, enabled: s.languages.includes(l.name), borrowers: s.borrowers.filter((b) => b.language === l.name).length })),
      unserved: s.borrowers.filter((b) => languageUnserved(b, s.languages)).length,
    };
  };
  const { data, setData, offline, error } = useApi<Data>("/api/channels", fallback, 5000);
  const [product, setProduct] = useState("all");
  const [lang, setLang] = useState("all");
  const [langMsg, setLangMsg] = useState("");
  const [lineMsg, setLineMsg] = useState("");
  const groups = useMemo(() => {
    const list = (data?.agents ?? []).filter((a) => (product === "all" || a.product === product || a.product === "All") && (lang === "all" || a.language === lang || a.language === "Multilingual"));
    const m = new Map<string, Agent[]>();
    list.forEach((a) => m.set(a.product, [...(m.get(a.product) ?? []), a]));
    return [...m.entries()];
  }, [data, product, lang]);
  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading rows={1} />;

  async function patch(body: object) {
    const r = await post("/api/channels", body, "PATCH");
    if (r.ok) { setData(r.json); refreshMeta(); }
    return r;
  }
  async function toggleLanguage(name: string, on: boolean) {
    if (!data) return;
    const next = data.languages.filter((l) => (l.name === name ? on : l.enabled)).map((l) => l.name);
    const r = await patch({ languages: next });
    setLangMsg(r.ok ? `${name} ${on ? "switched on. Voice campaigns were added for every product." : "switched off. Its voice campaigns were removed."}` : r.json.error ?? "Couldn't change the language.");
  }
  async function setLines(c: ChannelRow, lines: number) {
    const r = await patch({ channel: c.key, lines });
    setLineMsg(r.ok ? `${c.key}: ${lines} ${c.unit}${lines === 1 ? "" : "s"}, ${n(lines * c.perLine)} concurrent${c.campaigns ? ". Shared evenly across its campaigns." : "."}` : r.json.error ?? "Couldn't change the lines.");
  }
  const pctUsed = Math.min(100, (data.total.live / (data.total.capacity || 1)) * 100);

  return (
    <>
      <Offline show={offline} />
      <Card title="Global capacity" sub={`Concurrent calls and conversations across every channel: ${data.total.lines} lines of ${SESSIONS_PER_LINE} plus ${data.total.seats} telecaller seats. Refreshes every 5 seconds.`}>
        <div className="flex items-baseline gap-2"><span className="text-[32px] font-semibold leading-none num">{n(data.total.live)}</span><span className="text-muted num">of {n(data.total.capacity)} concurrent sessions in use</span></div>
        <div className="mt-3 h-2.5 rounded-full bg-sunk"><div className={`h-2.5 rounded-full ${pctUsed >= 85 ? "bg-bad" : "bg-brand"}`} style={{ width: `${pctUsed}%` }} /></div>
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

      <Card pad={false} title="Communication channels"
        sub={`How borrowers are reached. Each line carries ${SESSIONS_PER_LINE} concurrent calls or conversations. Telecallers are people, counted by seat at one call each.`}>
        <div className="overflow-x-auto">
          <table className="table w-full">
            <thead><tr><th>Channel</th><th className="text-right">Lines / seats</th><th className="text-right">Capacity</th><th>Live now</th><th className="text-right">Campaigns</th></tr></thead>
            <tbody>
              {data.channels.map((c) => {
                const Icon = ICON[c.key];
                return (
                  <tr key={c.key}>
                    <td className="min-w-[260px]">
                      <div className="flex items-start gap-2.5">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-sunk text-ink-2"><Icon size={14} aria-hidden="true" /></span>
                        <span>
                          <span className="block font-medium">{c.key}</span>
                          <span className="block text-[12px] text-muted">{c.use}</span>
                        </span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {canEdit && !offline
                        ? <span className="inline-flex items-center gap-1.5">
                            <input aria-label={`${c.key} ${c.unit}s`} className="input w-16 text-right" type="number" min={0} max={c.maxLines} defaultValue={c.lines} key={c.lines}
                              onBlur={(e) => { const v = Number(e.target.value); if (Number.isInteger(v) && v !== c.lines) setLines(c, v); }} />
                            <span className="text-[12px] text-muted">{c.unit}s</span>
                          </span>
                        : <span className="num">{c.lines} {c.unit}{c.lines === 1 ? "" : "s"}</span>}
                    </td>
                    <td className="whitespace-nowrap text-right num">{n(c.capacity)}<span className="text-[12px] text-muted"> concurrent</span></td>
                    <td className="whitespace-nowrap"><Meter live={c.live} max={c.capacity} wide /></td>
                    <td className="text-right num">{c.campaigns || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {lineMsg && <p className="px-4 pb-3 text-[12.5px] text-ink-2" role="status">{lineMsg}</p>}
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
      <Card pad={false} title="Campaigns" sub="Each campaign's share of its channel's capacity."
        right={canEdit && !offline ? <button className="btn" onClick={() => patch({ recalculate: true }).then((r) => setLineMsg(r.ok ? "Capacity shared evenly within each channel." : r.json.error ?? "Couldn't rebalance."))}><RefreshCw size={14} aria-hidden="true" />Share capacity evenly</button> : undefined}>
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
                    {canEdit && <td><input aria-label={`Max for ${a.name}`} className="input w-20" type="number" min={0} defaultValue={a.max} key={a.max} disabled={offline}
                      onBlur={(e) => { const v = Number(e.target.value); if (v !== a.max && v >= 0) patch({ agentId: a.id, max: v }); }} /></td>}
                    <td className="text-[12px]">
                      <span className="inline-flex gap-1">
                        <span className="rounded bg-good-soft px-1.5 py-0.5 text-good num">{a.resolved} resolved</span>
                        {a.open > 0 && <span className="rounded bg-warn-soft px-1.5 py-0.5 text-warn num">{a.open} open</span>}
                      </span>
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
