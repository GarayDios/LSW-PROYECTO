import { blackScholes } from './bsm.ts';
import { binomialPrice } from './binomial.ts';
import { normalCdf } from './math.ts';
import { knownBy, type CompanyResearch, type ObservedOptionContract, type ResearchVariable } from '../features/research/model.ts';
import type { StrategyId, OptionInputs } from './types.ts';
import { equityTerms, valuationExpiry,modelDividendYield,cashDividendPv } from '../features/research/contract-terms.ts';
import { evaluationTuning, type EvaluationTuningInput } from './evaluation-policy.ts';
import { estimatedSnapshot } from './estimated-snapshot.ts';
import { inspectContracts, type SelectionDiagnostics } from './strategy-eligibility.ts';

export type AnalysisPolicy = {
  capital?: number; feePerContract?: number; maxSpreadPercent?: number;
  dividendYield?: ResearchVariable; riskFreeRate?: ResearchVariable; longDays?: number; tuning?: EvaluationTuningInput;
  modelMode?:'observed'|'estimated';financingRate?:number;pmccCapitalMode?:'assignment-reserve'|'debit-only';pmccMinLongDelta?:number;ivShock?:number;estimatedSpreadPercent?:number;estimatedSpreadFloor?:number;
  dividendModel?:'continuous'|'declared-cash';
  estimatedCandidateLimit?:number;estimateDays?:number;
};
export type StrategyLeg = { contract: ObservedOptionContract; quantity: number; entry: number };
export type StrategyAnalysis = {
  strategy: StrategyId; status: 'available' | 'unavailable'; missing: string[]; warnings: string[];
  legs: StrategyLeg[]; capitalRequired: number | null; entryDebit: number | null;
  maxLoss: number | null; maxGain: number | null; breakevens: number[];
  spreadCost: number | null; netDelta: number | null; netGamma: number | null; netTheta: number | null;
  theoreticalDebit: number | null; probability: number | null; probabilityMethod: string;
  scenarios: { change: number; spot: number; pnl: number }[]; optionLiquidity: number | null;
  model: string; horizonDays: number | null;
  contractMultiplier: number | null; deliverableShares: number | null;
  dataMode:'observed'|'estimated';financingCost:number;assignmentReserve:number|null;
  ivScenarios:{change:number;ivChange:number;pnl:number}[];
  diagnostics?:SelectionDiagnostics;
};
const DAY = 86400000;
const clamp = (x: number) => Math.max(0, Math.min(1, x));
const expiry = (s: CompanyResearch,c: ObservedOptionContract) => valuationExpiry(c,s.asOf).time;
const remaining = (s: CompanyResearch, c: ObservedOptionContract) => (expiry(s,c) - Date.parse(s.asOf)) / DAY;
const spread = (c: ObservedOptionContract) => (c.ask.value! - c.bid.value!) / Math.max(.01, c.premium.value!);

/** Structural selection, ordered by requested tenor and quoted transaction friction.
 * No fixed target IV, delta or strike percentage. All legs must be observed. */
