export const USER_SORTS = ['lastSeen', 'aiCost', 'aiCalls', 'events', 'tokens'] as const;
export type UserSort = (typeof USER_SORTS)[number];
