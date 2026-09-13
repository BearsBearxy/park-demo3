// B12 挂载测:五列、出范围行左色条与同色字、缺抄行整行淡底「没抄表」、可见 8 行内滚与表脚。
// 夹具 8 月 1–28 日:17 日漏抄、18–22 日连续高于(连续第 1–5 天)、10 日单独低于、3 日有读数但画不出范围,
// 其余在范围内;发电量与比值逐行不同。另一份年档夹具摆「月份 / 当月 / 那个月」与少于 8 行不写滚动。
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import PvDetailTable from '../PvDetailTable.vue'
import type { DetailRow } from '../pvAnaV4.logic'
import { PV_COLORS as C } from '../pvAnaColors'

function monthRows(): DetailRow[] {
  return Array.from({ length: 28 }, (_, i) => {
    const d = i + 1
    const key = `2025-08-${String(d).padStart(2, '0')}`
    if (d === 17) return { key, label: String(d), gen: null, ratio: null, state: 'missing', out: null, runDay: null }
    const out = d >= 18 && d <= 22 ? 1 : d === 10 ? -1 : d === 3 ? null : 0
    return {
      key, label: String(d), state: 'seen',
      gen: 1200 + 37 * ((i * 7) % 11) + i * 3.3,
      ratio: 0.7 + 0.013 * ((i * 5) % 9),
      out, runDay: d >= 18 && d <= 22 ? d - 17 : null,
    }
  })
}
const yearRows = (): DetailRow[] => [
  { key: '2025-02', label: '2月', gen: 21876.4, ratio: 0.812, state: 'seen', out: 0, runDay: null },
  { key: '2025-03', label: '3月', gen: null, ratio: null, state: 'missing', out: null, runDay: null },
  { key: '2025-04', label: '4月', gen: 30512.9, ratio: 0.655, state: 'seen', out: -1, runDay: 1 },
  { key: '2025-05', label: '5月', gen: 29004.2, ratio: 0.641, state: 'seen', out: -1, runDay: 2 },
]

const mountTable = (rows: DetailRow[] = monthRows(), gran: 'month' | 'year' = 'month') =>
  mount(PvDetailTable, { props: { rows, gran } })
const cells = (tr: ReturnType<ReturnType<typeof mountTable>['findAll']>[number]) => tr.findAll('td').map(td => td.text())

