import { describe, it, expect } from 'vitest'
import { bandSeries, bandTooWide } from '../anaTheme'

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

describe('bandTooWide —— 带宽门(半宽/中位 > 0.20 判太宽,只出点不画带)', () => {
  it('半宽/中位 = 0.25(>0.20)→ true', () => {
    expect(bandTooWide([75], [125])).toBe(true)   // 半宽25/中位100=0.25
  })

  it('半宽/中位 = 0.15(≤0.20)→ false', () => {
    expect(bandTooWide([85], [115])).toBe(false)  // 半宽15/中位100=0.15
  })

  it('半宽/中位 = 0.20 整(边界,不超过 → false;门槛是「超过」不是「达到」)', () => {
    expect(bandTooWide([80], [120])).toBe(false)  // 半宽20/中位100=0.20
  })

  it('❗bandSeries 第一条断言 [1,2]~[4,6] 半宽/中位约 0.54,若把此门写进 bandSeries 入口会把那条断言判红 —— 这正是本函数独立于 bandSeries 之外的原因', () => {
    expect(bandTooWide([1, 2], [4, 6])).toBe(true)
    // 佐证:bandSeries 本身不受影响,仍出两条
    const s = bandSeries([1, 2], [4, 6]) as Array<Record<string, unknown>>
    expect(s).toHaveLength(2)
  })

  it('null 点跳过,只算非 null 的点 —— 多数点 null 时,若误把 null 当 0 参与计算,中位数会被拖成 0 反而判不宽', () => {
    // 3 null + 1 真点(75~125,半宽25/中心100=0.25);null 若被当 0 混进两个中位数,
    // 两串各 4 个数里 3 个是 0,中位数双双落 0 → mid=0 触发另一条门槛(mid===0)错判 false。
    expect(bandTooWide([null, null, null, 75], [null, null, null, 125])).toBe(true)
  })

  it('全 null → 无点可判,不算太宽(false)', () => {
    expect(bandTooWide([null], [null])).toBe(false)
  })

  it('❗中心=0 但半宽非零(带跨零轴)→ 不判太宽(避免除以 0 把 Infinity 当「宽」)', () => {
    // 半宽10/中心0:没有这道门槛会算成 10/0=Infinity>0.2 → true,错把「除不了」当「很宽」
    expect(bandTooWide([-10], [10])).toBe(false)
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
