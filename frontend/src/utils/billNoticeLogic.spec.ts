import { describe, expect, it } from 'vitest'
import {
  aggregateByTenant, auditTitle, billFeeLabel, billFeeName, groupDormExcelStyle, groupExcelStyle,
  groupRentByPremise, priceScopeLabel, rentAreaText, rentByTenant, rentFeeName, resolvePhase,
  segLabel, tenantKpis, type DormLineBase, type NoticeLike, type RentLineBase,
} from './billNoticeLogic'

describe('billFeeLabel 费项字典(spec §4:沿用 alloc_result 现值,不造第三套)', () => {
  it('直连计费键', () => {
    expect(billFeeLabel('elec')).toBe('电费')
    expect(billFeeLabel('mgmt_fee')).toBe('电力管理费')
    expect(billFeeLabel('capacity')).toBe('装机容量费')
    expect(billFeeLabel('water')).toBe('水费')
    expect(billFeeLabel('water_pipe')).toBe('水管网维护费')
  })
  it('公摊键复用 ALLOC_FEE_LABEL', () => {
    expect(billFeeLabel('share_elec_floor')).toBe('楼层照明')
    expect(billFeeLabel('share_elec_elevator')).toBe('电梯用电')
    expect(billFeeLabel('share_green_water')).toBe('绿化水公摊')
  })
  it('损耗按单据词汇显「线路损耗」(BILL-DERIVE §1.1,覆盖 alloc 的「损耗费」)', () =>
    expect(billFeeLabel('share_elec_loss')).toBe('线路损耗'))
  it('未知键原样回落', () => expect(billFeeLabel('nope')).toBe('nope'))
})

describe('segLabel 分时段', () => {
  it('尖峰平谷', () => {
    expect(segLabel('sharp')).toBe('尖')
    expect(segLabel('peak')).toBe('峰')
    expect(segLabel('flat')).toBe('平')
    expect(segLabel('valley')).toBe('谷')
  })
  it('非分时行 null=空串', () => expect(segLabel(null)).toBe(''))
  it('未知段原样', () => expect(segLabel('mid')).toBe('mid'))
})

describe('groupExcelStyle Excel 版式(非宿舍:电/水两部逐场地费块+维护费块,可莱恩 2024-02 范式)', () => {
  const l = (feeKey: string, premise: string | null, amount: number) => ({ feeKey, premise, amount })
  // 可莱恩非宿舍单缩样:A602(单一段)+B201(分时四段+容量)+现状 premise=null 的公摊行
  const lines = [
    l('water', 'A座602室', 181.7), l('water_pipe', 'A座602室', 23),
    l('elec', 'A座602室', 425.36), l('mgmt_fee', 'A座602室', 171.39),
    l('water', 'B座201室', 422.65), l('water_pipe', 'B座201室', 53.5),
    l('elec', 'B座201室', 1056.52), l('elec', 'B座201室', 1122.61),
    l('elec', 'B座201室', 1106.24), l('elec', 'B座201室', 29.58),
    l('mgmt_fee', 'B座201室', 550.91), l('capacity', 'B座201室', 7187.5),
    l('share_elec_light', null, 169.12), l('share_elec_elevator', null, 302.5),
    l('share_elec_floor', null, 10.03), l('share_elec_loss', null, 26.88), l('share_elec_loss', null, 77.05),
  ]
  const g = groupExcelStyle(lines)
  it('电部场地按首现序;容量行归电费块(挂 B201,不落维护费)', () => {
    expect(g.elec.groups.map(x => x.label)).toEqual(['A座602室', 'B座201室', '园区/未分场地'])
    const b201 = g.elec.groups[1]
    expect(b201.fee.map(x => x.feeKey)).toEqual(['elec', 'elec', 'elec', 'elec', 'capacity'])
    expect(b201.feeTotal).toBe(10502.45)   // 3314.95 电 + 7187.50 容量
    expect(b201.maintTotal).toBe(550.91)
  })
  it('维护费块归置:管理费/楼层/电梯/损耗/路灯;premise=null 落「园区/未分场地」兜底带', () => {
    expect(g.elec.groups[0].maint.map(x => x.feeKey)).toEqual(['mgmt_fee'])
    const park = g.elec.groups[2]
    expect(park.premise).toBeNull()
    expect(park.fee).toEqual([])
    expect(park.maintTotal).toBe(585.58)   // 169.12+302.5+10.03+26.88+77.05
  })
  it('水部:水表行/管网维护费分块,场地小计=费+维护', () => {
    expect(g.water.groups.map(x => x.label)).toEqual(['A座602室', 'B座201室'])
    expect(g.water.groups[0].subtotal).toBe(204.7)
    expect(g.water.groups[1].subtotal).toBe(476.15)
  })
  it('两部合计与总合计=Σ全行', () => {
    expect(g.elec.total).toBe(12235.69)
    expect(g.water.total).toBe(680.85)
    expect(g.total).toBe(12916.54)
  })
  it('未知费项落 other 兜底不丢行,计入总合计', () => {
    const g2 = groupExcelStyle([l('elec', 'A', 0.1), l('nope', null, 0.2)])
    expect(g2.other.map(x => x.feeKey)).toEqual(['nope'])
    expect(g2.otherTotal).toBe(0.2)
    expect(g2.total).toBe(0.3)   // 浮点无噪音
  })
  it('空行集=空结构', () => {
    const g0 = groupExcelStyle([])
    expect(g0.elec.groups).toEqual([])
    expect(g0.water.groups).toEqual([])
    expect(g0.total).toBe(0)
  })
})

