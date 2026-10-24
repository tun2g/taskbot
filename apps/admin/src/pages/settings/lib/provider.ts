const PROVIDER_LABELS: Record<string, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  fuse: 'Fuse',
};

/** "gemini" → "Google Gemini" (unknown ids are shown as given). */
export function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider.toLowerCase()] ?? provider;
}
