// 门禁:非测试源码里不许再弹浏览器原生确认 / 提示框(实现规范 §5;§1.1 结果回执、§1.2 确认弹窗)。
// 报成败 → utils/receipt.ts;问一句再动手 → utils/ask.ts 的 ask(),会丢未保存改动的 → askLeave();
// 字段填错 → 字段下面的 .fp-field-err。window.prompt 这次不管(规范 §4:⑨ 没有输入框)。
//
// 判据:window.confirm / window.alert(含 globalThis.)出现即违规;裸 confirm( / alert( 是调用即违规。
// 不算违规:注释里提到;`api.confirm(` 这类方法调用(前面有点);本文件自己声明了同名绑定
// (MeterAssignDialog 的 `async function confirm()`、ChangePasswordView 的 `const confirm = ref('')`)。
// ponytail: 同名绑定按整文件算、不分作用域 —— 同一文件里既有局部 confirm 又调全局 confirm 会漏;真碰上再按作用域细分。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '../..')   // frontend/src

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === '__tests__' || n === 'node_modules' ? [] : walk(p)
    if (p.endsWith('.spec.ts') || p.endsWith('test-setup.ts')) return []
    return p.endsWith('.ts') || p.endsWith('.vue') ? [p] : []
  })
}

/** 注释区间(照抄 noNativeSelect.spec:只算区间、不删字符)。 */
function commentRanges(s: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const re of [/<!--[\s\S]*?-->/g, /\/\*[\s\S]*?\*\//g, /(^|[^:])\/\/[^\n\r]*/g]) {
    for (const m of s.matchAll(re)) out.push([m.index!, m.index! + m[0].length])
  }
  return out
}

/** 一段源码里的违规处,`行号 原文`。 */
function offenders(src: string): string[] {
  const ranges = commentRanges(src)
  const inComment = (at: number) => ranges.some(([a, b]) => at >= a && at < b)
  const local = new Set([...src.matchAll(/\b(?:function\s*\*?\s*|(?:const|let|var)\s+)(confirm|alert)\b/g)].map((m) => m[1]))
  const out: string[] = []
  const hit = (at: number) => {
    const line = src.slice(0, at).split('\n').length
    out.push(`${line} ${src.split('\n')[line - 1].trim()}`)
  }
  for (const m of src.matchAll(/\b(?:window|globalThis)\.(?:confirm|alert)\b/g)) if (!inComment(m.index!)) hit(m.index!)
  for (const m of src.matchAll(/(?<![\w$.])(confirm|alert)\s*\(/g)) {
    if (!inComment(m.index!) && !local.has(m[1])) hit(m.index!)
  }
  return out
}

describe('禁原生 confirm / alert', () => {
  it('判据自检:该抓的抓到,方法调用 / 注释 / 同名局部绑定放过', () => {
    expect(offenders("if (!confirm('删?')) return\nalert('好了')\nwindow.confirm('x')\nglobalThis.alert")).toHaveLength(4)
    expect(offenders("api.confirm(1)\nclearConfirm()\n// alert('x')\n/* confirm('y') */\n<!-- alert('z') -->")).toEqual([])
    expect(offenders('async function confirm() {}\nconfirm()')).toEqual([])
    expect(offenders("const confirm = ref('')\nalert('x')")).toEqual(["2 alert('x')"])
  })

  it('❗非测试源码(.ts / .vue)里 window.confirm / window.alert / 裸 confirm( / alert( 为 0', () => {
    const files = walk(SRC)
    expect(files.length, '防空扫:src 下的 .ts / .vue 不该少于 400 个').toBeGreaterThan(400)
    const bad = files.flatMap((f) =>
      offenders(readFileSync(f, 'utf8')).map((h) => `${f.slice(SRC.length + 1).replace(/\\/g, '/')}:${h}`))
    expect(bad, bad.join('\n')).toEqual([])
  })
})
