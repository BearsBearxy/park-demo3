// src/views/__tests__/reportPeriodGate.spec.ts — 报表层九屏的源码形状门禁(照 chainPeriodGate.spec 的写法)。
// 每屏都得有期间条(<FPStepStrip)并标出自己是哪一环;损益附表一 View 五值,current 是动态绑定。
// 立此门禁的直接原因:PnlScheduleView 的期间条在 977af27 合并时被 sed 反向引用写成字面「\1」,
// 丢了一个月没人发现(全仓零挂载测,报表层此前没有任何源码门禁),用户屏上真的显示一个「\1」。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const VIEWS = join(__dirname, '..')

/** 路由值 → 屏文件(current 写字面量的四屏)。 */
const FILES: Record<string, string> = {
  'income-statement': '/reports/income-statement/IncomeStatementView.vue',
  'balance-sheet': '/reports/balance-sheet/BalanceSheetView.vue',
  'trial-balance': '/reports/trial-balance/TrialBalanceView.vue',
  'reconciliation': '/reports/recon/ReconView.vue',
}
const PNL = '/reports/pnl/PnlScheduleView.vue'
const src = (rel: string) => readFileSync(join(VIEWS, rel), 'utf8')

describe('报表层期间条门禁', () => {
  it('五个文件都指得到 —— 表烂了下面全是空断言', () => {
    for (const rel of [...Object.values(FILES), PNL]) expect(src(rel).length).toBeGreaterThan(0)
  })

  it.each(Object.entries(FILES))('%s 有期间条且标出自己是哪一环', (route, rel) => {
    const s = src(rel)
    expect(s.includes('<FPStepStrip'), `${rel} 没有期间条 —— 九张报表横跳就换不了期`).toBe(true)
    expect(s.includes(`current="${route}"`), `${rel} 的期间条没标出自己是哪一环(current="${route}")`).toBe(true)
  })

  it('损益附表(一 View 五值)有期间条,current 动态绑定 config.route;模板里不许再有字面「\\1」', () => {
    const s = src(PNL)
    expect(s.includes('<FPStepStrip'), '附表1–5 没有期间条(977af27 的 sed 事故回潮)').toBe(true)
    expect(s.includes(':current="config.route"'), '一 View 五值,current 必须动态绑定').toBe(true)
    expect(/^\\1$/m.test(s), '模板里还留着 sed 反向引用的字面「\\1」').toBe(false)
  })
})
