import type { StrategyId } from '../../cores/types.ts';

export type F5Side = 'buy' | 'sell';
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
export type F5Request = F5OpenRequest | F5CloseRequest | F5HedgeRequest;
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
export type F5Activity = { id: string; type: string; symbol: string; date: string; quantity: string; description: string };
export type F5Account = { status: string; cash: number; buyingPower: number; optionsBuyingPower: number; equity: number; optionsLevel: number; blocked: boolean };
export type F5Operation = {
  id: string; strategy: StrategyId; underlying: string; action: F5Request['action']; parentId?: string;
  request: F5Request; legs: F5Leg[]; quantity: number; limitPrice: number; reservedCapitalUsd: number;
  clientOrderId: string; input: F5OrderInput; createdAt: string; expiresAt: string;
  state: 'preview' | 'reserved' | 'submitted' | 'partial' | 'filled' | 'canceled' | 'rejected' | 'expired' | 'ambiguous';
  brokerOrder?: F5BrokerOrder; message?: string; warnings: string[];
};
export type F5Status = {
  configured: boolean; enabled: boolean; marketOpen: boolean; mode: 'paper'; feed: 'indicative' | 'opra';
  account: F5Account | null; operations: F5Operation[]; positions: F5Position[]; activities: F5Activity[];
  message?: string;
};
