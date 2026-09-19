// 写死的颜色字面量门(DARK-MODE-SPEC §4 / §7):src 下 .vue / .css / .ts 里,白名单以外的颜色字面量
// (#hex、rgb()/rgba()、hsl()、oklch() 这类,以及样式里的具名色 white / black …)**只减不增**;
// 另外,引用的令牌(var(--x),带兜底值的也算)必须有定义。
//
// 为什么要门:暗色模式靠 tokens.css 的 :root[data-theme="dark"] 换一整套令牌,
// 写死的颜色不跟着换 —— 暗底上变成一块白、一行看不见的黑字,浏览器不报任何错。
// 引了没定义的令牌也一样不报错:带兜底值时两种外观都吃兜底(命令面板选中行就这样在暗色下和浮层同色),
// 不带兜底时整条声明作废。scripts/token-check.mjs 放过带兜底值的,所以这里要查。
// 收法见 DARK-MODE-SPEC §4:换成浅色值相同的令牌;墨色半透明写 color-mix(in srgb, var(--ink-900) N%, transparent);
// 一处一个、没有同值令牌的浅色值:浅色照旧写,另加一条 :root[data-theme="dark"] 的规则换成令牌。
//
// 计数规则:去掉注释(/* */、<!-- -->、// 行尾)后按正则数;测试文件(*.spec.ts / __tests__/)不算。
// BASELINE 只许往下改:收掉了就把它改成新的数,别为了过门往上抬 —— 新写的颜色请引令牌。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** 当前允许的上限(2026-09-20 对抗复查修完后的实测数;剩下的见文末「剩下的是什么」)。 */
const BASELINE = 166

const SRC = join(__dirname, '..')

/** 白名单(DARK-MODE-SPEC §4「不收」):令牌表本身、写进 Excel 的颜色、导出窗口、登录页(本来就是暗色背景)、
 *  图表的两套色板(anaTheme.ts §6;光伏分栋屏的镜像 pvAnaColors.ts 同理,按 resolvedTheme 取浅 / 暗两套)。
 *  打印样式与品牌标志 SVG 不在扫描范围(.svg 不扫;打印块混在屏的样式里,计入基线)。 */
const WHITELIST: RegExp[] = [
  /^styles\/tokens\.css$/,
  /^utils\/[^/]*Excel[^/]*\.ts$/,
  /^views\/bills\/Export[^/]*Window\.vue$/,
  /^views\/LoginView\.vue$/,
  /^components\/ana\/anaTheme\.ts$/,
  /^views\/analysis\/pvAnaColors\.ts$/,
]

// lab() / lch() / oklab() / oklch() / hwb() 要以数字开头才算颜色:pvAnaV4.logic 里有个叫 lab(r.from) 的函数
const LITERAL = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?)\(|\b(?:oklch|oklab|lab|lch|hwb)\(\s*[\d.]/g
const NAMES = 'white|black|red|green|blue|gray|grey|orange|yellow|silver|navy|purple|pink|brown'
/** 样式里的具名色:属性值里的 white / black …(--surface-white、white-space 这种不算) */
const NAMED_IN_STYLE = new RegExp(
  `(?:^|[\\s{;"'(])(?:color|background(?:-color)?|fill|stroke|border(?:-[a-z]+)*|outline(?:-color)?|box-shadow|caret-color|stop-color)\\s*:\\s*[^;"'}\\n]*?(?<![-\\w.#$])(?:${NAMES})(?![-\\w])`, 'gi')
/** 脚本 / 模板里当颜色写的具名色:{ color: 'white' }、fill="black"(变量名 blue、Badge 的 tone="blue" 不算) */
const NAMED_IN_SCRIPT = new RegExp(
  `(?:\\b(?:color|background(?:Color)?|fill|stroke|border(?:Color)?|outline(?:Color)?|stopColor)\\s*:\\s*(['"\`])(?:${NAMES})\\1)`
  + `|(?:\\s(?:fill|stroke|color|stop-color)="(?:${NAMES})")`, 'gi')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) { if (e !== '__tests__') walk(p, out) }
    else if (/\.(vue|css|ts)$/.test(e) && !/\.(spec|test)\.ts$/.test(e) && !e.endsWith('.d.ts')) out.push(p)
  }
  return out
}

