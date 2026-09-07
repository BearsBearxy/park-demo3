import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../auth'

// Mock @/api so we never hit the network
vi.mock('@/api', () => ({
  default: {
    post: vi.fn(),
  },
  // 跨标签页身份漂移守卫的两个具名导出:store 在 login/logout 收尾会调它们。
  // 漏 mock 会让本文件所有用例报「No "bindSession" export is defined」——
  // vi.mock 是整模块替换,不是部分 mock。
  bindSession: vi.fn(),
  sessionDrifted: vi.fn(() => false),
}))

import api from '@/api'

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('starts unauthed when no token in localStorage', () => {
    const auth = useAuthStore()
    expect(auth.isAuthed).toBe(false)
    expect(auth.token).toBeNull()
  })

  it('starts authed when token already in localStorage', () => {
    localStorage.setItem('token', 'existing-token')
    const auth = useAuthStore()
    expect(auth.isAuthed).toBe(true)
    expect(auth.token).toBe('existing-token')
  })

  it('login stores token + displayName + role + isAuthed true + persists to localStorage', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ token: 'jwt-abc', displayName: 'Admin', role: 'admin', permissions: ['entry:edit'] })
    const auth = useAuthStore()

    await auth.login({ username: 'admin', password: 'admin123' })

    expect(auth.token).toBe('jwt-abc')
    expect(auth.displayName).toBe('Admin')
    expect(auth.role).toBe('admin')
    expect(auth.isReadonly).toBe(false)
    expect(auth.isAuthed).toBe(true)
    expect(localStorage.getItem('token')).toBe('jwt-abc')
    expect(localStorage.getItem('role')).toBe('admin')
    expect(api.post).toHaveBeenCalledWith('/auth/login', { username: 'admin', password: 'admin123' })
  })

  it('login remember=false → 存 sessionStorage 不存 localStorage,且清掉上次「记住」的残留', async () => {
    localStorage.setItem('token', 'stale-remembered')
    vi.mocked(api.post).mockResolvedValueOnce({ token: 'jwt-s', displayName: 'Admin', role: 'admin' })
    const auth = useAuthStore()

    await auth.login({ username: 'admin', password: 'admin123' }, false)

    expect(auth.isAuthed).toBe(true)
    expect(sessionStorage.getItem('token')).toBe('jwt-s')
    expect(localStorage.getItem('token')).toBeNull()
  })

  it('初始化回退读 sessionStorage(上次没勾记住,同标签页刷新仍在登录态)', () => {
    sessionStorage.setItem('token', 'sess-token')
    const auth = useAuthStore()
    expect(auth.isAuthed).toBe(true)
    expect(auth.token).toBe('sess-token')
  })

  // 破坏验证:把 login 里 `target.setItem('roleNames', ...)` 那行删掉 → 第二段红。
  // 不落盘的话刷新一次角色行就掉回派生值 —— 屏上不报错,只是那行字悄悄换了个人。
  it('❗roleNames 落 storage,刷新后角色行还在', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      token: 'jwt-r', displayName: '王主管', role: 'finance_manager',
      permissions: ['ledger:edit'], roleNames: ['财务主管', '审核员'],
    })
    const auth = useAuthStore()
    await auth.login({ username: 'wang', password: 'x' })
    expect(auth.roleLabel).toBe('财务主管、审核员')
    expect(JSON.parse(localStorage.getItem('roleNames')!)).toEqual(['财务主管', '审核员'])
  })

  it('viewer role → isReadonly true(只读标志;安全边界在后端 GET-only,此处仅供 UI)', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ token: 'jwt-v', displayName: '只读账号', role: 'viewer', permissions: [] })
    const auth = useAuthStore()
    await auth.login({ username: 'viewer', password: 'viewer123' })
    expect(auth.isReadonly).toBe(true)
  })

  it('permissions/navLayers 落 storage 且 can() 按位判定;只有 system:view 仍算只读', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({
      token: 'jwt-p', displayName: '审计', role: 'auditor',
      permissions: ['system:view'], navLayers: ['data'],
    })
    const auth = useAuthStore()
    await auth.login({ username: 'auditor', password: 'x' })

    expect(auth.can('system:view')).toBe(true)
    expect(auth.can('entry:edit')).toBe(false)
    expect(auth.isReadonly).toBe(true)   // 一个 :edit 都没有
    expect(auth.navLayers).toEqual(['data'])
    expect(localStorage.getItem('permissions')).toBe('["system:view"]')
    expect(localStorage.getItem('navLayers')).toBe('["data"]')
  })

  it('老后端不返 navLayers → 三层全给,别让老用户看不到导航', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ token: 'jwt-o', displayName: 'Old', role: 'admin' })
    const auth = useAuthStore()
    await auth.login({ username: 'admin', password: 'x' })
    expect(auth.navLayers).toEqual(['data', 'reports', 'analysis'])
    expect(auth.permissions).toEqual([])
  })

  it('初始化从 storage 还原 permissions;JSON 坏了按缺省不炸', () => {
    localStorage.setItem('token', 't')
    localStorage.setItem('permissions', '["report:edit"]')
    localStorage.setItem('navLayers', 'not-json')
    const auth = useAuthStore()
    expect(auth.can('report:edit')).toBe(true)
    expect(auth.isReadonly).toBe(false)
    expect(auth.navLayers).toEqual(['data', 'reports', 'analysis'])
  })

  it('logout 清掉 permissions/navLayers(共享机器上不给下一个人继承权限)', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ token: 'jwt-a', displayName: 'A', role: 'admin', permissions: ['entry:edit'] })
    const auth = useAuthStore()
    await auth.login({ username: 'a', password: 'x' })

    auth.logout()

    expect(localStorage.getItem('permissions')).toBeNull()
    expect(localStorage.getItem('navLayers')).toBeNull()
    expect(auth.can('entry:edit')).toBe(false)
  })

  it('logout 两个 storage 一起清(不论当初记没记住)', async () => {
    sessionStorage.setItem('token', 'sess-token')
    const auth = useAuthStore()
    auth.logout()
    expect(sessionStorage.getItem('token')).toBeNull()
    expect(auth.isAuthed).toBe(false)
  })

  it('mustChangePassword:登录置位并落 storage,清标志后两轨都没了', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ token: 'jwt-n', displayName: '新人', mustChangePassword: true })
    const auth = useAuthStore()
    await auth.login({ username: 'newbie', password: 'init' })
    expect(auth.mustChangePassword).toBe(true)
    expect(localStorage.getItem('mustChangePassword')).toBe('1')

    auth.clearMustChangePassword()
    expect(auth.mustChangePassword).toBe(false)
    expect(localStorage.getItem('mustChangePassword')).toBeNull()
    expect(sessionStorage.getItem('mustChangePassword')).toBeNull()
  })

  it('上一个账号的改密标志不能传染下一个(同机换人登录)', async () => {
    localStorage.setItem('mustChangePassword', '1')
    vi.mocked(api.post).mockResolvedValueOnce({ token: 'jwt-2', displayName: '老手' })
    const auth = useAuthStore()
    await auth.login({ username: 'vet', password: 'x' })
    expect(auth.mustChangePassword).toBe(false)
    expect(localStorage.getItem('mustChangePassword')).toBeNull()
  })

  it('logout clears token + displayName + role + removes from localStorage', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ token: 'jwt-abc', displayName: 'Admin', role: 'admin' })
    const auth = useAuthStore()
    await auth.login({ username: 'admin', password: 'admin123' })

    auth.logout()

    expect(auth.token).toBeNull()
    expect(auth.displayName).toBeNull()
    expect(auth.role).toBeNull()
    expect(auth.isAuthed).toBe(false)
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('role')).toBeNull()
  })
})

