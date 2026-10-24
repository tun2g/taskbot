import { AI_BUILT_IN_PRICING, AiModelPrice } from '@tbot/shared';
import type { AiUsage } from 'src/shared/services/ai/ai.interface';

export type PriceTable = Record<string, AiModelPrice>;

const VERSION_SUFFIX = /^(\d|latest\b|preview\b|exp\b)/;

/** Built-in table with the owner's overrides (Settings → AI → pricing) on top. */
export function mergePricing(overrides: PriceTable | null | undefined): PriceTable {
  return { ...AI_BUILT_IN_PRICING, ...(overrides ?? {}) };
}

/**
 * The price entry for a model id: exact (case-insensitive), then without a provider prefix ("models/",
 * "openai/"), then the longest table key followed by a version suffix — so a dated snapshot
 * ("gpt-5-mini-2025-08-07", "gemini-2.5-flash-preview-05-20") gets its family's price, while another model
 * ("gpt-5-nano") never borrows "gpt-5"'s price.
 */
export function findPrice(model: string, table: PriceTable): AiModelPrice | null {
  const entries = Object.entries(table).map(([k, v]) => [k.toLowerCase(), v] as const);
  const lookup = new Map(entries);
  const raw = model.trim().toLowerCase();
  const bare = raw.replace(/^.*\//, '');
  for (const candidate of [raw, bare]) {
    const hit = lookup.get(candidate);
    if (hit) return hit;
  }
  let best: { key: string; price: AiModelPrice } | null = null;
  for (const [key, price] of entries) {
    if (!bare.startsWith(`${key}-`)) continue;
    // Only a version / date suffix ("-2025-08-07", "-001", "-preview-05-20"), not another model ("-nano").
    if (!VERSION_SUFFIX.test(bare.slice(key.length + 1))) continue;
    if (!best || key.length > best.key.length) best = { key, price };
  }
  return best?.price ?? null;
}

export interface AiCost {
  costUsd: number;
  /** False when the model has no price (cost unknown, not free). */
  priced: boolean;
}

/**
 * USD for one call. Cached input tokens are part of inputTokens and billed at `cachedInput` (default: the
 * input price); thinking tokens are already included in outputTokens (billed as output).
 */
export function computeCost(model: string, usage: AiUsage, table: PriceTable): AiCost {
  const price = findPrice(model, table);
  if (!price) return { costUsd: 0, priced: false };
  const cached = Math.min(usage.cachedTokens, usage.inputTokens);
  const fresh = usage.inputTokens - cached;
  const usd =
    (fresh * price.input + cached * (price.cachedInput ?? price.input) + usage.outputTokens * price.output) / 1_000_000;
  // Micro-dollar precision keeps sums stable without float noise.
  return { costUsd: Math.round(usd * 1e8) / 1e8, priced: true };
}
