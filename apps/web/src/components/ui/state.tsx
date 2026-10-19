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
      {icon && (
        <div className="mb-3 text-4xl" aria-hidden>
          {icon}
        </div>
      )}
      <h2 className="text-base font-semibold text-tg-text">{title}</h2>
      {body && <div className="mt-2 text-sm text-tg-hint">{body}</div>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
