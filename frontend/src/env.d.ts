/// <reference types="vite/client" />

// Extend Vite's environment typing so that TypeScript understands any
// custom VITE_ prefixed variables. The backend URL is injected at
// build time in production and during development via .env files. The
// MODE variable tells the app whether it is running in development or
// production.

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_FIREBASE_API_KEY?: string;
  readonly VITE_FIREBASE_AUTH_DOMAIN?: string;
  readonly VITE_FIREBASE_PROJECT_ID?: string;
  readonly VITE_FIREBASE_STORAGE_BUCKET?: string;
  readonly VITE_FIREBASE_MESSAGING_SENDER_ID?: string;
  readonly VITE_FIREBASE_APP_ID?: string;
  readonly VITE_FIREBASE_MEASUREMENT_ID?: string;
  readonly MODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
