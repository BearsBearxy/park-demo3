// 横条收尾(2026-10-03,实现规范 §2「横条盘点」CockpitView:551 / FinCashflowView:314)。
// 两屏挂载要喂十几个分析接口,这里钉模板与样式原文(同 meterNarrow / isHintS 的源码钉法):
//   · 驾驶舱主图卡的负收入月提示:常驻 32px 预留位(空时透明),不再 v-if 顶开 —— 骨架那枚占位 FPNote 换真版式时卡不缩;
//   · 收缴欠费弹层:切「按家族」不再多出一段说明,同一行副句按口径换文案,家族怎么算挂「按家族」的悬停说明。
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8')
const tpl = (src: string) => (src.match(/<template>([\s\S]*)<\/template>/)?.[1] ?? '').replace(/<!--[\s\S]*?-->/g, '')
const css = (src: string) => [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n')

describe('驾驶舱 · 负收入月提示常驻预留位', () => {
  const src = read('CockpitView.vue')
  let style: HTMLStyleElement
  beforeAll(() => { style = document.createElement('style'); style.textContent = css(src); document.head.appendChild(style) })
  afterAll(() => style.remove())

  // 破坏验证:外壳改回 <FPNote v-if="outlierNoteText"> 直接挂 / .cv2-onote 的 min-height 删掉 → 红
  it('❗外壳常驻、FPNote 只在壳里出没;壳高 32 + 下边 8 = 骨架那枚占位 FPNote 的 32 + 8', () => {
    const t = tpl(src)
    expect(t).toContain('<div class="cv2-onote"><FPNote v-if="outlierNoteText" tone="warn">{{ outlierNoteText }}</FPNote></div>')
    expect(t.match(/v-if="outlierNoteText"/g), '只有壳里那一处').toHaveLength(1)
    // 骨架:占位 FPNote 自身 min-height 32(FPNote.vue)+ margin-bottom 8
    expect(t).toContain('<FPNote class="ana-hole" tone="warn" style="margin-bottom: 8px">')
    const el = document.createElement('div')
    el.className = 'cv2-onote'
    document.body.appendChild(el)
    const cs = getComputedStyle(el)
    expect([cs.minHeight, cs.marginBottom]).toEqual(['32px', '8px'])
    el.remove()
  })
})

describe('收缴欠费弹层 · 按家族的说明并进副句', () => {
  const t = tpl(read('FinCashflowView.vue'))
  const src = read('FinCashflowView.vue')

  // 破坏验证:把 v-if="famOn" 那段说明加回来 → 红
  it('❗弹层里只有一行副句,按口径换文案;不再有 famOn 才出的第二段', () => {
    expect(t.match(/class="fin-modal-sub"/g)).toHaveLength(1)
    expect(t).not.toMatch(/v-if="famOn"[^>]*class="fin-modal-sub"/)
    expect(t).toContain("单位 万元{{ famOn ? ' · 家族合计可能小于逐户合计' : '' }}</div>")
    expect(t, '库字段名不上屏').not.toContain('parent_id')
  })

  // 破坏验证:「按家族」上的 v-tip 删掉 → 红
  it('❗家族怎么算的全文挂在弹层「按家族」的悬停说明上', () => {
    expect(t).toContain('<button :class="{ on: famOn }" v-tip="FAM_TIP" @click="famOn = true">按家族</button>')
    expect(src).toContain("const FAM_TIP = '家族 = 租户管理里关联在一起的户。按家族汇总时成员的流水合并后再算,"
      + "某个成员的预收 / 多收会抵减其他成员的欠费(同一个实际客户),所以家族合计可能小于逐户合计。'")
  })
})
