import { describe, expect, it } from 'vitest'
import {
  blockBootstrapP, buildDetail, buildLab, buildSnapshot, changePoint, LAB_SHUFFLES, median,
  type LabResult, type ReadingRow, type SnapshotInput, type StationCfg, type StationDetail,
} from './pvMeterAna.logic'
import {
  alphaBars, anchorBars, betaSlots, chipGroups, consumption, controlChart, CP_P_MAX, critFoot,
  dayFact, dayOfYear, defaultPick, detailRows, driftChart, historyShort, isUnreadable, judgedN, kpiSparks, labTableRows,
  ledgerScatter, LOSS_AXIS_MAX, missingN, perKwCard, phaseName, polishStability, pvKpis, qualityCalendar,
  residualGrid, revenueBars, shortRefOf, timeKpiSparks, unreadableWhy, yieldBand,
} from './pvAnaV4.logic'
import { num, pctS, yuan } from '@/components/ana/anaSentence'
import { wanKwh } from '@/components/ana/anaSentence'

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
const LAB = () => (labMemo ??= buildLab(SNAP, INPUT))
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
    expect(feb.board.filter(x => isUnreadable(x, feb)).map(x => x.name)).toEqual(['10栋'])
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
  it('❗只因选中才常显的栋钉常显组末位(读不出之后);对照:不选时它在收起里', () => {
    const id = idOf('11栋')
    const g2 = chipGroups(SNAP, id)
    expect(g2.shown.map(c => c.name)).toEqual(['F座', 'G座', '9栋', '10栋', '11栋'])
    expect(g2.shown[g2.shown.length - 1]).toMatchObject({ selected: true, kind: 'plain' })
    expect(g2.folded.some(c => c.id === id)).toBe(false)
    expect(g.folded.some(c => c.id === id)).toBe(true)
  })

  it('❗选中本来就常显的栋不挪位:选中读不出的 9栋,它仍排在读不出档、不被钉到末位', () => {
    const g2 = chipGroups(SNAP, idOf('9栋'))
    expect(g2.shown.map(c => c.name)).toEqual(['F座', 'G座', '9栋', '10栋'])
  })
})

describe('dayFact —— 图头事实句(2026-10-06 改稿:零散与连着分开说)', () => {
  it('F座:27 天都低于、有一段连着', () => {
    expect(dayFact(row('F座'), SNAP)).toBe('27 天低于平时，1 段连着')
  })
  it('G座:有连着高于的段,写「N 段连着」', () => {
    expect(dayFact(row('G座'), SNAP)).toMatch(/平时.*，1 段连着$/)
  })
  it('❗11栋:只零散出过几天 → 句首「零散」,不写段;对照:F座 有段不写「零散」', () => {
    const b = row('11栋')
    expect(b.runs).toHaveLength(0)
    expect(dayFact(b, SNAP)).toMatch(new RegExp(`^零散 ${b.outN} 天`))
    expect(dayFact(row('F座'), SNAP)).not.toMatch(/^零散/)
  })
  it('❗读不出的栋只写原因,不出判据句(也不再带「读不出」前缀,屏上不出这个词)', () => {
    expect(dayFact(row('9栋'), SNAP)).toBe('已抄 17/28 天，覆盖不到 90%')
    const days = SNAP.stations.find(s => s.name === '10栋')!.days
    expect(dayFact(row('10栋'), SNAP)).toBe(`在网 ${days} 天，不足 90 天`)
  })
  it('❗画不出范围的栋给句型库那句(屏上叫「平时范围」,不印 logic 旧句「历史刻度 / 正常范围」);判据脚第二行不再重复', () => {
    const b = row('创业大厦')
    expect(b.lo).toBeNull()
    expect(b.baseNote).toMatch(/正常范围/)   // 对照:logic 的整句版仍是旧说法,屏上不用它
    expect(dayFact(b, SNAP)).toBe('历史不够，画不出平时范围')
    expect(critFoot(SNAP, b.id).baseNote).toBeNull()
  })
  it('❗本段才有读数的楼(在网、有读数,但段外没有历史):读不出的原因同样是句型库那句,芯片徽标「历史不够」', SLOW, () => {
    const fresh = ROWS.filter(r => !(r.stationId === 9 && r.date < '2025-08'))
    const s = buildSnapshot({ ...INPUT, rows: fresh })
    const b = s.board.find(x => x.id === 9)!
    expect([b.bornBySeg, b.center, b.seenN > 0]).toEqual([true, null, true])
    expect(dayFact(b, s)).toBe('历史不够，画不出平时范围')
    expect(critFoot(s, 9).baseNote).toBeNull()
    expect(chipGroups(s, null).shown.find(c => c.id === 9)).toMatchObject({ kind: 'unreadable', history: true })
  })
})

// ── B0 KPI(2026-10-06 改稿:五瓦)────────────────────────────────────────
// 期望值按定义从夹具逐条读数重新加一遍,不经过 pvKpis 的分段代码
const sumIn = (rs: ReadingRow[], pre: string, f: (r: ReadingRow) => number) => rs.filter(r => r.date.startsWith(pre)).reduce((t, r) => t + f(r), 0)
const CAP = new Map(STATIONS.map(s => [s.id, s.capKwp!]))
const daysIn = (rs: ReadingRow[], pre: string, ids?: number[]) => rs.filter(r => r.date.startsWith(pre) && (!ids || ids.includes(r.stationId)))
const perDayIn = (rs: ReadingRow[], pre: string, ids?: number[]) => {
  const xs = daysIn(rs, pre, ids)
  return xs.reduce((t, r) => t + r.gen, 0) / xs.reduce((t, r) => t + CAP.get(r.stationId)!, 0)
}
const r1 = (v: number) => Math.round(v * 10) / 10
const dir = (a: number, b: number) => (a >= b ? 'up' : 'dn')
/** 夹具 8 月只抄到 28 日:比上月 / 比去年同月都截到 1–28 日(同一段天数比) */
const to28 = (rs: ReadingRow[]) => rs.filter(r => +r.date.slice(8) <= 28)

