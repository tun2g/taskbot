import type { AiChatTurn } from '@tbot/shared';
import { randomBytes } from 'crypto';
import logger from 'src/shared/logger/logger';
import { redisService } from 'src/shared/services/redis.service';

// ask_taskbot conversations: kept server-side (the caller only holds the id), per user, for an hour.

const PREFIX = 'mcp_conv';
export const CONVERSATION_TTL_SECONDS = 60 * 60;
/** Stored turns (user + assistant entries); the planner itself only reads the last few. */
export const CONVERSATION_MAX_TURNS = 20;
const ID_FORMAT = /^[A-Za-z0-9_-]{8,64}$/;

export interface Conversation {
  groupId: string;
  history: AiChatTurn[];
}

const key = (userId: string, conversationId: string) => `${PREFIX}:${userId}:${conversationId}`;

export function newConversationId(): string {
  return randomBytes(12).toString('base64url');
}

export function isConversationId(value: string): boolean {
  return ID_FORMAT.test(value);
}

/** The stored conversation, or null when unknown / expired / unreadable. */
export async function loadConversation(userId: string, conversationId: string): Promise<Conversation | null> {
  if (!isConversationId(conversationId)) return null;
  try {
    const raw = await redisService.get(key(userId, conversationId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Conversation;
    return parsed && typeof parsed.groupId === 'string' && Array.isArray(parsed.history) ? parsed : null;
  } catch (error) {
    logger.warn(`Could not load MCP conversation ${conversationId}: ${error}`);
    return null;
  }
}

/** Appends one exchange (capped to the last CONVERSATION_MAX_TURNS) and refreshes the TTL. Never throws. */
export async function saveConversation(
  userId: string,
  conversationId: string,
  conversation: Conversation,
  exchange: { user: string; assistant: string },
): Promise<void> {
  const history: AiChatTurn[] = [
    ...conversation.history,
    { role: 'user' as const, content: exchange.user.slice(0, 4000) },
    { role: 'assistant' as const, content: exchange.assistant.slice(0, 4000) },
  ].slice(-CONVERSATION_MAX_TURNS);
  try {
    await redisService.set(key(userId, conversationId), JSON.stringify({ groupId: conversation.groupId, history }), {
      EX: CONVERSATION_TTL_SECONDS,
    });
  } catch (error) {
    logger.warn(`Could not save MCP conversation ${conversationId}: ${error}`);
  }
}
