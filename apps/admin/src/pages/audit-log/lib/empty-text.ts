import type { AuditTarget } from '@/lib/search';

const EMPTY_BY_TARGET: Record<AuditTarget, { title: string; body: string }> = {
  group: {
    title: 'No changes to groups yet',
    body: 'Approvals, rejections, suspensions and AI limits for groups show up here.',
  },
  user: { title: 'No changes to people yet', body: 'AI limits and revoked MCP tokens for people show up here.' },
  settings: {
    title: 'No changes to Settings yet',
    body: 'Every save of the AI settings shows up here, with the old and new values.',
  },
  session: {
    title: 'No sign-ins recorded yet',
    body: 'Each sign-in and sign-out of the admin app shows up here, with the browser and address.',
  },
  system: {
    title: 'No jobs started by hand yet',
    body: 'When you press “Run now” on the System page, it shows up here.',
  },
};

/** The empty state for the current filter — it names the filter, so "nothing" isn't mistaken for "broken". */
export function auditEmptyText(
  targetType: AuditTarget | undefined,
  targetName: string | undefined,
  hasTargetId: boolean,
) {
  if (hasTargetId) {
    const name = targetName ? `“${targetName}”` : 'this item';
    return { title: `Nothing recorded for ${name} yet`, body: 'Changes you make to it show up here.' };
  }
  if (targetType) return EMPTY_BY_TARGET[targetType];
  return {
    title: 'You haven’t changed anything yet',
    body: 'When you approve a group, change an AI limit or update settings, it’s recorded here.',
  };
}
