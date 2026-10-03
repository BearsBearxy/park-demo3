<script setup lang="ts">
// 某一项参数的「历史」(S21-PARAM-CENTER-SPEC §5.4,2026-10-03 画布 10-C 右半):居中卡(640 宽),原右侧抽屉形态撤掉 ——
// 文件名留着 Drawer 只为不动别处的引用。三段:① 本月前 6 后 5 共 12 个月的时间轴色段(每月用的是哪一版:
// 本月在用那一版实蓝、其余长期版本浅蓝、仅某月的版本橙、没有版本灰;版本换手处断开)② 版本列表(「本月在用」)③ 变更记录(时间 / 谁 / 动作 / 旧 → 新)。
// 打开即拉 GET /api/params/history;失败换成「没读到 + 重试」(FPLoadError)。点遮罩、Esc、× 关。
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { paramsApi, type ParamChangeDTO, type ParamHistoryDTO, type ParamRowDTO, type ParamVersionDTO } from '@/api/params'
import { iconFor } from '@/components/ds/icon'
import Badge from '@/components/ds/Badge.vue'
import FPEmpty from '@/components/fp/FPEmpty.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import { prevYm } from '@/utils/paramCenterLogic'
import { authorizerOf, whoOf } from './paramSections'

const props = defineProps<{ open: boolean; row: ParamRowDTO | null; ym?: string }>()
const emit = defineEmits<{ close: [] }>()

const data = ref<ParamHistoryDTO | null>(null)
const err = ref('')
let seq = 0
// 打开 / 重试共用。err 只在成功时清:重试在途时失败面不先消失(房内定型写法)
async function load() {
  const r = props.row
  if (!r) return
  const my = ++seq
  try {
    const d = await paramsApi.history(r.key, r.scope)
    if (my === seq) { data.value = d; err.value = '' }
  } catch (e) {
    if (my === seq) err.value = (e as { message?: string })?.message ?? '历史加载失败'
  }
}
// 换了一行是另一件事:旧行的结果与失败一起清掉
watch(() => [props.open, props.row] as const, ([o, r]) => {
  if (!o || !r) return
  data.value = null; err.value = ''
  load()
})
const shown = computed(() => props.open && !!props.row)
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') { e.stopPropagation(); emit('close') } }
watch(shown, v => (v ? window.addEventListener('keydown', onKey) : window.removeEventListener('keydown', onKey)), { immediate: true })
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const nextYm = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
}
const stand = computed(() => props.ym || props.row?.acctMonth || '')
// 站在某月用的是哪一版:该月的 month 行优先,否则起点 ≤ 该月的最晚 from 行(起点 '' = 最早那一版)
function useAt(vs: readonly ParamVersionDTO[], m: string): ParamVersionDTO | undefined {
  return vs.find(v => v.mode === 'month' && v.acctMonth === m)
    ?? vs.filter(v => v.mode === 'from' && v.acctMonth <= m).sort((a, b) => b.acctMonth.localeCompare(a.acctMonth))[0]
}
const inUse = computed(() => (data.value && stand.value ? useAt(data.value.versions, stand.value) : undefined))
const tone = (v: ParamVersionDTO | undefined) => (!v ? 'none' : v.mode === 'month' ? 'month' : v === inUse.value ? 'cur' : 'old')
// 12 格:本月前 6、后 5
const months = computed(() => {
  const s = stand.value
  if (!/^\d{4}-\d{2}$/.test(s)) return []
  let m = s
  for (let i = 0; i < 6; i++) m = prevYm(m)
  const out: string[] = []
  for (let i = 0; i < 12; i++) { out.push(m); m = nextYm(m) }
  return out
})
const cells = computed(() => {
  const vs = data.value?.versions ?? []
  const used = months.value.map(m => useAt(vs, m))
  return months.value.map((m, i) => ({
    m, label: m.slice(2), tone: tone(used[i]),
    st: i === 0 || used[i - 1] !== used[i], en: i === used.length - 1 || used[i + 1] !== used[i],
  }))
})
// 版本:新的在上
const versions = computed(() => [...(data.value?.versions ?? [])].sort((a, b) => b.acctMonth.localeCompare(a.acctMonth) || a.mode.localeCompare(b.mode)))