describe('groupDormExcelStyle 宿舍逐间子表(可莱恩宿舍段范式)', () => {
  const l = (feeKey: string, premise: string | null, amount: number, over: Partial<DormLineBase> = {}): DormLineBase =>
    ({ feeKey, premise, amount, meterId: null, meterLabel: null, baseSnap: null, ...over })
  // S6:表行 premise 与公摊行 premise 同源=计费行 location 原文,配对键按此形态
  it('电:电表行建间,管理费同表挂靠(金额=电+管理费),路灯同房号唯一配对且面积取 baseSnap', () => {
    const d = groupDormExcelStyle([
      l('elec', 'A座孵化器四楼430室', 117.64, { meterId: 757 }),
      l('mgmt_fee', 'A座孵化器四楼430室', 29.6, { meterId: 757 }),
      l('share_elec_light', 'A座孵化器四楼430室', 2.86, { baseSnap: 47.66 }),
      l('elec', 'A座孵化器四楼431室', 47.88, { meterId: 758 }),
      l('mgmt_fee', 'A座孵化器四楼431室', 12.05, { meterId: 758 }),
    ])
    expect(d.elec.rooms).toHaveLength(2)
    expect(d.elec.rooms[0].room).toBe('A座孵化器四楼430室')
    expect(d.elec.rooms[0].amount).toBe(147.24)
    expect(d.elec.rooms[0].area).toBe(47.66)
    expect(d.elec.rooms[0].share?.amount).toBe(2.86)
    expect(d.elec.rooms[1].share).toBeNull()
    expect(d.elec.extras).toEqual([])
    expect(d.elec.total).toBe(210.03)   // 147.24+2.86+59.93
  })
  it('水:水表行建间,绿化水同房号配对;宿舍总合计=电+水', () => {
    const d = groupDormExcelStyle([
      l('elec', 'A座孵化器四楼430室', 100, { meterId: 1 }),
      l('water', 'A座孵化器四楼430室', 50.05, { meterId: 1057 }),
      l('share_green_water', 'A座孵化器四楼430室', 0.95, { baseSnap: 47.66 }),
    ])
    expect(d.water.rooms).toHaveLength(1)
    expect(d.water.rooms[0].share?.amount).toBe(0.95)
    expect(d.water.rooms[0].area).toBe(47.66)
    expect(d.water.total).toBe(51)
    expect(d.total).toBe(151)
  })
  it('回退路径:表行定位不唯一回退长串,公摊行按单间原文→配不上落 extras;损耗行恒 extras;不丢行', () => {
    const seg = '宿舍楼四座430、431室'   // premiseOf 回退串(S6 §2.2),与公摊行单间原文不同源
    const d = groupDormExcelStyle([
      l('elec', seg, 117.64, { meterId: 757 }),
      l('elec', seg, 47.88, { meterId: 758 }),
      l('share_elec_light', '宿舍楼四座430室', 15.45, { baseSnap: 257.54 }),
      l('share_elec_loss', null, 3.23),
      l('share_green_water', null, 5.15),   // premise 空→extras
    ])
    expect(d.elec.rooms).toHaveLength(2)
    expect(d.elec.rooms.every(r => r.share === null && r.area === null)).toBe(true)
    expect(d.elec.extras.map(x => x.feeKey)).toEqual(['share_elec_light', 'share_elec_loss'])
    expect(d.water.extras.map(x => x.feeKey)).toEqual(['share_green_water'])
    expect(d.total).toBe(189.35)   // Σ全行
  })
  it('同 premise 两间时路灯配不唯一→extras(不硬挂错间)', () => {
    const d = groupDormExcelStyle([
      l('elec', '430室', 10, { meterId: 1 }),
      l('elec', '430室', 20, { meterId: 2 }),
      l('share_elec_light', '430室', 2.86, { baseSnap: 47.66 }),
    ])
    expect(d.elec.extras.map(x => x.feeKey)).toEqual(['share_elec_light'])
  })
  it('分时宿舍一表多段=一段一行,管理费挂该表首行', () => {
    const d = groupDormExcelStyle([
      l('elec', '501室', 10, { meterId: 9 }),
      l('elec', '501室', 5, { meterId: 9 }),
      l('mgmt_fee', '501室', 2.4, { meterId: 9 }),
    ])
    expect(d.elec.rooms).toHaveLength(2)
    expect(d.elec.rooms[0].amount).toBe(12.4)
    expect(d.elec.rooms[1].amount).toBe(5)
  })
  it('S6:分时一间=一表四段四行同 premise→路灯按表唯一挂该表首行,只挂一次', () => {
    const d = groupDormExcelStyle([
      l('elec', '一期宿舍一栋501室', 10, { meterId: 9 }),
      l('elec', '一期宿舍一栋501室', 5, { meterId: 9 }),
      l('elec', '一期宿舍一栋501室', 3, { meterId: 9 }),
      l('elec', '一期宿舍一栋501室', 2, { meterId: 9 }),
      l('share_elec_light', '一期宿舍一栋501室', 2.86, { baseSnap: 47.66 }),
    ])
    expect(d.elec.rooms).toHaveLength(4)
    expect(d.elec.rooms[0].share?.amount).toBe(2.86)
    expect(d.elec.rooms[0].area).toBe(47.66)
    expect(d.elec.rooms.slice(1).every(r => r.share === null)).toBe(true)
    expect(d.elec.extras).toEqual([])
    expect(d.elec.total).toBe(22.86)
  })
  it('未知键落水子表尾兜底;空行集=空结构', () => {
    const d = groupDormExcelStyle([l('nope', null, 1.5)])
    expect(d.water.extras.map(x => x.feeKey)).toEqual(['nope'])
    expect(d.total).toBe(1.5)
    expect(groupDormExcelStyle([]).total).toBe(0)
  })
})

