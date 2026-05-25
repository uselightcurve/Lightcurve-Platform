export function ScoreBar({ value, max = 1 }: { value: number; max?: number }) {
  const pct = Math.max(0, Math.min((value / max) * 100, 100));
  const color = pct >= 80 ? 'bg-[#2f5ae0]' : pct >= 60 ? 'bg-[#8a6a20]' : 'bg-[#a94d4a]';

  return (
    <div className="flex items-center gap-2">
      <span className="tabular min-w-9 text-sm text-slate-700">
        {max === 4.5 ? value.toFixed(1) : `${Math.round(value * 100)}%`}
      </span>
      <div className="score-bar-track h-1.5 flex-1">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function StatusChip({ status }: { status: string }) {
  const normalized = status.toLowerCase();
  const className =
    normalized === 'pass'
      ? 'status-pill-complete'
      : normalized === 'fail'
        ? 'status-pill-failed'
        : normalized === 'running'
          ? 'status-pill-running'
          : 'status-pill-pending';

  return <span className={className}>{status}</span>;
}
