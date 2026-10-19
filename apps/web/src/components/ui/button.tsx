import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'link';
export type ButtonSize = 'md' | 'sm' | 'icon' | 'fab';

const base =
  'focus-ring inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,opacity,color,transform] duration-150 disabled:pointer-events-none disabled:opacity-50';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-tg-button font-semibold text-tg-button-text hover:opacity-90 active:opacity-80',
  secondary: 'border border-tg-separator text-tg-text hover:bg-tg-secondary active:bg-tg-secondary',
  danger: 'bg-tg-destructive font-semibold text-white hover:opacity-90 active:opacity-80',
  // Inherits the text color, so callers can tint it (e.g. text-tg-destructive).
  ghost: 'hover:bg-tg-secondary active:bg-tg-secondary',
  link: 'text-tg-link hover:underline active:opacity-70',
};

/** Every size keeps a 44px touch target on phones; `sm` shrinks to 36px from 640px up. */
const sizes: Record<ButtonSize, string> = {
  md: 'min-h-11 rounded-xl px-4 text-sm',
  sm: 'min-h-11 rounded-lg px-3 text-sm sm:min-h-9',
  icon: 'h-11 w-11 rounded-full text-lg',
  fab: 'h-14 w-14 rounded-full text-3xl font-normal shadow-lg active:scale-95',
};

export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className = ''): string {
  const pad =
    variant === 'link' && (size === 'md' || size === 'sm') ? sizes[size].replace(/px-\d/, 'px-2') : sizes[size];
  return `${base} ${variants[variant]} ${pad} ${className}`;
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Disables the button and shows this text instead of the children. */
  loading?: boolean;
  loadingText?: ReactNode;
  icon?: ReactNode;
}

/** Shared button. Defaults to type="button" so it never submits a form by accident. */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  loadingText,
  icon,
  className = '',
  type = 'button',
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass(variant, size, className)}
      {...rest}
    >
      {icon && <span aria-hidden>{icon}</span>}
      {loading && loadingText ? loadingText : children}
    </button>
  );
}
