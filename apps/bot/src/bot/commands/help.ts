import { TASK_STATUS_LABELS, TASK_STATUS_ORDER, TASK_TYPE_LABELS, TASK_TYPE_ORDER } from '@tbot/shared';
import { BotContext } from 'src/bot/interface/context';
import { escapeMarkdown } from 'src/bot/task-card.renderer';
import { configService } from 'src/configs/configuration';
import { groupService } from 'src/database/services/group.service';
import logger from 'src/shared/logger/logger';
import { appLinkButton } from 'src/shared/utils/app-links';
import { InlineKeyboardButton } from 'telegraf/types';

export const HELP_TOPICS = ['create', 'ai', 'manage', 'board', 'reminders', 'setup'] as const;
export type HelpTopic = (typeof HELP_TOPICS)[number];

export interface HelpPage {
  text: string;
  keyboard: InlineKeyboardButton[][];
}

export interface HelpPageContext {
  chatType?: string;
  /** Mongo id of the current group (only in groups), used for the board link. */
  groupId?: string | null;
}

const BACK: InlineKeyboardButton = { text: '« Back', callback_data: 'help:home' };

function botMention(): string {
  return configService.botUsername ? `@${escapeMarkdown(configService.botUsername)}` : 'the bot';
}

/** "a 📥 Backlog · 📝 To do" — two labels per line. */
function pairs(labels: string[]): string[] {
  const lines: string[] = [];
  for (let i = 0; i < labels.length; i += 2) lines.push(labels.slice(i, i + 2).join(' · '));
  return lines;
}

function homePage(): HelpPage {
  const text = [
    '🤖 *TBot — tasks from your chat*',
    'I turn what your team says in this chat into tasks, and keep everyone on track.',
    '',
    '📝 Turn messages into tasks with AI',
    '💬 Ask in plain words with /ai',
    '🗂 Manage tasks right on their card',
    '📊 Kanban board in the app',
    '🔔 Reminders & daily digest',
    '',
    'Pick a topic:',
  ].join('\n');

  const keyboard: InlineKeyboardButton[][] = [
    [
      { text: '📝 Create tasks', callback_data: 'help:create' },
      { text: '💬 /ai', callback_data: 'help:ai' },
    ],
    [
      { text: '🗂 Manage', callback_data: 'help:manage' },
      { text: '📊 Board', callback_data: 'help:board' },
    ],
    [
      { text: '🔔 Reminders', callback_data: 'help:reminders' },
      { text: '⚙️ Setup', callback_data: 'help:setup' },
    ],
  ];
  return { text, keyboard };
}

function createPage(): HelpPage {
  const text = [
    '📝 *Create tasks*',
    '`/task Fix login on iOS @an` — from text',
    'Reply /task to a message — tasks from that message',
    'Reply `/task <note>` — same, your note is a hint',
    'Reply `/task all` — that message through the latest',
    '`/task 10` — the last 10 messages (max 50)',
    '',
    'The AI can split one message into several tasks and detects type, assignee and due date.',
    'Created by mistake? Tap ↩️ Undo within 10 minutes.',
  ].join('\n');
  return { text, keyboard: [[BACK]] };
}

function aiPage(): HelpPage {
  const text = [
    '💬 *Ask in plain words*',
    'Reply to a task card: `/ai assign this to @an`',
    '`/ai #12 xong rồi`',
    '`/ai move #12 to review, priority high`',
    '`/ai tôi còn task nào?`',
    '`/ai tạo task fix login cho @an hạn thứ 6`',
    '',
    'Vietnamese or English both work.',
  ].join('\n');
  return { text, keyboard: [[BACK]] };
}

