"use client";

import { useMemo } from 'react';
import { companies, strategies } from '../lib/market-data';
import { rankCompanies, type CoreId, type StrategyId } from '../lib/quant';

export default function OpportunityOverview({ selectedCores, strategy, days, rate, issue, onStrategy, onCompany }: {
  selectedCores: CoreId[]; strategy: StrategyId; days: number; rate: number; issue: string;
  onStrategy: (id: StrategyId) => void; onCompany: (symbol: string) => void;
}) {
  const comparisons = useMemo(() => {
    if (issue || !selectedCores.length || days > 3650) return [];
    return strategies.map(s => ({ ...s, ranked: rankCompanies(companies, selectedCores, s.id, Math.max(1, days), rate) }));
  }, [selectedCores, days, rate, issue]);
  const current = comparisons.find(s => s.id === strategy);
  return <section className="panel opportunity-overview" aria-label="Mejores empresas por estrategia">
    <div className="opportunity-title"><div><span className="eyebrow">COMPARACIÓN EN VIVO · {selectedCores.length}/7 CORES</span><h2>Mejores empresas por estrategia</h2></div><span className="demo-pill">Compatibilidad de muestra, no rentabilidad</span></div>
    {issue ? <p className="form-error" role="status">{issue}</p> : !comparisons.length ? <p>Selecciona al menos un core y un plazo de hasta 3650 días.</p> : <>
      <div className="strategy-comparison">{comparisons.map(s=><button key={s.id} aria-pressed={strategy===s.id} className={strategy===s.id?'selected':''} onClick={()=>onStrategy(s.id)}><span>{s.title}</span><strong>{s.ranked[0]?.symbol}<small>{s.ranked[0]?.score}/100</small></strong></button>)}</div>
      <div className="top-opportunities">{current?.ranked.slice(0,3).map((c,i)=><button key={c.symbol} onClick={()=>onCompany(c.symbol)} aria-label={`Ver ${c.symbol} en la gráfica`}><span className="top-rank">0{i+1}</span><span><strong>{c.symbol} <small>{c.score}/100</small></strong><span>{c.name}</span><p>{c.reason}</p></span><span className="orange">Ver gráfica ↗</span></button>)}</div>
      <p className="history-footnote">Vista previa actualizada al cambiar cores, estrategia, plazo o tasa. Generar oportunidades guarda una copia de los resultados; las listas anteriores no se modifican. El histórico solo cambia la gráfica, no recalcula estas métricas de muestra.</p>
    </>}
  </section>;
}
