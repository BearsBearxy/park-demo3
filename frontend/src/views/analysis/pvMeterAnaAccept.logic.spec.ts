import { describe, expect, it } from 'vitest'
import {
  buildSnapshot, buildDetail, DEFAULT_CRITERIA,
  type AnaSnapshot, type ReadingRow, type SnapshotInput, type StationCfg,
} from './pvMeterAna.logic'

/**
 * 全刀验收(PV-ANALYSIS-SPEC §08)。这一份不测零件,测的是**整条链**:
 * 模拟器产出的数据 → 逐段看板 → 事实清单。
 *
 * ⚠ 夹具**照 `PvMeterService.simulateDays` 的结构复刻**,不是照它的数值:
 *   共享的全园天气因子 + 站内小扰动 + 种入 F 座 7/18 起 −28%,
 *   站间拆分权重 = 容量 × 故障月系数(= 逐日系数的月内均值)。
 *   Java 的 Random 是 48 位 LCG,逐位复刻要上 BigInt,不值 —— 验收要的是**统计结构**对不对。
 *   真模拟器那一侧由 `PvMeterSimulateApiIT` 锁死,两头合起来才是完整的链。
 *
 * §08 的两条对照都在这里:
 *   **阳性** —— 种进去的靶子必须亮。一个连自带阳性对照都不亮的检测屏,「没有命中」说明不了任何事。
 *   **阴性** —— 零故障的园区上,不许报出「出范围」的段。
 */

const pad = (n: number) => String(n).padStart(2, '0')
const YEAR = 2025
const FAULT_STATION = 'F座'
const FAULT_MONTH = 7
const FAULT_DAY = 18
const FAULT_FACTOR = 0.72

const faultDay = (name: string, m: number, d: number, on: boolean) =>
  on && name === FAULT_STATION && (m > FAULT_MONTH || (m === FAULT_MONTH && d > FAULT_DAY)) ? FAULT_FACTOR : 1

/** 月系数 = 逐日系数的**月内均值**。写成常数 0.72 的话 7 月前半月会被垫高 13%(§08) */
function faultMonth(name: string, m: number, on: boolean): number {
  const dim = new Date(YEAR, m, 0).getDate()
  let s = 0
  for (let d = 1; d <= dim; d++) s += faultDay(name, m, d, on)
  return s / dim
}

function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

const NAMES = ['B座', 'C、D座', 'E座', 'F座', 'G座', '8栋', '9栋', '10栋', '11栋', '12栋', '13栋']
const CAPS = [500, 780, 390, 390, 390, 340, 340, 340, 340, 340, 340]
const PHASE = [1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2]
const WATT = 500

interface Opts {
  fault?: boolean          // 默认种;false = 零故障园区(阴性对照)
  noPanel?: boolean
  noPanelOn?: string       // 只有这一栋没录板数
  badLedgerOn?: string
  jitterOn?: string        // 该栋 8 月逐日上下乱跳(散在两侧,不是断崖)
}

function simulate(o: Opts = {}, gran: 'month' | 'year' = 'month', month = 8): SnapshotInput {
  const on = o.fault !== false
  const stations: StationCfg[] = NAMES.map((name, i) => {
    const blank = o.noPanel || o.noPanelOn === name
    const theo = blank ? null : CAPS[i]
    return {
      id: i + 1, name, phase: PHASE[i], metered: true,
      capKwp: o.badLedgerOn === name && theo != null ? theo * 1.5 : CAPS[i],
      panelCount: blank ? null : Math.round((CAPS[i] * 1000) / WATT),
      panelWatt: blank ? null : WATT,
    }
  })
  const rows: ReadingRow[] = []

  for (let m = 1; m <= 12; m++) {
    const dim = new Date(YEAR, m, 0).getDate()
    const wgt = NAMES.map((name, i) => CAPS[i] * faultMonth(name, m, on))
    const wSum = wgt.reduce((a, b) => a + b, 0)
    const monthPark = 900_000

    // **全园共享**的天气序列:种子不含站 id
    const park = lcg(YEAR * 100 + m)
    const dayW: number[] = []
    for (let d = 1; d <= dim; d++) dayW.push(0.55 + park() * 0.9)

    stations.forEach((s, i) => {
      const site = lcg(s.id * 100000 + YEAR * 100 + m)
      const jit = lcg(s.id * 7 + m)
      const monthSelf = (monthPark * wgt[i]) / wSum
      const w: number[] = []
      for (let d = 1; d <= dim; d++) {
        const noisy = o.jitterOn === s.name && m === 8 ? 0.55 + jit() * 0.9 : 1
        w.push(dayW[d - 1] * (0.92 + site() * 0.16) * faultDay(s.name, m, d, on) * noisy)
      }
      const sum = w.reduce((a, b) => a + b, 0)
      for (let d = 1; d <= dim; d++) {
        const self = (monthSelf * w[d - 1]) / sum
        const grid = self * 0.42
        const gen = (self + grid) * 1.03
        rows.push({
          stationId: s.id, date: `${YEAR}-${pad(m)}-${pad(d)}`, gen,
          selfUse: self, gridFeed: grid, revenue: self * 0.8, priceSnap: 0.8,
        })
      }
    })
  }
  return { year: YEAR, gran, month, stations, rows, gridPrice: 0.391 }
}

