<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, useId } from "vue";

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  label?: string;
  options?: Array<string | SelectOption>;
  value?: string;
  modelValue?: string;
  defaultValue?: string;
  placeholder?: string;
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  defaultOpen?: boolean;
  id?: string;
  style?: string | Record<string, string>;
}

const props = withDefaults(defineProps<SelectProps>(), {
  options: () => [],
  size: "md",
  disabled: false,
  defaultOpen: false,
});

const emit = defineEmits<{
  change: [e: { target: { value: string } }, value: string];
  "update:modelValue": [value: string];
}>();

// controlled: modelValue (v-model) or value prop; uncontrolled: inner ref
const inner = ref<string | undefined>(
  props.modelValue !== undefined
    ? props.modelValue
    : props.value !== undefined
    ? props.value
    : props.defaultValue
);

// prefer modelValue for v-model, then value for controlled, then inner
const val = computed(() =>
  props.modelValue !== undefined
    ? props.modelValue
    : props.value !== undefined
    ? props.value
    : inner.value
);

const open = ref(props.defaultOpen);
const containerRef = ref<HTMLElement | null>(null);

const autoId = useId();
const selectId = computed(() => props.id || autoId);

const height = computed(() => ({ sm: 32, md: 36, lg: 44 }[props.size] ?? 36));

const items = computed<SelectOption[]>(() =>
  props.options.map((o) =>
    typeof o === "string" ? { value: o, label: o } : { value: o.value, label: String(o.label) }
  )
);

const current = computed(() => items.value.find((it) => it.value === val.value));

function pick(v: string) {
  inner.value = v;
  open.value = false;
  const e = { target: { value: v } };
  emit("change", e, v);
  emit("update:modelValue", v);
}

function onDoc(e: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    open.value = false;
  }
}

function onKey(e: KeyboardEvent) {
  // Esc 只关本下拉:不阻断的话宿主弹窗(FPDrawer 的 window keydown)会连宿主一起关,
  // 用户想收下拉、结果整个抽屉没了,录到一半的东西全丢(UI-OVERLAY-SPEC §2)
  if (e.key === "Escape") {
    e.stopPropagation();
    open.value = false;
  }
}

// ⭐capture 阶段(UI-OVERLAY-SPEC §1):宿主弹窗容器普遍带 @mousedown.stop —— FPDrawer.vue:33
// 的 .fp-dwr 就是。冒泡阶段监听在弹窗内**永远收不到**事件,于是抽屉里每一个下拉点外面都不关,
// 只能再点一次触发器或按 Esc(2026-08-15 用户报障「点开了点击别的区域不会回弹关闭」)。
// capture 先于任何 .stop 派发,不受影响。同 ds/Popover.vue 的既有做法。
onMounted(() => {
  document.addEventListener("mousedown", onDoc, true);
  document.addEventListener("keydown", onKey, true);
});

onUnmounted(() => {
  document.removeEventListener("mousedown", onDoc, true);
  document.removeEventListener("keydown", onKey, true);
});
</script>

<template>
  <div
    ref="containerRef"
    :style="[
      { display: 'flex', flexDirection: 'column', gap: '6px', position: 'relative' },
      props.style as any,
    ]"
  >
    <label
      v-if="label"
      :for="selectId"
      :style="{
        font: 'var(--type-label)',
        color: 'var(--text-secondary)',
        fontWeight: 'var(--fw-medium)',
      }"
    >
      {{ label }}
    </label>

    <button
      :id="selectId"
      type="button"
      :disabled="disabled"
      aria-haspopup="listbox"
      :aria-expanded="open"
      @click="open = !open"
      :style="{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '8px',
        height: height + 'px',
        padding: '0 12px',
        background: disabled ? 'var(--bg-sunken)' : 'var(--surface-white)',
        border: `1px solid ${open ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
        borderRadius: 'var(--radius-sm)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--fs-body)',
        color: current ? 'var(--text-primary)' : 'var(--text-muted)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        textAlign: 'left',
        width: '100%',
        boxSizing: 'border-box',
        transition: 'border-color var(--dur-fast) var(--ease-standard)',
        opacity: disabled ? '0.6' : '1',
      }"
    >
      <span :style="{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }">
        {{ current ? current.label : placeholder || "请选择" }}
      </span>
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        :style="{
          color: 'var(--text-muted)',
          flex: '0 0 auto',
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform var(--dur-fast) var(--ease-standard)',
        }"
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <div
      v-if="open"
      role="listbox"
      :style="{
        position: 'absolute',
        top: 'calc(100% + 6px)',
        left: '0',
        /* 面板宽度贴内容不贴触发器:窄触发器(如 92px 月份选择)下选项文本+勾不再截断 */
        minWidth: '100%',
        width: 'max-content',
        maxWidth: '280px',
        zIndex: '60',
        background: 'var(--surface-white)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        boxShadow: 'var(--shadow-pop)',
        padding: '6px',
        /* 12 项(年月选择)整列可见不滚动:12×36px 行高 + 上下 padding */
        maxHeight: '456px',
        overflowY: 'auto',
        boxSizing: 'border-box',
      }"
    >
      <button
        v-for="it in items"
        :key="it.value"
        type="button"
        role="option"
        :aria-selected="it.value === val"
        @click="pick(it.value)"
        @mouseenter="($event.currentTarget as HTMLElement).style.background = 'var(--bg-hover)'"
        @mouseleave="($event.currentTarget as HTMLElement).style.background = 'transparent'"
        :style="{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          width: '100%',
          padding: '8px 10px',
          border: 'none',
          borderRadius: 'var(--radius-sm)',
          background: 'transparent',
          color: 'var(--text-primary)',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--fs-body)',
          fontWeight: it.value === val ? 'var(--fw-medium)' : 'var(--fw-regular)',
          cursor: 'pointer',
          textAlign: 'left',
          transition: 'background var(--dur-fast) var(--ease-standard)',
        }"
      >
        <span :style="{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }">
          {{ it.label }}
        </span>
        <svg
          v-if="it.value === val"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
          :style="{ flex: '0 0 auto' }"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      </button>
    </div>
  </div>
</template>
