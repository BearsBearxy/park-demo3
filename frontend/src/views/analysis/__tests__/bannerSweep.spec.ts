// 横条收尾(2026-10-03,实现规范 §2「横条盘点」CockpitView:551 / FinCashflowView:314)。
// 两屏挂载要喂十几个分析接口,这里钉模板与样式原文(同 meterNarrow / isHintS 的源码钉法):
//   · 驾驶舱:2026-10 改稿把卡内黄条整个拿掉(原来钉的是负收入月提示的 32px 预留位);
//   · 收缴欠费弹层:切「按家族」不再多出一段说明,同一行副句按口径换文案,家族怎么算挂「按家族」的悬停说明。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (f: string) => readFileSync(join(__dirname, '..', f), 'utf8')
const tpl = (src: string) => (src.match(/<template>([\s\S]*)<\/template>/)?.[1] ?? '').replace(/<!--[\s\S]*?-->/g, '')

// 驾驶舱那一段 2026-10 改稿删掉:新稿把满宽黄条、结论条、卡内黄条都拿掉了(cv2-changes 第 1 条),负收入月提示不再上屏。
describe('驾驶舱 · 卡内不再有黄条', () => {
  it('❗没有 FPNote(负收入月提示),也没有它的预留位', () => {
    const t = tpl(read('CockpitView.vue'))
    expect(t).not.toContain('FPNote')
    expect(t).not.toContain('cv2-onote')
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
