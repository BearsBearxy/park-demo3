<script setup lang="ts">
// 顶栏铃铛:按钮 + 右上角记号(PAGE-BEHAVIOR-SPEC §5.3,画布 06-G「长什么样」+ 规则表)。
// 桌面顶栏与手机顶栏是同一个铃铛,mobile 只换按钮尺寸(手机 44×44 触达,RESPONSIVE-LAYOUT-SPEC §6.2)。
// 记号 absolute 贴在定尺寸按钮上:出现、消失、位数变化都不改铃铛大小、不挪工具条。
import { defineAsyncComponent, ref, watch } from 'vue'
import { Bell } from 'lucide-vue-next'
import IconButton from '@/components/ds/IconButton.vue'
import ShellTip from '@/components/shell/ShellTip.vue'
import { useBellStore } from '@/stores/bell'

// 面板懒加载:顶栏在外壳里是急切的,面板只在点开时才要。⚠ 必须配下面的 v-if 才真省 ——
// defineAsyncComponent 是渲染时才拉块的,常挂在树上等于没懒(同原 FPApprovalDrawer 的口径)。
const NotifyPanel = defineAsyncComponent(() => import('@/components/shell/NotifyPanel.vue'))

defineProps<{ mobile?: boolean }>()
const bell = useBellStore()
/** 面板挂在 body 上,桌面按它的位置摆 */
const host = ref<HTMLElement | null>(null)

// 面板「点外面关」由 mousedown 触发,先于这次 click 跑:刚被这一下关掉的,click 不再把它重开。
// ponytail: 按时间判,300ms 内的 click 当成同一下;面板若改成按 click 关,这段可删
let closedAt = 0
watch(() => bell.open, (o) => { if (!o) closedAt = Date.now() }, { flush: 'sync' })
function toggle() {
  if (bell.open) bell.closePanel()
  else if (Date.now() - closedAt > 300) void bell.openPanel()
}
</script>

<template>
  <span ref="host" class="nb" :class="{ 'nb-m': mobile }">
    <button v-if="mobile" type="button" class="nb-mbtn" :aria-label="bell.ariaLabel" :aria-expanded="bell.open" @click="toggle">
      <Bell :size="20" />
    </button>
    <ShellTip v-else title="通知" align="end" :disabled="bell.open">
      <IconButton :aria-label="bell.ariaLabel" :aria-expanded="bell.open" @click="toggle">
        <Bell :size="16" />
      </IconButton>
    </ShellTip>
    <!-- 记号本身不读,数在按钮名字里(06-G 读屏)。数字变化直接换字,只有出现 / 消失走 120ms 淡入淡出 -->
    <Transition name="nb-fade">
      <span v-if="bell.markText" class="nb-num" aria-hidden="true">{{ bell.markText }}</span>
      <span v-else-if="bell.blue" class="nb-dot" aria-hidden="true" />
    </Transition>
    <NotifyPanel v-if="bell.open" :mobile="mobile" :anchor="host" @close="bell.closePanel()" />
  </span>
</template>

<style scoped>
.nb { position: relative; display: inline-flex; flex: 0 0 auto; }

/* 手机:与 MobileTopBar 的 .mtb-btn 同尺寸同配色(触达 ≥44×44) */
.nb-mbtn {
  width: 44px; height: 44px;
  border: none; border-radius: var(--radius-md);
  background: transparent; color: var(--text-secondary);
  cursor: pointer;
  display: grid; place-items: center;
  transition: background var(--dur-fast) var(--ease-standard);
}
.nb-mbtn:hover,
.nb-mbtn:active { background: var(--bg-hover); color: var(--text-primary); }

/* 红数字:16 高,1 位是 16×16 的圆,位数多了只往宽里长 —— 右沿钉住,往左长,不出顶栏右边 */
.nb-num {
  position: absolute; top: -6px; right: -6px;
  min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box;
  border-radius: var(--radius-full);
  background: var(--hue-red); color: var(--control-solid-text);   /* 实底上的字:暗色下红提亮,字反深 */
  font-family: var(--font-mono); font-size: 10px; font-weight: var(--fw-semibold); line-height: 16px;
  text-align: center; white-space: nowrap;
  box-shadow: 0 0 0 2px var(--surface-white);   /* 外圈 2px 底色描边 */
  pointer-events: none;
}
/* 蓝点:8×8,贴铃铛右上 */
.nb-dot {
  position: absolute; top: 1px; right: 1px;
  width: 8px; height: 8px;
  border-radius: var(--radius-full);
  background: var(--hue-blue);
  box-shadow: 0 0 0 2px var(--surface-white);
  pointer-events: none;
}
.nb-m .nb-num { top: 3px; right: 3px; }
.nb-m .nb-dot { top: 8px; right: 8px; }

.nb-fade-enter-active,
.nb-fade-leave-active { transition: opacity var(--dur-fast) linear; }
.nb-fade-enter-from,
.nb-fade-leave-to { opacity: 0; }
</style>
