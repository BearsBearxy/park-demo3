import { describe, expect, it } from 'vitest'
import {
  buildDetail, buildLab, buildSnapshot, median,
  type LabResult, type ReadingRow, type SnapshotInput, type StationCfg, type StationDetail,
} from './pvMeterAna.logic'
import {
  acfBars, alphaBars, anchorBars, betaSlots, chipGroups, consumption, controlChart, CP_P_MAX, critFoot,
  dayFact, dayOfYear, denomNote, detailRows, driftChart, isUnreadable, kpiSparks, kpiTiles, labTableRows,
  ledgerScatter, LOSS_AXIS_MAX, missingN, NULL_BINS, nullHist, phaseName, polishStability, qualityCalendar,
  residualGrid, revenueBars, timeKpiSparks, unreadableWhy, yieldBand,
} from './pvAnaV4.logic'

// ── 夹具 ─────────────────────────────────────────────────────────────────
// 计划 §2.5:真库 3171 行零缺抄、零「在网 < 3 栋」日,两态点不亮 —— 夹具必须自己把它们造出来。
// 这里一份整年(1/1–8/28)数据同时含:连续低于(F座,6/9 起)、连续高于(G座 8/18–22)、
// 零散出范围(11栋)、漏抄(E座 8/25、G座 8/14)、整日剔除(8/17 只有两栋抄)、覆盖不足读不出(9栋)、
// 在网不足 90 天读不出(10栋,2 月才投产且抄得稀)、未投产(创业大厦整年无抄表)、未装表、
// 板数部分录入(3 栋全录、1 栋只录了单块标称)、台账差超线(12栋)、上一年只有两栋有抄表且月份不齐。
// 噪声是确定性 LCG ±6%,损耗率逐日变、8/10 冲到 7%。

const Y = 2025
const TODAY = '2025-08-28'
const pad = (n: number) => String(n).padStart(2, '0')
const dim = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate()

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

const st = (id: number, name: string, phase: number, cap: number, count: number | null, watt: number | null): StationCfg =>
  ({ id, name, phase, metered: true, capKwp: cap, panelCount: count, panelWatt: watt })
const STATIONS: StationCfg[] = [
  st(1, 'B座', 1, 500, 1000, 500),
  st(2, 'C、D座', 1, 780, null, null),
  st(3, 'E座', 1, 390, 800, 500),        // 板数 × 标称 400,台账差 −2.5%(带内)
  st(4, 'F座', 1, 390, null, 540),       // 只录了单块标称 → 不出点
  st(5, 'G座', 1, 390, null, null),
  st(6, '8栋', 2, 340, null, null),
  st(7, '9栋', 2, 340, null, null),
  st(8, '10栋', 2, 340, null, null),
  st(9, '11栋', 2, 340, null, null),
  st(10, '12栋', 2, 340, 760, 500),      // 380 vs 340,台账差 −10.5% → 踢出 α 排序
  st(11, '创业大厦', 3, 600, null, null),
  { ...st(12, '未装表楼', 3, 200, null, null), metered: false },
]
const LEVEL = [1.00, 1.04, 0.97, 0.93, 1.02, 1.06, 0.99, 1.01, 1.03, 0.96]

function reads(i: number, m: number, d: number): boolean {
  if (i >= 10) return false
  if (m > 8 || (m === 8 && d > 28)) return false
  if (m === 8 && d === 17) return i <= 1                 // 整日剔除:只有两栋抄
  if (i === 2 && m === 8 && d === 25) return false       // E座 漏抄
  if (i === 4 && m === 8 && d === 14) return false       // G座 漏抄
  if (i === 6 && m === 8 && d > 18) return false         // 9栋 本月后半段没抄
  if (i === 7) {                                          // 10栋:2 月投产,早期抄得稀
    if (m === 1) return false
    if (m === 2) return d === 1 || d === 15
    if (m < 8) return d % 4 === 1
  }
  return true
}
function factor(i: number, m: number, d: number): number {
  if (i === 3 && (m > 6 || (m === 6 && d >= 9))) return 0.65
  if (i === 4 && m === 8 && d >= 18 && d <= 22) return 1.35
  if (i === 8 && m === 8) return ({ 5: 1.3, 12: 0.7, 20: 1.3, 24: 0.7 } as Record<number, number>)[d] ?? 1
  return 1
}
const weather = (doy: number) => 1 + 0.25 * Math.sin(doy * 0.9) + 0.1 * Math.cos(doy * 0.37)
const lossRate = (m: number, d: number) => (m === 8 && d === 10 ? 0.07 : 0.01 + 0.04 * (d % 7) / 6)

function makeRows(year: number, keep: (i: number, m: number, d: number) => boolean, fac: typeof factor, base: number): ReadingRow[] {
  const rnd = lcg(year * 7 + 11)
  const rows: ReadingRow[] = []
  for (let m = 1; m <= 12; m++) {
    for (let d = 1; d <= dim(year, m); d++) {
      const doy = dayOfYear(`${year}-${pad(m)}-${pad(d)}`)
      for (let i = 0; i < 10; i++) {
        const noise = 1 + 0.12 * (rnd() - 0.5)
        if (!keep(i, m, d)) continue
        const gen = STATIONS[i].capKwp! * base * weather(doy) * LEVEL[i] * fac(i, m, d) * noise
        const selfUse = gen * (0.55 + 0.2 * ((d + i) % 5) / 4)
        const gridFeed = gen * (1 - lossRate(m, d)) - selfUse
        const price = STATIONS[i].phase === 1 ? 0.52 : 0.6
        rows.push({ stationId: i + 1, date: `${year}-${pad(m)}-${pad(d)}`, gen, selfUse, gridFeed, revenue: selfUse * price, priceSnap: price })
      }
    }
  }
  return rows
}

const ROWS = makeRows(Y, reads, factor, 3.4)
// 上一年:只有 B座(1–8 月)与 E座(1–6 月)有抄表
const PREV = makeRows(Y - 1, (i, m) => (i === 0 && m <= 8) || (i === 2 && m <= 6), () => 1, 3.2)

