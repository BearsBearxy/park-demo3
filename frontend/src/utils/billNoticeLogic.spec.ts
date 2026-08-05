import { describe, expect, it } from 'vitest'
import {
  aggregateByTenant, auditTitle, billFeeLabel, groupLinesByPremise,
  priceScopeLabel, rentByTenant, resolvePhase, segLabel, tenantKpis,
  type NoticeLike,
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

describe('groupLinesByPremise 场地分段小计(§1.1)', () => {
  const l = (premise: string | null, amount: number) => ({ premise, amount })
  it('按首现序分组,组内保行序,小计=Σ金额', () => {
    const gs = groupLinesByPremise([
      l('A座602室', 100), l('A座602室', 16), l('B座201室', 50), l('A座602室', 4),
    ])
    // 后端行序=场地段连续,乱序入参也按首现归组(A 段第三行仍归 A 组)
    expect(gs.map(g => g.premise)).toEqual(['A座602室', 'B座201室'])
    expect(gs[0].lines).toHaveLength(3)
    expect(gs[0].subtotal).toBe(120)
    expect(gs[1].subtotal).toBe(50)
  })
  it('无场地行归「未标场地」组(premise=null)', () => {
    const gs = groupLinesByPremise([l(null, 22.6), l('A座', 1)])
    expect(gs[0].premise).toBeNull()
    expect(gs[0].label).toBe('未标场地')
  })
  it('小计不带浮点噪音(0.1+0.2=0.3)', () =>
    expect(groupLinesByPremise([l('A', 0.1), l('A', 0.2)])[0].subtotal).toBe(0.3))
  it('空行集=空组', () => expect(groupLinesByPremise([])).toEqual([]))
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
