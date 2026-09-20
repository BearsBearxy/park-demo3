// src/components/fp/__tests__/fpWideCards.spec.ts — S 档宽表卡片模板的几何门禁
// (响应式稿 WideCardVariants 板 §2「三种都满足的硬条件」逐条钉住)。
//
// 为什么钉几何而不是快照:稿把三档定高写进了「硬条件①定高——骨架卡与真卡同几何,
// 数据到的那一帧零位移」。定高一旦被改成 min-height 或被内容撑开,骨架就不再等高,
// 首帧切换会位移;那是个静默退步,没有断言就没人会发现。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import FPWideCards, { type WideCard } from '../FPWideCards.vue'
import { _resetViewportForTest } from '@/composables/useViewport'

// S 档桩:只让 ≤600 命中(jsdom 原生 matchMedia 一律 matches:false = 非 S 档 → 组件不出卡)
function asS() {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('max-width: 600px'), media: q,
    addEventListener() {}, removeEventListener() {},
  }))
  _resetViewportForTest()
}

const ROWS = [
  { id: 1, nm: '鑫诚精密科技', due: 148620, got: 148620 },
  { id: 2, nm: '嘉华新材料',   due: 96340,  got: 60000  },
]
// ⚠ 夹具不许退化:两行的收缴率必须一个满一个不满,否则「条宽跟着比值走」写死 100% 也绿。
const fields = (r: any): WideCard => ({
  name: r.nm,
  amount: '¥' + r.due.toLocaleString('en-US'),
  sub: `已收 ¥${r.got.toLocaleString('en-US')} · 收缴 ${Math.round((r.got / r.due) * 100)}%`,
  pill: r.got >= r.due ? { text: '已结清', tone: 'ok' } : { text: '欠 ¥36,340', tone: 'warn' },
  bar: Math.round((r.got / r.due) * 100),
})

beforeEach(asS)
afterEach(() => { vi.unstubAllGlobals(); _resetViewportForTest() })

