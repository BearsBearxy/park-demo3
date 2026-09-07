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
// review(R2 落数):`rowsOf` 的 `review` 入参收 GET /api/review?period= 的整月行集。
// 传 null = 审核态还没到(或这一屏不看审核),此时全行显 'na' 即屏上的「—」——
// 不许降级成「没有行就是未交审」:那两件事在屏上是两个字,显反了就是对用户撒谎。
//
// chips 是「这一行有子入口」的通用装置,不只给台账公司 / 附10 期区:附13+附14 合并成一行后出
// 「办公」/「三期」两个 chip、附7+附8 合并成一行后出「汽车」/「电动车」两个 chip,各自带自己的
// `tab` 或 `go`,合并成 8 行之后深链入口一个不丢。
import type { DataHomeItemDTO, DataHomeOverviewDTO } from '@/types/dataHome'
import type { ReconMonthMeta } from '@/types/recon'
import type { ReviewRow, ReviewStatus } from '@/types/review'

export type CloseCol = 'billing' | 'booking'

/** 台账公司 / 附10 期区用 `co` 带 id/no(与 `nav/deepLink.ts` 的 `co` 同口径);
 *  附13+附14 / 附7+附8 合并行用 `tab` / `go` 带各自的子入口 —— 一个 chip 只会用到其中一组。 */
export interface CloseChip {
  label: string
  done: boolean
  co?: number | 'all'
  go?: string
  tab?: string
  /** 这枚 chip 自己那把审核键(台账每公司一把 / 附10 每期区一把 / 合并行各一把)。 */
  reviewKey?: string
  review?: ReviewStatus | 'na'
}

export interface CloseRow {
  key: string              // 稳定 key,不用数组下标
  col: CloseCol
  label: string            // 「月度台账」
  tag?: string             // 「凭证」/「附10」
  go?: string              // nav value;无入口的行不给
  state: 'todo' | 'done' | 'stale' | 'na'   // na = 源缺,屏上显「—」
  // 分母是否把这一行算进去(评审修补 T3 fix-brief #5):结构性 na 恒 false(导入中心没有这个数据源、
  // 本月锁账机制未上线,两者永远做不完,进分母会让「n/6」永远差一格);其余恒 true —— 包括收入核对,
  // 它的 na 只是「暂时不知道」(recon 还没到达),不是「做不完」,不能因为异步加载就把分母从 6 撞成 5。
  countable: boolean
  detail?: string          // 「本月电价 6/6 已录」,来自 overview.chain.steps[i].detail
  locked?: string          // 有值 = 前置未满,显 padlock,文案即 tooltip
  chips?: CloseChip[]      // 台账公司 / 附10 期区 / 合并行子入口
  /**
   * 这一行的审核态。'na' = 审核态没到 / 这一行没有审核键(导入中心、收入核对)。
   *
   * 一行压多把键时(台账 N 个公司 / 附10 N 个期区 / 附表7+8 合并行)取**最不进展**的那个:
   * entered < returned < submitted < approved。与 P2 那条「行 done 收严成所有 chip 都 done」
   * 同一条理由 —— 一行显示「已审核」而底下挂着没交审的公司,是自相矛盾。
   */
  review: ReviewStatus | 'na'
  /** 单键行的键(行上的交审/通过按钮用)。多键行不给 —— 动作长在 chip 上。 */
  reviewKey?: string
}

export interface RowsInput {
  overview: DataHomeOverviewDTO
  recon: ReconMonthMeta | null
  /** 该月全部审核键(GET /api/review?period=)。null = 还没到,全行显 'na'。 */
  review: ReviewRow[] | null
}

/** 附10 期区名:no 1..4 ← 一期/二期/三期/宿舍(与后端 DataHomeItemDTO.phases 注释同口径)。 */
const PHASE_LABEL: Record<number, string> = { 1: '一期', 2: '二期', 3: '三期', 4: '宿舍' }

// ── 审核态(R2) ──────────────────────────────────────────────────────────
//
// 清单行 key → 审核 kind。出账列五步的 step.key **逐字就是**前五个 kind code
// (DataHomeService.buildChain:274 那个数组写死的),记账列的行 key 是 monthClose 自己起的,
// 两边对不上,所以要这张表。一行可能对多个 kind:附表7/8 合并成一行、附13/14 是同 kind 两个 scope。
const ROW_KINDS: Record<string, string[]> = {
  params: ['params'], meters: ['meters'], alloc: ['alloc'],
  'alloc-loss': ['alloc-loss'], 'bill-notices': ['bill-notices'],
  ledger: ['ledger'], 'sales-income': ['s10'], salary: ['salary'],
  utilities: ['utilities'], 'pv-income': ['pv'],
  charging: ['charging-car', 'charging-ebike'], 'elec-cost': ['elec-cost'],
  import: [],           // 导入中心没有审核键
  reconciliation: [],   // 收入核对本轮不进审核(§7.1 末句)
  'month-lock': [],     // 本月锁账是别的 14 行的派生,自己没有键
}

