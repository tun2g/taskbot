import { z } from 'zod';

const reason = z
  .string({ message: 'The reason must be text.' })
  .trim()
  .max(500, 'Keep the reason under 500 characters.');

const notifyGroup = z.boolean({ message: 'notifyGroup must be true or false.' }).optional();

/** Reject / suspend: the reason is shown to the group, so it's required. */
export const actionWithReasonSchema = z.object({
  reason: reason.min(1, 'Please give a reason — it is shown to the group.'),
  notifyGroup,
});

export const actionSchema = z.object({ reason: reason.optional(), notifyGroup });

export const deleteGroupSchema = z.object({
  confirmName: z.string({ message: 'Type the group name to confirm.' }),
});

export const aiOverrideSchema = z
  .object({
    disabled: z.boolean({ message: 'disabled must be true or false.' }).optional(),
    dailyLimit: z
      .number({ message: 'The daily limit must be a whole number (or empty for the default).' })
      .int('The daily limit must be a whole number.')
      .min(0, 'The daily limit can’t be negative.')
      .max(100_000, 'The daily limit is too large (max 100000).')
      .nullable()
      .optional(),
  })
  .refine((v) => v.disabled !== undefined || v.dailyLimit !== undefined, 'Nothing to change: send disabled and/or dailyLimit.');

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
