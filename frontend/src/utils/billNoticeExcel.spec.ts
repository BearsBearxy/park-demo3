import { describe, expect, it } from 'vitest'
import type { BillNoticeLineDTO } from '@/api/billNotices'
import {
  buildNoticeSections, buildReconSheet, buildRentBlocks, noticeFileName, reconWorkbookBytes,
  splitByPayCompany, tenantWorkbookBytes, type NoticeExportItem,
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
  // 2026-08-14 改:租金随联带出(同一张单、同一家收款公司),落到通知单上表
  it('租金行随联带出,与水电分列 rent/lines 两侧', () => {
    const gs = splitByPayCompany({
      ...it0,
      details: [detail(3, [
        line({ feeKey: 'rent_factory', amount: 999, feeGroup: 'rent' }),
        line({ feeKey: 'elec', amount: 100 }),
      ])],
    })
    expect(gs).toHaveLength(1)
    expect(gs[0].rent.map(l => l.feeKey)).toEqual(['rent_factory'])
    expect(gs[0].lines.map(l => l.feeKey)).toEqual(['elec'])
    expect([gs[0].rentTotal, gs[0].total]).toEqual([999, 100])
  })
  it('只有租金行的单也成联(改前会被整联丢掉)', () => {
    const gs = splitByPayCompany({
      ...it0, details: [detail(3, [line({ feeKey: 'rent_factory', amount: 999, feeGroup: 'rent' })])],
    })
    expect([gs.length, gs[0].rentTotal, gs[0].total]).toEqual([1, 999, 0])
  })
  it('未指定收款公司的单独立成联(companyId=null)', () => {
    const gs = splitByPayCompany({ ...it0, details: [detail(null, [line({ amount: 5 })])] })
    expect(gs[0].companyId).toBeNull()
  })
})

