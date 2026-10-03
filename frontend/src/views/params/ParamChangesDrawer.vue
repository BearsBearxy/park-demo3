<script setup lang="ts">
// 「本月改动」区(S21-PARAM-CENTER-SPEC §5.4,2026-10-03 画布 10-C 左半):右当前区卡里的一张表,原 1040 宽右抽屉撤掉 ——
// 文件名留着 Drawer 只为不动别处的引用。影响本月的参数改动 + 本月重算,新的在上;列 = 时间 / 参数(带范围)/ 旧 → 新 / 谁(带「x 授权」)。
// 点一行跳到那一项(emit jump,父页切区、滚到、闪一下);重算行不跳。open 变真时拉一次(父页切进本区时挂上即开)。
import { computed, ref, watch } from 'vue'
import { paramsApi, type ParamChangeDTO } from '@/api/params'
import { iconFor } from '@/components/ds/icon'
import FPEmpty from '@/components/fp/FPEmpty.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import { authorizerOf, changeStats, isParamChange, whoOf } from './paramSections'

const props = defineProps<{ open: boolean; ym: string }>()
const emit = defineEmits<{ jump: [c: ParamChangeDTO] }>()

const list = ref<ParamChangeDTO[] | null>(null)
const err = ref('')
const q = ref('')
let seq = 0
// 打开 / 重试共用。err 只在成功时清:重试在途时失败面不先消失(房内定型写法)
async function load() {
  const my = ++seq
  try {
    const d = await paramsApi.changes(props.ym)
    if (my === seq) { list.value = d; err.value = '' }
  } catch (e) {
    if (my === seq) err.value = (e as { message?: string })?.message ?? '变更记录加载失败'
  }
}
watch(() => [props.open, props.ym] as const, ([o]) => {
  if (!o) return
  list.value = null; err.value = ''; q.value = ''
  load()
}, { immediate: true })
const ymText = computed(() => `${props.ym.slice(0, 4)} 年 ${Number(props.ym.slice(5, 7))} 月`)
const stats = computed(() => changeStats(list.value ?? []))

const shown = computed(() => {
  const kw = q.value.trim()
  const all = (list.value ?? []).filter(isParamChange)
  return kw ? all.filter(c => `${c.label ?? ''} ${c.scopeLabel ?? ''} ${c.note ?? ''} ${c.actor}`.includes(kw)) : all
})
const fmtTs = (iso: string) => iso.slice(5, 16).replace('T', ' ')
// 值文案由后端给(与列表行同一格式器);值空 = 此前无值 / 已删 → 「–」(老后端没有文案字段时退回原始数字)
const fmtV = (t: string | null | undefined, v: number | null) => t ?? (v == null ? '–' : String(v))
const isRecalc = (c: ParamChangeDTO) => c.action === 'recalc'
// 池结构改动(公共电核算改池,key 为空)没有参数名:那一格写日志里的原话
const what = (c: ParamChangeDTO) => c.label || c.note || ''
const scopeText = (c: ParamChangeDTO) => (c.label ? (c.scopeLabel ?? '').replace(/（(池|户|表)）$/, '') : '')
const canJump = (c: ParamChangeDTO) => !isRecalc(c) && c.scope != null
</script>

