// parkEnergy.logic.spec.ts — 园区能耗改稿(energy-v2)四块画板逐字对:夹具 = 开发库 2024、2025 两年真数
// (产品 buildEnergyMonths / buildAmtMonths 导出,到分),期望 = 画板句子清单 manifest.json 与画板图上的数。
import { describe, expect, it } from 'vitest'
import type { EnergyMonth } from '@/analysis/anaData'
import { anchorS10Ym, asofOf, buildAmtMonths, monthModel, yearModel, type AmtMonth, type EnergyData } from './parkEnergy.logic'

type MRow = [string, ...(number | null)[]]
const mon = (rows: MRow[]): EnergyMonth[] => rows.map(([ym, buyKwh, buyCost, pvSelfKwh, pvGridKwh, pvAmt, chgProfit, s10Elec]) => ({
  ym, buyKwh, buyCost, pvSelfKwh, pvGridKwh, pvAmt, chgKwh: null, chgProfit, officeKwh: null, s10Elec, s10Water: null,
}))
const amt = (rows: MRow[]): AmtMonth[] => rows.map(([ym, buyCost, pvSelfAmt, s10Elec, officeAmt, chgCost]) => ({ ym, buyCost, pvSelfAmt, s10Elec, officeAmt, chgCost }))

// ym, buyKwh, buyCost, pvSelfKwh, pvGridKwh, pvAmt, chgProfit, s10Elec
const M24 = mon([
  ['2024-09', null, null, 153825, 33600, 153512.36, null, null],
  ['2024-10', null, null, 167902, 40640, 169646.6, null, null],
  ['2024-11', null, null, 159269, 55040, 169134.28, null, null],
  ['2024-12', null, null, 117624, 38720, 122165.97, null, null],
])
const M25 = mon([
  ['2025-01', 968400, 877041.25, 78689.5, 45520, 91806.52, 4645.72, 1069452.24],
  ['2025-02', 490035.53, 731376.69, 94970.5, 112000, 137372.25, 4411.89, 1127726.53],
  ['2025-03', 648720, 674924.02, 90200, 67440, 114151.63, 6106.73, null],
  ['2025-04', 913960, 880461.21, 124258, 74240, 144825.32, 6174.96, null],
  ['2025-05', 957460, 960559.08, 146686, 65760, 161241.02, 5740.57, null],
  ['2025-06', 1048240, 1018481.35, 157585.5, 74280, 175187.19, 5687.77, 1413566.55],
  ['2025-07', 878420, 845573.53, 415840.5, 121000, 439102.99, 6484.17, 1494888.59],
  ['2025-08', 981840, 889115.36, 537098.5, 143680, 541591.98, 6188.26, null],
  ['2025-09', 1041880, 954528.07, 431289, 118440, 438389.77, 6796.14, null],
  ['2025-10', 1060420, 1000628.59, 475864, 83840, 478796.34, 20481.44, 1871915.24],
  ['2025-11', 965720, 924009.6, 391685.5, 126920, 420089.49, 21562.57, 1593248.79],
  ['2025-12', 811100, 769889.68, 361485.5, 92560, 368182.92, 20294.3, 1397941.61],
])
// ym, buyCost, pvSelfAmt, s10Elec, officeAmt, chgCost
const A24 = amt([
  ['2024-09', null, 138291.56, null, 7776.67, null],
  ['2024-10', null, 151236.68, null, 31660, null],
  ['2024-11', null, 144201.16, null, 23872.01, null],
  ['2024-12', null, 104625.81, null, 17240.27, null],
])
const A25 = amt([
  ['2025-01', 877041.25, 71185.96, 1069452.24, 7943.49, 1594.42],
  ['2025-02', 731376.69, 86636.25, 1127726.53, 6966, 1494.66],
  ['2025-03', 674924.02, 83601.31, null, 6839.24, 2207.94],
  ['2025-04', 880461.21, 111194.6, null, 5725.2, 2305.37],
  ['2025-05', 960559.08, 131451.74, null, 5469.84, 2160.87],
  ['2025-06', 1018481.35, 141538.35, 1413566.55, 1181.45, 2210.6],
  ['2025-07', 845573.53, 384289.99, 1494888.59, 1366.51, 2486.08],
  ['2025-08', 889115.36, 476504.94, null, 1662.6, 2535.66],
  ['2025-09', 954528.07, 384736.45, null, 1456.34, 2798.22],
  ['2025-10', 1000628.59, 440816.82, 1871915.24, 1541.38, 19281.47],
  ['2025-11', 924009.6, 362594.73, 1593248.79, 962.42, 18457.4],
  ['2025-12', 769889.68, 326253.24, 1397941.61, 982.72, 15577.31],
])
const D: EnergyData = { year: 2025, mon: M25, monPast: M24, amt: A25, amtPast: A24 }
const DEFS = ['售电收益按售电收入和购电成本算', '光伏收益按光伏自用和上网算', '充电桩收益按手续费及服务费和充电桩用电算']
const FLOW_DEF = '售电收入按向租户收的算，其余按电费算，两边不等'
const nodeText = (n: { name: string; val: string; prev: string }) => [n.name, n.val, n.prev].filter(Boolean).join(' ')

