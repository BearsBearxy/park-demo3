// 首进骨架 ↔ 真版式对齐(2026-09-16)。
//
// 骨架原来用固定高的灰条顶卡头 / 页头 / 读数句,手机上这些字会折行,数据一到整页下推 170~780px
// (浏览器 390 宽逐屏实测)。改成把真版式的页头、卡头照抄进骨架,只把随数据变的字换成隐形占位,
// 于是折行与真版式一致。代价是同一段字写了两遍 —— 这里盯着两份不走样:
//   ① 骨架里不许再有「灰条当卡头」;
//   ② 骨架的卡头标题、页头标题,按顺序都能在真版式里找到(真版式可以多:弹窗、空态分支、别的档)。
// 块高对不对 jsdom 量不出来,那一半只能在浏览器里量(实测记录见各屏 skel:start 注释)。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const DIR = join(__dirname, '..', 'analysis')
const SCREENS = [
  'AnomalyView', 'BreakevenView', 'BudgetView', 'ChargingAnalysisView', 'ChurnView', 'CockpitView',
  'ElecAnalysisView', 'ExpenseView', 'ExpiryView', 'ParkEnergyView', 'ParkView', 'PnlAnalysisView',
  'PvMeterAnaView', 'PvRoiView', 'TenantEnergyView', 'TenantPeerView', 'TenantPortfolioView',
]

function parts(name: string): { skel: string; real: string } {
  const src = readFileSync(join(DIR, name + '.vue'), 'utf8')
  const tpl = src.slice(src.indexOf('<template>'))
  const a = tpl.indexOf('<!-- skel:start')
  const b = tpl.indexOf('<!-- skel:end -->')
  expect(a, `${name} 没有 skel:start 标记`).toBeGreaterThan(-1)
  expect(b, `${name} 没有 skel:end 标记`).toBeGreaterThan(a)
  return { skel: tpl.slice(a, b), real: tpl.slice(b) }
}

// 标题的「静态前缀」:随数据变的部分(骨架里的隐形占位、真版式里的插值)在两份里写法不同 ——
// 骨架可能把「{{ selected ?? '全园区' }}」直接写成首进时的值 —— 只比第一个变量之前的那段字。
const DYN = '\u0000'
const norm = (html: string): string => html
  .replace(/<span class="ana-hole">[\s\S]*?<\/span>/g, DYN)
  .replace(/\{\{[\s\S]*?\}\}/g, DYN)
  .replace(/<[^>]+>/g, '')
  .replace(/\s+/g, '')
  .split(DYN)[0]

// <span class="t">…</span> 里可能套一层 span(占位 / 过滤徽标),按嵌套深度取到配对的闭合
function titles(html: string, cls: string): string[] {
  const out: string[] = []
  const open = new RegExp(`<(span|h2) class="${cls}"[^>]*>`, 'g')
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const tag = m[1]
    let depth = 1, i = open.lastIndex
    const re = new RegExp(`<${tag}\\b|</${tag}>`, 'g')
    re.lastIndex = i
    for (let t = re.exec(html); t; t = re.exec(html)) {
      depth += t[0].startsWith('</') ? -1 : 1
      if (depth === 0) { out.push(norm(html.slice(i, t.index))); break }
    }
  }
  return out
}

// 两个前缀谁是谁的开头就算同一个标题(真版式整句是变量时前缀为空,匹配任何骨架标题)
const same = (x: string, y: string): boolean => x.startsWith(y) || y.startsWith(x)
const isSubsequence = (xs: string[], ys: string[]): boolean => {
  let j = 0
  for (const y of ys) if (j < xs.length && same(xs[j], y)) j++
  return j === xs.length
}

describe('首进骨架与真版式对齐', () => {
  it.each(SCREENS)('❗%s:骨架里没有「灰条当卡头」', (name) => {
    const { skel } = parts(name)
    expect(skel, '卡头要照抄真版式的字,灰条顶不住手机上的折行').not.toMatch(/class="av2-card-h"><div class="fp-shim"/)
  })

  it.each(SCREENS)('❗%s:骨架卡头标题按顺序都在真版式里', (name) => {
    const { skel, real } = parts(name)
    const s = titles(skel, 't'), r = titles(real, 't')
    expect(s.length, '骨架至少要有一个真卡头').toBeGreaterThan(0)
    expect(isSubsequence(s, r), `骨架 [${s.join(' | ')}]\n真版式 [${r.join(' | ')}]`).toBe(true)
  })

  it.each(SCREENS)('%s:骨架页头标题与真版式一致', (name) => {
    const { skel, real } = parts(name)
    const s = titles(skel, 'ak-title'), r = titles(real, 'ak-title')
    expect(isSubsequence(s, r), `骨架 [${s.join(' | ')}] 真版式 [${r.join(' | ')}]`).toBe(true)
  })

  // 块高序列(灰条的写死高 + AnaSkelChart 的档位)。数值是 2026-09-16 在浏览器 390 / 1366 宽下
  // 逐屏对过真版式的结果;这里只钉「别被顺手改了」,改的时候先去浏览器量,再更新快照。
  it.each(SCREENS)('%s:骨架块高序列(浏览器实测过)', (name) => {
    const { skel } = parts(name)
    const seq = [...skel.matchAll(/class="fp-shim[^"]*" style="[^"]*?height: (\d+)px|<AnaSkelChart :height="(\d+)"/g)]
      .map((m) => (m[1] ? m[1] : 'chart' + m[2]))
    expect(seq).toMatchSnapshot()
  })

  it('比对器自检:改掉真版式一个卡头字,对齐判据就不成立', () => {
    const skel = '<span class="t">月度收入 · <span class="ana-hole">0000</span>年</span><span class="t">费用结构</span>'
    expect(isSubsequence(titles(skel, 't'), titles('<span class="t">月度收入 · {{ y }}年</span><span class="t">费用结构</span>', 't'))).toBe(true)
    expect(isSubsequence(titles(skel, 't'), titles('<span class="t">月度收入 · {{ y }}年</span><span class="t">费用构成</span>', 't'))).toBe(false)
  })
})