function managePage(): HelpPage {
  const text = [
    '🗂 *Manage tasks*',
    'Card buttons: next step, 👤 Assign, ⋯ More (status, type, priority, delete)',
    '`/done #12` — or reply /done to a card',
    '`/tasks` — open tasks; add `mine`, `open`, `review`, `pending`, `bug`, `@name`…',
    '',
    '*Statuses*',
    ...pairs(TASK_STATUS_ORDER.map((s) => TASK_STATUS_LABELS[s])),
    '',
    '*Types*',
    ...pairs(TASK_TYPE_ORDER.map((t) => TASK_TYPE_LABELS[t])),
  ].join('\n');
  return { text, keyboard: [[BACK]] };
}

function boardPage(ctx: HelpPageContext): HelpPage {
  const isGroup = ctx.chatType === 'group' || ctx.chatType === 'supergroup';
  const open = isGroup && ctx.groupId ? appLinkButton('📊 Open board', ctx.groupId) : null;

  const lines = [
    '📊 *Board in the app*',
    'Kanban columns by status — drag cards to move them',
    'Filter by type, assignee or just yours',
    'Group by assignee to see who has what',
    'Works inside Telegram and in a normal browser',
  ];
  if (!isGroup) lines.push('', 'Send /start here to pick a group board.');
  else if (!open) lines.push('', 'The app link isn\'t configured yet — ask whoever runs the bot.');

  const keyboard: InlineKeyboardButton[][] = open ? [[open, BACK]] : [[BACK]];
  return { text: lines.join('\n'), keyboard };
}

function remindersPage(): HelpPage {
  const text = [
    '🔔 *Reminders & digest*',
    'DM when you\'re assigned or your task changes status',
    'DM the day before a task is due',
    'Daily summary in the group at 9:00 group time',
    '',
    `To get DMs, open a private chat with ${botMention()} once and tap Start.`,
  ].join('\n');
  const keyboard: InlineKeyboardButton[][] = configService.botUsername
    ? [[{ text: '💬 Start private chat', url: `https://t.me/${configService.botUsername}` }, BACK]]
    : [[BACK]];
  return { text, keyboard };
}

function setupPage(): HelpPage {
  const text = [
    '⚙️ *Setup (for admins)*',
    '1. Add me to the group',
    '2. @BotFather → /setprivacy → Disable, so `/task 10` and `/task all` can see messages',
    '3. @BotFather → configure the Main Mini App, so board links open inside Telegram',
    `4. Several bots here? Pick commands from the menu so they go to ${botMention()}`,
    '5. In groups with Topics, events go to a “Task events” topic — I create it if I\'m an admin with Manage topics, or run /settopic in the topic you want',
  ].join('\n');
  return { text, keyboard: [[BACK]] };
}

export function renderHelpPage(topic: string, ctx: HelpPageContext = {}): HelpPage {
  switch (topic) {
    case 'create':
      return createPage();
    case 'ai':
      return aiPage();
    case 'manage':
      return managePage();
    case 'board':
      return boardPage(ctx);
    case 'reminders':
      return remindersPage();
    case 'setup':
      return setupPage();
    default:
      return homePage();
  }
}

/** Page context for the current chat (group id for the board link). */
export async function helpPageContext(ctx: BotContext): Promise<HelpPageContext> {
  const chatType = ctx.chat?.type;
  if ((chatType === 'group' || chatType === 'supergroup') && ctx.chat?.id) {
    try {
      const group = await groupService.findGroupByTelegramId(ctx.chat.id);
      return { chatType, groupId: group ? group._id.toString() : null };
    } catch (error) {
      logger.warn(`Help: could not load group: ${error}`);
    }
  }
  return { chatType };
}

export class HelpCommand {
  private map: Map<string, (ctx: BotContext) => void>;

  constructor() {
    this.map = new Map<string, (ctx: BotContext) => void>();
  }

  register() {
    this.map.set('help', this.onHelp.bind(this));
    return this.map;
  }

  async onHelp(ctx: BotContext) {
    const page = renderHelpPage('home');
    await ctx.reply(page.text, {
      parse_mode: 'Markdown',
      link_preview_options: { is_disabled: true },
      reply_markup: { inline_keyboard: page.keyboard },
    });
  }
}

export const helpCommand = new HelpCommand();