describe('pvKpis —— 屏顶五瓦', () => {
  const t = pvKpis(SNAP, ROWS, PREV, 0.4)
  const aug = (f: (r: ReadingRow) => number) => sumIn(ROWS, '2025-08', f)
  const jul = (f: (r: ReadingRow) => number) => sumIn(to28(ROWS), '2025-07', f)
  const ly = (f: (r: ReadingRow) => number) => sumIn(to28(PREV), '2024-08', f)
  const gen = (r: ReadingRow) => r.gen, self = (r: ReadingRow) => r.selfUse, rev = (r: ReadingRow) => r.revenue + r.gridFeed * 0.4

  it('五瓦标签逐字', () => {
    expect(t.map(x => x.label)).toEqual(['发电量', '每千瓦日均', '连着 3 天偏离的楼栋', '自用占比', '自用和上网收益'])
  })
  it('发电量:本月合计万kWh;比7月、比去年8月(去年只有 B座 有 8 月读数,有数就算)', () => {
    expect(t[0].value).toBe(`${num(aug(gen) / 1e4)}万kWh`)
    expect(t[0].rows).toEqual([
      { val: pctS((aug(gen) / jul(gen) - 1) * 100), dir: dir(aug(gen), jul(gen)), key: '比7月' },
      { val: pctS((aug(gen) / ly(gen) - 1) * 100), dir: dir(aug(gen), ly(gen)), key: '比去年8月' },
    ])
  })
  it('❗每千瓦日均 = Σ发电 ÷ Σ(台账装机 × 抄表天数);比上月只拿两月都有读数的那批,key 写明几栋', () => {
    expect(t[1].value).toBe(`${perDayIn(ROWS, '2025-08').toFixed(1)} kWh`)
    const both = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]   // 7、8 月都有读数的 10 栋(创业大厦整年没读数)
    const a = perDayIn(ROWS, '2025-08', both), b = perDayIn(to28(ROWS), '2025-07', both)
    expect(t[1].rows![0]).toEqual({ val: pctS((a / b - 1) * 100), dir: dir(a, b), key: '同 10 栋楼比7月' })
    // 比去年同月:去年 8 月只有 B座 → 只拿 B座 比
    const a1 = perDayIn(ROWS, '2025-08', [1]), b1 = perDayIn(to28(PREV), '2024-08', [1])
    expect(t[1].rows![1]).toEqual({ val: pctS((a1 / b1 - 1) * 100), dir: dir(a1, b1), key: '比去年8月' })
  })
  it('连着偏离:值 = 有连续段且读得出的栋数;副行「判了 N 栋楼，M 栋历史不够」(9栋 覆盖不够不算历史不够)', () => {
    expect(t[2].value).toBe('2 栋')
    expect(judgedN(SNAP)).toBe(SNAP.board.filter(b => b.bornBySeg).length - 2)
    expect(t[2].note).toBe(`判了 ${judgedN(SNAP)} 栋楼，1 栋历史不够`)
    expect(t[2].rows).toBeUndefined()
  })
  it('自用占比:一位小数;差写「个点」,两边先舍入再相减', () => {
    const a = r1((aug(self) / aug(gen)) * 100), b = r1((jul(self) / jul(gen)) * 100)
    expect(t[3].value).toBe(`${a.toFixed(1)}%`)
    expect(t[3].rows![0]).toMatchObject({ dir: dir(a, b), key: '比7月' })
    expect(t[3].rows![0].val).toMatch(/^[+−]\d+\.\d 个点$/)
  })
  it('收益 = Σ自用(录入单价)+ Σ上网 × 上网单价;「−4.8万」= 屏上一位小数相减', () => {
    expect(t[4].value).toBe(yuan(aug(rev) / 1e4))
    const d = r1(aug(rev) / 1e4) - r1(jul(rev) / 1e4)
    expect(t[4].rows![0].val).toBe(`${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}万`)
    // 上网单价是入参(屏上读 pv_grid_price),不写死
    expect(pvKpis(SNAP, ROWS, PREV, 0.9)[4].value).not.toBe(t[4].value)
  })
  it('❗本月只抄到 28 日:比7月、比去年8月都只拿 1–28 日;对照:拿 7 月整月比是另一个数(差的是 3 天,不是发电)', () => {
    const full = sumIn(ROWS, '2025-07', gen)
    expect(jul(gen)).toBeLessThan(full)
    expect(t[0].rows![0].val).toBe(pctS((aug(gen) / jul(gen) - 1) * 100))
    expect(t[0].rows![0].val).not.toBe(pctS((aug(gen) / full - 1) * 100))
    // 整月抄完时不截:7 月看 7 月,比 6 月整月
    const julS = buildSnapshot({ ...INPUT, month: 7 })
    const g7 = sumIn(ROWS, '2025-07', gen), g6 = sumIn(ROWS, '2025-06', gen)
    expect(pvKpis(julS, ROWS, PREV, 0.4)[0].rows![0].val).toBe(pctS((g7 / g6 - 1) * 100))
  })
  it('❗上网单价按读数所在的月取;有月份没读到 → 收益写「—」,不拿常数顶', () => {
    const augOnly = (ym: string) => (ym === '2025-08' ? 0.4 : 0.6)
    const k = pvKpis(SNAP, ROWS, PREV, augOnly)[4]
    expect(k.value).toBe(yuan(aug(rev) / 1e4))   // 8 月按 0.4
    const d = r1(aug(rev) / 1e4) - r1(jul(r => r.revenue + r.gridFeed * 0.6) / 1e4)   // 7 月按 0.6
    expect(k.rows![0].val).toBe(`${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}万`)
    const miss = pvKpis(SNAP, ROWS, PREV, (ym: string) => (ym === '2025-08' ? null : 0.4))[4]
    expect([miss.value, miss.rows![0].val]).toEqual(['—', null])
  })
  it('❗上一年没取到 → 比去年那一行全是「—」(val null),比上月照算', () => {
    const n = pvKpis(SNAP, ROWS, undefined, 0.4)
    for (const k of [0, 1, 3, 4]) {
      expect(n[k].rows![1]).toEqual({ val: null, key: '比去年8月' })
      expect(n[k].rows![0].val).not.toBeNull()
    }
  })
  it('❗2 月 10栋 刚并网:每千瓦日均比 1 月只拿两月都有读数的 9 栋(新并网的掺进来会改平均);对照:全拿会是另一个数', SLOW, () => {
    const feb = buildSnapshot({ ...INPUT, month: 2 })
    const k = pvKpis(feb, ROWS, PREV, 0.4)[1].rows![0]
    const nine = [1, 2, 3, 4, 5, 6, 7, 9, 10]
    const a = perDayIn(ROWS, '2025-02', nine), b = perDayIn(ROWS, '2025-01', nine)
    expect(k).toEqual({ val: pctS((a / b - 1) * 100), dir: dir(a, b), key: '同 9 栋楼比1月' })
    expect(pctS((perDayIn(ROWS, '2025-02') / b - 1) * 100)).not.toBe(k.val)
  })

  it('按年:副行只有一行「比2024年」', () => {
    const y = pvKpis(SNAP_Y, ROWS, PREV, 0.4)
    expect(y[2].label).toBe('连着 3 个月偏离的楼栋')
    for (const k of [0, 1, 3, 4]) expect(y[k].rows!.map(r => r.key)).toEqual(['比2024年'])
    // 这一年只到 8/28:去年也只拿 1/1–8/28(年初到今天 ≠ 去年整年)
    const g25 = sumIn(ROWS, '2025', gen), g24 = sumIn(PREV.filter(r => r.date.slice(5) <= '08-28'), '2024', gen)
    expect(y[0].rows![0].val).toBe(pctS((g25 / g24 - 1) * 100))
    expect(y[0].rows![0].val).not.toBe(pctS((g25 / sumIn(PREV, '2024', gen) - 1) * 100))
  })
  it('❗1 月的比上月取上一年 12 月;上一年没 12 月 → 「—」', SLOW, () => {
    const jan = buildSnapshot({ ...INPUT, month: 1 })
    // 1 月比的是上一年 12 月:写「去年12月」(和消纳卡读数句同一个叫法,「比12月」在 1 月读起来像今年 12 月)
    expect(pvKpis(jan, ROWS, PREV, 0.4)[0].rows![0]).toEqual({ val: null, key: '比去年12月' })   // 夹具上一年只到 8 月
    const prevDec = [...PREV, ...makeRows(Y - 1, (i, m) => i === 0 && m === 12, () => 1, 3.2)]
    const g = sumIn(ROWS, '2025-01', gen), p = sumIn(prevDec, '2024-12', gen)
    expect(pvKpis(jan, ROWS, prevDec, 0.4)[0].rows![0]).toEqual({ val: pctS((g / p - 1) * 100), dir: dir(g, p), key: '比去年12月' })
    const pk = perKwCard(jan, ROWS, prevDec, 0.4)
    expect([pk.heads, pk.hint]).toEqual([['比去年12月', '比去年1月'], '全部 11 栋楼 · 和去年12月、去年同月比 · kWh'])
  })
  it('❗有楼每千瓦日均超 24 kWh → 连着偏离那张的副行改说它;对照:没有时说判了几栋', () => {
    const hot = ROWS.map(r => (r.stationId === 1 && r.date.startsWith('2025-08') ? { ...r, gen: r.gen * 10 } : r))
    expect(pvKpis(SNAP, hot, PREV, 0.4)[2].note).toBe('另 1 栋楼每千瓦日均超 24 kWh')
    expect(t[2].note).toMatch(/^判了/)
  })
})

