<script setup lang="ts">
import { computed, ref } from "vue";

export interface PaginationProps {
  page?: number;
  pageCount?: number;
  pageSize?: number;
  total?: number;
  onPage?: (page: number) => void;
  onPageSize?: (size: number) => void;
  showMeta?: boolean;
  // v-model support (mirrors onPage for controlled usage)
  modelValue?: number;
}

const props = withDefaults(defineProps<PaginationProps>(), {
  page: 1,
  pageCount: 5,
  pageSize: 20,
  showMeta: true,
});

const emit = defineEmits<{
  (e: "change", value: number): void;
  (e: "update:modelValue", value: number): void;
  (e: "pageSizeChange", size: number): void;
}>();

// Controlled/uncontrolled duality: if modelValue is provided, use it; else use page prop; else internal ref
const internalPage = ref(props.page);

const currentPage = computed(() =>
  props.modelValue !== undefined ? props.modelValue : props.page
);

const pages = computed(() =>
  Array.from({ length: props.pageCount }, (_, i) => i + 1)
);

function goToPage(p: number) {
  internalPage.value = p;
  emit("change", p);
  emit("update:modelValue", p);
  props.onPage?.(p);
}

function handlePageSizeChange(e: Event) {
  const size = Number((e.target as HTMLSelectElement).value);
  emit("pageSizeChange", size);
  props.onPageSize?.(size);
}

const pillBase = {
  minWidth: "32px",
  height: "32px",
  padding: "0 10px",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-full)",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--fs-body)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

function pillStyle(on: boolean, dis: boolean) {
  return {
    ...pillBase,
    background: on ? "var(--bg-sunken)" : "transparent",
    color: dis ? "var(--text-disabled)" : "var(--text-primary)",
    fontWeight: on ? "var(--fw-semibold)" : "var(--fw-regular)",
    cursor: dis ? "not-allowed" : "pointer",
  };
}
</script>

<template>
  <div :style="{ display: 'flex', alignItems: 'center', gap: '12px' }">
    <div
      v-if="showMeta"
      :style="{ display: 'flex', alignItems: 'center', gap: '12px', marginRight: 'auto' }"
    >
      <select
        :value="pageSize"
        :style="{
          appearance: 'none',
          height: '32px',
          padding: '0 24px 0 12px',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--surface-white)',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--fs-body)',
          color: 'var(--text-primary)',
          cursor: 'pointer',
        }"
        @change="handlePageSizeChange"
      >
        <option v-for="n in [10, 20, 50, 100]" :key="n" :value="n">{{ n }}</option>
      </select>
      <span
        v-if="total != null"
        :style="{ font: 'var(--type-body)', color: 'var(--text-muted)' }"
      >共 {{ total }} 条</span>
    </div>

    <!-- Prev -->
    <button
      aria-label="Previous"
      :disabled="currentPage <= 1"
      :style="pillStyle(false, currentPage <= 1)"
      @click="goToPage(currentPage - 1)"
    >‹</button>

    <!-- Page pills -->
    <button
      v-for="p in pages"
      :key="p"
      :style="pillStyle(p === currentPage, false)"
      @click="goToPage(p)"
    >{{ p }}</button>

    <!-- Next -->
    <button
      aria-label="Next"
      :disabled="currentPage >= pageCount"
      :style="pillStyle(false, currentPage >= pageCount)"
      @click="goToPage(currentPage + 1)"
    >›</button>
  </div>
</template>
