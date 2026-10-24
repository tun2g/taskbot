import type { UsageChannel, UsageKind } from '@tbot/shared';
import mongoose from 'mongoose';
import { Group } from 'src/database/models/group.model';
import { UsageEvent } from 'src/database/models/usage-event.model';
import { User } from 'src/database/models/user.model';
import logger from 'src/shared/logger/logger';
import { redisService } from 'src/shared/services/redis.service';
import { currentContext } from 'src/shared/services/telemetry/request-context';

/**
 * Telemetry switch. Off under Jest so unrelated tests never touch Mongo/Redis through it; telemetry
 * tests turn it on and mock the models.
 */
export const telemetry = { enabled: process.env.NODE_ENV !== 'test' };

const FLUSH_DELAY_MS = 5000;
const FLUSH_BATCH = 200;
const MAX_BUFFER = 5000;
const ID_CACHE_MAX = 5000;
/** user.lastSeenAt / group.lastActivityAt are written at most this often per user / group. */
export const LAST_SEEN_THROTTLE_SECONDS = 5 * 60;

export interface UsageInput {
  kind: UsageKind;
  /** Command ("task"), callback family ("task:status_done"), tool ("list_tasks"), route ("GET /groups/:groupId/tasks")… */
  name: string;
  channel?: UsageChannel;
  ok?: boolean;
  latencyMs?: number | null;
  client?: string | null;
  /** Mongo ids (ObjectId or string). Default: the request context. */
  groupId?: unknown;
  userId?: unknown;
  /** Used when the Mongo ids aren't known: resolved to Mongo ids when the batch is written. */
  telegramUserId?: number | null;
  telegramChatId?: number | null;
}

interface PendingEvent {
  createdAt: Date;
  kind: UsageKind;
  name: string;
  channel: UsageChannel;
  ok: boolean;
  latencyMs: number | null;
  client: string | null;
  groupId: string | null;
  userId: string | null;
  telegramUserId: number | null;
  telegramChatId: number | null;
}

let buffer: PendingEvent[] = [];
let timer: NodeJS.Timeout | null = null;
const userIdCache = new Map<number, string>();
const groupIdCache = new Map<number, string>();

const validId = (value: unknown): string | null => {
  if (value === undefined || value === null) return null;
  const id = String(value);
  return mongoose.Types.ObjectId.isValid(id) ? id : null;
};

/** Records one usage event (fire-and-forget, batched). Never throws. */
export function recordUsage(input: UsageInput): void {
  if (!telemetry.enabled) return;
  try {
    const ctx = currentContext();
    const event: PendingEvent = {
      createdAt: new Date(),
      kind: input.kind,
      name: (input.name || 'unknown').slice(0, 120),
      channel: input.channel ?? ctx.channel ?? 'telegram',
      ok: input.ok ?? true,
      latencyMs: input.latencyMs ?? null,
      client: input.client ? input.client.slice(0, 80) : null,
      groupId: validId(input.groupId !== undefined ? input.groupId : ctx.groupId),
      userId: validId(input.userId !== undefined ? input.userId : ctx.userId),
      telegramUserId: input.telegramUserId ?? ctx.telegramUserId ?? null,
      telegramChatId: input.telegramChatId ?? ctx.telegramChatId ?? null,
    };
    buffer.push(event);
    if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
    if (buffer.length >= FLUSH_BATCH) void flushUsage();
    else if (!timer) {
      timer = setTimeout(() => void flushUsage(), FLUSH_DELAY_MS);
      timer.unref?.();
    }
  } catch (error) {
    logger.warn(`[Usage] Could not record ${input.kind} ${input.name}: ${error}`);
  }
}

function remember(cache: Map<number, string>, key: number, id: string) {
  if (cache.size >= ID_CACHE_MAX) cache.clear();
  cache.set(key, id);
}

