import type { AdminAiOverrideInput } from '@tbot/shared';
import { type FormEvent, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, TextInput, Toggle } from '@/components/ui/input';

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
  const [off, setOff] = useState(disabled);
  const [limit, setLimit] = useState(dailyLimit == null ? '' : String(dailyLimit));
  useEffect(() => {
    setOff(disabled);
    setLimit(dailyLimit == null ? '' : String(dailyLimit));
  }, [disabled, dailyLimit]);

  const parsed = limit.trim() === '' ? null : Number(limit);
  const invalid = parsed !== null && (!Number.isInteger(parsed) || parsed < 0 || parsed > 100_000);
  const dirty = off !== disabled || parsed !== dailyLimit;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (invalid || !dirty) return;
    onSave({ disabled: off, dailyLimit: parsed });
  };

  const who = subject === 'group' ? 'this group' : 'this person';
  return (
    <form onSubmit={submit} className="space-y-4">
      <Toggle
        checked={off}
        onChange={setOff}
        label={`Turn off AI for ${who}`}
        hint={
          subject === 'group'
            ? 'The /ai assistant, “Explain”, “Create tasks from messages” and “Split into subtasks” stop working in this group. Everything else keeps working.'
            : 'This person can’t use AI features in any group. Everything else keeps working.'
        }
      />
      <Field
        label="Daily AI call limit"
        hint={
          invalid
            ? undefined
            : `Leave empty to use the default: ${defaultLimitText}. 0 blocks AI like turning it off.`
        }
        error={invalid ? 'Enter a whole number from 0 to 100,000, or leave it empty.' : null}
      >
        <TextInput
          inputMode="numeric"
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          placeholder="Default"
          disabled={off}
          className="max-w-40"
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={!dirty || invalid} loading={pending}>
          Save AI settings
        </Button>
        <span className="text-[13px] text-text-3">Changes apply within 30 seconds.</span>
      </div>
    </form>
  );
}