describe('PvDetailTable(B12)', () => {
  it('五列表头与列宽 108 / 104 / 84 / 96 / 余宽;可见 8 行 = 表头 24 + 8 × 32 = 280 内滚', () => {
    const w = mountTable()
    const th = w.findAll('th')
    expect(th.map(t => t.text())).toEqual(['日期', '当日发电 度', '比值', '在不在范围内', '备注'])
    expect(th.map(t => t.attributes('style') ?? '')).toEqual(['width: 108px;', 'width: 104px;', 'width: 84px;', 'width: 96px;', ''])
    expect(w.find('.scroll').attributes('style')).toContain('max-height: 280px')
    expect(w.findAll('tbody tr')).toHaveLength(28)
  })

  it('在范围内的行:发电千分位、比值三位、无色条无着色', () => {
    const tr = mountTable().findAll('tbody tr')[0]
    expect(cells(tr)).toEqual(['8 月 1 日', '1,200', '0.700', '在范围内', ''])
    expect(tr.find('.bar').attributes('style')).toContain('background: transparent')
    expect(tr.findAll('td')[1].attributes('style')).toBeUndefined()
  })

  it('高于上沿的行:左 2px 琥珀条,数值与状态琥珀字,备注「连续第 k 天」;低于下沿的行:红条红字', () => {
    const rows = mountTable().findAll('tbody tr')
    const hi = rows[21]                                                 // 8 月 22 日,连续第 5 天
    expect(cells(hi).slice(0, 1).concat(cells(hi).slice(3))).toEqual(['8 月 22 日', '高于上沿', '连续第 5 天'])
    expect(hi.find('.bar').attributes('style')).toContain(rgb(C.ABOVE))
    for (const k of [1, 2, 3]) expect(hi.findAll('td')[k].attributes('style')).toContain(rgb(C.AMBER_TEXT))
    const lo = rows[9]                                                  // 8 月 10 日,单独一天
    expect([cells(lo)[3], cells(lo)[4]]).toEqual(['低于下沿', ''])
    expect(lo.find('.bar').attributes('style')).toContain(rgb(C.BELOW))
    expect(lo.findAll('td')[3].attributes('style')).toContain(rgb(C.BELOW))
    // 有读数但画不出范围:状态「—」,不着色,数值照写
    const nb = rows[2]
    expect(cells(nb).slice(2, 4)).toEqual([(0.7 + 0.013 * 1).toFixed(3), '—'])
    expect(nb.find('.bar').attributes('style')).toContain('background: transparent')
  })

  it('缺抄行出现、整行淡底,三个数都是「—」,备注「没抄表」;对照行没有这层底', () => {
    const rows = mountTable().findAll('tbody tr')
    const miss = rows[16]
    expect(cells(miss)).toEqual(['8 月 17 日', '—', '—', '—', '没抄表'])
    expect(miss.attributes('style')).toContain('background: var(--surface-sunken)')
    expect(miss.classes()).toContain('miss')
    expect(rows[15].attributes('style')).toBeUndefined()
  })

  it('❗有抄表但发电 0(比值算不出,state 也是 missing):发电写 0、不标没抄表、不铺缺抄淡底;对照:真没抄的 17 日照旧', () => {
    const rs = monthRows()
    rs[4] = { ...rs[4], gen: 0, ratio: null, state: 'missing', out: null, runDay: null }
    const rows = mountTable(rs).findAll('tbody tr')
    expect(cells(rows[4])).toEqual(['8 月 5 日', '0', '—', '—', '有抄表，发电不为正，不算比值'])
    expect(rows[4].classes()).not.toContain('miss')
    expect(rows[4].attributes('style')).toBeUndefined()
    expect(cells(rows[16])[4]).toBe('没抄表')
  })

  it('打开停在最后 8 行,表脚写停在第几天;滚到顶 / 中间表脚跟着改', async () => {
    const w = mountTable()
    expect(w.find('.ana-ref').text()).toBe('只列这一栋、只列本段 · 表内可上下滚，这里停在第 21–28 天，其余 20 天滚上去看 · 空行不是 0，是那天没抄表')
    const box = w.find('.scroll')
    Object.defineProperty(box.element, 'scrollTop', { value: 0, configurable: true, writable: true })
    await box.trigger('scroll')
    expect(w.find('.ana-ref').text()).toContain('这里停在第 1–8 天，其余 20 天滚下去看')
    ;(box.element as HTMLElement).scrollTop = 320
    await box.trigger('scroll')
    expect(w.find('.ana-ref').text()).toContain('这里停在第 11–18 天，其余 20 天上下滚动看')
  })

  it('年档:月份 / 当月发电;不足 8 行不写滚动;连续第 k 个月;空行是「那个月」没抄表', () => {
    const w = mountTable(yearRows(), 'year')
    expect(w.findAll('th').map(t => t.text()).slice(0, 2)).toEqual(['月份', '当月发电 度'])
    const rows = w.findAll('tbody tr')
    expect(cells(rows[0])).toEqual(['2 月', '21,876', '0.812', '在范围内', ''])
    expect(cells(rows[1])).toEqual(['3 月', '—', '—', '—', '没抄表'])
    expect(cells(rows[3])[4]).toBe('连续第 2 个月')
    expect(w.find('.ana-ref').text()).toBe('只列这一栋、只列本段 · 空行不是 0，是那个月没抄表')
    expect(w.find('.hint').text()).toBe('这一栋这一段，每个月的原始读数')
  })
})

function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`
}