<template>
  <div class="pc">
    <div class="pc-h">
      <b>本月改动</b>
      <span class="s">影响 {{ ym }}<template v-if="list"> · {{ stats.items.size }} 项改了 {{ stats.times }} 次，新的在上</template></span>
      <span class="sp" />
      <label class="pc-search"><component :is="iconFor('search')" :size="13" /><input v-model="q" class="pc-q" type="text" placeholder="筛选" /></label>
    </div>
    <FPLoadError v-if="err" :sub="err" @retry="load">{{ ymText }}的变更记录没读到</FPLoadError>
    <div v-else-if="!list" class="pc-empty">加载中…</div>
    <FPEmpty v-else-if="!shown.length">{{ list.some(isParamChange) ? '没有符合筛选的变更记录' : `${ymText}还没有变更记录` }}</FPEmpty>
    <div v-else class="pc-wrap">
      <table class="pc-tab">
        <thead><tr><th>时间</th><th>参数</th><th class="r">旧 → 新</th><th>谁</th><th class="fp-fill" aria-hidden="true"></th></tr></thead>
        <tbody>
          <tr v-for="c in shown" :key="c.ts + (c.key ?? '') + (c.scope ?? '') + c.action" :class="{ go: canJump(c) }"
              :tabindex="canJump(c) ? 0 : undefined" @click="canJump(c) && emit('jump', c)" @keydown.enter="canJump(c) && emit('jump', c)">
            <td class="n e">{{ fmtTs(c.ts) }}</td>
            <td class="nm" v-tip="c.label ? c.note : null">{{ what(c) }}<span v-if="scopeText(c)" class="u">{{ scopeText(c) }}</span></td>
            <td class="n r">
              <template v-if="isRecalc(c)">{{ (c.note ?? '').split(' / ').join(' · ') }}</template>
              <template v-else-if="c.key">{{ fmtV(c.oldText, c.oldValue) }}<span class="ar">→</span>{{ fmtV(c.newText, c.newValue) }}</template>
            </td>
            <td class="who">{{ whoOf(c) }}<span v-if="authorizerOf(c)" class="au">{{ authorizerOf(c) }}授权</span></td>
            <td class="fp-fill" aria-hidden="true"></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
/* 卡头与表格照抄父页 .pm-ch / .pm-table 的一套(画布 10-C):卡头 52 高,行 40 高,表头贴顶 */
.pc { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.pc-h { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; height: 52px; padding: 0 12px 0 16px; border-bottom: 1px solid var(--divider); }
.pc-h > b { font-size: 16px; font-weight: var(--fw-semibold); white-space: nowrap; color: var(--text-primary); }
.pc-h .s { font-size: 12px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pc-h .sp { flex: 1; }
.pc-search { display: inline-flex; align-items: center; gap: 6px; width: 150px; height: 28px; box-sizing: border-box; padding: 0 10px; border: 1px solid var(--border-control); border-radius: var(--radius-full); color: var(--text-muted); flex: 0 0 auto; }
.pc-search:focus-within { border-color: var(--hue-blue); }
.pc-q { flex: 1 1 auto; min-width: 0; border: none; outline: none; background: transparent; font-family: var(--font-sans); font-size: 12px; color: var(--text-primary); }
.pc-empty { padding: 16px; color: var(--text-muted); font-size: var(--fs-label); }
.pc-wrap { flex: 1 1 auto; min-height: 0; overflow: auto; }
.pc-tab { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 14px; }
.pc-tab th { position: sticky; top: 0; z-index: 2; height: 40px; padding: 0 12px; background: var(--surface-card); font-size: 12px; font-weight: var(--fw-medium); color: var(--text-muted); text-align: left; white-space: nowrap; border-bottom: 1px solid var(--divider); }
.pc-tab td { height: 40px; padding: 0 12px; border-bottom: 1px solid var(--divider); white-space: nowrap; color: var(--text-primary); }
.pc-tab .r { text-align: right; }
.pc-tab td.n { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.pc-tab td.e { font-size: 12px; color: var(--text-muted); }
.pc-tab .u { margin-left: 4px; font-size: 12px; color: var(--text-muted); }
.pc-tab .ar { margin: 0 6px; color: var(--text-muted); font-family: var(--font-sans); }
.pc-tab .who { color: var(--text-secondary); }
.pc-tab .au { margin-left: 4px; font-size: 12px; color: var(--text-muted); }
.pc-tab tbody tr.go { cursor: pointer; }
.pc-tab tbody tr.go:hover td { background: var(--surface-card); }
.pc-tab tbody tr.go:focus-visible { outline: 2px solid var(--hue-blue); outline-offset: -2px; }
</style>
