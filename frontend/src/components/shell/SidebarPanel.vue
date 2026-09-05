<script setup lang="ts">
import { computed, h, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useTabsStore } from '@/stores/tabs'
import { fpFindLayer } from '@/nav/fpNav'
import { autoOpenTitles } from '@/nav/navFold'
import { visibleLayers } from '@/nav/navAccess'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import SidebarNav from '@/components/ds/SidebarNav.vue'

const route = useRoute()
const router = useRouter()
const tabs = useTabsStore()
const auth = useAuthStore()

// 与 IconRail 同口径:按角色的 navLayers 过滤('system' 层不进 navLayers,按 system:view 判)
const layers = computed(() => visibleLayers(auth.navLayers, auth.can('system:view')))

// ponytail: route-derived, same pattern as IconRail
// 当前屏属于不可见层时(读全开,深链能进)不展开那一层的目录,退回第一个可见层
const activeLayer = computed(() => {
  const L = fpFindLayer((route.meta as Record<string, string>).value ?? '')
  return layers.value.includes(L) ? L : (layers.value[0] ?? L)
})

const activeValue = computed(() =>
  (route.meta as Record<string, string>).value ?? ''
)

// Map FP_NAV sections → DS SidebarNav shape (drop `kind`)
const sections = computed(() =>
  activeLayer.value.sections.map(s => ({
    title: s.title,
    items: s.items.map(it => ({
      value: it.value,
      label: it.label,
      icon: h(iconFor(it.icon) as any, { size: 16 }),
    })),
  }))
)

// 折叠(SIDEBAR-UX-REDESIGN §3.2):展开集合是内存态,换层清空,不落盘;
// 路由变化只**追加**含当前屏的组(与层首页默认组),不收回用户手动展开的组 —— 收回等于替人做主。
const openTitles = ref<string[]>([])
watch([activeLayer, activeValue], ([L, v], prev) => {
  const base = prev && L === prev[0] ? openTitles.value : []
  openTitles.value = [...new Set([...base, ...autoOpenTitles(L, v)])]
}, { immediate: true })
function onToggle(title: string) {
  openTitles.value = openTitles.value.includes(title)
    ? openTitles.value.filter(t => t !== title)
    : [...openTitles.value, title]
}

// 用户手动多开超出面板高度时 .fp-panel 自己滚(overflow-y:auto 早就有);换屏后把当前项滚进视野 ——
// 此前附表 6 起 9 行在折叠线下也不滚(§1)。jsdom 无 scrollIntoView,可选调用兜底。
const panelEl = ref<HTMLElement | null>(null)
watch(activeValue, () => {
  void nextTick(() => panelEl.value?.querySelector('.fp-sbnav-row[data-on]')?.scrollIntoView?.({ block: 'nearest' }))
})

// 侧栏点击 = **恢复现场**(P3 §4.1):KeepAlive 里那份实例连同 P0a–P0c 落进去的期、公司、
// 抽屉一起留着 —— 「导航一次重过一次门」正是这一期要消灭的东西。
// 「全新」收窄成三个显式动作:Shift + 点击 / 关签后重开(dropState) / 换层。
// Shift + 点当前项照样重建(不 push,路由没变;App.vue 的 key 含 epoch,原地重挂载)——
// 改前「点当前项」走的就是 openFresh,不给这条出路的话,当前屏在本期之后再没有任何强制刷新手势。
function onSelect(value: string, ev?: MouseEvent) {
  if (value === activeValue.value) {
    if (ev?.shiftKey) tabs.openFresh(value)
    return
  }
  if (ev?.shiftKey) tabs.openFresh(value)
  else tabs.open(value)
  router.push('/' + value)
}
</script>

<template>
  <div ref="panelEl" class="fp-panel">
    <!-- header: layer icon + label -->
    <div class="fp-panel-hdr">
      <component :is="iconFor(activeLayer.icon)" :size="18" />
      <span class="nm">{{ activeLayer.label }}</span>
    </div>
    <!-- full-bleed divider -->
    <div class="fp-panel-div" />
    <!-- nav body -->
    <SidebarNav
      :sections="sections"
      :active="activeValue"
      :open-titles="openTitles"
      @select="onSelect"
      @toggle="onToggle"
    />
  </div>
</template>

<style scoped>
.fp-panel {
  width: 234px;
  flex: 0 0 234px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 14px 14px;
  box-sizing: border-box;
  overflow-y: auto;
}

.fp-panel-hdr {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 6px;
  color: var(--text-primary);
}

.fp-panel-hdr .nm {
  font-size: 16px;
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
  letter-spacing: -0.01em;
  white-space: nowrap;
}

/* full-bleed: margin compensates parent padding */
.fp-panel-div {
  height: 1px;
  background: var(--divider);
  margin: 0 -14px;
}
</style>
