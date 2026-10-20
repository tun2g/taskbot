import logger from 'src/shared/logger/logger';
import { redisService } from 'src/shared/services/redis.service';

// The server is stateless (one McpServer per HTTP request), so the client's name from `initialize`
// is remembered per token in Redis and reused for "(via Claude Code)" on later calls.

const CLIENT_KEY_PREFIX = 'mcp_client';
const CLIENT_TTL_SECONDS = 30 * 24 * 60 * 60;
export const DEFAULT_CLIENT_LABEL = 'MCP';

const KNOWN_CLIENTS: [RegExp, string][] = [
  [/claude[\s_-]*code/i, 'Claude Code'],
  [/claude/i, 'Claude'],
  [/cursor/i, 'Cursor'],
  [/windsurf|codeium/i, 'Windsurf'],
  [/vs\s*code|visual studio code|copilot/i, 'VS Code'],
  [/zed/i, 'Zed'],
];

/**
 * "(via …)" label for an MCP client name: well-known clients get their product name ("claude-code" →
 * "Claude Code"); anything else is kept but reduced to letters, digits, spaces, dots and dashes (it ends up in
 * Telegram Markdown/HTML), max 30 characters. Empty → "MCP".
 */
export function clientLabel(name: string | null | undefined): string {
  const raw = (name ?? '').trim();
  if (!raw) return DEFAULT_CLIENT_LABEL;
  for (const [pattern, label] of KNOWN_CLIENTS) if (pattern.test(raw)) return label;
  const cleaned = raw
    .replace(/[^\p{L}\p{N} .-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30)
    .trim();
  return cleaned || DEFAULT_CLIENT_LABEL;
}

/** The client name in a JSON-RPC `initialize` request body (single or batch), if any. */
export function clientNameFromInitialize(body: unknown): string | null {
  const messages = Array.isArray(body) ? body : [body];
  for (const message of messages) {
    if (message && typeof message === 'object' && (message as { method?: unknown }).method === 'initialize') {
      const name = (message as { params?: { clientInfo?: { name?: unknown } } }).params?.clientInfo?.name;
      if (typeof name === 'string' && name.trim()) return name.trim();
    }
  }
  return null;
}

/** Best guess from the User-Agent when the client never told us its name. */
export function clientNameFromUserAgent(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  for (const [pattern] of KNOWN_CLIENTS) if (pattern.test(userAgent)) return userAgent;
  return null;
}

export async function rememberClientName(tokenId: string, name: string): Promise<void> {
  try {
    await redisService.set(`${CLIENT_KEY_PREFIX}:${tokenId}`, name.slice(0, 100), { EX: CLIENT_TTL_SECONDS });
  } catch (error) {
    logger.warn(`Could not remember MCP client for token ${tokenId}: ${error}`);
  }
}

export async function recallClientName(tokenId: string): Promise<string | null> {
  try {
    return await redisService.get(`${CLIENT_KEY_PREFIX}:${tokenId}`);
  } catch (error) {
    logger.warn(`Could not load MCP client for token ${tokenId}: ${error}`);
    return null;
  }
}

/**
 * The "(via …)" label for this request: the name sent in `initialize` (remembered for later requests),
 * else the remembered one, else a guess from the User-Agent, else "MCP".
 */
export async function resolveClientLabel(tokenId: string, body: unknown, userAgent?: string): Promise<string> {
  const fromInit = clientNameFromInitialize(body);
  if (fromInit) {
    await rememberClientName(tokenId, fromInit);
    return clientLabel(fromInit);
  }
  const remembered = await recallClientName(tokenId);
  return clientLabel(remembered ?? clientNameFromUserAgent(userAgent));
}
