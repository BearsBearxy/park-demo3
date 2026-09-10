import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 口径浮层的高度上限门禁(FORECAST-BAND-AND-PLAIN-SENTENCE Task 5 修复轮 1)。
 *
 * D5 之后桌面档也走 pill + 浮层,而浮层是从触发按钮**向上**弹的,`.av2-card` 没有 overflow
 * 裁它。没有高度上限时,长口径文案(如台账期数列表)能把弹层撑到把上方那张图**整个**盖住。
 * 图还在,但读者看不见,也不知道它在后面。
 *
 * 判据不是「常见图高」而是**最矮**的那张:上限比最矮的图还矮,才能保证任何一张图都不会被
 * 整个盖住。所以这条断言不写死 170,而是每次运行都重新数一遍全仓的图高 ——
 * 将来有人加一张比上限还矮的图,这里当场变红,而不是等到那个屏上出事。
 *
 * jsdom 没有排版引擎(offsetHeight 恒为 0),量不了真实高度,所以扫源码。
 * 这条挡不住「样式写对了但被别处覆盖」,只挡「有人把这行删了/改大了」。
 */
const SRC = join(__dirname, '../../..')
const POP_FILE = join(__dirname, '../AnaMethodNote.vue')

function vueFiles(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...vueFiles(p))
    else if (e.name.endsWith('.vue')) out.push(p)
  }
  return out
}

describe('口径浮层的高度上限', () => {
  it('❗.ana-note-pop 必须有 max-height 且带滚动 —— 没有它,内容多长就能盖多高', () => {
    const src = readFileSync(POP_FILE, 'utf8')
    const block = src.match(/\.ana-note-pop\s*\{([\s\S]*?)\}/)?.[1] ?? ''
    expect(block).toMatch(/max-height:\s*\d+px/)
    expect(block).toMatch(/overflow-y:\s*auto/)
  })

  it('❗上限必须低于全仓最矮的那张图 —— 否则那张图会被整个盖住', () => {
    const cap = Number(
      readFileSync(POP_FILE, 'utf8')
        .match(/\.ana-note-pop\s*\{([\s\S]*?)\}/)?.[1]
        ?.match(/max-height:\s*(\d+)px/)?.[1],
    )
    const heights = vueFiles(SRC).flatMap((f) =>
      [...readFileSync(f, 'utf8').matchAll(/:height="(\d+)"/g)].map((m) => Number(m[1])),
    )
    expect(heights.length).toBeGreaterThan(0)   // 扫不到图 = 断言变成空转,先钉住
    expect(cap).toBeLessThan(Math.min(...heights))
  })
})
