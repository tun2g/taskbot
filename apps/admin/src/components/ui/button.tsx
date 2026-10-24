import { createLink } from '@tanstack/react-router';
import { type AnchorHTMLAttributes, type ButtonHTMLAttributes, forwardRef } from 'react';

import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-outline';
export type ButtonSize = 'sm' | 'md';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover border border-transparent',
  secondary: 'bg-surface text-text border border-border-strong hover:bg-surface-2',
  ghost: 'bg-transparent text-text-2 border border-transparent hover:bg-surface-2 hover:text-text',
  danger: 'bg-danger text-white hover:bg-danger-hover border border-transparent',
  'danger-outline': 'bg-surface text-danger border border-border-strong hover:bg-danger-soft hover:border-danger',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-[15px] gap-2 rounded-xl',
};

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', extra?: string) {
  return cn(
    'inline-flex items-center justify-center font-medium whitespace-nowrap transition-colors select-none',
    'disabled:opacity-50 disabled:pointer-events-none cursor-pointer',
    VARIANTS[variant],
    SIZES[size],
    extra,
  );
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} disabled={disabled || loading} {...rest}>
      {loading && <Spinner />}
      {children}
    </button>
  );
});

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent', className)}
    />
  );
}

interface LinkButtonBaseProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const LinkButtonBase = forwardRef<HTMLAnchorElement, LinkButtonBaseProps>(function LinkButtonBase(
  { variant = 'secondary', size = 'md', className, ...rest },
  ref,
) {
  return <a ref={ref} className={buttonClass(variant, size, className)} {...rest} />;
});

/** A router link that looks like a button. */
export const LinkButton = createLink(LinkButtonBase);

const TextLinkBase = forwardRef<HTMLAnchorElement, AnchorHTMLAttributes<HTMLAnchorElement>>(function TextLinkBase(
  { className, ...rest },
  ref,
) {
  return (
    <a
      ref={ref}
      className={cn('text-accent-text underline-offset-2 hover:underline decoration-1 cursor-pointer', className)}
      {...rest}
    />
  );
});

/** A router link styled as an inline text link (used for drill-downs on numbers). */
export const TextLink = createLink(TextLinkBase);
