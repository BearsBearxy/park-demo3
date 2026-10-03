<script setup lang="ts">
// 手机顶栏(S 档,RESPONSIVE-LAYOUT-SPEC §4.1)。桌面 Toolbar 的收纳版:
// 面包屑只留屏名 —— 层名由底栏高亮承担,不在这里重复。
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useUiStore } from '@/stores/ui'
import { Menu, Search } from 'lucide-vue-next'
import NotifyBell from '@/components/shell/NotifyBell.vue'
import FPElevChip from '@/components/fp/FPElevChip.vue'

const emit = defineEmits<{ 'open-drawer': []; 'open-command': [] }>()

const route = useRoute()
const pageName = computed(() => (route.meta as Record<string, string>).page ?? '')

// 屏级主动作(§5.10)。没屏登记时整个按钮不渲染 —— 顶栏逐字回到原来那四件。
const ui = useUiStore()
</script>

<template>
  <header class="mtb">
    <button class="mtb-btn" aria-label="打开导航" @click="emit('open-drawer')">
      <Menu :size="20" />
    </button>
    <span class="mtb-title">{{ pageName }}</span>
    <!-- 屏级主动作(§5.10「动作 → 顶栏右:1 个主动作」)。钉在 🔍 之前,不是最右:
         🔍/🔔 这样仍贴着右边缘,换屏时一个像素不挪 —— 外壳的稳定是它的价值(§5.10 判据四)。
         流内没有块因此出现/消失,零位移铁律不受影响(LAYOUT-STABILITY §1)。 -->
    <button v-if="ui.topBarAction" class="mtb-btn mtb-act" @click="ui.topBarAction.onClick()">
      <component :is="ui.topBarAction.icon" v-if="ui.topBarAction.icon" :size="18" />
      <span class="mtb-act-t">{{ ui.topBarAction.label }}</span>
    </button>
    <!-- 临时授权(画布 08 ElevStates 手机档):只留钥匙圆钮,页名让位截断;卡片贴顶栏下占满宽,时间写在卡里 -->
    <FPElevChip variant="mobile" />
    <button class="mtb-btn" aria-label="搜索" @click="emit('open-command')">
      <Search :size="20" />
    </button>
    <!-- 铃铛与桌面顶栏是同一个(记号、面板都在 NotifyBell 里);面板在手机上贴顶栏下方占满宽(06-F 底注) -->
    <NotifyBell mobile />
  </header>
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

/* 屏级主动作:定宽 44 的圆钮放不下一句话,改自适应宽 —— 但触达下限仍是 44×44(规范 §6.2),
   高度继承 .mtb-btn 的 44 不覆盖,横向靠 min-width 兜底(只有图标没有字时也够)。
   .mtb-btn 是 display:grid + place-items:center,两个子节点默认竖着叠,所以改 column 流。 */
.mtb-act {
  width: auto;
  min-width: 44px;
  padding: 0 10px;
  grid-auto-flow: column;
  gap: 4px;
  color: var(--text-primary);
  font-size: var(--fs-body);
  font-weight: var(--fw-medium);
}
.mtb-act-t { white-space: nowrap; }

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
</style>
