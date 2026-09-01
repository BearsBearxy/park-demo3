import { describe, expect, it } from 'vitest'
import {
  buildSnapshot,
  type ReadingRow, type SnapshotInput, type StationCfg,
} from './pvMeterAna.logic'

/**
 * 全刀验收(PV-ANALYSIS-SPEC §08)。这一份不测零件,测的是**整条链**:
 * 模拟器产出的数据 → 抛光 → 变点 → 三重门槛 → 屏上的判词。
 *
 * ⚠ 这里的夹具**照 `PvMeterService.simulateDays` 的结构复刻**,不是照它的数值:
 *   共享的全园天气因子 + 站内小扰动 + 种入 F 座 7/18 起 −28%,
 *   站间拆分权重 = 容量 × 故障月系数(= 逐日系数的月内均值)。
 *   Java 的 `Random` 是 48 位 LCG,逐位复刻要上 BigInt,不值 —— 验收要的是**统计结构**对不对,
 *   不是两边随机数一样。真模拟器的那一侧由 `PvMeterSimulateApiIT` 的三条断言锁死
 *   (共享天气因子 / 故障持续可见 / 当月内有阶跃),两头合起来才是完整的链。
 */

const pad = (n: number) => String(n).padStart(2, '0')
const YEAR = 2025
const FAULT_STATION = 'F座'
const FAULT_MONTH = 7
const FAULT_DAY = 18
const FAULT_FACTOR = 0.72

/** 与后端同名同义:F 座 7/18 之后 0.72,其余 1.0 */
const faultDay = (name: string, m: number, d: number) =>
  name === FAULT_STATION && (m > FAULT_MONTH || (m === FAULT_MONTH && d > FAULT_DAY)) ? FAULT_FACTOR : 1

/** 月系数 = 逐日系数的**月内均值**。写成常数 0.72 的话 7 月前半月会被垫高 13%(§08) */
function faultMonth(name: string, m: number): number {
  const dim = new Date(YEAR, m, 0).getDate()
  let s = 0
  for (let d = 1; d <= dim; d++) s += faultDay(name, m, d)
  return s / dim
}

function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 }
}

const NAMES = ['B座', 'C、D座', 'E座', 'F座', 'G座', '8栋', '9栋', '10栋', '11栋', '12栋', '13栋']
const CAPS = [500, 780, 390, 390, 390, 340, 340, 340, 340, 340, 340]

