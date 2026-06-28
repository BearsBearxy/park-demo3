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

  it('login stores token + displayName + isAuthed true + persists to localStorage', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ token: 'jwt-abc', displayName: 'Admin' })
    const auth = useAuthStore()

    await auth.login({ username: 'admin', password: 'admin123' })

    expect(auth.token).toBe('jwt-abc')
    expect(auth.displayName).toBe('Admin')
    expect(auth.isAuthed).toBe(true)
    expect(localStorage.getItem('token')).toBe('jwt-abc')
    expect(api.post).toHaveBeenCalledWith('/auth/login', { username: 'admin', password: 'admin123' })
  })

  it('logout clears token + displayName + removes from localStorage', async () => {
    vi.mocked(api.post).mockResolvedValueOnce({ token: 'jwt-abc', displayName: 'Admin' })
    const auth = useAuthStore()
    await auth.login({ username: 'admin', password: 'admin123' })

    auth.logout()

    expect(auth.token).toBeNull()
    expect(auth.displayName).toBeNull()
    expect(auth.isAuthed).toBe(false)
    expect(localStorage.getItem('token')).toBeNull()
  })
})
