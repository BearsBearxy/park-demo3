// PvResidualHeat 挂载测:L3 13 × 12 残差格。钉格的底色 / 字色 / 字、列头当段月、虚线空格、悬停气泡位置与翻边。
// 夹具两份:月档(截至 8 月、8 月没录满、一栋没进模型、一栋有个样本不足的空月)与年档(截至 12 月、无当段月)。
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PvResidualHeat from '../PvResidualHeat.vue'
import type { ResidualCell, ResidualGrid, ResidualRow } from '../pvAnaV4.logic'

const TH: [number, number, number, number] = [2, 4, 7, 10]
const lvl = (p: number): ResidualCell['level'] => {
  const a = Math.abs(p)
  return a < TH[0] ? 0 : a < TH[1] ? 1 : a < TH[2] ? 2 : a < TH[3] ? 3 : 4
}
/** 12 个月;null = 样本不足;through 之后是 future */
function mkRow(id: number, name: string, phase: number, vals: (number | null)[], through: number, partial: number | null, inModel = true): ResidualRow {
  return {
    id, name, phase, inModel,
    cells: Array.from({ length: 12 }, (_, k) => {
      const month = k + 1
      const v = vals[k] ?? null
      const state: ResidualCell['state'] = inModel && month > through ? 'future' : v == null ? 'empty' : 'value'
      const pct = state === 'value' ? v : null
      return {
        month, pct, level: pct == null ? 0 : lvl(pct),
        sign: pct == null ? 0 : (Math.sign(pct) as -1 | 0 | 1), state, partial: partial === month,
      }
    }),
  }
}

const MONTH: ResidualGrid = {
  rows: [
    mkRow(5, 'E座', 1, [3.4, -1.2, 12.3, 8.1, 5.5, -2.6, -4.4, 6.6], 8, 8),
    mkRow(6, 'F座', 1, [-9.5, -11.8, -6.2, -0.4, -3.1, 2.2, -7.7, -10.4], 8, 8),
    mkRow(9, '9栋', 2, [1.5, null, 4.9, -8.3, 0.6, 10.6, -2.1, 3.9], 8, 8),
    mkRow(20, '创业大厦', 3, Array(12).fill(null), 8, 8, false),
  ],
  thresholds: TH, currentMonth: 8, throughMonth: 8, outsideN: 1,
}
const YEAR: ResidualGrid = {
  rows: [
    mkRow(5, 'E座', 1, [3.4, -1.2, 12.3, 8.1, 5.5, -2.6, -4.4, 6.6, 2.9, -3.3, 7.4, 11.2], 12, null),
    mkRow(6, 'F座', 1, [-9.5, -11.8, -6.2, -0.4, -3.1, 2.2, -7.7, -10.4, -5.8, 1.1, -2.4, -12.9], 12, null),
  ],
  thresholds: TH, currentMonth: null, throughMonth: 12, outsideN: 0,
}

const mountIt = (data = MONTH, selId: number | null = 6) =>
  mount(PvResidualHeat, { props: { data, selId, year: 2025 } })
const cell = (w: ReturnType<typeof mountIt>, id: number, m: number) =>
  w.find(`.prh-row[data-id="${id}"]`).findAll('.prh-cell')[m - 1]
const px = (s: string | undefined, prop: string) => Number(new RegExp(`${prop}:\\s*(-?[\\d.]+)px`).exec(s ?? '')?.[1])