const AUG = buildSnapshot(simulate())                       // 月段:2025-08
const YR = buildSnapshot(simulate({}, 'year'))              // 年段:2025 全年
const factsOf = (s: AnaSnapshot, name: string, kind?: string) =>
  s.facts.filter(f => f.station === name && (kind == null ? true : f.kind === kind))

describe('§08 期间与刻度 —— 月段只画当月', () => {
  it('月段的刻度是当月每一天,不是全年逐日', () => {
    expect(AUG.gran).toBe('month')
    expect(AUG.ym).toBe('2025-08')
    expect(AUG.ticks).toHaveLength(31)
    expect(AUG.ticks[0]).toBe('2025-08-01')
    expect(AUG.ticks[30]).toBe('2025-08-31')
    expect(AUG.tickLabels[0]).toBe('1')
  })
  it('年段的刻度是 12 个月', () => {
    expect(YR.ticks).toHaveLength(12)
    expect(YR.tickLabels[0]).toBe('1月')
  })
  it('**模型永远吃全年** —— 换段不改喂进去的数据量', () => {
    expect(AUG.quality.totalDays).toBe(365)
    expect(YR.quality.totalDays).toBe(365)
    for (const s of AUG.stations) expect(s.days, s.name).toBe(365)
  })
  it('账面量跟着刻度走:月段 31 个点,年段 12 个点', () => {
    expect(AUG.ledger.self).toHaveLength(31)
    expect(YR.ledger.self).toHaveLength(12)
  })
})

describe('§08 阳性对照 —— 种进去的靶子必须亮', () => {
  it('① F座 在 8 月的看板上整月落在正常范围下方', () => {
    const b = AUG.board.find(x => x.name === FAULT_STATION)!
    expect(b.lo, '范围估不出来').not.toBeNull()
    const below = b.out.filter(v => v === -1).length
    expect(below, `31 天里只有 ${below} 天在范围下方`).toBeGreaterThanOrEqual(25)
  })

  it('① 事实清单把它说成「连续 N 天在正常范围下方」—— 断崖,不是波动', () => {
    const f = factsOf(AUG, FAULT_STATION, 'run')
    expect(f.length, JSON.stringify(factsOf(AUG, FAULT_STATION))).toBe(1)
    expect(f[0].text).toMatch(/起连续 \d+ 天在正常范围下方/)
  })

  it('① 正常范围是拿**当月之外**的数据估的 —— 否则整月都坏的栋会把带撑到把自己包进去', () => {
    const b = AUG.board.find(x => x.name === FAULT_STATION)!
    expect(b.baseNote).toContain('当月之外')
    // 8 月的比值全部低于范围下沿
    const vals = b.ratio.filter((v): v is number => v != null)
    expect(Math.max(...vals)).toBeLessThan(b.lo!)
  })

  it('① 年段上 F座 也被说成连续几个月在范围下方', () => {
    const f = factsOf(YR, FAULT_STATION, 'run')
    expect(f.length).toBe(1)
    expect(f[0].text).toMatch(/起连续 \d+ 个月在正常范围下方/)
  })

  it('① 靶子亮的同时不能满屏都亮:其余各栋在 8 月不报「出范围」', () => {
    const others = AUG.facts.filter(f => (f.kind === 'run' || f.kind === 'scatter') && f.station !== FAULT_STATION)
    expect(others.map(f => `${f.station}:${f.text}`)).toEqual([])
  })

  it('① 变点仍落在 7/18 ±3 周(抽屉里的通道没坏)', () => {
    const s = AUG.stations.find(x => x.name === FAULT_STATION)!
    const d = buildDetail(AUG, s.id)!
    expect(d.cpDate).not.toBeNull()
    const off = Math.abs(new Date(d.cpDate!).getTime() - new Date(`${YEAR}-07-18`).getTime()) / 86400000
    expect(off, `变点 ${d.cpDate}`).toBeLessThanOrEqual(21)
  })
})

