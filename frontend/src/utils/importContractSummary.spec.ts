// 汇总册解析器锚点断言(同构合成夹具 + 真实文件回归)。锁:
//   金纳(厂房 5 项 / 期 2023-07-14~2026-07-13 / 原文去空白)、
//   银纳(厂房 4 + 宿舍 4 两段,门禁 108.33、网络 650,期 2022-12-26~2025-12-25)、
//   翔海(多厂房段 + 空地段,期 2017-08-14~2027-08-13 multiple,阶梯价 AH 非空)、
//   别名归一(维保费/「土地使用税、房产税」)、空收费项目行级跳过、同名跨期不合并、relative 户期限空标待补、
//   类型钉死集越界(办公室基础设施维护费)去段类型不丢行、明细↔汇总 AB 对账。
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import * as XLSX from 'xlsx'
import { parseContractWorkbook, contractReportCsv, mapFeeItem, parseTerms, splitMultiTerm, type ContractFullRow } from './importContractSummary'

const D_HEAD = ['期', '租户(工作表)', '企业全称', '物业名称/位置', '收费项目', '面积(㎡)', '单价(元/㎡)', '月单价(标准,元)', '本月应收金额(元)', '备注', '租赁期限起', '租赁期限止']
const S_HEAD = ['期', '租户(工作表)', '企业全称', '物业名称/位置', '总面积(㎡)', '月费用合计(标准,元)', '租赁期限起', '租赁期限止', '期限类型', '期限原文', '分年阶梯价', '合同期备注']

const d = (phase: string, short: string, full: string, loc: string, item: string,
  area = '', unit = '', monthly = '', actual = '', note = '') =>
  [phase, short, full, loc, item, area, unit, monthly, actual, note, '', '']
const s = (phase: string, short: string, full: string, loc: string, total: string,
  start: string, end: string, type: string, text: string, tier = '', remark = '') =>
  [phase, short, full, loc, '', total, start, end, type, text, tier, remark]

