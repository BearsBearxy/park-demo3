<script setup lang="ts">
import type { VNode } from "vue";
import { computed } from "vue";

export type SegmentedOption =
  | string
  | { value: string; label: string | VNode; icon?: VNode };

export interface SegmentedProps {
  options?: SegmentedOption[];
  /** Controlled value; also used as v-model target via modelValue alias */
  value?: string;
  modelValue?: string;
  size?: "sm" | "md" | "lg";
}

const props = withDefaults(defineProps<SegmentedProps>(), {
  options: () => [],
  size: "md",
});

const emit = defineEmits<{
  change: [value: string];
  "update:modelValue": [value: string];
}>();

const heightMap = { sm: 28, md: 32, lg: 38 } as const;

// 根样式两条防变形(2026-08-09 催缴单抽屉报障):
// width:fit-content —— 放进 flex column / grid 父(如 FPDrawer 的 .fp-dwr-body)时 inline-flex 被块化,
//   cross 尺寸为 auto 会被 align-items:stretch 拉成整行宽(轨道底色铺满一横条 + 宽度随父内容宽抖动);
//   宽度非 auto 即不参与 stretch,flex row 父(全站 14 处工具条)按 flex-basis:auto 走内容宽,无变化。
// flexShrink:0 —— 定高 flex 列里本组件若是唯一可压缩项会独吞溢出被压扁(28→26px),下方内容随之上移。
// 另:两态字重恒为 --fw-medium(选中只换底色/阴影),故切换不改变文本宽度,无需等宽占位。

const items = computed(() =>
  props.options.map((o) =>
    typeof o === "string" ? { value: o, label: o, icon: undefined } : o
  )
);

// Controlled: prefer modelValue (v-model), then value, then first item
const active = computed(
  () => props.modelValue ?? props.value ?? items.value[0]?.value
);

function handleClick(val: string) {
  emit("change", val);
  emit("update:modelValue", val);
}
</script>

<template>
  <div
    role="tablist"
    :style="{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '2px',
      padding: '3px',
      height: `${heightMap[size]}px`,
      width: 'fit-content',
      flexShrink: 0,
      background: 'var(--bg-sunken)',
      borderRadius: 'var(--radius-full)',
      boxSizing: 'border-box',
    }"
    v-bind="$attrs"
  >
    <button
      v-for="it in items"
      :key="it.value"
      role="tab"
      class="ds-seg-item"
      :data-on="it.value === active ? '' : undefined"
      :aria-selected="it.value === active"
      :style="{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        height: '100%',
        padding: '0 14px',
        border: 'none',
        borderRadius: 'var(--radius-full)',
        background: 'var(--ds-seg-bg)',
        color: 'var(--ds-seg-fg)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--fs-body)',
        fontWeight: 'var(--fw-medium)',
        cursor: 'pointer',
        boxShadow: it.value === active ? 'var(--shadow-pill)' : 'none',
        transition:
          'background var(--dur-fast) var(--ease-standard), color var(--dur-fast)',
        whiteSpace: 'nowrap',
      }"
      @click="handleClick(it.value)"
    >
      <component :is="it.icon" v-if="it.icon" />
      {{ it.label }}
    </button>
  </div>
</template>

<style scoped>
/* 未选中项此前没有任何悬停反馈,鼠标移上去毫无变化。
   ⚠ 悬停只提文字色(--text-muted → --text-secondary),不加底色:
   加底色会和「选中态的白底」撞在一起,读成两个都被选中了。 */
.ds-seg-item { --ds-seg-bg: transparent; --ds-seg-fg: var(--text-muted); }
.ds-seg-item[data-on] { --ds-seg-bg: var(--surface-white); --ds-seg-fg: var(--text-primary); }
.ds-seg-item:hover:not([data-on]) { --ds-seg-fg: var(--text-secondary); }
</style>
