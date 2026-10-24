import { z } from 'zod';
import { configService } from 'src/configs/configuration';
import logger from 'src/shared/logger/logger';
import { recordAiCall } from 'src/shared/services/ai/ai-call-recorder';
import { AiCompletion, AIProvider, AiProviderError, ChatMessage, JsonGenerationRequest } from 'src/shared/services/ai/ai.interface';
import { FuseProvider } from 'src/shared/services/ai/fuse.provider';
import { GeminiProvider } from 'src/shared/services/ai/gemini.provider';
import { OpenAIProvider } from 'src/shared/services/ai/openai.provider';
import { rateLimitService } from 'src/shared/services/rate-limit.service';
import { settingsService } from 'src/shared/services/settings.service';
import { currentContext } from 'src/shared/services/telemetry/request-context';
import { utcDayWindow } from 'src/shared/services/ai-quota';

/** 'disabled' = the bot owner turned AI off for this group or person (admin app). */
export type AIUnavailableReason = 'unconfigured' | 'failed' | 'invalid' | 'quota' | 'disabled';

/** Thrown by `generateJson` when no usable structured answer could be produced. */
export class AIUnavailableError extends Error {
  constructor(
    public readonly reason: AIUnavailableReason,
    message: string,
  ) {
    super(message);
    this.name = 'AIUnavailableError';
  }
}

/** Strips code fences / surrounding prose and parses JSON. Returns undefined when it isn't JSON. */
export function parseJsonLoose(raw: string): unknown {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  let body = fenced ? fenced[1] : trimmed;
  if (!fenced) {
    const start = body.search(/[[{]/);
    const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
    if (start >= 0 && end > start) body = body.slice(start, end + 1);
  }
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

export interface GenerateJsonOptions {
  /** Extra attempts when the output is not valid JSON / fails the schema. Default 1. */
  retries?: number;
}

class AIService {
  private provider: AIProvider | null = null;

  /** False when no AI_API_KEY is set — callers should use their non-AI fallback. */
  isConfigured(): boolean {
    return !!configService.ai.apiKey;
  }

  // Created lazily so a missing key never crashes the bot at import time.
  private getProvider(): AIProvider {
    if (this.provider) return this.provider;
    const providerType = configService.ai.provider.toLowerCase();
    if (providerType === 'fuse') this.provider = new FuseProvider();
    else if (providerType === 'openai') this.provider = new OpenAIProvider();
    else this.provider = new GeminiProvider();
    return this.provider;
  }

  /**
   * Bot-wide cap on AI calls per day: Settings → AI → daily call limit, else AI_DAILY_LIMIT (0 = none).
   * Every AI call counts (one /ai can make several: plan, explanations, breakdown), so a runaway or abusive
   * day can't run up an unbounded bill. Callers already fall back on AIUnavailableError.
   */
  private async checkDailyBudget() {
    const settings = await settingsService.getAi();
    const max = settings.dailyCallLimit ?? configService.ai.dailyLimit;
    if (!max) return;
    const today = utcDayWindow('ai_daily_budget');
    const budget = await rateLimitService.checkRateLimit('all', today.action, max, today.seconds);
    if (!budget.allowed) throw new AIUnavailableError('quota', `Daily AI budget of ${max} calls reached`);
  }

  /** Refuses when the owner turned AI off for this request's group / person (set at the entry point). */
  private checkEnabled() {
    const by = currentContext().aiDisabledBy;
    if (!by) return;
    const message = `AI is turned off for this ${by === 'group' ? 'group' : 'person'}`;
    // Recorded so the owner can see the switch working (calls refused, not just calls stopping).
    const provider = this.getProvider();
    recordAiCall({ provider: provider.name, model: provider.modelName, status: 'disabled', attempt: 1, latencyMs: 0, error: message });
    throw new AIUnavailableError('disabled', message);
  }

  /** The daily cap; a refusal is recorded as a 'quota' call (no tokens, no cost). */
  private async guardBudget(provider: AIProvider) {
    try {
      await this.checkDailyBudget();
    } catch (error) {
      if (error instanceof AIUnavailableError && error.reason === 'quota') {
        recordAiCall({ provider: provider.name, model: provider.modelName, status: 'quota', attempt: 1, latencyMs: 0, error: error.message });
      }
      throw error;
    }
  }

  private record(provider: AIProvider, status: 'ok' | 'invalid', attempt: number, started: number, completion: AiCompletion) {
    recordAiCall({
      provider: provider.name,
      model: completion.model || provider.modelName,
      status,
      attempt,
      latencyMs: Date.now() - started,
      usage: completion.usage,
      error: status === 'invalid' ? 'Invalid output' : null,
    });
  }

  private recordFailure(provider: AIProvider, attempt: number, started: number, error: unknown) {
    const providerError = error instanceof AiProviderError ? error : null;
    recordAiCall({
      provider: provider.name,
      model: providerError?.model || provider.modelName,
      status: 'failed',
      attempt,
      latencyMs: Date.now() - started,
      usage: providerError?.usage ?? null,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  /** Free-form chat (recorded like every provider call). */
  async chat(messages: ChatMessage[]): Promise<string> {
    if (!this.isConfigured()) throw new AIUnavailableError('unconfigured', 'AI_API_KEY is not set');
    this.checkEnabled();
    const provider = this.getProvider();
    await this.guardBudget(provider);
    const started = Date.now();
    try {
      const completion = await provider.chat(messages);
      this.record(provider, 'ok', 1, started, completion);
      return completion.text;
    } catch (error) {
      this.recordFailure(provider, 1, started, error);
      throw error;
    }
  }

  /** One raw JSON-mode provider call: text + usage (unvalidated, not recorded). */
  async generateJsonCompletion(request: JsonGenerationRequest): Promise<AiCompletion> {
    return this.getProvider().generateJson(request);
  }

  /** Raw JSON-mode text from the provider (unvalidated, not recorded). */
  async generateJsonText(request: JsonGenerationRequest): Promise<string> {
    return (await this.generateJsonCompletion(request)).text;
  }

  /**
   * Structured generation: asks the provider for JSON (low temperature), validates it with
   * `schema`, retries on invalid output. Throws AIUnavailableError when unconfigured, turned off by the owner,
   * over the daily cap, when the provider fails, or when every attempt is invalid. Every provider attempt
   * (and a refusal by the daily cap) is recorded as an AiCall for the cost dashboard.
   */
  async generateJson<T>(request: JsonGenerationRequest, schema: z.ZodType<T>, options: GenerateJsonOptions = {}): Promise<T> {
    if (!this.isConfigured()) throw new AIUnavailableError('unconfigured', 'AI_API_KEY is not set');
    this.checkEnabled();
    const provider = this.getProvider();
    await this.guardBudget(provider);
    const attempts = 1 + (options.retries ?? 1);

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const started = Date.now();
      let completion: AiCompletion;
      try {
        completion = await this.generateJsonCompletion(request);
      } catch (error) {
        logger.error(`AI generateJson: provider failed (attempt ${attempt}): ${error}`);
        this.recordFailure(provider, attempt, started, error);
        throw new AIUnavailableError('failed', error instanceof Error ? error.message : String(error));
      }
      const parsed = schema.safeParse(parseJsonLoose(completion.text));
      this.record(provider, parsed.success ? 'ok' : 'invalid', attempt, started, completion);
      if (parsed.success) return parsed.data;
      logger.warn(`AI generateJson: invalid output (attempt ${attempt}): ${completion.text.slice(0, 500)}`);
    }
    throw new AIUnavailableError('invalid', 'AI returned invalid output');
  }
}

export const aiService = new AIService();
