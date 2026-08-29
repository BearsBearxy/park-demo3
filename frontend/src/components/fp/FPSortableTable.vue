<script setup lang="ts">
// ponytail: 自建 <table>，表头用 Popover 排序触发器（需 VNode 表头，故不走纯文本插值的通用表格）
import { computed, h, defineComponent, type VNode } from 'vue'
import Popover from '@/components/ds/Popover.vue'
import PopoverItem from '@/components/ds/PopoverItem.vue'
import { fpSortRows } from './fpSort'
import type { SortState, SortValue } from './fpSort'
import { useViewport } from '@/composables/useViewport'

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
  // master-detail 选中高亮:命中行(rowKey===selectedKey)加背景色;null=无选中(向后兼容)。
  selectedKey?: string | number | null
  /**
   * 数据未到时先画几行骨架(加载态设计稿 §07「精确占位」)。0 = 不画。
   *
   * ⚠ 行数由调用方给 —— 那几屏用 useFitRows 算得出「本卡片放得下几行」,
   *   骨架照那个数画,真数据落进来时**几何完全一致**。
   *   这里若自作主张定一个数,零位移就断了。
   * 骨架行与数据行**共用同一套 tr/td 样式**(--mx-row-h 定高、同一 borderBottom、同一 padding),
   *   不是另画一张表 —— 两份版式迟早会漂。
   */
  skeletonRows?: number
}>(), {
  rowKey: 'id',
  sort: null,
  rowHover: true,
  fixedLayout: false,
  selectedKey: null,
  skeletonRows: 0,
})

const isSel = (r: any) => props.selectedKey != null && r[props.rowKey] === props.selectedKey

// S 档(≤600)行转卡片(RESPONSIVE-LAYOUT-SPEC §5.1):不渲染 <table>,改渲染 72px 定高卡列。
// useViewport 自带 jsdom/SSR guard(无 matchMedia → tier 恒 'xl'),既有测试走表格分支不变。
const { tier } = useViewport()

// S 档兜底卡取列内容:与 td 同一取值路径(render 优先,否则按 key 取),列不够时给 null
function cellNode(r: any, i: number) {
  const c = props.columns[i]
  return c ? (c.render ? c.render(r) : r[c.key]) : null
}

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
  <!-- Mirrors DataTable layout exactly; headers replaced with Popover sort triggers.
       宽档分支写在前(与 CSS「宽档在前窄档在后」同序);S 档见下方 v-else 卡片分支 -->
  <div v-if="tier !== 's'" style="width:100%;overflow-x:auto">
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
        <!-- 骨架行:与下面的数据行共用 tr 定高与 td padding,换的只是格子里的内容 -->
        <tr
          v-for="i in (skeletonRows || 0)"
          :key="'sk-' + i"
          :style="{ height: 'var(--mx-row-h, 56px)', borderBottom: '1px solid var(--divider)' }"
        >
          <td v-for="(c, ci) in columns" :key="c.key"
              :style="{ padding: '0 16px', verticalAlign: 'middle', textAlign: c.align || 'left' }">
            <span class="fp-shim" aria-hidden="true"
                  :style="{ display: 'inline-block', height: '11px', borderRadius: '3px',
                            width: [62, 44, 54, 38, 48, 58][(ci + i) % 6] + '%' }"></span>
          </td>
        </tr>
        <tr
          v-for="r in sortedRows"
          :key="(r as any)[rowKey]"
          :class="{ 'is-selected': isSel(r) }"
          :style="{
            height: 'var(--mx-row-h, 56px)',
            borderBottom: '1px solid var(--divider)',
            transition: 'background var(--dur-fast) var(--ease-standard)',
            cursor: 'pointer',
            background: isSel(r) ? 'rgba(24,134,254,0.10)' : 'transparent',
          }"
          @click="$emit('rowClick', r)"
          @mouseenter="rowHover && (($event.currentTarget as HTMLElement).style.background = 'var(--bg-panel)')"
          @mouseleave="rowHover && (($event.currentTarget as HTMLElement).style.background = isSel(r) ? 'rgba(24,134,254,0.10)' : 'transparent')"
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
              /* 超长内容截断而不是把列撑宽(LIST-PAGE-SPEC §4):table-layout 保持 auto,
                 列宽被 width:100% 压缩时才生效;全文靠上面的 :title 悬浮看 */
              overflow: c.wrap ? undefined : 'hidden',
              textOverflow: c.wrap ? undefined : 'ellipsis',
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

  <!-- S 档(≤600)卡片分支(RESPONSIVE-LAYOUT-SPEC §5.1):每行一张 72px 定高卡,
       几何统一在 mx-list.css 的 .mx-rowcard(不逐屏手写)。排序照常作用于 sortedRows;
       行点击与选中态语义与表格分支一致(同 emit、同 is-selected 判定)。 -->
  <div v-else>
    <!-- 骨架卡:与真卡同 .mx-rowcard 定高同结构,只是格子换成微光条——
         与表格骨架互斥按档出,exactPlaceholder「精确占位」口径在 S 档同样成立 -->
    <div v-for="i in (skeletonRows || 0)" :key="'skc-' + i" class="mx-rowcard" aria-hidden="true">
      <span class="fp-shim"
            :style="{ display: 'inline-block', height: '13px', borderRadius: '3px',
                      width: [46, 58, 40, 52][i % 4] + '%' }"></span>
      <span class="fp-shim"
            :style="{ display: 'inline-block', height: '11px', borderRadius: '3px',
                      width: [68, 60, 74, 56][i % 4] + '%' }"></span>
    </div>
    <div
      v-for="r in sortedRows"
      :key="(r as any)[rowKey]"
      class="mx-rowcard"
      :class="{ 'is-selected': isSel(r) }"
      @click="$emit('rowClick', r)"
    >
      <!-- 调用方给 #card 时按屏映射;不给时兜底:第一列 = 主字段,第二三列 = 次级行 -->
      <slot name="card" :row="r">
        <div class="mx-rowcard-main"><Cell :node="cellNode(r, 0)" /></div>
        <div class="mx-rowcard-sub">
          <span v-if="columns[1]"><Cell :node="cellNode(r, 1)" /></span>
          <span v-if="columns[2]"><Cell :node="cellNode(r, 2)" /></span>
        </div>
      </slot>
    </div>
  </div>
</template>
