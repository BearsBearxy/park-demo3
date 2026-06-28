<script setup lang="ts">
import IconRail from '@/components/shell/IconRail.vue'
</script>

<template>
  <!-- root stage: flex row, padding 12px, gap 12px -->
  <div class="fp-stage">
    <!-- nav card: flex:0 0 auto, height 100%, radius 24 -->
    <div class="fp-nav-card">
      <!-- IconRail: Task 3 -->
      <IconRail @open-command="() => {/* Task 6 will wire this */}" />
      <!-- vertical divider placeholder: 1px border-subtle -->
      <div class="fp-vdiv-placeholder" />
      <!-- SidebarPanel placeholder: width 234 -->
      <div class="fp-sidebar-placeholder" />
    </div>

    <!-- main card: flex 1, flex-column, radius 24 -->
    <div class="fp-main-card">
      <!-- TabStrip placeholder: height 44, surface-card -->
      <div class="fp-tabstrip-placeholder" />
      <!-- Toolbar placeholder: height 48, surface-overlay -->
      <div class="fp-toolbar-placeholder" />
      <!-- content area -->
      <main class="fp-content">
        <slot />
      </main>
    </div>
  </div>
</template>

<style scoped>
/* ponytail: placeholder divs are intentionally empty — Tasks 3-5 fill them */

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

/* vertical divider: 1px */
.fp-vdiv-placeholder {
  flex: 0 0 1px;
  width: 1px;
  height: 100%;
  background: var(--border-subtle);
}

/* SidebarPanel placeholder: width 234 */
.fp-sidebar-placeholder {
  flex: 0 0 234px;
  width: 234px;
  height: 100%;
  background: var(--surface-white);
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

/* TabStrip placeholder: height 44 */
.fp-tabstrip-placeholder {
  flex: 0 0 44px;
  height: 44px;
  background: var(--surface-card);
  border-bottom: 1px solid var(--divider);
}

/* Toolbar placeholder: height 48 */
.fp-toolbar-placeholder {
  flex: 0 0 48px;
  height: 48px;
  background: var(--surface-overlay);
  border-bottom: 1px solid var(--divider);
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
