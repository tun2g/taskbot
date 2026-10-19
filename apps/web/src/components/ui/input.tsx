import { type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react';

const control =
  'w-full rounded-lg border border-tg-separator bg-tg-section px-3 text-sm text-tg-text outline-none transition-colors duration-150 placeholder:text-tg-hint hover:border-tg-hint/60 focus:border-tg-link disabled:opacity-60 aria-[invalid=true]:border-tg-destructive';

export const inputClass = `${control} min-h-11`;

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputClass} ${className}`} {...rest} />;
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${control} resize-y py-2.5 leading-relaxed ${className}`} {...rest} />;
}

export const fieldLabelClass = 'mb-1.5 block text-xs font-medium uppercase tracking-wide text-tg-hint';

interface FieldProps {
  label: ReactNode;
  /** id of the control, so the label focuses / names it. */
  htmlFor?: string;
  required?: boolean;
  /** Muted help text under the control. */
  hint?: ReactNode;
  /** Error under the control (replaces the hint). */
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Label + control + hint/error, for forms. */
export function FormField({ label, htmlFor, required, hint, error, className = '', children }: FieldProps) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className={fieldLabelClass}>
        {label}
        {required && (
          <span className="text-tg-destructive" aria-hidden>
            {' '}
            *
          </span>
        )}
      </label>
      {children}
      {error ? (
        <p role="alert" className="mt-1 text-xs text-tg-destructive">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1 text-xs text-tg-hint">{hint}</p>
      )}
    </div>
  );
}

/** Inline error box (server message). */
export function ErrorBox({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={`tint-danger rounded-xl p-3 text-sm [overflow-wrap:anywhere] ${className}`}>
      {children}
    </p>
  );
}
