import type { ReactNode } from 'react';

interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
  className?: string;
}

/** Checkbox with its label; the whole row is a 44px target. */
export function Checkbox({ checked, onChange, children, className = '' }: CheckboxProps) {
  return (
    <label className={`flex min-h-11 cursor-pointer select-none items-center gap-2 text-sm text-tg-text ${className}`}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-[18px] w-[18px] shrink-0 cursor-pointer accent-[var(--tg-theme-button-color)]"
      />
      {children}
    </label>
  );
}
