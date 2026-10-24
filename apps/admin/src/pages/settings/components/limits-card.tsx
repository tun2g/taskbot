import type { AdminAiSettings } from '@tbot/shared';
import { useFormContext, useWatch } from 'react-hook-form';

import { FormTextField } from '@/components/form/form';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { formatMoney, formatNumber } from '@/lib/format';

import type { SettingsValues } from '../lib/form-model';
import { providerLabel } from '../lib/provider';

function ModelLine({ defaults }: { defaults: AdminAiSettings['defaults'] }) {
  if (!defaults.provider || !defaults.model)
    return <>The bot hasn’t reported which AI model it uses yet — it does each time it starts.</>;
  return (
    <>
      Current model: <span className="text-text-2">{providerLabel(defaults.provider)}</span> ·{' '}
      <span className="font-mono text-text-2">{defaults.model}</span> (set in the bot’s server config).
    </>
  );
}

/** "With your budget that is $1.20 a day." under the alert field, while both values are valid. */
function useAlertPreview(): string {
  const { control } = useFormContext<SettingsValues>();
  const [budget, pct] = useWatch({ control, name: ['dailyBudgetUsd', 'alertAtPercent'] }) as [string, string];
  const b = Number(budget);
  const p = Number(pct);
  if (!String(budget).trim() || !(b > 0) || !(p >= 1 && p <= 100)) return '';
  return ` With your budget that is ${formatMoney((b * p) / 100)} a day.`;
}

export function LimitsCard({ defaults }: { defaults: AdminAiSettings['defaults'] }) {
  const { control } = useFormContext<SettingsValues>();
  const budget = useWatch({ control, name: 'dailyBudgetUsd' }) as string;
  const alertPreview = useAlertPreview();
  const envLimit = defaults.envDailyCallLimit;

  return (
    <Card>
      <CardHeader
        title="Daily limits"
        subtitle={
          <>
            Days are counted in UTC. <ModelLine defaults={defaults} />
          </>
        }
      />
      <CardBody className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <FormTextField
          name="dailyCallLimit"
          label="Daily AI call limit for all groups"
          hint={
            <>
              Total AI calls per day across every group. When it’s reached, AI stops until midnight UTC.{' '}
              {envLimit > 0
                ? `Leave empty to use the bot’s fallback of ${formatNumber(envLimit)} calls (from its server config).`
                : 'Leave empty for no limit.'}
            </>
          }
          inputMode="numeric"
          placeholder={envLimit > 0 ? String(envLimit) : 'No limit'}
          className="max-w-48"
        />
        <FormTextField
          name="dailyBudgetUsd"
          label="Daily budget (USD)"
          hint="For alerts only: you get a Telegram message as today’s estimated cost (UTC day) approaches it. AI keeps working — use the daily call limit to stop it. Leave empty for no budget."
          inputMode="decimal"
          placeholder="No budget"
          prefix="$"
          controlClassName="max-w-48"
        />
        <FormTextField
          name="alertAtPercent"
          label="Alert at (% of budget)"
          hint={`You get a Telegram message when today’s cost passes this share of the budget.${alertPreview}`}
          inputMode="numeric"
          suffix="%"
          controlClassName="max-w-32"
          disabled={!String(budget ?? '').trim()}
        />
        <FormTextField
          name="userDailyLimit"
          label="Default daily limit per person"
          hint={
            <>
              AI calls one person can make per day, in all groups together. Leave empty for the built-in default (
              {formatNumber(defaults.userDailyLimit)} calls). You can change it for one person on their page.
            </>
          }
          inputMode="numeric"
          placeholder={String(defaults.userDailyLimit)}
          className="max-w-48"
        />
      </CardBody>
    </Card>
  );
}
