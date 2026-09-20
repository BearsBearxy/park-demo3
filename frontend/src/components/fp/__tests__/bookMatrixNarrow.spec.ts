/**
 * 选期矩阵的窄档降列(RESPONSIVE-LAYOUT-SPEC §5.8,2026-09-21 拍板)。
 *
 * 钉五件事:
 *   ① 三档列数:XL 仍是 `repeat(12, 1fr)` 一字不动(9 个屏共用,1440 零差异是 §9 硬标准)、
 *      M 档 6 列、S 档 4 列。
 *   ② 新写的列数一律 `minmax(0, 1fr)` 而不是裸 `1fr` —— `1fr` 等价 `minmax(auto, 1fr)`,
 *      auto 那一侧隐含 min-width:auto,列缩不到内容宽以下(12 张月卡 748px vs 盒子 242px,
 *      右边 7~9 个月整块出屏)。这条连同源码里那段注释一起钉,注释掉了下一个人又会写裸 1fr。
 *   ③ 层叠顺序:960 块在 600 块之前。写反了 S 档 4 列被 M 档 6 列静默盖回 ——
 *      不报错、不告警,只有屏上能看出来,所以位置必须进断言。
 *   ④ 「移除年份」在 `(hover: none)` 下 DOM 里有且可见(不是 opacity:0 / display:none);
 *      `(hover: hover)` 下恢复现状(行 hover 才显)。两种都断。
 *   ⑤ 年标落点:S/M 档独占一行(18 高、左对齐、月卡整行换到第二行),XL 档仍在 56px 左槽右对齐。
 *
 * 为什么读源码字面量:jsdom 不做布局(元素宽恒 0)、也不参与 @media 求值,
 * 挂载后量宽在这里只能得到恒真表达式。断言的是「规则写在哪个媒体条件下、按什么源序排」,
 * 那正是本轮改的东西。DOM 侧只断它管得了的:格子数、有数/空月、移除钮在不在。
 */
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mediaBlock } from '@/test-utils/mediaBlock'

import BookMonthMatrix from '@/components/fp/BookMonthMatrix.vue'
import { usePresenceStore } from '@/stores/presence'

const SRC = readFileSync(join(__dirname, '..', 'BookMonthMatrix.vue'), 'utf8').replace(/\r\n/g, '\n')

const Q960 = '@media (max-width: 960px)'
const Q600 = '@media (max-width: 600px)'
const QTOUCH = '@media (hover: none)'

/** 媒体块外的规则 = 任何档位都生效的基础层(也就是 XL / hover:hover 看到的那一份) */
const OUTSIDE = SRC.replace(/@media[^{]*\{(?:[^{}]|\{[^{}]*\})*\}/g, '')

describe('§5.8 ① 三档列数', () => {
  it('XL(媒体块外)仍是 repeat(12, 1fr) —— 宽档一个像素不许动', () => {
    expect(OUTSIDE).toContain('grid-template-columns: repeat(12, 1fr);')
    // 反向:降列没有被写到媒体块外去(写外面 = 桌面也降列 = §9 回归)
    expect(OUTSIDE).not.toContain('repeat(6,')
    expect(OUTSIDE).not.toContain('repeat(4,')
  })

  it('M 档(960 块)6 列', () => {
    const block = mediaBlock(SRC, Q960)
    expect(block, '960 块整个不见了').not.toBe('')
    expect(block).toContain('grid-template-columns: repeat(6, minmax(0, 1fr));')
  })

  it('S 档(600 块)4 列 —— 4 是能同时认出五样标记的最窄一档', () => {
    const block = mediaBlock(SRC, Q600)
    expect(block, '600 块整个不见了').not.toBe('')
    expect(block).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));')
  })
})

describe('§5.8 ② 新列数用 minmax(0, 1fr),不是裸 1fr', () => {
  it('960 / 600 两块里的 grid-template-columns 全是 minmax(0, 1fr)', () => {
    const decls = [Q960, Q600].flatMap((q) => {
      const block = mediaBlock(SRC, q)
      expect(block, `${q} 块取不到,下面的 filter 会恒为空`).not.toBe('')
      return [...block.matchAll(/grid-template-columns:[^;]+;/g)].map((m) => m[0])
    })
    // 先断「真的选到了东西」—— 选择器写错时 filter 恒空,这条就成了恒真
    expect(decls).toHaveLength(2)
    for (const d of decls) {
      expect(d).toContain('minmax(0, 1fr)')
      expect(d, `裸 1fr 隐含 min-width:auto,列缩不下去: ${d}`).not.toMatch(/repeat\(\d+,\s*1fr\)/)
    }
  })

  it('源码里写清了「1fr 隐含 min-width:auto」—— 注释掉了下一个人又写裸 1fr', () => {
    expect(SRC).toContain('minmax(auto, 1fr)')
    expect(SRC).toContain('min-width:auto')
  })
})

