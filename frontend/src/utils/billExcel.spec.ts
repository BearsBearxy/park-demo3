import { describe, it, expect } from 'vitest'
import {
  buildFamilies, buildPayslip, buildBillAoa, billFileName,
  S10_FEE_LABELS, BILL_DUE_NOTE, BILL_TRANSFER_NOTE, type PayCoLookup,
} from './billExcel'
import type { BillS10RowDTO } from '../api/bills'
import type { TenantDTO } from '../types/tenant'

// 租户主数据底座(家族骨架来源=档案,非台账行/附表10行)
const tenant = (p: Partial<TenantDTO>): TenantDTO => ({
  id: 1, companyName: '甲', contactName: '', contactPhone: '', businessType: '',
  status: 1, categoryId: null, phase: 1, since: null, monthlyRent: 0, leasedArea: 0,
  primaryBuilding: null, contractCount: 0, parentId: null, parentName: null, ...p,
} as TenantDTO)

// 25 附表10 费用列全零底座,按需覆写
const s10zeros = Object.fromEntries([...S10_FEE_LABELS.keys()].map(k => [k, 0])) as Record<string, number>
const s10 = (p: Partial<BillS10RowDTO>): BillS10RowDTO => ({
  tenantId: null, tenantName: '甲', phase: 1, ...s10zeros, ...p,
} as BillS10RowDTO)

// 档案:季海莲家族(主+子)、曹小芳家族(主本期无附表10行,子有——主户必须仍出现)、安然科技(本期无附表10 → 不入列表)
const tenants: TenantDTO[] = [
  tenant({ id: 11, companyName: '季海莲' }),
  tenant({ id: 12, companyName: '季海莲宿舍', parentId: 11, parentName: '季海莲' }),
  tenant({ id: 21, companyName: '曹小芳' }),
  tenant({ id: 22, companyName: '曹小芳宿舍', parentId: 21, parentName: '曹小芳' }),
  tenant({ id: 3, companyName: '安然科技' }),
]

// s10 行:季海莲跨 phase 两行(tenantId 匹配求和),宿舍 tenantId 空走 tenantName 兜底;路人甲不在档案 → 独立成户
const s10Rows: BillS10RowDTO[] = [
  s10({ tenantId: 11, tenantName: '季海莲', phase: 2, factoryRent: 30000 }),
  s10({ tenantId: 11, tenantName: '季海莲', phase: 3, factoryRent: 20000, elecStd: 500 }),
  s10({ tenantId: null, tenantName: '季海莲宿舍', phase: 4, dormRent: 2000 }),
  s10({ tenantId: null, tenantName: '曹小芳宿舍', phase: 4, dormRent: 1500 }),
  s10({ tenantId: null, tenantName: '路人甲', phase: 1, otherFee: 300 }),
]

describe('buildFamilies', () => {
  it('家族=档案 root+children(非台账);只列本期有附表10数据的家族,默认应收降序', () => {
    const fams = buildFamilies(tenants, s10Rows)
    // 安然科技本期无附表10 → 不入列;应收降序:季海莲 52500 > 曹小芳 1500 > 路人甲 300
    expect(fams.map(f => f.rootName)).toEqual(['季海莲', '曹小芳', '路人甲'])
    expect(fams.map(f => f.totalReceivable)).toEqual([52500, 1500, 300])
  })

  it('成员匹配 tenantId 优先/tenantName 全等兜底;一成员多行按费用项求和;root 在前', () => {
    const ji = buildFamilies(tenants, s10Rows)[0]
    expect(ji.unlinked).toBe(false)
    expect(ji.members.map(m => m.tenantName)).toEqual(['季海莲', '季海莲宿舍'])
    expect(ji.members[0]).toMatchObject({ tenantId: 11, child: false, missing: false, total: 50500 })
    expect(ji.members[0].fees.factoryRent).toBe(50000)   // phase 2 + phase 3 求和
    expect(ji.members[0].fees.elecStd).toBe(500)
    expect(ji.members[1]).toMatchObject({ tenantId: 12, child: true, missing: false, total: 2000 })   // 名称兜底命中
  })

  it('主户本期无附表10行也必须出现(missing=true),家族不消失——曹小芳纠偏场景', () => {
    const cao = buildFamilies(tenants, s10Rows)[1]
    expect(cao.members.map(m => m.tenantName)).toEqual(['曹小芳', '曹小芳宿舍'])
    expect(cao.members[0]).toMatchObject({ missing: true, total: 0 })
    expect(cao.members[1]).toMatchObject({ missing: false, total: 1500 })
    expect(cao.totalReceivable).toBe(1500)
  })

  it('匹配不到档案的附表10行按 tenantName 独立成户(unlinked),不静默丢行', () => {
    const stray = buildFamilies(tenants, s10Rows)[2]
    expect(stray).toMatchObject({ rootName: '路人甲', unlinked: true, totalReceivable: 300 })
    expect(stray.members).toHaveLength(1)
    expect(stray.members[0]).toMatchObject({ tenantId: null, child: false, missing: false, total: 300 })
  })
})

