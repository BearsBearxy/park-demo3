/**
 * KpiNarrow 板 —— 三个指标卡组件在窄档的落点(响应式稿 KpiNarrow 板 §1/§2/§3)。
 *
 * 钉四件事:
 *   ① 三个报表屏各自那份 .fin-kpis 的「降两列」写在 ≤960(M 档)块里,不是原来的 ≤600;
 *      同时断言它**不再**留在 ≤600 块里 —— 两处都写等于没改档,而视觉上看不出来。
 *   ② ana.css 的 .av2-kpis 在 ≤960 定 4 列,且这个块夹在 1100 块之后、600 块之前。
 *      层叠顺序是这条规则唯一的正确性判据:插到 600 之后会把 S 档的两列盖回 4 列,
 *      而层叠覆盖不报错、不告警,是静默的 —— 所以位置必须进断言,不能只断言"存在"。
 *   ③ FPStat 的 S 档圆角收到 --radius-md,且 --radius-md 确实是 12px
 *      (只断言令牌名不够:令牌值被改了这条就成了一句空话)。
 *   ④ 反向:ds/KpiCard 的 .kc padding 20 / gap 12 / 图标 18 一个都没动。
 *      本轮明文不做(计划 §4 第 5 条:收 padding 与降两列互相撤销),顺手改了要红。
 *
 * 为什么读源码字面量而不是挂载后量宽:jsdom 不做布局(每个元素宽都是 0),
 * @media 条件也不参与计算 —— 挂载断言在这里只能得到恒真表达式。
 * 断言的是"规则写在哪个媒体条件下、按什么源序排",那正是这轮改的东西。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mediaBlock } from '@/test-utils/mediaBlock'

const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n')

/** 三个报表屏各自那份 .fin-kpis(scoped,故有三份副本) */
const REPORTS: ReadonlyArray<readonly [string, string]> = [
  ['IncomeStatementView', 'views/reports/income-statement/IncomeStatementView.vue'],
  ['BalanceSheetView', 'views/reports/balance-sheet/BalanceSheetView.vue'],
  ['TrialBalanceView', 'views/reports/trial-balance/TrialBalanceView.vue'],
]

const TWO_COL = '.fin-kpis { grid-template-columns:repeat(2, minmax(0,1fr)); }'

describe('KpiNarrow §1 — 三个报表屏的 .fin-kpis 在 M 档(≤960)降两列', () => {
  it.each(REPORTS)('%s:降两列写在 960 块里', (_name, rel) => {
    const css = read(rel)
    expect(mediaBlock(css, '@media (max-width: 960px)')).toContain(TWO_COL)
  })

  it.each(REPORTS)('%s:降两列不再留在 600 块里(留着=档没真的改)', (_name, rel) => {
    const css = read(rel)
    const sBlock = mediaBlock(css, '@media (max-width: 600px)')
    // ⚠ 「取不到块」和「取到了但里面没有」不是一回事:mediaBlock 找不到就返回空串,
    //   空串里当然没有 .fin-kpis —— 这条对 BalanceSheetView(本轮 600 块被整段删了)是空转,
    //   2026-09-20 对抗复查抓到的。所以先断该屏该不该有 600 块,再断块内内容。
    if (rel.includes('balance-sheet')) {
      expect(sBlock, 'BalanceSheetView 的 600 块本轮已整段移进 960 块,不该再出现').toBe('')
      expect(css.match(/@media \(max-width: (\d+)px\)/g)).toEqual(['@media (max-width: 960px)'])
    } else {
      expect(sBlock, `${rel} 的 600 块不见了 —— 那里还有别的 S 档规则,不该空`).not.toBe('')
      expect(sBlock).not.toContain('.fin-kpis')
    }
  })

  it.each(REPORTS)('%s:桌面档仍是 repeat(4)(XL 零差异,RESPONSIVE-LAYOUT-SPEC §9)', (_name, rel) => {
    const css = read(rel)
    // 媒体块外的基础规则:整份 CSS 去掉所有 @media 块后仍须留着 4 列那条
    const outside = css.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
    expect(outside).toContain('.fin-kpis { flex:0 0 auto; display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:12px; }')
  })

  it('三处都断到了(副本数不是 2 也不是 4)', () => {
    expect(REPORTS).toHaveLength(3)
  })
})

