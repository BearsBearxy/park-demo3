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
/**
 * sel 是不是本机存过的选择。不是(新浏览器 / 新园区)时先放今年今月:月份注入前各屏已按它取数,
 * 改前放 0 年,首进每屏先打一发 ?year=0 被拒(2026-10-05 复查)。注入月份后一律夹到默认期(最近有损益的月),
 * 不因今月恰好在可用月里就停在今月 —— 有数据时最终落点和改前一样,不读时钟。
 */
let pristine = true
const todaySel = (): PeriodSel => {
  const now = new Date()
  return { gran: 'month', year: now.getFullYear(), month: now.getMonth() + 1 }
}

function loadSel(): PeriodSel {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY) || 'null')
    if (s && (s.gran === 'month' || s.gran === 'year') && typeof s.year === 'number' && typeof s.month === 'number') {
      pristine = false
      return s
    }
  } catch { /* 损坏则回默认 */ }
  return todaySel()   // 月份注入后自动落到最新期
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

/**
 * 注入可用月份(升序去重),并把非法/过期选择夹到默认期。
 * financeMonths = 有损益覆盖的月份(AnalysisMonthsDTO.sources.pnl)。默认期优先落其最新月:
 * 真实数据的全局最新月是 2026-01(仅办公水电有数、无损益),落在那里会让驾驶舱首屏营收/成本/利润
 * 全 `—` + 主区空态,像「系统没数据」。不传则回退全局最新月(向后兼容)。
 */
export function providePeriodMonths(list: string[], financeMonths?: string[]): void {
  months.value = [...new Set(list)].sort()
  if (!months.value.length) {
    // 一个有数据的月都没有(新园区空库):落今年今月,不再停在 0 年 —— 改前屏上出「0年未导入预算」,
    // 还拿 ?ym=0-12 / ?year=0 去取数被拒。2026-10-05 用户拍板「按你建议修改」:只在没数据时读时钟。
    // 不写 localStorage:下次有了数据照旧夹到最近有损益的月。有数据的路径(下面)不读时钟。
    sel.value = { ...todaySel(), gran: sel.value.gran }
    pristine = true   // 落今月是兜底,不是谁选的:有了数据照旧夹到默认期
    return
  }
  if (!pristine && isValid(sel.value)) return
  const pool = (financeMonths ?? []).filter((m) => months.value.includes(m)).sort()
  const last = (pool.length ? pool : months.value).slice(-1)[0]
  const y = +last.slice(0, 4), m = +last.slice(5, 7)
  sel.value = sel.value.gran === 'year' ? { gran: 'year', year: y, month: m } : { gran: 'month', year: y, month: m }
  pristine = false
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
  sel.value = todaySel()
  pristine = true
  try { localStorage.removeItem(LS_KEY) } catch { /* noop */ }
}