const INPUT: SnapshotInput = {
  year: Y, gran: 'month', month: 8, stations: STATIONS, rows: ROWS, prevRows: PREV,
  gridPrice: 0.4, today: TODAY,
}
const SNAP = buildSnapshot(INPUT)
const SNAP_Y = buildSnapshot({ ...INPUT, gran: 'year' })
const row = (name: string) => SNAP.board.find(b => b.name === name)!
const idOf = (name: string) => STATIONS.find(s => s.name === name)!.id

let labMemo: LabResult | null = null
const LAB = () => (labMemo ??= buildLab(SNAP, INPUT, idOf('F座')))
const DETAIL_F = () => buildDetail(SNAP, idOf('F座'))!
const SLOW = { timeout: 120_000 }

// ── 读不出 / 缺抄 ────────────────────────────────────────────────────────
describe('isUnreadable / missingN', () => {
  it('9栋:本月已抄 17 / 应抄 28 → 读不出;缺抄 11(17 日与 19–28 日)', () => {
    const b = row('9栋')
    expect(missingN(b, SNAP.ticks)).toBe(11)
    expect(b.seenN).toBe(17)
    expect(isUnreadable(b, SNAP)).toBe(true)
  })
  it('10栋:覆盖 27/28 够线,只因整年在网 < 90 天读不出', () => {
    const b = row('10栋')
    const days = SNAP.stations.find(s => s.id === b.id)!.days
    expect(b.seenN / (b.seenN + missingN(b, SNAP.ticks))).toBeGreaterThanOrEqual(0.9)
    expect(days).toBeLessThan(90)
    expect(isUnreadable(b, SNAP)).toBe(true)
    // 对照:把门槛降到 days 以下,同一栋就读得出 —— 拦它的只有在网天数这一条
    expect(isUnreadable(b, { ...SNAP, crit: { ...SNAP.crit, minOnlineDays: days } })).toBe(false)
  })
  it('❗2 月中打开:年初就在的栋当年只抄了 46 天,不按「在网 < 90 天」判读不出;对照:同一栋首条抄表比全园晚 → 读不出', SLOW, () => {
    const feb = buildSnapshot({ ...INPUT, month: 2, rows: ROWS.filter(r => r.date <= '2025-02-15'), today: '2025-02-15', prevRows: undefined })
    const b = feb.board.find(x => x.name === 'B座')!
    expect(feb.stations.find(s => s.id === b.id)!.days).toBe(46)
    expect(isUnreadable(b, feb)).toBe(false)
    expect(unreadableWhy({ ...b, firstDate: '2025-01-02' }, feb)).toBe('在网 46 天，不足 90 天')
    // 全园 10 栋里只剩 2/1 才投产、段外没有历史的 10栋 读不出
    expect(kpiTiles(feb)[1]).toEqual({ label: '读不出', value: '1 栋', note: '10栋' })
  })
  it('E座 漏抄 2 天(17、25 日)仍读得出;未投产的栋不算读不出、缺抄 0', () => {
    expect(missingN(row('E座'), SNAP.ticks)).toBe(2)
    expect(isUnreadable(row('E座'), SNAP)).toBe(false)
    expect(isUnreadable(row('创业大厦'), SNAP)).toBe(false)
    expect(missingN(row('创业大厦'), SNAP.ticks)).toBe(0)
  })
  it('phaseName / dayOfYear', () => {
    expect([1, 2, 3].map(phaseName)).toEqual(['一期', '二期', '三期'])
    expect([dayOfYear('2025-01-01'), dayOfYear('2025-06-09'), dayOfYear('2024-12-31')]).toEqual([1, 160, 366])
  })
  it('投产前的刻度不算漏抄:年档 10栋 1 月状态是 missing,但缺抄数 0', () => {
    const b = SNAP_Y.board.find(x => x.name === '10栋')!
    expect(b.state[0]).toBe('missing')
    expect(missingN(b, SNAP_Y.ticks)).toBe(0)
  })
})

// ── B1 芯片 ──────────────────────────────────────────────────────────────
describe('chipGroups —— 常显 = 有连续段 ∪ 读不出 ∪ 选中', () => {
  const g = chipGroups(SNAP, null)
  it('常显:连续段两栋(F座 27 天低于在前、G座 高于)→ 读不出两栋', () => {
    expect(g.shown.map(c => [c.name, c.kind])).toEqual([['F座', 'hit'], ['G座', 'hit'], ['9栋', 'unreadable'], ['10栋', 'unreadable']])
    expect(g.shown[0]).toMatchObject({ hasRun: true, dir: -1, outDays: 27, clickable: true })
    expect(g.shown[1]).toMatchObject({ hasRun: true, dir: 1 })
    expect(g.shown.slice(-2).every(c => c.outDays === 0 && c.dir === null)).toBe(true)
  })
  it('只零散出范围的 11栋 收起,徽标天数照给;收起的按天数降序、未投产垫底且不可点', () => {
    expect(g.folded.find(c => c.name === '11栋')).toMatchObject({ kind: 'plain', hasRun: false, dir: null })
    expect(g.folded.find(c => c.name === '11栋')!.outDays).toBeGreaterThanOrEqual(4)
    const plain = g.folded.slice(0, -1)
    expect(plain.every(c => c.kind === 'plain' && c.clickable)).toBe(true)
    for (let i = 1; i < plain.length; i++) expect(plain[i - 1].outDays).toBeGreaterThanOrEqual(plain[i].outDays)
    expect(g.folded[g.folded.length - 1]).toMatchObject({ name: '创业大厦', kind: 'unborn', clickable: false })
    expect(g.shown.length + g.folded.length).toBe(SNAP.board.length)
  })
  it('❗徽标单位:月档「天」,年档「个月」', () => {
    expect(g.unit).toBe('天')
    expect(chipGroups(SNAP_Y, null).unit).toBe('个月')
  })
  it('选中一栋没有连续段的 → 挪进常显,排在连续段之后、读不出之前;对照:不选时它在收起里', () => {
    const id = idOf('11栋')
    const g2 = chipGroups(SNAP, id)
    expect(g2.shown.map(c => c.name)).toEqual(['F座', 'G座', '11栋', '9栋', '10栋'])
    expect(g2.shown[2]).toMatchObject({ selected: true, kind: 'plain' })
    expect(g2.folded.some(c => c.id === id)).toBe(false)
    expect(g.folded.some(c => c.id === id)).toBe(true)
  })
})

