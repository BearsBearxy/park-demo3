// 损益附表固定列与表格高度(LIST-PAGE §9.1 / §9.3,画布 07-C 损益附表行;实现规范 §1.8)。
// 先后:科目细分(编辑态勾选列随它,永不退)→ 本年合计 → 分组 → 填入;备注任何宽度都不固定。
// 断言钉渲染出来的 left/right 像素与 min-height,不钉配置对象。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import PnlTable from '../PnlTable.vue'
import { rowsNotEndingInFill, stubWideTable } from '@/composables/__tests__/wideTableStub'
import { compareRow } from '@/reports/pnlDerive'
import type { PnlRowDTO } from '@/types/pnl'

// 夹具不退化(同 pnlCardS):标签长短不一、r3 是小计行;合计含负数与整行未录。
const ROWS: PnlRowDTO[] = [
  { rowKey: 'r1', groupLabel: '一期厂房', label: '租金收入', kind: 'detail', note: null, sortOrder: 0,
    m: [12000, 12000, 12000, null, 9000, 9000, 9000, 9000, 9000, 9000, 9000, 9000] },
  { rowKey: 'r2', groupLabel: '一期厂房', label: '物业成本', kind: 'detail', note: '按面积摊', sortOrder: 1,
    m: [-3000, -3000, -3000, -3000, -3000, -3000, -3000, -3000, -3000, -3000, -3000, -3000] },
  { rowKey: 'r3', groupLabel: '一期厂房', label: '租金损益小计', kind: 'subtotal', note: null, sortOrder: 2,
    m: [9000, 9000, 9000, null, 6000, 6000, 6000, 6000, 6000, 6000, 6000, 6000] },
  { rowKey: 'r4', groupLabel: '二期厂房', label: '租金收入', kind: 'detail', note: null, sortOrder: 3,
    m: Array(12).fill(null) },
]
// 派生:r1 重叠月全等 → 「已证√」;r3 1 月、5 月不等 → 「差异2月」;两行 4 月录入空、派生有值 → 出「填入」列
const D1 = [12000, 12000, 12000, 12000, 9000, 9000, 9000, 9000, 9000, 9000, 9000, 9000]
const D3 = [9100, 9000, 9000, 9000, 6100, 6000, 6000, 6000, 6000, 6000, 6000, 6000]
const DERIVE = {
  r1: { ...compareRow(ROWS[0].m, D1), derived: D1 },
  r3: { ...compareRow(ROWS[2].m, D3), derived: D3 },
}
// 按夹具算出的列宽(不量 DOM):勾选 36 · 分组 118 · 科目细分 170(「租金损益小计」106 + 徽标「差异2月」64)
// · 本年合计 103(「−36,000.00」10 字 × 0.6 × 12.5 = 75,+2 +26)· 填入 56
// 科目细分封顶 1/5 的下限 131 = 3 个字 67 + 最宽的徽标「差异2月」64(徽标不缩,不设下限名字被挤成 0 宽)

let ro: ReturnType<typeof stubWideTable>
const fireRO = (w: number, h: number) => ro.fire(w, h)

beforeEach(() => { ro = stubWideTable('pt-wrap') })
afterEach(() => {
  vi.useRealTimers()
  ro.restore()
  document.body.innerHTML = ''
})

async function mountAt(w: number, h: number, edit: boolean, over: { year?: number; rows?: PnlRowDTO[] } = {}) {
  const wr = mount(PnlTable, {
    props: { year: 2025, rows: ROWS, groupCol: '区域', edit, derive: DERIVE, selected: new Set<string>(), ...over },
    attachTo: document.body,
  })
  await fireRO(w, h)
  const st = (sel: string) => wr.get<HTMLElement>(sel).element.style
  return { wr, th: (c: string) => st(`thead th.pt-c-${c}`), td: (c: string) => st(`tbody tr:first-child td.pt-c-${c}`) }
}
const subBoxW = (wr: Awaited<ReturnType<typeof mountAt>>['wr'], k = 0) =>
  (wr.findAll('tbody tr')[k].get('.pt-sub').element as HTMLElement).style.width

