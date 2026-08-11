import { describe, expect, it } from 'vitest'
import { S10_FEE_LABELS } from './billExcel'
import {
  COL_SLOTS, buildPayPlan, buildPayRows, buildReconSheets, buildSlotCells, payColOf, payKey,
  resolveSlot, slotAmounts, slotFeeNames, slotGap, slotLabel, slotOf, tenantStatus,
  type PayMap, type PayStash,
} from './payBookLogic'

// ── 注册表(S20 §1 调研定稿:催缴单实际落到的 10 个收款槽) ──
describe('COL_SLOTS 收款槽注册表', () => {
  it('十槽齐全且 colId 唯一,顺序=收款簿下拉序', () => {
    expect(COL_SLOTS.map(s => s.colId)).toEqual([
      'elecStd', 'elecMaint', 'elecBasic', 'waterStd', 'waterMaint',
      'dormRent', 'officeRent', 'officeMgmtFee', 'landRent', 'infraOffice',
    ])
    expect(new Set(COL_SLOTS.map(s => s.colId)).size).toBe(10)
  })
  it('电费槽承接六项催缴单费项', () => {
    expect(slotFeeNames(slotOf('elecStd')!))
      .toEqual(['电费', '楼层公共', '消防用电', '电梯用电', '线路损耗', '路灯公摊'])
  })
  it('水费槽承接两项', () => {
    expect(slotFeeNames(slotOf('waterStd')!)).toEqual(['水费', '绿化水公摊'])
  })
  it('三个维护类槽未设时继承电费/水费槽', () => {
    expect(slotOf('elecMaint')!.inheritFrom).toBe('elecStd')
    expect(slotOf('elecBasic')!.inheritFrom).toBe('elecStd')
    expect(slotOf('waterMaint')!.inheritFrom).toBe('waterStd')
  })
  it('四个租金类槽标「系统从无默认」,且都没有继承源', () => {
    for (const c of ['officeRent', 'officeMgmtFee', 'landRent', 'infraOffice']) {
      expect(slotOf(c)!.neverSeeded).toBe(true)
      expect(slotOf(c)!.inheritFrom).toBeUndefined()
    }
    expect(COL_SLOTS.filter(s => s.neverSeeded).length).toBe(4)
  })
  it('dormRent 通吃宿舍单整单,单独说明', () => {
    const s = slotOf('dormRent')!
    expect(s.wholeNotice).toBe(true)
    expect(s.note).toContain('整单')
    expect(s.inheritFrom).toBeUndefined()
  })
  it('槽名取附表10列名单一事实源,不手抄', () => {
    for (const s of COL_SLOTS) expect(slotLabel(s.colId)).toBe(S10_FEE_LABELS.get(s.colId))
  })
})

// ── fee_key → 槽(镜像后端 BillFeeMap;改了后端这里必须同步) ──
describe('payColOf 映射', () => {
  it('水电十一键与后端 BillFeeMap.PAY_COL 逐条一致', () => {
    const expected: Record<string, string> = {
      elec: 'elecStd', mgmt_fee: 'elecMaint', capacity: 'elecBasic',
      water: 'waterStd', water_pipe: 'waterMaint',
      share_elec_floor: 'elecStd', share_elec_elevator: 'elecStd', share_elec_fire: 'elecStd',
      share_elec_light: 'elecStd', share_elec_loss: 'elecStd', share_green_water: 'waterStd',
    }
    for (const [k, v] of Object.entries(expected)) expect(payColOf(k)).toBe(v)
  })
  it('宿舍单整单落 dormRent(压过逐行映射)', () => {
    expect(payColOf('elec', { dorm: true })).toBe('dormRent')
    expect(payColOf('rent_dorm', { dorm: true })).toBe('dormRent')
  })
  it('租金行按段类型分列', () => {
    expect(payColOf('rent_office')).toBe('officeRent')
    expect(payColOf('rent_land')).toBe('landRent')
    expect(payColOf('mgmt', { propertyType: 'office' })).toBe('officeMgmtFee')
    expect(payColOf('infra', { propertyType: 'office' })).toBe('infraOffice')
    expect(payColOf('mgmt', { propertyType: 'factory' })).toBe('factoryMgmtFee')
  })
  it('未知键返回 null', () => {
    expect(payColOf('nope')).toBeNull()
    expect(payColOf('mgmt')).toBeNull()      // 段类型未知时不猜
  })
})

