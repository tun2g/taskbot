/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A tiny in-memory evaluator for the $match + $group pipelines the stats queries use, so tests can check that
 * the numbers the API returns add up (rows vs totals) against one set of raw documents.
 */

const same = (a: unknown, b: unknown) => (a == null && b == null) || (a != null && b != null && String(a) === String(b));

function evalExpr(e: any, r: any): any {
  if (typeof e === 'string') return e.startsWith('$') ? r[e.slice(1)] : e;
  if (e === null || typeof e !== 'object') return e;
  if (Array.isArray(e)) return e;
  if (e.$dateToString) return (evalExpr(e.$dateToString.date, r) as Date).toISOString().slice(0, 10);
  if (e.$cond) return evalExpr(e.$cond[0], r) ? evalExpr(e.$cond[1], r) : evalExpr(e.$cond[2], r);
  if (e.$in) return (e.$in[1] as unknown[]).some((v) => same(v, evalExpr(e.$in[0], r)));
  if (e.$or) return (e.$or as any[]).some((x) => !!evalExpr(x, r));
  return Object.fromEntries(Object.entries(e).map(([k, v]) => [k, evalExpr(v, r)]));
}

function check(value: unknown, cond: any): boolean {
  if (cond === null || typeof cond !== 'object' || cond instanceof Date || !Object.keys(cond).some((k) => k.startsWith('$'))) return same(value, cond);
  return Object.entries(cond).every(([op, arg]: [string, any]) => {
    if (op === '$in') return (arg as unknown[]).some((v) => same(v, value));
    if (op === '$ne') return !same(value, arg);
    if (op === '$gte') return value != null && (value as any) >= arg;
    if (op === '$gt') return value != null && (value as any) > arg;
    if (op === '$lt') return value != null && (value as any) < arg;
    if (op === '$lte') return value != null && (value as any) <= arg;
    throw new Error(`fake-aggregate: unsupported ${op}`);
  });
}

export function matches(r: any, m: Record<string, any>): boolean {
  return Object.entries(m).every(([k, cond]) => {
    if (k === '$or') return (cond as any[]).some((c) => matches(r, c));
    if (k === '$and') return (cond as any[]).every((c) => matches(r, c));
    return check(r[k], cond);
  });
}

export function aggregate(rows: any[], pipeline: any[]): any[] {
  let out = rows;
  for (const stage of pipeline) {
    if (stage.$match) out = out.filter((r) => matches(r, stage.$match));
    else if (stage.$group) {
      const { _id, ...acc } = stage.$group;
      const groups = new Map<string, any>();
      for (const r of out) {
        const id = evalExpr(_id, r);
        const key = JSON.stringify(id ?? null);
        const g = groups.get(key) ?? { _id: id ?? null, ...Object.fromEntries(Object.keys(acc).map((k) => [k, 0])) };
        for (const [k, spec] of Object.entries(acc) as [string, any][]) g[k] += Number(evalExpr(spec.$sum, r) ?? 0);
        groups.set(key, g);
      }
      out = [...groups.values()];
    }
  }
  return out;
}