describe('perKwCard —— 各栋每千瓦日均发电(新卡)', () => {
  const c = perKwCard(SNAP, ROWS, PREV, 0.4)
  it('按月:列头比上月、比去年同月;卡头写全部几栋楼', () => {
    expect(c.heads).toEqual(['比7月', '比去年8月'])
    expect(c.hint).toBe('全部 11 栋楼 · 和7月、去年同月比 · kWh')   // 装了表的 11 栋(未装表楼不进)
    expect(c.anchorDay).toBeNull()
  })
  it('按每千瓦日均降序(一位小数相同按楼栋顺序);这段没读数的创业大厦垫底、占一行', () => {
    const pd = c.rows.filter(r => r.perDay != null).map(r => r.perDay!)
    expect(pd).toHaveLength(10)
    for (let i = 1; i < pd.length; i++) expect(r1(pd[i - 1])).toBeGreaterThanOrEqual(r1(pd[i]))
    expect(c.rows[c.rows.length - 1]).toMatchObject({ name: '创业大厦', perDay: null, days: 0, born: false })
    // 对照:已经并网、只是这段没读数的楼(9 月:数据只到 8/28)不写「还没并网」
    const sep = perKwCard(buildSnapshot({ ...INPUT, month: 9 }), ROWS, PREV, 0.4)
    expect(sep.rows.find(r => r.name === 'B座')).toMatchObject({ perDay: null, days: 0, born: true })
    const b = c.rows.find(r => r.name === 'B座')!
    expect(b.perDay).toBeCloseTo(perDayIn(ROWS, '2025-08', [1]), 9)
    expect(b.days).toBe(28)
  })
  it('❗每栋两列:比7月有数;比去年8月只有去年有读数的 B座 有数,其余写「—」', () => {
    const b = c.rows.find(r => r.name === 'B座')!
    const a = perDayIn(ROWS, '2025-08', [1])
    expect(b.cols).toEqual([pctS((a / perDayIn(to28(ROWS), '2025-07', [1]) - 1) * 100), pctS((a / perDayIn(to28(PREV), '2024-08', [1]) - 1) * 100)])
    expect(c.rows.find(r => r.name === 'C、D座')!.cols[1]).toBe('—')
    expect(c.refs).toEqual([])   // 上一期、去年都有数,没有超 24 的 —— 一句参照都不出
    expect(c.read?.type).toBe('extremes')
  })
  it('❗「—」一张卡说一次:2 月 10栋 刚并网没有 1 月;去年整年没有分栋读数;去年没取到不说「没有」', SLOW, () => {
    const feb = buildSnapshot({ ...INPUT, month: 2 })
    const f = perKwCard(feb, ROWS, PREV, 0.4)
    expect(f.rows.find(r => r.name === '10栋')!.cols[0]).toBe('—')
    expect(f.refs.map(r => r.text)).toEqual(['—：2月才并网的楼没有1月'])
    expect(perKwCard(SNAP, ROWS, [], 0.4).refs.map(r => r.text)).toEqual(['—：2024年还没有分栋读数'])
    expect(perKwCard(SNAP, ROWS, undefined, 0.4).refs).toEqual([])
  })
  it('❗早有读数、只是上个月整月没抄的楼不说「才并网」,写测量;对照:2 月 10栋 首条读数在本段 → 才并网', () => {
    const gap = ROWS.filter(r => !(r.stationId === 4 && r.date.startsWith('2025-07')))   // F座 1 月起就有读数,7 月整月没抄
    const g = perKwCard(SNAP, gap, PREV, 0.4)
    expect(g.rows.find(r => r.name === 'F座')!.cols[0]).toBe('—')
    expect(g.refs.map(r => r.text)).toEqual(['—：F座7月没有读数'])
  })
  it('❗按年那列比去年:只拿两年都有读数的月(同合格线卡),E座 去年只有 1–6 月 → 只比 1–6 月;去年截到 8/28', () => {
    const y = perKwCard(SNAP_Y, ROWS, PREV, 0.4)
    const pd = (rs: ReadingRow[], id: number, ms: number[]) => {
      const x = rs.filter(r => r.stationId === id && ms.includes(+r.date.slice(5, 7)))
      return x.reduce((s, r) => s + r.gen, 0) / x.length
    }
    const m6 = [1, 2, 3, 4, 5, 6], m8 = [1, 2, 3, 4, 5, 6, 7, 8]
    expect(y.rows.find(r => r.name === 'E座')!.cols[1]).toBe(pctS((pd(ROWS, 3, m6) / pd(PREV, 3, m6) - 1) * 100))
    const prev28 = PREV.filter(r => r.date.slice(5) <= '08-28')
    expect(y.rows.find(r => r.name === 'B座')!.cols[1]).toBe(pctS((pd(ROWS, 1, m8) / pd(prev28, 1, m8) - 1) * 100))
    // 两张卡同一栋同一个数
    expect(anchorBars(SNAP, ROWS, PREV).rows.find(r => r.name === 'E座')!.prev).toBe(y.rows.find(r => r.name === 'E座')!.cols[1])
  })
  it('❗只有月抄的楼:一条读数按那个月的日历天数摊(按条数算会放大约 30 倍);徽标写「只有月抄」', SLOW, () => {
    // 11栋 改成每月一条(月末,整月合计),看 7 月
    const monthly = ROWS.filter(r => r.stationId !== 9).concat(
      Array.from({ length: 7 }, (_, k) => {
        const xs = ROWS.filter(r => r.stationId === 9 && r.date.startsWith(`2025-0${k + 1}`))
        const sum = (f: (r: ReadingRow) => number) => xs.reduce((s, r) => s + f(r), 0)
        return { ...xs[xs.length - 1], gen: sum(r => r.gen), selfUse: sum(r => r.selfUse), gridFeed: sum(r => r.gridFeed), revenue: sum(r => r.revenue) }
      }))
    const julM = buildSnapshot({ ...INPUT, month: 7, rows: monthly })
    const julD = buildSnapshot({ ...INPUT, month: 7 })
    expect(julM.stations.find(s => s.id === 9)!.cadence).toBe('monthly')
    const m = perKwCard(julM, monthly, PREV, 0.4).rows.find(r => r.name === '11栋')!
    const d = perKwCard(julD, ROWS, PREV, 0.4).rows.find(r => r.name === '11栋')!
    expect(m.days).toBe(31)
    expect(m.perDay).toBeCloseTo(d.perDay!, 9)
    expect(pvKpis(julM, monthly, PREV, 0.4)[2].note).toMatch(/^判了/)   // 没被放大成「超 24 kWh」
    expect(chipGroups(julM, null).shown.find(c => c.name === '11栋')).toMatchObject({ kind: 'unreadable', monthly: true, history: false })
  })
  it('按年:列头在网、比2024年;合格线摊到每天画进这张(807.5 ÷ 365)', () => {
    const y = perKwCard(SNAP_Y, ROWS, PREV, 0.4)
    expect(y.heads).toEqual(['在网', '比2024年'])
    expect(y.hint).toBe('11 栋楼 · 按在网天数平均 · 和2024年比 · kWh')
    expect(y.anchorDay).toBeCloseTo(807.5 / 365, 9)
    expect(y.anchorLabel).toBe('合格线 2.21（一年 807.5）')
    // 锚点没填(0,新园区库里没这条参数):不画合格线,不套我园的 950
    const none = perKwCard(buildSnapshot({ ...INPUT, gran: 'year', crit: { anchorHours: 0 } }), ROWS, PREV, 0.4)
    expect([none.anchorDay, none.anchorLabel]).toEqual([null, null])
    // 夹具整年只到 8/28:每栋都不满一年,在网列写天数
    expect(y.rows.find(r => r.name === 'B座')!.cols[0]).toBe(`${daysIn(ROWS, '2025', [1]).length} 天`)
  })
  it('❗有楼超 24 kWh:读数句说超限(对约定值),参照说一天只有 24 小时', () => {
    const hot = ROWS.map(r => (r.stationId === 1 && r.date.startsWith('2025-08') ? { ...r, gen: r.gen * 10 } : r))
    const h = perKwCard(SNAP, hot, PREV, 0.4)
    expect(h.rows[0].name).toBe('B座')
    expect(h.read?.type).toBe('baseline')
    expect(h.read?.text.replace(/ /g, ' ')).toBe(`B座每千瓦日均 ${h.rows[0].perDay!.toFixed(1)} kWh，超过 24 kWh`)
    expect(h.refs.map(r => r.text)).toEqual(['每千瓦一天最多发 24 kWh（一天只有 24 小时）'])
  })
})

