import { describe, expect, it } from 'vitest'
import {
  FROZEN_HINT,
  bandFooter, buildLossReconRows, buildPoolExportAoa, costPerLine, foldQtySrcIds,
  groupPoolsByBookBlock, lineFloor, lineLabel, lineUseName, lossFooter, netSummary, POOL_LOC_HINT,
  poolAutoName, poolFeeLabel, poolFloor, poolFooter, poolLocKind, poolNote, poolSemantics,
  poolSpan, poolSubtitle, poolSubtotal, stdDisplay,
} from './poolLedgerLogic'
import type {
  AllocLossReconDTO, AllocLossUnitDTO, AllocMethod, AllocPoolLineDTO, AllocPoolRowDTO,
} from '@/api/alloc'

const pool = (p: Partial<AllocPoolRowDTO>): AllocPoolRowDTO => ({
  ruleId: 1, zone: 'p2', name: '一车间消防', bookBlock: null, bookKey: null, groupLabel: '一车间', method: 'floor',
  stdKind: null, roundScale: 2, baseKey: null, sortNo: 10, note: null,
  buildingId: 13, buildingName: '一车间', floorLabel: null, side: null, feeName: '消防',
  autoName: '一车间·消防', autoMembers: false, members: [],
  meters: [{ meterId: 9, name: '一车间消防', sign: 1, label: '一车间·电表①', spot: '一车间', subName: '电表①', meterType: '公共用电' }], links: [], lines: [],
  qtyTotal: null, qtySharp: null, qtyPeak: null, qtyFlat: null, qtyValley: null,
  extraQty: null, costAmount: null, baseSnap: null, stdValue: null, foldAdd: null,
  priceSnap: null, allocatedAmount: null, gapAmount: null, warn: null, ...p,
})

describe('poolSemantics 分摊语义标签', () => {
  it('floor=X层均摊', () => expect(poolSemantics(pool({ method: 'floor', baseSnap: 7 }))).toBe('7层均摊'))
  it('floor 小数层数不带浮点噪音', () =>
    expect(poolSemantics(pool({ method: 'floor', baseSnap: 5.8 }))).toBe('5.8层均摊'))
  it('area=X㎡分摊', () =>
    expect(poolSemantics(pool({ method: 'area', baseSnap: 1734.73 }))).toBe('1734.73㎡分摊'))
  it('未生成月基数null=方法字典回退', () =>
    expect(poolSemantics(pool({ method: 'area', baseSnap: null }))).toBe('按面积'))
  it('direct/none/ref 固定话术', () => {
    expect(poolSemantics(pool({ method: 'direct' }))).toBe('户对户')
    expect(poolSemantics(pool({ method: 'none' }))).toBe('不分摊')
    expect(poolSemantics(pool({ method: 'ref' }))).toBe('纯标准行')
  })
})

describe('stdDisplay 分摊标准与折入披露', () => {
  it('按 roundScale 定小数', () => {
    expect(stdDisplay(pool({ stdValue: 302.5, roundScale: 2 }))).toEqual({ text: '302.50', title: null })
    expect(stdDisplay(pool({ stdValue: 0.015, roundScale: 3 })).text).toBe('0.015')
  })
  it('折入档比 roundScale 多一位不截位(V46=0.015,scale2)', () => {
    expect(stdDisplay(pool({ stdValue: 0.015, foldAdd: 0.005, roundScale: 2 })).text).toBe('0.015')
  })
  it('null=–', () => expect(stdDisplay(pool({ stdValue: null }))).toEqual({ text: '–', title: null }))
  it('折入 title=基础+叠加(V46=0.01+0.005)', () =>
    expect(stdDisplay(pool({ stdValue: 0.015, foldAdd: 0.005, roundScale: 3 })).title).toBe('0.01+0.005'))
})

describe('§H3 二期 2023 冻结参数披露', () => {
  const NOTE = '冻结于 2023-05:『公共电分摊』(hidden) M99=0.005'
  it('无冻结参数=title 不变(不给所有池扣帽子)', () =>
    expect(stdDisplay(pool({ stdValue: 0.005, roundScale: 3 }), null).title).toBe(null))
  it('有冻结参数=title 出提示语+note 原文', () =>
    expect(stdDisplay(pool({ stdValue: 0.005, roundScale: 3 }), NOTE).title)
      .toBe(`${FROZEN_HINT} —— ${NOTE}`))
  it('折入与冻结同在=两行,折入在前', () =>
    expect(stdDisplay(pool({ stdValue: 0.015, foldAdd: 0.005, roundScale: 3 }), NOTE).title)
      .toBe(`0.01+0.005\n${FROZEN_HINT} —— ${NOTE}`))
  it('未生成月(std=null)照披露:冻结是池的属性,不是当月结果', () =>
    expect(stdDisplay(pool({ stdValue: null }), NOTE)).toEqual(
      { text: '–', title: `${FROZEN_HINT} —— ${NOTE}` }))
  it('提示语逐字锁死(spec §H3 屏上话术)', () =>
    expect(FROZEN_HINT).toBe('本值含 2023 年冻结参数,非当月价'))
})