/** Fills Mongo ids from Telegram ids (one query per kind for the whole batch). */
async function resolveIds(events: PendingEvent[]): Promise<void> {
  const tgUsers = new Set<number>();
  const tgChats = new Set<number>();
  for (const e of events) {
    if (!e.userId && e.telegramUserId && !userIdCache.has(e.telegramUserId)) tgUsers.add(e.telegramUserId);
    // Only group chats (negative ids) are workspaces; a private chat has no group.
    if (!e.groupId && e.telegramChatId && e.telegramChatId < 0 && !groupIdCache.has(e.telegramChatId)) tgChats.add(e.telegramChatId);
  }
  if (tgUsers.size) {
    const users = await User.find({ telegramUserId: { $in: [...tgUsers] } }, { _id: 1, telegramUserId: 1 }).lean();
    for (const u of users as { _id: unknown; telegramUserId: number }[]) remember(userIdCache, u.telegramUserId, String(u._id));
  }
  if (tgChats.size) {
    const groups = await Group.find({ telegramGroupId: { $in: [...tgChats] } }, { _id: 1, telegramGroupId: 1 }).lean();
    for (const g of groups as { _id: unknown; telegramGroupId: number }[]) remember(groupIdCache, g.telegramGroupId, String(g._id));
  }
  for (const e of events) {
    if (!e.userId && e.telegramUserId) e.userId = userIdCache.get(e.telegramUserId) ?? null;
    if (!e.groupId && e.telegramChatId) e.groupId = groupIdCache.get(e.telegramChatId) ?? null;
  }
}

/** Writes the buffered events. Called by the timer, on a full batch, and on shutdown. */
export async function flushUsage(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!buffer.length) return;
  const events = buffer;
  buffer = [];
  try {
    await resolveIds(events);
  } catch (error) {
    logger.warn(`[Usage] Could not resolve ids: ${error}`);
  }
  try {
    await UsageEvent.insertMany(
      events.map(({ telegramUserId: _u, telegramChatId: _c, ...doc }) => doc),
      { ordered: false },
    );
  } catch (error) {
    logger.warn(`[Usage] Could not write ${events.length} usage events: ${error}`);
  }
}

/** Test helper: what is waiting to be written. */
export function pendingUsage(): readonly PendingEvent[] {
  return buffer;
}

/** Test helper. */
export function resetUsageTracker(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  buffer = [];
  userIdCache.clear();
  groupIdCache.clear();
}

async function claim(key: string): Promise<boolean> {
  const result = await redisService.set(key, '1', { NX: true, EX: LAST_SEEN_THROTTLE_SECONDS });
  return result === 'OK';
}

export interface SeenInput {
  userId?: unknown;
  telegramUserId?: number | null;
  groupId?: unknown;
  telegramChatId?: number | null;
}

/**
 * user.lastSeenAt (and the group's lastActivityAt) — written at most once per LAST_SEEN_THROTTLE_SECONDS per
 * user / group (Redis NX key), from bot updates, the Mini App API and MCP. Fire-and-forget, never throws.
 */
export function touchLastSeen(input: SeenInput): void {
  if (!telemetry.enabled) return;
  void (async () => {
    const now = new Date();
    const userId = validId(input.userId);
    if (userId || input.telegramUserId) {
      const key = userId ? `lastseen:u:${userId}` : `lastseen:tu:${input.telegramUserId}`;
      if (await claim(key)) {
        await User.updateOne(userId ? { _id: userId } : { telegramUserId: input.telegramUserId }, { $set: { lastSeenAt: now } });
      }
    }
    const groupId = validId(input.groupId);
    const chatId = input.telegramChatId && input.telegramChatId < 0 ? input.telegramChatId : null;
    if (groupId || chatId) {
      const key = groupId ? `lastseen:g:${groupId}` : `lastseen:tg:${chatId}`;
      if (await claim(key)) {
        await Group.updateOne(groupId ? { _id: groupId } : { telegramGroupId: chatId }, { $set: { lastActivityAt: now } });
      }
    }
  })().catch((error) => logger.warn(`[Usage] Could not update last seen: ${error}`));
}
