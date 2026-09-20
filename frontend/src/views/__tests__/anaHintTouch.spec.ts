/**
 * 分析层卡头话术的「桌面 / 手机」两套写法门禁(2026-09-20 立)。
 *
 * 背景:`.hint-desk` 原本在 ≤600 一刀切 display:none。代价是分析层 16 个卡片处的
 * 「这张图还能点」整句在手机上消失 —— 图照样能点,只是没人告诉用户。
 * 改法是成对写:桌面显 `.hint-desk`,手机显 `.hint-touch`(同一件事换一句说法)。
 *
 * 这道门禁钉的是**配对**,不是字数(字数归 anaCopyLint)。只要有人再往 `.hint-desk` 里
 * 塞一句指点话术而忘了配 `.hint-touch`,手机上就又少一句,这里会红。
 *
 * ⚠ 例外只有一个:驾驶舱主图的「拖选缩放」—— S 档 slider 被剔,这句在手机上是假话,
 * 它必须单独留在 `.hint-desk` 里继续藏。所以它和「点月柱切期间」被拆成了两个 span。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const ANA = join(__dirname, '..', 'analysis')
const CSS = join(__dirname, '..', '..', 'components', 'ana', 'ana.css')

/** 用户拍板的 8 屏(2026-09-20):分析屏手机体验稿的范围。 */
const SCOPE = [
  'PvMeterAnaView.vue',
  'ElecAnalysisView.vue',
  'ChargingAnalysisView.vue',
  'CockpitView.vue',
  'ParkView.vue',
  'TenantPortfolioView.vue',
  'ExpiryView.vue',
  'PvRoiView.vue',
]

const read = (p: string) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
/**
 * 只取 `<template>` 块,并剥掉注释。
 * 「不许写悬停」那条管的是**上屏的字**;`<script>` 里的注释提「悬停」是正常的
 * (如 CockpitView:227 在解释为什么图例带占比、不必悬停)。
 */
function tpl(f: string): string {
  const src = read(join(ANA, f))
  const m = /<template>([\s\S]*)<\/template>/.exec(src)
  return (m ? m[1] : src).replace(/<!--[\s\S]*?-->/g, '')
}

/**
 * 取一个 `<span class="hint">` 的整段内容 —— 必须**配平** `<span>`。
 * 照抄 anaCopyLint.spec.ts 的取法:非贪婪正则会停在内层 `</span>`,
 * 而我们要查的恰恰是内层那两个兄弟。
 */
function hintBlocks(src: string): string[] {
  const out: string[] = []
  for (const open of src.matchAll(/<span[^>]*class="hint"[^>]*>/g)) {
    const start = open.index! + open[0].length
    const re = /<span\b|<\/span>/g
    re.lastIndex = start
    let depth = 1
    let tag: RegExpExecArray | null
    while ((tag = re.exec(src)) !== null) {
      depth += tag[0] === '</span>' ? -1 : 1
      if (depth === 0) break
    }
    out.push(src.slice(start, tag ? tag.index : src.length))
  }
  return out
}

/** 取出所有 `<span class="hint-touch">…</span>` 的可见文字(这批不嵌套)。 */
function touchTexts(src: string): string[] {
  return [...src.matchAll(/<span class="hint-touch">([\s\S]*?)<\/span>/g)].map((m) => m[1])
}

