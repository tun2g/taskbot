import { configService } from 'src/configs/configuration';
import logger from 'src/shared/logger/logger';
import {
  AiCompletion,
  AIProvider,
  AiProviderError,
  ChatMessage,
  chatCompletionsUrl,
  JsonGenerationRequest,
  usageFromOpenAI,
} from 'src/shared/services/ai/ai.interface';

interface FuseAPIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface FuseAPIRequest {
  model: string;
  messages: FuseAPIMessage[];
  temperature?: number;
  max_tokens?: number;
}

interface FuseAPIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens: number;
    prompt_tokens_details?: { cached_tokens?: number } | null;
    completion_tokens_details?: { reasoning_tokens?: number } | null;
  };
}

export class FuseProvider implements AIProvider {
  readonly name = 'fuse';
  private apiUrl: string;
  private apiKey: string;
  // AI_MODEL (or the configured default), like the other providers.
  private model = configService.ai.model;

  get modelName(): string {
    return this.model;
  }

  constructor() {
    this.apiUrl = chatCompletionsUrl(configService.ai.apiUrl || 'https://api.fuseapi.app/v1');
    this.apiKey = configService.ai.apiKey;
    if (!this.apiKey) {
      throw new Error('Fuse API key is required. Set AI_API_KEY in your environment variables.');
    }
  }

  private async callFuseAPI(messages: FuseAPIMessage[], temperature = 0.7): Promise<AiCompletion> {
    try {
      const requestBody: FuseAPIRequest = {
        model: this.model,
        messages,
        temperature,
      };

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Fuse API error (${response.status}): ${errorText}`);
      }

      const data = (await response.json()) as FuseAPIResponse;

      const usage = usageFromOpenAI(data.usage);
      const model = data.model || this.model;
      if (!data.choices || data.choices.length === 0) {
        throw new AiProviderError('No response from Fuse API', usage, model);
      }

      return { text: data.choices[0].message.content ?? '', usage, model };
    } catch (error) {
      logger.error(`Fuse API call failed: ${error}`);
      throw error;
    }
  }

  private wrap(message: string, cause: unknown): AiProviderError {
    return cause instanceof AiProviderError
      ? new AiProviderError(message, cause.usage, cause.model)
      : new AiProviderError(message);
  }

  private parseError(error: unknown): string {
    const errorStr = error instanceof Error ? error.message : String(error);

    if (errorStr.includes('401') || errorStr.includes('Unauthorized')) {
      return 'Invalid configuration';
    }
    if (errorStr.includes('429') || errorStr.includes('rate limit')) {
      return 'Rate limit exceeded';
    }
    if (errorStr.includes('quota') || errorStr.includes('insufficient')) {
      return 'Out of quota';
    }
    if (errorStr.includes('403') || errorStr.includes('Forbidden')) {
      return 'Permission denied';
    }
    if (errorStr.includes('503') || errorStr.includes('unavailable')) {
      return 'Service unavailable';
    }
    if (errorStr.includes('timeout') || errorStr.includes('ETIMEDOUT')) {
      return 'Request timeout';
    }

    return 'Unknown error';
  }

  async chat(messages: ChatMessage[]): Promise<AiCompletion> {
    try {
      const fuseMessages: FuseAPIMessage[] = messages.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));

      return await this.callFuseAPI(fuseMessages, 0.7);
    } catch (error) {
      const errorMessage = this.parseError(error);
      logger.error(`Error in chat: ${error}`);
      throw this.wrap(errorMessage, error);
    }
  }

  async generateJson(request: JsonGenerationRequest): Promise<AiCompletion> {
    try {
      return await this.callFuseAPI(
        [
          { role: 'system', content: `${request.system}\n\nRespond with a single JSON object only — no prose, no code fences.` },
          { role: 'user', content: request.user },
        ],
        request.temperature ?? 0.2,
      );
    } catch (error) {
      const errorMessage = this.parseError(error);
      logger.error(`Error in generateJson: ${error}`);
      throw this.wrap(errorMessage, error);
    }
  }
}