describe('defaultPick / shortRefOf / historyShort', () => {
  it('默认选中本段偏离天数最多、有连着偏离的那栋(F座 27 天),不是芯片第一枚读不出的', () => {
    expect(defaultPick(SNAP)).toBe(idOf('F座'))
  })
  it('❗没有连续段时选零散偏离天数最多、判得了的那栋;对照:读不出的不选', SLOW, () => {
    const s = buildSnapshot({ ...INPUT, crit: { bandRun: 40 } })
    const g = chipGroups(s, null)
    const judged = [...g.shown, ...g.folded].filter(c => c.kind === 'plain')
    expect(judged.length).toBeGreaterThan(1)
    const max = Math.max(...judged.map(c => c.outDays))
    const pick = judged.find(c => c.id === defaultPick(s))!
    expect(pick.outDays).toBe(max)
    expect(max).toBeGreaterThan(0)
  })
  it('历史不够 = 画不出范围或在网不足 90 天;覆盖不够的 9栋 不算', () => {
    expect(historyShort(row('10栋'), SNAP)).toBe(true)
    expect(historyShort(row('9栋'), SNAP)).toBe(false)
    expect(chipGroups(SNAP, null).shown.filter(c => c.kind === 'unreadable').map(c => [c.name, c.history])).toEqual([['9栋', false], ['10栋', true]])
  })
  it('❗主卡那句:月档按在网天数说还差几天;年档画不出范围时按月数说', SLOW, () => {
    const d = SNAP.stations.find(s => s.name === '10栋')!.days
    expect(shortRefOf(SNAP)?.text).toBe(`10栋读数从2月1日起，还差 ${90 - d} 天满 90 天`)
    // 10栋 只有 8 月读数:年档 1 个月画不出范围
    const late = ROWS.filter(r => r.stationId !== 8 || r.date >= '2025-08-01')
    const y = buildSnapshot({ ...INPUT, gran: 'year', rows: late })
    expect(shortRefOf(y)?.text).toBe('10栋只有 1 个月读数，满 6 个月才判')
    expect(shortRefOf(buildSnapshot({ ...INPUT, rows: ROWS.filter(r => r.stationId !== 7 && r.stationId !== 8) }))).toBeNull()
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

// ── B2 判据脚(2026-10-06 改稿:三条判据 + 平时范围拿哪段估 + 末句)────────────────
describe('critFoot', () => {
  it('三条判据原文;窗口句写首末与条数;末句', () => {
    const f = critFoot(SNAP, idOf('F座'))
    expect(f.items.map(i => i.text)).toEqual(['平时范围：常见水平上下各放 2 份正常起伏', '连着 3 天偏离算一次', '抄够 90% 才判'])
    const base = row('F座').base!
    // 窗口 = 同批在网(10栋 2/1 投产起)∩ 6/9 变点之前
    expect(base.from).toBe('2025-02-01')
    expect(f.baseNote).toBe(`平时范围按 2月1日–${+base.to.slice(0, 2)}月${+base.to.slice(3)}日 的 ${base.n} 天算`)
    expect(f.tail).toBe('全园一起少发时，这张图看不出来')
    expect(critFoot(SNAP, null).baseNote).toBeNull()
  })
  // 2026-10-04 用户拍板产品卖给别的园区:锚点没填(新园区库里没这条参数)就不判,不套我园的 950。
  // 2026-10-06 改稿判据脚不再列年等效(挪回合格线卡),所以只钉「各栋不出年等效那条」+ 判据脚里没有这一项
  it('❗锚点没填(0):各栋不出年等效那条;判据脚不列年等效;对照:有锚点照常出', () => {
    expect(SNAP_Y.facts.some(f => f.kind === 'yield')).toBe(true)
    const none = buildSnapshot({ ...INPUT, gran: 'year', crit: { anchorHours: 0 } })
    expect(none.facts.some(f => f.kind === 'yield')).toBe(false)
    expect(critFoot(none, null).items.map(i => i.key)).toEqual(['band', 'run', 'cover'])
  })
  it('❗放宽过「含并网初期」、选中栋是年内才并网的 → 「含这栋刚并网那段」;年初就在的栋只放宽同批 → 「含别的楼刚并网的月份」', () => {
    const f = row('F座')
    const with_ = (patch: Partial<typeof f>) => ({ ...SNAP, board: SNAP.board.map(b => (b.id === f.id ? { ...b, ...patch } : b)) })
    const own = with_({ firstDate: '2025-02-01', base: { ...f.base!, relaxed: ['含并网初期'] } })
    expect(critFoot(own, f.id).baseNote).toMatch(/，含这栋刚并网那段$/)
    const other = with_({ base: { ...f.base!, relaxed: ['不限同批在网', '含并网初期'] } })
    expect(critFoot(other, f.id).baseNote).toMatch(/，含别的楼刚并网的月份$/)
    expect(critFoot(SNAP, f.id).baseNote).not.toContain('，含')
  })
  it('读 snap.crit,不写死;年档按月计', () => {
    const f = critFoot({ ...SNAP, crit: { ...SNAP.crit, coverMonth: 0.85, bandSigma: 3, bandRun: 4 } }, null)
    expect(f.items.map(i => i.text)).toEqual(['平时范围：常见水平上下各放 3 份正常起伏', '连着 4 天偏离算一次', '抄够 85% 才判'])
    expect(critFoot(SNAP_Y, null).items.find(i => i.key === 'run')!.text).toBe('连着 3 个月偏离算一次')
  })
})

// ── B3 每千瓦发电走势(2026-10-06 改稿:卡头写选中栋与每天 / 每月,参照只留分母那句 + 超 24 压顶那句)─────
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
    expect([f.med[16], f.lo[16], f.hi[16]]).toEqual([null, null, null])
    expect(f.selName).toBe('F座')
    expect(f.hint).toBe('选中 F座 · 每天 · 和全园中间一半比 · kWh')
    expect(f.cap).toBe(24)
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
    // 按年一个点是一个月的合计:上限逐月 = 24 × 当月天数(画板便签「规则一样」);卡头写「每月」
    expect([f.futureFrom, f.hint]).toEqual([8, '选中 F座 · 每月 · 和全园中间一半比 · kWh'])
    expect(f.cap).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].map(d => 24 * d))
    expect(SNAP_Y.elapsedN).toBe(8)   // 已过去 8/12 个月(原「数据到」瓦的副行,那张瓦 2026-10-06 改稿拿掉了)
    const c = consumption(SNAP_Y, ROWS, PREV)
    expect([c.ticks.length, c.futureFrom, c.ticks[8].lossPct]).toEqual([12, 8, null])
  })
  it('整段已过去(今天挪到 31 日)不画未到淡区', () => {
    expect(yieldBand({ ...SNAP, elapsedN: 31 }, ROWS, null).futureFrom).toBeNull()
  })
  it('❗投产前的刻度给 pre,不给 missing(气泡不写没抄表):年档 10栋 1 月', () => {
    const t = yieldBand(SNAP_Y, ROWS, idOf('10栋'))
    expect(t.selState.slice(0, 2)).toEqual(['pre', 'seen'])
    expect(yieldBand(SNAP, ROWS, idOf('F座')).selState).not.toContain('pre')
  })
  it('分母那句三种:一栋都没录板数(画板)/ 录了几栋 / 都录了不出句', () => {
    const refs = (noPanel: string[]) => yieldBand({ ...SNAP, quality: { ...SNAP.quality, noPanel } }, ROWS, idOf('F座')).refs.map(r => r.text)
    const all = SNAP.stations.filter(s => s.metered).map(s => s.name)
    expect(refs(all)).toEqual(['按台账装机算，全部 11 栋楼都没录板数'])
    expect(refs(SNAP.quality.noPanel)).toEqual(['8 栋楼没录板数，这几栋按台账装机算'])
    expect(refs([])).toEqual([])
  })
  it('❗选中栋有一天每千瓦超 24 kWh:参照加「虚线段」那句(画板 m-trail-over);对照:选别的栋、按年都不加', () => {
    const over = ROWS.map(r => (r.stationId === 4 && r.date === '2025-08-05' ? { ...r, gen: 390 * 30 } : r))
    const f = yieldBand(SNAP, over, idOf('F座'))
    expect(f.sel[4]).toBeCloseTo(30, 9)
    expect(f.refs.map(r => r.text)).toEqual(['8 栋楼没录板数，这几栋按台账装机算', '虚线段：这天每千瓦超过 24 kWh，画到 24 为止'])
    expect(yieldBand(SNAP, over, idOf('E座')).refs).toHaveLength(1)
    expect(yieldBand(SNAP_Y, over, idOf('F座')).refs).toHaveLength(1)   // 按年 8 月合计远不到 24 × 31
  })
  it('❗按年:某月每千瓦日均超 24(合计超 24 × 当月天数)→ 参照写按月那句;对照:按月那句是「这天」', () => {
    const hot = ROWS.map(r => (r.stationId === 4 && r.date.startsWith('2025-08') ? { ...r, gen: 390 * 30 } : r))
    const f = yieldBand(SNAP_Y, hot, idOf('F座'))
    expect(f.sel[7]!).toBeGreaterThan(24 * 31)
    expect(f.refs.map(r => r.text)[1]).toBe('虚线段：这个月每千瓦日均超 24 kWh，画到 24 × 天数')
  })
})

