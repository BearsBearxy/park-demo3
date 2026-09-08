// src/views/data-home/__tests__/monthClose.logic.spec.ts — monthClose.logic 折行纯函数单测(P2 T2)。
// 覆盖 task-2-brief.md 的 8 条最低要求 + chips 通用装置(附13/14、附7/8 各自的 tab/go)+
// companies/phases 为 null(非 undefined)时的防御性处理。
import { describe, it, expect } from 'vitest'
import { rowsOf, closeChecks } from '../monthClose.logic'
import type { DataHomeItemDTO, DataHomeOverviewDTO, DataHomeStepDTO } from '@/types/dataHome'
import type { ReconMonthMeta } from '@/types/recon'

// key/label/go/detail 四值各不相同 —— 若实现拿 key 顶替 label/go(比如 `go: s.key`),同值夹具会让
// 断言恒真看不出来。'stale' 不在 DataHomeStepDTO['status'] 类型域内(后端算法只产 done/current/todo,
// 见 fix-brief #2),这里放宽夹具类型仅为覆盖 CloseRow.state 的防御分支,用 cast 越过类型域。
function step(key: string, status: DataHomeStepDTO['status'] | 'stale'): DataHomeStepDTO {
  return { key, label: `${key}-label`, status: status as DataHomeStepDTO['status'], detail: `${key}-detail`, go: `${key}-go` }
}

// 业务时序:计费参数 → 园区抄表 → 公共电核算 → 楼栋损耗 → 催缴单
const MIXED_STEPS: DataHomeStepDTO[] = [
  step('params', 'todo'),   // 本月还没录电价 —— 专钉「链五步不许读 chainStepsOf」那颗假绿
  step('meters', 'done'),
  step('alloc', 'current'),
  step('alloc-loss', 'todo'),
  step('bill-notices', 'todo'),
]
const ALL_DONE_STEPS: DataHomeStepDTO[] = [
  step('params', 'done'), step('meters', 'done'), step('alloc', 'done'),
  step('alloc-loss', 'done'), step('bill-notices', 'done'),
]

function item(go: string, tag: string, done: boolean, extra: Partial<DataHomeItemDTO> = {}): DataHomeItemDTO {
  return { name: go, tag, done, go, companies: null, phases: null, ...extra }
}

function fullItems(overrides: Partial<Record<string, DataHomeItemDTO>> = {}): DataHomeItemDTO[] {
  const base: Record<string, DataHomeItemDTO> = {
    ledger: item('ledger', '凭证', false, {
      companies: [{ id: 1, short: 'A公司', done: true }, { id: 2, short: 'B公司', done: false }],
    }),
    'sales-income': item('sales-income', '附10', true, {
      phases: [{ no: 1, done: true }, { no: 2, done: false }, { no: 3, done: true }, { no: 4, done: true }],
    }),
    salary: item('salary', '附12', true),
    'utilities-office': item('utilities', '附13', true),
    'utilities-phase3': item('utilities', '附14', true),
    'pv-income': item('pv-income', '附6', true),
    'car-charging': item('car-charging', '附7', true),
    'ebike-charging': item('ebike-charging', '附8', true),
    'elec-cost': item('elec-cost', '附11', true),
    // 三大报表(2026-09-08):与月度台账同形 —— 按公司分格,公司全集来自后端
    'income-statement': item('income-statement', '报表', true, {
      companies: [{ id: 1, short: 'A公司', done: true }, { id: 2, short: 'B公司', done: true }],
    }),
    'balance-sheet': item('balance-sheet', '报表', true, {
      companies: [{ id: 1, short: 'A公司', done: true }, { id: 2, short: 'B公司', done: true }],
    }),
    'trial-balance': item('trial-balance', '报表', true, {
      companies: [{ id: 1, short: 'A公司', done: true }, { id: 2, short: 'B公司', done: true }],
    }),
  }
  // Object.values 对 Partial 的展开产出 (T | undefined)[] —— 严格模式下要显式收窄
  return Object.values({ ...base, ...overrides }).filter((x): x is DataHomeItemDTO => x != null)
}

