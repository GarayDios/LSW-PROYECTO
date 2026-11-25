import { missingVariable } from '../../cores/compartido/research-model.ts';
import { INSTITUTIONAL_SECURITIES, TRACKED_MANAGERS, compareInstitutionalReports, parseHoldingsTable, previousQuarter, validDate, xmlValue, type InstitutionalResearch, type InstitutionalManager } from '../../cores/02-flujo-institucional/sec-13f.ts';
import { secJson, secText, type SecResearchConfig } from './sec.ts';
import { numeric, record, researchJson, timestamp, validateResearchRequest, type ResearchFetch, ResearchProviderError } from './http.ts';
import type { AlpacaResearchConfig } from './alpaca.ts';

const SOURCE='SEC 13F · muestra de gestores';
export type SplitFactorProvider=(symbol:string,cusip:string,start:string,end:string)=>Promise<number|{factor:number;source:string}>;
const caches=new WeakMap<ResearchFetch,Map<string,{expires:number;value:Promise<unknown>}>>();
async function cached<T>(fetcher:ResearchFetch,key:string,ttl:number,load:()=>Promise<T>):Promise<T>{
  let cache=caches.get(fetcher);if(!cache){cache=new Map();caches.set(fetcher,cache);}
  const existing=cache.get(key);if(existing&&existing.expires>Date.now())return existing.value as Promise<T>;
  if(cache.size>=64)cache.delete(cache.keys().next().value!);
  const entry={expires:Date.now()+ttl,value:load()};cache.set(key,entry);
  try{return await entry.value;}catch(error){if(cache.get(key)===entry)cache.delete(key);throw error;}
}
export function missingInstitutional(message='Configura SEC_USER_AGENT y Alpaca para consultar posiciones 13F y verificar splits.'):InstitutionalResearch{
  return {status:{source:SOURCE,status:'missing_config',message},cusip:null,managers:[],configured:TRACKED_MANAGERS.length,comparable:0,direction:missingVariable(SOURCE,message),warnings:[]};
}
type Filing={form:string;accession:string;period:string;availableAt:string;document:string};
export function knownInstitutionalFilings(body:unknown,asOf:string):Filing[]{
  const recent=record(record(record(body).filings).recent),forms=Array.isArray(recent.form)?recent.form:[];
  const at=(key:string,i:number)=>Array.isArray(recent[key])?recent[key][i]:null;
  return forms.flatMap((form,i)=>{
    const period=at('reportDate',i),accession=at('accessionNumber',i),document=at('primaryDocument',i),filed=at('filingDate',i),accepted=timestamp(at('acceptanceDateTime',i));
    if(!['13F-HR','13F-HR/A','13F-NT','13F-NT/A'].includes(String(form))||!validDate(period)||!/(?:03-31|06-30|09-30|12-31)$/.test(period)||!validDate(filed)||typeof accession!=='string'||!/^\d{10}-\d{2}-\d{6}$/.test(accession)||typeof document!=='string')return [];
    const availableAt=accepted??new Date(filed+'T23:59:59-05:00').toISOString();
    if(Date.parse(availableAt)>Date.parse(asOf)||Date.parse(availableAt)<Date.parse(period))return [];
    return [{form:String(form),accession,period,availableAt,document}];
  }).sort((a,b)=>b.period.localeCompare(a.period)||b.availableAt.localeCompare(a.availableAt)||b.accession.localeCompare(a.accession));
}