// ── A2 每千瓦日均和合格线的差(2026-10-06 改稿:年等效 → 每栋按有读数的天数摊到每天,合格线也摊到每天)──
describe('anchorBars —— 每千瓦日均、比合格线、比上一年', () => {
  const a = anchorBars(SNAP, ROWS, PREV)
  const AD = 807.5 / 365
  const CAP: Record<number, number> = Object.fromEntries(STATIONS.map(s => [s.id, s.capKwp!]))
  const rs = (src: ReadingRow[], id: number, months?: number[]) =>
    src.filter(r => r.stationId === id && (!months || months.includes(Number(r.date.slice(5, 7)))))
  /** 独立重算:Σ发电 ÷ (台账装机 × 有读数的天数) */
  const perDay = (src: ReadingRow[], id: number, months?: number[]) => {
    const x = rs(src, id, months)
    return x.reduce((t, r) => t + r.gen, 0) / CAP[id] / x.length
  }
  it('合格线摊到每天 807.5 ÷ 365;按差降序;在网不足 90 天的 10栋 不画;整年没读数的创业大厦占一行写还没并网', () => {
    expect(a.anchorDay).toBeCloseTo(AD, 12)
    expect(a.rows.map(r => r.name).sort()).toEqual(['11栋', '12栋', '8栋', '9栋', 'B座', 'C、D座', 'E座', 'F座', 'G座'].sort())
    for (let i = 1; i < a.rows.length; i++) expect(Math.round(a.rows[i - 1].delta * 100)).toBeGreaterThanOrEqual(Math.round(a.rows[i].delta * 100))
    expect(a.unborn).toEqual([{ id: 11, name: '创业大厦', phase: 3 }])
    // 卡头覆盖按读数首末月:夹具只到 8 月,写「1–8月」(写「全年」会和工具条「分栋抄表 2025年1–8月」对不上)
    expect(a.hint).toBe('1–8月 · 9 栋楼 · 和合格线比 · kWh')
  })
  it('❗分母是台账装机 × 有读数的天数(和新卡同一个数):E座 除 390 不除板数算的 400;差与 %', () => {
    const e = a.rows.find(r => r.name === 'E座')!
    const pd = perDay(ROWS, 3)
    expect(e.days).toBe(rs(ROWS, 3).length)
    expect(e.perDay).toBeCloseTo(pd, 9)
    expect(e.perDay).not.toBeCloseTo(rs(ROWS, 3).reduce((t, r) => t + r.gen, 0) / 400 / e.days, 3)
    expect(e.delta).toBeCloseTo(pd - AD, 9)
    expect(e.deltaPct).toBeCloseTo((pd / AD - 1) * 100, 9)
  })
  it('❗比上一年只拿两年都有读数的月、各自摊到每天:E座 只比 1–6 月;对照:拿今年 8 个月去比会是另一个数', () => {
    const m6 = [1, 2, 3, 4, 5, 6]
    const e = a.rows.find(r => r.name === 'E座')!
    expect(e.prev).toBe(pctS((perDay(ROWS, 3, m6) / perDay(PREV, 3, m6) - 1) * 100))
    expect(e.prev).not.toBe(pctS((perDay(ROWS, 3) / perDay(PREV, 3, m6) - 1) * 100))
    const m8 = [1, 2, 3, 4, 5, 6, 7, 8]
    // 这一年只到 8/28:去年也截到 8/28
    expect(a.rows.find(r => r.name === 'B座')!.prev).toBe(pctS((perDay(ROWS, 1, m8) / perDay(PREV.filter(r => r.date.slice(5) <= '08-28'), 1, m8) - 1) * 100))
    // 上一年这栋没读数 →「—」;上一年没取到同样「—」
    expect(a.rows.find(r => r.name === 'C、D座')!.prev).toBe('—')
    expect(anchorBars(SNAP, ROWS, undefined).rows.every(r => r.prev === '—')).toBe(true)
  })
  it('❗角标:上一年取到了却一条分栋读数都没有 →「2024年没有分栋读数」;没取到不说;有数不说', () => {
    expect(anchorBars(SNAP, ROWS, []).badge).toBe('2024年没有分栋读数')
    expect(anchorBars(SNAP, ROWS, undefined).badge).toBeNull()
    expect(a.badge).toBeNull()
  })
  it('参照三句:合格线一年 / 摊到每天;每期按几天平均(一期内天数不一样写范围);在网太短不画的楼', () => {
    const days = (ids: number[]) => ids.map(id => rs(ROWS, id).length)
    const p1 = days([1, 2, 3, 4, 5]), p2 = days([6, 7, 9, 10])
    const span = (ds: number[]) => (Math.min(...ds) === Math.max(...ds) ? `${ds[0]}` : `${Math.min(...ds)}–${Math.max(...ds)}`)
    const short = SNAP.stations.find(s => s.name === '10栋')!.days
    expect(short).toBeLessThan(90)
    expect(a.refs.map(r => r.text)).toEqual([
      '合格线一年 807.5 kWh，摊到每天 2.21 kWh',
      `一期按 ${span(p1)} 天、二期按 ${span(p2)} 天平均`,
      `10栋在网 ${short} 天，不画`,
    ])
    expect(span(p1)).toContain('–')   // 夹具非退化:E座、G座 漏抄,一期内天数不一样
  })
})

