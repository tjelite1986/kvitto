'use client';

// Multi-series price history line chart (one line per store), hand-rolled SVG.
// Derived from tidsrapport's LineChart, extended with series and a legend.

export interface PricePoint {
  date: string; // YYYY-MM-DD
  valueOre: number;
}

export interface PriceSeries {
  label: string;
  points: PricePoint[];
}

interface PriceHistoryChartProps {
  series: PriceSeries[];
  height?: number;
}

const SERIES_COLORS = ['#16a34a', '#2563eb', '#d97706', '#dc2626', '#7c3aed', '#0891b2'];

function formatKrShort(ore: number): string {
  return (ore / 100).toLocaleString('sv-SE', { maximumFractionDigits: 2 });
}

export default function PriceHistoryChart({ series, height = 240 }: PriceHistoryChartProps) {
  const allPoints = series.flatMap((s) => s.points);
  if (allPoints.length === 0) {
    return <p className="text-sm text-gray-400">No price data yet.</p>;
  }

  const allDates = Array.from(new Set(allPoints.map((p) => p.date))).sort();
  const values = allPoints.map((p) => p.valueOre);
  const maxValue = Math.max(...values);
  const minValue = Math.min(...values);
  const range = maxValue - minValue || maxValue * 0.2 || 100;
  const yMin = Math.max(0, minValue - range * 0.15);
  const yMax = maxValue + range * 0.15;

  const padding = { top: 16, right: 20, bottom: 30, left: 44 };
  const svgWidth = Math.max(420, allDates.length * 64 + padding.left + padding.right);
  const chartHeight = height - padding.top - padding.bottom;
  const chartWidth = svgWidth - padding.left - padding.right;

  const xFor = (date: string) =>
    padding.left + (allDates.indexOf(date) / Math.max(allDates.length - 1, 1)) * chartWidth;
  const yFor = (ore: number) =>
    padding.top + chartHeight - ((ore - yMin) / (yMax - yMin)) * chartHeight;

  return (
    <div>
      <div className="flex flex-wrap gap-3 mb-2">
        {series.map((s, i) => (
          <span key={s.label} className="inline-flex items-center gap-1.5 text-xs text-gray-600">
            <span
              className="w-2.5 h-2.5 rounded-full"
              style={{ backgroundColor: SERIES_COLORS[i % SERIES_COLORS.length] }}
            />
            {s.label}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto">
        <svg width={svgWidth} height={height} className="block">
          {[0, 0.5, 1].map((frac) => {
            const y = padding.top + chartHeight * (1 - frac);
            const value = yMin + (yMax - yMin) * frac;
            return (
              <g key={frac}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={svgWidth - padding.right}
                  y2={y}
                  stroke="#e5e7eb"
                  strokeWidth={1}
                />
                <text x={padding.left - 6} y={y + 3} textAnchor="end" className="text-[9px] fill-gray-400">
                  {formatKrShort(value)}
                </text>
              </g>
            );
          })}

          {series.map((s, si) => {
            const color = SERIES_COLORS[si % SERIES_COLORS.length];
            const points = s.points.map((p) => ({ x: xFor(p.date), y: yFor(p.valueOre), ...p }));
            const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
            return (
              <g key={s.label}>
                <path d={path} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
                {points.map((p, i) => (
                  <g key={i}>
                    <circle cx={p.x} cy={p.y} r={3.5} fill={color} stroke="white" strokeWidth={2} />
                    <text x={p.x} y={p.y - 9} textAnchor="middle" className="text-[9px] fill-gray-600">
                      {formatKrShort(p.valueOre)}
                    </text>
                  </g>
                ))}
              </g>
            );
          })}

          {allDates.map((date) => (
            <text
              key={date}
              x={xFor(date)}
              y={height - 6}
              textAnchor="middle"
              className="text-[9px] fill-gray-500"
            >
              {date.slice(5)}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}
