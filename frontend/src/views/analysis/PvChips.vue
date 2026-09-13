<script setup lang="ts">
// B1 楼栋芯片条(PV-ANALYSIS-SCREEN-V4 §3.2;计划 §1 #5 #7)。样式照画布 v2/Main.dc.html 的 .chip 与 renderVals 抄。
// 常显 = 有连续出范围段 ∪ 读不出 ∪ 选中,其余收进末尾「其余 N 栋 ▾」浮层 —— 行高恒 34,卡高不随栋数变。
// 分组与排序由 pvAnaV4.logic.ts 的 chipGroups 定,这里只管长相;
// 唯一的几何决定:常显一行放不下时,从末尾起把常显栋挪进浮层(选中那枚不挪),芯片条不许冲出卡片。
// 浮层直接用 ds/Popover(UI-OVERLAY-SPEC §4:capture 点外关、Esc 只关自己、z-index 走 --z-popover)。
import { computed, ref } from 'vue'
import Popover from '@/components/ds/Popover.vue'
import { useWidth } from '@/components/ana/useWidth'
import { tipWidth } from '@/components/ana/chartTip'
import { PHASE_COLORS, PV_COLORS as C } from './pvAnaColors'
import type { ChipItem, PvChipsProps } from './pvAnaV4.logic'

const props = defineProps<PvChipsProps>()
const emit = defineEmits<{ pick: [id: number] }>()
const open = ref(false)
/** 1366 视口下主卡卡内宽 951(V4 §2);jsdom 量不到宽时就用它 */
const { el, width } = useWidth(951)
const GAP = 6, POP_W = 280

/** 方向色的淡底由 pvAnaColors 常量现算,不另写颜色字面值 */
const tint = (hex: string, a: number) =>
  `rgba(${[1, 3, 5].map(k => parseInt(hex.slice(k, k + 2), 16)).join(',')},${a})`

function look(c: ChipItem) {
  const below = c.dir === -1
  const base = c.kind === 'hit'
    ? {
        bg: tint(below ? C.BELOW : C.ABOVE, 0.1), fg: below ? 'var(--hue-red)' : C.AMBER_TEXT, bc: 'transparent',
        badgeBg: tint(below ? C.BELOW : C.ABOVE, below ? 0.16 : 0.2),
      }
    : c.kind === 'unborn'
      ? { bg: 'transparent', fg: 'var(--text-disabled)', bc: 'var(--border-subtle)', badgeBg: '' }
      : c.kind === 'unreadable'
        ? { bg: 'var(--surface-white)', fg: 'var(--text-muted)', bc: 'var(--border-strong)', badgeBg: 'var(--ink-050)' }
        : { bg: 'var(--surface-white)', fg: 'var(--text-secondary)', bc: 'var(--border-subtle)', badgeBg: 'var(--ink-050)' }
  const badgeFg = c.kind === 'hit' ? base.fg : 'var(--text-muted)'
  const s = c.selected
    ? { ...base, bg: 'var(--control-solid)', fg: 'var(--control-solid-text)', bc: 'var(--control-solid)', badgeBg: 'color-mix(in srgb, var(--control-solid-text) 18%, transparent)' }
    : base
  return {
    c,
    style: {
      background: s.bg, color: s.fg, borderColor: s.bc,
      borderStyle: c.kind === 'unreadable' ? 'dashed' : 'solid',
      fontWeight: c.selected ? 600 : c.kind === 'unborn' ? 400 : 500,
    },
    dot: c.kind === 'unborn' ? 'var(--text-disabled)' : PHASE_COLORS[c.phase] ?? 'var(--text-muted)',
    badge: badgeOf(c),
    badgeStyle: { background: s.badgeBg, color: c.selected ? 'var(--control-solid-text)' : badgeFg },
  }
}

function badgeOf(c: ChipItem): string {
  return c.kind === 'unreadable' ? '读不出' : c.kind !== 'unborn' && c.outDays > 0 ? `${c.outDays} ${props.groups.unit}` : ''
}

