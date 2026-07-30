import { describe, it, expect } from 'vitest'
import { parseMeterSheet, parseMeterWorkbook, buildMeterTemplateAoa, buildMeterExportAoa } from './meterExcel'
import { readingFlags } from './meterLogic'

// 夹具 = 审计实测真实版式(202405水电表数据表.xlsx):标题行+双行表头(电)/单行表头(水)+脏数据
const ELEC_SHEET: string[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
  ['', '2024年5月二期园区电表抄表记录'],
  ['', '区域', '', '企业名称', '表类', '电表名称', '电表编码', '电表倍率', '上月行至', '', '', '', '', '本月行至', '', '', '', '', '本月用电量', '', '', '', '', '备注'],
  ['', '', '', '', '', '', '', '', '总', '尖', '峰', '平', '谷', '总', '尖', '峰', '平', '谷', '总', '尖', '峰', '平', '谷', ''],
  ['二期总电', '二期园区变压器', '', '', '总电表', '总电表', '', '12000', '459.21', '102.72', '116.21', '183.66', '56.6', '508.85', '113.37', '128.56', '202.55', '64.36', '595680', '127800', '', '', '', ''],
  ['一车间消防', '一车间', '', '消防', '公共用电/已分摊', '电表①', '221103010062', '30', '81.74', '10.38', '13.75', '30.61', '26.98', '89.53', '11.35', '15.05', '33.53', '29.58', '233.7', '29.1', '', '', '', '损耗率备注游离列'],
  ['A座总电', 'A座', '', '', '总电表', '总电表', '', '1500', '1540.85', '', '456.92', '796.44', '287.48', '', '', '', '', '', '-2311275', '', '', '', '', ''],  // 缺本月读数=漏抄
  ['', '小计游离行'],   // 标识列空 → 剔除
  ['一车间总用电量', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '34478.6'],   // Excel 车间汇总行 → 剔除
  ['某表', '二车间总用电量', '', '', '', '', '', '', '1', '', '', '', '', '2'],   // 区域列命中汇总关键词 → 剔除
]

const WATER_SHEET: string[][] = [
  ['', '2024年5月宿舍水表抄表记录'],
  ['', '区域', '', '', '企业名称', '面积', '表类', '水表名称', '水表编码', '水表倍率', '上月行至', '本月行至', '本月用水量', '备注'],
  ['宿舍总水', '宿舍', '', '', '', '', '总水表', '总水表', '', '1', '279467', '', '-279467', ''],
  ['工地宿舍水1', '三期工地工人宿舍', '', '', '接绿化水管水表', '', '户内用水', '水表①', '923110030', '1', '45', '88.53', '43.53', ''],
]

// 串味标题的分摊 sheet(真实文件实测:一期租户分摊公共用电金额 sheet 标题也写「抄表记录」):表头无行至列 → 闸门②拒收
const FAKE_TITLE_SHEET: string[][] = [
  ['', '2024年1月一期园区电表抄表记录'],
  ['', '区域', '', '企业名称', '租赁面积', '分摊项目', '', '', '孵化协议固定收取', '盈/亏', '备注'],
  ['旭化成A101公共', 'A座', '一楼101室', '旭化成', '489', '0'],
]

describe('parseMeterSheet — 电表 TOU 双行表头', () => {
  const sec = parseMeterSheet('二期园区电', ELEC_SHEET)!
  it('识别分区/类别/月份并入段标签', () => {
    expect(sec.label).toBe('二期电表 · 2024年5月 · 3块表')
  })
  it('行契约:档案字段+总/四段读数;倍率/编码落位', () => {
    const r = sec.records[0]
    expect(r).toMatchObject({
      kind: 'elec', zone: 'p2', name: '二期总电', ym: '2024-05',
      area: '二期园区变压器', meterType: '总电表', factor: 12000,
      prevTotal: 459.21, currTotal: 508.85, prevSharp: 102.72, currValley: 64.36,
    })
    expect(sec.records[1]).toMatchObject({ name: '一车间消防', code: '221103010062', factor: 30, tenantName: '消防' })
  })
  it('缺本月读数=null 照收(漏抄进系统标黄,不算错误行);标识空行剔除', () => {
    const r = sec.records[2]
    expect(r.currTotal).toBeNull()
    expect(r.prevTotal).toBe(1540.85)
    expect(sec.records).toHaveLength(3)
  })
  it('Excel 车间汇总行剔除(标识或区域列含 总用电量/合计,防脏档案 id1135-1138 复发)', () => {
    expect(sec.records.map(r => r.name)).not.toContain('一车间总用电量')
    expect(sec.records.map(r => r.name)).not.toContain('某表')
    expect(sec.records).toHaveLength(3)
  })
})

