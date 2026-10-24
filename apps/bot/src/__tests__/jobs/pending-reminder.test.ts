import { configService } from 'src/configs/configuration';
import { Group } from 'src/database/models/group.model';
import { pendingReminderText, remindOwnerOfPendingGroups } from 'src/jobs/pending-reminder';
import { redisService } from 'src/shared/services/redis.service';

jest.mock('src/database/models/group.model', () => ({ Group: { find: jest.fn() } }));
jest.mock('src/shared/services/redis.service', () => ({ redisService: { set: jest.fn() } }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const now = new Date('2026-10-24T05:20:00Z');
const found = (rows: unknown[]) =>
  (Group.find as jest.Mock).mockReturnValue({ sort: () => ({ select: () => ({ lean: () => Promise.resolve(rows) }) }) });

beforeEach(() => {
  configService.botOwnerTelegramId = 42;
  configService.adminUrl = '';
  (redisService.set as jest.Mock).mockResolvedValue('OK');
});

describe('pendingReminderText', () => {
  it('lists how long each group waited and how to act', () => {
    const text = pendingReminderText([
      { name: 'Team Alpha', hoursWaiting: 30 },
      { name: 'Book Club', hoursWaiting: 80 },
    ]);
    expect(text).toContain('2 groups have been waiting');
    expect(text).toContain('• Team Alpha — waiting 30h');
    expect(text).toContain('• Book Club — waiting 3 days');
    expect(text).toContain('Send /start');
    expect(pendingReminderText([{ name: 'X', hoursWaiting: 25 }], 'https://admin.example')).toContain(
      'https://admin.example/groups?status=pending',
    );
  });
});

describe('remindOwnerOfPendingGroups', () => {
  it('DMs the owner once per UTC day when a group waited over 24h', async () => {
    found([{ groupName: 'Team Alpha', addedAt: new Date('2026-10-23T01:00:00Z') }]);
    const notify = jest.fn().mockResolvedValue(undefined);
    expect(await remindOwnerOfPendingGroups(notify, now)).toBe(true);
    expect(notify).toHaveBeenCalledWith(42, expect.stringContaining('Team Alpha — waiting 28h'));
    expect(redisService.set).toHaveBeenCalledWith('pending-reminder:2026-10-24', '1', { NX: true, EX: 172800 });

    (redisService.set as jest.Mock).mockResolvedValue(null);
    expect(await remindOwnerOfPendingGroups(notify, now)).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('stays quiet with nothing overdue or no owner', async () => {
    found([]);
    const notify = jest.fn();
    expect(await remindOwnerOfPendingGroups(notify, now)).toBe(false);
    configService.botOwnerTelegramId = null;
    expect(await remindOwnerOfPendingGroups(notify, now)).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});