// 按字估宽(chartTip 的 CJK 12 / 其余 6.6,11px 字下宁宽勿窄):
// 芯片 = 边 2 + 内边距 17 + 点 6 + 间距 5 + 名字 [+ 间距 5 + 徽标内边距 10 + 徽标字]
const chipW = (c: ChipItem) => 30 + tipWidth([c.name], 0) + (badgeOf(c) ? 15 + tipWidth([badgeOf(c)], 0) : 0)
const moreW = (n: number) => 19 + tipWidth([`其余 ${n} 栋 ▾`], 0)
const rowW = (xs: ChipItem[]) => xs.reduce((t, c) => t + chipW(c) + GAP, 0)

const fit = computed(() => {
  const { shown: all, folded: rest } = props.groups
  const need = (xs: ChipItem[]) => {
    const n = all.length - xs.length + rest.length
    return rowW(xs) + (n ? moreW(n) : -GAP)
  }
  if (need(all) <= width.value) return { shown: all, spill: [] as ChipItem[] }
  const keep = all.filter(c => c.selected)
  for (const c of all) {
    if (c.selected) continue
    if (need([...keep, c]) > width.value) break
    keep.push(c)
  }
  return { shown: all.filter(c => keep.includes(c)), spill: all.filter(c => !keep.includes(c)) }
})

const shown = computed(() => fit.value.shown.map(look))
const folded = computed(() => [...fit.value.spill, ...props.groups.folded].map(look))
/** 浮层往右展开;触发钮离右缘不足 280 时改成右对齐往左展开 —— 两边都不越出芯片条 */
const popAlign = computed<'start' | 'end'>(() => (rowW(fit.value.shown) + POP_W <= width.value ? 'start' : 'end'))

function pickFolded(id: number) {
  emit('pick', id)
  open.value = false
}
</script>

<template>
  <div ref="el" class="pvc">
    <button v-for="x in shown" :key="x.c.id" type="button" class="chip" :style="x.style"
      :disabled="!x.c.clickable" :aria-pressed="x.c.selected" @click="emit('pick', x.c.id)">
      <span class="dot" :style="{ background: x.dot }"></span>
      <span>{{ x.c.name }}</span>
      <span v-if="x.badge" class="bd" :style="x.badgeStyle">{{ x.badge }}</span>
    </button>

    <Popover v-if="folded.length" v-model="open" :align="popAlign" :width="POP_W">
      <template #trigger>
        <button type="button" class="chip more" :aria-expanded="open">其余 {{ folded.length }} 栋 ▾</button>
      </template>
      <div class="pvc-pop">
        <button v-for="x in folded" :key="x.c.id" type="button" class="chip" :style="x.style"
          :disabled="!x.c.clickable" @click="pickFolded(x.c.id)">
          <span class="dot" :style="{ background: x.dot }"></span>
          <span>{{ x.c.name }}</span>
          <span v-if="x.badge" class="bd" :style="x.badgeStyle">{{ x.badge }}</span>
        </button>
      </div>
    </Popover>
  </div>
</template>

<style scoped>
.pvc { display: flex; align-items: center; gap: 6px; height: 34px; padding: 4px 0; box-sizing: border-box; white-space: nowrap; }
.chip {
  display: inline-flex; align-items: center; gap: 5px; height: 26px; padding: 0 9px 0 8px; margin: 0;
  border-radius: 999px; border-width: 1px; font: inherit; font-size: 11px; line-height: 1; white-space: nowrap;
  cursor: pointer; user-select: none;
  transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard);
}
.chip:disabled { cursor: default; }
.chip.more { background: var(--surface-white); color: var(--text-secondary); border: 1px solid var(--border-subtle); font-weight: 500; }
.dot { width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; }
.bd { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 11px; line-height: 16px; height: 16px; padding: 0 5px; border-radius: 999px; }
.pvc-pop { display: flex; flex-wrap: wrap; gap: 6px; }
</style>
