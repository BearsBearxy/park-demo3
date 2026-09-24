import { describe, it, expect } from 'vitest'
import {
  meterSearchHit, isMeaningfulName, isPendingMeter, isPlaceholderMeter,
  buildRows, rowStatus, cardCounts, matchStatus, filterRows,
  segUsage, segCheck, buildingTotals, groupByBuilding,
  effVal, draftRowDirty, draftDirtyIds, rowUsage, draftRowIssues, draftReq, gridFooter, healRows, baseOpen,
  bindQueueBucket, bindReason, autoLinkEstimate, statusDims, bookTip, bookGapText, bookLine, BOOK_REDO,
  flattenGroups, buildWindow, offsetOf, ROW_H, BSUM_H, floorRankOf,
  type WorkbenchRow, type WorkbenchFilter, type MeterDraft, type BuildingGroup, type DisplayItem,
} from './useMeterWorkbench'
import type { MeterLoc } from '@/utils/meterGroup'
import type { MeterDTO, MeterReadingDTO, MeterBindingRowDTO } from '@/api/meters'

// METER-V5-SPEC §5+§7 v5.1:rows 合流/状态最差优先/统计卡口径/筛选/Σ段校验/楼栋合计损耗/草稿式编辑

let seq = 0
// V74 位置结构化字段(A3 刀起前端 MeterDTO 已带这三列,MeterLoc 交叉仅为兼容既有断言写法)
function mkM(p: Partial<MeterDTO & MeterLoc> = {}): MeterDTO & MeterLoc {
  return {
    id: ++seq, kind: 'elec', zone: 'p1', name: `m${seq}`, area: null, spot: null,
    floorLabel: null, side: null, roomNo: null,
    tenantName: null, tenantId: null, buildingId: null, ownership: 'share',
    meterType: null, deviceType: null, subName: null, code: null,
    factor: 1, sortNo: seq, readingCount: 0,
    status: 'active', statusFrom: '1900-01', statusUntil: null,
    assignFrom: '1900-01', assignUntil: null, assignSrc: 'migrate', changedThisMonth: false, ...p,
  }
}
function mkR(meterId: number, p: Partial<MeterReadingDTO> = {}): MeterReadingDTO {
  return {
    id: meterId * 1000, meterId, ym: '2024-05',
    prevTotal: null, currTotal: null,
    prevSharp: null, prevPeak: null, prevFlat: null, prevValley: null,
    currSharp: null, currPeak: null, currFlat: null, currValley: null,
    factorSnap: 1, usageTotal: null, usageSharp: null, usagePeak: null, usageFlat: null, usageValley: null,
    note: null, source: 'manual', ...p,
  }
}
function mkB(meterId: number, p: Partial<MeterBindingRowDTO> = {}): MeterBindingRowDTO {
  return { meterId, status: 'auto', hasReading: true, ...p }
}
const F = (p: Partial<WorkbenchFilter> = {}): WorkbenchFilter =>
  ({ kind: 'elec', zone: 'all', building: 'all', own: 'all', status: 'all', q: '', ...p })

describe('meterSearchHit / isMeaningfulName / isPendingMeter — v4 口径原样保留', () => {
  const mk = (p: Partial<MeterDTO> = {}) => mkM(p)
  it('六字段逐一命中;空关键词恒命中;null 不炸', () => {
    expect(meterSearchHit(mk(), '')).toBe(true)
    expect(meterSearchHit(mk({ name: '一车间总电' }), '车间')).toBe(true)
    expect(meterSearchHit(mk({ subName: '电表①' }), '电表①')).toBe(true)
    expect(meterSearchHit(mk({ code: 'DB-001' }), 'DB-001')).toBe(true)
    expect(meterSearchHit(mk({ spot: '1-3楼' }), '1-3楼')).toBe(true)
    expect(meterSearchHit(mk({ tenantName: '力灏' }), '力灏')).toBe(true)
    expect(meterSearchHit(mk(), '锂朋', '锂朋科技有限公司')).toBe(true)
    expect(meterSearchHit(mk({ name: 'x' }), '桑尼', null)).toBe(false)
  })
  it('占位原文不算有意义:空/横线/（空）/已停用', () => {
    for (const s of [null, '', '  ', '-', '—', '（空）', '(空)', '铝箔厂已停用']) {
      expect(isMeaningfulName(s)).toBe(false)
    }
    expect(isMeaningfulName('嘉荣科技')).toBe(true)
  })
  it('待核=租户表+未挂+原文有意义;占位=租户表+未挂+原文无意义', () => {
    expect(isPendingMeter({ ownership: 'tenant', tenantId: null, tenantName: '嘉荣' })).toBe(true)
    expect(isPendingMeter({ ownership: 'tenant', tenantId: 3, tenantName: '嘉荣' })).toBe(false)
    expect(isPendingMeter({ ownership: 'share', tenantId: null, tenantName: '嘉荣' })).toBe(false)
    expect(isPendingMeter({ ownership: 'tenant', tenantId: null, tenantName: '-' })).toBe(false)
    expect(isPlaceholderMeter({ ownership: 'tenant', tenantId: null, tenantName: '-' })).toBe(true)
    expect(isPlaceholderMeter({ ownership: 'tenant', tenantId: null, tenantName: '嘉荣' })).toBe(false)
    expect(isPlaceholderMeter({ ownership: 'share', tenantId: null, tenantName: null })).toBe(false)
  })
})

describe('buildRows — meters×readings×binding 合流', () => {
  it('读数/上月/绑定按表 join;prev 基准=本月自带>上月行至;倍率=快照>档案', () => {
    const m = mkM({ tenantId: 7, ownership: 'tenant', factor: 40 })
    const r = mkR(m.id, { prevTotal: 100, currTotal: 120, factorSnap: 20 })
    const prev = mkR(m.id, { ym: '2024-04', currTotal: 99 })
    const b = mkB(m.id, { status: 'auto' })
    const [x] = buildRows([m], [r], [prev], [b], new Map([[7, '锂朋科技全名']]))
    expect(x.r).toBe(r)
    expect(x.prevR).toBe(prev)
    expect(x.bind).toBe(b)
    expect(x.tenantLabel).toBe('锂朋科技全名')
    expect(x.prevTotal).toBe(100)          // 本月自带 prev 优先
    expect(x.factor).toBe(20)              // 快照优先
    expect(x.ready).toBe(true)
  })
  it('无本月读数:prev 基准回落上月行至(总+四段),倍率回落档案', () => {
    const m = mkM({ factor: 40 })
    const prev = mkR(m.id, { ym: '2024-04', currTotal: 99, currSharp: 1, currPeak: 2, currFlat: 3, currValley: 4 })
    const [x] = buildRows([m], [], [prev], null)
    expect(x.prevTotal).toBe(99)
    expect(x.prevSegs).toEqual({ sharp: 1, peak: 2, flat: 3, valley: 4 })
    expect(x.factor).toBe(40)
    expect(x.bind).toBeNull()
  })
  it('分时表判定:电表且本月或上月读数带任一分时段;水表恒否', () => {
    const e1 = mkM(), e2 = mkM(), e3 = mkM(), w = mkM({ kind: 'water' })
    const rows = buildRows(
      [e1, e2, e3, w],
      [mkR(e1.id, { currSharp: 5 }), mkR(w.id, { currSharp: 5 })],
      [mkR(e2.id, { ym: '2024-04', prevPeak: 3 })],
      null)
    expect(rows.map(x => x.tou)).toEqual([true, true, false, false])
  })
})

