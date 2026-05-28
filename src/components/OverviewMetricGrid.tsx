'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';

type MetricPanel = {
  title: string;
  value: string;
  sublabel?: string;
  href: string;
  icon: string;
  variant: 'line' | 'bars';
  series: number[];
  labels: string[];
};

type ActivePoint = {
  index: number;
  value: number;
  x: number;
  y: number;
};

function MetricIcon({ type }: { type: string }) {
  const common = 'h-4 w-4';

  if (type === 'target') {
    return (
      <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 20.5a8.5 8.5 0 100-17 8.5 8.5 0 000 17z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 16a4 4 0 100-8 4 4 0 000 8z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 12h.01" />
      </svg>
    );
  }

  if (type === 'check') {
    return (
      <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M5 12.5l4.2 4.2L19.5 6.5" />
      </svg>
    );
  }

  if (type === 'clock') {
    return (
      <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 7.5v4.8l3.2 1.9" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 21a9 9 0 100-18 9 9 0 000 18z" />
      </svg>
    );
  }

  if (type === 'topic') {
    return (
      <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 4.5l7.1 5.1-2.7 8.2H7.6L4.9 9.6 12 4.5z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 9v4.2" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M12 16h.01" />
      </svg>
    );
  }

  if (type === 'flask') {
    return (
      <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M8.5 4h7M9.5 4v6.4L6.3 18a1.6 1.6 0 001.5 2.2h8.4a1.6 1.6 0 001.5-2.2l-3.2-7.6V4" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M8 15h8" />
      </svg>
    );
  }

  return (
    <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.7} d="M5 6.5h14M5 12h14M5 17.5h9" />
    </svg>
  );
}

function formatValue(panel: MetricPanel, value: number) {
  if (panel.title === 'Avg MOS') return value.toFixed(1);
  if (panel.title === 'Latency p95') return `${value.toFixed(1)}s`;
  if (panel.title === 'Task completion') return `${Math.round(value)}%`;
  return Math.round(value).toString();
}

function linePoints(series: number[]) {
  const min = Math.min(...series);
  const max = Math.max(...series);
  const range = max - min || 1;

  return series.map((value, index) => {
    const x = 40 + (index / Math.max(series.length - 1, 1)) * 340;
    const y = 88 - ((value - min) / range) * 48;
    return { index, value, x, y };
  });
}

function pathFor(points: ActivePoint[]) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
}

function InteractiveLine({ panel }: { panel: MetricPanel }) {
  const points = linePoints(panel.series);
  const [active, setActive] = useState<ActivePoint | null>(null);
  const valueText = active ? formatValue(panel, active.value) : '';

  return (
    <div className="relative mt-5 h-28" onMouseLeave={() => setActive(null)}>
      <div className="absolute inset-x-0 bottom-3 border-t border-slate-200" />
      <div className="absolute bottom-3 left-10 right-4 flex justify-between text-[11px] text-slate-400">
        <span>09 AM</span>
        <span>12 PM</span>
        <span>03 PM</span>
      </div>
      <div className="absolute bottom-3 left-10 top-1.5 flex flex-col justify-between text-[11px] text-slate-400">
        <span>1</span>
        <span>0.5</span>
        <span>0</span>
      </div>
      <svg viewBox="0 0 420 110" className="absolute inset-x-8 top-1.5 h-[72px] w-[calc(100%-4rem)] overflow-visible">
        <path d={pathFor(points)} fill="none" stroke="#2f5ae0" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" />
        <path d={`${pathFor(points)} L 380 96 L 40 96 Z`} fill="url(#overview-line-fill)" opacity="0.18" />
        <defs>
          <linearGradient id="overview-line-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#2f5ae0" />
            <stop offset="100%" stopColor="#2f5ae0" stopOpacity="0" />
          </linearGradient>
        </defs>
        {points.map((point) => (
          <g key={point.index}>
            <circle
              cx={point.x}
              cy={point.y}
              r="12"
              fill="transparent"
              onMouseEnter={() => setActive(point)}
            />
            <circle
              cx={point.x}
              cy={point.y}
              r={active?.index === point.index ? 3.6 : 2.5}
              fill={active?.index === point.index ? '#2f5ae0' : '#ffffff'}
              stroke="#2f5ae0"
              strokeWidth="1.8"
              className="transition-all"
            />
          </g>
        ))}
        {active ? <line x1={active.x} x2={active.x} y1="16" y2="96" stroke="#cbd5e1" strokeDasharray="3 4" /> : null}
      </svg>
      {active ? (
        <div
          className="pointer-events-none absolute rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 shadow-sm"
          style={{ left: `calc(${(active.x / 420) * 100}% + 10px)`, top: `${Math.max(active.y - 8, 8)}px` }}
        >
          <span className="tabular">{valueText}</span>
          <span className="ml-1 text-slate-400">{panel.labels[active.index]}</span>
        </div>
      ) : null}
    </div>
  );
}