async function loadReport(cik:string,filing:Filing,headers:Record<string,string>,fetcher:ResearchFetch){
  const base=`https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${filing.accession.replaceAll('-','')}/`;
  return cached(fetcher,`13f:${headers['User-Agent']}:${cik}:${filing.accession}`,86400000,async()=>{
    if(!/^13F-HR(?:\/A)?$/.test(filing.form))throw Error('El gestor presentó una notificación sin tabla de posiciones.');
    const document=filing.document.split('/').at(-1)!;
    if(!/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.xml$/.test(document)||document.includes('..'))throw Error('Documento SEC no válido.');
    const cover=await secText(new URL(base+document),headers,fetcher);
    if(/<!DOCTYPE|<!ENTITY/i.test(cover)||xmlValue(cover,'cik')?.padStart(10,'0')!==cik)throw Error('El reporte no corresponde al gestor.');
    const period=filing.period.slice(5,7)+'-'+filing.period.slice(8,10)+'-'+filing.period.slice(0,4);
    if(xmlValue(cover,'reportCalendarOrQuarter')!==period||xmlValue(cover,'submissionType')!==filing.form)throw Error('Fecha o formulario SEC no coincidente.');
    if(filing.form.endsWith('/A')&&xmlValue(cover,'amendmentType')!=='RESTATEMENT')throw Error('Enmienda aditiva: falta consolidar sus posiciones con el reporte original. Se excluye este gestor.');
    if(xmlValue(cover,'isConfidentialOmitted')!=='false')throw Error('El reporte omite posiciones o no confirma su cobertura pública.');
    const total=Number(xmlValue(cover,'tableEntryTotal'));if(!Number.isSafeInteger(total)||total<=0)throw Error('La tabla SEC no tiene un total verificable.');
    const index=record(record(await secJson(new URL(base+'index.json'),headers,fetcher)).directory);
    if(!Array.isArray(index.item))throw Error('No se recibió el índice SEC.');
    const files=index.item.map(record).filter(row=>typeof row.name==='string'&&/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\.xml$/.test(row.name)&&!row.name.includes('..')&&row.name!==document&&row.name!=='index.xml');
    if(!files.length||files.length>8||files.some(row=>numeric(row.size)===null||numeric(row.size)!>20000000))throw Error('Tablas SEC ausentes, excesivas o incompletas.');
    const positions:Record<string,number>={};let entries=0;
    for(const file of files){
      const table=parseHoldingsTable(await secText(new URL(base+file.name),headers,fetcher));entries+=table.entries;
      for(const [cusip,shares] of Object.entries(table.positions))positions[cusip]=(positions[cusip]??0)+shares;
    }
    if(entries!==total)throw Error('La cantidad de filas no coincide con el total declarado.');
    return {positions,url:base+document};
  });
}

export function institutionalSplitFactor(body:unknown,symbol:string,cusip:string,start:string,end:string):number{
  const root=record(body),actions=record(root.corporate_actions);
  if(!root.corporate_actions||typeof root.corporate_actions!=='object'||Array.isArray(root.corporate_actions)||root.next_page_token)throw Error('No hay cobertura completa de splits.');
  let factor=1;const seen=new Map<string,string>();
  for(const type of ['forward_splits','reverse_splits']){
    if(actions[type]!==undefined&&!Array.isArray(actions[type]))throw Error('Splits no válidos.');
    for(const raw of actions[type] as unknown[]??[]){
      const row=record(raw),old=numeric(row.old_rate),next=numeric(row.new_rate),date=row.ex_date;
      if(row.symbol!==symbol||typeof row.id!=='string'||!row.id||!validDate(date)||date<start||date>end||old===null||next===null||old<=0||next<=0)throw Error('No se pudo verificar el ajuste de acciones.');
      if(type==='reverse_splits'&&(row.new_cusip!==cusip||row.old_cusip!==cusip||row.new_symbol&&row.new_symbol!==symbol)||type==='forward_splits'&&row.cusip!==cusip)throw Error('Cambió el identificador del valor; requiere correspondencia explícita.');
      const signature=JSON.stringify([type,date,old,next]);if(seen.has(row.id)){if(seen.get(row.id)!==signature)throw Error('Splits contradictorios.');continue;}seen.set(row.id,signature);
      factor*=next/old;
    }
  }
  if(!Number.isFinite(factor)||factor<=0)throw Error('Factor de split no válido.');return factor;
}

