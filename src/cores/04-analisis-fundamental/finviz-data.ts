// Importación manual de Finviz con validación de formato, unidades y fecha de captura. Una captura actual no
// completa un análisis histórico previo.

// Importa los ayudantes y tipos compartidos que utiliza este archivo; sus nombres se emplean en las
// validaciones y cálculos descritos a continuación.
import { z } from 'zod';
// Importa los ayudantes y tipos compartidos que utiliza este archivo; sus nombres se emplean en las
// validaciones y cálculos descritos a continuación.
import { knownBy, type CompanyResearch, type ResearchVariable, type ProviderStatus } from '../compartido/research-model.ts';

// Abre el catálogo de campos que puede reconocer una captura manual de Finviz; los alias permiten distintos
// nombres para la misma métrica.
export const FINVIZ_FIELDS = [
  // Registra Inst Trans; su valor se expresa internamente como fracción y se presenta como porcentaje.
  { id: 'institutionalTransactions', label: 'Inst Trans', percent: true, aliases: ['Institutional Transactions','Institutional Change'] },
  // Registra Inst Own; su valor se expresa internamente como fracción y se presenta como porcentaje.
  { id: 'institutionalOwnership', label: 'Inst Own', percent: true, aliases: ['Institutional Ownership'] },
  // Registra Insider Own; su valor se expresa internamente como fracción y se presenta como porcentaje.
  { id: 'insiderOwnership', label: 'Insider Own', percent: true, aliases: ['Insider Ownership'] },
  // Registra Profit Margin; su valor se expresa internamente como fracción y se presenta como porcentaje.
  { id: 'profitMargin', label: 'Profit Margin', percent: true, aliases: ['Net Profit Margin','Net Margin'] },
  // Registra Oper. Margin; su valor se expresa internamente como fracción y se presenta como porcentaje.
  { id: 'operatingMargin', label: 'Oper. Margin', percent: true, aliases: ['Operating Margin'] },
  // Registra Gross Margin; su valor se expresa internamente como fracción y se presenta como porcentaje.
  { id: 'grossMargin', label: 'Gross Margin', percent: true, aliases: [] },
  // Registra ROE; su valor se expresa internamente como fracción y se presenta como porcentaje.
  { id: 'roe', label: 'ROE', percent: true, aliases: ['Return on Equity'] },
  // Registra ROA; su valor se expresa internamente como fracción y se presenta como porcentaje.
  { id: 'roa', label: 'ROA', percent: true, aliases: ['Return on Assets'] },
  // Registra ROIC; su valor se expresa internamente como fracción y se presenta como porcentaje.
  { id: 'roic', label: 'ROIC', percent: true, aliases: ['Return on Invested Capital','Return on Investment','ROI'] },
  // Registra Current Ratio.
  { id: 'currentRatio', label: 'Current Ratio', percent: false, aliases: [] },
  // Registra Quick Ratio.
  { id: 'quickRatio', label: 'Quick Ratio', percent: false, aliases: [] },
  // Registra Debt/Eq.
  { id: 'debtEquity', label: 'Debt/Eq', percent: false, aliases: ['Debt/Equity'] },
  // Registra P/E.
  { id: 'pe', label: 'P/E', percent: false, aliases: [] },
  // Registra Forward P/E.
  { id: 'forwardPe', label: 'Forward P/E', percent: false, aliases: [] },
  // Registra PEG.
  { id: 'peg', label: 'PEG', percent: false, aliases: [] },
  // Registra P/S.
  { id: 'priceSales', label: 'P/S', percent: false, aliases: ['Price/Sales'] },
  // Registra P/B.
  { id: 'priceBook', label: 'P/B', percent: false, aliases: ['Price/Book'] },
  // Registra Short Float; su valor se expresa internamente como fracción y se presenta como porcentaje.
  { id: 'shortFloat', label: 'Short Float', percent: true, aliases: ['Float Short','Short Float / Ratio'] },
// Cierra el catálogo como tupla de valores literales para derivar tipos a partir de sus identificadores.
] as const;
// Construye la unión de identificadores válidos tomando id de cada entrada del catálogo.
export type FinvizMetricId = typeof FINVIZ_FIELDS[number]['id'];
// Crea un esquema estricto de números opcionales finitos entre −1000000000 y 1000000000; rechaza claves no
// reconocidas.
export const finvizMetricsSchema = z.object(Object.fromEntries(FINVIZ_FIELDS.map(f => [f.id,z.number().finite().min(-1e9).max(1e9).optional()])) as Record<FinvizMetricId,z.ZodOptional<z.ZodNumber>>).strict();
// Valida fecha ISO con zona horaria y entre 1 y 14 símbolos válidos, cada uno asociado al esquema de
// métricas.
export const finvizDatasetSchema = z.object({ capturedAt: z.string().datetime({offset:true}), records: z.record(z.string().regex(/^[A-Z][A-Z0-9.-]{0,14}$/),finvizMetricsSchema).refine(r=>Object.keys(r).length>0&&Object.keys(r).length<=14,'Usa entre 1 y 14 empresas.') }).strict();
// Deriva el tipo TypeScript directamente del esquema Zod para que validación y tipos describan la misma
// estructura.
export type FinvizDataset = z.infer<typeof finvizDatasetSchema>;
// Describe los datos manuales normalizados con fecha de captura, métricas parciales, estado y advertencias.
export type FinvizResearch = { capturedAt: string; metrics: Partial<Record<FinvizMetricId,ResearchVariable>>; status: ProviderStatus; warnings: string[] };
// Normaliza etiquetas: elimina BOM inicial, convierte a minúsculas y retira signos y espacios para comparar
// nombres.
const key = (s: string) => s.replace(/^\uFEFF/,'').toLowerCase().replace(/[^a-z0-9]/g,'');
// Busca una definición por su etiqueta principal o cualquiera de sus alias normalizados.
const findField = (s: string) => FINVIZ_FIELDS.find(f => [f.label,...f.aliases].some(label=>key(label)===key(s)));
// Convierte el texto de una celda a número, expresando porcentajes como fracciones decimales.
export function finvizNumber(text: string, percent: boolean): number | null {
  // Recorta espacios externos y sustituye el signo menos tipográfico por el carácter numérico habitual.
  const trimmed=text.trim().replace(/−/g,'-');
  // Si existen comas, exige agrupaciones de miles válidas; evita interpretar 2,5 como un decimal que el
  // formato no admite.
  if(trimmed.includes(',')&&!/^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d*)?%?$/.test(trimmed))return null;
  // Elimina separadores de miles y el símbolo porcentual final.
  const value=trimmed.replaceAll(',','').replace(/\s*%$/,'');
  // Acepta únicamente una representación decimal completa; rechaza guiones de faltantes, texto y otras
  // expresiones.
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))return null;
  // Convierte a Number, divide entre 100 los campos porcentuales y rechaza valores no finitos o excesivos.
  const n=Number(value)/(percent?100:1);return Number.isFinite(n)&&Math.abs(n)<=1e9?n:null;
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}
// Interpreta una tabla CSV o TSV con un delimitador elegido, comillas escapadas y saltos de línea dentro de
// celdas.
function table(text: string, delimiter: string): string[][] {
  // Inicializa filas, fila actual, texto de celda y estado de si el recorrido está dentro de comillas.
  const rows:string[][]=[];let row:string[]=[], cell='', quoted=false;
  // Recorre carácter por carácter para distinguir delimitadores reales de los contenidos en texto citado.
  for(let i=0;i<text.length;i++){
    // Lee el carácter actual de la tabla.
    const c=text[i];
    // Procesa comillas: dos comillas internas representan una literal; las posiciones inválidas lanzan error;
    // las demás abren o cierran el campo citado.
    if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else if(!quoted&&cell.trim()||quoted&&text[i+1]&&![delimiter,'\r','\n'].includes(text[i+1]))throw Error('Comillas CSV inválidas.');else quoted=!quoted;}
    // Fuera de comillas, el delimitador termina una celda, la agrega a la fila y reinicia su texto.
    else if(!quoted&&c===delimiter){row.push(cell);cell='';}
    // Fuera de comillas, un salto termina la fila; agrupa CRLF, descarta filas vacías y reinicia los
    // acumuladores.
    else if(!quoted&&(c==='\n'||c==='\r')){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}
    // Agrega a la celda cualquier carácter que no funcione como separador estructural.
    else cell+=c;
  // Cierra el bloque, objeto o declaración iniciado anteriormente.
  }
  // Rechaza la tabla si al terminar el texto todavía queda una celda con comillas abiertas.
  if(quoted)throw Error('El CSV contiene comillas sin cerrar.');
  // Cierra la última celda y agrega una última fila no vacía, aunque el texto no termine en salto de línea.
  row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows;
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}
// Importa una tabla copiada o un CSV; symbol se usa cuando la captura solo describe una empresa y capturedAt
// fija su disponibilidad.
export function parseFinvizData(text: string, symbol: string, capturedAt: string): FinvizDataset {
  // Limita la longitud del texto a un millón de unidades de cadena; el mensaje lo describe como hasta 1 MB.
  if(text.length>1_000_000)throw Error('Usa un archivo o tabla de hasta 1 MB.');
  // Elige tabulador si existe y coma en caso contrario; crea la tabla y el diccionario de empresas.
  const rows=table(text,text.includes('\t')?'\t':','), records:FinvizDataset['records']={};
  // Busca una columna Ticker o Symbol en la cabecera normalizada.
  const header=rows[0]??[], ticker=header.findIndex(h=>['ticker','symbol'].includes(key(h)));
  // Si existe esa columna, interpreta el contenido como una tabla de varias empresas.
  if(ticker>=0){
    // Recorre las filas posteriores a la cabecera.
    for(const row of rows.slice(1)){
      // Obtiene el ticker en mayúsculas y omite filas sin símbolo o completamente vacías.
      const name=row[ticker]?.trim().toUpperCase();if(!name||!row.some(v=>v.trim()))continue;
      // Prepara las métricas reconocidas de la empresa de esta fila.
      const values:Partial<Record<FinvizMetricId,number>>={};
      // Relaciona cada columna con un campo admitido, convierte su unidad y conserva solo números válidos,
      // incluido cero.
      header.forEach((label,i)=>{const field=findField(label);if(!field)return;const value=finvizNumber(row[i]??'',field.percent);if(value!==null)values[field.id]=value;});
      // Guarda filas con alguna métrica; rechaza un símbolo duplicado para impedir sobrescribir evidencia sin
      // advertencia.
      if(Object.keys(values).length){if(records[name])throw Error('El archivo repite un símbolo; conserva una sola fila por empresa.');records[name]=values;}
    // Cierra el bloque, objeto o declaración iniciado anteriormente.
    }
  // Cuando falta la columna Ticker, interpreta pares nombre/valor para una sola empresa.
  }else{
    // Inicializa las métricas parciales de esa captura individual.
    const values:Partial<Record<FinvizMetricId,number>>={};
    // Aplana filas y celdas, divide saltos internos y limpia espacios para detectar nombres junto a sus valores.
    const cells=rows.flat().flatMap(s=>s.split(/\r?\n/)).map(s=>s.trim());
    // Busca un campo reconocido y convierte la celda siguiente según su unidad porcentual o numérica.
    for(let i=0;i<cells.length-1;i++){const field=findField(cells[i]);if(!field)continue;const n=finvizNumber(cells[i+1],field.percent);if(n!==null)values[field.id]=n;}
    // También recorre líneas simples pegadas, por ejemplo Inst Trans 2.5%, sin exigir columnas.
    for(const line of text.split(/\r?\n/)){
      // Separa el nombre del campo y el número final, permitiendo signo, separadores de miles y porcentaje.
      const match=/^(.+?)\s+([+-]?(?:[\d,]+(?:\.\d*)?|\.\d+)%?)\s*$/.exec(line.trim());
      // Omite líneas sin patrón o sin campo conocido y agrega únicamente valores convertibles.
      if(!match)continue;const field=findField(match[1]);if(!field)continue;const n=finvizNumber(match[2],field.percent);if(n!==null)values[field.id]=n;
    // Cierra el bloque, objeto o declaración iniciado anteriormente.
    }
    // Asocia la captura al símbolo recibido solamente si se reconoció al menos una métrica.
    if(Object.keys(values).length)records[symbol]=values;
  // Cierra el bloque, objeto o declaración iniciado anteriormente.
  }
  // Rechaza importaciones vacías y explica qué formatos y campos puede reconocer.
  if(!Object.keys(records).length)throw Error('No se reconocieron métricas. Copia nombre y valor (por ejemplo Inst Trans y 2.5%) o usa un CSV con columna Ticker.');
  // Valida el resultado completo con Zod antes de devolverlo al resto del sistema.
  return finvizDatasetSchema.parse({capturedAt,records});
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}

