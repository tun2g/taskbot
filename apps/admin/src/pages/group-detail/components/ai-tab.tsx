import type { AdminGroupDetail, AdminRange } from '@tbot/shared';
import { AI_FEATURE_VALUES, AiFeature } from '@tbot/shared';

import { TextLink } from '@/components/ui/button';
import { Card, CardHeader } from '@/components/ui/card';
import { EmptyState, Notice } from '@/components/ui/states';
import { Table, Td, Th, THead, TotalRow, Tr } from '@/components/ui/table';
import { formatMoney, formatNumber, plural } from '@/lib/format';
import { AI_FAILED_HINT, AI_FAILED_LABEL, RANGE_LABELS } from '@/lib/labels';

import { GroupAiLimitText } from './group-ai-limit-text';

function asFeature(key: string): AiFeature | undefined {
  return (AI_FEATURE_VALUES as string[]).includes(key) ? (key as AiFeature) : undefined;
}

export function AiTab({
  group,
  range,
  globalLimit,
  onOpenFeature,
}: {
  group: AdminGroupDetail;
  range: AdminRange;
  /** Global daily call limit from Settings (null = none; undefined = still loading). */
  globalLimit: number | null | undefined;
  onOpenFeature: (feature: AiFeature) => void;
}) {
  const rows = group.aiByFeature;
  const total = rows.reduce(
    (s, r) => ({
      calls: s.calls + r.calls,
      failed: s.failed + r.failed,
      inputTokens: s.inputTokens + r.inputTokens,
      outputTokens: s.outputTokens + r.outputTokens,
      costUsd: s.costUsd + r.costUsd,
      unpriced: s.unpriced + r.unpriced,
    }),
    { calls: 0, failed: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, unpriced: 0 },
  );
  const rangeText = RANGE_LABELS[range].toLowerCase();

  return (
    <div className="space-y-4">
      {total.unpriced > 0 && (
        <Notice
          tone="warn"
          action={
            <TextLink to="/settings" className="text-sm">
              Add a price →
            </TextLink>
          }
        >
          {plural(total.unpriced, 'call')} used a model with no price in your price table, so their cost counts as $0.
          The cost shown is a lower bound — add a price in Settings.
        </Notice>
      )}

      <Card>
        <CardHeader
          title="AI by feature"
          subtitle={
            <>
              AI calls from this group in the {rangeText}. Cost is estimated from token counts × your price table. Click
              a row to see its calls.
            </>
          }
          action={<GroupAiLimitText group={group} globalLimit={globalLimit} />}
        />
        {rows.length === 0 ? (
          <EmptyState
            title={group.aiDisabled ? 'AI is turned off for this group.' : 'No AI calls from this group in this period.'}
            body={
              group.aiDisabled
                ? 'Turn it back on in the Settings tab.'
                : 'AI calls happen when people use /ai, “Explain”, “Create tasks from messages” or “Split into subtasks”.'
            }
          />
        ) : (
          <Table>
            <THead>
              <Th>Feature</Th>
              <Th align="right">Calls</Th>
              <Th align="right" hint={AI_FAILED_HINT}>
                {AI_FAILED_LABEL}
              </Th>
              <Th align="right" hint="sent to the model">
                Input tokens
              </Th>
              <Th align="right" hint="written by the model">
                Output tokens
              </Th>
              <Th align="right" hint="estimated">
                Cost
              </Th>
            </THead>
            <tbody>
              {rows.map((r) => {
                const feature = asFeature(r.key);
                return (
                  <Tr key={r.key} onOpen={feature ? () => onOpenFeature(feature) : undefined}>
                    <Td>
                      <span className="text-text">{r.label}</span>
                      {r.unpriced > 0 && (
                        <span className="block text-[13px] text-warn">{plural(r.unpriced, 'unpriced call')}</span>
                      )}
                    </Td>
                    <Td align="right">{formatNumber(r.calls)}</Td>
                    <Td align="right">
                      <span className={r.failed > 0 ? 'text-text' : 'text-text-3'}>{formatNumber(r.failed)}</span>
                    </Td>
                    <Td align="right">{formatNumber(r.inputTokens, { compact: true })}</Td>
                    <Td align="right">{formatNumber(r.outputTokens, { compact: true })}</Td>
                    <Td align="right">
                      {formatMoney(r.costUsd)}
                      {r.unpriced > 0 && <span className="text-warn">+</span>}
                    </Td>
                  </Tr>
                );
              })}
              <TotalRow>
                <Td>Total</Td>
                <Td align="right">{formatNumber(total.calls)}</Td>
                <Td align="right">{formatNumber(total.failed)}</Td>
                <Td align="right">{formatNumber(total.inputTokens, { compact: true })}</Td>
                <Td align="right">{formatNumber(total.outputTokens, { compact: true })}</Td>
                <Td align="right" stop>
                  <TextLink to="/ai" search={{ groupId: group.id, range }}>
                    {formatMoney(total.costUsd)}
                    {total.unpriced > 0 && '+'}
                  </TextLink>
                </Td>
              </TotalRow>
            </tbody>
          </Table>
        )}
        {(group.aiRefused ?? 0) > 0 && (
          <p className="border-t border-border px-5 py-3 text-sm text-text-2">
            {plural(group.aiRefused ?? 0, 'request was', 'requests were')} refused by a daily limit or because AI is
            turned off. They never reached the model, so they aren’t AI calls and cost nothing.{' '}
            <TextLink to="/ai" search={{ groupId: group.id, range, status: 'quota' }}>
              See them →
            </TextLink>
          </p>
        )}
        <div className="border-t border-border px-5 py-3 text-sm">
          <TextLink to="/ai" search={{ groupId: group.id, range }}>
            See every AI call from this group →
          </TextLink>
        </div>
      </Card>
    </div>
  );
}
