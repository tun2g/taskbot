import type { ReactNode } from 'react';

interface CardProps {
  /** Optional header row. */
  title?: ReactNode;
  titleId?: string;
  /** Right side of the header. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Bordered surface with an optional header — detail panels, settings blocks. */
export function Card({ title, titleId, actions, className = '', children }: CardProps) {
  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={`rounded-lg border border-tg-separator bg-tg-section ${className}`}
    >
      {title && (
        <header className="flex min-h-11 items-center gap-2 border-b border-tg-separator px-4">
          <h2 id={titleId} className="flex-1 text-sm font-semibold text-tg-text">
            {title}
          </h2>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

/** Small uppercase heading for page sections ("Activity", "Source messages"). */
export function SectionHeading({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3 id={id} className="mb-2 text-xs font-medium uppercase tracking-wide text-tg-hint">
      {children}
    </h3>
  );
}
