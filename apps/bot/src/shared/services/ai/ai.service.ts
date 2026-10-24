import { z } from 'zod';
import { configService } from 'src/configs/configuration';
import logger from 'src/shared/logger/logger';
import { AIProvider, ChatMessage, JsonGenerationRequest } from 'src/shared/services/ai/ai.interface';
import { FuseProvider } from 'src/shared/services/ai/fuse.provider';
import { GeminiProvider } from 'src/shared/services/ai/gemini.provider';
import { OpenAIProvider } from 'src/shared/services/ai/openai.provider';
import { rateLimitService } from 'src/shared/services/rate-limit.service';

export type AIUnavailableReason = 'unconfigured' | 'failed' | 'invalid' | 'quota';

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
   * AI_DAILY_LIMIT: every AI call counts (one /ai can make several: plan, explanations, breakdown), so a
   * runaway or abusive day can't run up an unbounded bill. Callers already fall back on AIUnavailableError.
   */
  private async checkDailyBudget() {
    const max = configService.ai.dailyLimit;
    if (!max) return;
    const budget = await rateLimitService.checkRateLimit('all', 'ai_daily_budget', max, 24 * 60 * 60);
    if (!budget.allowed) throw new AIUnavailableError('quota', `Daily AI budget of ${max} calls reached`);
  }

  async chat(messages: ChatMessage[]) {
    return this.getProvider().chat(messages);
  }

  /** Raw JSON-mode text from the provider (unvalidated). */
  async generateJsonText(request: JsonGenerationRequest): Promise<string> {
    return this.getProvider().generateJson(request);
  }

  /**
   * Structured generation: asks the provider for JSON (low temperature), validates it with
   * `schema`, retries on invalid output. Throws AIUnavailableError when unconfigured, when the
   * provider fails, or when every attempt is invalid.
   */
  async generateJson<T>(request: JsonGenerationRequest, schema: z.ZodType<T>, options: GenerateJsonOptions = {}): Promise<T> {
    if (!this.isConfigured()) throw new AIUnavailableError('unconfigured', 'AI_API_KEY is not set');
    await this.checkDailyBudget();
    const attempts = 1 + (options.retries ?? 1);

    for (let attempt = 1; attempt <= attempts; attempt++) {
      let raw: string;
      try {
        raw = await this.generateJsonText(request);
      } catch (error) {
        logger.error(`AI generateJson: provider failed (attempt ${attempt}): ${error}`);
        throw new AIUnavailableError('failed', error instanceof Error ? error.message : String(error));
      }
      const parsed = schema.safeParse(parseJsonLoose(raw));
      if (parsed.success) return parsed.data;
      logger.warn(`AI generateJson: invalid output (attempt ${attempt}): ${raw.slice(0, 500)}`);
    }
    throw new AIUnavailableError('invalid', 'AI returned invalid output');
  }
}

export const aiService = new AIService();
