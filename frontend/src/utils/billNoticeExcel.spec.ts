import { describe, expect, it } from 'vitest'
import type { BillNoticeLineDTO } from '@/api/billNotices'
import {
  buildNoticeSections, buildReconSheet, noticeFileName, noticeWorkbookBytes, reconWorkbookBytes,
  splitByPayCompany, type NoticeExportItem,
} from './billNoticeExcel'

// ── 造行:字段默认全空,逐用例只填相关列(与 billNoticeLogic.spec 同手法) ──
const line = (o: Partial<BillNoticeLineDTO>): BillNoticeLineDTO => ({
  lineNo: 0, feeKey: 'elec', premise: null, meterId: null, meterLabel: null, contractId: null,
  seg: null, prevRead: null, currRead: null, factorSnap: null, qty: null, priceSnap: null,
  priceKey: null, priceScope: null, priceMonth: null, ruleBranch: null, poolRuleId: null,
  poolName: null, shareSrc: null, baseSnap: null, amount: 0, note: null, feeGroup: 'elec', ...o,
})
const detail = (payCompanyId: number | null, lines: BillNoticeLineDTO[], o: Record<string, unknown> = {}) => ({
  id: 1, ym: '2024-02', tenantId: 7, tenantName: '王红婷', payCompanyId, payCompanyName: null,
  noticeKind: 'fee', premiseText: null, totalAmount: lines.reduce((s, l) => s + l.amount, 0),
  prevDue: 0, status: 'draft', warn: null, lines, ...o,
})
const noNotes = new Map<string, string>()

// 源册锚点(二期2024年2月水电费.xlsx / 王红婷 sheet):电费联=装机容量费+分时四段;维护费联=管理费+公摊四项
const wangElec = [
  line({ feeKey: 'capacity', qty: 25, priceSnap: 22.6, amount: 565 }),
  line({ feeKey: 'elec', seg: 'peak', meterLabel: '电表①', prevRead: 54.99, currRead: 59.79, factorSnap: 30, qty: 144, priceSnap: 1.20606875, amount: 173.67 }),
  line({ feeKey: 'elec', seg: 'flat', meterLabel: '电表①', prevRead: 48.68, currRead: 52.43, factorSnap: 30, qty: 112.5, priceSnap: 0.72076875, amount: 81.09 }),
  line({ feeKey: 'water', meterLabel: '水表①', prevRead: 41, currRead: 45, factorSnap: 1, qty: 4, priceSnap: 3.95, amount: 15.8, feeGroup: 'water' }),
]

describe('splitByPayCompany 一户一单按收款公司拆(spec §5.1)', () => {
  const it0: NoticeExportItem = {
    tenantId: 7, tenantName: '王红婷', premiseText: '二期12号楼六楼602室', notes: noNotes,
    details: [
      detail(3, [line({ feeKey: 'elec', amount: 100 })]),
      detail(5, [line({ feeKey: 'mgmt_fee', amount: 20 })]),
      detail(3, [line({ feeKey: 'water', amount: 10, feeGroup: 'water' })]),
    ],
  }
  it('同户跨两家公司出两联,同公司多单合并', () => {
    const gs = splitByPayCompany(it0)
    expect(gs.map(g => g.companyId)).toEqual([3, 5])
    expect(gs[0].lines.map(l => l.feeKey)).toEqual(['elec', 'water'])
    expect(gs[0].total).toBe(110)
    expect(gs[1].total).toBe(20)
  })
  it('租金行不进水电通知单', () => {
    const gs = splitByPayCompany({
      ...it0, details: [detail(3, [line({ feeKey: 'rent_factory', amount: 999, feeGroup: 'rent' })])],
    })
    expect(gs).toEqual([])
  })
  it('未指定收款公司的单独立成联(companyId=null)', () => {
    const gs = splitByPayCompany({ ...it0, details: [detail(null, [line({ amount: 5 })])] })
    expect(gs[0].companyId).toBeNull()
  })
})

