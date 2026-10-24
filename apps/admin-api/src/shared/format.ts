/** A date as an ISO string for the API, or null when unset. */
export const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