const DETAIL: string[][] = [D_HEAD,
  // 金纳:厂房 5 项(租金带单价 → per_sqm_month;管理/基础设施无单价 → per_month 直填月额)
  d('一期', '金纳', '佛山市金纳新材料有限公司', '一期D座三楼整层', '厂房租金', '3200', '9.6784', '30971', '30971'),
  d('一期', '金纳', '佛山市金纳新材料有限公司', '一期D座三楼整层', '厂房企业管理服务费', '3200', '', '17440', '17440'),
  d('一期', '金纳', '佛山市金纳新材料有限公司', '一期D座三楼整层', '厂房基础设施维护费', '3200', '', '6112', '6112'),
  d('一期', '金纳', '佛山市金纳新材料有限公司', '一期D座三楼整层', '变压器维护费', '', '', '159', '159'),
  d('一期', '金纳', '佛山市金纳新材料有限公司', '一期D座三楼整层', '电梯维护费', '', '', '318', '318'),
  // 银纳:厂房段 4 + 宿舍段 4(门禁/网络钉死 dorm)
  d('一期', '银纳', '广东银纳科技有限公司', '一期E座首层103室', '厂房租金', '256.52', '22.5651', '5788.4', '5788.4'),
  d('一期', '银纳', '广东银纳科技有限公司', '一期E座首层103室', '厂房企业管理服务费', '256.52', '', '1398', '1398'),
  d('一期', '银纳', '广东银纳科技有限公司', '一期E座首层103室', '厂房基础设施维护费', '256.52', '', '502.8', '502.8'),
  d('一期', '银纳', '广东银纳科技有限公司', '一期E座首层103室', '变压器维护费', '', '', '159', '159'),
  d('一期', '银纳', '广东银纳科技有限公司', '保障房404、410', '宿舍租金', '488.33', '19', '9278.27', '9278.27'),
  d('一期', '银纳', '广东银纳科技有限公司', '保障房404、410', '宿舍基础设施维护费', '488.33', '', '976.66', '976.66'),
  d('一期', '银纳', '广东银纳科技有限公司', '保障房404、410', '门禁设施维护费', '', '', '108.33', '108.33', '合同期：2024.02.01-2026.01.31'),
  d('一期', '银纳', '广东银纳科技有限公司', '保障房404、410', '网络通讯费', '', '', '650', '650'),
  // 翔海:多厂房位置段 + 空地段(本月应收全 0,月单价才是标准额)
  d('一期', '翔海', '广东翔海光电科技有限公司', 'E座3-4层', '厂房租金', '4708', '18.876', '88868.21', '0'),
  d('一期', '翔海', '广东翔海光电科技有限公司', 'G座1层', '厂房租金', '2354', '24.5388', '57764.34', '0'),
  d('一期', '翔海', '广东翔海光电科技有限公司', 'G座1-4层', '厂房基础设施维护费', '9416', '', '21298.99', '0'),
  d('一期', '翔海', '广东翔海光电科技有限公司', 'G座1-4层', '电梯维护费', '', '', '', '0'),
  d('一期', '翔海', '广东翔海光电科技有限公司', '空地一', '空地租金', '280', '10', '2800', '0'),
  // 南宗:别名归一(维保费)+ 无前缀泛项继承组主类型(组内无租金行前有租金行 → factory)
  d('一期', '南宗', '广东南宗运输有限公司', 'A座6楼623室', '租金', '300', '14.1', '4230', '4230'),
  d('一期', '南宗', '广东南宗运输有限公司', 'A座6楼623室', '基础设施维护费', '300', '', '282', '282'),
  d('一期', '南宗', '广东南宗运输有限公司', 'A座6楼623室', '电梯维保费', '', '', '25', '25'),
  d('一期', '南宗', '广东南宗运输有限公司', 'A座6楼623室', '变压器维保费', '', '', '25', '25'),
  d('一期', '南宗', '广东南宗运输有限公司', 'A座6楼623室', '土地使用税、房产税', '', '', '100', '100'),
  // 成吉:办公室段带基础设施维护费(钉死集越界 → 去段类型保留行)
  d('一期', '成吉', '广东成吉化工有限公司', 'A座208室', '办公室租金', '446.4', '32', '14284.8', '14284.8'),
  d('一期', '成吉', '广东成吉化工有限公司', 'A座208室', '办公室基础设施维护费', '446.4', '', '892.8', '892.8'),
  // 李富全:空收费项目行(押金/保证金)→ 行级跳过
  d('一期', '李富全', '李富全', 'A座503室', '办公室租金', '100', '20', '2000', '2000'),
  d('一期', '李富全', '李富全', 'A座503室水电费押金', '', '', '', '', '5000'),
  // 同名跨期:李李 一期/二期 两户,按 期+全称 区分
  d('一期', '李李', '佛山协作链供应链管理有限公司', '宿金区二号楼首层2110室', '厂房租金', '100', '18', '1800', '1800'),
  d('二期', '李李', '佛山协作链供应链管理有限公司', '二期9号楼103单元', '厂房租金', '7202', '10', '72020', '72020'),
  // relative 户:期限起止空 → 待人工补
  d('二期', '力灏', '佛山市南海力灏工具设备制造有限公司', '二期五号楼首层101室', '厂房租金', '20000', '11.93', '238667.26', '238667.26'),
  // 多租期 A 类(两段连续 + 段后金额):陈书谨
  d('二期', '陈书谨', '陈书谨', '二期钢构车间101室', '厂房租金', '1000', '12.5', '12500', '12500'),
  // 多租期 A 类(四段连续,前两段古老 + 一段并存补充协议):旭化成
  d('一期', '旭化成', '旭化成塑料（广州）有限公司', 'A座二层201、202室', '厂房租金', '500', '20', '10000', '10000'),
  // 多租期 B 类(两段不连续,并存标的):高建军
  d('一期', '高建军', '高建军', 'A座六楼621室', '办公室租金', '100', '30', '3000', '3000'),
]
const SUMMARY: string[][] = [S_HEAD,
  s('一期', '金纳', '佛山市金纳新材料有限公司', '一期D座三楼整层', '55000', '2023-07-14', '2026-07-13', 'explicit', '2023 年 7 月 14 日起至 2026 年 7 月 13 日'),
  s('一期', '银纳', '广东银纳科技有限公司', '一期E座首层103室；保障房404、410', '18861.46', '2022-12-26', '2025-12-25', 'explicit', '2022年12月26日至2025年12月25日', '', '合同期：2024.02.01-2026.01.31'),
  s('一期', '翔海', '广东翔海光电科技有限公司', 'E座3-4层；G座1层', '170731.54', '2017-08-14', '2027-08-13', 'multiple', '厂房 E座3-4层…2017年8月14日至2027年8月13日', '租金首层13元、二层11元…每三年递增10%,分摊系数1.56'),
  s('一期', '南宗', '广东南宗运输有限公司', 'A座6楼623室', '4662', '2021-07-10', '2024-07-09', 'explicit', '2021年7月10日至2024年7月9日'),
  s('一期', '成吉', '广东成吉化工有限公司', 'A座208室', '15177.6', '2022-05-08', '2025-05-07', 'explicit', '2022年05月08日起至2025年05月07日'),
  s('一期', '李富全', '李富全', 'A座503室', '2000', '2020-12-20', '2026-12-19', 'explicit', '2020年12月20日起'),
  s('一期', '李李', '佛山协作链供应链管理有限公司', '宿金区二号楼首层2110室', '1800', '2023-08-01', '2032-07-31', 'explicit', '一期原文'),
  s('二期', '李李', '佛山协作链供应链管理有限公司', '二期9号楼103单元', '72020', '2023-08-01', '2032-07-31', 'explicit', '二期原文'),
  s('二期', '力灏', '佛山市南海力灏工具设备制造有限公司', '二期五号楼首层101室', '238667.26', '', '', 'relative', '租赁期限从以下租赁物业竣工验收报告载明验收日期次日起计九年止'),
  s('二期', '陈书谨', '陈书谨', '二期钢构车间101室', '12500', '2023-05-17', '2029-05-16', 'multiple',
    '租赁期限：2023年5月17日至2026年5月16日（合计12500元/月）；2026年5月17日至2029年5月16日（合计13750元/月）'),
  s('一期', '旭化成', '旭化成塑料（广州）有限公司', 'A座二层201、202室', '10000', '2017-10-27', '2027-10-26', 'multiple',
    '主合同（二层201室、202室）分四个周期：一 2017年10月27日至2020年10月26日；二 2020年10月27日至2023年10月26日；'
    + '三 2023年10月27日至2026年10月26日；四 2026年10月27日至2027年10月26日。'
    + '补充协议（空地14平方米）：租赁期限从2023年07月01日起至2027年10月26日止。'),
  s('一期', '高建军', '高建军', 'A座六楼621室', '3000', '2023-09-01', '2026-09-09', 'multiple',
    '办公室部分：2023年09月01日至2026年08月31日；厂房及企业服务部分：2023年09月10日起至2026年09月09日止'),
]
const WB = [{ name: '明细', matrix: DETAIL }, { name: '汇总', matrix: SUMMARY }]

