import { forwardRef, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes, useId } from 'react';

import { cn } from '@/lib/cn';

const CONTROL =
  'w-full rounded-lg border border-border-strong bg-surface px-3.5 text-[15px] text-text placeholder:text-text-3 ' +
  'hover:border-text-3/60 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand disabled:opacity-60';

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(CONTROL, 'h-10', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(CONTROL, 'py-2 leading-relaxed', className)} {...rest} />;
});

/** A labelled control with an always-visible hint underneath. */
export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="mb-1.5 block text-[15px] font-bold text-text">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[13px] text-danger">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-[13px] leading-relaxed text-text-3">{hint}</span>
      )}
    </label>
  );
}

/** An on/off switch with a label and a hint. */
export function Toggle({
  checked,
  onChange,
  label,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative mt-0.5 inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-brand' : 'bg-border-strong',
        )}
      >
        <span
          className={cn(
            'inline-block size-5 rounded-full bg-white transition-transform',
            checked ? 'translate-x-[22px]' : 'translate-x-0.5',
          )}
        />
      </button>
      <label htmlFor={id} className="cursor-pointer">
        <span className="block text-[15px] font-bold text-text">{label}</span>
        {hint && <span className="mt-0.5 block text-[13px] leading-relaxed text-text-3">{hint}</span>}
      </label>
    </div>
  );
}

/** Search box that reports its value; debounce happens in the caller. */
export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={cn('relative', className)}>
      <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute top-1/2 left-3 size-[18px] -translate-y-1/2 text-text-3">
        <path fill="currentColor" d="M8.5 3a5.5 5.5 0 014.38 8.83l3.65 3.64a.75.75 0 01-1.06 1.06l-3.64-3.65A5.5 5.5 0 118.5 3zm0 1.5a4 4 0 100 8 4 4 0 000-8z" />
      </svg>
      <TextInput
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-10"
        aria-label={placeholder}
      />
    </div>
  );
}
