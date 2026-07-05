/// <reference types="vite/client" />

// Injected at build time by electron.vite.config.ts (renderer `define`) from
// package.json — keeps the Settings "О программе" version from going stale.
declare const __APP_VERSION__: string

declare module '*.mp3' {
  const src: string
  export default src
}
