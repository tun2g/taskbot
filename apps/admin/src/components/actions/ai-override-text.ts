import { AI_DEFAULT_GROUP_BURST } from '@tbot/shared';

/**
 * Which limit wins — what the bot actually does (apps/bot ai-quota.ts, task-creation.service.ts, ai.service.ts):
 * every AI request is checked against the person's daily limit, the group's limit and the bot-wide daily cap,
 * and is refused as soon as any one of them has run out. So in effect the lowest one applies.
 */
export const WHICH_LIMIT_WINS: Record<'group' | 'person', string> = {
  person:
    'Your limit replaces the per-person default from Settings — it can be higher or lower. The group’s limit and the bot-wide daily cap still apply too: whichever runs out first refuses the request, so in effect the lowest one wins.',
  group: `A group limit replaces the default of ${AI_DEFAULT_GROUP_BURST.limit} requests per ${AI_DEFAULT_GROUP_BURST.windowMinutes} minutes with this many per day (UTC). Each person’s own daily limit and the bot-wide daily cap still apply too: whichever runs out first refuses the request, so in effect the lowest one wins.`,
};

export const TURN_OFF_HINT: Record<'group' | 'person', string> = {
  group:
    'The /ai assistant, “Explain”, “Create tasks from messages” and “Split into subtasks” stop working in this group. Everything else keeps working.',
  person: 'This person can’t use AI features in any group. Everything else keeps working.',
};

export const LIMIT_ERROR = 'Enter a whole number from 1 to 100,000, or leave it empty for the default. To stop AI completely, use the switch above.';