describe('buildNoticeSections 行序与块结构(源册王红婷 sheet 逐块)', () => {
  const secs = buildNoticeSections(wangElec, noNotes)
  it('四块按 电费/用电维护费/水费/用水维护费 定序,空块不出现', () => {
    expect(secs.map(s => s.label)).toEqual(['电费', '水费'])
    expect(secs.map(s => s.water)).toEqual([false, true])
  })
  it('电费块=装机容量费+分时行,合计与实际用量合计各自累加', () => {
    const e = secs[0]
    expect(e.rows.map(r => r.name)).toEqual(['装机容量费', '峰', '平'])
    expect(e.total).toBe(819.76)
    expect(e.qtyTotal).toBe(256.5)   // 144+112.5;装机容量费不入用量合计(源册 I11 同)
  })
  it('装机容量费:实际用量列走「N千伏安」文本,不入用量合计', () => {
    const r = secs[0].rows[0]
    expect(r.qtyText).toBe('25千伏安')
    expect(r.qty).toBeNull()
    expect(r.meterQty).toBeNull()
    expect(r.price).toBe(22.6)
  })
  it('分时行:上月/本月行至+倍率+用量+单价,项目名=段名(单表不冠表名)', () => {
    const r = secs[0].rows[1]
    expect([r.prev, r.curr, r.factor, r.qty, r.amount]).toEqual([54.99, 59.79, 30, 144, 173.67])
    // 单价走 billQtyCell「能验算的最少位数」口径(与屏上同源):144×1.20607=173.67 验得平,
    // 落库原值 1.20606875 不直接印(S7 拍板;源册手工表印全精度,此处刻意与屏一致)
    expect(r.price).toBe(1.20607)
    expect(r.meterQty).toBe(144)
  })
  it('水费块项目名=表名(源册 D13「水表1」)', () => {
    expect(secs[1].rows.map(r => r.name)).toEqual(['水表①'])
    expect(secs[1].qtyTotal).toBe(4)
  })
  it('多表块给项目名冠表名(单表不冠,保源册原样)', () => {
    const two = buildNoticeSections([
      line({ feeKey: 'elec', seg: 'peak', meterLabel: '电表①', qty: 1, priceSnap: 1, amount: 1 }),
      line({ feeKey: 'elec', seg: 'peak', meterLabel: '电表②', qty: 2, priceSnap: 1, amount: 2 }),
    ], noNotes)
    expect(two[0].rows.map(r => r.name)).toEqual(['电表① 峰', '电表② 峰'])
  })
  it('多场地块给项目名冠场地', () => {
    const two = buildNoticeSections([
      line({ feeKey: 'water', premise: 'A座101', meterLabel: '水表①', qty: 1, priceSnap: 1, amount: 1, feeGroup: 'water' }),
      line({ feeKey: 'water', premise: 'B座201', meterLabel: '水表①', qty: 2, priceSnap: 1, amount: 2, feeGroup: 'water' }),
    ], noNotes)
    expect(two[0].rows.map(r => r.name)).toEqual(['A座101 水表①', 'B座201 水表①'])
  })
})

