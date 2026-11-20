import { z } from 'zod';

/** User constraints affect suitability, never the market training labels. */
export const investorPreferencesSchema = z.object({
  objective: z.enum(['preservation', 'income', 'growth']),
  riskTolerance: z.enum(['low', 'medium', 'high']),
  capital: z.number().finite().positive().max(10_000_000),
  maxAllocationPercent: z.number().finite().min(0).max(100),
  maxLossPercent: z.number().finite().min(0).max(100),
  horizonSessions: z.union([z.literal(5), z.literal(20), z.literal(60)]),
  experience: z.enum(['learning', 'intermediate', 'advanced']),
  monitoring: z.enum(['occasional', 'daily']),
  allowedStrategies: z.array(z.enum(['wheel', 'pmcc', 'backspread', 'gamma'])).max(4)
    .refine(items => new Set(items).size === items.length, 'Hay estrategias repetidas.'),
}).strict();

export type InvestorPreferences = z.infer<typeof investorPreferencesSchema>;

export const defaultInvestorPreferences: InvestorPreferences = {
  objective: 'preservation', riskTolerance: 'low', capital: 20_000,
  maxAllocationPercent: 25, maxLossPercent: 2, horizonSessions: 20,
  experience: 'learning', monitoring: 'occasional',
  allowedStrategies: ['wheel', 'pmcc', 'backspread', 'gamma'],
};
