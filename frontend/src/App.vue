<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import AppShell from './components/shell/AppShell.vue'

const route = useRoute()
const tabs = useTabsStore()
// 自带整屏布局、不进外壳的两页:登录 + 强制改密
// (改密是强制态,外壳的侧边栏点哪儿都被守卫弹回来,给了反而像页面坏了)
const isBare = computed(() => route.path === '/login' || route.path === '/change-password')
// 路由 value = tab value:path 恒为 '/'+value(router/index.ts)
const routeValue = computed(() => route.path.slice(1))
</script>

<template>
  <!-- /login 与 /change-password 各自拥有整屏布局 -->
  <router-view v-if="isBare" />
  <!-- all other routes render inside the two-card shell -->
  <!-- KeepAlive per tab:key = value:epoch。TabStrip 点击=命中缓存,恢复浏览状态;
       openFresh(侧边栏点击/核对跳转/关闭重开)递增 epoch → key 变 → 全新实例走 onMounted。
       共用同一组件的兄弟路由(充电桩汽车/电动车)value 不同 → key 天然不同,切换必重建,原「陈旧数据」防线不回归 -->
  <AppShell v-else>
    <router-view v-slot="{ Component }">
      <keep-alive :max="10">
        <component :is="Component" :key="routeValue + ':' + tabs.epochOf(routeValue)" />
      </keep-alive>
    </router-view>
  </AppShell>
</template>

<style>
#app {
  width: 100%;
  height: 100%;
}
</style>
