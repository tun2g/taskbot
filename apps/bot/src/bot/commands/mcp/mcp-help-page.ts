import { botStartLink, manageTokensButton } from 'src/shared/utils/app-links';
import { InlineKeyboardButton } from 'telegraf/types';

/** Deep-link payload that opens the /mcp group picker in a private chat. */
export const MCP_START_PAYLOAD = 'mcp';

/** /help → "🤖 AI tools (MCP)": what it is, 3 steps, and where tokens come from (legacy Markdown). */
export function renderMcpHelpPage(
  privateChat: boolean,
  back?: InlineKeyboardButton,
): { text: string; keyboard: InlineKeyboardButton[][] } {
  const text = [
    '🤖 *AI tools (MCP)*',
    'Let Claude Code or Cursor manage your tasks — they talk to me in plain words, or use exact fields.',
    '',
    '1. DM me /mcp → get a token',
    '2. Paste the command into Claude Code, or the config into Cursor',
    '3. Ask: “tạo task fix login cho @an trong group X”',
    '',
    'A token can work for one group or all of yours. Revoke it anytime.',
  ].join('\n');

  const row: InlineKeyboardButton[] = [];
  const start = botStartLink(MCP_START_PAYLOAD);
  if (start) row.push({ text: '🔑 Get a token', url: start });
  const manage = manageTokensButton(privateChat);
  if (manage) row.push({ ...manage, text: '⚙️ Tokens' });
  const keyboard: InlineKeyboardButton[][] = [];
  if (row.length) keyboard.push(row);
  if (back) keyboard.push([back]);
  return { text, keyboard };
}
