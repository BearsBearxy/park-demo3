// PvLabTable 挂载测:核对明细档「逐栋核对表」(2026-10-06 改稿)。钉 9 列表头与列宽、每格的字、左侧色条的色、
// 「哪天起变了」两种写法(找到写日子正文色 / 没找到写「没找到」)、隔天像不像与碰巧更偏两列、合并格、卡头与表脚六条参照。
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import PvLabTable from '../PvLabTable.vue'
import type { LabTableRow } from '../pvAnaV4.logic'

const base = { cpFrom: null, cpTo: null, monthsSoFar: 8, runDir: null, unborn: false, shortDays: null, rho1: null, chance: null } as const
const ROWS: LabTableRow[] = [
  { ...base, id: 8, name: '8栋', phase: 2, alphaPct: 12.2, rank: 1, ciLo: 5.2, ciHi: 19.2, validMonths: 8, rho1: 0.0612, chance: 420 },
  { ...base, id: 5, name: 'E座', phase: 1, alphaPct: 11.0, rank: 2, ciLo: 8.5, ciHi: 13.5, cpFrom: '2025-06-03', cpTo: '2025-06-14', validMonths: 7, runDir: 1, rho1: 0.7581, chance: 3 },
  { ...base, id: 6, name: 'F座', phase: 1, alphaPct: -38.0, rank: 3, ciLo: -41.6, ciHi: -34.4, cpFrom: '2025-03-02', cpTo: '2025-03-02', validMonths: 8, runDir: -1, rho1: -0.0213, chance: 455 },
  { ...base, id: 12, name: '12栋', phase: 2, alphaPct: 30.5, rank: null, ciLo: null, ciHi: null, validMonths: 6, rho1: 0.1, chance: 0 },
  { ...base, id: 20, name: '创业大厦', phase: 3, alphaPct: null, rank: null, ciLo: null, ciHi: null, validMonths: null, unborn: true },
]
const mountIt = (rows = ROWS, o: { cover?: string | null; winMonth?: number | null } = {}) =>
  mount(PvLabTable, { props: { rows, cover: '2025年全年', winMonth: 12, ...o } })
// 行末空列 .fp-fill(余宽落那里)不算格子,另有一条单独钉它
const tds = (w: ReturnType<typeof mountIt>, id: number) => w.find(`tr[data-id="${id}"]`).findAll('td:not(.fp-fill)')