describe('parseMeterSheet — 水表单行表头 & 闸门', () => {
  it('水表:无 TOU 子头,数据紧跟表头行;宿舍双空位列拼 spot', () => {
    const sec = parseMeterSheet('宿舍水', WATER_SHEET)!
    expect(sec.records[0]).toMatchObject({ kind: 'water', zone: 'dorm', name: '宿舍总水', ym: '2024-05', prevTotal: 279467, currTotal: null })
    expect(sec.records[1]).toMatchObject({ tenantName: '接绿化水管水表', code: '923110030', currTotal: 88.53 })
  })
  it('闸门②:标题串味但表头无「上月/本月行至」的分摊 sheet 拒收', () => {
    expect(parseMeterSheet('一期租户分摊公共用电金额', FAKE_TITLE_SHEET)).toBeNull()
  })
  it('无标题 sheet(租户缴费单等)拒收', () => {
    expect(parseMeterSheet('金纳', [['', '缴费通知单'], ['', '计费期限:2024年2月']])).toBeNull()
  })
})

describe('parseMeterWorkbook — 整册 sections', () => {
  it('多 sheet → sections 勾选段;混入未识别 sheet 静默跳过', () => {
    const res = parseMeterWorkbook([
      { name: '二期园区电', matrix: ELEC_SHEET },
      { name: '宿舍水', matrix: WATER_SHEET },
      { name: '金纳', matrix: [['', '缴费通知单']] },
    ])
    expect(res.sections).toHaveLength(2)
    expect(res.records).toBeUndefined()
  })
  it('仅 1 段平铺为 records;全不识别=整批错误', () => {
    expect(parseMeterWorkbook([{ name: '宿舍水', matrix: WATER_SHEET }]).records).toHaveLength(2)
    expect(parseMeterWorkbook([{ name: 'x', matrix: [['abc']] }]).error).toContain('抄表记录')
  })
})

describe('模板/导出 ↔ 解析器互认(修正回路)', () => {
  it('模板骨架(含示例行)可被解析器读回', () => {
    const elec = parseMeterSheet('一期园区电', buildMeterTemplateAoa('p1', 'elec', '2026-07').map(r => r.map(String)))!
    expect(elec.records[0]).toMatchObject({ zone: 'p1', kind: 'elec', ym: '2026-07', name: '示例总电', factor: 500 })
    const water = parseMeterSheet('二期园区水', buildMeterTemplateAoa('p2', 'water', '2026-07').map(r => r.map(String)))!
    expect(water.records[0]).toMatchObject({ zone: 'p2', kind: 'water', currTotal: 2137 })
  })
  it('导出 aoa 可被解析器读回(改后直接重导)', () => {
    const meters = [{ id: 7, kind: 'elec', zone: 'p1', name: 'A座总电', area: 'A座', factor: 1500, meterType: '总电表' }]
    const readings = [{ meterId: 7, prevTotal: 1540.85, currTotal: 1600, prevPeak: 456.92, currPeak: 470 }]
    const aoa = buildMeterExportAoa('p1', 'elec', '2024-05', meters, readings).map(r => r.map(String))
    const sec = parseMeterSheet('一期园区电', aoa)!
    expect(sec.records[0]).toMatchObject({ name: 'A座总电', ym: '2024-05', prevTotal: 1540.85, currTotal: 1600, prevPeak: 456.92, factor: 1500 })
  })
})

