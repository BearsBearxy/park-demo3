import { describe, it, expect } from 'vitest'
import { bandSeries } from '../anaTheme'

describe('bandSeries —— 全站唯一一份带子', () => {
  it('返回两条:下沿哨兵 + 上沿宽度,宽度 = hi − lo', () => {
    const s = bandSeries([1, 2], [4, 6]) as Array<Record<string, unknown>>
    expect(s).toHaveLength(2)
    expect(s[0].data).toEqual([1, 2])
    expect(s[1].data).toEqual([3, 4])
  })

  it('❗任一端为 null 则该点整体 null —— 五处旧写法有四种 null 判法,收编后只许一种', () => {
    const s = bandSeries([1, null, 3], [4, 8, null]) as Array<Record<string, unknown>>
    expect(s[1].data).toEqual([3, null, null])
    expect(s[0].data).toEqual([1, null, null])
  })

  it('下沿哨兵不进图例、不吃 tooltip', () => {
    const s = bandSeries([1], [2]) as Array<Record<string, unknown>>
    expect(s[0].name).toBe('')
    expect(s[0].tooltip).toEqual({ show: false })
    expect(s[0].silent).toBe(true)
    expect((s[0].lineStyle as Record<string, unknown>).opacity).toBe(0)
  })

  it('❗上沿宽度线也不吃 tooltip —— 它扛的是宽度(hi−lo)不是上沿,标签写着 P25~P75/均值±σ带,漏进 tooltip 就是读数句说谎', () => {
    const s = bandSeries([1], [2]) as Array<Record<string, unknown>>
    expect(s[0].tooltip).toEqual({ show: false })
    expect(s[1].tooltip).toEqual({ show: false })
  })

  it('dp 控制小数位:PV 三处要 3~4 位,金额两处要 0 位', () => {
    const s = bandSeries([1.23456], [2.34567], { dp: 3 }) as Array<Record<string, unknown>>
    expect(s[1].data).toEqual([1.111])
  })

  it('stack 键可换 —— 同屏三条带并存时必须互不串台(PvMeterAnaView 的 band/q/se)', () => {
    const s = bandSeries([1], [2], { stack: 'se' }) as Array<Record<string, unknown>>
    expect(s[0].stack).toBe('se')
    expect(s[1].stack).toBe('se')
  })

  it('series 附加项透传 —— B3 要展开它自己的 const L', () => {
    const s = bandSeries([1], [2], { series: { smooth: true } }) as Array<Record<string, unknown>>
    expect(s[0].smooth).toBe(true)
    expect(s[1].smooth).toBe(true)
  })
})

describe('❗C2:横截面对标带必须画得出来 —— 用实测量级的真实分布喂进去', () => {
  // 这里的数字全部来自 park_demo3(2026-09-11 实测,SQL 见 task-8-report.md),
  // 不是为了卡在某个阈值两侧捏出来的两元素数组 —— C2 能活下来,正是因为这个文件里
  // 从头到尾只有 [75]~[125] 这类为阈值量身定做的样例,没有一条断言见过真实数据长什么样。
  //
  // AnomalyView:同类电费 P25~P75(monitor.logic buildMonitorModel,n≥20 才建 key)
  const P25 = [251.57, 292.33, 408.60, 521.54, 602.08, 516.14, 329.67]
  const P75 = [2538.24, 2866.91, 3327.56, 3681.64, 5099.61, 3945.46, 3178.05]
  // TenantEnergyView:跨户均值±一个波动幅度(buildParkBand,lo=max(0, mean−σ))
  const LO = [0, 0, 0, 0, 0, 0, 0]
  const HI = [23016, 24216, 24038, 23839, 26705, 21990, 19449]

  const halfOverCenter = (lo: number[], hi: number[]): number[] =>
    lo.map((l, i) => (hi[i] - l) / 2 / ((hi[i] + l) / 2))

  it('实测比值:同类 P25~P75 逐月 0.75~0.82、跨户均值带逐月恒为 1.000 —— 任何 20% 量级的带宽门都是「一个月都不画」', () => {
    for (const r of halfOverCenter(P25, P75)) {
      expect(r).toBeGreaterThan(0.70)
      expect(r).toBeLessThan(0.85)
    }
    for (const r of halfOverCenter(LO, HI)) expect(r).toBe(1)
  })

  it('❗真实量级喂进去,两条带都出得来 —— bandSeries 不自己判宽窄,宽是结论不是毛病', () => {
    const a = bandSeries(P25, P75, { name: '园区P25~P75' }) as Array<Record<string, unknown>>
    expect(a).toHaveLength(2)
    expect((a[1].data as (number | null)[]).every((v) => v != null && v > 0)).toBe(true)
    const b = bandSeries(LO, HI, { name: '跨户波动范围带' }) as Array<Record<string, unknown>>
    expect(b).toHaveLength(2)
    expect((b[1].data as (number | null)[]).every((v) => v != null && v > 0)).toBe(true)
  })
})

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

it('❗全仓 lineStyle:{opacity:0} 只许出现在 anaTheme.ts —— 没这条,下一处带照旧手写', () => {
  const dir = join(__dirname, '../../../views/analysis')
  const hits: string[] = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.vue') && !f.endsWith('.ts')) continue
    const s = readFileSync(join(dir, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    if (/lineStyle:\s*\{\s*opacity:\s*0\s*\}/.test(s)) hits.push(f)
  }
  expect(hits, `这些文件还在手写带子,改用 bandSeries(): ${hits.join(', ')}`).toEqual([])
})

/**
 * ❗C2 的门禁:分析层的 bandSeries 调用一律不许挂条件。
 *
 * 这条比「给 bandTooWide 补个用例」管用一个量级:C2 那道门本身算得对,出事的是**把它套在
 * 横截面带上**。一条针对函数本身的断言,不管怎么写都照样全绿。真正能当场变红的判据是
 * 「这张图上的带还在不在」—— 而带在不在,由调用点有没有挂条件决定。
 *
 * 分析层今天六处 bandSeries 调用全部无条件(合约租金带 / 同类 P25~P75 / 跨户均值带 / PV 三处)。
 * 计划 §5 禁做清单把所有该配宽度门的时序外推带都禁掉了,所以「无条件」不是巧合,是当下的完整规矩。
 * 将来真要给某条带加条件,先把 anaTheme.ts 里 bandTooWide 那段墓志铭读完,再来改这条门禁。
 */
it('❗分析层的 bandSeries 调用不许挂条件 —— 横截面带被一道宽度门按住是 C2 的原样重演', () => {
  const dir = join(__dirname, '../../../views/analysis')
  const bad: string[] = []
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.vue') && !f.endsWith('.ts')) continue
    if (f.endsWith('.spec.ts')) continue
    const src = readFileSync(join(dir, f), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    src.split('\n').forEach((ln, i) => {
      const at = ln.indexOf('bandSeries(')
      if (at < 0) return
      const before = ln.slice(0, at)
      if (/[?&|]/.test(before)) bad.push(`${f}:${i + 1} ${ln.trim().slice(0, 80)}`)
    })
  }
  expect(bad, `这些 bandSeries 调用挂了条件,带可能一个点都画不出来: ${bad.join(' | ')}`).toEqual([])
})
