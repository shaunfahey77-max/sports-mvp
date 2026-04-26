/// <reference types="vite/client" />

// Build-time flag injected by `define` in vite.config.ts. True only when the
// public-site preview gate (SITE_BASIC_AUTH_USER + SITE_BASIC_AUTH_PASS) is
// configured at build time. Used by the app shell to decide whether to
// render the "Sign out of preview" affordance.
declare const __PREVIEW_GATE_ENABLED__: boolean;