function overview(steps: DataHomeStepDTO[], items: DataHomeItemDTO[]): DataHomeOverviewDTO {
  return {
    period: { year: 2026, month: 9, label: '2026年9月' },
    months: ['2026-09'],
    blockers: [],
    chain: { currentIndex: 2, steps },
    schedules: { done: items.filter(i => i.done).length, total: 9, items },
  }
}

const RECON_OK: ReconMonthMeta = { month: 9, hasData: true, entityCount: 5, okCount: 5, diffCount: 0, missCount: 0 }
const RECON_DIFF: ReconMonthMeta = { month: 9, hasData: true, entityCount: 5, okCount: 3, diffCount: 2, missCount: 0 }
const RECON_MISS: ReconMonthMeta = { month: 9, hasData: true, entityCount: 5, okCount: 4, diffCount: 0, missCount: 1 }
// 空月:后端每年恒发 12 个 MonthMeta,没数据的月 hasData=false 且四个计数全 0 —— 专钉「hasData 闸」。
const RECON_EMPTY: ReconMonthMeta = { month: 9, hasData: false, entityCount: 0, okCount: 0, diffCount: 0, missCount: 0 }

// 出账链五步全部走到 status='stale' 分支的最小样例(后端目前不发,见 step() 上方注释)。
const STALE_STEP: DataHomeStepDTO[] = [
  step('params', 'stale'), step('meters', 'done'), step('alloc', 'todo'),
  step('alloc-loss', 'todo'), step('bill-notices', 'todo'),
]

// 记账列 11 行全 done 的样例:companies/phases 子项也都填成 true,不能只改源项自己的 done。
function allDoneItems(): DataHomeItemDTO[] {
  return fullItems({
    ledger: item('ledger', '凭证', true, {
      companies: [{ id: 1, short: 'A公司', done: true }, { id: 2, short: 'B公司', done: true }],
    }),
    'sales-income': item('sales-income', '附10', true, {
      phases: [{ no: 1, done: true }, { no: 2, done: true }, { no: 3, done: true }, { no: 4, done: true }],
    }),
  })
}

