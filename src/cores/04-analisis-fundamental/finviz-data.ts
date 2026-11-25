import { z } from 'zod';
import { knownBy, type CompanyResearch, type ResearchVariable, type ProviderStatus } from '../compartido/research-model.ts';

export const FINVIZ_FIELDS = [
  { id: 'institutionalTransactions', label: 'Inst Trans', percent: true, aliases: ['Institutional Transactions','Institutional Change'] },
  { id: 'institutionalOwnership', label: 'Inst Own', percent: true, aliases: ['Institutional Ownership'] },
  { id: 'insiderOwnership', label: 'Insider Own', percent: true, aliases: ['Insider Ownership'] },
  { id: 'profitMargin', label: 'Profit Margin', percent: true, aliases: ['Net Profit Margin','Net Margin'] },
  { id: 'operatingMargin', label: 'Oper. Margin', percent: true, aliases: ['Operating Margin'] },
  { id: 'grossMargin', label: 'Gross Margin', percent: true, aliases: [] },
  { id: 'roe', label: 'ROE', percent: true, aliases: ['Return on Equity'] },
  { id: 'roa', label: 'ROA', percent: true, aliases: ['Return on Assets'] },
  { id: 'roic', label: 'ROIC', percent: true, aliases: ['Return on Invested Capital','Return on Investment','ROI'] },
  { id: 'currentRatio', label: 'Current Ratio', percent: false, aliases: [] },
  { id: 'quickRatio', label: 'Quick Ratio', percent: false, aliases: [] },
  { id: 'debtEquity', label: 'Debt/Eq', percent: false, aliases: ['Debt/Equity'] },
  { id: 'pe', label: 'P/E', percent: false, aliases: [] },
  { id: 'forwardPe', label: 'Forward P/E', percent: false, aliases: [] },
  { id: 'peg', label: 'PEG', percent: false, aliases: [] },
  { id: 'priceSales', label: 'P/S', percent: false, aliases: ['Price/Sales'] },
  { id: 'priceBook', label: 'P/B', percent: false, aliases: ['Price/Book'] },
  { id: 'shortFloat', label: 'Short Float', percent: true, aliases: ['Float Short','Short Float / Ratio'] },
] as const;
export type FinvizMetricId = typeof FINVIZ_FIELDS[number]['id'];
export const finvizMetricsSchema = z.object(Object.fromEntries(FINVIZ_FIELDS.map(f => [f.id,z.number().finite().min(-1e9).max(1e9).optional()])) as Record<FinvizMetricId,z.ZodOptional<z.ZodNumber>>).strict();
export const finvizDatasetSchema = z.object({ capturedAt: z.string().datetime({offset:true}), records: z.record(z.string().regex(/^[A-Z][A-Z0-9.-]{0,14}$/),finvizMetricsSchema).refine(r=>Object.keys(r).length>0&&Object.keys(r).length<=14,'Usa entre 1 y 14 empresas.') }).strict();
export type FinvizDataset = z.infer<typeof finvizDatasetSchema>;
export type FinvizResearch = { capturedAt: string; metrics: Partial<Record<FinvizMetricId,ResearchVariable>>; status: ProviderStatus; warnings: string[] };
const key = (s: string) => s.replace(/^\uFEFF/,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const findField = (s: string) => FINVIZ_FIELDS.find(f => [f.label,...f.aliases].some(label=>key(label)===key(s)));
export function finvizNumber(text: string, percent: boolean): number | null {
  const trimmed=text.trim().replace(/−/g,'-');
  if(trimmed.includes(',')&&!/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?%?$/.test(trimmed))return null;
  const value=trimmed.replaceAll(',','').replace(/\s*%$/,'');
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))return null;
  const n=Number(value)/(percent?100:1);return Number.isFinite(n)&&Math.abs(n)<=1e9?n:null;
}
/** Quoted RFC-style CSV/TSV, including embedded newlines and escaped quotes. */
function table(text: string, delimiter: string): string[][] {
  const rows:string[][]=[];let row:string[]=[], cell='', quoted=false;
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(!quoted&&cell.trim()||quoted&&text[i+1]&&![delimiter,'\r','\n'].includes(text[i+1]))throw Error('Comillas CSV inválidas.');else quoted=!quoted;}
    else if(!quoted&&c===delimiter){row.push(cell);cell='';}
    else if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw Error('El CSV contiene comillas sin cerrar.');
  row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows;
}
/** Import values the user copied from the free page, or a CSV they already have.
 * The import time is the first known availability; never backdate current data. */
