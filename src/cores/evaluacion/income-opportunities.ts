import { knownBy, type CompanyResearch } from '../compartido/research-model.ts';
import { equityTerms, valuationExpiry } from '../../features/research/contract-terms.ts';

export type IncomeOpportunity = { symbol: string; contract: string; strategy: 'csp' | 'cc'; strike: number; expiration: string; days: number; netPremium: number; collateral: number; breakeven: number; roc: number; annualizedRoc: number; shares: number };
/** A bounded screen of received contracts, not a claim to optimize all options. */
export function incomeOpportunities(snapshot: CompanyResearch, input: { capital: number; ownedShares: number; costBasis: number; feePerContract: number; maxSpreadPercent: number }): IncomeOpportunity[] {
  if (snapshot.market.stale || !knownBy(snapshot.market.spot, snapshot.asOf) || !Object.values(input).every(Number.isFinite) || input.capital < 0 || input.ownedShares < 0 || input.costBasis <= 0 || input.feePerContract < 0 || input.maxSpreadPercent < 0) return [];
  return snapshot.options.contracts.flatMap<IncomeOpportunity>(c => {
    const terms = equityTerms(c, snapshot.asOf), expiry = valuationExpiry(c, snapshot.asOf).time;
    if (c.underlyingSymbol !== snapshot.symbol || !terms || ![c.bid,c.ask,c.premium,c.strike].every(v => knownBy(v,snapshot.asOf)) || expiry <= Date.parse(snapshot.asOf)
      || c.bid.value! <= 0 || c.ask.value! < c.bid.value! || c.premium.value! <= 0 || Date.parse(snapshot.asOf) - Date.parse(c.bid.observedAt!) > 3600000
      || (c.ask.value! - c.bid.value!) / c.premium.value! * 100 > input.maxSpreadPercent) return [];
    const strategy = c.type === 'put' ? 'csp' : 'cc';
    if (strategy === 'csp' && terms.effectiveStrike > snapshot.market.spot.value! || strategy === 'cc' && (terms.effectiveStrike < snapshot.market.spot.value! || input.ownedShares < terms.shares)) return [];
    const collateral = strategy === 'csp' ? c.strike.value! * terms.multiplier : input.costBasis * terms.shares;
    if (strategy === 'csp' && collateral + input.feePerContract > input.capital) return [];
    const netPremium = c.bid.value! * terms.multiplier - input.feePerContract;
    if (netPremium <= 0 || collateral <= 0) return [];
    const days = (expiry - Date.parse(snapshot.asOf)) / 86400000, roc = netPremium / collateral;
    return [{ symbol: snapshot.symbol, contract: c.symbol, strategy, strike: terms.effectiveStrike, expiration: c.expiration, days, netPremium, collateral,
      breakeven: (strategy === 'csp' ? terms.effectiveStrike : input.costBasis) - netPremium / terms.shares, roc, annualizedRoc: roc * 365 / days, shares: terms.shares }];
  }).sort((a,b) => b.annualizedRoc - a.annualizedRoc || a.contract.localeCompare(b.contract));
}