describe('§08 阴性对照 —— 零故障园区不报「出范围」', () => {
  const clean = buildSnapshot(simulate({ fault: false }))
  it('② 8 月一条 run / scatter 都没有', () => {
    expect(clean.facts.filter(f => f.kind === 'run' || f.kind === 'scatter').map(f => f.station)).toEqual([])
  })
  it('② 台账与理论一致时不报台账差', () => {
    expect(clean.facts.filter(f => f.kind === 'ledger').map(f => f.text)).toEqual([])
  })
})

describe('§08 断崖与波动要分开说 —— 用户要的就是这两种感觉', () => {
  const jit = buildSnapshot(simulate({ fault: false, jitterOn: '9栋' }))
  it('上下乱跳的栋报的是 scatter,不是 run', () => {
    const f = factsOf(jit, '9栋')
    expect(f.length, JSON.stringify(f)).toBeGreaterThan(0)
    expect(f.some(x => x.kind === 'scatter')).toBe(true)
    expect(f.every(x => x.kind !== 'run')).toBe(true)
    expect(f.find(x => x.kind === 'scatter')!.text).toContain('在正常范围之外')
  })
  it('断崖的栋报的是 run,不是 scatter', () => {
    expect(factsOf(AUG, FAULT_STATION, 'run').length).toBe(1)
    expect(factsOf(AUG, FAULT_STATION, 'scatter').length).toBe(0)
  })
})

describe('§08 判据线可改', () => {
  it('把范围放宽到 6 倍波动,F座 那条 run 消失', () => {
    const loose = buildSnapshot({ ...simulate(), crit: { bandSigma: 6 } })
    expect(factsOf(loose, FAULT_STATION, 'run')).toEqual([])
  })
  it('把「连续几天算一段」提到 40,断崖降级成散点描述', () => {
    const strict = buildSnapshot({ ...simulate(), crit: { bandRun: 40 } })
    expect(factsOf(strict, FAULT_STATION, 'run')).toEqual([])
  })
  it('快照上带着当前生效的线,屏拿它渲染,不另存一份', () => {
    expect(AUG.crit.bandSigma).toBe(DEFAULT_CRITERIA.bandSigma)
    expect(buildSnapshot({ ...simulate(), crit: { bandSigma: 3 } }).crit.bandSigma).toBe(3)
  })
})

describe('§08 台账差是纯算术 —— 不依赖任何统计,也不依赖期间', () => {
  it('台账改成理论的 1.5 倍,两个数都写在事实行上', () => {
    const bad = buildSnapshot(simulate({ badLedgerOn: 'E座' }))
    const f = factsOf(bad, 'E座', 'ledger')
    expect(f.length).toBe(1)
    expect(f[0].text).toContain('585.0')      // 390 × 1.5
    expect(f[0].text).toContain('390.0')
  })
  // 「板数未录」对全园都成立时**不逐栋重复** —— 实测:13 栋各报一遍同一句话,
  // 把真信号全淹了,而 T1 的脚注与横幅已经各说过一次
  it('全园都没录板数 → 不逐栋刷屏', () => {
    const np = buildSnapshot(simulate({ noPanel: true }))
    expect(np.facts.filter(f => f.kind === 'ledger')).toEqual([])
  })
  it('只有个别栋没录 → 那几栋要报,因为这时它是逐栋缺口不是项目状态', () => {
    const one = buildSnapshot(simulate({ noPanelOn: 'E座' }))
    const f = one.facts.filter(x => x.kind === 'ledger')
    expect(f.map(x => x.station)).toEqual(['E座'])
    expect(f[0].text).toContain('未录')
  })
})

describe('§08 绝对通道降级 —— 板数没录时看板完全不受影响', () => {
  const np = buildSnapshot(simulate({ noPanel: true }))
  it('看板与有板数时逐点一致 —— 它根本不用装机容量', () => {
    const a = AUG.board.find(x => x.name === FAULT_STATION)!
    const b = np.board.find(x => x.name === FAULT_STATION)!
    expect(b.ratio).toEqual(a.ratio)
    expect(b.lo).toEqual(a.lo)
  })
  it('分母退回台账装机,年等效小时照常算得出来', () => {
    for (const s of np.stations) {
      expect(s.yieldDenom, s.name).toBe('ledger')
      expect(s.yieldHours, s.name).not.toBeNull()
    }
  })
})

describe('§08 确定性', () => {
  it('同一份数据两次算,id 相同', () => {
    expect(buildSnapshot(simulate()).id).toBe(AUG.id)
  })
  it('换了期间就是另一次计算,id 不同', () => {
    expect(YR.id).not.toBe(AUG.id)
    expect(buildSnapshot(simulate({}, 'month', 9)).id).not.toBe(AUG.id)
  })
})