describe('FPWideCards · S 档卡片模板', () => {
  it('❗三档定高 64 / 88 / 96 写在 CSS 里,不是被内容撑出来的', () => {
    const css = readFileSync(join(__dirname, '../FPWideCards.vue'), 'utf8')
    for (const [d, h] of [[64, 64], [88, 88], [96, 96]] as const) {
      expect(css, `d${d} 档定高丢了`).toMatch(new RegExp(`\\.fpwc-c\\.d${d}\\s*\\{\\s*height:\\s*${h}px`))
    }
    // min-height 会让内容把卡撑高,骨架就不再等高——稿硬条件①点名不许
    expect(css.match(/\.fpwc-c[^{]*\{[^}]*min-height/), 'd 档改成了 min-height').toBeNull()
  })

  it('❗骨架卡与真卡同一个 .fpwc-c 定高类,行数也一致(零位移的全部依据)', () => {
    const w = mount(FPWideCards, { props: { rows: ROWS, rowKey: 'id', fields, density: 88, skeletonRows: 3 } })
    const cards = w.findAll('.fpwc-c')
    expect(cards).toHaveLength(3 + ROWS.length)
    // 骨架 3 张 + 真卡 2 张,五张都挂 d88;骨架不许换一套类
    expect(cards.every(c => c.classes().includes('d88'))).toBe(true)
    // 88 档真卡三行四格:名字 + 状态胶囊 / 金额 / 次级句。骨架逐格占位,一格不少
    expect(w.findAll('.fpwc-c[aria-hidden] .fp-shim')).toHaveLength(3 * 4)
    // 64 档没有第二行大字,骨架也不许画它(多一条 20px 就多 20px 的位移)
    const w64 = mount(FPWideCards, { props: { rows: [], rowKey: 'id', fields, density: 64, skeletonRows: 2 } })
    expect(w64.findAll('.fpwc-c .amt-sk')).toHaveLength(0)
    expect(w64.findAll('.fpwc-c .fp-shim')).toHaveLength(2 * 3)
  })

  it('❗88 档金额独占第二行 mono 20;64 档没有第二行,金额贴第一行右端', () => {
    const w88 = mount(FPWideCards, { props: { rows: ROWS, rowKey: 'id', fields, density: 88 } })
    expect(w88.findAll('.fpwc-c > .amt')).toHaveLength(2)          // 每张卡一行独立金额
    expect(w88.findAll('.r1 .amt')).toHaveLength(0)
    expect(w88.findAll('.r1 .pill')).toHaveLength(2)               // 88 的第一行右端是状态胶囊

    const w64 = mount(FPWideCards, { props: { rows: ROWS, rowKey: 'id', fields, density: 64 } })
    expect(w64.findAll('.fpwc-c > .amt')).toHaveLength(0)
    expect(w64.findAll('.r1 .amt.sm')).toHaveLength(2)             // 64 的金额在第一行右端
    expect(w64.findAll('.pill')).toHaveLength(0)                   // 22px 胶囊塞不进两行
    expect(w64.findAll('.r2 .bal')).toHaveLength(2)                // 退成末行右端的 mono 数

    const css = readFileSync(join(__dirname, '../FPWideCards.vue'), 'utf8')
    expect(css).toMatch(/\.amt\s*\{[^}]*font-size:\s*20px/)
    expect(css).toMatch(/\.amt\.sm\s*\{[^}]*font-size:\s*14px/)
    // 硬条件③ 字号只取阶梯 20/14/12/11,不许出现小数字号
    const sizes = [...css.matchAll(/font-size:\s*([\d.]+)px/g)].map(m => m[1])
    expect(sizes.filter(s => !['20', '14', '12', '11', '6'].includes(s)), '字号越出阶梯').toEqual([])
  })

  it('❗96 档的条宽跟着比值走,并夹在 0–100(脏数据不许把条画出卡外)', () => {
    const w = mount(FPWideCards, { props: { rows: ROWS, rowKey: 'id', fields, density: 96 } })
    const widths = w.findAll('.bar i').map(e => (e.element as HTMLElement).style.width)
    expect(widths).toEqual(['100%', '62%'])

    const over = mount(FPWideCards, {
      props: {
        rows: [{ id: 9 }], rowKey: 'id', density: 96,
        fields: () => ({ name: 'x', amount: '¥1', bar: 380 } as WideCard),
      },
    })
    expect((over.find('.bar i').element as HTMLElement).style.width).toBe('100%')
  })

  it('❗整卡一个点击目标(触屏没有 hover,行内不许再放第二个可点件)', async () => {
    const w = mount(FPWideCards, { props: { rows: ROWS, rowKey: 'id', fields, density: 88 } })
    await w.findAll('.fpwc-c')[1].trigger('click')
    expect(w.emitted('rowClick')?.[0]?.[0]).toEqual(ROWS[1])
    expect(w.findAll('.fpwc-c button, .fpwc-c a, .fpwc-c input')).toHaveLength(0)
    // 点按反馈只能是 :active —— :hover 在触屏上要么不触发要么点完粘住
    const css = readFileSync(join(__dirname, '../FPWideCards.vue'), 'utf8')
    expect(css).toMatch(/\.fpwc-c:active/)
    expect(css.match(/\.fpwc-c[^{]*:hover/), '卡上写了 :hover').toBeNull()
  })

  it('❗宽档不出卡片(卡列只属于 S 档,别的档由调用方渲染原表)', () => {
    vi.unstubAllGlobals(); _resetViewportForTest()   // jsdom 原生 matchMedia → tier='xl'
    const w = mount(FPWideCards, { props: { rows: ROWS, rowKey: 'id', fields, density: 88, skeletonRows: 3 } })
    expect(w.findAll('.fpwc-c')).toHaveLength(0)
  })
})
