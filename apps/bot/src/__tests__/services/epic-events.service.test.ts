import { epicService } from 'src/database/services/epic.service';
import { groupService } from 'src/database/services/group.service';
import logger from 'src/shared/logger/logger';
import {
  buildEpicCreatedText,
  buildEpicDeletedText,
  buildEpicDoneText,
  buildEpicReopenedText,
  EpicEventsService,
} from 'src/shared/services/epic-events.service';
import { groupMessengerService } from 'src/shared/services/group-messenger.service';

const telegram = { sendMessage: jest.fn() };
jest.mock('src/bot', () => ({ bot: { telegram: { sendMessage: jest.fn() } } }));
jest.mock('src/database/services/epic.service', () => ({ epicService: { getProgress: jest.fn() } }));
jest.mock('src/database/services/group.service', () => ({ groupService: { findGroupById: jest.fn() } }));
jest.mock('src/shared/services/group-messenger.service', () => ({
  groupMessengerService: { sendEvent: jest.fn().mockResolvedValue({ message_id: 1 }) },
}));
jest.mock('src/shared/utils/app-links', () => ({
  boardButton: jest.fn(() => ({ text: '📋 Open board', url: 'https://t.me/b?startapp=g1' })),
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const an = { username: 'an' } as any;
const login = { _id: 'e1', groupId: 'g1', title: 'Login', color: 'blue', status: 'open', description: null } as any;
const group = { _id: 'g1', telegramGroupId: -100 } as any;

describe('epic event lines', () => {
  it('created, with the source label', () => {
    expect(buildEpicCreatedText(an, login, 'Claude Code')).toBe(
      '🗂 @an created epic 🟦 <b>Login</b> (via Claude Code)',
    );
    expect(buildEpicCreatedText(an, login, 'app')).toBe('🗂 @an created epic 🟦 <b>Login</b> (via app)');
    expect(buildEpicCreatedText(an, login, '/ai')).toBe('🗂 @an created epic 🟦 <b>Login</b> (via /ai)');
  });

  it('created: the description goes on a second line, cut to ~80 chars and escaped', () => {
    const text = buildEpicCreatedText(an, { ...login, description: `<b>Sign in</b> ${'x'.repeat(200)}` }, 'app');
    const [first, second] = text.split('\n');
    expect(first).toBe('🗂 @an created epic 🟦 <b>Login</b> (via app)');
    expect(second.startsWith('<i>&lt;b&gt;Sign in&lt;/b&gt; xxx')).toBe(true);
    expect(second.endsWith('…</i>')).toBe(true);
    expect(Array.from(second.replace(/<\/?i>/g, '').replace(/&lt;|&gt;/g, '<')).length).toBeLessThanOrEqual(80);
  });

  it('escapes titles and names', () => {
    expect(buildEpicCreatedText({ firstName: 'A&B' } as any, { ...login, title: 'x <y>' }, 'app')).toBe(
      '🗂 A&amp;B created epic 🟦 <b>x &lt;y&gt;</b> (via app)',
    );
  });

  it('done: all tasks done / some still open / no tasks', () => {
    expect(buildEpicDoneText(login, { total: 7, done: 7 }, 'app')).toBe(
      '🎉 Epic 🟦 <b>Login</b> done — 7/7 tasks (via app)',
    );
    expect(buildEpicDoneText(login, { total: 7, done: 5 }, 'Cursor')).toBe(
      '🎉 Epic 🟦 <b>Login</b> done — 5/7 tasks, 2 still open (via Cursor)',
    );
    expect(buildEpicDoneText(login, { total: 1, done: 1 }, 'app')).toBe(
      '🎉 Epic 🟦 <b>Login</b> done — 1/1 task (via app)',
    );
    expect(buildEpicDoneText(login, null, 'app')).toBe('🎉 Epic 🟦 <b>Login</b> done (via app)');
  });

  it('reopened and deleted', () => {
    expect(buildEpicReopenedText(an, login, 'app')).toBe('↩️ @an reopened epic 🟦 <b>Login</b> (via app)');
    expect(buildEpicDeletedText(an, login, 3, 'app')).toBe(
      '🗑 @an deleted epic 🟦 <b>Login</b> — its 3 tasks were kept (via app)',
    );
    expect(buildEpicDeletedText(an, login, 1, 'MCP')).toBe(
      '🗑 @an deleted epic 🟦 <b>Login</b> — its 1 task was kept (via MCP)',
    );
    expect(buildEpicDeletedText(an, login, 0, 'app')).toBe('🗑 @an deleted epic 🟦 <b>Login</b> (via app)');
  });
});

describe('EpicEventsService', () => {
  const service = new EpicEventsService();
  const sendEvent = groupMessengerService.sendEvent as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    (groupService.findGroupById as jest.Mock).mockResolvedValue(group);
  });

  it('posts through the group messenger (events topic in forums) with the board button', async () => {
    await service.created(login, an, 'Claude Code');
    expect(groupService.findGroupById).toHaveBeenCalledWith('g1');
    expect(sendEvent).toHaveBeenCalledWith(
      expect.anything(),
      group,
      '🗂 @an created epic 🟦 <b>Login</b> (via Claude Code)',
      {
        extra: {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          reply_markup: { inline_keyboard: [[{ text: '📋 Open board', url: 'https://t.me/b?startapp=g1' }]] },
        },
      },
    );
  });

  it('uses the given group / telegram / source without a lookup', async () => {
    await service.created(login, an, '/ai', {
      group,
      telegram: telegram as any,
      source: { messageId: 5, threadId: 9 },
      fallbackThreadId: 9,
    });
    expect(groupService.findGroupById).not.toHaveBeenCalled();
    expect(sendEvent).toHaveBeenCalledWith(
      telegram,
      group,
      expect.stringContaining('(via /ai)'),
      expect.objectContaining({ source: { messageId: 5, threadId: 9 }, fallbackThreadId: 9 }),
    );
  });

  it('open → done announces the progress', async () => {
    (epicService.getProgress as jest.Mock).mockResolvedValue(
      new Map([['e1', { total: 7, done: 5, inProgress: 1, cancelled: 0 }]]),
    );
    await service.statusChanged('open', { ...login, status: 'done' }, an, 'app');
    expect(sendEvent.mock.calls[0][2]).toBe('🎉 Epic 🟦 <b>Login</b> done — 5/7 tasks, 2 still open (via app)');
  });

  it('done → open announces a reopen; no status change posts nothing', async () => {
    await service.statusChanged('done', { ...login, status: 'open' }, an, 'Cursor');
    expect(sendEvent.mock.calls[0][2]).toBe('↩️ @an reopened epic 🟦 <b>Login</b> (via Cursor)');
    sendEvent.mockClear();
    await service.statusChanged('open', login, an, 'app');
    await service.statusChanged(undefined, login, an, 'app');
    expect(sendEvent).not.toHaveBeenCalled();
  });

  it('deleted', async () => {
    await service.deleted(login, an, 4, 'app');
    expect(sendEvent.mock.calls[0][2]).toBe('🗑 @an deleted epic 🟦 <b>Login</b> — its 4 tasks were kept (via app)');
  });

  it('never throws: errors are logged', async () => {
    sendEvent.mockRejectedValueOnce(new Error('chat not found'));
    await expect(service.created(login, an, 'app')).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('chat not found'));
  });

  it('skips groups without a Telegram chat', async () => {
    (groupService.findGroupById as jest.Mock).mockResolvedValue(null);
    await service.created(login, an, 'app');
    expect(sendEvent).not.toHaveBeenCalled();
  });
});
