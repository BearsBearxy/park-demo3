<script setup lang="ts">
// 在册状态列表的「加一行」与「改月」(METER-TIMELINE-SPEC §3.4)。
// 加一行 = 自 M 起 在用 / 停用 / 已拆;拆除问「最后一次抄表是哪个月 L」,写 L 的次月(L 的读数照收)。
// 改月 = 把这一行挪到另一个月(第一行不能删,只能这样改)。确认前数出这次会改到哪几个月、
// 其中有读数的月份、不能改的月份;拆除时提示所在公摊池与这一段人工绑定的合同。
import { ref, computed, watch } from 'vue'
import {
  metersApi, type MeterStatusImpactDTO, type MeterStatusRow, type MeterStatusValue,
} from '@/api/meters'
import { STATUS_LABEL, EARLIEST, rangeText, lockedText, shiftYm } from './meterTimeline'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import DatePicker from '@/components/ds/DatePicker.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'

const props = defineProps<{
  edit: boolean
  meterId: number
  meterName: string
  ym: string                      // 查看月:加一行的缺省月份
  rows: MeterStatusRow[]          // 这块表的状态行,升序
  row: MeterStatusRow | null      // null = 加一行;否则 = 给这一行改月
}>()
const emit = defineEmits<{ close: []; done: [] }>()

const YM_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const moving = computed(() => props.row != null)
const status = ref<MeterStatusValue>(props.row?.status ?? 'retired')
// 已拆问的是最后一次抄表月 L(写 L 的次月);其余问起始月
const month = ref(props.row
  ? (props.row.status === 'removed' ? shiftYm(props.row.fromYm, -1) : (props.row.fromYm === EARLIEST ? '' : props.row.fromYm))
  : props.ym)
const fromYm = computed(() => (YM_RE.test(month.value) ? (status.value === 'removed' ? shiftYm(month.value, 1) : month.value) : ''))

const STATUS_OPTS = [
  { value: 'retired', label: '停用(照常显示,不计费)' },
  { value: 'removed', label: '已拆(不再显示)' },
  { value: 'active', label: '在用' },
]

// ── 这次改到哪几个月、改成什么 ──
const idx = computed(() => (props.row ? props.rows.findIndex(r => r.fromYm === props.row!.fromYm) : -1))
const prevStatus = computed(() => (idx.value > 0 ? props.rows[idx.value - 1].status : null))
const old = computed(() => props.row?.fromYm ?? '')
const later = computed(() => moving.value && fromYm.value > old.value)
// 改月只在前后两行之间挪(后端同样 409):越过相邻行 = 两行对调,下面按「只挪这一行」数出的月份和读数就不对了
const lo = computed(() => (moving.value && idx.value > 0 ? props.rows[idx.value - 1].fromYm : null))
const hi = computed(() => (moving.value && idx.value + 1 < props.rows.length ? props.rows[idx.value + 1].fromYm : null))
const inBounds = computed(() => !fromYm.value || ((!lo.value || fromYm.value > lo.value) && (!hi.value || fromYm.value < hi.value)))
// 月份框里填的是 fromYm;已拆填的是它的前一个月
const monthMin = computed(() => (lo.value ? (status.value === 'removed' ? lo.value : shiftYm(lo.value, 1)) : undefined))
const monthMax = computed(() => (hi.value ? shiftYm(hi.value, status.value === 'removed' ? -2 : -1) : undefined))
const boundText = computed(() => [lo.value && lo.value !== EARLIEST ? `${lo.value} 之后` : '', hi.value ? `${hi.value} 之前` : '']
  .filter(Boolean).join('、'))

const imp = ref<MeterStatusImpactDTO | null>(null)       // 自 fromYm 起
const impOld = ref<MeterStatusImpactDTO | null>(null)    // 改月时原来那一行
const impErr = ref('')
const impKey = ref('')
let seq = 0
async function loadImpact() {
  const f = fromYm.value
  if (!f || !inBounds.value || (moving.value && f === old.value)) { imp.value = null; impOld.value = null; impKey.value = ''; return }
  const n = ++seq
  try {
    const [a, b] = await Promise.all([
      metersApi.statusImpact(props.meterId, f, status.value),
      // 往后挪且这一行是「在用」:原来那几个月回到上一行 / 不在册,要按「不计费」数读数
      moving.value ? metersApi.statusImpact(props.meterId, old.value, status.value === 'active' ? 'retired' : status.value) : null,
    ])
    if (n !== seq) return
    imp.value = a; impOld.value = b; impKey.value = `${f}|${status.value}`; impErr.value = ''
  } catch (e) {
    if (n === seq) impErr.value = (e as { message?: string })?.message ?? '影响范围没算出来，请重试'
  }
}
watch([fromYm, status], loadImpact, { immediate: true })
const ready = computed(() => imp.value != null && impKey.value === `${fromYm.value}|${status.value}`)

const effect = computed(() => {
  const f = fromYm.value
  if (!ready.value || !imp.value) return null
  const locked = [...imp.value.locked, ...(impOld.value?.locked ?? [])]
    .filter((l, i, a) => a.findIndex(x => x.ym === l.ym) === i)
    .sort((x, y) => x.ym.localeCompare(y.ym))
  if (!moving.value) {
    return {
      line: `${rangeText(imp.value.from, imp.value.until)} 改为「${STATUS_LABEL[status.value]}」`,
      locked, readings: imp.value.readings,
    }
  }
  if (!later.value) {   // 往前挪:[新月, 原月) 改成这一行的状态
    return {
      line: `${rangeText(f, shiftYm(old.value, -1))} 改为「${STATUS_LABEL[status.value]}」`,
      locked, readings: imp.value.readings,
    }
  }
  // 往后挪:[原月, 新月) 回到上一行(第一行 = 不在册)
  const back = prevStatus.value ? `回到上一行的「${STATUS_LABEL[prevStatus.value]}」` : '不在册'
  const stops = status.value === 'active' && prevStatus.value !== 'active'
  return {
    line: `${rangeText(old.value, shiftYm(f, -1))} ${back}`,
    locked,
    readings: stops ? (impOld.value?.readings ?? []).filter(r => r.ym < f) : [],
  }
})

