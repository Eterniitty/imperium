/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_UNIVERSE_SEED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
