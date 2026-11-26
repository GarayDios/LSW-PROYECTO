import { z } from 'zod';

/** Bind confirmation to the blocked day, baseline and loss limit shown to the owner. */
export const dailyRiskResetSchema = z.object({
  confirmed: z.literal(true),
  reference: z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    baselineEquity: z.number().finite().positive(),
    maxDailyLossUsd: z.number().finite().positive(),
    resetId: z.string().uuid().nullable(),
  }).strict(),
}).strict();

export type DailyRiskResetReference = z.infer<typeof dailyRiskResetSchema>['reference'];
