// 用户管理屏。钉三条会真出事的契约:
// ① 读全开(RBAC-SPEC §0):无 system:edit 时账号照常全部显示,只是没有新建/编辑/停用入口;
// ② 账号只停用不删除(§8):全屏不得出现「删除」二字,停用行数据照常显示、只加停用徽标;
// ③ 后端两条守卫(不能停用自己 / 用户名重复)要翻成人话,不能把原始报错糊到用户脸上。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'

const ROLES = [
  { id: 1, code: 'admin', name: '系统管理员', builtin: true, navLayers: ['data', 'reports', 'analysis'], perms: ['system:edit'], userCount: 1, remark: null },
  { id: 3, code: 'clerk', name: '财务专员', builtin: true, navLayers: ['data', 'reports', 'analysis'], perms: ['entry:edit'], userCount: 1, remark: null },
]
const USERS = [
  { id: 1, username: 'admin', displayName: '系统管理员', status: 1, mustChangePassword: false, roles: [ROLES[0]], createdAt: '2026-01-05T09:30:00' },
  { id: 2, username: 'zhang.kj', displayName: '张会计', status: 0, mustChangePassword: true, roles: [ROLES[1]], createdAt: '2026-03-11T14:02:00' },
]

const setUserStatus = vi.fn()
const createUser = vi.fn()

vi.mock('@/api/system', () => ({
  systemApi: {
    users: () => Promise.resolve(USERS),
    roles: () => Promise.resolve(ROLES),
    setUserStatus: (...a: unknown[]) => setUserStatus(...a),
    createUser: (...a: unknown[]) => createUser(...a),
    updateUser: () => Promise.resolve(),
    resetPassword: () => Promise.resolve(),
  },
}))

import SystemUsersView from './SystemUsersView.vue'

function mountWith(perms: string[]) {
  setActivePinia(createPinia())
  useAuthStore().permissions = perms
  return mount(SystemUsersView)
}
const btnByText = (w: ReturnType<typeof mount>, text: string) =>
  w.findAll('button').filter(b => b.text() === text)

beforeEach(() => {
  localStorage.clear()
  document.body.innerHTML = ''
  setUserStatus.mockReset()
  createUser.mockReset()
})

describe('SystemUsersView', () => {
  it('读全开:无 system:edit 时账号全显示,但没有任何写入口', async () => {
    const w = mountWith(['system:view'])
    await flushPromises()
    // 两个账号都在(含已停用的那个)——「读全开」的直接体现
    expect(w.text()).toContain('admin')
    expect(w.text()).toContain('zhang.kj')
    expect(btnByText(w, '新建账号').length).toBe(0)
    expect(btnByText(w, '编辑').length).toBe(0)
    expect(btnByText(w, '重置密码').length).toBe(0)
    expect(btnByText(w, '停用').length).toBe(0)
    // 操作列整列不渲染(而不是渲染一排点了会 403 的按钮)
    expect(w.find('thead').text()).not.toContain('操作')
  })

  it('账号只停用不删除:停用行数据照常显示,全屏无「删除」', async () => {
    const w = mountWith(['system:view', 'system:edit'])
    await flushPromises()
    const html = w.text()
    expect(html).toContain('停用')
    // 没有任何一个按钮叫「删除」——账号只停用不删除,这是 UI 上的硬约束
    expect(w.findAll('button').some(b => b.text().includes('删除'))).toBe(false)
    // 停用的账号:用户名/显示名/角色/创建时间一格不少
    expect(html).toContain('zhang.kj')
    expect(html).toContain('张会计')
    expect(html).toContain('财务专员')
    expect(html).toContain('2026-03-11 14:02')
    // 还在用初始密码的标出来(拍板 #3 首次登录强制改密)
    expect(html).toContain('待改密')
    // 有权时三个行内操作齐全:启用行给「停用」,停用行给「启用」
    expect(btnByText(w, '停用').length).toBe(1)
    expect(btnByText(w, '启用').length).toBe(1)
  })

  it('后端拒绝翻人话:停用自己 / 用户名重复都不露原始报错', async () => {
    const w = mountWith(['system:view', 'system:edit'])
    await flushPromises()

    setUserStatus.mockRejectedValueOnce({ message: 'cannot disable self' })
    await btnByText(w, '停用')[0].trigger('click')
    await flushPromises()
    // 确认弹窗 Teleport 到 body
    expect(document.body.textContent).toContain('已登录的会话下一个请求即失效')
    const confirm = [...document.body.querySelectorAll('button')].find(b => b.textContent?.includes('确认停用'))!
    confirm.click()
    await flushPromises()
    expect(document.body.textContent).toContain('把你锁在门外')
    expect(document.body.textContent).not.toContain('cannot disable self')

    // 用户名重复:后端只给 409,前端也要给人话
    createUser.mockRejectedValueOnce({ response: { status: 409 } })
    await btnByText(w, '新建账号')[0].trigger('click')
    await flushPromises()
    const body = document.body
    const inputs = [...body.querySelectorAll('input')].filter(i => i.type !== 'checkbox')
    inputs[0].value = 'admin'; inputs[0].dispatchEvent(new Event('input'))
    inputs[1].value = '重名'; inputs[1].dispatchEvent(new Event('input'))
    inputs[2].value = 'pw'; inputs[2].dispatchEvent(new Event('input'))
    await flushPromises()
    const create = [...body.querySelectorAll('button')].find(b => b.textContent?.trim() === '创建')!
    create.click()
    await flushPromises()
    expect(body.textContent).toContain('用户名已经被占用')
  })
})