describe('§5.8 ③ 层叠顺序:960 块在 600 块之前', () => {
  it('按字符下标:960 < 600(写反了 S 档 4 列被静默盖回 6 列)', () => {
    const at960 = SRC.indexOf(Q960)
    const at600 = SRC.indexOf(Q600)
    expect(at960).toBeGreaterThan(-1)
    expect(at600).toBeGreaterThan(-1)
    expect(at600).toBeGreaterThan(at960)
  })

  it('只用了 600 / 960 两个断点值(§1 唯一事实源,野断点不许新增)', () => {
    const widths = [...SRC.matchAll(/@media\s*\(max-width:\s*(\d+)px\)/g)].map((m) => Number(m[1]))
    expect(widths.length).toBeGreaterThan(0)
    expect([...new Set(widths)].sort((a, b) => a - b)).toEqual([600, 960])
  })
})

describe('§5.8 ④ 「移除年份」在触屏常驻(顺带修掉 §6.1 那一条)', () => {
  it('(hover: none) 块把 .bmm-rm 改成 display:inline-flex,且不是 opacity:0 / display:none', () => {
    const block = mediaBlock(SRC, QTOUCH)
    expect(block, 'hover:none 块整个不见了').not.toBe('')
    expect(block, '块里根本没提 .bmm-rm,下面两条否定断言会恒真').toContain('.bmm-rm')
    expect(block).toContain('.bmm-rm { display: inline-flex; }')
    expect(block).not.toContain('display: none')
    expect(block).not.toContain('opacity: 0')
  })

  it('(hover: none) 块排在基础 `.bmm-rm { display: none }` 之后 —— 同特异度靠源序赢', () => {
    const atBase = SRC.indexOf('.bmm-rm {\n  display: none;')
    const atTouch = SRC.indexOf(QTOUCH)
    expect(atBase, '基础那条 display:none 的写法变了,这条断言要跟着改').toBeGreaterThan(-1)
    expect(atTouch).toBeGreaterThan(atBase)
  })

  it('(hover: hover)恢复现状:基础层仍是「行 hover 才显」,触屏块没动 .bmm-yrow:hover', () => {
    expect(OUTSIDE).toContain('.bmm-rm {\n  display: none;')
    expect(OUTSIDE).toContain('.bmm-yrow:hover .bmm-rm { display: inline-flex; }')
    expect(mediaBlock(SRC, QTOUCH)).not.toContain('.bmm-yrow:hover')
  })

  it('DOM 里真有那颗钮(可移除的年才有)—— 常驻是 CSS 的事,先确认渲染这一层没丢', () => {
    const w = mkTwoYears()
    const btns = w.findAll('.bmm-rm')
    expect(btns).toHaveLength(1)
    expect(btns[0].text()).toContain('移除')
  })
})

describe('§5.8 ⑤ 年标落点', () => {
  it('XL:仍在 56px 左槽、右对齐', () => {
    expect(OUTSIDE).toContain('.bmm-ylabel {\n  flex: 0 0 56px;\n  text-align: right;\n}')
  })

  it('S/M:年标独占一行(18 高、左对齐),月卡整行换到第二行', () => {
    const block = mediaBlock(SRC, Q960)   // 600 ⊂ 960,S 档走的是同一份
    expect(block).toContain('.bmm-yrow { flex-wrap: wrap; }')
    expect(block).toContain('height: 18px;')
    expect(block).toContain('text-align: left;')
    expect(block).toContain('flex: 0 0 auto;')
    // 月卡整行 + 排到移除槽之后 = 第二行
    expect(block).toContain('.bmm-cells { flex: 0 0 100%; order: 2;')
    expect(block).toContain('.bmm-rm-slot { flex: 0 0 auto; order: 1; }')
  })

  it('600 块只管列数,年标那套不在里面重写一遍(两处写 = 改档时漏一处)', () => {
    const block = mediaBlock(SRC, Q600)
    expect(block).toContain('.bmm-cells')
    expect(block).not.toContain('.bmm-ylabel')
    expect(block).not.toContain('flex-wrap')
  })
})

