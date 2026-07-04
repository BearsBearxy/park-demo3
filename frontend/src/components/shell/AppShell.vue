<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/ui'
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
