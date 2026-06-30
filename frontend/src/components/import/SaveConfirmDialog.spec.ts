import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import SaveConfirmDialog from './SaveConfirmDialog.vue'

function mountDialog(count = 3) {
  return mount(SaveConfirmDialog, { props: { count } })
}

describe('SaveConfirmDialog', () => {
  it('显示改动处数', () => {
    const w = mountDialog(5)
    expect(w.find('.scd-body').text()).toContain('5')
  })

  it('保存修改 → emit save', async () => {
    const w = mountDialog()
    const btns = w.findAll('.scd-f button')
    await btns[1].trigger('click')   // [放弃][保存] → 保存是第二个
    expect(w.emitted('save')).toBeTruthy()
  })

  it('放弃修改 → emit discard', async () => {
    const w = mountDialog()
    const btns = w.findAll('.scd-f button')
    await btns[0].trigger('click')
    expect(w.emitted('discard')).toBeTruthy()
  })

  it('× 关闭 → emit close', async () => {
    const w = mountDialog()
    await w.find('.scd-x').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
  })
})
