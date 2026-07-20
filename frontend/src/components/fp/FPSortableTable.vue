<script setup lang="ts">
// ponytail: 自建 <table>，表头用 Popover 排序触发器（需 VNode 表头，故不走纯文本插值的通用表格）
import { computed, h, defineComponent, type VNode } from 'vue'
import Popover from '@/components/ds/Popover.vue'
import PopoverItem from '@/components/ds/PopoverItem.vue'
import { fpSortRows } from './fpSort'
import type { SortState, SortValue } from './fpSort'

// 列定义（原从已删除的 ds/DataTable.vue 导入；FPSortableTable 是唯一使用方，内联于此）
export interface SortableColumn<Row = any> {
  key: string
  header: string
  width?: number | string
  align?: 'left' | 'center' | 'right'
  mono?: boolean
  wrap?: boolean
  render?: (row: Row) => VNode | string
  sortValue?: SortValue
}

const props = withDefaults(defineProps<{
  columns: SortableColumn[]
  rows: any[]
  rowKey?: string
  sort?: SortState | null
  rowHover?: boolean
  // 列宽铁律(LIST-PAGE-SPEC §4):true 时 table-layout:fixed——定宽列锁死,唯一无宽列吸收余宽,
  // 列位置不随单元格内容长短或翻页漂移。默认 false 向后兼容既有使用方。
  fixedLayout?: boolean
}>(), {
  rowKey: 'id',
  sort: null,
  rowHover: true,
  fixedLayout: false,
})

const emit = defineEmits<{
  sortChange: [sort: SortState | null]
  rowClick: [row: any]
}>()

function onSort(key: string, dir: 'asc' | 'desc' | null) {
  emit('sortChange', dir === null ? null : { key, dir })
}

const sortedRows = computed(() => fpSortRows(props.rows, props.sort ?? null, props.columns))

// Cell shim — same pattern as DataTable.vue
const Cell = defineComponent({
  props: { node: { default: null } },
  render() { return this.node },
})

// Inline SVG — avoids lucide timing issues (mirrors fp-table-sort.jsx Ico)
function ico(paths: string[], size = 13) {
  return h('svg', {
    width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', 'stroke-width': '1.7',
    'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    style: 'flex:0 0 auto',
  }, paths.map(d => h('path', { d })))
}
const ICO_UP   = ['M12 19V5', 'M5 12l7-7 7 7']
const ICO_DOWN = ['M12 5v14', 'M5 12l7 7 7-7']
const ICO_X    = ['M18 6L6 18', 'M6 6l12 12']

function renderSortHeader(col: SortableColumn) {
  const active    = props.sort?.key === col.key
  const dir       = active ? props.sort!.dir : null
  const indicator = dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : '↕'
  const align     = col.align || 'left'

  const trigger = h('span', {
    role: 'button',
    tabindex: '0',
    title: '排序',
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
      cursor: 'pointer',
      userSelect: 'none',
      padding: '2px 6px',
      margin: '-2px -6px',
      borderRadius: 'var(--radius-sm)',
      color: active ? 'var(--text-primary)' : 'inherit',
      font: 'inherit',
      fontWeight: 'inherit',
      flexDirection: align === 'right' ? 'row-reverse' : 'row',
    },
  }, [
    h('span', null, col.header as string),
    h('span', {
      style: {
        fontSize: '11px',
        color: active ? 'var(--hue-blue)' : 'var(--text-disabled)',
        fontFamily: 'var(--font-sans)',
        lineHeight: '1',
      },
    }, indicator),
  ])

  function activeDot(thisDir: 'asc' | 'desc') {
    return dir === thisDir
      ? h('span', { style: { color: 'var(--hue-blue)', fontSize: '12px' } }, '●')
      : null
  }

  const items = [
    h('div', {
      key: 'lbl',
      style: { padding: '2px 8px 6px', font: 'var(--type-label)', color: 'var(--text-muted)' },
    }, '排序方式'),
    h(PopoverItem, { key: 'asc', onClick: () => onSort(col.key, 'asc') }, {
      icon: () => ico(ICO_UP),
      default: () => h('span', {
        style: { flex: '1', display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
      }, [h('span', null, '升序'), activeDot('asc')]),
    }),
    h(PopoverItem, { key: 'desc', onClick: () => onSort(col.key, 'desc') }, {
      icon: () => ico(ICO_DOWN),
      default: () => h('span', {
        style: { flex: '1', display: 'inline-flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' },
      }, [h('span', null, '降序'), activeDot('desc')]),
    }),
    active ? h('div', { key: 'sep', style: { height: '1px', background: 'var(--divider)', margin: '4px 6px' } }) : null,
    active ? h(PopoverItem, { key: 'clear', danger: true, onClick: () => onSort(col.key, null) }, {
      icon: () => ico(ICO_X),
      default: () => '取消排序',
    }) : null,
  ].filter(Boolean)

  return h(Popover, { align: align === 'right' ? 'end' : 'start', width: 184 }, {
    trigger: () => trigger,
    default: () => items,
  })
}
</script>

<template>
  <!-- Mirrors DataTable layout exactly; headers replaced with Popover sort triggers -->
  <div style="width:100%;overflow-x:auto">
    <table :style="{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-sans)', tableLayout: fixedLayout ? 'fixed' : undefined }">
      <thead>
        <tr style="border-bottom:1px solid var(--divider)">
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
            }"
          >
            <component :is="() => renderSortHeader(c)" />
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in sortedRows"
          :key="(r as any)[rowKey]"
          :style="{
            height: 'var(--mx-row-h, 56px)',
            borderBottom: '1px solid var(--divider)',
            transition: 'background var(--dur-fast) var(--ease-standard)',
            cursor: 'pointer',
          }"
          @click="$emit('rowClick', r)"
          @mouseenter="rowHover && (($event.currentTarget as HTMLElement).style.background = 'var(--bg-panel)')"
          @mouseleave="rowHover && (($event.currentTarget as HTMLElement).style.background = 'transparent')"
        >
          <td
            v-for="c in columns"
            :key="c.key"
            :title="c.render ? undefined : String((r as any)[c.key] ?? '')"
            :style="{
              /* 等高铁律(LIST-PAGE-SPEC §4):垂直留白由 tr 定高提供(--mx-row-h),td 不吃上下 padding */
              padding: '0 16px',
              verticalAlign: 'middle',
              textAlign: c.align || 'left',
              font: 'var(--type-body)',
              color: 'var(--text-primary)',
              whiteSpace: c.wrap ? 'normal' : 'nowrap',
              fontVariantNumeric: c.mono ? 'tabular-nums' : 'normal',
              fontFamily: c.mono ? 'var(--font-mono)' : 'var(--font-sans)',
            }"
          >
            <Cell :node="c.render ? c.render(r) : (r as any)[c.key]" />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