// ── B6 ───────────────────────────────────────────────────────────────────
describe('ledgerScatter —— 缺任一不出点', () => {
  it('3 栋出点(含一栋超线);只录了单块标称的 F座 不出', () => {
    const l = ledgerScatter(SNAP)
    expect(l.points.map(p => [p.name, p.x, p.y])).toEqual([['B座', 500, 500], ['E座', 400, 390], ['12栋', 380, 340]])
    expect(l.points[2].diff).toBeCloseTo(-40 / 380, 9)
    expect([l.unrecorded, l.metered, l.tolerance]).toEqual([8, 11, 0.03])
    expect([l.hint, l.empty]).toEqual(['全部 11 栋楼 · 和台账比 · kWp', null])
  })
  it('❗一栋都没录板数(画板):给一句,整张卡收成一行;对照:录了几栋照画散点', () => {
    const all = SNAP.stations.filter(s => s.metered).map(s => s.name)
    const none = ledgerScatter({
      ...SNAP, quality: { ...SNAP.quality, noPanel: all },
      stations: SNAP.stations.map(s => ({ ...s, theoKwp: null, ledgerDiff: null })),
    })
    expect(none.points).toEqual([])
    expect(none.empty).toBe('全部 11 栋楼都没录板数，录了才画得出和台账对不对得上')
  })
})

