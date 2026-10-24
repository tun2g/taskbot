import { parseSearchWith, stringifySearchWith } from '@tanstack/react-router';

/**
 * JSON.parse, except for values it would change: an id such as "671000000000000000000100" (all digits) or
 * "6710e5…" parses as a number and loses digits, so `?userId=` silently pointed at nobody. Throwing keeps the
 * raw string (the router catches it), and links built by the app keep such ids unquoted.
 */
function parseLossless(value: string): unknown {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed === 'number' && String(parsed) !== value) throw new Error('keep as text');
  return parsed;
}

export const parseSearch = parseSearchWith(parseLossless);
export const stringifySearch = stringifySearchWith(JSON.stringify, parseLossless);
