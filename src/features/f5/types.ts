import type { StrategyId } from '../../cores/compartido/types.ts';

export type F5Side = 'buy' | 'sell';
export type F5Feed = 'indicative' | 'opra' | 'webull-sandbox';
export type F5Intent = 'buy_to_open' | 'sell_to_open' | 'buy_to_close' | 'sell_to_close';
export type F5Leg = { symbol: string; side: F5Side; ratio: number; intent: F5Intent };
export type F5Contract = {
  symbol: string; underlying: string; type: 'call' | 'put'; expiry: string; strike: number;
  size: number; tradable: boolean; style: string;
  bid: number | null; ask: number | null; quoteTime: string | null; delta: number | null;
};
export type F5OpenRequest = {
  action: 'open'; strategy: StrategyId; underlying: string; quantity: number;
  /** Wheel: one contract; PMCC: long, short; backspread: short, long; gamma: call, put. */
  contracts: string[]; wheelPhase?: 'put' | 'call'; limitPrice: number; maxCapitalUsd: number;
};
export type F5CloseRequest = { action: 'close'; operationId: string; limitPrice: number; maxCapitalUsd: number };
export type F5HedgeRequest = { action: 'hedge'; operationId: string; side: F5Side; quantity: number; limitPrice: number; maxCapitalUsd: number };
export type F5RollRequest = { action: 'roll'; operationId: string; newShortContract: string; limitPrice: number; maxCapitalUsd: number;step?:'close-short'|'open-short' };
export type F5Request = F5OpenRequest | F5CloseRequest | F5HedgeRequest | F5RollRequest;
export type F5OrderInput = {
  client_order_id: string; qty: string; type: 'limit'; time_in_force: 'day'; limit_price: string;
  symbol?: string; side?: F5Side; position_intent?: F5Intent; order_class?: 'mleg';
  legs?: { symbol: string; side: F5Side; ratio_qty: string; position_intent: F5Intent }[];
};
export type F5BrokerOrder = {
  id: string; client_order_id: string; status: string; qty: string; filled_qty: string;
  filled_avg_price?: string | null; symbol?: string; side?: F5Side; limit_price?: string | null;
  order_class?: string; type?: string; time_in_force?: string;
  position_intent?: string | null; ratio_qty?: string; created_at?: string; legs?: F5BrokerOrder[] | null;
};
export type F5Position = { symbol: string; quantity: number; assetClass: string; marketValue: number | null; averagePrice: number | null; unrealizedPnl: number | null };
export type F5Activity = { id: string; type: string; symbol: string; date: string; quantity: string; description: string; groupId?: string };
export type F5Account = { status: string; cash: number; buyingPower: number; optionsBuyingPower: number; equity: number; optionsLevel: number | null; optionsPermissionSource?: 'account' | 'preview'; blocked: boolean };
export type F5Operation = {
  id: string; strategy: StrategyId; underlying: string; action: F5Request['action']; parentId?: string;
  request: F5Request; legs: F5Leg[]; quantity: number; limitPrice: number; reservedCapitalUsd: number;
  clientOrderId: string; input: F5OrderInput; createdAt: string; expiresAt: string;
  state: 'preview' | 'reserved' | 'submitted' | 'partial' | 'filled' | 'canceled' | 'rejected' | 'expired' | 'ambiguous';
  brokerOrder?: F5BrokerOrder; message?: string; warnings: string[];
  planId?: string; automationKey?: string;
  stockBaseline?: number; activityBaselineIds?: string[]; lifecycle?: F5Lifecycle;
};
export type F5Status = {
  configured: boolean; enabled: boolean; marketOpen: boolean; mode: 'paper' | 'sandbox'; feed: F5Feed;
  provider?: 'alpaca' | 'webull'; activitiesComplete?: boolean;
  account: F5Account | null; operations: F5Operation[]; positions: F5Position[]; activities: F5Activity[];
  message?: string;
};

export type F5RiskSettings = {
  paused: boolean; maxDailyLossUsd: number; maxGrossExposureUsd: number;
  maxPremiumExposureUsd: number; maxAbsDelta: number; maxCycleCapitalUsd: number;
};
export type F5RiskState = {
  date: string; baselineEquity: number; equity: number; dailyPnlUsd: number;
  dailyLossBlocked: boolean; grossExposureUsd: number; premiumExposureUsd: number;
  netDelta: number | null; uncertain: boolean; blockedReasons: string[]; updatedAt: string;
};
export type F5PlanPolicy =
  | { kind: 'wheel'; minDte: number; maxDte: number; minStrike: number; maxStrike: number; minPremium: number }
  | { kind: 'pmcc'; rollAtDte: number; minDte: number; maxDte: number; minStrike: number; maxStrike: number; maxDebit: number; minCredit: number }
  | { kind: 'gamma'; deltaThreshold: number; maxShares: number; intervalSeconds: number }
  | { kind: 'exit'; stopLossPct: number; takeProfitPct: number; closeDte: number };
export type F5AutomationPlanInput = {
  operationId?: string; initial?: F5OpenRequest; startDate: string; endDate: string;
  maxActions: number; maxCapitalUsd: number; policy: F5PlanPolicy;
};
export type F5AutomationPlan = F5AutomationPlanInput & {
  id: string; strategy: StrategyId; underlying: string; enabled: boolean; actions: number;
  createdAt: string; updatedAt: string; lastEvaluatedAt?: string; lastActionAt?: string;
  lastOperationId?: string; holdReason?: string;
};
export type F5ControlEvent = {
  id: string; time: string; planId?: string; operationId?: string;
  status: 'info' | 'waiting' | 'blocked' | 'submitted' | 'partial' | 'filled' | 'rejected' | 'canceled' | 'expired' | 'ambiguous' | 'error';
  message: string;
};
export type F5Health = { running: boolean; automationEnabled: boolean; lastStartedAt: string | null; lastCompletedAt: string | null; lastError: string | null };
export type F5Control = { settings: F5RiskSettings; plans: F5AutomationPlan[]; events: F5ControlEvent[]; health: F5Health; risk: F5RiskState | null };
export type F5Lifecycle = {
  phase: 'pending' | 'open' | 'partial' | 'closed' | 'expired' | 'assigned' | 'uncertain';
  remainingQuantity: number; hedgeShares: number; canClose: boolean; canHedge: boolean; canRoll: boolean;
  shortContract?: string; reason?: string;
  rollPhase?:'close-short'|'open-short';
};