describe('损益附表 · 固定列按表格可见宽度退(07-C)', () => {
  it('编辑态 + 有填入,1400 宽全留:科目细分 left 154px,本年合计 right = 填入宽 56px,备注不固定', async () => {
    const { wr, th, td } = await mountAt(1400, 600, true)
    expect(td('sel').left).toBe('0px')
    expect(td('grp').left).toBe('36px')
    expect(td('sub').left).toBe('154px')
    expect(td('fill').right).toBe('0px')
    expect(td('ann').right).toBe('56px')
    expect(th('ann').right).toBe('56px')
    expect(td('note').position).toBe('')
    expect(th('note').position).toBe('')
    expect(wr.get('tbody tr:first-child td.pt-c-note').classes()).not.toContain('pt-fix')
    expect(th('ann').minWidth).toBe('103px')   // 按整列最长的数算,不再锁 120
    // 表头那一格与表体同一套 left/right,不然横滚时表头和表体错位
    expect([th('sel').left, th('grp').left, th('sub').left, th('fill').right]).toEqual(['0px', '36px', '154px', '0px'])
    wr.unmount()
  })

  it('500 宽:填入、分组、本年合计都退,只剩勾选 + 科目细分;1/5 = 100 比下限 131 窄,科目细分按 131', async () => {
    ro.injectCss('views/reports/pnl/PnlTable.vue')
    const { wr, td } = await mountAt(500, 600, true)
    expect(td('ann').position).toBe('')
    expect(td('grp').position).toBe('')
    expect(td('fill').position).toBe('')
    expect(td('sel').left).toBe('0px')
    expect(td('sub').left).toBe('36px')
    expect(subBoxW(wr)).toBe('105px')   // 131 − 左右内边距 26
    // 类上不许残留横向 sticky(备注任何宽度都不固定):computed 也不是 sticky(表头本来就纵向 sticky,只看表体)
    for (const c of ['grp', 'ann', 'fill', 'note']) {
      expect(getComputedStyle(wr.get(`tbody tr:first-child td.pt-c-${c}`).element).position, c).not.toBe('sticky')
    }
    // 退掉的列摘掉 .pt-fix(表头 z-index 5):不摘的话横滚时盖住还固定着的勾选列、科目细分表头
    const fixed = (part: string) => ['sel', 'grp', 'sub', 'ann', 'fill']
      .filter(c => wr.get(`${part} .pt-c-${c}`).classes().includes('pt-fix'))
    expect(fixed('thead')).toEqual(['sel', 'sub'])
    expect(fixed('tbody tr:first-child')).toEqual(['sel', 'sub'])
    wr.unmount()
  })

  // 手机档编辑态(小屏录入走横滚表):1/5 = 71,「差异2月」徽标 64 不缩 → 按下限 131,科目名分到 105 − 64 = 41 ≥ 3 个字 39
  it('358 宽编辑态 + 带徽标的行:科目细分不低于「3 个字 + 徽标」= 131', async () => {
    const { wr } = await mountAt(358, 600, true)
    expect(wr.findAll('tbody tr')[2].get('.pt-badge').text()).toBe('差异2月')
    expect(subBoxW(wr, 2)).toBe('105px')
    wr.unmount()
  })

  it('800 宽:1/5 = 160 在下限 131 与估宽 170 之间,科目细分封顶 160', async () => {
    const { wr } = await mountAt(800, 600, true)
    expect(subBoxW(wr)).toBe('134px')   // 160 − 26
    wr.unmount()
  })

  it('名字超了省略:.pt-sub-t 是 overflow hidden + ellipsis + min-width 0', async () => {
    ro.injectCss('views/reports/pnl/PnlTable.vue')
    const { wr } = await mountAt(500, 600, true)
    const cs = getComputedStyle(wr.get('tbody tr:first-child .pt-sub-t').element)
    expect([cs.overflow, cs.textOverflow, parseFloat(cs.minWidth)]).toEqual(['hidden', 'ellipsis', 0])
    wr.unmount()
  })

  it('同一年换一份 rows 数变小:本年合计列宽不缩;换年:按新数据变窄', async () => {
    const small = ROWS.map(r => ({ ...r, m: r.m.map(v => (v === null ? null : 1)) }))
    const { wr, th } = await mountAt(3000, 600, false)
    expect(th('ann').minWidth).toBe('103px')
    await wr.setProps({ rows: small })
    expect(th('ann').minWidth).toBe('103px')
    await wr.setProps({ year: 2026 })
    expect(th('ann').minWidth).toBe('76px')   // 数最长 12.00 → 66,按表头「本年合计」76
    wr.unmount()
  })

  it('同宽 600:读态本年合计还固定;编辑态勾选列 36 计入 40%,本年合计就退了', async () => {
    // 读态:分组退掉后 科目细分 131(下限)+ 本年合计 103 = 234 ≤ 240,留
    const r = await mountAt(600, 600, false)
    expect(r.td('ann').right).toBe('0px')
    expect(r.td('sub').left).toBe('0px')
    r.wr.unmount()
    // 编辑态:再加勾选 36 = 270 > 240,本年合计退
    const e = await mountAt(600, 600, true)
    expect(e.td('ann').position).toBe('')
    expect(e.td('sub').left).toBe('36px')
    e.wr.unmount()
  })

  it('科目细分超 1/5 被截的名字:停 500ms 出全称;没被截的不出', async () => {
    const { wr } = await mountAt(500, 600, true)
    vi.useFakeTimers()
    const label = (k: number) => wr.findAll('tbody tr')[k].get('.pt-sub-t')
    await label(3).trigger('mouseenter')   // r4「租金收入」80 ≤ 131,没截
    vi.advanceTimersByTime(500)
    expect(document.querySelector('.fp-vtip')).toBeNull()
    await label(3).trigger('mouseleave')
    await label(2).trigger('mouseenter')   // r3「租金损益小计」+ 徽标 170 > 131,截了
    vi.advanceTimersByTime(500)
    // r3 是小计行:全称作标题,下面带一句口径(原页底说明行,2026-10-03 横条收尾)
    expect(document.querySelector('.fp-vtip b')?.textContent).toBe('租金损益小计')
    expect(document.querySelector('.fp-vtip .sub')?.textContent).toBe('这一行存的是文件原值,改明细不会自动重算')
    wr.unmount()
  })
})

