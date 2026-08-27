<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import { useUiStore } from '@/stores/ui'
import { usePresenceStore } from '@/stores/presence'
import IconRail from '@/components/shell/IconRail.vue'
import SidebarPanel from '@/components/shell/SidebarPanel.vue'
import TabStrip from '@/components/shell/TabStrip.vue'
import Toolbar from '@/components/shell/Toolbar.vue'
import CommandPalette from '@/components/shell/CommandPalette.vue'

const ui = useUiStore()
const reloadPage = () => window.location.reload()

const paletteOpen = ref(false)
const paletteMode = ref<'jump' | 'new'>('jump')

function openPalette(mode: 'jump' | 'new' = 'jump') {
  paletteMode.value = mode
  paletteOpen.value = true
}

function onGlobalKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
    e.preventDefault()
    if (paletteOpen.value) {
      paletteOpen.value = false
    } else {
      openPalette('jump')
    }
  }
}

onMounted(() => window.addEventListener('keydown', onGlobalKey))
onUnmounted(() => window.removeEventListener('keydown', onGlobalKey))

// ── 在场(PRESENCE §02) ──
// 全站唯一的轮询挂在外壳上:登录后一直跑,浏览态也发 —— 顶栏头像组靠它。
// 「在哪一屏」直接取面包屑那两段,不必让 20 个屏各自登记一次。
const route = useRoute()
const presence = usePresenceStore()
watch(() => route.path, () => {
  const m = route.meta as Record<string, string>
  const label = [m.layerLabel, m.page].filter(Boolean).join(' · ')
  presence.enter(null, label || null)
}, { immediate: true })
onUnmounted(() => presence.stop())
</script>

<template>
  <!-- root stage: flex row, padding 12px, gap 12px -->
  <div class="fp-stage">
    <!-- nav card: IconRail + optional vertical divider + optional SidebarPanel -->
    <div class="fp-nav-card">
      <IconRail @open-command="openPalette('jump')" />
      <!-- vertical divider: only shown when sidebar is open -->
      <div v-if="ui.sbOpen" class="fp-vdiv" />
      <!-- SidebarPanel: only shown when sidebar is open -->
      <SidebarPanel v-if="ui.sbOpen" />
    </div>

    <!-- main card: TabStrip → Toolbar → content -->
    <div class="fp-main-card">
      <!-- 导航进度条:chunk 下载完才 confirm 导航,这条是那段空窗里唯一的反馈(DESIGN-FIDELITY §6.5) -->
      <div v-if="ui.navigating" class="fp-nav-bar" aria-hidden="true" />
      <TabStrip @open-command="openPalette($event as 'jump' | 'new')" />
      <Toolbar @open-command="openPalette($event as 'jump' | 'new')" />
      <!-- content area -->
      <main class="fp-content">
        <slot />
      </main>
    </div>
  </div>

  <CommandPalette
    :open="paletteOpen"
    :mode="paletteMode"
    @close="paletteOpen = false"
  />

  <!-- 全局网络错误 toast(读路径加载失败的兜底提示,8s 自动消失) -->
  <Teleport to="body">
    <div v-if="ui.netError" class="fp-net-toast" role="alert">
      <span class="msg">{{ ui.netError }}</span>
      <button class="act" @click="reloadPage">刷新</button>
      <button class="act ghost" @click="ui.dismissNetError()">×</button>
    </div>
  </Teleport>
</template>

<style scoped>
.fp-stage {
  display: flex;
  height: 100%;
  overflow: hidden;
  padding: 12px;
  gap: 12px;
  box-sizing: border-box;
  /* T3 全局地板(spec 2026-07-12):<960px 视口不再挤压,由文档视口出横向滚动。
     stage 是块级 flex 容器,宽度恒=父(#app)100%,子项 fp-main-card min-width:0
     不会把地板顶穿;≥960 视口时 min-width 不生效 → 无常驻横滚 */
  min-width: 960px;
}

/* ── 全局网络错误 toast ── */
.fp-net-toast { position:fixed; left:50%; bottom:28px; transform:translateX(-50%); z-index:400;
  display:flex; align-items:center; gap:10px; max-width:min(560px,90vw); padding:10px 14px;
  background:var(--ink-900); color:#fff; border-radius:var(--radius-md); box-shadow:0 12px 32px rgba(28,28,28,.32); font-size:13px; }
.fp-net-toast .msg { min-width:0; }
.fp-net-toast .act { flex:0 0 auto; height:26px; padding:0 10px; border:1px solid rgba(255,255,255,.35); border-radius:var(--radius-sm);
  background:transparent; color:#fff; font-size:12px; cursor:pointer; }
.fp-net-toast .act:hover { background:rgba(255,255,255,.14); }
.fp-net-toast .act.ghost { border-color:transparent; padding:0 6px; }

/* ── nav card ── */
.fp-nav-card {
  flex: 0 0 auto;
  height: 100%;
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  display: flex;
  flex-direction: row;
}

/* vertical divider: 1px border-subtle */
.fp-vdiv {
  flex: 0 0 1px;
  width: 1px;
  background: var(--border-subtle);
}

/* ── main card ── */
.fp-main-card {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-2xl);
  overflow: hidden;
  /* 给进度条做定位参照;已有 overflow:hidden,绝对定位子元素会被裁进圆角内 */
  position: relative;
}

/* ── 导航进度条 ── */
/* 绝对定位而非 flex 子项:作为兄弟节点插进这个 column flex 会把 TabStrip 整体下推 2px,
   出现/消失各抖一次 —— 正是 DESIGN-FIDELITY §6.4 禁止的布局位移。 */
.fp-nav-bar {
  position: absolute; top: 0; left: 0; right: 0; height: 2px;
  z-index: 20; /* P4 z-index 令牌化时改成 var(--z-sticky) */
  overflow: hidden;
  pointer-events: none;
}
/* 不定长进度:导航时长不可预估,用往返滑块表示「在动」而非表示进度百分比 */
.fp-nav-bar::after {
  content: ''; position: absolute; top: 0; bottom: 0; width: 36%;
  background: var(--hue-blue);
  animation: fp-nav-slide 1.1s ease-in-out infinite;
}
@keyframes fp-nav-slide {
  from { left: -36%; }
  to   { left: 100%; }
}

/* content area */
.fp-content {
  flex: 1;
  overflow-y: auto;
  scrollbar-gutter: stable both-edges;
  padding: 24px;
  box-sizing: border-box;
}
</style>
