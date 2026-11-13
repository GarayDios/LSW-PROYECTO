"use client";

import { useMemo } from 'react';
import { companies } from '../market/data';
import { strategies } from '../strategies/catalog';
import { rankCompanies, type CoreId, type StrategyId } from '../../cores/index';

export default function OpportunityOverview({ selectedCores, strategy, days, rate, issue, onStrategy, onCompany, source = 'demo', observed = [], excluded = 0 }: {
  selectedCores: CoreId[]; strategy: StrategyId; days: number; rate: number; issue: string;
  onStrategy: (id: StrategyId) => void; onCompany: (symbol: string) => void;
  source?: 'demo' | 'alpaca'; observed?: {symbol:string;score:number|null;reason:string}[]; excluded?: number;
}) {
  const comparisons = useMemo(() => {
    if (source !== 'demo' || issue || !selectedCores.length || days > 3650) return [];
    return strategies.map(s => ({ ...s, ranked: rankCompanies(companies, selectedCores, s.id, Math.max(1, days), rate) }));
  }, [selectedCores, days, rate, issue, source]);
  const current = comparisons.find(s => s.id === strategy);
  if (source === 'alpaca') return <section className="panel opportunity-overview" aria-label="Mejores empresas por estrategia"><div className="opportunity-title"><div><span className="eyebrow">DATOS OBSERVADOS · {selectedCores.length}/7 CORES</span><h2>Compatibilidad con variables reales</h2></div><span className="demo-pill">Puntuación heurística</span></div>{issue ? <p className="form-error">{issue}</p> : observed.length ? <div className="top-opportunities">{observed.slice(0,3).map((company,i)=><button key={company.symbol} onClick={()=>onCompany(company.symbol)}><span className="top-rank">0{i+1}</span><span><strong>{company.symbol} <small>{company.score}/100</small></strong><p>{company.reason}</p></span><span className="orange">Ver gráfica ↗</span></button>)}</div> : <p className="history-footnote">Pulsa Generar oportunidades para consultar las variables de las empresas con este rango y evaluar los cores disponibles. Las comparaciones de muestra no se utilizan en este modo.</p>}<p className="history-footnote">{excluded > 0 ? `${excluded} empresas sin entradas completas para los cores seleccionados. ` : ''}La compatibilidad expresa criterios de la estrategia, no rentabilidad esperada ni probabilidad real de éxito. Opciones y tasas necesitan sus fuentes habilitadas.</p></section>;
  return <section className="panel opportunity-overview" aria-label="Mejores empresas por estrategia">
    <div className="opportunity-title"><div><span className="eyebrow">COMPARACIÓN EN VIVO · {selectedCores.length}/7 CORES</span><h2>Mejores empresas por estrategia</h2></div><span className="demo-pill">Compatibilidad de muestra, no rentabilidad</span></div>
    {issue ? <p className="form-error" role="status">{issue}</p> : !comparisons.length ? <p>Selecciona al menos un core y un plazo de hasta 3650 días.</p> : <>
      <div className="strategy-comparison">{comparisons.map(s=><button key={s.id} aria-pressed={strategy===s.id} className={strategy===s.id?'selected':''} onClick={()=>onStrategy(s.id)}><span>{s.title}</span><strong>{s.ranked[0]?.symbol}<small>{s.ranked[0]?.score}/100</small></strong></button>)}</div>
      <div className="top-opportunities">{current?.ranked.slice(0,3).map((c,i)=><button key={c.symbol} onClick={()=>onCompany(c.symbol)} aria-label={`Ver ${c.symbol} en la gráfica`}><span className="top-rank">0{i+1}</span><span><strong>{c.symbol} <small>{c.score}/100</small></strong><span>{c.name}</span><p>{c.reason}</p></span><span className="orange">Ver gráfica ↗</span></button>)}</div>
      <p className="history-footnote">Vista previa actualizada al cambiar cores, estrategia, plazo o tasa. Generar oportunidades guarda una copia de los resultados; las listas anteriores no se modifican. El histórico solo cambia la gráfica, no recalcula estas métricas de muestra.</p>
    </>}
  </section>;
}
