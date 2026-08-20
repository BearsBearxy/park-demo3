<script setup lang="ts">
// 右抽屉「新增记账」— 1:1 from screen-schedule6.jsx S6Drawer(164-235),用共享 FPDrawer 壳。
// 期 chips + 记账月(年/月) + 发生月(年/月) + 自消纳(电量/金额) + 上网(电量/收益)
// + 自动总计 + 校验(至少一组电量 + 一组金额);提交 pvApi.create。
import { ref, computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import { phaseTint } from '@/components/sched/tints'
import type { PvPhaseDTO, PvRecordReq } from '@/types/pv'

const props = defineProps<{
  phases: PvPhaseDTO[]
  initPhase: string   // 'all' | phase id
  initYear: number
  years: number[]     // overview 年份范围
}>()
const emit = defineEmits<{ close: []; save: [req: PvRecordReq] }>()

// 期别:初值取当前筛选期,'all' 退回首期(jsx 166)
const phase = ref(props.initPhase === 'all' ? props.phases[0]?.id ?? '' : props.initPhase)
const acctY = ref(String(props.initYear))
const acctM = ref('1')
const occY = ref(String(props.initYear))
const occM = ref('12')
const sKwh = ref('')
const sAmt = ref('')
const gKwh = ref('')
const gAmt = ref('')

const months = Array.from({ length: 12 }, (_, i) => String(i + 1))
const yearOpts = computed(() => props.years.map(y => ({ value: String(y), label: y + '年' })))
const monthOpts = months.map(m => ({ value: m, label: m + '月' }))

const num = (v: string) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
const gen = computed(() => num(sKwh.value) + num(gKwh.value))
const fee = computed(() => num(sAmt.value) + num(gAmt.value))
// 至少一组电量 + 一组金额(jsx 177)
const valid = computed(() => (!!sKwh.value || !!gKwh.value) && (!!sAmt.value || !!gAmt.value))

const kwh = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
const yuan = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function save() {
  if (!valid.value) return
  emit('save', {
    phase: phase.value,
    acctMonth: acctY.value + '-' + acctM.value.padStart(2, '0'),
    occurMonth: occY.value + '-' + occM.value.padStart(2, '0'),
    selfKwh: num(sKwh.value),
    selfAmt: num(sAmt.value),
    gridKwh: num(gKwh.value),
    gridAmt: num(gAmt.value),
  })
}
</script>

<template>
  <FPDrawer
    :open="true"
    title="新增记账"
    subtitle="登记某一期光伏的月度发电与电费,系统自动归入对应年份"
    icon="sun"
    :width="440"
    @close="emit('close')"
  >
    <!-- 期别 chips -->
    <div class="s6-fgrp">
      <span class="s6-flabel">期别</span>
      <div class="s6-seg">
        <button
          v-for="(p, i) in phases"
          :key="p.id"
          :class="['s6-chip', { on: phase === p.id }]"
          @click="phase = p.id"
        ><span class="s6-cdot" :style="{ background: phaseTint(i) }"></span>{{ p.short }}</button>
      </div>
    </div>

    <!-- 记账月 / 发生月(年 + 月) -->
    <div class="s6-frow">
      <div class="s6-fgrp">
        <span class="s6-flabel">记账月份</span>
        <div class="s6-frow">
          <Select :options="yearOpts" v-model="acctY" />
          <Select :options="monthOpts" v-model="acctM" />
        </div>
      </div>
      <div class="s6-fgrp">
        <span class="s6-flabel">发生月份</span>
        <div class="s6-frow">
          <Select :options="yearOpts" v-model="occY" />
          <Select :options="monthOpts" v-model="occM" />
        </div>
      </div>
    </div>

    <!-- 自消纳 -->
    <div class="s6-fgrp">
      <span class="s6-flabel">自消纳（园区自用）</span>
      <div class="s6-frow">
        <input class="s6-input mono" inputmode="decimal" placeholder="电量 kWh" v-model="sKwh" />
        <input class="s6-input mono" inputmode="decimal" placeholder="金额 元" v-model="sAmt" />
      </div>
    </div>

    <!-- 余电上网 -->
    <div class="s6-fgrp">
      <span class="s6-flabel">余电上网</span>
      <div class="s6-frow">
        <input class="s6-input mono" inputmode="decimal" placeholder="电量 kWh" v-model="gKwh" />
        <input class="s6-input mono" inputmode="decimal" placeholder="收益 元" v-model="gAmt" />
      </div>
    </div>

    <!-- 自动总计 -->
    <div class="s6-fgrp">
      <span class="s6-flabel">合计（自动计算）</span>
      <div class="s6-sub2">
        <div><div class="k">光伏发电总量</div><div class="v">{{ kwh(gen) }} <span class="u">kWh</span></div></div>
        <div><div class="k">发电电费总额</div><div class="v">¥{{ yuan(fee) }}</div></div>
      </div>
      <span class="s6-hint">发电总量 = 自消纳电量 + 上网电量;电费总额 = 自消纳金额 + 上网收益</span>
    </div>

    <template #footer>
      <Button variant="gray" @click="emit('close')">取消</Button>
      <Button variant="filled" :disabled="!valid" @click="save">
        <template #leading><component :is="iconFor('check')" :size="16" /></template>
        保存记账
      </Button>
    </template>
  </FPDrawer>
</template>

<style scoped>
/* 1:1 from screen-schedule6.jsx S6Styles(.s6-fgrp / .s6-chip / .s6-input 段,116-132) */
.s6-fgrp { display:flex; flex-direction:column; gap:7px; }
.s6-flabel { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); }
.s6-frow { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.s6-seg { display:flex; gap:6px; }
.s6-chip { flex:1; height:38px; border:1px solid var(--border-subtle); background:var(--surface-white); border-radius:8px; cursor:pointer; font-family:var(--font-sans); font-size:13px; color:var(--text-secondary); display:flex; align-items:center; justify-content:center; gap:6px; transition:all var(--dur-fast); }
.s6-chip:hover { background:var(--surface-card); }
.s6-chip.on { border-color:var(--ink-900); background:var(--ink-900); color:#fff; }
.s6-cdot { width:8px; height:8px; border-radius:50%; flex:0 0 auto; }
.s6-input { height:38px; width:100%; box-sizing:border-box; border:1px solid var(--border-subtle); border-radius:8px; padding:0 12px; font-family:var(--font-sans); font-size:var(--fs-body); color:var(--text-primary); background:var(--surface-white); outline:none; transition:border-color var(--dur-fast); }
.s6-input.mono { font-family:var(--font-mono); text-align:right; }
.s6-input:focus { border-color:var(--border-strong); }
.s6-input::placeholder { color:var(--text-disabled); }
.s6-sub2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:13px 14px; background:var(--surface-card); border-radius:var(--radius-md); }
.s6-sub2 .k { font-size:11px; color:var(--text-muted); }
.s6-sub2 .v { font-size:15px; font-weight:var(--fw-semibold); font-family:var(--font-mono); color:var(--text-primary); margin-top:2px; }
.s6-sub2 .v .u { font-size:11px; color:var(--text-muted); font-family:var(--font-sans); }
.s6-hint { font-size:11px; color:var(--text-muted); }
</style>