// ── v2 结构化拆分接入(§6.2-§6.4):tenantId/buildingId/ownership 挂行 + 预览列改拆分结果 ──
describe('parseMeterSheet — v2 主数据拆分', () => {
  const TENANTS = [
    { id: 11, companyName: '力灏' }, { id: 12, companyName: '桑尼号' },
    { id: 21, companyName: '邓宇峰（一）' }, { id: 22, companyName: '邓宇峰（二）' },
  ]
  const BUILDINGS = [
    { id: 1, name: '一期 A座' }, { id: 2, name: '一期 B座' },
    { id: 3, name: '一期 宿舍一栋' }, { id: 5, name: '二期 一车间' },
  ]
  const master = { tenants: TENANTS, buildings: BUILDINGS }
  const V2_WATER: string[][] = [
    ['', '2025年3月一期园区水表抄表记录'],
    ['', '区域', '', '企业名称', '表类', '水表名称', '水表编码', '水表倍率', '上月行至', '本月行至', '备注'],
    ['力灏水', 'B座', '', '1-3楼（力灏）', '户内用水', '水表①', '', '1', '10', '20', ''],
    ['桑尼水', 'C座', '', '桑尼号西侧', '户内用水', '水表①', '', '1', '5', '8', ''],
    ['邓宇峰水', 'A座', '', '邓宇峰（高区）', '户内用水', '水表①', '', '1', '3', '4', ''],
    ['水泵水', 'A座', '', '生活水泵', '公共用水', '水表①', '', '1', '1', '2', ''],
  ]
  const sec = parseMeterSheet('一期园区水', V2_WATER, master)!

  it('括号拆分:租户挂 id,方位入 spot,原文保留 tenantName;§6.4 预览列', () => {
    expect(sec.records[0]).toMatchObject({
      tenantId: 11, buildingId: 2, ownership: 'tenant', spot: '1-3楼', tenantName: '1-3楼（力灏）',
    })
    expect(sec.records[0].__preview).toEqual(['一期', '一期 B座', '1-3楼', '力灏', '租户', 1, 10, 20, ''])
  })
  it('无括号连写:桑尼号西侧 → 剥方位后缀匹配', () => {
    expect(sec.records[1]).toMatchObject({ tenantId: 12, ownership: 'tenant', spot: '西侧' })
  })
  it('多命中待核:邓宇峰×2 → tenantId 空,仍归租户表,预览显原文+待核', () => {
    expect(sec.records[2]).toMatchObject({ tenantId: null, ownership: 'tenant', spot: '高区', tenantName: '邓宇峰（高区）' })
    expect(sec.records[2].__preview![3]).toBe('邓宇峰（高区）(待核)')
  })
  it('公共表:水泵→ops 不做租户匹配;区域→楼栋映射照挂', () => {
    expect(sec.records[3]).toMatchObject({ tenantId: null, ownership: 'ops', buildingId: 1 })
    expect(sec.records[3].__preview![4]).toBe('园区经营')
  })
  it('归属分类:总电表→infra;消防→share;变压器区域无楼栋映射=null;主数据缺省不炸(v1 行为兜底)', () => {
    const elec = parseMeterSheet('二期园区电', ELEC_SHEET, master)!
    expect(elec.records[0]).toMatchObject({ ownership: 'infra', buildingId: null })
    expect(elec.records[1]).toMatchObject({ ownership: 'share', buildingId: 5, tenantId: null })   // 一车间→二期 一车间
    const bare = parseMeterSheet('二期园区电', ELEC_SHEET)!
    expect(bare.records[1]).toMatchObject({ ownership: 'share', tenantId: null, buildingId: null })
  })
  it('宿舍 zone:无栋号区域(宿舍/三期工地工人宿舍)不挂栋;户内未匹配=待核', () => {
    const water = parseMeterSheet('宿舍水', WATER_SHEET, master)!
    expect(water.records[1]).toMatchObject({ ownership: 'tenant', tenantId: null, buildingId: null })
  })
})

