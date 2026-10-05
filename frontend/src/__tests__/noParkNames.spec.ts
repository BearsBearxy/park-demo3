// 前端源码里不许出现我园真名(2026-10-04 用户拍板:产品卖给别的园区,客户浏览器下载的 JS 里不能有我园的东西)。
//
// 清单和后端共用一份:backend/src/test/resources/baseline/real-names.txt(BaselineChainIT / BaselineBootIT 拿它扫客户库)。
// 静态扫 src 下非测试的 .ts / .vue,先剥掉注释再查 —— 注释和测试不进构建产物(esbuild/Vue 生产编译剥注释、sourcemap 关着)。
// tools/ 不扫:只有 vite-node 手动跑,app 不 import(dist 实测 0 命中)。
//
// KNOWN 是复查时已知、因为改了会动我园自己的导入/排序而暂缓的几处(见收口消息的 deferred 项),只许变少不许变多:
// 名字出现在 KNOWN 以外的文件 = 新漏的,红。
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const SRC = join(__dirname, '..')                                       // → frontend/src
const NAMES_FILE = join(SRC, '..', '..', 'backend', 'src', 'test', 'resources', 'baseline', 'real-names.txt')

const KNOWN: Record<string, string[]> = {
  // 电费成本拆分的值域写死成我园四栋(后端 ElecCostService 同),是导入解析键 —— 改成按电表配置前不能动
  'A座': ['composables/useMeterWorkbench.ts', 'utils/elecCostExcel.ts'],
  'B-G座': ['composables/useMeterWorkbench.ts', 'utils/elecCostExcel.ts'],
  '创业大厦': ['utils/elecCostExcel.ts', 'utils/meterSplit.ts'],
  '工业大厦': ['utils/elecCostExcel.ts', 'utils/meterSplit.ts'],
  // 抄表册「区域 → 楼栋」与园区自担关键词、楼组排序:改了会动我园导入的归楼与组序
  '招商中心': ['composables/useMeterWorkbench.ts', 'utils/meterSplit.ts'],
  '创显': ['utils/meterSplit.ts'],
  '人才港': ['utils/meterSplit.ts'],
  // 通用说法(园区公共用电),清单里是因为 V65 有个池就叫这个名
  '园区公共电': ['utils/paramRegistry.ts', 'views/params/ParamCenterView.vue'],
}

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === '__fixtures__' || name === 'tools') continue
      out.push(...walk(p))
    } else if ((p.endsWith('.ts') || p.endsWith('.vue')) && !p.endsWith('.spec.ts') && !p.endsWith('.d.ts')) {
      out.push(p)
    }
  }
  return out
}

// 剥注释:块注释、HTML 注释、行注释(// 前是 : 或引号的不算,那是 http:// 或字符串里的 //)。宁可多剥 —— 只会少报,不会误报
const stripComments = (s: string) => s
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const rel = (p: string) => relative(SRC, p).split(sep).join('/')

describe('前端源码不含我园真名', () => {
  const names = readFileSync(NAMES_FILE, 'utf8').split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'))
  const files = walk(SRC).map(p => ({ path: rel(p), code: stripComments(readFileSync(p, 'utf8')) }))

  it('扫描面不为空(防止目录或清单改名后本测试静默失效)', () => {
    expect(files.length).toBeGreaterThan(200)
    expect(names.length).toBeGreaterThan(200)
  })

  it('真名只出现在已知暂缓的文件里', () => {
    const leaks: string[] = []
    for (const n of names)
      for (const f of files)
        if (f.code.includes(n) && !(KNOWN[n] ?? []).includes(f.path)) leaks.push(`${f.path}: ${n}`)
    expect(leaks).toEqual([])
  })
})
