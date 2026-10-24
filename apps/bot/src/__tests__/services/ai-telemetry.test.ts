import { AiFeature } from '@tbot/shared';
import mongoose from 'mongoose';
import { z } from 'zod';
import { configService } from 'src/configs/configuration';
import { AiCall } from 'src/database/models/ai-call.model';
import { computeCost, findPrice, mergePricing } from 'src/shared/services/ai/ai-cost';
import { AiProviderError, EMPTY_USAGE, usageFromGemini, usageFromOpenAI } from 'src/shared/services/ai/ai.interface';
import { AIUnavailableError, aiService } from 'src/shared/services/ai/ai.service';
import { FuseProvider } from 'src/shared/services/ai/fuse.provider';
import { GeminiProvider } from 'src/shared/services/ai/gemini.provider';
import { OpenAIProvider } from 'src/shared/services/ai/openai.provider';
import {
  AI_USER_DAILY_LIMIT,
  aiDisabledBy,
  checkUserAiDailyLimit,
  withAiScope,
} from 'src/shared/services/ai-quota';
import { rateLimitService } from 'src/shared/services/rate-limit.service';
import { DEFAULT_AI_SETTINGS, settingsService } from 'src/shared/services/settings.service';
import { checkGroupAiRateLimit } from 'src/shared/services/task-creation.service';
import { currentContext, withContext } from 'src/shared/services/telemetry/request-context';
import { telemetry } from 'src/shared/services/telemetry/usage-tracker';

jest.mock('src/database/models/ai-call.model', () => ({ AiCall: { create: jest.fn(async (row: unknown) => row) } }));
jest.mock('src/shared/services/rate-limit.service', () => ({ rateLimitService: { checkRateLimit: jest.fn() } }));
jest.mock('src/shared/services/redis.service', () => ({ redisService: {} }));
jest.mock('src/shared/logger/logger', () => ({ info: jest.fn(), error: jest.fn(), warn: jest.fn() }));

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};
const rows = () => (AiCall.create as jest.Mock).mock.calls.map(([row]) => row);
const completion = (text: string, usage = { inputTokens: 1000, cachedTokens: 200, outputTokens: 300, thinkingTokens: 100 }) => ({
  text,
  usage,
  model: 'gemini-3.5-flash-lite',
});
const schema = z.object({ ok: z.boolean() });
const allowed = { allowed: true, remaining: 1, retryAfterSeconds: 0 };

beforeEach(() => {
  jest.restoreAllMocks();
  (AiCall.create as jest.Mock).mockClear();
  (rateLimitService.checkRateLimit as jest.Mock).mockReset().mockResolvedValue(allowed);
  jest.spyOn(settingsService, 'getAi').mockResolvedValue({ ...DEFAULT_AI_SETTINGS });
  telemetry.enabled = true;
  configService.ai.apiKey = 'test-key';
});
afterAll(() => {
  telemetry.enabled = false;
  configService.ai.apiKey = '';
});

// ── Provider usage parsing ──────────────────────────────────────────────────

