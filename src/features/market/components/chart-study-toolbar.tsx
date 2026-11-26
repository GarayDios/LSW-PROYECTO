"use client";

import { studyCore, type ChartStudies } from '../chart-core-layers';
import type { ScannerCoreId } from '../../../cores/evaluacion/scanner-settings';
export { defaultChartStudies, type ChartStudies } from '../chart-core-layers';

export default function ChartStudyToolbar({ studies, onToggle, cores }: { studies: ChartStudies; onToggle: (key: keyof ChartStudies) => void; cores?: readonly ScannerCoreId[] }) {
  const controls: { key: keyof ChartStudies; label: string; color: string; title: string }[] = [
    { key: 'averages', label: 'Medias 20/50', color: '#e2bf80', title: 'Medias simples de 20 y 50 velas originales.' },
    { key: 'crosses', label: 'Cruces 20/50', color: '#e2bf80', title: 'Cruces alcistas y bajistas entre las medias de 20 y 50 velas.' },
    { key: 'rsi', label: 'RSI14', color: '#b6a6e8', title: 'Panel RSI14 y marcas de entrada en sobrecompra o sobreventa.' },
    { key: 'macd', label: 'MACD', color: '#79c9e5', title: 'Panel MACD12/26/9 y cruces de MACD con su señal.' },
    { key: 'supportResistance', label: 'Soportes / resistencias', color: '#41c9a6', title: 'Niveles confirmados y número de contactos.' },
    { key: 'trends', label: 'Tendencias', color: '#79c9e5', title: 'Mínimos crecientes: tendencia alcista. Máximos decrecientes: tendencia bajista. Dos pivotes confirmados por línea.' },
    { key: 'gaps', label: 'Gaps', color: '#e2bf80', title: 'Apertura frente al cierre de la sesión anterior: variación de al menos ±0.5%, cuando ambos datos están disponibles.' },
    { key: 'news', label: 'Noticias', color: '#d6b66c', title: 'Línea temporal de titulares de Alpaca, alineada con las fechas de la gráfica.' },
    { key: 'volume', label: 'Volumen', color: '#8cb9b0', title: 'Volumen de cada vela.' },
    { key: 'events', label: 'Rupturas', color: '#ef787b', title: 'Rupturas de soportes y resistencias previamente confirmados.' },
    { key: 'volatilityBands', label: 'Bandas de volatilidad', color: '#d6b66c', title: 'Bandas ±1σ con volatilidad histórica (HV) y el plazo de operación. En demostración usan la volatilidad supuesta.' },
    { key: 'riskScenario', label: 'Escenario −2σ', color: '#ef787b', title: 'Caída ilustrativa de dos desviaciones. No es la pérdida máxima ni un límite de riesgo.' },
    { key: 'labels', label: 'Etiquetas', color: '#d1d7df', title: 'Textos sobre las velas y los niveles. Los detalles siguen disponibles al pasar el cursor.' },
  ];
  return <details className="chart-layer-settings"><summary>Capas de los cores seleccionados</summary><div className="chart-study-toolbar" role="group" aria-label="Capas de análisis técnico">{controls.filter(control => control.key === 'labels' || !cores || cores.includes(studyCore[control.key])).map(control =>
    <button key={control.key} type="button" className="secondary-button" title={control.title} aria-pressed={studies[control.key]} onClick={() => onToggle(control.key)}>
      <span className="chart-study-swatch" aria-hidden="true" style={{ backgroundColor: control.color }}/>{control.label}
    </button>)}</div></details>;
}