describe('rowStatus — 状态最差优先:待核＞待绑定＞时段不符＞倒走＞未抄＞已抄＞占位', () => {
  it('待核压过一切(含异常读数)', () => {
    const m = mkM({ ownership: 'tenant', tenantName: '嘉荣' })
    const r = mkR(m.id, { currTotal: 5, usageTotal: -3 })
    expect(buildRows([m], [r], [], null)[0].status).toBe('pending')
  })
  it('待绑定(manual/override_stale)压过时段不符;时段不符压过倒走', () => {
    const m = mkM({ ownership: 'tenant', tenantId: 1 })
    const bad = mkR(m.id, {
      currTotal: 5, usageTotal: -10,
      usageSharp: 1, usagePeak: 1, usageFlat: 1, usageValley: 1,   // Σ=4 ≠ -10 → touMismatch+negative
    })
    expect(buildRows([m], [bad], [], [mkB(m.id, { status: 'manual', bucket: 'ambiguous' })])[0].status).toBe('unbound')
    expect(buildRows([m], [bad], [], [mkB(m.id, { status: 'override_stale' })])[0].status).toBe('unbound')
    expect(buildRows([m], [bad], [], [mkB(m.id, { status: 'auto' })])[0].status).toBe('touMismatch')
    const neg = mkR(m.id, { currTotal: 5, usageTotal: -10 })
    expect(buildRows([m], [neg], [], null)[0].status).toBe('negative')
  })
  it('未抄/已抄;占位槽不计未抄', () => {
    const m = mkM({ ownership: 'tenant', tenantId: 1 })
    expect(buildRows([m], [], [], null)[0].status).toBe('missing')
    // 已抄 = 本月行至与底数都在(后端没有底数就算不出用量,SPEC §3.4 缺底数不算已抄)
    expect(buildRows([m], [mkR(m.id, { prevTotal: 6, currTotal: 8, usageTotal: 2 })], [], null)[0].status).toBe('read')
    const ph = mkM({ ownership: 'tenant', tenantName: '（空）' })
    expect(buildRows([ph], [], [], null)[0].status).toBe('placeholder')
  })
  it('rowStatus 纯函数直调:占位判定先于未抄,非占位序不变', () => {
    const flags = { missing: true, negative: false, touMismatch: false }
    expect(rowStatus({ pending: false, unbound: false, placeholder: true, retired: false, flags, r: null })).toBe('placeholder')
    expect(rowStatus({ pending: false, unbound: false, placeholder: false, retired: false, flags, r: null })).toBe('missing')
  })

  // 2026-09-23 南盛物流案:表 243 档案写 zone=p1、它挂的楼却是二期二车间。
  // 筛期区用 zone、位置显示用楼栋 —— 于是一期抄表里出现了一行二车间,半年无人发觉。
  it('期区对不上:表档案的期区 ≠ 它挂的楼栋的期区', () => {
    const odd = mkM({ ownership: 'tenant', tenantId: 1, zone: 'p1', buildingZone: 'p2' })
    const row = buildRows([odd], [mkR(odd.id, { currTotal: 8, usageTotal: 2 })], [], null)[0]
    expect(row.zoneOdd, '两边不同 → 标出来').toBe(true)
    // 抢在待核/待绑定/已抄之前:这一行站在哪个页签里都不对
    expect(row.status).toBe('zoneOdd')
    expect(statusDims(row)).toContain('期区对不上')
    // 停用仍然最优先(本月不在服务中,其余维度无意义)
    const retiredOdd = mkM({ ownership: 'tenant', tenantId: 1, zone: 'p1', buildingZone: 'p2', status: 'retired', statusFrom: '2020-01' })
    expect(buildRows([retiredOdd], [], [], null)[0].status).toBe('retired')
  })
  it('期区对得上 / 没挂楼栋 → 不标(否则全库满屏红)', () => {
    const same = mkM({ ownership: 'tenant', tenantId: 1, zone: 'p1', buildingZone: 'p1' })
    expect(buildRows([same], [mkR(same.id, { currTotal: 8, usageTotal: 2 })], [], null)[0].zoneOdd).toBe(false)
    const noBld = mkM({ ownership: 'tenant', tenantId: 1, zone: 'p1', buildingZone: null })
    expect(buildRows([noBld], [mkR(noBld.id, { currTotal: 8, usageTotal: 2 })], [], null)[0].zoneOdd).toBe(false)
    // 旧夹具(根本没这一格)也不能被标
    const legacy = mkM({ ownership: 'tenant', tenantId: 1, zone: 'p1' })
    expect(buildRows([legacy], [mkR(legacy.id, { currTotal: 8, usageTotal: 2 })], [], null)[0].zoneOdd).toBe(false)
  })
})

describe('cardCounts / matchStatus — 统计卡独立计数,不受徽标优先级影响', () => {
  const m1 = mkM({ ownership: 'tenant', tenantName: '嘉荣' })                 // 待核+未抄
  const m2 = mkM({ ownership: 'tenant', tenantId: 1 })                        // 已抄+倒走+待绑定
  const m3 = mkM({ ownership: 'tenant', tenantId: 2 })                        // 已抄+就绪
  const m4 = mkM({ ownership: 'tenant', tenantName: '-' })                    // 占位(未抄计入卡口径)
  const m5 = mkM({ ownership: 'infra' })                                      // 非租户表:不进 已抄/未抄
  const rows = buildRows(
    [m1, m2, m3, m4, m5],
    [mkR(m2.id, { prevTotal: 7, currTotal: 5, usageTotal: -2 }), mkR(m3.id, { prevTotal: 6, currTotal: 9, usageTotal: 3 })],
    [],
    [mkB(m2.id, { status: 'manual', bucket: 'date_missing' }), mkB(m3.id, { status: 'override' })])
  it('租户表总数=已抄+未抄 恰好切分;各维独立', () => {
    const c = cardCounts(rows)
    expect(c.tenant).toBe(4)
    expect(c.read).toBe(2)
    expect(c.missing).toBe(2)                    // m1 + m4(占位也在租户未抄分母)
    expect(c.read + c.missing).toBe(c.tenant)
    expect(c.negative).toBe(1)
    expect(c.anomaly).toBe(1)
    expect(c.pending).toBe(1)
    expect(c.unbound).toBe(1)
    expect(c.ready).toBe(1)
  })
  it('m2 徽标虽显「待绑定」,仍计入 已抄/倒走(独立计数)', () => {
    const x2 = rows.find(x => x.m.id === m2.id)!
    expect(x2.status).toBe('unbound')
    expect(matchStatus(x2, 'read')).toBe(true)
    expect(matchStatus(x2, 'negative')).toBe(true)
    expect(matchStatus(x2, 'attention')).toBe(true)
  })
  it('statusDims tooltip 列全维度', () => {
    const dims = statusDims(rows.find(x => x.m.id === m2.id)!)
    expect(dims).toContain('待绑定')
    expect(dims).toContain('倒走')
    expect(dims).toContain('已抄')
  })
})