describe('monthClose.logic', () => {
  it('出账列 7 行:链五步 + 收入核对 + 本月锁账,顺序即业务时序', () => {
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK, review: null })
    const billing = rows.filter(r => r.col === 'billing')
    expect(billing.map(r => r.key)).toEqual([
      'params', 'meters', 'alloc', 'alloc-loss', 'bill-notices', 'reconciliation', 'month-lock',
    ])
  })

  it('记账列 11 行:附13+附14 折成「办公·三期水电」一行、附7+附8 折成「附表7/8」一行、加导入中心', () => {
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK, review: null })
    const booking = rows.filter(r => r.col === 'booking')
    expect(booking.map(r => r.label)).toEqual([
      '月度台账', '附表10', '附表12', '办公·三期水电', '附表6', '附表7/8', '附表11',
      '利润表', '资产负债表', '科目余额表', '导入中心',
    ])
  })

  it('附13+附14 合并行:两项都 done 才算 done —— 只做了附13 是 todo,不是 done;各自 chip 带自己的 tab', () => {
    const items = fullItems({ 'utilities-phase3': item('utilities', '附14', false) })
    const rows = rowsOf({ overview: overview(MIXED_STEPS, items), recon: RECON_OK, review: null })
    const utilities = rows.find(r => r.key === 'utilities')!
    expect(utilities.state).toBe('todo')
    // R2 起 chip 多带两个字段:自己那把审核键 + 审核态(review 传 null 时态是 'na',
    // 但键照给 —— 键只跟期与 scope 有关,不依赖审核数据到没到)
    expect(utilities.chips).toEqual([
      { label: '办公', done: true, tab: 'office', reviewKey: 'utilities:office:2026-09', review: 'na' },
      { label: '三期', done: false, tab: 'phase3', reviewKey: 'utilities:phase3:2026-09', review: 'na' },
    ])
  })

  it('附7+附8 合并行:两项都 done 才算 done,各自 chip 带自己的 nav value', () => {
    const items = fullItems({ 'ebike-charging': item('ebike-charging', '附8', false) })
    const rows = rowsOf({ overview: overview(MIXED_STEPS, items), recon: RECON_OK, review: null })
    const charging = rows.find(r => r.key === 'charging')!
    expect(charging.state).toBe('todo')
    expect(charging.chips).toEqual([
      { label: '汽车', done: true, go: 'car-charging', reviewKey: 'charging-car:2026-09', review: 'na' },
      { label: '电动车', done: false, go: 'ebike-charging', reviewKey: 'charging-ebike:2026-09', review: 'na' },
    ])
  })

  // R2 起本月锁账是**派生**的(全部键 approved),但判据只认审核态 —— 出账链五步全 done
  // 也不许降级成「已锁账」,那是假绿。审核态没到时仍是 na。
  it('审核态没到时本月锁账仍是 na —— 出账链五步全完成也不降级成「已锁账」', () => {
    const rows = rowsOf({ overview: overview(ALL_DONE_STEPS, fullItems()), recon: RECON_OK, review: null })
    const lock = rows.find(r => r.key === 'month-lock')!
    expect(lock.state).toBe('na')
    expect(lock.locked).toBeTruthy()
  })

  it('导入中心恒 na —— 它不在后端 9 源里,混进一条 go=import 的假源也不改变它', () => {
    const items = fullItems()
    items.push(item('import', '', true))   // 假源:若实现误按 go 匹配会把这行读成 done
    const rows = rowsOf({ overview: overview(MIXED_STEPS, items), recon: RECON_OK, review: null })
    const imp = rows.find(r => r.key === 'import')!
    expect(imp.state).toBe('na')
    expect(imp.chips).toBeUndefined()
  })

  it('收入核对:recon 为 null 时 na;diffCount/missCount 都是 0 才 done,否则 todo', () => {
    const base = overview(MIXED_STEPS, fullItems())
    const naRow = rowsOf({ overview: base, recon: null, review: null }).find(r => r.key === 'reconciliation')!
    const doneRow = rowsOf({ overview: base, recon: RECON_OK, review: null }).find(r => r.key === 'reconciliation')!
    const diffRow = rowsOf({ overview: base, recon: RECON_DIFF, review: null }).find(r => r.key === 'reconciliation')!
    const missRow = rowsOf({ overview: base, recon: RECON_MISS, review: null }).find(r => r.key === 'reconciliation')!
    expect(naRow.state).toBe('na')
    expect(doneRow.state).toBe('done')
    expect(diffRow.state).toBe('todo')
    expect(missRow.state).toBe('todo')   // diffCount=0 但 missCount=1 —— 只查 diffCount 会漏这档
  })

  it('计数从渲染的行算,不抄 schedules.total —— 结构性 na 的行不进分母,记账列分母是 10、出账列分母是 6', () => {
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK, review: null })
    const { byCol } = closeChecks(rows)
    expect(byCol.booking.total).toBe(10)
    expect(byCol.billing.total).toBe(6)
  })

  // 评审修补(task-3-fix-brief.md #5):分母排除的是「结构性 na」(导入中心 / 本月锁账,恒做不完),
  // 不是「当下 state 为 na」——收入核对的 na 只是「recon 还没到达」,真能做完,不能因为异步加载
  // 就把出账分母从 6 撞成 5。旧口径(`if (r.state === 'na') continue`)下这条会失败(billing.total=5)。
  it('分母只排除结构性 na(导入中心/本月锁账)——收入核对未到(na)时也计入分母,出账恒 6、记账恒 10', () => {
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: null, review: null })
    const { byCol } = closeChecks(rows)
    expect(byCol.billing.total).toBe(6)   // 5 链步 + 收入核对(countable,即使此刻是 na)
    expect(byCol.booking.total).toBe(10)
    const recon = rows.find(r => r.key === 'reconciliation')!
    const lock = rows.find(r => r.key === 'month-lock')!
    const imp = rows.find(r => r.key === 'import')!
    expect(recon.countable, '收入核对不是结构性 na —— 只是暂时不知道,要进分母').toBe(true)
    expect(lock.countable, '本月锁账是结构性 na —— 审核机制未上线,不进分母').toBe(false)
    expect(imp.countable, '导入中心是结构性 na —— 没有这个数据源,不进分母').toBe(false)
  })

  it('链五步的状态取 overview.chain.steps[i].status —— 不许用 chainStepsOf,它的第一步恒 done', () => {
    // MIXED_STEPS 里 params 是 'todo'(本月没录电价);chainStepsOf 会把它读成恒 done。
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK, review: null })
    const params = rows.find(r => r.key === 'params')!
    expect(params.state).toBe('todo')
  })

  it('链步 status="current" 折成 todo —— 两栏清单只有 done/没 done,current 不是独立状态', () => {
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK, review: null })
    const alloc = rows.find(r => r.key === 'alloc')!
    expect(alloc.state).toBe('todo')
  })

  it('台账行带公司 chips:没录的公司也在(灰的,done:false),co 是公司 id', () => {
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK, review: null })
    const ledger = rows.find(r => r.key === 'ledger')!
    expect(ledger.chips).toEqual([
      { label: 'A公司', done: true, co: 1, reviewKey: 'ledger:1:2026-09', review: 'na' },
      { label: 'B公司', done: false, co: 2, reviewKey: 'ledger:2:2026-09', review: 'na' },
    ])
  })

  it('附10 行带四个期区 chips,co 是期区 no', () => {
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK, review: null })
    const s10 = rows.find(r => r.key === 'sales-income')!
    expect(s10.chips).toEqual([
      { label: '一期', done: true, co: 1, reviewKey: 's10:1:2026-09', review: 'na' },
      { label: '二期', done: false, co: 2, reviewKey: 's10:2:2026-09', review: 'na' },
      { label: '三期', done: true, co: 3, reviewKey: 's10:3:2026-09', review: 'na' },
      { label: '宿舍', done: true, co: 4, reviewKey: 's10:4:2026-09', review: 'na' },
    ])
  })

  it('companies/phases 线上发的是 null 不是 undefined —— 台账/附10 遇到 null 不炸,chips 是空数组', () => {
    const items = fullItems({
      ledger: item('ledger', '凭证', false, { companies: null }),
      'sales-income': item('sales-income', '附10', true, { phases: null }),
    })
    const rows = rowsOf({ overview: overview(MIXED_STEPS, items), recon: RECON_OK, review: null })
    expect(rows.find(r => r.key === 'ledger')!.chips).toEqual([])
    expect(rows.find(r => r.key === 'sales-income')!.chips).toEqual([])
  })

  // ── 以下为评审修补补的断言(task-2-fix-brief.md) ──────────────────────────────────

  it('收入核对:hasData=false 的空月(四计数全 0)判 na,不判 done(先过 hasData 闸,同 ReconView.vue 口径)', () => {
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_EMPTY, review: null })
    expect(rows.find(r => r.key === 'reconciliation')!.state).toBe('na')
  })

  it('链步 status 是 stale 时行 state 也是 stale —— 不折进 todo(后端目前不发,防御分支,越过类型域测)', () => {
    const rows = rowsOf({ overview: overview(STALE_STEP, fullItems()), recon: RECON_OK, review: null })
    expect(rows.find(r => r.key === 'params')!.state).toBe('stale')
  })

  it('台账行:chips 收严 —— 源项自己说 done,但有一个公司没做,行仍是 todo(所有 chip 都 done 才算 done)', () => {
    const items = fullItems({
      ledger: item('ledger', '凭证', true, {
        companies: [{ id: 1, short: 'A公司', done: true }, { id: 2, short: 'B公司', done: false }],
      }),
    })
    const rows = rowsOf({ overview: overview(MIXED_STEPS, items), recon: RECON_OK, review: null })
    expect(rows.find(r => r.key === 'ledger')!.state).toBe('todo')
  })

  it('台账行:companies 为 null(chips 空数组)时不能靠 [].every() 恒真判 done,退回源项自己的 done', () => {
    const items = fullItems({
      ledger: item('ledger', '凭证', false, { companies: null }),
    })
    const rows = rowsOf({ overview: overview(MIXED_STEPS, items), recon: RECON_OK, review: null })
    expect(rows.find(r => r.key === 'ledger')!.state).toBe('todo')
  })

  it('出账链五步全 done 时,五行状态都是 done', () => {
    const rows = rowsOf({ overview: overview(ALL_DONE_STEPS, fullItems()), recon: RECON_OK, review: null })
    const steps = rows.filter(r => ['params', 'meters', 'alloc', 'alloc-loss', 'bill-notices'].includes(r.key))
    expect(steps.map(r => r.state)).toEqual(['done', 'done', 'done', 'done', 'done'])
  })

  it('记账列单源行(无 chips):源项 done 时行也是 done(附12/附6/附11)', () => {
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK, review: null })
    expect(rows.find(r => r.key === 'salary')!.state).toBe('done')
    expect(rows.find(r => r.key === 'pv-income')!.state).toBe('done')
    expect(rows.find(r => r.key === 'elec-cost')!.state).toBe('done')
  })

  it('closeChecks 的分子是渲染出的 done 行数,不是写死 0 —— 全 done 夹具下应等于分母', () => {
    const rows = rowsOf({ overview: overview(ALL_DONE_STEPS, allDoneItems()), recon: RECON_OK, review: null })
    const { done, total, byCol } = closeChecks(rows)
    expect(byCol.billing).toEqual({ done: 6, total: 6 })
    expect(byCol.booking).toEqual({ done: 10, total: 10 })
    expect(done).toBe(16)
    expect(total).toBe(16)
  })

  it('BOOKING_ROWS 里有条目、但后端没发对应 source 时那一行是 na(防御路径,不是导入中心那条)', () => {
    const items = fullItems().filter(it => it.go !== 'salary')   // 模拟后端漏发附12源
    const rows = rowsOf({ overview: overview(MIXED_STEPS, items), recon: RECON_OK, review: null })
    expect(rows.find(r => r.key === 'salary')!.state).toBe('na')
  })

  it('链步的 detail/go 原样透传,不是拿 key 顶替(step 夹具 key/label/go 各不相同)', () => {
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK, review: null })
    const meters = rows.find(r => r.key === 'meters')!
    expect(meters.detail).toBe('meters-detail')
    expect(meters.go).toBe('meters-go')
  })

  it('记账列 11 行的 go/tag 逐行钉住(合并 + 三大报表之后深链入口一个不丢)', () => {
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK, review: null })
    const booking = rows.filter(r => r.col === 'booking')
    const expected: Record<string, { go?: string; tag?: string }> = {
      ledger: { go: 'ledger', tag: '凭证' },
      'sales-income': { go: 'sales-income', tag: '附10' },
      salary: { go: 'salary', tag: '附12' },
      utilities: { go: 'utilities', tag: '附13/14' },
      'pv-income': { go: 'pv-income', tag: '附6' },
      charging: { go: 'car-charging', tag: '附7/8' },
      'elec-cost': { go: 'elec-cost', tag: '附11' },
      'income-statement': { go: 'income-statement', tag: '报表' },
      'balance-sheet': { go: 'balance-sheet', tag: '报表' },
      'trial-balance': { go: 'trial-balance', tag: '报表' },
      import: { go: 'import', tag: undefined },
    }
    // 行数与表长必须相等 —— 少写一行,下面那个循环会跳过它而不是报错(表里没有 = 恒不检查)
    expect(booking.map(r => r.key)).toHaveLength(Object.keys(expected).length)
    for (const row of booking) {
      expect(expected[row.key], `${row.key} 不在钉住表里`).toBeDefined()
      expect(row.go).toBe(expected[row.key].go)
      expect(row.tag).toBe(expected[row.key].tag)
    }
  })

  it('收入核对/本月锁账:label 与 go 钉住 —— 无入口的行不给 go', () => {
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK, review: null })
    const recon = rows.find(r => r.key === 'reconciliation')!
    const lock = rows.find(r => r.key === 'month-lock')!
    expect(recon.label).toBe('收入核对')
    expect(recon.go).toBe('reconciliation')
    expect(lock.label).toBe('本月锁账')
    expect(lock.go).toBeUndefined()
  })

  it('单源行(附12/附6/附11)没有子入口,chips 是 undefined —— 真正调到 chipsFor 的兜底分支(非 na 早退)', () => {
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK, review: null })
    expect(rows.find(r => r.key === 'salary')!.chips).toBeUndefined()
    expect(rows.find(r => r.key === 'pv-income')!.chips).toBeUndefined()
    expect(rows.find(r => r.key === 'elec-cost')!.chips).toBeUndefined()
  })
})


