// 计费行提取器锚点断言(BILL-FORWARD-SPEC §1.6 三次返工版,同构合成版式;真实两册导入验收另做)。
// 停止收敛,每费项行 1:1 出计费行。同构夹具锁:
//   银纳厂房+宿舍两段(multiPick 位置路由,锚点④⑤⑥⑦) / 翔海 7 位置系数 1.56(锚点⑧)+无合同报「须先建合同」(锚点⑨) /
//   按间房数 3 写法(陷阱④) / 叠单合并(陷阱①) / 表头转置修正(旭化成,锚点⑩) / 思汗系数错位忽略回填(锚点⑪) /
//   金纳主流五行(锚点①②③) / B 流水账 C 仅汇总须手录 / 非租户 sheet 排除 / 到户报告在册全量逐户有名。
import { describe, it, expect } from 'vitest'
import {
  parseBillingTermsWorkbook, billingReportCsv, normalizeFeeKey,
  type BillingContractLite, type FeeLine,
} from './importBillingTerms'

const wb = (name: string, matrix: string[][]) => ({ name, matrix })
const lineOf = (lines: FeeLine[], feeKey: string, loc?: string) =>
  lines.find(l => l.feeKey === feeKey && (loc == null || l.location === loc))!

const CONTRACTS: BillingContractLite[] = [
  { id: 11, contractNo: 'HT-金纳', tenantName: '金纳', startDate: '2023-01-01', endDate: '2025-12-31', status: 'active' },
  { id: 12, contractNo: 'HT-旭化成', tenantName: '旭化成', startDate: '2023-01-01', endDate: '2025-12-31', status: 'active' },
  { id: 13, contractNo: 'HT-思汗', tenantName: '思汗', startDate: '2023-01-01', endDate: '2025-12-31', status: 'active' },
  { id: 14, contractNo: 'HT-翔海', tenantName: '翔海', startDate: '2023-01-01', endDate: '2025-12-31', status: 'active' },
  // 银纳:同名两合同,厂房 vs 宿舍(buildingName 定 kind)→ 位置自动路由,两段都用
  { id: 15, contractNo: 'HT-银纳厂', tenantName: '银纳', buildingName: '银纳3号厂房', startDate: '2023-01-01', endDate: '2025-12-31', status: 'active' },
  { id: 16, contractNo: 'HT-银纳宿', tenantName: '银纳', buildingName: '银纳宿舍楼', startDate: '2023-01-01', endDate: '2025-12-31', status: 'active' },
  { id: 17, contractNo: 'HT-已终止', tenantName: '老租户', startDate: '2020-01-01', endDate: '2022-12-31', status: 'terminated' },
]
const ctx = { contracts: CONTRACTS }

// A1 主流(锚点①②③金纳):物业名称在前列,五行 1:1
const JINNA = [
  ['', '2024年3月应收费用汇总'],
  [],
  ['', '物业名称', '收费项目', '房号', '建筑面积', '面积单价', '月单价', '应收金额', '备注'],
  ['', '3号厂房', '厂房租金', 'A101', '3200', '9.6785', '30971.2', '30971.2', ''],
  ['', '3号厂房', '企业管理服务费', '', '3200', '5.45', '17440', '17440', ''],
  ['', '3号厂房', '基础设施维护费', '', '3200', '1.91', '6112', '6112', ''],
  ['', '3号厂房', '变压器维护费', '', '', '', '159', '159', ''],
  ['', '3号厂房', '电梯维护费', '', '', '', '318', '318', ''],
  ['', '合计', '', '', '', '', '', '55000.2', ''],
]

// 银纳:单 sheet 厂房位置 + 宿舍位置 + 门禁 + 网络(锚点④⑤⑥⑦);门禁/网络单价入面积单价列、房数入房数列
const YINNA = [
  ['', '2024年3月'],
  ['', '物业名称', '收费项目', '房数', '面积', '面积单价', '应收金额'],
  ['', '厂房', '厂房租金', '', '256.52', '22.565', '5788.4'],
  ['', '宿舍楼', '宿舍租金', '', '488.33', '19', '9278.27'],
  ['', '宿舍楼', '门禁设施维护费', '13', '', '100', '108.33'],
  ['', '宿舍楼', '网络通讯费', '13', '', '50', '650'],
  ['', '合计', '', '', '', '', ''],
]