/** 进展序。取「最不进展」用它比大小 —— 一行显示已审核而底下挂着没交审的公司是自相矛盾。 */
const RANK: Record<ReviewStatus, number> = { entered: 0, returned: 1, submitted: 2, approved: 3 }
const leastOf = (ss: ReviewStatus[]): ReviewStatus | 'na' =>
  ss.length ? ss.reduce((a, b) => (RANK[b] < RANK[a] ? b : a)) : 'na'

/** 这一行(按 kind,可再按 scope 收窄)在该月的全部审核行。 */
function pick(review: ReviewRow[] | null, kinds: string[], scope?: string): ReviewRow[] {
  if (!review || !kinds.length) return []
  return review.filter(r => kinds.includes(r.kind) && (scope === undefined || r.scope === scope))
}

const statusOf = (rows: ReviewRow[]): ReviewStatus | 'na' => leastOf(rows.map(r => r.status))

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
function chipsFor(key: string, matched: DataHomeItemDTO[], review: ReviewRow[] | null,
                  period: string | null): CloseChip[] | undefined {
  /** 一枚 chip 的审核键与态。period 为空(全新库)时不给键 —— 拼不出键就没有动作可挂。 */
  const rv = (kind: string, scope: string | null): Pick<CloseChip, 'reviewKey' | 'review'> => {
    if (!period) return { review: 'na' }
    const k = scope == null ? `${kind}:${period}` : `${kind}:${scope}:${period}`
    const row = review?.find(r => r.key === k)
    return { reviewKey: k, review: review ? (row?.status ?? 'entered') : 'na' }
  }
  if (key === 'ledger') {
    const companies = matched[0]?.companies ?? []
    return companies.map(c => ({ label: c.short, done: c.done, co: c.id, ...rv('ledger', String(c.id)) }))
  }
  if (key === 'sales-income') {
    const phases = matched[0]?.phases ?? []
    return phases.map(p => ({ label: PHASE_LABEL[p.no] ?? String(p.no), done: p.done, co: p.no,
                              ...rv('s10', String(p.no)) }))
  }
  if (key === 'utilities') {
    return matched.map(it => ({
      label: it.tag === '附14' ? '三期' : '办公',
      done: it.done,
      tab: it.tag === '附14' ? 'phase3' : 'office',
      ...rv('utilities', it.tag === '附14' ? 'phase3' : 'office'),
    }))
  }
  if (key === 'charging') {
    return matched.map(it => ({
      label: it.go === 'ebike-charging' ? '电动车' : '汽车',
      done: it.done,
      go: it.go,
      // ⚠ 附表7/8 是**两个 kind**,不是一个 kind 的两个 scope(后端 ReviewKind 头注第三坑)。
      ...rv(it.go === 'ebike-charging' ? 'charging-ebike' : 'charging-car', null),
    }))
  }
  return undefined
}

function bookingRow(row: (typeof BOOKING_ROWS)[number], items: DataHomeItemDTO[],
                    review: ReviewRow[] | null, period: string | null): CloseRow {
  const matched = items.filter(it => row.from.includes(it.go))
  const kinds = ROW_KINDS[row.key] ?? []
  const rvRows = pick(review, kinds)
  const base = {
    key: row.key, col: 'booking' as const, label: row.label, tag: row.tag, go: row.go,
    countable: row.from.length > 0,   // 结构性 na 只有导入中心(row.from 空数组);其余记账行恒 true
    review: statusOf(rvRows),
    // 单键行才给行级键(salary / pv / elec-cost);台账、附10、附13/14、附7/8 的动作长在 chip 上
    ...(rvRows.length === 1 ? { reviewKey: rvRows[0].key } : {}),
  }
  // 无源(导入中心)或源缺(防御性 —— 正常回包 7 个非导入行必有匹配)→ na,屏上显「—」
  if (row.from.length === 0 || matched.length === 0) return { ...base, state: 'na' }
  const chips = chipsFor(row.key, matched, review, period)
  // 有 chips 的行:行 done 收严成「所有 chip 都 done」,不是「matched 源项自己的 done」——
  // 台账/附10 的 chips 来自 companies/phases 子集,可能与源项自己的 done 字段对不上(自相矛盾,
  // 一行之内左边说已做、右边挂着没做的公司 chip)。合并行(utilities/charging)本就是按 matched
  // 逐项拆 chip,两边等价,不受影响。
  // ⚠ chips.length===0(companies/phases 线上发 null 时 chipsFor 回空数组)必须靠 `chips.length` 守——
  // `[].every()` 恒真,不守会把源项自己 done=false 的行错判成 done。
  const state: CloseRow['state'] =
    (chips && chips.length ? chips.every(c => c.done) : matched.every(it => it.done)) ? 'done' : 'todo'
  return chips ? { ...base, state, chips } : { ...base, state }
}

