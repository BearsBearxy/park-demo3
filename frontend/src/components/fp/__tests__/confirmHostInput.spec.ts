import { describe, it, expect, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import FPConfirmHost from '../FPConfirmHost.vue'
import { askText, askQueue, answer } from '@/utils/ask'

// askText(2026-10-09,园区抄表倒走保存前问原因用):没写字主按钮不能点,写了回填去掉首尾空白的字,取消回 null
describe('FPConfirmHost 带输入框', () => {
  afterEach(() => { while (askQueue.length) answer(false) })

  it('没写字不能点;写了回填文字;取消回 null', async () => {
    const w = mount(FPConfirmHost, { attachTo: document.body })
    const p = askText({ title: '写一下原因再保存', action: '保存', input: { label: '原因' } })
    await nextTick(); await nextTick()
    const act = () => document.querySelectorAll<HTMLButtonElement>('.fch-f button')[1]
    expect(act().disabled).toBe(true)
    const input = document.querySelector<HTMLInputElement>('.fch-card input')!
    input.value = '  换表 '
    input.dispatchEvent(new Event('input'))
    await nextTick()
    expect(act().disabled).toBe(false)
    act().click()
    expect(await p).toBe('换表')

    const q = askText({ title: '写一下原因再保存', action: '保存', input: { label: '原因' } })
    await nextTick(); await nextTick()
    document.querySelectorAll<HTMLButtonElement>('.fch-f button')[0].click()
    expect(await q).toBeNull()
    w.unmount()
  })
})
