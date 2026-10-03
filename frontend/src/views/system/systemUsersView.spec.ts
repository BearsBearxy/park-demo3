// 用户管理屏。钉三条会真出事的契约:
// ① 读全开(RBAC-SPEC §0):无 system:edit 时账号照常全部显示,只是没有新建/编辑/停用入口;
// ② 账号只停用不删除(§8):全屏不得出现「删除」二字,停用行数据照常显示、只加停用徽标;
// ③ 后端两条守卫(不能停用自己 / 用户名重复)要翻成人话,不能把原始报错糊到用户脸上。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { useAuthStore } from '@/stores/auth'
import { askQueue, answer } from '@/utils/ask'
import { receipts } from '@/utils/receipt'

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
const users = vi.fn()

vi.mock('@/api/system', () => ({
  systemApi: {
    users: () => users(),
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
  users.mockReset()
  users.mockImplementation(() => Promise.resolve(USERS))
  askQueue.splice(0)
  receipts.splice(0)
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
    answer(true)
    await flushPromises()
    // 被拒报回执(不再是确认卡里的红字),人话 + 「重试」
    const r = receipts.at(-1)!
    expect(r.tone).toBe('fail')
    expect(r.text).toContain('把你锁在门外')
    expect(r.text).not.toContain('cannot disable self')
    expect(r.action?.label).toBe('重试')

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
    // 表单里的错误贴在字段下(.fp-field-err),不走回执
    expect(body.querySelector('.fin-dlg .fp-field-err')?.textContent).toContain('用户名已经被占用')
  })

  it('❗停用走 ask(danger,主按钮写「停用账号」);答取消不发请求,答停用才发,目标状态是 0', async () => {
    const w = mountWith(['system:view', 'system:edit'])
    await flushPromises()
    await btnByText(w, '停用')[0].trigger('click')
    await flushPromises()
    expect(askQueue[0]).toMatchObject({ title: '停用「系统管理员(admin)」？', action: '停用账号', danger: true })
    expect(askQueue[0].body).toContain('已登录的会话下一个请求即失效')
    answer(false)
    await flushPromises()
    expect(setUserStatus).not.toHaveBeenCalled()
    await btnByText(w, '停用')[0].trigger('click')
    await flushPromises()
    answer(true)
    await flushPromises()
    expect(setUserStatus).toHaveBeenCalledWith(1, 0)
  })

  it('❗启用不是删除类:ask 不带 danger,主按钮写「启用账号」', async () => {
    const w = mountWith(['system:view', 'system:edit'])
    await flushPromises()
    await btnByText(w, '启用')[0].trigger('click')
    await flushPromises()
    expect(askQueue[0]).toMatchObject({ title: '启用「张会计(zhang.kj)」？', action: '启用账号' })
    expect(askQueue[0].danger).toBeFalsy()
  })

  it('❗加载失败换掉表格本身(FPLoadError,和表格互斥);点重试重拉,成功后表格回来', async () => {
    users.mockRejectedValueOnce({ message: '网关超时' })
    const w = mountWith(['system:view', 'system:edit'])
    await flushPromises()
    expect(btnByText(w, '新建账号')[0].attributes('disabled'), '没读到账号与角色时不开写入口').toBeDefined()
    const err = w.find('.mx-listcard .fp-empty.error')
    expect(err.text()).toContain('账号列表没读到')
    expect(err.text()).toContain('网关超时')
    expect(w.find('.mx-tablewrap').exists()).toBe(false)
    expect(w.find('.mx-pagerbar').exists()).toBe(false)
    await err.find('button').trigger('click')
    await flushPromises()
    expect(users).toHaveBeenCalledTimes(2)
    expect(w.find('.fp-empty.error').exists()).toBe(false)
    expect(w.find('.mx-tablewrap').text()).toContain('zhang.kj')
  })

  it('❗筛空了是 FPEmpty', async () => {
    const w = mountWith(['system:view'])
    await flushPromises()
    await w.find('.mx-search input').setValue('查无此人')
    expect(w.find('.mx-tablewrap .fp-empty').text()).toBe('没有匹配的账号')
  })

  // 两趟叠着发(写后重拉 + 手点重试 + 切回重读)只认后发的那趟
  // 破坏验证:reload 成功支的 `if (my !== seq) return` 删掉 → 旧名单盖屏 → 红;catch 支的删掉 → 冒失败件 → 红
  it('❗先发的晚到:旧名单不盖新名单,失败不冒失败件', async () => {
    let lateOk!: (v: typeof USERS) => void, lateFail!: (e: Error) => void
    users
      .mockImplementationOnce(() => new Promise((_, rej) => { lateFail = rej }))
      .mockImplementationOnce(() => new Promise((res) => { lateOk = res }))
    const w = mountWith(['system:view'])
    await flushPromises()
    const vm = w.vm as unknown as { reload: () => Promise<void> }
    void vm.reload()
    await vm.reload()
    await flushPromises()
    const fresh = w.find('.mx-tablewrap').text()
    expect(fresh).toContain('zhang.kj')
    lateOk([USERS[0]])
    await flushPromises()
    expect(w.find('.mx-tablewrap').text(), '先发的旧名单盖了上来').toBe(fresh)
    lateFail(new Error('网关超时'))
    await flushPromises()
    expect(w.find('.fp-empty.error').exists(), '先发的失败冒了出来').toBe(false)
    expect(w.find('.mx-tablewrap').text()).toBe(fresh)
  })
})

// 列宽铁律(LIST-PAGE §4 / §7,2026-10-02):角色列按全部账号里最宽的一组角色签定宽(余宽归行末空列)。
// 屏只把当前页交给 FPSortableTable;不给宽的话翻页 / 筛选时宽跟着变,右边状态 / 创建时间 / 操作整排平移。
describe('SystemUsersView · 角色列按全部账号定宽', () => {
  // 破坏验证:roleColW 改成按 paged 算 → 第 1 页只有单签「系统管理员」,32 + 78 = 110px,红;width 去掉 → '',红
  it('❗两个签的账号在第 2 页:角色列 = 两签(78 + 66)+ 签间 6 + 内边距 32', async () => {
    const many = Array.from({ length: 10 }, (_, i) => ({ ...USERS[0], id: 100 + i, username: `u${i}` }))
    const both = { ...USERS[1], id: 200, username: 'both.roles', roles: [ROLES[0], ROLES[1]] }
    users.mockImplementation(() => Promise.resolve([...many, both]))
    const w = mountWith(['system:view'])
    await flushPromises()
    expect(w.find('.mx-tablewrap tbody').text(), '前置:两签账号在第 2 页').not.toContain('both.roles')
    const th = w.findAll('.mx-tablewrap thead th').find(t => t.text().includes('角色'))!.element as HTMLElement
    // 签 = 12px 字 + 2 + 内边距 4 + 圆点 6 + 间距 6:「系统管理员」60 + 18 = 78,「财务专员」48 + 18 = 66
    expect(th.style.width).toBe('182px')
    expect(th.style.minWidth).toBe('182px')
  })
})
