// ECharts 按需注册完整性护栏（2026-08-11 审计整改 P2-1 配套）。
//
// 为什么需要它：AnaEChart 改成按需注册后，漏注册一个 series 类型 = 该屏整块白图 + 控制台
// `Series bar is used but not imported`。而组件单测里 echartsBundle 是整体 vi.mock 的桩，
// **漏注册在单测里永远测不出来**。treemap/sankey/gauge 各自只有一个屏在用（园区经营 /
// 园区能耗 / 资产负债分析），漏一个就是一整屏白图，靠人工点屏发现太不可靠。
//
// 本测试不跑 echarts，只做静态对账：扫全部图表 option 的构造点，把用到的 series 类型
// 与 echartsBundle.ts 实际注册的清单求差集。新增图表类型时忘了注册 → 这里立刻红。
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(__dirname, '..', '..', '..')          // → frontend/src
const BUNDLE = join(SRC, 'components', 'ana', 'echartsBundle.ts')

// option 的构造点：分析屏、屏级 *.logic.ts、共享数据层、ana 图元
const SCAN_DIRS = [
  join(SRC, 'views', 'analysis'),
  join(SRC, 'analysis'),
  join(SRC, 'components', 'ana'),
]

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === '__tests__') continue                // 测试里的 type 字面量是桩，不算真实用量
      out.push(...walk(p))
    } else if ((p.endsWith('.ts') || p.endsWith('.vue')) && !p.endsWith('.spec.ts')) {
      out.push(p)
    }
  }
  return out
}

/** echarts 的 series type 字符串 → echarts/charts 的导出名（全系列都遵循这个构词法） */
const chartExportOf = (t: string) => t[0].toUpperCase() + t.slice(1) + 'Chart'

// 只认 `type: 'xxx'` 这一种写法。项目里 option 全是对象字面量，没有动态拼 series type 的地方
// （唯二的动态 type 是轴的 xLog?'log':'value'，属 GridComponent 覆盖范围，不是 series）。
const SERIES_TYPE_RE = /\btype:\s*'([a-zA-Z]+)'/g

// ⚠ 口径选择：这里用「echarts 的 series 词表」做白名单，而不是「已知非 series 值」做黑名单。
// 黑名单版本试过，立刻被四类假阳性打穿：legend 的 type:'scroll'、瀑布图的业务字段
// type:'start'/'inc'/'dec'/'end'、轴的 'value'/'category'/'log'、tooltip.axisPointer 的 'shadow'。
// 业务侧的 type 值是无界的（谁都能起个新名字），而 echarts 的 series 词表是有界且极少变的 ——
// 用有界的那一边当白名单才稳。代价：echarts 将来新增 series 类型要回来补这张表（很少发生）。
const ECHARTS_SERIES_TYPES = new Set([
  'line', 'bar', 'pie', 'scatter', 'effectScatter', 'radar', 'tree', 'treemap',
  'sunburst', 'boxplot', 'candlestick', 'heatmap', 'map', 'parallel', 'lines',
  'graph', 'sankey', 'funnel', 'gauge', 'pictorialBar', 'themeRiver', 'custom',
])

describe('ECharts 按需注册完整性', () => {
  const bundle = readFileSync(BUNDLE, 'utf8')
  const files = SCAN_DIRS.flatMap(walk)

  it('扫描面不为空（防止目录改名后本测试静默失效）', () => {
    expect(files.length).toBeGreaterThan(20)
  })

  it('用到的每个 series 类型都在 echartsBundle 注册了', () => {
    // 'line' 既可能是 LineChart 也可能是 axisPointer.type:'line'，字面量分不开 —— 但项目必然
    // 用了折线图且 LineChart 已注册，把它当 series 是更严的口径，只会多要求不会漏。
    const used = new Map<string, string>()   // series type → 首个出现的文件（报错时好定位）
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.matchAll(SERIES_TYPE_RE)) {
        const t = m[1]
        if (!ECHARTS_SERIES_TYPES.has(t)) continue
        if (!used.has(t)) used.set(t, f.slice(SRC.length + 1))
      }
    }

    const missing = [...used.entries()]
      .filter(([t]) => !bundle.includes(chartExportOf(t)))
      .map(([t, f]) => `${chartExportOf(t)}（series type '${t}'，见 ${f}）`)

    expect(missing, `echartsBundle.ts 漏注册 —— 这些屏会白图：\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('用到的 markLine / markPoint / markArea / dataZoom 都注册了对应 Component', () => {
    const featureToComponent: Record<string, string> = {
      markLine: 'MarkLineComponent',
      markPoint: 'MarkPointComponent',
      markArea: 'MarkAreaComponent',
      dataZoom: 'DataZoomComponent',
    }
    const missing: string[] = []
    for (const [feature, comp] of Object.entries(featureToComponent)) {
      const usedSomewhere = files.some((f) => new RegExp(`\\b${feature}\\s*:`).test(readFileSync(f, 'utf8')))
      if (usedSomewhere && !bundle.includes(comp)) missing.push(`${comp}（用到了 ${feature}）`)
    }
    expect(missing, `echartsBundle.ts 漏注册 component：\n  ${missing.join('\n  ')}`).toEqual([])
  })

  it('注册清单里没有全站已不再使用的图表（删屏后应同步瘦身）', () => {
    // 只从 `from 'echarts/charts'` 那条 import 里取，别扫全文 —— 文件头注释里出现的
    // 「AnaEChart」也会被 /\w+Chart/ 匹到（实测踩过）。
    const chartsImport = bundle.match(/import\s*\{([^}]*)\}\s*from\s*'echarts\/charts'/s)?.[1] ?? ''
    const registered = [...chartsImport.matchAll(/\b([A-Z][a-zA-Z]*Chart)\b/g)].map((m) => m[1])
    expect(registered.length, "没能从 echartsBundle.ts 解析出 echarts/charts 的 import，本测试已失效").toBeGreaterThan(0)
    const allSrc = files.map((f) => readFileSync(f, 'utf8')).join('\n')
    const orphan = [...new Set(registered)].filter((c) => {
      const t = c.slice(0, -'Chart'.length)
      const seriesType = t[0].toLowerCase() + t.slice(1)
      return !new RegExp(`type:\\s*'${seriesType}'`).test(allSrc)
    })
    // 这条是"提醒瘦身"而非"阻止合并"：留着不用的图表只是多几十 KB，不会坏功能。
    expect(orphan, `echartsBundle 注册了但全站没用到，可删以继续瘦身：${orphan.join(', ')}`).toEqual([])
  })
})