describe('billFeeName 行名带池名(S5 §3.2:「费项·池名」)', () => {
  it('poolName 非空=费项·池名(同名公摊行分得清)', () =>
    expect(billFeeName({ feeKey: 'share_elec_floor', poolName: 'B座楼梯间消防照明' }))
      .toBe('楼层照明·B座楼梯间消防照明'))
  it('无池名=纯费项;undefined 同 null', () => {
    expect(billFeeName({ feeKey: 'elec', poolName: null })).toBe('电费')
    expect(billFeeName({ feeKey: 'water' })).toBe('水费')
  })
})

describe('groupRentByPremise 租金板块分块(S5 刀4:可莱恩缩样,一场地一块/宿舍逐间块)', () => {
  const l = (feeKey: string, premise: string | null, amount: number): RentLineBase => ({ feeKey, premise, amount })
  // 可莱恩缩样:A602 办公室段 2 行 + 宿舍 430室 逐间 4 行(dorm 钉死费项)
  const lines = [
    l('rent_office', 'A座602室', 24448), l('mgmt', 'A座602室', 3056),
    l('rent_dorm', '430室', 800.1), l('infra', '430室', 74.52),
    l('access', '430室', 8.33), l('network', '430室', 50),
  ]
  const g = groupRentByPremise(lines)
  it('按 premise 分块,块序=首现序;块类型=rent_* 行反推', () => {
    expect(g.groups.map(x => x.label)).toEqual(['A座602室', '430室'])
    expect(g.groups.map(x => x.type)).toEqual(['office', 'dorm'])
  })
  it('块内行序=入参序,块小计/全户合计浮点无噪音', () => {
    expect(g.groups[0].lines.map(x => x.feeKey)).toEqual(['rent_office', 'mgmt'])
    expect(g.groups[0].subtotal).toBe(27504)
    expect(g.groups[1].lines).toHaveLength(4)
    expect(g.groups[1].subtotal).toBe(932.95)
    expect(g.total).toBe(28436.95)
    expect(groupRentByPremise([l('rent_factory', 'X', 0.1), l('mgmt', 'X', 0.2)]).total).toBe(0.3)
  })
  it('premise=null 落「未标场地」兜底带;无 rent_* 行块 type=null', () => {
    const g2 = groupRentByPremise([l('mgmt', null, 10)])
    expect(g2.groups[0].label).toBe('未标场地')
    expect(g2.groups[0].type).toBeNull()
  })
  it('空行集=空结构', () => expect(groupRentByPremise([])).toEqual({ groups: [], total: 0 }))
})

