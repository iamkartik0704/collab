"use client";

import { useState } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatCompactInr, formatDay, formatInteger } from "@/lib/admin/format";
import { formatMoney } from "@/lib/utils";

/**
 * Dashboard charts. Palette: categorical slots 1-2 of the validated reference palette
 * (blue #2a78d6, orange #eb6834 - passes lightness, chroma, CVD and contrast checks on white).
 * One measure per chart (no dual axes); revenue and order counts are separate plots.
 */
const SERIES = { gross: "#2a78d6", net: "#eb6834", orders: "#2a78d6" } as const;
const GRID = "#ebebeb";
const AXIS = "#656565";

interface TipProps {
  active?: boolean | undefined;
  payload?: ReadonlyArray<{ value?: unknown; payload?: unknown }> | undefined;
  label?: unknown;
}

export interface SeriesPoint {
  date: string;
  gross: number;
  net: number;
  orders: number;
  refunds: number;
}

function RevenueTooltip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0]!.payload as SeriesPoint;
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-semibold">{formatDay(String(label))}</p>
      <p className="flex items-center gap-2">
        <span className="inline-block h-0.5 w-3" style={{ background: SERIES.gross }} aria-hidden /> Gross <span className="ml-auto font-medium tabular-nums">{formatMoney(point.gross)}</span>
      </p>
      <p className="flex items-center gap-2">
        <span className="inline-block h-0.5 w-3" style={{ background: SERIES.net }} aria-hidden /> Net <span className="ml-auto font-medium tabular-nums">{formatMoney(point.net)}</span>
      </p>
      {point.refunds > 0 && <p className="mt-1 text-muted-2">Refunds {formatMoney(point.refunds)}</p>}
    </div>
  );
}

function OrdersTooltip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-white px-3 py-2 text-xs shadow-lg">
      <p className="font-semibold">{formatDay(String(label))}</p>
      <p className="tabular-nums">{formatInteger(Number(payload[0]!.value))} orders</p>
    </div>
  );
}

function Legend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <ul className="flex flex-wrap gap-4 text-xs text-muted-2" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: item.color }} aria-hidden />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function tickInterval(points: number): number {
  return points <= 10 ? 0 : Math.ceil(points / 8) - 1;
}

export function RevenueChart({ series }: { series: SeriesPoint[] }) {
  const [asTable, setAsTable] = useState(false);
  const last = series.at(-1);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-4">
        <Legend items={[{ label: "Gross revenue", color: SERIES.gross }, { label: "Net of refunds", color: SERIES.net }]} />
        <button type="button" onClick={() => setAsTable((value) => !value)} className="text-xs font-medium text-muted-2 underline-offset-4 hover:text-ink hover:underline">
          {asTable ? "Show chart" : "View as table"}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-2">
                <th className="py-1.5 font-medium">Day</th>
                <th className="py-1.5 text-right font-medium">Gross</th>
                <th className="py-1.5 text-right font-medium">Net</th>
                <th className="py-1.5 text-right font-medium">Orders</th>
              </tr>
            </thead>
            <tbody>
              {series.map((point) => (
                <tr key={point.date} className="border-t border-line tabular-nums">
                  <td className="py-1.5">{formatDay(point.date)}</td>
                  <td className="py-1.5 text-right">{formatMoney(point.gross)}</td>
                  <td className="py-1.5 text-right">{formatMoney(point.net)}</td>
                  <td className="py-1.5 text-right">{point.orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="h-72" role="img" aria-label={`Daily gross and net revenue${last ? `; latest day ${formatMoney(last.gross)} gross` : ""}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="date" tickFormatter={formatDay} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={{ stroke: GRID }} interval={tickInterval(series.length)} />
              <YAxis tickFormatter={formatCompactInr} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} width={64} />
              <Tooltip content={(props) => <RevenueTooltip active={props.active} payload={props.payload} label={props.label} />} cursor={{ stroke: "#909090", strokeDasharray: "3 3" }} />
              <Line type="monotone" dataKey="gross" stroke={SERIES.gross} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
              <Line type="monotone" dataKey="net" stroke={SERIES.net} strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function OrdersChart({ series }: { series: SeriesPoint[] }) {
  return (
    <div className="h-56" role="img" aria-label="Orders placed per day">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap={2}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis dataKey="date" tickFormatter={formatDay} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={{ stroke: GRID }} interval={tickInterval(series.length)} />
          <YAxis allowDecimals={false} tick={{ fill: AXIS, fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
          <Tooltip content={(props) => <OrdersTooltip active={props.active} payload={props.payload} label={props.label} />} cursor={{ fill: "#f6f6f6" }} />
          <Bar dataKey="orders" fill={SERIES.orders} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
