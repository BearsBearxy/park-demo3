/**
 * 读数句的「有↔无占位」门禁（2026-09-20 立）。
 *
 * 毛病长这样：骨架分支把读数句**无条件**画出来（`<p class="ana-read"><span class="ana-hole">…`），
 * 而真数据分支写的是 `<p v-if="xxx" class="ana-read">`。空态命中时（图画得出来、句子算不出来），
 * 数据到的那一帧真版式比骨架**矮两行**，整块内容反向上跳 —— 撞 `LAYOUT-STABILITY-SPEC`。
 *
 * 仓里现成的解法是 `.ana-read.hold` / `.ana-ref.hold`（`ana.css`：`min-height: 1lh`）：
 * `<p>` 常驻占一行高，里面的字用 `<template v-if>` 包。
 *
 * 2026-09-20 给 6 屏补常驻读数句时，对抗复查在新写的驾驶舱、电费、光伏回收三处抓到了这个形状。
 * 一查是**全层的老毛病**：到期墙、租户对标、驾驶舱回测卡早就这么写着。
 * 所以这道门禁按棘轮立：老账登记在 `LEGACY` 里，**只许变短，不许变长**。
 * 修老账时把对应行从 `LEGACY` 删掉即可（`expected N to be M` 会告诉你数对不对）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ANA = join(__dirname, '..', 'analysis')

/**
 * 立档当天就存在的 13 处（都在本轮之前写的）。
 * 它们同样会反向塌，但不是这一轮碰的代码 —— 登记下来，别让它变多。
 */
const LEGACY = [
  'CockpitView.vue :: v-else class="ana-ref"',
  'CockpitView.vue :: v-if="backRead" class="ana-read"',
  'CockpitView.vue :: v-if="backRead" class="ana-ref"',
  'ExpiryView.vue :: v-if="rentRollText" class="ana-read"',
  'ExpiryView.vue :: v-if="priorityRead" class="ana-read"',
  'ExpiryView.vue :: v-if="priorityRead" class="ana-ref"',
  'ExpiryView.vue :: v-if="renewalRateRead" class="ana-read"',
  'ExpiryView.vue :: v-if="renewalRateRead" class="ana-ref"',
  'ExpiryView.vue :: v-if="sensitivityRead" class="ana-read"',
  'ExpiryView.vue :: v-if="sensitivityGapRead" class="ana-read"',
  'ExpiryView.vue :: v-if="sensitivityRead" class="ana-ref"',
  'TenantPeerView.vue :: v-if="elecRead" class="ana-read"',
  'TenantPeerView.vue :: v-if="elecRead" class="ana-ref"',
]

/** 条件出句但没占位的读数句。只在「这个文件的骨架确实画了读数句占位」时才算数。 */
function offenders(): string[] {
  const out: string[] = []
  for (const f of readdirSync(ANA).filter((x) => x.endsWith('.vue'))) {
    const src = readFileSync(join(ANA, f), 'utf8').replace(/\r\n/g, '\n')
    const m = /<template>([\s\S]*)<\/template>/.exec(src)
    if (!m) continue
    const tpl = m[1].replace(/<!--[\s\S]*?-->/g, '')
    // 骨架没画读数句占位的文件不成立（没有「无条件的那一半」，就不会反向塌）
    if (!/class="ana-(?:read|ref)"><span class="ana-hole"/.test(tpl)) continue
    for (const g of tpl.matchAll(/<p\b([^>]*class="ana-(?:read|ref)"[^>]*)>/g)) {
      const attrs = g[1].trim().replace(/\s+/g, ' ')
      if (/\bv-if=|\bv-else/.test(attrs)) out.push(`${f} :: ${attrs.slice(0, 70)}`)
    }
  }
  return out
}

describe('读数句的有↔无占位', () => {
  it('❗条件出句的 .ana-read / .ana-ref 必须用 .hold 占位 —— 老账只许变短', () => {
    const now = offenders()
    const added = now.filter((x) => !LEGACY.includes(x))
    expect(
      added,
      '新写的条件读数句没占位，空态时会比骨架矮两行、数据到了整块上跳。\n' +
        '改法：`<p class="ana-read hold"><template v-if="…">…</template></p>`（照 CockpitView 的 outlierRead 那两行）。\n' +
        '新增的：\n  ' + added.join('\n  '),
    ).toEqual([])
    expect(
      now.length,
      `老账登记了 ${LEGACY.length} 处，现在实测 ${now.length} 处。\n` +
        '变多了就是有人绕开了上面那条；变少了是好事 —— 把修好的那几行从 LEGACY 里删掉。',
    ).toBe(LEGACY.length)
  })

  it('❗.hold 的两条 CSS 还在 —— 没有它，加 hold 等于什么都没做', () => {
    const css = readFileSync(join(ANA, '..', '..', 'components', 'ana', 'ana.css'), 'utf8')
    expect(css).toMatch(/\.ana-read\.hold\s*,\s*\.ana-ref\.hold\s*\{[^}]*min-height/)
  })

  it('❗本轮 6 屏新写的读数句都占了位（钉住具体几处，防止有人把 hold 顺手删掉）', () => {
    const count = (f: string, re: RegExp) =>
      (readFileSync(join(ANA, f), 'utf8').match(re) || []).length
    const HOLD = /class="ana-(?:read|ref) hold"/g
    expect(count('ElecAnalysisView.vue', HOLD), '电费 3 张图 × 2 行').toBe(6)
    expect(count('CockpitView.vue', HOLD), '驾驶舱：本轮 2 张 × 2 行 + 原有 outlier/forecast 4 行').toBeGreaterThanOrEqual(8)
    expect(count('ParkView.vue', HOLD), '园区 TreeMap 2 行 + 环图 2 行 + 面积卡 1 行').toBe(5)
    expect(count('TenantPortfolioView.vue', HOLD), '租户 帕累托 2 行 + 散点 2 行').toBe(4)
    expect(count('PvRoiView.vue', HOLD), '光伏回收 爬坡图 2 行').toBeGreaterThanOrEqual(2)
  })
})
