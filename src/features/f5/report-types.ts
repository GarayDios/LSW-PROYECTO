import type { StrategyId } from '../../cores/compartido/types.ts';

export type F5Coverage = 'complete' | 'partial' | 'unknown';
/** Normalized server-only read of Alpaca activities. Missing money is never zero. */
export type F5AccountingActivity = {
  id: string; type: string; symbol: string | null; orderId: string | null;
  date: string | null; transactionTime: string | null; quantity: number | null; price: number | null;
  side: 'buy' | 'sell' | 'sell_short' | null; netAmount: number | null;
  groupId: string | null; optionSymbol: string | null; relatedActivityId: string | null;
  status: string | null; description: string; subtype: string | null; currency: string | null;
};
export type F5AccountingBatch = { items: F5AccountingActivity[]; complete: boolean; asOf: string; source: string; warnings: string[] };
export type F5ReportMetrics = {
  cashFlowUsd: number | null; realizedPnlUsd: number | null; unrealizedPnlUsd: number | null;
  grossPnlUsd: number | null; feesUsd: number | null; netPnlUsd: number | null;
  /** The observed subset remains useful when the full amount cannot be established. */
  observedCashFlowUsd: number; observedFeesUsd: number;
  coverage: { fills: F5Coverage; fees: F5Coverage; settlements: F5Coverage; positions: F5Coverage };
  warnings: string[];
};
export type F5ReportEvent = {
  id: string; operationId: string | null; activityId: string | null;
  type: 'fill' | 'order_fill' | 'assignment' | 'exercise' | 'expiration' | 'settlement' | 'fee' | 'unattributed';
  symbol: string | null; date: string | null; quantity: number | null; price: number | null;
  cashFlowUsd: number | null; feeUsd: number | null; source: string; known: boolean; reason?: string;
};
export type F5CycleReport = {
  id: string; strategy: StrategyId; underlying: string; openedAt: string; operationIds: string[];
  state: 'open' | 'closed' | 'uncertain'; metrics: F5ReportMetrics; events: F5ReportEvent[];
};
export type F5StrategyReport = { strategy: StrategyId; cycleCount: number; metrics: F5ReportMetrics };
export type F5DailyReport = { date: string; metrics: F5ReportMetrics };
export type F5Report = {
  generatedAt: string; currency: 'USD'; source: string; totals: F5ReportMetrics;
  cycles: F5CycleReport[]; strategies: F5StrategyReport[]; daily: F5DailyReport[];
  unattributed: F5ReportEvent[]; warnings: string[];
};

/** Browser-safe CSV; absent values stay blank and text cannot inject spreadsheet formulas. */
export function f5ReportCsv(report: F5Report): string {
  const columns = ['scope', 'id', 'strategy', 'underlying', 'date', 'cash_flow_usd', 'realized_pnl_usd', 'unrealized_pnl_usd', 'gross_pnl_usd', 'fees_usd', 'net_pnl_usd', 'observed_cash_flow_usd', 'observed_fees_usd', 'fills_coverage', 'fees_coverage', 'settlements_coverage', 'positions_coverage', 'warnings'];
  const cell = (value: string | number | null): string => value === null ? '' : typeof value === 'number' ? String(value) : '"' + (/^[=+\-@\t\r]/.test(value) ? "'" + value : value).replaceAll('"', '""') + '"';
  const row = (scope: string, id: string, strategy: string, underlying: string, date: string, m: F5ReportMetrics) => [scope, id, strategy, underlying, date, m.cashFlowUsd, m.realizedPnlUsd, m.unrealizedPnlUsd, m.grossPnlUsd, m.feesUsd, m.netPnlUsd, m.observedCashFlowUsd, m.observedFeesUsd, m.coverage.fills, m.coverage.fees, m.coverage.settlements, m.coverage.positions, m.warnings.join(' | ')].map(cell).join(',');
  return '\uFEFF' + [columns.join(','), row('total', '', '', '', report.generatedAt, report.totals),
    ...report.strategies.map(item => row('strategy', '', item.strategy, '', '', item.metrics)),
    ...report.cycles.map(item => row('cycle', item.id, item.strategy, item.underlying, item.openedAt, item.metrics)),
    ...report.daily.map(item => row('daily', '', '', '', item.date, item.metrics)),
  ].join('\r\n') + '\r\n';
}
