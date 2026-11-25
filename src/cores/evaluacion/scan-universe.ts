import type { ScannerSettings } from './scanner-settings.ts';
export function scanUniverse(catalog:readonly {symbol:string;sector:string}[],current:readonly string[],choice:ScannerSettings['scan']['universe']):string[]{
  const allowed=choice==='technology'?catalog.filter(c=>['Tecnología','Semiconductores'].includes(c.sector)):choice==='current-list'?catalog.filter(c=>current.includes(c.symbol)):catalog;
  return [...new Set(allowed.map(c=>c.symbol))].slice(0,14);
}
export function filterScanResults<T extends {symbol:string;score:number|null;probabilityOfProfit?:number|null}>(rows:readonly T[],settings:ScannerSettings['scan']):(T&{score:number})[]{
  return rows.filter((row):row is T&{score:number}=>row.score!==null&&Number.isFinite(row.score)&&row.score>=settings.minConfluence).sort((a,b)=>{
    const pop=(row:T)=>row.probabilityOfProfit!==null&&row.probabilityOfProfit!==undefined&&Number.isFinite(row.probabilityOfProfit)?row.probabilityOfProfit:-1;
    return (settings.order==='pop'?pop(b)-pop(a):0)||b.score-a.score||a.symbol.localeCompare(b.symbol);
  }).slice(0,settings.limit);
}
