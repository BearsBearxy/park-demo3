// 门禁:.vue 模板里不许再挂浏览器原生 title 悬停说明(实现规范 §5;§1.3 悬停说明)。
// 原生 title 要停一秒多才出、样子由系统画、触屏出不来;一律换 v-tip(顶栏 / 图标轨 / 页签条用 ShellTip 组件)。
//
// 判据(用 vue/compiler-sfc 解析模板,不靠正则猜标签):
//   ① 小写原生标签(含 <component :is> 动态组件)上的 title= / :title= 一律违规;
//   ② 组件上的 title= 只有在那个组件**声明了 title prop** 时才放过(FPDrawer、ds/Card、ShellTip…),
//      没声明就会透传到根元素变成原生 title(ds 组件、fp 组件都一样);解析不出组件文件的(全局组件如 RouterLink)按透传算。
//   白名单不手写:「声明了 title prop」由 compileScript 的 bindings 算出来,组件改了 props 门禁自动跟着变。
//   <slot :title> 是插槽参数、<template> 不出 DOM,不算。
// 防静默变绿(照 crossLayerLinkGate):解析器数出来的 title 属性数要等于正则笨办法数出来的,对不上就点名。
// 模板之外还有一种写法:渲染函数 h('span', { title }) 一样是原生 title(ContractsView 合同号徽标、FPSortableTable 表头曾漏在这),
// .vue / .ts 里一并查;渲染函数里要悬停说明照 BuildingsView 写 withDirectives(h(…), [[vTip, '一句']])。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { compileScript, parse } from 'vue/compiler-sfc'
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import FPSortableTable, { type SortableColumn } from '@/components/fp/FPSortableTable.vue'

const SRC = resolve(__dirname, '../..')   // frontend/src
// @vue/compiler-core 的枚举值(NodeTypes / ElementTypes)
const ELEMENT = 1, ATTRIBUTE = 6, DIRECTIVE = 7, SIMPLE_EXPRESSION = 4
const TAG_ELEMENT = 0, TAG_COMPONENT = 1

function walk(dir: string, exts: string[]): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === '__tests__' || n === 'node_modules' ? [] : walk(p, exts)
    return exts.some((e) => p.endsWith(e)) && !p.endsWith('.spec.ts') ? [p] : []
  })
}

const rel = (f: string) => f.slice(SRC.length + 1).replace(/\\/g, '/')
const fsOpt = {
  fileExists: (p: string) => { try { return statSync(p).isFile() } catch { return false } },
  readFile: (p: string) => readFileSync(p, 'utf8'),
}

const propCache = new Map<string, boolean>()
/** 这个组件声明了 title prop 吗(compileScript 的 bindings 里 title === 'props')。 */
function declaresTitle(file: string): boolean {
  if (!propCache.has(file)) {
    const { descriptor } = parse(readFileSync(file, 'utf8'), { filename: file })
    const has = !!(descriptor.script || descriptor.scriptSetup)
      && compileScript(descriptor, { id: 'gate', fs: fsOpt }).bindings?.title === 'props'
    propCache.set(file, has)
  }
  return propCache.get(file)!
}

const pascal = (t: string) => t.replace(/(^|-)(\w)/g, (_, __, c: string) => c.toUpperCase())

interface Node { type: number; tag?: string; tagType?: number; props?: any[]; children?: Node[]; loc: { start: { line: number } } }