// METER-TIMELINE-SPEC §1.3 / §6:在不在册、停用都由 list(ym) 投影好的状态段决定(MeterDTO.status),
// 前端不再拿账期列自己比月份。
describe('状态段(站在本月)— 停用照常显示不进分母;已拆 / 未在册只在自己那一项里', () => {
  const live = mkM({ ownership: 'tenant', tenantId: 1 })
  const idle = mkM({ ownership: 'tenant', tenantId: 2, status: 'retired', statusFrom: '2024-03', statusUntil: '2024-08' })
  const gone = mkM({ ownership: 'tenant', tenantId: 3, status: 'removed', statusFrom: '2024-09' })
  const later = mkM({ ownership: 'tenant', tenantId: 4, status: null, statusFrom: null })
  const rows = buildRows([live, idle, gone, later], [], [], null)
  const ids = (p: Partial<WorkbenchFilter>) => filterRows(rows, F(p)).map(x => x.m.id)

  it('徽标:已停用 / 已拆 / 未在册', () => {
    expect(rows.map(x => x.status)).toEqual(['missing', 'retired', 'removed', 'notYet'])
    expect(rows.map(x => x.off)).toEqual([null, null, 'removed', 'notYet'])
  })
  it('悬停按状态段说话:停用 2024-03 ~ 2024-08 / 自 2024-09 起已拆;链尾写「自 M 起停用」', () => {
    expect(statusDims(rows[1])).toContain('停用 2024-03 ~ 2024-08')
    expect(statusDims(rows[2])).toContain('自 2024-09 起已拆')
    expect(statusDims(rows[3])).toContain('本月还不在册')
    const open = buildRows([mkM({ status: 'retired', statusFrom: '2024-03', statusUntil: null })], [], [], null)[0]
    expect(statusDims(open)).toContain('自 2024-03 起停用')
    // 不再教人「清空账期」
    for (const x of [...rows, open]) expect(statusDims(x)).not.toContain('账期')
  })
  it('「全部」:在用 + 停用;已拆与未在册不在里面', () => {
    expect(ids({})).toEqual([live.id, idle.id])
  })
  it('各自的筛选项只调出自己那一批', () => {
    expect(ids({ status: 'retired' })).toEqual([idle.id])
    expect(ids({ status: 'removed' })).toEqual([gone.id])
    expect(ids({ status: 'notYet' })).toEqual([later.id])
  })
  it('统计卡:停用与不在册都不进分母(租户表总数只剩在用那一块)', () => {
    const c = cardCounts(rows)
    expect(c.tenant).toBe(1)
    expect(c.missing).toBe(1)
  })
})

describe('本月有变化(SPEC §6)— 按后端给的 changedThisMonth 筛,含本月起停用 / 已拆的表', () => {
  const same = mkM({ ownership: 'tenant', tenantId: 1 })
  const moved = mkM({ ownership: 'tenant', tenantId: 2, changedThisMonth: true })
  const idleNow = mkM({ ownership: 'tenant', tenantId: 3, status: 'retired', statusFrom: '2024-05', changedThisMonth: true })
  const goneNow = mkM({ ownership: 'tenant', tenantId: 4, status: 'removed', statusFrom: '2024-05', changedThisMonth: true })
  const rows = buildRows([same, moved, idleNow, goneNow], [], [], null)
  it('三块本月有自己那一行的表都出来,没变的不出', () => {
    expect(filterRows(rows, F({ status: 'changed' })).map(x => x.m.id)).toEqual([moved.id, idleNow.id, goneNow.id])
  })
  it('不是统计卡维度:不改任何分母', () => {
    expect(cardCounts(rows).tenant).toBe(2)
  })
})

