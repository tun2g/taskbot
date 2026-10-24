import type { AdminAiCallRow } from '@tbot/shared';
import { countCalls, findCallsPage } from 'src/modules/ai/ai.repository';
import { callRow } from 'src/modules/ai/helpers/call-row';
import type { Pagination } from 'src/shared/http';
import { loadGroupRefs, loadPersonRefs } from 'src/shared/refs';

/** One page of calls, newest first, with their group and person. */
export async function callRows(filter: Record<string, unknown>, p: Pagination): Promise<{ rows: AdminAiCallRow[]; total: number }> {
  const [total, calls] = await Promise.all([countCalls(filter), findCallsPage(filter, p)]);
  const [groups, people] = await Promise.all([loadGroupRefs(calls.map((c) => c.groupId)), loadPersonRefs(calls.map((c) => c.userId))]);
  const rows = calls.map((c) => callRow(c, groups, people));
  return { rows, total };
}
