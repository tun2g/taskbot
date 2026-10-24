import { AsyncLocalStorage } from 'async_hooks';
import type { AiFeature, UsageChannel } from '@tbot/shared';

/** Why AI is off for this request (owner overrides in the admin app). */
export type AiDisabledBy = 'group' | 'user';

/**
 * Who / where / which feature, carried through one request without threading parameters, so AI calls
 * and usage events deep in the services are attributed correctly. Ids are Mongo ids (strings); the
 * Telegram ids are a fallback the usage recorder resolves later when the Mongo ids aren't known yet.
 */
export interface RequestContext {
  channel?: UsageChannel;
  feature?: AiFeature;
  groupId?: string | null;
  userId?: string | null;
  telegramUserId?: number | null;
  telegramChatId?: number | null;
  /** Set when the owner turned AI off for this group / person: AI calls are refused like "unavailable". */
  aiDisabledBy?: AiDisabledBy | null;
  /**
   * Shared by every nested scope of one request: the group the request turned out to be about (an MCP tool
   * only learns it after resolving its `group` argument). Read when the request's usage event is written.
   */
  resolved?: { groupId?: string | null };
}

const storage = new AsyncLocalStorage<RequestContext>();

/** The current context ({} outside any request). */
export function currentContext(): RequestContext {
  return storage.getStore() ?? {};
}

const idOf = (value: unknown): string | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return String(value);
};

export interface ContextPatch extends Omit<RequestContext, 'groupId' | 'userId'> {
  /** ObjectId or string. */
  groupId?: unknown;
  userId?: unknown;
}

/**
 * Runs `fn` with the current context plus `patch` (undefined fields keep the outer value). Nested calls
 * stack: `/ai` sets the group and person, the planner sets feature "planner", and an explanation inside the
 * same request sets "explain" only for its own call.
 */
export function withContext<T>(patch: ContextPatch, fn: () => T): T {
  const next: RequestContext = { ...currentContext() };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    (next as Record<string, unknown>)[key] = key === 'groupId' || key === 'userId' ? idOf(value) : value;
  }
  return storage.run(next, fn);
}

/** Notes the group this request is about, for the request's usage event (no-op outside a tracked request). */
export function noteGroup(groupId: unknown): void {
  const holder = storage.getStore()?.resolved;
  if (holder && groupId) holder.groupId = String(groupId);
}