describe('rentFeeName 租金行费项名(mgmt/infra 带段类型前缀)', () => {
  it('mgmt/infra 前缀随块类型', () => {
    expect(rentFeeName('mgmt', 'office')).toBe('办公室企业管理服务费')
    expect(rentFeeName('infra', 'dorm')).toBe('宿舍基础设施维护费')
  })
  it('类型未知=不带前缀;rent_* 自带类型', () => {
    expect(rentFeeName('mgmt', null)).toBe('企业管理服务费')
    expect(rentFeeName('rent_factory', null)).toBe('厂房租金')
  })
  it('未知键原样回落(引擎加费项不炸)', () => expect(rentFeeName('nope', null)).toBe('nope'))
})

describe('rentAreaText 面积拆解(S5 §2:qty=计租面积,baseSnap=建筑+公摊分摊基数快照)', () => {
  it('baseSnap>qty 显「建筑+公摊」拆解(可莱恩 A602 锚点)', () => {
    expect(rentAreaText(1528, 1986)).toBe('1528+458')
    expect(rentAreaText(2700, 4050)).toBe('2700+1350')
  })
  it('无基数/基数≤面积=单数(area 已含公摊的多数户)', () => {
    expect(rentAreaText(1528, null)).toBe('1528')
    expect(rentAreaText(74.52, 74.52)).toBe('74.52')
  })
  it('qty 空=null;小数差浮点无噪音', () => {
    expect(rentAreaText(null, 1986)).toBeNull()
    expect(rentAreaText(100.5, 150.75)).toBe('100.5+50.25')
  })
})

describe('auditTitle 取价审计链悬浮', () => {
  it('四段齐全=四行', () =>
    expect(auditTitle({ priceKey: 'elec_peak', priceScope: 'p2', priceMonth: '2024-02', ruleBranch: 'tou' }))
      .toBe('取价键 elec_peak\n作用域 p2\n价目月 2024-02\n判定分支 分时四段'))
  it('scope 空串=全园默认;tenant:=户级例外;月空串=初始版本', () => {
    expect(priceScopeLabel('')).toBe('全园默认')
    expect(priceScopeLabel('tenant:82')).toBe('户级例外(tenant:82)')
    expect(auditTitle({ priceKey: 'water', priceScope: '', priceMonth: '', ruleBranch: 'commercial' }))
      .toBe('取价键 water\n作用域 全园默认\n价目月 初始版本(自始生效)\n判定分支 商业价')
  })
  it('未知分支原样显(后端加分支不炸)', () =>
    expect(auditTitle({ priceKey: null, priceScope: null, priceMonth: null, ruleBranch: 'x' }))
      .toBe('判定分支 x'))
  it('全空=null(公摊池行可能无取价链,不出空 title)', () =>
    expect(auditTitle({ priceKey: null, priceScope: null, priceMonth: null, ruleBranch: null })).toBeNull())
})

