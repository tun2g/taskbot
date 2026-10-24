import type { AdminAiSettings } from '@tbot/shared';
import { z } from 'zod';

import type { AiSettingsInput } from '@/api/settings';
import { optionalInt, optionalNumber, requiredNumber, toInput } from '@/components/form/schema';

type Price = AdminAiSettings['pricing'][string];

const PRICE_MSG = 'Use a number like 0.30';
const price = optionalNumber(0, 10_000, PRICE_MSG);

/**
 * One row of the price table. Built-in rows: a blank field keeps the built-in value for that field, and any
 * filled field makes the row your override. Custom rows (models without a built-in price) need input + output.
 */
const priceRow = z.object({
  model: z.string(),
  builtIn: z.boolean(),
  input: price,
  cachedInput: price,
  output: price,
});

export function settingsSchema(builtIn: Record<string, Price>) {
  return z
    .object({
      dailyCallLimit: optionalInt(1, 1_000_000, 'Enter a whole number of at least 1, or leave it empty.'),
      dailyBudgetUsd: optionalNumber(0.01, 100_000, 'Enter an amount in dollars, like 2 or 2.50, or leave it empty.'),
      alertAtPercent: requiredNumber(1, 100, 'Enter a whole number from 1 to 100.').refine(
        Number.isInteger,
        'Enter a whole number from 1 to 100.',
      ),
      userDailyLimit: optionalInt(0, 100_000, 'Enter a whole number, or leave it empty.'),
      prices: z.array(priceRow),
    })
    .superRefine((v, ctx) => {
      const ids = v.prices.map((p) => p.model.trim());
      v.prices.forEach((p, i) => {
        if (p.builtIn) return;
        const at = (field: string, message: string) =>
          ctx.addIssue({ code: 'custom', path: ['prices', i, field], message });
        const model = p.model.trim();
        if (!model) at('model', 'Enter the model id, e.g. gemini-2.5-pro');
        else if (/\s/.test(model)) at('model', 'Model ids have no spaces');
        else if (builtIn[model]) at('model', 'Already in the table — edit its row instead');
        else if (ids.indexOf(model) !== i) at('model', 'This model is listed twice');
        if (p.input == null) at('input', 'Required');
        if (p.output == null) at('output', 'Required');
      });
    });
}

export type SettingsValues = z.input<ReturnType<typeof settingsSchema>>;
export type SettingsOutput = z.output<ReturnType<typeof settingsSchema>>;
export type PriceRowValues = SettingsValues['prices'][number];

const str = (n: number | null | undefined) => toInput(n);

/** Saved settings → what the inputs hold: every built-in model (filled when overridden), then your own models. */
export function toValues(s: AdminAiSettings): SettingsValues {
  const builtIn = s.defaults.builtInPricing;
  const builtInRows = Object.keys(builtIn)
    .sort()
    .map((model) => {
      const p = s.pricing[model];
      return { model, builtIn: true, input: str(p?.input), cachedInput: str(p?.cachedInput), output: str(p?.output) };
    });
  const customRows = Object.entries(s.pricing)
    .filter(([model]) => !builtIn[model])
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([model, p]) => ({
      model,
      builtIn: false,
      input: str(p.input),
      cachedInput: str(p.cachedInput),
      output: str(p.output),
    }));
  return {
    dailyCallLimit: str(s.dailyCallLimit),
    dailyBudgetUsd: str(s.dailyBudgetUsd),
    alertAtPercent: str(s.alertAtPercent),
    userDailyLimit: str(s.userDailyLimit),
    prices: [...builtInRows, ...customRows],
  };
}

export const emptyCustomRow = (): PriceRowValues => ({
  model: '',
  builtIn: false,
  input: '',
  cachedInput: '',
  output: '',
});

/** A built-in row counts as your override as soon as one of its fields is filled. */
export const isOverride = (p: { builtIn: boolean; input: unknown; cachedInput: unknown; output: unknown }) =>
  !p.builtIn || [p.input, p.cachedInput, p.output].some((v) => v != null && String(v).trim() !== '');

/** Parsed form → the API body. Built-in rows only become overrides when filled; blanks keep the built-in value. */
export function toApiInput(v: SettingsOutput, builtIn: Record<string, Price>): AiSettingsInput {
  const pricing: AiSettingsInput['pricing'] = {};
  for (const p of [...v.prices].sort((a, b) => a.model.trim().localeCompare(b.model.trim()))) {
    if (!isOverride(p)) continue;
    const base = p.builtIn ? builtIn[p.model] : undefined;
    const row: Price = { input: p.input ?? base?.input ?? 0, output: p.output ?? base?.output ?? 0 };
    const cached = p.cachedInput ?? base?.cachedInput;
    if (cached != null) row.cachedInput = cached;
    pricing[p.model.trim()] = row;
  }
  return {
    dailyCallLimit: v.dailyCallLimit,
    dailyBudgetUsd: v.dailyBudgetUsd,
    alertAtPercent: v.alertAtPercent,
    userDailyLimit: v.userDailyLimit,
    pricing,
  };
}
