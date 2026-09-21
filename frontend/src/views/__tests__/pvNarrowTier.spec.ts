/**
 * 自绘 SVG 图的「窄容器档」门禁（2026-09-20 立）。
 *
 * 这批图不按视口分档，按**容器宽**分档 —— 因为同一张图既出现在手机上，也出现在桌面
 * `.av2-s4` 那种只有三百多像素的窄栏里，视口判据在后一种场合失效。
 *
 * 代价是：桌面上某些槽位的容器本来就窄，会**在 1440 上落进窄档**，
 * 撞 `RESPONSIVE-LAYOUT-SPEC` §9 的第一条「1440 与现状零差异」。
 * 这一轮就踩到过：`PvAcfBars` / `PvNullHist` 住在 `.av2-s4`，桌面容器实测 312px，
 * 加了 `narrow` 之后 1440 上的几何当场变了，而当时没有任何断言看着。
 * 处置是**这两张不改**（窄屏收益只有「高 138→130 + 标签隔标」，不值一条零差异例外）。
 *
 * 所以门禁钉的是这条：**凡是有窄档分支的自绘图，它在桌面上的容器宽必须 ≥ 阈值**。
 * 判据取自组件自己的 `useWidth(init)` —— 那个初值就是当初在桌面上实测的容器宽
 * （`PvAcfBars(312)` 正是 `.av2-s4` 的实测值，`PvDayChart(1025)` 是整幅内容宽）。
 * jsdom 里没有 ResizeObserver，宽度也正是停在这个初值上（见 `components/ana/useWidth.ts`），
 * 所以这个数同时是单测口径下的实际宽度，一石二鸟。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ANA = join(__dirname, '..', 'analysis')

/** 窄档阈值。改它要同时改全部 12 个组件，所以钉死在这里对一遍。 */
const NARROW_MAX = 420

type Comp = { file: string; init: number; hasNarrow: boolean; src: string }

function comps(): Comp[] {
  const out: Comp[] = []
  for (const file of readdirSync(ANA).filter((f) => f.startsWith('Pv') && f.endsWith('.vue'))) {
    const src = readFileSync(join(ANA, file), 'utf8').replace(/\r\n/g, '\n')
    const m = /useWidth\((\d+)\)/.exec(src)
    if (!m) continue
    out.push({ file, init: Number(m[1]), hasNarrow: /const narrow = computed/.test(src), src })
  }
  return out
}

describe('自绘图的窄容器档', () => {
  it('❗有窄档分支的图，桌面容器宽必须 ≥ 阈值 —— 否则 1440 上的几何会当场变', () => {
    const bad = comps()
      .filter((c) => c.hasNarrow && c.init < NARROW_MAX)
      .map((c) => `${c.file}: useWidth(${c.init}) < ${NARROW_MAX}`)
    expect(
      bad,
      '这些图在桌面上的容器就窄于阈值，加了窄档分支等于改了桌面渲染（撞 RESPONSIVE-LAYOUT-SPEC §9「1440 与现状零差异」）。\n' +
        '要么这张图不加窄档分支，要么先把零差异例外写进规范并在计划里留下授权。\n  ' +
        bad.join('\n  '),
    ).toEqual([])
  })

  it('❗阈值只有一个值，12 个组件写的是同一个数', () => {
    const withNarrow = comps().filter((c) => c.hasNarrow)
    // 12 个自绘图 + PvMeterAnaView 自己 —— 它的首进骨架也要按同一个容器宽判档，
    // 否则骨架与图会在视口 488–600 那一段分叉（2026-09-20 对抗复查实测：B7 差 42、B8 差 39）。
    expect(withNarrow.length, '12 个自绘图 + PvMeterAnaView 的骨架').toBe(13)
    for (const c of withNarrow) {
      expect(
        c.src,
        `${c.file} 的窄档阈值不是 ${NARROW_MAX} —— 各写各的，以后就没人知道哪张图在哪一档`,
      ).toMatch(new RegExp(`const narrow = computed\\(\\(\\) => \\w+\\.value < ${NARROW_MAX}\\)`))
    }
  })

  it('❗窄档不许靠缩字号或整幅缩放塞下去（用户 2026-09-20 拍板）', () => {
    const bad: string[] = []
    for (const c of comps().filter((x) => x.hasNarrow)) {
      // 整幅缩放：viewBox 宽与渲染宽脱钩，或直接上 transform: scale
      if (/preserveAspectRatio/.test(c.src)) bad.push(`${c.file}: 出现 preserveAspectRatio`)
      if (/transform:\s*scale|scale\(/.test(c.src)) bad.push(`${c.file}: 出现 scale()`)
      if (/width="100%"[^>]*viewBox/.test(c.src)) bad.push(`${c.file}: svg 宽脱离 viewBox`)
      // 字号跟着 narrow 走 = 在缩字
      if (/narrow[^\n]{0,40}(font-size|fs-micro|fs-label)/.test(c.src)) bad.push(`${c.file}: 字号跟着窄档变`)
    }
    expect(bad, bad.join('\n')).toEqual([])
  })
})