describe('PvResidualHeat · 格的色阶', () => {
  it('❗正向四档蓝、负向四档琥珀,透明度 .14 / .30 / .50 / .75;最深正向字转白', () => {
    const w = mountIt()
    expect(cell(w, 5, 3).attributes('style')).toContain('background: rgba(55, 138, 221, 0.75)')   // +12.3 → 4 档
    expect(cell(w, 5, 3).attributes('style')).toContain('color: var(--text-on-solid)')
    expect(cell(w, 5, 3).text()).toBe('+12')
    expect(cell(w, 5, 4).attributes('style')).toContain('background: rgba(55, 138, 221, 0.5)')    // +8.1 → 3 档
    expect(cell(w, 5, 5).attributes('style')).toContain('background: rgba(55, 138, 221, 0.3)')    // +5.5 → 2 档
    expect(cell(w, 5, 1).attributes('style')).toContain('background: rgba(55, 138, 221, 0.14)')   // +3.4 → 1 档
    expect(cell(w, 6, 2).attributes('style')).toContain('background: rgba(239, 159, 39, 0.75)')   // −11.8
    expect(cell(w, 6, 2).attributes('style')).toContain('color: var(--text-primary)')             // 负向最深档不转白
    expect(cell(w, 6, 2).text()).toBe('−12')
    expect(cell(w, 6, 3).attributes('style')).toContain('background: rgba(239, 159, 39, 0.3)')    // −6.2 → 2 档
  })

  it('接近 0 的格走墨 4%、字墨 40%', () => {
    const c = cell(mountIt(), 6, 4)   // −0.4
    expect(c.attributes('style')).toContain('background: var(--ink-040)')
    expect(c.attributes('style')).toContain('color: var(--ink-500)')
    expect(c.text()).toBe('0')
  })

  it('❗还没到的月、样本不足的月、没进模型的整行 = 虚线空格,不写字、不补色', () => {
    const w = mountIt()
    for (const c of [cell(w, 5, 9), cell(w, 5, 12), cell(w, 9, 2), cell(w, 20, 1), cell(w, 20, 8)]) {
      expect(c.attributes('style')).toContain('border: 1px dashed var(--ink-100)')
      expect(c.attributes('style')).toContain('background: transparent')
      expect(c.text()).toBe('')
    }
    // 对照:有数的格是透明实线边
    expect(cell(w, 5, 8).attributes('style')).toContain('border: 1px solid transparent')
    // 上面那行「没进模型」的月份全是 null,本来就是空格 —— 补一行没进模型但带了数的:照样整行虚线空格
    const w2 = mountIt({ ...MONTH, rows: [...MONTH.rows.slice(0, 3), mkRow(20, '创业大厦', 3, [5.5, -8.1, 12.3], 8, 8, false)] })
    expect(w2.find('.prh-row[data-id="20"]').findAll('.prh-cell').slice(0, 3).map(c => [c.text(), c.attributes('style')?.includes('border: 1px dashed var(--ink-100)')]))
      .toEqual([['', true], ['', true], ['', true]])
  })
})

describe('PvResidualHeat · 行头与列头', () => {
  it('❗当段月列头蓝底白字,其余月不上底;年档没有当段月', () => {
    const heads = mountIt().findAll('.prh-mo')
    expect(heads).toHaveLength(12)
    expect(heads[7].text()).toBe('8月')
    expect(heads[7].classes()).toContain('cur')
    expect(heads[7].attributes('style')).toContain('background: rgb(55, 138, 221)')
    expect(heads[6].attributes('style') ?? '').not.toContain('background')
    expect(mountIt(YEAR).findAll('.prh-mo.cur')).toHaveLength(0)
  })

  it('选中栋栋名加粗;没进模型的行栋名走淡墨;行序 = 传进来的固定顺序', () => {
    const w = mountIt()
    expect(w.findAll('.prh-row').map(r => r.find('.prh-name').text())).toEqual(['E座', 'F座', '9栋', '创业大厦'])
    expect(w.find('.prh-row[data-id="6"] .prh-name').classes()).toContain('on')
    expect(w.find('.prh-row[data-id="5"] .prh-name').classes()).not.toContain('on')
    expect(w.find('.prh-row[data-id="20"] .prh-name').classes()).toContain('out')
  })

  it('图例右侧:哪几个月还没到 · 哪个月没录满 · 几栋无残差', () => {
    expect(mountIt().find('.prh-leg .note').text()).toBe('9–12 月还没到 · 8 月还没录满 · 1 栋无残差')
    expect(mountIt(YEAR).find('.prh-leg .note').exists()).toBe(false)
  })
})