export function selectStrategyLegs(s: CompanyResearch, strategy: StrategyId, days: number, policy: AnalysisPolicy = {}): StrategyLeg[] {
  s=estimatedSnapshot(s,{...policy,estimateDays:days});
  if (!Number.isFinite(days) || days <= 0 || !knownBy(s.market.spot, s.asOf)) return [];
  let tuning;try {tuning=evaluationTuning(policy.tuning);}catch{return [];}
  const spot = s.market.spot.value!;
  const terms=(c:ObservedOptionContract)=>equityTerms(c,s.asOf)!;
  const strike=(c:ObservedOptionContract)=>terms(c).effectiveStrike;
  const compatible=(a:ObservedOptionContract,b:ObservedOptionContract)=>terms(a).multiplier===terms(b).multiplier && terms(a).shares===terms(b).shares
    && Math.abs(Date.parse(a.premium.observedAt!)-Date.parse(b.premium.observedAt!))<=tuning.legQuoteSkewMinutes*60000;
  const contracts = inspectContracts(s,policy).eligible;
  const distance = (c: ObservedOptionContract, tenor = days) => tuning.tenorWeight*Math.abs(remaining(s, c) - tenor) / tenor + tuning.spreadWeight*spread(c);
  const ordered = (items: ObservedOptionContract[], tenor = days) => [...items].sort((a,b) => distance(a,tenor) - distance(b,tenor) || Math.abs(strike(a) - spot) - Math.abs(strike(b) - spot) || a.symbol.localeCompare(b.symbol));
  const leg = (contract: ObservedOptionContract, quantity: number): StrategyLeg => ({ contract, quantity, entry: quantity > 0 ? contract.ask.value! : contract.bid.value! });
  if (strategy === 'wheel') {
    const put = ordered(contracts.filter(c => c.type === 'put' && strike(c) <= spot && c.bid.value! > 0
      && (policy.capital === undefined || c.strike.value! * terms(c).multiplier + (policy.feePerContract ?? 0) <= policy.capital)))[0];
    return put ? [leg(put,-1)] : [];
  }
  const calls = contracts.filter(c => c.type === 'call');
  if (strategy === 'pmcc') {
    const delta=(c:ObservedOptionContract)=>{
      if(knownBy(c.delta,s.asOf))return c.delta.value!;
      const r=policy.riskFreeRate??s.macro.riskFreeRate,q=modelDividendYield(s,policy);
      if(!knownBy(r,s.asOf)||!knownBy(q,s.asOf))return -Infinity;
      try{return blackScholes({spot,strike:strike(c),days:remaining(s,c),volatility:c.impliedVolatility.value!,rate:r.value!,dividendYield:q.value!,type:'call'}).delta;}catch{return -Infinity;}
    };
    const longs = ordered(calls.filter(c => strike(c) < spot && remaining(s,c) > days && (!(policy.pmccMinLongDelta??0)||delta(c)>=(policy.pmccMinLongDelta??0))), policy.longDays ?? Math.max(365,days*4));
    for (const long of longs) {
      const short = ordered(calls.filter(c => compatible(c,long) && strike(c) > strike(long) && expiry(s,c) < expiry(s,long) && c.bid.value! > 0
        && long.ask.value! > c.bid.value! && (policy.capital === undefined || (long.ask.value! - c.bid.value!)*terms(c).multiplier + 2*(policy.feePerContract ?? 0)
          + (policy.pmccCapitalMode==='debit-only'?0:c.strike.value!*terms(c).multiplier) <= policy.capital)))[0];
      if (short) return [leg(long,1),leg(short,-1)];
    }
    return [];
  }
  if (strategy === 'gamma') {
    for (const call of ordered(calls)) {
      const put = contracts.find(c => c.type === 'put' && compatible(c,call) && expiry(s,c) === expiry(s,call) && strike(c) === strike(call));
      if (put && (policy.capital === undefined || (call.ask.value! + put.ask.value!)*terms(call).multiplier + 2*(policy.feePerContract ?? 0) <= policy.capital)) return [leg(call,1),leg(put,1)];
    }
    return [];
  }
  for (const short of ordered(calls.filter(c => c.bid.value! > 0))) {
    const long = ordered(calls.filter(c => compatible(c,short) && expiry(s,c) === expiry(s,short) && strike(c) > strike(short)
      && (policy.capital === undefined || Math.max(0,(c.strike.value!-short.strike.value!+2*c.ask.value!-short.bid.value!)*terms(c).multiplier)+3*(policy.feePerContract ?? 0)<=policy.capital)))[0];
    if (long) return [leg(short,-1),leg(long,2)];
  }
  return [];
}

/** Aggregate signed cashflows using verified premium multiplier and deliverables. Prices use ask for buys,
 * bid for sales and fees per contract. These are conservative estimates, not fills. */