describe('关页面前的二次确认', () => {
  // 用户 2026-08-26:「全局增加二次弹窗确认,和所有别的网页一样如果开着编辑模式没保存
  // 要关浏览器先阻止,弹窗二次确认才能关」。
  //
  // 挂在 auth 而不是某个屏:editors 是**全站唯一**的编辑态登记表,六个编辑器
  // (useEditMode / 系数簿 / 收款簿 / 附表页头 / 账册模板 / 三大报表)都已经往里登记。
  // 挂在屏上就要挂六遍,而且漏一处不报错。
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear(); sessionStorage.clear() })

  it('编辑态里关页面 → 拦下来,让浏览器弹二次确认', () => {
    const auth = useAuthStore()
    const id = Symbol('screen')
    auth.openEditor(id)

    const e = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(e)

    expect(e.defaultPrevented, 'preventDefault 是浏览器弹确认框的开关').toBe(true)
    // ⚠ 收尾:store 注册的监听器活得比本用例长(同一个 jsdom window)。
    //   不关掉的话它会一直认为「有人在编辑」,把后面那条「不该拦」的用例污染成假失败。
    auth.closeEditor(id)
  })

  it('不在编辑态就不要拦 —— 无谓的挽留比不挽留更烦', () => {
    useAuthStore()
    const e = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(e)
    expect(e.defaultPrevented).toBe(false)
  })

  it('退出编辑态之后就不再拦', () => {
    const auth = useAuthStore()
    const id = Symbol('screen')
    auth.openEditor(id)
    auth.closeEditor(id)

    const e = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(e)

    expect(e.defaultPrevented).toBe(false)
  })
})