describe('dayFact —— 图头三段式', () => {
  it('F座:仍在持续的段不写闭区间,缺抄跨过去不断段', () => {
    expect(dayFact(row('F座'), SNAP)).toBe('27 天出范围（低 27 高 0） · 1 日起低于（仍在持续） · 缺抄 1 天')
  })
  it('G座:已结束的段写闭区间', () => {
    const f = dayFact(row('G座'), SNAP)
    expect(f).toContain('18–22 日高于')
    expect(f.endsWith(' · 缺抄 2 天')).toBe(true)
  })
  it('❗读不出的栋只写原因,不出「N 天出范围」判据句;对照:读得出的 F座 照写判据句', () => {
    expect(dayFact(row('9栋'), SNAP)).toBe('读不出 · 已抄 17/28 天，覆盖不到 90%')
    const days = SNAP.stations.find(s => s.name === '10栋')!.days
    expect(dayFact(row('10栋'), SNAP)).toBe(`读不出 · 在网 ${days} 天，不足 90 天`)
    expect(dayFact(row('F座'), SNAP)).toMatch(/^27 天出范围/)
  })
  it('画不出范围的栋直接给原因句', () => {
    const b = row('创业大厦')
    expect(b.lo).toBeNull()
    expect(dayFact(b, SNAP)).toBe(b.baseNote)
  })
})

// ── B0 KPI ───────────────────────────────────────────────────────────────
describe('kpiTiles', () => {
  const t = kpiTiles(SNAP)
  it('六瓦标签逐字', () => {
    expect(t.map(x => x.label)).toEqual(['本段出范围栋数', '读不出', '未装表', '已录板数', '缺抄条数', '数据到'])
  })
  it('值与副行;出范围与缺抄 > 0 时副行转警示', () => {
    expect(t[0]).toEqual({ label: '本段出范围栋数', value: '2 栋', note: 'F座 · G座', noteTone: 'warn' })
    expect(t[1]).toEqual({ label: '读不出', value: '2 栋', note: '9栋 · 10栋' })
    expect(t[2]).toEqual({ label: '未装表', value: '1 栋', note: '未装表楼' })
    expect(t[3]).toEqual({ label: '已录板数', value: '3/11', note: '8 栋未录' })
    expect(t[4]).toEqual({
      label: '缺抄条数', value: '20 条', noteTone: 'warn',
      note: '9栋 11 · E座 2 · G座 2 · F座 1 · 8栋 1 · 10栋 1 · 11栋 1 · 12栋 1',
    })
    // §1 #10:已抄 n/N · x%,N = 已抄 + 漏抄(不含未投产)
    expect(t[5]).toEqual({ label: '数据到', value: '08-28', note: '已过去 28/31 天 · 已抄 260/280 · 93%' })
  })
  it('0 命中:副行不转警示;读不出 0 时写覆盖句', SLOW, () => {
    const jan = kpiTiles(buildSnapshot({ ...INPUT, month: 1 }))
    expect(jan[0]).toEqual({ label: '本段出范围栋数', value: '0 栋', note: '—' })
    expect(jan[1]).toEqual({ label: '读不出', value: '0 栋', note: '9 栋覆盖都 ≥ 90%' })
    expect(jan[4].noteTone).toBeUndefined()
  })
})

describe('kpiSparks / timeKpiSparks —— 逐月跑 buildSnapshot', () => {
  it('1…8 月:8 月那一格与 KPI 瓦同数;2 月 10栋 刚投产只抄 2 天 → 缺 26', SLOW, () => {
    const s = kpiSparks(INPUT)
    expect(s.months).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(s.out[7]).toBe(2)
    expect(s.missing[7]).toBe(20)
    expect(s.out[0]).toBe(0)
    expect(s.missing[0]).toBe(0)
    expect(s.missing[1]).toBe(26)
  })
  it('计时辅助返回的 ms 是前后两次取时之差', SLOW, () => {
    const ticks = [100, 350]
    const r = timeKpiSparks({ ...INPUT, month: 2 }, () => ticks.shift()!)
    expect(r.ms).toBe(250)
    expect(r.months).toEqual([1, 2])
  })
})

// ── B2 判据脚 ────────────────────────────────────────────────────────────
describe('critFoot', () => {
  it('参数当前值原文;范围窗口带条数;末尾那句', () => {
    const f = critFoot(SNAP, idOf('F座'))
    expect(f.items.map(i => i.text)).toEqual([
      '范围 = 这栋自己的水平 ± 2 倍稳健波动', '连续 ≥ 3 天出范围计一段', '抄表覆盖 ≥ 90% 才判', '台账差 ±3%', '年等效 ≥ 807.5 h',
    ])
    const base = row('F座').base!
    // 窗口 = 同批在网(10栋 2/1 投产起)∩ 6/9 变点之前
    expect(base.from).toBe('2025-02-01')
    expect(f.baseNote).toBe(`范围按 02-01~${base.to} 算，共 ${base.n} 天`)
    expect(f.baseNote).toMatch(/^范围按 02-01~0[56]-\d\d 算，共 \d+ 天$/)
    expect(f.tail).toBe('未列出 ≠ 没问题')
    expect(critFoot(SNAP, null).baseNote).toBeNull()
  })
  it('❗估带窗口为凑样本放宽过的条件写进 baseNote;对照:没放宽不写', () => {
    const f = row('F座')
    const relaxed = { ...SNAP, board: SNAP.board.map(b => (b.id === f.id ? { ...b, base: { ...b.base!, relaxed: ['含并网初期', '不限变点之前'] } } : b)) }
    expect(critFoot(relaxed, f.id).baseNote).toBe(`范围按 02-01~${f.base!.to} 算，共 ${f.base!.n} 天，放宽 2 档：含并网初期、不限变点之前`)
    expect(critFoot(SNAP, f.id).baseNote).not.toContain('放宽')
  })
  it('读 snap.crit,不写死;年档连续段按月计', () => {
    const f = critFoot({ ...SNAP, crit: { ...SNAP.crit, coverMonth: 0.85, anchorHours: 1000, bandRun: 4 } }, null)
    expect(f.items.map(i => i.text)).toContain('抄表覆盖 ≥ 85% 才判')
    expect(f.items.map(i => i.text)).toContain('年等效 ≥ 850 h')
    expect(f.items.map(i => i.text)).toContain('连续 ≥ 4 天出范围计一段')
    expect(critFoot(SNAP_Y, null).items.find(i => i.key === 'run')!.text).toBe('连续 ≥ 3 个月出范围计一段')
  })
})