export function parseFinvizData(text: string, symbol: string, capturedAt: string): FinvizDataset {
  if(text.length>1_000_000)throw Error('Usa un archivo o tabla de hasta 1 MB.');
  const rows=table(text,text.includes('\t')?'\t':','), records:FinvizDataset['records']={};
  const header=rows[0]??[], ticker=header.findIndex(h=>['ticker','symbol'].includes(key(h)));
  if(ticker>=0){
    for(const row of rows.slice(1)){
      const name=row[ticker]?.trim().toUpperCase();if(!name||!row.some(v=>v.trim()))continue;
      const values:Partial<Record<FinvizMetricId,number>>={};
      header.forEach((label,i)=>{const field=findField(label);if(!field)return;const value=finvizNumber(row[i]??'',field.percent);if(value!==null)values[field.id]=value;});
      if(Object.keys(values).length){if(records[name])throw Error('El archivo repite un símbolo; conserva una sola fila por empresa.');records[name]=values;}
    }
  }else{
    const values:Partial<Record<FinvizMetricId,number>>={};
    const cells=rows.flat().flatMap(s=>s.split(/\r?\n/)).map(s=>s.trim());
    for(let i=0;i<cells.length-1;i++){const field=findField(cells[i]);if(!field)continue;const n=finvizNumber(cells[i+1],field.percent);if(n!==null)values[field.id]=n;}
    // Supports simple pasted "Inst Trans 2.5%" lines in addition to table cells.
    for(const line of text.split(/\r?\n/)){
      const match=/^(.+?)\s+([+-]?(?:[\d,]+(?:\.\d*)?|\.\d+)%?)\s*$/.exec(line.trim());
      if(!match)continue;const field=findField(match[1]);if(!field)continue;const n=finvizNumber(match[2],field.percent);if(n!==null)values[field.id]=n;
    }
    if(Object.keys(values).length)records[symbol]=values;
  }
  if(!Object.keys(records).length)throw Error('No se reconocieron métricas. Copia nombre y valor (por ejemplo Inst Trans y 2.5%) o usa un CSV con columna Ticker.');
  return finvizDatasetSchema.parse({capturedAt,records});
}

export function withFinviz(snapshot: CompanyResearch, dataset?: FinvizDataset, advanceCurrentCutoff=false): CompanyResearch {
  if(snapshot.dataMode==='demo')return snapshot;
  const record=dataset?.records[snapshot.symbol];if(!dataset||!record)return snapshot;
  const captured=Date.parse(dataset.capturedAt), cutoff=Date.parse(snapshot.asOf);
  // A user importing data now can move a current analysis forward, never a backtest.
  const asOf=advanceCurrentCutoff&&!snapshot.quality.historicalOnly&&captured>cutoff&&captured-cutoff<=600000?dataset.capturedAt:snapshot.asOf;
  const metrics=Object.fromEntries(Object.entries(record).map(([id,value])=>[id,{value,kind:'assumed',source:`Finviz · ${FINVIZ_FIELDS.find(f=>f.id===id)?.label??id} · captura manual declarada por el usuario`,observedAt:dataset.capturedAt,availableAt:dataset.capturedAt,reason:'Dato copiado/importado, sin verificación directa de la fuente. La fecha es la de importación, no la de publicación original.'}])) as FinvizResearch['metrics'];
  const available=captured<=Date.parse(asOf)&&Date.parse(asOf)-captured<=7*86400000;
  const status:ProviderStatus={source:'Finviz · importación manual',status:available?'partial':'unavailable',message:available?'Datos declarados por el usuario; consulta actual, sin cobertura histórica.':captured>Date.parse(asOf)?'La captura Finviz es posterior al corte: no se aplica al análisis histórico.':'La captura Finviz supera siete días de antigüedad; actualízala.'};
  if(!available)for(const value of Object.values(metrics))if(value)value.kind='missing';
  return {...snapshot,asOf,finviz:{capturedAt:dataset.capturedAt,metrics,status,warnings:['Finviz complementa SEC: las métricas TTM y las del ejercicio fiscal no son equivalentes.','Inst Trans es variación de participación institucional; no acredita flujo intradía ni volumen neto negociado.']},quality:{...snapshot.quality,sources:[...snapshot.quality.sources.filter(s=>!s.source.startsWith('Finviz')),status]}};
}
export function finvizInstitutional(snapshot:CompanyResearch):ResearchVariable|undefined{
  const value=snapshot.finviz?.metrics.institutionalTransactions;
  return value&&knownBy(value,snapshot.asOf)?value:undefined;
}
