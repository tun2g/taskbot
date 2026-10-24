/** Display formatting. The UI never shows raw ISO timestamps, enums or ids — everything goes through here. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * $0.0120 for amounts under a dollar (always 4 decimals so a column lines up), $12.34 otherwise, $12.3K for big
 * totals in tight spots. `axis` trims trailing zeros for chart ticks.
 */
export function formatMoney(value: number | null | undefined, opts: { compact?: boolean; axis?: boolean } = {}): string {
  if (value == null || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs === 0) return '$0';
  if (abs < 0.0001) return `${sign}<$0.0001`;
  if (abs < 1) {
    const fixed = abs.toFixed(4);
    return `${sign}$${opts.axis ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed}`;
  }
  if (opts.compact && abs >= 10_000) return `${sign}$${compact(abs)}`;
  return `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function compact(abs: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(abs);
}

/** 1,234 in tables; 12.3K when `compact` (KPI cards, chart axes). */
export function formatNumber(value: number | null | undefined, opts: { compact?: boolean } = {}): string {
  if (value == null || Number.isNaN(value)) return '—';
  if (opts.compact && Math.abs(value) >= 10_000) return compact(value);
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 });
}

export function formatPercent(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

/** Change vs the previous period: "▲ 12%", "▼ 4%", "New" when there was nothing before. */
export function formatDelta(value: number, previous: number): { text: string; direction: 'up' | 'down' | 'flat' } {
  if (previous === 0 && value === 0) return { text: 'No change', direction: 'flat' };
  if (previous === 0) return { text: 'New this period', direction: 'up' };
  const change = (value - previous) / previous;
  if (Math.abs(change) < 0.005) return { text: 'No change', direction: 'flat' };
  const pct = Math.abs(change) >= 10 ? `${Math.round(Math.abs(change))}×` : `${Math.round(Math.abs(change) * 100)}%`;
  return { text: `${change > 0 ? '▲' : '▼'} ${pct}`, direction: change > 0 ? 'up' : 'down' };
}

function parse(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "24 Oct 2026" */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = parse(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** "24 Oct 2026, 14:05" */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = parse(value);
  if (Number.isNaN(d.getTime())) return '—';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${formatDate(d)}, ${hh}:${mm}`;
}

/** A UTC day "2026-10-24" → "24 Oct" (or "24 Oct 2026" with `withYear`). */
export function formatDay(day: string | null | undefined, opts: { withYear?: boolean } = {}): string {
  if (!day) return '—';
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) return day;
  return opts.withYear ? `${d} ${MONTHS[m - 1]} ${y}` : `${d} ${MONTHS[m - 1]}`;
}

/** Day of a timestamp or a "YYYY-MM-DD" string as a UTC "YYYY-MM-DD" key. */
export function dayKey(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(value).toISOString().slice(0, 10);
}

/** "just now", "5 min ago", "3 hours ago", "yesterday", "12 days ago", then the date. */
export function formatRelative(value: string | Date | null | undefined, now: Date = new Date()): string {
  if (!value) return 'Never';
  const d = parse(value);
  if (Number.isNaN(d.getTime())) return '—';
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 0) {
    const ahead = -diff;
    if (ahead < 60) return 'in a moment';
    if (ahead < 3600) return `in ${Math.round(ahead / 60)} min`;
    if (ahead < 86400) return `in ${Math.round(ahead / 3600)} hours`;
    return formatDate(d);
  }
  if (diff < 45) return 'just now';
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} min ago`;
  if (diff < 86400) {
    const h = Math.round(diff / 3600);
    return h === 1 ? '1 hour ago' : `${h} hours ago`;
  }
  const days = Math.floor(diff / 86400);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} days ago`;
  return formatDate(d);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

const DECISION_VERBS = { rejected: 'you rejected it', suspended: 'you suspended it', removed: 'you removed the bot' } as const;

/** "Asked before — you rejected it on 20 Oct 2026: “spam”" — the earlier decision about a group that asks again. */
export function previousDecisionText(d: { action: keyof typeof DECISION_VERBS; at: string; reason: string | null }): string {
  return `Asked before — ${DECISION_VERBS[d.action]} on ${formatDate(d.at)}${d.reason ? `: “${d.reason}”` : ''}`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${formatNumber(count)} ${count === 1 ? one : many}`;
}

export function personName(p: { name: string; username: string | null } | null | undefined): string {
  if (!p) return 'Unknown person';
  return p.name || (p.username ? `@${p.username}` : 'Unknown person');
}
