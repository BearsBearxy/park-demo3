import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from '../auth'

// Mock @/api so we never hit the network
vi.mock('@/api', () => ({
  default: {
    post: vi.fn(),
  },
}))

import api from '@/api'

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
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
    vi.mocked(api.post).mockResolvedValueOnce({ token: 'jwt-abc', displayName: 'Admin', role: 'admin' })
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

  it('viewer role → isReadonly true(只读标志;安全边界在后端 GET-only,此处仅供 UI)', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ token: 'jwt-v', displayName: '只读账号', role: 'viewer' })
    const auth = useAuthStore()
    await auth.login({ username: 'viewer', password: 'viewer123' })
    expect(auth.isReadonly).toBe(true)
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
