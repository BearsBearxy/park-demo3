// 审核状态提示的**接线**门禁(SIDEBAR-UX-REDESIGN §7.5,2026-09-08 补漏)。
//
// 规范明写:已交审 / 已审核的月,编辑按钮位要换成同尺寸的禁用提示
// (「待审核 · 已交审」/「已审核 · 李审 03-05」)。组件那一半 R2 就写好了 ——
// FPEditModeButton 上有 reviewNote / reviewTip 两个 prop。
//
// **但没有一个屏往里传值。** 那一支从上线到今天一次都没渲染过,是死代码。
// 结果:计费参数 / 园区抄表 / 公共电核算 / 催缴单这几屏,在已审核的月点「编辑模式」
// 什么都不会发生 —— 不报错、不提示、不变样。挡是挡住了(useEditMode 里那句 return),
// 但用户不知道为什么,只能当界面坏了。
//
// 为什么原有的测试拦不住:useEditMode.spec 断的是 composable 的返回值
// (`m.reviewNote.value`),那一半一直是对的。漏的是**组件有没有拿到它**,
// 而这件事只有渲染层或源码层看得见。
//
// 判据落在源码而不是渲染:这 5 屏没有一个有组件测试(要挂载它们得铺一大堆 API 桩),
// 为一句 prop 铺挂载脚手架不划算 —— 而源码门禁恰好能覆盖「以后新写的屏也不许漏」。
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'

const SRC = resolve(__dirname, '../..')

function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) collect(p, out)
    else if (p.endsWith('.vue')) out.push(p)
  }
  return out
}

/** 声明了审核键的屏 = 它的编辑按钮会被审核态挡住 = 它必须把状态说给用户听。 */
const DECLARES_KEY = /\breviewKey\s*:/
/** 屏上那颗按钮。只认这一个组件 —— SchedHeader / LedgerWideTable 走的是自己的另一条路。 */
const USES_BUTTON = /<FPEditModeButton\b/

describe('声明了审核键的屏,必须把审核状态传给编辑按钮', () => {
  const files = collect(join(SRC, 'views'))

  it('确实扫到了屏', () => {
    expect(files.length, '扫不到 .vue 就等于这份门禁没跑').toBeGreaterThanOrEqual(40)
  })

  // ❗破坏验证:把任一屏模板上的 :review-note 删掉 → 红并点名是哪个屏。
  //   这正是 R2 上线时的状态 —— 五个屏一个都没传,而当时全绿。
  it('❗用 FPEditModeButton 且声明了 reviewKey 的屏,模板里必须传 review-note', () => {
    const bad: string[] = []
    let checked = 0
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      if (!USES_BUTTON.test(src) || !DECLARES_KEY.test(src)) continue
      checked++
      if (!/:review-note=/.test(src)) bad.push(relative(SRC, f))
    }
    // 防空扫:判据是两条正则的交集,任一条哪天不匹配了,这份门禁会一声不吭地全绿。
    expect(checked, '没扫到任何「声明了审核键 + 用了这颗按钮」的屏 —— 判据失效了').toBeGreaterThanOrEqual(5)
    expect(bad,
      `这些屏声明了审核键、却没把审核状态传给编辑按钮。表现是:已审核的月点「编辑模式」\n`
      + `什么都不会发生 —— 挡住了但不说为什么。改法:从 useEditMode 解构 reviewNote / reviewTip,\n`
      + `在模板上传 :review-note="reviewNote" :review-tip="reviewTip"。\n${bad.join('\n')}`)
      .toEqual([])
  })

  // reviewTip 是那句「撤销审核需审核员」,少了它用户知道改不了但不知道去找谁。
  it('❗tip 也要传 —— 只说「已审核」不说找谁撤销,等于把人晾在那', () => {
    const bad: string[] = []
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      if (!/:review-note=/.test(src)) continue
      if (!/:review-tip=/.test(src)) bad.push(relative(SRC, f))
    }
    expect(bad, `传了 review-note 就要一起传 review-tip:\n${bad.join('\n')}`).toEqual([])
  })
})
