// 密码框不许用自托管的 Roboto Mono 子集(2026-09-20 手机实测:iPhone Safari 上密码框是一排黑竖条)。
// 根因:iOS WebKit 用 U+25CF BLACK CIRCLE 画掩码点,子集字体里没有这个字形,而掩码字符不走
// 「缺字形就往后一族找」的逐字回退 —— 直接画 .notdef 方框。见 tokens.css 的 --font-ui。
// jsdom 不加载字体、更不做掩码,所以这里钉的是源码:字体栈里有没有 webfont、每个遮罩框有没有写这一行。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '')
const TOKENS = strip(readFileSync(join(SRC, 'styles', 'tokens.css'), 'utf8'))
const BASE = strip(readFileSync(join(SRC, 'styles', 'base.css'), 'utf8'))

/** 本仓自托管的 @font-face 族名(带引号写在 font-family 里的那些)。 */
const WEBFONTS = [...TOKENS.matchAll(/@font-face\s*\{[^}]*?font-family:\s*"([^"]+)"/g)].map((m) => m[1])

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) return n === 'node_modules' ? [] : walk(p)
    return p.endsWith('.vue') ? [p] : []
  })
}

describe('密码框字体', () => {
  it('❗自托管子集确实存在,且 --font-ui 里一个 webfont 族都不带(带了就等于没修)', () => {
    expect(WEBFONTS).toContain('Roboto Mono')
    const ui = TOKENS.match(/--font-ui:\s*([^;]+);/)?.[1] ?? ''
    expect(ui).toBeTruthy()
    for (const f of WEBFONTS) expect(ui).not.toContain(f)
    expect(ui).toContain('-apple-system')   // iOS 上第一顺位必须是系统字体
  })

  it('❗base.css 把所有 type="password" 的框换成 --font-ui,且带 !important(组件 scoped 样式特异度更高)', () => {
    const rule = BASE.match(/input\[type="password"\][^{]*\{([^}]*)\}/)?.[1] ?? ''
    expect(rule).toMatch(/font-family:\s*var\(--font-ui\)\s*!important/)
  })

  it('❗用 -webkit-text-security 遮罩的框(type="text",选不中上面那条)各自写了 --font-ui', () => {
    const offenders: string[] = []
    for (const file of walk(SRC)) {
      const css = strip(readFileSync(file, 'utf8'))
      // 从遮罩声明往前找到它所在规则的 `{`,再往后到 `}` —— 同一条规则里必须有 font-ui
      for (const m of css.matchAll(/-webkit-text-security:\s*disc/g)) {
        const open = css.lastIndexOf('{', m.index!)
        const close = css.indexOf('}', m.index!)
        if (!/font-family:\s*var\(--font-ui\)/.test(css.slice(open, close))) {
          offenders.push(file.slice(SRC.length + 1).replace(/\\/g, '/'))
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