// METER-TIMELINE-SPEC §10.4:按期区 × 表类看这个月导入的册子。夹具四组,每组形状不同(不许全组同形):
//   一期电 = 整段零记录(同期区的水表却有记录 —— 期区与表类两个维度都要看);
//   二期电 = 三块里一块有、两块没有(另有停用 / 已拆各一块也没有);三期电 = 整段零记录(与一期电合成一句)。
describe('本月册子(SPEC §10.4)— 一笔都没有只出一句;有记录才逐行打标,只标没有的', () => {
  const t = { ownership: 'tenant' as const }
  const p1a = mkM({ ...t, tenantId: 1 })
  const p1b = mkM({ ...t, tenantId: 2, zone: 'p1' })
  const p2seen = mkM({ ...t, tenantId: 3, zone: 'p2', bookSeen: true, bookFile: '二期电 2024-05.xlsx', bookAt: '2026-09-24T10:30:00' })
  const p2old = mkM({ ...t, tenantId: 4, zone: 'p2' })                                      // 自最早那一行照抄
  const p2imp = mkM({ ...t, tenantId: 5, zone: 'p2', assignFrom: '2024-02', assignSrc: 'import' })
  const p2idle = mkM({ ...t, tenantId: 6, zone: 'p2', status: 'retired', statusFrom: '2024-03' })
  const p2gone = mkM({ ...t, tenantId: 7, zone: 'p2', status: 'removed', statusFrom: '2024-03' })
  const p1w = mkM({ ...t, tenantId: 8, zone: 'p1', kind: 'water', bookSeen: true })
  const p3 = mkM({ ...t, tenantId: 9, zone: 'p3' })
  const rows = buildRows([p1a, p1b, p2seen, p2old, p2imp, p2idle, p2gone, p1w, p3], [], [], null)
  const row = (id: number) => rows.find(x => x.m.id === id)!

  it('按期区 × 表类分三种:整段零 = none,同段有记录的没出现 = missing,出现 = seen', () => {
    expect(rows.map(x => x.book)).toEqual(['none', 'none', 'seen', 'missing', 'missing', 'missing', 'missing', 'seen', 'none'])
  })
  it('整段零记录:一块都不打标,只出表格上方那一句(原句)', () => {
    expect(bookTip(row(p1a.id))).toBeNull()
    expect(bookTip(row(p1b.id))).toBeNull()
    expect(bookGapText([row(p1a.id), row(p1b.id)]))
      .toBe(`这个月还没导入过一期的电表册子,这些表的档案都是沿用的。${BOOK_REDO}`)
  })
  it('多个期区合成一句;有记录的段不进这句', () => {
    expect(bookGapText(rows)).toBe(`这个月还没导入过一期、三期的电表册子,这些表的档案都是沿用的。${BOOK_REDO}`)
    expect(bookGapText([row(p2seen.id), row(p2old.id), row(p1w.id)])).toBe('')
  })
  it('部分有:只标没出现的那几块;悬停写是哪一段、来源四种说法', () => {
    expect(bookTip(row(p2seen.id)), '册子里有的行不标').toBeNull()
    expect(bookTip(row(p1w.id))).toBeNull()
    expect(bookTip(row(p2old.id))).toBe('这个月导入的册子里没有这块表;显示的是最早那一行(按旧档案补记)')
    expect(bookTip(row(p2imp.id))).toBe('这个月导入的册子里没有这块表;显示的是自 2024-02 起那一行(导入)')
    const src = (assignSrc: 'manual' | 'contract') =>
      bookTip(buildRows([mkM({ bookSeen: true }), mkM({ assignFrom: '2024-04', assignSrc })], [], [], null)[1])
    expect(src('manual')).toBe('这个月导入的册子里没有这块表;显示的是自 2024-04 起那一行(手改)')
    expect(src('contract')).toBe('这个月导入的册子里没有这块表;显示的是自 2024-04 起那一行(合同终止)')
  })
  it('停用 / 不在册的行不打标(同待核:本月不在服务中)', () => {
    expect(row(p2idle.id).book).toBe('missing')
    expect(bookTip(row(p2idle.id))).toBeNull()
    expect(bookTip(row(p2gone.id))).toBeNull()
  })
  it('筛选「本月册子里没有」= 打了标签的那几行;不是统计卡维度,分母不变', () => {
    expect(filterRows(rows, F({ status: 'bookMissing' })).map(x => x.m.id)).toEqual([p2old.id, p2imp.id])
    expect(filterRows(rows, F({ status: 'bookMissing', zone: 'p1' }))).toEqual([])
    expect(filterRows(rows, F({ status: 'bookMissing', kind: 'water' }))).toEqual([])
    expect(cardCounts(rows).tenant).toBe(7)   // 9 块减停用、已拆各一;打没打标都在分母里
  })
  it('抽屉顶部那一句:文件名 · 时间 / 册子里没有这块表 / 整段还没导入过', () => {
    expect(bookLine(row(p2seen.id))).toBe('本月册子:二期电 2024-05.xlsx · 2026-09-24 10:30')
    expect(bookLine(row(p1w.id))).toBe('本月册子:文件名没有记下 · ')
    expect(bookLine(row(p2old.id))).toBe('这个月导入的册子里没有这块表')
    expect(bookLine(row(p1a.id))).toBe(`这个月还没导入过一期的电表册子。${BOOK_REDO}`)
  })
})

describe('缺底数(SPEC §3.4)— 有本月行至、没有上月行至:不算已抄,开放录入起始底数', () => {
  const fresh = mkM({ ownership: 'tenant', tenantId: 1 })                 // 新表首月:有本月读数,没有底数
  const ok = mkM({ ownership: 'tenant', tenantId: 2 })
  const rows = buildRows([fresh, ok],
    [mkR(fresh.id, { prevTotal: null, currTotal: 120 }), mkR(ok.id, { prevTotal: 100, currTotal: 130, usageTotal: 30 })],
    [], null)
  it('徽标「缺底数」,算未抄不算已抄;租户表总数 = 已抄 + 未抄 仍成立', () => {
    expect(rows[0].noBase).toBe(true)
    expect(rows[0].status).toBe('noBase')
    expect(statusDims(rows[0])).toContain('缺底数')
    const c = cardCounts(rows)
    expect([c.read, c.missing, c.tenant]).toEqual([1, 1, 2])
    expect(filterRows(rows, F({ status: 'noBase' })).map(x => x.m.id)).toEqual([fresh.id])
  })
  it('有本月读数时底数只认它自己的上月行至(后端算用量只看这一格),不拿上月读数顶上去', () => {
    const m = mkM()
    const [x] = buildRows([m], [mkR(m.id, { prevTotal: null, currTotal: 50 })], [mkR(m.id, { ym: '2024-04', currTotal: 40 })], null)
    expect(x.prevTotal).toBeNull()
    expect(x.noBase).toBe(true)
    expect(baseOpen(x)).toBe(true)
    expect(baseOpen(rows[1])).toBe(false)
  })
  it('底数写进草稿:用量实时算出、页脚计已抄、保存请求带上这一格', () => {
    const d: MeterDraft = { prevTotal: '100' }
    expect(draftRowDirty(rows[0], d)).toBe(true)
    expect(rowUsage(rows[0], d)).toBe(20)
    expect(gridFooter(rows, new Map()).read).toBe(1)
    expect(gridFooter(rows, new Map([[fresh.id, d]])).read).toBe(2)
    expect(draftReq(rows[0], d, '2024-05')).toMatchObject({ prevTotal: 100, currTotal: 120 })
  })
})

describe('healRows(SPEC §3.4)— 未在册的表录了本月读数,保存前要点名', () => {
  const later = mkM({ status: null })
  const live = mkM()
  const rows = buildRows([later, live], [], [], null)
  it('未在册 + 本月止有值 → 点名;只填底数 / 在册的表 → 不点名', () => {
    expect(healRows(rows, new Map([[later.id, { currTotal: '5' }], [live.id, { currTotal: '5' }]])).map(x => x.m.id))
      .toEqual([later.id])
    expect(healRows(rows, new Map([[later.id, { prevTotal: '5' }]]))).toEqual([])
    expect(healRows(rows, new Map([[later.id, { currTotal: '' }]]))).toEqual([])
  })
  // 自愈只在新录一条时发生(后端 createReading);改已有的读数不补在册 —— 对它承诺「将从 M 起在册」是假话
  it('未在册但本月已有读数(改读数走 updateReading)→ 不点名', () => {
    const had = mkM({ status: null })
    const rs = buildRows([had], [mkR(had.id, { currTotal: 3 })], [], null)
    expect(healRows(rs, new Map([[had.id, { currTotal: '5' }]]))).toEqual([])
  })
})