describe('按月 2025年12月(默认板 energy-v2)', () => {
  const m = monthModel(D, 12)
  it('❗屏顶四张瓦不放钱,都和11月比;单价降了标绿,电量、比例不上色', () => {
    expect(m.kpis.map((k) => [k.label, k.value, k.dval, k.dkey, k.dtone])).toEqual([
      ['单位购电成本', '0.949元/kWh', '−0.008元', '比11月', 'up'],
      ['购电量', '81.1万kWh', '−15.5万kWh', '比11月', undefined],
      ['光伏自用和上网', '45.4万kWh', '−6.5万kWh', '比11月', undefined],
      ['光伏占园区用电', '30.8%', '+1.9 个点', '比11月', undefined],
    ])
    expect(m.kpis.map((k) => k.ddir)).toEqual(['dn', 'dn', 'dn', 'up'])
  })
  it('❗流向图节点标本月和11月,差额不画成来源;读数句 = 售电收入 − 购电成本(按节点上的一位小数相减)', () => {
    const f = m.flow!
    expect(f.nodes.map(nodeText)).toEqual([
      '购电成本 ¥77.0万 11月 ¥92.4万', '光伏自用 ¥32.6万 11月 ¥36.3万',
      '售电收入 ¥139.8万 11月 ¥159.3万', '充电桩用电 ¥1.6万 11月 ¥1.8万', '办公和三期用电 ¥0.1万 11月 ¥0.1万',
    ])
    expect(f.nodes.map((n) => n.side)).toEqual(['l', 'l', 'r', 'r', 'r'])
    expect([f.tag, f.hint, f.read, f.refs]).toEqual(['', '按金额 · 和11月比 · 万元', '售电收入比购电成本多 ¥62.8万；11月多 ¥66.9万', [FLOW_DEF]])
  })
  it('❗各项收益成对条(上月 / 本月);变动没过上月合计 5% → 不出读数句', () => {
    expect([m.earn.cats, m.earn.prev, m.earn.cur, m.earn.prevName, m.earn.curName]).toEqual([['售电收益', '光伏收益', '充电桩收益'], [66.9, 42, 2.2], [62.8, 36.8, 2], '11月', '12月'])
    expect([m.earn.hint, m.earn.read, m.earn.refs]).toEqual(['和11月比 · 万元', '', DEFS])
  })
})

describe('按月 2025年6月(上个月销售收入表没数 energy-v2-m06)', () => {
  const m = monthModel(D, 6)
  it('❗瓦', () => {
    expect(m.kpis.map((k) => [k.value, k.dval])).toEqual([['0.972元/kWh', '−0.031元'], ['104.8万kWh', '+9.1万kWh'], ['23.2万kWh', '+2.0万kWh'], ['13.1%', '−0.2 个点']])
  })
  it('❗售电节点写「5月没有」,读数句不带5月;其余节点照带5月', () => {
    expect(m.flow!.nodes.map(nodeText)).toEqual([
      '购电成本 ¥101.8万 5月 ¥96.1万', '光伏自用 ¥14.2万 5月 ¥13.1万', '售电收入 ¥141.4万 5月没有', '充电桩用电 ¥0.2万 5月 ¥0.2万', '办公和三期用电 ¥0.1万 5月 ¥0.5万',
    ])
    expect([m.flow!.hint, m.flow!.read]).toEqual(['按金额 · 和5月比 · 万元', '售电收入比购电成本多 ¥39.6万'])
  })
  it('❗售电收益5月没数只剩本月一根;读数句只说两项都有的;参照照说缺5月', () => {
    expect([m.earn.prev, m.earn.cur]).toEqual([[null, 16.1, 0.6], [39.6, 17.5, 0.6]])
    expect(m.earn.read).toBe('光伏收益 16.1→17.5；充电桩收益 0.6→0.6')
    expect(m.earn.refs).toEqual([...DEFS, '销售收入表里没有5月，算不了5月的售电收益'])
  })
})

