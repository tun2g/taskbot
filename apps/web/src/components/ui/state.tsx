import type { ReactNode } from 'react';

interface StateMessageProps {
  icon?: string;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}

/** Centered empty / error / not-found message. */
export function StateMessage({ icon, title, body, action }: StateMessageProps) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-4xl" aria-hidden>{icon}</div>}
      <h2 className="text-base font-semibold text-tg-text">{title}</h2>
      {body && <div className="mt-2 text-sm text-tg-hint">{body}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export const buttonPrimary =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-tg-button px-4 text-sm font-semibold text-tg-button-text transition-opacity active:opacity-80 disabled:opacity-50';

export const buttonSecondary =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-tg-separator px-4 text-sm font-medium text-tg-text transition-colors active:bg-tg-secondary disabled:opacity-50';

export const buttonDanger =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-tg-destructive px-4 text-sm font-semibold text-white transition-opacity active:opacity-80 disabled:opacity-50';

/** Inline error box (server message). */
export const errorBox = 'tint-danger rounded-xl p-3 text-sm';

export const buttonLink =
  'inline-flex min-h-11 items-center justify-center px-2 text-sm font-medium text-tg-link active:opacity-70';

export const fieldLabel = 'mb-1.5 block text-xs font-medium uppercase tracking-wide text-tg-hint';

export const fieldInput =
  'min-h-11 w-full rounded-lg border border-tg-separator bg-tg-section px-3 text-sm text-tg-text outline-none placeholder:text-tg-hint focus:border-tg-link';
