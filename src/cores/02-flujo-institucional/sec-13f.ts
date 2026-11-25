import type { ProviderStatus, ResearchVariable } from '../compartido/research-model.ts';

/** Verified against the Geode 2026-Q3 official information table. Class A and C
 * are separate securities; unknown symbols never fall back to issuer-name search. */
export const INSTITUTIONAL_SECURITIES:Record<string,string>={AAPL:'037833100',NVDA:'67066G104',MSFT:'594918104',TSLA:'88160R101',AMZN:'023135106',META:'30303M102',GOOGL:'02079K305',AMD:'007903107',JPM:'46625H100',KO:'191216100',DIS:'254687106',PLTR:'69608A108',AVGO:'11135F101',NFLX:'64110L106'};
export const TRACKED_MANAGERS=[{cik:'0001214717',name:'Geode Capital Management'},{cik:'0000093751',name:'State Street'}] as const;
export type InstitutionalReport={period:string;availableAt:string;accession:string;url:string;shares:number;amended:boolean};
export type InstitutionalManager={cik:string;name:string;message:string;current?:InstitutionalReport;previous?:InstitutionalReport;splitFactor?:number;change?:number;direction?:number};
export type InstitutionalResearch={status:ProviderStatus;cusip:string|null;managers:InstitutionalManager[];configured:number;comparable:number;direction:ResearchVariable;warnings:string[]};
export type HoldingsTable={positions:Record<string,number>;entries:number};
const prefix='(?:[A-Za-z_][\\w.-]*:)?';
export function xmlValue(xml:string,key:string):string|null{
  return xml.match(new RegExp(`<${prefix}${key}\\b[^>]*>([^<]*)<\\/${prefix}${key}\\s*>`,'i'))?.[1]?.trim()??null;
}
export function validDate(value:unknown):value is string{return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;}
export function previousQuarter(period:string):string{
  const date=new Date(period+'T00:00:00Z');date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-2);date.setUTCDate(0);return date.toISOString().slice(0,10);
}
export function parseHoldingsTable(xml:string):HoldingsTable{
  if(/<!DOCTYPE|<!ENTITY/i.test(xml)||!new RegExp(`<${prefix}informationTable\\b`,'i').test(xml)||!new RegExp(`<\\/${prefix}informationTable\\s*>`,'i').test(xml))throw Error('Tabla 13F no válida.');
  const blocks=[...xml.matchAll(new RegExp(`<${prefix}infoTable\\b[^>]*>([\\s\\S]*?)<\\/${prefix}infoTable\\s*>`,'gi'))];
  const starts=xml.match(new RegExp(`<${prefix}infoTable\\b`,'gi'))?.length??0;
  if(starts!==blocks.length||blocks.length>100000)throw Error('Tabla 13F truncada o excesiva.');
  const positions:Record<string,number>={};
  for(const block of blocks){
    const item=block[1],cusip=xmlValue(item,'cusip'),type=xmlValue(item,'sshPrnamtType'),option=xmlValue(item,'putCall'),raw=xmlValue(item,'sshPrnamt');
    if(option||type!=='SH')continue;
    if(!cusip||!/^[A-Z0-9*@#]{9}$/.test(cusip)||raw===null||!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))throw Error('Posición 13F inválida.');
    positions[cusip]=(positions[cusip]??0)+Number(raw);
    if(!Number.isSafeInteger(positions[cusip]))throw Error('Posición fuera de rango.');
  }
  return {positions,entries:blocks.length};
}
export function compareInstitutionalReports(current:InstitutionalReport,previous:InstitutionalReport,factor:number):Pick<InstitutionalManager,'change'|'direction'|'splitFactor'>{
  if(previousQuarter(current.period)!==previous.period||!Number.isFinite(factor)||factor<=0||current.shares<0||previous.shares<0||current.shares+previous.shares===0)throw Error('Períodos o acciones no comparables.');
  const adjusted=previous.shares*factor,denominator=current.shares+adjusted;
  if(!Number.isFinite(adjusted)||!denominator)throw Error('Base ajustada no válida.');
  return {splitFactor:factor,change:adjusted>0?(current.shares-adjusted)/adjusted:undefined,direction:(current.shares-adjusted)/denominator};
}
