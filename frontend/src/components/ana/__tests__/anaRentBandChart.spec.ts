// AnaRentBandChart 挂载测:钉的是「缺口批注什么时候出现」这件交互本身。
// 几何由 rentBandChart.logic.spec.ts 钉;这里钉的是几何钉不到的那半件 ——
// 用户 2026-09-12:「设定一个阈值,高于阈值金额的退租才显示,并且改为 hover 才出现显示」。
// 又一天(同日):「常态下把那条红色线也去掉」—— 引线也不常驻了,没悬停就什么都没有。
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AnaRentBandChart from '../AnaRentBandChart.vue'
import { GAP_MIN_DROP_WAN, type GapInput, type RentBandCol } from '@/views/analysis/rentBandChart.logic'

/** 12 个历史月 + 12 个预测月,同 rentBandChart.logic.spec.ts 那份。 */
function cols(): RentBandCol[] {
  const hist: RentBandCol[] = Array.from({ length: 12 }, (_, i) => ({
    month: `2025-${String(i + 1).padStart(2, '0')}`,
    realized: 330 - i * 1.5, locked: null, mid: null, lo: null, hi: null,
  }))
  const fwd: RentBandCol[] = Array.from({ length: 12 }, (_, i) => {
    const locked = 312 - i * 8
    return {
      month: `2026-${String(i + 1).padStart(2, '0')}`,
      realized: i === 0 ? locked : null,
      locked, mid: locked + 12 + i, lo: locked + 2, hi: locked + 26 + i * 2,
    }
  })
  return [...hist, ...fwd]
}
const BIG: GapInput = { colIndex: 14, dropWan: 56.8, names: ['力灏', '开利暖通'], count: 5, endLabel: '2026-03' }
const SMALL: GapInput = { colIndex: 18, dropWan: 0.1, names: ['南宏'], count: 1, endLabel: '2026-07' }

/** jsdom 里 getBoundingClientRect 全是 0,所以 clientX 就是组件读到的 px。 */
const PAD_L = 54, PAD_R = 52, W = 900
const xOfCol = (i: number) => PAD_L + ((W - PAD_L - PAD_R) * i) / (cols().length - 1)

function mountChart(gaps: GapInput[] = [BIG, SMALL]) {
  return mount(AnaRentBandChart, { props: { cols: cols(), splitIdx: 12, gaps, height: 300 } })
}

describe('AnaRentBandChart 缺口批注', () => {
  it('❗没悬停时图上一点痕迹都没有 —— 字不在,那条红线也不在', () => {
    const w = mountChart()
    expect(w.findAll('.arb-gaptext')).toHaveLength(0)
    expect(w.findAll('.arb-gapline')).toHaveLength(0)
  })

  it('❗悬停缺口那一列才出现引线与三行小字', async () => {
    const w = mountChart()
    await w.find('.arb-host').trigger('mousemove', { clientX: xOfCol(BIG.colIndex) })
    const t = w.findAll('.arb-gaptext').map((n) => n.text())
    expect(t).toEqual([`−${BIG.dropWan.toFixed(1)} 万`, '力灏 + 开利暖通 等 5 份', '2026-03 到期'])
    expect(w.findAll('.arb-gapline')).toHaveLength(1)
    // 气泡里也有那一行,与图上同源
    expect(w.find('.arb-tip').exists()).toBe(true)
    expect(w.text()).toContain('5 份到期 · −56.8 万')
  })

  it('❗悬停别的列不出现别人的批注 —— 批注跟着鼠标走,不是常驻', async () => {
    const w = mountChart()
    await w.find('.arb-host').trigger('mousemove', { clientX: xOfCol(BIG.colIndex + 2) })
    expect(w.findAll('.arb-gaptext')).toHaveLength(0)
    expect(w.findAll('.arb-gapline')).toHaveLength(0)
  })

  it('❗跌幅不到阈值的那一列,悬停也不出批注、气泡也不提', async () => {
    const w = mountChart()
    await w.find('.arb-host').trigger('mousemove', { clientX: xOfCol(SMALL.colIndex) })
    expect(w.findAll('.arb-gaptext')).toHaveLength(0)
    expect(w.findAll('.arb-gapline')).toHaveLength(0)
    expect(w.text()).not.toContain('份到期')
  })

  it('阈值上下各一份:悬停同一列,够格的出批注,不够格的什么都不出', async () => {
    const hover = async (dropWan: number) => {
      const w = mountChart([{ ...SMALL, dropWan }])
      await w.find('.arb-host').trigger('mousemove', { clientX: xOfCol(SMALL.colIndex) })
      return w
    }
    expect((await hover(GAP_MIN_DROP_WAN)).findAll('.arb-gapline')).toHaveLength(1)
    expect((await hover(GAP_MIN_DROP_WAN - 0.1)).findAll('.arb-gapline')).toHaveLength(0)
  })
})
