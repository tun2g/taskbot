import { GroupStatus } from '@tbot/shared';
import { MAX_PENDING_CARDS, StartCommand } from 'src/bot/commands/start';
import { configService } from 'src/configs/configuration';
import { Group } from 'src/database/models/group.model';
import { groupMemberService } from 'src/database/services/group-member.service';
import { userService } from 'src/database/services/user.service';
import { groupLifecycleService } from 'src/shared/services/group-lifecycle.service';

jest.mock('src/database/models/group.model', () => ({ Group: { find: jest.fn() } }));
jest.mock('src/database/services/group-member.service', () => ({ groupMemberService: { getUserGroups: jest.fn() } }));
jest.mock('src/database/services/user.service', () => ({ userService: { findOrCreateUser: jest.fn() } }));
jest.mock('src/database/services/group.service', () => ({ groupService: { findOrCreateGroup: jest.fn() } }));
jest.mock('src/shared/services/group-lifecycle.service', () => ({ groupLifecycleService: { sendOwnerCard: jest.fn() } }));
jest.mock('src/shared/services/redis.service', () => ({ redisService: {} }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const OWNER = 42;
const command = new StartCommand();

function ctx(fromId = 7) {
  return { chat: { id: fromId, type: 'private' }, from: { id: fromId }, telegram: {}, reply: jest.fn().mockResolvedValue({}) } as any;
}

const doc = (name: string, status: GroupStatus) => ({ _id: `id-${name}`, groupName: name, status });

/** Group.find(...) is used two ways: `.sort()` (the member's groups) and `.sort().limit()` (pending groups). */
function groups(memberGroups: unknown[], pending: unknown[] = []) {
  (Group.find as jest.Mock).mockImplementation((q: Record<string, unknown>) => {
    const rows = 'status' in q ? pending : memberGroups;
    const sorted = Object.assign(Promise.resolve(rows), { limit: (n: number) => Promise.resolve(rows.slice(0, n)) });
    return { sort: () => sorted };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(configService, {
    botOwnerTelegramId: OWNER,
    adminUrl: '',
    botUsername: 'tbot_dev',
    botHasMainWebApp: false,
    webappUrl: 'https://taskbot.example.com',
  });
  (userService.findOrCreateUser as jest.Mock).mockResolvedValue({ _id: 'u1', firstName: 'An' });
  (groupMemberService.getUserGroups as jest.Mock).mockResolvedValue(['g1']);
});

describe('/start — a member with groups that are not ready yet', () => {
  it('only waiting groups: says none can be used yet and lists why, in plain words', async () => {
    groups([doc('Alpha', GroupStatus.PENDING), doc('Beta', GroupStatus.SUSPENDED)]);
    const c = ctx();
    await command.onStart(c);

    expect(c.reply).toHaveBeenCalledTimes(1);
    const [text, extra] = c.reply.mock.calls[0];
    expect(text).toContain('None of your groups can be used with me yet.');
    expect(text).toContain("• Alpha — waiting for the bot owner's approval");
    expect(text).toContain('• Beta — paused by the bot owner');
    expect(text).not.toMatch(/pending|suspended/);
    expect(extra.reply_markup).toBeUndefined();
  });

  it('a mix: board buttons for ready groups only, the rest under "Not ready yet"; rejected / removed are left out', async () => {
    groups([
      doc('Alpha', GroupStatus.ACTIVE),
      doc('Beta', GroupStatus.PENDING),
      doc('Gamma', GroupStatus.REJECTED),
      doc('Delta', GroupStatus.LEFT),
    ]);
    const c = ctx();
    await command.onStart(c);

    const [text, extra] = c.reply.mock.calls[0];
    expect(extra.reply_markup.inline_keyboard).toEqual([[{ text: '📋 Alpha', web_app: { url: 'https://taskbot.example.com/id-Alpha/tasks' } }]]);
    expect(text).toContain('⏳ *Not ready yet*');
    expect(text).toContain("• Beta — waiting for the bot owner's approval");
    expect(text).not.toContain('Gamma');
    expect(text).not.toContain('Delta');
  });

  it('not the owner: no approval cards are re-sent', async () => {
    groups([doc('Alpha', GroupStatus.ACTIVE)], [doc('P1', GroupStatus.PENDING)]);
    await command.onStart(ctx(7));
    expect(groupLifecycleService.sendOwnerCard).not.toHaveBeenCalled();
  });
});

describe("/start — the bot owner's pending approval cards", () => {
  it('re-sends the card of every group still waiting, after a one-line count', async () => {
    const pending = [doc('P1', GroupStatus.PENDING), doc('P2', GroupStatus.PENDING)];
    groups([], pending);
    (groupMemberService.getUserGroups as jest.Mock).mockResolvedValue([]);
    const c = ctx(OWNER);
    await command.onStart(c);

    expect(c.reply.mock.calls[0][0]).toBe('🆕 2 groups are waiting for your approval:');
    expect(groupLifecycleService.sendOwnerCard).toHaveBeenCalledTimes(2);
    expect((groupLifecycleService.sendOwnerCard as jest.Mock).mock.calls.map((call) => call[1].groupName)).toEqual(['P1', 'P2']);
  });

  it('one group: singular wording', async () => {
    groups([], [doc('P1', GroupStatus.PENDING)]);
    const c = ctx(OWNER);
    await command.onStart(c);
    expect(c.reply.mock.calls[0][0]).toBe('🆕 1 group is waiting for your approval:');
  });

  it(`more than ${MAX_PENDING_CARDS}: the oldest ${MAX_PENDING_CARDS} cards, plus a button to all waiting groups in the admin app`, async () => {
    configService.adminUrl = 'https://admin.example.com';
    const pending = Array.from({ length: 8 }, (_, i) => doc(`P${i + 1}`, GroupStatus.PENDING));
    groups([], pending);
    const c = ctx(OWNER);
    await command.onStart(c);

    const [text, extra] = c.reply.mock.calls[0];
    expect(text).toBe(
      `🆕 More than ${MAX_PENDING_CARDS} groups are waiting for your approval — the oldest ${MAX_PENDING_CARDS} are below, the rest are in the admin app.`,
    );
    expect(extra.reply_markup.inline_keyboard).toEqual([[{ text: '🛠 All waiting groups', url: 'https://admin.example.com/groups?status=pending' }]]);
    expect(groupLifecycleService.sendOwnerCard).toHaveBeenCalledTimes(MAX_PENDING_CARDS);
  });

  it(`more than ${MAX_PENDING_CARDS} without ADMIN_URL: same text, no button`, async () => {
    groups([], Array.from({ length: 6 }, (_, i) => doc(`P${i + 1}`, GroupStatus.PENDING)));
    const c = ctx(OWNER);
    await command.onStart(c);
    expect(c.reply.mock.calls[0][1]).toEqual({});
    expect(groupLifecycleService.sendOwnerCard).toHaveBeenCalledTimes(MAX_PENDING_CARDS);
  });

  it('nothing waiting: no extra message', async () => {
    groups([], []);
    (groupMemberService.getUserGroups as jest.Mock).mockResolvedValue([]);
    const c = ctx(OWNER);
    await command.onStart(c);
    expect(c.reply).toHaveBeenCalledTimes(1);
    expect(c.reply.mock.calls[0][0]).toContain("Let's get your team set up");
  });
});