export function analyzeStrategy(s: CompanyResearch, strategy: StrategyId, days: number, policy: AnalysisPolicy = {}): StrategyAnalysis {
  s=estimatedSnapshot(s,{...policy,estimateDays:days});
  const a: StrategyAnalysis = { strategy, status:'unavailable', missing:[], warnings:[], legs:[], capitalRequired:null, entryDebit:null,
    maxLoss:null,maxGain:null,breakevens:[],spreadCost:null,netDelta:null,netGamma:null,netTheta:null,theoreticalDebit:null,
    probability:null,probabilityMethod:'No disponible',scenarios:[],optionLiquidity:null,model:'BSM europeo; CRR americano cuando el estilo está verificado',horizonDays:null,contractMultiplier:null,deliverableShares:null,
    dataMode:policy.modelMode??'observed',financingCost:0,assignmentReserve:null,ivScenarios:[] };
  let tuning;try {tuning=evaluationTuning(policy.tuning);}catch {a.missing.push('Parámetros avanzados válidos');return a;}
  if (!Number.isFinite(days) || days <= 0 || days > 3650) { a.missing.push('Plazo válido'); return a; }
  if (policy.capital !== undefined && (!Number.isFinite(policy.capital) || policy.capital <= 0)
    || policy.feePerContract !== undefined && (!Number.isFinite(policy.feePerContract) || policy.feePerContract < 0)
    || policy.maxSpreadPercent !== undefined && (!Number.isFinite(policy.maxSpreadPercent) || policy.maxSpreadPercent < 0)
    || policy.financingRate!==undefined&&(!Number.isFinite(policy.financingRate)||policy.financingRate<0||policy.financingRate>1)
    || policy.ivShock!==undefined&&(!Number.isFinite(policy.ivShock)||policy.ivShock<0||policy.ivShock>.9)
    || strategy === 'pmcc' && policy.longDays !== undefined && (!Number.isFinite(policy.longDays) || policy.longDays <= days || policy.longDays > 3650)) {
    a.missing.push('Política de capital, costes, spread o plazo largo inválida'); return a;
  }
  const q = modelDividendYield(s,policy);
  const rate=policy.riskFreeRate ?? s.macro.riskFreeRate;
  for (const [name,v] of [['Precio',s.market.spot],['Tasa',rate],['Dividendo futuro',q]] as const)
    if (!knownBy(v,s.asOf)) a.missing.push(name);
  if (s.market.stale) a.missing.push('Precio reciente');
  a.legs = selectStrategyLegs(s,strategy,days,{...policy,modelMode:'observed'});
  if (!a.legs.length) {
    const d=inspectContracts(s,policy).diagnostics;
    a.diagnostics=d;
    if(!d.totalContracts){d.blocker='contracts';a.missing.push('El proveedor no entregó contratos para este corte');}
    else {
      const unbounded={...policy,modelMode:'observed' as const,capital:undefined};
      const example=selectStrategyLegs(s,strategy,days,unbounded);
      if(example.length){
        d.blocker='capital';
        const terms=equityTerms(example[0].contract,s.asOf)!;
        const fee=(policy.feePerContract??0)*example.reduce((n,l)=>n+Math.abs(l.quantity),0);
        const debit=example.reduce((n,l)=>n+l.quantity*l.entry*terms.multiplier,0)+fee;
        d.exampleCapitalRequired=strategy==='wheel'?example[0].contract.strike.value!*terms.multiplier+fee:
          strategy==='pmcc'?Math.max(0,debit)+(policy.pmccCapitalMode==='debit-only'?0:example.find(l=>l.quantity<0)!.contract.strike.value!*terms.multiplier)+Math.max(0,debit)*(policy.financingRate??0)*Math.min(...example.map(l=>remaining(s,l.contract)))/365:
          strategy==='gamma'?debit:Math.max(0,(example.find(l=>l.quantity>0)!.contract.strike.value!-example.find(l=>l.quantity<0)!.contract.strike.value!)*terms.multiplier+debit);
        a.missing.push(`Capital insuficiente: una combinación compatible requiere USD ${d.exampleCapitalRequired.toFixed(2)}; disponible USD ${policy.capital?.toFixed(2)}. No es un mínimo global`);
      } else if(selectStrategyLegs(s,strategy,days,{...unbounded,maxSpreadPercent:undefined}).length){
        d.blocker='spread';a.missing.push('Los contratos de la estructura superan el spread permitido');
      } else if(!d.eligibleContracts){
        d.blocker='quality';a.missing.push(...d.rejected.map(r=>`${r.label}: ${r.count}/${d.totalContracts}`));
      } else {
        d.blocker='structure';a.missing.push('No hay piernas compatibles con strikes, vencimientos, delta y sincronización requeridos por esta estrategia');
      }
    }
  }
  for (const {contract:c} of a.legs) {
    if (c.premium.observedAt && s.market.spot.observedAt && Math.abs(Date.parse(c.premium.observedAt)-Date.parse(s.market.spot.observedAt))>tuning.spotOptionGapDays*DAY) a.missing.push(`Precio y opciones dentro de ${tuning.spotOptionGapDays} días`);
    if (c.premium.observedAt && Date.parse(s.asOf)-Date.parse(c.premium.observedAt)>tuning.quoteMaxAgeMinutes*60000) a.missing.push(`Cotización de hasta ${tuning.quoteMaxAgeMinutes} minutos`);
    a.warnings.push(`${c.symbol}: ${valuationExpiry(c,s.asOf).source}.`);
  }
  if (a.legs.length > 1) {
    const stamps = a.legs.map(l=>Date.parse(l.contract.premium.observedAt!));
    if (Math.max(...stamps)-Math.min(...stamps)>tuning.legQuoteSkewMinutes*60000) a.missing.push(`Cotizaciones de las piernas dentro de ${tuning.legQuoteSkewMinutes} minutos`);
  }
  a.warnings.push('Selección estructural por plazo y spread; no es una optimización validada de rentabilidad.',
    `${s.market.spotBasis==='quote'?'Punto medio de la cotización de la acción':'Precio de cierre diario'} e horizonte de valoración estimado. El modelo no simula decisiones de ejercicio anticipado ni liquidación del bróker.`,
    'Se usan multiplicador y entregables verificados. No constituye margen confirmado por un bróker.');
  if (q.kind === 'assumed') a.warnings.push(`Dividendo supuesto explícitamente: ${q.value === null ? 'ausente' : q.value*100}%. Fuente: ${q.source}.`);
  if(rate.kind==='assumed')a.warnings.push(`Tasa continua supuesta: ${rate.value! * 100}%; no es una tasa FRED observada.`);
  if(policy.modelMode==='estimated')a.warnings.push('Modo ESTIMADO: IV, precios y probabilidades pueden depender de supuestos. No constituye evidencia histórica ni cotización ejecutable.');
  if(policy.modelMode==='estimated')a.warnings.push(...s.warnings.filter(w=>w.startsWith('Reconstrucción limitada')));
  if (s.options.feed === 'indicative') a.warnings.push('Feed indicative: cotizaciones estimadas y retrasadas.');
  if (!s.options.complete) a.warnings.push('La cadena disponible es parcial; puede haber otras combinaciones.');
  if (strategy === 'wheel') a.warnings.push('Se evalúa la put con efectivo reservado. La siguiente call depende de una posible asignación futura y aún no se cotiza.');
  if (strategy === 'pmcc') a.warnings.push('Escenarios al vencimiento corto: la call larga conserva valor según volatilidad constante. Asignación y financiación pueden exigir capital adicional al débito.');
  if (strategy === 'gamma') a.warnings.push('Se analiza un straddle sin coberturas futuras. Gamma Scalping requiere una trayectoria, rebalanceos y sus costes; su rentabilidad no se infiere de este payoff.');
  if (q.value !== null && q.value < 0) a.missing.push('Dividendo no negativo');
  if (s.market.spot.value !== null && s.market.spot.value <= 0) a.missing.push('Precio positivo');
  if (a.missing.length) return a;
  const fee = policy.feePerContract ?? 0, count=a.legs.reduce((n,l)=>n+Math.abs(l.quantity),0);
  const terms=equityTerms(a.legs[0].contract,s.asOf)!;
  a.contractMultiplier=terms.multiplier;a.deliverableShares=terms.shares;
  const debit=a.legs.reduce((n,l)=>n+l.quantity*l.entry*terms.multiplier,0)+fee*count;
  a.entryDebit=debit;
  a.spreadCost=a.legs.reduce((n,l)=>n+Math.abs(l.quantity)*(l.contract.ask.value!-l.contract.bid.value!)*terms.multiplier/2,0);
  a.optionLiquidity=Math.min(...a.legs.map(l=>clamp(1-spread(l.contract))));
  a.horizonDays=Math.min(...a.legs.map(l=>remaining(s,l.contract)));
  a.financingCost=strategy==='pmcc'?Math.max(0,debit)*(policy.financingRate??0)*a.horizonDays/365:0;
  a.assignmentReserve=strategy==='pmcc'?a.legs.find(l=>l.quantity<0)!.contract.strike.value!*terms.multiplier:0;
  const inputs=(l:StrategyLeg, spot=s.market.spot.value!, elapsed=0):OptionInputs=>({spot:Math.max(spot-(policy.dividendModel==='declared-cash'?cashDividendPv(s,expiry(s,l.contract),rate.value!,Date.parse(s.asOf)+elapsed*DAY):0),1e-8),strike:equityTerms(l.contract,s.asOf)!.effectiveStrike,days:Math.max(0,remaining(s,l.contract)-elapsed),volatility:l.contract.impliedVolatility.value!,rate:rate.value!,dividendYield:q.value!,type:l.contract.type});
  const sameExpiry=new Set(a.legs.map(l=>expiry(s,l.contract))).size===1;
  const theoretical=(l:StrategyLeg)=>l.contract.style==='american'?binomialPrice(inputs(l),'american',tuning.binomialSteps):blackScholes(inputs(l)).price;
  try {
    a.theoreticalDebit=a.legs.reduce((n,l)=>n+l.quantity*theoretical(l),0)*terms.shares;
    const greeks=a.legs.map(l=>({n:l.quantity,v:blackScholes(inputs(l))}));
    a.netDelta=greeks.reduce((n,l)=>n+l.n*l.v.delta*terms.shares,0);
    a.netGamma=greeks.reduce((n,l)=>n+l.n*l.v.gamma*terms.shares,0);
    a.netTheta=greeks.reduce((n,l)=>n+l.n*l.v.theta*terms.shares,0);
    const pnl=(spot:number,ivFactor=1)=>terms.shares*a.legs.reduce((n,l)=>n+l.quantity*(remaining(s,l.contract)<=a.horizonDays!+1e-8
      ? Math.max(0,l.contract.type==='call'?spot-inputs(l).strike:inputs(l).strike-spot)
      : l.contract.style==='american'?binomialPrice({...inputs(l,spot,a.horizonDays!),volatility:inputs(l).volatility*ivFactor},'american',tuning.binomialSteps)
      : blackScholes({...inputs(l,spot,a.horizonDays!),volatility:inputs(l).volatility*ivFactor}).price),0)-debit-a.financingCost;
    a.scenarios=[...tuning.scenarioChanges].sort((a,b)=>a-b).map(change=>({change,spot:s.market.spot.value!*(1+change),pnl:pnl(s.market.spot.value!*(1+change))}));
    if(strategy==='pmcc')a.ivScenarios=a.scenarios.flatMap(row=>[-(policy.ivShock??.2),0,policy.ivShock??.2].map(ivChange=>({change:row.change,ivChange,pnl:pnl(row.spot,1+ivChange)})));
    if (sameExpiry) {
      const points=[0,...new Set(a.legs.map(l=>inputs(l).strike))].sort((x,y)=>x-y);
      const tailSlope=a.legs.reduce((n,l)=>n+(l.contract.type==='call'?l.quantity:0),0);
      const values=points.map(pnl);
      a.maxLoss=tailSlope<0?null:Math.max(0,-Math.min(...values));
      a.maxGain=tailSlope>0?null:Math.max(0,...values);
      const tail=points.at(-1)!+Math.max(1,s.market.spot.value!);
      const segments=[...points,tail];
      for(let i=1;i<segments.length;i++) {
        const left=segments[i-1],right=segments[i],v=pnl(left),slope=(pnl(right)-v)/(right-left);
        if (v===0 && !a.breakevens.includes(left)) a.breakevens.push(left);
        if (Math.abs(slope)>1e-10) {
          const root=left-v/slope;
          if(root>left && (i===segments.length-1 || root<=right) && !a.breakevens.some(b=>Math.abs(b-root)<1e-8))a.breakevens.push(root);
        }
      }
      a.breakevens.sort((x,y)=>x-y);
      const T=a.horizonDays/365,sigma=a.legs[0].contract.impliedVolatility.value!;
      const cdf=(x:number)=>x<=0?0:x===Infinity?1:normalCdf((Math.log(x/s.market.spot.value!)-(rate.value!-q.value!-sigma*sigma/2)*T)/(sigma*Math.sqrt(T)));
      const boundaries=[0,...a.breakevens.filter(b=>b>0),Infinity];
      a.probability=0;
      for(let i=1;i<boundaries.length;i++) {
        const lo=boundaries[i-1],hi=boundaries[i],mid=hi===Infinity?Math.max(lo+1,s.market.spot.value!*2):(lo+hi)/2;
        if(pnl(mid)>1e-8)a.probability+=cdf(hi)-cdf(lo);
      }
      a.probability=clamp(a.probability);
      a.probabilityMethod='Distribución terminal neutral al riesgo; IV de la primera pierna constante, payoff conjunto, bid/ask y comisiones de entrada. No predice rentabilidad.';
    } else {
      a.maxLoss=null; a.maxGain=null;
      a.probabilityMethod='No se publica probabilidad para vencimientos distintos: requiere modelar la evolución de IV y la gestión de la diagonal.';
    }
    a.capitalRequired=strategy==='wheel'?a.legs[0].contract.strike.value!*terms.multiplier+fee:strategy==='pmcc'?Math.max(0,debit)+a.financingCost+(policy.pmccCapitalMode==='debit-only'?0:a.assignmentReserve!):strategy==='gamma'?debit:a.maxLoss;
    if(strategy==='pmcc')a.warnings.push(`Reserva ante asignación: ${a.assignmentReserve}; financiación al horizonte: ${a.financingCost.toFixed(2)}. ${policy.pmccCapitalMode==='debit-only'?'Solo débito elegido: no acredita capacidad de afrontar asignación.':'Capital conservador: débito + nominal corto + financiación; no es margen oficial del bróker.'}`);
    if (policy.capital!==undefined && a.capitalRequired!==null && a.capitalRequired>policy.capital) a.missing.push('Capital suficiente');
    if (a.legs.some(l=>l.contract.style!=='european')) a.warnings.push(`Las sensibilidades y probabilidades usan BSM europeo; el precio inicial americano usa CRR de ${tuning.binomialSteps} pasos.`);
    if (strategy==='gamma') { a.probability=null; a.probabilityMethod='La probabilidad de Gamma Scalping exige trayectorias de cobertura y costes; se muestran escenarios del straddle sin cobertura.'; }
    if(policy.dividendModel==='declared-cash'){
      a.warnings.push('Dividendos discretos declarados: se resta su valor presente al spot para valorar. Es una aproximación; no incorpora anuncios futuros desconocidos ni modela de forma exacta el ejercicio americano.');
      a.probability=null;a.probabilityMethod='Sin probabilidad lognormal publicada al incorporar saltos por dividendos discretos.';
    }
    a.status=a.missing.length?'unavailable':'available';
  } catch { a.missing.push('Modelo numérico válido para todas las piernas'); }
  return a;
}
