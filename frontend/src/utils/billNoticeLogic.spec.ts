import { describe, expect, it } from 'vitest'
import {
  NOTICE_KIND_LABEL, NOTICE_STATUS_LABEL, auditTitle, billFeeLabel,
  groupLinesByPremise, noticeKindLabel, noticeKpis, priceScopeLabel, segLabel,
} from './billNoticeLogic'

describe('noticeKindLabel 单据类字典', () => {
  it('五类逐字(entity BillNotice.noticeKind 词汇)', () => {
    expect(NOTICE_KIND_LABEL).toEqual({
      combined: '合一单', fee: '水电费单', maint: '维护费单', dorm: '宿舍单', offbook: '账外单',
    })
  })
  it('未知 kind 原样回落(后端加词汇不炸屏)', () => expect(noticeKindLabel('rent')).toBe('rent'))
})

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

describe('NOTICE_STATUS_LABEL 状态字典', () => {
  it('draft/issued/void', () => {
    expect(NOTICE_STATUS_LABEL.draft).toBe('草稿')
    expect(NOTICE_STATUS_LABEL.issued).toBe('已签发')
    expect(NOTICE_STATUS_LABEL.void).toBe('已作废')
  })
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

describe('noticeKpis 列表 KPI', () => {
  const n = (lineCount: number, totalAmount: number, warn: string | null) => ({ lineCount, totalAmount, warn })
  it('单数/行数/总额/警告单数', () => {
    expect(noticeKpis([n(3, 100.5, null), n(2, 0.25, '缺价'), n(1, -10, '合计为负')]))
      .toEqual({ count: 3, lineCount: 6, total: 90.75, warned: 2 })
  })
  it('空月=全 0', () => expect(noticeKpis([])).toEqual({ count: 0, lineCount: 0, total: 0, warned: 0 }))
})