describe('poolAutoName 池名自动生成(与后端 poolName 同规则)', () => {
  it('四级定位「·」连接,楼层+侧向合成一段,楼栋名原样(含空格)', () =>
    expect(poolAutoName('p1', '一期 A座', '四楼', '西侧', '走廊灯')).toBe('一期 A座·四楼西侧·走廊灯'))
  it('楼层空=整栋(货梯这类跨层池)', () =>
    expect(poolAutoName('p1', '一期 A座', null, null, '货梯')).toBe('一期 A座·货梯'))
  it('楼栋空=园区级,前缀取期别(三个「路灯」池靠期别区分,统一前缀会三撞一)', () => {
    expect(poolAutoName('p1', null, null, null, '路灯')).toBe('一期园区·路灯')
    expect(poolAutoName('p2', null, null, null, '路灯')).toBe('二期园区·路灯')
    expect(poolAutoName('dorm', null, null, null, '路灯')).toBe('宿舍区·路灯')
  })
  it('侧向单独给也进定位段', () =>
    expect(poolAutoName('p2', '二车间', null, '东侧', '公共电')).toBe('二车间·东侧·公共电'))
  it('截到 64', () => expect(poolAutoName('p1', '楼'.repeat(80), null, null, '消防').length).toBe(64))
})

// §H4.2b:一期按原册 7 个块分带(块名逐字);二期/宿舍原册无块结构,回落旧的按楼栋分带
describe('groupPoolsByBookBlock 按原册块分带', () => {
  // 一期入参=后端契约序(块序 → 块内 book_row);块内故意给乱序的 floorLabel/sortNo,
  // 验证前端**不重排**块带(book_row 不透出 DTO,重排就会把原册行序打乱)
  const B1 = 'A座及园区公共表合计：'   // 全角冒号,原册 B11 原文
  const B2 = 'A座电梯及楼层公共电合计'
  const p1rows = [
    pool({ ruleId: 5, zone: 'p1', bookBlock: B1, bookKey: '地下车库东侧照明', floorLabel: '负一层', sortNo: 23 }),
    pool({ ruleId: 8, zone: 'p1', bookBlock: B1, bookKey: '招商中心电1', floorLabel: '四楼', sortNo: 22 }),
    pool({ ruleId: 10, zone: 'p1', bookBlock: B1, bookKey: '园区路灯', buildingId: null, buildingName: null, sortNo: 30 }),
    pool({ ruleId: 17, zone: 'p1', bookBlock: B2, bookKey: '中大4楼公共', floorLabel: '四楼', sortNo: 24 }),
    pool({ ruleId: 27, zone: 'p1', bookBlock: B2, bookKey: 'A座天面电梯', floorLabel: '天面', sortNo: 39 }),
  ]
  it('带名=原册块名逐字(含全角冒号),带序=后端行序首现', () => {
    expect(groupPoolsByBookBlock(p1rows, 'p1').map(b => b.label)).toEqual([B1, B2])
  })
  it('块带内序原样保留后端行序(招商中心 r8 在块1,不因楼层/sortNo 被重排)', () => {
    const bands = groupPoolsByBookBlock(p1rows, 'p1')
    expect(bands.map(b => b.book)).toEqual([true, true])
    expect(bands[0].rows.map(r => r.ruleId)).toEqual([5, 8, 10])
    expect(bands[1].rows.map(r => r.ruleId)).toEqual([17, 27])
  })
  // 二期/宿舍 book_block 全 NULL → 老路:楼栋名分带(园区级在前)+带内楼层→侧向→sortNo
  const p2rows = [
    pool({ ruleId: 8, zone: 'p2', buildingId: null, buildingName: null, sortNo: 89 }),
    pool({ ruleId: 3, zone: 'p2', buildingName: '一期A座', floorLabel: '四楼', side: '东侧', sortNo: 30 }),
    pool({ ruleId: 4, zone: 'p2', buildingName: '一期A座', floorLabel: '四楼', side: '东侧', sortNo: 25 }),
    pool({ ruleId: 2, zone: 'p2', buildingName: '一期A座', floorLabel: '四楼', side: '西侧', sortNo: 20 }),
    pool({ ruleId: 5, zone: 'p2', buildingName: '一期A座', floorLabel: '负一层', side: null, sortNo: 60 }),
    pool({ ruleId: 1, zone: 'p2', buildingName: '一期A座', floorLabel: null, side: null, sortNo: 10 }),
    pool({ ruleId: 6, zone: 'p2', buildingName: '一期A座', floorLabel: '天面', side: null, sortNo: 70 }),
    pool({ ruleId: 9, zone: 'p1', buildingName: 'B座', sortNo: 5 }),
  ]
  it('无原册块(二期/宿舍)=按楼栋分带,带内楼层(整栋排首,负一层<四楼<天面)→侧向→sortNo', () => {
    const bands = groupPoolsByBookBlock(p2rows, 'p2')
    expect(bands.map(b => b.label)).toEqual(['园区级', '一期A座'])
    expect(bands.map(b => b.book)).toEqual([false, false])
    expect(bands[1].rows.map(r => r.ruleId)).toEqual([1, 5, 4, 3, 2, 6])
  })
  it('zone 过滤;无行=空带', () => {
    expect(groupPoolsByBookBlock(p2rows, 'p1').map(b => b.label)).toEqual(['B座'])
    expect(groupPoolsByBookBlock(p2rows, 'dorm')).toEqual([])
  })
})