describe('按月 2025年3月(这个月销售收入表没数 energy-v2-m03)', () => {
  const m = monthModel(D, 3)
  it('❗流向图退到2月:卡头贴「显示 2月」,比1月;这个月的购电成本瓦留着(放在最前)', () => {
    expect(m.kpis.map((k) => [k.label, k.value, k.dval, k.dtone])).toEqual([
      ['购电成本', '¥67.5万', '−5.6万', 'up'], ['单位购电成本', '1.040元/kWh', '−0.452元', 'up'], ['购电量', '64.9万kWh', '+15.9万kWh', undefined],
      ['光伏自用和上网', '15.8万kWh', '−4.9万kWh', undefined], ['光伏占园区用电', '12.2%', '−4.0 个点', undefined],
    ])
    const f = m.flow!
    expect([f.tag, f.hint, f.read]).toEqual(['显示 2月', '按金额 · 和1月比 · 万元', '售电收入比购电成本多 ¥39.7万；1月多 ¥19.2万'])
    expect(f.refs).toEqual([FLOW_DEF, '销售收入表里没有3月，图上是2月的数'])
    expect(f.nodes.map(nodeText)).toEqual([
      '购电成本 ¥73.1万 1月 ¥87.7万', '光伏自用 ¥8.7万 1月 ¥7.1万', '售电收入 ¥112.8万 1月 ¥106.9万', '充电桩用电 ¥0.1万 1月 ¥0.2万', '办公和三期用电 ¥0.7万 1月 ¥0.8万',
    ])
  })
  it('❗各项收益:3月售电收益算不了,和2月比', () => {
    expect([m.earn.prev, m.earn.cur, m.earn.hint, m.earn.read]).toEqual([[39.7, 13.7, 0.4], [null, 11.4, 0.6], '和2月比 · 万元', ''])
    expect(m.earn.refs.at(-1)).toBe('销售收入表里没有3月，算不了3月的售电收益')
  })
})

describe('按年 2025(energy-v2-year)', () => {
  const y = yearModel(D)
  it('❗五张瓦:钱在前,写覆盖不写涨跌', () => {
    expect(y.kpis.map((k) => [k.label, k.value, k.note])).toEqual([
      ['购电成本', '¥1,052.7万', '12 个月合计'], ['单位购电成本', '0.978元/kWh', '按 12 个月合计算'], ['购电量', '1,076.6万kWh', '12 个月合计'],
      ['光伏自用和上网', '443.1万kWh', '2024年只有9–12月有数'], ['光伏占园区用电', '23.5%', '园区用电是购电量加光伏自用'],
    ])
  })
  it('❗流向图只算销售收入表有数的7个月,节点写「· 7 个月」,不带往年', () => {
    expect(y.flow!.nodes.map(nodeText)).toEqual(['购电成本 ¥616.7万 · 7 个月', '光伏自用 ¥181.3万 · 7 个月', '售电收入 ¥996.9万 · 7 个月', '充电桩用电 ¥6.1万 · 7 个月', '办公和三期用电 ¥2.1万 · 7 个月'])
    expect([y.flow!.hint, y.flow!.read, y.flow!.refs]).toEqual(['按金额 · 销售收入表有数的 7 个月 · 万元', '售电收入比购电成本多 ¥380.2万', [FLOW_DEF]])
  })
  it('❗各月售电收入和购电成本:12 个月位都留,缺月售电空着;售电收益最高最低两点标数', () => {
    expect(y.bars.sell).toEqual([106.9, 112.8, null, null, null, 141.4, 149.5, null, null, 187.2, 159.3, 139.8])
    expect(y.bars.gap.filter((v) => v != null)).toEqual([19.2, 39.7, 39.6, 64.9, 87.1, 66.9, 62.8])
    expect([y.bars.read, y.bars.refs, y.bars.marks]).toEqual(['售电收益最高 10月 ¥87.1万，最低 1月 ¥19.2万', ['销售收入表里没有3–5月、8–9月'], [9, 0]])
  })
  it('❗各月单位购电成本:并列最低两个月都标', () => {
    expect([y.unit.read, y.unit.his, y.unit.los]).toEqual(['最高 2月 1.492元，最低 1月、8月 0.906元', [1], [0, 7]])
    expect(y.unit.refs).toEqual(['购电成本按价税合计、含基本电费算', '2024年没有购电数据，比不了往年'])
  })
  it('❗各项收益:条旁写有数的月数;光伏收益和2024年同期比,两个数进气泡', () => {
    expect(y.earn.items.map((i) => [i.value, i.label])).toEqual([[380.2, '¥380.2万 · 7 个月'], [351.1, '¥351.1万 · 12 个月'], [11.5, '¥11.5万 · 12 个月']])
    expect(y.earn.mark).toEqual({ value: 351.1, lines: ['9–12月 ¥170.5万', '2024年9–12月 ¥61.4万'] })
    expect(y.earn.read).toBe('光伏收益9–12月比2024年多 ¥109.1万')
    expect(y.earn.refs).toEqual([...DEFS, '2024年只有光伏收益9–12月有数'])
  })
})

