import { z } from 'zod';

/**
 * Inputs hold strings; these schemas turn them into what the API takes. An empty field means "not set" (null).
 */
const blankToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : typeof v === 'string' ? Number(v.trim()) : v);

/** A whole number in [min, max], or empty → null. */
export const optionalInt = (min: number, max: number, message: string) =>
  z.preprocess(blankToNull, z.number({ message }).int({ message }).min(min, { message }).max(max, { message }).nullable());

/** A decimal number in [min, max], or empty → null. */
export const optionalNumber = (min: number, max: number, message: string) =>
  z.preprocess(blankToNull, z.number({ message }).min(min, { message }).max(max, { message }).nullable());

/** A required decimal number in [min, max]. */
export const requiredNumber = (min: number, max: number, message: string) =>
  z.preprocess(blankToNull, z.number({ message }).min(min, { message }).max(max, { message }));

/** Number (or null) → the string an input shows. */
export const toInput = (n: number | null | undefined) => (n == null ? '' : String(n));
