import type { ComponentProps, ReactNode } from 'react';
import {
  Controller,
  type FieldPath,
  type FieldValues,
  FormProvider,
  type SubmitHandler,
  useFormContext,
  type UseFormReturn,
} from 'react-hook-form';

import { Field, TextInput, Textarea, Toggle } from '@/components/ui/input';
import { Select, type SelectOption } from '@/components/ui/select';

/**
 * Every form in the admin app is react-hook-form + a zod schema (zodResolver). These wrappers bind the shared
 * inputs to the form by `name`, so a page never wires value/onChange/error by hand.
 */
export function Form<T extends FieldValues, TOut extends FieldValues = T>({
  form,
  onSubmit,
  className,
  children,
}: {
  /** useForm<Input, unknown, Output>: the schema's parsed output is what onSubmit receives. */
  form: UseFormReturn<T, unknown, TOut>;
  onSubmit: SubmitHandler<TOut>;
  className?: string;
  children: ReactNode;
}) {
  return (
    <FormProvider {...form}>
      <form noValidate onSubmit={form.handleSubmit(onSubmit)} className={className}>
        {children}
      </form>
    </FormProvider>
  );
}

function errorOf(errors: Record<string, unknown>, name: string): string | null {
  const err = name.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], errors) as
    | { message?: string }
    | undefined;
  return err?.message ?? null;
}

type TextFieldProps = Omit<ComponentProps<typeof TextInput>, 'name'> & {
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  /** Something shown inside the input on the left, e.g. "$". */
  prefix?: string;
  /** Something shown inside the input on the right, e.g. "%". */
  suffix?: string;
  fieldClassName?: string;
};

/** A text/number input registered by name, with label, hint and the schema's error message. */
export function FormTextField({ name, label, hint, prefix, suffix, fieldClassName, className, ...rest }: TextFieldProps) {
  const { register, formState } = useFormContext();
  const error = errorOf(formState.errors, name);
  return (
    <Field label={label} hint={hint} error={error} className={fieldClassName}>
      <span className="relative block">
        {prefix && <span className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-text-3">{prefix}</span>}
        <TextInput
          {...rest}
          {...register(name)}
          aria-invalid={error ? true : undefined}
          className={[className, prefix && 'pl-8', suffix && 'pr-9', error && 'border-danger focus:border-danger focus:ring-danger/20']
            .filter(Boolean)
            .join(' ')}
        />
        {suffix && <span className="pointer-events-none absolute top-1/2 right-3.5 -translate-y-1/2 text-text-3">{suffix}</span>}
      </span>
    </Field>
  );
}

export function FormTextareaField({
  name,
  label,
  hint,
  ...rest
}: Omit<ComponentProps<typeof Textarea>, 'name'> & { name: string; label: ReactNode; hint?: ReactNode }) {
  const { register, formState } = useFormContext();
  const error = errorOf(formState.errors, name);
  return (
    <Field label={label} hint={hint} error={error}>
      <Textarea {...rest} {...register(name)} aria-invalid={error ? true : undefined} />
    </Field>
  );
}

export function FormToggleField<T extends FieldValues>({
  name,
  label,
  hint,
  disabled,
}: {
  name: FieldPath<T>;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const { control } = useFormContext<T>();
  return (
    <Controller
      control={control}
      name={name}
      render={({ field }) => (
        <Toggle checked={Boolean(field.value)} onChange={field.onChange} label={label} hint={hint} disabled={disabled} />
      )}
    />
  );
}

export function FormSelectField<T extends FieldValues, V extends string>({
  name,
  label,
  hint,
  options,
}: {
  name: FieldPath<T>;
  label: string;
  hint?: ReactNode;
  options: SelectOption<V>[];
}) {
  const { control, formState } = useFormContext<T>();
  return (
    <Field label={label} hint={hint} error={errorOf(formState.errors, name)}>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <Select label={label} showLabel={false} value={field.value as V} onChange={field.onChange} options={options} />
        )}
      />
    </Field>
  );
}
