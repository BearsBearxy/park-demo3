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