/** 去注释:块注释、HTML 注释、// 行尾注释(// 前是冒号或引号的不算,那是 URL 或字符串)。 */
function stripComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
}

/** 一个文件里的颜色字面量个数。kind:css 整个是样式;ts 整个是脚本;vue 样式 = <style> 块 + 模板里的 style="…" */
function countLiterals(s: string, kind: 'vue' | 'css' | 'ts' = 'css'): number {
  const t = stripComments(s)
  const style = kind === 'css' ? t : kind === 'ts' ? ''
    : [...t.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g), ...t.matchAll(/\sstyle="([^"]*)"/g)].map((m) => m[1]).join('\n')
  const script = kind === 'ts' ? t : kind === 'css' ? '' : t.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '')
  return (t.match(LITERAL) ?? []).length + (style.match(NAMED_IN_STYLE) ?? []).length + (script.match(NAMED_IN_SCRIPT) ?? []).length
}

const kindOf = (f: string) => (f.endsWith('.vue') ? 'vue' : f.endsWith('.css') ? 'css' : 'ts') as 'vue' | 'css' | 'ts'
const relOf = (f: string) => f.slice(SRC.length + 1).replace(/\\/g, '/')

function tally(): { total: number; files: [string, number][] } {
  const files: [string, number][] = []
  let total = 0
  for (const f of walk(SRC)) {
    const rel = relOf(f)
    if (WHITELIST.some((re) => re.test(rel))) continue
    const n = countLiterals(readFileSync(f, 'utf8'), kindOf(f))
    if (n) { files.push([rel, n]); total += n }
  }
  return { total, files: files.sort((a, b) => b[1] - a[1]) }
}

// ── 引用的令牌有没有定义 ──
/**
 * 已经提给主持人、还没加进 tokens.css 的令牌(2026-09-20 对抗复查;值见那次的回报)。
 * 加进 tokens.css 之后,下面「待加名单里的已经加了」会红 —— 从这里删掉就好。
 */
const PENDING: string[] = []
/** 组件留给宿主覆盖的钩子,自带兜底值、宿主不设就用兜底(DatePicker 的触发器高度)。 */
const HOOKS = ['--dp-h']

