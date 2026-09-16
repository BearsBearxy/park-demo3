// src/views/__tests__/anaScreenSkeleton.spec.ts — C6-01 第 4 步:四张分析屏首进的真版式骨架挂载测。
//
// 钉的是**坐标**,不是「有没有骨架」:每块 .fp-shim 的高必须等于它顶替的那块的高
// (图块 = 调用处 :height 字面值,文字行 = 行盒 20(--lh-snug 是长度,与字号无关),
//  表块 = .ak-tbl 表头 30(行盒 20 + padding-bottom 9 + 下边框 1)+ 行高 38 × 行数),
// 顺序也钉 —— 顺序错了等于骨架和真版式的块对不上,硬切时位移就回来了。
//
// 夹具不用退化数据:anaData 的取数一律停在 pending(永不 resolve),这正是真实首进那几百毫秒的状态;
// 用空数组 resolve 会走到「空态」分支,测不到骨架。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mount } from '@vue/test-utils'
import { flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

beforeEach(() => setActivePinia(createPinia()))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/components/ana/AnaEChart.vue', () => ({
  default: { name: 'AnaEChart', props: ['option', 'height'], template: '<div class="stub-chart" />' },
}))

const pending = () => new Promise<never>(() => {})
vi.mock('@/analysis/anaData', () => ({
  // 外壳的月份列表照常到位 —— 它与各屏自己的数据无关(AnaShell 的 !loaded 门已删,C6-01 ①)
  fetchAvailableMonths: vi.fn(async () => ({ months: ['2026-08'], sources: { pnl: ['2026-08'] } })),
  fetchLedgerRows: vi.fn(() => pending()),
  fetchS10Rows: vi.fn(() => pending()),
  fetchS10TenantMap: vi.fn(() => pending()),
  fetchTenants: vi.fn(() => pending()),
  fetchContracts: vi.fn(() => pending()),
  fetchBuildings: vi.fn(() => pending()),
  fetchContractDetail: vi.fn(() => pending()),
  invalidateAnaCache: vi.fn(),
}))

import ChurnView from '@/views/analysis/ChurnView.vue'
import TenantEnergyView from '@/views/analysis/TenantEnergyView.vue'
import TenantPortfolioView from '@/views/analysis/TenantPortfolioView.vue'
import TenantPeerView from '@/views/analysis/TenantPeerView.vue'

const STUBS = { global: { stubs: { RouterLink: true, teleport: true } } }

/** 骨架里每块 .fp-shim 的行内高,按 DOM 顺序 */
async function shimHeights(comp: unknown, root: string) {
  const w = mount(comp as never, STUBS)
  await flushPromises()
  expect(w.find(root).exists(), `首进没出骨架 ${root}`).toBe(true)
  expect(w.find('.page-spin').exists(), '版式已知还在转圈').toBe(false)
  return {
    w,
    heights: w.findAll(`${root} .fp-shim`).map((e) => (e.element as HTMLElement).style.height),
  }
}

