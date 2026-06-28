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
  if (e.key === "Escape") setOpen(false);
}

watch(isOpen, (v) => {
  if (v) {
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
  } else {
    document.removeEventListener("mousedown", onDoc);
    document.removeEventListener("keydown", onKey);
  }
});

onUnmounted(() => {
  document.removeEventListener("mousedown", onDoc);
  document.removeEventListener("keydown", onKey);
});

const panelStyle = computed(() => ({
  position: "absolute" as const,
  top: "calc(100% + 8px)",
  ...(props.align === "end" ? { right: "0" } : { left: "0" }),
  zIndex: 60,
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
    <div v-if="isOpen" role="dialog" :style="panelStyle">
      <slot />
    </div>
  </span>
</template>
