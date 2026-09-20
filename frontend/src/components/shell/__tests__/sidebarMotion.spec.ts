// 收起 / 打开导航的动效(2026-09-20 用户要求):宽屏内联侧栏宽度 0 ↔ 235 过渡;窄屏浮层侧栏横向滑出 + 淡入,关闭反着走。
// jsdom 不跑 CSS 过渡、test-utils 默认把 <Transition> 换成直出,所以钉的是源码:包了哪个 Transition、那几条类写了什么。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'

// 统一成 LF:下面的选择器里写死了 \n,而 Windows 上检出的工作区是 CRLF(.gitattributes 没锁),
// 不规范化的话同一份源码在 Linux 上绿、在 Windows 上红。
const src = readFileSync(join(__dirname, '..', 'AppShell.vue'), 'utf8').replace(/\r\n/g, '\n')
const rule = (sel: string) => src.match(new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'))?.[1] ?? ''

describe('收起 / 打开导航的动效', () => {
  it('❗宽屏内联侧栏包在 <Transition name="fp-sb"> 里,宽度从 0 过渡到 235(分隔线 1 + 面板 234)', () => {
    expect(src).toMatch(/<Transition name="fp-sb">\s*<div v-if="ui\.sbOpen && tier === 'xl'" class="fp-sb-inline">/)
    expect(rule('.fp-sb-inline')).toMatch(/width:\s*235px/)
    expect(rule('.fp-sb-inline')).toMatch(/overflow:\s*hidden/)
    expect(rule('.fp-sb-enter-active,\n.fp-sb-leave-active')).toMatch(/transition:\s*width var\(--dur-base\)/)
    expect(rule('.fp-sb-enter-from,\n.fp-sb-leave-to')).toMatch(/width:\s*0/)
  })

  it('❗窄屏浮层侧栏包在 <Transition name="fp-sbf"> 里:打开从左滑出 + 淡入,关闭反着走(不再是瞬时消失)', () => {
    expect(src).toMatch(/<Transition name="fp-sbf">\s*<div v-if="floatActive" ref="floatEl" class="fp-sb-float">/)
    expect(rule('.fp-sbf-enter-active,\n.fp-sbf-leave-active')).toMatch(/opacity var\(--dur-base\).*transform var\(--dur-base\)/)
    const from = rule('.fp-sbf-enter-from,\n.fp-sbf-leave-to')
    expect(from).toMatch(/opacity:\s*0/)
    expect(from).toMatch(/transform:\s*translateX\(-8px\)/)
  })
})
