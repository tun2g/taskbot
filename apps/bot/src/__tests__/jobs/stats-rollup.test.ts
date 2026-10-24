import mongoose from 'mongoose';
import { configService } from 'src/configs/configuration';
import { Group } from 'src/database/models/group.model';
import { StatsDaily } from 'src/database/models/stats-daily.model';
import {
  budgetAlertText,
  findSpikes,
  reachedThresholds,
  runAiAlerts,
  spikeAlertText,
} from 'src/jobs/ai-alerts';
import { redisService } from 'src/shared/services/redis.service';
import { DEFAULT_AI_SETTINGS, settingsService } from 'src/shared/services/settings.service';
import {
  addDays,
  buildDailyRows,
  DailyRow,
  DayAggregates,
  mergeTaskCounts,
  NO_GROUP,
} from 'src/shared/services/stats/daily-stats';

jest.mock('src/database/models/stats-daily.model', () => ({ StatsDaily: { find: jest.fn(), bulkWrite: jest.fn() } }));
jest.mock('src/database/models/group.model', () => ({ Group: { find: jest.fn() } }));
jest.mock('src/shared/services/redis.service', () => ({ redisService: { set: jest.fn() } }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const A = new mongoose.Types.ObjectId().toString();
const B = new mongoose.Types.ObjectId().toString();

describe('buildDailyRows', () => {
  const agg: DayAggregates = {
    usage: [
      { group: A, kind: 'command', channel: 'telegram', count: 5 },
      { group: A, kind: 'api', channel: 'app', count: 3 },
      { group: B, kind: 'mcp_tool', channel: 'mcp', count: 4 },
      { group: B, kind: 'rate_limited', channel: 'telegram', count: 2 },
      { group: NO_GROUP, kind: 'command', channel: 'telegram', count: 1 },
    ],
    activeUsersByGroup: { [A]: 2, [B]: 2, [NO_GROUP]: 1 },
    // The same person is active in both groups: the global count is distinct, not 2 + 2 + 1.
    activeUsersTotal: 3,
    ai: [
      { group: A, calls: 10, failed: 1, inputTokens: 1000, outputTokens: 200, costUsd: 0.0123, unpriced: 0 },
      { group: NO_GROUP, calls: 2, failed: 0, inputTokens: 100, outputTokens: 20, costUsd: 0.001, unpriced: 2 },
    ],
    tasksCreated: { [A]: 4, [B]: 1 },
    tasksCompleted: { [A]: 2 },
  };

  it('one row per group plus a global row', () => {
    const rows = buildDailyRows('2026-10-23', agg);
    const byGroup = Object.fromEntries(rows.map((r) => [r.groupId ?? 'global', r]));
    expect(Object.keys(byGroup).sort()).toEqual([A, B, 'global'].sort());

    expect(byGroup[A]).toEqual(
      expect.objectContaining({
        day: '2026-10-23',
        activeUsers: 2,
        events: { command: 5, api: 3 },
        channels: { telegram: 5, app: 3 },
        aiCalls: 10,
        aiFailed: 1,
        aiCostUsd: 0.0123,
        tasksCreated: 4,
        tasksCompleted: 2,
        mcpCalls: 0,
      }),
    );
    expect(byGroup[B]).toEqual(expect.objectContaining({ mcpCalls: 4, rateLimited: 2, aiCalls: 0, tasksCreated: 1 }));
  });

  it('the global row sums everything (no-group data included) with distinct active users', () => {
    const global = buildDailyRows('2026-10-23', agg).find((r) => r.groupId === null)!;
    expect(global).toEqual(
      expect.objectContaining({
        activeUsers: 3,
        events: { command: 6, api: 3, mcp_tool: 4, rate_limited: 2 },
        channels: { telegram: 8, app: 3, mcp: 4 },
        aiCalls: 12,
        aiFailed: 1,
        aiInputTokens: 1100,
        aiOutputTokens: 220,
        aiCostUsd: 0.0133,
        aiUnpriced: 2,
        tasksCreated: 5,
        tasksCompleted: 2,
        mcpCalls: 4,
        rateLimited: 2,
      }),
    );
  });

  it('an empty day still has a global row of zeros', () => {
    const rows = buildDailyRows('2026-10-23', {
      usage: [],
      activeUsersByGroup: {},
      activeUsersTotal: 0,
      ai: [],
      tasksCreated: {},
      tasksCompleted: {},
    });
    expect(rows).toEqual([expect.objectContaining({ groupId: null, aiCalls: 0, activeUsers: 0 })]);
  });
});

describe('mergeTaskCounts', () => {
  it('created = max(tasks still there, "created" log rows); completed from status → Done', () => {
    const g = new mongoose.Types.ObjectId();
    const out = mergeTaskCounts(
      [{ _id: { day: '2026-10-01', g }, n: 3 }],
      [
        { _id: { day: '2026-10-01', g }, n: 5 }, // two were deleted since
        { _id: { day: '2026-10-02', g }, n: 1 },
      ],
      [{ _id: { day: '2026-10-02', g }, n: 2 }],
    );
    expect(out).toEqual({
      '2026-10-01': { [String(g)]: { created: 5, completed: 0 } },
      '2026-10-02': { [String(g)]: { created: 1, completed: 2 } },
    });
  });

  it('addDays crosses months', () => {
    expect(addDays('2026-11-01', -1)).toBe('2026-10-31');
  });
});

// ── Alerts ──────────────────────────────────────────────────────────────────

const row = (groupId: string | null, patch: Partial<DailyRow>): DailyRow => ({
  day: '2026-10-24',
  groupId,
  activeUsers: 0,
  events: {},
  channels: {},
  tasksCreated: 0,
  tasksCompleted: 0,
  aiCalls: 0,
  aiFailed: 0,
  aiInputTokens: 0,
  aiOutputTokens: 0,
  aiCostUsd: 0,
  aiUnpriced: 0,
  mcpCalls: 0,
  rateLimited: 0,
  ...patch,
});
const lean = (docs: unknown[]) => ({ lean: async () => docs });

describe('budget thresholds', () => {
  it('alert % and 100%, highest first', () => {
    expect(reachedThresholds(3.9, 5, 80)).toEqual([]);
    expect(reachedThresholds(4, 5, 80)).toEqual([80]);
    expect(reachedThresholds(5.2, 5, 80)).toEqual([100, 80]);
    expect(reachedThresholds(9, null, 80)).toEqual([]);
    expect(reachedThresholds(5, 5, 100)).toEqual([100]);
  });

  it('message: cost, budget, top groups', () => {
    const text = budgetAlertText({
      costUsd: 4.12,
      budgetUsd: 5,
      threshold: 80,
      calls: 640,
      unpriced: 0,
      topGroups: [
        { name: 'Acme Mobile Team', costUsd: 2.1, calls: 310 },
        { name: 'Design Crew', costUsd: 1.2, calls: 150 },
      ],
    });
    expect(text).toContain('82% of your daily budget: $4.12 of $5.00');
    expect(text).toContain('1. Acme Mobile Team — $2.10 (310 calls)');
    expect(text).toContain('AI calls today: 640.');
  });
});

describe('spikes', () => {
  it('today > 5× the 7-day daily average and > 30 calls', () => {
    const today = [row(A, { aiCalls: 120 }), row(B, { aiCalls: 31 }), row(null, { aiCalls: 151 })];
    // A: 7 × 20 = 140 → average 20, 120 > 100 ✓ ; B: 70 → average 10, 31 < 50 ✗
    expect(findSpikes(today, { [A]: 140, [B]: 70 })).toEqual([{ groupId: A, calls: 120, costUsd: 0, average: 20 }]);
    // A quiet group with no history but only 25 calls is not a spike.
    expect(findSpikes([row(B, { aiCalls: 25 })], {})).toEqual([]);
    expect(spikeAlertText('Acme', { groupId: A, calls: 120, costUsd: 0.5, average: 20 })).toContain('usually about 20 a day');
  });
});

describe('runAiAlerts', () => {
  const claimed = new Set<string>();
  const notify = jest.fn(async () => undefined);

  beforeEach(() => {
    jest.clearAllMocks();
    claimed.clear();
    (redisService.set as jest.Mock).mockImplementation(async (key: string) => (claimed.has(key) ? null : (claimed.add(key), 'OK')));
    (StatsDaily.find as jest.Mock).mockReturnValue(lean([]));
    (Group.find as jest.Mock).mockReturnValue(lean([{ _id: A, groupName: 'Acme' }, { _id: B, groupName: 'Design' }]));
    jest.spyOn(settingsService, 'getAi').mockResolvedValue({ ...DEFAULT_AI_SETTINGS, dailyBudgetUsd: 5, alertAtPercent: 80 });
    configService.botOwnerTelegramId = 42;
  });
  afterAll(() => {
    configService.botOwnerTelegramId = null;
  });

  const day = (cost: number) => [row(A, { aiCostUsd: cost * 0.7, aiCalls: 20 }), row(B, { aiCostUsd: cost * 0.3, aiCalls: 10 }), row(null, { aiCostUsd: cost, aiCalls: 30 })];

  it('once per threshold per day: 80% once, then 100% once', async () => {
    await runAiAlerts('2026-10-24', day(4.2), notify);
    await runAiAlerts('2026-10-24', day(4.6), notify);
    await runAiAlerts('2026-10-24', day(5.1), notify);
    await runAiAlerts('2026-10-24', day(6), notify);
    expect(notify).toHaveBeenCalledTimes(2);
    expect((notify.mock.calls[0] as unknown[])[0]).toBe(42);
    expect((notify.mock.calls[0] as unknown[])[1]).toContain('⚠️ AI spend today is at 84%');
    expect((notify.mock.calls[1] as unknown[])[1]).toContain('🛑 AI spend today reached your daily budget');
  });

  it('jumping straight past 100% sends one message (the 100% one) and claims both', async () => {
    await runAiAlerts('2026-10-24', day(7), notify);
    expect(notify).toHaveBeenCalledTimes(1);
    expect((notify.mock.calls[0] as unknown[])[1]).toContain('reached your daily budget');
    expect(claimed).toEqual(new Set(['ai_budget_alert:2026-10-24:100', 'ai_budget_alert:2026-10-24:80']));
    // A new day starts over.
    await runAiAlerts('2026-10-25', day(4.5), notify);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('top groups by cost in the message', async () => {
    await runAiAlerts('2026-10-24', day(4.5), notify);
    const text = (notify.mock.calls[0] as unknown[])[1] as string;
    expect(text.indexOf('1. Acme')).toBeGreaterThan(0);
    expect(text.indexOf('2. Design')).toBeGreaterThan(text.indexOf('1. Acme'));
  });

  it('no budget or no owner → nothing', async () => {
    jest.spyOn(settingsService, 'getAi').mockResolvedValue({ ...DEFAULT_AI_SETTINGS });
    await runAiAlerts('2026-10-24', day(100), notify);
    configService.botOwnerTelegramId = null;
    jest.spyOn(settingsService, 'getAi').mockResolvedValue({ ...DEFAULT_AI_SETTINGS, dailyBudgetUsd: 1 });
    await runAiAlerts('2026-10-24', day(100), notify);
    expect(notify).not.toHaveBeenCalled();
  });

  it('a spiking group is reported once per day', async () => {
    jest.spyOn(settingsService, 'getAi').mockResolvedValue({ ...DEFAULT_AI_SETTINGS });
    (StatsDaily.find as jest.Mock).mockReturnValue(lean([{ groupId: A, aiCalls: 7 }]));
    const rows = [row(A, { aiCalls: 40, aiCostUsd: 0.2 }), row(null, { aiCalls: 40 })];
    await runAiAlerts('2026-10-24', rows, notify);
    await runAiAlerts('2026-10-24', rows, notify);
    expect(notify).toHaveBeenCalledTimes(1);
    expect((notify.mock.calls[0] as unknown[])[1]).toContain('📈 Unusual AI use in “Acme”');
  });
});
