import { zodResolver } from '@hookform/resolvers/zod';
import type { AdminAiOverrideInput } from '@tbot/shared';
import { type ReactNode, useEffect } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';

import { Form, FormTextareaField, FormTextField, FormToggleField } from '@/components/form/form';
import { optionalInt, toInput } from '@/components/form/schema';
import { Button } from '@/components/ui/button';

import { LIMIT_ERROR, TURN_OFF_HINT, WHICH_LIMIT_WINS } from './ai-override-text';

const schema = z.object({
  disabled: z.boolean(),
  dailyLimit: optionalInt(1, 100_000, LIMIT_ERROR),
  reason: z.string().max(500, 'Keep the reason under 500 characters.'),
});
type Values = z.input<typeof schema>;

/** Turn AI off or set a custom daily call limit for one group or one person, with an optional reason. */
export function AiOverrideForm({
  subject,
  disabled,
  dailyLimit,
  reason = null,
  defaultLimitText,
  rightNow,
  usage,
  pending,
  onSave,
}: {
  subject: 'group' | 'person';
  disabled: boolean;
  dailyLimit: number | null;
  /** The reason saved with the current override. */
  reason?: string | null;
  /** What applies without an override, e.g. "40 calls per person per day (from Settings)". */
  defaultLimitText: string;
  /** "Right now: 10/day (your override) · group limit … · bot-wide …" — what is in force before any change. */
  rightNow?: ReactNode;
  /** How much of the limit is used today (shown next to the form). */
  usage?: ReactNode;
  pending: boolean;
  onSave: (input: AdminAiOverrideInput) => void;
}) {
  const form = useForm<Values, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { disabled, dailyLimit: toInput(dailyLimit), reason: reason ?? '' },
  });
  const { reset } = form;
  useEffect(() => reset({ disabled, dailyLimit: toInput(dailyLimit), reason: reason ?? '' }), [disabled, dailyLimit, reason, reset]);
  const off = useWatch({ control: form.control, name: 'disabled' });
  const limit = useWatch({ control: form.control, name: 'dailyLimit' });
  const overriding = off || String(limit ?? '').trim() !== '';

  const who = subject === 'group' ? 'this group' : 'this person';
  return (
    <Form form={form} onSubmit={(v) => onSave({ disabled: v.disabled, dailyLimit: v.dailyLimit, reason: v.reason.trim() })} className="space-y-4">
      {(rightNow || usage) && (
        <div className="space-y-1 rounded-xl bg-surface-2/70 px-4 py-3 text-[15px] text-text-2">
          {rightNow && <p>{rightNow}</p>}
          {usage && <p>{usage}</p>}
        </div>
      )}
      <FormToggleField<Values> name="disabled" label={`Turn off AI for ${who}`} hint={TURN_OFF_HINT[subject]} />
      <FormTextField
        name="dailyLimit"
        label="Daily AI call limit"
        hint={`Leave empty to use the default: ${defaultLimitText}.`}
        inputMode="numeric"
        placeholder="Default"
        disabled={off}
        className="max-w-40"
      />
      <p className="text-[13px] leading-relaxed text-text-3">{WHICH_LIMIT_WINS[subject]}</p>
      {overriding && (
        <FormTextareaField
          name="reason"
          label="Reason (optional)"
          hint={`Kept with this setting and shown next to it. When AI is off, the bot tells ${subject === 'group' ? 'the group' : 'the person'} this reason.`}
          rows={2}
          maxLength={500}
          placeholder="e.g. Over this month’s AI budget"
        />
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={!form.formState.isDirty} loading={pending}>
          Save AI settings
        </Button>
        <span className="text-[13px] text-text-3">Changes apply within 30 seconds.</span>
      </div>
    </Form>
  );
}