describe('KpiNarrow §2 — ana.css 的 .av2-kpis 在 M 档定 4 列', () => {
  const css = read('components/ana/ana.css')
  const Q1100 = '@media (max-width:1100px)'
  const Q960 = '@media (max-width:960px)'
  const Q600 = '@media (max-width:600px)'

  it('960 块里是 repeat(4),不是 auto-fit', () => {
    const block = mediaBlock(css, Q960)
    expect(block).toContain('.av2-kpis { grid-template-columns:repeat(4,minmax(0,1fr)); }')
    expect(block).not.toContain('auto-fit')
  })

  it('基础规则仍是 auto-fit minmax(120px)(L/XL 零差异)', () => {
    expect(css).toContain('.av2-kpis { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:8px; }')
  })

  it('层叠顺序:1100 → 960 → 600,宽档在前(写反了 S 档两列被静默盖回)', () => {
    const at1100 = css.indexOf(Q1100)
    const at960 = css.indexOf(Q960)
    const at600 = css.indexOf(Q600)
    expect(at1100).toBeGreaterThan(-1)
    expect(at960).toBeGreaterThan(-1)
    expect(at600).toBeGreaterThan(-1)
    expect(at960).toBeGreaterThan(at1100)
    expect(at600).toBeGreaterThan(at960)
  })

  it('S 档仍是两列(被盖回 4 列的那一刻这条红)', () => {
    expect(mediaBlock(css, Q600)).toContain('.av2-kpis { grid-template-columns:repeat(2,minmax(0,1fr)); }')
  })

  it('只用 600/960/1280 三个断点值(1100 是 mx 之外的存量豁免,本轮不清账也不新增)', () => {
    // 只数 @media 条件里的值 —— 文件里还有一个 max-width:1640px 是容器属性,不是断点
    const widths = [...css.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]))
    expect(widths.length).toBeGreaterThan(0)
    expect([...new Set(widths)].sort((a, b) => a - b)).toEqual([600, 960, 1100, 1280])
  })
})

describe('KpiNarrow §3 — FPStat 的 S 档圆角 16 → 12', () => {
  const css = read('components/fp/FPStat.vue')

  it('600 块里把 .fs 的圆角收到 --radius-md', () => {
    expect(mediaBlock(css, '@media (max-width: 600px)')).toContain('.fs { border-radius: var(--radius-md); }')
  })

  it('--radius-md 确实是 12px(与同屏 AnaKpiTile 的 .av2-kpi 同值)', () => {
    expect(read('styles/tokens.css')).toMatch(/--radius-md:\s*12px/)
    expect(read('components/ana/AnaKpiTile.vue')).toContain('border-radius: var(--radius-md)')
  })

  it('宽档仍是 --radius-lg,且列数/字号没动(稿判零代码:useFitDown 已在跑)', () => {
    expect(css).toContain('.fs { box-sizing: border-box; min-width: 0; border-radius: var(--radius-lg); padding: 12px 14px; display: flex; flex-direction: column; gap: 4px; }')
    expect(css).toContain('const { small, tip } = useFitDown(numEl)')
    expect(css).toContain('.fs-n.s16 { font-size: var(--fs-h3); }')
  })
})

describe('反向 — ds/KpiCard 本轮一个像素都不许动(计划 §4 第 5 条)', () => {
  const css = read('components/ds/KpiCard.vue')

  it('.kc 的 padding 仍是 20px、gap 仍是 12px', () => {
    expect(css).toContain('.kc { box-sizing: border-box; min-width: 0; border-radius: var(--radius-lg); padding: 20px; display: flex; flex-direction: column; gap: 12px; }')
  })

  it('图标仍是 18px', () => {
    expect(css).toContain('.kc-i :deep(svg) { width: 18px; height: 18px; }')
  })

  it('KpiCard 自己没有长出媒体块(降两列在三处消费方的 .fin-kpis 上做,不动共用组件)', () => {
    expect(css).not.toContain('@media')
  })
})
