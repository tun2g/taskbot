import type { AdminAiSettings } from '@tbot/shared';

import { Badge } from '@/components/ui/badge';
import { Button, TextLink } from '@/components/ui/button';
import { TextInput } from '@/components/ui/input';
import { Table, Td, Th, THead, Tr } from '@/components/ui/table';
import { cn } from '@/lib/cn';

import { type DraftErrors, type PriceDraft, priceToDraft } from './form-model';

type Price = AdminAiSettings['pricing'][string];
type PriceField = 'input' | 'cachedInput' | 'output';
const FIELDS: PriceField[] = ['input', 'cachedInput', 'output'];

function PriceInput({
  value,
  placeholder,
  error,
  builtIn,
  label,
  onChange,
}: {
  value: string;
  placeholder?: string;
  error?: string;
  /** Built-in value shown under an override, for comparison. */
  builtIn?: number;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="min-w-24">
      <TextInput
        inputMode="decimal"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        aria-invalid={!!error}
        className={cn('h-8 text-right tabular', error && 'border-danger')}
      />
      {error ? (
        <span className="mt-0.5 block text-right text-xs text-danger">{error}</span>
      ) : builtIn != null ? (
        <span className="mt-0.5 block text-right text-xs text-text-3">built-in {builtIn}</span>
      ) : null}
    </div>
  );
}

export function PriceTable({
  builtIn,
  overrides,
  errors,
  currentModel,
  onChange,
}: {
  builtIn: Record<string, Price>;
  overrides: PriceDraft[];
  errors: DraftErrors['prices'];
  currentModel: string;
  onChange: (overrides: PriceDraft[]) => void;
}) {
  const builtInModels = Object.keys(builtIn).sort();
  const customRows = overrides.filter((o) => o.isNew || !builtIn[o.model.trim()]);

  const setField = (key: string, field: keyof PriceDraft, value: string) =>
    onChange(overrides.map((o) => (o.key === key ? { ...o, [field]: value } : o)));

  /** Typing into a built-in row turns it into your override (starting from the built-in price). */
  const editBuiltIn = (model: string, field: PriceField, value: string) => {
    const existing = overrides.find((o) => !o.isNew && o.model.trim() === model);
    if (existing) setField(existing.key, field, value);
    else onChange([...overrides, { ...priceToDraft(model, builtIn[model]), [field]: value }]);
  };

  const remove = (key: string) => onChange(overrides.filter((o) => o.key !== key));

  return (
    <>
      <Table>
        <THead>
          <Th>Model</Th>
          <Th align="right" hint="USD per 1M tokens">
            Input
          </Th>
          <Th align="right" hint="USD per 1M · optional">
            Cached input
          </Th>
          <Th align="right" hint="USD per 1M tokens">
            Output
          </Th>
          <Th>Source</Th>
          <Th />
        </THead>
        <tbody>
          {builtInModels.map((model) => {
            const base = builtIn[model]!;
            const ov = overrides.find((o) => !o.isNew && o.model.trim() === model);
            const err = ov ? errors[ov.key] : undefined;
            return (
              <Tr key={model}>
                <Td>
                  <span className="font-mono text-sm text-text">{model}</span>
                  {model === currentModel && <span className="block text-[13px] text-text-3">Current model</span>}
                </Td>
                {FIELDS.map((f) => (
                  <Td key={f} align="right">
                    <PriceInput
                      label={`${model} ${f} price`}
                      value={ov ? ov[f] : ''}
                      placeholder={base[f] != null ? String(base[f]) : f === 'cachedInput' ? 'same as input' : ''}
                      builtIn={ov && base[f] != null ? base[f] : undefined}
                      error={err?.[f]}
                      onChange={(v) => editBuiltIn(model, f, v)}
                    />
                  </Td>
                ))}
                <Td>
                  {ov ? (
                    <Badge tone="accent" title="Your price is used instead of the built-in one.">
                      Your price (overrides built-in)
                    </Badge>
                  ) : (
                    <Badge tone="neutral" title="Price shipped with the bot. Type a value to override it.">
                      Built-in
                    </Badge>
                  )}
                </Td>
                <Td align="right">
                  {ov && (
                    <Button size="sm" variant="ghost" onClick={() => remove(ov.key)}>
                      Reset to built-in
                    </Button>
                  )}
                </Td>
              </Tr>
            );
          })}
          {customRows.map((o) => {
            const err = errors[o.key];
            return (
              <Tr key={o.key}>
                <Td>
                  {o.isNew ? (
                    <div className="min-w-48">
                      <TextInput
                        value={o.model}
                        onChange={(e) => setField(o.key, 'model', e.target.value)}
                        placeholder="Model id, e.g. gemini-2.5-pro"
                        aria-label="Model id"
                        aria-invalid={!!err?.model}
                        spellCheck={false}
                        autoComplete="off"
                        className={cn('h-8 font-mono text-sm', err?.model && 'border-danger')}
                      />
                      {err?.model && <span className="mt-0.5 block text-xs text-danger">{err.model}</span>}
                    </div>
                  ) : (
                    <>
                      <span className="font-mono text-sm text-text">{o.model}</span>
                      {err?.model && <span className="block text-xs text-danger">{err.model}</span>}
                      {o.model.trim() === currentModel && <span className="block text-[13px] text-text-3">Current model</span>}
                    </>
                  )}
                </Td>
                {FIELDS.map((f) => (
                  <Td key={f} align="right">
                    <PriceInput
                      label={`${o.model || 'new model'} ${f} price`}
                      value={o[f]}
                      placeholder={f === 'cachedInput' ? 'same as input' : '0.00'}
                      error={err?.[f]}
                      onChange={(v) => setField(o.key, f, v)}
                    />
                  </Td>
                ))}
                <Td>
                  <Badge tone="accent" title="A model without a built-in price, priced by you.">
                    Your price
                  </Badge>
                </Td>
                <Td align="right">
                  <Button size="sm" variant="ghost" onClick={() => remove(o.key)}>
                    Remove
                  </Button>
                </Td>
              </Tr>
            );
          })}
        </tbody>
      </Table>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-5 py-3">
        <Button size="sm" onClick={() => onChange([...overrides, priceToDraft('', undefined, true)])}>
          + Add a model
        </Button>
        <span className="text-[13px] text-text-3">
          For a model that shows as “unpriced”. Find model ids on{' '}
          <TextLink to="/ai" search={{ groupBy: 'model' }}>
            AI &amp; cost, grouped by model
          </TextLink>
          .
        </span>
      </div>
    </>
  );
}
