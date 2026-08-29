<script setup lang="ts">
// 右侧滑出抽屉(用户 2026-08-23 指定 antd Drawer 形态,推翻 DESIGN-FIDELITY §7「一律居中弹窗」的默认——
// 语义不同:居中弹窗=聚焦单任务,这里是「边看表格边处理问题清单」的持续参考面板,必须不挡主内容)。
// 浮层纪律(UI-OVERLAY-SPEC):Esc 只在自己开着时拦截(第七次审计 C1 教训:关闭态无条件
// stopPropagation 会吞掉全站 Esc)。监听挂 document **冒泡**阶段——抽屉是宿主不是内层浮层,
// 内层(FPTenantPicker 下拉)在自己元素上 stopPropagation 先赢,Esc 才能只收下拉不关抽屉;
// 挂 capture 会抢在内层之前把整个抽屉关掉(评审复核,UI-OVERLAY-SPEC 铁律二的原始失败模式)。
import { watch, onUnmounted } from 'vue'
import { X } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  width?: number
}>(), { width: 440 })

const emit = defineEmits<{ close: [] }>()

function onKey(e: KeyboardEvent) {
  if (!props.open) return               // ⚠ 关闭态绝不拦别人的键(审计 C1)
  if (e.key === 'Escape') { e.stopPropagation(); emit('close') }
}
// 监听只在开着时挂(同 ds/Popover 的 watch 挂/摘范式)
// immediate:组件可能以 open=true 初始挂载(如 v-if 包着的场景),不带 immediate 首帧监听挂不上
watch(() => props.open, (v) => {
  if (v) document.addEventListener('keydown', onKey)
  else document.removeEventListener('keydown', onKey)
}, { immediate: true })
onUnmounted(() => document.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <!-- ponytail: 无动效直开直关(FPDrawer/CommandPalette 同款惯例)。曾用 <Transition> 滑入,
         在不合成帧的后台标签页里 rAF 不跑,enter-from 永不摘除 → 遮罩透明卡死挡全屏点击;
         v-if 直切没有这个失败模式。 -->
      <div v-if="open" class="fp-sdw-mask" @mousedown.self="emit('close')">
        <aside class="fp-sdw" :style="{ width: width + 'px' }" role="dialog" aria-modal="true" :aria-label="title">
          <header class="fp-sdw-head">
            <span class="fp-sdw-title">{{ title }}</span>
            <button class="fp-sdw-x" aria-label="关闭" @click="emit('close')"><X :size="16" /></button>
          </header>
          <div class="fp-sdw-body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="fp-sdw-foot">
            <slot name="footer" />
          </footer>
        </aside>
      </div>
  </Teleport>
</template>

<style scoped>
.fp-sdw-mask {
  position: fixed; inset: 0;
  z-index: var(--z-modal);
  background: rgba(28, 28, 28, 0.28);
  display: flex; justify-content: flex-end;
}
.fp-sdw {
  height: 100%;
  max-width: 92vw;
  background: var(--surface-page);
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.12);
  display: flex; flex-direction: column;
}
.fp-sdw-head {
  flex: 0 0 auto;
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-subtle);
}
.fp-sdw-title { font-size: 15px; font-weight: 600; color: var(--text-primary); }
.fp-sdw-x {
  display: inline-flex; align-items: center; justify-content: center;
  width: 28px; height: 28px; border: none; border-radius: var(--radius-sm);
  background: transparent; color: var(--text-muted); cursor: pointer;
}
.fp-sdw-x:hover { background: var(--bg-hover); color: var(--text-primary); }
.fp-sdw-body { flex: 1 1 auto; overflow-y: auto; padding: 14px 18px; }
.fp-sdw-foot { flex: 0 0 auto; padding: 12px 18px; border-top: 1px solid var(--border-subtle); }

/* S 档全屏接管(RESPONSIVE-LAYOUT-SPEC §4.4):390 视口塞 440px 侧板必然截断,「不挡主内容」
   的持续参考语义在手机上本就不成立,直接全屏。width 是 :style 内联传入,组件内只有
   !important 盖得住——调用方零改动的代价。 */
@media (max-width: 600px) {
  .fp-sdw { width: 100% !important; max-width: none; }
  /* 脚部贴底,给 iOS 手势条让位 */
  .fp-sdw-foot { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
}
</style>
