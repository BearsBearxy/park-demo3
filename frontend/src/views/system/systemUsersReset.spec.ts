// 用户管理 · 重置密码分自己和别人(用户 2026-10-04:「在系统用户管理里面重置密码后，到登录的时候又要强制改一遍」)。
// 给自己重置:不用再改,服务端回这台设备接着用的新令牌,本机换上;给别人重置:该账号下次登录须改。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

const ROLES = [{ id: 1, code: 'admin', name: '系统管理员', builtin: true, navLayers: ['data'], perms: ['system:edit'], userCount: 1, remark: null }]
const USERS = [
  { id: 1, username: 'admin', displayName: '系统管理员', status: 1, mustChangePassword: false, roles: [ROLES[0]], createdAt: '2026-01-05T09:30:00' },
  { id: 2, username: 'zhang.kj', displayName: '张会计', status: 1, mustChangePassword: false, roles: [], createdAt: '2026-03-11T14:02:00' },
]
// 后端口径:重置自己的回新令牌,别人的回 null
const resetPassword = vi.fn((id: number) => Promise.resolve({ token: id === 1 ? 'fresh' : null }))

vi.mock('@/api/system', () => ({
  systemApi: {
    users: () => Promise.resolve(USERS),
    roles: () => Promise.resolve(ROLES),
    resetPassword: (id: number) => resetPassword(id),
  },
}))

import SystemUsersView from './SystemUsersView.vue'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  document.body.innerHTML = ''
  resetPassword.mockClear()
  setActivePinia(createPinia())
  localStorage.setItem('token', 'old')
  const auth = useAuthStore()
  auth.permissions = ['system:view', 'system:edit']
  auth.me = 'admin'
})

async function resetRow(username: string) {
  const w = mount(SystemUsersView)
  await flushPromises()
  const row = w.findAll('tr').find((r) => r.text().includes(username))!
  await row.findAll('button').find((b) => b.text() === '重置密码')!.trigger('click')
  const dlg = () => document.body.querySelector<HTMLElement>('.fin-dlg')!
  const before = dlg().querySelector('.fin-dlg-h p')!.textContent
  const input = dlg().querySelector<HTMLInputElement>('input.su-in')!
  input.value = 'new-pass-12'
  input.dispatchEvent(new Event('input'))
  ;[...dlg().querySelectorAll('button')].find((b) => b.textContent?.trim() === '重置')!.click()
  await flushPromises()
  return { before, after: dlg().querySelector('.fin-dlg-h p')!.textContent }
}

describe('重置密码:自己 / 别人', () => {
  // 破坏验证:submitReset 去掉 `if (r?.token) auth.setToken(r.token)` → 令牌断言红;pwSelf 恒假 → 文案断言红
  it('❗给自己重置:说明写不用再改、本机保持登录;换上新令牌;完成写「下次登录用新密码」', async () => {
    const { before, after } = await resetRow('admin')
    expect(before).toBe('为你自己的账号设一个新密码。提交后不用再改,这台设备保持登录。')
    expect(resetPassword).toHaveBeenCalledWith(1)
    expect(useAuthStore().token).toBe('fresh')
    expect(localStorage.getItem('token')).toBe('fresh')
    expect(after).toBe('你的密码已重置,下次登录用新密码。')
  })

  // 破坏验证:pwSelf 恒真 → 文案断言红
  it('给别人重置:照旧写该账号下次登录须修改密码;本机令牌不动', async () => {
    const { before, after } = await resetRow('zhang.kj')
    expect(before).toBe('为「张会计(zhang.kj)」设一个新密码。提交后该账号下次登录须修改密码。')
    expect(useAuthStore().token).toBe('old')
    expect(after).toBe('「张会计」的密码已重置,该账号下次登录须修改密码。')
  })
})