// ══════════ 审核态落数(SIDEBAR-UX-REDESIGN §7.5,R2 T5) ══════════
//
// 屏上要能分清三件事,它们在清单上是三个不同的字:
//   · 审核态没到 → 「—」(na)
//   · 到了、这把键没有落库行 → 「未交审」(entered)
//   · 到了、有行 → 该行的状态
// 混起来就是对用户撒谎,所以这一组断言先钉这三档。
import type { ReviewRow, ReviewStatus } from '@/types/review'

const P9 = '2026-09'
function rv(key: string, kind: string, status: ReviewStatus, scope: string | null = null): ReviewRow {
  return { key, kind, scope, status, submittedBy: null, submittedAt: null,
           reviewedBy: null, reviewedAt: null, reason: null, blockedBy: [] }
}

/** 后端 GET /api/review?period= 发的是**全集**(含派生 entered),这里照那个形状造。 */
function fullReview(over: Record<string, ReviewStatus> = {}): ReviewRow[] {
  const mk = (key: string, kind: string, scope: string | null = null) =>
    rv(key, kind, over[key] ?? 'entered', scope)
  return [
    mk(`params:${P9}`, 'params'), mk(`meters:${P9}`, 'meters'), mk(`alloc:${P9}`, 'alloc'),
    mk(`alloc-loss:${P9}`, 'alloc-loss'), mk(`bill-notices:${P9}`, 'bill-notices'),
    mk(`ledger:1:${P9}`, 'ledger', '1'), mk(`ledger:2:${P9}`, 'ledger', '2'),
    mk(`s10:1:${P9}`, 's10', '1'), mk(`s10:2:${P9}`, 's10', '2'),
    mk(`s10:3:${P9}`, 's10', '3'), mk(`s10:4:${P9}`, 's10', '4'),
    mk(`salary:${P9}`, 'salary'),
    mk(`utilities:office:${P9}`, 'utilities', 'office'), mk(`utilities:phase3:${P9}`, 'utilities', 'phase3'),
    mk(`pv:${P9}`, 'pv'), mk(`charging-car:${P9}`, 'charging-car'),
    mk(`charging-ebike:${P9}`, 'charging-ebike'), mk(`elec-cost:${P9}`, 'elec-cost'),
    mk(`elec-model:${P9}`, 'elec-model'),
  ]
}