// ══════════ 角色行(§6 角色行,P5) ══════════
//
// 侧栏头像下那一行字。改前它是个二值常量:「只读账号」/「管理员(可写)」——
// 财务专员、财务主管、审核员三种人一律被写成「管理员」,而其中两种连用户管理都进不去。
describe('角色行 roleLabel(P5)', () => {
  beforeEach(() => { setActivePinia(createPinia()); localStorage.clear(); sessionStorage.clear() })

  // 破坏验证:把 roleNames.length 那一支删掉 → 红(会掉进派生表显「系统管理员（派生）」)
  it('❗后端给了真名就显真名,不再自己猜', () => {
    const auth = useAuthStore()
    auth.roleNames = ['财务主管']
    auth.permissions = ['system:view']          // 派生表会算成「系统管理员」,真名必须压过它
    expect(auth.roleLabel).toBe('财务主管')
  })

  // 破坏验证:把 join('、') 改成 join('/') 或 [0] → 红
  it('❗兼岗给全部角色,顿号拼 —— 只显第一个等于把另一半身份藏了', () => {
    const auth = useAuthStore()
    auth.roleNames = ['财务主管', '系统管理员']
    expect(auth.roleLabel).toBe('财务主管、系统管理员')
  })

  // ❗派生表逐档。每一档都要能被上一档压住 —— 少一档就是把这个人说成别人。
  //   破坏验证:任删一支 → 该档那一条红。
  it('❗一个角色都没挂时按权限派生,次序 系统管理员 > 审核员 > 财务主管 > 财务专员 > 股东 > 只读', () => {
    const auth = useAuthStore()
    const label = (perms: string[], layers = ['data', 'reports', 'analysis']) => {
      auth.roleNames = []; auth.permissions = perms; auth.navLayers = layers
      return auth.roleLabel
    }
    expect(label(['system:view', 'review:approve', 'lock:takeover', 'ledger:edit'])).toBe('系统管理员（派生）')
    expect(label(['review:approve', 'lock:takeover', 'ledger:edit'])).toBe('审核员（派生）')
    expect(label(['lock:takeover', 'ledger:edit'])).toBe('财务主管（派生）')
    expect(label(['ledger:edit'])).toBe('财务专员（派生）')
    expect(label([], ['analysis'])).toBe('园区股东（派生）')
    expect(label([])).toBe('只读账号（派生）')
  })

  // ❗「（派生）」不是装饰:派生值跟真名长得一模一样,不标的话用户会以为系统认得他,
  //   而派生表里根本没有「总经理」这一档(总经理与只读账号权限完全相同)。
  //   破坏验证:把 `d + '（派生）'` 改成 `d` → 红。
  it('❗派生出来的必须带「（派生）」,真名不带', () => {
    const auth = useAuthStore()
    auth.permissions = ['ledger:edit']
    expect(auth.roleLabel).toContain('（派生）')
    auth.roleNames = ['财务专员']
    expect(auth.roleLabel).not.toContain('（派生）')
  })

  // 破坏验证:把 landing 里的 readonly / reviewer 任一参数去掉 → 对应那条红
  it('❗auth.landing 把四个判据一处读齐 —— 六个调用点各传一遍必然漏', () => {
    const auth = useAuthStore()
    auth.permissions = []                       // 零 :edit
    expect(auth.landing).toBe('/cockpit')
    auth.permissions = ['review:approve']       // 审核员:仍零 :edit,但要落审核队列那一屏
    expect(auth.landing).toBe('/data-home')
    auth.permissions = ['ledger:edit']
    expect(auth.landing).toBe('/data-home')
  })
})
