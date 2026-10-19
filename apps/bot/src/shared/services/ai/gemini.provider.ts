import { GoogleGenerativeAI } from '@google/generative-ai';
import { configService } from 'src/configs/configuration';
import logger from 'src/shared/logger/logger';
import { AIProvider, ChatMessage, JsonGenerationRequest } from 'src/shared/services/ai/ai.interface';

export class GeminiProvider implements AIProvider {
  private genAI: GoogleGenerativeAI;
  private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;
  private static readonly MODEL = 'gemini-2.5-flash';

  constructor() {
    this.genAI = new GoogleGenerativeAI(configService.ai.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: GeminiProvider.MODEL });
  }

  private parseError(error: unknown): string {
    const errorStr = error instanceof Error ? error.message : String(error);

    if (errorStr.includes('API_KEY_INVALID') || errorStr.includes('API key not valid')) {
      return 'Invalid configuration';
    }
    if (errorStr.includes('RESOURCE_EXHAUSTED') || errorStr.includes('quota')) {
      return 'Out of quota';
    }
    if (errorStr.includes('PERMISSION_DENIED')) {
      return 'Permission denied';
    }
    if (errorStr.includes('RATE_LIMIT') || errorStr.includes('429')) {
      return 'Rate limit exceeded';
    }
    if (errorStr.includes('UNAVAILABLE') || errorStr.includes('503')) {
      return 'Service unavailable';
    }
    if (errorStr.includes('DEADLINE_EXCEEDED') || errorStr.includes('timeout')) {
      return 'Request timeout';
    }

    return 'Unknown error';
  }

  async chat(messages: ChatMessage[]): Promise<string> {
    try {
      const contents = messages.map((msg) => ({
        role: msg.role === 'user' ? ('user' as const) : ('model' as const),
        parts: [{ text: msg.content }],
      }));

      const result = await this.model.generateContent({ contents });

      const response = result.response;
      return response.text();
    } catch (error) {
      const errorMessage = this.parseError(error);
      logger.error(`Error in chat: ${error}`);
      throw new Error(errorMessage);
    }
  }

  async generateJson(request: JsonGenerationRequest): Promise<string> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: GeminiProvider.MODEL,
        systemInstruction: request.system,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: request.temperature ?? 0.2,
        },
      });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: request.user }] }],
      });
      return result.response.text();
    } catch (error) {
      const errorMessage = this.parseError(error);
      logger.error(`Error in generateJson: ${error}`);
      throw new Error(errorMessage);
    }
  }
}