const rowsWith = (review: ReviewRow[] | null) =>
  rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK, review })
const byKey = (rs: ReturnType<typeof rowsOf>, k: string) => rs.find(r => r.key === k)!

describe('清单的审核态(R2)', () => {
  // 破坏验证:把 statusOf 的空集分支从 'na' 改成 'entered' → 红
  it('❗审核态没到显「—」,不许当成「未交审」', () => {
    const rs = rowsWith(null)
    expect(rs.every(r => r.review === 'na'), '一行都不该猜').toBe(true)
    expect(byKey(rs, 'month-lock').state).toBe('na')
  })

  it('到了但这把键没落库行 → 未交审(entered)', () => {
    expect(byKey(rowsWith(fullReview()), 'salary').review).toBe('entered')
  })

  it('单键行落到自己的键与态,并带上行级 reviewKey(行上的交审按钮要用)', () => {
    const rs = rowsWith(fullReview({ [`salary:${P9}`]: 'approved', [`params:${P9}`]: 'submitted' }))
    expect(byKey(rs, 'salary').review).toBe('approved')
    expect(byKey(rs, 'salary').reviewKey).toBe(`salary:${P9}`)
    expect(byKey(rs, 'params').review).toBe('submitted')
  })

  // ❗破坏验证:把 leastOf 改成取第一个 / 取最大 → 红
  it('❗多键行取「最不进展」的那个 —— 一行显已审核而底下挂着没交审的公司是自相矛盾', () => {
    const rs = rowsWith(fullReview({ [`ledger:1:${P9}`]: 'approved' }))   // 2 号公司仍是 entered
    expect(byKey(rs, 'ledger').review).toBe('entered')
    expect(byKey(rs, 'ledger').reviewKey, '多键行不给行级键,动作长在 chip 上').toBeUndefined()

    const rs2 = rowsWith(fullReview({ [`ledger:1:${P9}`]: 'approved', [`ledger:2:${P9}`]: 'submitted' }))
    expect(byKey(rs2, 'ledger').review, 'submitted 比 approved 不进展').toBe('submitted')
  })

  // 破坏验证:把 chipsFor 的 rv() 里 scope 传 null → 红(所有公司 chip 会共用一把键)
  it('❗chips 各带各的键与态:台账按公司、附10 按期区', () => {
    const rs = rowsWith(fullReview({ [`ledger:2:${P9}`]: 'approved', [`s10:3:${P9}`]: 'submitted' }))
    const led = byKey(rs, 'ledger').chips!
    expect(led.map(c => [c.reviewKey, c.review]))
      .toEqual([[`ledger:1:${P9}`, 'entered'], [`ledger:2:${P9}`, 'approved']])
    const s10 = byKey(rs, 'sales-income').chips!
    expect(s10.find(c => c.label === '三期')!.review).toBe('submitted')
    expect(s10.find(c => c.label === '一期')!.review).toBe('entered')
  })

  // ❗附表7/8 是两个 kind,不是一个 kind 的两个 scope(后端 ReviewKind 头注第三坑)。
  //   破坏验证:把 charging 那支 rv() 的 kind 写死成 'charging' → 红
  it('❗附7/8 合并行的两枚 chip 各挂各的 kind', () => {
    const rs = rowsWith(fullReview({ [`charging-ebike:${P9}`]: 'approved' }))
    const chips = byKey(rs, 'charging').chips!
    expect(chips.find(c => c.label === '汽车')!.reviewKey).toBe(`charging-car:${P9}`)
    expect(chips.find(c => c.label === '电动车')!.reviewKey).toBe(`charging-ebike:${P9}`)
    expect(chips.find(c => c.label === '电动车')!.review).toBe('approved')
    expect(byKey(rs, 'charging').review, '汽车还没交审 → 行取最不进展').toBe('entered')
  })

  // 附13/14 是同一个 kind 的两个 scope
  it('附13 / 附14 两枚 chip 按 scope 分键', () => {
    const chips = byKey(rowsWith(fullReview({ [`utilities:phase3:${P9}`]: 'returned' })), 'utilities').chips!
    expect(chips.find(c => c.label === '办公')!.reviewKey).toBe(`utilities:office:${P9}`)
    expect(chips.find(c => c.label === '三期')!.review).toBe('returned')
  })

  it('收入核对与导入中心没有审核键,恒 na(§7.1 末句:收入核对本轮不进审核)', () => {
    const rs = rowsWith(fullReview())
    expect(byKey(rs, 'reconciliation').review).toBe('na')
    expect(byKey(rs, 'import').review).toBe('na')
  })
})