function InteractiveBars({ panel }: { panel: MetricPanel }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const activeValue = activeIndex === null ? 0 : (panel.series[activeIndex] ?? panel.series[0] ?? 0);

  return (
    <div className="relative mt-5 h-28" onMouseLeave={() => setActiveIndex(null)}>
      <div className="absolute inset-x-0 bottom-3 border-t border-slate-200" />
      <div className="absolute bottom-3 left-10 right-4 flex justify-between text-[11px] text-slate-400">
        <span>09 AM</span>
        <span>12 PM</span>
        <span>03 PM</span>
      </div>
      <div className="absolute bottom-3 left-10 top-1.5 flex flex-col justify-between text-[11px] text-slate-400">
        <span>1</span>
        <span>0.5</span>
        <span>0</span>
      </div>
      <div className="absolute bottom-8 left-20 right-16 flex h-20 items-end gap-2">
        {panel.series.map((value, index) => (
          <span
            key={`${panel.title}-${index}`}
            className={`flex-1 rounded-t transition-all ${activeIndex === index ? 'bg-[#2f5ae0]' : 'bg-slate-300 hover:bg-slate-400'}`}
            style={{ height: `${Math.max(18, value)}%` }}
            onMouseEnter={() => setActiveIndex(index)}
          />
        ))}
      </div>
      {activeIndex !== null ? (
        <div className="absolute right-4 top-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] text-slate-700 shadow-sm">
          <span className="tabular">{formatValue(panel, activeValue)}</span>
          <span className="ml-1 text-slate-400">{panel.labels[activeIndex]}</span>
        </div>
      ) : null}
    </div>
  );
}

function MetricCard({ panel }: { panel: MetricPanel }) {
  const [isFocused, setIsFocused] = useState(false);

  return (
    <Link
      href={panel.href}
      className="card group block min-h-[204px] bg-white p-4 transition-colors hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-[#cfd8ff]"
      onFocus={() => setIsFocused(true)}
      onBlur={() => setIsFocused(false)}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-slate-900">
          <span className="text-slate-700 transition-colors group-hover:text-[#2f5ae0]">
            <MetricIcon type={panel.icon} />
          </span>
          <h2 className="text-sm font-semibold tracking-[-0.01em]">{panel.title}</h2>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-[1.45rem] font-semibold leading-none tracking-[-0.02em] text-slate-950">
            {panel.value}
          </span>
          <span className={`text-xs text-slate-400 transition-opacity ${isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            View
          </span>
        </div>
      </div>
      {panel.variant === 'bars' ? <InteractiveBars panel={panel} /> : <InteractiveLine panel={panel} />}
    </Link>
  );
}

export function OverviewMetricGrid({ panels }: { panels: MetricPanel[] }) {
  const normalizedPanels = useMemo(() => {
    return panels.map((panel) => ({
      ...panel,
      series: panel.series.length ? panel.series : panels.find((item) => item.title === panel.title)?.series ?? [0],
    }));
  }, [panels]);

  return (
    <div className="grid grid-cols-3 gap-3">
      {normalizedPanels.map((panel) => (
        <MetricCard key={panel.title} panel={panel} />
      ))}
    </div>
  );
}
