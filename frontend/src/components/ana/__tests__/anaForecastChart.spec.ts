// AnaForecastChart 挂载测:量的是真渲染出来的 SVG 属性与悬停后的文字。
// 为什么要有这一层:2026-09-12 这天两次栽在「纯函数全对、画出来是错的」——
// 一次是标签叠字,一次是竖线画到图外。几何有 forecastChart.logic.spec.ts 钉,
// 这里钉的是组件自己的三件事:尺寸、去掉渐变、悬停。
import { describe, it, expect, beforeAll } from 'vitest'
import { mount } from '@vue/test-utils'
import AnaForecastChart from '../AnaForecastChart.vue'
import { rollingForecastRows } from '@/views/analysis/forecastChart.logic'
import type { PnlSummary } from '@/analysis/anaData'

beforeAll(() => {
  // jsdom 没有 ResizeObserver;组件只用它测宽度,给个空壳即可(宽度走 clientWidth||900 的兜底)。
  if (!('ResizeObserver' in globalThis)) {
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {} unobserve() {} disconnect() {}
    }
  }
})

const REV: (number | null)[] = [
  7146649.89, 7169836.30, 6996629.95, 7406069.55, 7537092.36, 7711058.20,
  null, null, null, null, null, null,
]
const P_MID: PnlSummary = {
  year: 2025, months: [1, 2, 3, 4, 5, 6], revenue: REV,
  cost: new Array(12).fill(null), profit: new Array(12).fill(null), bySchedule: {},
}
const rows = () => rollingForecastRows(P_MID)

function mountChart(height = 280) {
  return mount(AnaForecastChart, { props: { rows: rows(), height } })
}

describe('AnaForecastChart', () => {
  it('❗高度就是传进去的那个数 —— viewBox 与 width/height 三者一致,不许按宽度等比放大', () => {
    const w = mountChart(280)
    const svg = w.find('svg.afc')
    expect(svg.exists()).toBe(true)
    // 改前 viewBox 写死 900 配 CSS height:auto:卡片一宽,280 的图在 1900px 宽的卡上涨到 590 高,
    // 字号跟着放大(用户 2026-09-12:「整个图缩放不对」)。
    expect(svg.attributes('height')).toBe('280')
    expect(svg.attributes('viewBox')).toBe(`0 0 ${svg.attributes('width')} 280`)
  })

  it('❗主线下面没有渐变填充(用户 2026-09-12:「把主线的渐变去掉」)', () => {
    const html = mountChart().html()
    expect(html).not.toContain('linearGradient')
    expect(html).not.toContain('url(#afc-fill)')
    expect(html.match(/class="afc-line"/g) ?? [], '主线本身还得在').toHaveLength(1)
  })

  it('❗前几个月没有带时,图上写清楚**是哪一种**原因 —— 三种不一样,不能都写「样本不足」糊过去', () => {
    const text = (st: 'none' | 'mismatch' | 'spliced') =>
      mount(AnaForecastChart, { props: { rows: rows(), height: 280, prevState: st } }).find('.afc-note').text()
    expect(text('none')).toContain('1–3月无带')
    expect(text('none'), '没有上一年可接').toContain('没有上一年数据可接')
    expect(text('mismatch'), '有上一年但口径不同').toContain('附表口径与本年不同')
    expect(text('spliced'), '接上了但上一年自己也不够').toContain('上一年可用月也不足')
    // 三种说法必须互不相同 —— 相同就等于没分
    const all = new Set([text('none'), text('mismatch'), text('spliced')])
    expect(all.size).toBe(3)
  })

  it('❗上一年接上之后 1 月就有带,那行小字跟着消失(它只在真有洞时出现)', () => {
    const prevRev = Array.from({ length: 12 }, (_, i) => 6_000_000 + i * 80_000 + (i % 3 - 1) * 120_000)
    const bandOf = (rev: (number | null)[]) => ({ rev, cost: new Array(12).fill(null), pnl: new Array(12).fill(null) })
    const mk = (months: number[], revenue: (number | null)[], year: number): PnlSummary => {
      const bySchedule: Record<string, ReturnType<typeof bandOf>> = {}
      for (const k of ['s1', 's2', 's3', 's4', 's5']) bySchedule[k] = bandOf(new Array(12).fill(null))
      bySchedule.s1 = bandOf(revenue)
      return { year, months, revenue, cost: new Array(12).fill(null), profit: new Array(12).fill(null), bySchedule } as PnlSummary
    }
    const cur = mk([1, 2, 3], [7_146_649.89, 7_169_836.30, 6_996_629.95, ...new Array(9).fill(null)], 2025)
    const prev = mk([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], prevRev, 2024)
    const w = mount(AnaForecastChart, {
      props: { rows: rollingForecastRows(cur, prev), height: 280, prevState: 'spliced' },
    })
    expect(w.find('.afc-note').exists(), '没有洞了就不该还挂着解释').toBe(false)
  })

  it('❗悬停出气泡:有带的月报区间,没带的月报原因,移开就收', async () => {
    const w = mountChart()
    const host = w.find('.afc-host')
    // jsdom 的 getBoundingClientRect 全是 0,所以 clientX 直接就是图内 x 坐标。
    expect(rows()!.length, '录到 6 月 → 七格(含下月预测)').toBe(7)

    // 第 6 个月(有带)
    await host.trigger('mousemove', { clientX: 52 + ((900 - 52 - 62) * 5) / 6 })
    let lines = w.findAll('text.afc-tiptext').map((e) => e.text())
    expect(lines[0]).toBe('6月')
    expect(lines.some((l) => l.startsWith('区间 ')), '有带的月必须报区间').toBe(true)

    // 第 2 个月(没带)
    await host.trigger('mousemove', { clientX: 52 + ((900 - 52 - 62) * 1) / 6 })
    lines = w.findAll('text.afc-tiptext').map((e) => e.text())
    expect(lines[0]).toBe('2月')
    expect(lines.some((l) => l.includes('算不出带')), '没带的月要说原因,不是空着').toBe(true)

    await host.trigger('mouseleave')
    expect(w.findAll('text.afc-tiptext')).toHaveLength(0)
  })

  it('❗气泡宽度随内容变 —— 写死宽度会把最长那行切掉', async () => {
    const w = mountChart()
    const host = w.find('.afc-host')
    await host.trigger('mousemove', { clientX: 52 + ((900 - 52 - 62) * 1) / 6 })   // 2月,长句
    const wide = Number(w.find('rect.afc-tip').attributes('width'))
    await host.trigger('mousemove', { clientX: 52 + ((900 - 52 - 62) * 5) / 6 })   // 6月,短句
    const narrow = Number(w.find('rect.afc-tip').attributes('width'))
    expect(wide).toBeGreaterThan(narrow)
    // 够装下那行字:9 个中日韩字 + 若干半角,不能比 120 还窄
    expect(wide).toBeGreaterThan(120)
  })

  it('rows 为 null → 不渲染 svg(不画一个空壳)', () => {
    const w = mount(AnaForecastChart, { props: { rows: null } })
    expect(w.find('svg.afc').exists()).toBe(false)
  })
})
