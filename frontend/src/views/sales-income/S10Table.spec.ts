import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import S10Table from './S10Table.vue'
import { LAYOUTS, leavesOf, type Group } from './layout'
import type { S10RecordDTO, S10ColId } from '@/types/s10'

// 版面现由账册模板驱动(props.groups = toS10Layout(book.definition));
// 旧 layout.ts 的 OFFICE/FACTORY 常量与模板种子同形,这里继续当测试夹具用。
// 构造一行:给定版面的所有列填 0,再覆盖几列。
function makeRow(layout: 'office' | 'factory', over: Partial<Record<string, number>>, extra: Partial<S10RecordDTO> = {}): S10RecordDTO {
  const zeros = Object.fromEntries(leavesOf(layout).map(l => [l.colId, 0]))
  return {
    id: 1, tenantId: 1, tenantName: 'T', phase: 1, profile: 'factory',
    note: null, source: 'seed', total: 0,
    ...zeros, ...over, ...extra,
  } as unknown as S10RecordDTO
}

describe('S10Table 两级表头 / 模板驱动版面', () => {
  it('office 版面渲染全部 25 个叶子子列 + 分组表头', () => {
    const w = mount(S10Table, {
      props: { groups: LAYOUTS.office, phaseName: '一期厂房', year: 2026, month: 6, rows: [makeRow('office', {})], edit: false },
    })
    // 叶子子列 = 多叶子组的 .s10-h-sub
    const subs = w.findAll('th.s10-h-sub').length
    // 独立叶子（leaf 组）渲染为 .s10-h-leaf（空地租金 / 其他费用 = 2 个）
    const leafCols = w.findAll('th.s10-h-leaf').length
    expect(subs + leafCols).toBe(leavesOf('office').length) // 25
    expect(leafCols).toBe(2)
    // 分组表头存在（含 MON→月份替换）
    expect(w.text()).toContain('6月电费')
    expect(w.text()).toContain('6月水费')
  })

  it('factory 版面渲染 20 个叶子（无办公室/保障房列）', () => {
    const w = mount(S10Table, {
      props: { groups: LAYOUTS.factory, phaseName: '二期厂房', year: 2026, month: 6, rows: [makeRow('factory', {})], edit: false },
    })
    const subs = w.findAll('th.s10-h-sub').length
    const leafCols = w.findAll('th.s10-h-leaf').length
    expect(subs + leafCols).toBe(leavesOf('factory').length) // 20
    // 无办公室租金列、无保障房列
    expect(w.text()).not.toContain('办公室租金')
    expect(w.text()).not.toContain('保障房')
  })

  it('模板自定义列(c_)进表头并参与本地合计', () => {
    const groups: Group[] = [...LAYOUTS.factory, { label: '自定义', leaves: [{ colId: 'c_park' as S10ColId, label: '停车费' }] }]
    const row = makeRow('factory', { factoryRent: 100 })
    ;(row as unknown as Record<string, number>).c_park = 30
    const w = mount(S10Table, {
      props: { groups, phaseName: '二期厂房', year: 2026, month: 6, rows: [row], edit: true },
    })
    expect(w.text()).toContain('停车费')
    // 编辑态本地即时算:行合计含 c_ 列 = 130
    expect(w.find('td.s10-c-total').text()).toBe('130.00')
    expect(w.find('th.s10-foot-total').text()).toBe('130.00')
  })
})

describe('S10Table 合计口径', () => {
  it('无后端派生时本地算:行合计 = 各列之和;列合计 / 总计在 tfoot', () => {
    const rows = [
      makeRow('factory', { factoryRent: 100, shopRent: 50 }, { id: 1, tenantName: 'A' }),
      makeRow('factory', { factoryRent: 30, elecStd: 20 }, { id: 2, tenantName: 'B' }),
    ]
    const w = mount(S10Table, {
      props: { groups: LAYOUTS.factory, phaseName: '二期厂房', year: 2026, month: 6, rows, edit: false },
    })
    // 行合计:A=150, B=50 → 末列 .s10-c-total
    const rowTotals = w.findAll('td.s10-c-total').map(td => td.text())
    expect(rowTotals).toContain('150.00')
    expect(rowTotals).toContain('50.00')
    // 总计 = 200
    expect(w.find('th.s10-foot-total').text()).toBe('200.00')
    // 列合计:factoryRent = 130（首叶子）
    const footNums = w.findAll('tfoot th.s10-c-num').map(th => th.text())
    expect(footNums[0]).toBe('130.00')
  })

  it('浏览态信后端派生:行 total / columnTotals / grandTotal 原样展示', () => {
    // 行 total=999 与列值故意不等:证明浏览态没有本地自算(口袋含归档列等前端看不见的值)
    const row = makeRow('factory', { factoryRent: 100 }, { total: 999 })
    const w = mount(S10Table, {
      props: {
        groups: LAYOUTS.factory, phaseName: '二期厂房', year: 2026, month: 6, rows: [row], edit: false,
        columnTotals: { factoryRent: 100 }, grandTotal: 999,
      },
    })
    expect(w.find('td.s10-c-total').text()).toBe('999.00')
    expect(w.find('th.s10-foot-total').text()).toBe('999.00')
    const footNums = w.findAll('tfoot th.s10-c-num').map(th => th.text())
    expect(footNums[0]).toBe('100.00')
  })

  it('编辑态 sumIds 含隐藏列:行合计计入版面外的值', () => {
    const row = makeRow('factory', { factoryRent: 100 })
    ;(row as unknown as Record<string, number>).c_hidden = 7   // 隐藏自定义列(平铺后在行顶层)
    const sumIds = [...leavesOf('factory').map(l => l.colId as string), 'c_hidden']
    const w = mount(S10Table, {
      props: { groups: LAYOUTS.factory, phaseName: '二期厂房', year: 2026, month: 6, rows: [row], edit: true, sumIds },
    })
    expect(w.find('td.s10-c-total').text()).toBe('107.00')
  })
})