// ── 解析(含继承与暂存) ──
describe('resolveSlot 继承与暂存', () => {
  const map: PayMap = new Map([[payKey(7, 'elecStd'), 3], [payKey(7, 'elecMaint'), 5]])
  it('本槽已设=直接命中', () => {
    expect(resolveSlot(map, 7, slotOf('elecMaint')!))
      .toEqual({ companyId: 5, inherited: false, from: null })
  })
  it('本槽未设+有继承源=命中继承源并标 inherited', () => {
    expect(resolveSlot(map, 7, slotOf('elecBasic')!))
      .toEqual({ companyId: 3, inherited: true, from: 'elecStd' })
  })
  it('继承源也未设=解析不出', () => {
    expect(resolveSlot(map, 7, slotOf('waterMaint')!))
      .toEqual({ companyId: null, inherited: false, from: null })
  })
  it('暂存压过落库值,继承源的暂存也吃', () => {
    const stash: PayStash = new Map([[payKey(7, 'elecStd'), 9]])
    expect(resolveSlot(map, 7, slotOf('elecBasic')!, stash).companyId).toBe(9)
    expect(resolveSlot(map, 7, slotOf('elecStd')!, stash))
      .toEqual({ companyId: 9, inherited: false, from: null })
  })
  it('dormRent 无继承源,未设即缺口', () => {
    expect(resolveSlot(map, 7, slotOf('dormRent')!).companyId).toBeNull()
  })
})

// ── 行构建 ──
describe('buildPayRows 行构建', () => {
  const buildings = [{ id: 1, phase: 2, name: 'B座' }, { id: 2, phase: 1, name: '一车间' }]
  const contracts = [
    { tenantId: 7, tenantName: '甲', buildingId: 1, buildingName: 'B座', rentArea: 200 },
    { tenantId: 8, tenantName: '乙', buildingId: 2, buildingName: '一车间', rentArea: 50 },
  ]
  const n = (
    tenantId: number, tenantName: string, payCompanyId: number | null,
    noticeKind = 'combined', totalAmount = 100,
  ) => ({ tenantId, tenantName, payCompanyId, noticeKind, premiseText: null, totalAmount, status: 'draft' })

  it('一户一行,期归属/主楼栋与催缴单列表同源', () => {
    const rows = buildPayRows([n(7, '甲', 3), n(8, '乙', 3)], contracts, buildings)
    expect(rows.map(r => r.tenantId)).toEqual([7, 8])
    expect(rows[0].phase).toBe(2)
    expect(rows[1].phase).toBe(1)
    expect(rows[0].bld.main?.name).toBe('B座')
  })
  it('任一单收款公司为空 → 该户 gap', () => {
    const rows = buildPayRows([n(7, '甲', 3), n(7, '甲', null)], contracts, buildings)
    expect(rows.length).toBe(1)
    expect(rows[0].gap).toBe(true)
    expect(rows[0].totalAmount).toBe(200)
  })
  it('有宿舍单 → dorm=true', () => {
    const rows = buildPayRows([n(7, '甲', 3), n(7, '甲', 4, 'dorm')], contracts, buildings)
    expect(rows[0].dorm).toBe(true)
  })
  it('将出几张单=按收款公司拆的单数(未设公司那部分也算一张)', () => {
    const rows = buildPayRows([n(7, '甲', 3), n(7, '甲', 3, 'dorm'), n(7, '甲', null)], contracts, buildings)
    expect(rows[0].sheetCount).toBe(2)
  })
  it('无合同的户仍出行(未归楼栋,兜底一期)', () => {
    const rows = buildPayRows([n(99, '丙', null)], contracts, buildings)
    expect(rows[0].bld.main).toBeNull()
    expect(rows[0].phase).toBe(1)
  })
})

