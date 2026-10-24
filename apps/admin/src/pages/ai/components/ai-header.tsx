import type { AdminRange } from '@tbot/shared';
import { Link } from '@tanstack/react-router';

import { LinkButton } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/card';
import { FilterChip } from '@/components/ui/nav';
import type { AiSearch } from '@/lib/search';

import type { AiFilters } from '../ai.content';

/** Name in a filter chip that opens the person / group it filters by. */
function ChipName({ to, id, name, range }: { to: 'person' | 'group'; id: string; name: string; range: AdminRange }) {
  const cls = 'font-medium underline-offset-2 hover:underline';
  return to === 'person' ? (
    <Link to="/users/$userId" params={{ userId: id }} search={{ range }} className={cls}>
      {name}
    </Link>
  ) : (
    <Link to="/groups/$groupId" params={{ groupId: id }} search={{ range }} className={cls}>
      {name}
    </Link>
  );
}

/** Title, the person / group filter (names link back), and "Limit or turn off AI for …" when filtered to one. */
export function AiHeader({ filters, range, onUpdate }: { filters: AiFilters; range: AdminRange; onUpdate: (patch: Partial<AiSearch>) => void }) {
  const { groupId, userId } = filters;
  const action = userId ? (
    <LinkButton to="/users/$userId" params={{ userId }} search={{ range }} hash="ai-limits" variant="secondary">
      Limit or turn off AI for {filters.userLabel} →
    </LinkButton>
  ) : groupId && !filters.groupDeleted ? (
    <LinkButton to="/groups/$groupId" params={{ groupId }} search={{ range, tab: 'settings' }} variant="secondary">
      Limit or turn off AI for {filters.groupLabel} →
    </LinkButton>
  ) : undefined;

  return (
    <PageHeader
      title="AI & cost"
      subtitle="What AI features cost and who uses them. Est. AI cost is token counts × your price table."
      actions={action}
    >
      {(groupId || userId) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-text-3">Showing only:</span>
          {groupId && (
            <FilterChip
              label={
                <>
                  Group:&nbsp;{filters.groupDeleted ? filters.groupLabel : <ChipName to="group" id={groupId} name={filters.groupLabel} range={range} />}
                </>
              }
              onRemove={() => onUpdate({ groupId: undefined })}
            />
          )}
          {userId && (
            <FilterChip
              label={
                <>
                  Person:&nbsp;<ChipName to="person" id={userId} name={filters.userLabel} range={range} />
                </>
              }
              onRemove={() => onUpdate({ userId: undefined })}
            />
          )}
        </div>
      )}
    </PageHeader>
  );
}
