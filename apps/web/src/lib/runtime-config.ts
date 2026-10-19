interface RuntimeConfig {
  apiUrl?: string;
  botUsername?: string;
}

declare global {
  interface Window {
    __TBOT_CONFIG__?: RuntimeConfig;
  }
}

const runtime: RuntimeConfig = (typeof window !== 'undefined' && window.__TBOT_CONFIG__) || {};

/** Container env (web.env, read at startup) wins over build-time VITE_* values. */
export const config = {
  apiUrl: runtime.apiUrl || (import.meta.env.VITE_API_URL as string | undefined) || '/api',
  botUsername: runtime.botUsername || (import.meta.env.VITE_BOT_USERNAME as string | undefined) || undefined,
};
