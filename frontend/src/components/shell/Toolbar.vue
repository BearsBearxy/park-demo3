<script setup lang="ts">
// Toolbar — ported from shell.jsx .fp-toolbar / AppToolbar.
import { computed, ref, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { usePresenceStore } from '@/stores/presence'
import { useAuthStore } from '@/stores/auth'
// ponytail: 铃铛抽屉懒加载。Toolbar 在外壳里是**急切**的,静态 import 会把这个抽屉
// 连同它的 CSS 一起压进首屏 index 块 —— 而它只在点铃铛时才出现。
// ⚠ 必须配下面的 v-if 才真省:defineAsyncComponent 是**渲染时**才拉块的,
//   常挂在树上(只靠 :open=false)等于没懒。
// FPDrawer 内部本来就是 `v-if="open"` 且没有过渡,外层再包一层 v-if 视觉上一模一样;
// 它那个 Esc 栈用的是 `{ immediate: true }` 的 watch + onBeforeUnmount,挂卸载都接得住。
const FPApprovalDrawer = defineAsyncComponent(() => import('@/components/fp/FPApprovalDrawer.vue'))
import { useUiStore } from '@/stores/ui'
import IconButton from '@/components/ds/IconButton.vue'
import FPPresenceBar from '@/components/fp/FPPresenceBar.vue'
import { PanelLeft, Star, Search, Sun, History, Bell } from 'lucide-vue-next'

const emit = defineEmits<{ 'open-command': [mode: string] }>()

const route = useRoute()
const ui = useUiStore()

// ── 待批授权(设计稿 §07 F-3) ──
// Bell 从此有事做了 —— 它此前是顶栏四个死按钮之一(收藏 / 主题 / 操作记录 / 通知)。
const presence = usePresenceStore()
const auth = useAuthStore()
const router = useRouter()
const inbox = ref(false)
const pendingCount = computed(() => presence.approvals.length)

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
      <!-- 操作记录:SystemLogsView 早就写好了,此前只差这根线(需 system:view) -->
      <IconButton v-if="auth.can('system:view')" aria-label="操作记录" @click="router.push('/sys-logs')">
        <History :size="16" />
      </IconButton>
      <!-- 通知 = 待批授权。红点**只在有待批时出现**,position:absolute 贴在图标上 ——
           不改图标尺寸、不挪工具条。这是全站唯一允许「凭空出现」的标记:
           它贴在一个尺寸恒定的按钮上,出现与消失都不影响布局。 -->
      <span class="fp-bell">
        <IconButton aria-label="待批授权" @click="inbox = true">
          <Bell :size="16" />
        </IconButton>
        <span v-if="pendingCount" class="fp-bell-dot">{{ pendingCount }}</span>
      </span>
    </div>
  </header>
  <FPApprovalDrawer v-if="inbox" :open="inbox" @close="inbox = false" />
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

.fp-bell { position: relative; display: inline-flex; }
.fp-bell-dot {
  position: absolute; top: 1px; right: 1px;
  min-width: 14px; height: 14px; padding: 0 3px;
  border-radius: var(--radius-full);
  background: var(--hue-red); color: #fff;
  font-family: var(--font-mono); font-size: 9.5px; font-weight: var(--fw-semibold);
  display: grid; place-items: center;
  box-shadow: 0 0 0 1.5px var(--surface-white);
  pointer-events: none;
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
