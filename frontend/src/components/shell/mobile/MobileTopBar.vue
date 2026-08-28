<script setup lang="ts">
// 手机顶栏(S 档,RESPONSIVE-LAYOUT-SPEC §4.1)。桌面 Toolbar 的收纳版:
// 面包屑只留屏名 —— 层名由底栏高亮承担,不在这里重复。
import { computed, ref, defineAsyncComponent } from 'vue'
import { useRoute } from 'vue-router'
import { usePresenceStore } from '@/stores/presence'
import { Menu, Search, Bell } from 'lucide-vue-next'
// 铃铛抽屉懒加载,口径照抄 Toolbar.vue:顶栏在外壳里是**急切**的,静态 import 会把
// 抽屉连同它的 CSS 一起压进首屏块。⚠ 必须配下面的 v-if 才真省 ——
// defineAsyncComponent 是渲染时才拉块的,常挂在树上(只靠 :open=false)等于没懒。
const FPApprovalDrawer = defineAsyncComponent(() => import('@/components/fp/FPApprovalDrawer.vue'))

const emit = defineEmits<{ 'open-drawer': []; 'open-command': [] }>()

const route = useRoute()
const pageName = computed(() => (route.meta as Record<string, string>).page ?? '')

// 待批授权铃铛:红点机制与桌面 Toolbar 完全一致(红点随迁,规范 §4.1)
const presence = usePresenceStore()
const inbox = ref(false)
const pendingCount = computed(() => presence.approvals.length)
</script>

<template>
  <header class="mtb">
    <button class="mtb-btn" aria-label="打开导航" @click="emit('open-drawer')">
      <Menu :size="20" />
    </button>
    <span class="mtb-title">{{ pageName }}</span>
    <button class="mtb-btn" aria-label="搜索" @click="emit('open-command')">
      <Search :size="20" />
    </button>
    <!-- 红点 absolute 贴在定宽按钮上:出现与消失都不影响布局(Toolbar 同口径,
         全站唯一允许「凭空出现」的标记) -->
    <span class="mtb-bell">
      <button class="mtb-btn" aria-label="待批授权" @click="inbox = true">
        <Bell :size="20" />
      </button>
      <span v-if="pendingCount" class="mtb-bell-dot">{{ pendingCount }}</span>
    </span>
  </header>
  <FPApprovalDrawer v-if="inbox" :open="inbox" @close="inbox = false" />
</template>

<style scoped>
.mtb {
  /* safe-area 由栏自身 padding 承接(规范 §10 S 档高度链裁定,不用 fixed) */
  height: calc(52px + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) 6px 0;
  box-sizing: border-box;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  border-bottom: 1px solid var(--divider);
  background: var(--surface-overlay);
  /* iOS ≤17 无前缀不识别 backdrop-filter(规范 §6.5) */
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
}

/* 触达 ≥44×44(规范 §6.2 主操作档) */
.mtb-btn {
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  border: none;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: background var(--dur-fast) var(--ease-standard);
}
.mtb-btn:hover,
.mtb-btn:active { background: var(--bg-hover); color: var(--text-primary); }

.mtb-title {
  flex: 1;
  min-width: 0;
  padding: 0 4px;
  font-size: var(--fs-h4);
  font-weight: var(--fw-semibold);
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mtb-bell { position: relative; display: inline-flex; flex: 0 0 auto; }
.mtb-bell-dot {
  position: absolute; top: 5px; right: 5px;
  min-width: 14px; height: 14px; padding: 0 3px;
  border-radius: var(--radius-full);
  background: var(--hue-red); color: #fff;
  font-family: var(--font-mono); font-size: 9.5px; font-weight: var(--fw-semibold);
  display: grid; place-items: center;
  box-shadow: 0 0 0 1.5px var(--surface-white);
  pointer-events: none;
}
</style>
