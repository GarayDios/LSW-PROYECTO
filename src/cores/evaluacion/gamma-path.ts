import { z } from 'zod';
import { blackScholes } from '../nucleo-cuantitativo/bsm.ts';
import { analyzeStrategy,type AnalysisPolicy } from './strategy-analysis.ts';
import { valuationExpiry,equityTerms } from '../../features/research/contract-terms.ts';
import type { CompanyResearch } from '../compartido/research-model.ts';

export const gammaPathSchema=z.object({source:z.string().min(1).max(500),kind:z.enum(['observed','scenario']),points:z.array(z.object({
  at:z.string().datetime({offset:true}),spot:z.number().finite().positive().max(1e7),bid:z.number().finite().positive(),ask:z.number().finite().positive(),
  volatility:z.number().finite().positive().max(5).optional(),
}).strict().refine(p=>p.bid<=p.spot&&p.ask>=p.spot,'El spot debe estar entre bid y ask.')).min(2).max(2000)}).strict();
export type GammaPath=z.infer<typeof gammaPathSchema>;
export const gammaConfigSchema=z.object({deltaTolerance:z.number().finite().min(0).max(1e5).default(10),maxShares:z.number().int().min(1).max(1e5).default(1000),
  minimumMinutes:z.number().finite().min(0).max(1440).default(0),feePerShare:z.number().finite().min(0).max(10).default(.005),
  stockBorrowRate:z.number().finite().min(0).max(1).default(.05),allowShortStock:z.boolean().default(false)}).strict();
export type GammaConfig=z.input<typeof gammaConfigSchema>;
export type GammaPathResult={kind:'observed'|'scenario';source:string;pnl:number;unhedgedPnl:number;hedgeTrades:number;stockFees:number;spreadCost:number;borrowCost:number;maxDrawdown:number;
  events:{at:string;spot:number;shares:number;deltaBefore:number;deltaAfter:number;trade:number;equity:number;reason:string}[];warnings:string[]};

/** Replays whole-share delta hedges through the supplied path. It never submits
 * orders. Option marks/exit are modeled, so observed stock bars alone do not turn
 * this into a historical options performance claim. */
