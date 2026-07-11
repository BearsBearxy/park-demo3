// expense.logic 单测:组带识别/关键词圈定/环比含 null 月/Top 排序。
// 标签锚定 2025 库内实际(SQL 已核对):销售费用合计(group=销售费用 无冒号)/管理费用总计：/
// 财务费用合计：/修缮、改造费用/运营费用总计;组内小计「办公室水电费合计」等不得混入组带。
import { describe, expect, it } from 'vitest'
import type { PnlRowDTO } from '@/types/pnl'
import { addSeries, coveredMonths, extractGroups, momMovers, reimburse, topSubjects, wanSeries } from './expense.logic'

const M = (src: Partial<Record<number, number>> = {}): (number | null)[] => {
  const a: (number | null)[] = new Array(12).fill(null)
  for (const [k, v] of Object.entries(src)) a[+k - 1] = v as number
  return a
}
const row = (groupLabel: string, label: string, kind: PnlRowDTO['kind'], src?: Partial<Record<number, number>>): PnlRowDTO =>
  ({ rowKey: label, groupLabel, label, kind, note: null, m: M(src), sortOrder: 0 })

describe('extractGroups 组带识别', () => {
  const rows = [
    row('销售费用', '一期中介费', 'detail', { 1: 999 }),               // 明细不计入
    row('销售费用', '销售费用合计', 'total', { 1: 100, 2: 200 }),      // group 非空、无冒号(库内实际)
    row('管理费用', '办公室水电费合计', 'total', { 1: 50 }),           // 组内小计,不得混入
    row('管理费用', '保安、保洁费用合计', 'total', { 1: 60 }),         // 组内小计,不得混入
    row('', '管理费用总计：', 'total', { 1: 300 }),                    // 全角冒号
    row('', '财务费用合计：', 'total', { 1: 10 }),
    row('', '修缮、改造费用', 'total', { 2: 40 }),
    row('', '运营费用总计', 'total', { 1: 410, 2: 240 }),
  ]
  const g = extractGroups(rows)
  it('五组带按前缀命中总计行,不重算明细', () => {
    expect(g.sales).toEqual(M({ 1: 100, 2: 200 }))
    expect(g.admin).toEqual(M({ 1: 300 }))       // 小计 50/60 未混入
    expect(g.fin).toEqual(M({ 1: 10 }))
    expect(g.repair).toEqual(M({ 2: 40 }))
    expect(g.total).toEqual(M({ 1: 410, 2: 240 }))
  })
  it('缺月保持 null;coveredMonths=任一组带有数月', () => {
    expect(g.admin[2]).toBeNull()
    expect(coveredMonths(g)).toEqual([1, 2])
  })
})

describe('addSeries / wanSeries', () => {
  it('逐月相加,两侧均 null 保持 null;折万保留两位', () => {
    expect(addSeries(M({ 1: 5 }), M({ 1: 3, 2: 7 }))).toEqual(M({ 1: 8, 2: 7 }))
    expect(wanSeries(M({ 1: 12345 }))).toEqual(M({ 1: 1.23 }))
  })
})

describe('topSubjects 科目 Top 排序', () => {
  const rows = [
    row('管理费用', '员工工资', 'detail', { 1: 100, 2: 200 }),
    row('销售费用', '一期中介费', 'detail', { 1: 500 }),
    row('管理费用', '快递费', 'detail', { 1: 20 }),
    row('管理费用', '利息收入', 'detail', { 1: -5 }),                  // ≤0 不入榜
    row('', '运营费用总计', 'total', { 1: 9999 }),                     // 合计行不参与
  ]
  it('月粒度取当月,金额降序取前 N,带组归属', () => {
    const t = topSubjects(rows, true, 0, 2)
    expect(t.map((d) => d.label)).toEqual(['一期中介费', '员工工资'])
    expect(t[0]).toEqual({ label: '一期中介费', group: '销售费用', value: 500 })
  })
  it('年粒度=有数月Σ;无数据月的科目值为 null 时不入榜', () => {
    expect(topSubjects(rows, false, 0, 10).find((d) => d.label === '员工工资')?.value).toBe(300)
    expect(topSubjects([row('管理费用', '聚餐费', 'detail')], false, 0).length).toBe(0)
  })
})

describe('momMovers 环比异动(含 null 月)', () => {
  const rows = [
    row('管理费用', '快递费', 'detail', { 1: 100, 3: 150 }),          // 2月缺 → 跨 null 对比 1月,+50%
    row('管理费用', '节日费用', 'detail', { 2: 100, 3: 40 }),         // −60%
    row('管理费用', '聚餐费', 'detail', { 3: 50 }),                   // 无上期 → 排除
    row('管理费用', '业务费', 'detail', { 1: 0, 3: 80 }),             // 上期=0 → 排除(分母 0)
    row('管理费用', '审计费', 'detail', { 2: 30, 3: 30 }),            // 持平 → 非异动
    row('管理费用', '员工工资', 'detail', { 1: 100, 2: 120 }),        // 当月(3月)无数 → 排除
    row('', '运营费用总计', 'total', { 2: 1, 3: 9 }),                 // 合计行不参与
  ]
  it('|环比%| 降序;跨 null 取最近有数月并给出基准月', () => {
    const mv = momMovers(rows, 2)   // mi=2 → 3月
    expect(mv.map((d) => d.label)).toEqual(['节日费用', '快递费'])
    expect(mv[0].pct).toBeCloseTo(-60)
    expect(mv[1]).toMatchObject({ prev: 100, cur: 150, delta: 50, prevM: 1 })
  })
})

describe('reimburse 员工报销与办公类圈定', () => {
  const rows = [
    row('管理费用', '餐补费', 'detail', { 1: 100 }),
    row('管理费用', '差旅费（油费）', 'detail', { 1: 50 }),
    row('管理费用', '接待矿泉水', 'detail', { 2: 30 }),
    row('管理费用', '保洁用品', 'detail', { 1: 20 }),
    row('管理费用', '员工工资', 'detail', { 1: 9999 }),               // 不命中关键词
    row('管理费用', '办公室水电费合计', 'total', { 1: 888 }),         // 含「办公」但是合计行 → 不圈,防重算
  ]
  it('明细行关键词命中;月=当月(该月无数科目跳过)', () => {
    const r = reimburse(rows, true, 0)   // 1月
    expect(r.sum).toBe(170)
    expect(r.items.map((d) => d.label)).toEqual(['餐补费', '差旅费（油费）', '保洁用品'])
  })
  it('年=Σ;无任何命中有数科目 → sum=null(KPI 显 —)', () => {
    expect(reimburse(rows, false, 0).sum).toBe(200)
    expect(reimburse([row('管理费用', '员工工资', 'detail', { 1: 1 })], true, 0).sum).toBeNull()
  })
})
