import type { ReactNode } from 'react';

/** The column name, shown inside a cell only on phones (where a STACK_ON_MOBILE table hides its header). */
export function StackLabel({ children }: { children: ReactNode }) {
  return <span className="text-[13px] font-medium text-text-3 sm:hidden">{children}</span>;
}
