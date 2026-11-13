import { blackScholes, type StrategyId } from '../../cores/index.ts';
import type { Company } from '../market/data.ts';

export type CyclePhase = 'put' | 'shares' | 'covered-call' | 'active' | 'pmcc-long' | 'pmcc-assigned' | 'closed';
export type Scenario = 'up' | 'down' | 'flat' | 'recovery';
export interface CycleConfig {
  id: string; strategy: StrategyId; symbol: string; capital: number; contracts: number;
  startDate: string; spot: number; iv: number; rate: number; dividendYield: number;
  shortStrike: number; longStrike: number; shortPremium: number; longPremium: number;
  shortDays: number; longDays: number; feePerContract: number; feePerShare: number;
}
export interface CycleLeg { id: string; type: 'call' | 'put'; quantity: number; strike: number; premium: number; expiry: string }
export interface CycleEvent { sequence: number; date: string; kind: 'open'|'market'|'assignment'|'exercise'|'expiry'|'hedge'|'close'|'complete'; title: string; detail: string; spot: number; cash: number; shares: number; equity: number; pnl: number }
export interface SimCycle {
  version: 1; id: string; config: CycleConfig; strategy: StrategyId; symbol: string;
  date: string; spot: number; phase: CyclePhase; cash: number; shares: number; stockBasis: number;
  realizedOptions: number; realizedShares: number; fees: number; legs: CycleLeg[]; events: CycleEvent[];
}
export const phaseNames: Record<CyclePhase, string> = { put: 'PUT vendida', shares: 'Acciones asignadas', 'covered-call': 'Call cubierta', active: 'Posición abierta', 'pmcc-long': 'Call larga disponible', 'pmcc-assigned': 'Asignación por resolver', closed: 'Ciclo completado' };
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const validDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().slice(0,10) === s;
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b+'T00:00:00Z')-Date.parse(a+'T00:00:00Z'))/86400000);
export function addDays(date: string, days: number): string { const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10); }

