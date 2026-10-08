'use client';

import { useState } from 'react';
import type { TypeCounts } from '@/lib/types';

const SERIES: Array<{ key: keyof TypeCounts; label: string; color: string }> = [
  { key: 'known', label: 'Registered', color: '#34d399' },
  { key: 'uncertain', label: 'Uncertain', color: '#fbbf24' },
  { key: 'unknown', label: 'Unrecognized', color: '#f87171' },
];

export function Legend() {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-ink-300">
      {SERIES.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </span>
      ))}
    </div>
  );
}

/** Stacked bar chart of event counts by type. */
export function StackedBars<T extends TypeCounts>({ data, label, height = 200 }: { data: T[]; label: (d: T) => string; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.known + d.unknown + d.uncertain));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const w = 100 / Math.max(1, data.length);
  const chartH = height - 24;

  return (
    <div className="relative" style={{ height }}>
      <div className="absolute inset-y-0 left-0 flex w-8 flex-col-reverse justify-between pb-6 text-right text-[10px] text-ink-400 tabular-nums">
        {ticks.map((t) => (
          <span key={t}>{t}</span>
        ))}
      </div>
      <div className="absolute inset-y-0 right-0 left-10">
        <svg width="100%" height={chartH} preserveAspectRatio="none" viewBox={`0 0 100 ${chartH}`} className="overflow-visible">
          {ticks.map((t) => (
            <line key={t} x1="0" x2="100" y1={chartH - (t / top) * chartH} y2={chartH - (t / top) * chartH} stroke="#22304f" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
          ))}
          {data.map((d, i) => {
            let y = chartH;
            return (
              <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <rect x={i * w} y="0" width={w} height={chartH} fill={hover === i ? 'rgba(96,165,250,0.06)' : 'transparent'} />
                {SERIES.map((s) => {
                  const h = (d[s.key] / top) * chartH;
                  y -= h;
                  return h > 0 ? <rect key={s.key} x={i * w + w * 0.2} y={y} width={w * 0.6} height={h} fill={s.color} opacity={0.9} /> : null;
                })}
              </g>
            );
          })}
        </svg>
        <div className="flex">
          {data.map((d, i) => (
            <span key={i} className="truncate text-center text-[10px] text-ink-400" style={{ width: `${w}%` }}>
              {label(d)}
            </span>
          ))}
        </div>
        {hover !== null && data[hover] && (
          <div className="pointer-events-none absolute top-0 z-10 rounded-lg border border-ink-600 bg-ink-850 px-3 py-2 text-xs shadow-xl" style={{ left: `min(calc(${(hover + 0.5) * w}% ), calc(100% - 9rem))` }}>
            <p className="mb-1 font-medium text-ink-100">{label(data[hover])}</p>
            {SERIES.map((s) => (
              <p key={s.key} className="flex justify-between gap-4 text-ink-300">
                <span style={{ color: s.color }}>{s.label}</span>
                <span className="tabular-nums">{data[hover][s.key]}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function niceTicks(max: number): number[] {
  const step = max <= 4 ? 1 : max <= 10 ? 2 : Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 2 : 1);
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top; v += step) out.push(v);
  return out;
}
