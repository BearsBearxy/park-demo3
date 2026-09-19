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
/* C2-03:transition 与 box-shadow 从内联 :style 迁到这里 —— 内联 transition 让下面
   :active 的 transition-duration: 0ms 永远输。白药丸阴影此前不在过渡列表里,瞬现。 */
.ds-seg-item {
  --ds-seg-bg: transparent;
  --ds-seg-fg: var(--text-muted);
  box-shadow: none;
  transition: background var(--dur-fast) var(--ease-standard),
              color var(--dur-fast) var(--ease-standard),
              box-shadow var(--dur-fast) var(--ease-standard);
}
/* 选中格 --surface-raised:暗色下比卡片亮一层,对轨道才分得开(稿 Components ③) */
.ds-seg-item[data-on] { --ds-seg-bg: var(--surface-raised); --ds-seg-fg: var(--text-primary); box-shadow: var(--shadow-pill); }
.ds-seg-item:hover:not([data-on]) { --ds-seg-fg: var(--text-secondary); }
/* 按压:底色换一档,0ms 瞬到;选中项不压(已是选中态)。背景写在内联 style 里读的是
   --ds-seg-bg,所以换变量而不是写 background。 */
.ds-seg-item:active:not([data-on]):not(:disabled) { --ds-seg-bg: var(--ink-100); transition-duration: 0ms; }
</style>
