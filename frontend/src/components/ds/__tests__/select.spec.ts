// ds/Select 的两件事(2026-09-20 补):选同值不派发 change、键盘按标准 combobox 走。
// 起因是把最后两处原生 <select> 换成它时的对抗复查 —— 原生给的语义和键盘操作,自绘的这边缺了一半,
// 而 34 个调用点都是照着原生的脾气写的(ParamCenterView 的 setExKey 重选同一项会清空已填的值,
// TemplateEditorPanel 的版本切换会走一次真写服务端的 pin)。
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import Select from '../Select.vue'

const OPTS = ['北京', '上海', 'Berlin', 'Boston', '广州']

function mk(props: Record<string, unknown> = {}) {
  return mount(Select, { props: { options: OPTS, ...props }, attachTo: document.body })
}
const trigger = (w: ReturnType<typeof mk>) => w.find('button.ds-sel-trigger')
const opts = (w: ReturnType<typeof mk>) => w.findAll('button.ds-sel-opt')
const activeLabel = (w: ReturnType<typeof mk>) => w.find('button.ds-sel-opt[data-active]').text()

describe('ds/Select · 选同值不发事件', () => {
  it('❗点中的还是当前这项:不发 change、不发 update:modelValue(原生的 select 就是这个语义)', async () => {
    const w = mk({ modelValue: '上海' })
    await trigger(w).trigger('click')
    await opts(w).find((o) => o.text() === '上海')!.trigger('click')
    expect(w.emitted('change')).toBeUndefined()
    expect(w.emitted('update:modelValue')).toBeUndefined()
    w.unmount()
  })

  it('❗换一项就照常发(上一条不是恒真),面板同样关上', async () => {
    const w = mk({ modelValue: '上海' })
    await trigger(w).trigger('click')
    await opts(w).find((o) => o.text() === '广州')!.trigger('click')
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['广州'])
    expect(w.emitted('change')?.[0]?.[1]).toBe('广州')
    expect(opts(w).length, '选完面板要关').toBe(0)
    w.unmount()
  })

  it('❗选同值也要把面板关掉(不发事件不等于当没点)', async () => {
    const w = mk({ modelValue: '上海' })
    await trigger(w).trigger('click')
    await opts(w).find((o) => o.text() === '上海')!.trigger('click')
    expect(opts(w).length).toBe(0)
    w.unmount()
  })
})

