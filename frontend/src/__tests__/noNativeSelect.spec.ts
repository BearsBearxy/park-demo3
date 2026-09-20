// 全站不许出现原生 <select>(UI-CONSISTENCY-SPEC §1「禁原生 select」)。下拉一律走 ds/Select.vue。
// 判据是规范原话:下拉面板由**操作系统渲染**,CSS 一行都管不到 —— iOS Safari 上弹系统滚轮、
// 各平台长相不一、暗色外观下不跟令牌走(0.15.0 上线暗色后更明显)。
//
// 为什么不留「只许减不许增」的基线:2026-09-20 清完之后就是零,留基线等于给下一个「就这一处」
// 留口子,而这条规矩已经栽过两次(模板编辑器版本切换、分页器每页条数,都是写的时候图省事,
// 直到画手机稿逐行核源码才翻出来)。
//
// 规范 §1 留了例外(「需要 :class 承载校验态时可保留原生 select,但要在代码里写明为什么」),
// 所以这里给的是**记名放行**而不是零容忍:在那一行上面写 ALLOW 标记 + 理由,门禁放过,并要求那句理由真是话而不是符号。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')

/** 记名放行标记。写法:`<!-- ui-consistency:allow-native-select 理由 -->` 或同名的 // 注释。 */
const ALLOW = /ui-consistency:allow-native-select([^\n\r>*]*)/
/** 理由得是话,不能是符号 —— 不写理由时 `-->` 的那两个横杠会被捕获成「理由」(实测踩过)。 */
const hasReason = (s: string) => /[\p{L}\p{N}]{2,}/u.test(s)

function walk(dir: string, exts: string[]): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : walk(p, exts)
    return exts.some((e) => p.endsWith(e)) ? [p] : []
  })
}

/**
 * 注释区间。**只算区间、不删字符** —— 直接把 /* … *\/ 从正文里剪掉会把区间内的真违规
 * 一起吃掉(模板里凑巧出现一对 /* *\/ 就够了),那是 2026-09-20 对抗复查实测到的漏网写法之一。
 */
function commentRanges(s: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const re of [/<!--[\s\S]*?-->/g, /\/\*[\s\S]*?\*\//g, /(^|[^:])\/\/[^\n\r]*/g]) {
    for (const m of s.matchAll(re)) out.push([m.index!, m.index! + m[0].length])
  }
  return out
}

/**
 * 会让浏览器画出原生 select 的几种写法(对抗复查实测:只查 `<select` 会漏掉后三种和自闭合写法)。
 * ⚠ 一律**区分大小写**:HTML 标签名不区分,但 Vue 单文件组件区分 —— 小写 `select` 是原生元素,
 * 大写 `Select` 是本产品那个自绘组件。加 /i 会把 30 多处正确用法全判成违规(实测踩过)。
 */
const PATTERNS: Array<[string, RegExp]> = [
  ['<select> 标签', /<select[\s/>]/g],                          // 含 <select/> 自闭合写法
  ['动态组件 :is="select"', /:is\s*=\s*["'`]\s*select\s*["'`]/g],
  ['渲染函数 h("select")', /\bh\(\s*["'`]select["'`]/g],
  ['createElement("select")', /createElement\(\s*["'`]select["'`]/g],
]

interface Hit { file: string; what: string; line: number; allowed: string | null }

function scan(): Hit[] {
  const hits: Hit[] = []
  for (const file of walk(SRC, ['.vue', '.ts'])) {
    if (file.endsWith('noNativeSelect.spec.ts')) continue   // 本文件自带样例
    const src = readFileSync(file, 'utf8')
    const ranges = commentRanges(src)
    for (const [what, re] of PATTERNS) {
      for (const m of src.matchAll(re)) {
        const at = m.index!
        if (ranges.some(([a, b]) => at >= a && at < b)) continue   // 注释里提到它不算违规
        const before = src.slice(Math.max(0, at - 400), at)
        hits.push({
          file: file.slice(SRC.length + 1).replace(/\\/g, '/'),
          what,
          line: src.slice(0, at).split('\n').length,
          allowed: ALLOW.exec(before)?.[1]?.trim() ?? null,
        })
      }
    }
  }
  return hits
}

describe('禁原生 select', () => {
  it('❗全仓 .vue / .ts 里零个原生 select(含自闭合、动态组件 :is、渲染函数 h()、createElement 四种写法)', () => {
    const offenders = scan()
      .filter((h) => h.allowed === null || !hasReason(h.allowed))
      .map((h) => `${h.file}:${h.line} ${h.what}`)
    expect(offenders).toEqual([])
  })

  it('❗记名放行必须写理由(规范 §1 的例外条款:可以留,但要说为什么)', () => {
    const blank = scan()
      .filter((h) => h.allowed !== null && !hasReason(h.allowed))
      .map((h) => `${h.file}:${h.line} 放行了但没写理由`)
    expect(blank).toEqual([])
  })

  it('❗ds/Select.vue 自己还在(门禁不是靠把替代品也删掉来过的)', () => {
    const sel = readFileSync(join(SRC, 'components', 'ds', 'Select.vue'), 'utf8')
    expect(sel).toMatch(/aria-haspopup="listbox"/)
  })
})
