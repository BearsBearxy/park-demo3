<script setup lang="ts">
// 计费参数改值卡(S21-PARAM-CENTER-SPEC §5.3,2026-10-03 画布 10-B):点格子贴着格子弹出的 400 宽卡(原居中 500 宽弹窗撤掉)。
// 值 + 单位 +「当前 x」|「从哪个月起」三选:仅本月 / 自本月起用到更晚一版为止 / 改错原地更正当前生效那版(不给任意月)| 备注 |
// 底部「删除「… 」这一版」(红字)/ 取消 / 保存。三选在后端各有落点:month 行、from 行(右端由下一版本推出)、correction=true 原地改命中行。
// 值控件按注册表 valueKind:数值 input / enum→Select / bool→Segmented / ref→Select(候选由父页给)。
// meterPick:楼栋损耗「不计入楼栋合计的表」格子里的「+」—— 值换成「选这栋的哪块表」,存成那块表的 loss_exclude=1。
// 浮层三铁律(UI-OVERLAY-SPEC):点外关(capture,确认弹窗开着时不算)、Esc 只关自己、关时注销监听。
// 本组件只组装 ParamPutReq 交父页写库(父页做铁律二 patch),不碰网络。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import type { ParamPutReq, ParamRowDTO } from '@/api/params'
import { paramDef, type ParamMode } from '@/utils/paramRegistry'
import { ask, askQueue } from '@/utils/ask'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import Segmented from '@/components/ds/Segmented.vue'
import { bare, verLabel } from './paramSections'

export interface RefOption { value: string; label: string }

const props = defineProps<{
  open: boolean
  row: ParamRowDTO | null
  ym: string
  refOptions?: RefOption[]        // ref_meter / ref_building 的候选(父页按栋/期过滤好)
  anchor?: HTMLElement | null     // 贴着哪一格弹;没有就居中
  meterPick?: RefOption[]         // 给了 = 「不计入的表」新增:值换成选表
}>()
const emit = defineEmits<{ close: []; save: [req: ParamPutReq] }>()

const def = computed(() => (props.row ? paramDef(props.row.key) : undefined))
const kind = computed(() => def.value?.valueKind ?? 'number')
const picking = computed(() => !!props.meterPick)

// 布尔键状态句(与后端 valueText 同口径:0/1 各一句)
const BOOL_TEXT: Record<string, [string, string]> = {
  loss_recon: ['不参与', '参与'],
  loss_exclude: ['计入', '不计入'],
  loss_denom_cable: ['仅总表', '总表 + 铝缆'],
}
const boolOpts = computed(() => {
  const t = BOOL_TEXT[props.row?.key ?? ''] ?? ['否', '是']
  return [{ value: '0', label: t[0] }, { value: '1', label: t[1] }]
})
const enumOpts = computed(() =>
  Object.entries(def.value?.enumOptions ?? {}).map(([v, l]) => ({ value: v, label: l })))

type Way = 'month' | 'from' | 'correction'
const val = ref('')
const way = ref<Way>('month')
const note = ref('')
const inp = ref<HTMLInputElement | null>(null)
const card = ref<HTMLElement | null>(null)
const pos = ref<{ left: string; top: string } | null>(null)
watch(() => [props.open, props.row] as const, ([o]) => {
  if (!o || !props.row) return
  pos.value = null   // 上一次的位置不许先闪一下:摆好之前先藏着
  val.value = picking.value || props.row.value == null ? '' : String(props.row.value)
  way.value = def.value?.defaultMode ?? 'from'
  note.value = ''
  nextTick(() => { place(); inp.value?.focus(); inp.value?.select() })
}, { immediate: true })

// 当前命中的那一版(本作用域自己的)—— 改错 / 删除都指它;本月有专属 month 行时它就是那一行
const curVer = computed(() => (props.row?.hasMonthRow ? verLabel('month', props.ym) : props.row ? verLabel(props.row.mode, props.row.acctMonth) : ''))
const canCorrect = computed(() => !picking.value && props.row?.rowId != null)
// 只能按月生效的键(电价 6 键 / 照抄金额,注册表 monthOnly = 后端 400「只能按月生效」的镜像)不出「自 X 起」
const wayOpts = computed(() => [
  { value: 'month' as Way, label: `仅 ${props.ym}` },
  ...(def.value?.monthOnly ? [] : [{ value: 'from' as Way, label: `自 ${props.ym} 起，用到更晚的一版为止` }]),
  ...(canCorrect.value ? [{ value: 'correction' as Way, label: `改错：原地更正「${curVer.value}」这一版` }] : []),
])
const wayHint = computed(() => way.value === 'month'
  ? `只影响 ${props.ym}；其它月份照旧`
  : way.value === 'from'
    ? `${props.ym} 及以后沿用；更早的月份不受影响`
    : `不新建版本，「${curVer.value}」这一版覆盖的月份一起变`)

