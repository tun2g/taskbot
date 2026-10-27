/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Bot username (no "@") for the "Add to Telegram" links. */
  readonly VITE_BOT_USERNAME?: string;
  /** Absolute public URL of the landing page, for canonical / Open Graph tags and the sitemap. */
  readonly VITE_SITE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