// 翔海:7 位置厂房租金,系数 1.56 独立列(锚点⑧);E座3-4层 4708×12.1×1.56
const XIANGHAI = [
  ['', '2024年3月'],
  ['', '物业名称', '收费项目', '面积', '面积单价', '系数', '应收金额'],
  ['', 'A座', '厂房租金', '1000', '12.1', '1.56', ''],
  ['', 'B座', '厂房租金', '1100', '12.1', '1.56', ''],
  ['', 'C座', '厂房租金', '1200', '12.1', '1.56', ''],
  ['', 'D座', '厂房租金', '1300', '12.1', '1.56', ''],
  ['', 'E座3-4层', '厂房租金', '4708', '12.1', '1.56', '88868.21'],
  ['', 'F座', '厂房租金', '1500', '12.1', '1.56', ''],
  ['', 'G座', '厂房租金', '1600', '12.1', '1.56', ''],
  ['', '合计', '', '', '', '', ''],
]

// 旭化成:表头「收费项目|物业名称」互换,数据仍位置在前列(转置修正,锚点⑩);系数 1.56 独立列不折入单价
const XUHUACHENG = [
  ['', '2024年3月'],
  ['', '收费项目', '物业名称', '建筑面积', '面积单价', '系数', '应收金额'],
  ['', '5号楼', '办公室租金', '400', '15.7', '1.56', '9796.8'],
  ['', '合计', '', '', '', '', ''],
]

// 思汗:面积单价列空、把宿舍价错填进系数列(19)→ 忽略回填 coeff=1,单价不当真(锚点⑪)
const SIHAN = [
  ['', '2024年3月'],
  ['', '物业名称', '收费项目', '面积', '面积单价', '系数', '应收金额'],
  ['', '宿舍', '宿舍租金', '300', '', '19', ''],
  ['', '合计', '', '', '', '', ''],
]

// 按间房数 3 写法(陷阱④):整数 5 / 「3间」文本 / 房号列表 4 个隐含
const ROOMS = [
  ['', '2024年3月'],
  ['', '物业名称', '收费项目', '房数', '房号', '面积单价', '应收金额'],
  ['', '1号楼', '门禁设施维护费', '5', '', '100', ''],
  ['', '2号楼', '门禁设施维护费', '3间', '', '100', ''],
  ['', '3号楼', '门禁设施维护费', '', '101,102,103,104', '100', ''],
  ['', '合计', '', '', '', '', ''],
]

// 叠单合并(陷阱①):单 sheet 两块通知单,合并为该户费项合集
const STACKED = [
  ['', '2024年3月 第一张通知单'],
  ['', '物业名称', '收费项目', '面积', '面积单价', '应收金额'],
  ['', 'A厂房', '厂房租金', '1000', '10', '10000'],
  ['', '合计', '', '', '', ''],
  [],
  ['', '第二张通知单'],
  ['', '物业名称', '收费项目', '面积', '面积单价', '应收金额'],
  ['', 'A厂房', '企业管理服务费', '1000', '3', '3000'],
  ['', '合计', '', '', '', ''],
]

const LEDGER_SHEET = [
  ['', '2023年1月', '租金', '5000'],
  ['', '本月合计', '', '5000'],
  ['', '2023年2月', '租金', '5000'],
  ['', '本月合计', '', '5000'],
]
const SUMMARY_ONLY = [
  ['', '2024年3月应收费用汇总'],
  ['', '租金', '3000'],
]

describe('normalizeFeeKey(费项原文 → 13 枚举)', () => {
  it('专项名先于泛化名,宿舍/办公/商铺/空地租金分流,税→land_tax', () => {
    expect(normalizeFeeKey('厂房租金')).toBe('rent_factory')
    expect(normalizeFeeKey('员工宿舍租金')).toBe('rent_dorm')
    expect(normalizeFeeKey('办公室租金')).toBe('rent_office')
    expect(normalizeFeeKey('商铺租金')).toBe('rent_shop')
    expect(normalizeFeeKey('空地租金')).toBe('rent_land')
    expect(normalizeFeeKey('企业管理服务费')).toBe('mgmt')
    expect(normalizeFeeKey('基础设施维护费')).toBe('infra')
    expect(normalizeFeeKey('电梯维护费')).toBe('elevator')
    expect(normalizeFeeKey('变压器维护费')).toBe('transformer')
    expect(normalizeFeeKey('门禁设施维护费')).toBe('access')
    expect(normalizeFeeKey('网络通讯费')).toBe('network')
    expect(normalizeFeeKey('土地使用税')).toBe('land_tax')
    expect(normalizeFeeKey('保洁费')).toBe('other')
  })
})

