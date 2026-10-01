import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import FPLockDialogs from '@/components/fp/FPLockDialogs.vue'
import FPTakeoverDrawer from '@/components/fp/FPTakeoverDrawer.vue'
import { locksApi, type LockHolder } from '@/api/locks'

const holder: LockHolder = {
  user: 'lisi', displayName: '李四', heldMs: 60_000, idleMs: 1_000, idle: false,
}

// 两个弹窗都在 Teleport 里(FPEvictedDialog.vue:49 直接 Teleport;FPTakeoverDrawer 经
// FPDrawer.vue 的 Teleport)—— 不桩 teleport 一定找不到。
const mk = (props: Record<string, unknown>) => mount(FPLockDialogs, {
  props: { lockedBy: null, evictedBy: null, scope: null, what: '公共电核算 2024-02', ...props },
  global: { stubs: { teleport: true } },
})

// FPTakeoverDrawer 的 setup 里 useAuthStore() —— 没有活动 pinia 会当场炸
beforeEach(() => { setActivePinia(createPinia()) })

describe('FPLockDialogs', () => {
  it('❗lockedBy 非空 → 接管抽屉出现(这正是「按钮点了没反应」的解药)', () => {
    expect(mk({ lockedBy: holder, scope: 'billing-chain:2024-02' }).find('.tk-body').exists()).toBe(true)
  })

  it('❗scope 原样透传 —— 共占锁的 scopeNote 全靠它说出「一把锁管四个写面」', () => {
    const w = mk({ lockedBy: holder, scope: 'billing-chain:2024-02' })
    expect(w.findComponent(FPTakeoverDrawer).props('scope')).toBe('billing-chain:2024-02')
  })

  it('❗evictedBy 非空 → 失锁弹窗出现(这正是「静默踢出」的解药)', () => {
    const w = mk({ evictedBy: { scope: 'pv-meter:2025', by: 'lisi', byDisplayName: '李四', authorizerName: null } })
    expect(w.find('.evd-scrim').exists()).toBe(true)
  })

  it('不传 dirtyCount/copyText → 不出复制块(本次范围:只做提示,不做复制)', () => {
    const w = mk({ evictedBy: { scope: 'pv-meter:2025', by: 'lisi', byDisplayName: '李四', authorizerName: null } })
    expect(w.find('.evd-scrim').exists(), '前提:弹窗开着').toBe(true)
    expect(w.find('.evd-draft').exists()).toBe(false)
  })

  it('两个都为 null → 什么都不渲染', () => {
    const w = mk({})
    expect(w.find('.tk-body').exists()).toBe(false)
    expect(w.find('.evd-scrim').exists()).toBe(false)
  })
})

describe('FPTakeoverDrawer · 块内提示与字段报错', () => {
  const td = (h: LockHolder) => mount(FPTakeoverDrawer, {
    props: { holder: h, scope: 'billing-chain:2024-02', what: '公共电核算 2024-02' },
    global: { stubs: { teleport: true } },
  })

  it('持有人空闲:「未保存的内容要他自己复制走」是块内提示 FPNote 黄档', () => {
    const w = td({ ...holder, idle: true, idleMs: 25 * 60_000 })
    expect(w.find('.fp-note.warn').text()).toContain('他未保存的内容需要他自己复制走')
  })

  it('接管失败:错误落在常驻的 .fp-field-err 里,没出错时这一行也占着', async () => {
    const w = td({ ...holder, idle: true, idleMs: 25 * 60_000 })
    expect(w.find('.fp-field-err').exists(), '常驻占位:出错前就在').toBe(true)
    expect(w.find('.fp-field-err').text()).toBe('')
    const spy = vi.spyOn(locksApi, 'takeover').mockRejectedValueOnce({ message: '锁已被别人接走' })
    await w.findAll('button').find(b => b.text() === '确认接管')!.trigger('click')
    await flushPromises()
    expect(spy).toHaveBeenCalled()
    expect(w.find('.fp-field-err').text()).toBe('锁已被别人接走')
    spy.mockRestore()
  })
})