describe('数据缺口', () => {
  it('❗这一年销售收入表一个月都没有:流向图不画,照说;购电成本瓦回到屏顶;不崩', () => {
    const d: EnergyData = { year: 2026, mon: mon([['2026-01', null, null, 300000, 20000, 310000, null, null]]), monPast: M25, amt: amt([['2026-01', null, 280000, null, null, null]]), amtPast: A25 }
    const m = monthModel(d, 1)
    expect([m.flow, m.flowEmpty]).toEqual([null, '销售收入表里没有2026年'])
    expect(m.kpis.map((k) => [k.label, k.value, k.dval])).toEqual([
      ['购电成本', '—', undefined], ['单位购电成本', '—', undefined], ['购电量', '—', undefined], ['光伏自用和上网', '32.0万kWh', '−13.4万kWh'], ['光伏占园区用电', '—', undefined],
    ])
    expect(m.earn.prevName).toBe('12月')   // 1 月比上一年 12 月
    const y = yearModel(d)
    expect(y.flow).toBeNull()
    expect(y.kpis[0].value).toBe('—')
    expect(y.unit.refs).toEqual(['购电成本按价税合计、含基本电费算'])   // 2025 有购电:不说「比不了往年」
    expect(y.earn.refs.join('|')).not.toContain('2025年只有')   // 2025 年 12 个月都有光伏收益:不按两年重叠的 1 个月说「只有1月」(对抗复查 10-05)
    expect(y.earn.read).toContain('1月')
    expect(y.bars.refs).toEqual(['销售收入表里没有2026年'])   // 一个月都没有:说整年,不列「1–12月」
  })
})

describe('工具条数据截至', () => {
  it('❗三份数据各到哪个月;缺一份退回外壳默认', () => {
    expect(asofOf({ elec: ['2025-11', '2025-12'], s10: ['2025-12'], pv: ['2025-12', '2026-01'] })).toBe('购电到 2025年12月 · 销售收入表到 2025年12月 · 光伏到 2026年1月')
    expect(asofOf({ pnl: ['2025-06'] })).toBeUndefined()
  })
})

describe('buildAmtMonths', () => {
  it('各源金额并入目标年逐月;缺源 = null 不补 0;跨年行剔除', () => {
    const out = buildAmtMonths(2025,
      { energy: { rows: [{ acctMonth: '2025-01', total: 100 }, { acctMonth: '2024-12', total: 999 }] }, basic: { rows: [{ acctMonth: '2025-01', total: 50 }] } },
      [{ acctMonth: '2025-01', selfAmt: 30 }],
      [{ rows: [{ acctMonth: '2025-01', cost: 7 }] }, { rows: [{ acctMonth: '2025-02', cost: 3 }] }],
      [{ rows: [{ acctMonth: '2025-01', elecAmt: 5 }] }],
      [{ acctMonth: '2025-01', elec: 200 }, { acctMonth: '2025-01', elec: 40 }],
    )
    expect(out.map((m) => m.ym)).toEqual(['2025-01', '2025-02'])
    expect(out[0]).toEqual({ ym: '2025-01', buyCost: 150, pvSelfAmt: 30, s10Elec: 240, officeAmt: 5, chgCost: 7 })
    expect(out[1]).toEqual({ ym: '2025-02', buyCost: null, pvSelfAmt: null, s10Elec: null, officeAmt: null, chgCost: 3 })
  })
})

describe('anchorS10Ym(能量流月锚)', () => {
  it('命中有数月 → 原月;缺月 → ≤所选最近;更早无 → 最早有数月;全无 → null', () => {
    const COVERED = ['2025-01', '2025-02', '2025-06', '2025-07', '2025-10']
    expect(anchorS10Ym(COVERED, '2025-06')).toBe('2025-06')
    expect(anchorS10Ym(COVERED, '2025-03')).toBe('2025-02')
    expect(anchorS10Ym(COVERED, '2025-12')).toBe('2025-10')
    expect(anchorS10Ym(['2025-06'], '2025-01')).toBe('2025-06')
    expect(anchorS10Ym([], '2025-01')).toBeNull()
  })
})
