import { configService } from 'src/configs/configuration';
import logger from 'src/shared/logger/logger';
import { AIProvider, ChatMessage, chatCompletionsUrl, JsonGenerationRequest } from 'src/shared/services/ai/ai.interface';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature?: number;
  response_format?: { type: 'json_object' };
}

interface OpenAIResponse {
  choices?: Array<{
    message: { role: string; content: string | null; refusal?: string | null };
    finish_reason: string;
  }>;
}

// Reasoning models (o-series, gpt-5 family) reject any temperature other than the default.
const FIXED_TEMPERATURE_MODEL = /^(o\d|gpt-5)/i;

/** OpenAI Chat Completions — also works with any OpenAI-compatible endpoint via AI_API_URL. */
export class OpenAIProvider implements AIProvider {
  private readonly apiUrl: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor() {
    this.apiUrl = chatCompletionsUrl(configService.ai.apiUrl || 'https://api.openai.com/v1');
    this.apiKey = configService.ai.apiKey;
    this.model = configService.ai.model;
    if (!this.apiKey) {
      throw new Error('OpenAI API key is required. Set AI_API_KEY in your environment variables.');
    }
  }

  private async callOpenAI(messages: OpenAIMessage[], temperature: number, json = false): Promise<string> {
    const requestBody: OpenAIRequest = { model: this.model, messages };
    if (!FIXED_TEMPERATURE_MODEL.test(this.model)) requestBody.temperature = temperature;
    if (json) requestBody.response_format = { type: 'json_object' };

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
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as OpenAIResponse;
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error('No response from OpenAI API');
    if (message.refusal) throw new Error(`OpenAI refused: ${message.refusal}`);
    return message.content ?? '';
  }

  private parseError(error: unknown): string {
    const errorStr = error instanceof Error ? error.message : String(error);

    if (errorStr.includes('(401)') || errorStr.includes('invalid_api_key')) {
      return 'Invalid configuration';
    }
    if (errorStr.includes('insufficient_quota')) {
      return 'Out of quota';
    }
    if (errorStr.includes('(429)') || errorStr.includes('rate_limit')) {
      return 'Rate limit exceeded';
    }
    if (errorStr.includes('(403)')) {
      return 'Permission denied';
    }
    if (errorStr.includes('(404)') || errorStr.includes('model_not_found')) {
      return 'Invalid configuration';
    }
    if (errorStr.includes('(500)') || errorStr.includes('(502)') || errorStr.includes('(503)')) {
      return 'Service unavailable';
    }
    if (errorStr.includes('timeout') || errorStr.includes('ETIMEDOUT')) {
      return 'Request timeout';
    }

    return 'Unknown error';
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    try {
      return await this.callOpenAI(
        messages.map((msg) => ({ role: msg.role, content: msg.content })),
        0.7,
      );
    } catch (error) {
      const errorMessage = this.parseError(error);
      logger.error(`Error in chat: ${error}`);
      throw new Error(errorMessage);
    }
  }

  async generateJson(request: JsonGenerationRequest): Promise<string> {
    try {
      // json_object mode requires the word "JSON" somewhere in the messages.
      return await this.callOpenAI(
        [
          { role: 'system', content: `${request.system}\n\nRespond with a single JSON object only.` },
          { role: 'user', content: request.user },
        ],
        request.temperature ?? 0.2,
        true,
      );
    } catch (error) {
      const errorMessage = this.parseError(error);
      logger.error(`Error in generateJson: ${error}`);
      throw new Error(errorMessage);
    }
  }
}
