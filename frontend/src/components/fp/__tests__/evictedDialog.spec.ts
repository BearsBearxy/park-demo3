import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FPEvictedDialog from '@/components/fp/FPEvictedDialog.vue'
import type { Eviction } from '@/api/locks'

/**
 * 被接管/失锁弹窗的两种口吻(2026-08-30 第三轮复查:此前**零测试挂载过它**,
 * 把 by=null 分支整体回退成无条件「{{byDisplayName}} 接管了…」时 1718 条照样全绿)。
 */
describe('FPEvictedDialog', () => {
  const at = (eviction: Eviction | null) =>
    mount(FPEvictedDialog, {
      props: { open: true, eviction, what: '2026-08 期' },
      global: { stubs: { Teleport: true } },
    })

  it('有接管者:说清被谁接管、经谁授权', () => {
    const w = at({ scope: 's', by: 'lisi', byDisplayName: '李四', authorizerName: '张主管' })
    expect(w.text()).toContain('李四')
    expect(w.text()).toContain('接管了')
    expect(w.text()).toContain('张主管')
  })

  it('❗没有接管者的失锁(锁蒸发/别处还掉)不许渲染「被  接管」', () => {
    // 后端派生的兜底通知 by=null:后端重启锁蒸发、同人另一页签还锁、陈旧被清。
    const w = at({ scope: 's', by: null, byDisplayName: null, authorizerName: null })
    expect(w.text()).toContain('编辑锁已失效')
    expect(w.text(), '空名字的「 接管了」是句破话').not.toContain('接管了')
    // 指引不许把人引向丢草稿:没接 copyText 的屏,重进时草稿被整份重新快照
    expect(w.text()).toContain('重新录入')
    expect(w.text()).not.toContain('即可继续')
  })
})