const res = parseContractWorkbook(WB)
const row = (full: string, phase?: number): ContractFullRow =>
  res.rows.find(r => r.tenantFullName === full && (phase == null || r.phase === phase))!
const line = (r: ContractFullRow, feeKey: string, loc?: string) =>
  r.lines.find(l => l.feeKey === feeKey && (loc == null || l.location === loc))!

describe('mapFeeItem 费项归一', () => {
  it('带前缀费项 → (段类型, 枚举)', () => {
    expect(mapFeeItem('厂房租金')).toEqual({ pt: 'factory', key: 'rent_factory' })
    expect(mapFeeItem('办公室企业管理服务费')).toEqual({ pt: 'office', key: 'mgmt' })
    expect(mapFeeItem('宿舍基础设施维护费')).toEqual({ pt: 'dorm', key: 'infra' })
    expect(mapFeeItem('商铺租金')).toEqual({ pt: 'shop', key: 'rent_shop' })
    expect(mapFeeItem('空地租金')).toEqual({ pt: 'land', key: 'rent_land' })
  })
  it('别名归一(锚点:维保费/税合称)', () => {
    expect(mapFeeItem('电梯维保费')).toEqual({ pt: null, key: 'elevator' })
    expect(mapFeeItem('变压器维保费')).toEqual({ pt: null, key: 'transformer' })
    expect(mapFeeItem('土地使用税、房产税')).toEqual({ pt: null, key: 'land_tax' })
  })
  it('门禁/网络钉死宿舍;其他费用不带段类型;泛称租金待定型;未识别返 null', () => {
    expect(mapFeeItem('门禁设施维护费')).toEqual({ pt: 'dorm', key: 'access' })
    expect(mapFeeItem('网络通讯费')).toEqual({ pt: 'dorm', key: 'network' })
    expect(mapFeeItem('其他费用')).toEqual({ pt: null, key: 'other' })
    expect(mapFeeItem('租金')).toEqual({ pt: null, key: 'RENT' })
    expect(mapFeeItem('水电费押金')).toBeNull()
  })
})