// METER-TIMELINE-SPEC §3.6:钉的合同不是这一段租户的(换户后没重钉)→ 后端不采用,contractId 为空、带出 pinnedContractNo
describe('钉了别户合同的 override_stale — 不说成「本月没生效」', () => {
  it('bindReason 与抄表屏悬停都说「不是这一段租户的合同」;钉的是本户的那一种照旧', () => {
    const pinned = mkB(1, { status: 'override_stale', contractId: null, pinnedContractNo: 'C-009' })
    expect(bindReason('stale', pinned)).toBe('人工绑定的是 C-009,它不是这一段租户的合同,没有采用;该户本月也没有别的有效合同')
    const m = mkM({ ownership: 'tenant', tenantId: 7, tenantName: '力灏' })
    const x = buildRows([m], [], [], [mkB(m.id, { status: 'override_stale', contractId: null, pinnedContractNo: 'C-009' })])[0]
    expect(statusDims(x)).toContain('待绑定:人工绑定的 C-009 不是这一段租户的合同,没有采用')
    expect(statusDims(x)).not.toContain('本月没生效')
    const own = buildRows([m], [], [], [mkB(m.id, { status: 'override_stale', contractId: 5, contractNo: 'C-005' })])[0]
    expect(statusDims(own)).toContain('待绑定:绑的那份合同本月没生效')
  })
})

describe('filterRows — 电水/分区/楼栋/归属/状态/搜索 链', () => {
  const a = mkM({ kind: 'elec', zone: 'p1', buildingId: 11, ownership: 'tenant', tenantId: 1 })
  const b = mkM({ kind: 'elec', zone: 'p2', buildingId: 12, ownership: 'share', name: '走廊灯' })
  const c = mkM({ kind: 'water', zone: 'p1', ownership: 'tenant', tenantId: 2 })
  const rows = buildRows([a, b, c], [mkR(a.id, { prevTotal: 2, currTotal: 3, usageTotal: 1 })], [], null,
    new Map([[1, '力灏实业'], [2, '碳紫科技']]))
  it('kind/zone/building/own 过滤', () => {
    expect(filterRows(rows, F()).map(x => x.m.id)).toEqual([a.id, b.id])
    expect(filterRows(rows, F({ zone: 'p2' })).map(x => x.m.id)).toEqual([b.id])
    expect(filterRows(rows, F({ building: '11' })).map(x => x.m.id)).toEqual([a.id])
    expect(filterRows(rows, F({ own: 'share' })).map(x => x.m.id)).toEqual([b.id])
    expect(filterRows(rows, F({ kind: 'water' })).map(x => x.m.id)).toEqual([c.id])
  })
  it('状态筛选(已抄)与搜索(库内全名,带空白裁剪)', () => {
    expect(filterRows(rows, F({ status: 'read' })).map(x => x.m.id)).toEqual([a.id])
    expect(filterRows(rows, F({ q: ' 力灏 ' })).map(x => x.m.id)).toEqual([a.id])
    expect(filterRows(rows, F({ q: '走廊' })).map(x => x.m.id)).toEqual([b.id])
  })
})

describe('草稿式编辑(v5.1 §7)— effCurr/脏行/用量重算/校验红显/请求构造/tfoot 页脚', () => {
  it('effVal:草稿覆盖服务器;空串=清空;非法文本=null;未编辑字段回落读数', () => {
    const m = mkM()
    const [x] = buildRows([m], [mkR(m.id, { currTotal: 100, currSharp: 5 })], [], null)
    expect(effVal(x, undefined, 'currTotal')).toBe(100)
    expect(effVal(x, { currTotal: '120.5' }, 'currTotal')).toBe(120.5)
    expect(effVal(x, { currTotal: '' }, 'currTotal')).toBeNull()
    expect(effVal(x, { currTotal: 'abc' }, 'currTotal')).toBeNull()
    expect(effVal(x, { currTotal: '120' }, 'currSharp')).toBe(5)
  })

  it('draftRowDirty/draftDirtyIds:数值等价("100"=100)不算脏;无读数录空不算;真改动才算', () => {
    const m1 = mkM(), m2 = mkM(), m3 = mkM()
    const rows = buildRows([m1, m2, m3], [mkR(m1.id, { currTotal: 100 })], [], null)
    const draft = new Map<number, MeterDraft>([
      [m1.id, { currTotal: '100' }],       // 等值
      [m2.id, { currTotal: '' }],          // 无读数录空=无操作
      [m3.id, { currTotal: '7' }],         // 真改动
    ])
    expect(draftRowDirty(rows[0], draft.get(m1.id))).toBe(false)
    expect(draftRowDirty(rows[0], { currTotal: '101' })).toBe(true)
    expect(draftRowDirty(rows[0], undefined)).toBe(false)
    expect(draftDirtyIds(rows, draft)).toEqual([m3.id])
    expect(draftDirtyIds(rows, new Map())).toEqual([])
  })

  it('rowUsage:草稿改总示数按(本月−上月)×倍率重算;只动段/无草稿用服务器 usageTotal', () => {
    const m = mkM({ factor: 2 })
    const [x] = buildRows([m], [mkR(m.id, { prevTotal: 50, currTotal: 60, factorSnap: 2, usageTotal: 20 })], [], null)
    expect(rowUsage(x, undefined)).toBe(20)
    expect(rowUsage(x, { currTotal: '80' })).toBe(60)     // (80−50)×2
    expect(rowUsage(x, { currTotal: '' })).toBeNull()     // 清空=不可算
    expect(rowUsage(x, { currSharp: '9' })).toBe(20)      // 只动段:总用量不变
  })

  it('draftRowIssues:倒走红显;电表 Σ段≠总红显;段未齐不可判不红;水表不做段校验', () => {
    const e = mkM({ factor: 1 })
    const [x] = buildRows([e], [mkR(e.id, {
      prevTotal: 0, prevSharp: 0, prevPeak: 0, prevFlat: 0, prevValley: 0,
      currTotal: 100, currSharp: 10, currPeak: 20, currFlat: 30, currValley: 40, factorSnap: 1,
    })], [], null)
    expect(draftRowIssues(x, undefined)).toEqual([])                                  // Σ=100=总
    expect(draftRowIssues(x, { currTotal: '150' }).join()).toContain('时段不符')
    expect(draftRowIssues(x, { currTotal: '-5' }).some(s => s.includes('倒走'))).toBe(true)
    expect(draftRowIssues(x, { currSharp: '' })).toEqual([])                          // 段未齐→不可判
    const w = mkM({ kind: 'water' })
    const [y] = buildRows([w], [mkR(w.id, { prevTotal: 10, currTotal: 8, factorSnap: 1, usageTotal: -2 })], [], null)
    expect(draftRowIssues(y, undefined)).toEqual(['倒走:总用量为负,疑换表/抄错'])
  })

  it('draftReq:无读数=POST 形(prev 预填上月行至+草稿值);有读数=PUT 形(prev/note 保留,五格覆写)', () => {
    const m = mkM()
    const prev = mkR(m.id, { ym: '2024-04', currTotal: 99, currSharp: 1, currPeak: 2, currFlat: 3, currValley: 4 })
    const [x] = buildRows([m], [], [prev], null)
    expect(draftReq(x, { currTotal: '120' }, '2024-05')).toMatchObject({
      meterId: m.id, ym: '2024-05', prevTotal: 99, prevSharp: 1, prevValley: 4,
      currTotal: 120, currSharp: null, note: null,
    })
    const r = mkR(m.id, { prevTotal: 50, currTotal: 60, currSharp: 7, note: '换表' })
    const [y] = buildRows([m], [r], [], null)
    expect(draftReq(y, { currPeak: '9' }, '2024-05')).toMatchObject({
      ym: '2024-05', prevTotal: 50, currTotal: 60, currSharp: 7, currPeak: 9, note: '换表',
    })
  })

  it('gridFooter:已抄/未抄按有效总示数与底数(草稿实时);Σ用量=非空行合计,全空=null', () => {
    const m1 = mkM({ factor: 1 }), m2 = mkM(), m3 = mkM()
    const rows = buildRows([m1, m2, m3],
      [mkR(m1.id, { prevTotal: 0, currTotal: 10, factorSnap: 1, usageTotal: 10 })],
      [mkR(m2.id, { ym: '2024-04', currTotal: 1 })], null)
    expect(gridFooter(rows, new Map())).toEqual({ read: 1, missing: 2, usageSum: 10 })
    const draft = new Map<number, MeterDraft>([
      [m1.id, { currTotal: '' }],          // 清空:已抄→未抄,用量不可算
      [m2.id, { currTotal: '5' }],         // 新录:上月行至 1 作底数 → 已抄,用量 4
      [m3.id, { currTotal: '7' }],         // 新录但没有底数(缺底数)→ 仍算未抄
    ])
    expect(gridFooter(rows, draft)).toEqual({ read: 1, missing: 2, usageSum: 4 })
    expect(gridFooter([], new Map())).toEqual({ read: 0, missing: 0, usageSum: null })
  })
})

