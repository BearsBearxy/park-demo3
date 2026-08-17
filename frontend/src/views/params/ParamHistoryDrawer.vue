<script setup lang="ts">
// 单键单作用域「历史」抽屉(S21-PARAM-CENTER-SPEC §5.4):版本时间轴(from 连续段 / month 单点)+ 变更日志(时间/人/动作/旧→新/备注)。
// 打开即拉 GET /api/params/history;失败显错不阻断页面。
import { ref, watch } from 'vue'
import { paramsApi, type ParamChangeDTO, type ParamHistoryDTO, type ParamRowDTO } from '@/api/params'
import Badge from '@/components/ds/Badge.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'

const props = defineProps<{ open: boolean; row: ParamRowDTO | null }>()
const emit = defineEmits<{ close: [] }>()

const data = ref<ParamHistoryDTO | null>(null)
const err = ref('')
let seq = 0
watch(() => [props.open, props.row] as const, async ([o, r]) => {
  if (!o || !r) return
  const my = ++seq
  data.value = null; err.value = ''
  try {
    const d = await paramsApi.history(r.key, r.scope)
    if (my === seq) data.value = d
  } catch (e) {
    if (my === seq) err.value = (e as { message?: string })?.message ?? '历史加载失败'
  }
})

const ACTION_TEXT: Record<string, string> = { set: '设置', delete: '删除', recalc: '重算', migrate: '迁移基线' }
const fmtTs = (iso: string) => iso.slice(0, 16).replace('T', ' ')
// 值文案由后端给(枚举字典 / 布尔状态句 / 引用显名 / 千分位+单位,与列表行同一格式器);值空 = 此前无值 / 已删 → 「—」
// (老后端没有文案字段时退回原始数字,不显一排「—」)
const fmtV = (t: string | null | undefined, v: number | null) => t ?? (v == null ? '—' : String(v))
// 枚举文字(如「按损耗量核算（率 = …）」)一行放不下才换行;数字对(「0.16 元/度 → 0.15 元/度」)保持不换行
const longV = (c: ParamChangeDTO) => (c.oldText?.length ?? 0) + (c.newText?.length ?? 0) > 40
</script>

<template>
  <FPDrawer :open="open && !!row" :title="row ? `${row.scopeLabel} · ${row.label}` : ''" subtitle="版本时间轴与变更记录"
            icon="history" :width="640" @close="emit('close')">
    <div v-if="err" class="ph-err">{{ err }}</div>
    <div v-else-if="!data" class="ph-loading">加载中…</div>
    <template v-else>
      <section class="ph-sec">
        <h4 class="ph-h">版本（{{ data.versions.length }}）</h4>
        <div v-if="!data.versions.length" class="ph-empty">本作用域没有专属版本，取值来自上级作用域。</div>
        <div v-for="v in data.versions" :key="`${v.mode}|${v.acctMonth}`" class="ph-ver" :class="v.mode">
          <span class="ph-bar" />
          <Badge :tone="v.mode === 'month' ? 'orange' : 'blue'" :dot="false">{{ v.mode === 'month' ? '仅当月' : '长期' }}</Badge>
          <span class="ph-range">{{ v.rangeText }}</span>
          <span class="ph-val mono">{{ fmtV(v.valueText, v.value) }}</span>
          <span class="ph-note">{{ v.note ?? '' }}</span>
        </div>
      </section>
      <section class="ph-sec">
        <h4 class="ph-h">变更记录（{{ data.changes.length }}）</h4>
        <div v-if="!data.changes.length" class="ph-empty">暂无变更记录。</div>
        <table v-else class="ph-tab">
          <colgroup><col style="width:128px" /><col style="width:64px" /><col style="width:64px" /><col style="width:110px" /><col style="width:130px" /><col /></colgroup>
          <thead><tr><th>时间</th><th>人</th><th>动作</th><th>生效</th><th class="num">变更（旧 → 新）</th><th>备注</th></tr></thead>
          <tbody>
            <tr v-for="c in data.changes" :key="c.ts + c.action + (c.acctMonth ?? '')">
              <td class="mono">{{ fmtTs(c.ts) }}</td>
              <td>{{ c.actor }}</td>
              <td>{{ ACTION_TEXT[c.action] ?? c.action }}</td>
              <td>{{ c.mode === 'month' ? `仅 ${c.acctMonth}` : c.acctMonth ? `${c.acctMonth} 起长期` : '长期' }}</td>
              <td class="num mono" :class="{ wrap: longV(c) }">{{ fmtV(c.oldText, c.oldValue) }} → {{ fmtV(c.newText, c.newValue) }}</td>
              <td class="ph-note">{{ c.note ?? '' }}</td>
            </tr>
          </tbody>
        </table>
      </section>
    </template>
  </FPDrawer>
</template>

<style scoped>
.ph-err { color: var(--hue-red); font-size: var(--fs-label); }
.ph-loading, .ph-empty { color: var(--text-muted); font-size: var(--fs-label); }
.ph-sec { display: flex; flex-direction: column; gap: 8px; }
.ph-h { margin: 0; font-size: 13px; font-weight: var(--fw-semibold); color: var(--text-secondary); }
/* 时间轴行:左色条 from=连续蓝条 / month=橙色单点;备注换行不截 */
.ph-ver { display: flex; align-items: center; gap: 10px; min-height: 34px; padding: 4px 0; box-sizing: border-box; font-size: 12.5px; color: var(--text-primary); }
.ph-bar { width: 4px; align-self: stretch; border-radius: 2px; background: var(--hue-blue); flex: 0 0 auto; }
.ph-ver.month .ph-bar { align-self: center; height: 10px; width: 10px; border-radius: 50%; background: var(--hue-orange); margin: 0 -3px; }
.ph-range { flex: 0 0 160px; color: var(--text-secondary); }
/* 值:短值(数字 + 单位 / 状态句)一行;长枚举文字最多占行宽 55%,超出换行不截 */
.ph-val { flex: 0 0 auto; max-width: 55%; font-weight: var(--fw-semibold); white-space: normal; line-height: 1.4; }
.ph-note { flex: 1 1 auto; min-width: 0; color: var(--text-muted); white-space: normal; line-height: 1.4; overflow-wrap: anywhere; }
.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
/* 表:列宽是下限(auto 布局),时间/人/动作/生效/变更 nowrap 按内容撑开;备注换行;变更列遇长枚举文字(.wrap)换行 */
.ph-tab { width: 100%; border-collapse: collapse; font-size: 12px; table-layout: auto; }
.ph-tab th { text-align: left; padding: 6px 8px; font-weight: var(--fw-regular); color: var(--text-muted); border-bottom: 1px solid var(--divider); white-space: nowrap; }
.ph-tab td { padding: 6px 8px; border-bottom: 1px solid var(--divider); white-space: nowrap; vertical-align: top; }
.ph-tab td.ph-note { white-space: normal; line-height: 1.4; min-width: 140px; }
.ph-tab td.wrap { white-space: normal; line-height: 1.4; min-width: 220px; }
.ph-tab .num { text-align: right; }
</style>