describe('buildPayslip(转置:行=费用项,列=成员)', () => {
  it('行=家族非零费用项(office 叶序);values 与成员列对齐;末行=各成员合计', () => {
    const ji = buildFamilies(tenants, s10Rows)[0]
    const ps = buildPayslip(ji)

    // 非零费用项:厂房租金/宿舍租金/基准电费,office 叶序 factoryRent < dormRent < elecStd
    expect(ps.rows.map(r => r.key)).toEqual(['factoryRent', 'dormRent', 'elecStd'])
    expect(ps.rows.map(r => r.label)).toEqual(['厂房租金', '宿舍租金', '基准电费'])

    // 列序=成员序(root 前子后);每行 values 对齐成员 + 行合计
    expect(ps.members.map(m => m.tenantName)).toEqual(['季海莲', '季海莲宿舍'])
    expect(ps.rows[0]).toMatchObject({ values: [50000, 0], total: 50000 })
    expect(ps.rows[1]).toMatchObject({ values: [0, 2000], total: 2000 })
    expect(ps.rows[2]).toMatchObject({ values: [500, 0], total: 500 })

    // 末行=各成员列合计;总计=附表10应收合计
    expect(ps.memberTotals).toEqual([50500, 2000])
    expect(ps.grandTotal).toBe(52500)
  })

  it('missing 成员照常占列(值全零);未关联独立户单成员单列', () => {
    const fams = buildFamilies(tenants, s10Rows)
    const cao = buildPayslip(fams[1])
    expect(cao.rows.map(r => r.key)).toEqual(['dormRent'])
    expect(cao.rows[0].values).toEqual([0, 1500])
    expect(cao.memberTotals).toEqual([0, 1500])

    const stray = buildPayslip(fams[2])
    expect(stray.rows.map(r => r.label)).toEqual(['其他费用'])
    expect(stray.memberTotals).toEqual([300])
    expect(stray.grandTotal).toBe(300)
  })
})

// 收款公司指引 lookup(BILLS-SPEC §5):季海莲(id=11)×厂房租金已设置,其余无映射
const payCo: PayCoLookup = (tid, k) => (tid === 11 && k === 'factoryRent' ? '创显科技公司' : null)

describe('buildBillAoa(转置版式,无台账汇总区)', () => {
  it('每成员金额列右侧配「转入公司」列;合计行公司列留白;末尾转账指引+催缴语', () => {
    const fams = buildFamilies(tenants, s10Rows)
    const aoa = buildBillAoa(fams[0], 2025, 7, payCo)

    expect(aoa[1]).toEqual(['期间', '2025年7月'])
    expect(aoa[2]).toEqual(['户名', '季海莲（家族 2 户）'])
    expect(aoa[4]).toEqual(['费用项', '季海莲', '转入公司', '└ 季海莲宿舍', '转入公司', '合计'])
    // 非零格带公司全名;零金额格公司列留白;非零无映射=「未设置」兜底
    expect(aoa[5]).toEqual(['厂房租金', 50000, '创显科技公司', 0, '', 50000])
    expect(aoa[6]).toEqual(['宿舍租金', 0, '', 2000, '未设置', 2000])
    expect(aoa[7]).toEqual(['基准电费', 500, '未设置', 0, '', 500])
    expect(aoa[8]).toEqual(['合计', 50500, '', 2000, '', 52500])

    // 应收合计保留;台账汇总区(上期结余/实收/期末欠费)已删
    const labels = aoa.map(r => r[0])
    expect(aoa[labels.indexOf('附表10应收合计')]).toEqual(['附表10应收合计', 52500])
    expect(labels).not.toContain('上期结余')
    expect(labels).not.toContain('本期实收')
    expect(labels).not.toContain('期末欠费')
    expect(aoa[aoa.length - 2]).toEqual([BILL_TRANSFER_NOTE])   // 催缴语前一行=转账指引
    expect(aoa[aoa.length - 1]).toEqual([BILL_DUE_NOTE])        // 末行催缴提示语
  })

  it('missing 成员金额与公司列整列画「—」,列头带（无附表10记录）', () => {
    const cao = buildBillAoa(buildFamilies(tenants, s10Rows)[1], 2025, 7, payCo)
    expect(cao[4]).toEqual(['费用项', '曹小芳（无附表10记录）', '转入公司', '└ 曹小芳宿舍', '转入公司', '合计'])
    expect(cao[5]).toEqual(['宿舍租金', '—', '—', 1500, '未设置', 1500])
    expect(cao[6]).toEqual(['合计', '—', '', 1500, '', 1500])
  })

  it('未关联租户档案的独立户(tenantId 空)无处落映射 → 公司列「未设置」', () => {
    const stray = buildBillAoa(buildFamilies(tenants, s10Rows)[2], 2025, 7, payCo)
    expect(stray[4]).toEqual(['费用项', '路人甲', '转入公司', '合计'])
    expect(stray[5]).toEqual(['其他费用', 300, '未设置', 300])
  })
})

describe('billFileName', () => {
  it('账单-YYYY年MM月-户名.xlsx;户名去文件系统非法字符', () => {
    expect(billFileName(2025, 7, '季海莲')).toBe('账单-2025年07月-季海莲.xlsx')
    expect(billFileName(2025, 12, 'A/B:C*D?"E<F>G|H\\I')).toBe('账单-2025年12月-ABCDEFGHI.xlsx')
    expect(billFileName(2025, 7, '***')).toBe('账单-2025年07月-账单.xlsx')   // 全非法 → 兜底
  })
})