/** 一个 .vue 文件里的违规处 + 解析器 / 正则各数到几个 title 属性。 */
function scan(file: string) {
  const src = readFileSync(file, 'utf8')
  const { descriptor } = parse(src, { filename: file })
  const tpl = descriptor.template
  const script = (descriptor.script?.content ?? '') + (descriptor.scriptSetup?.content ?? '')
  const imports = new Map([...script.matchAll(/import\s+(\w+)\s*(?:,\s*\{[^}]*\}\s*)?from\s+['"]([^'"]+\.vue)['"]/g)]
    .map((m) => [m[1], resolve(m[2].startsWith('@/') ? SRC : dirname(file), m[2].replace(/^@\//, ''))]))
  const bad: string[] = []
  let parsed = 0
  const visit = (n: Node) => {
    if (n.type === ELEMENT) {
      const t = n.props!.find((p) => (p.type === ATTRIBUTE && p.name === 'title')
        || (p.type === DIRECTIVE && p.name === 'bind' && p.arg?.type === SIMPLE_EXPRESSION && p.arg.isStatic && p.arg.content === 'title'))
      if (t) {
        parsed++
        const at = `${rel(file)}:${t.loc.start.line} <${n.tag}>`
        if (n.tagType === TAG_ELEMENT || n.tag === 'component') bad.push(`${at} 原生标签`)
        else if (n.tagType === TAG_COMPONENT) {
          const f = imports.get(pascal(n.tag!))
          if (!f) bad.push(`${at} 解析不出组件文件,按透传到原生算`)
          else if (!declaresTitle(f)) bad.push(`${at} ${rel(f)} 没声明 title prop,会透传到根元素`)
        }
      }
    }
    n.children?.forEach(visit)
  }
  if (tpl?.ast) visit(tpl.ast as unknown as Node)
  const naive = tpl ? (tpl.content.replace(/<!--[\s\S]*?-->/g, '').match(/\s(?::|v-bind:)?title\s*=/g) ?? []).length : 0
  return { bad, parsed, naive }
}

/** 渲染函数里 h('小写标签', { …title… }) 的行号。只看 props 对象这一层的键(style: {…} 这类嵌套先抹掉)。 */
function hTitles(src: string): number[] {
  const out: number[] = []
  for (const m of src.matchAll(/\bh\(\s*['"`]([a-z][\w-]*)['"`]\s*,\s*\{/g)) {
    const start = m.index! + m[0].length
    let i = start, depth = 1
    for (; depth && i < src.length; i++) depth += src[i] === '{' ? 1 : src[i] === '}' ? -1 : 0
    let top = src.slice(start, i - 1)
    while (/\{[^{}]*\}/.test(top)) top = top.replace(/\{[^{}]*\}/g, '')
    if (/(?:^|[,\s])title\s*(?::|,|$)/.test(top)) out.push(src.slice(0, m.index).split('\n').length)
  }
  return out
}

describe('禁原生 title', () => {
  const files = walk(SRC, ['.vue'])
  const res = files.map((f) => ({ f, ...scan(f) }))

  it('防空扫:src 下的 .vue 不少于 200 个,且扫到了组件上的 title(FPDrawer 等)', () => {
    expect(files.length).toBeGreaterThan(200)
    expect(res.reduce((s, r) => s + r.parsed, 0)).toBeGreaterThan(50)
  })

  it('解析器数到的 title 属性数 = 正则笨办法数到的(对不上 = 解析漏了一种写法)', () => {
    const off = res.filter((r) => r.parsed !== r.naive).map((r) => `${rel(r.f)} 解析 ${r.parsed} / 正则 ${r.naive}`)
    expect(off, off.join('\n')).toEqual([])
  })

  it('❗模板里原生标签、以及没声明 title prop 的组件上 title= 为 0', () => {
    const bad = res.flatMap((r) => r.bad)
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('❗渲染函数 h(\'原生标签\', { title }) 为 0(.vue / .ts)', () => {
    const bad = walk(SRC, ['.vue', '.ts']).flatMap((f) => hTitles(readFileSync(f, 'utf8')).map((l) => `${rel(f)}:${l}`))
    expect(bad, bad.join('\n')).toEqual([])
  })

  it('判据自检:渲染函数里 title 键抓到,嵌套在 style 里的、组件 h(Comp, …) 的放过', () => {
    expect(hTitles("h('span', {\n  role: 'button',\n  title: '排序',\n  style: { a: 1 },\n}, [])")).toEqual([1])
    expect(hTitles("x\nh('span', { style: { title: 1 } }, 'a')\nh(Comp, { title: 'x' })\nh('i', { title })")).toEqual([4])
  })

  it('判据自检:声明了 title prop 的组件放过,没声明的抓', () => {
    expect(declaresTitle(join(SRC, 'components/ds/Card.vue'))).toBe(true)
    expect(declaresTitle(join(SRC, 'components/fp/FPDrawer.vue'))).toBe(true)
    expect(declaresTitle(join(SRC, 'components/ds/Button.vue'))).toBe(false)
  })
})

// DatePicker 的面板在桌面 / 平板档不走 Teleport,就长在根 .dp 里。v-tip 写在 <DatePicker> 上会落到根上:
// 面板里每点一格(触屏)、每次移回面板(鼠标)都冒宿主那条说明,还盖住面板首行(DATE-PICKER-SPEC §50:只落触发器)。
// 宿主要悬停说明就传 title,DatePicker 自己挂到触发器 .dp-box 上。
// 破坏验证:ContractsView 的「按某天查看」改回 v-tip="'…'" → 红
describe('DatePicker 上不写 v-tip', () => {
  it('❗<DatePicker v-tip> 为 0(走 title prop)', () => {
    const bad: string[] = []
    for (const f of walk(SRC, ['.vue'])) {
      const { descriptor } = parse(readFileSync(f, 'utf8'), { filename: f })
      const visit = (n: Node) => {
        if (n.type === ELEMENT && n.tag === 'DatePicker' && n.props!.some((p) => p.type === DIRECTIVE && p.name === 'tip')) {
          bad.push(`${rel(f)}:${n.loc.start.line}`)
        }
        n.children?.forEach(visit)
      }
      if (descriptor.template?.ast) visit(descriptor.template.ast as unknown as Node)
    }
    expect(bad, bad.join('\n')).toEqual([])
  })
})

// 换下来的那几处悬停说明还在、字没丢(门禁只管「没有原生 title」)。
// ContractsView TABLE_COLUMNS 里三枚徽标(整租 / 递增 / 续)同样换了,但那组 render 现在不上屏
// (TABLE_COLUMNS 只给 fpSortRows 取排序值,列表是模板写的 .cl-item),没有可挂载的落点,只由上面的门禁看着。
describe('渲染函数里换成 v-tip 的残留', () => {
  // 破坏验证:FPSortableTable 表头触发钮的 [[vTip, '排序']] 拿掉 → 红
  it('可排序表头:「排序」在悬停说明里,不挂原生 title', () => {
    setActivePinia(createPinia())
    const cols: SortableColumn<{ id: number; name: string }>[] = [{ key: 'name', header: '租户' }]
    const w = mount(FPSortableTable, { props: { columns: cols, rows: [{ id: 1, name: '广联' }] } })
    const trig = w.get('thead [role=button]').element as HTMLElement & { _tip?: { text: string } }
    expect([trig._tip?.text, trig.getAttribute('title')]).toEqual(['排序', null])
  })
})
