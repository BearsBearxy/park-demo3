// FPMoreMenu 带字触发与红色项(画布 05-A「簿册 ▾」「导出 ▾」、04-B「…」里红字「批量删除本期」;实现规范 §1.9)
import { afterEach, describe, expect, it } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import FPMoreMenu, { type MoreItem } from '../FPMoreMenu.vue'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const books: MoreItem[] = [
  { key: 'company', label: '收款公司' }, { key: 'payee', label: '收款簿' }, { key: 'coef', label: '系数簿' },
]
const more: MoreItem[] = [
  { key: 'export', label: '导出当月', icon: 'download' },
  { key: 'tpl', label: '下载模板', icon: 'file-text' },
  { key: 'wipe', label: '批量删除本期', icon: 'trash-2', danger: true },
]

let w: VueWrapper | null = null
afterEach(() => { w?.unmount(); w = null })

describe('FPMoreMenu 带字触发', () => {
  it('传 label:触发钮就写这个字,带图标和 ▾', () => {
    w = mount(FPMoreMenu, { props: { label: '簿册', icon: 'book-open', items: books } })
    const t = w.find('.fp-more-lbl')
    expect(t.text()).toBe('簿册')
    expect(t.find('.lucide-book-open-icon').exists()).toBe(true)
    expect(t.find('.dd').exists()).toBe(true)
    expect(w.find('.fp-more-btn').exists()).toBe(false)
  })
  it('点带字触发钮出菜单,选一项 emit key 并收起', async () => {
    w = mount(FPMoreMenu, { props: { label: '簿册', items: books } })
    await w.find('.fp-more-lbl').trigger('click')
    expect(w.findAll('.fp-more-item').map(b => b.text())).toEqual(['收款公司', '收款簿', '系数簿'])
    await w.findAll('.fp-more-item')[1].trigger('click')
    expect(w.emitted('select')).toEqual([['payee']])
    expect(w.find('[role=menu]').exists()).toBe(false)
  })
  // 破坏验证:触发钮改回原生 title="更多操作" → 本条红(title 不再是 undefined、aria-label 没了)
  it('不传 label 保持「…」原样:悬停说明走 v-tip「更多操作」(无原生 title,读屏读 aria-label)', () => {
    w = mount(FPMoreMenu, { props: { items: more } })
    const b = w.find('.fp-more-btn')
    expect([b.attributes('title'), b.attributes('aria-label')]).toEqual([undefined, '更多操作'])
    expect(w.find('.fp-more-lbl').exists()).toBe(false)
  })
})

describe('FPMoreMenu 红色项', () => {
  it('danger 项带 danger 类,其余不带', async () => {
    w = mount(FPMoreMenu, { props: { items: more } })
    await w.find('.fp-more-btn').trigger('click')
    const items = w.findAll('.fp-more-item')
    expect(items.map(b => b.classes('danger'))).toEqual([false, false, true])
  })
})

// 画布 05-A「簿册 ▾」面板:约 220 宽、每项约 36 高、14 字(对抗复查 spec-8)
describe('FPMoreMenu 带字面板的尺寸', () => {
  // 破坏验证:.fp-more-pop.start 去掉 min-width 200 / 项高 36 / 字 14 → 各自那条红;图标 :size 写死 14 → 最后一条红
  it('至少 200 宽、每项 36 高、14 字、16 图标;「…」那一版不变', async () => {
    const src = readFileSync(join(__dirname, '..', 'FPMoreMenu.vue'), 'utf8')
    const s = document.createElement('style')
    s.textContent = [...src.matchAll(/^<style[^>]*>([\s\S]*?)^<\/style>/gm)].map(m => m[1]).join('\n')
    document.head.appendChild(s)
    try {
      w = mount(FPMoreMenu, { props: { label: '导出', icon: 'download', items: more }, attachTo: document.body })
      await w.find('.fp-more-lbl').trigger('click')
      const pop = getComputedStyle(w.find('.fp-more-pop').element)
      const item = getComputedStyle(w.find('.fp-more-item').element)
      expect(pop.minWidth).toBe('200px')
      expect([item.height, item.fontSize]).toEqual(['36px', 'var(--fs-body)'])
      expect(w.find('.fp-more-item svg').attributes('width')).toBe('16')
      w.unmount()
      w = mount(FPMoreMenu, { props: { items: more }, attachTo: document.body })
      await w.find('.fp-more-btn').trigger('click')
      expect(getComputedStyle(w.find('.fp-more-pop').element).minWidth, '「…」仍是 148').toBe('148px')
      expect(w.find('.fp-more-item svg').attributes('width')).toBe('14')
    } finally { s.remove() }
  })
})
