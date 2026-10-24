// Owner decisions (approve / reject / suspend) live in @tbot/db so the bot and the admin API apply them the same way.
export { decideGroup, GROUP_TRANSITIONS } from '@tbot/db';
export type { GroupDecision, GroupDecisionResult } from '@tbot/db';