describe('PvResidualHeat · 悬停', () => {
  it('❗悬停有数的格:墨 2px 内描边 + 三行气泡,放在格右 4px(格左 = 72 + (m−1)·30)', async () => {
    const w = mountIt()
    await cell(w, 5, 3).trigger('mouseenter')
    expect(cell(w, 5, 3).classes()).toContain('ring')
    expect(cell(w, 5, 4).classes()).not.toContain('ring')
    const tip = w.find('.cz-tip')
    expect(tip.findAll('span').map(s => s.text())).toEqual(['E座 · 2025-03', '残差 +12.3%', '比自己常年水平多发'])
    expect(px(tip.attributes('style'), 'left')).toBe(72 + 2 * 30 + 32)
    expect(px(tip.attributes('style'), 'top')).toBe(22 + 0 * 30 - 4)
    await cell(w, 6, 3).trigger('mouseenter')
    expect(w.find('.cz-tip').findAll('span').map(s => s.text())).toEqual(['F座 · 2025-03', '残差 −6.2%', '比自己常年水平少发'])
    expect(px(w.find('.cz-tip').attributes('style'), 'top')).toBe(22 + 1 * 30 - 4)
  })

  it('❗右边放不下翻到格左 4px:12 月格左 402,气泡宽 130 → 402 − 4 − 130 = 268', async () => {
    const w = mountIt(YEAR)
    await cell(w, 5, 12).trigger('mouseenter')
    // 气泡宽 = 最长行「比自己常年水平多发」9 × 12 + 22 = 130;格右 4px 放是 434 + 130 > 496
    expect(px(w.find('.cz-tip').attributes('style'), 'left')).toBe(268)
  })

  it('悬停空格不出气泡;移出网格就收', async () => {
    const w = mountIt()
    await cell(w, 5, 10).trigger('mouseenter')
    expect(w.find('.cz-tip').exists()).toBe(false)
    expect(cell(w, 5, 10).classes()).not.toContain('ring')                 // 空格也不描边(气泡另有 pct 闸,单看气泡测不出)
    await cell(w, 5, 1).trigger('mouseenter')
    expect(w.find('.cz-tip').exists()).toBe(true)
    await w.find('.prh-grid').trigger('mouseleave')
    expect(w.find('.cz-tip').exists()).toBe(false)
    expect(w.findAll('.prh-cell.ring')).toHaveLength(0)
  })
})

describe('PvResidualHeat · 格宽跟卡片走,字不出格', () => {
  const withWidth = async (w: number, vals: number[]) => {
    const d = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => w })
    try {
      const grid: ResidualGrid = { ...MONTH, rows: [mkRow(1, '甲', 1, vals, 12, null)] }
      const wr = mount(PvResidualHeat, { props: { data: grid, selId: null, year: 2025 } })
      await wr.vm.$nextTick()
      return wr
    } finally {
      if (d) Object.defineProperty(HTMLElement.prototype, 'clientWidth', d)
    }
  }
  it('❗宽卡片:格宽 = (1000 − 94) ÷ 12 钉到 56,「+506」照写', async () => {
    const w = await withWidth(1000, [506, -25, 3])
    const cells = w.find('.prh-row').findAll('.prh-cell')
    expect(cells[0].attributes('style')).toContain('width: 56px')
    expect(w.find('.prh-mo').attributes('style')).toContain('width: 56px')
    expect(cells.slice(0, 3).map(c => c.text())).toEqual(['+506', '−25', '+3'])
  })
  it('❗窄卡片:格宽钉在 28,四个字的正数去掉「+」,负数与短数照写', async () => {
    const w = await withWidth(400, [506, -25, 3])
    const cells = w.find('.prh-row').findAll('.prh-cell')
    expect(cells[0].attributes('style')).toContain('width: 28px')
    expect(cells.slice(0, 3).map(c => c.text())).toEqual(['506', '−25', '+3'])
  })
})