// 最右空列(LIST-PAGE §4 列宽铁律,2026-10-02 用户拍板):表格区比各列合计宽时,余宽全落在每行末尾那一格空列,
// 不再按比例摊进科目细分和 12 个月;右固定的本年合计 / 填入跟着内容排,不必贴右沿
describe('损益附表 · 最右空列', () => {
  // 破坏验证:tbody 行末那格 fp-fill 删掉 → 红(4 行都列出来)
  it('可见 3000 编辑态(带填入列):表头、每一行的最右一格都是空列,排在右固定列之后;科目细分按估宽 170 不封顶', async () => {
    const { wr, td } = await mountAt(3000, 800, true)
    expect(rowsNotEndingInFill(wr.get('table.pt-table').element)).toEqual([])
    // 右固定列的 right 只按真列累加:空列不进 planFixed,溢出时它宽 0,贴右沿的仍是填入
    expect([td('fill').right, td('ann').right]).toEqual(['0px', '56px'])
    expect(subBoxW(wr)).toBe('')   // 170 < 3000/5:名字框不定宽,按内容撑开
    wr.unmount()
  })
})

describe('损益附表 · 表格高度(07-B)', () => {
  it('表格区露不下 8 行:留 38 + 8×38 + 边框 2 = 344px,整页往下滚;够了就不撑', async () => {
    const { wr } = await mountAt(1400, 300, false)
    const wrap = () => wr.get<HTMLElement>('.pt-wrap').element.style
    expect(wrap().minHeight).toBe('344px')
    await fireRO(1400, 400)
    expect(wrap().minHeight).toBe('')
    wr.unmount()
  })
})
