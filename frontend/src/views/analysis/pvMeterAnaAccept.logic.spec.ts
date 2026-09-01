import { describe, expect, it } from 'vitest'
import {
  buildSnapshot, buildDetail, DEFAULT_CRITERIA,
  type ReadingRow, type SnapshotInput, type StationCfg,
} from './pvMeterAna.logic'

/**
 * 全刀验收(PV-ANALYSIS-SPEC §08)。这一份不测零件,测的是**整条链**:
 * 模拟器产出的数据 → 抛光 → 变点 → BH 闸门 → 命中清单。
 *
 * ⚠ 这里的夹具**照 `PvMeterService.simulateDays` 的结构复刻**,不是照它的数值:
 *   共享的全园天气因子 + 站内小扰动 + 种入 F 座 7/18 起 −28%,
 *   站间拆分权重 = 容量 × 故障月系数(= 逐日系数的月内均值)。
 *   Java 的 `Random` 是 48 位 LCG,逐位复刻要上 BigInt,不值 —— 验收要的是**统计结构**对不对,
 *   不是两边随机数一样。真模拟器那一侧由 `PvMeterSimulateApiIT` 锁死,两头合起来才是完整的链。
 *
 * §08 的两条对照都在这里:
 *   **阳性** —— 种进去的靶子必须亮。一个连自带阳性对照都不亮的检测屏,「命中数为 0」说明不了任何事。
 *   **阴性** —— 零故障的园区上,命中数必须为 0。
 */

const pad = (n: number) => String(n).padStart(2, '0')
const YEAR = 2025
const FAULT_STATION = 'F座'
const FAULT_MONTH = 7
const FAULT_DAY = 18
const FAULT_FACTOR = 0.72

/** 与后端同名同义:F 座 7/18 之后 0.72,其余 1.0 */
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
  fault?: boolean                 // 默认种;false = 零故障园区(阴性对照)
  noPanel?: boolean               // 板数与单块功率都不录 —— 绝对通道降级
  badLedgerOn?: string            // 该栋台账容量改成理论的 1.5 倍
}