/** 定义:tokens.css 与各处 `--x:` 声明(组件自己的局部变量、行内样式变量表里的 '--x':),去掉注释后算 */
function definedTokens(): Set<string> {
  const out = new Set<string>()
  for (const f of walk(SRC)) {
    for (const m of stripComments(readFileSync(f, 'utf8')).matchAll(/(--[a-zA-Z0-9_-]+)['"]?\s*:/g)) out.add(m[1])
  }
  return out
}
/** 引用:var(--x …),去掉注释后算;模板串拼出来的名字(var(--accent-${tint}))静态查不了,跳过 */
function referencedTokens(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const f of walk(SRC)) {
    const s = stripComments(readFileSync(f, 'utf8'))
    for (const m of s.matchAll(/var\(\s*(--[a-zA-Z0-9_-]*[a-zA-Z0-9_])(-?\$\{)?/g)) {
      if (m[2]) continue
      const at = `${relOf(f)}:${s.slice(0, m.index).split('\n').length}`
      out.set(m[1], [...(out.get(m[1]) ?? []), at])
    }
  }
  return out
}
const TOKENS_CSS = stripComments(readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8'))

describe('颜色字面量门', () => {
  it('计数规则:注释里的不算,各种写法都算', () => {
    expect(countLiterals('/* #fff rgb(0,0,0) */ a { color: #fff; }')).toBe(1)
    expect(countLiterals('// rgba(28,28,28,.1)\nconst a = "rgba(28, 28, 28, 0.1)"', 'ts')).toBe(1)
    expect(countLiterals('<!-- #123456 --><i style="color:oklch(0.5 0.1 250)"/>', 'vue')).toBe(1)
    expect(countLiterals('url(http://x.cn/a) hsl(0 0% 0%)')).toBe(1)
    expect(countLiterals('color: var(--ink-900); background: color-mix(in srgb, var(--ink-900) 6%, transparent)')).toBe(0)
  })

  it('具名色也算(background: white / color: black / 脚本里的 \'white\');令牌名、white-space、变量名 blue 不算', () => {
    expect(countLiterals('a { background: white; border: 1px solid black }')).toBe(2)
    expect(countLiterals('<template><i style="color: white" /></template><style>b { fill: Black; }</style>', 'vue')).toBe(2)
    expect(countLiterals("const d = { color: 'black', fill: \"white\" }", 'ts')).toBe(2)
    expect(countLiterals('<template><svg><path fill="white" /></svg><Badge tone="blue" /></template>', 'vue')).toBe(1)
    expect(countLiterals('a { background: var(--surface-white); white-space: nowrap; color: var(--hue-red) }')).toBe(0)
    expect(countLiterals('const { blue, red } = hues(); x = { color: blue, stroke: red }', 'ts')).toBe(0)
  })

  it('lab() 要以数字开头才算颜色(同名函数 lab(r.from) 不算)', () => {
    expect(countLiterals('const t = `${lab(r.from)}–${lab(r.to)}`', 'ts')).toBe(0)
    expect(countLiterals('a { color: lab(52% 40 59) }')).toBe(1)
  })

  it(`src 下白名单外的颜色字面量 ≤ ${BASELINE}(只减不增)`, () => {
    const { total, files } = tally()
    // 超了就把最多的几个文件打出来,方便找是谁新写的
    expect(total, `现在 ${total} 处,上限 ${BASELINE}。最多的文件:\n` + files.slice(0, 15).map(([f, n]) => `  ${n}  ${f}`).join('\n')).toBeLessThanOrEqual(BASELINE)
  })
})

describe('引用的令牌都有定义(带兜底值的也查)', () => {
  const defined = definedTokens()
  const refs = referencedTokens()

  it('每个 var(--x) 都有定义(tokens.css 或组件自己的 --x: 声明);待加的只许是 PENDING 名单里的', () => {
    const bad = [...refs].filter(([n]) => !defined.has(n) && !PENDING.includes(n) && !HOOKS.includes(n)).map(([n, at]) => `${n}  ${at.join(' ')}`)
    expect(bad.join('\n'), '引了没定义的令牌(拼错了?还是忘了加进 tokens.css?)').toBe('')
  })

  it('判据没失效:拼错一个名字会被抓到', () => {
    expect(defined.has('--row-selectd')).toBe(false)
    expect(defined.has('--row-selected')).toBe(true)
    expect(refs.has('--hue-blue')).toBe(true)
  })

  it('PENDING 名单里的令牌都还有人引(没人引了就删掉)', () => {
    expect(PENDING.filter((n) => !refs.has(n))).toEqual([])
  })

  it('待加名单里的已经加进 tokens.css 了 —— 从 PENDING 里删掉', () => {
    expect(PENDING.filter((n) => new RegExp(`${n}\\s*:`).test(TOKENS_CSS))).toEqual([])
  })
})

// ── 剩下的是什么(2026-09-20,166 处)──
// 都不会在暗底上变成白块 / 黑字:
//   · 半透明的色底(rgba(255,149,0,.14) 这类胶囊 / 选中底 / 删除钮悬停红):叠在暗底上照样是暗的;
//   · 墨色投影与遮罩(0 16px 48px rgba(28,28,28,.22)、rgba(28,28,28,.32)):暗底上看不出,但也不碍事;
//   · 图表数据色(期别色、账龄红阶、电费分项、趋势线的上期灰)与装饰(版本更新页头的暗色流动渐变、在线头像身份色):两种外观同值;
//   · 一处一个、没有同值令牌的浅色底 / 深色字:浅色照原值写,紧跟一条 :root[data-theme="dark"] 规则换成令牌
//     (账单通知选中行、表视图选中卡、抄表台账可疑 / 不完整行、参数中心高亮行、各处悬停加深……)。
// 要再往下收,就给这些角色加令牌(浅色值 = 原值),见 DARK-MODE-SPEC §4。