// §H4.2a/§H4.3.3:定位归一为一格 floor_label,屏上不许再出现
// 「天面东侧/天面西侧/整栋净额/按车间/–」这五种话术
describe('poolFloor 楼层列(单值,不拼方位)', () => {
  it('原样显 floor_label 一格(方位在原册就写在这一格里)', () => {
    expect(poolFloor(pool({ floorLabel: '四楼西侧' }))).toBe('四楼西侧')
    expect(poolFloor(pool({ floorLabel: '天面' }))).toBe('天面')
  })
  it('side 字段一律不再参与拼接(存量二期行 side 还在库里)', () => {
    expect(poolFloor(pool({ floorLabel: '天面', side: '东侧' }))).toBe('天面')
    expect(poolFloor(pool({ floorLabel: '二楼', side: '东侧' }))).toBe('二楼')
  })
  it('园区级池(不挂楼栋)=空;挂栋没录=「(未录)」(非层份摊法才催)', () => {
    expect(poolFloor(pool({ buildingId: null, floorLabel: null }))).toBe('')
    expect(poolFloor(pool({ method: 'area', buildingId: 13, floorLabel: null }))).toBe('(未录)')
    expect(poolFloor(pool({ method: 'area', buildingId: 13, floorLabel: '  ' }))).toBe('(未录)')
  })
  it('P2-SHARE §8:按层份(floor)池挂栋不录楼层=整栋刻意,留空不出「(未录)」', () => {
    expect(poolFloor(pool({ method: 'floor', buildingId: 14, floorLabel: null }))).toBe('')
    expect(poolFloor(pool({ method: 'floor', buildingId: 14, floorLabel: '  ' }))).toBe('')
  })
  it('五种废话术在任何输入下都不再产出', () => {
    const banned = ['天面东侧', '天面西侧', '整栋净额', '按车间', '–']
    const neg = [{ meterId: 1, name: '分表', sign: -1, label: null, spot: null, subName: null, meterType: null }]
    const cases = [
      pool({ zone: 'p1', floorLabel: '天面', side: '东侧' }),
      pool({ zone: 'p1', floorLabel: '天面', side: '西侧' }),
      pool({ zone: 'p2', buildingName: '二期 一车间', floorLabel: null, side: null }),
      pool({ zone: 'p1', buildingName: '一期 招商中心', method: 'direct', meters: neg, floorLabel: null, side: null }),
      pool({ zone: 'p1', buildingId: null, floorLabel: null, side: null }),
    ]
    for (const c of cases) expect(banned).not.toContain(poolFloor(c))
  })
})

describe('poolLocKind 池定位四态(workshop/net 两态已随 §H4 废除)', () => {
  it('有 floor_label=located(园区级池也算,原册 r5 那类有楼层)', () => {
    expect(poolLocKind(pool({ floorLabel: '四楼西侧' }))).toBe('located')
    expect(poolLocKind(pool({ buildingId: null, floorLabel: '负一层' }))).toBe('located')
  })
  it('不挂楼栋且无楼层=park(留空,不催补)', () =>
    expect(poolLocKind(pool({ buildingId: null, floorLabel: null }))).toBe('park'))
  it('非层份摊法挂栋没录=todo —— 净额池(direct)/面积池落这一类(§H4 代价,已知)', () => {
    expect(poolLocKind(pool({ zone: 'p1', method: 'direct', buildingId: 13, floorLabel: null }))).toBe('todo')
    expect(poolLocKind(pool({ zone: 'p1', method: 'area', buildingId: 13, floorLabel: null }))).toBe('todo')
  })
  it('P2-SHARE §8:按层份(floor)池挂栋无 floor_label=whole 整栋刻意,不再判 todo', () => {
    expect(poolLocKind(pool({ zone: 'p2', method: 'floor', buildingId: 14, buildingName: '二期 一车间', floorLabel: null }))).toBe('whole')
    expect(poolLocKind(pool({ zone: 'p2', method: 'floor', buildingId: 14, floorLabel: '  ' }))).toBe('whole')
  })
  it('只有 todo 提示用户去补', () => {
    expect(POOL_LOC_HINT.todo).toContain('补')
    expect(POOL_LOC_HINT.located).toBeNull()
    expect(POOL_LOC_HINT.park).toBeNull()
    expect(POOL_LOC_HINT.whole).toBeNull()
  })
})

describe('poolFeeLabel 池名称列优先原册自然键', () => {
  it('有 book_key 就显它(§H4.2d 回溯锚点)', () =>
    expect(poolFeeLabel(pool({ bookKey: 'A4西侧走廊灯', feeName: '走廊灯', name: '一期 A座·四楼西侧·走廊灯' })))
      .toBe('A4西侧走廊灯'))
  it('无自然键(二期/宿舍/V81 补的无表行)回退费项名', () =>
    expect(poolFeeLabel(pool({ bookKey: null, feeName: '公共用电', name: '一车间·二楼东侧·公共用电' })))
      .toBe('公共用电'))
  it('两者都空回退全名', () => {
    expect(poolFeeLabel(pool({ bookKey: '  ', feeName: null, name: '一期B101蔡卫兵' }))).toBe('一期B101蔡卫兵')
    expect(poolFeeLabel(pool({ feeName: '  ', name: '一期C座陈' }))).toBe('一期C座陈')
  })
})

