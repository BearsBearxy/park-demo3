// KPI 卡的调用处 + 算式类三种(KPI-CARD-SPEC §1 K3/K5、§3、§4;稿 KpiA、KpiFormula A 半边)。
//
// 组件本身的样子由 components/ds/__tests__/kpiCards.spec.ts 管;这里管「谁该传什么」:
//   · 迷你趋势线没了,调用方不许再传 trend;
//   · 利润类(园区利润、净利润…)传 profit,收入类不传 —— 标不标红是调用处决定的;
//   · 列表大卡上「2 栋停用」「待招商」不是涨跌,走说明行(sub),不走 delta;
//   · 三张报表顶部不再随窗口缩放(.fin-kval 去掉),走 KpiCard 的 24 / 20;
//   · 利润公式条 / 杜邦 / 收入核对平衡条照 §4。
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  RouterLink: { template: '<a><slot /></a>' },
}))
vi.mock('@/components/ana/AnaEChart.vue', () => ({
  default: { name: 'AnaEChart', props: ['option', 'height', 'entrance'], template: '<div class="stub-chart" />' },
}))
vi.mock('@/analysis/anaData', async (orig) => {
  const a = await orig<typeof import('@/analysis/anaData')>()
  return {
    ...a,
    fetchAvailableMonths: vi.fn(), fetchPnlSummary: vi.fn(), fetchBudgetAll: vi.fn(),
    fetchCompanies: vi.fn(), fetchReportAll: vi.fn(), fetchReportPeriod: vi.fn(),
  }
})

import * as data from '@/analysis/anaData'
import { providePeriodMonths, usePeriod } from '@/analysis/usePeriod'
import { __resetCompareForTest } from '@/analysis/useCompare'
import FinPnlView from '@/views/analysis/FinPnlView.vue'

const VIEWS = join(__dirname, '..')
const read = (rel: string): string => readFileSync(join(VIEWS, rel), 'utf8')
/** 一个组件的全部开标签(双引号属性值里的 > 不算结束,如 :note="margin > 300 ? …") */
const tags = (src: string, name: string): string[] => src.match(new RegExp(`<${name}\\b(?:[^>"]|"[^"]*")*>`, 'g')) ?? []
const tagWith = (src: string, name: string, label: string): string => {
  const hit = tags(src, name).filter((t) => t.includes(label))
  expect(hit, `找不到 ${name} ${label}`).toHaveLength(1)
  return hit[0]
}

describe('分析屏小卡调用处', () => {
  const screens = readdirSync(join(VIEWS, 'analysis')).filter((f) => f.endsWith('.vue'))

  it('❗不再传 trend(K3 去掉迷你趋势线)', () => {
    const bad = screens.flatMap((f) => tags(read('analysis/' + f), 'AnaKpiTile').filter((t) => /\btrend\b/.test(t)).map((t) => `${f}: ${t}`))
    expect(bad).toEqual([])
    // 判据没失效:确实扫到了一批瓦
    expect(screens.reduce((n, f) => n + tags(read('analysis/' + f), 'AnaKpiTile').length, 0)).toBeGreaterThan(50)
  })

  it('❗首进占位瓦是加载态(传 loading,数字位微光),不是一排「—」:数组驱动的两屏(园区、园区能耗)', () => {
    for (const f of ['analysis/ParkView.vue', 'analysis/ParkEnergyView.vue']) {
      const hold = /KPI_LABELS\.map\(\(label\) => \(\{[^}]*\}\)\)/.exec(read(f))
      expect(hold, f).not.toBeNull()
      expect(hold![0], `${f} 的占位瓦没传 loading`).toMatch(/\bloading: /)
    }
  })

  it('❗利润类传 profit(为负标红),收入类不传', () => {
    expect(tagWith(read('analysis/CockpitView.vue'), 'AnaKpiTile', 'label="园区利润"')).toMatch(/\sprofit\b/)
    expect(tagWith(read('analysis/BreakevenView.vue'), 'AnaKpiTile', 'label="月净利"')).toMatch(/\sprofit\b/)
    expect(tagWith(read('analysis/PnlAnalysisView.vue'), 'AnaKpiTile', 'label="分项损益合计"')).toMatch(/\sprofit\b/)
    const incomeish = screens.flatMap((f) => tags(read('analysis/' + f), 'AnaKpiTile'))
      .filter((t) => /收入|增速|达成|差额|缺口/.test(t) && /\sprofit\b/.test(t))
    expect(incomeish, '收入 / 增速 / 差额类为负不标红').toEqual([])
  })
})

