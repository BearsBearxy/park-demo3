// src/analysis/useCompare.ts — 对比开关(spec §一:无/环比/同比/预算)。
// 模块级单例 + localStorage 'fp-ana-compare':切屏不丢。屏声明支持集 useCompare(supported):
// 持久化值不在支持集 → 该屏 mode 读到 'none'(原始选择保留,回到支持屏自动恢复);
// set 越权(不在支持集)忽略。AnaShell 按屏传入的支持集渲染 segmented(不支持项禁用+title)。
import { computed, ref, type ComputedRef } from 'vue'

export type CompareMode = 'none' | 'mom' | 'yoy' | 'budget'
const MODES: CompareMode[] = ['none', 'mom', 'yoy', 'budget']

const LS_KEY = 'fp-ana-compare'

function load(): CompareMode {
  try {
    const v = localStorage.getItem(LS_KEY)
    if (MODES.includes(v as CompareMode)) return v as CompareMode
  } catch { /* 隐私模式静默 */ }
  return 'none'
}
const raw = ref<CompareMode>(load())

export interface UseCompare {
  mode: ComputedRef<CompareMode>   // 本屏生效模式(支持集外 → 'none')
  set: (m: CompareMode) => void
  supported: CompareMode[]
}

export function useCompare(supported: CompareMode[]): UseCompare {
  const mode = computed<CompareMode>(() =>
    raw.value === 'none' || supported.includes(raw.value) ? raw.value : 'none')
  function set(m: CompareMode) {
    if (m !== 'none' && !supported.includes(m)) return
    raw.value = m
    try { localStorage.setItem(LS_KEY, m) } catch { /* noop */ }
  }
  return { mode, set, supported }
}

/** 仅测试用:重置模块级状态。 */
export function __resetCompareForTest(): void {
  raw.value = 'none'
  try { localStorage.removeItem(LS_KEY) } catch { /* noop */ }
}