describe('segUsage / segCheck — Σ段实时校验(容差同 meterLogic:max(1, |总|×1%))', () => {
  it('单段用量=(本月−上月)×倍率,round2;任一端缺=null', () => {
    expect(segUsage(10, 12.345, 2)).toBe(4.69)
    expect(segUsage(null, 12, 2)).toBeNull()
    expect(segUsage(10, null, 2)).toBeNull()
  })
  it('段/总齐且 |Σ−总|≤容差 → ok;超容差红显差值', () => {
    // 段用量 10+20+30+40=100,总=(150-50)×1=100 → ok
    const ok = segCheck([0, 0, 0, 0], [10, 20, 30, 40], 50, 150, 1)
    expect(ok).toEqual({ segSum: 100, total: 100, diff: 0, ok: true })
    // 总=110 → 差 -10 超容差(max(1, 1.1)=1.1)
    const bad = segCheck([0, 0, 0, 0], [10, 20, 30, 40], 50, 160, 1)
    expect(bad.ok).toBe(false)
    expect(bad.diff).toBe(-10)
    // 容差内(差 1 ≤ max(1, 1.01)) → ok
    expect(segCheck([0, 0, 0, 0], [10, 20, 30, 41], 50, 150, 1).ok).toBe(true)
  })
  it('段未齐/总未录 → ok=null 不可判', () => {
    expect(segCheck([0, 0, 0, null], [10, 20, 30, 40], 50, 150, 1).ok).toBeNull()
    expect(segCheck([0, 0, 0, 0], [10, 20, 30, 40], null, 150, 1).ok).toBeNull()
    expect(segCheck([0, 0, 0, 0], [10, 20, 30, 40], 50, null, 1).total).toBeNull()
  })
  it('倍率参与:段与总同乘快照', () => {
    const c = segCheck([0, 0, 0, 0], [1, 2, 3, 4], 0, 10, 40)
    expect(c.segSum).toBe(400)
    expect(c.total).toBe(400)
    expect(c.ok).toBe(true)
  })
})

describe('buildingTotals — 楼栋合计/损耗(复用 meterGroup 口径)', () => {
  it('合计=tenant+share(总+四段,round2);infra/ops 不计;损耗=分表Σ−infra 总表', () => {
    const head = mkM({ ownership: 'infra' })
    const t1 = mkM({ ownership: 'tenant', tenantId: 1 })
    const s1 = mkM({ ownership: 'share' })
    const o1 = mkM({ ownership: 'ops' })
    const rows = buildRows([head, t1, s1, o1], [
      mkR(head.id, { usageTotal: 100 }),
      mkR(t1.id, { usageTotal: 60.005, usageSharp: 10 }),
      mkR(s1.id, { usageTotal: 30, usageSharp: 5 }),
      mkR(o1.id, { usageTotal: 999 }),                       // ops 不计入
    ], [], null)
    const t = buildingTotals(rows)!
    expect(t.sums.count).toBe(2)
    expect(t.sums.usageTotal).toBe(90.01)                    // 60.005+30 → round2
    expect(t.sums.usageSharp).toBe(15)
    expect(t.loss).not.toBeNull()
    expect(t.loss!.headQty).toBe(100)
    expect(t.loss!.lossQty).toBe(-9.99)                      // 90.01−100
    expect(t.loss!.warn).toBe(true)                          // -9.99% < -5%
  })
  it('无 infra 总表读数=无损耗行;空行集=null', () => {
    const t1 = mkM({ ownership: 'tenant', tenantId: 1 })
    const rows = buildRows([t1], [mkR(t1.id, { usageTotal: 5 })], [], null)
    expect(buildingTotals(rows)!.loss).toBeNull()
    expect(buildingTotals([])).toBeNull()
  })
})

