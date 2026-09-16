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
  it('❗流失预警:页头 20/20 · 散点 300 + 图例 20 · 已流失表 330 · 明细表 420 · 流向图 300;KPI 槽空着由 .anx-kpis 兜位', async () => {
    const { w, heights } = await shimHeights(ChurnView, '.churn-skel')
    expect(heights).toEqual([
      '20px', '20px',                 // .ak-head 标题 + 副行(行盒 20)
      '20px', '300px', '20px',        // s8 风险象限散点 :height 300 + 图例行(行盒 20)
      '20px', '330px',                // s4 已流失清单 .churn-scroll max-height 330
      '20px', '420px',                // s8 流失预警明细 .churn-scroll.tall 420
      '20px', '300px',                // s4 s10 逐月出现/消失 :height 300
    ])
    expect(w.find('.ak-h-ic').exists(), '页头图标位没占住').toBe(true)
    // 首进期瓦片不画,但容器在 —— 空行由 min-height 94 兜住,数据到了不推下方
    expect(w.find('.anx-kpis').exists()).toBe(true)
    expect(w.findAll('.anx-kpis .av2-kpi')).toHaveLength(0)
  })

  it('❗租户用能:左列列表 >1280 flex:1、≤1280 钉 560 · 趋势 300 · 应收实收 200 · Top20 440 · 散点 440 + 图例 20', async () => {
    const { w, heights } = await shimHeights(TenantEnergyView, '.te2-skel')
    expect(heights).toEqual([
      '20px', '31px', '',             // 左列:卡头 + 搜索框 31 + 列表条(flex:1,高由右列那栏定)
      '20px', '300px', '20px', '20px',// 趋势卡 :height 300 + .ana-read + .ana-ref(行盒 20,见下)
      '20px', '200px', '20px',        // 应收实收卡 :height 200 + 收缴率行 .te2-payline(行盒 20)
      '20px', '440px',                // Top20 :height 440
      '20px', '440px', '20px',        // 散点 :height 440 + .cz-legend(.cz-leg 行盒 20)
    ])
    // 列表条的高按断点定(jsdom 不算样式 → 钉类与 scoped 规则原文):
    // >1280 左卡被右栏拉伸,条 flex:1(至少 300);≤1280 左卡独占一行不被拉伸,真列表 = min(内容, 560),钉 560
    const list = w.findAll('.te2-skel .fp-shim')[2]
    expect(list.classes(), '列表条没接断点规则').toContain('te2-skel-list')
    const css = readFileSync(join(__dirname, '../analysis/TenantEnergyView.vue'), 'utf8').replace(/\r\n/g, '\n')
    expect(css).toContain('.te2-skel-list { flex: 1; min-height: 300px; }')
    expect(css, '≤1280 列表条没钉 560 → 首进数据到那一帧左卡长高、下方整片下沉')
      .toContain('@media (max-width: 1280px) { .te2-skel-list { flex: none; height: 560px; } }')
    expect(css).toContain('.te2-list { flex: 1; min-height: 0; max-height: 560px;')
    expect(w.find('.anx-kpis').exists()).toBe(true)
    expect(w.findAll('.anx-kpis .av2-kpi')).toHaveLength(0)
  })

  it('❗结构与续约:帕累托 300 · 环 300 · 箱点 250,六卡按 s8/s4 交替占满 12 栏', async () => {
    const { w, heights } = await shimHeights(TenantPortfolioView, '.tp2-skel')
    expect(heights).toEqual([
      '20px', '300px',                // s8 帕累托 :height 300
      '20px', '300px', '112px',       // s4 环 :height 300 + 期区清单
      '20px', '250px',                // s8 箱点 :height 250
      '20px', '220px',                // s4 续约风险空态
      '20px', '156px',                // s4 生命周期 5 行 × 行盒 20 + 4 × gap 14
      '20px', '486px',                // s8 租户清单 表头 30(行盒 20 + padding-bottom 9 + 下边框 1)+ 12 行 × 38
    ])
    expect(w.findAll('.tp2-skel .av2-grid > *').map((e) => e.classes().filter((c) => c.startsWith('av2-s'))))
      .toEqual([['av2-s8'], ['av2-s4'], ['av2-s8'], ['av2-s4'], ['av2-s4'], ['av2-s8']])
  })

  it('❗租户对标:页头 20/20 + 页签 31 + 直方图 280 + 三张表卡(30 + 38×n)', async () => {
    const { w, heights } = await shimHeights(TenantPeerView, '.tp-skel')
    expect(heights).toEqual([
      '20px', '20px', '36px',         // .tp-head 标题 + 副行(行盒 20)+ FPTenantPicker 36
      '31px',                         // .anx-seg 页签 padding 3 + 按钮 25
      // 读数句 / 参照系小字都钉 20:行盒由 base.css 的 line-height: var(--lh-snug) 定,
      // --lh-snug 是**长度** 20px(tokens.css),按长度继承 —— 与 .ana-read 12px / .ana-ref 11px 的字号无关。
      // 按字号写 15 / 14,每卡欠 11px,四卡就是数据到达那一帧整页下沉 44px。
      '20px', '280px', '20px', '20px',// 单位租金对标 AnaUnitRentHist :height 280
      '20px', '106px', '20px', '20px',// 哪些期区能给区间:30 + 2 × 38
      '20px', '68px', '20px', '20px', // 同一招式用在电费上:30 + 1 × 38
      '20px', '182px', '20px', '20px',// 这张图为什么可信:30 + 4 × 38
    ])
    // 页头 / 页签复用真版式那两个类,下距 14 与真版式同源
    expect(w.find('.tp-skel .tp-head').exists()).toBe(true)
    expect(w.find('.tp-skel .tp-tabs').exists()).toBe(true)
  })
})
