// 重点卡在「本次更新」和「更新记录」里的「去看看」(VERSION-UPDATE-SPEC §2 / §4)。
// 用假数据:真数据的当前版本可能根本没有能跳的条目(小调整版),正路径得自己造。「❗」开头的做过破坏验证。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import type { ReleaseNote } from '@/types/changelog'

const FIXTURE: ReleaseNote[] = vi.hoisted(() => [
  {
    version: '0.16.0', date: '2026-10-10', headline: '新增台账导出',
    feature: { icon: 'download', title: '台账导出', desc: '一键导出本月台账。', to: 'ledger' },
    added: [{ icon: 'users', title: '租户批量改', desc: '一次改多户。', to: 'tenants' }], improved: [], fixed: [],
  },
  {
    version: '0.15.0', date: '2026-10-01', headline: '新增表计',
    feature: { icon: 'gauge', title: '表计', desc: '新屏。', to: 'meters' }, added: [], improved: [], fixed: [],
  },
])
vi.mock('@/changelog', async (orig) => {
  const real = await orig<typeof import('@/changelog')>()
  return { ...real, CHANGELOG: FIXTURE, APP_VERSION: '0.16.0', noteOf: (v: string) => FIXTURE.find((n) => n.version === v) }
})
const push = vi.fn()
vi.mock('vue-router', () => ({ useRouter: () => ({ push }), useRoute: () => ({ path: '/home' }) }))
vi.mock('@/components/fp/GradientWave.vue', () => ({ default: { name: 'GradientWaveStub', render: () => null } }))
vi.mock('@/api', () => ({
  default: { post: vi.fn(() => Promise.resolve(undefined)), delete: vi.fn(() => Promise.resolve(undefined)) },
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

import { useAuthStore } from '@/stores/auth'
import { useUpdateStore } from '@/stores/update'
import WhatsNewDialog from '../WhatsNewDialog.vue'
import ChangelogDialog from '../ChangelogDialog.vue'

function login() {
  useAuthStore().me = 'zhou'
  const upd = useUpdateStore()
  upd.loadSeen()
  return upd
}
const click = async (el: Element) => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await nextTick() }

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  push.mockClear()
  document.body.innerHTML = ''
})

describe('重点卡的「去看看」', () => {
  it('❗更新记录:当前版本的重点卡点「去看看」就跳并关窗', async () => {
    login()
    const w = mount(ChangelogDialog, { attachTo: document.body })
    await click(document.querySelector('.cl-detail .rfc .rfc-lnk')!)
    expect(push).toHaveBeenCalledWith('/ledger')
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('更新记录:当前版本「新增」里能跳的行点了就跳', async () => {
    login()
    const w = mount(ChangelogDialog, { attachTo: document.body })
    const row = [...document.querySelectorAll('.cl-row')].find((r) => r.querySelector('.t')?.textContent === '租户批量改')!
    await click(row)
    expect(push).toHaveBeenCalledWith('/tenants')
    w.unmount()
  })

  it('❗更新记录:旧版本的重点卡照样出(带配图位),但不给「去看看」', async () => {
    login()
    const w = mount(ChangelogDialog, { attachTo: document.body })
    await click(document.querySelectorAll('.cl-item')[1])
    expect(document.querySelector('.cl-detail .rfc h3')!.textContent).toBe('表计')
    expect(document.querySelector('.rfc-lnk')).toBeNull()
    w.unmount()
  })

  it('本次更新:重点卡点「去看看」= 看过了并跳过去', async () => {
    const upd = login()
    const w = mount(WhatsNewDialog, { attachTo: document.body })
    await click(document.querySelector('.rfc .rfc-lnk')!)
    expect(push).toHaveBeenCalledWith('/ledger')
    expect(upd.seen).toBe('0.16.0')
    w.unmount()
  })
})
