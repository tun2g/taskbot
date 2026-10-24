export const GROUP_BY = ['day', 'feature', 'model', 'group', 'user'] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export const REFUSED_BY = ['person', 'group'] as const;
export type RefusedBy = (typeof REFUSED_BY)[number];

export const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(String(value)) ? (value as T) : fallback;
