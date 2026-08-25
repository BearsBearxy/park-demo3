<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from "vue";

export interface PopoverProps {
  /** Element that toggles the popover — pass via slot:trigger instead. */
  align?: "start" | "end";
  width?: number;
  open?: boolean;
  modelValue?: boolean;
  style?: Record<string, string>;
}

const props = withDefaults(defineProps<PopoverProps>(), {
  align: "start",
  width: 240,
  // 显式 undefined:布尔 prop 缺省时 Vue 强转 false,使 `!== undefined` 受控判定恒真,
  // 非受控模式(不传 open/modelValue)永远打不开(popoverTrigger.spec 回归锁)
  open: undefined,
  modelValue: undefined,
});

const emit = defineEmits<{
  (e: "update:modelValue", v: boolean): void;
  (e: "openChange", v: boolean): void;
}>();

const uOpen = ref(false);
// controlled: modelValue prop present OR open prop present
const isOpen = computed(() =>
  props.modelValue !== undefined
    ? props.modelValue
    : props.open !== undefined
    ? props.open
    : uOpen.value
);

function setOpen(v: boolean) {
  if (props.modelValue !== undefined) {
    emit("update:modelValue", v);
  } else if (props.open !== undefined) {
    emit("openChange", v);
  } else {
    uOpen.value = v;
  }
}

const root = ref<HTMLElement | null>(null);

function onDoc(e: MouseEvent) {
  if (root.value && !root.value.contains(e.target as Node)) setOpen(false);
}
function onKey(e: KeyboardEvent) {
  // Esc 只关本浮层:阻断传播,否则宿主弹窗(FPDrawer 等 window keydown)会连宿主一起关(FPTenantPicker 同款前例)
  if (e.key === "Escape") {
    e.stopPropagation();
    setOpen(false);
  }
}

// 监听挂 capture 阶段:宿主弹窗容器常有 @mousedown.stop(如 FPDrawer .fp-dwr),
// 冒泡阶段监听在弹窗内永远收不到事件,「点外关闭」会整体失效;capture 先于 .stop 派发,不受影响。
watch(isOpen, (v) => {
  if (v) {
    document.addEventListener("mousedown", onDoc, true);
    document.addEventListener("keydown", onKey, true);
  } else {
    document.removeEventListener("mousedown", onDoc, true);
    document.removeEventListener("keydown", onKey, true);
  }
});

onUnmounted(() => {
  document.removeEventListener("mousedown", onDoc, true);
  document.removeEventListener("keydown", onKey, true);
});

const panelStyle = computed(() => ({
  position: "absolute" as const,
  top: "calc(100% + 8px)",
  ...(props.align === "end" ? { right: "0" } : { left: "0" }),
  zIndex: 'var(--z-popover)',
  width: props.width + "px",
  background: "var(--surface-white)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-md)",
  boxShadow: "var(--shadow-pop)",
  padding: "8px",
  ...props.style,
}));
</script>

<template>
  <span ref="root" style="position: relative; display: inline-flex">
    <span style="display: inline-flex" @click="setOpen(!isOpen)">
      <slot name="trigger" />
    </span>
    <div v-if="isOpen" class="ds-popover-panel" role="dialog" :style="panelStyle">
      <slot />
    </div>
  </span>
</template>

<style scoped>
/* 面板入场。改前是 v-if 硬切,面板凭空出现。与 Select 的下拉同规格
   (见 motion.css 的 fp-pop-in):120ms / 4px —— 贴附浮层是高频操作,
   时长按频率定而不是按重要性定。 */
.ds-popover-panel { animation: fp-pop-in var(--dur-fast) var(--ease-out); }
</style>
