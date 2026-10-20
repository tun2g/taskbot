export type McpClient = 'claude' | 'cursor';

export const TOKEN_PLACEHOLDER = '<your token>';

export function claudeCodeCommand(url: string, token: string): string {
  return `claude mcp add --transport http taskbot ${url} --header "Authorization: Bearer ${token}"`;
}

export function cursorConfig(url: string, token: string): string {
  return JSON.stringify({ mcpServers: { taskbot: { url, headers: { Authorization: `Bearer ${token}` } } } }, null, 2);
}

/** "Oct 20" this year, "Oct 20, 2025" otherwise. */
export function formatShortDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric' });
}

export const TOKEN_ENV = 'TBOT_TOKEN';

/** Project `.mcp.json` for Claude Code — reads the token from the environment so it's safe to commit. */
export function claudeProjectConfig(url: string): string {
  return JSON.stringify(
    { mcpServers: { taskbot: { type: 'http', url, headers: { Authorization: `Bearer \${${TOKEN_ENV}}` } } } },
    null,
    2,
  );
}

export function tokenEnvExport(token: string): string {
  return `export ${TOKEN_ENV}=${token}`;
}