describe('公摊三类行形状(源册 R40-R43/R47 逐格)', () => {
  // 电梯用电:H「每层」/ I 每层单价 / J「元，共N层」/ K 金额
  it('份数型(shareSrc=floor):每层单价=金额÷份数', () => {
    const [s] = buildNoticeSections([
      line({ feeKey: 'share_elec_elevator', shareSrc: 'floor', baseSnap: 0.11, qty: 5, priceSnap: 1, amount: 23.91 }),
    ], noNotes)
    const r = s.rows[0]
    expect([r.name, r.h, r.qty, r.priceText, r.amount]).toEqual(['电梯用电', '每层', 217.36, '元，共0.11层', 23.91])
    expect(r.meterQty).toBeNull()
  })
  // 线路损耗:I 金额基数(0.00) / J 损耗率(0.00%) / L「用电总金额×损耗率」
  it('损耗型:基数×率,备注固定「用电总金额×损耗率」', () => {
    const [s] = buildNoticeSections([
      line({ feeKey: 'share_elec_loss', baseSnap: 487.29, priceSnap: 0.0287, qty: 100, amount: 13.99 }),
    ], noNotes)
    const r = s.rows[0]
    expect([r.name, r.qty, r.qtyIsMoney, r.price, r.priceIsPct]).toEqual(['线路损耗', 487.29, true, 0.0287, true])
    expect(r.note).toBe('用电总金额×损耗率')
  })
  // 路灯公摊:E:G 面积 / H「㎡」/ J 单价 / L「面积×公摊单价」
  it('面积型(shareSrc=area):面积走 E:G,单价取 billQtyCell 口径', () => {
    const [s] = buildNoticeSections([
      line({ feeKey: 'share_elec_light', shareSrc: 'area', baseSnap: 517, priceSnap: 0.005, qty: 2, amount: 2.59 }),
    ], noNotes)
    const r = s.rows[0]
    expect([r.name, r.area, r.h, r.price, r.amount]).toEqual(['路灯公摊', 517, '㎡', 0.005, 2.59])
    expect(r.note).toBe('面积×公摊单价')
    expect(r.qty).toBeNull()
  })
  it('维护费块过 mergeMaintRows:同项多池并一行,金额求和', () => {
    const [s] = buildNoticeSections([
      line({ feeKey: 'share_elec_floor', shareSrc: 'floor', baseSnap: 1, poolName: '甲池', amount: 10 }),
      line({ feeKey: 'share_elec_floor', shareSrc: 'floor', baseSnap: 2, poolName: '乙池', amount: 20 }),
    ], noNotes)
    expect(s.label).toBe('用电维护费')
    expect(s.rows.map(r => [r.name, r.amount])).toEqual([['楼层公共、消防照明', 30]])
    expect(s.rows[0].priceText).toBe('元，共3层')   // 份数求和
  })
  // 维护费块只有一列项目名:独苗 mgmt_fee/water_pipe(mergeMaintRows 单表不并)必须报费项名,不是表名
  it('维护费块独苗行报费项名而非表名', () => {
    const [s] = buildNoticeSections([
      line({ feeKey: 'mgmt_fee', meterLabel: '电表①', qty: 373.8, priceSnap: 0.16, amount: 59.81 }),
      line({ feeKey: 'water_pipe', meterLabel: '水表①', qty: 4, priceSnap: 0.5, amount: 2, feeGroup: 'water' }),
    ], noNotes)
    expect(s.rows.map(r => r.name)).toEqual(['电力管理费'])
  })
  it('备注人工覆盖优先于引擎备注', () => {
    const l = line({ feeKey: 'elec', seg: 'peak', qty: 1, priceSnap: 1, amount: 1, note: '引擎原文' })
    const [s] = buildNoticeSections([l], new Map([[JSON.stringify(['elec', '', '', 'peak']), '人工改写']]))
    expect(s.rows[0].note).toBe('人工改写')
  })
})

describe('noticeFileName 文件名(spec §5.1)', () => {
  it('公司文件夹 + 通知单-YYYY年MM月-户名.xlsx', () =>
    expect(noticeFileName('一泽', '2024-02', '王红婷')).toBe('一泽/水电费缴费通知单-2024年02月-王红婷.xlsx'))
  it('非法字符剔除(sanitize 同 billExcel)', () =>
    expect(noticeFileName('一泽/A', '2024-02', '甲*乙?丙')).toBe('一泽A/水电费缴费通知单-2024年02月-甲乙丙.xlsx'))
  it('无收款公司落「未指定收款公司」文件夹', () =>
    expect(noticeFileName(null, '2024-02', '王红婷')).toBe('未指定收款公司/水电费缴费通知单-2024年02月-王红婷.xlsx'))
})

describe('buildReconSheet 对账表(spec §5.2:户 × 费项 × 金额)', () => {
  const rows = [
    { companyId: 3, tenantId: 1, tenantName: '甲', feeKey: 'elec', amount: 100 },
    { companyId: 3, tenantId: 1, tenantName: '甲', feeKey: 'water', amount: 10 },
    { companyId: 3, tenantId: 2, tenantName: '乙', feeKey: 'elec', amount: 50 },
    { companyId: null, tenantId: 3, tenantName: '丙', feeKey: 'elec', amount: 7 },
  ]
  it('列=费项(中文名),行=户,末列合计,末行列合计', () => {
    const aoa = buildReconSheet(rows.filter(r => r.companyId === 3))
    expect(aoa[0]).toEqual(['租户', '电费', '水费', '合计'])
    expect(aoa[1]).toEqual(['甲', 100, 10, 110])
    expect(aoa[2]).toEqual(['乙', 50, 0, 50])
    expect(aoa[3]).toEqual(['合计 · 2 户', 150, 10, 160])
  })
  it('同户同费项跨单累加', () => {
    const aoa = buildReconSheet([rows[0], { ...rows[0], amount: 5 }])
    expect(aoa[1]).toEqual(['甲', 105, 105])
  })
  it('空行集给出只有表头的空表', () =>
    expect(buildReconSheet([])).toEqual([['租户', '合计'], ['合计 · 0 户', 0]]))
})

