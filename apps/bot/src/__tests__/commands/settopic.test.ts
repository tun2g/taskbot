import { SetTopicCommand } from 'src/bot/commands/settopic';
import { groupService } from 'src/database/services/group.service';
import { groupMessengerService } from 'src/shared/services/group-messenger.service';
import { configService } from 'src/configs/configuration';

jest.mock('src/database/services/group.service', () => ({ groupService: { findOrCreateGroup: jest.fn() } }));
jest.mock('src/shared/services/group-messenger.service', () => ({
  ...jest.requireActual('src/shared/services/group-messenger.service'),
  groupMessengerService: { trackMessage: jest.fn(), setEventsTopic: jest.fn() },
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const group = { _id: 'g1', telegramGroupId: -100 };

function ctx(opts: { forum?: boolean; threadId?: number | null; status?: string; message?: Record<string, unknown> } = {}) {
  const { forum = true, threadId = 9, status = 'administrator' } = opts;
  return {
    chat: { id: -100, type: 'supergroup', title: 'Team', is_forum: forum },
    from: { id: 1 },
    message: {
      message_id: 50,
      text: '/settopic',
      ...(threadId ? { message_thread_id: threadId, is_topic_message: true } : {}),
      ...opts.message,
    },
    reply: jest.fn().mockResolvedValue({}),
    telegram: { getChatMember: jest.fn().mockResolvedValue({ status }) },
  } as any;
}

describe('/settopic', () => {
  const command = new SetTopicCommand();

  beforeEach(() => (groupService.findOrCreateGroup as jest.Mock).mockResolvedValue(group));

  it('registers', () => {
    expect(new SetTopicCommand().register().has('settopic')).toBe(true);
  });

  it('explains there are no topics in a normal group', async () => {
    const c = ctx({ forum: false, threadId: null });
    await command.onSetTopic(c);
    expect(c.reply).toHaveBeenCalledWith(expect.stringContaining('no Topics'));
    expect(groupMessengerService.setEventsTopic).not.toHaveBeenCalled();
  });

  it('asks to run it inside a topic when sent in General', async () => {
    const c = ctx({ threadId: null });
    await command.onSetTopic(c);
    expect(c.reply).toHaveBeenCalledWith(expect.stringContaining('Open the topic'));
    expect(groupMessengerService.setEventsTopic).not.toHaveBeenCalled();
  });

  it('refuses non-admins', async () => {
    const c = ctx({ status: 'member' });
    await command.onSetTopic(c);
    expect(c.reply).toHaveBeenCalledWith(expect.stringContaining('Only group admins'), {
      reply_parameters: { message_id: 50 },
    });
    expect(groupMessengerService.setEventsTopic).not.toHaveBeenCalled();
  });

  it('saves the topic for an admin and confirms there', async () => {
    const c = ctx();
    await command.onSetTopic(c);
    expect(groupMessengerService.setEventsTopic).toHaveBeenCalledWith(group, 9);
    expect(c.reply).toHaveBeenCalledWith(expect.stringContaining('✅ Task events will be posted in this topic'), {
      message_thread_id: 9,
    });
  });

  it('adds the board button to the confirmation when the app link exists', async () => {
    const saved = { botUsername: configService.botUsername, botHasMainWebApp: configService.botHasMainWebApp };
    Object.assign(configService, { botUsername: 'tbot', botHasMainWebApp: true });
    const c = ctx();
    await command.onSetTopic(c);
    Object.assign(configService, saved);
    expect(c.reply).toHaveBeenCalledWith(expect.any(String), {
      message_thread_id: 9,
      reply_markup: { inline_keyboard: [[{ text: '📋 Open board', url: 'https://t.me/tbot?startapp=g1' }]] },
    });
  });

  it('points to /start in a private chat', async () => {
    const c = { ...ctx(), chat: { id: 1, type: 'private' } };
    await command.onSetTopic(c);
    expect(c.reply).toHaveBeenCalledWith(expect.stringContaining('Send /start'), {});
    expect(groupMessengerService.setEventsTopic).not.toHaveBeenCalled();
  });

  it('accepts anonymous admins (posting as the group)', async () => {
    const c = ctx({ status: 'member', message: { sender_chat: { id: -100 } } });
    await command.onSetTopic(c);
    expect(c.telegram.getChatMember).not.toHaveBeenCalled();
    expect(groupMessengerService.setEventsTopic).toHaveBeenCalledWith(group, 9);
  });
});
