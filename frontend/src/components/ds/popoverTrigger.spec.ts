// 复现云上账号菜单点不开:最小化验证 Popover trigger 点击 → 面板渲染
import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import Popover from './Popover.vue'

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
})