describe('parseTerms / splitMultiTerm 多租期', () => {
  it('三种日期写法成对(「日」可缺),金额小数不误命中', () => {
    expect(parseTerms('2020.8.07-2023.8.6；2023-08-07至2026-08-06').map(t => [t.startDate, t.endDate]))
      .toEqual([['2020-08-07', '2023-08-06'], ['2023-08-07', '2026-08-06']])
    expect(parseTerms('2023年11月15日起至2026年11月14；2026年11月15日起至2029年11月14日')
      .map(t => t.endDate)).toEqual(['2026-11-14', '2029-11-14'])
    expect(parseTerms('基础设施维护费18155.48元/月,合计2548.00元')).toEqual([])
  })

  it('短于 90 天的日期对 = 签订/移交日噪声,丢弃', () => {
    // 三龙:2022-06-24 签订 / 2022-07-24 移交 不成租期,只剩补充协议一段
    const ts = parseTerms('主合同2022年06月24日签订,物业于2022年07月24日移交;补充协议:2023年01月01日起至2028年07月23日止')
    expect(ts.map(t => t.startDate)).toEqual(['2023-01-01'])
  })

  it('连续段(止+1~2 天)成串;主串取最长,古老周期在覆盖段之前被切掉', () => {
    const s = splitMultiTerm('一2017年10月27日至2020年10月26日;二2020年10月27日至2023年10月26日;'
      + '三2023年10月27日至2026年10月26日;四2026年10月27日至2027年10月26日。'
      + '补充协议:2023年07月01日起至2027年10月26日止')!
    expect(s.renewal).toBe(true)
    expect(s.chain.map(t => t.startDate)).toEqual(['2023-10-27', '2026-10-27'])
    expect(s.others.map(t => t.startDate)).toEqual(['2023-07-01'])
  })

  it('不连续 → renewal=false,chain 只 1 段(取覆盖 2024-03 的);无覆盖段 → null', () => {
    const s = splitMultiTerm('2023年09月01日至2026年08月31日；2023年09月10日起至2026年09月09日止')!
    expect(s.renewal).toBe(false)
    expect(s.chain).toHaveLength(1)
    expect(s.others).toHaveLength(1)
    expect(splitMultiTerm('2019年1月1日至2020年12月31日')).toBeNull()
  })

  it('A 类但覆盖段已是末期(李富全型):renewal=true 而 chain 只 1 期 → 不拆链', () => {
    const s = splitMultiTerm('2020.12.20-2023.12.19；2023.12.20-2026.12.19。办公室:2023年12月16日至2026年12月19日')!
    expect(s.renewal).toBe(true)
    expect(s.chain.map(t => t.startDate)).toEqual(['2023-12-20'])
    expect(s.others.map(t => t.startDate)).toEqual(['2023-12-16'])   // 古老周期不进 others
  })
})