describe('列表大卡调用处', () => {
  it('❗「2 栋停用」「待招商」「户需续签」走说明行,不带涨跌箭头;不再内联盖 padding', () => {
    for (const f of ['buildings/BuildingsView.vue', 'tenants/TenantsView.vue', 'system/SystemUsersView.vue']) {
      const cards = tags(read(f), 'KpiCard')
      expect(cards.length, f).toBe(4)
      for (const t of cards) {
        expect(t, `${f} 还在传涨跌`).not.toMatch(/\s:?(delta|trend)=/)
        expect(t, `${f} 还在内联盖样式`).not.toMatch(/\s:style=/)
      }
    }
    expect(tagWith(read('buildings/BuildingsView.vue'), 'KpiCard', 'label="空置单元"')).toContain('sub="待招商"')
    expect(tagWith(read('buildings/BuildingsView.vue'), 'KpiCard', 'label="楼栋总数"')).toContain(':sub="`${stoppedCount} 栋停用`"')
    expect(tagWith(read('tenants/TenantsView.vue'), 'KpiCard', 'label="合同将到期"')).toContain('sub="户需续签"')
  })

  it('❗三张报表顶部:.fin-kval 缩放去掉,数走 :value(KpiCard 的 24 / 20);利润类传 profit,收入不传', () => {
    for (const f of ['reports/income-statement/IncomeStatementView.vue', 'reports/balance-sheet/BalanceSheetView.vue', 'reports/trial-balance/TrialBalanceView.vue']) {
      expect(read(f), f).not.toMatch(/fin-kval|clamp\(14px/)
    }
    const is = read('reports/income-statement/IncomeStatementView.vue')
    for (const l of ['营业利润(本月)', '利润总额(本月)', '净利润(本月)']) {
      expect(tagWith(is, 'KpiCard', `label="${l}"`)).toMatch(/:value="finMoney\(\w+\)" profit\b/)
    }
    expect(tagWith(is, 'KpiCard', 'label="营业收入(本月)"')).not.toMatch(/\bprofit\b/)
  })

  it('❗三张报表顶部四张卡按位置 slate → blue → sky → cyan(K2)', () => {
    for (const f of ['reports/income-statement/IncomeStatementView.vue', 'reports/balance-sheet/BalanceSheetView.vue', 'reports/trial-balance/TrialBalanceView.vue']) {
      const src = read(f)
      const block = src.slice(src.indexOf('<div class="fin-kpis">'), src.indexOf('</div>', src.indexOf('<div class="fin-kpis">')))
      expect(tags(block, 'KpiCard').map((t) => /\btint="(\w+)"/.exec(t)?.[1]), f).toEqual(['slate', 'blue', 'sky', 'cyan'])
    }
  })

  it('❗「平衡差」卡的数字色用浅底上的写字色(--delta-*-text ≥4.5),不用只够图形 3:1 的 --hue-red / --hue-green', () => {
    for (const f of ['reports/balance-sheet/BalanceSheetView.vue', 'reports/trial-balance/TrialBalanceView.vue']) {
      const card = read(f).match(/<KpiCard[^>]*label="[^"]*平衡差[^"]*"[^>]*>[\s\S]*?<\/KpiCard>/)
      expect(card, f).not.toBeNull()
      expect(card![0], f).toContain("'var(--delta-down-text)'")
      expect(card![0], f).not.toMatch(/--hue-(red|green)/)
    }
  })
})

describe('算式类(KPI-CARD-SPEC §4,稿 KpiFormula A)', () => {
  // 把一个 SFC 的 <style> 原样塞进 document,读 getComputedStyle(同 kpiCards.spec)
  beforeAll(() => {
    for (const rel of ['analysis/FinPnlView.vue', 'reports/recon/ReconWorkbench.vue']) {
      const el = document.createElement('style')
      el.textContent = [...read(rel).matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
      document.head.appendChild(el)
    }
  })

  describe('利润公式条(FinPnlView)', () => {
    const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']
    let w: VueWrapper | null = null
    beforeEach(() => {
      setActivePinia(createPinia())
      vi.clearAllMocks()
      __resetCompareForTest()
      vi.mocked(data.fetchAvailableMonths).mockResolvedValue({ months: MONTHS, sources: { pnl: MONTHS, report: ['2026-08'] } } as never)
      vi.mocked(data.fetchPnlSummary).mockResolvedValue(null as never)
      vi.mocked(data.fetchBudgetAll).mockResolvedValue([])
      vi.mocked(data.fetchCompanies).mockResolvedValue([{ id: 1, name: '甲公司', short: '甲', sortNo: 1 }] as never)
      // 营业收入为负(冲回月)、成本为正 → 毛利 / 营业利润 / 净利润都为负:收入不标红,利润类标红
      vi.mocked(data.fetchReportAll).mockResolvedValue({ amounts: { 1: { cur: -100000, ytd: -1000000 }, 2: { cur: 50000, ytd: 500000 } }, customRows: [] } as never)
    })
    afterEach(() => { w?.unmount(); w = null })

    async function boot(): Promise<VueWrapper> {
      w = mount(FinPnlView as never, { global: { stubs: { RouterLink: true, teleport: true } }, attachTo: document.body })
      await flushPromises()
      providePeriodMonths(MONTHS, MONTHS)
      usePeriod().setYear(2026)
      await flushPromises()
      return w
    }

    it('❗每个数一格浅底:加减的数 slate、等号右边的结果 sky、最后的净利润 blue;运算符在格之间', async () => {
      const v = await boot()
      const nodes = v.findAll('.fin-chain .node')
      expect(nodes.map((n) => n.find('.nl').text())).toEqual(['营业收入', '营业成本', '毛利', '期间费用', '营业利润', '净利润'])
      expect(nodes.map((n) => getComputedStyle(n.element).background)).toEqual([
        'var(--accent-slate)', 'var(--accent-slate)', 'var(--accent-sky)', 'var(--accent-slate)', 'var(--accent-sky)', 'var(--accent-blue)',
      ])
      expect(v.findAll('.fin-chain .op').map((o) => o.text())).toEqual(['−', '=', '−', '=', '→'])
      const op = getComputedStyle(v.find('.fin-chain .op').element)
      expect([op.fontSize, op.color]).toEqual(['var(--fs-h2)', 'var(--text-muted)'])
      const nv = getComputedStyle(nodes[0].find('.nv').element)
      expect([nv.fontSize, getComputedStyle(nodes[0].find('.nl').element).fontSize, getComputedStyle(nodes[0].find('.np').element).fontSize])
        .toEqual(['var(--fs-h2)', 'var(--fs-label)', 'var(--fs-micro)'])
      expect([nodes[0].find('.nv .u').text(), getComputedStyle(nodes[0].find('.nv .u').element).fontSize]).toEqual(['万', 'var(--fs-body)'])
    })

    it('❗利润类(毛利 / 营业利润 / 净利润)为负标红,营业收入为负不标', async () => {
      const v = await boot()
      const color = (label: string) => getComputedStyle(v.findAll('.fin-chain .node').find((n) => n.find('.nl').text() === label)!.find('.nv').element).color
      expect(color('营业收入')).toBe('var(--text-primary)')
      expect(v.findAll('.fin-chain .node')[0].find('.nv').text()).toMatch(/^−¥/)
      for (const l of ['毛利', '营业利润', '净利润']) expect(color(l), l).toBe('var(--delta-down-text)')
    })

    it('❗尾注(营业外…)独占下一行靠右', async () => {
      const t = getComputedStyle((await boot()).find('.fin-chain .tail').element)
      expect([t.flexBasis || t.flex, t.textAlign]).toEqual([expect.stringMatching(/100%/), 'right'])
      expect(getComputedStyle(w!.find('.fin-chain').element).flexWrap).toBe('wrap')
    })
  })

  it('❗杜邦(FinBalanceView):ROE 大格 blue 数 28;三因子各一格 sky / slate / cyan 数 20;标签 12 主色', () => {
    const src = read('analysis/FinBalanceView.vue')
    const block = src.slice(src.indexOf('杜邦(稿 KpiFormula A'), src.indexOf('<AnaEmpty v-else label="杜邦拆解不可算"'))
    expect(block.match(/var\(--accent-(\w+)\)/g)).toEqual(['var(--accent-blue)', 'var(--accent-sky)', 'var(--accent-slate)', 'var(--accent-cyan)'])
    expect(block).toMatch(/font-size: var\(--fs-display\)[^"]*">\{\{ \(R\.roe \* 100\)/)
    expect(block).toMatch(/font-size: var\(--fs-h2\)[^"]*">\{\{ f\.v \}\}/)
    expect(block.match(/font-size: var\(--fs-label\); line-height: 18px; color: var\(--text-primary\)/g)).toHaveLength(2)
    expect(block, '因子格不再是灰底').not.toContain('--surface-card')
  })

  it('❗收入核对平衡条(ReconWorkbench):底随状态换色;状态字 已配平 --info-text-on-tint、差额 --hue-orange、缺记 --delta-down-text;金额 20', () => {
    const src = read('reports/recon/ReconWorkbench.vue')
    expect(src, '状态字颜色要交给样式表,不许内联').toMatch(/<div class="verdict">/)
    const bar = document.createElement('div')
    document.body.appendChild(bar)
    const look = (st: string) => {
      bar.innerHTML = `<div class="rc-balance ${st}"><div class="bl"><span class="k">台账合计</span><span class="v">¥1</span></div><span class="eq">=</span><div class="verdict">已配平</div></div>`
      const b = bar.firstElementChild!
      return [getComputedStyle(b).background, getComputedStyle(b.querySelector('.verdict')!).color]
    }
    expect(look('ok')).toEqual(['var(--accent-blue)', 'var(--info-text-on-tint)'])
    expect(look('diff')).toEqual(['var(--warn-bg)', 'var(--hue-orange)'])
    expect(look('miss')).toEqual(['var(--danger-bg)', 'var(--delta-down-text)'])
    look('ok')
    const v = getComputedStyle(bar.querySelector('.bl .v')!)
    expect([v.fontSize, getComputedStyle(bar.querySelector('.bl .k')!).color, getComputedStyle(bar.querySelector('.rc-balance')!).borderRadius])
      .toEqual(['var(--fs-h2)', 'var(--text-muted-tint)', 'var(--radius-lg)'])
    bar.remove()
  })
})
