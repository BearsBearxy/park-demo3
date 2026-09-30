<script setup lang="ts">
// 问题面板(十件 ③,LAYOUT-STABILITY-SPEC §6,画布 06-B ③ / 06-C 方案 A,UI-OVERLAY §7.1):
// 「待重算 / 成员变动 / 生成告警」这类状态型告警不做流内提示条,收进工具条上的入口胶囊。
// 本组件 = 入口胶囊(FPAlertChip)+ 以它为触发的 ds/Popover:贴着胶囊弹出,420 宽,页面不变暗;
// 点外面、Esc 关(Popover 管)。打开态由屏持有(v-model:open)。
// 每组:组头(类名 + 件数 + 处理按钮,点组头收起 / 展开)、一句「这是什么、不处理会怎样」、可点的明细。
// 只报不给动作的告警不许进来(§6-3)。问题多了面板里滚动,不把面板撑出屏。
// 默认插槽:台账 / 附表10 的未绑定清单原样放进来。
import { ref, watch, onDeactivated, type ComponentPublicInstance } from 'vue'
import Popover from '@/components/ds/Popover.vue'
import Button from '@/components/ds/Button.vue'
import FPAlertChip from '@/components/fp/FPAlertChip.vue'
import { iconFor } from '@/components/ds/icon'

export interface AlertItem {
  /** 一行明细文本 */
  text: string
  /** 次要说明(灰字,可选) */
  hint?: string
  /** 点这一行跳到问题所在处(跳行并闪一下由屏做) */
  onClick?: () => void
}

export interface AlertGroup {
  key: string
  /** 组标题,如「待重算」 */
  title: string
  /** 人话:这是什么、不处理会怎样 */
  desc: string
  tone?: 'warn' | 'info'
  items: AlertItem[]
  /** 组级动作(如「重算本月」「一键重算 3 个月」),放在组头;§6-3:必须给得出清除路径。
   *  busyLabel:执行中的文案,可带进度(如「重算中 2/3」);缺省显「处理中…」 */
  action?: { label: string; icon?: string; busy?: boolean; busyLabel?: string; run: () => void }
}

const props = withDefaults(defineProps<{
  open: boolean
  groups: AlertGroup[]
  /** 胶囊上的数(口径见 FPAlertChip:Σ items,无 items 的组按 1) */
  count: number
  label?: string
  quietLabel?: string
  /** 胶囊在工具条右侧时传 end:面板右边对齐胶囊,往左展开。只是首选 —— 放不下会换边,见 place() */
  align?: 'start' | 'end'
}>(), { label: '待处理', quietLabel: '无待处理', align: 'start' })
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>()

// 展开态:默认只展开第一组(画布 06-C),点组头翻转。收起用 v-show —— 内容还在 DOM 里,只是不占地方。
const flipped = ref<Record<string, boolean>>({})
const expanded = (key: string, i: number) => flipped.value[key] ?? i === 0
function toggle(key: string, i: number) { flipped.value = { ...flipped.value, [key]: !expanded(key, i) } }

// 面板左右位置打开时量一次(对抗复查 regress-1):工具条一折行,胶囊可能落到第二行最左边,
// 写死往左展开就大半截出屏(负方向溢出滚不回来),桌面编辑态还会被 .fp-main-card 的 overflow:hidden 裁掉。
// 先按 align 摆,那边放不下换另一边,两边都放不下就夹在屏内左右各 16。手机上面板宽 = 屏宽 - 32,即左右各留 16 的满宽。
// ponytail: 只在打开那一刻量,开着时转屏 / 改窗口宽不重摆;要跟着动再加 resize 监听。
const EDGE = 16
const chip = ref<ComponentPublicInstance | null>(null)
const left = ref(0)   // 相对胶囊左边的偏移(Popover 的根就是胶囊那么大)
function place() {
  const el = chip.value?.$el as HTMLElement | undefined
  if (!el) return
  const r = el.getBoundingClientRect()
  const vw = window.innerWidth
  const w = Math.min(420, vw - 2 * EDGE)
  const start = r.left
  const end = r.right - w
  const x = props.align === 'end' ? (end >= EDGE ? end : start) : (start + w <= vw - EDGE ? start : end)
  left.value = Math.max(EDGE, Math.min(x, vw - EDGE - w)) - r.left
}
watch(() => props.open, (v) => { if (v) place() })

// 屏被 KeepAlive 停用(切页签)时收起:切回来不该还开着,Popover 挂在 document 上的点外 / Esc 监听也一并摘掉
onDeactivated(() => { if (props.open) emit('update:open', false) })
</script>

