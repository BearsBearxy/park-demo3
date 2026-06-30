import { describe, it, expect } from 'vitest'
import { importElecRows, type ElecImportRow } from './importElecRows'

const c = (a: (string | number)[]) => a.map(String)

// 仿真实附表11:两行表头(分组 + 叶子),左块 记账期/期 合并下填,大工业行带计费需量(产 basic)。
// 列序对齐真实 dump:记账期@0·期@1·用电时段@2·开票日期@3·用电类别@4·单位@5·电量@6·不含税单价@7·
//   不含税金额@8·税率@9·税额@10·价税合计@11·计费需量@12·单价@13·基本用电费@14。
const elec: string[][] = [
  c(['', '', '进项', '', '', '', '', '', '', '', '', '', '其中:基本用电']),
  c(['', '', '开票日期', '用电时段', '用电类别', '单位', '电量', '不含税单价', '不含税金额', '税率', '税额', '价税合计', '计费需量', '单价', '基本用电费']),
  // 记账期 202501 / 一期:大工业(带计费需量) + 居民 + 商业 各下填
  c(['202501', '一期', '', '2024-12-01', '大工业用电', '千瓦时', '203280', '0.735342', '149480.36', '13%', '19432.45', '168912.81', '1029.6', '36.1', '37168.56', '248257.64']),
  c(['', '', '', '2024-12-01', '居民生活', '千瓦时', '137595', '0.562716', '77426.87', '13%', '10065.49', '87492.36']),
  c(['', '', '', '2024-12-01', '商业', '千瓦时', '42405', '0.605644', '25682.33', '13%', '3338.7', '29021.03']),
  // 记账期 202501 / 二期:大工业(带计费需量)
  c(['202501', '二期', '', '2024-12-01', '大工业用电', '千瓦时', '585120', '0.728420', '426212.96', '13%', '55407.68', '481620.64', '1666.8', '36.1', '60171.48', '421449.16']),
  // 小计行整行跳过
  c(['', '', '202501', '小计', '', '', '968400', '0.700953', '678802.52', '', '88244.32', '767046.84']),
]

describe('importElecRows — 附表11 电费成本 bespoke 解析', () => {
  it('一(记账期,期)产多 energy + 大工业额外 1 basic;小计跳过;YYYYMM 解析;下填生效', () => {
    const { records, error } = importElecRows(elec)
    expect(error).toBeUndefined()
    const recs = records as unknown as ElecImportRow[]
    // 一期:大工业(energy+basic) + 居民(energy) + 商业(energy) = 4 条;二期大工业(energy+basic) = 2 条 → 共 6
    expect(recs.length).toBe(6)

    // 记账期 202501 → 2025-01(YYYYMM 解析),期下填 一→p1 / 二→p2
    const e0 = recs[0]
    expect(e0).toMatchObject({
      type: 'energy', phaseId: 'p1', acctMonth: '2025-01',
      cat: '大工业用电', unit: '千瓦时', qty: 203280, price: 0.735342, rate: 0.13, period: null,
    })
    // 紧随的 basic(同行计费需量非空):demand=1029.6, price=36.1(basic 单价列), rate 同行
    expect(recs[1]).toMatchObject({ type: 'basic', phaseId: 'p1', acctMonth: '2025-01', demand: 1029.6, price: 36.1, rate: 0.13 })
    // 居民/商业 energy 无 basic、下填承一期
    expect(recs[2]).toMatchObject({ type: 'energy', phaseId: 'p1', cat: '居民生活' })
    expect(recs[3]).toMatchObject({ type: 'energy', phaseId: 'p1', cat: '商业' })
    // 二期大工业 energy + basic
    expect(recs[4]).toMatchObject({ type: 'energy', phaseId: 'p2', acctMonth: '2025-01', cat: '大工业用电', qty: 585120 })
    expect(recs[5]).toMatchObject({ type: 'basic', phaseId: 'p2', acctMonth: '2025-01', demand: 1666.8, price: 36.1 })

    // 派生(不含税金额/税额/价税合计/基本用电费)不入记录
    for (const r of recs as unknown as Record<string, unknown>[]) {
      expect(r.amount).toBeUndefined()
      expect(r.tax).toBeUndefined()
      expect(r.total).toBeUndefined()
    }
  })

  it('开票日期 m/d/yy 也解析为 YYYY-MM-DD', () => {
    const m: string[][] = [
      c(['', '', '开票日期', '用电时段', '用电类别', '单位', '电量', '不含税单价', '不含税金额', '税率', '税额', '价税合计', '计费需量', '单价', '基本用电费']),
      c(['202503', '一期', '', '2/9/25', '大工业用电', '度', '1000', '0.98', '980', '13%', '127.4', '1107.4', '1250', '32', '40000']),
    ]
    const { records } = importElecRows(m)
    const recs = records as unknown as ElecImportRow[]
    expect(recs[0].invDate).toBe('2025-02-09')
    expect(recs[0].acctMonth).toBe('2025-03')
    expect(recs[1].type).toBe('basic')
    expect(recs[1].demand).toBe(1250)
  })

  it('无表头 → error', () => {
    const { error } = importElecRows([c(['乱', '七', '八', '糟'])])
    expect(error).toBeTruthy()
  })
})
