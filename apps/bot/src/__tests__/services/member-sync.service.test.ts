import { renderMembers } from 'src/bot/commands/members';
import { User } from 'src/database/models/user.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { MemberSyncService } from 'src/shared/services/member-sync.service';

const store = new Map<string, string>();
const telegram = { getChatAdministrators: jest.fn(), getChatMember: jest.fn() };

jest.mock('src/bot', () => ({ bot: { telegram } }));
jest.mock('src/database/models/user.model', () => ({ User: { findOneAndUpdate: jest.fn() } }));
jest.mock('src/database/services/group-member.service', () => ({
  groupMemberService: { addMember: jest.fn().mockResolvedValue({}) },
}));
jest.mock('src/shared/services/redis.service', () => ({
  redisService: {
    get: jest.fn(async (k: string) => store.get(k) ?? null),
    set: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
      return 'OK';
    }),
  },
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }));

const group = { _id: 'g1', telegramGroupId: -100123 } as never;
const user = { _id: 'u1', telegramUserId: 42 } as never;

describe('MemberSyncService', () => {
  let service: MemberSyncService;

  beforeEach(() => {
    store.clear();
    jest.clearAllMocks();
    service = new MemberSyncService();
    (User.findOneAndUpdate as jest.Mock).mockImplementation(async (q: { telegramUserId: number }) => ({
      _id: `user-${q.telegramUserId}`,
      telegramUserId: q.telegramUserId,
    }));
  });

  it('registers human admins and skips bots', async () => {
    telegram.getChatAdministrators.mockResolvedValue([
      { user: { id: 1, is_bot: false, first_name: 'Lan' } },
      { user: { id: 2, is_bot: true, first_name: 'Bot' } },
    ]);
    expect(await service.syncAdmins(group)).toBe(1);
    expect(groupMemberService.addMember).toHaveBeenCalledWith('g1', 'user-1', 1);
  });

  it('syncs admins at most once an hour unless forced', async () => {
    telegram.getChatAdministrators.mockResolvedValue([]);
    await service.syncAdmins(group);
    await service.syncAdmins(group);
    expect(telegram.getChatAdministrators).toHaveBeenCalledTimes(1);
    await service.syncAdmins(group, undefined, true);
    expect(telegram.getChatAdministrators).toHaveBeenCalledTimes(2);
  });

  it('never throws when Telegram refuses', async () => {
    telegram.getChatAdministrators.mockRejectedValue(new Error('CHAT_ADMIN_REQUIRED'));
    await expect(service.syncAdmins(group)).resolves.toBe(0);
  });

  it.each(['member', 'administrator', 'creator'])('verifies a %s and records membership', async (status) => {
    telegram.getChatMember.mockResolvedValue({ status });
    expect(await service.verifyAndAddMember(group, user)).toBe(true);
    expect(groupMemberService.addMember).toHaveBeenCalledWith('g1', 'u1', 42);
  });

  it('refuses people who left and caches the answer briefly', async () => {
    telegram.getChatMember.mockResolvedValue({ status: 'left' });
    expect(await service.verifyAndAddMember(group, user)).toBe(false);
    expect(await service.verifyAndAddMember(group, user)).toBe(false);
    expect(telegram.getChatMember).toHaveBeenCalledTimes(1);
    expect(groupMemberService.addMember).not.toHaveBeenCalled();
  });

  it('accepts restricted users only while they are still in the group', async () => {
    telegram.getChatMember.mockResolvedValue({ status: 'restricted', is_member: true });
    expect(await service.verifyAndAddMember(group, user)).toBe(true);
  });
});

describe('/members rendering', () => {
  it('lists names sorted and escaped, with the join button', () => {
    const { text, keyboard } = renderMembers([
      { username: 'binh' },
      { firstName: 'An <dev>', lastName: 'Le' },
    ] as never);
    expect(text).toContain('People I can assign tasks to · 2');
    expect(text).toContain('@binh, An &lt;dev&gt; Le');
    expect(keyboard).toEqual([[{ text: "✋ I'm here", callback_data: 'members:join' }]]);
  });

  it('says nobody when the list is empty', () => {
    expect(renderMembers([]).text).toContain('Nobody yet.');
  });
});
