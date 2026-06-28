<script setup lang="ts">
import { useUiStore } from '@/stores/ui'
import IconRail from '@/components/shell/IconRail.vue'
import SidebarPanel from '@/components/shell/SidebarPanel.vue'
import TabStrip from '@/components/shell/TabStrip.vue'
import Toolbar from '@/components/shell/Toolbar.vue'

const ui = useUiStore()

// open-command events are forwarded up for Task 6 (CommandPalette) to wire
const emit = defineEmits<{ 'open-command': [mode: string] }>()
</script>

<template>
  <!-- root stage: flex row, padding 12px, gap 12px -->
  <div class="fp-stage">
    <!-- nav card: IconRail + optional vertical divider + optional SidebarPanel -->
    <div class="fp-nav-card">
      <IconRail @open-command="emit('open-command', 'jump')" />
      <!-- vertical divider: only shown when sidebar is open -->
      <div v-if="ui.sbOpen" class="fp-vdiv" />
      <!-- SidebarPanel: only shown when sidebar is open -->
      <SidebarPanel v-if="ui.sbOpen" />
    </div>

    <!-- main card: TabStrip → Toolbar → content -->
    <div class="fp-main-card">
      <TabStrip @open-command="emit('open-command', $event)" />
      <Toolbar @open-command="emit('open-command', $event)" />
      <!-- content area -->
      <main class="fp-content">
        <slot />
      </main>
    </div>
  </div>
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