// ── B3 ───────────────────────────────────────────────────────────────────
describe('yieldBand —— 月档逐日 / 年档逐月', () => {
  const genOn = (id: number, date: string) => ROWS.find(r => r.stationId === id && r.date === date)!.gen
  it('分母优先板数 × 标称:E座 除 400 不除 390', () => {
    const e = yieldBand(SNAP, ROWS, idOf('E座'))
    expect(e.sel[0]).toBeCloseTo(genOn(3, '2025-08-01') / 400, 9)
    expect(e.sel[0]).not.toBeCloseTo(genOn(3, '2025-08-01') / 390, 4)
  })
  it('选中栋:漏抄与未到留空;在网 < 3 栋的 17 日整列留空', () => {
    const f = yieldBand(SNAP, ROWS, idOf('F座'))
    expect(f.labels).toHaveLength(31)
    expect(f.sel[0]).toBeCloseTo(genOn(4, '2025-08-01') / 390, 9)
    expect(f.sel[16]).toBeNull()
    expect(f.sel[28]).toBeNull()
    expect(f.futureFrom).toBe(28)
    expect(f.throughIdx).toBe(27)
    expect([f.med[16], f.lo[16], f.hi[16]]).toEqual([null, null, null])
    expect(f.selName).toBe('F座')
    expect([f.onlineN, f.unbornN]).toEqual([10, 1])
  })
  it('中位 = 当日各栋等效小时的中位;lo ≤ 中位 ≤ hi', () => {
    const f = yieldBand(SNAP, ROWS, null)
    const denom: Record<number, number> = { 1: 500, 2: 780, 3: 400, 4: 390, 5: 390, 6: 340, 7: 340, 8: 340, 9: 340, 10: 380 }
    const col = ROWS.filter(r => r.date === '2025-08-02').map(r => r.gen / denom[r.stationId]).sort((a, b) => a - b)
    expect(col).toHaveLength(10)
    expect(f.med[1]).toBeCloseTo((col[4] + col[5]) / 2, 9)
    f.med.forEach((m, i) => { if (m != null) { expect(f.lo[i]!).toBeLessThanOrEqual(m); expect(f.hi[i]!).toBeGreaterThanOrEqual(m) } })
    expect(f.sel.every(v => v == null)).toBe(true)
  })
  it('❗年档:横轴固定 12 个月(数据只到 8 月也画满),9 月起未到;8 月 = 当月发电合计 ÷ 分母', () => {
    const f = yieldBand(SNAP_Y, ROWS, idOf('F座'))
    expect(f.labels).toEqual(Array.from({ length: 12 }, (_, i) => `${i + 1}月`))
    const aug = ROWS.filter(r => r.stationId === 4 && r.date.startsWith('2025-08')).reduce((t, r) => t + r.gen, 0)
    expect(f.sel[7]).toBeCloseTo(aug / 390, 6)
    expect(f.sel.slice(8).every(v => v == null)).toBe(true)
    expect([f.futureFrom, f.throughIdx]).toEqual([8, 7])
    expect(kpiTiles(SNAP_Y)[5].note).toBe('已过去 8/12 个月 · 已抄 79/79 · 100%')
    const c = consumption(SNAP_Y)
    expect([c.ticks.length, c.futureFrom, c.ticks[8].lossPct]).toEqual([12, 8, null])
  })
  it('❗「数据到」按最后一条抄表,不按今天:今天挪到 31 日(整段已过去)数据仍到 28 日;对照:数据到段末不写', () => {
    const late = { ...SNAP, elapsedN: 31 }
    expect([yieldBand(late, ROWS, null).futureFrom, yieldBand(late, ROWS, null).throughIdx]).toEqual([null, 27])
    expect(consumption(late).throughIdx).toBe(27)
    expect(yieldBand({ ...SNAP, dataThrough: '2025-08-31' }, ROWS, null).throughIdx).toBeNull()
  })
  it('❗投产前的刻度给 pre,不给 missing(气泡不写没抄表):年档 10栋 1 月', () => {
    const t = yieldBand(SNAP_Y, ROWS, idOf('10栋'))
    expect(t.selState.slice(0, 2)).toEqual(['pre', 'seen'])
    expect(yieldBand(SNAP, ROWS, idOf('F座')).selState).not.toContain('pre')
  })
  it('denomNote 三种口径', () => {
    expect(denomNote(SNAP)).toBe('分母 = 板数 × 单块标称；8 栋未录板数，用台账装机')
    const all = SNAP.stations.filter(s => s.metered).map(s => s.name)
    expect(denomNote({ ...SNAP, quality: { ...SNAP.quality, noPanel: all } })).toBe('分母 = 台账装机（11 栋未录板数）')
    expect(denomNote({ ...SNAP, quality: { ...SNAP.quality, noPanel: [] } })).toBe('分母 = 板数 × 单块标称')
  })
})