describe('本月锁账(D20)', () => {
  const allApproved = (): ReviewRow[] =>
    fullReview().map(r => ({ ...r, status: 'approved' as ReviewStatus }))

  it('全审 → done', () => {
    expect(byKey(rowsWith(allApproved()), 'month-lock').state).toBe('done')
  })

  // ❗这一条钉 2026-09-07 拆两把键那个裁定。
  //   破坏验证:把 monthLockRow 里的 `r.kind !== 'elec-model'` 过滤删掉 → 红
  it('❗只差 elec-model 没审 → 照样算锁账(它没有清单行,计入就永远达不成)', () => {
    const all = allApproved().map(r => r.kind === 'elec-model' ? { ...r, status: 'entered' as ReviewStatus } : r)
    expect(byKey(rowsWith(all), 'month-lock').state).toBe('done')
  })

  // 破坏验证:把 left 的比较从 !== 'approved' 改成 === 'entered' → 红(待审核会被当成审完)
  it('❗差一张就不算,并点名还差几张;待审核不算审完', () => {
    const one = allApproved().map(r => r.key === `salary:${P9}` ? { ...r, status: 'submitted' as ReviewStatus } : r)
    const row = byKey(rowsWith(one), 'month-lock')
    expect(row.state).toBe('todo')
    expect(row.locked).toBe('还有 1 张表没审完')
  })

  // 破坏验证:把 monthLockRow 的 countable 改成 true → 红
  it('❗本月锁账不进分母 —— 它是其余 14 行的同义反复,进分母等于同一件事数两遍', () => {
    const a = closeChecks(rowsWith(null))
    const b = closeChecks(rowsWith(allApproved()))
    expect(a.byCol.billing.total, '审核态到不到都不该改分母').toBe(b.byCol.billing.total)
    expect(byKey(rowsWith(allApproved()), 'month-lock').countable).toBe(false)
  })
})