describe('groupByBuilding — 楼栋分组汇总行(§7.6)', () => {
  const names = new Map([[11, 'A栋'], [12, 'B栋']])

  // 用户 2026-07-30 报障:组序原本吃导入 sort_no,V66 补档一块 sort_no=0 的表就把 D座 拽到 A座 前面。
  // 现按账册固定楼栋序排,未收录楼栋在后、未挂楼栋恒垫底;并列用首现序兜底(不做字母重排)。
  it('未收录楼栋按首现序、未挂楼栋垫底', () => {
    const a = mkM({ buildingId: 11 }), b = mkM({ buildingId: null }),
          c = mkM({ buildingId: 12 }), d = mkM({ buildingId: 11 })
    const gs = groupByBuilding(buildRows([a, b, c, d], [], [], null), names, new Map())
    expect(gs.map(g => g.label)).toEqual(['A栋', 'B栋', '未挂楼栋'])
    expect(gs[0].rows.map(x => x.m.id)).toEqual([a.id, d.id])
    expect(gs[2].key).toBe('none')
    expect(gs[2].rows.map(x => x.m.id)).toEqual([b.id])
  })

  it('组序照账册楼栋序(A→G→招商中心→车间→宿舍),与导入序无关', () => {
    const real = new Map([[1, '一期 D座'], [2, '一期 A座'], [3, '二期 一车间'], [4, '一期 宿舍二栋']])
    const rows = buildRows(
      [mkM({ buildingId: 1 }), mkM({ buildingId: 2 }), mkM({ buildingId: 3 }), mkM({ buildingId: 4 })],
      [], [], null)
    expect(groupByBuilding(rows, real, new Map()).map(g => g.label))
      .toEqual(['一期 A座', '一期 D座', '二期 一车间', '一期 宿舍二栋'])
  })

  it('段内:总表(infra)在前,再按楼层(负一层<一楼<二楼<天面)', () => {
    const f2 = mkM({ buildingId: 11, spot: '二楼201室' })
    const head = mkM({ buildingId: 11, ownership: 'infra', spot: null })
    const b1 = mkM({ buildingId: 11, spot: '负一层' })
    const roof = mkM({ buildingId: 11, spot: '天面' })
    const f1 = mkM({ buildingId: 11, spot: '一楼101室' })
    const gs = groupByBuilding(buildRows([f2, head, b1, roof, f1], [], [], null), names, new Map())
    expect(gs[0].rows.map(x => x.m.id)).toEqual([head.id, b1.id, f1.id, f2.id, roof.id])
  })

  // §A.2:排序键改走 V74 结构化字段 floorLabel/side/roomNo,取不到才回退 spot 原文解析
  const idsOf = (ms: (MeterDTO & MeterLoc)[]) =>
    groupByBuilding(buildRows(ms, [], [], null), names, new Map())[0].rows.map(x => x.m.id)

  it('floorRankOf:floorLabel 优先(天面99/负一层−1/N楼N/认不出50),空则回退 spot', () => {
    expect(floorRankOf({ floorLabel: '天面', spot: '一楼101室' })).toBe(99)
    expect(floorRankOf({ floorLabel: '负一层' })).toBe(-1)
    expect(floorRankOf({ floorLabel: '四楼' })).toBe(4)
    expect(floorRankOf({ floorLabel: '10楼' })).toBe(10)
    expect(floorRankOf({ floorLabel: '夹层' })).toBe(50)          // 有楼层原文但认不出
    expect(floorRankOf({ floorLabel: '  ', spot: '二楼201室' })).toBe(2)   // 空白视同未录 → 回退 spot
    expect(floorRankOf({ floorLabel: null, spot: null })).toBe(0) // 两者皆空不炸
  })

  it('天面排该栋末尾(结构化字段口径)', () => {
    const roof = mkM({ buildingId: 11, floorLabel: '天面' })
    const f1 = mkM({ buildingId: 11, floorLabel: '一楼' })
    const b1 = mkM({ buildingId: 11, floorLabel: '负一层' })
    expect(idsOf([roof, f1, b1])).toEqual([b1.id, f1.id, roof.id])
  })

  it('同层按方位:东<西<南<北<空', () => {
    const w = mkM({ buildingId: 11, floorLabel: '四楼', side: '西侧' })
    const none = mkM({ buildingId: 11, floorLabel: '四楼' })
    const n = mkM({ buildingId: 11, floorLabel: '四楼', side: '北侧' })
    const e = mkM({ buildingId: 11, floorLabel: '四楼', side: '东侧' })
    expect(idsOf([w, none, n, e])).toEqual([e.id, w.id, n.id, none.id])
  })

  it('同层同方位按房号自然序(101<102<1001,不是字符串序)', () => {
    const r1001 = mkM({ buildingId: 11, floorLabel: '一楼', roomNo: '1001室' })
    const r102 = mkM({ buildingId: 11, floorLabel: '一楼', roomNo: '102室' })
    const r101 = mkM({ buildingId: 11, floorLabel: '一楼', roomNo: '101室' })
    expect(idsOf([r1001, r102, r101])).toEqual([r101.id, r102.id, r1001.id])
  })

  it('floorLabel 空 → 回退 spot 解析,与已录结构化字段的表混排仍有序', () => {
    const f3 = mkM({ buildingId: 11, floorLabel: '三楼' })
    const f1Spot = mkM({ buildingId: 11, spot: '一楼101室' })      // 存量:只有 spot
    const f2Spot = mkM({ buildingId: 11, spot: '二楼201室' })
    expect(idsOf([f3, f2Spot, f1Spot])).toEqual([f1Spot.id, f2Spot.id, f3.id])
  })

  it('spot 与 floorLabel 都空不炸,退回导入序/id', () => {
    const b = mkM({ buildingId: 11, sortNo: 7 })
    const a = mkM({ buildingId: 11, sortNo: 3 })
    expect(idsOf([b, a])).toEqual([a.id, b.id])
  })

  it('usage 只汇 tenant+share(infra 防重复/ops 不计);总+四段 round2,同 meterGroup §7.2 口径', () => {
    const head = mkM({ buildingId: 11, ownership: 'infra' })
    const t = mkM({ buildingId: 11, ownership: 'tenant', tenantId: 1 })
    const s = mkM({ buildingId: 11, ownership: 'share' })
    const o = mkM({ buildingId: 11, ownership: 'ops' })
    const rows = buildRows([head, t, s, o], [
      mkR(head.id, { usageTotal: 100 }),
      mkR(t.id, { usageTotal: 60.005, usageSharp: 10 }),
      mkR(s.id, { usageTotal: 30, usageSharp: 5 }),
      mkR(o.id, { usageTotal: 999 }),
    ], [], null)
    const [g] = groupByBuilding(rows, names, new Map())
    expect(g.usage.total).toBe(90.01)                            // 60.005+30 → round2;infra/ops 不计
    expect(g.usage.sharp).toBe(15)
    expect(g.usage.peak).toBeNull()                              // 无值段=null
  })

  it('draft 变化实时重算:总与段草稿都参与(口径同 rowUsage)', () => {
    const t = mkM({ buildingId: 11, ownership: 'tenant', tenantId: 1, factor: 2 })
    const rows = buildRows([t], [mkR(t.id, {
      prevTotal: 50, currTotal: 60, prevSharp: 0, currSharp: 3,
      factorSnap: 2, usageTotal: 20, usageSharp: 6,
    })], [], null)
    expect(groupByBuilding(rows, names, new Map())[0].usage).toMatchObject({ total: 20, sharp: 6 })
    const draft = new Map<number, MeterDraft>([[t.id, { currTotal: '80', currSharp: '5' }]])
    const [g] = groupByBuilding(rows, names, draft)
    expect(g.usage.total).toBe(60)                               // (80−50)×2
    expect(g.usage.sharp).toBe(10)                               // (5−0)×2
  })
})

