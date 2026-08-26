<script setup lang="ts">
// Toolbar — ported from shell.jsx .fp-toolbar / AppToolbar.
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useUiStore } from '@/stores/ui'
import IconButton from '@/components/ds/IconButton.vue'
import FPPresenceBar from '@/components/fp/FPPresenceBar.vue'
import { PanelLeft, Star, Search, Sun, History, Bell } from 'lucide-vue-next'

const emit = defineEmits<{ 'open-command': [mode: string] }>()

const route = useRoute()
const ui = useUiStore()

const meta = computed(() => route.meta as Record<string, string>)
const crumbGroup = computed(() => meta.value.layerLabel ?? '')
const crumbPage  = computed(() => meta.value.page ?? '')
</script>

<template>
  <header class="fp-toolbar">
    <!-- left: sidebar toggle + star -->
    <IconButton aria-label="折叠侧边栏" @click="ui.toggleSidebar()">
      <PanelLeft :size="16" />
    </IconButton>
    <IconButton aria-label="收藏本页">
      <Star :size="16" />
    </IconButton>

    <!-- breadcrumb -->
    <span class="fp-crumb">
      <span class="fp-crumb-grp">{{ crumbGroup }}</span>
      <span class="fp-crumb-sep">/</span>
      <span class="fp-crumb-page">{{ crumbPage }}</span>
    </span>

    <!-- right: search + utility icons -->
    <div class="fp-toolbar-right">
      <!-- 在场头像组(PRESENCE §03):右区最左,紧挨搜索框。宽度按满员算死,人数变化不挪版。 -->
      <FPPresenceBar />
      <button class="fp-search-btn" @click="emit('open-command', 'jump')">
        <Search :size="15" />
        <span>搜索页面 / 租户 / 凭证…</span>
        <kbd class="fp-kbd">Ctrl K</kbd>
      </button>
      <IconButton aria-label="浅色/深色模式">
        <Sun :size="16" />
      </IconButton>
      <IconButton aria-label="操作记录">
        <History :size="16" />
      </IconButton>
      <IconButton aria-label="通知">
        <Bell :size="16" />
      </IconButton>
    </div>
  </header>
</template>

<style scoped>
.fp-toolbar {
  height: 48px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  border-bottom: 1px solid var(--divider);
  background: var(--surface-overlay);
  backdrop-filter: blur(8px);
  box-sizing: border-box;
}

.fp-crumb {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-left: 6px;
  min-width: 0;
}
.fp-crumb-grp {
  font-size: var(--fs-body);
  color: var(--text-muted);
  white-space: nowrap;
}
.fp-crumb-sep {
  color: var(--text-disabled);
}
.fp-crumb-page {
  font-size: var(--fs-body);
  font-weight: var(--fw-medium);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.fp-toolbar-right {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
}

.fp-search-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 8px 0 12px;
  border-radius: var(--radius-full);
  border: 1px solid var(--border-subtle);
  background: var(--surface-card);
  cursor: pointer;
  font-family: var(--font-sans);
  color: var(--text-muted);
  min-width: 200px;
  transition: background var(--dur-fast) var(--ease-standard);
}
.fp-search-btn:hover { background: var(--bg-hover); }
.fp-search-btn span {
  font-size: 13px;
  flex: 1;
  text-align: left;
}

.fp-kbd {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-family: var(--font-sans);
  font-size: 11px;
  font-weight: var(--fw-semibold);
  color: var(--text-secondary);
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 2px 7px;
}
</style>
