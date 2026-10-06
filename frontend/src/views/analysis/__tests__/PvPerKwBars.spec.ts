// PvPerKwBars(新卡「各栋每千瓦日均发电」)的几何与交互:刻度步长按像素挑、悬停气泡、点一行换选中。
// 数据整形(排序、列里的字)在 pvAnaV4.logic.spec 的 perKwCard 那组,这里只钉组件自己的事。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PvPerKwBars from '../PvPerKwBars.vue'
import type { PerKwCard } from '../pvAnaV4.logic'

const row = (id: number, name: string, phase: number, perDay: number | null, cols: string[]) =>
  ({ id, name, phase, perDay, days: perDay == null ? 0 : 31, born: true, cols })
const DATA: PerKwCard = {
  rows: [
    row(1, 'B座', 1, 4.0, ['+1.0%', '—']),
    row(2, '8栋', 2, 3.1, ['−2.4%', '—']),
    row(3, '13栋', 2, 2.2, ['+0.4%', '—']),
    row(4, '创业大厦', 3, null, ['—', '—']),
  ],
  heads: ['比11月', '比去年12月'], hint: '', anchorDay: null, anchorLabel: null, read: null, refs: [],
}
const axis = (w: ReturnType<typeof mount>) => w.findAll('text.ppk-ax').filter(t => t.attributes('y') === String(18 + 4 * 20 + 20 - 6))
  .map(t => [t.text(), Number(t.attributes('x'))] as const)

afterEach(() => { vi.restoreAllMocks() })

describe('PvPerKwBars', () => {
  it('卡内宽 293(1440):每 2 一格 —— 列宽 36 + 58 + 8,条区 64–151,量程 6(4.0 × 1.5)', () => {
    const w = mount(PvPerKwBars, { props: { data: DATA, selId: null } })
    expect(axis(w)).toEqual([['0', 64], ['2', 93], ['4', 122], ['6', 151]])
  })

  it('❗卡窄(1281 宽时卡内 240,条区只剩 34px):刻度改每 5 一格,相邻字隔 ≥ 20px 不叠;对照:每 2 一格只隔 11px', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(240)
    const w = mount(PvPerKwBars, { props: { data: DATA, selId: null } })
    await w.vm.$nextTick()   // useWidth 在 onMounted 里量宽,下一拍才重画
    const xs = axis(w)
    expect(xs.map(x => x[0])).toEqual(['0', '5'])
    expect(xs[1][1] - xs[0][1]).toBeGreaterThanOrEqual(20)
    expect((98 - 64) / 6 * 2).toBeLessThan(20)
  })

  it('❗悬停一行出气泡(楼名 · 期别、每千瓦日均和天数、右边两列);点一行换选中', async () => {
    const w = mount(PvPerKwBars, { props: { data: DATA, selId: null } })
    const hit = w.find('.ppk-hit[data-id="1"]')
    await hit.trigger('mouseenter')
    expect(w.findAll('.ppk-tip span').map(s => s.text())).toEqual(['B座 · 一期', '每千瓦日均 4.00 kWh · 31 天', '比11月 +1.0%', '比去年12月 —'])
    await w.find('.ppk-hit[data-id="4"]').trigger('mouseenter')
    expect(w.findAll('.ppk-tip span').map(s => s.text())).toEqual(['创业大厦 · 三期', '这一段没有读数'])
    await hit.trigger('click')
    expect(w.emitted('pick')).toEqual([[1]])
    await w.find('.ppk-plot').trigger('mouseleave')
    expect(w.find('.ppk-tip').exists()).toBe(false)
  })
})