describe('bindQueueBucket / autoLinkEstimate — v4 meterBindQueue 口径并入', () => {
  it('状态→桶:绿与占位=null;manual 缺 bucket 兜底 no_contract', () => {
    for (const status of ['auto', 'auto_bld', 'override', 'placeholder'] as const) {
      expect(bindQueueBucket({ status })).toBeNull()
    }
    expect(bindQueueBucket({ status: 'pending' })).toBe('pending')
    expect(bindQueueBucket({ status: 'override_stale' })).toBe('stale')
    expect(bindQueueBucket({ status: 'manual', bucket: 'ambiguous' })).toBe('ambiguous')
    expect(bindQueueBucket({ status: 'manual' })).toBe('no_contract')
  })
  // ⚠ 「过期」曾被用户读成「这份合同到期了」(2026-09-23 报障:合同明明覆盖这个月还写过期)。
  //   这一档说的是「有人把这块表指给了这一份,而本月不在它的租期内」——往往是它还没开始。
  //   破坏验证:把 'stale' 那一支改回 `${contractNo} 不覆盖本月,请复核` → 本行红。
  it('stale 的话要说清是绑定不适用、不是合同到期;有候选时指到候选上', () => {
    const base = { meterId: 1, status: 'override_stale', contractNo: 'C2024M-022A#3', hasReading: true } as const
    const withCands = bindReason('stale', { ...base, candidates: [
      { contractId: 419, contractNo: 'C2024M-022A#2', buildingName: 'A座', startDate: null, endDate: null },
      { contractId: 423, contractNo: 'C2024M-022#2', buildingName: 'A座', startDate: null, endDate: null },
    ] })
    expect(withCands).toContain('本月还没生效或已到期')
    expect(withCands).toContain('2 份')          // 候选数报出来:原先这一档候选恒空,屏上只剩「该户无候选合同」
    expect(withCands).not.toContain('C2024M-022A#3')   // 合同号在左边那一格,别印第二遍
    expect(bindReason('stale', base)).toContain('该户本月也没有别的有效合同')
  })
  it('一键挂预估:精确全等且档案内唯一才计入', () => {
    const tenantNames = ['锂朋科技', '嘉荣', '嘉荣', '力灏']
    expect(autoLinkEstimate(['锂朋科技'], tenantNames)).toBe(1)
    expect(autoLinkEstimate(['嘉荣'], tenantNames)).toBe(0)        // 档案重名
    expect(autoLinkEstimate(['锂朋'], tenantNames)).toBe(0)        // 子串≠精确
    expect(autoLinkEstimate(['不存在', null], tenantNames)).toBe(0)
    expect(autoLinkEstimate(['锂朋科技', '力灏', '嘉荣'], tenantNames)).toBe(2)
  })
})

describe('flattenGroups / offsetOf / buildWindow — 行窗口化虚拟滚动(§7 6.5)', () => {
  // 类型字符拼列表:r=数据行(34) b=汇总行(40);buildWindow/offsetOf 只读 type
  const mkList = (pat: string): DisplayItem[] =>
    [...pat].map(ch => ch === 'b'
      ? { type: 'bsum', g: {} as BuildingGroup }
      : { type: 'row', x: {} as WorkbenchRow })

  it('flattenGroups:组内行原序展平,每组末尾插 bsum 项', () => {
    const names = new Map([[11, 'A栋']])
    const a = mkM({ buildingId: 11 }), b = mkM({ buildingId: 11 }), c = mkM({ buildingId: null })
    const rows = buildRows([a, b, c], [], [], null)
    const list = flattenGroups(groupByBuilding(rows, names, new Map()))
    expect(list.map(it => it.type)).toEqual(['row', 'row', 'bsum', 'row', 'bsum'])
    expect(list[0].type === 'row' && list[0].x.m.id).toBe(a.id)
    expect(list[2].type === 'bsum' && list[2].g.label).toBe('A栋')
    expect(list[4].type === 'bsum' && list[4].g.key).toBe('none')
  })

  it('offsetOf:混合行高前缀和;0 起点;越界夹紧到总高', () => {
    const list = mkList('rrrrrbrrrrrb')                   // 10×34+2×40=420
    expect(offsetOf(list, 0)).toBe(0)
    expect(offsetOf(list, 5)).toBe(5 * ROW_H)             // 170
    expect(offsetOf(list, 6)).toBe(5 * ROW_H + BSUM_H)    // 210:跨过 bsum
    expect(offsetOf(list, list.length)).toBe(420)
    expect(offsetOf(list, 99)).toBe(420)                  // 越界=总高
  })

  it('窗口边界:纯数据行,可视 10 行±buffer;部分行相交也计入', () => {
    const list = mkList('r'.repeat(30))
    expect(buildWindow(list, 0, 340, 2))                  // 顶部:上缓冲夹紧 0
      .toEqual({ start: 0, end: 12, topPad: 0, bottomPad: 18 * ROW_H })
    expect(buildWindow(list, 340, 340, 2))                // 中段:raw [10,20)±2
      .toEqual({ start: 8, end: 22, topPad: 8 * ROW_H, bottomPad: 8 * ROW_H })
    expect(buildWindow(list, 17, 340, 2))                 // 半行相交:首尾部分可见行都渲染
      .toEqual({ start: 0, end: 13, topPad: 0, bottomPad: 17 * ROW_H })
  })

  it('混合行高窗口:pad=前后段真实高度和,invariant topPad+窗内+bottomPad=总高', () => {
    const list = mkList('rrrrrbrrrrrb')
    const w = buildWindow(list, 210, 100, 0)              // scrollTop 恰在 bsum 之后
    expect(w).toEqual({ start: 6, end: 9, topPad: 210, bottomPad: 108 })
    const winH = 3 * ROW_H
    expect(w.topPad + winH + w.bottomPad).toBe(420)
  })

  it('首尾夹紧:超滚到底渲染末段;buffer 超表长=整表;负 scrollTop 视 0', () => {
    const list = mkList('rrrrrbrrrrrb')
    expect(buildWindow(list, 100000, 340, 2))             // 尾:end 夹到 n
      .toEqual({ start: 10, end: 12, topPad: 9 * ROW_H + BSUM_H, bottomPad: 0 })
    expect(buildWindow(mkList('rrrrr'), 0, 68, 12))       // 短表:整表渲染,零 pad
      .toEqual({ start: 0, end: 5, topPad: 0, bottomPad: 0 })
    expect(buildWindow(list, -50, 340, 2))                // iOS 弹性负滚
      .toEqual(buildWindow(list, 0, 340, 2))
  })

  it('空表:全零窗口', () => {
    expect(buildWindow([], 123, 456)).toEqual({ start: 0, end: 0, topPad: 0, bottomPad: 0 })
  })

  it('验收锚点:220 行/40 行视口/默认 buffer=12 → 渲染 65 行,电表 16 列 <1200 格', () => {
    const list = mkList('r'.repeat(220))
    const w = buildWindow(list, 2000, 40 * ROW_H)         // 默认 buffer=12
    expect(w.end - w.start).toBe(65)                      // ~41 可视+24 缓冲
    expect((w.end - w.start) * 16).toBeLessThan(1200)     // vs 全量 3409 格
  })
})
