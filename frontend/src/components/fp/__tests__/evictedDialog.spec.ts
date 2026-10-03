import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import FPEvictedDialog from '@/components/fp/FPEvictedDialog.vue'
import type { Eviction } from '@/api/locks'
import type { EditStop } from '@/stores/ui'

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

  // 06-E 当场出现组「正在编辑的表被交审或审核通过」→ 同一个居中弹窗,写谁交审 / 谁审过
  const rv = (review: EditStop) =>
    mount(FPEvictedDialog, { props: { eviction: null, review }, global: { stubs: { Teleport: true } } })

  // 破坏验证:review 分支的 h3 改回接管那句 → 红;第二句恒写交审那句 → 红
  it('❗review 审核通过:标题写审核通过,正文写谁审的、哪张表,只有「知道了」', () => {
    const w = rv({ key: 'salary:2025-03', status: 'approved', by: '李审', what: '附表12 工资 · 2025-03' })
    expect(w.find('h3').text()).toContain('审核通过')
    expect(w.text()).toContain('李审')
    expect(w.text()).toContain('附表12 工资 · 2025-03')
    expect(w.find('.evd-note').text()).toBe('要再改，需审核员先撤销审核。')
    expect(w.text(), '不是接管,别借那句').not.toContain('接管')
    expect(w.findAll('button').map((b) => b.text())).toEqual(['知道了'])
  })

  // 破坏验证:h3 不分 status 恒写「已审核通过」→ 红;正文动词恒写「审核通过了」→ 红;第二句恒写撤销审核那句 → 红
  it('❗review 交审:标题写已交审,正文写谁交审了哪张表、怎么才能改', () => {
    const w = rv({ key: 'salary:2025-03', status: 'submitted', by: '张三', what: '附表12 工资 · 2025-03' })
    expect(w.find('h3').text()).toBe('这张表已交审')
    expect(w.find('.evd-lead').text()).toBe('张三 交审了「附表12 工资 · 2025-03」，你已退回浏览态。')
    expect(w.find('.evd-note').text()).toContain('请交审人撤回，或等审核员退回')
  })
})