// §H4.2e:V81 四个无电表行(原册 r12 联塑精铟 / r47-49 C座一楼西侧三户)
describe('manual 无电表行', () => {
  // manual 故意没进 AllocMethod 联合(理由见 api/alloc.ts),夹具里强转
  const MANUAL = 'manual' as unknown as AllocMethod
  const man = pool({ method: MANUAL, note: null })
  it('语义列=无电表(不落到 method 原文)', () => expect(poolSemantics(man)).toBe('无电表'))
  it('备注列固定话术,覆盖池自带备注为空的情形', () => {
    expect(poolNote(man)).toBe('无电表,金额人工/从总表回勾')
    expect(poolNote(pool({ method: MANUAL, note: '原册 r12' }))).toBe('无电表,金额人工/从总表回勾')
  })
  it('普通池备注照旧;导出用空串占位不用 –', () => {
    expect(poolNote(pool({ note: '按 40 倍率' }))).toBe('按 40 倍率')
    expect(poolNote(pool({ note: null }))).toBe('–')
    expect(poolNote(pool({ note: null }), '')).toBe('')
  })
})

describe('poolFooter/bandFooter 合计(ref 行剔除)', () => {
  it('Σ度数/Σ应分摊,ref 不计', () => {
    const bands = groupPoolsByBookBlock([
      pool({ ruleId: 1, qtyTotal: 100.5, costAmount: 111.18 }),
      pool({ ruleId: 2, sortNo: 20, qtyTotal: 200, costAmount: 222.42 }),
      pool({ ruleId: 3, sortNo: 30, method: 'ref', qtyTotal: 999, costAmount: 999 }),
    ], 'p2')
    expect(poolFooter(bands)).toEqual({ qty: 300.5, cost: 333.6 })
  })
  it('未生成月全 null=null', () =>
    expect(poolFooter(groupPoolsByBookBlock([pool({})], 'p2'))).toEqual({ qty: null, cost: null }))
  // §H4.2b 带尾合计:原册 r31「S31=SUM(S13:S30) 起于13,AD/AE/AF31=SUM(…12:…30) 起于12」
  // ——块首 r12(联塑精铟)无表故 S 空、只有手输金额 232。按册复刻=用量少这一行、金额多这一行。
  it('原册 r31 怪癖:无用量的 manual 行不进 Σ用量,金额照进 Σ应分摊', () => {
    const B2 = 'A座电梯及楼层公共电合计'
    const bands = groupPoolsByBookBlock([
      pool({ ruleId: 12, bookBlock: B2, method: 'manual' as unknown as AllocMethod,
        qtyTotal: null, costAmount: 232 }),                       // r12 联塑精铟
      pool({ ruleId: 13, bookBlock: B2, qtyTotal: 100, costAmount: 111.18 }),
      pool({ ruleId: 30, bookBlock: B2, qtyTotal: 200, costAmount: 222.42 }),
    ], 'p2')
    expect(bandFooter(bands[0].rows)).toEqual({ qty: 300, cost: 565.6 })
  })
  it('带尾合计逐带独立,tfoot=Σ各带', () => {
    const bands = groupPoolsByBookBlock([
      pool({ ruleId: 1, bookBlock: '块甲', qtyTotal: 10, costAmount: 11.11 }),
      pool({ ruleId: 2, bookBlock: '块乙', qtyTotal: 20, costAmount: 22.22 }),
    ], 'p2')
    expect(bandFooter(bands[0].rows)).toEqual({ qty: 10, cost: 11.11 })
    expect(bandFooter(bands[1].rows)).toEqual({ qty: 20, cost: 22.22 })
    expect(poolFooter(bands)).toEqual({ qty: 30, cost: 33.33 })
  })
})

// V73:导出改逐表平表(一表一行)。§E1 起:定位三列每行都填,只有合并类列留空供下游合并
const line = (p: Partial<AllocPoolLineDTO>): AllocPoolLineDTO => ({
  meterId: 1, label: 'A座·天面·东侧货梯·电表①', area: 'A座', spot: '天面', subName: '电表①',
  meterType: '公共用电/已分摊', code: null, sign: 1, factorSnap: 20, prevTotal: 199.35, currTotal: 206.14,
  qtyTotal: 135.8, qtySharp: null, qtyPeak: null, qtyFlat: null, qtyValley: null, costAmount: 151.3, ...p,
})