describe('parseContractWorkbook 锚点', () => {
  it('金纳:厂房 5 项 + 期限四件套(原文去空白)', () => {
    const r = row('佛山市金纳新材料有限公司')
    expect(r.lines.length).toBe(5)
    expect(r.lines.map(l => l.feeKey)).toEqual(['rent_factory', 'mgmt', 'infra', 'transformer', 'elevator'])
    expect(r.lines.every(l => l.propertyType === 'factory')).toBe(true)
    expect(r.startDate).toBe('2023-07-14')
    expect(r.endDate).toBe('2026-07-13')
    expect(r.termType).toBe('explicit')
    expect(r.termText).toBe('2023年7月14日起至2026年7月13日')
    expect(r.phase).toBe(1)
    // 租金行有单价 → per_sqm_month;管理/基础设施无单价 → per_month 直填月额(不反推单价)
    expect(line(r, 'rent_factory')).toMatchObject({ billMode: 'per_sqm_month', area: 3200, unitPrice: 9.6784, amountOverride: null })
    expect(line(r, 'mgmt')).toMatchObject({ billMode: 'per_month', unitPrice: null, amountOverride: 17440 })
    expect(line(r, 'elevator')).toMatchObject({ billMode: 'per_month', amountOverride: 318 })
  })

  it('银纳:厂房 4 + 宿舍 4 两段,门禁 108.33 / 网络 650', () => {
    const r = row('广东银纳科技有限公司')
    expect(r.lines.length).toBe(8)
    expect(r.lines.filter(l => l.location === '一期E座首层103室').length).toBe(4)
    expect(r.lines.filter(l => l.location === '保障房404、410').length).toBe(4)
    expect(line(r, 'rent_dorm').propertyType).toBe('dorm')
    expect(line(r, 'access')).toMatchObject({ propertyType: 'dorm', amountOverride: 108.33 })
    expect(line(r, 'network')).toMatchObject({ propertyType: 'dorm', amountOverride: 650 })
    expect(line(r, 'infra', '保障房404、410').propertyType).toBe('dorm')
    expect([r.startDate, r.endDate, r.termType]).toEqual(['2022-12-26', '2025-12-25', 'explicit'])
    expect(r.remark).toBe('合同期：2024.02.01-2026.01.31')
  })

  it('翔海:多厂房段 + 空地段,multiple 期限,阶梯价非空', () => {
    const r = row('广东翔海光电科技有限公司')
    expect(new Set(r.lines.map(l => l.location)).size).toBe(4)
    expect(line(r, 'rent_land', '空地一')).toMatchObject({ propertyType: 'land', area: 280, unitPrice: 10 })
    // 空地段只允许 rent_land/land_tax;厂房段的电梯/基础设施仍留在厂房位置段
    expect(line(r, 'infra', 'G座1-4层').propertyType).toBe('factory')
    expect(line(r, 'elevator', 'G座1-4层')).toMatchObject({ propertyType: 'factory', amountOverride: 0 })
    expect([r.startDate, r.endDate, r.termType]).toEqual(['2017-08-14', '2027-08-13', 'multiple'])
    expect(r.tierPriceNote).toMatch(/分摊系数1.56/)
  })

  it('南宗:别名归一 + 无前缀泛项继承组主类型', () => {
    const r = row('广东南宗运输有限公司')
    expect(r.lines.map(l => l.feeKey)).toEqual(['rent_factory', 'infra', 'elevator', 'transformer', 'land_tax'])
    expect(r.lines.every(l => l.propertyType === 'factory')).toBe(true)
    expect(line(r, 'land_tax').note).toBe('原文「土地使用税、房产税」')
  })

  it('成吉:办公室+基础设施越界 → 去段类型保数据并报告点名', () => {
    const r = row('广东成吉化工有限公司')
    expect(r.lines.length).toBe(2)
    expect(line(r, 'rent_office').propertyType).toBe('office')
    expect(line(r, 'infra').propertyType).toBeNull()
    expect(line(r, 'infra').amountOverride).toBe(892.8)
    expect(res.report.find(x => x.tenantName === '成吉')!.issues).toMatch(/不属「office」钉死集/)
  })

  it('空收费项目行 → 行级错误跳过,不进计费行', () => {
    const r = row('李富全')
    expect(r.lines.length).toBe(1)
    expect(res.errors.some(e => e.label === '一期·李富全' && /收费项目为空/.test(e.reason))).toBe(true)
  })

  it('同名跨期户按 期+企业全称 区分,不按简称合并', () => {
    const one = row('佛山协作链供应链管理有限公司', 1)
    const two = row('佛山协作链供应链管理有限公司', 2)
    expect(one.termText).toBe('一期原文')
    expect(two.termText).toBe('二期原文')
    expect(one.lines[0].location).toBe('宿金区二号楼首层2110室')
    expect(two.lines[0].area).toBe(7202)
  })

  it('relative 户期限空 → 起止 null + remark 标待人工补', () => {
    const r = row('佛山市南海力灏工具设备制造有限公司')
    expect(r.startDate).toBeNull()
    expect(r.endDate).toBeNull()
    expect(r.termType).toBe('relative')
    expect(r.termText).toMatch(/竣工验收/)
    expect(r.remark).toBe('期限待人工补')
    expect(res.report.find(x => x.tenantName === '力灏')!.issues).toMatch(/期限待人工补/)
  })

  it('明细月合计与汇总 AB 对账:一致户无差异,抓漏户点名', () => {
    // 翔海:汇总 AB 只含 2 段(170731.54),明细 5 行合计 170731.54 → 无差异
    const xh = res.report.find(x => x.tenantName === '翔海')!
    expect(xh.detailTotal).toBe(170731.54)
    expect(xh.diff).toBe(0)
    // 成吉:汇总 AB 15177.6 = 明细 15177.6
    expect(res.report.find(x => x.tenantName === '成吉')!.diff).toBe(0)
    // 南宗:5 费项(含别名两条)合计 4662 = 汇总 AB
    const nzRow = res.report.find(x => x.tenantName === '南宗')!
    expect(nzRow.detailTotal).toBe(4662)
    expect(nzRow.diff).toBe(0)
    // 抓漏演示:汇总 AB 比明细少 → 报告点名(李富全 押金行不计费,AB 2000 = 明细 2000)
    expect(res.report.find(x => x.tenantName === '李富全')!.diff).toBe(0)
  })

  it('A 类两段连续 → terms 两期 + 段后金额归段,计费行仍挂当期', () => {
    const r = row('陈书谨')
    expect(r.terms).toHaveLength(2)
    expect(r.terms![0]).toMatchObject({ startDate: '2023-05-17', endDate: '2026-05-16' })
    expect(r.terms![0].amountNote).toContain('12500')
    expect(r.terms![1]).toMatchObject({ startDate: '2026-05-17', endDate: '2029-05-16' })
    expect(r.terms![1].amountNote).toContain('13750')
    expect(r.terms![1].text).toMatch(/^2026年5月17日/)
    // 主行起止 = 第 1 期(明细执行期),不再是汇总合成的 2023-05-17~2029-05-16
    expect([r.startDate, r.endDate]).toEqual(['2023-05-17', '2026-05-16'])
    expect(r.lines).toHaveLength(1)
    expect(res.report.find(x => x.tenantName === '陈书谨')!.issues).toMatch(/A 类续签链 2 期/)
  })

  it('A 类四段:只保留覆盖 2024-03 那期及之后,古老周期丢弃但原文全留;并存补充协议落 remark', () => {
    const r = row('旭化成塑料（广州）有限公司')
    expect(r.terms!.map(x => x.startDate)).toEqual(['2023-10-27', '2026-10-27'])
    expect([r.startDate, r.endDate]).toEqual(['2023-10-27', '2026-10-26'])
    expect(r.termText).toMatch(/2017年10月27日/)          // 丢弃的古老周期原文仍在
    expect(r.remark).toBe('本标的租期 2023-07-01→2027-10-26')
  })

  it('B 类不连续 → 不拆链,期限取覆盖 2024-03 的主标的,其余段落 remark', () => {
    const r = row('高建军')
    expect(r.terms).toBeUndefined()
    expect([r.startDate, r.endDate]).toEqual(['2023-09-01', '2026-08-31'])
    expect(r.remark).toBe('本标的租期 2023-09-10→2026-09-09')
    expect(res.report.find(x => x.tenantName === '高建军')!.issues).toMatch(/B 类多标的并存 2 段/)
  })

  it('非 multiple 户不受影响(金纳仍单期无 terms)', () => {
    expect(row('佛山市金纳新材料有限公司').terms).toBeUndefined()
  })

  it('报告 CSV 带 BOM + 表头 + 每户一行', () => {
    const csv = contractReportCsv(res.report)
    expect(csv.startsWith('﻿期,租户简称,企业全称')).toBe(true)
    expect(csv.split('\n').length).toBe(res.report.length + 1)
  })

  it('缺表 → error 兜底', () => {
    expect(parseContractWorkbook([{ name: 'x', matrix: [['甲', '乙']] }]).error).toMatch(/明细/)
    expect(parseContractWorkbook([{ name: '明细', matrix: DETAIL }]).error).toMatch(/汇总/)
  })
})

