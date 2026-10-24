import type { AdminAiSettings } from '@tbot/shared';
import { useFieldArray, useFormContext } from 'react-hook-form';

import { Button, TextLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { STACK_ON_MOBILE } from '@/components/ui/table-stack';
import { Table, Th, THead } from '@/components/ui/table';

import { emptyCustomRow, type SettingsValues } from '../lib/form-model';
import { PriceRow } from './price-row';

type Price = AdminAiSettings['pricing'][string];

/** Built-in prices (type to override) and models you priced yourself. */
export function PriceTable({ builtIn, currentModel }: { builtIn: Record<string, Price>; currentModel: string | null }) {
  const { control } = useFormContext<SettingsValues>();
  const { fields, append, remove } = useFieldArray({ control, name: 'prices' });

  return (
    <Card>
      <CardHeader
        title="Price table"
        subtitle={
          <>
            Cost is estimated from token counts × these prices, at the moment each call is made — a change applies to
            new calls only; past costs stay as recorded. Calls to a model with no price count as $0 and show as
            “unpriced” on <TextLink to="/ai">AI &amp; cost</TextLink>. Prices are in US dollars per 1 million tokens, as
            listed on your provider’s pricing page.
          </>
        }
      />
      <Table className={STACK_ON_MOBILE}>
        <THead>
          <Th>Model</Th>
          <Th align="right" hint="USD per 1M tokens">
            Input
          </Th>
          <Th align="right" hint="USD per 1M · blank = same as input">
            Cached input
          </Th>
          <Th align="right" hint="USD per 1M tokens">
            Output
          </Th>
          <Th>Source</Th>
          <Th />
        </THead>
        <tbody>
          {fields.map((f, i) => (
            <PriceRow
              key={f.id}
              index={i}
              base={f.builtIn ? builtIn[f.model] : undefined}
              isCurrentModel={!!currentModel && f.model === currentModel}
              onRemove={() => remove(i)}
            />
          ))}
        </tbody>
      </Table>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-5 py-3">
        <Button size="sm" onClick={() => append(emptyCustomRow())}>
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
    </Card>
  );
}