/** 夹具:一年满 12 期(行数各不相同,不是退化的常数列)+ 一年只有 3 期且可移除 */
function mkTwoYears() {
  setActivePinia(createPinia())
  // 在场头像是五样标记之一,得真有人在编辑才画得出来 —— 只占 2024-01 一格
  usePresenceStore().users = [{
    sid: 's1', user: 'zhangsan', displayName: '张三', role: null,
    scope: 'bmm:2024-01', label: '台账', mode: 'edit', editScopes: ['bmm:2024-01'],
    sinceMs: 1000, idleMs: 0, self: false,
  }]
  const full = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    hasData: true,
    rowCount: 7 + i * 13,            // 7,20,33,… 逐月不同
    cur: i === 6,
    ...(i < 4 ? { pips: [true, true, i > 1, false] } : {}),
    ...(i === 0 ? { review: 'approved' as const } : {}),
  }))
  const sparse = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    hasData: i < 3,
    ...(i < 3 ? { rowCount: 2 + i * 5 } : {}),
  }))
  return mount(BookMonthMatrix, {
    props: {
      book: {},
      scopeOf: (y: number, m: number) => `bmm:${y}-${String(m).padStart(2, '0')}`,
      years: [
        { year: 2024, months: full },
        { year: 2025, months: sparse, sub: '手工年', removable: true },
      ],
    },
  })
}

describe('§5.8 夹具:两年都排得对(降列是 CSS 的事,DOM 恒 12 格)', () => {
  const w = mkTwoYears()
  const rows = w.findAll('.bmm-yrow:not(.bmm-addrow)')

  it('两个年行,各 12 格 —— 降列不许少画格子', () => {
    expect(rows).toHaveLength(2)
    expect(rows[0].findAll('.bmm-card')).toHaveLength(12)
    expect(rows[1].findAll('.bmm-card')).toHaveLength(12)
  })

  it('满的那年:12 格全是有数卡,行数各不相同(夹具不退化)', () => {
    const cards = rows[0].findAll('.bmm-card')
    expect(rows[0].find('.bmm-y').text()).toBe('2024')
    expect(cards.filter((c) => c.classes().includes('has'))).toHaveLength(12)
    expect(cards.filter((c) => c.classes().includes('blank'))).toHaveLength(0)
    // 前 4 格传了 pips,走工序点分支不画行数徽标(组件里那条 v-else-if 互斥链)
    expect(rows[0].findAll('.bmm-pips')).toHaveLength(4)
    const badges = rows[0].findAll('.bmm-count').map((b) => b.text())
    expect(badges).toHaveLength(8)
    expect(new Set(badges).size, '8 个徽标全一样 = 退化夹具,写死也绿').toBe(8)
  })

  it('只有几期的那年:3 有数 + 9 空月,且移除钮只挂在它身上', () => {
    const cards = rows[1].findAll('.bmm-card')
    expect(rows[1].find('.bmm-y').text()).toBe('2025')
    expect(cards.filter((c) => c.classes().includes('has'))).toHaveLength(3)
    expect(cards.filter((c) => c.classes().includes('blank'))).toHaveLength(9)
    expect(rows[1].findAll('.bmm-rm')).toHaveLength(1)
    expect(rows[0].findAll('.bmm-rm')).toHaveLength(0)
  })

  it('五样标记在满的那年都画得出来(4 列要同时认得出它们)', () => {
    const first = rows[0].findAll('.bmm-card')[0]
    expect(first.find('.bmm-month').text()).toBe('1月')            // ① 月份数字
    expect(first.classes()).toContain('has')                        // ② 有数没数
    expect(first.findAll('.bmm-pip')).toHaveLength(4)               // ③ 四颗工序点
    expect(first.find('.bmm-who').exists()).toBe(true)              // ④ 在场头像角标
    expect(first.find('.bmm-rv').exists()).toBe(true)               // ⑤ 审核角标
    // 反向:头像只挂在真有人在编辑的那一格(scopeOf 接线退化成按年 → 12 格全亮)
    expect(rows[0].findAll('.bmm-who')).toHaveLength(1)
    expect(rows[0].findAll('.bmm-card')[6].classes()).toContain('cur')
  })
})