describe('provider usage parsing', () => {
  it('Gemini: thinking is billed as output and also reported on its own', () => {
    expect(
      usageFromGemini({ promptTokenCount: 1200, cachedContentTokenCount: 400, candidatesTokenCount: 150, thoughtsTokenCount: 50 }),
    ).toEqual({ inputTokens: 1200, cachedTokens: 400, outputTokens: 200, thinkingTokens: 50 });
    expect(usageFromGemini(undefined)).toEqual(EMPTY_USAGE);
  });

  it('OpenAI-compatible: cached and reasoning details', () => {
    expect(
      usageFromOpenAI({
        prompt_tokens: 900,
        completion_tokens: 120,
        prompt_tokens_details: { cached_tokens: 300 },
        completion_tokens_details: { reasoning_tokens: 64 },
      }),
    ).toEqual({ inputTokens: 900, cachedTokens: 300, outputTokens: 120, thinkingTokens: 64 });
    expect(usageFromOpenAI({ prompt_tokens: 10, completion_tokens: 5 })).toEqual({
      inputTokens: 10,
      cachedTokens: 0,
      outputTokens: 5,
      thinkingTokens: 0,
    });
  });

  it('GeminiProvider returns text, usage and the served model version', () => {
    const provider = new GeminiProvider();
    const result = {
      response: {
        text: () => '{"ok":true}',
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, thoughtsTokenCount: 6, cachedContentTokenCount: 0 },
        modelVersion: 'gemini-3.5-flash-lite-001',
      },
    };
    expect(provider.toCompletion(result as never)).toEqual({
      text: '{"ok":true}',
      usage: { inputTokens: 10, cachedTokens: 0, outputTokens: 10, thinkingTokens: 6 },
      model: 'gemini-3.5-flash-lite-001',
    });
  });

  describe('HTTP providers', () => {
    const originalFetch = global.fetch;
    const originalModel = configService.ai.model;
    afterEach(() => {
      global.fetch = originalFetch;
      configService.ai.model = originalModel;
    });
    const respond = (body: unknown) =>
      (global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => body }) as unknown as typeof fetch);

    it('OpenAIProvider parses usage and the model from the response', async () => {
      respond({
        model: 'gpt-5-mini-2025-08-07',
        choices: [{ message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 50, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 10 }, completion_tokens_details: { reasoning_tokens: 8 } },
      });
      const out = await new OpenAIProvider().generateJson({ system: 's', user: 'u' });
      expect(out).toEqual({
        text: '{"ok":true}',
        usage: { inputTokens: 50, cachedTokens: 10, outputTokens: 20, thinkingTokens: 8 },
        model: 'gpt-5-mini-2025-08-07',
      });
    });

    it('OpenAIProvider keeps the billed usage of a refusal on the error', async () => {
      respond({ choices: [{ message: { role: 'assistant', content: null, refusal: 'no' }, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 3 } });
      const error = await new OpenAIProvider().generateJson({ system: 's', user: 'u' }).catch((e) => e);
      expect(error).toBeInstanceOf(AiProviderError);
      expect(error.usage).toEqual(expect.objectContaining({ inputTokens: 7, outputTokens: 3 }));
    });

    it('FuseProvider sends the configured model (not a hard-coded one) and parses usage', async () => {
      configService.ai.model = 'claude-sonnet-4.5';
      respond({ model: 'claude-sonnet-4.5', choices: [{ message: { content: 'hi' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } });
      const out = await new FuseProvider().chat([{ role: 'user', content: 'hello' }]);
      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      expect(body.model).toBe('claude-sonnet-4.5');
      expect(out).toEqual({ text: 'hi', usage: { inputTokens: 3, cachedTokens: 0, outputTokens: 2, thinkingTokens: 0 }, model: 'claude-sonnet-4.5' });
    });
  });
});

// ── Cost ────────────────────────────────────────────────────────────────────

describe('AI cost', () => {
  const table = { 'gpt-5': { input: 1, output: 10 }, 'gpt-5-mini': { input: 0.25, cachedInput: 0.025, output: 2 } };

  it('bills cached input at the cached price and output (thinking included) at the output price', () => {
    // 800 fresh × 0.25 + 200 cached × 0.025 + 300 output × 2 = 200 + 5 + 600 = 805 per 1M
    expect(computeCost('gpt-5-mini', { inputTokens: 1000, cachedTokens: 200, outputTokens: 300, thinkingTokens: 100 }, table)).toEqual({
      costUsd: 0.000805,
      priced: true,
    });
  });

  it('cached tokens default to the input price when the model has no cached price', () => {
    expect(computeCost('gpt-5', { inputTokens: 1000, cachedTokens: 500, outputTokens: 0, thinkingTokens: 0 }, table).costUsd).toBe(0.001);
  });

  it('unknown model → cost 0, not priced', () => {
    expect(computeCost('mystery-1', { inputTokens: 1000, cachedTokens: 0, outputTokens: 10, thinkingTokens: 0 }, table)).toEqual({
      costUsd: 0,
      priced: false,
    });
  });

  it('dated snapshots and provider prefixes use the family price; mini never falls back to its big sibling', () => {
    expect(findPrice('gpt-5-mini-2025-08-07', table)).toBe(table['gpt-5-mini']);
    expect(findPrice('openai/GPT-5', table)).toBe(table['gpt-5']);
    expect(findPrice('gpt-5-nano', table)).toBeNull();
  });

  it("the owner's pricing overrides win over the built-in table", () => {
    const merged = mergePricing({ 'gemini-3.5-flash-lite': { input: 9, output: 9 } });
    expect(merged['gemini-3.5-flash-lite']).toEqual({ input: 9, output: 9 });
    expect(merged['gpt-5-mini']).toBeDefined();
  });
});

// ── AiCall recording ────────────────────────────────────────────────────────