const ACTION_TEXT: Record<string, string> = { set: '设置', delete: '删除', recalc: '重算', migrate: '迁移' }
const fmtTs = (iso: string) => iso.slice(0, 16).replace('T', ' ')
// 值文案由后端给(与列表行同一格式器);值空 = 此前无值 / 已删 → 「–」(老后端没有文案字段时退回原始数字)
const fmtV = (t: string | null | undefined, v: number | null) => t ?? (v == null ? '–' : String(v))
const act = (c: ParamChangeDTO) => `${ACTION_TEXT[c.action] ?? c.action} · ${c.mode === 'month' ? `仅 ${c.acctMonth}` : c.acctMonth ? `${c.acctMonth} 起` : '长期'}`
const sub = computed(() => `${(props.row?.scopeLabel ?? '').replace(/（(池|户|表)）$/, '')} · 版本时间轴与变更记录`)
</script>

<template>
  <Teleport to="body">
    <div v-if="shown && row" class="ph-scrim" @mousedown.self="emit('close')">
      <div class="ph" role="dialog" aria-modal="true" :aria-label="`${row.label} 的历史`">
        <div class="ph-h">
          <div class="ph-ht"><h3>{{ row.label }}</h3><p>{{ sub }}</p></div>
          <button type="button" class="ph-x" aria-label="关闭" @click="emit('close')"><component :is="iconFor('x')" :size="18" /></button>
        </div>
        <div class="ph-b">
          <FPLoadError v-if="err" :sub="err" @retry="load">这项参数的历史没读到</FPLoadError>
          <div v-else-if="!data" class="ph-loading">加载中…</div>
          <template v-else>
            <div v-if="cells.length" class="ph-tl">
              <div v-for="c in cells" :key="c.m">
                <span class="bar" :class="[c.tone, { st: c.st, en: c.en }]" />
                <span class="m" :class="{ cur: c.m === stand }">{{ c.label }}</span>
              </div>
            </div>
            <section>
              <h4 class="ph-vh">版本（{{ data.versions.length }}）</h4>
              <FPEmpty v-if="!data.versions.length" size="sm" sub="取值来自上级作用域。">本作用域没有专属版本</FPEmpty>
              <div v-else class="ph-vl">
                <div v-for="v in versions" :key="`${v.mode}|${v.acctMonth}`" class="ph-vr" v-tip="v.note">
                  <span class="sw" :class="tone(v)" />
                  <span class="num">{{ fmtV(v.valueText, v.value) }}</span>
                  <span class="s">{{ v.rangeText }}</span>
                  <Badge v-if="v === inUse" tone="blue" :dot="false" class="r">本月在用</Badge>
                </div>
              </div>
            </section>
            <section>
              <h4 class="ph-vh">变更记录（{{ data.changes.length }}）</h4>
              <FPEmpty v-if="!data.changes.length" size="sm">还没有变更记录</FPEmpty>
              <div v-else class="ph-vl ph-tw">
                <table class="ph-tab">
                  <thead><tr><th>时间</th><th>谁</th><th>动作</th><th class="r">旧 → 新</th><th class="fp-fill" aria-hidden="true"></th></tr></thead>
                  <tbody>
                    <tr v-for="c in data.changes" :key="c.ts + c.action + (c.acctMonth ?? '')">
                      <td class="n e">{{ fmtTs(c.ts) }}</td>
                      <td>{{ whoOf(c) }}<span v-if="authorizerOf(c)" class="au">{{ authorizerOf(c) }}授权</span></td>
                      <td v-tip="c.note">{{ act(c) }}</td>
                      <td class="n r">{{ fmtV(c.oldText, c.oldValue) }}<span class="ar">→</span>{{ fmtV(c.newText, c.newValue) }}</td>
                      <td class="fp-fill" aria-hidden="true"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </template>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 画布 10-C .p10-hist:640 宽居中卡、圆角 16、弹窗阴影,遮罩用 --scrim */
