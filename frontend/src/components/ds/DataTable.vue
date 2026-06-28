<script setup lang="ts">
import { computed } from "vue";
import Checkbox from "./Checkbox.vue";

export interface DataColumn<Row = any> {
  key: string;
  header: string;
  width?: number | string;
  align?: "left" | "center" | "right";
  mono?: boolean;
  wrap?: boolean;
  sortable?: boolean;
  render?: (row: Row) => any;
}

export interface DataTableProps<Row = any> {
  columns?: DataColumn<Row>[];
  rows?: Row[];
  rowKey?: string;
  selectable?: boolean;
  selected?: Array<string | number>;
  sort?: { key: string; dir: "asc" | "desc" };
  rowHover?: boolean;
  style?: Record<string, string>;
}

const props = withDefaults(defineProps<DataTableProps>(), {
  columns: () => [],
  rows: () => [],
  rowKey: "id",
  selectable: false,
  selected: () => [],
  rowHover: true,
});

const emit = defineEmits<{
  select: [ids: Array<string | number>];
  sort: [key: string];
}>();

const allChecked = computed(
  () =>
    props.selectable &&
    props.rows.length > 0 &&
    props.selected!.length === props.rows.length
);
const someChecked = computed(
  () => props.selectable && props.selected!.length > 0 && !allChecked.value
);

function toggleAll() {
  if (!props.selectable) return;
  emit("select", allChecked.value ? [] : props.rows.map((r: any) => r[props.rowKey!]));
}

function toggleOne(id: string | number) {
  const sel = props.selected!;
  emit(
    "select",
    sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]
  );
}

function onSort(key: string, sortable?: boolean) {
  if (sortable) emit("sort", key);
}

function onMouseEnter(e: MouseEvent, isSel: boolean) {
  if (props.rowHover && !isSel)
    (e.currentTarget as HTMLElement).style.background = "var(--bg-panel)";
}
function onMouseLeave(e: MouseEvent, isSel: boolean) {
  if (props.rowHover && !isSel)
    (e.currentTarget as HTMLElement).style.background = "transparent";
}
</script>

<template>
  <div :style="{ width: '100%', overflowX: 'auto', ...style }">
    <table style="width: 100%; border-collapse: collapse; font-family: var(--font-sans)">
      <thead>
        <tr style="border-bottom: 1px solid var(--divider)">
          <th
            v-if="selectable"
            style="width: 40px; padding: 0 8px 10px 12px; text-align: left"
          >
            <Checkbox
              :checked="allChecked"
              :indeterminate="someChecked"
              @change="toggleAll"
            />
          </th>
          <th
            v-for="c in columns"
            :key="c.key"
            :style="{
              width: c.width,
              padding: '0 16px 10px',
              textAlign: c.align || 'left',
              font: 'var(--type-label)',
              fontWeight: 'var(--fw-regular)',
              color: 'var(--text-muted)',
              whiteSpace: 'nowrap',
              cursor: c.sortable ? 'pointer' : 'default',
              userSelect: 'none',
            }"
            @click="onSort(c.key, c.sortable)"
          >
            <span style="display: inline-flex; align-items: center; gap: 4px">
              {{ c.header }}
              <span
                v-if="c.sortable"
                :style="{
                  color:
                    sort && sort.key === c.key
                      ? 'var(--text-secondary)'
                      : 'var(--text-disabled)',
                  fontSize: '11px',
                }"
              >
                {{ sort && sort.key === c.key ? (sort.dir === 'desc' ? '↓' : '↑') : '↕' }}
              </span>
            </span>
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in rows"
          :key="(r as any)[rowKey!]"
          :data-selected="selected!.includes((r as any)[rowKey!]) || undefined"
          :style="{
            borderBottom: '1px solid var(--divider)',
            background: selected!.includes((r as any)[rowKey!]) ? 'var(--bg-hover)' : 'transparent',
            transition: 'background var(--dur-fast) var(--ease-standard)',
          }"
          @mouseenter="onMouseEnter($event, selected!.includes((r as any)[rowKey!]))"
          @mouseleave="onMouseLeave($event, selected!.includes((r as any)[rowKey!]))"
        >
          <td v-if="selectable" style="padding: 12px 8px 12px 12px">
            <Checkbox
              :checked="selected!.includes((r as any)[rowKey!])"
              @change="toggleOne((r as any)[rowKey!])"
            />
          </td>
          <td
            v-for="c in columns"
            :key="c.key"
            :style="{
              padding: '12px 16px',
              textAlign: c.align || 'left',
              font: 'var(--type-body)',
              color: 'var(--text-primary)',
              whiteSpace: c.wrap ? 'normal' : 'nowrap',
              fontVariantNumeric: c.mono ? 'tabular-nums' : 'normal',
              fontFamily: c.mono ? 'var(--font-mono)' : 'var(--font-sans)',
            }"
          >
            <!-- ponytail: render() returns any; v-html unsafe so use component slot trick is overkill — caller passes VNodes via render, rendered as-is -->
            <component :is="() => c.render ? c.render(r) : (r as any)[c.key]" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
