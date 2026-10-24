import { formatRetryAfter } from 'src/shared/services/ai-quota';
import { rateLimitService } from 'src/shared/services/rate-limit.service';
import { redisService } from 'src/shared/services/redis.service';

jest.mock('src/shared/services/redis.service', () => ({
  redisService: { incr: jest.fn(), expire: jest.fn(), ttl: jest.fn() },
}));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const redis = redisService as unknown as Record<'incr' | 'expire' | 'ttl', jest.Mock>;

beforeEach(() => jest.clearAllMocks());

describe('rateLimitService.checkRateLimit', () => {
  it('counts with INCR first and starts the window on the first hit', async () => {
    redis.incr.mockResolvedValue(1);
    await expect(rateLimitService.checkRateLimit(7, 'x', 3, 60)).resolves.toEqual({
      allowed: true,
      remaining: 2,
      retryAfterSeconds: 0,
    });
    expect(redis.incr).toHaveBeenCalledWith('ratelimit:x:7');
    expect(redis.expire).toHaveBeenCalledWith('ratelimit:x:7', 60);
  });

  it('allows exactly `limit` hits, then denies with the remaining window', async () => {
    redis.incr.mockResolvedValue(3);
    expect((await rateLimitService.checkRateLimit(7, 'x', 3, 60)).allowed).toBe(true);
    redis.incr.mockResolvedValue(4);
    redis.ttl.mockResolvedValue(25);
    await expect(rateLimitService.checkRateLimit(7, 'x', 3, 60)).resolves.toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 25,
    });
    expect(redis.expire).not.toHaveBeenCalled();
  });

  it('repairs a key that lost its TTL instead of blocking forever', async () => {
    redis.incr.mockResolvedValue(9);
    redis.ttl.mockResolvedValue(-1);
    const result = await rateLimitService.checkRateLimit(7, 'x', 3, 60);
    expect(result).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
    expect(redis.expire).toHaveBeenCalledWith('ratelimit:x:7', 60);
  });

  it('fails open when Redis is down', async () => {
    redis.incr.mockRejectedValue(new Error('down'));
    expect((await rateLimitService.checkRateLimit(7, 'x', 3, 60)).allowed).toBe(true);
  });
});

describe('formatRetryAfter', () => {
  it.each([
    [45, '45s'],
    [600, '10 min'],
    [5 * 3600 + 1, '6h'],
  ])('%i → %s', (seconds, text) => expect(formatRetryAfter(seconds)).toBe(text));
});