// ══════════ 三大报表进清单(2026-09-08) ══════════
//
// 后端的闸已经挂上了(ReviewGuardChainIT);这里钉的是**入口** —— 屏上得有地方交审,
// 否则闸就是死代码:审不了就永远到不了「已审核」,闸一辈子不生效(elec-model 犯过这个错)。
describe('三大报表的清单行', () => {
  // 夹具 overview 的期就是 2026-09(见文件头 overview()),键按它拼
  const P = '2026-09'
  const full = () => rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK,
                              review: null })
  const rowOf = (k: string) => full().find(r => r.key === k)!

  it('三行都在记账列,各带公司格', () => {
    for (const k of ['income-statement', 'balance-sheet', 'trial-balance']) {
      const r = rowOf(k)
      expect(r.col, `${k} 该在记账列`).toBe('booking')
      expect(r.chips?.map(c => c.label), `${k} 要按公司分格`).toEqual(['A公司', 'B公司'])
    }
  })

  // ❗破坏验证:把 chipsFor 里 REPORT_KIND 那一支删掉 → 红(没有键就没有动作可挂,屏上交不了审)。
  it('❗每格带自己的审核键 —— 三张表三个 kind,公司进 scope', () => {
    const keyOf = (k: string) => rowOf(k).chips!.map(c => c.reviewKey)
    expect(keyOf('income-statement')).toEqual([`report-is:1:${P}`, `report-is:2:${P}`])
    expect(keyOf('balance-sheet')).toEqual([`report-bs:1:${P}`, `report-bs:2:${P}`])
    expect(keyOf('trial-balance')).toEqual([`report-tb:1:${P}`, `report-tb:2:${P}`])
  })

  // ❗破坏验证:把 ROW_KINDS 里那三项删掉 → 红(行级审核态恒 na,整行显「—」、动作全不出)。
  it('❗行级审核态按各自的 kind 取,不许串台', () => {
    // ⚠ 照后端清单道的真形状造:它发的是**该月全部键**,没落库的那把也发,状态是派生的 entered。
    //   只造已落库的那几行是不真的 —— 那样 2 号公司会整个缺席,而缺席与「未交审」在
    //   leastOf 里是两回事(缺席不参与比较,未交审会把整行拉回未交审)。
    const review: ReviewRow[] = [
      rv(`report-is:1:${P}`, 'report-is', 'approved', '1'),
      rv(`report-is:2:${P}`, 'report-is', 'approved', '2'),
      rv(`report-bs:1:${P}`, 'report-bs', 'submitted', '1'),
      rv(`report-bs:2:${P}`, 'report-bs', 'entered', '2'),
      rv(`report-tb:1:${P}`, 'report-tb', 'entered', '1'),
      rv(`report-tb:2:${P}`, 'report-tb', 'entered', '2'),
    ]
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK, review })
    expect(rows.find(r => r.key === 'income-statement')!.review, '两家都审完').toBe('approved')
    // 资产负债表只有 1 号公司交了审、2 号一条记录都没有 → 取「最不进展」= 未交审
    expect(rows.find(r => r.key === 'balance-sheet')!.review, '一家没交就不算').toBe('entered')
    expect(rows.find(r => r.key === 'trial-balance')!.review, '两家都没交').toBe('entered')
  })

  // 报表不进整月锁账(后端 ReviewKind 那一位是 false),屏上的「本月锁账」判据要与它同源。
  it('报表没审也不挡本月锁账 —— 与后端 countsTowardMonthClose 同源', () => {
    const others = fullReview().filter(r => !r.kind.startsWith('report-'))
                               .map(r => ({ ...r, status: 'approved' as ReviewStatus }))
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK,
                          review: others })
    expect(rows.find(r => r.key === 'month-lock')!.state,
      '报表一条都没审,锁账照样成立').toBe('done')
  })
})