// ── 缺口 ──
describe('slotGap 缺口户数', () => {
  const buildings = [{ id: 1, phase: 1, name: 'A座' }]
  const contracts = [
    { tenantId: 7, tenantName: '甲', buildingId: 1, rentArea: 10 },
    { tenantId: 8, tenantName: '乙', buildingId: 1, rentArea: 10 },
  ]
  const n = (tenantId: number, kind = 'combined') =>
    ({ tenantId, tenantName: 'x', payCompanyId: null, noticeKind: kind, premiseText: null, totalAmount: 0, status: 'draft' })
  const rows = buildPayRows([n(7), n(8, 'dorm')], contracts, buildings)

  it('缺口=可见户中该槽解析不出公司的户数', () => {
    expect(slotGap(rows, new Map(), slotOf('elecStd')!)).toBe(2)
    expect(slotGap(rows, new Map([[payKey(7, 'elecStd'), 3]]), slotOf('elecStd')!)).toBe(1)
  })
  it('继承生效的户不计缺口', () => {
    const map: PayMap = new Map([[payKey(7, 'elecStd'), 3], [payKey(8, 'elecStd'), 3]])
    expect(slotGap(rows, map, slotOf('elecMaint')!)).toBe(0)
  })
  it('dormRent 只统计有宿舍单的户', () => {
    expect(slotGap(rows, new Map(), slotOf('dormRent')!)).toBe(1)
  })
  it('暂存计入缺口(改完立刻掉数)', () => {
    const stash: PayStash = new Map([[payKey(7, 'elecStd'), 3], [payKey(8, 'elecStd'), 3]])
    expect(slotGap(rows, new Map(), slotOf('elecStd')!, stash)).toBe(0)
  })
})

// ── 暂存 → 提交计划 ──
describe('buildPayPlan 提交计划', () => {
  it('逐条 PUT /bills/paymap 行(tenantId/feeKey/companyId),同户多槽各出一行', () => {
    const stash: PayStash = new Map([
      [payKey(7, 'elecStd'), 3], [payKey(7, 'waterStd'), 4], [payKey(8, 'elecStd'), 3],
    ])
    expect(buildPayPlan(stash)).toEqual([
      { tenantId: 7, feeKey: 'elecStd', companyId: 3 },
      { tenantId: 7, feeKey: 'waterStd', companyId: 4 },
      { tenantId: 8, feeKey: 'elecStd', companyId: 3 },
    ])
  })
})

// ── 户级状态(单据级存储、户级展示;S20 §1.3) ──
describe('tenantStatus 户级状态', () => {
  const s = (...ss: string[]) => ss.map(status => ({ status }))
  it('全部已确认=confirmed', () => expect(tenantStatus(s('confirmed', 'confirmed'))).toBe('confirmed'))
  it('部分确认=partial', () => expect(tenantStatus(s('confirmed', 'draft'))).toBe('partial'))
  it('全部已导出=exported', () => expect(tenantStatus(s('exported', 'exported'))).toBe('exported'))
  it('已导出+已确认混=confirmed(未全导出)', () => expect(tenantStatus(s('exported', 'confirmed'))).toBe('confirmed'))
  it('void 单忽略,不拖累已确认', () => expect(tenantStatus(s('confirmed', 'void'))).toBe('confirmed'))
  it('全 void / 空 = draft', () => {
    expect(tenantStatus(s('void'))).toBe('draft')
    expect(tenantStatus([])).toBe('draft')
  })
  it('未知/遗留状态按 draft 处理(不冒充已确认)', () => expect(tenantStatus(s('issued'))).toBe('draft'))
})

// ── 对账表 sheet 清单 ──
describe('buildReconSheets 对账表 sheet', () => {
  const n = (tenantId: number, payCompanyId: number | null, payCompanyName: string | null, amt: number) =>
    ({ tenantId, tenantName: 'x', payCompanyId, payCompanyName, noticeKind: 'combined', premiseText: null, totalAmount: amt, status: 'draft' })
  const sheets = buildReconSheets([n(7, 3, '一泽', 100), n(8, 3, '一泽', 50.5), n(7, 4, '积前', 20), n(9, null, null, 8)])

  it('总表在前、未设置在末,中间每家公司一 sheet', () => {
    expect(sheets.map(s => s.kind)).toEqual(['total', 'company', 'company', 'none'])
    expect(sheets[1].label).toBe('一泽')
  })
  it('户数按租户去重、金额求和', () => {
    expect(sheets[0]).toMatchObject({ tenants: 3, amount: 178.5 })
    expect(sheets[1]).toMatchObject({ companyId: 3, tenants: 2, amount: 150.5 })
    expect(sheets[3]).toMatchObject({ companyId: null, tenants: 1, amount: 8 })
  })
  it('无未设置户时不出「未设置」sheet', () => {
    expect(buildReconSheets([n(7, 3, '一泽', 100)]).map(s => s.kind)).toEqual(['total', 'company'])
  })
})

