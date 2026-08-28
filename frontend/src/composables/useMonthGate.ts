// 通用月门（2026-08-29「两本账」设计稿 §③）—— 期 + 选期矩阵的年份行，两件事一起给。
//
// 三个运营账屏（分栋抄表 / 分桩明细 / 电费成本总览）改前**零选期层**：点完功能卡直接落表，
// 系统按 `latestPeriodOf` 自己 snap 到最后一个有数据的月 —— BOOK-WORKBENCH-SPEC §7-1
// 一字不差禁止的「顺手落进某个期」。出账链五屏在 2026-08-28/29 刚从这个形状迁走，这三屏没跟上。
//
// 与出账链那道门（`ChainMonthGate` + `stores/billingPeriod`）的区别只有一条：
// 那五屏**共**一个期（它们抢同一把月锁），这三屏**各**记各的（按 key 分）。
// 矩阵本身、手工年、连续补满的规则完全一样，所以那部分收在这里，两边都别再抄。
import { computed, ref } from 'vue'
import { useScreenPeriodStore } from '@/stores/screenPeriod'
import { loadExtraYears, saveExtraYears, buildYearRows } from '@/utils/matrixYears'

const pad2 = (n: number) => String(n).padStart(2, '0')
const YM = /^\d{4}-(0[1-9]|1[0-2])$/

/** 一张月卡。`badge` 由各屏自己决定显什么（条数 / 站数 / 金额）。 */
export interface GateCell {
  month: number
  hasData: boolean
  badge?: string
  cur?: boolean
}

export interface GateRow {
  year: number
  months: GateCell[]
  sub?: string
  removable?: boolean
}

export function useMonthGate(opts: {
  /** 会话内记期的键。同一屏用同一个键；附表7/8 要分开（`cp:car` / `cp:ebike`）。 */
  key: string
  /** 手工年记本机的键（`utils/matrixYears` 的 屏+册）。 */
  store: readonly [string, string | number]
  /** 有数据的账期全集（`'YYYY-MM'`，后端 /months 端点直给）。 */
  months: () => readonly string[]
  /** 每格的徽标。省略 = 只画有无，不写数字。 */
  badgeOf?: (ym: string) => string | undefined
}) {
  const store = useScreenPeriodStore()

  // ── 期（会话内，按 key） ────────────────────────────────
  const cur = computed(() => store.get(opts.key))
  const year = computed(() => cur.value?.year ?? null)
  const month = computed(() => cur.value?.month ?? null)
  const picked = computed(() => cur.value != null)
  const ym = computed(() => (cur.value ? `${cur.value.year}-${pad2(cur.value.month)}` : null))

  const pick = (y: number, m: number) => store.pick(opts.key, y, m)
  /** 「换月」—— 回到选期矩阵。 */
  const clear = () => store.clear(opts.key)

  // ── 手工年（记本机） ────────────────────────────────────
  const extraYears = ref<number[]>(loadExtraYears(...opts.store))
  function setExtra(years: number[]) {
    saveExtraYears(...opts.store, years)
    extraYears.value = loadExtraYears(...opts.store)   // 回读取归一化（去重排序）
  }

  // ── 矩阵年份行 ─────────────────────────────────────────
  const rows = computed<GateRow[]>(() => {
    const set = new Set(opts.months().filter(m => YM.test(m)))
    const dataYears = [...new Set([...set].map(m => +m.slice(0, 4)))]
    const thisYear = new Date().getFullYear()
    const out = buildYearRows(dataYears, thisYear, extraYears.value).map<GateRow>(r => {
      const months = Array.from({ length: 12 }, (_, i) => {
        const key = `${r.year}-${pad2(i + 1)}`
        const hasData = set.has(key)
        return { month: i + 1, hasData, badge: hasData ? opts.badgeOf?.(key) : undefined }
      })
      return {
        year: r.year,
        months,
        // 当前年优先：当前自然年无数据时 manual 也为真，不得标成「手工年」（它不可移除、非手工添加）
        sub: r.year === thisYear ? '当前年' : r.manual ? '手工年' : undefined,
        // 手工添加（区间自动补位年不算）且整年仍为空才可移除；录入数据即转正
        removable: r.manual && extraYears.value.includes(r.year) && months.every(m => !m.hasData),
      }
    })
    // 全年份范围内最近有数据的那一个月描边
    for (let i = out.length - 1; i >= 0; i--) {
      const j = out[i].months.map(m => m.hasData).lastIndexOf(true)
      if (j >= 0) { out[i].months[j].cur = true; break }
    }
    return out
  })

  const edge = (first: boolean) => {
    const r = rows.value
    if (!r.length) return new Date().getFullYear()
    return first ? r[0].year - 1 : r[r.length - 1].year + 1
  }
  const addEarlier = () => setExtra([...extraYears.value, edge(true)])
  const addLater = () => setExtra([...extraYears.value, edge(false)])
  const removeYear = (y: number) => setExtra(extraYears.value.filter(x => x !== y))

  return { year, month, picked, ym, pick, clear, rows, addEarlier, addLater, removeYear }
}
