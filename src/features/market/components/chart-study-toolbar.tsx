"use client";

export type ChartStudies = { averages: boolean; rsi: boolean; macd: boolean; supportResistance: boolean; volume: boolean; labels: boolean; events: boolean };
export const defaultChartStudies: ChartStudies = { averages: true, rsi: true, macd: true, supportResistance: true, volume: true, labels: true, events: true };

export default function ChartStudyToolbar({ studies, onToggle }: { studies: ChartStudies; onToggle: (key: keyof ChartStudies) => void }) {
  const controls: { key: keyof ChartStudies; label: string }[] = [
    { key: 'averages', label: 'Medias 20/50' }, { key: 'rsi', label: 'RSI14' }, { key: 'macd', label: 'MACD' },
    { key: 'supportResistance', label: 'Soportes / resistencias' }, { key: 'volume', label: 'Volumen' },
    { key: 'events', label: 'Eventos técnicos' }, { key: 'labels', label: 'Etiquetas' },
  ];
  return <div className="chart-study-toolbar" role="group" aria-label="Capas de análisis técnico">{controls.map(control =>
    <button key={control.key} className="secondary-button" aria-pressed={studies[control.key]} onClick={() => onToggle(control.key)}>{control.label}</button>)}</div>;
}
