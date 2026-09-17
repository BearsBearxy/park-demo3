// 「旧版本的条目不给去看看」这条规矩(VERSION-UPDATE-SPEC §4)。
// 单独一个文件:真实 changelog 里旧版本**碰巧**一条 `to` 都没有,拿它断言等于空转
// (夹具不许用退化数据)。这里换成一份两版都带 `to` 的夹具。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { useUpdateStore } from '@/stores/update'

const push = vi.fn()
vi.mock('vue-router', () => ({
  useRoute: () => ({ meta: {}, path: '/data-home' }),
  useRouter: () => ({ push }),
}))
vi.mock('@/api', () => ({
  default: {
    get: vi.fn(() => Promise.resolve([])),
    post: vi.fn(() => Promise.resolve([])),
    put: vi.fn(() => Promise.resolve({ users: [] })),
    delete: vi.fn(() => Promise.resolve()),
  },
  readToken: vi.fn(() => 'test-token'),
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))
// 当前版本 = 夹具第一段;store 与组件都读这个模块。
vi.mock('@/changelog', () => {
  const CHANGELOG = [
    { version: '9.9.9', date: '2026-09-18', headline: '当前版本', added: [{ icon: 'sun', title: '新屏甲', desc: '说明', to: 'tenants' }], improved: [], fixed: [] },
    { version: '9.8.0', date: '2026-08-01', headline: '上一版', added: [{ icon: 'sun', title: '旧屏乙', desc: '说明', to: 'contracts' }], improved: [], fixed: [] },
  ]
  return { CHANGELOG, APP_VERSION: '9.9.9', noteOf: (v: string) => CHANGELOG.find((n) => n.version === v) }
})

import ChangelogDialog from '../ChangelogDialog.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  localStorage.clear()
  document.body.innerHTML = ''
  push.mockClear()
  const auth = useAuthStore()
  auth.me = 'zhou'
  useUpdateStore().loadSeen()
})

describe('更新记录 · 旧版本的条目', () => {
  it('当前版本的条目有「去看看」,切到旧版本后没有', async () => {
    const w = mount(ChangelogDialog, { attachTo: document.body })
    expect(document.querySelectorAll('.cl-lnk').length).toBe(1)

    document.querySelectorAll('.cl-item')[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(document.querySelector('.cl-vv')!.textContent).toContain('v9.8.0')
    expect(document.querySelectorAll('.cl-row').length).toBe(1)   // 条目在(不是整段没渲染)
    expect(document.querySelectorAll('.cl-lnk').length).toBe(0)   // 只是不给跳
    w.unmount()
  })

  it('点旧版本的条目不跳转也不关窗', async () => {
    const w = mount(ChangelogDialog, { attachTo: document.body })
    document.querySelectorAll('.cl-item')[1].dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    document.querySelector('.cl-row')!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()
    expect(push).not.toHaveBeenCalled()
    expect(w.emitted('close')).toBeFalsy()
    w.unmount()
  })
})
