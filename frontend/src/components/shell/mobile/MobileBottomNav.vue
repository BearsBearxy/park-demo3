<script setup lang="ts">
// 手机底栏(S 档,RESPONSIVE-LAYOUT-SPEC §4.1):层级导航,IconRail 在手机上的化身。
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { fpFindLayer, type NavLayer } from '@/nav/fpNav'
import { visibleLayers } from '@/nav/navAccess'
import { HOME, tabMeta, useTabsStore } from '@/stores/tabs'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const tabsStore = useTabsStore()

// 与 IconRail 同口径:按角色 navLayers 过滤,'system' 层不进 navLayers、跟 system:view 走
const layers = computed(() => visibleLayers(auth.navLayers, auth.can('system:view')))
const activeValue = computed(() => (route.meta as Record<string, string>).value ?? '')
const onHome = computed(() => activeValue.value === HOME)
const activeLayer = computed(() => fpFindLayer(activeValue.value))
// 首页的图标与屏名跟桌面页签条同源(tabMeta),别在这儿写第二份字面量
const home = tabMeta(HOME)!

// 点当前层什么都不做(§4.1,IconRail.goLayer 同语义)
function goLayer(layer: NavLayer) {
  if (layer.id === activeLayer.value.id) return
  tabsStore.openFresh(layer.home)
  router.push('/' + layer.home)
}

// 首页格(2026-09-21 补):S 档不渲染页签条(AppShell `v-if="tier !== 's'"`),抽屉里也没有首页
// —— 而 'home' 不在 fpNav 里,buildAllPages 会把它滤掉,命令面板与「最近打开」同样搜不到。
// 结果是登录落在首页之后点走一次就再也回不来,只剩浏览器后退。
// 走 open 不走 openFresh(用户拍板):首页没有草稿可丢,恢复现场即可;
// 首页是固定页签,commit() 在 S 档按 `t.pinned` 留着它,纪元不动 → KeepAlive 现场还在。
function goHome() {
  if (onHome.value) return
  tabsStore.open(HOME)
  router.push('/' + HOME)
}
</script>

<template>
  <nav class="mbn">
    <!-- 首页恒在最左(市面上手机 app 的通行排法),不受角色过滤影响:人人都有首页 -->
    <button class="mbn-tab" :class="{ on: onHome }" @click="goHome">
      <span class="mbn-ic"><component :is="iconFor(home.icon)" :size="20" /></span>
      <span>{{ home.page }}</span>
    </button>
    <button
      v-for="layer in layers"
      :key="layer.id"
      class="mbn-tab"
      :class="{ on: !onHome && layer.id === activeLayer.id }"
      @click="goLayer(layer)"
    >
      <span class="mbn-ic">
        <component :is="iconFor(layer.icon)" :size="20" />
      </span>
      <span>{{ layer.short }}</span>
    </button>
  </nav>
</template>

<style scoped>
.mbn {
  /* safe-area 由栏自身 padding 承接(规范 §10 S 档高度链裁定,不用 fixed) */
  height: calc(56px + env(safe-area-inset-bottom));
  padding-bottom: env(safe-area-inset-bottom);
  box-sizing: border-box;
  flex: 0 0 auto;
  display: flex;
  border-top: 1px solid var(--divider);
  background: var(--surface-white);
}

/* 每格 flex:1 定宽居中:激活态的胶囊/配色变化不挪动相邻格(零位移) */
.mbn-tab {
  flex: 1 1 0;
  min-width: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  font-family: var(--font-sans);
  font-size: 10.5px;
  font-weight: var(--fw-medium);
  color: var(--text-muted);
  transition: color var(--dur-fast) var(--ease-standard);
}
.mbn-tab.on { color: var(--text-primary); }

.mbn-ic {
  display: grid;
  place-items: center;
  width: 44px;
  height: 26px;
  border-radius: var(--radius-full);
}
.mbn-tab.on .mbn-ic { background: var(--accent-slate); }
</style>