describe('aiService records every provider attempt', () => {
  const group = { _id: new mongoose.Types.ObjectId(), ai: { disabled: false, dailyLimit: null } };
  const user = { _id: new mongoose.Types.ObjectId(), ai: { disabled: false, dailyLimit: null } };

  it('ok call: tokens, cost, feature, group, person and channel', async () => {
    jest.spyOn(aiService, 'generateJsonCompletion').mockResolvedValue(completion('{"ok":true}'));
    await withAiScope(AiFeature.EXTRACT, { group, user, channel: 'app' }, () => aiService.generateJson({ system: 's', user: 'u' }, schema));
    await settle();
    expect(rows()).toEqual([
      expect.objectContaining({
        feature: 'extract',
        provider: 'gemini',
        aiModel: 'gemini-3.5-flash-lite',
        status: 'ok',
        attempt: 1,
        inputTokens: 1000,
        cachedTokens: 200,
        outputTokens: 300,
        thinkingTokens: 100,
        // 800 × 0.1 + 200 × 0.025 + 300 × 0.4 = 80 + 5 + 120 = 205 per 1M
        costUsd: 0.000205,
        priced: true,
        groupId: String(group._id),
        userId: String(user._id),
        channel: 'app',
        error: null,
      }),
    ]);
  });

  it('an invalid answer and its retry are two rows', async () => {
    jest
      .spyOn(aiService, 'generateJsonCompletion')
      .mockResolvedValueOnce(completion('nope'))
      .mockResolvedValueOnce(completion('{"ok":true}'));
    await aiService.generateJson({ system: 's', user: 'u' }, schema);
    await settle();
    expect(rows().map((r) => [r.status, r.attempt, r.feature])).toEqual([
      ['invalid', 1, 'other'],
      ['ok', 2, 'other'],
    ]);
  });

  it('a provider failure is recorded (with billed usage when the provider reported it)', async () => {
    jest
      .spyOn(aiService, 'generateJsonCompletion')
      .mockRejectedValue(new AiProviderError('Rate limit exceeded', { inputTokens: 5, cachedTokens: 0, outputTokens: 1, thinkingTokens: 0 }));
    await expect(aiService.generateJson({ system: 's', user: 'u' }, schema)).rejects.toMatchObject({ reason: 'failed' });
    await settle();
    expect(rows()).toEqual([expect.objectContaining({ status: 'failed', attempt: 1, inputTokens: 5, error: 'Rate limit exceeded' })]);
  });

  it('a refusal by the daily call cap is a "quota" row; the cap comes from Settings over AI_DAILY_LIMIT', async () => {
    jest.spyOn(settingsService, 'getAi').mockResolvedValue({ ...DEFAULT_AI_SETTINGS, dailyCallLimit: 7 });
    (rateLimitService.checkRateLimit as jest.Mock).mockResolvedValue({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
    const call = jest.spyOn(aiService, 'generateJsonCompletion');
    await expect(aiService.generateJson({ system: 's', user: 'u' }, schema)).rejects.toMatchObject({ reason: 'quota' });
    await settle();
    expect(rateLimitService.checkRateLimit).toHaveBeenCalledWith('all', expect.stringMatching(/^ai_daily_budget:\d{4}-\d{2}-\d{2}$/), 7, expect.any(Number));
    expect(call).not.toHaveBeenCalled();
    expect(rows()).toEqual([expect.objectContaining({ status: 'quota', inputTokens: 0, costUsd: 0 })]);
  });

  it('an unknown model is recorded as unpriced', async () => {
    jest.spyOn(aiService, 'generateJsonCompletion').mockResolvedValue({ ...completion('{"ok":true}'), model: 'brand-new-model' });
    await aiService.generateJson({ system: 's', user: 'u' }, schema);
    await settle();
    expect(rows()[0]).toEqual(expect.objectContaining({ aiModel: 'brand-new-model', costUsd: 0, priced: false }));
  });

  it('nested features are tagged per call (planner → explain → planner) and the entry channel wins', async () => {
    jest.spyOn(aiService, 'generateJsonCompletion').mockResolvedValue(completion('{"ok":true}'));
    const ask = () => aiService.generateJson({ system: 's', user: 'u' }, schema);
    await withContext({ channel: 'mcp' }, () =>
      withAiScope(AiFeature.PLANNER, { group, user, channel: 'telegram' }, async () => {
        await ask();
        await withAiScope(AiFeature.EXPLAIN, { group, user }, ask);
        await ask();
      }),
    );
    await settle();
    expect(rows().map((r) => [r.feature, r.channel])).toEqual([
      ['planner', 'mcp'],
      ['explain', 'mcp'],
      ['planner', 'mcp'],
    ]);
  });

  it('parallel requests keep their own context', async () => {
    jest.spyOn(aiService, 'generateJsonCompletion').mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return completion('{"ok":true}');
    });
    const other = { _id: new mongoose.Types.ObjectId(), ai: { disabled: false, dailyLimit: null } };
    await Promise.all([
      withAiScope(AiFeature.BREAKDOWN, { group, user }, () => aiService.generateJson({ system: 's', user: 'u' }, schema)),
      withAiScope(AiFeature.EXPLAIN, { group: other, user }, () => aiService.generateJson({ system: 's', user: 'u' }, schema)),
    ]);
    await settle();
    expect(rows().map((r) => [r.feature, r.groupId]).sort()).toEqual(
      [
        ['breakdown', String(group._id)],
        ['explain', String(other._id)],
      ].sort(),
    );
  });
});

