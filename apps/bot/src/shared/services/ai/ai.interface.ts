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

export interface AIProvider {
  chat(messages: ChatMessage[]): Promise<string>;
  /** Returns the raw model text, which should be a single JSON document. Callers validate it. */
  generateJson(request: JsonGenerationRequest): Promise<string>;
}