// Añade Finviz a una instantánea sin alterar los datos SEC originales; puede adelantar un corte actual si se
// autoriza expresamente.
export function withFinviz(snapshot: CompanyResearch, dataset?: FinvizDataset, advanceCurrentCutoff=false): CompanyResearch {
  // Mantiene intactos los datos de demostración para no mezclarlos con capturas del usuario.
  if(snapshot.dataMode==='demo')return snapshot;
  // Busca los datos del símbolo de la instantánea y devuelve la original si no hay captura aplicable.
  const record=dataset?.records[snapshot.symbol];if(!dataset||!record)return snapshot;
  // Convierte la fecha de captura y el corte de análisis a milisegundos.
  const captured=Date.parse(dataset.capturedAt), cutoff=Date.parse(snapshot.asOf);
  // Solo adelanta un análisis no histórico si se solicita y la captura es posterior por diez minutos o menos;
  // jamás retrofecha una captura.
  const asOf=advanceCurrentCutoff&&!snapshot.quality.historicalOnly&&captured>cutoff&&captured-cutoff<=600000?dataset.capturedAt:snapshot.asOf;
  // Envuelve cada número como supuesto declarado por el usuario con fuente Finviz, etiqueta y fecha de
  // importación; no afirma verificación automática.
  const metrics=Object.fromEntries(Object.entries(record).map(([id,value])=>[id,{value,kind:'assumed',source:`Finviz · ${FINVIZ_FIELDS.find(f=>f.id===id)?.label??id} · captura manual declarada por el usuario`,observedAt:dataset.capturedAt,availableAt:dataset.capturedAt,reason:'Dato copiado/importado, sin verificación directa de la fuente. La fecha es la de importación, no la de publicación original.'}])) as FinvizResearch['metrics'];
  // Admite la captura únicamente si ya existía en el corte y tiene como máximo siete días de antigüedad.
  const available=captured<=Date.parse(asOf)&&Date.parse(asOf)-captured<=7*86400000;
  // Construye un estado parcial cuando la captura es válida o explica si quedó fuera por ser futura o
  // demasiado antigua.
  const status:ProviderStatus={source:'Finviz · importación manual',status:available?'partial':'unavailable',message:available?'Datos declarados por el usuario; consulta actual, sin cobertura histórica.':captured>Date.parse(asOf)?'La captura Finviz es posterior al corte: no se aplica al análisis histórico.':'La captura Finviz supera siete días de antigüedad; actualízala.'};
  // Marca las métricas fuera de vigencia como missing, aunque conserve su valor para mostrar la evidencia
  // recibida.
  if(!available)for(const value of Object.values(metrics))if(value)value.kind='missing';
  // Devuelve una copia con métricas y advertencias Finviz; reemplaza su estado previo en las fuentes sin
  // modificar los fundamentales SEC.
  return {...snapshot,asOf,finviz:{capturedAt:dataset.capturedAt,metrics,status,warnings:['Finviz complementa SEC: las métricas TTM y las del ejercicio fiscal no son equivalentes.','Inst Trans es variación de participación institucional; no acredita flujo intradía ni volumen neto negociado.']},quality:{...snapshot.quality,sources:[...snapshot.quality.sources.filter(s=>!s.source.startsWith('Finviz')),status]}};
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}
// Obtiene la métrica manual de cambio institucional únicamente cuando está disponible al corte.
export function finvizInstitutional(snapshot:CompanyResearch):ResearchVariable|undefined{
  // Selecciona institutionalTransactions, correspondiente a Inst Trans; Inst Own por sí solo no mide cambios.
  const value=snapshot.finviz?.metrics.institutionalTransactions;
  // Devuelve el dato si knownBy confirma valor, clase y fechas utilizables; en caso contrario devuelve
  // undefined.
  return value&&knownBy(value,snapshot.asOf)?value:undefined;
// Cierra el bloque, objeto o declaración iniciado anteriormente.
}