// ── B7 ───────────────────────────────────────────────────────────────────
describe('consumption —— 逐日三段与损耗率', () => {
  const c = consumption(SNAP, ROWS, PREV)
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

  // 2026-10-06 改稿:卡下长图注换成读数句 + 参照(画板 m-ledger / y-ledger)
  const gridOf = (rs: ReadingRow[], pre: string) => rs.filter(r => r.date.startsWith(pre)).reduce((t, r) => t + r.gridFeed, 0)
  const growthText = (a: number, b: number, from: string, to: string) =>
    `${from}→${to} 上网电量${b >= a ? '增长' : '下降'} ${Math.abs((b / a - 1) * 100).toFixed(1)}%`
  it('按月:读数句 = 上网电量比上月;参照 = 按几栋几条抄表算 + 损耗那句;这段有楼没读数不写「全部」', () => {
    // 卡头和参照说同一个栋数:这段 10 栋有读数,不写「全部 11 栋楼」
    expect(c.hint).toBe('10 栋楼合计 · 万kWh')
    // 本月只抄到 28 日:上月也只拿 1–28 日
    expect(c.read?.text).toBe(growthText(gridOf(to28(ROWS), '2025-07'), gridOf(ROWS, '2025-08'), '7月', '8月'))
    expect(c.read?.text).not.toBe(growthText(gridOf(ROWS, '2025-07'), gridOf(ROWS, '2025-08'), '7月', '8月'))
    const aug = ROWS.filter(r => r.date.startsWith('2025-08'))
    expect(new Set(aug.map(r => r.stationId)).size).toBe(10)   // 创业大厦整年没读数
    expect(c.refs.map(r => r.text)).toEqual([`按 10 栋楼 ${aug.length} 条抄表算`, '损耗是发电减去自用和上网剩下的，没记原因'])
    expect([c.marks, c.joins]).toEqual([[], []])
  })
  it('❗1 月比上月取上一年 12 月(写「去年12月」);上一年没有 12 月 → 读数句不出(行位由屏留着)', SLOW, () => {
    const jan = buildSnapshot({ ...INPUT, month: 1 })
    expect(consumption(jan, ROWS, PREV).read).toBeNull()
    const dec: ReadingRow = { stationId: 1, date: '2024-12-15', gen: 2000, selfUse: 900, gridFeed: 1000, revenue: 0, priceSnap: null }
    expect(consumption(jan, ROWS, [...PREV, dec]).read?.text).toBe(growthText(1000, gridOf(ROWS, '2025-01'), '去年12月', '1月'))
  })
  it('按年:读数句 = 发电最高最低的月;两个月柱顶出气泡;参照只有损耗那句', () => {
    const cy = consumption(SNAP_Y, ROWS, PREV)
    const gens = Array.from({ length: 8 }, (_, i) => ROWS.filter(r => r.date.startsWith(`2025-0${i + 1}`)).reduce((t, r) => t + r.gen, 0))
    const hi = gens.indexOf(Math.max(...gens)), lo = gens.indexOf(Math.min(...gens))
    // 显示位数一样的月并列点名(夹具 2 月、8 月都是 36.9万kWh)
    const tie = (v: number) => gens.flatMap((g, i) => (wanKwh(g) === wanKwh(v) ? [`${i + 1}月`] : [])).join('、')
    expect(cy.read?.text).toBe(`发电最高 ${tie(gens[hi])} ${wanKwh(gens[hi])}，最低 ${tie(gens[lo])} ${wanKwh(gens[lo])}`)
    expect(cy.marks).toEqual([{ i: hi, text: `${hi + 1}月 ${wanKwh(gens[hi])}` }, { i: lo, text: `${lo + 1}月 ${wanKwh(gens[lo])}` }])
    expect(cy.refs.map(r => r.text)).toEqual(['损耗是发电减去自用和上网剩下的，没记原因'])
    expect(cy.joins).toEqual([])   // 夹具三期都从 1 月起就有读数(10栋 2 月才有,但二期别的楼 1 月就有)
  })
  it('❗按年并网短标:某期第一条读数落在哪月标哪月(数据的第一个月不标);和气泡同月让给气泡', () => {
    const marks = consumption(SNAP_Y, ROWS, PREV).marks.map(k => k.i)
    const from = (m: number) => ROWS.filter(r => !(r.stationId >= 6 && r.stationId <= 10 && r.date < `2025-0${m}`))
    const free = [2, 3, 4, 5, 6, 7, 8].find(m => !marks.includes(m - 1))!
    expect(consumption(SNAP_Y, from(free), PREV).joins).toEqual([{ i: free - 1, text: '二期并网' }])
    const taken = marks.find(i => i > 0)! + 1   // 气泡占着的月(不是 1 月)
    expect(consumption(SNAP_Y, from(taken), PREV).joins).toEqual([])
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
  it('❗条尾两位小数一样的按楼栋顺序排:9栋 比 8栋 多 ¥0.01(屏上一样)仍排在 8栋 后;对照:差到条尾看得出时照合计排', () => {
    const twin = (bump: number) => ROWS.filter(r => r.stationId !== 7)
      .concat(ROWS.filter(r => r.stationId === 6).map(r => ({ ...r, stationId: 7, revenue: r.revenue + (r.date === '2025-08-01' ? bump : 0) })))
    const names = (bump: number) => revenueBars(SNAP, twin(bump), 0.4).rows.map(x => x.name).filter(n => n === '8栋' || n === '9栋')
    expect(names(0.01)).toEqual(['8栋', '9栋'])
    expect(names(500)).toEqual(['9栋', '8栋'])
  })
  it('卡头写几栋楼(这段 10 栋发了电,不写「全部」);读数句收益最高最低;参照写上网单价与自用单价', () => {
    expect(r.hint).toBe('10 栋楼 · 按合计排 · 万元')
    const hi = r.rows[0], lo = r.rows[r.rows.length - 1]
    // 屏上一位小数一样的并列点名,按楼栋顺序(夹具 F座、9栋 都是 ¥1.0万)
    const tie = (v: number) => r.rows.filter(x => yuan(x.total / 1e4) === yuan(v / 1e4)).sort((a, b) => a.id - b.id).map(x => x.name).join('、')
    expect(r.read?.text).toBe(`收益最高 ${tie(hi.total)} ${yuan(hi.total / 1e4)}，最低 ${tie(lo.total)} ${yuan(lo.total / 1e4)}`)
    expect(r.refs.map(x => x.text)).toEqual(['上网按系统里的上网单价 ¥0.4/kWh 算', '自用按录入时的单价算'])
    expect(revenueBars(SNAP, ROWS, 0.453).refs[0].text).toBe('上网按系统里的上网单价 ¥0.453/kWh 算')
  })
  it('❗上网单价按读数所在的月取:几个月不同价参照写范围;有月份没读到 → 那几个月上网收益不算,参照写明', () => {
    const yr = revenueBars(SNAP_Y, ROWS, (ym: string) => (ym === '2025-06' ? 0.5 : 0.453))
    expect([yr.gridPrice, yr.refs[0].text]).toEqual([null, '上网按每月的系统上网单价 ¥0.453–0.5/kWh 算'])
    const b = (p: number | ((ym: string) => number | null)) => revenueBars(SNAP_Y, ROWS, p).rows.find(x => x.name === 'B座')!.grid
    const jun = ROWS.filter(x => x.stationId === 1 && x.date.startsWith('2025-06')).reduce((s, x) => s + x.gridFeed, 0)
    expect(b(ym => (ym === '2025-06' ? 0.5 : 0.453)) - b(0.453)).toBeCloseTo(jun * 0.047, 6)
    const miss = revenueBars(SNAP, ROWS, () => null)
    expect([miss.gridPrice, miss.refs[0].text, miss.rows[0].grid]).toEqual([null, '上网单价没读到，这几个月的上网收益没算', 0])
  })
  it('❗按年另说哪几栋不是整年都有读数:两栋以内写楼名;正好一整期写「二期」', () => {
    expect(revenueBars(SNAP_Y, ROWS, 0.4).refs.map(x => x.text)[2]).toBe('10栋只有 2–8月')
    const p2June = ROWS.filter(r => !(r.stationId >= 6 && r.stationId <= 10 && r.date < '2025-06'))
    expect(revenueBars(SNAP_Y, p2June, 0.4).refs.map(x => x.text)[2]).toBe('二期只有 6–8月')
    // 组内楼名按楼栋顺序(F座 合计比 G座 小,按合计排它在后面;画板「创业大厦、工业大厦」同理)
    const fgJune = ROWS.filter(r => !((r.stationId === 4 || r.stationId === 5) && r.date < '2025-06'))
    const y = revenueBars(SNAP_Y, fgJune, 0.4)
    expect(y.rows.findIndex(x => x.name === 'G座')).toBeLessThan(y.rows.findIndex(x => x.name === 'F座'))
    expect(y.refs.map(x => x.text)[2]).toBe('F座、G座只有 6–8月，10栋只有 2–8月')
    expect(r.refs).toHaveLength(2)   // 按月不说
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
  it('❗residualGrid:在网不足的行数;某期年内并网那个月老一期的格冲过最深一档才写范围,没冲过不写', () => {
    const g = residualGrid(LAB(), SNAP)
    expect(g.shortN).toBe(1)                     // 10栋
    expect(g.join).toBeNull()                    // 夹具里各期 1 月 1 日就有读数
    // 二期 6 月才有第一条读数;一期两栋 6 月那格 +477% / +566%(画板上的样子),另一栋那个月没数
    const v = (p: number) => Math.log(1 + p / 100)
    const snap6 = { ...SNAP, board: SNAP.board.map(b => (b.phase === 2 ? { ...b, firstDate: '2025-06-01' } : b)) }
    const lab = (jun: [number, number]) => ({
      seasonHalf: Math.log(1.1), seasonPartial: null,
      season: [
        { id: 1, name: 'B座', amp: null, months: [0, 0, 0, 0, 0, v(jun[0]), v(-8), 0, null, null, null, null] },
        { id: 2, name: 'C、D座', amp: null, months: [0, 0, 0, 0, 0, v(jun[1]), 0, 0, null, null, null, null] },
        { id: 3, name: 'E座', amp: null, months: [0, 0, 0, 0, 0, null, 0, 0, null, null, null, null] },
        { id: 6, name: '8栋', amp: null, months: [null, null, null, null, null, v(-25), 0, 0, null, null, null, null] },
      ],
    }) as unknown as LabResult
    const j = residualGrid(lab([477.4, 566.1]), snap6).join!
    expect([j.m, j.p, j.p0, j.n]).toEqual([6, 2, 1, 2])
    expect([j.lo, j.hi].map(x => +x.toFixed(6))).toEqual([477.4, 566.1])
    // 对照:同一个并网月,老楼那格没冲过最深一档(半幅 10%)就不写
    expect(residualGrid(lab([3, 6]), snap6).join).toBeNull()
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

  // 2026-10-06 改稿:隔天像不像 / 碰巧更偏两张卡下线,一栋一个数并进核对表
  it('❗labTableRows 两列:隔天像不像 = 这栋整年逐日偏差隔 1 天的相关;碰巧更偏 = 当段那几天打乱重算 999 次里一样偏或更偏的次数', () => {
    const lab = LAB()
    const t = labTableRows(lab, SNAP)
    const ranked = t.filter(r => !r.unborn)
    expect(ranked.length).toBe(9)
    for (const r of ranked) {
      // 期望值不经过 buildLab:从快照的残差重新取序列、重新打乱
      const series = [...SNAP.polish.resid.get(r.id)!].sort((a, b) => a[0].localeCompare(b[0]))
      const vals = series.map(([, v]) => v)
      const win = series.flatMap(([d, v]) => (d.startsWith('2025-08') ? [v] : []))
      const obs = win.reduce((a, b) => a + b, 0) / win.length
      const dist = blockBootstrapP(vals, obs, win.length, { block: 14, B: 999, seed: 20260831 }).nullDist
      expect(dist).toHaveLength(LAB_SHUFFLES)
      expect(r.chance, r.name).toBe(Math.min(dist.filter(v => v >= obs).length, dist.filter(v => v <= obs).length))
      const m = vals.reduce((a, b) => a + b, 0) / vals.length
      const c0 = vals.reduce((a, v) => a + (v - m) ** 2, 0)
      const c1 = vals.slice(1).reduce((a, v, i) => a + (v - m) * (vals[i] - m), 0)
      expect(r.rho1!, r.name).toBeCloseTo(c1 / c0, 12)
    }
    // ❗F座 6/9 起掉到 0.65:前后两段各自平,隔天的偏差几乎同涨同落;别的栋只有噪声,隔天不相干
    const f = t.find(r => r.name === 'F座')!
    expect(f.rho1!).toBeGreaterThan(0.9)
    expect(Math.max(...ranked.filter(r => r.name !== 'F座').map(r => r.rho1!))).toBeLessThan(0.6)
    // 次数取观测值那一侧:999 次里最多 499;夹具里有几百次的,也有几十次的(不是常数)
    const ch = ranked.map(r => r.chance!)
    expect(Math.max(...ch)).toBeLessThanOrEqual(499)
    expect(Math.max(...ch) - Math.min(...ch)).toBeGreaterThan(200)
    // 不排的栋两列都不给
    expect(t.filter(r => r.unborn).every(r => r.rho1 == null && r.chance == null)).toBe(true)
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

describe('❗哪天起变了:跳过并网那个月再找(2026-10-06 改稿)', SLOW, () => {
  // 9栋 5 月才并网、5 月爬坡只发四成:不跳的话全年序列在 6 月 1 日有一个很显著的「水平变了」——那是并网,不是变化
  const keep = (i: number, m: number, d: number) => reads(i, m, d) && !(i === 6 && m < 5)
  const fac = (i: number, m: number, d: number) => (i === 6 && m === 5 ? 0.4 : factor(i, m, d))
  const rows = makeRows(Y, keep, fac, 3.4)
  const snap = buildSnapshot({ ...INPUT, rows })
  const nine = idOf('9栋')

  it('并网那个月(5 月)跳过再找:不显著了 → 核对表写「没找到」,抽屉第一块不画线、第二块拿全期估;对照:不跳的话 6 月初显著', () => {
    const d = buildDetail(snap, nine)!
    expect(d.dates[0]).toBe('2025-05-01')                 // 点照旧从并网那天画起:只有找变点这一步跳
    const raw = changePoint(d.resid, { block: 14, B: 999, seed: 20260831 })
    expect(raw.p).toBeLessThanOrEqual(CP_P_MAX)
    expect(d.dates[raw.index] >= '2025-05-25' && d.dates[raw.index] <= '2025-06-07').toBe(true)
    expect(d.cp == null || d.cp.p > CP_P_MAX).toBe(true)
    expect(driftChart(d, snap)!.cp).toBeNull()
    expect(controlChart(d, snap)!.wholePeriod).toBe(true)
    const lab = buildLab(snap, { ...INPUT, rows })
    expect(labTableRows(lab, snap).find(r => r.id === nine)).toMatchObject({ cpFrom: null, cpTo: null })
  })

  it('1 月 1 日就有读数的楼不跳:F座 6/9 起掉到 0.65 照样找得到,日子落在全年下标上', () => {
    const d = buildDetail(snap, idOf('F座'))!
    expect(d.cp!.p).toBeLessThanOrEqual(CP_P_MAX)
    expect(Math.abs(dayOfYear(d.cpDate!) - dayOfYear('2025-06-09'))).toBeLessThanOrEqual(10)
    expect(d.dates[d.cp!.index]).toBe(d.cpDate)
  })

  it('跳过之后找到的变点,下标换回全年序列(区间两头也是)', () => {
    // 9栋 5 月爬坡 + 7 月 10 日起再掉到六成:跳过 5 月以后仍找得到 7 月那次
    const fac2 = (i: number, m: number, d: number) => (i === 6 && (m > 7 || (m === 7 && d >= 10)) ? 0.6 : fac(i, m, d))
    const s2 = buildSnapshot({ ...INPUT, rows: makeRows(Y, keep, fac2, 3.4) })
    const d = buildDetail(s2, nine)!
    expect(d.cp!.p).toBeLessThanOrEqual(CP_P_MAX)
    expect(Math.abs(dayOfYear(d.cpDate!) - dayOfYear('2025-07-10'))).toBeLessThanOrEqual(7)
    expect(d.dates[d.cp!.index]).toBe(d.cpDate)
    expect(d.cpLo! <= d.cpDate! && d.cpDate! <= d.cpHi!).toBe(true)
    expect(d.cpLo! >= '2025-06-01').toBe(true)
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
