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
  }
  return Object.values({ ...base, ...overrides })
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

// 记账列 8 行全 done 的样例:companies/phases 子项也都填成 true,不能只改源项自己的 done。
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

  it('记账列 8 行:附13+附14 折成「办公·三期水电」一行、附7+附8 折成「附表7/8」一行、加导入中心', () => {
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK, review: null })
    const booking = rows.filter(r => r.col === 'booking')
    expect(booking.map(r => r.label)).toEqual([
      '月度台账', '附表10', '附表12', '办公·三期水电', '附表6', '附表7/8', '附表11', '导入中心',
    ])
  })

  it('附13+附14 合并行:两项都 done 才算 done —— 只做了附13 是 todo,不是 done;各自 chip 带自己的 tab', () => {
    const items = fullItems({ 'utilities-phase3': item('utilities', '附14', false) })
    const rows = rowsOf({ overview: overview(MIXED_STEPS, items), recon: RECON_OK, review: null })
    const utilities = rows.find(r => r.key === 'utilities')!
    expect(utilities.state).toBe('todo')
    expect(utilities.chips).toEqual([
      { label: '办公', done: true, tab: 'office' },
      { label: '三期', done: false, tab: 'phase3' },
    ])
  })

  it('附7+附8 合并行:两项都 done 才算 done,各自 chip 带自己的 nav value', () => {
    const items = fullItems({ 'ebike-charging': item('ebike-charging', '附8', false) })
    const rows = rowsOf({ overview: overview(MIXED_STEPS, items), recon: RECON_OK, review: null })
    const charging = rows.find(r => r.key === 'charging')!
    expect(charging.state).toBe('todo')
    expect(charging.chips).toEqual([
      { label: '汽车', done: true, go: 'car-charging' },
      { label: '电动车', done: false, go: 'ebike-charging' },
    ])
  })

  it('本月锁账恒 na(审核机制未上线)——即使出账链五步全部完成也不降级成「已锁账」,且带 locked 文案', () => {
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

  it('计数从渲染的行算,不抄 schedules.total —— 结构性 na 的行不进分母,记账列分母是 7、出账列分母是 6', () => {
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK, review: null })
    const { byCol } = closeChecks(rows)
    expect(byCol.booking.total).toBe(7)
    expect(byCol.billing.total).toBe(6)
  })

  // 评审修补(task-3-fix-brief.md #5):分母排除的是「结构性 na」(导入中心 / 本月锁账,恒做不完),
  // 不是「当下 state 为 na」——收入核对的 na 只是「recon 还没到达」,真能做完,不能因为异步加载
  // 就把出账分母从 6 撞成 5。旧口径(`if (r.state === 'na') continue`)下这条会失败(billing.total=5)。
  it('分母只排除结构性 na(导入中心/本月锁账)——收入核对未到(na)时也计入分母,出账恒 6、记账恒 7', () => {
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: null, review: null })
    const { byCol } = closeChecks(rows)
    expect(byCol.billing.total).toBe(6)   // 5 链步 + 收入核对(countable,即使此刻是 na)
    expect(byCol.booking.total).toBe(7)
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
      { label: 'A公司', done: true, co: 1 },
      { label: 'B公司', done: false, co: 2 },
    ])
  })

  it('附10 行带四个期区 chips,co 是期区 no', () => {
    const rows = rowsOf({ overview: overview(MIXED_STEPS, fullItems()), recon: RECON_OK, review: null })
    const s10 = rows.find(r => r.key === 'sales-income')!
    expect(s10.chips).toEqual([
      { label: '一期', done: true, co: 1 },
      { label: '二期', done: false, co: 2 },
      { label: '三期', done: true, co: 3 },
      { label: '宿舍', done: true, co: 4 },
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
    expect(byCol.booking).toEqual({ done: 7, total: 7 })
    expect(done).toBe(13)
    expect(total).toBe(13)
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

  it('记账列 8 行的 go/tag 逐行钉住(合并成 8 行之后深链入口一个不丢)', () => {
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
      import: { go: 'import', tag: undefined },
    }
    for (const row of booking) {
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
