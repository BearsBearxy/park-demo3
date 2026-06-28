import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/api'

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(localStorage.getItem('token'))
  const displayName = ref<string | null>(localStorage.getItem('displayName'))

  const isAuthed = computed(() => !!token.value)

  async function login({ username, password }: { username: string; password: string }) {
    const data = await api.post<{ token: string; displayName: string }>('/auth/login', { username, password })
    const result = data as unknown as { token: string; displayName: string }
    token.value = result.token
    displayName.value = result.displayName
    localStorage.setItem('token', result.token)
    localStorage.setItem('displayName', result.displayName)
  }

  function logout() {
    token.value = null
    displayName.value = null
    localStorage.removeItem('token')
    localStorage.removeItem('displayName')
  }

  // ponytail: kept for backwards-compat with P0-B code that calls setToken
  function setToken(t: string | null) {
    token.value = t
    if (t) localStorage.setItem('token', t)
    else localStorage.removeItem('token')
  }

  return { token, displayName, isAuthed, login, logout, setToken }
})
