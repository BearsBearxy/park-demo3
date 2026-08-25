<script setup lang="ts">
// 屏级告警面板(LAYOUT-STABILITY-SPEC §6,2026-08-25 用户拍板):
// 「快照过期/待重算/成员变动/生成告警」这类状态型告警统一收进右侧抽屉,不再做流内提示条
// (顶动表格 + 清不掉 = 永久噪音)。入口是常驻 chip(FPAlertChip),这里只画抽屉内容。
// 每组必须给「这是什么、不处理会怎样」+ 可执行动作;只报不给动作的告警不许进来(§6-3)。
import FPSideDrawer from '@/components/fp/FPSideDrawer.vue'
import Button from '@/components/ds/Button.vue'
import { iconFor } from '@/components/ds/icon'

export interface AlertItem {
  /** 一行明细文本 */
  text: string
  /** 次要说明(灰字,可选) */
  hint?: string
  /** 点这一行跳到问题所在处 */
  onClick?: () => void
}

export interface AlertGroup {
  key: string
  /** 组标题,如「快照过期」 */
  title: string
  /** 人话:这是什么、不处理会怎样 */
  desc: string
  tone?: 'warn' | 'info'
  items: AlertItem[]
  /** 组级动作(如「重算本月」「一键重算 3 个月」);§6-3:必须给得出清除路径。
   *  busyLabel:执行中的文案,可带进度(如「重算中 2/3」);缺省显「处理中…」 */
  action?: { label: string; icon?: string; busy?: boolean; busyLabel?: string; run: () => void }
}

const props = defineProps<{
  open: boolean
  title?: string
  groups: AlertGroup[]
}>()
defineEmits<{ (e: 'close'): void }>()
</script>

<template>
  <FPSideDrawer :open="props.open" :title="props.title ?? '待处理事项'" @close="$emit('close')">
    <div v-if="!props.groups.length" class="fap-empty">
      <component :is="iconFor('check-circle-2')" :size="22" />
      <p>本月没有待处理事项</p>
    </div>
    <div v-for="g in props.groups" :key="g.key" class="fap-g" :class="g.tone ?? 'warn'">
      <div class="fap-gh">
        <component :is="iconFor(g.tone === 'info' ? 'info' : 'alert-triangle')" :size="15" />
        <span class="t">{{ g.title }}</span>
        <span class="n">{{ g.items.length }}</span>
      </div>
      <p class="fap-desc">{{ g.desc }}</p>
      <div v-if="g.items.length" class="fap-items">
        <button v-for="(it, i) in g.items" :key="i" class="fap-item" :class="{ click: !!it.onClick }"
                type="button" :disabled="!it.onClick" @click="it.onClick && it.onClick()">
          <span class="tx">{{ it.text }}</span>
          <span v-if="it.hint" class="hn">{{ it.hint }}</span>
          <component v-if="it.onClick" :is="iconFor('chevron-right')" :size="13" class="ch" />
        </button>
      </div>
      <div v-if="g.action" class="fap-act">
        <Button variant="outline" size="sm" :disabled="g.action.busy" @click="g.action.run">
          <template v-if="g.action.icon" #leading>
            <component :is="iconFor(g.action.icon)" :size="14" />
          </template>
          {{ g.action.busy ? (g.action.busyLabel ?? '处理中…') : g.action.label }}
        </Button>
      </div>
    </div>
  </FPSideDrawer>
</template>

<style scoped>
.fap-empty {
  display: flex; flex-direction: column; align-items: center; gap: 8px;
  padding: 48px 0; color: var(--text-disabled);
}
.fap-empty p { margin: 0; font-size: var(--fs-label); }

.fap-g {
  padding: 14px 16px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background: var(--surface-white);
}
.fap-g + .fap-g { margin-top: var(--space-3); }

.fap-gh { display: flex; align-items: center; gap: 7px; }
.fap-gh > :first-child { flex: none; color: var(--status-warning); }
.fap-g.info .fap-gh > :first-child { color: var(--hue-blue); }
.fap-gh .t { font-size: var(--fs-body); font-weight: var(--fw-semibold); color: var(--text-primary); }
.fap-gh .n {
  font-family: var(--font-mono); font-size: var(--fs-micro); font-weight: var(--fw-semibold);
  color: var(--status-warning); background: rgb(252, 243, 232);
  border-radius: var(--radius-full); padding: 1px 8px;
}
.fap-g.info .fap-gh .n { color: var(--hue-blue); background: var(--accent-blue); }

.fap-desc {
  margin: 6px 0 0; font-size: var(--fs-label); line-height: 1.55; color: var(--text-muted);
}

.fap-items { margin-top: 10px; display: flex; flex-direction: column; gap: 1px; }
.fap-item {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 9px; border: none; border-radius: var(--radius-sm);
  background: transparent; text-align: left; font-family: var(--font-sans);
  font-size: var(--fs-label); color: var(--text-secondary);
}
.fap-item.click { cursor: pointer; }
.fap-item.click:hover { background: var(--surface-sunken); color: var(--text-primary); }
.fap-item .tx { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* hint 长(如租户名列表)时折到第二行,不把 text 挤成省略号 */
.fap-item { flex-wrap: wrap; }
.fap-item .hn {
  flex: 1 0 100%; font-size: var(--fs-micro); color: var(--text-disabled);
  padding-left: 1px; line-height: 1.5;
}
.fap-item .ch { flex: none; color: var(--text-disabled); }

.fap-act { margin-top: 12px; display: flex; justify-content: flex-end; }
</style>
