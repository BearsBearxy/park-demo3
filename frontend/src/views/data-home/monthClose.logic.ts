// src/views/data-home/monthClose.logic.ts — 「本月出账」两栏清单的折行纯函数(P2 §5.2)。
// 把后端 9 个附表源 + 出账链 5 步 + 收入核对 + 本月锁账,折成屏上两栏 15 行:出账列 7 / 记账列 8。
// 零 import Vue、零 import store —— 纯数据变换,能进懒加载块也好单测。
//
// 出账列五步的状态只读 `overview.chain.steps[i].status`,**不用** `nav/billingChain.ts` 的 `chainStepsOf`——
// 那个函数的第一步(计费参数)恒为 done(矩阵 4 点的口径,「这个月配过参数没有」对参数不是一个有答案的
// 问题),照抄进清单会让没录电价的月显示已完成。清单要的是后端 `DataHomeService.buildChain` 算好的
// 另一套判据,只在 `status` 里。`chainStepsOf` / `ChainCell` 只喂年份条矩阵,这里不消费。
//
// DataHomeStepDTO.status 有 'current'(当前步),但 CloseRow.state 没有对应档 —— 「正在做哪一步」是
// 年份条大卡那层的事(比对 chain.currentIndex),两栏清单只回答「done 没 done」,current 并入 'todo'。
//
// review 恒 'na':审核机制(spec §7.4)全仓一行代码都没有,归 R1。`rowsOf` 的 `review` 入参本期恒传
// null,留着不改形状,R1 只填数据不改类型。
//
// chips 是「这一行有子入口」的通用装置,不只给台账公司 / 附10 期区:附13+附14 合并成一行后出
// 「办公」/「三期」两个 chip、附7+附8 合并成一行后出「汽车」/「电动车」两个 chip,各自带自己的
// `tab` 或 `go`,合并成 8 行之后深链入口一个不丢。
import type { DataHomeItemDTO, DataHomeOverviewDTO } from '@/types/dataHome'
import type { ReconMonthMeta } from '@/types/recon'

export type CloseCol = 'billing' | 'booking'

/** 台账公司 / 附10 期区用 `co` 带 id/no(与 `nav/deepLink.ts` 的 `co` 同口径);
 *  附13+附14 / 附7+附8 合并行用 `tab` / `go` 带各自的子入口 —— 一个 chip 只会用到其中一组。 */
export interface CloseChip {
  label: string
  done: boolean
  co?: number | 'all'
  go?: string
  tab?: string
}

export interface CloseRow {
  key: string              // 稳定 key,不用数组下标
  col: CloseCol
  label: string            // 「月度台账」
  tag?: string             // 「凭证」/「附10」
  go?: string              // nav value;无入口的行不给
  state: 'todo' | 'done' | 'stale' | 'na'   // na = 源缺,屏上显「—」
  detail?: string          // 「本月电价 6/6 已录」,来自 overview.chain.steps[i].detail
  locked?: string          // 有值 = 前置未满,显 padlock,文案即 tooltip
  chips?: CloseChip[]      // 台账公司 / 附10 期区 / 合并行子入口
  review: 'na'             // 本期恒 'na'(审核机制归 R1);留字段是为了 R2 只填不改形状
}

export interface RowsInput {
  overview: DataHomeOverviewDTO
  recon: ReconMonthMeta | null
  review: null
}

/** 附10 期区名:no 1..4 ← 一期/二期/三期/宿舍(与后端 DataHomeItemDTO.phases 注释同口径)。 */
const PHASE_LABEL: Record<number, string> = { 1: '一期', 2: '二期', 3: '三期', 4: '宿舍' }

/** 记账列 8 行 ← 后端 9 源。合并行 done = 两项皆 done(保守:与「全月已审核」同调)。
 *  `from` 按 `DataHomeItemDTO.go` 匹配 —— 附13/附14 两条源本就共用 go='utilities',
 *  `from: ['utilities']` 一项就能同时收下两条;附7/8 的 go 本就不同,`from` 列两个。 */
const BOOKING_ROWS: { key: string; label: string; tag?: string; from: string[]; go?: string }[] = [
  { key: 'ledger',        label: '月度台账', tag: '凭证',   from: ['ledger'],        go: 'ledger' },
  { key: 'sales-income',  label: '附表10',   tag: '附10',   from: ['sales-income'],  go: 'sales-income' },
  { key: 'salary',        label: '附表12',   tag: '附12',   from: ['salary'],        go: 'salary' },
  { key: 'utilities',     label: '办公·三期水电', tag: '附13/14', from: ['utilities'], go: 'utilities' },
  { key: 'pv-income',     label: '附表6',    tag: '附6',    from: ['pv-income'],     go: 'pv-income' },
  { key: 'charging',      label: '附表7/8',  tag: '附7/8',  from: ['car-charging', 'ebike-charging'], go: 'car-charging' },
  { key: 'elec-cost',     label: '附表11',   tag: '附11',   from: ['elec-cost'],     go: 'elec-cost' },
  { key: 'import',        label: '导入中心', from: [],      go: 'import' },   // 无源 → 恒 na
]

