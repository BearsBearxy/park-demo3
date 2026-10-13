/* Copyright (c) 2026 Junyang. All rights reserved. */
// 共享件(导入中心改稿 T9 / T6):行高亮 fp-row-flash、FPSortableTable 的 flashKey / sortable:false / end 列、
// useFitRows 的 min、FPAlertChip 的量词。
import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import FPSortableTable from '../FPSortableTable.vue'
import FPAlertChip from '../FPAlertChip.vue'
import { useFitRows } from '../useFitRows'

const read = (p: string) => readFileSync(join(__dirname, '../../..', p), 'utf8').replace(/\r\n/g, '\n')
const COLS = [
  { key: 'name', header: '名称' },
  { key: 'n', header: '行数', sortable: false },
  { key: 'go', header: '', end: true, render: () => '去看' },
]
const ROWS = [{ id: 1, name: '甲', n: 3 }, { id: 2, name: '乙', n: 4 }, { id: 3, name: '丙', n: 5 }]
const anim = (name: string) => Object.assign(new Event('animationend', { bubbles: true }), { animationName: name })

describe('motion.css · fp-row-flash', () => {
  const css = read('styles/motion.css')
  // 破坏验证:关键帧写上 to { background: #fff } → 第一句红(暗色下褪到白);减动效那条删掉 → 第二句红(2s 被压成 1ms)
  it('❗只写 from(浅蓝),时长 --dur-highlight;减少动态效果时顶回 2s', () => {
    expect(css).toMatch(/@keyframes fp-row-flash \{\s*from \{ background-color: var\(--accent-blue\); \}\s*\}/)
    expect(css).toMatch(/\.fp-row-flash \{ animation: fp-row-flash var\(--dur-highlight\) var\(--ease-standard\); \}/)
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'))
    expect(reduced).toMatch(/\.fp-row-flash \{ animation-duration: var\(--dur-highlight\) !important; \}/)
  })
})

describe('FPSortableTable', () => {
  // 破坏验证:isFlash 恒 false → 红;只认单个 key 不认数组 → 第二段红
  it('❗flashKey 命中的行挂 fp-row-flash(单个或一组)', async () => {
    const w = mount(FPSortableTable, { props: { columns: COLS, rows: ROWS, flashKey: 2 } })
    const flashed = () => w.findAll('tbody tr').map(t => t.classes().includes('fp-row-flash'))
    expect(flashed()).toEqual([false, true, false])
    await w.setProps({ flashKey: [1, 3] })
    expect(flashed()).toEqual([true, false, true])
    await w.setProps({ flashKey: null })
    expect(flashed()).toEqual([false, false, false])
  })

  // 破坏验证:onFlashEnd 不看 animationName → 第一句红(格子里别的动画一结束就把高亮清了)
  it('❗只有 fp-row-flash 那个动画结束才 emit flashEnd', async () => {
    const w = mount(FPSortableTable, { props: { columns: COLS, rows: ROWS, flashKey: 2 } })
    const tr = w.findAll('tbody tr')[1].element
    tr.dispatchEvent(anim('fp-pop-in'))
    expect(w.emitted('flashEnd')).toBeUndefined()
    tr.dispatchEvent(anim('fp-row-flash'))
    expect(w.emitted('flashEnd')).toHaveLength(1)
  })

  // 破坏验证:sortable:false 仍走 renderSortHeader → 那一格多出排序触发器 → 红
  it('sortable:false 的列表头只写字,不出排序', () => {
    const w = mount(FPSortableTable, { props: { columns: COLS, rows: ROWS } })
    const ths = w.findAll('thead th')
    expect(ths[0].find('[role="button"]').exists()).toBe(true)
    expect(ths[1].find('[role="button"]').exists()).toBe(false)
    expect(ths[1].text()).toBe('行数')
  })

  // 破坏验证:end 列前不放空列 / 行尾仍多一格空列 → 红
  it('❗end 列贴右:表头、骨架行、数据行的空列都挪到它前面,每行只有一格', () => {
    const w = mount(FPSortableTable, { props: { columns: COLS, rows: ROWS, skeletonRows: 1 } })
    for (const tr of w.findAll('tr')) {
      const cells = tr.findAll('th, td')
      expect(cells.at(-2)!.classes()).toContain('fp-fill')
      expect(cells.at(-1)!.classes()).not.toContain('fp-fill')
      expect(tr.findAll('.fp-fill')).toHaveLength(1)
    }
  })
})

describe('useFitRows · min', () => {
  // jsdom 的 clientHeight 在 Element.prototype 上恒 0;这里在 HTMLElement.prototype 上盖一层,用完删掉
  afterEach(() => { delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight })
  const fit = async (hgt: number, min?: number) => {
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => hgt })
    const C = defineComponent({ setup() {
      const el = ref<HTMLElement | null>(null)
      const n = min == null ? useFitRows(el, 56, 10) : useFitRows(el, 56, 10, min)
      return () => h('div', { ref: el, 'data-n': n.value })
    } })
    const w = mount(C)
    await nextTick()
    return Number(w.attributes('data-n'))
  }
  // 破坏验证:measure 里不把 min 传给 fitRows → 8 那句变 6 → 红
  it('❗矮卡片:不给 min 钳到 6,给 8 钳到 8;放得下更多时照算', async () => {
    expect(await fit(200)).toBe(6)
    expect(await fit(200, 8)).toBe(8)
    expect(await fit(1000, 8)).toBe(17)   // (1000 − 表头兜底 36) / 56 = 17.2
  })
})

describe('FPAlertChip · unit', () => {
  // 破坏验证:有态 / 筛选态任一处不写 unit → 红
  it('数后面写量词:「还差 5 样」,筛选态同样', () => {
    expect(mount(FPAlertChip, { props: { count: 5, label: '还差', unit: '样' } }).text()).toBe('还差 5 样')
    expect(mount(FPAlertChip, { props: { count: 5, label: '还差', unit: '样', active: true } }).text()).toBe('还差 5 样')
    expect(mount(FPAlertChip, { props: { count: 5 } }).text()).toBe('待处理 5')
  })
})
