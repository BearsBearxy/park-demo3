/* Copyright (c) 2026 Junyang. All rights reserved. */
import { mount } from '@vue/test-utils'
import { describe, it, expect, afterEach } from 'vitest'
import FPPager from '../FPPager.vue'

// 破坏验证:onKey 去掉 `&& open.value` → 收着也吞 Esc → 第一条红
describe('FPPager · Esc', () => {
  const seen: string[] = []
  const onWin = (e: KeyboardEvent) => seen.push(e.key)
  afterEach(() => { window.removeEventListener('keydown', onWin); seen.length = 0 })

  it('❗跳页浮层收着时不吞 Esc:同页弹窗(window keydown)照样收得到', () => {
    const w = mount(FPPager, { props: { page: 1, pageCount: 9, total: 67 }, attachTo: document.body })
    window.addEventListener('keydown', onWin)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(seen).toEqual(['Escape'])
    w.unmount()
  })

  it('跳页浮层开着时 Esc 只关它自己,不往外传', async () => {
    const w = mount(FPPager, { props: { page: 1, pageCount: 9, total: 67 }, attachTo: document.body })
    ;(w.vm as unknown as { open: boolean }).open = true
    await w.vm.$nextTick()
    window.addEventListener('keydown', onWin)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(seen).toEqual([])
    expect((w.vm as unknown as { open: boolean }).open).toBe(false)
    w.unmount()
  })
})