// ── 该户各槽金额(PaySlotGrid amounts 入参) ──
describe('slotAmounts 归槽求和', () => {
  const l = (feeKey: string, amount: number, o: Record<string, unknown> = {}) =>
    ({ feeKey, premise: null, amount, feeGroup: 'elec', ...o })
  it('水电行按 BillFeeMap 归槽,同槽多行求和', () => {
    const m = slotAmounts([{ noticeKind: 'combined', lines: [
      l('elec', 100), l('share_elec_loss', 5.5), l('mgmt_fee', 8), l('water', 20, { feeGroup: 'water' }),
    ] }])
    expect(m.get('elecStd')).toBe(105.5)
    expect(m.get('elecMaint')).toBe(8)
    expect(m.get('waterStd')).toBe(20)
  })
  it('宿舍单整单落 dormRent(逐行映射被压过)', () => {
    const m = slotAmounts([{ noticeKind: 'dorm', lines: [l('elec', 100), l('rent_dorm', 900, { feeGroup: 'rent' })] }])
    expect(m.get('dormRent')).toBe(1000)
    expect(m.has('elecStd')).toBe(false)
  })
  it('rent 行的 mgmt/infra 按同场地块的 rent_* 反推段类型', () => {
    const m = slotAmounts([{ noticeKind: 'combined', lines: [
      l('rent_office', 5000, { feeGroup: 'rent', premise: 'A座602' }),
      l('mgmt', 300, { feeGroup: 'rent', premise: 'A座602' }),
      l('infra', 100, { feeGroup: 'rent', premise: 'A座602' }),
    ] }])
    expect(m.get('officeRent')).toBe(5000)
    expect(m.get('officeMgmtFee')).toBe(300)
    expect(m.get('infraOffice')).toBe(100)
  })
  it('映射不到槽的行不进结果(不伪造格子)', () => {
    expect(slotAmounts([{ noticeKind: 'combined', lines: [l('nope', 42)] }]).size).toBe(0)
  })
  it('跨单累加(该户多张单合成一套方格)', () => {
    const m = slotAmounts([
      { noticeKind: 'combined', lines: [l('elec', 100)] },
      { noticeKind: 'combined', lines: [l('elec', 1)] },
    ])
    expect(m.get('elecStd')).toBe(101)
  })
})

// ── 抽屉方格(PaySlotGrid 数据源) ──
describe('buildSlotCells 抽屉方格', () => {
  const map: PayMap = new Map([[payKey(7, 'elecStd'), 3]])
  const cos = [{ id: 3, name: '一泽', short: '一泽' }, { id: 4, name: '积前', short: '积前' }]
  const cells = buildSlotCells(7, { dorm: false, amounts: new Map([['elecStd', 120], ['elecMaint', 8]]) }, map, cos)

  it('已设格显公司名,继承格显「继承自X」', () => {
    const e = cells.find(c => c.colId === 'elecStd')!
    expect(e).toMatchObject({ companyId: 3, companyName: '一泽', inherit: null, amount: 120 })
    // 槽名取附表10列名(elecStd=「基准电费」),不另起炉灶
    expect(cells.find(c => c.colId === 'elecMaint')).toMatchObject({ companyId: 3, inherit: '继承自基准电费' })
  })
  it('非宿舍户不出 dormRent 格', () => {
    expect(cells.some(c => c.colId === 'dormRent')).toBe(false)
    expect(buildSlotCells(7, { dorm: true, amounts: new Map() }, map, cos).some(c => c.colId === 'dormRent')).toBe(true)
  })
  it('无金额的槽不出格,免整屏 25 列噪声', () => {
    expect(cells.map(c => c.colId)).toEqual(['elecStd', 'elecMaint'])
  })
  it('系统从无默认的槽有金额时照出,并带 neverSeeded 标', () => {
    const c = buildSlotCells(7, { dorm: false, amounts: new Map([['officeRent', 5000]]) }, new Map(), cos)
    expect(c).toHaveLength(1)
    expect(c[0]).toMatchObject({ colId: 'officeRent', neverSeeded: true, companyId: null })
  })
})