/** 复刻 simulateDays 的产出结构 */
function simulate(opts: { dropStation?: string; dropMonth?: number; dropDays?: number } = {}) {
  const stations: StationCfg[] = NAMES.map((name, i) => ({
    id: i + 1, name, capKwp: CAPS[i], metered: true,
  }))
  const rows: ReadingRow[] = []

  for (let m = 1; m <= 12; m++) {
    const dim = new Date(YEAR, m, 0).getDate()
    // 站间拆分:权重 = 容量 × 故障月系数(故障那份由同期其余站分掉,Σ 不变)
    const wgt = stations.map(s => (s.capKwp ?? 0) * faultMonth(s.name, m))
    const wSum = wgt.reduce((a, b) => a + b, 0)
    const monthPark = 900_000                       // phase 月量(度),对本验收只要恒定即可

    // **全园共享**的天气序列:种子不含站 id
    const park = lcg(YEAR * 100 + m)
    const dayW: number[] = []
    for (let d = 1; d <= dim; d++) dayW.push(0.55 + park() * 0.9)

    for (let d = 1; d <= dim; d++) {
      const date = `${YEAR}-${pad(m)}-${pad(d)}`
    }

    stations.forEach((s, i) => {
      const site = lcg(s.id * 100000 + YEAR * 100 + m)
      const monthSelf = (monthPark * wgt[i]) / wSum
      const w: number[] = []
      for (let d = 1; d <= dim; d++) {
        w.push(dayW[d - 1] * (0.92 + site() * 0.16) * faultDay(s.name, m, d))
      }
      const sum = w.reduce((a, b) => a + b, 0)
      for (let d = 1; d <= dim; d++) {
        if (opts.dropStation === s.name && opts.dropMonth === m && d <= (opts.dropDays ?? 0)) continue
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
  return { year: YEAR, stations, rows, gridPrice: 0.391 } satisfies SnapshotInput
}

const INPUT = simulate()
const SNAP = buildSnapshot(INPUT)

describe('§08 验收', () => {
  // ① 种入故障能被检出。变点日期落在种入日 **±3 周**内即算通过 ——
  //    不是 ±3 天,argmax 有赢家诅咒,区间本来就有那么宽
  it('① F座 的 −28% 阶跃判为 risk,变点落在 7/18 ±3 周', () => {
    const f = SNAP.stations.find(s => s.name === FAULT_STATION)!
    expect(f.status, `F座 实得 ${f.status}`).toBe('risk')
    expect(f.detail!.cpDate).not.toBeNull()
    const cp = new Date(f.detail!.cpDate!).getTime()
    const seeded = new Date(`${YEAR}-07-18`).getTime()
    expect(Math.abs(cp - seeded) / 86400000, `变点 ${f.detail!.cpDate}`).toBeLessThanOrEqual(21)
  })

  it('① 建议派的是现场检查(阶跃 = 设备级故障)', () => {
    const f = SNAP.stations.find(s => s.name === FAULT_STATION)!
    expect(f.shape).toBe('step')
    expect(f.advice).toBe('现场检查')
    expect(f.situation).toContain('7 月')
  })

  // ② 健康站不误报。全年误报总数 ≤ 1
  it('② 其余站一个 risk 都不出', () => {
    const falses = SNAP.stations.filter(s => s.name !== FAULT_STATION && s.status === 'risk')
    expect(falses.map(s => s.name)).toEqual([])
  })

  it('② 全年误报(含黄灯)总数 ≤ 1', () => {
    const noisy = SNAP.stations.filter(s =>
      s.name !== FAULT_STATION && (s.status === 'risk' || s.status === 'watch'))
    expect(noisy.map(s => `${s.name}:${s.status}`).length).toBeLessThanOrEqual(1)
  })

  // ④ 共享天气因子到底生效没有。
  //
  // ⚠ 规格原文是「ρ₁ 非零,否则说明模拟器的共享天气因子没生效」—— **这条对着模拟数据不成立**,
  //   而且方向反了:共享天气因子**生效**时,β 恰好把它整个吸走,剩下的残差就是站内那份
  //   逐日独立的小扰动,ρ₁ 本来就该 ≈0。ρ≈0.3–0.6 是**真实**残差的性质(§5.3),
  //   来自积灰、气象模型误差这些真实世界的慢过程,模拟器里没有它们。
  //   拿它当验收项会逼人去把模拟器改成「造出自相关」,那是为了过验收而造假数据。
  //
  //   真正要验的是**共享天气因子到底生效没有**,直接量:
  //   β 的方差应当**远大于**残差方差 —— 天气那份被 β 拿走了。
  //   种子若含站 id(改造前),各站各晒各的太阳,β 是一堆独立序列的中位数、趋近常数,
  //   天气就留在残差里,两者方差会拉平。
  it('④ 共享天气因子确实生效:β 的方差远大于残差方差', () => {
    const v = (xs: number[]) => {
      const m = xs.reduce((a, b) => a + b, 0) / xs.length
      return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length
    }
    const beta = v([...SNAP.polish.beta.values()])
    const resid = v([...SNAP.polish.resid.values()].flatMap(m => [...m.values()]))
    expect(beta / resid, `β 方差 ${beta.toFixed(5)} / 残差方差 ${resid.toFixed(5)}`)
      .toBeGreaterThan(5)
  })

  // ⑤ 两层数字一致:第一层缺口 = 逐站缺口求和,**分毫不差**;snapshot id 相同
  it('⑤ 第一层缺口 = 逐站求和,分毫不差', () => {
    const sum = SNAP.stations.reduce((a, r) => a + r.gapMoney, 0)
    expect(SNAP.park.gap).toBeCloseTo(sum, 9)
    expect(SNAP.park.gap).toBeGreaterThan(0)
  })

  it('⑤ 同一份数据两次算,id 与缺口都一样(确定性)', () => {
    const again = buildSnapshot(simulate())
    expect(again.id).toBe(SNAP.id)
    expect(again.park.gap).toBeCloseTo(SNAP.park.gap, 9)
  })

  // ⑥ 护栏可见:人为删掉某站某月 11 天抄表 → 灰灯,不是绿灯
  it('⑥ 删掉某站某月 11 天 → 该站灰灯不是绿灯', () => {
    const s = buildSnapshot(simulate({ dropStation: '9栋', dropMonth: 12, dropDays: 11 }))
    const r = s.stations.find(x => x.name === '9栋')!
    expect(r.status).toBe('mute')
    expect(r.statusLabel).toBe('数据不全')
    expect(r.statusLabel).not.toBe('正常')
    expect(r.situation).toContain('只抄了')
  })

  it('⑥ 没删的站不受牵连', () => {
    const s = buildSnapshot(simulate({ dropStation: '9栋', dropMonth: 12, dropDays: 11 }))
    expect(s.stations.find(x => x.name === '8栋')!.status).not.toBe('mute')
  })
})
