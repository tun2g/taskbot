import type { AdminAiSettings } from '@tbot/shared';
import { type FormEvent, useMemo, useState } from 'react';

import type { AiSettingsInput } from '@/api/settings';
import { Button, TextLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Field, TextInput } from '@/components/ui/input';
import { formatMoney, formatNumber } from '@/lib/format';

import { hasErrors, type SettingsDraft, snapshot, toDraft, toInput, validate } from './form-model';
import { PriceTable } from './price-table';

export function SettingsForm({
  settings,
  saving,
  onSave,
}: {
  settings: AdminAiSettings;
  saving: boolean;
  onSave: (input: AiSettingsInput) => void;
}) {
  const initial = useMemo(() => toDraft(settings), [settings]);
  const [draft, setDraft] = useState<SettingsDraft>(initial);
  const { defaults } = settings;

  const errors = validate(draft, defaults.builtInPricing);
  const invalid = hasErrors(errors);
  const dirty = snapshot(draft) !== snapshot(initial);

  const set = (field: keyof Omit<SettingsDraft, 'overrides'>) => (e: { target: { value: string } }) =>
    setDraft((d) => ({ ...d, [field]: e.target.value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || invalid || saving) return;
    onSave(toInput(draft));
  };

  const budget = Number(draft.dailyBudgetUsd);
  const alertPct = Number(draft.alertAtPercent);
  const alertPreview =
    draft.dailyBudgetUsd.trim() && !errors.dailyBudgetUsd && !errors.alertAtPercent
      ? ` With your budget that is ${formatMoney((budget * alertPct) / 100)} a day.`
      : '';

  return (
    <form onSubmit={submit} className="space-y-5 pb-20">
      <Card>
        <CardHeader
          title="Daily limits"
          subtitle={
            <>
              Days are counted in UTC. Current model:{' '}
              <span className="font-mono text-text-2">
                {defaults.provider} · {defaults.model}
              </span>{' '}
              (set on the server).
            </>
          }
        />
        <CardBody className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field
            label="Daily AI call limit for all groups"
            hint={
              <>
                Total AI calls per day across every group. When it’s reached, AI stops until midnight UTC. Leave empty
                for no limit. Server default:{' '}
                {defaults.envDailyCallLimit > 0 ? `${formatNumber(defaults.envDailyCallLimit)} calls` : 'none'}.
              </>
            }
            error={errors.dailyCallLimit}
          >
            <TextInput
              inputMode="numeric"
              value={draft.dailyCallLimit}
              onChange={set('dailyCallLimit')}
              placeholder={defaults.envDailyCallLimit > 0 ? String(defaults.envDailyCallLimit) : 'No limit'}
              className="max-w-48"
            />
          </Field>
          <Field
            label="Daily budget (USD)"
            hint="For alerts only: you get a Telegram message as today’s estimated cost (UTC day) approaches it. AI keeps working — use the daily call limit above to stop it. Leave empty for no budget."
            error={errors.dailyBudgetUsd}
          >
            <div className="relative max-w-48">
              <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-text-3">$</span>
              <TextInput
                inputMode="decimal"
                value={draft.dailyBudgetUsd}
                onChange={set('dailyBudgetUsd')}
                placeholder="No budget"
                className="pl-6"
              />
            </div>
          </Field>
          <Field
            label="Alert at (% of budget)"
            hint={`You get a Telegram message when today’s cost passes this share of the budget.${alertPreview}`}
            error={errors.alertAtPercent}
          >
            <div className="relative max-w-32">
              <TextInput
                inputMode="numeric"
                value={draft.alertAtPercent}
                onChange={set('alertAtPercent')}
                className="pr-7"
                disabled={!draft.dailyBudgetUsd.trim()}
              />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm text-text-3">%</span>
            </div>
          </Field>
          <Field
            label="Default daily limit per person"
            hint={
              <>
                AI calls one person can make per day, in all groups together. Leave empty to use the server default (
                {formatNumber(defaults.userDailyLimit)} calls). You can change it for one person on their page.
              </>
            }
            error={errors.userDailyLimit}
          >
            <TextInput
              inputMode="numeric"
              value={draft.userDailyLimit}
              onChange={set('userDailyLimit')}
              placeholder={String(defaults.userDailyLimit)}
              className="max-w-48"
            />
          </Field>
        </CardBody>
      </Card>

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
        <PriceTable
          builtIn={defaults.builtInPricing}
          overrides={draft.overrides}
          errors={errors.prices}
          currentModel={defaults.model}
          onChange={(overrides) => setDraft((d) => ({ ...d, overrides }))}
        />
      </Card>

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-border bg-bg/95 px-4 py-3 backdrop-blur sm:-mx-8 sm:px-8">
        <Button type="submit" variant="primary" disabled={!dirty || invalid} loading={saving}>
          Save settings
        </Button>
        <Button variant="secondary" disabled={!dirty || saving} onClick={() => setDraft(toDraft(settings))}>
          Discard changes
        </Button>
        <span className="text-[13px] text-text-3">
          {invalid && dirty
            ? 'Fix the highlighted fields to save.'
            : dirty
              ? 'Unsaved changes. They apply within 30 seconds of saving.'
              : 'Changes apply within 30 seconds of saving.'}
        </span>
      </div>
    </form>
  );
}
