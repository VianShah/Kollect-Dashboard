"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, ReactFlowProvider, addEdge, useEdgesState, useNodesState,
  type Connection, type Edge, type Node, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Trash2 } from "lucide-react";
import { CONDITION_LABEL, SLOT_LABEL, STEP_DEFS, TEMPLATES, stepDef } from "@/lib/campaigns";
import type { StepData, StepEdge, StepKind, StepNode } from "@/lib/types";

export interface AgentOption { code: string; name: string; channel: string; language: string; product: string }
type FlowNode = Node<StepData & { kind: StepKind } & Record<string, unknown>>;

function summary(kind: StepKind, d: StepData) {
  if (kind === "whatsapp" || kind === "sms") return [d.template ?? "No template", d.slot ? SLOT_LABEL[d.slot] : ""].filter(Boolean).join(" · ");
  if (kind === "voice" || kind === "ivr") return [d.agent === "auto" ? "Borrower's language" : d.agent ?? "No agent", d.slot ? SLOT_LABEL[d.slot] : ""].filter(Boolean).join(" · ");
  if (kind === "wait") return `${d.waitHours ?? 24} h`;
  if (kind === "branch") return d.condition ? CONDITION_LABEL[d.condition] : "No condition";
  if (kind === "telecaller") return `${d.seats ?? 1} seat${(d.seats ?? 1) === 1 ? "" : "s"}`;
  return stepDef(kind).hint;
}

function StepCard({ data, selected }: NodeProps<FlowNode>) {
  const def = stepDef(data.kind);
  return (
    <div className={`relative w-[180px] rounded-lg border bg-surface text-left shadow-sm ${selected ? "border-ink ring-2 ring-ink/15" : "border-line"}`} style={{ borderLeft: `4px solid ${def.color}` }}>
      {data.kind !== "start" && <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !bg-ink-2" />}
      <div className="px-3 py-2">
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: def.color }}>{def.title}</div>
        <div className="truncate text-[13px] font-medium">{data.label}</div>
        <div className="truncate text-[11.5px] text-muted">{summary(data.kind, data)}</div>
      </div>
      {data.kind === "branch" ? (
        <>
          <Handle id="yes" type="source" position={Position.Right} style={{ top: "30%" }} className="!h-2.5 !w-2.5 !bg-[#0e6b50]" title="yes" />
          <Handle id="no" type="source" position={Position.Right} style={{ top: "75%" }} className="!h-2.5 !w-2.5 !bg-[#b42318]" title="no" />        </>
      ) : data.kind !== "end" && <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !bg-ink-2" />}
    </div>
  );
}
const nodeTypes = { step: StepCard };

const toFlow = (nodes: StepNode[]): FlowNode[] => nodes.map((n) => ({ id: n.id, type: "step", position: { x: n.x, y: n.y }, data: { ...n.data, kind: n.kind } }));
const edgeStyle = (label?: string): Partial<Edge> => ({
  label, markerEnd: { type: MarkerType.ArrowClosed }, labelStyle: { fontSize: 11, fontWeight: 600, fill: label === "no" ? "#b42318" : "#0e6b50" },
  style: { stroke: label === "no" ? "#b42318" : label === "yes" ? "#0e6b50" : "#8b8f96", strokeWidth: 1.5 },
});
const toEdges = (edges: StepEdge[]): Edge[] => edges.map((e) => ({ id: e.id, source: e.source, target: e.target, sourceHandle: e.label, ...edgeStyle(e.label) }));

