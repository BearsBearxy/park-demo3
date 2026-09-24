<script setup lang="ts">
// 改归属 / 改合同绑定的「从哪个月起改」(METER-TIMELINE-SPEC §3.3):
// 站在查看月 V,当前生效的是自 F 起那一段 —— F < V 时二选一(从 V 起变更 / 更正自 F 起那一行),
// 各写明影响哪几个月;有不能改的月份的选项灰掉并写明是哪个月、为什么。
// 同房间的表默认一起改,和这块表用同一个起始月写(SPEC §3.3,后端按 meterIds 第一块定起始月);
// 上线时复制的后续几段给一个默认不勾的复选框。真正的写由调用方的 run 做。
import { ref, computed } from 'vue'
import type { MeterAssignMode, MeterSpan, MeterTimelineDTO } from '@/api/meters'
import { METER_KIND_LABEL } from '@/utils/meterExcel'
import { rangeText, lockedText, EARLIEST, type AssignChoice } from './meterTimeline'
import Button from '@/components/ds/Button.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'

const props = defineProps<{
  title: string
  meterName: string
  ym: string
  lines: string[]                         // 改什么:「楼层:三楼 → 四楼」
  impact: MeterTimelineDTO['impact']
  siblings: MeterTimelineDTO['siblings']  // 不一起改就传 []
  withMigrate: boolean
  tenantTo: string | null                 // 改到哪一户(换租时写明整月归谁)
  run: (c: AssignChoice) => Promise<unknown>
}>()
const emit = defineEmits<{ close: []; done: [] }>()

interface Opt { mode: MeterAssignMode; title: string; span: MeterSpan }
const opts = computed<Opt[]>(() => {
  const { correct, from } = props.impact
  // 早于第一段,或当前这一段正好从 V 起:只有一种改法
  if (!correct || correct.from === from.from) return [{ mode: 'from', title: `改自 ${props.ym} 起的这一段`, span: from }]
  return [
    { mode: 'from', title: `从 ${props.ym} 起变更`, span: from },
    { mode: 'correct', title: correct.from === EARLIEST ? '更正现有的这一段' : `更正自 ${correct.from} 起的这一段`, span: correct },
  ]
})
const pick = ref<MeterAssignMode | null>(opts.value.find(o => !o.span.locked.length)?.mode ?? null)
const chosen = computed(() => opts.value.find(o => o.mode === pick.value) ?? null)

const sibOn = ref<Set<number>>(new Set(props.siblings.map(s => s.meterId)))
function toggleSib(id: number) {
  const s = new Set(sibOn.value)
  if (s.has(id)) s.delete(id); else s.add(id)
  sibOn.value = s
}
const alsoMigrate = ref(false)

// 2024-03 → 2024年3
const ymCn = (ym: string) => `${ym.slice(0, 4)}年${Number(ym.slice(5))}`