<template>
  <Popover :open="props.open" :width="420"
           :style="{ padding: '6px 0', left: `${left}px`, right: 'auto', maxWidth: 'calc(100vw - 32px)', maxHeight: '70vh', overflowY: 'auto' }"
           @open-change="emit('update:open', $event)">
    <template #trigger>
      <FPAlertChip ref="chip" :count="props.count" :label="props.label" :quiet-label="props.quietLabel"
                   :aria-expanded="props.open" aria-haspopup="dialog" />
    </template>
    <div class="fap">
      <div v-if="!props.groups.length && !$slots.default" class="fap-empty">
        <component :is="iconFor('check-circle-2')" :size="22" />
        <p>本月没有待处理事项</p>
      </div>
      <section v-for="(g, gi) in props.groups" :key="g.key" class="fap-g" :class="g.tone ?? 'warn'">
        <div class="fap-gh">
          <button class="fap-tg" type="button" :aria-expanded="expanded(g.key, gi)" @click="toggle(g.key, gi)">
            <component :is="iconFor(expanded(g.key, gi) ? 'chevron-down' : 'chevron-right')" :size="13" class="cv" />
            <span class="t">{{ g.title }}</span>
            <span v-if="g.items.length" class="n">{{ g.items.length }}</span>
          </button>
          <Button v-if="g.action" variant="filled" size="sm" :disabled="g.action.busy" @click="g.action.run">
            <template v-if="g.action.icon" #leading>
              <component :is="iconFor(g.action.icon)" :size="14" />
            </template>
            {{ g.action.busy ? (g.action.busyLabel ?? '处理中…') : g.action.label }}
          </Button>
        </div>
        <div v-show="expanded(g.key, gi)" class="fap-body">
          <p class="fap-desc">{{ g.desc }}</p>
          <div v-if="g.items.length" class="fap-items">
            <button v-for="(it, i) in g.items" :key="i" class="fap-item" :class="{ click: !!it.onClick }"
                    type="button" :disabled="!it.onClick" @click="it.onClick && it.onClick()">
              <span class="tx">{{ it.text }}</span>
              <span v-if="it.hint" class="hn">{{ it.hint }}</span>
              <component v-if="it.onClick" :is="iconFor('chevron-right')" :size="13" class="ch" />
            </button>
          </div>
        </div>
      </section>
      <slot />
    </div>
  </Popover>
</template>

<style scoped>
.fap-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 32px 0; color: var(--text-disabled);
}
.fap-empty p { margin: 0; font-size: var(--fs-label); }

.fap-g { padding: 8px 12px 10px; }
.fap-g + .fap-g { border-top: 1px solid var(--border-subtle); }

.fap-gh { display: flex; align-items: center; gap: 8px; min-height: 28px; }
.fap-tg {
  flex: 1; min-width: 0;
  display: inline-flex; align-items: center; gap: 6px;
  padding: 0; border: none; background: transparent; cursor: pointer;
  font-family: var(--font-sans); text-align: left;
}
.fap-tg .cv { flex: none; color: var(--text-disabled); }
.fap-tg .t { font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); }
.fap-tg .n {
  font-family: var(--font-mono); font-size: var(--fs-micro); font-weight: var(--fw-semibold);
  color: var(--status-warning); background: var(--warn-soft);
  border-radius: var(--radius-full); padding: 1px 7px;
}
.fap-g.info .fap-tg .n { color: var(--hue-blue); background: var(--accent-blue); }

.fap-body { padding-left: 19px; }
.fap-desc {
  margin: 4px 0 0; font-size: var(--fs-label); line-height: 1.55; color: var(--text-muted);
}

.fap-items { margin: 6px 0 0 -8px; display: flex; flex-direction: column; gap: 1px; }
.fap-item {
  display: flex; flex-wrap: wrap; align-items: center; column-gap: 8px;
  box-sizing: border-box; min-height: 36px;   /* 06-C 实测:明细 14px、行高 36 */
  padding: 8px; border: none; border-radius: var(--radius-sm);
  background: transparent; text-align: left; font-family: var(--font-sans);
  font-size: var(--fs-body); line-height: 20px; color: var(--text-primary);
}
.fap-item.click { cursor: pointer; }
.fap-item.click:hover { background: var(--surface-sunken); }
.fap-item:disabled { color: var(--text-secondary); }
/* 不截断:hint 长(如租户名列表)时自己折到下一行 */
.fap-item .tx { flex: 1 1 auto; }
.fap-item .hn { margin-left: auto; font-size: var(--fs-label); color: var(--text-muted); line-height: 1.5; }
.fap-item .ch { flex: none; color: var(--text-disabled); }
</style>
