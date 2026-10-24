import { useMemo } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

import { formatDay, formatNumber } from '@/lib/format';

export interface ChartSeries {
  key: string;
  label: string;
  /** A CSS color, normally a categorical token: var(--series-1). */
  color: string;
}

type Row = { day: string } & Record<string, number | string | null>;

interface TooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: { dataKey?: string | number; value?: number | null; color?: string }[];
}

/**
 * One chart = one measure on one axis (never two scales). Days before stats tracking started have no data —
 * they are drawn as gaps and the tooltip says "Not tracked yet", instead of a misleading zero.
 */
export function DailyChart({
  data,
  series,
  kind = 'bar',
  stacked = false,
  format = (v) => formatNumber(v),
  height = 200,
  trackedFrom,
  ariaLabel,
}: {
  data: readonly { day: string }[];
  series: ChartSeries[];
  kind?: 'bar' | 'line';
  stacked?: boolean;
  format?: (value: number) => string;
  height?: number;
  /** First tracked day ("YYYY-MM-DD"); earlier days show as gaps. Omit for metrics that exist before tracking. */
  trackedFrom?: string | null;
  ariaLabel: string;
}) {
  const rows = useMemo(
    (): Row[] =>
      trackedFrom === undefined
        ? (data as Row[])
        : (data as Row[]).map((d) =>
            trackedFrom === null || d.day < trackedFrom
              ? { ...d, ...Object.fromEntries(series.map((s) => [s.key, null])), __untracked: 1 }
              : d,
          ),
    [data, series, trackedFrom],
  );

  // Counts get whole-number ticks; fractional measures (USD cost) need decimal ticks, or a $0.20 day draws as a
  // sliver under a forced $0–$4 axis.
  const fractional = useMemo(
    () => rows.some((r) => series.some((s) => typeof r[s.key] === 'number' && !Number.isInteger(r[s.key]))),
    [rows, series],
  );

  const tick = { fill: 'var(--text-3)', fontSize: 11 };
  const tickEvery = Math.max(0, Math.ceil(rows.length / 8) - 1);

  const renderTooltip = ({ active, payload, label }: TooltipProps) => {
    if (!active || !payload?.length) return null;
    const row = rows.find((r) => r.day === label);
    const untracked = !!row?.__untracked;
    const total = payload.reduce((s, p) => s + (typeof p.value === 'number' ? p.value : 0), 0);
    return (
      <div className="min-w-40 rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-[var(--shadow-lg)]">
        <p className="mb-1 font-medium text-text">{formatDay(String(label), { withYear: true })}</p>
        {untracked ? (
          <p className="text-text-3">Not tracked yet</p>
        ) : (
          <>
            {[...payload].reverse().map((p) => {
              const s = series.find((x) => x.key === p.dataKey);
              return (
                <div key={String(p.dataKey)} className="flex items-center justify-between gap-4">
                  <span className="flex items-center gap-1.5 text-text-2">
                    <span className="size-2 rounded-sm" style={{ background: s?.color }} />
                    {s?.label}
                  </span>
                  <span className="font-medium text-text tabular">{format(Number(p.value ?? 0))}</span>
                </div>
              );
            })}
            {stacked && payload.length > 1 && (
              <div className="mt-1 flex justify-between gap-4 border-t border-border pt-1">
                <span className="text-text-2">Total</span>
                <span className="font-medium text-text tabular">{format(total)}</span>
              </div>
            )}
          </>
        )}
      </div>
    );
  };

  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
      <XAxis
        dataKey="day"
        tickFormatter={(d: string) => formatDay(d)}
        tick={tick}
        tickLine={false}
        axisLine={{ stroke: 'var(--border)' }}
        interval={tickEvery}
        minTickGap={8}
      />
      <YAxis
        tick={tick}
        tickLine={false}
        axisLine={false}
        width={52}
        tickFormatter={(v: number) => format(v)}
        domain={[0, 'auto']}
        allowDecimals={fractional}
      />
      <Tooltip content={renderTooltip as never} cursor={{ fill: 'var(--surface-2)', stroke: 'var(--border-strong)' }} />
    </>
  );

  return (
    <div role="img" aria-label={ariaLabel}>
      {series.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-2">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <ResponsiveContainer width="100%" height={height}>
        {kind === 'line' ? (
          <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            {axes}
            {series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stroke={s.color}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        ) : (
          <BarChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
            {axes}
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId={stacked ? 'a' : undefined}
                fill={s.color}
                stroke="var(--surface)"
                strokeWidth={stacked ? 1 : 0}
                radius={!stacked || i === series.length - 1 ? [3, 3, 0, 0] : 0}
                maxBarSize={28}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/** A horizontal share bar for "top N" lists (no chart library needed). */
export function ShareBar({ value, max, color = 'var(--series-1)' }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3" aria-hidden>
      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}