.ph-scrim { position: fixed; inset: 0; z-index: var(--z-modal); background: var(--scrim); display: grid; place-items: center; animation: fp-fade-in var(--dur-base) var(--ease-out); }
.ph { width: min(640px, calc(100vw - 32px)); max-height: calc(100vh - 64px); display: flex; flex-direction: column; background: var(--surface-white); border-radius: 16px; border: 1px solid var(--border-subtle); box-shadow: var(--shadow-dialog); overflow: hidden; font-family: var(--font-sans); animation: fp-rise-in var(--dur-base) var(--ease-out) both; }
.ph-h { flex: 0 0 auto; display: flex; align-items: flex-start; gap: 12px; padding: 20px 22px 16px; border-bottom: 1px solid var(--divider); }
.ph-ht { flex: 1 1 auto; min-width: 0; }
.ph-ht h3 { margin: 0; font-size: 17px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.ph-ht p { margin: 3px 0 0; font-size: 12.5px; color: var(--text-muted); }
.ph-x { width: 28px; height: 28px; flex: 0 0 auto; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); cursor: pointer; display: grid; place-items: center; }
.ph-x:hover { background: var(--bg-hover); color: var(--text-primary); }
.ph-b { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 16px 22px 22px; display: flex; flex-direction: column; gap: 16px; }
.ph-loading { color: var(--text-muted); font-size: var(--fs-label); }
.ph-tl { display: grid; grid-template-columns: repeat(12, 1fr); }
.ph-tl > div { display: flex; flex-direction: column; gap: 6px; }
.ph-tl .m { font: 11px var(--font-mono); color: var(--text-muted); text-align: center; }
.ph-tl .m.cur { color: var(--text-primary); font-weight: var(--fw-semibold); }
.ph-tl .bar { height: 10px; background: var(--ink-050); }
.ph-tl .bar.cur { background: var(--hue-blue); }
.ph-tl .bar.old { background: color-mix(in srgb, var(--hue-blue) 45%, transparent); }
.ph-tl .bar.month { background: var(--hue-orange); }
.ph-tl .bar.st { border-radius: 5px 0 0 5px; margin-left: 2px; }
.ph-tl .bar.en { border-top-right-radius: 5px; border-bottom-right-radius: 5px; }
.ph-tl .bar.st.en { border-radius: 5px; }
.ph-vh { margin: 0 0 6px; font-size: 12px; font-weight: var(--fw-semibold); color: var(--text-secondary); }
.ph-vl { border-radius: 10px; box-shadow: 0 0 0 1px var(--border-subtle); }
.ph-vr { display: flex; align-items: center; gap: 10px; min-height: 40px; padding: 0 12px; font-size: 14px; color: var(--text-primary); }
.ph-vr + .ph-vr { border-top: 1px solid var(--divider); }
.ph-vr .sw { width: 10px; height: 10px; border-radius: 3px; flex: none; background: var(--ink-050); }
.ph-vr .sw.cur { background: var(--hue-blue); }
.ph-vr .sw.old { background: color-mix(in srgb, var(--hue-blue) 45%, transparent); }
.ph-vr .sw.month { background: var(--hue-orange); }
.ph-vr .num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: var(--fw-semibold); white-space: normal; line-height: 1.4; }
.ph-vr .s { font-size: 12px; color: var(--text-muted); white-space: nowrap; }
.ph-vr .r { margin-left: auto; }
.ph-tw { overflow-x: auto; }
.ph-tab { width: 100%; border-collapse: collapse; font-size: 12px; }
.ph-tab th { height: 36px; padding: 0 12px; text-align: left; font-weight: var(--fw-medium); color: var(--text-muted); border-bottom: 1px solid var(--divider); white-space: nowrap; }
.ph-tab td { height: 40px; padding: 0 12px; border-bottom: 1px solid var(--divider); white-space: nowrap; color: var(--text-primary); }
.ph-tab tbody tr:last-child td { border-bottom: none; }
.ph-tab .r { text-align: right; }
.ph-tab .n { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.ph-tab .e { color: var(--text-muted); }
.ph-tab .au { margin-left: 4px; color: var(--text-muted); }
.ph-tab .ar { margin: 0 6px; color: var(--text-muted); font-family: var(--font-sans); }
</style>