const numeric = computed(() => !picking.value && !['enum', 'bool', 'ref_meter', 'ref_building', 'ref_rule'].includes(kind.value))
const parsed = computed<number | null>(() => {
  const t = val.value.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
})
const canSave = computed(() => parsed.value != null)
const cur = computed(() => (props.row && props.row.mode != null && !picking.value ? bare(props.row) : ''))
const sub = computed(() => (props.row?.scopeLabel ?? '').replace(/（(池|户|表)）$/, ''))

function submit() {
  if (!props.row || parsed.value == null) return
  const r = props.row
  const n = note.value.trim() || null
  if (picking.value) {
    emit('save', { key: 'loss_exclude', scope: `meter:${parsed.value}`, acctMonth: props.ym, mode: way.value as ParamMode, value: 1, note: n, correction: false })
    return
  }
  const correction = way.value === 'correction'
  emit('save', {
    key: r.key, scope: r.scope, acctMonth: props.ym,
    mode: correction ? r.mode : (way.value as ParamMode),
    value: parsed.value, note: n, correction,
  })
}

// 删除:优先删本月 month 行(恢复长期值);否则删命中的本作用域版本行
const delLabel = computed(() => (!picking.value && (props.row?.hasMonthRow || props.row?.rowId != null) ? `删除「${curVer.value}」这一版` : ''))
async function remove() {
  const r = props.row
  if (!r) return
  const monthRow = r.hasMonthRow
  const desc = monthRow ? `${props.ym} 的专属值` : `版本「${r.rangeText}」`
  const ok = await ask({
    title: `删除「${r.scopeLabel} · ${r.label}」${desc}？`,
    body: '删除后该月回退到上一层级 / 上一版本的值。',
    action: '删除',
    danger: true,
  })
  // 问的途中弹窗关了或换了一行:不替别的行发删除(比键不比引用:父页重载会换掉行对象)
  if (!ok || !props.open || props.row?.key !== r.key || props.row?.scope !== r.scope) return
  emit('save', {
    key: r.key, scope: r.scope,
    acctMonth: monthRow ? props.ym : r.acctMonth, mode: monthRow ? 'month' : r.mode,
    value: null, note: note.value.trim() || null, correction: false,
  })
}

