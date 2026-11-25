// Filtro descriptivo de puts con efectivo y calls cubiertas recibidas del proveedor. Ordena retorno de prima
// sobre garantía; no optimiza globalmente ni modela pérdidas esperadas.

// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { knownBy, type CompanyResearch } from '../compartido/research-model.ts';
// Importa los ayudantes o modelos nombrados en esta declaración; las líneas siguientes explican dónde se
// utilizan.
import { equityTerms, valuationExpiry } from '../../features/research/contract-terms.ts';

// Describe una oportunidad CSP/CC con contrato, prima neta, garantía, equilibrio y retorno de prima sobre
// capital.
export type IncomeOpportunity = { symbol: string; contract: string; strategy: 'csp' | 'cc'; strike: number; expiration: string; days: number; netPremium: number; collateral: number; breakeven: number; roc: number; annualizedRoc: number; shares: number };
// Filtra los contratos recibidos para una put con efectivo o una call cubierta, sin enviar órdenes.
export function incomeOpportunities(snapshot: CompanyResearch, input: { capital: number; ownedShares: number; costBasis: number; feePerContract: number; maxSpreadPercent: number }): IncomeOpportunity[] {
  // Devuelve lista vacía con mercado desactualizado, precio desconocido o parámetros de capital/costes
  // inválidos.
  if (snapshot.market.stale || !knownBy(snapshot.market.spot, snapshot.asOf) || !Object.values(input).every(Number.isFinite) || input.capital < 0 || input.ownedShares < 0 || input.costBasis <= 0 || input.feePerContract < 0 || input.maxSpreadPercent < 0) return [];
  // Transforma cada contrato en cero o una oportunidad de ingreso.
  return snapshot.options.contracts.flatMap<IncomeOpportunity>(c => {
    // Prepara multiplicador, entregables y strike efectivo verificados.
    const terms = equityTerms(c, snapshot.asOf), expiry = valuationExpiry(c, snapshot.asOf).time;
    // Exige subyacente correcto, entregables y cotizaciones conocidos y vencimiento futuro.
    if (c.underlyingSymbol !== snapshot.symbol || !terms || ![c.bid,c.ask,c.premium,c.strike].every(v => knownBy(v,snapshot.asOf)) || expiry <= Date.parse(snapshot.asOf)
      // Exige bid y prima positivos, ask coherente y bid de hasta una hora de antigüedad.
      || c.bid.value! <= 0 || c.ask.value! < c.bid.value! || c.premium.value! <= 0 || Date.parse(snapshot.asOf) - Date.parse(c.bid.observedAt!) > 3600000
      // Descarta contratos cuyo spread relativo supera el máximo configurado.
      || (c.ask.value! - c.bid.value!) / c.premium.value! * 100 > input.maxSpreadPercent) return [];
    // Clasifica puts como CSP y calls como CC.
    const strategy = c.type === 'put' ? 'csp' : 'cc';
    // Para CSP exige strike no superior al spot; para CC exige strike no inferior y acciones suficientes para
    // cubrir entregables.
    if (strategy === 'csp' && terms.effectiveStrike > snapshot.market.spot.value! || strategy === 'cc' && (terms.effectiveStrike < snapshot.market.spot.value! || input.ownedShares < terms.shares)) return [];
    // Para put reserva nominal strike × multiplicador; para call usa coste base de las acciones como capital de
    // referencia.
    const collateral = strategy === 'csp' ? c.strike.value! * terms.multiplier : input.costBasis * terms.shares;
    // Exige que el efectivo alcance para garantía y comisión de la put.
    if (strategy === 'csp' && collateral + input.feePerContract > input.capital) return [];
    // Calcula prima neta al bid de venta, multiplicada por contrato y descontando comisión.
    const netPremium = c.bid.value! * terms.multiplier - input.feePerContract;
    // Descarta prima neta o garantía sin base positiva.
    if (netPremium <= 0 || collateral <= 0) return [];
    // Calcula días restantes y retorno de prima = prima neta / garantía.
    const days = (expiry - Date.parse(snapshot.asOf)) / 86400000, roc = netPremium / collateral;
    // Publica identidad, términos y capital de la oportunidad.
    return [{ symbol: snapshot.symbol, contract: c.symbol, strategy, strike: terms.effectiveStrike, expiration: c.expiration, days, netPremium, collateral,
      // Calcula equilibrio y anualiza aritméticamente el retorno; no incorpora probabilidad de pérdida ni
      // reinversiones garantizadas.
      breakeven: (strategy === 'csp' ? terms.effectiveStrike : input.costBasis) - netPremium / terms.shares, roc, annualizedRoc: roc * 365 / days, shares: terms.shares }];
  // Ordena por retorno anualizado de prima y desempata por símbolo; es una clasificación descriptiva acotada.
  }).sort((a,b) => b.annualizedRoc - a.annualizedRoc || a.contract.localeCompare(b.contract));
// Cierra el bloque, objeto o llamada definido anteriormente.
}
