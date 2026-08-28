import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'

import SchedHeader from '@/components/sched/SchedHeader.vue'
import { useAuthStore } from '@/stores/auth'
import api from '@/api'

/**
 * SchedHeader 是**第二套**编辑锁实现。
 *
 * 附表族 7 屏的编辑态由各屏自己持有(`edit` 是 prop),锁在这个组件里 acquire/release ——
 * 它不走 `useEditMode`。所以 2026-08-29 在 useEditMode 里补的那条「换期就还锁」
 * 覆盖不到这 7 屏,得在这里再补一遍。
 *
 * 会踩到的实际动作(三处都在编辑态里就地换 scope):
 *   · 附表13/14 顶部 Segmented 切子表 → `S.utilities(no, year)` 的 no 变
 *   · 附表12 月胶囊换月           → `S.salary(year, month)` 的 month 变
 *   · 四屏「新增记账」存的是别的年 → 屏静默跳年,`S.pv(year)` 之类跟着变
 *
 * 不修的后果是**会丢数据**:人在 5 月编辑、手里却握着 3 月的锁,
 * 于是 5 月对别人显示「无人编辑」,两个人能同时改同一个月,后保存的赢。
 */

vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve({ granted: true, holder: null })),
    put: vi.fn(() => Promise.resolve({ evicted: null })),
    delete: vi.fn(() => Promise.resolve()),
  },
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

function mk(props: Record<string, unknown> = {}) {
  return mount(SchedHeader, {
    props: {
      icon: 'wallet', title: '附表12 · 工资明细', year: 2025,
      edit: false, perm: 'entry:edit', scope: 'sched:salary:2025-03',
      ...props,
    },
  })
}

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  vi.clearAllMocks()
  useAuthStore().permissions = ['entry:edit']
})

describe('SchedHeader 编辑锁', () => {
  /** 编辑模式按钮就是 .lc-lockbtn(锁位长在它身上,设计稿 §05) */
  const press = async (w: ReturnType<typeof mk>) => {
    await w.find('.lc-lockbtn').trigger('click')
    await flushPromises()
  }

  it('进编辑态先占锁', async () => {
    const w = mk()
    await press(w)
    expect(api.post).toHaveBeenCalledWith('/locks/sched:salary:2025-03')
    expect(w.emitted('toggle-edit')).toHaveLength(1)
  })

  it('❗编辑态里 scope 变了 → 还旧锁 + 请上层退出编辑态', async () => {
    // edit=false 起步,按一下真的占到 3 月那把锁,再让上层把 edit 翻上去
    const w = mk({ edit: false })
    await press(w)
    await w.setProps({ edit: true })
    vi.mocked(api.delete).mockClear()

    await w.setProps({ scope: 'sched:salary:2025-05' })
    await nextTick()
    await flushPromises()

    expect(api.delete, '还的必须是**旧**那把').toHaveBeenCalledWith('/locks/sched:salary:2025-03')
    expect(w.emitted('toggle-edit'), '请上层退出编辑态(edit 是 prop,组件自己改不了)')
      .toHaveLength(2)   // 1 = 进编辑态那次,2 = 换期请求退出
  })

  it('浏览态换 scope 什么都不做 —— 没进编辑态就没有锁可还', async () => {
    const w = mk({ edit: false })
    await w.setProps({ scope: 'sched:salary:2025-05' })
    await nextTick()
    expect(api.delete).not.toHaveBeenCalled()
    expect(w.emitted('toggle-edit')).toBeUndefined()
  })

  it('scope 没变就不动 —— 别把无关的重渲当成换期', async () => {
    const w = mk({ edit: false })
    await press(w)
    await w.setProps({ edit: true })
    vi.mocked(api.delete).mockClear()

    await w.setProps({ year: 2026 })   // 别的 prop 变,scope 不变
    await nextTick()
    expect(api.delete).not.toHaveBeenCalled()
  })

  it('不上锁的屏(scope=null)不受影响', async () => {
    const w = mk({ edit: true, scope: null })
    await w.setProps({ scope: null, year: 2026 })
    await nextTick()
    expect(api.delete).not.toHaveBeenCalled()
    expect(w.emitted('toggle-edit')).toBeUndefined()
  })
})
