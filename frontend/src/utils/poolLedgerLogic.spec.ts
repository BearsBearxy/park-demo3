import { describe, expect, it } from 'vitest'
import {
  buildLossReconRows, buildPoolExportAoa, gapClass, groupPoolsByBuilding, lossFooter, poolAutoName,
  poolFeeLabel, poolFloorSide, poolFooter, poolSemantics, stdDisplay,
} from './poolLedgerLogic'
import type { AllocLossReconDTO, AllocLossUnitDTO, AllocPoolRowDTO } from '@/api/alloc'

const pool = (p: Partial<AllocPoolRowDTO>): AllocPoolRowDTO => ({
  ruleId: 1, zone: 'p2', name: '一车间消防', groupLabel: '一车间', method: 'floor',
  stdKind: null, roundScale: 2, baseKey: null, sortNo: 10, note: null,
  buildingId: 13, buildingName: '一车间', floorLabel: null, side: null, feeName: '消防',
  autoName: '一车间·消防', autoMembers: false, members: [],
  meters: [{ meterId: 9, name: '一车间消防', sign: 1, label: '一车间·电表①', spot: '一车间', subName: '电表①', meterType: '公共用电' }], links: [],
  qtyTotal: null, qtySharp: null, qtyPeak: null, qtyFlat: null, qtyValley: null,
  extraQty: null, costAmount: null, baseSnap: null, stdValue: null, foldAdd: null,
  priceSnap: null, allocatedAmount: null, gapAmount: null, warn: null, ...p,
})

describe('poolSemantics 分摊语义标签', () => {
  it('floor=X层均摊', () => expect(poolSemantics(pool({ method: 'floor', baseSnap: 7 }))).toBe('7层均摊'))
  it('floor 小数层数不带浮点噪音', () =>
    expect(poolSemantics(pool({ method: 'floor', baseSnap: 5.8 }))).toBe('5.8层均摊'))
  it('area=X㎡分摊', () =>
    expect(poolSemantics(pool({ method: 'area', baseSnap: 1734.73 }))).toBe('1734.73㎡分摊'))
  it('未生成月基数null=方法字典回退', () =>
    expect(poolSemantics(pool({ method: 'area', baseSnap: null }))).toBe('按面积'))
  it('direct/none/ref 固定话术', () => {
    expect(poolSemantics(pool({ method: 'direct' }))).toBe('户对户')
    expect(poolSemantics(pool({ method: 'none' }))).toBe('不分摊')
    expect(poolSemantics(pool({ method: 'ref' }))).toBe('纯标准行')
  })
})

describe('stdDisplay 分摊标准与折入披露', () => {
  it('按 roundScale 定小数', () => {
    expect(stdDisplay(pool({ stdValue: 302.5, roundScale: 2 }))).toEqual({ text: '302.50', title: null })
    expect(stdDisplay(pool({ stdValue: 0.015, roundScale: 3 })).text).toBe('0.015')
  })
  it('折入档比 roundScale 多一位不截位(V46=0.015,scale2)', () => {
    expect(stdDisplay(pool({ stdValue: 0.015, foldAdd: 0.005, roundScale: 2 })).text).toBe('0.015')
  })
  it('null=–', () => expect(stdDisplay(pool({ stdValue: null }))).toEqual({ text: '–', title: null }))
  it('折入 title=基础+叠加(V46=0.01+0.005)', () =>
    expect(stdDisplay(pool({ stdValue: 0.015, foldAdd: 0.005, roundScale: 3 })).title).toBe('0.01+0.005'))
})

describe('poolAutoName 池名自动生成(与后端 poolName 同规则)', () => {
  it('四级定位「·」连接,楼层+侧向合成一段,楼栋名原样(含空格)', () =>
    expect(poolAutoName('p1', '一期 A座', '四楼', '西侧', '走廊灯')).toBe('一期 A座·四楼西侧·走廊灯'))
  it('楼层空=整栋(货梯这类跨层池)', () =>
    expect(poolAutoName('p1', '一期 A座', null, null, '货梯')).toBe('一期 A座·货梯'))
  it('楼栋空=园区级,前缀取期别(三个「路灯」池靠期别区分,统一前缀会三撞一)', () => {
    expect(poolAutoName('p1', null, null, null, '路灯')).toBe('一期园区·路灯')
    expect(poolAutoName('p2', null, null, null, '路灯')).toBe('二期园区·路灯')
    expect(poolAutoName('dorm', null, null, null, '路灯')).toBe('宿舍区·路灯')
  })
  it('侧向单独给也进定位段', () =>
    expect(poolAutoName('p2', '二车间', null, '东侧', '公共电')).toBe('二车间·东侧·公共电'))
  it('截到 64', () => expect(poolAutoName('p1', '楼'.repeat(80), null, null, '消防').length).toBe(64))
})

