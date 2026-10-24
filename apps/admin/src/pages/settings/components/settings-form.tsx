import { zodResolver } from '@hookform/resolvers/zod';
import type { AdminAiSettings } from '@tbot/shared';
import { aiSettingsChangeLines } from '@tbot/shared';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';

import type { AiSettingsInput } from '@/api/settings';
import { Form } from '@/components/form/form';
import { UnsavedChangesGuard } from '@/components/form/unsaved-changes-guard';
import { toast } from '@/lib/toast';

import { settingsSchema, type SettingsOutput, type SettingsValues, toApiInput, toValues } from '../lib/form-model';
import { LimitsCard } from './limits-card';
import { PriceTable } from './price-table';
import { ReviewDialog } from './review-dialog';
import { SaveBar } from './save-bar';

/** AI limits and prices: edit → "Review and save" lists every change → confirm writes them. */
export function SettingsForm({
  settings,
  saving,
  onSave,
}: {
  settings: AdminAiSettings;
  saving: boolean;
  onSave: (input: AiSettingsInput) => void;
}) {
  const { defaults } = settings;
  const schema = useMemo(() => settingsSchema(defaults.builtInPricing), [defaults.builtInPricing]);
  const initial = useMemo(() => toValues(settings), [settings]);
  const form = useForm<SettingsValues, unknown, SettingsOutput>({
    resolver: zodResolver(schema),
    defaultValues: initial,
  });
  const [review, setReview] = useState<{ input: AiSettingsInput; lines: string[] } | null>(null);
  const { isDirty, errors } = form.formState;

  const submit = (values: SettingsOutput) => {
    const input = toApiInput(values, defaults.builtInPricing);
    const lines = aiSettingsChangeLines(settings, input, defaults.builtInPricing);
    if (lines.length === 0) {
      toast.info('Nothing to save', 'These values are the same as the saved ones.');
      form.reset(initial);
      return;
    }
    setReview({ input, lines });
  };

  return (
    <>
      <Form form={form} onSubmit={submit} className="space-y-5 pb-20">
        <LimitsCard defaults={defaults} />
        <PriceTable builtIn={defaults.builtInPricing} currentModel={defaults.model} />
        <SaveBar
          dirty={isDirty}
          invalid={Object.keys(errors).length > 0}
          saving={saving}
          onDiscard={() => form.reset(initial)}
        />
        <UnsavedChangesGuard when={isDirty && !saving && !review} what="your AI settings changes" />
      </Form>
      {/* Outside the form: a dialog's events bubble through the React tree. */}
      <ReviewDialog
        lines={review?.lines ?? null}
        saving={saving}
        onCancel={() => setReview(null)}
        onConfirm={() => review && onSave(review.input)}
      />
    </>
  );
}