describe('PvLabTable', () => {
  // 破坏验证:min-width 改回 width → 第一条红(auto 布局里有行末空列时 width 不起作用);删掉表头或行里的 .fp-fill → 第二条红
  it('❗表头 9 列逐字、列宽照画板(写成 min-width)', () => {
    const ths = mountIt().findAll('th:not(.fp-fill)')
    expect(ths.map(t => t.text())).toEqual(['楼栋', '期别', '常年水平', '名次', '大概落在', '哪天起变了', '有效月数', '隔天像不像', '碰巧更偏'])
    expect(ths.map(t => t.attributes('style'))).toEqual([
      'min-width: 96px;', 'min-width: 64px;', 'min-width: 104px;', 'min-width: 64px;', 'min-width: 168px;', 'min-width: 120px;',
      'min-width: 96px;', 'min-width: 96px;', 'min-width: 96px;',
    ])
  })

  it('❗余宽落进行末空列:表头、每一行(含合并格的行)最后一格都是 aria-hidden 的 .fp-fill', () => {
    const w = mountIt()
    for (const tr of [w.find('thead tr'), ...w.findAll('tbody tr')]) {
      const last = tr.findAll('th, td').at(-1)!
      expect(last.classes()).toContain('fp-fill')
      expect(last.attributes('aria-hidden')).toBe('true')
      expect(last.text()).toBe('')
    }
  })

  it('❗一行 9 格:期别名、带符号的常年水平、名次、大概落在、没找到、有效月数、隔天像不像两位小数(负号 −)、碰巧更偏次数', () => {
    expect(tds(mountIt(), 8).map(t => t.text())).toEqual(['8栋', '二期', '+12.2%', '1', '+5.2% ~ +19.2%', '没找到', '8 / 8', '0.06', '420'])
    expect(tds(mountIt(), 6).map(t => t.text())).toEqual(['F座', '一期', '−38.0%', '3', '−41.6% ~ −34.4%', '3月2日', '8 / 8', '−0.02', '455'])
    // 碰巧更偏 0 次照写 0,不写「—」(「—」是没数)
    expect(tds(mountIt(), 12)[8].text()).toBe('0')
  })

  it('❗哪天起变了:找到给区间(两头日期,同一天只写一个),正文色不标红;没找到写「没找到」灰字,不写「—」', () => {
    const w = mountIt()
    const e = tds(w, 5)[5]
    expect(e.text()).toBe('6月3日–6月14日')
    expect(e.attributes('style')).toBeUndefined()
    expect(e.classes()).not.toContain('sub')
    expect(tds(w, 6)[5].text()).toBe('3月2日')
    const none = tds(w, 8)[5]
    expect([none.text(), none.classes().includes('sub')]).toEqual(['没找到', true])
  })

  it('❗左侧 2px 色条:低于 = 红、高于 = 琥珀;没有连续段不画', () => {
    const w = mountIt()
    expect(tds(w, 6)[0].find('.edge').attributes('style')).toContain('background: rgb(226, 75, 74)')
    expect(tds(w, 5)[0].find('.edge').attributes('style')).toContain('background: rgb(239, 159, 39)')
    expect(tds(w, 8)[0].find('.edge').exists()).toBe(false)
  })

  it('期别点按期别色', () => {
    const w = mountIt()
    expect(tds(w, 8)[0].find('.dot').attributes('style')).toContain('background: rgb(55, 138, 221)')   // 二期 #378ADD
    expect(tds(w, 20)[0].find('.dot').attributes('style')).toContain('background: rgb(133, 183, 235)')   // 三期 #85B7EB
  })

  it('被踢出排序的栋:名次与大概落在写 —,其余照写', () => {
    expect(tds(mountIt(), 12).map(t => t.text())).toEqual(['12栋', '二期', '+30.5%', '—', '—', '没找到', '6 / 8', '0.10', '0'])
  })

  it('❗没有可算的行:期别之后合并 7 格一句灰字', () => {
    const c = tds(mountIt(), 20)
    expect(c).toHaveLength(3)
    expect(c[2].attributes('colspan')).toBe('7')
    expect(c[2].text()).toBe('没有可算的行')
    expect(mountIt().find('tr[data-id="20"]').classes()).toContain('unborn')
  })

  it('❗卡名、卡头:按月写覆盖「2025年全年」,按年不写覆盖', () => {
    const w = mountIt()
    expect(w.find('.t').text()).toBe('逐栋核对表')
    expect(w.find('.hint').text()).toBe('2025年全年 · 全部 5 栋楼')
    expect(mountIt(ROWS, { cover: null }).find('.hint').text()).toBe('全部 5 栋楼')
  })

  it('❗表脚六条:每列怎么读;打乱的月份跟着传进来的那个月;一栋都没进模型(没有那个月)只写前四条;全表不出统计名词', () => {
    const w = mountIt(ROWS, { winMonth: 8 })
    expect(w.findAll('.ana-ref').map(p => p.text())).toEqual([
      '名次 1 是常年水平最高；左边色条是连着偏离的楼', '「大概落在」按每栋全年每天的抄表估', '「哪天起变了」跳过并网那个月再算',
      '「隔天像不像」：近 1 同涨同落，近 0 不相干，负是一涨一落', '「碰巧更偏」：8月日子打乱重算 1000 次里更偏的次数',
      '次数越少，8月越不像碰巧；几百次就是常有的事',
    ])
    expect(mountIt(ROWS, { winMonth: null }).findAll('.ana-ref')).toHaveLength(4)
    expect(w.text()).not.toMatch(/CSV|导出/)
    expect(w.text()).not.toMatch(/σ|N_eff|zₙ|置信|p 值|q 值|BH-FDR|自相关|区间/)
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
