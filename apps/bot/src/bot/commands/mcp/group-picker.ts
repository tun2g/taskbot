import { IGroup } from 'src/database/models/group.model';
import { InlineKeyboardButton } from 'telegraf/types';

export const MCP_PICK_PREFIX = 'mcp:new:';
export const MCP_PICK_ALL = 'all';
const MAX_GROUP_BUTTONS = 8;
const LABEL_MAX = 24;

function shortName(name: string): string {
  const chars = Array.from(name.trim());
  return chars.length <= LABEL_MAX
    ? chars.join('')
    : `${chars
        .slice(0, LABEL_MAX - 1)
        .join('')
        .trimEnd()}…`;
}

/** "Which group should this token work for?" — groups two per row (names are long), then "🌐 All my groups". */
export function renderGroupPicker(groups: IGroup[]): { text: string; keyboard: InlineKeyboardButton[][] } {
  const text = [
    '🤖 <b>Connect Claude Code or Cursor</b>',
    'Which group should this token work for?',
    '',
    'One group is safest — e.g. one token per project. You can revoke it anytime.',
  ].join('\n');

  const buttons: InlineKeyboardButton[] = groups
    .slice(0, MAX_GROUP_BUTTONS)
    .map((g) => ({ text: `👥 ${shortName(g.groupName)}`, callback_data: `${MCP_PICK_PREFIX}${g._id}` }));
  const keyboard: InlineKeyboardButton[][] = [];
  for (let i = 0; i < buttons.length; i += 2) keyboard.push(buttons.slice(i, i + 2));
  keyboard.push([{ text: '🌐 All my groups', callback_data: `${MCP_PICK_PREFIX}${MCP_PICK_ALL}` }]);
  return { text, keyboard };
}

/** "mcp:new:<groupId>" → groupId, "mcp:new:all" → null, anything else → undefined. */
export function parsePick(data: string): string | null | undefined {
  if (!data.startsWith(MCP_PICK_PREFIX)) return undefined;
  const value = data.slice(MCP_PICK_PREFIX.length);
  if (value === MCP_PICK_ALL) return null;
  return /^[0-9a-f]{24}$/.test(value) ? value : undefined;
}