describe('parseBillingTermsWorkbook(FeeRow 1:1 计费行)', () => {
  it('金纳主流:5 行 1:1,单一位置(锚点①②③)', () => {
    const { sections, errors } = parseBillingTermsWorkbook([wb('金纳', JINNA)], ctx)
    expect(errors).toHaveLength(0)
    expect(sections).toHaveLength(1)
    expect(sections[0].checked).not.toBe(false)
    const rec = sections[0].records[0]
    expect(rec.contractId).toBe(11)
    const lines = rec.lines as FeeLine[]
    expect(lines).toHaveLength(5)
    expect(new Set(lines.map(l => l.location))).toEqual(new Set(['3号厂房']))
    expect(lineOf(lines, 'rent_factory')).toMatchObject({ area: 3200, unitPrice: 9.6785, coeff: 1, billMode: 'per_sqm_month' })
    expect(lineOf(lines, 'mgmt')).toMatchObject({ area: 3200, unitPrice: 5.45 })
    expect(lineOf(lines, 'infra')).toMatchObject({ area: 3200, unitPrice: 1.91 })
    expect(lineOf(lines, 'transformer')).toMatchObject({ amountOverride: 159, billMode: 'per_month' })
    expect(lineOf(lines, 'elevator')).toMatchObject({ amountOverride: 318, billMode: 'per_month' })
  })

  it('银纳:厂房行→厂房合同、宿舍/门禁/网络行→宿舍合同(位置路由,锚点④⑤⑥⑦),两段都勾选', () => {
    const { sections, errors } = parseBillingTermsWorkbook([wb('银纳', YINNA)], ctx)
    expect(errors).toHaveLength(0)
    expect(sections).toHaveLength(2)
    expect(sections.every(s => s.checked === true)).toBe(true)

    const fac = sections.find(s => s.records[0].contractId === 15)!.records[0].lines as FeeLine[]
    const dorm = sections.find(s => s.records[0].contractId === 16)!.records[0].lines as FeeLine[]
    // 厂房合同只收厂房行(锚点④ 256.52×22.565)
    expect(fac).toHaveLength(1)
    expect(lineOf(fac, 'rent_factory')).toMatchObject({ location: '厂房', area: 256.52, unitPrice: 22.565 })
    // 宿舍合同收宿舍租金+门禁+网络(锚点⑤⑥⑦)
    expect(dorm).toHaveLength(3)
    expect(lineOf(dorm, 'rent_dorm')).toMatchObject({ location: '宿舍楼', area: 488.33, unitPrice: 19 })
    expect(lineOf(dorm, 'access')).toMatchObject({ unitPrice: 100, roomCount: 13, billMode: 'per_room_year' })
    expect(lineOf(dorm, 'network')).toMatchObject({ unitPrice: 50, roomCount: 13, billMode: 'per_room_month' })
  })

  it('翔海:7 位置厂房租金系数 1.56 独立列(锚点⑧),E座3-4层 4708×12.1×1.56', () => {
    const { sections, errors } = parseBillingTermsWorkbook([wb('翔海', XIANGHAI)], ctx)
    expect(errors).toHaveLength(0)
    const lines = sections[0].records[0].lines as FeeLine[]
    expect(lines).toHaveLength(7)
    expect(new Set(lines.map(l => l.location)).size).toBe(7)
    expect(lines.every(l => l.feeKey === 'rent_factory' && l.coeff === 1.56)).toBe(true)
    expect(lineOf(lines, 'rent_factory', 'E座3-4层')).toMatchObject({ area: 4708, unitPrice: 12.1, coeff: 1.56 })
  })

  it('翔海无合同:报「须先建合同」不猜建(锚点⑨)', () => {
    const noXh = { contracts: CONTRACTS.filter(c => c.tenantName !== '翔海') }
    const { sections, errors } = parseBillingTermsWorkbook([wb('翔海', XIANGHAI)], noXh)
    expect(sections).toHaveLength(0)
    expect(errors[0].reason).toContain('须先建合同')
  })

  it('旭化成:表头互换按位置在前列纠正,系数 1.56 独立列不折入单价(锚点⑩)', () => {
    const { sections, errors } = parseBillingTermsWorkbook([wb('旭化成', XUHUACHENG)], ctx)
    expect(errors).toHaveLength(0)
    const line = lineOf(sections[0].records[0].lines as FeeLine[], 'rent_office')
    expect(line).toMatchObject({ location: '5号楼', area: 400, unitPrice: 15.7, coeff: 1.56 })
  })

  it('思汗:面积单价空、系数列错填价 19 → 忽略回填 coeff=1,单价不当真(锚点⑪)', () => {
    const { sections } = parseBillingTermsWorkbook([wb('思汗', SIHAN)], ctx)
    const line = lineOf(sections[0].records[0].lines as FeeLine[], 'rent_dorm')
    expect(line).toMatchObject({ coeff: 1, unitPrice: null, area: 300 })
  })

  it('按间房数 3 写法:整数 5 / 「3间」文本 / 房号列表隐含 4(陷阱④)', () => {
    const { sections } = parseBillingTermsWorkbook([wb('金纳', ROOMS)], ctx)
    const lines = sections[0].records[0].lines as FeeLine[]
    expect(lines.map(l => l.roomCount)).toEqual([5, 3, 4])
    expect(lines.every(l => l.feeKey === 'access' && l.billMode === 'per_room_year')).toBe(true)
  })

  it('叠单合并:单 sheet 两块通知单 → 该户费项合集(陷阱①)', () => {
    const { sections } = parseBillingTermsWorkbook([wb('金纳', STACKED)], ctx)
    expect(sections).toHaveLength(1)
    const lines = sections[0].records[0].lines as FeeLine[]
    expect(lines).toHaveLength(2)
    expect(lineOf(lines, 'rent_factory')).toMatchObject({ unitPrice: 10 })
    expect(lineOf(lines, 'mgmt')).toMatchObject({ unitPrice: 3 })
  })

  it('B 流水账/C 仅汇总:整 sheet 须手录,不阻断整批', () => {
    const { sections, errors } = parseBillingTermsWorkbook(
      [wb('中山大学', LEDGER_SHEET), wb('保安宿舍', SUMMARY_ONLY), wb('金纳', JINNA)], ctx)
    expect(sections).toHaveLength(1)
    expect(errors).toHaveLength(2)
    expect(errors.find(e => e.label === '中山大学')?.reason).toContain('流水账')
    expect(errors.find(e => e.label === '保安宿舍')?.reason).toContain('无通知单块')
  })

  it('非租户 sheet(水电费/总表)名单式排除', () => {
    const { sections, errors } = parseBillingTermsWorkbook(
      [wb('2024年2月水电费', JINNA), wb('2024.03应收费用总表', JINNA)], ctx)
    expect(sections).toHaveLength(0)
    expect(errors).toHaveLength(0)
  })

  it('别名收敛:sheet名⊆租户名唯一命中;同租户多 sheet 按合同合并聚合', () => {
    const ctx2 = { contracts: [
      { id: 21, contractNo: 'HT-开利', tenantName: '开利暖通', startDate: '2023-01-01', endDate: '2025-12-31', status: 'active' },
    ] as BillingContractLite[] }
    const { sections, errors } = parseBillingTermsWorkbook([wb('暖通', JINNA), wb('开利暖通', JINNA)], ctx2)
    expect(errors).toHaveLength(0)
    expect(sections).toHaveLength(1)             // 两 sheet 归并同一合同
    expect((sections[0].records[0].lines as FeeLine[]).length).toBe(10)   // 叠加两册 5+5
  })

  it('到户报告:在册合同全量逐户有名(已导入/须手录/未见于本册),终止不入册', () => {
    const { report } = parseBillingTermsWorkbook(
      [wb('金纳', JINNA), wb('中山大学', LEDGER_SHEET)], ctx)
    expect(report.find(r => r.contractNo === 'HT-已终止')).toBeUndefined()
    expect(report.find(r => r.contractNo === 'HT-金纳')).toMatchObject({ state: 'imported', lineCount: 5 })
    expect(report.find(r => r.contractNo === 'HT-旭化成')?.state).toBe('not_in_file')
    const csv = billingReportCsv(report)
    expect(csv.split('\n')).toHaveLength(report.length + 1)
    expect(csv).toContain('HT-金纳')
    expect(csv).toContain('未见于本册')
  })
})
