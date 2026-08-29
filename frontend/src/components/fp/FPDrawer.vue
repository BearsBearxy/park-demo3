<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch } from 'vue'
import { iconFor } from '@/components/ds/icon'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  subtitle?: string
  icon?: string
  width?: number
  // 恒定高度(BILLS-SPEC §4):true 时抽屉高度固定为 max-height 上限,不随内容塌缩——
  // 内容少的记录与满表记录同尺寸。默认 false 向后兼容既有使用方(内容驱动高度)。
  fixedHeight?: boolean
  // 全屏档(催缴单 worksheet 级长表):96vw×94vh,压过 width/fixedHeight 的尺寸约束
  full?: boolean
  // 层级档位(DESIGN-FIDELITY z 七级):从别的弹窗里再开本抽屉时传 'modal-2'/'confirm',默认 modal 零回归
  tier?: 'modal' | 'modal-2' | 'confirm'
}>(), { width: 640, fixedHeight: false, full: false, tier: 'modal' })

const emit = defineEmits<{ close: [] }>()

// Esc 只关**最上面那个**抽屉。
//
// 原来每个 FPDrawer 都无条件监听 window 的 keydown，抽屉套抽屉时(如催缴单页 → 系数簿 →
// 主管授权窗)按一次 Esc 会把它们全关掉 —— 用户只想退掉授权窗，结果连系数簿里的暂存
// 一起没了。提权功能让「抽屉上再开一个抽屉」变成常态，所以这里要一个栈。
//
// ponytail: 模块级数组，不引 focus-trap 库。同一时刻打开的抽屉个位数，push/splice 足够。
const stack: symbol[] = []
const meId = Symbol('fp-drawer')

function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return
  if (stack[stack.length - 1] !== meId) return   // 不是最上面那个，交给它处理
  emit('close')
}

watch(() => props.open, (open) => {
  const i = stack.indexOf(meId)
  if (open && i < 0) stack.push(meId)
  else if (!open && i >= 0) stack.splice(i, 1)
}, { immediate: true })

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  const i = stack.indexOf(meId)
  if (i >= 0) stack.splice(i, 1)     // 未关闭就被卸载(路由切走)也要出栈,否则栈顶永远是个死抽屉
})
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fp-dwr-backdrop" :style="{ '--fp-dwr-z': `var(--z-${tier})` }" @mousedown="emit('close')">
    <div class="fp-dwr" :class="{ 'fp-dwr--fixed': fixedHeight, 'fp-dwr--full': full }" :style="full ? undefined : { width: `min(${width}px, 94vw)` }" role="dialog" aria-modal="true" @mousedown.stop>
      <div class="fp-dwr-hd">
        <span v-if="icon" class="fp-dwr-icon">
          <component :is="iconFor(icon)" :size="20" />
        </span>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <h3 style="margin:0;font-size:var(--fs-h3);font-weight:var(--fw-semibold);color:var(--text-primary)">{{ title }}</h3>
            <slot name="badge" />
          </div>
          <p v-if="subtitle" style="margin:4px 0 0;font-size:var(--fs-label);color:var(--text-muted)">{{ subtitle }}</p>
        </div>
        <button class="fp-dwr-x" @click="emit('close')" aria-label="关闭">
          <component :is="iconFor('x')" :size="18" />
        </button>
      </div>
      <div class="fp-dwr-body">
        <slot />
      </div>
      <div v-if="$slots.footer" class="fp-dwr-ft">
        <slot name="footer" />
      </div>
    </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 居中弹窗(取代原型右抽屉;参考 CommandPalette 居中卡)。见 DESIGN-FIDELITY §7。 */
.fp-dwr-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--fp-dwr-z, var(--z-modal));
  background: rgba(28, 28, 28, .34);
  /* iOS ≤17 只认带前缀的写法,无前缀在真机上等于没有模糊 */
  -webkit-backdrop-filter: blur(2px);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  box-sizing: border-box;
  opacity: 0;
  animation: fp-fade-in var(--dur-base) var(--ease-standard, ease) forwards;
}

.fp-dwr {
  z-index: 301;
  display: flex;
  flex-direction: column;
  max-height: min(85vh, 760px);
  background: var(--surface-white);
  border: 1px solid var(--border-subtle);
  border-radius: 16px;
  box-shadow: 0 24px 64px rgba(28, 28, 28, .28);
  overflow: hidden;
  transform: translateY(8px) scale(.985);
  opacity: 0;
  animation: fp-rise-in var(--dur-base) var(--ease-standard, ease) forwards;
}
/* 恒定高度档:高度钉在 max-height 上限,内容少不塌缩(fixedHeight prop) */
.fp-dwr--fixed { height: min(85vh, 760px); }
/* 全屏档:worksheet 级长表用,尺寸压过 fixed 与 width */
.fp-dwr--full { width: min(1720px, 96vw); height: 94vh; max-height: 94vh; }

.fp-dwr-hd {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 20px 22px 16px;
  border-bottom: 1px solid var(--divider);
}

.fp-dwr-icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  background: var(--surface-card);
  display: grid;
  place-items: center;
  color: var(--text-secondary);
  flex: 0 0 auto;
}

.fp-dwr-x {
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  display: grid;
  place-items: center;
  transition: background var(--dur-fast), color var(--dur-fast);
}
.fp-dwr-x:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.fp-dwr-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  /* 竖滚动条常驻占位:抽屉内切 tab(短内容↔长内容)时不再因滚动条出现/消失
     让内容宽 ±15px,户头四格/胶囊/明细表整体横向抖动 */
  scrollbar-gutter: stable;
  padding: 20px 22px 26px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}

.fp-dwr-ft {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 22px;
  border-top: 1px solid var(--divider);
  background: var(--surface-card);
}

/* S 档全屏接管(RESPONSIVE-LAYOUT-SPEC §4.4):居中弹卡是桌面隐喻,≤600 改全屏 sheet,
   体区照旧内滚。分支全在组件内部,调用方零改动——width 是调用方经 :style 内联传进来的,
   组件内只有 !important 盖得住内联,这是「零改动」的代价,不是偷懒。 */
@media (max-width: 600px) {
  .fp-dwr-backdrop { padding: 0; }
  .fp-dwr {
    width: 100% !important;
    height: 100%;
    max-height: none;
    border: none;
    border-radius: 0;
  }
  /* 脚部贴底,给 iOS 手势条让位 */
  .fp-dwr-ft { padding-bottom: calc(14px + env(safe-area-inset-bottom)); }
}
</style>
