// 复现云上账号菜单点不开:最小化验证 Popover trigger 点击 → 面板渲染
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Popover from './Popover.vue'
import { ask, answer, askQueue } from '@/utils/ask'

describe('Popover trigger', () => {
  it('非受控:点 trigger 开面板,含 style 覆盖 prop 时同样生效', async () => {
    const w = mount(Popover, {
      props: { width: 200, style: { top: 'auto', bottom: 'calc(100% + 8px)', left: '0' } },
      slots: { trigger: '<button class="t">头像</button>', default: '<div class="menu">菜单</div>' },
    })
    expect(w.find('.menu').exists()).toBe(false)
    await w.find('.t').trigger('click')
    expect(w.find('.menu').exists()).toBe(true)
    const dialog = w.find('[role="dialog"]')
    expect(dialog.attributes('style')).toContain('bottom')
  })

  // 问题面板组头动作先 ask:确认弹窗 Teleport 在 body,点它的按钮对 Popover 是「点外面」。
  // 面板一关,批量重算的逐月进度(只画在面板里)全程看不见。
  // 破坏验证:Popover.onDoc 去掉 askQueue 那一行 → 第一段红
  it('❗确认弹窗开着时点它,面板不关;答完再点外面才关', async () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    const w = mount(Popover, {
      attachTo: document.body,
      slots: { trigger: '<button class="t">问题</button>', default: '<div class="menu">进度</div>' },
    })
    await w.find('.t').trigger('click')
    const pending = ask({ title: '重算这 2 个月？', action: '重算 2 个月' })
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await w.vm.$nextTick()
    expect(w.find('.menu').exists(), '点确认弹窗把面板关了').toBe(true)

    answer(true)
    await pending
    expect(askQueue).toHaveLength(0)
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await w.vm.$nextTick()
    expect(w.find('.menu').exists(), '没有确认弹窗时点外面照常关').toBe(false)
    w.unmount(); outside.remove()
  })
})