describe('aggregateByTenant 租户聚合(v2 拍板1:一个租户一条)', () => {
  const n = (id: number, tenantId: number, over: Partial<NoticeLike> = {}): NoticeLike => ({
    id, tenantId, tenantName: `户${tenantId}`, noticeKind: 'combined', premiseText: null,
    totalAmount: 0, prevDue: 0, lineCount: 0, warn: null, ...over,
  })
  it('同户多单合并(含宿舍单):行数/合计/上期欠费=Σ,noticeIds 保单据序,户序按首现', () => {
    const rs = aggregateByTenant([
      n(11, 1, { lineCount: 3, totalAmount: 100.1, prevDue: 1 }),
      n(12, 2, { lineCount: 1, totalAmount: 50 }),
      n(13, 1, { lineCount: 2, totalAmount: 0.2, prevDue: 0.5, noticeKind: 'dorm' }),
    ])
    expect(rs.map(r => r.tenantId)).toEqual([1, 2])
    expect(rs[0].noticeIds).toEqual([11, 13])
    expect(rs[0].lineCount).toBe(5)
    expect(rs[0].totalAmount).toBe(100.3)
    expect(rs[0].prevDue).toBe(1.5)
  })
  it('场地按逗号拆项去重合并;warn 按分号拆项去重、换行连接', () => {
    const rs = aggregateByTenant([
      n(1, 1, { premiseText: 'A座602室,B座201室', warn: '缺价;表未归属' }),
      n(2, 1, { premiseText: 'A座602室', warn: '缺价' }),
    ])
    expect(rs[0].premiseText).toBe('A座602室,B座201室')
    expect(rs[0].warn).toBe('缺价\n表未归属')
  })
  it('offbook=该户单据全为账外(户级标,混合不降淡)', () => {
    expect(aggregateByTenant([n(1, 1, { noticeKind: 'offbook' })])[0].offbook).toBe(true)
    expect(aggregateByTenant([n(1, 1, { noticeKind: 'offbook' }), n(2, 1)])[0].offbook).toBe(false)
  })
  it('浮点合计无噪音(0.1+0.2=0.3)', () =>
    expect(aggregateByTenant([n(1, 1, { totalAmount: 0.1 }), n(2, 1, { totalAmount: 0.2 })])[0].totalAmount).toBe(0.3))
  it('空月=空', () => expect(aggregateByTenant([])).toEqual([]))
})

describe('resolvePhase 期归属(v2 拍板4)', () => {
  it('真期直取', () => expect(resolvePhase([{ phase: 2, name: 'B座' }], null)).toBe(2))
  it('phase=4 归一期', () => expect(resolvePhase([{ phase: 4, name: 'X栋' }], null)).toBe(1))
  it('楼栋名含宿舍/散租/保障房/饭堂归一期(即便挂真期号)', () => {
    expect(resolvePhase([{ phase: 2, name: '二期宿舍' }], null)).toBe(1)
    expect(resolvePhase([{ phase: 3, name: '饭堂' }], null)).toBe(1)
  })
  it('多真期取首个非宿舍期(合同序)', () =>
    expect(resolvePhase([{ phase: 4, name: '宿舍楼' }, { phase: 3, name: 'C座' }, { phase: 2, name: 'B座' }], null)).toBe(3))
  it('无楼栋回退 premise 前缀「一期/二期/三期」', () => {
    expect(resolvePhase([], '二期B座201室')).toBe(2)
    expect(resolvePhase([], '三期C座')).toBe(3)
    expect(resolvePhase([], '一期A座')).toBe(1)
  })
  it('兜底一期', () => {
    expect(resolvePhase([], null)).toBe(1)
    expect(resolvePhase([], 'A座602室')).toBe(1)
  })
})

describe('rentByTenant 月租金(参考)合计', () => {
  it('按户求和,浮点无噪音', () => {
    const m = rentByTenant([
      { tenantId: 1, monthlyRent: 1000.1 }, { tenantId: 1, monthlyRent: 0.2 }, { tenantId: 2, monthlyRent: 500 },
    ])
    expect(m.get(1)).toBe(1000.3)
    expect(m.get(2)).toBe(500)
    expect(m.get(3)).toBeUndefined()
  })
})

describe('tenantKpis KPI(v2:户数/水电总额/月租金合计(参考)/警告户数)', () => {
  const r = (totalAmount: number, rent: number | null, warn: string | null) => ({ totalAmount, rent, warn })
  it('四格;无在租合同户 rent=null 记 0', () =>
    expect(tenantKpis([r(100.5, 2000, null), r(0.25, null, '缺价'), r(-10, 1.05, '负数')]))
      .toEqual({ count: 3, total: 90.75, rent: 2001.05, warned: 2 }))
  it('空期=全 0', () => expect(tenantKpis([])).toEqual({ count: 0, total: 0, rent: 0, warned: 0 }))
})