describe('groupPoolsByBuilding 只按楼栋分带 + 楼层方位成列', () => {
  // 入参=后端契约序(园区级→楼栋账册序→楼层(整栋在前)→侧向);带内故意打乱楼层/侧向/sortNo
  const rows = [
    pool({ ruleId: 8, zone: 'p2', buildingId: null, buildingName: null, sortNo: 89 }),
    pool({ ruleId: 3, zone: 'p2', buildingName: '一期A座', floorLabel: '四楼', side: '东侧', sortNo: 30 }),
    pool({ ruleId: 4, zone: 'p2', buildingName: '一期A座', floorLabel: '四楼', side: '东侧', sortNo: 25 }),
    pool({ ruleId: 2, zone: 'p2', buildingName: '一期A座', floorLabel: '四楼', side: '西侧', sortNo: 20 }),
    pool({ ruleId: 5, zone: 'p2', buildingName: '一期A座', floorLabel: '负一层', side: null, sortNo: 60 }),
    pool({ ruleId: 1, zone: 'p2', buildingName: '一期A座', floorLabel: null, side: null, sortNo: 10 }),
    pool({ ruleId: 9, zone: 'p1', buildingName: 'B座', sortNo: 5 }),
  ]
  it('一栋一带(楼层/侧向不再分带),带序=行序首现', () => {
    expect(groupPoolsByBuilding(rows, 'p2').map(b => b.label)).toEqual(['园区级', '一期A座'])
  })
  it('带内序=楼层(整栋排首,负一层<四楼)→侧向→sortNo', () => {
    const bands = groupPoolsByBuilding(rows, 'p2')
    expect(bands[1].rows.map(r => r.ruleId)).toEqual([1, 5, 4, 3, 2])
  })
  it('zone 过滤;无行=空带', () => {
    expect(groupPoolsByBuilding(rows, 'p1').map(b => b.label)).toEqual(['B座'])
    expect(groupPoolsByBuilding(rows, 'dorm')).toEqual([])
  })
})

describe('poolFloorSide 楼层·方位列', () => {
  it('楼层+侧向拼接', () =>
    expect(poolFloorSide(pool({ floorLabel: '二楼', side: '东侧' }))).toBe('二楼东侧'))
  it('只有楼层 / 只有侧向', () => {
    expect(poolFloorSide(pool({ floorLabel: '天面', side: null }))).toBe('天面')
    expect(poolFloorSide(pool({ floorLabel: null, side: '东侧' }))).toBe('东侧')
  })
  it("整栋池(挂楼栋但楼层侧向皆空)='–'", () =>
    expect(poolFloorSide(pool({ floorLabel: null, side: null }))).toBe('–'))
  it('园区级池(不挂楼栋)=空', () =>
    expect(poolFloorSide(pool({ buildingId: null, floorLabel: null, side: null }))).toBe(''))
})

describe('poolFeeLabel 池名称列只显费项名', () => {
  it('有 feeName 就只显费项', () =>
    expect(poolFeeLabel(pool({ feeName: '公共用电', name: '一车间·二楼东侧·公共用电' }))).toBe('公共用电'))
  it('feeName 空(41/42/51 待人工池)回退全名', () => {
    expect(poolFeeLabel(pool({ feeName: null, name: '一期B101蔡卫兵' }))).toBe('一期B101蔡卫兵')
    expect(poolFeeLabel(pool({ feeName: '  ', name: '一期C座陈' }))).toBe('一期C座陈')
  })
})

describe('gapClass 盈亏色阶', () => {
  it('0(含浮点容差)=绿', () => {
    expect(gapClass(0)).toBe('ok')
    expect(gapClass(-0.001)).toBe('ok')
  })
  it('负=亏红 / 正=盈橙 / null=灰', () => {
    expect(gapClass(-111.42)).toBe('bad')
    expect(gapClass(0.5)).toBe('warn')
    expect(gapClass(null)).toBe('empty')
  })
})

