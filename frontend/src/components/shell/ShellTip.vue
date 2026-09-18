<script setup lang="ts">
// ShellTip — 顶栏图标的说明气泡(TAB-BAR-SPEC §6.4)。
// 鼠标停 500ms 出;刚收起一个又停到旁边的图标上时立即出(扫一排图标不用每个都等);按下鼠标即收。
// 贴在触发物正下方,深底白字,与版本更新的「更新记录随时在这里看」同一种样子。
// pointer-events:none —— 它只说一句话,不接管点击。
// 挂到 body 上按触发物的位置摆(fixed):导航卡 overflow:hidden、顶栏 backdrop-filter 都会裁掉 / 错位原地的浮层。
import { ref, onBeforeUnmount, type CSSProperties } from 'vue'

const props = withDefaults(defineProps<{
  title: string
  sub?: string
  kbd?: string
  /** 气泡对齐:居中 / 左对齐 / 右对齐(贴近屏幕右缘的图标用 end,免得出界) */
  align?: 'center' | 'start' | 'end'
  /** 出在上方(贴屏幕底边的触发物用,如左下角 ⌘) */
  up?: boolean
  disabled?: boolean
}>(), { align: 'center', up: false, disabled: false })

const DELAY = 500
const show = ref(false)
const wrap = ref<HTMLElement | null>(null)
const pos = ref<CSSProperties>({})
let timer: ReturnType<typeof setTimeout> | undefined

function place() {
  const r = wrap.value?.getBoundingClientRect()
  if (!r) return
  const p: CSSProperties = props.up ? { bottom: `${window.innerHeight - r.top + 8}px` } : { top: `${r.bottom + 8}px` }
  if (props.align === 'start') p.left = `${r.left}px`
  else if (props.align === 'end') p.right = `${window.innerWidth - r.right}px`
  else p.left = `${r.left + r.width / 2}px`
  pos.value = p
}
function open() { place(); show.value = true }
function enter() {
  if (props.disabled) return
  clearTimeout(timer)
  if (Date.now() - tipState.lastHide < 300) open()
  else timer = setTimeout(open, DELAY)
}
function leave() {
  clearTimeout(timer)
  if (show.value) tipState.lastHide = Date.now()
  show.value = false
}
function down() {
  clearTimeout(timer)
  show.value = false
  tipState.lastHide = 0
}
onBeforeUnmount(() => clearTimeout(timer))
</script>

<script lang="ts">
/** 全部气泡共用:上一个是什么时候收起的。导出给测试复位。 */
export const tipState = { lastHide: 0 }
</script>

<template>
  <span ref="wrap" class="fp-tipw" @mouseenter="enter" @mouseleave="leave" @mousedown.capture="down">
    <slot />
    <Teleport to="body">
      <span v-if="show" class="fp-tip-pos" :class="[align, { up }]" :style="pos">
        <span class="fp-tip" :class="[align, { up }]" role="tooltip">
          <b>{{ title }}</b><span v-if="kbd" class="k">{{ kbd }}</span>
          <span v-if="sub" class="sub">{{ sub }}</span>
        </span>
      </span>
    </Teleport>
  </span>
</template>

<style scoped>
.fp-tipw { position: relative; display: inline-flex; flex: 0 0 auto; }
.fp-tip-pos {
  position: fixed;
  z-index: var(--z-popover);
  pointer-events: none;
}
.fp-tip-pos.center { transform: translateX(-50%); }
.fp-tip {
  position: relative;
  display: block;
  width: max-content;
  max-width: 320px;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgb(40, 52, 66);
  color: #fff;
  font-size: 12px;
  line-height: 18px;
  font-weight: var(--fw-regular);
  text-align: left;
  white-space: nowrap;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.18);
  animation: fp-pop-in var(--dur-fast) var(--ease-out);
}
.fp-tip b { font-weight: var(--fw-semibold); }
.fp-tip .k { margin-left: 8px; color: rgba(255, 255, 255, 0.62); font-family: var(--font-mono); font-size: 11px; }
.fp-tip .sub { display: block; color: rgba(255, 255, 255, 0.66); }
.fp-tip::after {
  content: "";
  position: absolute;
  top: -6px;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-bottom: 6px solid rgb(40, 52, 66);
}
.fp-tip.up::after { top: auto; bottom: -6px; border-bottom: none; border-top: 6px solid rgb(40, 52, 66); }
.fp-tip.center::after { left: 50%; margin-left: -6px; }
.fp-tip.start::after { left: 8px; }
.fp-tip.end::after { right: 8px; }
</style>
