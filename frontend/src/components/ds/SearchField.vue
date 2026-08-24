<script setup lang="ts">
import { computed } from "vue";

export interface SearchFieldProps {
  placeholder?: string;
  /** Keyboard shortcut hint shown on the right. @default "/" */
  shortcut?: string;
  /** Controlled value (also used as modelValue for v-model). */
  value?: string;
  modelValue?: string;
  /** Pixel width. @default 240 */
  width?: number;
}

const props = withDefaults(defineProps<SearchFieldProps>(), {
  placeholder: "搜索",
  shortcut: "/",
  width: 240,
});

const emit = defineEmits<{
  /** Mirrors React onChange — emits the native InputEvent value string. */
  (e: "change", value: string): void;
  (e: "update:modelValue", value: string): void;
}>();

// ponytail: controlled/uncontrolled duality — if neither value nor modelValue
// is passed the input is uncontrolled (no :value binding needed).
const controlledValue = computed(() =>
  props.modelValue !== undefined ? props.modelValue : props.value
);

function onInput(event: Event) {
  const val = (event.target as HTMLInputElement).value;
  emit("change", val);
  emit("update:modelValue", val);
}

const wrapperStyle = computed(() => ({
  display: "inline-flex",
  alignItems: "center",
  gap: "8px",
  height: "32px",
  width: props.width + "px",
  padding: "0 10px",
  background: "var(--bg-panel)",
  border: "1px solid var(--ds-sf-border)",
  borderRadius: "var(--radius-sm)",
  transition: "border-color var(--dur-fast) var(--ease-standard)",
}));
</script>

<template>
  <div class="ds-searchfield" :style="wrapperStyle">
    <!-- Magnifier icon — inline SVG verbatim from SearchField.jsx -->
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      :style="{ color: 'var(--text-muted)', flex: '0 0 auto' }"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>

    <input
      v-bind="controlledValue !== undefined ? { value: controlledValue } : {}"
      :placeholder="placeholder"
      :style="{
        flex: 1,
        minWidth: 0,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--fs-body)',
        color: 'var(--text-primary)',
      }"
      @input="onInput"
    />

    <kbd
      v-if="shortcut"
      :style="{
        font: 'var(--type-label)',
        color: 'var(--text-disabled)',
        border: 'none',
        background: 'transparent',
      }"
    >{{ shortcut }}</kbd>
  </div>
</template>

<style scoped>
/* 改前这个搜索框**完全没有聚焦态**:外框边框写死 --border-subtle 从不改变,
   内部 <input> 又是 outline:none —— 用键盘 Tab 进来时屏幕上没有任何变化,
   键盘用户无法知道自己停在哪。焦点环不能直接画在 input 上(会套在外框里成为
   「框中框」),故改由外框响应。 */
.ds-searchfield { --ds-sf-border: var(--border-subtle); }
.ds-searchfield:has(:focus-visible) { --ds-sf-border: var(--status-info); }
</style>
