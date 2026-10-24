import { GoogleGenerativeAI } from '@google/generative-ai';
import { configService } from 'src/configs/configuration';
import logger from 'src/shared/logger/logger';
import {
  AiCompletion,
  AIProvider,
  AiProviderError,
  ChatMessage,
  JsonGenerationRequest,
  usageFromGemini,
} from 'src/shared/services/ai/ai.interface';

type GeminiResult = Awaited<ReturnType<ReturnType<GoogleGenerativeAI['getGenerativeModel']>['generateContent']>>;

export class GeminiProvider implements AIProvider {
  readonly name = 'gemini';
  private genAI: GoogleGenerativeAI;
  private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;
  readonly modelName = configService.ai.model;

  constructor() {
    this.genAI = new GoogleGenerativeAI(configService.ai.apiKey);
    this.model = this.genAI.getGenerativeModel({ model: this.modelName });
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

  /** Text + usage; the served model version when the API reports it. */
  toCompletion(result: GeminiResult): AiCompletion {
    const response = result.response as GeminiResult['response'] & { modelVersion?: string };
    return {
      text: response.text(),
      usage: usageFromGemini(response.usageMetadata),
      model: response.modelVersion || this.modelName,
    };
  }

  async chat(messages: ChatMessage[]): Promise<AiCompletion> {
    try {
      const contents = messages.map((msg) => ({
        role: msg.role === 'user' ? ('user' as const) : ('model' as const),
        parts: [{ text: msg.content }],
      }));

      const result = await this.model.generateContent({ contents });
      return this.toCompletion(result);
    } catch (error) {
      const errorMessage = this.parseError(error);
      logger.error(`Error in chat: ${error}`);
      throw new AiProviderError(errorMessage);
    }
  }

  async generateJson(request: JsonGenerationRequest): Promise<AiCompletion> {
    try {
      const model = this.genAI.getGenerativeModel({
        model: this.modelName,
        systemInstruction: request.system,
        generationConfig: {
          responseMimeType: 'application/json',
          temperature: request.temperature ?? 0.2,
        },
      });
      const result = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: request.user }] }],
      });
      return this.toCompletion(result);
    } catch (error) {
      const errorMessage = this.parseError(error);
      logger.error(`Error in generateJson: ${error}`);
      throw new AiProviderError(errorMessage);
    }
  }
}
