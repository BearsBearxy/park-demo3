import { describe, expect, it } from 'vitest'
import {
  aggregateByTenant, auditTitle, billFeeLabel, billFeeName, billQtyCell, dormPriceCells,
  groupDormExcelStyle, groupExcelStyle, groupRentByPremise, priceScopeLabel, rentAreaText,
  rentByTenant, rentFeeName, resolvePhase, segLabel, tenantKpis,
  type DormLineBase, type NoticeLike, type RentLineBase,
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

describe('billQtyCell 刀D:抽屉逐行「用量×单价=金额」可心算(2026-08-08 人工审核诉求)', () => {
  // 显示价回读成数再验算(去尾随零的纯小数串,Number 可直读);r2 加 1e-6 兜 JS 浮点(99.70×0.15=14.955 边界)
  const r2 = (v: number) => Math.round(v * 100 + (v < 0 ? -1e-6 : 1e-6)) / 100
  type Row = Parameters<typeof billQtyCell>[0] & { amount: number }
  const row = (o: Partial<Row>): Row =>
    ({ feeKey: 'elec', shareSrc: null, qty: null, baseSnap: null, priceSnap: null, amount: 0, ...o })

  it('路灯(share_src=area):乘数=面积 3200㎡ 不是分得的 107.35 度;3200×0.04=128.00', () => {
    const c = billQtyCell(row({
      feeKey: 'share_elec_light', shareSrc: 'area', qty: 107.35, baseSnap: 3200, priceSnap: 0.04, amount: 128,
    }))
    expect(c.qty).toBe(3200)
    expect(c.unit).toBe('㎡')
    expect(c.price).toBe('0.04')
    expect(c.title).toContain('107.35 度')      // 原度数不丢,进悬浮
    expect(r2(c.qty! * Number(c.price))).toBe(128)
  })
  it('绿化水(area):3200×0.009=28.80,价必须显 0.009 不是 0.01;度数悬浮按吨', () => {
    const c = billQtyCell(row({
      feeKey: 'share_green_water', shareSrc: 'area', qty: 8.9, baseSnap: 3200, priceSnap: 0.009, amount: 28.8,
    }))
    expect(c.qty).toBe(3200)
    expect(c.unit).toBe('㎡')
    expect(c.price).toBe('0.009')
    expect(c.title).toContain('8.9 吨')
    expect(r2(c.qty! * Number(c.price))).toBe(28.8)
  })
  it('线路损耗:乘数=金额基数 538.10 元 不是链内 205.6 度;538.10×0.0213=11.46', () => {
    const c = billQtyCell(row({
      feeKey: 'share_elec_loss', qty: 205.6, baseSnap: 538.1, priceSnap: 0.0213, amount: 11.46,
    }))
    expect(c.qty).toBe(538.1)
    expect(c.unit).toBe('元')
    expect(c.price).toBe('0.0213')
    expect(c.title).toContain('205.6 度')
    expect(r2(c.qty! * Number(c.price))).toBe(11.46)
  })
  it('楼层照明 floor 行不受影响:乘数仍是用量 74.20', () => {
    const c = billQtyCell(row({
      feeKey: 'share_elec_floor', shareSrc: 'floor', qty: 74.2, baseSnap: null, priceSnap: 1.114151, amount: 82.67,
    }))
    expect(c.qty).toBe(74.2)
    expect(c.unit).toBe('')
    expect(c.title).toBeNull()
    expect(r2(c.qty! * Number(c.price))).toBe(82.67)
  })
  it('电费行不受影响;单价按需补位(落库 1.20606875,固定 2 位的 1.21 验不通)', () => {
    const c = billQtyCell(row({ feeKey: 'elec', qty: 25.6, priceSnap: 1.20606875, amount: 30.88 }))
    expect(c.qty).toBe(25.6)
    expect(c.unit).toBe('')
    expect(c.price).toBe('1.2061')
    expect(r2(c.qty! * Number(c.price))).toBe(30.88)
  })
  // ── S7 缺口①:面积池兜底(消防/楼层照明/电梯 的 area 行 price_snap 存电价元/度、base_snap 存面积,
  //    等效元/㎡ 率没有任何一列存)——率恒等于 amount÷base_snap,与源册『公共电分摊明细』AC 列逐格相同 ──
  it('楼层照明 area(2024-02 真实行 7.18度/1.114255/446.4㎡/8.93):派生率 0.02,乘数=面积', () => {
    const c = billQtyCell(row({
      feeKey: 'share_elec_floor', shareSrc: 'area', qty: 7.18, baseSnap: 446.4, priceSnap: 1.114255, amount: 8.93,
    }))
    expect(c.qty).toBe(446.4)
    expect(c.unit).toBe('㎡')
    expect(c.price).toBe('0.02')
    expect(c.title).toContain('金额÷面积')
    expect(c.title).toContain('1.114255')       // 落库表价留住,不假装它是本行乘数的配套价
    expect(c.title).toContain('7.18 度')
    expect(r2(c.qty! * Number(c.price))).toBe(8.93)
  })
  it('消防 area(11.6度/0.897222/714.3㎡/10.71):派生率 0.015——2 位的 0.01 验不通,须补到 3 位', () => {
    const c = billQtyCell(row({
      feeKey: 'share_elec_fire', shareSrc: 'area', qty: 11.6, baseSnap: 714.3, priceSnap: 0.897222, amount: 10.71,
    }))
    expect(c.qty).toBe(714.3)
    expect(c.price).toBe('0.015')
    expect(r2(c.qty! * Number(c.price))).toBe(10.71)
  })
  it('电梯 area(32.44度/1.114162/446.4㎡/35.71):派生率 0.08', () => {
    const c = billQtyCell(row({
      feeKey: 'share_elec_elevator', shareSrc: 'area', qty: 32.44, baseSnap: 446.4, priceSnap: 1.114162, amount: 35.71,
    }))
    expect(c.qty).toBe(446.4)
    expect(c.price).toBe('0.08')
    expect(r2(c.qty! * Number(c.price))).toBe(35.71)
  })
  it('消防 0 元行(0.02度/0.897222/714.3㎡/0.00):派生率 0,仍验得平', () => {
    const c = billQtyCell(row({
      feeKey: 'share_elec_fire', shareSrc: 'area', qty: 0.02, baseSnap: 714.3, priceSnap: 0.897222, amount: 0,
    }))
    expect(c.qty).toBe(714.3)
    expect(c.price).toBe('0')
    expect(r2(c.qty! * Number(c.price))).toBe(0)
  })
  // ── S7 缺口②:判据必须是「四舍五入到分」后的整数分,闭区间容差 |x−y|<=0.005 与 HALF_UP 不等价 ──
  it('判据反例 A(2024-02 真实行 0.50度×1.20606875=0.60):不许显 1.21(0.605→HALF_UP 0.61≠0.60)', () => {
    const c = billQtyCell(row({ feeKey: 'elec', qty: 0.5, priceSnap: 1.20606875, amount: 0.6 }))
    expect(c.price).not.toBe('1.21')
    expect(r2(c.qty! * Number(c.price))).toBe(0.6)
  })
  it('判据反例 B(15.00度×0.72076875=10.81):不许显 0.721(10.815→10.82≠10.81)', () => {
    const c = billQtyCell(row({ feeKey: 'elec', qty: 15, priceSnap: 0.72076875, amount: 10.81 }))
    expect(c.price).not.toBe('0.721')
    expect(r2(c.qty! * Number(c.price))).toBe(10.81)
  })
  it('缺价/缺量行不炸', () => {
    expect(billQtyCell(row({ feeKey: 'share_elec_floor', shareSrc: 'area', baseSnap: 136.86 })))
      .toEqual({ qty: null, unit: '', title: null, price: '–' })
    expect(billQtyCell(row({ feeKey: 'elec', qty: 0, priceSnap: 1.20606875, amount: 0 })).price).toBe('1.21')
  })
  it('护栏(主表):2024-02 真实混合行,每行 round(乘数×显示价,2)===金额', () => {
    const rows = [
      // S7 缺口①:三类面积池行(价存元/度、基数存面积)
      row({ feeKey: 'share_elec_fire', shareSrc: 'area', qty: 11.6, baseSnap: 714.3, priceSnap: 0.897222, amount: 10.71 }),
      row({ feeKey: 'share_elec_fire', shareSrc: 'area', qty: 50.32, baseSnap: 3100, priceSnap: 0.895115, amount: 46.5 }),
      row({ feeKey: 'share_elec_floor', shareSrc: 'area', qty: 8.04, baseSnap: 499.25, priceSnap: 1.114255, amount: 9.99 }),
      row({ feeKey: 'share_elec_floor', shareSrc: 'area', qty: 8, baseSnap: 249.8, priceSnap: 1.114097, amount: 9.99 }),
      row({ feeKey: 'share_elec_elevator', shareSrc: 'area', qty: 36.29, baseSnap: 499.25, priceSnap: 1.114162, amount: 39.94 }),
      row({ feeKey: 'share_elec_elevator', shareSrc: 'area', qty: 144.34, baseSnap: 1986, priceSnap: 1.114162, amount: 158.88 }),
      // S7 缺口②:判据反例两条
      row({ feeKey: 'elec', qty: 0.5, priceSnap: 1.20606875, amount: 0.6 }),
      row({ feeKey: 'elec', qty: 15, priceSnap: 0.72076875, amount: 10.81 }),
      // 宿舍子表 extras(路灯/绿化水配不上间,平铺后同样逐行可验:池末行取余,派生率补位吸收)
      row({ feeKey: 'share_elec_light', shareSrc: 'area', qty: 2.5, baseSnap: 45.08, priceSnap: 0.06, amount: 2.71 }),
      row({ feeKey: 'share_green_water', shareSrc: 'area', qty: 28.24, baseSnap: 5214.64, priceSnap: 0.02, amount: 104.3 }),
      row({ feeKey: 'elec', qty: 25.6, priceSnap: 1.20606875, amount: 30.88 }),
      row({ feeKey: 'elec', qty: 11486.4, priceSnap: 0.63586875, amount: 7303.84 }),   // 大额行须补到 8 位才验得通
      row({ feeKey: 'mgmt_fee', qty: 99.7, priceSnap: 0.15, amount: 14.96 }),     // HALF_UP 边界 14.955
      row({ feeKey: 'capacity', qty: 312.5, priceSnap: 23, amount: 7187.5 }),
      row({ feeKey: 'water', qty: 273, priceSnap: 3.95, amount: 1078.35 }),
      row({ feeKey: 'water_pipe', qty: 273, priceSnap: 0.5, amount: 136.5 }),
      row({ feeKey: 'share_elec_light', shareSrc: 'area', qty: 3.73, baseSnap: 714.3, priceSnap: 0.005, amount: 3.57 }),
      row({ feeKey: 'share_green_water', shareSrc: 'area', qty: 0.5, baseSnap: 714.3, priceSnap: 0.01, amount: 7.14 }),
      row({ feeKey: 'share_elec_loss', qty: 2323.6, baseSnap: 1867.89, priceSnap: 0.0271, amount: 50.62 }),
      row({ feeKey: 'share_elec_elevator', shareSrc: 'floor', qty: 39.3, baseSnap: 0.27, priceSnap: 0.980395, amount: 38.53 }),
    ]
    for (const l of rows) {
      const c = billQtyCell(l)
      expect([l.feeKey, r2(c.qty! * Number(c.price))]).toEqual([l.feeKey, l.amount])
    }
  })
})

// ── S7 缺口③:宿舍逐间子表两价压 2 位后 192 间行 177 条算不出金额;
//    且间行金额=两段各自四舍五入到分后相加,不是 用量×(价+管理费)——19/192 间行差 1 分 ──
describe('dormPriceCells 宿舍子表逐段可验算(2024-02 真实间行)', () => {
  const r2 = (v: number) => Math.round(v * 100 + (v < 0 ? -1e-6 : 1e-6)) / 100
  type Room = [qty: number, p: number, pAmt: number, m: number | null, mAmt: number]
  const cells = ([qty, p, pAmt, m, mAmt]: Room) =>
    dormPriceCells({ qty, priceSnap: p, amount: pAmt }, m == null ? null : { priceSnap: m, amount: mAmt })
  // 逐段验:用量×基准电价=电费段、用量×管理费=管理费段,两段相加=金额列
  const chk = (r: Room) => {
    const c = cells(r)
    const [qty, , pAmt, m, mAmt] = r
    expect(r2(qty * Number(c.price))).toBe(pAmt)
    if (m != null) expect(r2(qty * Number(c.mgmt))).toBe(mAmt)
    return c
  }
  it('二期10号楼301单元 128.30度 × 0.63586875 = 81.58:2 位的 0.64 验不通,补到 5 位', () => {
    const c = chk([128.3, 0.63586875, 81.58, 0.15, 19.25])
    expect([c.price, c.mgmt]).toEqual(['0.63587', '0.15'])
  })
  it('二期8号楼502单元 78.00度:电 49.60 + 管理费 12.48 = 62.08', () => {
    expect(chk([78, 0.63586875, 49.6, 0.16, 12.48]).price).toBe('0.6359')
  })
  it('302单元 99.70度 管理费段 HALF_UP 边界 14.955→14.96', () => {
    const c = chk([99.7, 0.63586875, 63.4, 0.15, 14.96])
    expect(c.mgmt).toBe('0.15')
  })
  it('宿舍一栋311室 240.40度:合并单价心算差 1 分(152.86+38.46=191.32,240.4×0.79586875→191.33),逐段仍验得平', () => {
    const c = chk([240.4, 0.63586875, 152.86, 0.16, 38.46])
    expect(r2(240.4 * (Number(c.price) + Number(c.mgmt)))).toBe(191.33)   // 合并口径的 1 分差:表头据此改口径
    expect(r2(152.86 + 38.46)).toBe(191.32)
  })
  it('水表间行(mgmt=null 退化成 用量×单价):8.00吨 × 3.85 = 30.80', () => {
    const c = chk([8, 3.85, 30.8, null, 0])
    expect([c.price, c.mgmt]).toEqual(['3.85', '–'])
  })
  it('0 用量/缺价行不炸', () => {
    expect(dormPriceCells({ qty: 0, priceSnap: 3.85, amount: 0 }, null)).toEqual({ price: '3.85', mgmt: '–' })
    expect(dormPriceCells({ qty: null, priceSnap: null, amount: 0 }, null)).toEqual({ price: '–', mgmt: '–' })
  })
  it('护栏(宿舍子表):2024-02 真实间行,每段 round(用量×显示价,2)===该段金额', () => {
    const rooms: Room[] = [
      [78, 0.63586875, 49.6, 0.16, 12.48], [128.3, 0.63586875, 81.58, 0.15, 19.25],
      [263.6, 0.63586875, 167.62, 0.15, 39.54], [99.7, 0.63586875, 63.4, 0.15, 14.96],
      [240.4, 0.63586875, 152.86, 0.16, 38.46], [160.4, 0.63586875, 101.99, 0.16, 25.66],
      [2, 3.85, 7.7, null, 0], [8, 3.85, 30.8, null, 0], [0, 3.85, 0, null, 0],
    ]
    for (const r of rooms) chk(r)
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