describe('poolFooter 合计(ref 行剔除)', () => {
  it('Σ度数/Σ应分摊,ref 不计', () => {
    const bands = groupPoolsByBuilding([
      pool({ ruleId: 1, qtyTotal: 100.5, costAmount: 111.18 }),
      pool({ ruleId: 2, sortNo: 20, qtyTotal: 200, costAmount: 222.42 }),
      pool({ ruleId: 3, sortNo: 30, method: 'ref', qtyTotal: 999, costAmount: 999 }),
    ], 'p2')
    expect(poolFooter(bands)).toEqual({ qty: 300.5, cost: 333.6 })
  })
  it('未生成月全 null=null', () =>
    expect(poolFooter(groupPoolsByBuilding([pool({})], 'p2'))).toEqual({ qty: null, cost: null }))
})

describe('buildPoolExportAoa 导出平表', () => {
  it('标题+表头+池行(楼栋/楼层方位/全名,sign 负号表名)+合计行', () => {
    const bands = groupPoolsByBuilding([pool({
      floorLabel: '二楼', side: '东侧', autoName: '一车间·二楼东侧·消防',
      qtyTotal: 100, costAmount: 111.42, baseSnap: 7, stdValue: 15.92,
      meters: [
        { meterId: 1, name: '总表', sign: 1, label: '总表', spot: null, subName: null, meterType: null },
        { meterId: 2, name: '广告字分表', sign: -1, label: '广告字分表', spot: null, subName: null, meterType: null },
      ],
    })], 'p2')
    const aoa = buildPoolExportAoa(bands, '2099-02', '二期')
    expect(aoa[0][0]).toBe('公共电核算 2099-02 · 二期')
    expect(aoa[1].slice(12, 16)).toEqual(['摊出', '差额', '实收', '盈亏'])
    expect(aoa[2][0]).toBe('一车间')
    expect(aoa[2][1]).toBe('二楼东侧')
    expect(aoa[2][2]).toBe('一车间·二楼东侧·消防')
    expect(aoa[2][3]).toBe('总表、-广告字分表')
    expect(aoa[2][10]).toBe('7层均摊')
    expect(aoa[2][14]).toBe('')          // 实收待账单模块
    const last = aoa[aoa.length - 1]
    expect(last[0]).toBe('合计')
    expect(last[4]).toBe(100)
    expect(last[9]).toBe(111.42)
  })
})

describe('buildLossReconRows 对账区两行', () => {
  const recon: AllocLossReconDTO = {
    zone: 'p1', supplyQty: 68320, sumC: 68000, sumD: 66500,
    lossVsC: -320, rateVsC: -0.0047, lossVsD: -1820, rateVsD: -0.0266,
  }
  it('两行:vs 总表Σ落 cQty,vs 分表Σ落 dQty', () => {
    const rows = buildLossReconRows(recon)
    expect(rows).toHaveLength(2)
    expect(rows[0].label).toContain('68,320')
    expect(rows[0]).toMatchObject({ cQty: 68000, dQty: null, loss: -320, rate: -0.0047 })
    expect(rows[1]).toMatchObject({ cQty: null, dQty: 66500, loss: -1820, rate: -0.0266 })
  })
  it('无 recon=空', () => expect(buildLossReconRows(null)).toEqual([]))
})

describe('lossFooter 单元合计', () => {
  const unit = (p: Partial<AllocLossUnitDTO>): AllocLossUnitDTO => ({
    headBuildingId: 13, label: 'A座', zone: 'p1', cQty: null, cableQty: null, dQty: null,
    eQty: null, rawRate: null, gQty: null, adjQty: null, adjRate: null,
    variant: 'net', tenantRate: null, note: null, ...p,
  })
  it('null 安全求和', () => {
    expect(lossFooter([
      unit({ cQty: 100.1, dQty: 90, eQty: -10.1 }),
      unit({ cQty: 200, cableQty: 5.5, dQty: 210 }),
    ])).toEqual({ cQty: 300.1, cableQty: 5.5, dQty: 300, eQty: -10.1 })
  })
  it('空集=全 null', () =>
    expect(lossFooter([])).toEqual({ cQty: null, cableQty: null, dQty: null, eQty: null }))
})
