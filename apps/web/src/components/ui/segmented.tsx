import type { ReactNode } from 'react';

interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

/** iOS/Telegram-style segmented control (radiogroup). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`flex shrink-0 rounded-lg bg-tg-secondary p-0.5 ${className}`}
    >
      {options.map((o) => {
        const selected = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            className={`focus-ring min-h-10 whitespace-nowrap rounded-md px-3 text-sm font-medium transition-colors duration-150 sm:min-h-8 ${
              selected ? 'bg-tg-section text-tg-text shadow-sm' : 'text-tg-hint hover:text-tg-text'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
