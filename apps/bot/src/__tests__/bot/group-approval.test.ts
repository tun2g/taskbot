import { GROUP_REJECT_REASONS, GroupStatus } from '@tbot/shared';
import mongoose from 'mongoose';
import { handleGroupApprovalCallback, ONLY_OWNER_TEXT } from 'src/bot/group-approval.handler';
import { configService } from 'src/configs/configuration';
import { decideGroup } from 'src/database/group-status';
import { groupService } from 'src/database/services/group.service';
import { AdminAuditLog } from 'src/database/models/admin-audit-log.model';

jest.mock('src/configs/configuration', () => ({ configService: { botOwnerTelegramId: 42 } }));
jest.mock('src/database/group-status', () => ({ decideGroup: jest.fn() }));
jest.mock('src/database/services/group.service', () => ({ groupService: { findGroupById: jest.fn() } }));
jest.mock('src/shared/services/redis.service', () => ({ redisService: { set: jest.fn() } }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));
const lastAudit = { current: null as Record<string, unknown> | null };
jest.mock('src/database/models/admin-audit-log.model', () => ({
  AdminAuditLog: {
    create: jest.fn().mockResolvedValue({}),
    findOne: jest.fn(() => ({ sort: () => ({ select: () => ({ lean: async () => lastAudit.current }) }) })),
  },
}));

const groupId = new mongoose.Types.ObjectId().toString();
const group = (status: GroupStatus) => ({
  _id: groupId,
  telegramGroupId: -100,
  groupName: 'Team Alpha',
  status,
  statusReason: null,
  memberCount: 12,
  addedBy: { telegramUserId: 7, name: 'An', username: 'an' },
});

function tap(data: string, fromId = 42) {
  return {
    from: { id: fromId },
    botInfo: { first_name: 'TaskBot' },
    callbackQuery: { id: '1', data },
    answerCbQuery: jest.fn().mockResolvedValue(true),
    editMessageText: jest.fn().mockResolvedValue(true),
    editMessageReplyMarkup: jest.fn().mockResolvedValue(true),
    telegram: { sendMessage: jest.fn().mockResolvedValue({}), leaveChat: jest.fn().mockResolvedValue(true) },
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  lastAudit.current = null;
  Object.assign(configService as any, { botOwnerTelegramId: 42, ownerContact: '', webappUrl: undefined, botUsername: undefined });
});