/** 收入核对本轮不进审核(§7.1 末句),所以 review 恒 'na' —— 这一条不是「暂时」,是拍板不做。 */
function reconRow(recon: ReconMonthMeta | null): CloseRow {
  // 后端每年恒发 12 个 MonthMeta,空月 hasData=false 且四个计数全 0 —— 与 ReconView.vue 同源写法
  // (:145 先 v-if="!m.hasData" 出空卡),先过 hasData 闸,不能让「计数全 0」被误判成「已配平」。
  const state: CloseRow['state'] =
    recon === null || !recon.hasData ? 'na' : recon.diffCount === 0 && recon.missCount === 0 ? 'done' : 'todo'
  return { key: 'reconciliation', col: 'billing', label: '收入核对', go: 'reconciliation', state, countable: true, review: 'na' }
}

/**
 * 本月锁账 = 该月**全部** countsTowardMonthClose 的键都 approved(D20)。
 *
 * 键集合**不在前端重算** —— 后端 `GET /api/review?period=` 发来的就是那个集合
 * (ReviewService.keysOf,含台账按公司数、附10 按期区数展开),这里只过滤与计数。
 * 重算一份就是第二份实现,而 §12 明写「计数与审核键集合必须与屏内同源,假绿栽过三次」。
 *
 * `elec-model` **不计入** —— 它没有清单行(§7.1),计入的话锁账永远达不成。
 *
 * ⚠ countable 保持 false:这一行是其余 14 行的同义反复,进分母等于把同一件事数两遍,
 *   而且会把 P2 定的六项计数口径改掉。
 */
function monthLockRow(review: ReviewRow[] | null): CloseRow {
  const base = { key: 'month-lock' as const, col: 'billing' as const, label: '本月锁账',
                 countable: false, review: 'na' as const }
  if (!review) return { ...base, state: 'na', locked: '审核态加载中' }
  const counted = review.filter(r => r.kind !== 'elec-model')
  // ⚠ 空集合**不算锁账**。`[].every(...)` 恒真那类假绿在 P2 的 chips 上栽过一次
  //   (「chips.length===0 必须靠 chips.length 守」),这里是同一个坑:回包空数组
  //   (全新库 / 端点回了个空)会被算成「14 张表全审完了」并在屏上打一个 ✓。
  //   拿不准就显「—」,不许替用户断言。
  if (counted.length === 0) return { ...base, state: 'na', locked: '审核态加载中' }
  const left = counted.filter(r => r.status !== 'approved').length
  return left === 0
    ? { ...base, state: 'done' }
    : { ...base, state: 'todo', locked: `还有 ${left} 张表没审完` }
}

export function rowsOf({ overview, recon, review }: RowsInput): CloseRow[] {
  const p = overview.period
  const period = p ? `${p.year}-${String(p.month).padStart(2, '0')}` : null
  const chainRows: CloseRow[] = overview.chain.steps.map(s => {
  // 出账链五步的 step.key 逐字就是前五个 kind code —— 所以这里直接拿 s.key 查 ROW_KINDS。
  // 后端哪天改了那个数组,ROW_KINDS 查不到就退成 'na',不会张冠李戴。
  const rvRows = pick(review, ROW_KINDS[s.key] ?? [])
  return {
    key: s.key,
    col: 'billing' as const,
    label: s.label,
    go: s.go,
    // 后端 buildChain 目前只产 done/current/todo 三值(DataHomeApiIT「出账链五步的状态取值受限」钉死
    // 取值域,算法源码里也是三选一的 ternary,'stale' 现在不会真的从这条链路来)。但 CloseRow.state 已
    // 声明 'stale' 档(spec §5.2 三态:未做/已做/需重算),不能把它并入 'todo' 死档 —— 用字符串比较
    // (越过 DataHomeStepDTO['status'] 的类型域)如实映射,不是猜的。
    state: (s.status === 'done' ? 'done' : (s.status as string) === 'stale' ? 'stale' : 'todo') as CloseRow['state'],
    countable: true,
    detail: s.detail,
    review: statusOf(rvRows),
    ...(rvRows.length === 1 ? { reviewKey: rvRows[0].key } : {}),
  }
  })
  const billing = [...chainRows, reconRow(recon), monthLockRow(review)]
  const booking = BOOKING_ROWS.map(row => bookingRow(row, overview.schedules.items, review, period))
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
    // 结构性 na 的行(导入中心、本月锁账)不进分母 —— 它们永远做不完,进分母会让「记账 7/8」永远差
    // 一格,用户会去找那一格是什么;与 spec §5.2「计数源缺显『—』不显 0」同源。收入核对不在此列
    // (评审修补 T3 fix-brief #5):它的 na 只是「暂时不知道」,一定会算完,恒排除会让分母随异步
    // 加载从 5 跳到 6。判据从「当下 state 是不是 na」换成「这一行结构上算不算得完」(countable)。
    if (!r.countable) continue
    byCol[r.col].total++
    if (r.state === 'done') byCol[r.col].done++
  }
  return { done: byCol.billing.done + byCol.booking.done, total: byCol.billing.total + byCol.booking.total, byCol }
}