describe('buildPoolExportAoa 导出逐表平表(V73)', () => {
  const bands = () => groupPoolsByBookBlock([pool({
    floorLabel: '天面', autoName: '一期 A座·天面·电梯', method: 'area',
    qtyTotal: 403.5, costAmount: 449.5, baseSnap: 12487.04, stdValue: 0.08,
    lines: [
      line({ meterId: 1 }),
      line({ meterId: 2, label: 'A座·天面·西侧货梯·电表②', subName: '电表②',
        prevTotal: 320.46, currTotal: 333.87, qtyTotal: 268.2, costAmount: 298.82 }),
    ],
  })], 'p2')

  it('表头含逐表列(电表/表编码/倍率/上月/本月)', () => {
    expect(buildPoolExportAoa(bands(), '2099-02', '二期')[1].slice(4, 9))
      .toEqual(['电表', '表编码', '倍率', '上月行至', '本月行至'])
  })
  // §H4:导出同步改块分带与自然键(导出的用途就是回原册逐行对)
  it('首四列表头=区域/楼层/池名称/原册块;有 book_key 就导自然键', () => {
    const b = groupPoolsByBookBlock([pool({
      zone: 'p1', bookBlock: 'A座电梯及楼层公共电合计', bookKey: 'A4西侧走廊灯',
      floorLabel: '四楼西侧', autoName: '一期 A座·四楼西侧·走廊灯',
    })], 'p1')
    const aoa = buildPoolExportAoa(b, '2099-02', '一期')
    expect(aoa[1].slice(0, 4)).toEqual(['区域', '楼层', '池名称', '原册块'])
    // 该夹具无 lines → 区域回落池的楼栋名并剥期数前缀(此处夹具 buildingName='一车间');
    // 有 lines 时取本行电表 area,见下面「§E1 定位列每行都填」那条
    expect(aoa[2].slice(0, 4)).toEqual(['一车间', '四楼西侧', 'A4西侧走廊灯', 'A座电梯及楼层公共电合计'])
  })
  it('无自然键(二期)回退 autoName,不导空', () => {
    const aoa = buildPoolExportAoa(bands(), '2099-02', '二期')
    expect(aoa[2][2]).toBe('一期 A座·天面·电梯')
  })
  it('一表一行:两块表出两行,逐表用量与逐表应分摊各归各行', () => {
    const aoa = buildPoolExportAoa(bands(), '2099-02', '二期')
    expect(aoa[2].slice(4, 10)).toEqual(['A座·天面·东侧货梯·电表①', '', 20, 199.35, 206.14, 135.8])
    expect(aoa[3].slice(4, 10)).toEqual(['A座·天面·西侧货梯·电表②', '', 20, 320.46, 333.87, 268.2])
    expect(aoa[2][14]).toBe(151.3)
    expect(aoa[3][14]).toBe(298.82)
  })
  // §E1 行为变更(用户报障:「要跟 excel 一样一行一行分开」):楼栋/楼层·方位/池名称
  // 三列由「只填池首行」改为**每行都填** —— 原册这三列是逐行写满的,只有语义/标准/
  // 实收/盈亏/备注才是合并单元格(摊出/差额两列 2026-08-02 已撤)。故 aoa[3].slice(0,3) 的旧断言 ['','',''] 作废。
  it('§E1 定位列(区域/楼层/池名/块名)每行都填;合并类列(语义/标准)仍只在池首行', () => {
    const aoa = buildPoolExportAoa(bands(), '2099-02', '二期')
    // 区域取本行电表 area(夹具 'A座'),不是块名/楼栋名 —— 与原册 B 列同源
    const loc = ['A座', '天面', '一期 A座·天面·电梯', '一车间']
    expect(aoa[2].slice(0, 4)).toEqual(loc)
    expect(aoa[3].slice(0, 4)).toEqual(loc)
    expect(aoa[2][15]).toBe('12487.04㎡分摊')
    expect(aoa[2][16]).toBe(0.08)
    expect(aoa[3][15]).toBe('')
    expect(aoa[3][16]).toBe('')
  })
  it('逐表金额缺失(二期池级ROUND)时金额只落池首行', () => {
    const b = groupPoolsByBookBlock([pool({
      qtyTotal: 300, costAmount: 333.6,
      lines: [line({ meterId: 1, costAmount: null }), line({ meterId: 2, costAmount: null })],
    })], 'p2')
    const aoa = buildPoolExportAoa(b, '2099-02', '二期')
    expect(aoa[2][14]).toBe(333.6)
    expect(aoa[3][14]).toBe('')
  })
  it('无绑定表的池仍出一行;合计行落在逐表列之后', () => {
    const aoa = buildPoolExportAoa(groupPoolsByBookBlock([pool({ qtyTotal: 100, costAmount: 111.42 })], 'p2'),
      '2099-02', '二期')
    expect(aoa[2][4]).toBe('(无绑定表)')
    expect(aoa[2][9]).toBe(100)
    const last = aoa[aoa.length - 1]
    expect(last[0]).toBe('合计')
    expect(last[9]).toBe(100)
    expect(last[14]).toBe(111.42)
  })
})

describe('V73 逐表行辅助', () => {
  it('poolSpan=表数,无表也占一行', () => {
    expect(poolSpan(pool({ lines: [line({}), line({ meterId: 2 })] }))).toBe(2)
    expect(poolSpan(pool({ lines: [] }))).toBe(1)
  })
  it('costPerLine:逐表金额齐全才逐表显,缺一即回落池级', () => {
    expect(costPerLine(pool({ lines: [line({}), line({ meterId: 2 })] }))).toBe(true)
    expect(costPerLine(pool({ lines: [line({}), line({ meterId: 2, costAmount: null })] }))).toBe(false)
    expect(costPerLine(pool({ lines: [] }))).toBe(false)
  })
  it('poolSubtotal 只在多表池出(单表池池行=表行)', () => {
    expect(poolSubtotal(pool({ lines: [line({}), line({ meterId: 2 })], qtyTotal: 403.5, costAmount: 449.5 })))
      .toBe('Σ 403.5 度 / 449.5 元')
    expect(poolSubtotal(pool({ lines: [line({})], qtyTotal: 135.8, costAmount: 151.3 }))).toBeNull()
  })
  it('lineLabel:sign=-1 前缀「−」(冲减载体一眼可辨)', () => {
    expect(lineLabel(line({}))).toBe('A座·天面·东侧货梯·电表①')
    expect(lineLabel(line({ sign: -1 }))).toBe('−A座·天面·东侧货梯·电表①')
  })
  it('carrier(冲减载体)语义标签', () =>
    expect(poolSemantics(pool({ method: 'carrier' }))).toBe('冲减载体'))
})