describe('readingFlags — 异常标记纯函数', () => {
  const base = { currTotal: 100, usageTotal: 100, usageSharp: 25, usagePeak: 25, usageFlat: 25, usageValley: 25 }
  it('正常行零标记', () => {
    expect(readingFlags(base)).toEqual({ missing: false, negative: false, touMismatch: false })
  })
  it('漏抄:currTotal 空(手工表在这算出 -231万度,系统标黄不硬算)', () => {
    expect(readingFlags({ ...base, currTotal: null, usageTotal: null }).missing).toBe(true)
  })
  it('倒走:总用量<0', () => {
    expect(readingFlags({ ...base, usageTotal: -15768 }).negative).toBe(true)
  })
  it('时段不符:四段齐全 Σ段≠总超容差;缺段不判(公共表只有总)', () => {
    expect(readingFlags({ ...base, usageValley: 50 }).touMismatch).toBe(true)
    expect(readingFlags({ ...base, usageTotal: 100.5 }).touMismatch).toBe(false)   // 容差 max(1,1%) 内
    expect(readingFlags({ ...base, usageValley: null }).touMismatch).toBe(false)
  })
})

// ── 用户新模板(无标识列)+ 单元格归一(METER-IMPORT-SPEC §2) ──────────────────
// 与历史文件的唯一差别:去掉 A 列「标识」,A 列直接是「区域」。其余列按表头文字定位,零错位。
const USER_TPL: string[][] = [
  ['2024年2月一期园区电表抄表记录'],
  ['区域', '', '企业名称', '表类', '电表名称', '电表编码', '电表倍率', '上月行至', '', '', '', '', '本月行至', '', '', '', '', '本月用电量', '', '', '', '', '备注'],
  ['', '', '', '', '', '', '', '总', '尖', '峰', '平', '谷', '总', '尖', '峰', '平', '谷', '总', '尖', '峰', '平', '谷', ''],
  ['A座', '', '', '总电表', '总电表', '', '1500', '1439.86', '', '426.83', '745.13', '267.88', '1465.56', '', '434.42', '757.58', '273.55', '38550', '', '11385', '18675', '8505', ''],
  ['A座', '负一层', '地下车库东侧照明', '公共用电/已分摊', '电表①', '220605000150', '1', '686.24', '', '', '', '', '715.75', '', '', '', '', '29.51', '', '', '', '', ''],
  ['A座', '一楼101室', '旭化成', '户内用电', '电表③', '220605000036', '80', '2465.62', '', '', '', '', '2585.7', '', '', '', '', '9606.4', '', '', '', '', ''],
  ['A座', '二楼201室、202室', '旭化成', '户内用电', '电表⑤', '230828010084', '120', '185.24', '', '', '', '', '221.52', '', '', '', '', '4353.6', '', '', '', '', ''],
  ['A座', '一楼东侧', '公共用电/旭化成 停用', '户内用电', '电表①', '220605000107', '1', '56.01', '', '', '', '', '56.01', '', '', '', '', '0', '', '', '', '', ''],
  ['A座', '', '已停用', '户内用电', '电表①', '220605000021', '40', '375.83', '', '', '', '', '375.83', '', '', '', '', '0', '', '', '', '', ''],
  ['招商中心', '四楼', '招商中心', '总电表', '电表①', '220605000017', '80', '379.02', '', '', '', '', '387.74', '', '', '', '', '697.6', '', '', '', '', '招商中心用电:'],
  ['三期项目工地', '', '三车间', '', '', '230828010021', '80', '10', '', '', '', '', '12', '', '', '', '', '160', '', '', '', '', ''],
  ['A座总用电量', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '34876.5'],
]