describe('C6-01 · 分析屏首进骨架逐块照真版式的高钉死', () => {
  // 2026-09-16 起页头 / 卡头 / 图例照抄真版式(不再是灰条),灰条只剩图块与表块;KPI 槽摆同数占位瓦
  it('❗流失预警:散点 300 · 已流失表 330 · 明细表 420 · 流向图 300;KPI 摆 6 张占位瓦', async () => {
    const { w, heights } = await shimHeights(ChurnView, '.churn-skel')
    expect(heights).toEqual([
      '300px',                        // s8 风险象限散点 :height 300
      '330px',                        // s4 已流失清单 .churn-scroll max-height 330
      '420px',                        // s8 流失预警明细 .churn-scroll.tall 420
      '300px',                        // s4 s10 逐月出现/消失 :height 300
    ])
    expect(w.find('.churn-skel .ak-title').text(), '页头照抄真版式').toBe('租户流失预警')
    expect(w.find('.churn-skel .cz-legend').exists(), '图例行照抄真版式').toBe(true)
    expect(w.find('.anx-kpis').exists()).toBe(true)
    expect(w.findAll('.anx-kpis .anx-kpi-hold')).toHaveLength(6)
  })

  it('❗租户用能:左列列表 >1280 flex:1、≤1280 钉 560 · 趋势 300 · 应收实收 200 · Top20 440 · 散点 440', async () => {
    const { w, heights } = await shimHeights(TenantEnergyView, '.te2-skel')
    expect(heights).toEqual([
      '',                             // 左列列表条(flex:1,高由右列那栏定);卡头 / 搜索框照抄真版式
      '300px',                        // 趋势卡 :height 300(读数句 / 参照系是真版式同类的 <p>)
      '200px',                        // 应收实收卡 :height 200(横幅 / 收缴率行照抄真版式)
      '440px',                        // Top20 :height 440
      '440px',                        // 散点 :height 440(图例照抄真版式)
    ])
    // 列表条的高按断点定(jsdom 不算样式 → 钉类与 scoped 规则原文):
    // >1280 左卡被右栏拉伸,条 flex:1(至少 300);≤1280 左卡独占一行不被拉伸,真列表 = min(内容, 560),钉 560
    const list = w.findAll('.te2-skel .fp-shim')[0]
    expect(list.classes(), '列表条没接断点规则').toContain('te2-skel-list')
    const css = readFileSync(join(__dirname, '../analysis/TenantEnergyView.vue'), 'utf8').replace(/\r\n/g, '\n')
    expect(css).toContain('.te2-skel-list { flex: 1; min-height: 300px; }')
    expect(css, '≤1280 列表条没钉 560 → 首进数据到那一帧左卡长高、下方整片下沉')
      .toContain('@media (max-width: 1280px) { .te2-skel-list { flex: none; height: 560px; } }')
    expect(css).toContain('.te2-list { flex: 1; min-height: 0; max-height: 560px;')
    expect(w.find('.anx-kpis').exists()).toBe(true)
    expect(w.findAll('.anx-kpis .anx-kpi-hold')).toHaveLength(6)
  })

  it('❗结构与续约:帕累托 300 · 环 300 · 箱点 250,六卡按 s8/s4 交替占满 12 栏', async () => {
    const { w, heights } = await shimHeights(TenantPortfolioView, '.tp2-skel')
    expect(heights).toEqual([
      '300px',                        // s8 帕累托 :height 300(期区图例、续约空态照抄真版式)
      '300px',                        // s4 环 :height 300
      '250px',                        // s8 箱点 :height 250
      '156px',                        // s4 生命周期 5 行 × 行盒 20 + 4 × gap 14
      '486px',                        // s8 租户清单 表头 30(行盒 20 + padding-bottom 9 + 下边框 1)+ 12 行 × 38
    ])
    expect(w.findAll('.tp2-skel .av2-grid > *').map((e) => e.classes().filter((c) => c.startsWith('av2-s'))))
      .toEqual([['av2-s8'], ['av2-s4'], ['av2-s8'], ['av2-s4'], ['av2-s4'], ['av2-s8']])
  })

  it('❗租户对标:页头 20/20 + 选择器 36 + 直方图 280 + 两张表块(30 + 38×n);页签、卡头、读数句、对照表照抄真版式', async () => {
    const { w, heights } = await shimHeights(TenantPeerView, '.tp-skel')
    expect(heights).toEqual([
      '20px', '20px', '36px',         // .tp-head 标题 + 副行(行盒 20)+ FPTenantPicker 36
      '280px',                        // 单位租金对标 AnaUnitRentHist :height 280
      '182px',                        // 哪些期区能给区间:30 + 4 × 38(库里现有 4 个期区)
      '68px',                         // 同一招式用在电费上:30 + 1 × 38
    ])
    expect(w.findAll('.tp-skel .ana-read').length, '四张卡的读数句照抄真版式').toBe(4)
    expect(w.findAll('.tp-skel .ak-tbl tbody tr').length, '对照表整张照抄').toBe(4)
    // 页头 / 页签复用真版式那两个类,下距 14 与真版式同源
    expect(w.find('.tp-skel .tp-head').exists()).toBe(true)
    expect(w.find('.tp-skel .tp-tabs').exists()).toBe(true)
  })
})