// ── 刀I §I3/§I4(ROW-IDENTITY-SPEC):逐行身份 + 合计不双计 ──
// 立法依据(图谱 §1.3 实测):原册 B/C/D 三列永远逐行写、从不纵向合并;纵向合并的只有 AA/AC/AE/AF/AG。
describe('§I3 lineFloor 楼层逐行取自本行电表', () => {
  it('行值缺(净额池不出行/无绑定表/老快照)回落池级', () => {
    expect(lineFloor(null, '四楼西侧')).toBe('四楼西侧')
    expect(lineFloor({ floorLabel: null }, '负一层')).toBe('负一层')
    expect(lineFloor({ floorLabel: '  ' }, '(未录)')).toBe('(未录)')
  })
  // 池级 floor_label 是原册 C 列原文(楼层+方位一格),表级是结构化楼层 —— 池级更完整就按册取池级,
  // 否则 60 个单表池会从「四楼西侧」被降级成「四楼」,反而离原册更远
  it('池级以行值开头(原册 C 列含方位)时取池级,不降级', () => {
    expect(lineFloor({ floorLabel: '四楼' }, '四楼西侧')).toBe('四楼西侧')
    expect(lineFloor({ floorLabel: '天面' }, '天面')).toBe('天面')
  })
  it('池级与行值不同层(池跨层/池是园区级没楼层)取行值', () => {
    expect(lineFloor({ floorLabel: '一楼' }, '负一层')).toBe('一楼')
    expect(lineFloor({ floorLabel: '一楼' }, '')).toBe('一楼')          // 园区路灯:园区级池 + 一楼的表
    expect(lineFloor({ floorLabel: '天面' }, '(未录)')).toBe('天面')
  })
  // spot 不是楼层:库里 p2 rule 14/15/16/17/20/21 绑的表 spot='消防分表'/'火炬园广告字'
  it('不拿 spot 兜底(位置原文含非楼层值,兜底会把噪音抬进楼层列)', () => {
    expect(lineFloor(line({ spot: '消防分表', floorLabel: null }), '(未录)')).toBe('(未录)')
    expect(lineFloor(line({ spot: '火炬园广告字', floorLabel: null }), '')).toBe('')
  })
})

describe('§I3 lineUseName / poolSubtitle 名称列与首行副标题', () => {
  it('名称取本行电表用途(原册 D 列);缺失回落池级名', () => {
    expect(lineUseName(line({ useName: '大堂' }), 'A1大堂')).toBe('大堂')
    expect(lineUseName(line({ useName: '  ' }), 'A1大堂')).toBe('A1大堂')
    expect(lineUseName(null, 'A4西侧走廊灯')).toBe('A4西侧走廊灯')
  })
  it('自然键与本行用途不同字=进副标题(A1大堂↔大堂 回溯锚点不丢)', () =>
    expect(poolSubtitle(pool({ bookKey: 'A1大堂', lines: [line({})] }), '大堂')).toBe('A1大堂'))
  it('自然键与本行用途同字=不重复出', () =>
    expect(poolSubtitle(pool({ bookKey: '地下车库东侧照明', lines: [line({})] }), '地下车库东侧照明')).toBeNull())
  it('多表池:自然键与 Σ 合计并列(Σ 只在池首行)', () =>
    expect(poolSubtitle(pool({
      bookKey: 'A东侧货梯', lines: [line({}), line({ meterId: 2 })], qtyTotal: 403.5, costAmount: 449.5,
    }), '东侧货梯')).toBe('A东侧货梯 · Σ 403.5 度 / 449.5 元'))
  it('无自然键=只剩 Σ;两者都无=null', () => {
    expect(poolSubtitle(pool({ bookKey: null, lines: [line({}), line({ meterId: 2 })], qtyTotal: 10, costAmount: 11 }), '货梯'))
      .toBe('Σ 10 度 / 11 元')
    expect(poolSubtitle(pool({ bookKey: null, lines: [line({})] }), '货梯')).toBeNull()
  })
})

