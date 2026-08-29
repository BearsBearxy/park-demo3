import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
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

describe('SchedHeader 强制退出带 forced 标(收口复查)', () => {
  it('❗换期强退 emit 的是 toggle-edit(true) —— 脏检查屏必须无条件退', async () => {
    // 附表10/损益表把 @toggle-edit 绑在带脏检查的函数上:普通 emit 在 dirty>0 时
    // 会被「保存确认」吞掉,edit 恒真 —— 而锁已经还了,确认框里的「保存」是无锁写。
    // forced=true 是「锁没了」的信号,接收方必须放弃询问直接退。
    const w = mk({ scope: 'sched:pv:2025' })
    await w.find('.lc-lockbtn').trigger('click')     // 占锁进编辑
    await flushPromises()
    await w.setProps({ edit: true })
    await w.setProps({ scope: 'sched:pv:2026' })     // 编辑态里换期 → 强退
    await flushPromises()

    const calls = w.emitted('toggle-edit')!
    expect(calls.at(-1), '强制退出必须带 forced=true').toEqual([true])
  })

  it('用户自己点「完成」不是强制 —— 脏检查屏该有机会问一句', async () => {
    const w = mk({ scope: 'sched:pv:2025' })
    await w.find('.lc-lockbtn').trigger('click')
    await flushPromises()
    await w.setProps({ edit: true })
    await w.find('.lc-lockbtn').trigger('click')     // 点「完成」
    await flushPromises()
    expect(w.emitted('toggle-edit')!.at(-1), '用户主动退出 forced=false').toEqual([false])
  })

  it('❗附表10/损益表的接收端真的处理 forced —— 源码钉(挂载太重,函数是组件内部的)', () => {
    for (const rel of ['../../../views/sales-income/S10View.vue', '../../../views/reports/pnl/PnlScheduleView.vue']) {
      const src = readFileSync(join(__dirname, rel), 'utf8')
      expect(/(?:finishEdit|toggleEdit)\(forced = false\)/.test(src), `${rel} 的处理函数不收 forced`).toBe(true)
      expect(src.includes('if (forced)'), `${rel} 没有 forced 直退分支 —— 强退会被脏检查吞掉`).toBe(true)
    }
  })
})

describe('SchedHeader copyText 透传(被接管的「复制我的改动」)', () => {
  // FPEvictedDialog 是 Teleport to body —— 查它必须桩掉 teleport(mk 没桩,这里本地挂)
  const mkT = (extra: Record<string, unknown> = {}) => mount(SchedHeader, {
    props: {
      icon: 'wallet', title: '附表12 · 工资明细', year: 2025,
      edit: false, perm: 'entry:edit', scope: 'sched:salary:2025-03', ...extra,
    },
    global: { stubs: { teleport: true } },
  })

  it('❗有草稿 + 传了 copyText → 被接管弹窗给复制的路,点了真拿到序列化文本', async () => {
    // 草稿在各屏,页头只递话:不透传的话被踢的人只看到「你丢了 N 处改动」然后关门。
    const w = mkT({ dirty: 3, copyText: () => 'A\tB\n1\t2' })
    await w.find('.lc-lockbtn').trigger('click')
    await flushPromises()
    await w.setProps({ edit: true })

    // 心跳带回被接管(锁 mock 的 put 返回 evictions)
    vi.mocked(api.put).mockResolvedValue({
      users: [],
      evictions: [{ scope: 'sched:salary:2025-03', by: 'lisi', byDisplayName: '李四', authorizerName: null }],
    } as never)
    const { usePresenceStore } = await import('@/stores/presence')
    await usePresenceStore().ping()
    await flushPromises()

    expect(w.find('.evd-scrim').exists(), '前提:被接管弹窗开了').toBe(true)
    expect(w.find('.evd-draft').exists(), '复制块必须在 —— 只给数字不给出路等于关门').toBe(true)
    expect(w.find('.evd-cnt').text()).toBe('3')

    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    await w.find('.evd-draft button').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith('A\tB\n1\t2')
    vi.unstubAllGlobals()
  })

  it('没传 copyText 的屏照旧不显示复制块(即时落库的 5 屏没有草稿可复制)', async () => {
    const w = mkT({ dirty: 0 })
    await w.find('.lc-lockbtn').trigger('click')
    await flushPromises()
    await w.setProps({ edit: true })
    vi.mocked(api.put).mockResolvedValue({
      users: [],
      evictions: [{ scope: 'sched:salary:2025-03', by: 'lisi', byDisplayName: '李四', authorizerName: null }],
    } as never)
    const { usePresenceStore } = await import('@/stores/presence')
    await usePresenceStore().ping()
    await flushPromises()
    expect(w.find('.evd-scrim').exists()).toBe(true)
    expect(w.find('.evd-draft').exists()).toBe(false)
  })

  it('❗S10 与损益表真的把 copyText 绑上了(挂载太重,绑定用源码钉)', () => {
    for (const [rel, fn] of [
      ['../../../views/sales-income/S10View.vue', 'draftAsTsv'],
      ['../../../views/reports/pnl/PnlScheduleView.vue', 'draftAsTsv'],
    ] as const) {
      const src = readFileSync(join(__dirname, rel), 'utf8')
      expect(src.includes(`:copy-text="${fn}"`), `${rel} 没把序列化器绑给 SchedHeader`).toBe(true)
      expect(src.includes(`function ${fn}`), `${rel} 没有序列化器`).toBe(true)
    }
  })
})