// ── Owner overrides ─────────────────────────────────────────────────────────

describe('AI overrides', () => {
  const id = () => new mongoose.Types.ObjectId();

  it('group / person switch: refused as "disabled", no provider call, one zero-cost "disabled" row', async () => {
    const call = jest.spyOn(aiService, 'generateJsonCompletion');
    const group = { _id: id(), ai: { disabled: true, dailyLimit: null } };
    const error = await withAiScope(AiFeature.PLANNER, { group, user: { _id: id() } }, () =>
      aiService.generateJson({ system: 's', user: 'u' }, schema),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(AIUnavailableError);
    expect(error.reason).toBe('disabled');
    expect(call).not.toHaveBeenCalled();
    await settle();
    expect(rows()).toEqual([expect.objectContaining({ status: 'disabled', costUsd: 0, inputTokens: 0, feature: AiFeature.PLANNER })]);
    expect(String(rows()[0].groupId)).toBe(String(group._id));
  });

  it('aiDisabledBy: the group switch first, then the person', () => {
    expect(aiDisabledBy({ ai: { disabled: true } }, { ai: { disabled: true } })).toBe('group');
    expect(aiDisabledBy({ ai: { disabled: false } }, { ai: { disabled: true } })).toBe('user');
    expect(aiDisabledBy({}, undefined)).toBeNull();
  });

  it('per-person daily limit: user override > Settings > built-in default', async () => {
    await checkUserAiDailyLimit(1, { ai: { dailyLimit: 5 } });
    expect(rateLimitService.checkRateLimit).toHaveBeenLastCalledWith(1, expect.stringMatching(/^ai_user_daily:\d{4}-\d{2}-\d{2}$/), 5, expect.any(Number));

    jest.spyOn(settingsService, 'getAi').mockResolvedValue({ ...DEFAULT_AI_SETTINGS, userDailyLimit: 40 });
    await checkUserAiDailyLimit(1, { ai: { dailyLimit: null } });
    expect(rateLimitService.checkRateLimit).toHaveBeenLastCalledWith(1, expect.stringMatching(/^ai_user_daily:\d{4}-\d{2}-\d{2}$/), 40, expect.any(Number));

    jest.spyOn(settingsService, 'getAi').mockResolvedValue({ ...DEFAULT_AI_SETTINGS });
    await checkUserAiDailyLimit(1);
    expect(rateLimitService.checkRateLimit).toHaveBeenLastCalledWith(1, expect.stringMatching(/^ai_user_daily:\d{4}-\d{2}-\d{2}$/), AI_USER_DAILY_LIMIT, expect.any(Number));
  });

  it("a group's daily limit replaces the 10-minute window with a per-day cap", async () => {
    await checkGroupAiRateLimit(-100, { ai: { dailyLimit: 12 } });
    expect(rateLimitService.checkRateLimit).toHaveBeenLastCalledWith(-100, expect.stringMatching(/^ai_group_daily:\d{4}-\d{2}-\d{2}$/), 12, expect.any(Number));
    await checkGroupAiRateLimit(-100, { ai: { dailyLimit: null } });
    expect(rateLimitService.checkRateLimit).toHaveBeenLastCalledWith(-100, 'ai_task_extract', 20, 600);
  });

  it('withAiScope does not leak outside its callback', async () => {
    await withAiScope(AiFeature.EXPLAIN, { group: { _id: id() } }, async () => {
      expect(currentContext().feature).toBe('explain');
    });
    expect(currentContext().feature).toBeUndefined();
  });
});
