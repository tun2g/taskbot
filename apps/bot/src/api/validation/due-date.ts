const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_PREFIX = /^(\d{4}-\d{2}-\d{2})T/;

/**
 * A due date is a calendar day. Accepts `YYYY-MM-DD` (preferred) or, for backward compatibility,
 * a full ISO datetime truncated to its date part. Returns a Date at 00:00:00Z of that day, or null if invalid.
 */
export function parseDueDate(value: string): Date | null {
  if (typeof value !== 'string') return null;
  let day = value.trim();
  const prefix = day.match(DATE_PREFIX);
  if (prefix) {
    if (Number.isNaN(Date.parse(day))) return null;
    day = prefix[1];
  }
  const m = day.match(DATE_ONLY);
  if (!m) return null;
  const date = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Reject rollovers such as 2026-02-31
  if (date.getUTCFullYear() !== +m[1] || date.getUTCMonth() + 1 !== +m[2] || date.getUTCDate() !== +m[3]) return null;
  return date;
}

/** `YYYY-MM-DD` of a stored due date (always read in UTC so it never shifts a day). */
export function formatDueDate(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
