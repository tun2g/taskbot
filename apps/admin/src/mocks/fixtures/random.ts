/** Seeded randomness and stable hashes, so the fixtures (and screenshots) are the same on every load. */

let seed = 42;
export function rand(): number {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}

export const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)]!;
export const int = (min: number, max: number) => Math.floor(min + rand() * (max - min + 1));

/** A Mongo-looking id. */
export const oid = (n: number) => `6710${String(n).padStart(20, '0')}`;

export function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Stable pseudo-random number in [0, max] for a key. */
export const noise = (key: string, max: number) => hash(key) % (max + 1);
