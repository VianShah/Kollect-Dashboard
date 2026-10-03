"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useApp } from "@/components/ctx";
import { useApi } from "@/components/useApi";
import { localStore } from "@/components/local";
import { C, Card, ErrorNote, Kpi, Loading, Offline, axisProps, tooltipStyle } from "@/components/ui";
import { computeUsage } from "@/lib/metrics";
import { num, shortDay } from "@/lib/format";

export default function Usage() {
  const { qs, filters, scope } = useApp();
  const { data, offline, error } = useApi(`/api/usage?${qs}`, () => computeUsage(localStore(), filters, scope));
  if (error) return <ErrorNote text={error} />;
  if (!data) return <Loading />;
  const { kpis: k } = data;
  return (
    <>
      <Offline show={offline} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Billable minutes" value={num(k.minutes)} sub="Connected talk time, rounded up" />
        <Kpi label="Connected calls" value={num(k.connectedCalls)} />
        <Kpi label="Average per call" value={`${k.avgMinPerCall.toFixed(1)} min`} />
        <Kpi label="Portfolios billed" value={k.verticals} />
      </div>
      <Card title="Daily usage" sub="Billable connected minutes per day">
        <ResponsiveContainer width="100%" height={270}>
          <BarChart data={data.dailyMinutes} margin={{ left: -12 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDay} {...axisProps} minTickGap={24} /><YAxis {...axisProps} />
            <Tooltip {...tooltipStyle} cursor={{ fill: "#f1eee8" }} labelFormatter={(l) => shortDay(String(l))} formatter={(v) => [`${num(Number(v))} min`, "Minutes"]} />
            <Bar dataKey="minutes" fill={C.brand} radius={[2, 2, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </Card>
      <Card title="Usage by campaign" pad={false}>
        <div className="overflow-x-auto">
          <table className="table w-full whitespace-nowrap">
            <thead><tr><th>Campaign</th><th>Product</th><th className="text-right">Connected calls</th><th className="text-right">Raw seconds</th><th className="text-right">Billable minutes</th></tr></thead>
            <tbody>{data.campaigns.map((c) => (
              <tr key={c.campaign}><td className="font-mono text-[12.5px]">{c.campaign}</td><td>{c.product}</td><td className="text-right num">{num(c.calls)}</td><td className="text-right num">{num(c.seconds)}</td><td className="text-right font-medium num">{num(c.billableMinutes)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