describe('parseMeterSheet — 用户新模板(无标识列)', () => {
  const sec = parseMeterSheet('一期园区电', USER_TPL)!
  it('去掉标识列后 11 列自动对齐:总电表行不再塌缩成「A座」', () => {
    expect(sec.records).toHaveLength(8)
    expect(sec.records[0]).toMatchObject({
      kind: 'elec', zone: 'p1', ym: '2024-02', area: 'A座', meterType: '总电表', subName: '总电表',
      factor: 1500, prevTotal: 1439.86, currTotal: 1465.56, prevPeak: 426.83, currValley: 273.55,
      ownership: 'infra', code: undefined,
    })
    // 无标识列 → 合成标签 区域-位置-表名(§3.1);旧实现这 8 行 name 全取区域名,7 行塌缩成一块表
    expect(new Set(sec.records.map(r => r.name)).size).toBe(8)
    expect(sec.records[0].name).toBe('A座-总电表')
    expect(sec.records[1].name).toBe('A座-负一层-电表①')
  })
  it('公共已分摊/户内多房号/编码倍率逐行落位', () => {
    expect(sec.records[1]).toMatchObject({ spot: '负一层', tenantName: '地下车库东侧照明', code: '220605000150', factor: 1, ownership: 'share' })
    expect(sec.records[2]).toMatchObject({ spot: '一楼101室', tenantName: '旭化成', code: '220605000036', factor: 80, ownership: 'tenant' })
    expect(sec.records[3]).toMatchObject({ spot: '二楼201室、202室', code: '230828010084', factor: 120, name: 'A座-二楼201室、202室-电表⑤' })
  })
  it('停用占位行照收(前后读数相等=用量0),归属按标记判:公共用电/X 停用→公摊', () => {
    expect(sec.records[4]).toMatchObject({ ownership: 'share', prevTotal: 56.01, currTotal: 56.01 })
    expect(sec.records[5]).toMatchObject({ tenantName: '已停用', ownership: 'tenant', code: '220605000021' })
  })
  it('招商中心备注列、工地空表类行照收;段落合计行剔除', () => {
    expect(sec.records[6]).toMatchObject({ area: '招商中心', spot: '四楼', note: '招商中心用电:', ownership: 'infra' })
    expect(sec.records[7]).toMatchObject({ area: '三期项目工地', tenantName: '三车间', code: '230828010021', meterType: undefined })
    expect(sec.records.map(r => r.area)).not.toContain('A座总用电量')
  })
  it('表列用量只进预览做对照,不入库', () => {
    expect(sec.records[0].__preview![8]).toBe(38550)   // (1465.56−1439.86)×1500 = 38550,一致无 ⚠
    expect(sec.records[7].__preview![8]).toBe(160)     // (12−10)×80 = 160
    expect(sec.records[0].usageTotal).toBeUndefined()
  })
  it('表列用量与派生不符 → 预览打 ⚠(换表/手工调整的行)', () => {
    const bad = USER_TPL.map(r => [...r])
    bad[10][17] = '999'
    expect(String(parseMeterSheet('一期园区电', bad)!.records[7].__preview![8])).toContain('⚠')
  })
})

describe('单元格归一 & 合并续行(§2.2 / §2.1)', () => {
  const wrap = (body: string[][]): string[][] => [
    ['2025年3月一期园区水表抄表记录'],
    ['区域', '', '企业名称', '表类', '水表名称', '水表编码', '水表倍率', '上月行至', '本月行至', '备注'],
    ...body,
  ]
  it('日期型位置格 5/18/23 → 2023-05-18(mm-dd-yy 自有格式,dateNF 管不着)', () => {
    const sec = parseMeterSheet('一期园区水', wrap([['A座', '5/18/23', '某租户', '户内用水', '水表①', '1', '1', '1', '2', '']]))!
    expect(sec.records[0].spot).toBe('2023-05-18')
  })
  it('科学计数法编码按无编码处理并给整册 warning(有效位已丢不可还原)', () => {
    const m = wrap([['A座', '一层', 'X', '户内用水', '水表①', '2.20605E+11', '1', '1', '2', '']])
    const sec = parseMeterSheet('一期园区水', m)!
    expect(sec.records[0].code).toBeUndefined()
    expect(sec.sciCodes).toBe(1)
    expect(parseMeterWorkbook([{ name: '一期园区水', matrix: m }]).warning).toContain('科学计数法')
  })
  it('数值化编码去尾零(101.00 → 101:261 块宿舍影子表的成因)', () => {
    const sec = parseMeterSheet('一期园区水', wrap([['A座', '一层', 'X', '户内用水', '水表①', '923110030.00', '1', '1', '2', '']]))!
    expect(sec.records[0].code).toBe('923110030')
  })
  it('区域纵向合并:续行区域空但有其他内容 → 保留并继承上一区域(旧实现在这静默丢一半)', () => {
    const sec = parseMeterSheet('一期园区水', wrap([
      ['B座', '一层', 'X', '户内用水', '水表①', '111', '1', '1', '2', ''],
      ['', '二层', 'Y', '户内用水', '水表②', '222', '1', '3', '4', ''],
      ['', '', '', '', '', '', '', '', '', '这是一条游离备注'],
    ]))!
    expect(sec.records).toHaveLength(2)
    expect(sec.records[1]).toMatchObject({ area: 'B座', spot: '二层', code: '222' })
  })
})