const busy = ref(false)
const err = ref('')
// 保存途中不许关:关了弹框就卸载,后端照写完,done 发不出去,屏上不刷新、行内输入却被复位成旧值
function close() { if (!busy.value) emit('close') }
async function confirm() {
  if (!chosen.value || chosen.value.span.locked.length || busy.value) return
  busy.value = true
  try {
    await props.run({ mode: chosen.value.mode, siblingIds: [...sibOn.value], alsoMigrate: alsoMigrate.value })
    emit('done')
  } catch (e) {
    err.value = (e as { message?: string })?.message ?? '保存失败，请重试'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <FPDrawer open :title="title" :subtitle="meterName" icon="calendar" :width="520" tier="modal-2" @close="close">
    <ul class="ad-lines">
      <li v-for="l in lines" :key="l">{{ l }}</li>
    </ul>

    <div class="ad-opts" role="radiogroup">
      <button
        v-for="o in opts" :key="o.mode" type="button" role="radio" class="ad-opt"
        :class="{ on: pick === o.mode }" :aria-checked="pick === o.mode" :disabled="o.span.locked.length > 0"
        @click="pick = o.mode"
      >
        <span class="t">{{ o.title }}</span>
        <span class="s">影响 {{ rangeText(o.span.from, o.span.until) }}</span>
        <span v-if="o.span.locked.length" class="lk">这几个月不能改:{{ lockedText(o.span.locked) }}</span>
      </button>
    </div>

    <p v-if="tenantTo && chosen && chosen.span.from !== EARLIEST" class="ad-note">
      水电按月抄表，{{ ymCn(chosen.span.from) }}月整月算给 {{ tenantTo }}。
    </p>

    <div v-if="siblings.length" class="ad-sibs">
      <span class="lab">同房间的表(站在 {{ ym }} 看同楼栋、同房号),一起改:</span>
      <label v-for="s in siblings" :key="s.meterId" class="ad-ck">
        <input type="checkbox" :checked="sibOn.has(s.meterId)" @change="toggleSib(s.meterId)" >
        <span>{{ METER_KIND_LABEL[s.kind] }} · {{ s.name }}{{ s.tenantName ? ` · ${s.tenantName}` : '' }}</span>
      </label>
      <span v-if="chosen && sibOn.size" class="lab">
        勾上的表也{{ chosen.span.from === EARLIEST ? '从最早的月份' : `自 ${chosen.span.from} ` }}起一起改,各改到它自己的下一次变更之前。
      </span>
    </div>

    <label v-if="withMigrate && impact.migrateCopies > 0" class="ad-ck">
      <input v-model="alsoMigrate" type="checkbox" >
      <span>一并更正后面 {{ impact.migrateCopies }} 段(按旧档案补记的)</span>
    </label>

    <p class="ad-err"><template v-if="err">{{ err }}</template></p>

    <template #footer>
      <Button variant="gray" size="sm" :disabled="busy" @click="close">取消</Button>
      <Button variant="filled" size="sm" :disabled="!chosen || busy" @click="confirm">确认修改</Button>
    </template>
  </FPDrawer>
</template>

<style scoped>
.ad-lines { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: var(--fs-body); color: var(--text-primary); overflow-wrap: anywhere; }
.ad-opts { display: flex; flex-direction: column; gap: 8px; }
/* 选项卡片照合同绑定的候选合同(.bc-item)画 */
.ad-opt { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; border: 1px solid var(--border-subtle); background: var(--surface-white); border-radius: var(--radius-md); padding: 10px 12px; cursor: pointer; text-align: left; font: inherit; transition: border-color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard); }
.ad-opt:hover:not(:disabled) { border-color: var(--border-strong); background: var(--bg-hover); }
.ad-opt.on { border-color: var(--hue-blue); background: var(--row-selected); }
.ad-opt:disabled { cursor: not-allowed; background: var(--surface-card); }
.ad-opt .t { font-size: var(--fs-body); color: var(--text-primary); }
.ad-opt:disabled .t { color: var(--text-disabled); }
.ad-opt .s { font-size: var(--fs-label); color: var(--text-secondary); font-family: var(--font-sans); }
.ad-opt .lk { font-size: var(--fs-label); color: var(--caution-text); overflow-wrap: anywhere; }
.ad-note { margin: 0; padding: 8px 12px; border-radius: var(--radius-md); background: var(--info-soft); font-size: var(--fs-label); color: var(--text-primary); }
.ad-sibs { display: flex; flex-direction: column; gap: 6px; }
.ad-sibs .lab { font-size: var(--fs-label); color: var(--text-muted); }
.ad-ck { display: flex; align-items: flex-start; gap: 8px; font-size: var(--fs-label); color: var(--text-secondary); cursor: pointer; overflow-wrap: anywhere; }
.ad-ck input { margin-top: 2px; flex: 0 0 auto; }
.ad-err { margin: 0; min-height: 18px; line-height: 18px; font-size: var(--fs-label); color: var(--hue-red); overflow-wrap: anywhere; }
</style>