export function simulateGammaPath(snapshot:CompanyResearch,days:number,policy:AnalysisPolicy,pathInput:unknown,configInput:GammaConfig={}):GammaPathResult {
  if(policy.dividendModel==='declared-cash')throw new RangeError('La cobertura Gamma requiere un modelo de caja de dividendos discretos adicional; usa el modelo continuo explícito para este replay.');
  const path=gammaPathSchema.parse(pathInput),config=gammaConfigSchema.parse(configInput);
  const opening=analyzeStrategy(snapshot,'gamma',days,policy);
  if(opening.status!=='available'||opening.entryDebit===null)throw new RangeError(`Faltan entradas Gamma: ${opening.missing.join(', ')}`);
  const capital=policy.capital??opening.entryDebit*3;
  if(capital<opening.entryDebit)throw new RangeError('Capital insuficiente para abrir el straddle.');
  const expiry=valuationExpiry(opening.legs[0].contract,snapshot.asOf).time,start=Date.parse(snapshot.asOf);
  let previous=start;
  for(const p of path.points){const t=Date.parse(p.at);if(t<start||t<previous||t>expiry||t===previous&&p!==path.points[0])throw new RangeError('La trayectoria debe avanzar, quedar después del corte y no superar el vencimiento.');previous=t;}
  const q=policy.dividendYield??snapshot.fundamentals.dividendYield,r=policy.riskFreeRate??snapshot.macro.riskFreeRate;
  const mark=(p:GammaPath['points'][number])=>{
    let value=0,delta=0;
    for(const leg of opening.legs){const terms=equityTerms(leg.contract,snapshot.asOf)!;
      const model=blackScholes({spot:p.spot,strike:terms.effectiveStrike,days:Math.max(0,(expiry-Date.parse(p.at))/86400000),volatility:p.volatility??leg.contract.impliedVolatility.value!,rate:r.value!,dividendYield:q.value!,type:leg.contract.type});
      value+=leg.quantity*model.price*terms.shares;delta+=leg.quantity*model.delta*terms.shares;
    }return {value,delta};
  };
  const result:GammaPathResult={kind:path.kind,source:path.source,pnl:0,unhedgedPnl:0,hedgeTrades:0,stockFees:0,spreadCost:0,borrowCost:0,maxDrawdown:0,events:[],warnings:[
    'Simulación de cobertura con acciones enteras; no se envían órdenes ni se demuestra rentabilidad futura.',
    'Las opciones se marcan con BSM europeo e IV suministrada o constante. No son precios históricos de salida de opciones.',
    'La garantía para acciones cortas es una reserva conservadora de nominal completo; no es margen oficial. Los dividendos discretos de acciones cortas no se infieren del rendimiento continuo q.',
  ]};
  let cash=capital-opening.entryDebit,shares=0,lastTime=start,lastHedge=-Infinity,peak=capital;
  for(let i=0;i<path.points.length;i++){
    const point=path.points[i],time=Date.parse(point.at),dt=(time-lastTime)/(365*86400000);
    const borrow=Math.max(0,-shares)*point.spot*config.stockBorrowRate*dt;
    cash-=borrow;result.borrowCost+=borrow;
    const option=mark(point),before=shares+option.delta;
    let trade=0,reason='Dentro de tolerancia o intervalo mínimo de cobertura.';
    if(i<path.points.length-1 && Math.abs(before)>config.deltaTolerance && time-lastHedge>=config.minimumMinutes*60000){
      const desired=Math.round(-option.delta),change=desired-shares,price=change>0?point.ask:point.bid;
      const afterCash=cash-change*price-Math.abs(change)*config.feePerShare;
      const equity=afterCash+desired*point.spot+option.value;
      if(Math.abs(desired)>config.maxShares)reason='Cobertura bloqueada por límite de acciones.';
      else if(desired<0&&!config.allowShortStock)reason='Cobertura bloqueada: ventas cortas no autorizadas en este escenario.';
      else if(desired>=0&&afterCash<0 || desired<0&&equity<Math.abs(desired)*point.spot)reason='Cobertura bloqueada por capital insuficiente.';
      else{trade=change;cash=afterCash;shares=desired;lastHedge=time;result.hedgeTrades++;result.stockFees+=Math.abs(change)*config.feePerShare;
        result.spreadCost+=Math.abs(change)*Math.abs(price-point.spot);reason='Delta ajustada con acciones enteras, bid/ask y comisión.';}
    }
    if(i===path.points.length-1){
      const exit=shares>0?point.bid:point.ask;
      cash+=shares*exit-Math.abs(shares)*config.feePerShare;
      result.spreadCost+=Math.abs(shares)*Math.abs(exit-point.spot);result.stockFees+=Math.abs(shares)*config.feePerShare;
      trade=-shares;shares=0;reason='Cierre de cobertura y opciones al final de la trayectoria.';
      const contractCount=opening.legs.reduce((n,l)=>n+Math.abs(l.quantity),0);
      const optionExitSpread=opening.legs.reduce((n,l)=>n+Math.abs(l.quantity)*(l.contract.ask.value!-l.contract.bid.value!)*opening.contractMultiplier!/2,0);
      const exitCost=time===expiry?0:optionExitSpread+(policy.feePerContract??0)*contractCount;
      cash+=Math.max(0,option.value-optionExitSpread*(time===expiry?0:1))-(time===expiry?0:(policy.feePerContract??0)*contractCount);
      result.pnl=cash-capital;result.unhedgedPnl=Math.max(0,option.value-optionExitSpread*(time===expiry?0:1))-(time===expiry?0:(policy.feePerContract??0)*contractCount)-opening.entryDebit;
    }
    const equity=i===path.points.length-1?cash:cash+shares*point.spot+option.value;
    peak=Math.max(peak,equity);result.maxDrawdown=Math.max(result.maxDrawdown,1-equity/peak);
    result.events.push({at:point.at,spot:point.spot,shares,deltaBefore:before,deltaAfter:i===path.points.length-1?0:shares+option.delta,trade,equity,reason});
    lastTime=time;
  }
  return result;
}