// ── A2 ───────────────────────────────────────────────────────────────────
describe('anchorBars —— 年等效、比锚点、比上一年', () => {
  const a = anchorBars(SNAP, ROWS, PREV)
  const sumGen = (rs: ReadingRow[], id: number, months: number[]) =>
    rs.filter(r => r.stationId === id && months.includes(Number(r.date.slice(5, 7)))).reduce((t, r) => t + r.gen, 0)
  it('锚点 807.5;按年等效降序;在网不足移出计数;未投产另列', () => {
    expect(a.anchor).toBeCloseTo(807.5, 9)
    expect(a.rows.map(r => r.name).sort()).toEqual(['11栋', '12栋', '8栋', '9栋', 'B座', 'C、D座', 'E座', 'F座', 'G座'].sort())
    for (let i = 1; i < a.rows.length; i++) expect(a.rows[i - 1].yieldHours).toBeGreaterThanOrEqual(a.rows[i].yieldHours)
    expect(a.short).toEqual(['10栋'])
    expect(a.unborn).toEqual([{ id: 11, name: '创业大厦', phase: 3 }])
    expect(a.noDenom).toEqual([])
  })
  it('比锚点的 h 与 %', () => {
    const e = a.rows.find(r => r.name === 'E座')!
    const yh = ROWS.filter(r => r.stationId === 3).reduce((t, r) => t + r.gen, 0) / 400
    expect(e.yieldHours).toBeCloseTo(yh, 6)
    expect(e.delta).toBeCloseTo(yh - 807.5, 6)
    expect(e.deltaPct).toBeCloseTo((yh / 807.5 - 1) * 100, 6)
  })
  it('比上一年按两年都有抄表的月对齐:E座 只比 1–6 月', () => {
    const e = a.rows.find(r => r.name === 'E座')!
    const m6 = [1, 2, 3, 4, 5, 6], m7 = [1, 2, 3, 4, 5, 6, 7], m8 = [1, 2, 3, 4, 5, 6, 7, 8]
    expect(e.prevMonths).toBe(6)
    expect(e.prevDelta!).toBeCloseTo((sumGen(ROWS, 3, m6) - sumGen(PREV, 3, m6)) / 400, 6)
    // 对照:拿今年 8 个月去比去年 6 个月,数会差很远
    expect(e.prevDelta!).not.toBeCloseTo((sumGen(ROWS, 3, m8) - sumGen(PREV, 3, m6)) / 400, 0)
    const b = a.rows.find(r => r.name === 'B座')!
    expect(b.prevMonths).toBe(7)
    expect(b.prevDelta!).toBeCloseTo((sumGen(ROWS, 1, m7) - sumGen(PREV, 1, m7)) / 500, 6)
  })
  it('❗今年没录满的那个月(数据到 8/28)不拿去比去年整月;对照:数据到月末 8 月就参与', () => {
    const m8 = [1, 2, 3, 4, 5, 6, 7, 8]
    expect(a.rows.find(r => r.name === 'B座')!.prevMonths).toBe(7)
    const full = anchorBars({ ...SNAP, dataThrough: '2025-08-31' }, ROWS, PREV).rows.find(r => r.name === 'B座')!
    expect(full.prevMonths).toBe(8)
    expect(full.prevDelta!).toBeCloseTo((sumGen(ROWS, 1, m8) - sumGen(PREV, 1, m8)) / 500, 6)
  })
  it('❗带分母口径句;上一年没取到(undefined)与取到了但为空分得开', () => {
    expect(a.denomNote).toBe(denomNote(SNAP))
    expect(a.prevLoaded).toBe(true)
    expect(anchorBars(SNAP, ROWS, undefined).prevLoaded).toBe(false)
    expect(anchorBars(SNAP, ROWS, []).prevLoaded).toBe(true)
  })
  it('上一年无抄表给 null,不给 0', () => {
    expect(a.rows.find(r => r.name === 'C、D座')!.prevDelta).toBeNull()
    expect(a.noPrev).toBe(7)
    const none = anchorBars(SNAP, ROWS, undefined)
    expect(none.rows.every(r => r.prevDelta === null && r.prevMonths === 0)).toBe(true)
    expect(none.noPrev).toBe(9)
  })
})

// ── B6 ───────────────────────────────────────────────────────────────────
describe('ledgerScatter —— 缺任一不出点', () => {
  it('3 栋出点(含一栋超线);只录了单块标称的 F座 不出', () => {
    const l = ledgerScatter(SNAP)
    expect(l.points.map(p => [p.name, p.x, p.y])).toEqual([['B座', 500, 500], ['E座', 400, 390], ['12栋', 380, 340]])
    expect(l.points[2].diff).toBeCloseTo(-40 / 380, 9)
    expect([l.unrecorded, l.metered, l.tolerance]).toEqual([8, 11, 0.03])
  })
})

// ── B7 ───────────────────────────────────────────────────────────────────
describe('consumption —— 逐日三段与损耗率', () => {
  const c = consumption(SNAP)
  it('损耗率 = 损耗 ÷ 发电;8/10 冲到 7% 标溢出,对照日不标', () => {
    expect(c.ticks).toHaveLength(31)
    expect(c.ticks[0].lossPct).toBeCloseTo((0.01 + 0.04 / 6) * 100, 6)
    expect(c.ticks[0].over).toBe(false)
    expect(c.ticks[9].lossPct).toBeCloseTo(7, 6)
    expect(c.ticks[9].over).toBe(true)
    expect(LOSS_AXIS_MAX).toBe(6)
  })
  it('未到的日子损耗率是 null,不画成 0', () => {
    expect(c.futureFrom).toBe(28)
    expect(c.ticks[28]).toMatchObject({ self: 0, grid: 0, loss: 0, lossPct: null, over: false })
  })
  it('三段是当日全园合计(8/17 只有两栋)', () => {
    const d17 = ROWS.filter(r => r.date === '2025-08-17')
    expect(d17).toHaveLength(2)
    expect(c.ticks[16].self).toBeCloseTo(d17.reduce((t, r) => t + r.selfUse, 0), 6)
  })
})

// ── B8 ───────────────────────────────────────────────────────────────────
describe('revenueBars —— 本段累计,按合计降序', () => {
  const r = revenueBars(SNAP, ROWS, 0.4)
  it('只算本段;自用 = Σ 录入收益,上网 = Σ 上网电量 × 调用方给的价', () => {
    expect(r.rows).toHaveLength(10)
    const aug = ROWS.filter(x => x.stationId === 1 && x.date.startsWith('2025-08'))
    const b = r.rows.find(x => x.name === 'B座')!
    expect(b.self).toBeCloseTo(aug.reduce((t, x) => t + x.revenue, 0), 6)
    expect(b.grid).toBeCloseTo(aug.reduce((t, x) => t + x.gridFeed, 0) * 0.4, 6)
    expect(b.total).toBeCloseTo(b.self + b.grid, 9)
    expect(revenueBars(SNAP, ROWS, 0.5).rows.find(x => x.name === 'B座')!.grid).toBeCloseTo(b.grid * 1.25, 6)
    for (let i = 1; i < r.rows.length; i++) expect(r.rows[i - 1].total).toBeGreaterThanOrEqual(r.rows[i].total)
  })
  it('月中「截至 M/D」;数据在段外或录满时不出', () => {
    expect(r.through).toBe('8/28')
    expect(revenueBars(SNAP_Y, ROWS, 0.4).through).toBe('8/28')
    expect(revenueBars({ ...SNAP, dataThrough: '2025-09-02' }, ROWS, 0.4).through).toBeNull()
    expect(revenueBars({ ...SNAP, dataThrough: '2025-08-31' }, ROWS, 0.4).through).toBeNull()
  })
})

