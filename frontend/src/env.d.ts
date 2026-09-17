/// <reference types="vite/client" />

/**
 * 前端版本号。构建时由 vite.config.ts 从 package.json 的 version 注入(见那里的 app-version 插件),
 * 同一个值也会写进 dist/version.json —— 页面靠比对这两个值发现「服务器上已经是新版了」。
 * 开发态(vite dev / vitest)同样有值,不必判空。
 */
declare const __APP_VERSION__: string

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}
