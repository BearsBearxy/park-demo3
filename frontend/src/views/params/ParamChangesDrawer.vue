<script setup lang="ts">
// 「变更记录」全页日志(S21-PARAM-CENTER-SPEC §5.4):影响 ym 的参数改动 + 该月重算,时间倒序;可按参数/范围文字筛。
import { computed, ref, watch } from 'vue'
import { paramsApi, type ParamChangeDTO } from '@/api/params'
import Badge from '@/components/ds/Badge.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'

const props = defineProps<{ open: boolean; ym: string }>()
const emit = defineEmits<{ close: [] }>()

const list = ref<ParamChangeDTO[] | null>(null)
const err = ref('')
const q = ref('')
let seq = 0
watch(() => [props.open, props.ym] as const, async ([o, ym]) => {
  if (!o) return
  const my = ++seq
  list.value = null; err.value = ''; q.value = ''
  try {
    const d = await paramsApi.changes(ym)
    if (my === seq) list.value = d
  } catch (e) {
    if (my === seq) err.value = (e as { message?: string })?.message ?? '变更记录加载失败'
  }
})

const ACTION: Record<string, { text: string; tone: 'blue' | 'red' | 'cyan' | 'neutral' }> = {
  set: { text: '设置', tone: 'blue' }, delete: { text: '删除', tone: 'red' },
  recalc: { text: '重算', tone: 'cyan' }, migrate: { text: '迁移基线', tone: 'neutral' },
}
const shown = computed(() => {
  const kw = q.value.trim()
  const all = list.value ?? []
  return kw ? all.filter(c => `${c.label ?? ''} ${c.scopeLabel ?? ''} ${c.note ?? ''}`.includes(kw)) : all
})
const fmtTs = (iso: string) => iso.slice(0, 16).replace('T', ' ')
const fmtV = (v: number | null) => (v == null ? '—' : String(v))
const effText = (c: ParamChangeDTO) => c.action === 'recalc' ? (c.ym ?? '')
  : c.mode === 'month' ? `仅 ${c.acctMonth}` : c.acctMonth ? `${c.acctMonth} 起长期` : '长期'
</script>

<template>
  <FPDrawer :open="open" :title="`变更记录 · ${ym}`" subtitle="影响本月的参数改动与本月重算，时间倒序" icon="history" :width="1040" fixed-height @close="emit('close')">
    <div class="pc-tools">
      <input v-model="q" class="pc-q" type="text" placeholder="按参数 / 范围 / 备注筛选" />
      <span class="pc-cnt">{{ shown.length }} 条</span>
    </div>
    <div v-if="err" class="pc-err">{{ err }}</div>
    <div v-else-if="!list" class="pc-empty">加载中…</div>
    <div v-else-if="!shown.length" class="pc-empty">暂无变更记录。</div>
    <div v-else class="pc-wrap">
    <table class="pc-tab">
      <colgroup><col style="width:132px" /><col style="width:64px" /><col style="width:72px" /><col style="width:150px" /><col style="width:140px" /><col style="width:110px" /><col style="width:120px" /><col /></colgroup>
      <thead><tr><th>时间</th><th>人</th><th>动作</th><th class="wrap">参数</th><th class="wrap">作用范围</th><th>生效</th><th class="num">变更（旧 → 新）</th><th class="note">备注</th></tr></thead>
      <tbody>
        <tr v-for="c in shown" :key="c.ts + (c.key ?? '') + (c.scope ?? '') + c.action">
          <td class="mono">{{ fmtTs(c.ts) }}</td>
          <td>{{ c.actor }}</td>
          <td><Badge :tone="ACTION[c.action]?.tone ?? 'neutral'" :dot="false">{{ ACTION[c.action]?.text ?? c.action }}</Badge></td>
          <td class="wrap">{{ c.label ?? '' }}</td>
          <td class="wrap">{{ c.scopeLabel ?? '' }}</td>
          <td>{{ effText(c) }}</td>
          <td class="num mono">{{ c.action === 'recalc' ? '' : `${fmtV(c.oldValue)} → ${fmtV(c.newValue)}` }}</td>
          <td class="note wrap">{{ c.note ?? '' }}</td>
        </tr>
      </tbody>
    </table>
    </div>
  </FPDrawer>
</template>

<style scoped>
.pc-tools { display: flex; align-items: center; gap: 10px; }
.pc-q { flex: 1 1 auto; height: 32px; box-sizing: border-box; padding: 0 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); font-family: var(--font-sans); font-size: var(--fs-label); color: var(--text-primary); outline: none; }
.pc-q:focus { border-color: var(--hue-blue); }
.pc-cnt { font-size: var(--fs-label); color: var(--text-muted); }
.pc-err { color: var(--hue-red); font-size: var(--fs-label); }
.pc-empty { color: var(--text-muted); font-size: var(--fs-label); }
/* 表:auto 布局,列宽是下限;时间/人/动作/生效/变更 nowrap 不截;参数/作用范围/备注 换行;过宽横向滚动 */
.pc-wrap { overflow-x: auto; }
.pc-tab { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: auto; }
.pc-tab th { text-align: left; padding: 6px 8px; font-weight: var(--fw-regular); color: var(--text-muted); border-bottom: 1px solid var(--divider); white-space: nowrap; }
.pc-tab td { padding: 7px 8px; border-bottom: 1px solid var(--divider); white-space: nowrap; vertical-align: top; color: var(--text-primary); }
/* 换行列要给 min-width:auto 布局下会被 nowrap 列挤到一字一行 */
.pc-tab td.wrap { white-space: normal; line-height: 1.4; }
.pc-tab th.wrap, .pc-tab td.wrap { min-width: 120px; }
.pc-tab th.note, .pc-tab td.note { min-width: 200px; }
.pc-tab .num { text-align: right; }
.pc-tab .note { color: var(--text-muted); }
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
</style>
