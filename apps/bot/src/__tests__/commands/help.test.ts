import { HelpCommand, renderHelpPage } from 'src/bot/commands/help';
import { handleHelpCallback } from 'src/bot/help-callback.handler';
import { configService } from 'src/configs/configuration';
import { groupService } from 'src/database/services/group.service';

jest.mock('src/database/services/group.service');
jest.mock('src/shared/services/callback-data-storage.service', () => ({
  callbackDataStorageService: { setCallbackData: jest.fn() },
}));
jest.mock('src/shared/services/redis.service', () => ({ redisService: {} }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const callbacks = (kb: unknown[][]) => kb.flat().map((b) => (b as { callback_data?: string }).callback_data).filter(Boolean);

describe('help', () => {
  beforeEach(() => {
    configService.botUsername = 'tbot_dev';
    configService.botHasMainWebApp = true;
  });

  it('/help sends one home message with a 2-column topic keyboard', async () => {
    const ctx = { chat: { id: 1, type: 'private' }, reply: jest.fn() } as any;
    await new HelpCommand().onHelp(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [text, opts] = ctx.reply.mock.calls[0];
    expect(text.split('\n')[0]).toBe('🤖 *TBot — tasks from your chat*');
    expect(opts.parse_mode).toBe('Markdown');
    const kb = opts.reply_markup.inline_keyboard;
    expect(kb.every((row: unknown[]) => row.length === 2)).toBe(true);
    expect(callbacks(kb)).toEqual([
      'help:create',
      'help:ai',
      'help:manage',
      'help:board',
      'help:reminders',
      'help:setup',
    ]);
  });

  it.each(['create', 'ai', 'manage', 'board', 'reminders', 'setup'])('topic %s is short and has « Back', (topic) => {
    const page = renderHelpPage(topic, { chatType: 'supergroup', groupId: 'g1' });
    expect(page.text.split('\n').length).toBeLessThanOrEqual(16);
    expect(callbacks(page.keyboard)).toContain('help:home');
  });

  it('manage lists all 7 statuses and 7 types two per line', () => {
    const { text } = renderHelpPage('manage');
    expect(text).toContain('📥 Backlog · 📝 To do');
    expect(text).toContain('🚫 Cancelled');
    expect(text).toContain('🛠 Improvement');
    expect(text).toContain('❓ Question');
  });

  it('board links to the group board in groups and to /start in private', () => {
    const inGroup = renderHelpPage('board', { chatType: 'supergroup', groupId: 'g1' });
    expect(inGroup.keyboard[0][0]).toEqual({ text: '📊 Open board', url: 'https://t.me/tbot_dev?startapp=g1' });
    const inPrivate = renderHelpPage('board', { chatType: 'private' });
    expect(inPrivate.text).toContain('/start');
    expect(inPrivate.keyboard.flat().some((b: any) => b.url)).toBe(false);
  });

  it('reminders offers a private chat url button and escapes the bot name', () => {
    const page = renderHelpPage('reminders');
    expect(page.keyboard[0][0]).toEqual({ text: '💬 Start private chat', url: 'https://t.me/tbot_dev' });
    expect(page.text).toContain('@tbot\\_dev');
  });

  it('tapping a topic edits the same message, and « Back returns home', async () => {
    (groupService.findGroupByTelegramId as jest.Mock).mockResolvedValue({ _id: 'g1' });
    const makeCtx = (data: string) =>
      ({
        chat: { id: -100, type: 'supergroup' },
        callbackQuery: { data },
        editMessageText: jest.fn(),
        answerCbQuery: jest.fn(),
        reply: jest.fn(),
      }) as any;

    const topicCtx = makeCtx('help:create');
    await handleHelpCallback(topicCtx);
    expect(topicCtx.editMessageText).toHaveBeenCalledWith(
      expect.stringContaining('*Create tasks*'),
      expect.objectContaining({ parse_mode: 'Markdown' }),
    );
    expect(topicCtx.reply).not.toHaveBeenCalled();
    expect(topicCtx.answerCbQuery).toHaveBeenCalled();

    const backCtx = makeCtx('help:home');
    await handleHelpCallback(backCtx);
    expect(backCtx.editMessageText.mock.calls[0][0]).toContain('TBot — tasks from your chat');

    const junkCtx = makeCtx('help:nope');
    await handleHelpCallback(junkCtx);
    expect(junkCtx.editMessageText.mock.calls[0][0]).toContain('TBot — tasks from your chat');
  });
});