// ── 账期降级(用户 2026-07-29 报障:「复制导入的之后必须要有表头,年月日」) ──
// 账期无法从数据推断(数据行里没有月份列)→ 标题缺了就用调用方(导入弹窗选择器)传入的 fallback。
describe('标题缺失 → fallback 账期/分区/类别', () => {
  // 用户「复制粘贴」式数据块:无标题行、无标识列、无任何年月线索
  const BARE: string[][] = [
    ['区域', '', '企业名称', '表类', '电表名称', '电表编码', '电表倍率', '上月行至', '本月行至', '备注'],
    ['一车间', '101室', '力灏', '户内用电', '电表①', '230220001238', '1', '100', '160', ''],
    ['', '102室', '碳紫', '户内用电', '电表②', '230220001239', '1', '5', '9', ''],
  ]

  it('裸数据块 + 指定 ym/zone/kind → 正常解析,段落标 ymSource=fallback', () => {
    const sec = parseMeterSheet('', BARE, {}, { ym: '2099-07', zone: 'p2', kind: 'elec' })!
    expect(sec.records).toHaveLength(2)
    expect(sec.ym).toBe('2099-07')
    expect(sec.ymSource).toBe('fallback')
    expect(sec.label).toContain('(按所选账期)')
    expect(sec.records[0]).toMatchObject({ kind: 'elec', zone: 'p2', ym: '2099-07', area: '一车间', code: '230220001238', prevTotal: 100, currTotal: 160 })
    expect(sec.records[1]).toMatchObject({ area: '一车间', ym: '2099-07' })   // 区域合并续行照常继承
  })

  it('没给 fallback 时裸数据块仍拒收(零行为变化)', () => {
    expect(parseMeterSheet('', BARE)).toBeNull()
  })

  it('标题齐全 → fallback 不生效,ymSource=title(历史文件零回归)', () => {
    const sec = parseMeterSheet('二期园区电', ELEC_SHEET, {}, { ym: '2099-07', zone: 'dorm', kind: 'water' })!
    expect(sec.ymSource).toBe('title')
    expect(sec.records[0]).toMatchObject({ ym: '2024-05', zone: 'p2', kind: 'elec' })
  })

  it('标题只缺月份 → 账期用 fallback,分区/类别仍取标题', () => {
    const noYm = ELEC_SHEET.map(r => [...r])
    noYm[1][1] = '二期园区电表抄表记录'
    const sec = parseMeterSheet('二期园区电', noYm, {}, { ym: '2099-08', zone: 'dorm', kind: 'water' })!
    expect(sec.ymSource).toBe('fallback')
    expect(sec.records[0]).toMatchObject({ ym: '2099-08', zone: 'p2', kind: 'elec' })
  })

  it('闸门②不放宽:无 区域+行至 表头的分摊 sheet,给了 fallback 也拒收', () => {
    expect(parseMeterSheet('一期租户分摊公共用电金额', FAKE_TITLE_SHEET, {}, { ym: '2099-07', zone: 'p1', kind: 'elec' })).toBeNull()
  })

  it('整册:用上 fallback 即回 notice 供弹窗披露;标题齐全则无 notice', () => {
    const res = parseMeterWorkbook([{ name: '', matrix: BARE }], {}, { ym: '2099-07', zone: 'p1', kind: 'elec' })
    expect(res.records).toHaveLength(2)
    expect(res.notice).toContain('2099-07')
    expect(parseMeterWorkbook([{ name: '二期园区电', matrix: ELEC_SHEET }]).notice).toBeUndefined()
  })

  it('错误文案可操作:表头认出来了但没账期 → 提示去上方选账期', () => {
    expect(parseMeterWorkbook([{ name: '', matrix: BARE }]).error).toContain('请在上方选择账期')
    expect(parseMeterWorkbook([{ name: '金纳', matrix: [['', '缴费通知单']] }]).error).toContain('上月行至')
  })
})