// ── exceljs 出流通性验证(不比对二进制:只验能写出非空 xlsx 且回读得到锚点格) ──
// 出流两例要真 import exceljs(~500KB)再写读一遍 workbook:单跑 ~0.6s,但全量并发时
// 与 deriveSweep(44s 真文件扫描)抢 CPU 会破 5s 默认阈值。给 30s 而不是让它间歇性红。
describe('exceljs 出流', { timeout: 30_000 }, () => {
  const item: NoticeExportItem = {
    tenantId: 7, tenantName: '王红婷', premiseText: '二期12号楼\n六楼602室', notes: noNotes,
    details: [detail(3, wangElec)],
  }
  it('通知单 workbook 写得出且回读锚点格对得上', async () => {
    const bytes = await noticeWorkbookBytes(
      splitByPayCompany(item)[0], item, '2024-02',
      { kind: 'bank', accountName: '佛山一泽科技有限公司', accountNo: '800 200 000 193 366 78', bankName: '广东南海农商行里水太行支行' },
      { id: 3, name: '一泽', short: '一泽', fullName: '佛山一泽科技有限公司' })
    expect(bytes.byteLength).toBeGreaterThan(2000)
    const ExcelJS = (await import('exceljs')).Workbook
    const wb = new ExcelJS()
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    const ws = wb.worksheets[0]
    expect(ws.getCell('B1').value).toBe('水电费缴费通知单')
    expect(ws.getCell('B2').value).toBe('计费期限：2024年2月')
    expect(ws.getCell('B3').value).toBe('租户名称：王红婷')
    expect(ws.getCell('B4').value).toBe('项目')
    expect(ws.getCell('L4').value).toBe('备注')
    const all = ws.getSheetValues().flatMap(r => (Array.isArray(r) ? r : [])).map(v => String(v ?? ''))
    expect(all.some(t => t.includes('户名：佛山一泽科技有限公司') && t.includes('开户行：'))).toBe(true)
    expect(all).toContain('电费合计')
    expect(all).toContain('水电费合计')
    expect(ws.getColumn(4).width).toBe(17.43)
    expect(ws.pageSetup.orientation).toBe('portrait')
    expect(ws.pageSetup.scale).toBe(85)
  })
  it('无账户信息 → 收款语与账户块整块省略(源册 17/56 户即如此)', async () => {
    const bytes = await noticeWorkbookBytes(splitByPayCompany(item)[0], item, '2024-02', null, null)
    const ExcelJS = (await import('exceljs')).Workbook
    const wb = new ExcelJS()
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    const ws = wb.worksheets[0]
    const texts = ws.getSheetValues().flatMap(r => (Array.isArray(r) ? r : [])).map(v => String(v ?? ''))
    expect(texts.some(t => t.includes('存入我公司以下账户'))).toBe(false)
    expect(texts.some(t => t.includes('通知单签收信息栏'))).toBe(true)
  })
  it('对账表 workbook 写得出,总表在首、每公司一 sheet', async () => {
    const bytes = await reconWorkbookBytes(
      [{ companyId: 3, tenantId: 1, tenantName: '甲', feeKey: 'elec', amount: 100 },
        { companyId: null, tenantId: 2, tenantName: '乙', feeKey: 'water', amount: 7 }],
      '2024-02', [{ companyId: 3, name: '一泽' }, { companyId: null, name: '未指定收款公司' }])
    const ExcelJS = (await import('exceljs')).Workbook
    const wb = new ExcelJS()
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    expect(wb.worksheets.map(w => w.name)).toEqual(['总表', '一泽', '未指定收款公司'])
    expect(wb.getWorksheet('一泽')!.getCell('A1').value).toBe('租户')
  })
})
