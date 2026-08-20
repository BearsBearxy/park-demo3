// CSS 设计令牌门禁:引用了但从未定义的 var(--x) 就红。
//
// 立此门禁的原因(2026-08-20 视觉规范审计):催缴单屏有 10 处引用了本仓根本不存在的令牌
// (--accent / --text-tertiary / --border / --fs-sm),已上线很久没人发现。因为这类错误
// **三道现有门禁全抓不到**:
//   · vue-tsc 不看 CSS;
//   · vitest 的 jsdom 不做 CSS 变量求值;
//   · 浏览器遇到未定义的 var() 不报错,按 CSS 规范静默回退到「属性初始值」——
//     color 退成继承色、border-color 退成 currentColor、background 退成 transparent。
// 于是表现是「这个徽标的蓝色没生效」「这个按钮没有边框」,看起来像设计没做好,而不像 bug。
// 只有「引用集合 − 定义集合」这种全量比对能抓,所以它必须是一道机器门禁而不是 code review 项。
//
// 零新依赖,只用 node 内置模块(与 size-check.mjs / precompress.mjs 同口径)。
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = join(fileURLToPath(new URL('../src', import.meta.url)))

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(vue|css|ts)$/.test(e)) out.push(p)
  }
  return out
}

const files = walk(SRC)
const defined = new Set()
for (const f of files) {
  for (const m of readFileSync(f, 'utf8').matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)) defined.add(m[1])
}

// 两类合法的「看起来未定义」,必须排除,否则门禁天天误报:
//   ① var(--x, 兜底值) —— 作者已显式给了回退,是有意的渐进增强(如 AnaEChart 的 var(--surface-1, var(--surface-sunken)));
//   ② var(--accent-${tint}) 这类模板字符串拼出来的名字 —— 实际解析成 --accent-slate/sky/blue/cyan,静态扫不出。
const WITH_FALLBACK = /var\(\s*--[a-zA-Z0-9_-]+\s*,/
const bad = []
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n')
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/g)) {
      if (defined.has(m[1])) continue
      if (WITH_FALLBACK.test(line.slice(m.index))) continue     // ①
      if (line.includes('${')) continue                          // ②
      bad.push(`${f.slice(SRC.length + 1).replace(/\\/g, '/')}:${i + 1}  ${m[1]}`)
    }
  })
}

if (bad.length) {
  console.error(`\n✗ 引用了未定义的 CSS 令牌 ${bad.length} 处:\n`)
  for (const b of bad) console.error('  ' + b)
  console.error('\n  修法:去 src/styles/tokens.css 查正确的令牌名(常见错配:')
  console.error('  --accent→--hue-blue / --border→--border-subtle / --text-tertiary→--text-muted / --fs-sm→--fs-label)。')
  console.error('  确需新令牌就加进 tokens.css,别在消费方写字面量。\n')
  process.exit(1)
}
console.log(`✓ CSS 令牌:${defined.size} 个已定义,引用全部有落点`)
