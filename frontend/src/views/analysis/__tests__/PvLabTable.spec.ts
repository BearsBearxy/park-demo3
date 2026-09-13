// PvLabTable 挂载测:L7 逐栋核对表。钉 7 列表头与列宽、每格的字、左侧色条的色、变点区间的写法与色、
// 被踢出排序 / 没进模型两种行、表脚删掉了导出那半句、屏上没有统计名词。
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PvLabTable from '../PvLabTable.vue'
import type { LabTableRow } from '../pvAnaV4.logic'

const base = { cpFrom: null, cpTo: null, monthsSoFar: 8, runDir: null, unborn: false, shortDays: null } as const
const ROWS: LabTableRow[] = [
  { ...base, id: 8, name: '8栋', phase: 2, alphaPct: 12.2, rank: 1, ciLo: 5.2, ciHi: 19.2, validMonths: 8 },
  { ...base, id: 5, name: 'E座', phase: 1, alphaPct: 11.0, rank: 2, ciLo: 8.5, ciHi: 13.5, cpFrom: '2025-06-03', cpTo: '2025-06-14', validMonths: 7, runDir: 1 },
  { ...base, id: 6, name: 'F座', phase: 1, alphaPct: -38.0, rank: 3, ciLo: -41.6, ciHi: -34.4, cpFrom: '2025-03-02', cpTo: '2025-03-02', validMonths: 8, runDir: -1 },
  { ...base, id: 12, name: '12栋', phase: 2, alphaPct: 30.5, rank: null, ciLo: null, ciHi: null, validMonths: 6 },
  { ...base, id: 20, name: '创业大厦', phase: 3, alphaPct: null, rank: null, ciLo: null, ciHi: null, validMonths: null, unborn: true },
]
const mountIt = (rows = ROWS) => mount(PvLabTable, { props: { rows, year: 2025 } })
const tds = (w: ReturnType<typeof mountIt>, id: number) => w.find(`tr[data-id="${id}"]`).findAll('td')

describe('PvLabTable', () => {
  it('❗表头 7 列逐字、列宽照画板', () => {
    const ths = mountIt().findAll('th')
    expect(ths.map(t => t.text())).toEqual(['楼栋', '期别', '常年水平', '名次', '区间', '哪天起变了', '有效月数'])
    expect(ths.map(t => t.attributes('style'))).toEqual(
      ['width: 96px;', 'width: 64px;', 'width: 104px;', 'width: 64px;', 'width: 168px;', 'width: 120px;', 'width: 96px;'])
  })

  it('❗一行 7 格:期别名、带符号的常年水平、名次、区间、没变点写 —、有效月数 = 有效 / 截至月', () => {
    const c = tds(mountIt(), 8)
    expect(c.map(t => t.text())).toEqual(['8栋', '二期', '+12.2%', '1', '+5.2% ~ +19.2%', '—', '8 / 8'])
    expect(tds(mountIt(), 6).map(t => t.text())).toEqual(['F座', '一期', '−38.0%', '3', '−41.6% ~ −34.4%', '3月2日', '8 / 8'])
  })

  it('❗变点给区间(两头日期),同一天只写一个;有值时字是红', () => {
    const w = mountIt()
    const e = tds(w, 5)[5]
    expect(e.text()).toBe('6月3日–6月14日')
    expect(e.attributes('style')).toContain('color: rgb(226, 75, 74)')
    expect(tds(w, 6)[5].text()).toBe('3月2日')
    expect(tds(w, 8)[5].attributes('style')).toBeUndefined()
  })

  it('❗左侧 2px 色条:低于 = 红、高于 = 琥珀;没有连续段不画', () => {
    const w = mountIt()
    expect(tds(w, 6)[0].find('.edge').attributes('style')).toContain('background: rgb(226, 75, 74)')
    expect(tds(w, 5)[0].find('.edge').attributes('style')).toContain('background: rgb(239, 159, 39)')
    expect(tds(w, 8)[0].find('.edge').exists()).toBe(false)
  })

  it('期别点按期别色', () => {
    const w = mountIt()
    expect(tds(w, 8)[0].find('.dot').attributes('style')).toContain('background: rgb(93, 202, 165)')
    expect(tds(w, 20)[0].find('.dot').attributes('style')).toContain('background: rgb(239, 159, 39)')
  })

  it('被踢出排序的栋:名次与区间写 —,其余照写', () => {
    expect(tds(mountIt(), 12).map(t => t.text())).toEqual(['12栋', '二期', '+30.5%', '—', '—', '—', '6 / 8'])
  })

  it('❗没有可算的行:期别之后合并 5 格一句灰字', () => {
    const c = tds(mountIt(), 20)
    expect(c).toHaveLength(3)
    expect(c[2].attributes('colspan')).toBe('5')
    expect(c[2].text()).toBe('没有可算的行')
    expect(mountIt().find('tr[data-id="20"]').classes()).toContain('unborn')
  })

  it('❗表脚说明砍了哪些列,不写「导出的 CSV 里有」;全表不出统计名词', () => {
    const w = mountIt()
    const foot = w.find('.ana-ref').text()
    expect(foot).toContain('砍掉了 6 列算法中间量')
    // 表里两个期间:各列吃整年,色条吃本段 —— 两个都要写出来(§6.5b)
    expect(foot.startsWith('常年水平、名次、区间、哪天起变了、有效月数按 2025 年整年算 · ')).toBe(true)
    expect(foot).toContain('左侧色条 = 本段有连续出范围的栋')
    expect(foot.endsWith('那些是要复算这屏数字才用得上的')).toBe(true)
    expect(w.text()).not.toMatch(/CSV|导出/)
    expect(w.text()).not.toMatch(/σ|N_eff|zₙ|置信|p 值|q 值|BH-FDR/)
  })
})

describe('PvLabTable · 在网不足', () => {
  it('❗在网不足 90 天的栋合并格写天数,不写「没有可算的行」', () => {
    const short: LabTableRow = { ...base, id: 21, name: '工业大厦', phase: 3, alphaPct: null, rank: null, ciLo: null, ciHi: null, validMonths: null, unborn: true, shortDays: 31 }
    const w = mountIt([...ROWS, short])
    const tr = w.find('tr[data-id="21"]')
    expect(tr.find('td[colspan]').text()).toBe('在网 31 天，不排')
    // 对照:未投产那栋照旧
    expect(w.find('tr[data-id="20"] td[colspan]').text()).toBe('没有可算的行')
  })
})