const busy = ref(false)
const err = ref('')
const canConfirm = computed(() => props.edit && !!effect.value && !effect.value.locked.length && !busy.value)
// 保存途中不许关:关了弹框就卸载,后端照写完,done 发不出去,屏上不刷新
function close() { if (!busy.value) emit('close') }
async function confirm() {
  if (!props.edit) return
  if (!canConfirm.value) return
  busy.value = true
  try {
    await metersApi.setStatus(props.meterId, {
      fromYm: fromYm.value, status: status.value, ...(moving.value ? { replaceFromYm: old.value } : {}),
    })
    emit('done')
  } catch (e) {
    err.value = (e as { message?: string })?.message ?? '保存失败，请重试'
  } finally {
    busy.value = false
  }
}
const fmtUsage = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
</script>

<template>
  <FPDrawer
    open :title="moving ? '改这一行的月份' : '加一行在册状态'" :subtitle="meterName"
    icon="calendar" :width="520" tier="modal-2" @close="close"
  >
    <div class="sd-form">
      <div v-if="!moving" class="sd-fld">
        <label>状态</label>
        <Select size="sm" :model-value="status" :options="STATUS_OPTS" :style="{ width: '100%' }"
                @update:model-value="status = $event as MeterStatusValue" />
      </div>
      <div v-else class="sd-fld">
        <label>这一行</label>
        <span>{{ STATUS_LABEL[status] }} · {{ rangeText(row!.fromYm, null) }}</span>
      </div>
      <div class="sd-fld">
        <label>{{ status === 'removed' ? '最后一次抄表是哪个月' : '自哪个月起' }}</label>
        <DatePicker v-model="month" mode="month" size="sm" :min="monthMin" :max="monthMax"
                    :aria-label="status === 'removed' ? '最后一次抄表月' : '起始月'" />
      </div>
    </div>
    <p v-if="boundText" class="sd-hint">只能挪到 {{ boundText }};要越过相邻的那一行,请先撤回或改那一行。</p>
    <p v-if="status === 'removed' && fromYm" class="sd-hint">自 {{ fromYm }} 起已拆,{{ month }} 的读数照收。</p>

    <p v-if="moving && fromYm === old" class="sd-hint">月份没变。</p>
    <p v-else-if="!inBounds" class="sd-lk">这个月越过了相邻的那一行,不能这样挪。</p>
    <p v-else-if="fromYm && !ready && !impErr" class="sd-hint">正在数这次会改到的月份…</p>
    <template v-else-if="effect">
      <p class="sd-line">{{ effect.line }}</p>
      <p v-if="effect.locked.length" class="sd-lk">这几个月不能改:{{ lockedText(effect.locked) }}</p>
      <div v-if="effect.readings.length" class="sd-warn">
        这 {{ effect.readings.length }} 个月的读数将不再计费:
        <span v-for="r in effect.readings" :key="r.ym" class="mono">{{ r.ym }}({{ fmtUsage(r.usage) }})</span>
      </div>
      <template v-if="!moving && status === 'removed' && imp">
        <p v-if="imp.pools.length" class="sd-hint">
          这块表在公摊池 {{ imp.pools.map(p => p.name).join('、') }} 里:旧表不用移出,自 {{ fromYm }} 起自动不计;换上的新表要自己加进池。
        </p>
        <p v-if="imp.contractNo" class="sd-hint">这一段人工绑定了合同 {{ imp.contractNo }}。</p>
      </template>
    </template>

    <!-- 影响没算出来 / 保存失败:一行常驻,出错不把下面的按钮顶走 -->
    <p class="sd-err"><template v-if="impErr || err">{{ [impErr, err].filter(Boolean).join(' ') }}</template></p>

    <template #footer>
      <Button variant="gray" size="sm" :disabled="busy" @click="close">取消</Button>
      <Button variant="filled" size="sm" :disabled="!canConfirm" @click="confirm">
        {{ effect?.readings.length ? `确认,这 ${effect.readings.length} 个月不再计费` : '确认' }}
      </Button>
    </template>
  </FPDrawer>
</template>

<style scoped>
.sd-form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 16px; }
@media (max-width: 600px) { .sd-form { grid-template-columns: 1fr; } }
.sd-fld { min-width: 0; }
.sd-fld label { display: block; margin-bottom: 5px; font-size: var(--fs-label); color: var(--text-muted); }
.sd-fld span { font-size: var(--fs-body); color: var(--text-primary); }
.sd-line { margin: 0; font-size: var(--fs-body); color: var(--text-primary); }
.sd-hint { margin: 0; font-size: var(--fs-label); color: var(--text-secondary); overflow-wrap: anywhere; }
.sd-lk { margin: 0; font-size: var(--fs-label); color: var(--caution-text); overflow-wrap: anywhere; }
.sd-warn { display: flex; flex-wrap: wrap; gap: 4px 10px; padding: 8px 12px; border-radius: var(--radius-md); background: var(--caution-soft); font-size: var(--fs-label); color: var(--caution-text); }
.sd-warn .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.sd-err { margin: 0; min-height: 18px; line-height: 18px; font-size: var(--fs-label); color: var(--hue-red); overflow-wrap: anywhere; }
</style>
