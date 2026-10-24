import { zodResolver } from '@hookform/resolvers/zod';
import type { AdminAiOverrideInput } from '@tbot/shared';
import { useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { Form, FormTextField, FormToggleField } from '@/components/form/form';
import { optionalInt, toInput } from '@/components/form/schema';
import { Button } from '@/components/ui/button';

const schema = z.object({
  disabled: z.boolean(),
  dailyLimit: optionalInt(0, 100_000, 'Enter a whole number from 0 to 100,000, or leave it empty.'),
});
type Values = z.input<typeof schema>;

/** Turn AI off or set a custom daily call limit for one group or one person. */
export function AiOverrideForm({
  subject,
  disabled,
  dailyLimit,
  defaultLimitText,
  pending,
  onSave,
}: {
  subject: 'group' | 'person';
  disabled: boolean;
  dailyLimit: number | null;
  /** What applies without an override, e.g. "40 calls per person per day (from Settings)". */
  defaultLimitText: string;
  pending: boolean;
  onSave: (input: AdminAiOverrideInput) => void;
}) {
  const defaults: Values = { disabled, dailyLimit: toInput(dailyLimit) };
  const form = useForm<Values, unknown, z.output<typeof schema>>({ resolver: zodResolver(schema), defaultValues: defaults });
  const { reset } = form;
  useEffect(() => reset({ disabled, dailyLimit: toInput(dailyLimit) }), [disabled, dailyLimit, reset]);
  const off = useWatch({ control: form.control, name: 'disabled' });

  const who = subject === 'group' ? 'this group' : 'this person';
  return (
    <Form form={form} onSubmit={(v) => onSave(v)} className="space-y-4">
      <FormToggleField<Values>
        name="disabled"
        label={`Turn off AI for ${who}`}
        hint={
          subject === 'group'
            ? 'The /ai assistant, “Explain”, “Create tasks from messages” and “Split into subtasks” stop working in this group. Everything else keeps working.'
            : 'This person can’t use AI features in any group. Everything else keeps working.'
        }
      />
      <FormTextField
        name="dailyLimit"
        label="Daily AI call limit"
        hint={`Leave empty to use the default: ${defaultLimitText}. 0 blocks AI like turning it off.`}
        inputMode="numeric"
        placeholder="Default"
        disabled={off}
        className="max-w-40"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={!form.formState.isDirty} loading={pending}>
          Save AI settings
        </Button>
        <span className="text-[13px] text-text-3">Changes apply within 30 seconds.</span>
      </div>
    </Form>
  );
}
