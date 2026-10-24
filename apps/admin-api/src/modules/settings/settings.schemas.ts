import { z } from 'zod';

const price = z
  .number({ message: 'Prices must be numbers (USD per 1M tokens).' })
  .min(0, 'Prices can’t be negative.')
  .max(1000, 'That price looks wrong (max $1000 per 1M tokens).');

export const aiSettingsSchema = z.object({
  dailyCallLimit: z
    .number({ message: 'The daily call limit must be a whole number (or empty for the env default).' })
    .int('The daily call limit must be a whole number.')
    .min(0, 'The daily call limit can’t be negative.')
    .max(10_000_000, 'The daily call limit is too large.')
    .nullable(),
  dailyBudgetUsd: z
    .number({ message: 'The daily budget must be a number of US dollars (or empty for none).' })
    .min(0, 'The daily budget can’t be negative.')
    .max(100_000, 'The daily budget is too large.')
    .nullable(),
  alertAtPercent: z
    .number({ message: 'The alert threshold must be a percentage.' })
    .int('The alert threshold must be a whole percentage.')
    .min(1, 'The alert threshold must be between 1 and 100%.')
    .max(100, 'The alert threshold must be between 1 and 100%.'),
  userDailyLimit: z
    .number({ message: 'The per-person limit must be a whole number (or empty for the default).' })
    .int('The per-person limit must be a whole number.')
    .min(0, 'The per-person limit can’t be negative.')
    .max(100_000, 'The per-person limit is too large.')
    .nullable(),
  pricing: z
    .record(
      z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9._:/@-]{1,100}$/, 'Model ids may only contain letters, digits and . _ : / @ -'),
      z.object({ input: price, cachedInput: price.optional(), output: price }).strict(),
    )
    .refine((r) => Object.keys(r).length <= 100, 'Too many price entries (max 100).'),
});

/** Set when the save puts back the values from before an audit entry ("Restore these values"). */
export const restoreSchema = z.object({ restoredFrom: z.string().max(64).optional() });