// ── 真实文件回归(原件在场才跑):146 户 / 648 明细行 / 7 行空费项 / 12 户期限待补 / AB 逐户零差异 ──
const REAL_FILE = 'C:/financial_dashboard/2025全年发生额、预算对比/2024年/2024年3月费用数据/园区租户租金合同明细汇总(2024年3月).xlsx'
describe.skipIf(!fs.existsSync(REAL_FILE))('真实汇总册回归', () => {
  const wb = fs.existsSync(REAL_FILE) ? XLSX.read(fs.readFileSync(REAL_FILE), { cellDates: true }) : null
  const sheets = (wb?.SheetNames ?? []).map(name => ({
    name,
    matrix: XLSX.utils.sheet_to_json<string[]>(wb!.Sheets[name], { header: 1, blankrows: false, defval: '', raw: false, dateNF: 'yyyy-mm-dd' }) as string[][],
  }))
  const real = parseContractWorkbook(sheets)

  it('146 户全出,641 条计费行,7 行空费项报错', () => {
    expect(real.error).toBeUndefined()
    expect(real.rows.length).toBe(146)
    expect(real.rows.reduce((n, r) => n + r.lines.length, 0)).toBe(641)
    expect(real.errors.filter(e => /收费项目为空/.test(e.reason)).length).toBe(7)
    expect(real.errors.filter(e => /无法归一/.test(e.reason)).length).toBe(0)
  })

  it('明细↔汇总 AB 逐户零差异', () => {
    expect(real.report.filter(r => Math.abs(r.diff) > 0.5)).toEqual([])
  })

  it('12 户期限待人工补(relative 2 + 未提取 10)', () => {
    const pending = real.rows.filter(r => r.startDate == null)
    expect(pending.length).toBe(12)
    expect(pending.filter(r => r.termType === 'relative').map(r => r.tenantName).sort()).toEqual(['力灏', '罗立剑'])
    expect(pending.every(r => r.remark!.includes('期限待人工补'))).toBe(true)
  })

  it('同名跨期 李李/广联 各 2 户不合并', () => {
    for (const n of ['李李', '广联']) expect(real.rows.filter(r => r.tenantName === n).length).toBe(2)
  })

  it('钉死集校验:所有带段类型的行都在允许集内', () => {
    const allowed: Record<string, string[]> = {
      factory: ['rent_factory', 'mgmt', 'infra', 'elevator', 'transformer', 'land_tax'],
      office: ['rent_office', 'mgmt', 'elevator', 'transformer', 'land_tax'],
      dorm: ['rent_dorm', 'infra', 'access', 'network', 'land_tax'],
      shop: ['rent_shop', 'infra', 'mgmt', 'transformer', 'land_tax'],
      land: ['rent_land', 'land_tax'],
    }
    for (const r of real.rows)
      for (const l of r.lines)
        if (l.propertyType) expect(allowed[l.propertyType]).toContain(l.feeKey)
  })

  it('锚点户:金纳 5 行 / 银纳两段 8 行 / 翔海 11 行 multiple', () => {
    const jn = real.rows.find(r => r.tenantFullName === '佛山市金纳新材料有限公司')!
    expect(jn.lines.length).toBe(5)
    expect([jn.startDate, jn.endDate]).toEqual(['2023-07-14', '2026-07-13'])
    expect(jn.termText).toBe('2023年7月14日起至2026年7月13日')
    const yn = real.rows.find(r => r.tenantFullName === '广东银纳科技有限公司')!
    expect(yn.lines.length).toBe(8)
    expect(yn.lines.find(l => l.feeKey === 'access')!.amountOverride).toBe(108.33)
    expect(yn.lines.find(l => l.feeKey === 'network')!.amountOverride).toBe(650)
    expect([yn.startDate, yn.endDate]).toEqual(['2022-12-26', '2025-12-25'])
    const xh = real.rows.find(r => r.tenantFullName === '广东翔海光电科技有限公司')!
    expect(xh.lines.length).toBe(11)
    expect([xh.startDate, xh.endDate, xh.termType]).toEqual(['2017-08-14', '2027-08-13', 'multiple'])
    expect(xh.tierPriceNote).toBeTruthy()
  })
})
