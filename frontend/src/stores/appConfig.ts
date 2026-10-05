// src/stores/appConfig.ts — 这套部署是我园还是客户园区(GET /api/app/config,后端 config/DeployConfig)。
// 2026-10-05 用户拍板「按你建议修改」:客户园区不显三处模拟填充、损益附表不自动补行(parkTools=false);
// 更新记录只给看装机那一版之后的(releaseBaseline)。我园生产后端默认 true / 0.0.0,一切照旧。
// 配置到之前一律按客户园区算(不显按钮、更新一条都不算):先显后收会闪出我园才有的按钮和旧更新。
// 拉失败不覆盖已拿到的值;一次都没拿到时,外壳每次换屏再拉(AppShell),一次网络抖动不会让我园整场丢按钮。
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import http from '@/api'

export interface AppConfig { parkTools: boolean; releaseBaseline: string }

export const useAppConfigStore = defineStore('appConfig', () => {
  const cfg = ref<AppConfig | null>(null)
  let inflight: Promise<void> | null = null

  function ensure(): Promise<void> {
    if (cfg.value) return Promise.resolve()
    inflight ??= Promise.resolve()
      .then(() => http.get<AppConfig>('/app/config'))
      .then((c) => { if (typeof c?.releaseBaseline === 'string') cfg.value = c })
      .catch(() => {})
      .finally(() => { inflight = null })
    return inflight
  }

  const parkTools = computed(() => cfg.value?.parkTools === true)
  /** null = 还没拿到 */
  const releaseBaseline = computed(() => cfg.value?.releaseBaseline ?? null)
  return { cfg, ensure, parkTools, releaseBaseline }
})
