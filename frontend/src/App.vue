<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppShell from './components/shell/AppShell.vue'

const route = useRoute()
const isLogin = computed(() => route.path === '/login')
</script>

<template>
  <!-- /login gets its own full-screen layout (LoginView owns it, Task 7) -->
  <router-view v-if="isLogin" />
  <!-- all other routes render inside the two-card shell -->
  <AppShell v-else>
    <router-view />
  </AppShell>
</template>

<style>
#app {
  width: 100%;
  height: 100%;
}
</style>