describe('ds/Select · 键盘(标准 combobox)', () => {
  it('❗合上时 ↑ ↓ Enter 空格都能展开,活动项落在当前选中项上', async () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', ' ']) {
      const w = mk({ modelValue: 'Berlin' })
      await trigger(w).trigger('keydown', { key })
      expect(opts(w).length, `${key} 应该展开`).toBe(OPTS.length)
      expect(activeLabel(w), `${key} 展开后活动项应落在当前选中项`).toBe('Berlin')
      w.unmount()
    }
  })

  it('❗展开后 ↓ ↑ 移动活动项,到头绕回去', async () => {
    const w = mk({ modelValue: '北京' })          // 第 0 项
    await trigger(w).trigger('keydown', { key: 'ArrowDown' })
    expect(activeLabel(w)).toBe('北京')
    await trigger(w).trigger('keydown', { key: 'ArrowDown' })
    expect(activeLabel(w)).toBe('上海')
    await trigger(w).trigger('keydown', { key: 'ArrowUp' })
    expect(activeLabel(w)).toBe('北京')
    await trigger(w).trigger('keydown', { key: 'ArrowUp' })
    expect(activeLabel(w), '第一项再往上要绕到最后一项').toBe('广州')
    w.unmount()
  })

  it('❗Home / End 跳首尾', async () => {
    const w = mk({ modelValue: '上海' })
    await trigger(w).trigger('keydown', { key: 'ArrowDown' })
    await trigger(w).trigger('keydown', { key: 'End' })
    expect(activeLabel(w)).toBe('广州')
    await trigger(w).trigger('keydown', { key: 'Home' })
    expect(activeLabel(w)).toBe('北京')
    w.unmount()
  })

  it('❗Enter 选中活动项并发事件', async () => {
    const w = mk({ modelValue: '北京' })
    await trigger(w).trigger('keydown', { key: 'ArrowDown' })   // 展开,活动项=北京
    await trigger(w).trigger('keydown', { key: 'ArrowDown' })   // → 上海
    await trigger(w).trigger('keydown', { key: 'Enter' })
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['上海'])
    expect(opts(w).length, '选完面板要关').toBe(0)
    w.unmount()
  })

  it('❗首字母跳转:敲 b 在 Berlin / Boston 之间轮转,合上时敲字母直接展开并跳过去', async () => {
    const w = mk({ modelValue: '北京' })
    await trigger(w).trigger('keydown', { key: 'b' })           // 合着敲 → 展开 + 跳
    expect(opts(w).length).toBe(OPTS.length)
    expect(activeLabel(w)).toBe('Berlin')
    await trigger(w).trigger('keydown', { key: 'b' })
    expect(activeLabel(w), '连敲同一个字母要在同首字母的项之间轮转').toBe('Boston')
    w.unmount()
  })

  it('❗Tab 把面板收掉,但不拦截(焦点照常往后走)', async () => {
    const w = mk()
    await trigger(w).trigger('keydown', { key: 'ArrowDown' })
    expect(opts(w).length).toBe(OPTS.length)
    const e = { key: 'Tab' }
    await trigger(w).trigger('keydown', e)
    expect(opts(w).length, 'Tab 走掉后不许留一块浮层').toBe(0)
    w.unmount()
  })

  it('❗焦点离开整个下拉就关', async () => {
    const w = mk()
    await trigger(w).trigger('keydown', { key: 'ArrowDown' })
    expect(opts(w).length).toBe(OPTS.length)
    await w.find('div').trigger('focusout', { relatedTarget: document.body })
    expect(opts(w).length).toBe(0)
    w.unmount()
  })

  it('❗禁用时键盘一律不响应', async () => {
    const w = mk({ disabled: true })
    // 绕开 test-utils 的 trigger():它对带 disabled 的元素直接不派发,那样这条断言是空跑的
    // (实测:把组件里的 disabled 闸去掉,用 trigger() 写的版本照样绿)。真浏览器也不会给
    // disabled 按钮发 keydown,所以组件里那道闸是第二层保险 —— 但保险也得能测出来。
    trigger(w).element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    await w.vm.$nextTick()
    expect(opts(w).length).toBe(0)
    w.unmount()
  })
})

describe('ds/Select · ARIA(标准 combobox 形状)', () => {
  it('❗触发器是 combobox,指向面板与活动项;选项不各自可聚焦', async () => {
    const w = mk({ modelValue: '上海' })
    const t = trigger(w)
    expect(t.attributes('role')).toBe('combobox')
    expect(t.attributes('aria-haspopup')).toBe('listbox')      // 门禁 noNativeSelect.spec 钉的就是这个
    expect(t.attributes('aria-expanded')).toBe('false')
    const panelId = t.attributes('aria-controls')
    expect(panelId).toBeTruthy()
    expect(t.attributes('aria-activedescendant'), '合着的时候不指任何项').toBeUndefined()

    await t.trigger('keydown', { key: 'ArrowDown' })
    expect(trigger(w).attributes('aria-expanded')).toBe('true')
    expect(w.find('[role="listbox"]').attributes('id')).toBe(panelId)
    const active = w.find('button.ds-sel-opt[data-active]')
    expect(trigger(w).attributes('aria-activedescendant')).toBe(active.attributes('id'))
    expect(active.attributes('aria-selected')).toBe('true')
    for (const o of opts(w)) expect(o.attributes('tabindex'), '选项不进 Tab 序,焦点留在触发器上').toBe('-1')
    w.unmount()
  })
})
