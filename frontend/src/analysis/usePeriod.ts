// src/analysis/usePeriod.ts — 期间上下文(移植 ana-period.js 的按月/按年/步进/边界语义)。
// 可用月份由调用方注入(providePeriodMonths,真实数据派生 — 见 anaData.fetchAvailableMonths),
// **不硬编码年份**。模块级单例:14 屏共享同一期间选择(切屏不丢);localStorage 持久化。
import { computed, ref } from 'vue'

export type Gran = 'month' | 'year'
export interface PeriodSel { gran: Gran; year: number; month: number }

const LS_KEY = 'fp-ana-period'
const pad2 = (n: number) => String(n).padStart(2, '0')
export const ymOf = (year: number, month: number): string => `${year}-${pad2(month)}`

// ── 模块级共享状态 ──
const months = ref<string[]>([])   // 'YYYY-MM' 升序(注入)

function loadSel(): PeriodSel {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
    if (s && (s.gran === 'month' || s.gran === 'year') && typeof s.year === 'number' && typeof s.month === 'number') return s
  } catch { /* 损坏则回默认 */ }
  return { gran: 'month', year: 0, month: 0 }   // 月份注入后自动落到最新期
}
const sel = ref<PeriodSel>(loadSel())

function persist() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(sel.value)) } catch { /* 隐私模式静默 */ }
}

const years = computed(() => [...new Set(months.value.map((m) => +m.slice(0, 4)))])
const monthNumsOf = (year: number): number[] =>
  months.value.filter((m) => +m.slice(0, 4) === year).map((m) => +m.slice(5, 7))

function isValid(s: PeriodSel): boolean {
  if (!months.value.length) return false
  if (s.gran === 'year') return years.value.includes(s.year)
  return months.value.includes(ymOf(s.year, s.month))
}

/** 注入可用月份(升序去重),并把非法/过期选择夹到最新期。 */
export function providePeriodMonths(list: string[]): void {
  months.value = [...new Set(list)].sort()
  if (!months.value.length || isValid(sel.value)) return
  const last = months.value[months.value.length - 1]
  const y = +last.slice(0, 4), m = +last.slice(5, 7)
  sel.value = sel.value.gran === 'year'
    ? { gran: 'year', year: years.value[years.value.length - 1], month: m }
    : { gran: 'month', year: y, month: m }
  persist()
}

export function usePeriod() {
  const label = computed(() => {
    if (!months.value.length) return '—'
    return sel.value.gran === 'year' ? sel.value.year + '年' : sel.value.year + '年' + sel.value.month + '月'
  })
  // 当前选中月键('YYYY-MM');按年粒度为 null
  const ym = computed(() => (sel.value.gran === 'month' ? ymOf(sel.value.year, sel.value.month) : null))

  function setGran(g: Gran) {
    if (g === sel.value.gran || !months.value.length) return
    if (g === 'year') {
      const y = years.value.includes(sel.value.year) ? sel.value.year : years.value[years.value.length - 1]
      sel.value = { gran: 'year', year: y, month: sel.value.month }
    } else {
      const ms = monthNumsOf(sel.value.year)
      const mm = ms.includes(sel.value.month) ? sel.value.month : ms[ms.length - 1]
      sel.value = { gran: 'month', year: sel.value.year, month: mm }
    }
    persist()
  }

  function setYear(y: number) {
    if (!years.value.includes(y)) return
    if (sel.value.gran === 'year') sel.value = { gran: 'year', year: y, month: sel.value.month }
    else {
      const ms = monthNumsOf(y)
      const mm = ms.includes(sel.value.month) ? sel.value.month : ms[ms.length - 1]
      sel.value = { gran: 'month', year: y, month: mm }
    }
    persist()
  }

  function setMonth(m: number) {
    if (sel.value.gran !== 'month' || !monthNumsOf(sel.value.year).includes(m)) return
    sel.value = { ...sel.value, month: m }
    persist()
  }

  // 步进:按月沿注入月份列表(跨年自然衔接);按年沿年份列表;边界禁用见 atStart/atEnd
  function step(dir: 1 | -1) {
    if (!months.value.length) return
    if (sel.value.gran === 'month') {
      const idx = months.value.indexOf(ymOf(sel.value.year, sel.value.month))
      const ni = Math.min(months.value.length - 1, Math.max(0, (idx < 0 ? months.value.length - 1 : idx) + dir))
      const nm = months.value[ni]
      sel.value = { gran: 'month', year: +nm.slice(0, 4), month: +nm.slice(5, 7) }
    } else {
      const yi = years.value.indexOf(sel.value.year)
      const nyi = Math.min(years.value.length - 1, Math.max(0, (yi < 0 ? years.value.length - 1 : yi) + dir))
      sel.value = { ...sel.value, year: years.value[nyi] }
    }
    persist()
  }

  const atStart = computed(() => {
    if (!months.value.length) return true
    return sel.value.gran === 'month'
      ? ymOf(sel.value.year, sel.value.month) <= months.value[0]
      : sel.value.year <= years.value[0]
  })
  const atEnd = computed(() => {
    if (!months.value.length) return true
    return sel.value.gran === 'month'
      ? ymOf(sel.value.year, sel.value.month) >= months.value[months.value.length - 1]
      : sel.value.year >= years.value[years.value.length - 1]
  })

  return { sel, months, years, monthNumsOf, label, ym, setGran, setYear, setMonth, step, atStart, atEnd }
}

/** 仅测试用:重置模块级状态。 */
export function __resetPeriodForTest(): void {
  months.value = []
  sel.value = { gran: 'month', year: 0, month: 0 }
  try { localStorage.removeItem(LS_KEY) } catch { /* noop */ }
}
