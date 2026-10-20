import { escapeHtml } from 'src/shared/services/task-event-lines';
import { manageTokensButton } from 'src/shared/utils/app-links';
import { InlineKeyboardButton } from 'telegraf/types';

export const MCP_HELP_CALLBACK = 'mcp:help';

export interface SetupMessageInput {
  secret: string;
  /** Public MCP endpoint, e.g. https://taskbot.example.com/mcp */
  url: string;
  /** Title of the group the token is limited to; null = all the user's groups. */
  groupTitle: string | null;
}

/** `claude mcp add …` exactly as Claude Code expects it (verified against the Claude Code MCP docs). */
export function claudeCodeCommand(url: string, secret: string): string {
  return `claude mcp add --transport http taskbot ${url} --header "Authorization: Bearer ${secret}"`;
}

/** ~/.cursor/mcp.json entry (remote server: url + headers). */
export function cursorConfig(url: string, secret: string): string {
  return JSON.stringify({ mcpServers: { taskbot: { url, headers: { Authorization: `Bearer ${secret}` } } } }, null, 2);
}

/**
 * The DM with a freshly issued token (HTML): scope, the secret, ready-to-paste Claude Code / Cursor setup,
 * a "shown once" warning and what to do next. Buttons: manage tokens · how it works.
 */
export function renderSetupMessage(input: SetupMessageInput): { text: string; keyboard: InlineKeyboardButton[][] } {
  const { secret, url, groupTitle } = input;
  const scope = groupTitle ? `<b>${escapeHtml(groupTitle)}</b>` : '<b>all your groups</b>';
  const text = [
    `🔑 <b>Token for</b> ${scope}`,
    'Lets Claude Code or Cursor create and manage tasks — and talk to me in plain words.',
    '',
    `<code>${escapeHtml(secret)}</code>`,
    '⚠️ <b>Shown once — treat it like a password.</b>',
    '',
    '<b>Claude Code</b> · run in a terminal:',
    `<pre><code class="language-bash">${escapeHtml(claudeCodeCommand(url, secret))}</code></pre>`,
    '',
    '<b>Cursor</b> · add to <code>~/.cursor/mcp.json</code>:',
    `<pre><code class="language-json">${escapeHtml(cursorConfig(url, secret))}</code></pre>`,
    '',
    "Next: in Claude Code run <code>/mcp</code> to check it's connected.",
  ].join('\n');

  const row: InlineKeyboardButton[] = [];
  const manage = manageTokensButton(true);
  if (manage) row.push(manage);
  row.push({ text: '📖 How it works', callback_data: MCP_HELP_CALLBACK });
  return { text, keyboard: [row] };
}

/** Shown instead of a token when the server has no public URL for MCP. */
export const MCP_NOT_CONFIGURED_TEXT = [
  '⚙️ <b>AI tools (MCP) aren’t set up on this bot yet</b>',
  'Whoever runs the bot needs to set <code>MCP_PUBLIC_URL</code> (or <code>WEBHOOK_URL</code>) so Claude Code and Cursor can reach it.',
  'No token was created.',
].join('\n');