// ── 高级分析 ─────────────────────────────────────────────────────────────
describe('高级分析档', SLOW, () => {
  it('alphaBars:α 降序、名次 1 = 最高;踢出的与没进模型的分开列', () => {
    const lab = LAB()
    const a = alphaBars(lab, SNAP)
    expect(a.rows).toHaveLength(8)
    // ❗在网不足 90 天的 10栋 不进排序,占行写天数
    expect(a.short).toEqual([{ id: idOf('10栋'), name: '10栋', phase: 2, days: SNAP.stations.find(s => s.name === '10栋')!.days }])
    expect(a.rows.map(r => r.name)).not.toContain('10栋')
    a.rows.forEach((r, i) => {
      expect(r.rank).toBe(i + 1)
      if (i) expect(a.rows[i - 1].alphaPct).toBeGreaterThanOrEqual(r.alphaPct)
      expect(r.crossesZero).toBe(r.ciLo <= 0 && r.ciHi >= 0)
    })
    expect(a.rows[a.rows.length - 1].name).toBe('F座')
    expect(a.excluded).toEqual(['12栋'])
    expect(a.rest.map(x => x.name)).toEqual(['创业大厦'])
  })

  it('polishStability:真数据自洽', () => {
    const p = polishStability(LAB(), SNAP)
    // ❗名次只在进 α 排序的栋里排:在网不足 90 天的 10栋 不算
    expect(p.n).toBe(9)
    expect(p.sameN + p.moved.length).toBe(9)
    expect(p.moved.map(m => m.name)).not.toContain('10栋')
  })
  it('polishStability:名次换成 1 = 最高;挪的位数都一样才给 sameShift', () => {
    const fake = (rowRank: number[], colRank: number[], trace: number[]) => ({
      convergence: { names: ['甲', '乙', '丙', '丁'], rowRank, colRank, flipped: [], iterations: trace.length, converged: false, trace, traceCol: trace, alphaGapPct: 0 },
    }) as unknown as LabResult
    const p = polishStability(fake([1, 2, 3, 4], [2, 1, 3, 4], [0.2, 3.2e-7]), SNAP)
    expect(p.moved).toEqual([{ name: '甲', from: 4, to: 3 }, { name: '乙', from: 3, to: 4 }])
    expect([p.sameN, p.sameShift]).toEqual([2, 1])
    const q = polishStability(fake([1, 2, 3, 4], [3, 1, 2, 4], [0.2, 2e-5]), SNAP)
    expect(q.sameShift).toBeNull()
  })

  it('residualGrid:固定栋序、未到 / 空格 / 没进模型三种空,当段月与未录满月', () => {
    const lab = LAB()
    const g = residualGrid(lab, SNAP)
    expect(g.rows.map(r => r.name)).toEqual(SNAP.board.map(b => b.name))
    expect([g.currentMonth, g.throughMonth, g.outsideN]).toEqual([8, 8, 2])
    // ❗在网不足 90 天的 10栋 整行空格(另一行是未投产的创业大厦)
    expect(g.rows.find(r => r.name === '10栋')!.inModel).toBe(false)
    const f = g.rows.find(r => r.name === 'F座')!
    expect(f.cells.slice(8).every(c => c.state === 'future' && c.pct === null)).toBe(true)
    expect(f.cells[7].partial).toBe(true)
    expect(f.cells[6].partial).toBe(false)
    const ten = g.rows.find(r => r.name === '10栋')!
    // 10栋 三月起有残差,但在网不足 90 天 → 整行空格,不拿几个月的量上色
    expect(ten.cells.every(c => c.state !== 'value' && c.pct === null)).toBe(true)
    // 对照:门槛降到它的在网天数以下,三月那格就是有数的 —— 拦它的只有在网天数这一条
    const tenDays = SNAP.stations.find(s => s.name === '10栋')!.days
    const g2 = residualGrid(lab, { ...SNAP, crit: { ...SNAP.crit, minOnlineDays: tenDays } })
    expect(g2.rows.find(r => r.name === '10栋')!.cells[2].state).toBe('value')
    expect(g.rows.find(r => r.name === '创业大厦')!.cells.every(c => c.state === 'empty')).toBe(true)
    const half = (Math.exp(lab.seasonHalf) - 1) * 100
    expect(g.thresholds[3]).toBeCloseTo(half, 9)
    expect(g.thresholds[0]).toBeCloseTo(half * 0.2, 9)
  })
  it('residualGrid:色阶档位由半幅定 —— 半幅 10% 时就是画板的 2 / 4 / 7 / 10', () => {
    const v = (p: number) => Math.log(1 + p / 100)
    const lab = {
      seasonHalf: Math.log(1.1), seasonPartial: null,
      season: [{ id: 1, name: 'B座', amp: null, months: [v(1.9), v(3), v(-6.9), v(9.9), v(10), v(-25), null, v(0), null, null, null, null] }],
    } as unknown as LabResult
    const g = residualGrid(lab, SNAP)
    expect(g.thresholds.map(x => +x.toFixed(9))).toEqual([2, 4, 7, 10])
    const cells = g.rows[0].cells
    expect(cells.slice(0, 6).map(c => c.level)).toEqual([0, 1, 2, 3, 4, 4])
    expect(cells.slice(0, 6).map(c => c.sign)).toEqual([1, 1, -1, 1, 1, -1])
    expect(cells[6].state).toBe('empty')
    expect(cells[8].state).toBe('future')
  })

  it('qualityCalendar:按自然月铺满、周一开头;四态;缺抄榜 13 栋全列的口径', () => {
    const q = qualityCalendar(LAB(), SNAP)
    expect(q.cells).toHaveLength(31)
    expect(q.weeks).toBe(5)
    const at = (d: number) => q.cells[d - 1]
    expect([at(1).col, at(1).row]).toEqual([0, 4])      // 2025-08-01 周五
    expect([at(4).col, at(4).row]).toEqual([1, 0])      // 周一换列
    expect([at(31).col, at(31).row]).toEqual([4, 6])
    expect(at(1)).toMatchObject({ kind: 'full', bornN: 10, missNames: [] })
    expect(at(14)).toMatchObject({ kind: 'miss', missNames: ['G座'] })
    expect(at(17)).toMatchObject({ kind: 'drop', readN: 2 })
    expect(at(25)).toMatchObject({ kind: 'miss', missNames: ['E座', '9栋'] })
    expect(at(29).kind).toBe('todo')
    expect(q.missRows.map(r => [r.name, r.missDays])).toEqual([
      ['9栋', 10], ['E座', 1], ['G座', 1], ['B座', 0], ['C、D座', 0], ['F座', 0], ['8栋', 0], ['10栋', 0], ['11栋', 0], ['12栋', 0],
      ['创业大厦', null],
    ])
    expect(q.missRows[q.missRows.length - 1].kind).toBe('unborn')
    expect(q.maxMiss).toBe(10)
  })
  it('❗「还没到」按今天切:今天挪到 31 日、数据仍到 28 日 → 29–31 日是缺抄(全园都没抄),缺抄榜每栋 +3;对照:今天 = 28 日时 29 日还没到', () => {
    const q = qualityCalendar(LAB(), { ...SNAP, elapsedN: 31 })
    expect(q.cells.slice(28).map(c => [c.kind, c.missNames.length, c.bornN])).toEqual([['miss', 10, 10], ['miss', 10, 10], ['miss', 10, 10]])
    expect(q.missRows.slice(0, 4).map(r => [r.name, r.missDays])).toEqual([['9栋', 13], ['E座', 4], ['G座', 4], ['B座', 3]])
    expect(qualityCalendar(LAB(), SNAP).cells[28].kind).toBe('todo')
  })

  it('acfBars:淡带 = 1.96 / √有效天数;跟选中栋,选中栋不在模型里退回 L4 那栋', () => {
    const lab = LAB()
    const a = acfBars(lab, idOf('B座'))!
    const n = lab.tests.find(t => t.id === 1)!.days
    expect(a.id).toBe(1)
    expect(a.n).toBe(n)
    expect(a.threshold).toBeCloseTo(1.96 / Math.sqrt(n), 12)
    const rho = lab.acf.find(x => x.id === 1)!.rho
    expect(a.bars).toHaveLength(rho.length - 1)
    expect(a.bars[0]).toEqual({ lag: 1, rho: rho[1], inside: Math.abs(rho[1]) <= a.threshold })
    expect(a.bars.some(b => b.inside)).toBe(true)
    expect(acfBars(lab, idOf('创业大厦'))!.id).toBe(idOf('F座'))
  })

  it('nullHist:16 格计数和 = 重算次数;「1000 遍」= 次数 + 1;尾部次数取观测值那一侧', () => {
    const lab = LAB()
    const h = nullHist(lab)!
    const { dist, obs } = lab.nullDist!
    expect(h.bins).toHaveLength(NULL_BINS)
    expect(h.bins.reduce((t, b) => t + b.count, 0)).toBe(dist.length)
    expect(h.total).toBe(dist.length + 1)
    expect(h.bins[0].lo).toBeCloseTo(Math.min(obs, ...dist), 12)
    expect(h.bins[NULL_BINS - 1].hi).toBeCloseTo(Math.max(obs, ...dist), 9)
    expect(h.extreme).toBe(Math.min(dist.filter(v => v >= obs).length, dist.filter(v => v <= obs).length))
    expect(h.id).toBe(idOf('F座'))
  })

  it('labTableRows:名次序 → 被踢出的 → 未投产;变点区间只在显著时给;色条跟连续段', () => {
    const lab = LAB()
    const t = labTableRows(lab, SNAP)
    expect(t.slice(0, 8).map(r => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(t[8]).toMatchObject({ name: '12栋', rank: null, unborn: false })
    // ❗在网不足 90 天:合并格写天数,α 不给
    const ten = t.find(r => r.name === '10栋')!
    expect(ten).toMatchObject({ unborn: true, alphaPct: null, rank: null, shortDays: SNAP.stations.find(s => s.name === '10栋')!.days })
    expect(t.find(r => r.name === '创业大厦')).toMatchObject({ unborn: true, alphaPct: null, validMonths: null, shortDays: null })
    const f = t.find(r => r.name === 'F座')!
    expect(f.runDir).toBe(-1)
    expect(f.cpFrom).toMatch(/^2025-0[56]-\d\d$/)
    expect(f.cpFrom! <= f.cpTo!).toBe(true)
    expect(t.find(r => r.name === 'G座')!.runDir).toBe(1)
    expect(t.find(r => r.name === '9栋')!.runDir).toBeNull()                  // 读不出的不给色条
    // 夹具里读不出的栋本来就没有连续段,上一行删了读不出那道闸也绿 —— 补一栋「读不出但有连续段」:
    // F座 有连续低于段,只把它改成月抄(读不出),色条就得收掉
    const fRow = row('F座')
    expect(fRow.runs.length).toBeGreaterThan(0)
    const monthlyF = { ...SNAP, board: SNAP.board.map(b => (b === fRow ? { ...b, cadence: 'monthly' as const } : b)) }
    expect(isUnreadable(monthlyF.board.find(b => b.name === 'F座')!, monthlyF)).toBe(true)
    expect(labTableRows(lab, monthlyF).find(r => r.name === 'F座')!.runDir).toBeNull()
    expect(t.find(r => r.name === '10栋')!.validMonths).toBe(6)             // 1 月投产前、2 月只抄 2 天
    expect(t.every(r => r.monthsSoFar === 8)).toBe(true)
    // 对照:有区间字符串但不显著的栋,不出区间
    const weak = lab.tests.find(x => x.p > CP_P_MAX && x.cpRange.includes('~'))
    expect(weak).toBeDefined()
    expect(t.find(r => r.id === weak!.id)!.cpFrom).toBeNull()
  })
})

// ── 抽屉 ─────────────────────────────────────────────────────────────────
describe('抽屉 B9 B10 —— 一年逐日同一把 x', SLOW, () => {
  it('driftChart:散点 / 趋势 / 变点与区间 / 当段只到数据截止日', () => {
    const d = DETAIL_F()
    const c = driftChart(d, SNAP)!
    expect(c.daysInYear).toBe(365)
    expect(c.points).toHaveLength(d.dates.length)
    expect(c.points[0]).toEqual({ date: '2025-01-01', doy: 1, v: d.resid[0] })
    expect(c.trend).toHaveLength(d.spline.length)
    expect(c.cp).not.toBeNull()
    expect(Math.abs(c.cp!.doy - dayOfYear('2025-06-09'))).toBeLessThanOrEqual(10)
    expect(c.cp!.fromDoy).toBeLessThanOrEqual(c.cp!.doy)
    expect(c.cp!.toDoy).toBeGreaterThanOrEqual(c.cp!.doy)
    expect(c.seg).toEqual({ month: 8, fromDoy: 213, toDoy: 240 })
    expect(c.futureFromDoy).toBe(241)
    expect(driftChart(null, SNAP)).toBeNull()
    // 对照:同一份抽屉,变点不显著就不画线也不画区间
    expect(driftChart({ ...d, cp: { ...d.cp!, p: 0.2 } }, SNAP)!.cp).toBeNull()
  })
  it('controlChart:三档互斥计数;估计窗口止于变点前一天', () => {
    const d = DETAIL_F()
    const c = controlChart(d, SNAP)!
    expect(c.counts.reduce((a, b) => a + b, 0)).toBe(c.points.length)
    expect(c.window!.from).toBe('2025-01-01')
    expect(c.window!.to < d.cpDate!).toBe(true)
    expect(c.wholePeriod).toBe(false)
    expect(controlChart({ ...d, limitTo: d.dates[d.dates.length - 1] }, SNAP)!.wholePeriod).toBe(true)
  })
  it('controlChart:点的档位按离中线几倍半宽', () => {
    const d = {
      dates: ['2025-03-01', '2025-03-02', '2025-03-03', '2025-03-04'], resid: [0.19, 0.21, 0.31, -0.25],
      spline: [], cp: { index: 3, ciLo: 2, ciHi: 3, p: 0.01, dropPct: 0 }, cpDate: '2025-03-04', cpLo: '2025-03-03', cpHi: '2025-03-04',
      center: 0, sigma: 0.1, limitFrom: '2025-03-01', limitTo: '2025-03-04',
    } satisfies StationDetail
    const c = controlChart(d, SNAP)!
    expect(c.points.map(p => p.level)).toEqual([0, 1, 2, 1])
    expect(c.counts).toEqual([1, 2, 1])
    expect(c.inner).toEqual({ lo: -0.2, hi: 0.2 })
    expect(c.outer.hi).toBeCloseTo(0.3, 12)
    expect(c.points[0].doy).toBe(60)
  })
})

describe('抽屉 B10 与 B9 同一道变点闸', SLOW, () => {
  it('❗变点不显著(B9 不画线)时 B10 也不按它切:退回全期估,中线 = 全期中位;对照:显著时止于变点前', () => {
    const d = DETAIL_F()
    const weakD = { ...d, cp: { ...d.cp!, p: 0.2 } }
    expect(driftChart(weakD, SNAP)!.cp).toBeNull()
    const weak = controlChart(weakD, SNAP)!
    expect(weak.wholePeriod).toBe(true)
    expect(weak.window).toMatchObject({ from: d.dates[0], to: d.dates[d.dates.length - 1] })
    expect(weak.center).toBeCloseTo(median(d.resid), 12)
    const strong = controlChart(d, SNAP)!
    expect([strong.wholePeriod, strong.center]).toEqual([false, d.center])
  })
})

describe('betaSlots —— 十二槽三种留空', () => {
  it('10栋:1 月投产前、2 月样本不足、3–8 月有值、9–12 月还没到;8 月是当段', () => {
    const s = betaSlots(SNAP, idOf('10栋'))
    expect(s.map(x => x.why)).toEqual(['pre', 'thin', null, null, null, null, null, null, 'future', 'future', 'future', 'future'])
    expect(s.slice(2, 8).every(x => x.beta != null && isFinite(x.beta))).toBe(true)
    expect(s.filter(x => x.current).map(x => x.month)).toEqual([8])
    expect(betaSlots(SNAP_Y, idOf('10栋')).some(x => x.current)).toBe(false)
  })
})

describe('detailRows —— 未到不出现、漏抄出现', () => {
  it('F座 8 月:28 行升序;17 日没抄表;连续第 k 天跨过漏抄不计', () => {
    const r = detailRows(SNAP, ROWS, idOf('F座'))
    expect(r).toHaveLength(28)
    expect(r[0].key).toBe('2025-08-01')
    expect(r[27].key).toBe('2025-08-28')
    expect(r[16]).toMatchObject({ key: '2025-08-17', state: 'missing', gen: null, ratio: null, out: null, runDay: null })
    expect(r[0].gen).toBeCloseTo(ROWS.find(x => x.stationId === 4 && x.date === '2025-08-01')!.gen, 9)
    expect([r[0].runDay, r[15].runDay, r[17].runDay, r[27].runDay]).toEqual([1, 16, 17, 27])
  })
  it('❗有抄表但发电 0:gen 给 0 不给 null(B12 靠它与没抄表分开);对照:真没抄的日子 null', () => {
    const zero = { ...ROWS.find(x => x.stationId === 4 && x.date === '2025-08-01')!, date: '2025-08-17', gen: 0, selfUse: 0, gridFeed: 0, revenue: 0 }
    expect(detailRows(SNAP, [...ROWS, zero], idOf('F座'))[16]).toMatchObject({ key: '2025-08-17', state: 'missing', gen: 0 })
    expect(detailRows(SNAP, ROWS, idOf('F座'))[16].gen).toBeNull()
  })
  it('年档 10栋:投产前的 1 月不出行,2 月是两次抄表之和', () => {
    const r = detailRows(SNAP_Y, ROWS, idOf('10栋'))
    expect(r[0].key).toBe('2025-02')
    const feb = ROWS.filter(x => x.stationId === 8 && x.date.startsWith('2025-02'))
    expect(feb).toHaveLength(2)
    expect(r[0].gen).toBeCloseTo(feb[0].gen + feb[1].gen, 9)
  })
})
