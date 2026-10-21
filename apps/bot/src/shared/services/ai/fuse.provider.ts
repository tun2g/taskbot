import { configService } from 'src/configs/configuration';
import logger from 'src/shared/logger/logger';
import { AIProvider, ChatMessage, chatCompletionsUrl, JsonGenerationRequest } from 'src/shared/services/ai/ai.interface';

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
  usage: {
    completion_tokens: number;
    total_tokens: number;
    prompt_tokens: number;
  };
}

export class FuseProvider implements AIProvider {
  private apiUrl: string;
  private apiKey: string;
  private model = 'claude-opus-4.6';

  constructor() {
    this.apiUrl = chatCompletionsUrl(configService.ai.apiUrl || 'https://api.fuseapi.app/v1');
    this.apiKey = configService.ai.apiKey;
    if (!this.apiKey) {
      throw new Error('Fuse API key is required. Set AI_API_KEY in your environment variables.');
    }
  }

  private async callFuseAPI(messages: FuseAPIMessage[], temperature = 0.7): Promise<string> {
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

      if (!data.choices || data.choices.length === 0) {
        throw new Error('No response from Fuse API');
      }

      return data.choices[0].message.content;
    } catch (error) {
      logger.error(`Fuse API call failed: ${error}`);
      throw error;
    }
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

  async chat(messages: ChatMessage[]): Promise<string> {
    try {
      const fuseMessages: FuseAPIMessage[] = messages.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      }));

      return await this.callFuseAPI(fuseMessages, 0.7);
    } catch (error) {
      const errorMessage = this.parseError(error);
      logger.error(`Error in chat: ${error}`);
      throw new Error(errorMessage);
    }
  }

  async generateJson(request: JsonGenerationRequest): Promise<string> {
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
      throw new Error(errorMessage);
    }
  }
}