/** A bounded, explicitly named sample, not all institutional ownership or live order flow. */
export async function fetchInstitutionalResearch(sec:SecResearchConfig|undefined,alpaca:AlpacaResearchConfig|undefined,symbol:string,asOf:string,fetcher:ResearchFetch=fetch,now=new Date(),splitFactor?:SplitFactorProvider):Promise<InstitutionalResearch>{
  validateResearchRequest(symbol,asOf);
  const result=missingInstitutional(),cusip=INSTITUTIONAL_SECURITIES[symbol];result.cusip=cusip??null;
  if(!sec?.userAgent||!/\S+@\S+/.test(sec.userAgent)||/[\r\n]/.test(sec.userAgent)||!alpaca&&!splitFactor)return result;
  if(!cusip||Date.parse(asOf)<now.getTime())return {...result,status:{source:SOURCE,status:'unavailable',message:!cusip?'Sin correspondencia CUSIP verificada para este símbolo.':'Los ajustes corporativos consultados ahora no se retrofechan a un corte histórico. Consulta variables actuales.'}};
  const headers={'User-Agent':sec.userAgent};
  result.managers=await Promise.all(TRACKED_MANAGERS.map(async manager=>{
    const row:InstitutionalManager={...manager,message:''};
    try{
      const submissions=await cached(fetcher,`submissions:${sec.userAgent}:${manager.cik}`,1800000,()=>secJson(new URL(`https://data.sec.gov/submissions/CIK${manager.cik}.json`),headers,fetcher));
      const filings=knownInstitutionalFilings(submissions,asOf),current=filings[0],previous=current?filings.find(f=>f.period===previousQuarter(current.period)):undefined;
      if(!current||!previous)throw Error('Faltan dos trimestres consecutivos publicados en el historial reciente.');
      if(Date.parse(asOf)-Date.parse(current.period)>200*86400000)throw Error('Los reportes del gestor están desactualizados.');
      const [latest,prior]=await Promise.all([loadReport(manager.cik,current,headers,fetcher),loadReport(manager.cik,previous,headers,fetcher)]);
      if(latest.positions[cusip]===undefined||prior.positions[cusip]===undefined)throw Error('El valor no aparece en ambas tablas; una ausencia no se convierte en venta total.');
      const start=new Date(Date.parse(previous.period)+86400000).toISOString().slice(0,10);
      const split=splitFactor?await splitFactor(symbol,cusip,start,current.period):await cached(fetcher,`splits:${alpaca!.apiKey}:${symbol}:${previous.period}:${current.period}`,3600000,async()=>{
        const url=new URL('https://data.alpaca.markets/v1/corporate-actions');
        Object.entries({symbols:symbol,types:'forward_split,reverse_split',start,end:current.period,data_quality:'all',limit:'1000'}).forEach(([k,v])=>url.searchParams.set(k,v));
        return institutionalSplitFactor(await researchJson(url,{'APCA-API-KEY-ID':alpaca!.apiKey,'APCA-API-SECRET-KEY':alpaca!.secretKey},fetcher),symbol,cusip,start,current.period);
      });
      const factor=typeof split==='number'?split:split.factor,splitSource=typeof split==='number'?'Alpaca corporate actions':split.source;
      row.current={period:current.period,availableAt:current.availableAt,accession:current.accession,url:latest.url,shares:latest.positions[cusip],amended:current.form.endsWith('/A')};
      row.previous={period:previous.period,availableAt:previous.availableAt,accession:previous.accession,url:prior.url,shares:prior.positions[cusip],amended:previous.form.endsWith('/A')};
      Object.assign(row,compareInstitutionalReports(row.current,row.previous,factor));
      row.message=`Comparación de acciones declaradas, ajustada por splits de ${splitSource}; cobertura de este gestor.`;
    }catch(error){row.message=error instanceof ResearchProviderError?error.message:error instanceof Error&&!/https?:|token|secret|api.?key/i.test(error.message)?error.message:'No se pudo validar el reporte del gestor.';}
    return row;
  }));
  // Do not blend managers reporting different quarters into the same signal.
  const latestPeriod=result.managers.flatMap(m=>m.current?[m.current.period]:[]).sort().at(-1);
  for(const manager of result.managers)if(manager.current&&manager.current.period!==latestPeriod){delete manager.direction;manager.message='El gestor no tiene el mismo trimestre que la muestra más reciente; se excluye de la puntuación.';}
  const comparable=result.managers.filter(m=>m.direction!==undefined);result.comparable=comparable.length;
  result.status={source:SOURCE,status:comparable.length?'partial':'unavailable',message:`${comparable.length}/${TRACKED_MANAGERS.length} gestores comparables. Muestra acotada: Geode y State Street; no representa todo el mercado ni flujo intradía.`};
  if(comparable.length)result.direction={value:comparable.reduce((sum,m)=>sum+m.direction!,0)/comparable.length,kind:'estimated',source:SOURCE,observedAt:latestPeriod+'T23:59:59Z',availableAt:now.toISOString(),reason:'Media por gestor de (acciones actuales − anteriores ajustadas) / (actuales + anteriores ajustadas). No mide dinero comprado/vendido ni identifica operaciones individuales.'};
  result.warnings=['Los reportes 13F describen posiciones al cierre trimestral y pueden publicarse hasta 45 días después.','La muestra de dos gestores puede tener sesgos y exposiciones relacionadas. No se suman sus posiciones como propiedad total.','Se excluyen opciones, importes en principal, omisiones confidenciales, enmiendas aditivas pendientes y valores sin dos posiciones verificables.','Los cambios pueden reflejar transferencias de mandatos, reorganizaciones u otros eventos además de operaciones.'];
  return result;
}