// 源册锚点(二期2024年03月租金.xlsx / 丁天伦 sheet 的通知单块 B34:I40)
describe('buildRentBlocks 租金表(源册租金通知单块逐列)', () => {
  const dingLines = [
    line({ feeKey: 'rent_factory', premise: '二期13号楼（六车间）501室', qty: 1700, priceSnap: 11.435, amount: 19439.5, feeGroup: 'rent' }),
    line({ feeKey: 'mgmt', premise: '二期13号楼（六车间）501室', qty: 1700, priceSnap: 5, amount: 8500, feeGroup: 'rent' }),
    line({ feeKey: 'infra', premise: '二期13号楼（六车间）501室', qty: 1700, priceSnap: 1.8, amount: 3060, feeGroup: 'rent' }),
    line({ feeKey: 'elevator', premise: '二期13号楼（六车间）501室', amount: 300, feeGroup: 'rent' }),
  ]
  it('按 premise 分块,收费项目走 rentFeeName(mgmt/infra 带段类型前缀)', () => {
    const { blocks, total } = buildRentBlocks(dingLines, noNotes)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].label).toBe('二期13号楼（六车间）501室')
    expect(blocks[0].rows.map(r => r.name))
      .toEqual(['厂房租金', '厂房企业管理服务费', '厂房基础设施维护费', '电梯维护费'])
    expect(total).toBe(31299.5)
  })
  it('面积落建筑面积列,月单价=面积×单价(源册 E/F/G 三列)', () => {
    const [r0] = buildRentBlocks(dingLines, noNotes).blocks[0].rows
    expect([r0.landArea, r0.bldArea, r0.unitPrice, r0.monthly, r0.amount])
      .toEqual([null, 1700, 11.435, 19439.5, 19439.5])
  })
  it('无面积的按月固定项:月单价回落金额(源册 G38=H38=300)', () => {
    const rows = buildRentBlocks(dingLines, noNotes).blocks[0].rows
    expect([rows[3].bldArea, rows[3].unitPrice, rows[3].monthly]).toEqual([null, null, 300])
  })
  it('空地段的面积落空地面积列', () => {
    const [b] = buildRentBlocks(
      [line({ feeKey: 'rent_land', premise: '消防通道', qty: 179.7, priceSnap: 6.7, amount: 1203.99, feeGroup: 'rent' })],
      noNotes).blocks
    expect([b.rows[0].landArea, b.rows[0].bldArea]).toEqual([179.7, null])
  })
  it('带公摊面积时建筑面积列显拆解串(同抽屉 rentAreaText)', () => {
    const [b] = buildRentBlocks(
      [line({ feeKey: 'rent_office', premise: 'A座602室', qty: 1528, baseSnap: 1986, priceSnap: 10, amount: 15280, feeGroup: 'rent' })],
      noNotes).blocks
    expect(b.rows[0].bldArea).toBe('1528+458')
  })
  it('折算行:月单价(标准额)与应收金额分开,算式在备注', () => {
    const [b] = buildRentBlocks(
      [line({ feeKey: 'rent_factory', premise: 'X', qty: 100, priceSnap: 10, amount: 723.9, note: '1000÷29×21', feeGroup: 'rent' })],
      noNotes).blocks
    expect([b.rows[0].monthly, b.rows[0].amount, b.rows[0].note]).toEqual([1000, 723.9, '1000÷29×21'])
  })
  it('备注人工覆盖优先于引擎备注', () => {
    const [b] = buildRentBlocks(
      [line({ feeKey: 'rent_factory', premise: 'X', amount: 1, note: '引擎原文', feeGroup: 'rent' })],
      new Map([[JSON.stringify(['rent_factory', 'X', '', '']), '人工改写']])).blocks
    expect(b.rows[0].note).toBe('人工改写')
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

// 2026-08-14 改:一户一个文件,不再有公司文件夹(一户可能要给几家公司转账,分文件夹会把同户单据拆散)
describe('noticeFileName 文件名(spec §5.1)', () => {
  it('平铺文件名,无公司目录', () =>
    expect(noticeFileName('2024-02', '王红婷')).toBe('费用缴费通知单-2024年02月-王红婷.xlsx'))
  it('非法字符剔除(sanitize 同 billExcel)', () =>
    expect(noticeFileName('2024-02', '甲*乙?丙/丁')).toBe('费用缴费通知单-2024年02月-甲乙丙丁.xlsx'))
  it('无户名兜底', () =>
    expect(noticeFileName('2024-02', null)).toBe('费用缴费通知单-2024年02月-租户.xlsx'))
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
  const yize = { id: 3, name: '一泽', short: '一泽', fullName: '佛山一泽科技有限公司' }
  const yizeAcct = {
    kind: 'bank', accountName: '佛山一泽科技有限公司',
    accountNo: '800 200 000 193 366 78', bankName: '广东南海农商行里水太行支行',
  }
  const load = async (bytes: Uint8Array) => {
    const ExcelJS = (await import('exceljs')).Workbook
    const wb = new ExcelJS()
    await wb.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength))
    return wb
  }
  const texts = (ws: { getSheetValues(): unknown[] }) =>
    ws.getSheetValues().flatMap(r => (Array.isArray(r) ? r : [])).map(v => String(v ?? ''))

  it('通知单 workbook 写得出且回读锚点格对得上', async () => {
    const { bytes, sheets } = await tenantWorkbookBytes(item, '2024-02', () => yizeAcct, () => yize)
    expect(bytes.byteLength).toBeGreaterThan(2000)
    expect(sheets).toBe(1)
    const ws = (await load(bytes)).worksheets[0]
    expect(ws.name).toBe('王红婷')            // 单联=户名
    expect(ws.getCell('B1').value).toBe('费用缴费通知单')
    expect(ws.getCell('B2').value).toBe('计费期限：2024年2月')
    expect(ws.getCell('B3').value).toBe('租户名称：王红婷')
    expect(ws.getCell('B4').value).toBe('项目')   // 无租金行 → 水电表直接接在户头下
    expect(ws.getCell('L4').value).toBe('备注')
    const all = texts(ws)
    expect(all.some(t => t.includes('户名：佛山一泽科技有限公司') && t.includes('开户行：'))).toBe(true)
    expect(all).toContain('电费合计')
    expect(all).toContain('水电费合计')
    expect(ws.getColumn(4).width).toBe(17.43)
    expect(ws.pageSetup.orientation).toBe('portrait')
    expect(ws.pageSetup.scale).toBe(85)
  })
  it('租金在上表、水电在下表,本期合计=两块之和', async () => {
    const withRent: NoticeExportItem = {
      ...item,
      details: [detail(3, [
        line({ feeKey: 'rent_factory', premise: '二期12号楼602室', qty: 100, priceSnap: 10, amount: 1000, feeGroup: 'rent' }),
        ...wangElec,
      ])],
    }
    const { bytes } = await tenantWorkbookBytes(withRent, '2024-02', () => null, () => yize)
    const ws = (await load(bytes)).worksheets[0]
    expect(ws.getCell('B4').value).toBe('租金、物业维护费')   // 上表标题在户头之后
    expect(ws.getCell('B5').value).toBe('物业名称')
    expect(ws.getCell('K5').value).toBe('应收金额（元）')
    expect(ws.getCell('B6').value).toBe('二期12号楼602室')     // B:C 竖跨物业名称
    expect(ws.getCell('D6').value).toBe('厂房租金')
    const all = texts(ws)
    expect(all).toContain('租金、物业维护费合计')
    expect(all).toContain('水电费')                            // 下表标题
    expect(all).toContain('水电费合计')
    // 本期合计 = 1000 租金 + 835.56 水电(819.76 电 + 15.8 水)
    expect(all).toContain('本期合计')
    expect(ws.getSheetValues().flatMap(r => (Array.isArray(r) ? r : [])).includes(1835.56)).toBe(true)
  })
  it('跨两家收款公司 → 同一 workbook 内两个 sheet,按公司命名', async () => {
    const two: NoticeExportItem = {
      ...item,
      details: [
        detail(3, [line({ feeKey: 'elec', amount: 100 })]),
        detail(5, [line({ feeKey: 'mgmt_fee', amount: 20 })], { payCompanyName: '积前' }),
      ],
    }
    const { bytes, sheets } = await tenantWorkbookBytes(two, '2024-02', () => null,
      id => (id === 3 ? yize : { id: 5, name: '积前', short: '积前', fullName: '佛山积前实业有限公司' }))
    expect(sheets).toBe(2)
    expect((await load(bytes)).worksheets.map(w => w.name)).toEqual(['一泽', '积前'])
  })
  it('无账户信息 → 收款语与账户块整块省略(源册 17/56 户即如此)', async () => {
    const { bytes } = await tenantWorkbookBytes(item, '2024-02', () => null, () => null)
    const ws = (await load(bytes)).worksheets[0]
    const all = texts(ws)
    expect(all.some(t => t.includes('存入我公司以下账户'))).toBe(false)
    expect(all.some(t => t.includes('通知单签收信息栏'))).toBe(true)
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
