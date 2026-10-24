/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Dev only: "1" serves fixture data from src/mocks instead of calling the admin API. */
  readonly VITE_ADMIN_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
