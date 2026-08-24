<script setup lang="ts">
import { computed, ref, watch } from "vue";

export interface PaginationProps {
  page?: number;
  pageCount?: number;
  pageSize?: number;
  total?: number;
  onPage?: (page: number) => void;
  onPageSize?: (size: number) => void;
  showMeta?: boolean;
  /** max page pills shown before windowing with … ellipsis */
  maxPills?: number;
  // v-model support (mirrors onPage for controlled usage)
  modelValue?: number;
}

const props = withDefaults(defineProps<PaginationProps>(), {
  page: 1,
  pageCount: 5,
  pageSize: 20,
  showMeta: true,
  maxPills: 7,
});

const emit = defineEmits<{
  (e: "change", value: number): void;
  (e: "page", value: number): void;
  (e: "update:modelValue", value: number): void;
  (e: "pageSizeChange", size: number): void;
}>();

// Controlled/uncontrolled duality
const internalPage = ref(props.page);
// ponytail: prefer modelValue > page prop > internalPage (uncontrolled local state)
const currentPage = computed(() =>
  props.modelValue !== undefined ? props.modelValue : internalPage.value
);
// keep internalPage in sync when parent drives :page
watch(() => props.page, v => { internalPage.value = v });

// windowed page list: first + last + a window around current, with … for gaps.
// keeps the pill count <= ~maxPills no matter how many pages there are.
const pages = computed<(number | "…")[]>(() => {
  const count = props.pageCount;
  if (count <= props.maxPills) {
    return Array.from({ length: count }, (_, i) => i + 1);
  }
  const cur = currentPage.value;
  const left = Math.max(2, cur - 1);
  const right = Math.min(count - 1, cur + 1);
  const out: (number | "…")[] = [1];
  if (left > 2) out.push("…");
  for (let i = left; i <= right; i++) out.push(i);
  if (right < count - 1) out.push("…");
  out.push(count);
  return out;
});

function goToPage(p: number) {
  internalPage.value = p;
  emit("change", p);
  emit("page", p);
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
  border: "1px solid var(--ds-pg-border)",
  borderRadius: "var(--radius-full)",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--fs-body)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

// ⚠ hover 不在这里:pillStyle 只能产出内联样式,而内联装不下 :hover ——
// 这正是改前 pillStyle(on, dis) 只有这两个分支、页码上根本没有悬停反馈的原因。
// hover 改由下方 <style scoped> 的 .ds-pg-pill:hover 负责。
function pillStyle(on: boolean, dis: boolean) {
  return {
    ...pillBase,
    background: on ? "var(--bg-sunken)" : "transparent",
    color: dis ? "var(--text-disabled)" : "var(--text-primary)",
    fontWeight: on ? "var(--fw-semibold)" : "var(--fw-regular)",
    cursor: dis ? "not-allowed" : "pointer",
  };
}

const ellipsisStyle = {
  minWidth: "20px",
  height: "32px",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--text-disabled)",
  fontFamily: "var(--font-sans)",
  fontSize: "var(--fs-body)",
  userSelect: "none" as const,
};
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
      class="ds-pg-pill"
      :disabled="currentPage <= 1"
      :style="pillStyle(false, currentPage <= 1)"
      @click="goToPage(currentPage - 1)"
    >‹</button>

    <!-- Page pills (windowed: caps at maxPills with … ellipsis) -->
    <template v-for="(p, i) in pages" :key="i">
      <span v-if="p === '…'" :style="ellipsisStyle">…</span>
      <button
        v-else
        class="ds-pg-pill"
        :style="pillStyle(p === currentPage, false)"
        @click="goToPage(p as number)"
      >{{ p }}</button>
    </template>

    <!-- Next -->
    <button
      aria-label="Next"
      class="ds-pg-pill"
      :disabled="currentPage >= pageCount"
      :style="pillStyle(false, currentPage >= pageCount)"
      @click="goToPage(currentPage + 1)"
    >›</button>
  </div>
</template>

<style scoped>
/* 页码胶囊的悬停。改前 pillStyle(on, dis) 只有「当前页」与「禁用」两个分支,
   鼠标移到页码上毫无反馈 —— 用户不确定这个数字能不能点。

   ⚠ 悬停改的是**边框**不是底色:--bg-hover(ink 5%)与当前页的 --bg-sunken
   在白底上几乎同色,用底色区分会让「悬停」和「当前页」看起来一样。 */
.ds-pg-pill {
  --ds-pg-border: var(--border-subtle);
  transition: border-color var(--dur-fast) var(--ease-standard),
              background var(--dur-fast) var(--ease-standard);
}
.ds-pg-pill:hover:not(:disabled) { --ds-pg-border: var(--border-strong); }
</style>
