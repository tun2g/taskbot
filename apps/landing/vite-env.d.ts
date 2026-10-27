/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Bot username (no "@") for the "Add to Telegram" links. */
  readonly VITE_BOT_USERNAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