/** 复刻 simulateDays 的产出结构 */
function simulate(o: Opts = {}): SnapshotInput {
  const on = o.fault !== false
  const stations: StationCfg[] = NAMES.map((name, i) => {
    const theo = o.noPanel ? null : CAPS[i]
    return {
      id: i + 1, name, phase: PHASE[i], metered: true,
      capKwp: o.badLedgerOn === name && theo != null ? theo * 1.5 : CAPS[i],
      panelCount: o.noPanel ? null : Math.round((CAPS[i] * 1000) / WATT),
      panelWatt: o.noPanel ? null : WATT,
    }
  })
  const rows: ReadingRow[] = []

  for (let m = 1; m <= 12; m++) {
    const dim = new Date(YEAR, m, 0).getDate()
    // 站间拆分:权重 = 容量 × 故障月系数(故障那份由同期其余站分掉,Σ 不变)
    const wgt = NAMES.map((name, i) => CAPS[i] * faultMonth(name, m, on))
    const wSum = wgt.reduce((a, b) => a + b, 0)
    const monthPark = 900_000                       // phase 月量(度),对本验收只要恒定即可

    // **全园共享**的天气序列:种子不含站 id
    const park = lcg(YEAR * 100 + m)
    const dayW: number[] = []
    for (let d = 1; d <= dim; d++) dayW.push(0.55 + park() * 0.9)

    stations.forEach((s, i) => {
      const site = lcg(s.id * 100000 + YEAR * 100 + m)
      const monthSelf = (monthPark * wgt[i]) / wSum
      const w: number[] = []
      for (let d = 1; d <= dim; d++) w.push(dayW[d - 1] * (0.92 + site() * 0.16) * faultDay(s.name, m, d, on))
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
  return { year: YEAR, stations, rows, gridPrice: 0.391 }
}

const SNAP = buildSnapshot(simulate())
const hitsOf = (snap: ReturnType<typeof buildSnapshot>, name: string, k?: string) =>
  snap.hits.filter(h => h.station === name && h.readable && (k == null || h.criterion === k))

describe('§08 阳性对照 —— 种进去的靶子必须亮', () => {
  // 站间拆分权重吃月系数,F 座少拿的那份由同期其余四栋分掉:
  // 8 月 F 权重 0.15×0.72=0.108、五站权重和 0.958 → 实得 0.1127 / 应得 0.15 ≈ −25%
  it('① F座 在月偏离这条上有命中', () => {
    const h = hitsOf(SNAP, FAULT_STATION, 'resid')
    expect(h.length, `F座 的命中:${JSON.stringify(SNAP.hits.filter(x => x.station === FAULT_STATION))}`).toBe(1)
    expect(h[0].value).toMatch(/−\d+%/)
    expect(h[0].line).toContain('q<0.05')
  })

  it('① F座 故障满月的各月偏离都是负的,量级在 −15% ~ −40%', () => {
    const f = SNAP.stations.find(s => s.name === FAULT_STATION)!
    const dev = SNAP.grid.deviation.get(f.id)!
    for (const c of [7, 8, 9, 10, 11]) {          // 8–12 月
      expect(dev[c], `${SNAP.months[c]}`).not.toBeNull()
      expect(dev[c]!, `${SNAP.months[c]} = ${dev[c]}`).toBeLessThan(-0.15)
      expect(dev[c]!, `${SNAP.months[c]} = ${dev[c]}`).toBeGreaterThan(-0.40)
    }
  })

  // 变点日期落在种入日 **±3 周**内即算通过 —— 不是 ±3 天,argmax 有赢家诅咒,区间本来就那么宽
  it('① 变点落在 7/18 ±3 周', () => {
    const f = SNAP.stations.find(s => s.name === FAULT_STATION)!
    const d = buildDetail(SNAP, f.id)!
    expect(d.cpDate, '未扫出变点').not.toBeNull()
    const off = Math.abs(new Date(d.cpDate!).getTime() - new Date(`${YEAR}-07-18`).getTime()) / 86400000
    expect(off, `变点 ${d.cpDate}`).toBeLessThanOrEqual(21)
  })

  it('① 靶子亮的同时不能满屏都亮:其余各栋在月偏离上不命中', () => {
    const others = SNAP.hits.filter(h => h.criterion === 'resid' && h.readable && h.station !== FAULT_STATION)
    expect(others.map(h => h.station)).toEqual([])
  })
})

describe('§08 阴性对照 —— 零故障园区命中数为 0', () => {
  const clean = buildSnapshot(simulate({ fault: false }))
  it('② 零故障合成园区上,月偏离一条都不命中', () => {
    expect(clean.hits.filter(h => h.criterion === 'resid' && h.readable).map(h => h.station)).toEqual([])
  })
  it('② 台账与理论一致时,台账差一条都不命中', () => {
    expect(clean.hits.filter(h => h.criterion === 'ledger' && h.readable)).toEqual([])
  })
})

describe('§08 零剔除', () => {
  it('④ 进模型的是全部 365 天,不是被筛过的子集', () => {
    expect(SNAP.quality.totalDays).toBe(365)
    expect(SNAP.quality.okDays).toBe(365)
    expect(SNAP.quality.droppedThin).toBe(0)
  })
  it('④ 每栋的在网天数都是 365 —— 没有任何按发电量或天气的日过滤', () => {
    for (const s of SNAP.stations) expect(s.days, s.name).toBe(365)
  })
})

describe('§08 判据线可改', () => {
  // 参数中心改了,这张清单必须跟着变 —— 否则「线画在屏上、你能反对」是句空话
  it('⑤ 把月偏离线放宽到 ±50%,F座 那条命中消失', () => {
    const loose = buildSnapshot({ ...simulate(), crit: { resid: 0.5 } })
    expect(hitsOf(loose, FAULT_STATION, 'resid')).toEqual([])
  })
  it('⑤ 把台账差线收到 ±0.1%,原本不命中的栋开始命中', () => {
    const tight = buildSnapshot({ ...simulate({ badLedgerOn: 'E座' }), crit: { ledger: 0.001 } })
    expect(tight.hits.filter(h => h.criterion === 'ledger' && h.readable).length).toBeGreaterThan(0)
  })
  it('⑤ 快照上带着当前生效的判据线,屏拿它渲染,不另存一份', () => {
    expect(SNAP.crit.resid).toBe(DEFAULT_CRITERIA.resid)
    expect(buildSnapshot({ ...simulate(), crit: { resid: 0.33 } }).crit.resid).toBe(0.33)
  })
})

describe('§08 绝对通道降级 —— 板数没录时其余块不受影响', () => {
  const noPanel = buildSnapshot(simulate({ noPanel: true }))
  it('⑦ 未录板数的栋进 noPanel 名单,理论装机为空', () => {
    expect(noPanel.quality.noPanel.length).toBe(NAMES.length)
    expect(noPanel.stations.every(s => s.theoKwp === null)).toBe(true)
  })
  it('⑦ 分母退回台账装机,年等效小时照常算得出来', () => {
    for (const s of noPanel.stations) {
      expect(s.yieldDenom, s.name).toBe('ledger')
      expect(s.yieldHours, s.name).not.toBeNull()
    }
  })
  it('⑦ 相对通道完全不受影响:网格与月偏离命中与有板数时一致', () => {
    const f = NAMES.indexOf(FAULT_STATION) + 1
    expect(noPanel.grid.deviation.get(f)).toEqual(SNAP.grid.deviation.get(f))
    expect(hitsOf(noPanel, FAULT_STATION, 'resid').length).toBe(1)
  })
  it('⑦ 台账差那条降为「读不出」—— 既不是命中也不是未命中', () => {
    const h = noPanel.hits.filter(x => x.station === 'B座' && x.criterion === 'ledger')
    expect(h.length).toBe(1)
    expect(h[0].readable).toBe(false)
    expect(h[0].line).toContain('读不出')
  })
})

describe('§08 台账差是纯算术 —— 不依赖任何统计', () => {
  it('把某栋台账改成理论的 1.5 倍,台账差立刻命中且值可复算', () => {
    const bad = buildSnapshot(simulate({ badLedgerOn: 'E座' }))
    const h = bad.hits.filter(x => x.station === 'E座' && x.criterion === 'ledger')
    expect(h.length).toBe(1)
    expect(h[0].readable).toBe(true)
    expect(h[0].value).toContain('+50%')
    expect(h[0].line).toBe('判据线 ±3%')
  })
})

describe('§08 确定性', () => {
  it('同一份数据两次算,id 相同', () => {
    expect(buildSnapshot(simulate()).id).toBe(SNAP.id)
  })
  it('判据线不同 → id 不同(屏上写的线变了,快照就不是同一次计算)', () => {
    expect(buildSnapshot({ ...simulate(), crit: { resid: 0.2 } }).id).not.toBe(SNAP.id)
  })
})
