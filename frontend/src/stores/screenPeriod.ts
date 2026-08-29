// 屏级账期（会话内），按 key 分别记。
//
// 出账链那份 `stores/billingPeriod` 是**五屏共一个期**的特例：它们抢同一把
// `billing-chain:{年}-{月}` 月锁，期必须一致。三个运营账屏（分栋抄表 / 分桩明细 /
// 电费成本总览）各有各的期，共用不得，但踩的是同一个坑：
//
// ⚠ 期不能存屏内 ref —— 侧栏点击走 `tabs.openFresh()` → epoch 递增 →
//   `App.vue` 的 KeepAlive key 变 → 组件**全新重建**，屏内 ref 每次被清掉，
//   于是每次进来都得重选一次月。用户原话：「我想随意打开某个表来看」。
//
// ⚠ **只记会话内**：不写 localStorage、不同步进 URL（用户 2026-08-29 拍板，同出账链）。
//   刷新 / 重开浏览器过一次矩阵是有意的 —— 换来「永远不会停在三个月前的月还以为是最新」。
//   手工年是另一回事，它记本机（`utils/matrixYears`）：那是「这台机器上我想看到哪些年」，
//   与「我此刻在看哪个月」不是一件事。
import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface ScreenPeriod { year: number; month: number }

export const useScreenPeriodStore = defineStore('screenPeriod', () => {
  const periods = ref(new Map<string, ScreenPeriod>())

  const get = (key: string): ScreenPeriod | null => periods.value.get(key) ?? null

  function pick(key: string, year: number, month: number) {
    // 换 Map 实例而不是原地 set：Map 的 set 不触发依赖（Vue 的响应式代理只跟踪
    // ref 本身的替换），原地改会让 rows 之类的 computed 不重算。
    periods.value = new Map(periods.value).set(key, { year, month })
  }

  function clear(key: string) {
    const next = new Map(periods.value)
    next.delete(key)
    periods.value = next
  }

  return { periods, get, pick, clear }
})
