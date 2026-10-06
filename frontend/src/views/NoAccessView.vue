<script setup lang="ts">
// 「无权查看」页(RBAC v3 读写分开,用户 2026-10-04 拍板第 8 条)。router 守卫把没有查看权的屏送到这里:
// /no-access?to=<原地址>。写明缺哪一项、去找系统管理员开;不进页签条(路由没有 meta.value)。
// 权限一到(刷新后 refreshMe 取回新权限、或本地存的是上一版的旧权限)就自己回到原地址 —— 不让人停在一张过期的拒绝页上。
import { computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { canViewPage, viewPermsOf } from '@/nav/navAccess'
import { fpBuildRoutes } from '@/nav/fpNav'
import { lackText } from '@/composables/useViewGate'
import FPEmpty from '@/components/fp/FPEmpty.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const ROUTES = fpBuildRoutes()

// 只认停在本页时的 ?to=:KeepAlive 里停用的实例也还在跟着全局 route 走
const to = computed(() => (route.path === '/no-access' && typeof route.query.to === 'string' ? route.query.to : ''))
const page = computed(() => ROUTES[to.value.replace(/^\//, '').split(/[?#]/)[0]]?.page ?? '这一屏')
const sub = computed(() => {
  const ps = viewPermsOf(to.value)
  return (ps ? `${lackText(ps)}才能看这一屏，` : '') + '请找系统管理员在「角色权限」里开通。'
})

watch(() => !!to.value && canViewPage(to.value, auth.can), (ok) => { if (ok) void router.replace(to.value) }, { immediate: true })
</script>

<template>
  <div class="na fp-fluid">
    <FPEmpty :sub="sub" action="回首页" @action="router.push('/home')">
      没有「{{ page }}」的查看权限
    </FPEmpty>
  </div>
</template>

<style scoped>
.na { display: flex; flex-direction: column; min-height: 100%; }
</style>
