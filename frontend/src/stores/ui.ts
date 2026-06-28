// src/stores/ui.ts — sidebar open/close state + persistence.
import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useUiStore = defineStore('ui', () => {
  // default true; "0" means closed (mirrors app.jsx toggleSb)
  const sbOpen = ref(localStorage.getItem('fp-app-sb') !== '0')

  function toggleSidebar() {
    sbOpen.value = !sbOpen.value
    localStorage.setItem('fp-app-sb', sbOpen.value ? '1' : '0')
  }

  return { sbOpen, toggleSidebar }
})
