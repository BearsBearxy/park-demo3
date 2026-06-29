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
  <!-- :key 强制按路由重建视图：避免共用同一组件的兄弟路由(如充电桩汽车/电动车)切换时不触发 onMounted、显示上一张表的陈旧数据 -->
  <AppShell v-else>
    <router-view :key="route.fullPath" />
  </AppShell>
</template>

<style>
#app {
  width: 100%;
  height: 100%;
}
</style>