// 原册块1「A座及园区公共表合计：」r5–r10 —— 本刀的验收锚点,逐格取自 2024-02 原册
describe('§I3/§I4 原册块1 逐格验收', () => {
  const B1 = 'A座及园区公共表合计：'
  const A = { zone: 'p1' as const, bookBlock: B1, buildingId: 13, buildingName: '一期 A座', method: 'direct' as const }
  const one = (id: number, key: string, floor: string, use: string, qty: number, cost: number) =>
    pool({ ...A, ruleId: id, bookKey: key, floorLabel: floor, qtyTotal: qty, costAmount: cost,
      lines: [line({ meterId: id * 10, floorLabel: floor, useName: use, qtyTotal: qty, costAmount: cost })] })
  const block1 = [
    one(5, '地下车库东侧照明', '负一层', '地下车库东侧照明', 29.51, 32.88),
    one(6, '地下车库西侧照明', '负一层', '地下车库西侧照明', 18.55, 20.67),
    one(7, 'A1大堂', '一楼', '大堂', 101.51, 113.10),
    // r8 招商中心:§I2 净额池,7 块表都不出逐表行(它们在原册分摊明细上没有行)
    pool({ ...A, ruleId: 8, bookKey: '招商中心电1', floorLabel: '四楼', buildingName: '一期 招商中心',
      qtyTotal: 152.06, costAmount: 169.42, lines: [],
      netParts: [
        { meterId: 223, label: '招商中心·四楼·电表①', sign: 1, qty: 697.60 },
        { meterId: 224, label: '招商中心·四楼·电表②', sign: 1, qty: 444.80 },
        { meterId: 301, label: 'A座·三楼·中大A304公共电1', sign: -1, qty: -4.74 },
        { meterId: 302, label: 'A座·三楼·优凯A305电', sign: -1, qty: 0 },
        { meterId: 303, label: 'A座·四楼·双成电2', sign: -1, qty: -315.60 },
        { meterId: 304, label: 'A座·四楼·中大4楼公共', sign: -1, qty: 0 },
        { meterId: 305, label: 'A座·四楼·4楼空调外机电', sign: -1, qty: 0 },
        { meterId: null, label: '账册扣度', sign: -1, qty: -670 },
      ] }),
    one(9, '生活加压泵', '负一层', '生活加压泵', 219.19, 244.21),
    // r10 园区路灯:园区级池(不挂楼栋,池级楼层空),楼层由表给出
    pool({ ...A, ruleId: 10, buildingId: null, buildingName: null, bookKey: '园区路灯', floorLabel: null,
      qtyTotal: 2683.80, costAmount: 2990.21,
      lines: [line({ meterId: 100, floorLabel: '一楼', useName: '园区路灯', qtyTotal: 2683.80, costAmount: 2990.21 })] }),
  ]
  const rows = () => groupPoolsByBookBlock(block1, 'p1')[0].rows
  const shown = (r: typeof block1[number]) => {
    const l = r.lines[0] ?? null
    return [lineFloor(l, poolFloor(r)), lineUseName(l, poolFeeLabel(r))]
  }

  // 验收线 2:块1 前 4 行 C/D 两列与原册 r5/r6/r7/r9 逐格相同(旧口径取池级 → 楼层错 1 行、名称错 1 行)
  it('前 4 行楼层=负一层/负一层/一楼/负一层,名称=…东侧照明/…西侧照明/大堂/生活加压泵', () => {
    const rs = rows()
    expect([rs[0], rs[1], rs[2], rs[4]].map(shown)).toEqual([
      ['负一层', '地下车库东侧照明'],
      ['负一层', '地下车库西侧照明'],
      ['一楼', '大堂'],
      ['负一层', '生活加压泵'],
    ])
  })
  it('r7 名称是 D 列「大堂」而不是 A 列「A1大堂」,自然键退到副标题', () => {
    const r = rows()[2]
    expect(lineUseName(r.lines[0], poolFeeLabel(r))).toBe('大堂')
    expect(poolSubtitle(r, '大堂')).toBe('A1大堂')
  })
  it('r10 园区路灯:园区级池楼层空,由表给出「一楼」', () => expect(shown(rows()[5])[0]).toBe('一楼'))

  // 验收线 1:块1 小计 = 原册 S11 / AC11。系统旧值 3356.68 / 3739.91(招商中心被计两遍)
  it('块1 小计 = 3204.62 / 3570.49(原册 S11/AC11),招商中心只算一次', () =>
    expect(bandFooter(rows())).toEqual({ qty: 3204.62, cost: 3570.49 }))
  it('块1 行数=6(§I2 后招商中心只占 1 行,5 块负号表不出行)', () => {
    expect(rows()).toHaveLength(6)
    expect(rows().map(r => r.lines.length)).toEqual([1, 1, 1, 0, 1, 1])
  })
  // 验收线 3:净额构成整条链自洽
  it('招商中心 hover:8 项有符号量相加 ≡ 152.06,冲减表数=5(账册扣度不算表)', () => {
    const r = rows()[3]
    const s = netSummary(r)!
    expect(s.text).toBe('净额 · 冲减 5 表')
    expect(s.title.split('\n')).toHaveLength(10)            // 抬头 + 8 项 + 合计
    expect(s.title).toContain('+697.6')
    expect(s.title).toContain('−670')
    expect(s.title.endsWith('= 152.06 度')).toBe(true)
    expect(r.netParts!.reduce((a, p) => a + (p.qty ?? 0), 0)).toBeCloseTo(152.06, 2)
  })
  it('非净额池无构成明细', () => expect(netSummary(rows()[0])).toBeNull())
})

