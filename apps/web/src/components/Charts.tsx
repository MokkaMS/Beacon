interface MetricPoint {
  timestamp: string;
  online: boolean;
  latencyMs: number | null;
  playerCount: number;
  maxPlayers: number;
}

interface SparkChartProps {
  title: string;
  points: MetricPoint[];
  valueKey: 'playerCount' | 'latencyMs';
  unit?: string;
  color: string;
}

export function MetricAreaChart({
  title,
  points,
  valueKey,
  unit = '',
  color,
}: SparkChartProps) {
  if (points.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
        <div className="text-xs font-medium text-slate-400 mb-2">{title}</div>
        <div className="h-36 flex items-center justify-center text-xs text-slate-500">
          Waiting for check history...
        </div>
      </div>
    );
  }

  const width = 520;
  const height = 140;
  const padX = 8;
  const padY = 12;

  const values = points.map((p) =>
    valueKey === 'latencyMs' ? (p.online && p.latencyMs !== null ? p.latencyMs : 0) : p.playerCount,
  );
  const maxVal = Math.max(1, ...values);
  const minVal = 0;

  const coords = values.map((val, idx) => {
    const x =
      points.length === 1
        ? width / 2
        : padX + (idx / (points.length - 1)) * (width - padX * 2);
    const y =
      height - padY - ((val - minVal) / (maxVal - minVal || 1)) * (height - padY * 2);
    return { x, y, val, point: points[idx] };
  });

  const linePath = coords
    .map((c, idx) => `${idx === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${height - padY} L ${coords[0].x.toFixed(1)} ${height - padY} Z`;

  const latestVal = values[values.length - 1];
  const peakVal = Math.max(...values);

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium text-slate-400">{title}</div>
        <div className="text-xs text-slate-300">
          Latest: <span className="font-semibold text-white">{latestVal}{unit}</span>
          <span className="text-slate-500 mx-1.5">•</span>
          Peak: <span className="font-semibold text-white">{peakVal}{unit}</span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full h-36 overflow-visible"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={`grad-${valueKey}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <line
          x1={padX}
          y1={height - padY}
          x2={width - padX}
          y2={height - padY}
          stroke="#1e293b"
          strokeWidth="1"
        />
        <path d={areaPath} fill={`url(#grad-${valueKey})`} />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
      </svg>

      <div className="flex justify-between text-[11px] text-slate-500 mt-1">
        <span>{points[0].timestamp.slice(5, 16)}</span>
        <span>{points[points.length - 1].timestamp.slice(5, 16)}</span>
      </div>
    </div>
  );
}
