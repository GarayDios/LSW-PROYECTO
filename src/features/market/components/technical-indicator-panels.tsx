import type { TechnicalIndicator } from '../../../cores/01-analisis-tecnico/indicators';

export default function TechnicalIndicatorPanels({ points, rsi, macd, width }: {
  points: { x: number; value: TechnicalIndicator | undefined }[]; rsi: boolean; macd: boolean; width: number;
}) {
  if (!rsi && !macd) return null;
  const latest = points.filter(point => point.value).at(-1)?.value;
  const right = width - 88;
  const path = (value: (point: TechnicalIndicator) => number | null, y: (number: number) => number) => {
    let started = false;
    return points.map(point => {
      const v = point.value ? value(point.value) : null;
      if (v === null) { started = false; return ''; }
      const command = started ? 'L' : 'M'; started = true;
      return `${command}${point.x.toFixed(2)},${y(v).toFixed(2)}`;
    }).join(' ');
  };
  const rsiY = (value: number) => 90 - Math.max(0, Math.min(100, value)) * .6;
  const macdTop = rsi ? 125 : 15;
  const macdBottom = macdTop + 80;
  const values = points.flatMap(point => point.value ? [point.value.macd, point.value.macdSignal, point.value.macdHistogram].filter((value): value is number => value !== null) : []);
  const minimum = Math.min(0, ...values), maximum = Math.max(0, ...values), extent = maximum - minimum || 1;
  const macdY = (value: number) => macdTop + 15 + (maximum - value) / extent * 60;
  const histogramWidth = points.length > 1 ? Math.max(1, Math.min(6, (points[1].x - points[0].x) * .55)) : 3;
  return <svg className="technical-indicator-panels" viewBox={`0 0 ${width} ${(rsi ? 110 : 0) + (macd ? 110 : 0)}`} role="img" aria-label="Paneles de indicadores RSI y MACD">
    {rsi && <g data-technical-panel="rsi">
      <text x="10" y="15" fill="#b6a6e8" fontSize="12">RSI14 · {latest?.rsi?.toFixed(1) ?? 'sin datos suficientes'}</text>
      <rect x="10" y={rsiY(70)} width={right - 10} height={rsiY(30) - rsiY(70)} fill="#b6a6e8" opacity=".04"/>
      {[30, 50, 70].map(value => <g key={value}><line x1="10" x2={right} y1={rsiY(value)} y2={rsiY(value)} stroke="#777188" strokeDasharray="4 4" opacity=".5"/><text x={right + 14} y={rsiY(value) + 4} fontSize="11" fill="#a9a1b8">{value}</text></g>)}
      <path d={path(point => point.rsi, rsiY)} fill="none" stroke="#b6a6e8" strokeWidth="1.8"/>
      <line x1="10" x2={right} y1="104" y2="104" stroke="#30343a"/>
    </g>}
    {macd && <g data-technical-panel="macd">
      <text x="10" y={macdTop} fill="#79c9e5" fontSize="12">MACD12/26/9 · {latest?.macd?.toFixed(3) ?? '—'} · señal {latest?.macdSignal?.toFixed(3) ?? '—'}</text>
      <line x1="10" x2={right} y1={macdY(0)} y2={macdY(0)} stroke="#777188" strokeDasharray="4 4"/>
      {points.map((point, index) => point.value?.macdHistogram !== null && point.value?.macdHistogram !== undefined && <rect key={index} x={point.x - histogramWidth / 2} y={Math.min(macdY(0), macdY(point.value.macdHistogram))} width={histogramWidth} height={Math.max(.5, Math.abs(macdY(point.value.macdHistogram) - macdY(0)))} fill={point.value.macdHistogram >= 0 ? '#41c9a6' : '#ef787b'} opacity=".5"/>)}
      <path d={path(point => point.macd, macdY)} fill="none" stroke="#79c9e5" strokeWidth="1.6"/>
      <path d={path(point => point.macdSignal, macdY)} fill="none" stroke="#e2bf80" strokeWidth="1.6"/>
      <text x={right + 14} y={macdY(0) + 4} fill="#929ba6" fontSize="11">0</text>
      <line x1="10" x2={right} y1={macdBottom + 10} y2={macdBottom + 10} stroke="#30343a"/>
    </g>}
  </svg>;
}
