import { GroupStatus } from '@tbot/shared';
import { statusCounts } from 'src/modules/overview/overview.service';
import { summariseJobs } from 'src/modules/system/system.service';
import { auditSummary } from 'src/shared/audit';
import {
  buildDailySeries,
  countActiveGroups,
  emptyDayStats,
  foldGroupActivity,
  fromStatsDoc,
  kpi,
  lastTrustedRollupDay,
  personName,
  roundUsd,
  sumBreakdown,
  sumSeries,
  topBy,
} from 'src/stats/aggregate';
import { daysBetween, rangeWindows } from 'src/stats/range';

jest.mock('@tbot/db', () => require('./helpers').dbMock());

describe('ranges', () => {
  it('builds the current and previous windows in UTC days', () => {
    const { current, previous } = rangeWindows('7d', new Date('2026-10-24T15:00:00Z'));
    expect(current.from).toBe('2026-10-18');
    expect(current.to).toBe('2026-10-24');
    expect(current.days).toHaveLength(7);
    expect(current.start.toISOString()).toBe('2026-10-18T00:00:00.000Z');
    expect(current.end.toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(previous.from).toBe('2026-10-11');
    expect(previous.to).toBe('2026-10-17');
  });

  it('crosses month boundaries', () => {
    expect(daysBetween('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  });
});

describe('rollup + live merge', () => {
  it('never trusts a rollup row for today', () => {
    expect(lastTrustedRollupDay('2026-10-24', '2026-10-24')).toBe('2026-10-23');
    expect(lastTrustedRollupDay('2026-10-20', '2026-10-24')).toBe('2026-10-20');
    expect(lastTrustedRollupDay(null, '2026-10-24')).toBeNull();
  });

  it('uses rollups up to lastRolled, live after, zeros for gaps', () => {
    const days = ['2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'];
    const rolled = [
      fromStatsDoc({ day: '2026-10-21', activeUsers: 5, aiCalls: 10, aiCostUsd: 0.1, channels: { telegram: 7 } }),
      // A stale partial rollup for a day after lastRolled must be ignored.
      fromStatsDoc({ day: '2026-10-23', activeUsers: 1, aiCalls: 1 }),
    ];
    const live = [
      { ...emptyDayStats('2026-10-23'), activeUsers: 4, aiCalls: 3, aiCostUsd: 0.2 },
      { ...emptyDayStats('2026-10-24'), activeUsers: 2, tasksCreated: 6, channels: { app: 2, mcp: 1 } },
      // Live rows inside the rolled-up period are ignored.
      { ...emptyDayStats('2026-10-21'), activeUsers: 99 },
    ];
    const series = buildDailySeries(days, rolled, live, '2026-10-22');
    expect(series.map((p) => p.activeUsers)).toEqual([5, 0, 4, 2]);
    expect(series[0].channels).toEqual({ telegram: 7 });
    expect(series[3].channels).toEqual({ app: 2, mcp: 1 });

    const totals = sumSeries(series);
    expect(totals.aiCalls).toBe(13);
    expect(totals.aiCostUsd).toBe(0.3);
    expect(totals.tasksCreated).toBe(6);
  });

  it('with no rollups everything is live', () => {
    const series = buildDailySeries(['2026-10-24'], [], [{ ...emptyDayStats('2026-10-24'), mcpCalls: 3 }], null);
    expect(series[0].mcpCalls).toBe(3);
  });
});

describe('group activity', () => {
  it('folds rows per group and counts active groups', () => {
    const rows = [
      { ...emptyDayStats('2026-10-01', 'a'), events: { command: 3, callback: 2 }, aiCalls: 1, aiCostUsd: 0.5 },
      { ...emptyDayStats('2026-10-02', 'a'), events: { command: 1 } },
      { ...emptyDayStats('2026-10-02', 'b'), tasksCreated: 1 },
      { ...emptyDayStats('2026-10-02', 'c') },
      { ...emptyDayStats('2026-10-02', null), events: { command: 100 } },
    ];
    const activity = foldGroupActivity(rows);
    expect(activity.get('a')).toEqual({ events: 6, aiCalls: 1, aiCostUsd: 0.5, tasksCreated: 0 });
    expect(activity.has('global')).toBe(false);
    expect(countActiveGroups(activity)).toBe(2);
    expect(topBy([...activity.entries()], (a) => a.events, 5).map(([id]) => id)).toEqual(['a']);
  });
});

describe('small helpers', () => {
  it('kpi + rounding', () => {
    expect(kpi(0.1 + 0.2, 1)).toEqual({ value: 0.3, previous: 1 });
    expect(roundUsd(0.0000004)).toBe(0);
  });

  it('sumBreakdown', () => {
    const row = { key: 'k', label: 'l', calls: 2, failed: 1, inputTokens: 10, outputTokens: 5, costUsd: 0.1, unpriced: 1 };
    expect(sumBreakdown([row, { ...row, costUsd: 0.2 }])).toEqual({ calls: 4, failed: 2, inputTokens: 20, outputTokens: 10, costUsd: 0.3, unpriced: 2 });
  });

  it('statusCounts fills every status', () => {
    const counts = statusCounts([{ _id: 'active', n: 3 }, { _id: 'bogus', n: 9 }]);
    expect(counts[GroupStatus.ACTIVE]).toBe(3);
    expect(counts[GroupStatus.PENDING]).toBe(0);
    expect(Object.keys(counts)).toHaveLength(6);
  });

  it('personName', () => {
    expect(personName({ telegramUserId: 1, firstName: 'An', lastName: 'Nguyen', username: 'an' })).toBe('An Nguyen');
    expect(personName({ telegramUserId: 1, username: 'an' })).toBe('@an');
    expect(personName({ telegramUserId: 1 })).toBe('User 1');
  });

  it('summariseJobs reports the last run and an error only if it is newer than the last success', () => {
    const jobs = summariseJobs(
      [{ name: 'due-reminder', cron: '5 * * * *' }, { name: 'daily-digest', cron: '0 * * * *' }],
      [
        { name: 'due-reminder', finishedOn: 2000 },
        { name: 'daily-digest', finishedOn: 5000 },
      ],
      [
        { name: 'due-reminder', finishedOn: 3000, failedReason: 'boom' },
        { name: 'daily-digest', finishedOn: 4000, failedReason: 'old' },
      ],
    );
    expect(jobs).toEqual([
      expect.objectContaining({ name: 'due-reminder', cron: '5 * * * *', lastRunAt: new Date(3000).toISOString(), lastError: 'boom', lastSuccessAt: new Date(2000).toISOString() }),
      expect.objectContaining({ name: 'daily-digest', cron: '0 * * * *', lastRunAt: new Date(5000).toISOString(), lastError: null }),
    ]);
  });

  it('summariseJobs keeps one row per schedule of the same job and counts failures in the last 24h', () => {
    const now = 10 * 86_400_000;
    const jobs = summariseJobs(
      [
        { name: 'stats-rollup', cron: '10 0 * * *', next: now + 1000 },
        { name: 'stats-rollup', cron: '20 * * * *' },
      ],
      [{ name: 'stats-rollup', cron: '10 0 * * *', finishedOn: now - 5000 }],
      [
        { name: 'stats-rollup', cron: '20 * * * *', finishedOn: now - 1000, failedReason: 'mongo down' },
        { name: 'stats-rollup', cron: '20 * * * *', finishedOn: now - 2 * 86_400_000, failedReason: 'old' },
      ],
      now,
    );
    expect(jobs).toHaveLength(2);
    expect(jobs[0]).toMatchObject({ key: 'stats-rollup|10 0 * * *', lastError: null, failuresLast24h: 0, nextRunAt: new Date(now + 1000).toISOString() });
    expect(jobs[1]).toMatchObject({ key: 'stats-rollup|20 * * * *', lastError: 'mongo down', failuresLast24h: 1, lastSuccessAt: null });
  });

  it('audit summaries read as sentences', () => {
    expect(auditSummary('group.suspend', 'Acme Mobile Team')).toBe('Suspended group “Acme Mobile Team”');
    expect(auditSummary('auth.login', null)).toBe('Signed in to the admin app');
  });
});
