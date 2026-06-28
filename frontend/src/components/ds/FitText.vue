<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick, useAttrs } from "vue";

export interface FitTextProps {
  /** Content to fit on one line — pass as slot, this is just for typing. */
  max?: number;
  /** Largest font size in px. @default 28 */
  min?: number;
  /** Smallest font size in px before clipping. @default 14 */
  title?: string;
}

const props = withDefaults(defineProps<FitTextProps>(), {
  max: 28,
  min: 14,
});

const attrs = useAttrs();
const spanRef = ref<HTMLSpanElement | null>(null);
const fs = ref(props.max);

function fit() {
  const el = spanRef.value;
  if (!el) return;
  const parent = el.parentElement;
  if (!parent) return;
  const cs = getComputedStyle(parent);
  const avail =
    parent.clientWidth -
    (parseFloat(cs.paddingLeft) || 0) -
    (parseFloat(cs.paddingRight) || 0);
  if (avail <= 0) return;
  el.style.fontSize = props.max + "px";
  const natural = el.scrollWidth;
  const next =
    natural > avail
      ? Math.max(props.min, Math.floor((props.max * avail) / natural * 10) / 10)
      : props.max;
  el.style.fontSize = next + "px";
  fs.value = next;
}

let ro: ResizeObserver | undefined;

onMounted(() => {
  nextTick(() => {
    fit();
    const el = spanRef.value;
    if (typeof ResizeObserver !== "undefined" && el) {
      ro = new ResizeObserver(fit);
      ro.observe(el.parentElement || el);
    }
  });
});

onUnmounted(() => {
  ro?.disconnect();
});

// Re-run fit when max/min props change (mirrors the [children, max, min] dep array)
watch(() => [props.max, props.min], () => nextTick(fit));
</script>

<template>
  <span
    ref="spanRef"
    v-bind="attrs"
    :title="title"
    :style="{
      display: 'inline-block',
      whiteSpace: 'nowrap',
      fontSize: fs + 'px',
      lineHeight: 1.1,
    }"
  ><slot /></span>
</template>
