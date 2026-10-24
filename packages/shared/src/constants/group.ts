/**
 * Where a group stands with the bot. Only ACTIVE groups get service (bot replies, Mini App, MCP, jobs).
 * New groups start PENDING until the bot owner approves them in the admin app (or from the owner's DM).
 */
export enum GroupStatus {
  /** Bot was added; waiting for the bot owner to approve. */
  PENDING = 'pending',
  ACTIVE = 'active',
  /** The owner declined the request; the bot left. Re-adding the bot asks again. */
  REJECTED = 'rejected',
  /** The owner paused service; data is kept and service resumes on unsuspend. */
  SUSPENDED = 'suspended',
  /** The bot was removed from (or left) the chat. Re-adding it restores an approval / suspension; otherwise it asks again. */
  LEFT = 'left',
  /** The basic group became a supergroup; its data moved to the new chat id. */
  MIGRATED = 'migrated',
}

export const GROUP_STATUS_VALUES = Object.values(GroupStatus) as [GroupStatus, ...GroupStatus[]];

/** Plain-language labels for the admin app. */
export const GROUP_STATUS_LABELS: Record<GroupStatus, string> = {
  [GroupStatus.PENDING]: 'Waiting for approval',
  [GroupStatus.ACTIVE]: 'Active',
  [GroupStatus.REJECTED]: 'Rejected',
  [GroupStatus.SUSPENDED]: 'Suspended',
  [GroupStatus.LEFT]: 'Bot removed',
  [GroupStatus.MIGRATED]: 'Moved to supergroup',
};

/** What each status means for the people in the group (admin app hints). */
export const GROUP_STATUS_HINTS: Record<GroupStatus, string> = {
  [GroupStatus.PENDING]: 'The bot was added but does nothing until you approve the group.',
  [GroupStatus.ACTIVE]: 'The bot, Mini App and MCP work normally.',
  [GroupStatus.REJECTED]: 'You declined this group and the bot left. If someone adds it again, it asks you again.',
  [GroupStatus.SUSPENDED]: 'Service is paused. Tasks are kept; unsuspend to resume.',
  [GroupStatus.LEFT]: 'The bot is no longer in the chat — someone removed it, or you used “Leave chat”. Tasks are kept.',
  [GroupStatus.MIGRATED]: 'Telegram upgraded this chat to a supergroup; its tasks moved to the new group.',
};

/** Usage-event kinds recorded for stats. */
export enum UsageKind {
  COMMAND = 'command',
  CALLBACK = 'callback',
  MENTION = 'mention',
  API = 'api',
  MCP_TOOL = 'mcp_tool',
  RATE_LIMITED = 'rate_limited',
}

export const USAGE_KIND_VALUES = Object.values(UsageKind) as [UsageKind, ...UsageKind[]];

/** Where a request came from. */
export type UsageChannel = 'telegram' | 'app' | 'mcp';
export const USAGE_CHANNEL_VALUES = ['telegram', 'app', 'mcp'] as const;

/** Which product feature made an AI call. */
export enum AiFeature {
  PLANNER = 'planner',
  EXPLAIN = 'explain',
  EXTRACT = 'extract',
  BREAKDOWN = 'breakdown',
  OTHER = 'other',
}

export const AI_FEATURE_VALUES = Object.values(AiFeature) as [AiFeature, ...AiFeature[]];

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  [AiFeature.PLANNER]: '/ai assistant (understanding the request)',
  [AiFeature.EXPLAIN]: 'Explain a task',
  [AiFeature.EXTRACT]: 'Create tasks from messages',
  [AiFeature.BREAKDOWN]: 'Split into subtasks',
  [AiFeature.OTHER]: 'Other',
};

/** quota = refused by a daily limit; disabled = refused because the owner turned AI off (both: no tokens, no cost). */
export type AiCallStatus = 'ok' | 'failed' | 'invalid' | 'quota' | 'disabled';
export const AI_CALL_STATUS_VALUES = ['ok', 'failed', 'invalid', 'quota', 'disabled'] as const;