describe('分析层 hint 两套写法', () => {
  it('❗ana.css:桌面与手机各显一套,不许两套同时显或同时不显', () => {
    const css = read(CSS)
    const s = css.search(/@media\s*\(max-width:\s*600px\)/)
    expect(s, 'ana.css 里找不到 S 档媒体块').toBeGreaterThan(-1)
    const base = css.slice(0, s)
    const sTier = css.slice(s)

    expect(base, '基档 .hint-touch 必须藏起来,否则桌面会同时看到两套').toMatch(
      /\.hint-touch\s*\{[^}]*display:\s*none/,
    )
    expect(base, '基档不许藏 .hint-desk —— 那是桌面要显的那一套').not.toMatch(
      /^\s*\.hint-desk\s*\{[^}]*display:\s*none/m,
    )
    expect(sTier, 'S 档要藏 .hint-desk').toMatch(/\.hint-desk\s*\{[^}]*display:\s*none/)
    expect(sTier, 'S 档要显 .hint-touch').toMatch(/\.hint-touch\s*\{[^}]*display:\s*inline/)
  })

  it('❗8 屏里每一段 .hint:有 .hint-desk 就必须有 .hint-touch(手机上不许只藏不换)', () => {
    const missing: string[] = []
    for (const f of SCOPE) {
      for (const b of hintBlocks(tpl(f))) {
        if (b.includes('class="hint-desk"') && !b.includes('class="hint-touch"')) {
          missing.push(`${f}: ${b.replace(/\s+/g, ' ').slice(0, 70)}`)
        }
      }
    }
    expect(missing, `这些 hint 只藏了桌面话术、没给手机换一句:\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('❗配对数对得上:8 屏共 16 个卡片处 × 骨架/真数据两遍 = 32 对', () => {
    let desk = 0
    let touch = 0
    for (const f of SCOPE) {
      const src = tpl(f)
      desk += src.split('class="hint-desk"').length - 1
      touch += src.split('class="hint-touch"').length - 1
    }
    // 8 屏 16 个卡片处,每处在骨架分支和真数据分支各写一遍。
    expect(desk, '桌面话术处数').toBe(32)
    expect(touch, '手机话术处数应与桌面一一对应').toBe(desk)
  })

  it('❗手机那一套不许留桌面写法:没有「点击」,没有「左图 / 右侧」这类方位词', () => {
    const bad: string[] = []
    for (const f of SCOPE) {
      for (const t of touchTexts(tpl(f))) {
        if (/点击/.test(t)) bad.push(`${f}: 「${t.trim()}」还写着「点击」——手机上是点,不是击`)
        if (/左图|右侧|左侧|右图/.test(t)) bad.push(`${f}: 「${t.trim()}」带桌面方位词,手机是单列堆叠`)
      }
    }
    expect(bad, bad.join('\n')).toEqual([])
  })

  /**
   * 「悬停」在**桌面**上是真话,不该一刀切禁掉 —— 要禁的是它出现在手机看得到的地方。
   * 判据因此钉在位置上:剥掉所有 `.hint-desk` 之后还剩「悬停」,那就是手机上会显出来的假话。
   *
   * 立这条的由来:PvResidualHeat 卡头那句「· 悬停看数」裸写在 `.hint` 里、压根没包 `.hint-desk`,
   * 所以它在手机上一直显示着 —— 全分析层唯一一处「说的和能做的对不上」。
   * 而合同散点那句「(悬停看租户)」是正常的:它包在 `.hint-desk` 里,手机上换成「(点看租户)」。
   */
  it('❗手机看得到的字里不许有「悬停」——手机没有 hover,说了就是假话', () => {
    // ⚠ 这条**扫整个分析层**,不是只扫上面那 8 屏。
    // 立它的那一处(PvResidualHeat.vue 的「· 悬停看数」)是被 PvMeterAnaView 引进来的图组件,
    // 按 8 屏的名单扫根本扫不到它 —— 第一版就是这么写的,破坏验证时照样绿。
    const bad: string[] = []
    for (const f of readdirSync(ANA).filter((x) => x.endsWith('.vue'))) {
      const onPhone = tpl(f).replace(/<span class="hint-desk">[\s\S]*?<\/span>/g, '')
      if (/悬停/.test(onPhone)) bad.push(f)
    }
    expect(bad, `这些文件在手机上还会显出「悬停」:${bad.join(', ')}`).toEqual([])
  })

  it('❗唯一的例外照旧藏着:驾驶舱主图「拖选缩放」只在 .hint-desk 里,不许混进手机那一套', () => {
    const src = tpl('CockpitView.vue')
    expect(src, '「拖选缩放」应当还在').toContain('拖选缩放')
    for (const t of touchTexts(src)) {
      expect(t, 'S 档 slider 被剔,「拖选缩放」在手机上做不到').not.toContain('拖选缩放')
    }
    // 同一个卡头里,前半截「点月柱」必须换成了手机说法
    const both = hintBlocks(src).filter((b) => b.includes('拖选缩放'))
    expect(both.length, '主图卡头骨架分支 + 真数据分支各一处').toBe(2)
    for (const b of both) expect(b, '拆 span 时把「点月柱」那半截丢了').toContain('点月柱切期间')
  })
})
