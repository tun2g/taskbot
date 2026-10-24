export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface JsonGenerationRequest {
  /** System-level instructions (rules, output format). */
  system: string;
  /** The user payload the model should work on. */
  user: string;
  /** Defaults to a low value (0.2) for deterministic structured output. */
  temperature?: number;
}

/** Token counts for one provider call (0 when the provider didn't report them). */
export interface AiUsage {
  /** All prompt tokens, cached ones included. */
  inputTokens: number;
  /** Part of inputTokens served from the provider's cache (billed cheaper). */
  cachedTokens: number;
  /** All billed output tokens, thinking/reasoning included. */
  outputTokens: number;
  /** Thinking/reasoning tokens (already counted in outputTokens). */
  thinkingTokens: number;
}

export const EMPTY_USAGE: AiUsage = { inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 };

/** One provider answer: the text plus what it cost in tokens and the model that served it. */
export interface AiCompletion {
  text: string;
  usage: AiUsage;
  model: string;
}

/** Thrown by providers on a failed call; carries the usage when the provider billed one (e.g. a refusal). */
export class AiProviderError extends Error {
  constructor(
    message: string,
    public readonly usage: AiUsage | null = null,
    public readonly model: string | null = null,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface AIProvider {
  /** Provider id recorded with each call ("gemini", "openai", "fuse"). */
  readonly name: string;
  /** The configured model id. */
  readonly modelName: string;
  chat(messages: ChatMessage[]): Promise<AiCompletion>;
  /** The raw model text (should be a single JSON document — callers validate it) plus usage. */
  generateJson(request: JsonGenerationRequest): Promise<AiCompletion>;
}

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

/**
 * OpenAI-compatible `usage` (OpenAI, Fuse and other gateways): prompt_tokens include the cached ones,
 * completion_tokens include the reasoning ones.
 */
export function usageFromOpenAI(usage: unknown): AiUsage {
  if (!usage || typeof usage !== 'object') return { ...EMPTY_USAGE };
  const u = usage as {
    prompt_tokens?: unknown;
    completion_tokens?: unknown;
    prompt_tokens_details?: { cached_tokens?: unknown } | null;
    completion_tokens_details?: { reasoning_tokens?: unknown } | null;
  };
  return {
    inputTokens: count(u.prompt_tokens),
    cachedTokens: count(u.prompt_tokens_details?.cached_tokens),
    outputTokens: count(u.completion_tokens),
    thinkingTokens: count(u.completion_tokens_details?.reasoning_tokens),
  };
}

/**
 * Gemini `usageMetadata`: candidatesTokenCount does NOT include thinking (thoughtsTokenCount), but thinking
 * is billed as output — so outputTokens = candidates + thoughts.
 */
export function usageFromGemini(meta: unknown): AiUsage {
  if (!meta || typeof meta !== 'object') return { ...EMPTY_USAGE };
  const m = meta as {
    promptTokenCount?: unknown;
    cachedContentTokenCount?: unknown;
    candidatesTokenCount?: unknown;
    thoughtsTokenCount?: unknown;
  };
  const thinking = count(m.thoughtsTokenCount);
  return {
    inputTokens: count(m.promptTokenCount),
    cachedTokens: count(m.cachedContentTokenCount),
    outputTokens: count(m.candidatesTokenCount) + thinking,
    thinkingTokens: thinking,
  };
}

/** `<base>/chat/completions`; accepts a base URL or a URL that already ends in the endpoint path. */
export function chatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return trimmed.endsWith('/chat/completions') ? trimmed : `${trimmed}/chat/completions`;
}
