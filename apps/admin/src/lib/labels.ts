import type { AdminAiRefusalReason, AdminAiUsage, AdminRange, AiCallStatus, UsageChannel } from '@tbot/shared';
import { AI_FEATURE_LABELS, AiFeature, UsageKind } from '@tbot/shared';

/** Plain-language names for every enum the admin API returns. Raw values never reach the screen. */

export const RANGE_LABELS: Record<AdminRange, string> = {
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
};

export const RANGE_DAYS: Record<AdminRange, number> = { '7d': 7, '30d': 30, '90d': 90 };

export const CHANNEL_LABELS: Record<UsageChannel, string> = {
  telegram: 'Telegram chat',
  app: 'Mini App',
  mcp: 'MCP (AI clients)',
};

export const CHANNEL_HINTS: Record<UsageChannel, string> = {
  telegram: 'Commands, mentions and button taps in the group chat',
  app: 'Requests from the Mini App board',
  mcp: 'Tool calls from Claude, Cursor and other AI clients using an MCP token',
};

export const USAGE_KIND_LABELS: Record<UsageKind, string> = {
  [UsageKind.COMMAND]: 'Commands',
  [UsageKind.CALLBACK]: 'Button taps',
  [UsageKind.MENTION]: 'Mentions of the bot',
  [UsageKind.API]: 'Mini App requests',
  [UsageKind.MCP_TOOL]: 'MCP tool calls',
  [UsageKind.RATE_LIMITED]: 'Refused (limit)',
};

export const AI_STATUS_LABELS: Record<AiCallStatus, string> = {
  ok: 'Succeeded',
  failed: 'Failed',
  invalid: 'Unusable reply',
  quota: 'Refused (limit)',
  disabled: 'AI turned off',
};

export const AI_STATUS_HINTS: Record<AiCallStatus, string> = {
  ok: 'The model answered and the bot used the reply.',
  failed: 'The provider returned an error or timed out.',
  invalid: 'The model answered, but the reply could not be used (bad format).',
  quota: 'Not sent: a daily AI limit was reached.',
  disabled: 'Not sent: you turned AI off for this group or person.',
};

export function featureLabel(feature: string): string {
  return AI_FEATURE_LABELS[feature as AiFeature] ?? 'Other';
}

export const GROUP_BY_LABELS: Record<AdminAiUsage['groupBy'], string> = {
  day: 'Day',
  feature: 'Feature',
  model: 'Model',
  group: 'Group',
  user: 'Person',
};

export const GROUP_SORT_LABELS = {
  lastActivity: 'Last activity',
  aiCost: 'AI cost (30 days)',
  tasks: 'Tasks',
  members: 'Members',
  added: 'Recently added',
} as const;
export type GroupSort = keyof typeof GROUP_SORT_LABELS;

export const USER_SORT_LABELS = {
  lastSeen: 'Last seen',
  aiCost: 'Est. AI cost',
  aiCalls: 'AI calls',
  events: 'Activity',
  tokens: 'MCP tokens',
} as const;

/** The one hint for "Activity" everywhere. */
export const ACTIVITY_HINT = 'bot actions: commands, taps, Mini App & MCP';

/** Why an AI request was refused before reaching the model. */
export const REFUSAL_REASON_LABELS: Record<AdminAiRefusalReason, string> = {
  person_limit: 'Their daily limit',
  person_burst: 'Too many in a row',
  group_limit: 'Group limit',
  bot_limit: 'Bot-wide daily cap',
  ai_off: 'AI turned off',
};
export type UserSort = keyof typeof USER_SORT_LABELS;

export const AUDIT_TARGET_LABELS = {
  group: 'Groups',
  user: 'People',
  settings: 'Settings',
  session: 'Sign-ins',
  system: 'System',
} as const;

export { AI_FEATURE_LABELS };

// ── Groups review ──
/** One word for an AI call that reached the model but didn't work. Requests refused by a limit are not AI calls. */
export const AI_FAILED_LABEL = 'Failed';
export const AI_FAILED_HINT = 'provider error or unusable reply';
