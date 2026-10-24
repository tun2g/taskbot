import type { AdminRange, AdminUserDetail } from '@tbot/shared';

import { Cost } from '@/components/ui/cost';
import { KpiCard } from '@/components/ui/kpi';
import { formatNumber, plural } from '@/lib/format';
import { ACTIVITY_HINT, RANGE_LABELS } from '@/lib/labels';
import { scrollToSection } from '@/lib/use-scroll-to-hash';

/** A KPI that scrolls to the table explaining it, further down this page. */
function SectionLink({ id, children }: { id: string; children: string }) {
  return (
    <button type="button" onClick={() => scrollToSection(id)} className="mt-2 cursor-pointer text-[13px] text-accent-text hover:underline">
      {children}
    </button>
  );
}

/** The person's headline numbers — straight from `totals`, never re-summed from the daily series. */
export function UserKpis({ user, range }: { user: AdminUserDetail; range: AdminRange }) {
  const t = user.totals;
  const period = RANGE_LABELS[range].toLowerCase();
  const userId = user.person.id ?? '';
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <KpiCard label="Groups" value={formatNumber(user.groups)} hint="Groups where this person has used the bot." footer={<SectionLink id="groups">See the groups ↓</SectionLink>} />
      <KpiCard label="Activity" value={formatNumber(t.events)} hint={`${ACTIVITY_HINT[0]!.toUpperCase()}${ACTIVITY_HINT.slice(1)} · ${period}.`} />
      <KpiCard
        label="Est. AI cost"
        value={<Cost usd={t.aiCostUsd} unpriced={t.aiUnpriced} className="items-start" />}
        hint={`${plural(t.aiCalls, 'AI call')}${t.aiFailed ? ` (${formatNumber(t.aiFailed)} failed)` : ''}${t.aiRefused ? ` · ${formatNumber(t.aiRefused)} refused (limit)` : ''} · ${period}. Token counts × your price table.`}
        to="/ai"
        search={{ userId, range }}
        neutralDelta
      />
      <KpiCard
        label="Active MCP tokens"
        value={formatNumber(user.activeTokens)}
        hint="Tokens AI clients use to act as this person."
        footer={<SectionLink id="tokens">See the tokens ↓</SectionLink>}
      />
    </div>
  );
}
