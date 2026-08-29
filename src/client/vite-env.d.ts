/// <reference types="vite/client" />

declare module 'virtual:index-html' {
  export const template: string;
}

interface ImportMetaEnv {
  readonly VITE_GA_MEASUREMENT_ID?: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
}
