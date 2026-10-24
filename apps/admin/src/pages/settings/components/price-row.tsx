import type { AdminAiSettings } from '@tbot/shared';
import { formatPricePerMillion } from '@tbot/shared';
import { useFormContext, useWatch } from 'react-hook-form';

import { FormTextField } from '@/components/form/form';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { StackLabel } from '@/components/ui/stack-label';
import { STACK_PAIR } from '@/components/ui/table-stack';
import { Td, Tr } from '@/components/ui/table';

import { isOverride, type SettingsValues } from '../lib/form-model';

type Price = AdminAiSettings['pricing'][string];
const FIELDS = [
  { key: 'input', label: 'Input' },
  { key: 'cachedInput', label: 'Cached input' },
  { key: 'output', label: 'Output' },
] as const;

function priceHint(base: Price | undefined, key: (typeof FIELDS)[number]['key'], overridden: boolean) {
  if (!base || !overridden) return undefined;
  const v = key === 'cachedInput' ? (base.cachedInput ?? base.input) : base[key];
  return `built-in ${formatPricePerMillion(v)}`;
}

/** One model: built-in rows take your price as soon as you type; custom rows are models you added. */
export function PriceRow({
  index,
  base,
  isCurrentModel,
  onRemove,
}: {
  index: number;
  /** The built-in price (undefined for a model you added). */
  base: Price | undefined;
  isCurrentModel: boolean;
  onRemove: () => void;
}) {
  const { control, setValue } = useFormContext<SettingsValues>();
  const row = useWatch({ control, name: `prices.${index}` });
  const overridden = isOverride(row);
  const reset = () =>
    FIELDS.forEach((f) => setValue(`prices.${index}.${f.key}`, '', { shouldDirty: true, shouldValidate: true }));

  return (
    <Tr>
      <Td className="max-sm:pb-2">
        {base ? (
          <span className="font-mono text-sm text-text">{row.model}</span>
        ) : (
          <FormTextField
            name={`prices.${index}.model`}
            label={<span className="sm:sr-only">Model id</span>}
            placeholder="Model id, e.g. gemini-2.5-pro"
            spellCheck={false}
            autoComplete="off"
            className="h-9 font-mono text-sm"
            fieldClassName="min-w-48"
          />
        )}
        {isCurrentModel && <span className="block text-[13px] text-text-3">Current model</span>}
      </Td>
      {FIELDS.map((f) => (
        <Td key={f.key} align="right">
          <FormTextField
            name={`prices.${index}.${f.key}`}
            label={<span className="sm:sr-only">{f.label} (USD per 1M tokens)</span>}
            hint={priceHint(base, f.key, overridden)}
            inputMode="decimal"
            placeholder={
              base
                ? formatPricePerMillion(f.key === 'cachedInput' ? (base.cachedInput ?? base.input) : base[f.key]).slice(
                    1,
                  )
                : f.key === 'cachedInput'
                  ? 'same as input'
                  : '0.00'
            }
            className="h-9 text-right tabular"
            fieldClassName="min-w-24 max-sm:text-left"
          />
        </Td>
      ))}
      <Td className={STACK_PAIR}>
        <StackLabel>Source</StackLabel>
        {!base ? (
          <Badge tone="accent" title="A model without a built-in price, priced by you.">
            Your price
          </Badge>
        ) : overridden ? (
          <Badge
            tone="accent"
            title="Your price is used instead of the built-in one. Blank fields keep the built-in value."
          >
            Your price
          </Badge>
        ) : (
          <Badge tone="neutral" title="Price shipped with the bot. Type a value to use your own.">
            Built-in
          </Badge>
        )}
      </Td>
      <Td align="right">
        {!base ? (
          <Button size="sm" variant="ghost" onClick={onRemove} className="max-sm:w-full">
            Remove
          </Button>
        ) : (
          overridden && (
            <Button size="sm" variant="ghost" onClick={reset} className="max-sm:w-full">
              Reset to built-in
            </Button>
          )
        )}
      </Td>
    </Tr>
  );
}