// 多表池(原册 r27–r30 四部梯:AA27:AA30 才是合并区间,B/C/D 仍逐行写)
describe('§I3 多表池逐行身份(红线八池的显示口径)', () => {
  const r = pool({
    zone: 'p1', ruleId: 40, bookBlock: 'A座电梯及楼层公共电合计', bookKey: 'A东侧货梯',
    buildingId: 13, floorLabel: '天面', method: 'area', qtyTotal: 403.5, costAmount: 449.5,
    lines: [
      line({ meterId: 1, floorLabel: '天面', useName: '东侧货梯' }),
      line({ meterId: 2, floorLabel: '天面', useName: '西侧货梯' }),
      line({ meterId: 3, floorLabel: '天面', useName: '客梯1' }),
      line({ meterId: 4, floorLabel: '天面', useName: '客梯2（到-1楼）' }),
    ],
  })
  it('四行楼层同为天面,名称逐行不同(旧口径四行都显 A东侧货梯)', () => {
    expect(r.lines.map(l => lineFloor(l, poolFloor(r)))).toEqual(['天面', '天面', '天面', '天面'])
    expect(r.lines.map(l => lineUseName(l, poolFeeLabel(r))))
      .toEqual(['东侧货梯', '西侧货梯', '客梯1', '客梯2（到-1楼）'])
  })
  it('自然键+Σ 落池首行副标题', () =>
    expect(poolSubtitle(r, '东侧货梯')).toBe('A东侧货梯 · Σ 403.5 度 / 449.5 元'))
  it('单表池两种取法结果相同(占绝大多数,本刀不应改动它们)', () => {
    const s = pool({ zone: 'p1', ruleId: 33, bookKey: 'A4西侧走廊灯', buildingId: 13, floorLabel: '四楼西侧',
      lines: [line({ meterId: 9, floorLabel: '四楼', useName: '走廊灯/西侧租户' })] })
    expect(lineFloor(s.lines[0], poolFloor(s))).toBe(poolFloor(s))     // 原册 C 列原文一格不动
  })
})

describe('§I4 合计不许双计(fold_qty 源池已被目标池吃掉)', () => {
  const B1 = 'A座及园区公共表合计：'
  // 刀前形态:rule 24 用 fold_qty 把 rule 23(招商中心 152.06/169.42)的净量折进自己的 520.82/580.28,
  // 而 rule 23 自己在屏上还占一行 → 无条件 Σ = 3356.68/3739.91,比原册各多 152.06/169.42
  const before = [
    pool({ zone: 'p1', ruleId: 24, bookBlock: B1, method: 'loss', qtyTotal: 520.82, costAmount: 580.28,
      links: [{ ruleId: 23, name: '招商中心电1', type: 'fold_qty' }] }),
    pool({ zone: 'p1', ruleId: 23, bookBlock: B1, qtyTotal: 152.06, costAmount: 169.42 }),
    pool({ zone: 'p1', ruleId: 10, bookBlock: B1, qtyTotal: 2683.80, costAmount: 2990.21 }),
  ]
  it('折入源不再重复计入 → 仍是原册 3204.62 / 3570.49', () =>
    expect(bandFooter(before)).toEqual({ qty: 3204.62, cost: 3570.49 }))
  it('tfoot 同口径(跳过集在全部行上解析)', () =>
    expect(poolFooter(groupPoolsByBookBlock(before, 'p1'))).toEqual({ qty: 3204.62, cost: 3570.49 }))
  it('foldQtySrcIds 只收 fold_qty;fold_price(只叠加分摊标准不动量)不跳过', () => {
    expect([...foldQtySrcIds(before)]).toEqual([23])
    const price = [pool({ ruleId: 2, qtyTotal: 100, costAmount: 111.42,
      links: [{ ruleId: 1, name: '源池', type: 'fold_price' }] }),
      pool({ ruleId: 1, qtyTotal: 50, costAmount: 55.71 })]
    expect(foldQtySrcIds(price).size).toBe(0)
    expect(bandFooter(price)).toEqual({ qty: 150, cost: 167.13 })
  })
  it('I1 之后无折入链=行为与刀前一致(防御不改变正常池)', () =>
    expect(foldQtySrcIds([pool({ ruleId: 1 }), pool({ ruleId: 2 })]).size).toBe(0))
})

describe('buildLossReconRows 对账区两行', () => {
  const recon: AllocLossReconDTO = {
    zone: 'p1', supplyQty: 68320, sumC: 68000, sumD: 66500,
    lossVsC: -320, rateVsC: -0.0047, lossVsD: -1820, rateVsD: -0.0266,
  }
  it('两行:vs 总表Σ落 cQty,vs 分表Σ落 dQty', () => {
    const rows = buildLossReconRows(recon)
    expect(rows).toHaveLength(2)
    expect(rows[0].label).toContain('68,320')
    expect(rows[0]).toMatchObject({ cQty: 68000, dQty: null, loss: -320, rate: -0.0047 })
    expect(rows[1]).toMatchObject({ cQty: null, dQty: 66500, loss: -1820, rate: -0.0266 })
  })
  it('无 recon=空', () => expect(buildLossReconRows(null)).toEqual([]))
})

describe('lossFooter 单元合计', () => {
  const unit = (p: Partial<AllocLossUnitDTO>): AllocLossUnitDTO => ({
    headBuildingId: 13, label: 'A座', zone: 'p1', cQty: null, cableQty: null, dQty: null,
    eQty: null, rawRate: null, gQty: null, adjQty: null, adjRate: null,
    variant: 'net', tenantRate: null, note: null, ...p,
  })
  it('null 安全求和', () => {
    expect(lossFooter([
      unit({ cQty: 100.1, dQty: 90, eQty: -10.1 }),
      unit({ cQty: 200, cableQty: 5.5, dQty: 210 }),
    ])).toEqual({ cQty: 300.1, cableQty: 5.5, dQty: 300, eQty: -10.1 })
  })
  it('空集=全 null', () =>
    expect(lossFooter([])).toEqual({ cQty: null, cableQty: null, dQty: null, eQty: null }))
})