// ── 贴格摆放:左沿对齐格子,下面放不下翻到上面,左右夹在屏内 8px ──
function place() {
  const el = card.value
  if (!el) return
  const vw = window.innerWidth, vh = window.innerHeight
  const w = el.offsetWidth || 400, h = el.offsetHeight
  const a = props.anchor?.getBoundingClientRect()
  if (!a) { pos.value = { left: Math.max(8, (vw - w) / 2) + 'px', top: Math.max(8, (vh - h) / 2) + 'px' }; return }
  const left = Math.min(Math.max(8, a.left), vw - w - 8)
  const below = a.bottom + 6
  const top = below + h > vh - 8 ? Math.max(8, a.top - h - 6) : below
  pos.value = { left: left + 'px', top: top + 'px' }
}
function onDoc(e: MouseEvent) {
  if (askQueue.length) return   // 删除确认开着:点它的按钮不算点外面
  const t = e.target as HTMLElement | null
  if (!t || card.value?.contains(t) || props.anchor?.contains(t)) return
  if (t.closest?.('.ds-sel-panel, .ds-sel-scrim')) return   // S 档下拉面板挂在 body 上
  emit('close')
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.stopPropagation(); emit('close') }
}
const onMove = () => place()
function listen(on: boolean) {
  if (on) {
    document.addEventListener('mousedown', onDoc, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
  } else {
    document.removeEventListener('mousedown', onDoc, true)
    document.removeEventListener('keydown', onKey, true)
    window.removeEventListener('resize', onMove)
    window.removeEventListener('scroll', onMove, true)
  }
}
const shown = computed(() => props.open && !!props.row)
watch(shown, v => listen(v), { immediate: true })
onBeforeUnmount(() => listen(false))
</script>

<template>
  <Teleport to="body">
    <div v-if="shown && row" ref="card" class="pe-pop" role="dialog" :aria-label="row.label" :style="pos ?? { visibility: 'hidden' }">
      <div class="pe-h">
        <div class="pe-ht">
          <b>{{ picking ? '不计入楼栋合计的表' : row.label }}</b>
          <span>{{ sub }}</span>
        </div>
        <button type="button" class="pe-x" aria-label="关闭" @click="emit('close')"><component :is="iconFor('x')" :size="16" /></button>
      </div>
      <div class="pe-b">
        <div>
          <div class="pe-lb">{{ picking ? '哪块表' : '值' }}</div>
          <div class="pe-in">
            <!-- 不用 v-model:type=number 的 v-model 会把值强转成 number,val 须恒为字符串(空串=未填) -->
            <input v-if="numeric" ref="inp" :value="val" class="pe-num" type="number" step="any" placeholder="请输入数字"
                   @input="val = ($event.target as HTMLInputElement).value" @keydown.enter="submit" />
            <div v-else class="pe-sel">
              <Select v-if="picking" :options="meterPick ?? []" :model-value="val" size="sm" placeholder="选这栋的表" @update:model-value="val = $event" />
              <Select v-else-if="kind === 'enum'" :options="enumOpts" :model-value="val" size="sm" placeholder="请选择" @update:model-value="val = $event" />
              <Segmented v-else-if="kind === 'bool'" :options="boolOpts" :model-value="val" size="sm" @update:model-value="val = $event" />
              <Select v-else :options="refOptions ?? []" :model-value="val" size="sm" placeholder="请选择" @update:model-value="val = $event" />
            </div>
            <span v-if="numeric && def?.unit" class="pe-u">{{ def.unit }}</span>
            <span v-if="cur" class="pe-was">当前 {{ cur }}</span>
          </div>
        </div>
        <div>
          <div class="pe-lb">从哪个月起</div>
          <template v-for="o in wayOpts" :key="o.value">
            <label class="pe-rad" :class="{ on: way === o.value }">
              <input type="radio" name="pe-way" :value="o.value" v-model="way" />{{ o.label }}
            </label>
            <p v-if="way === o.value" class="pe-eff">{{ wayHint }}</p>
          </template>
        </div>
        <div>
          <div class="pe-lb">备注</div>
          <input v-model="note" class="pe-ta" type="text" placeholder="来源说明，如:供电局 8 月账单" @keydown.enter="submit" />
        </div>
      </div>
      <div class="pe-f">
        <button v-if="delLabel" type="button" class="pe-del" @click="remove">{{ delLabel }}</button>
        <Button variant="outline" size="sm" @click="emit('close')">取消</Button>
        <Button variant="filled" size="sm" :disabled="!canSave" @click="submit">保存</Button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* 画布 10-B .p10-pop:400 宽、圆角 12、浮起面 + 弹层阴影 */
.pe-pop { position: fixed; z-index: var(--z-popover); width: 400px; max-width: calc(100vw - 16px); box-sizing: border-box; background: var(--surface-raised); border-radius: 12px; box-shadow: var(--shadow-pop), 0 0 0 1px var(--border-subtle); font-family: var(--font-sans); animation: fp-pop-in var(--dur-fast) var(--ease-out); }
.pe-h { display: flex; align-items: flex-start; gap: 10px; padding: 14px 16px 12px; border-bottom: 1px solid var(--divider); }
.pe-ht { flex: 1 1 auto; min-width: 0; }
.pe-ht b { display: block; font-size: 14px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.pe-ht span { display: block; margin-top: 2px; font-size: 12px; color: var(--text-muted); }
.pe-x { width: 24px; height: 24px; flex: 0 0 auto; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); cursor: pointer; display: grid; place-items: center; }
.pe-x:hover { background: var(--bg-hover); color: var(--text-primary); }
.pe-b { padding: 14px 16px 6px; display: flex; flex-direction: column; gap: 12px; }
.pe-lb { font-size: 12px; color: var(--text-muted); margin-bottom: 6px; }
.pe-in { display: flex; align-items: center; gap: 8px; }
.pe-num { width: 180px; height: 34px; box-sizing: border-box; padding: 0 10px; border: 1px solid var(--border-control); border-radius: var(--radius-sm); background: var(--surface-white); font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 14px; text-align: right; color: var(--text-primary); outline: none; }
.pe-num:focus { border-color: var(--hue-blue); box-shadow: 0 0 0 3px var(--accent-blue); }
.pe-num::-webkit-outer-spin-button, .pe-num::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.pe-sel { flex: 1 1 auto; min-width: 0; }
.pe-u { font-size: 14px; color: var(--text-secondary); }
.pe-was { margin-left: auto; font-size: 12px; color: var(--text-muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
.pe-rad { display: flex; align-items: center; gap: 8px; min-height: 32px; font-size: 14px; color: var(--text-secondary); cursor: pointer; }
.pe-rad.on { color: var(--text-primary); }
.pe-rad input { width: 16px; height: 16px; margin: 0; accent-color: var(--hue-blue); flex: none; }
.pe-eff { margin: 0 0 0 24px; font-size: 12px; line-height: 18px; color: var(--text-muted); }
.pe-ta { width: 100%; height: 34px; box-sizing: border-box; padding: 0 10px; border: 1px solid var(--border-control); border-radius: var(--radius-sm); background: var(--surface-white); font-family: var(--font-sans); font-size: 12px; color: var(--text-primary); outline: none; }
.pe-ta:focus { border-color: var(--hue-blue); }
.pe-f { display: flex; align-items: center; gap: 8px; padding: 12px 16px; margin-top: 8px; border-top: 1px solid var(--divider); }
.pe-f > :first-child:not(.pe-del) { margin-left: auto; }
.pe-del { margin-right: auto; padding: 0; border: none; background: none; font: inherit; font-size: 12px; color: var(--hue-red); cursor: pointer; }
.pe-del:hover { text-decoration: underline; }
</style>
