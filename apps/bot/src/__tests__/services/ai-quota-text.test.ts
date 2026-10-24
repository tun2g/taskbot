import { aiGroupLimitText, aiLimitText, aiResetTime } from 'src/shared/services/ai-quota';

jest.mock('src/configs/configuration', () => ({ configService: { timezone: 'Asia/Ho_Chi_Minh' } }));
jest.mock('src/shared/services/rate-limit.service', () => ({ rateLimitService: {} }));
jest.mock('src/shared/services/settings.service', () => ({ settingsService: {} }));

describe('AI limit texts', () => {
  // Daily limits reset at midnight UTC = 07:00 in Ho Chi Minh City.
  it('says when the daily limit comes back, in the group clock', () => {
    expect(aiResetTime('Asia/Ho_Chi_Minh', new Date('2026-10-24T02:00:00Z'))).toBe('tomorrow at 07:00 (in 22h)');
    expect(aiResetTime('Asia/Ho_Chi_Minh', new Date('2026-10-24T20:00:00Z'))).toBe('at 07:00 (in 4h)');
    expect(aiResetTime('America/New_York', new Date('2026-10-24T20:00:00Z'))).toBe('at 20:00 (in 4h)');
    expect(aiResetTime('Not/AZone', new Date('2026-10-24T23:59:30Z'))).toBe('tomorrow at 00:00 (in 30s)');
  });

  it('tells the per-minute limit from the daily one', () => {
    const now = new Date('2026-10-24T20:00:00Z');
    expect(aiLimitText('user', { scope: 'minute', retryAfterSeconds: 40 }, 'UTC', now)).toBe(
      'Too many AI requests in a row — try again in 40s.',
    );
    expect(aiLimitText('user', { scope: 'day', retryAfterSeconds: 14400, limit: 100 }, 'Asia/Ho_Chi_Minh', now)).toBe(
      "You've used all your AI requests for today (100). They come back at 07:00 (in 4h).",
    );
    // An older limiter result without a scope: a wait of hours is the daily limit.
    expect(aiLimitText('user', { retryAfterSeconds: 5 * 3600 }, 'UTC', now)).toContain('for today');
  });

  it("group: the owner's daily limit vs the 10-minute one", () => {
    expect(aiGroupLimitText({ ai: { dailyLimit: 50 }, timezone: 'Asia/Ho_Chi_Minh' })).toMatch(
      /^This group has used all its AI requests for today\. They come back (tomorrow )?at 07:00/,
    );
    // A group on UTC uses the bot's default zone, like due dates.
    expect(aiGroupLimitText({ ai: { dailyLimit: 50 }, timezone: 'UTC' })).toContain('07:00');
    expect(aiGroupLimitText({ ai: { dailyLimit: null } })).toBe(
      'This group has made a lot of AI requests in the last 10 minutes — try again in a few minutes.',
    );
  });

  it('group 10-minute limit: says exactly how long to wait (from the limiter TTL)', () => {
    expect(aiGroupLimitText({ ai: { dailyLimit: null } }, { scope: 'minute', retryAfterSeconds: 240 })).toBe(
      'This group has made a lot of AI requests in the last 10 minutes — try again in 4 min.',
    );
    expect(aiGroupLimitText(null, { scope: 'minute', retryAfterSeconds: 45 })).toContain('try again in 45s');
    // The limiter result decides which limit it was.
    expect(aiGroupLimitText({ ai: { dailyLimit: 5 } }, { scope: 'day', retryAfterSeconds: 3600 })).toContain('for today');
  });
});