describe('owner approval card', () => {
  it('only the bot owner can decide', async () => {
    const ctx = tap(`gapp:ok:${groupId}`, 7);
    await handleGroupApprovalCallback(ctx);
    expect(ctx.answerCbQuery).toHaveBeenCalledWith(ONLY_OWNER_TEXT);
    expect(decideGroup).not.toHaveBeenCalled();
  });

  it('nobody can decide when no owner is configured', async () => {
    (configService as any).botOwnerTelegramId = null;
    const ctx = tap(`gapp:ok:${groupId}`);
    await handleGroupApprovalCallback(ctx);
    expect(ctx.answerCbQuery).toHaveBeenCalledWith(ONLY_OWNER_TEXT);
  });

  it('Approve: card becomes "Approved here" without buttons, and the group is told it is ready', async () => {
    (decideGroup as jest.Mock).mockResolvedValue({ ok: true, group: group(GroupStatus.ACTIVE), from: GroupStatus.PENDING });
    const ctx = tap(`gapp:ok:${groupId}`);
    await handleGroupApprovalCallback(ctx);

    expect(decideGroup).toHaveBeenCalledWith(groupId, 'approve');
    expect(ctx.answerCbQuery).toHaveBeenCalledWith('✅ Approved');
    const [text, extra] = ctx.editMessageText.mock.calls[0];
    expect(text).toContain('✅ Approved here');
    expect(text).toContain('<b>Team Alpha</b>');
    expect(extra.reply_markup).toBeUndefined();
    expect(ctx.telegram.sendMessage).toHaveBeenCalledWith(-100, expect.stringContaining('This group is approved'), expect.anything());
    expect(ctx.telegram.sendMessage.mock.calls[0][1]).toContain('/new Fix login on iOS');
    expect(ctx.telegram.leaveChat).not.toHaveBeenCalled();
  });

  it('Reject asks why first: buttons swap to the reasons, nothing decided yet', async () => {
    const ctx = tap(`gapp:no:${groupId}`);
    await handleGroupApprovalCallback(ctx);
    expect(decideGroup).not.toHaveBeenCalled();
    const markup = ctx.editMessageReplyMarkup.mock.calls[0][0];
    const buttons = markup.inline_keyboard.flat();
    expect(buttons.map((b: any) => b.text)).toEqual(['🔒 Private bot', '💬 Not a team chat', '🚫 No reason', '← Back']);
    expect(markup.inline_keyboard.every((row: unknown[]) => row.length <= 3)).toBe(true);
    expect(buttons.every((b: any) => Buffer.byteLength(b.callback_data) <= 64)).toBe(true);
  });

  it('← Back restores Approve / Reject', async () => {
    const ctx = tap(`gapp:bk:${groupId}`);
    await handleGroupApprovalCallback(ctx);
    expect(decideGroup).not.toHaveBeenCalled();
    expect(ctx.editMessageReplyMarkup.mock.calls[0][0].inline_keyboard[0].map((b: any) => b.text)).toEqual(['✅ Approve', '🚫 Reject']);
  });

  it('a reason rejects: the group is told why, then the bot leaves', async () => {
    const reason = GROUP_REJECT_REASONS.private;
    (decideGroup as jest.Mock).mockResolvedValue({ ok: true, group: { ...group(GroupStatus.REJECTED), statusReason: reason }, from: GroupStatus.PENDING });
    const ctx = tap(`gapp:nr:${groupId}:private`);
    await handleGroupApprovalCallback(ctx);

    expect(decideGroup).toHaveBeenCalledWith(groupId, 'reject', reason);
    expect(ctx.editMessageText.mock.calls[0][0]).toContain('🚫 Rejected here — the bot left');
    const [chat, text] = ctx.telegram.sendMessage.mock.calls[0];
    expect(chat).toBe(-100);
    expect(text).toContain('did not approve this group');
    expect(text).toContain('Reason: This bot is private');
    expect(ctx.telegram.leaveChat).toHaveBeenCalledWith(-100);
  });

  it('"No reason" rejects without one', async () => {
    (decideGroup as jest.Mock).mockResolvedValue({ ok: true, group: group(GroupStatus.REJECTED), from: GroupStatus.PENDING });
    await handleGroupApprovalCallback(tap(`gapp:nr:${groupId}:-`));
    expect(decideGroup).toHaveBeenCalledWith(groupId, 'reject', null);
  });

  it('already decided in the admin app: says so and refreshes the card, nothing posted', async () => {
    (decideGroup as jest.Mock).mockResolvedValue({ ok: false, reason: 'wrong_state', current: GroupStatus.ACTIVE });
    (groupService.findGroupById as jest.Mock).mockResolvedValue(group(GroupStatus.ACTIVE));
    const ctx = tap(`gapp:nr:${groupId}:-`);
    lastAudit.current = { details: { from: 'pending', to: 'active' } };
    await handleGroupApprovalCallback(ctx);

    expect(ctx.answerCbQuery).toHaveBeenCalledWith('Already decided — now: Active.');
    expect(AdminAuditLog.findOne).toHaveBeenCalledWith({ targetType: 'group', targetId: groupId, action: 'group.approve' });
    expect(ctx.editMessageText.mock.calls[0][0]).toContain('✅ Approved in the admin app');
    expect(ctx.telegram.sendMessage).not.toHaveBeenCalled();
    expect(ctx.telegram.leaveChat).not.toHaveBeenCalled();
  });

  it('double tap in Telegram: the refreshed card says "here", not "in the admin app"', async () => {
    (decideGroup as jest.Mock).mockResolvedValue({ ok: false, reason: 'wrong_state', current: GroupStatus.REJECTED });
    (groupService.findGroupById as jest.Mock).mockResolvedValue(group(GroupStatus.REJECTED));
    lastAudit.current = { details: { via: 'telegram' } };
    const ctx = tap(`gapp:nr:${groupId}:-`);
    await handleGroupApprovalCallback(ctx);
    expect(AdminAuditLog.findOne).toHaveBeenCalledWith({ targetType: 'group', targetId: groupId, action: 'group.reject' });
    expect(ctx.editMessageText.mock.calls[0][0]).toContain('🚫 Rejected here — the bot left');
  });

  it('no record of where it was decided: the card states the outcome without guessing', async () => {
    (decideGroup as jest.Mock).mockResolvedValue({ ok: false, reason: 'wrong_state', current: GroupStatus.ACTIVE });
    (groupService.findGroupById as jest.Mock).mockResolvedValue(group(GroupStatus.ACTIVE));
    const ctx = tap(`gapp:ok:${groupId}`);
    await handleGroupApprovalCallback(ctx);
    const text = ctx.editMessageText.mock.calls[0][0];
    expect(text.split('\n')[0]).toBe('✅ Approved');
  });

  it('a Telegram decision is logged with via=telegram before anything is posted', async () => {
    (decideGroup as jest.Mock).mockResolvedValue({ ok: true, group: group(GroupStatus.ACTIVE), from: GroupStatus.PENDING });
    const ctx = tap(`gapp:ok:${groupId}`);
    await handleGroupApprovalCallback(ctx);
    expect(AdminAuditLog.create).toHaveBeenCalledWith(expect.objectContaining({ action: 'group.approve', details: { via: 'telegram' } }));
    const logged = (AdminAuditLog.create as jest.Mock).mock.invocationCallOrder[0];
    expect(logged).toBeLessThan(ctx.telegram.sendMessage.mock.invocationCallOrder[0]);
  });

  it('Approve: the group message carries the [Open board] button when a board link exists', async () => {
    Object.assign(configService as any, { webappUrl: 'https://taskbot.example.com' });
    (decideGroup as jest.Mock).mockResolvedValue({ ok: true, group: group(GroupStatus.ACTIVE), from: GroupStatus.PENDING });
    const ctx = tap(`gapp:ok:${groupId}`);
    await handleGroupApprovalCallback(ctx);
    expect(ctx.telegram.sendMessage.mock.calls[0][2].reply_markup).toEqual({
      inline_keyboard: [[{ text: '📋 Open board', url: `https://taskbot.example.com/${groupId}/tasks` }]],
    });
  });

  it('forum group: the approval goes to General (no topic) and says where task updates go', async () => {
    (decideGroup as jest.Mock).mockResolvedValue({ ok: true, group: { ...group(GroupStatus.ACTIVE), isForum: true }, from: GroupStatus.PENDING });
    const ctx = tap(`gapp:ok:${groupId}`);
    await handleGroupApprovalCallback(ctx);
    const [chat, text, extra] = ctx.telegram.sendMessage.mock.calls[0];
    expect(chat).toBe(-100);
    expect(text).toContain('“Task events” topic — /settopic picks another one');
    expect(extra.message_thread_id).toBeUndefined();
  });

  it('forum group with General closed to the bot: falls back to the events topic', async () => {
    (decideGroup as jest.Mock).mockResolvedValue({
      ok: true,
      group: { ...group(GroupStatus.ACTIVE), isForum: true, eventsTopicId: 33 },
      from: GroupStatus.PENDING,
    });
    const ctx = tap(`gapp:ok:${groupId}`);
    ctx.telegram.sendMessage.mockRejectedValueOnce(new Error('400: Bad Request: TOPIC_CLOSED'));
    await handleGroupApprovalCallback(ctx);
    expect(ctx.telegram.sendMessage).toHaveBeenCalledTimes(2);
    expect(ctx.telegram.sendMessage.mock.calls[1][2].message_thread_id).toBe(33);
  });

  it('OWNER_CONTACT set: the rejected notice tells the group how to reach the owner', async () => {
    Object.assign(configService as any, { ownerContact: '@tun2g' });
    (decideGroup as jest.Mock).mockResolvedValue({ ok: true, group: group(GroupStatus.REJECTED), from: GroupStatus.PENDING });
    const ctx = tap(`gapp:nr:${groupId}:-`);
    await handleGroupApprovalCallback(ctx);
    expect(ctx.telegram.sendMessage.mock.calls[0][1]).toContain("If you think this is a mistake, message the bot's owner: @tun2g.");
  });

  it('OWNER_CONTACT unset: no contact line', async () => {
    (decideGroup as jest.Mock).mockResolvedValue({ ok: true, group: group(GroupStatus.REJECTED), from: GroupStatus.PENDING });
    const ctx = tap(`gapp:nr:${groupId}:-`);
    await handleGroupApprovalCallback(ctx);
    expect(ctx.telegram.sendMessage.mock.calls[0][1]).toContain('ask the person who runs this bot');
    expect(ctx.telegram.sendMessage.mock.calls[0][1]).not.toContain("message the bot's owner");
  });

  it('a group that is gone: buttons removed', async () => {
    (decideGroup as jest.Mock).mockResolvedValue({ ok: false, reason: 'not_found' });
    const ctx = tap(`gapp:ok:${groupId}`);
    await handleGroupApprovalCallback(ctx);
    expect(ctx.answerCbQuery).toHaveBeenCalledWith('This group no longer exists.');
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledWith(undefined);
  });

  it('a malformed id never reaches the database', async () => {
    const ctx = tap('gapp:ok:nope');
    await handleGroupApprovalCallback(ctx);
    expect(decideGroup).not.toHaveBeenCalled();
    expect(ctx.answerCbQuery).toHaveBeenCalledWith('This group no longer exists.');
  });
});
