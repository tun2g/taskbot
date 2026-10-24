import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, useId } from 'react';

import { cn } from '@/lib/cn';

const CONTROL =
  'w-full rounded-lg border border-border-strong bg-surface px-3 text-sm text-text placeholder:text-text-3 ' +
  'focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/25 disabled:opacity-60';

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function TextInput(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(CONTROL, 'h-9', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea(
  { className, ...rest },
  ref,
) {
  return <textarea ref={ref} className={cn(CONTROL, 'py-2 leading-relaxed', className)} {...rest} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <select ref={ref} className={cn(CONTROL, 'h-9 w-auto cursor-pointer pr-8', className)} {...rest}>
      {children}
    </select>
  );
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
      <span className="mb-1.5 block text-[13px] font-medium text-text">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-danger">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-xs leading-relaxed text-text-3">{hint}</span>
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
          'relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-accent' : 'bg-border-strong',
        )}
      >
        <span
          className={cn(
            'inline-block size-4 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </button>
      <label htmlFor={id} className="cursor-pointer">
        <span className="block text-sm font-medium text-text">{label}</span>
        {hint && <span className="mt-0.5 block text-xs leading-relaxed text-text-3">{hint}</span>}
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
      <svg aria-hidden viewBox="0 0 20 20" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-text-3">
        <path fill="currentColor" d="M8.5 3a5.5 5.5 0 014.38 8.83l3.65 3.64a.75.75 0 01-1.06 1.06l-3.64-3.65A5.5 5.5 0 118.5 3zm0 1.5a4 4 0 100 8 4 4 0 000-8z" />
      </svg>
      <TextInput
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="pl-8"
        aria-label={placeholder}
      />
    </div>
  );
}