function Inner({ nodes: initialNodes, edges: initialEdges, agents, readOnly, onChange, allowed }: {
  nodes: StepNode[]; edges: StepEdge[]; agents: AgentOption[]; readOnly: boolean; onChange: (nodes: StepNode[], edges: StepEdge[]) => void;
  /** Channel step kinds this campaign may use; flow steps (wait, if/else, end) are always offered. */
  allowed?: StepKind[];
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(toFlow(initialNodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(toEdges(initialEdges));
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    onChange(
      nodes.map((n) => { const { kind, ...data } = n.data; return { id: n.id, kind, x: Math.round(n.position.x), y: Math.round(n.position.y), data }; }),
      edges.map((e) => ({ id: e.id, source: e.source, target: e.target, label: e.sourceHandle === "yes" || e.sourceHandle === "no" ? e.sourceHandle : undefined })),
    );
  }, [nodes, edges, onChange]);

  const onConnect = useCallback((c: Connection) => {
    setEdges((eds) => addEdge({ ...c, id: `e${Date.now()}`, ...edgeStyle(c.sourceHandle ?? undefined) }, eds.filter((e) => !(e.source === c.source && e.sourceHandle === c.sourceHandle))));
  }, [setEdges]);

  function add(kind: StepKind) {
    const id = `n${Date.now().toString(36)}`;
    const def = stepDef(kind);
    const data: StepData = { label: def.title };
    if (kind === "whatsapp" || kind === "sms") { data.template = "Payment link"; data.slot = "afternoon"; }
    if (kind === "voice" || kind === "ivr") { data.agent = "auto"; data.slot = "evening"; }
    if (kind === "wait") data.waitHours = 24;
    if (kind === "branch") data.condition = "paid";
    if (kind === "telecaller") data.seats = 1;
    const maxX = Math.max(0, ...nodes.map((n) => n.position.x));
    setNodes((ns) => [...ns, { id, type: "step", position: { x: maxX + 220, y: 160 }, data: { ...data, kind } }]);
    setSelected(id);
  }
  const sel = nodes.find((n) => n.id === selected);
  const update = (patch: Partial<StepData>) => setNodes((ns) => ns.map((n) => (n.id === selected ? { ...n, data: { ...n.data, ...patch } } : n)));
  const remove = () => { setNodes((ns) => ns.filter((n) => n.id !== selected)); setEdges((es) => es.filter((e) => e.source !== selected && e.target !== selected)); setSelected(null); };
  const agentList = useMemo(() => agents.filter((a) => (sel?.data.kind === "ivr" ? a.channel === "IVR" : a.channel === "AI Voice")), [agents, sel]);

  return (
    <div className="grid gap-3 xl:grid-cols-[1fr_280px]">
      <div className="card overflow-hidden">
        {!readOnly && (
          <div className="flex flex-wrap gap-1.5 border-b border-line px-3 py-2">
            <span className="label mr-1 self-center">Add step</span>
            {STEP_DEFS.filter((s) => s.kind !== "start" && (!allowed || ["wait", "branch", "end"].includes(s.kind) || allowed.includes(s.kind))).map((s) => (
              <button key={s.kind} className="btn min-h-7 px-2 text-[12px]" onClick={() => add(s.kind)} title={s.hint}>
                <span className="h-2 w-2 rounded-full" style={{ background: s.color }} aria-hidden="true" />{s.title}
              </button>
            ))}
          </div>
        )}
        <div className="h-[460px]">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} onNodesChange={readOnly ? undefined : onNodesChange} onEdgesChange={readOnly ? undefined : onEdgesChange}
            onConnect={readOnly ? undefined : onConnect} onNodeClick={(_, n) => setSelected(n.id)} onPaneClick={() => setSelected(null)}
            nodesDraggable={!readOnly} nodesConnectable={!readOnly} elementsSelectable deleteKeyCode={readOnly ? null : ["Backspace", "Delete"]}
            fitView fitViewOptions={{ padding: 0.15 }} proOptions={{ hideAttribution: true }}>
            <Background gap={18} color="#e7e3db" />
            <MiniMap pannable zoomable className="!hidden md:!block" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <p className="border-t border-line px-3 py-2 text-[12px] text-muted">
          {readOnly ? "Read-only. Pause the campaign to edit its workflow." : "Drag from a step's right dot to the next step's left dot to connect them. If / else steps have a green yes and a red no output. Select a step or line and press Delete to remove it."}
        </p>
      </div>

      <div className="card p-4">
        {!sel ? <p className="text-[13px] text-muted">Select a step to set it up.</p> : (
          <fieldset disabled={readOnly} className="space-y-3 text-[12px] text-muted">
            <div className="text-[11px] font-semibold uppercase tracking-[0.06em]" style={{ color: stepDef(sel.data.kind).color }}>{stepDef(sel.data.kind).title}</div>
            <p>{stepDef(sel.data.kind).hint}</p>
            <label className="block">Name<input className="input mt-1 block w-full" value={sel.data.label} maxLength={60} onChange={(e) => update({ label: e.target.value })} /></label>
            {(sel.data.kind === "whatsapp" || sel.data.kind === "sms") && (
              <label className="block">Template
                <select className="input mt-1 block w-full" value={sel.data.template ?? ""} onChange={(e) => update({ template: e.target.value })}>
                  {TEMPLATES.map((t) => <option key={t}>{t}</option>)}
                </select>
                <span className="mt-1 block">Sent in the borrower&apos;s language with the lender name and an opt-out line.</span>
              </label>
            )}
            {(sel.data.kind === "voice" || sel.data.kind === "ivr") && (
              <label className="block">Agent
                <select className="input mt-1 block w-full" value={sel.data.agent ?? "auto"} onChange={(e) => update({ agent: e.target.value })}>
                  <option value="auto">Auto: borrower&apos;s product and language</option>
                  {agentList.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}
                </select>
              </label>
            )}
            {["whatsapp", "sms", "voice", "ivr"].includes(sel.data.kind) && (
              <label className="block">When
                <select className="input mt-1 block w-full" value={sel.data.slot ?? "any"} onChange={(e) => update({ slot: e.target.value as StepData["slot"] })}>
                  {Object.entries(SLOT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            )}
            {sel.data.kind === "wait" && (
              <label className="block">Wait (hours)<input type="number" min={1} max={336} className="input mt-1 block w-full" value={sel.data.waitHours ?? 24} onChange={(e) => update({ waitHours: Number(e.target.value) })} /></label>
            )}
            {sel.data.kind === "branch" && (
              <label className="block">Check whether the borrower…
                <select className="input mt-1 block w-full" value={sel.data.condition ?? "paid"} onChange={(e) => update({ condition: e.target.value as StepData["condition"] })}>
                  {Object.entries(CONDITION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
            )}
            {sel.data.kind === "telecaller" && (
              <label className="block">Telecaller seats to use<input type="number" min={1} max={25} className="input mt-1 block w-full" value={sel.data.seats ?? 1} onChange={(e) => update({ seats: Number(e.target.value) })} /></label>
            )}
            {sel.data.kind !== "start" && <button type="button" className="btn btn-danger w-full" onClick={remove}><Trash2 size={14} aria-hidden="true" />Remove step</button>}
          </fieldset>
        )}
      </div>
    </div>
  );
}

export default function WorkflowCanvas(props: Parameters<typeof Inner>[0]) {
  return <ReactFlowProvider><Inner {...props} /></ReactFlowProvider>;
}
