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