/** 合并行(utilities / charging)按匹配到的源项拆出各自的 chip;单源行(ledger / sales-income)
 *  按 companies / phases 拆;其余行没有子入口,不给 chips。
 *  ⚠ 源字段线上发的是 `null` 不是缺席 —— `matched[0]?.companies ?? []` 用 `??` 而不是解构默认值,
 *  后者(`const { companies = [] } = item`)对 null 不生效。 */
function chipsFor(key: string, matched: DataHomeItemDTO[]): CloseChip[] | undefined {
  if (key === 'ledger') {
    const companies = matched[0]?.companies ?? []
    return companies.map(c => ({ label: c.short, done: c.done, co: c.id }))
  }
  if (key === 'sales-income') {
    const phases = matched[0]?.phases ?? []
    return phases.map(p => ({ label: PHASE_LABEL[p.no] ?? String(p.no), done: p.done, co: p.no }))
  }
  if (key === 'utilities') {
    return matched.map(it => ({
      label: it.tag === '附14' ? '三期' : '办公',
      done: it.done,
      tab: it.tag === '附14' ? 'phase3' : 'office',
    }))
  }
  if (key === 'charging') {
    return matched.map(it => ({
      label: it.go === 'ebike-charging' ? '电动车' : '汽车',
      done: it.done,
      go: it.go,
    }))
  }
  return undefined
}

function bookingRow(row: (typeof BOOKING_ROWS)[number], items: DataHomeItemDTO[]): CloseRow {
  const matched = items.filter(it => row.from.includes(it.go))
  const base = { key: row.key, col: 'booking' as const, label: row.label, tag: row.tag, go: row.go, review: 'na' as const }
  // 无源(导入中心)或源缺(防御性 —— 正常回包 7 个非导入行必有匹配)→ na,屏上显「—」
  if (row.from.length === 0 || matched.length === 0) return { ...base, state: 'na' }
  // 折出来的行两项都 done 才算 done —— 只做了其中一项(比如只录了附13)仍是 todo
  const state: CloseRow['state'] = matched.every(it => it.done) ? 'done' : 'todo'
  const chips = chipsFor(row.key, matched)
  return chips ? { ...base, state, chips } : { ...base, state }
}

function reconRow(recon: ReconMonthMeta | null): CloseRow {
  const state: CloseRow['state'] =
    recon === null ? 'na' : recon.diffCount === 0 && recon.missCount === 0 ? 'done' : 'todo'
  return { key: 'reconciliation', col: 'billing', label: '收入核对', go: 'reconciliation', state, review: 'na' }
}

/** 本月锁账:审核机制(spec §7.4)本期只做前置不做实现,恒 na —— 不许降级成「五步全 done 就算锁账」,
 *  那是假绿。locked 文案即 padlock 的 tooltip。 */
function monthLockRow(): CloseRow {
  return { key: 'month-lock', col: 'billing', label: '本月锁账', state: 'na', locked: '审核机制未上线', review: 'na' }
}

export function rowsOf({ overview, recon }: RowsInput): CloseRow[] {
  const chainRows: CloseRow[] = overview.chain.steps.map(s => ({
    key: s.key,
    col: 'billing',
    label: s.label,
    go: s.go,
    state: s.status === 'done' ? 'done' : 'todo',
    detail: s.detail,
    review: 'na',
  }))
  const billing = [...chainRows, reconRow(recon), monthLockRow()]
  const booking = BOOKING_ROWS.map(row => bookingRow(row, overview.schedules.items))
  return [...billing, ...booking]
}

/** 计数从渲染出来的 rows 算,不抄 `overview.schedules.total`(后端那个数恒为 9,而记账列折成 8 行,
 *  两个数不同源就对不上屏)。 */
export function closeChecks(rows: CloseRow[]): { done: number; total: number; byCol: Record<CloseCol, { done: number; total: number }> } {
  const byCol: Record<CloseCol, { done: number; total: number }> = {
    billing: { done: 0, total: 0 },
    booking: { done: 0, total: 0 },
  }
  for (const r of rows) {
    byCol[r.col].total++
    if (r.state === 'done') byCol[r.col].done++
  }
  return { done: byCol.billing.done + byCol.booking.done, total: byCol.billing.total + byCol.booking.total, byCol }
}