function validateConfig(c: CycleConfig) {
  if (!c || !['wheel','pmcc','backspread','gamma'].includes(c.strategy) || typeof c.id!=='string' || !c.id || typeof c.symbol!=='string' || !c.symbol || !validDate(c.startDate)) throw new RangeError('Selecciona estrategia, empresa y una fecha válida.');
  if (![c.capital,c.contracts,c.spot,c.iv,c.rate,c.dividendYield,c.shortStrike,c.longStrike,c.shortPremium,c.longPremium,c.shortDays,c.longDays,c.feePerContract,c.feePerShare].every(Number.isFinite)) throw new RangeError('Los parámetros deben ser números finitos.');
  if(c.capital<=0||c.capital>1e7||!Number.isInteger(c.contracts)||c.contracts<1||c.contracts>100||c.spot<=0||c.spot>1e6||c.iv<.01||c.iv>3||c.rate<-.2||c.rate>.5||c.dividendYield<0||c.dividendYield>.5) throw new RangeError('Revisa capital, contratos, precio, volatilidad y tasa.');
  if([c.spot,c.shortStrike,c.longStrike,c.shortPremium,c.longPremium].some(n=>n<=0||n>1e6||Math.abs(n*100-Math.round(n*100))>1e-6))throw new RangeError('Precio, strikes y primas deben ser positivos y tener hasta dos decimales.');
  if(!Number.isInteger(c.shortDays)||c.shortDays<1||c.shortDays>730||!Number.isInteger(c.longDays)||c.longDays<1||c.longDays>3650||c.feePerContract<0||c.feePerContract>100||c.feePerShare<0||c.feePerShare>10)throw new RangeError('Revisa los plazos y las comisiones.');
  if(c.strategy==='pmcc'&&(c.longDays<=c.shortDays||c.longStrike>=c.shortStrike||c.longPremium<=c.shortPremium))throw new RangeError('PMCC requiere call larga de strike menor y vencimiento posterior, con débito neto positivo.');
  if(c.strategy==='backspread'&&c.shortStrike>=c.longStrike)throw new RangeError('Backspread requiere vender el strike inferior y comprar dos calls del superior.');
}
export function defaultCycleConfig(company: Company, strategy: StrategyId, rate=.04): CycleConfig {
  const spot=round(company.price), k=(p:number)=>Math.max(5,Math.round(p/5)*5);
  const config: CycleConfig={id:'draft',strategy,symbol:company.symbol,capital:20000,contracts:1,startDate:'2026-11-09',spot,iv:company.iv,rate,dividendYield:company.dividendYield,shortStrike:k(spot*.95),longStrike:k(spot*1.03),shortPremium:1,longPremium:1,shortDays:32,longDays:375,feePerContract:0,feePerShare:0};
  if(strategy==='pmcc'){config.shortStrike=k(spot*1.08);config.longStrike=k(spot*.68);}
  if(strategy==='gamma')config.longStrike=k(spot);
  if(strategy==='backspread')config.longStrike=Math.max(config.shortStrike+5,k(spot*1.02));
  const price=(strike:number,days:number,type:'call'|'put')=>Math.max(.01,round(blackScholes({spot,strike,days,volatility:company.iv,rate,dividendYield:company.dividendYield,type}).price));
  config.shortPremium=price(config.shortStrike,32,strategy==='wheel'?'put':'call');
  config.longPremium=price(config.longStrike,strategy==='pmcc'?375:32,'call');
  if(company.symbol==='NVDA'){
    if(strategy==='wheel')Object.assign(config,{shortStrike:140,longStrike:145,shortPremium:4,longPremium:3});
    if(strategy==='pmcc')Object.assign(config,{shortStrike:160,longStrike:100,shortPremium:4,longPremium:52});
    if(strategy==='backspread')Object.assign(config,{shortStrike:140,longStrike:150,shortPremium:12,longPremium:7});
    if(strategy==='gamma')Object.assign(config,{longStrike:150,longPremium:8.37});
  }
  config.capital=strategy==='wheel'?Math.max(20000,Math.ceil(config.shortStrike*100/1000)*1000+1000):strategy==='pmcc'?Math.max(20000,Math.ceil(config.longPremium*100/1000)*1000+1000):strategy==='backspread'?Math.max(5000,Math.ceil((config.longStrike-config.shortStrike+2*config.longPremium-config.shortPremium)*100/1000)*1000+1000):Math.max(10000,Math.ceil(spot*70/1000)*1000);
  return config;
}
function optionMark(c: SimCycle, leg: CycleLeg) {
  return blackScholes({spot:c.spot,strike:leg.strike,days:Math.max(0,daysBetween(c.date,leg.expiry)),volatility:c.config.iv,rate:c.config.rate,dividendYield:c.config.dividendYield,type:leg.type});
}
export function cycleValue(c: SimCycle) {
  const optionsValue=c.legs.reduce((sum,l)=>sum+l.quantity*100*optionMark(c,l).price,0);
  const equity=c.cash+c.shares*c.spot+optionsValue;
  const realized=c.realizedOptions+c.realizedShares-c.fees;
  const unrealized=c.legs.reduce((sum,l)=>sum+l.quantity*100*(optionMark(c,l).price-l.premium),0)+c.shares*(c.spot-c.stockBasis);
  const delta=c.shares+c.legs.reduce((sum,l)=>sum+l.quantity*100*optionMark(c,l).delta,0);
  return {equity:round(equity),pnl:round(equity-c.config.capital),realized:round(realized),unrealized:round(unrealized),optionsValue:round(optionsValue),stockValue:round(c.shares*c.spot),delta:round(delta),returnPct:round((equity-c.config.capital)/c.config.capital*100)};
}
function record(c: SimCycle, kind: CycleEvent['kind'], title: string, detail: string) {
  const v=cycleValue(c);c.events.push({sequence:c.events.length+1,date:c.date,kind,title,detail,spot:c.spot,cash:c.cash,shares:c.shares,equity:v.equity,pnl:v.pnl});
}
function charge(c:SimCycle,fee:number){const amount=round(fee);c.cash=round(c.cash-amount);c.fees=round(c.fees+amount);}
function tradeShares(c:SimCycle,quantity:number,price:number,fee=true){
  if(!quantity)return;
  const old=c.shares,next=old+quantity;
  if(old===0||Math.sign(old)===Math.sign(quantity))c.stockBasis=(Math.abs(old)*c.stockBasis+Math.abs(quantity)*price)/Math.abs(next);
  else{c.realizedShares=round(c.realizedShares+Math.min(Math.abs(old),Math.abs(quantity))*Math.sign(old)*(price-c.stockBasis));if(next===0)c.stockBasis=0;else if(Math.sign(next)!==Math.sign(old))c.stockBasis=price;}
  c.cash=round(c.cash-quantity*price);c.shares=next;if(fee)charge(c,Math.abs(quantity)*c.config.feePerShare);
}
function openLeg(c:SimCycle,leg:Omit<CycleLeg,'id'>){
  c.cash=round(c.cash-leg.quantity*100*leg.premium);charge(c,Math.abs(leg.quantity)*c.config.feePerContract);
  c.legs.push({...leg,id:`${c.id}-leg-${c.events.length}-${c.legs.length}`});
}
function hedge(c:SimCycle){
  const desired=Math.round(-c.legs.reduce((sum,l)=>sum+l.quantity*100*optionMark(c,l).delta,0));
  const change=desired-c.shares;if(!change)return;
  tradeShares(c,change,c.spot);record(c,'hedge','Cobertura delta ajustada',`${change>0?'Compra':'Venta corta'} de ${Math.abs(change)} acciones a $${c.spot.toFixed(2)}. Objetivo: neutralizar delta con acciones enteras.`);
}
export function createCycle(config:CycleConfig):SimCycle{
  validateConfig(config);const q=config.contracts,fee=config.feePerContract;
  const needed=config.strategy==='wheel'?config.shortStrike*100*q+fee*q:config.strategy==='pmcc'?(config.longPremium-config.shortPremium)*100*q+2*q*fee:config.strategy==='backspread'?Math.max(0,config.longStrike-config.shortStrike+2*config.longPremium-config.shortPremium)*100*q+3*q*fee:config.longPremium*100*q+config.spot*50*q+fee*q+100*q*config.feePerShare;
  if(config.capital+1e-8<needed)throw new RangeError(`Capital insuficiente para el ejercicio. Reserva al menos $${needed.toFixed(2)} (regla de garantía del simulador).`);
  const c:SimCycle={version:1,id:config.id,config:{...config},strategy:config.strategy,symbol:config.symbol,date:config.startDate,spot:config.spot,phase:config.strategy==='wheel'?'put':'active',cash:config.capital,shares:0,stockBasis:0,realizedOptions:0,realizedShares:0,fees:0,legs:[],events:[]};
  const expiry=addDays(c.date,config.shortDays);
  if(c.strategy==='wheel')openLeg(c,{type:'put',quantity:-q,strike:config.shortStrike,premium:config.shortPremium,expiry});
  if(c.strategy==='pmcc'){openLeg(c,{type:'call',quantity:q,strike:config.longStrike,premium:config.longPremium,expiry:addDays(c.date,config.longDays)});openLeg(c,{type:'call',quantity:-q,strike:config.shortStrike,premium:config.shortPremium,expiry});}
  if(c.strategy==='backspread'){openLeg(c,{type:'call',quantity:-q,strike:config.shortStrike,premium:config.shortPremium,expiry});openLeg(c,{type:'call',quantity:2*q,strike:config.longStrike,premium:config.longPremium,expiry});}
  if(c.strategy==='gamma')openLeg(c,{type:'call',quantity:q,strike:config.longStrike,premium:config.longPremium,expiry});
  record(c,'open','Ciclo iniciado',`${q} contrato(s) base. Entradas con primas manuales; posiciones abiertas valoradas por BSM. Capital asignado: $${config.capital.toFixed(2)}.`);
  if(c.strategy==='gamma')hedge(c);return c;
}
const clone=(c:SimCycle):SimCycle=>structuredClone(c);
function ensureActive(c:SimCycle){if(c.phase==='closed')throw new RangeError('El ciclo ya terminó. Inicia otro para repetir la estrategia.');}
function inTheMoney(c:SimCycle,l:CycleLeg){return (l.type==='call'?c.spot-l.strike:l.strike-c.spot)>=.01-1e-8;}
function settleLeg(c:SimCycle,leg:CycleLeg,early=false){
  c.legs=c.legs.filter(l=>l.id!==leg.id);c.realizedOptions=round(c.realizedOptions-leg.quantity*100*leg.premium);
  if(inTheMoney(c,leg)){
    const shares=leg.quantity*100*(leg.type==='call'?1:-1);tradeShares(c,shares,leg.strike,false);
    record(c,leg.quantity<0?'assignment':'exercise',leg.quantity<0?'Asignación simulada':'Ejercicio simulado',`${early?'Asignación anticipada solicitada por el usuario. ':''}${leg.type.toUpperCase()} ${leg.strike}: ${shares>0?'recibes':'entregas'} ${Math.abs(shares)} acciones a $${leg.strike.toFixed(2)}. Regla mecánica educativa; no predice asignaciones reales.`);
  }else record(c,'expiry','Opción vencida sin ejercicio',`${Math.abs(leg.quantity)} ${leg.type.toUpperCase()} ${leg.strike}; prima contabilizada, sin intercambio de acciones.`);
}
function finish(c:SimCycle,title='Ciclo completado'){
  if(c.shares){const q=-c.shares;tradeShares(c,q,c.spot);record(c,'close','Acciones liquidadas',`Cierre de ${Math.abs(q)} acciones a $${c.spot.toFixed(2)}.`);}
  c.phase='closed';record(c,'complete',title,'Sin opciones ni acciones abiertas. El resultado incluye primas, liquidaciones y comisiones configuradas.');
}
function expiryBoundary(c:SimCycle){
  const due=c.legs.filter(l=>l.expiry<=c.date);if(!due.length)return;
  for(const leg of due)settleLeg(c,leg);
  if(c.strategy==='wheel'){
    if(c.shares>0)c.phase='shares';else finish(c,'Vuelta de Wheel completada');
  }else if(c.strategy==='pmcc'&&c.legs.length){c.phase=c.shares<0?'pmcc-assigned':'pmcc-long';}
  else if(!c.legs.length)finish(c);
}
export function advanceCycle(original:SimCycle,market:{date:string;spot:number}):SimCycle{
  ensureActive(original);
  if(!validDate(market.date)||market.date<=original.date||daysBetween(original.date,market.date)>3650||!Number.isFinite(market.spot)||market.spot<=0||market.spot>1e6||Math.abs(market.spot*100-Math.round(market.spot*100))>1e-6)throw new RangeError('Avanza a una fecha posterior y usa un precio positivo con hasta dos decimales.');
  const c=clone(original),start=c.date,startSpot=c.spot,total=daysBetween(start,market.date);
  const boundaries=[...new Set(c.legs.map(l=>l.expiry).filter(d=>d>start&&d<=market.date))].sort();
  for(const date of boundaries){c.date=date;c.spot=round(startSpot+(market.spot-startSpot)*daysBetween(start,date)/total);record(c,'market','Fecha de vencimiento alcanzada','Si se saltan fechas, el precio intermedio se interpola linealmente entre los dos puntos del escenario.');expiryBoundary(c);if(c.phase==='closed')return c;}
  c.date=market.date;c.spot=market.spot;record(c,'market','Escenario actualizado','Precio elegido por el usuario; no es una cotización de mercado.');
  if(c.strategy==='gamma'&&c.legs.length)hedge(c);
  if(cycleValue(c).equity<=0)return closeCycle(c,'Salida por agotamiento del capital');
  return c;
}
export function writeNextOption(original:SimCycle):SimCycle{
  ensureActive(original);const c=clone(original),q=c.config.contracts;let strike:number,expiry:string,premium:number;
  if(c.strategy==='wheel'&&c.phase==='shares'&&c.shares>=100*q){strike=c.config.longStrike;expiry=addDays(c.date,c.config.shortDays);premium=c.config.longPremium;c.phase='covered-call';}
  else if(c.strategy==='pmcc'&&c.phase==='pmcc-long'&&c.shares===0){
    const long=c.legs.find(l=>l.quantity>0)!;const days=Math.min(c.config.shortDays,daysBetween(c.date,long.expiry)-1);if(days<1)throw new RangeError('No queda plazo para otra call corta antes del vencimiento largo.');
    strike=c.config.shortStrike;expiry=addDays(c.date,days);premium=Math.max(.01,round(blackScholes({spot:c.spot,strike,days,volatility:c.config.iv,rate:c.config.rate,dividendYield:c.config.dividendYield,type:'call'}).price));c.phase='active';
  }else throw new RangeError('Esta fase no permite abrir otra call. Primero resuelve la posición actual.');
  openLeg(c,{type:'call',quantity:-q,strike,expiry,premium});record(c,'open',c.strategy==='wheel'?'Call cubierta vendida':'Call corta renovada',`${q} CALL ${strike}, vencimiento ${expiry}, prima $${premium.toFixed(2)} por acción. ${c.strategy==='wheel'?'Prima del ejercicio configurada al iniciar el ciclo.':'Nueva prima calculada con BSM.'}`);return c;
}
export function assignShortOption(original:SimCycle):SimCycle{
  ensureActive(original);const c=clone(original),leg=c.legs.find(l=>l.quantity<0&&inTheMoney(c,l));if(!leg)throw new RangeError('No hay una opción vendida dentro del dinero para este ejercicio de asignación.');
  settleLeg(c,leg,true);
  if(c.strategy==='wheel'){if(c.shares>0)c.phase='shares';else finish(c,'Acciones entregadas · Wheel completada');}
  else if(c.strategy==='pmcc')c.phase='pmcc-assigned';
  return c;
}
export function closeCycle(original:SimCycle,title='Ciclo cerrado por el usuario'):SimCycle{
  ensureActive(original);const c=clone(original);
  for(const leg of [...c.legs]){const exit=optionMark(c,leg).price;c.cash=round(c.cash+leg.quantity*100*exit);c.realizedOptions=round(c.realizedOptions+leg.quantity*100*(exit-leg.premium));charge(c,Math.abs(leg.quantity)*c.config.feePerContract);c.legs=c.legs.filter(l=>l.id!==leg.id);record(c,'close','Contrato cerrado a valor teórico',`${Math.abs(leg.quantity)} ${leg.type.toUpperCase()} ${leg.strike}, precio BSM $${exit.toFixed(4)} por acción.`);}
  finish(c,title);return c;
}
export function runScenario(original:SimCycle,scenario:Scenario):SimCycle{
  ensureActive(original);if(!['up','down','flat','recovery'].includes(scenario))throw new RangeError('Selecciona un escenario válido.');let c=clone(original);
  const base=c.spot;
  if(c.strategy==='wheel'){
    if(c.legs.length){const spot=scenario==='recovery'?c.config.shortStrike*.93:base*(scenario==='up'?1.12:scenario==='down'?.75:1);c=advanceCycle(c,{date:c.legs[0].expiry,spot:round(spot)});}
    if(c.phase==='shares'){c=writeNextOption(c);const spot=scenario==='recovery'?c.config.longStrike*1.05:base*(scenario==='up'?1.15:scenario==='down'?.65:1);c=advanceCycle(c,{date:c.legs[0].expiry,spot:round(spot)});}
  }else if(c.strategy==='gamma'){
    const expiry=c.legs[0].expiry,days=daysBetween(c.date,expiry),steps=Math.min(12,days),start=c.date;
    for(let i=1;i<=steps&&c.phase!=='closed';i++){const progress=i/steps,factor=scenario==='up'?1+.2*progress:scenario==='down'?1-.25*progress:scenario==='recovery'?1+.10*Math.sin(i*Math.PI/2):1;c=advanceCycle(c,{date:addDays(start,Math.max(1,Math.round(days*progress))),spot:Math.max(.01,round(base*factor))});}
  }else{
    const expiry=[...c.legs].sort((a,b)=>a.expiry.localeCompare(b.expiry))[0].expiry;
    const factor=scenario==='up'?1.20:scenario==='down'?.75:scenario==='recovery'?1.08:1;c=advanceCycle(c,{date:expiry,spot:round(base*factor)});
  }
  if(c.phase!=='closed')c=closeCycle(c,'Fin del escenario · posiciones liquidadas');return c;
}
export function accountSummary(cycles:readonly SimCycle[],initial=100000){
  const active=cycles.filter(c=>c.phase!=='closed'),closed=cycles.filter(c=>c.phase==='closed');
  const realized=cycles.reduce((sum,c)=>sum+cycleValue(c).realized,0),unrealized=cycles.reduce((sum,c)=>sum+cycleValue(c).unrealized,0);
  const committed=active.reduce((sum,c)=>sum+c.config.capital,0),available=initial+closed.reduce((sum,c)=>sum+cycleValue(c).pnl,0)-committed;
  return {initial,equity:round(initial+realized+unrealized),realized:round(realized),unrealized:round(unrealized),available:round(available),committed:round(committed),active:active.length,closed:closed.length};
}
export function isSimCycle(value:unknown):value is SimCycle{
  try{const c=value as SimCycle;if(!c||c.version!==1||!c.config||c.id!==c.config.id||c.symbol!==c.config.symbol||c.strategy!==c.config.strategy||!Object.hasOwn(phaseNames,c.phase)||!validDate(c.date)||c.date<c.config.startDate||![c.cash,c.shares,c.stockBasis,c.realizedOptions,c.realizedShares,c.fees,c.spot].every(Number.isFinite)||c.spot<=0||!Number.isInteger(c.shares)||!Array.isArray(c.legs)||!Array.isArray(c.events))return false;validateConfig(c.config);if(!c.legs.every(l=>l&&typeof l.id==='string'&&['call','put'].includes(l.type)&&Number.isInteger(l.quantity)&&l.quantity!==0&&Number.isFinite(l.strike)&&l.strike>0&&Number.isFinite(l.premium)&&l.premium>0&&validDate(l.expiry))||!c.events.every(e=>e&&typeof e.title==='string'&&typeof e.detail==='string'&&validDate(e.date)&&[e.cash,e.shares,e.equity,e.pnl,e.spot].every(Number.isFinite)))return false;const v=cycleValue(c);return Number.isFinite(v.equity)&&Math.abs(v.pnl-v.realized-v.unrealized)<1;}catch{return false;}
}
