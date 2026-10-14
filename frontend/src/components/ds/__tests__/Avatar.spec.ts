/* Copyright (c) 2026 Junyang. All rights reserved. */
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import Avatar from '../Avatar.vue'

// 调用方用 class 画环(在场头像组 .pb-av、选期矩阵 .bmm-av、年份卡 .sm-yc-av)。
// 内联 box-shadow 压得过 class,所以不传 ring 时内联样式里不能有 box-shadow。
// 模板根上有一行注释,测试里 wrapper.element 是那条注释,所以取 span。
describe('Avatar 的环', () => {
  it('不传 ring:内联样式里没有 box-shadow,调用方 class 上的环才画得出来', () => {
    const w = mount(Avatar, { props: { name: '示例', uid: 'demo' }, attrs: { class: 'pb-av edit' } })
    const el = w.find('span')
    expect(el.attributes('style') ?? '').not.toContain('box-shadow')
    expect(el.classes()).toContain('pb-av')
  })

  it('ring=true:自带 2px 白环', () => {
    const w = mount(Avatar, { props: { name: '示例', ring: true } })
    expect(w.find('span').attributes('style') ?? '').toContain('box-shadow: 0 0 0 2px var(--surface-white)')
  })
})
