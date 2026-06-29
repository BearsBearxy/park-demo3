<script setup lang="ts">
// 右抽屉「新增电费记账」— 1:1 from screen-schedule11.jsx EDrawer(174-280),用共享 FPDrawer 壳。
// type chips(energy/basic) + 期 chips(色点) + 记账月 + 开票日期 date
// + 〔energy:时段/类别/电量/单价/税率〕〔basic:需量/单价/税率〕 + 自动 金额/税额/价税合计。
// 校验:price>0 且(energy:qty>0 / basic:demand>0)。提交 elecApi.create。
import { ref, computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import Button from '@/components/ds/Button.vue'
import { phaseTint } from '@/components/sched/tints'
import type { ElecPhaseDTO, ElecRecordReq } from '@/types/elec'

const props = defineProps<{
  phases: ElecPhaseDTO[]
  initType: 'energy' | 'basic'
  initYear: number
  years: number[]     // overview 年份范围
}>()
const emit = defineEmits<{ close: []; save: [req: ElecRecordReq] }>()

const PERIODS = ['峰', '平', '谷']
const CATS = ['大工业用电', '一般工商业', '居民生活', '商业']
const DEFAULT_RATE = '0.13'   // jsx D.rate

const type = ref<'energy' | 'basic'>(props.initType)
const phase = ref(props.phases[0]?.id ?? '')
const acctY = ref(String(props.initYear))
const acctM = ref('1')
const invDate = ref('')
const period = ref('峰')
const cat = ref('大工业用电')
const qty = ref('')
const price = ref('')
const demand = ref('')
const rate = ref(DEFAULT_RATE)

const months = Array.from({ length: 12 }, (_, i) => String(i + 1))

const num = (v: string) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
const fee = computed(() => type.value === 'energy' ? num(qty.value) * num(price.value) : num(demand.value) * num(price.value))
const tax = computed(() => fee.value * num(rate.value))
// jsx 191:price>0 且(energy:qty>0 / basic:demand>0)
const valid = computed(() => num(price.value) > 0 && (type.value === 'energy' ? num(qty.value) > 0 : num(demand.value) > 0))

const eNum = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function save() {
  if (!valid.value) return
  const acct = acctY.value + '-' + acctM.value.padStart(2, '0')
  const base = {
    type: type.value,
    phase: phase.value,
    acctMonth: acct,
    invDate: invDate.value || null,
    price: num(price.value),
    rate: num(rate.value),
  }
  emit('save', type.value === 'energy'
    ? { ...base, period: period.value, cat: cat.value, unit: '度', qty: num(qty.value) }
    : { ...base, demand: num(demand.value) })
}
</script>

<template>
  <FPDrawer
    :open="true"
    title="新增电费记账"
    subtitle="登记一条对外电费进项,金额、税额与价税合计自动计算"
    icon="zap"
    :width="480"
    @close="emit('close')"
  >
    <!-- 费用类型 chips -->
    <div class="e11-fgrp">
      <span class="e11-flabel">费用类型</span>
      <div class="e11-seg">
        <button :class="['e11-chip', { on: type === 'energy' }]" @click="type = 'energy'">电量电费（进项）</button>
        <button :class="['e11-chip', { on: type === 'basic' }]" @click="type = 'basic'">基本电费</button>
      </div>
    </div>

    <!-- 期别 chips(色点) -->
    <div class="e11-fgrp">
      <span class="e11-flabel">期别</span>
      <div class="e11-seg">
        <button
          v-for="(p, i) in phases"
          :key="p.id"
          :class="['e11-chip', { on: phase === p.id }]"
          @click="phase = p.id"
        ><span class="e11-cdot" :style="{ background: phaseTint(i) }"></span>{{ p.short }}</button>
      </div>
    </div>

    <!-- 记账月 + 开票日期 -->
    <div class="e11-frow">
      <div class="e11-fgrp">
        <span class="e11-flabel">记账月份</span>
        <div class="e11-frow">
          <select class="e11-select" v-model="acctY"><option v-for="y in years" :key="y" :value="String(y)">{{ y }}年</option></select>
          <select class="e11-select" v-model="acctM"><option v-for="m in months" :key="m" :value="m">{{ m }}月</option></select>
        </div>
      </div>
      <div class="e11-fgrp">
        <span class="e11-flabel">开票日期</span>
        <input class="e11-input" type="date" v-model="invDate" />
      </div>
    </div>

    <!-- energy:时段 / 类别 / 电量·单价·税率 -->
    <template v-if="type === 'energy'">
      <div class="e11-frow">
        <div class="e11-fgrp">
          <span class="e11-flabel">用电时段</span>
          <select class="e11-select" v-model="period"><option v-for="p in PERIODS" :key="p" :value="p">{{ p }}</option></select>
        </div>
        <div class="e11-fgrp">
          <span class="e11-flabel">用电类别</span>
          <select class="e11-select" v-model="cat"><option v-for="c in CATS" :key="c" :value="c">{{ c }}</option></select>
        </div>
      </div>
      <div class="e11-frow3">
        <div class="e11-fgrp"><span class="e11-flabel">电量(度)</span><input class="e11-input mono" inputmode="decimal" placeholder="kWh" v-model="qty" /></div>
        <div class="e11-fgrp"><span class="e11-flabel">不含税单价</span><input class="e11-input mono" inputmode="decimal" placeholder="元/度" v-model="price" /></div>
        <div class="e11-fgrp"><span class="e11-flabel">税率</span><input class="e11-input mono" inputmode="decimal" v-model="rate" /></div>
      </div>
    </template>

    <!-- basic:需量·单价·税率 -->
    <div v-else class="e11-frow3">
      <div class="e11-fgrp"><span class="e11-flabel">计费需量(kVA)</span><input class="e11-input mono" inputmode="decimal" placeholder="kVA" v-model="demand" /></div>
      <div class="e11-fgrp"><span class="e11-flabel">单价</span><input class="e11-input mono" inputmode="decimal" placeholder="元/kVA·月" v-model="price" /></div>
      <div class="e11-fgrp"><span class="e11-flabel">税率</span><input class="e11-input mono" inputmode="decimal" v-model="rate" /></div>
    </div>

    <!-- 自动金额 -->
    <div class="e11-fgrp">
      <span class="e11-flabel">金额（自动计算）</span>
      <div class="e11-sub2">
        <div><div class="k">{{ type === 'energy' ? '不含税金额' : '基本用电费' }}</div><div class="v">¥{{ eNum(fee) }}</div></div>
        <div><div class="k">税额</div><div class="v">¥{{ eNum(tax) }}</div></div>
        <div><div class="k">价税合计</div><div class="v">¥{{ eNum(fee + tax) }}</div></div>
      </div>
      <span class="e11-hint">{{ type === 'energy' ? '不含税金额 = 电量 × 不含税单价' : '基本用电费 = 计费需量 × 单价' }};价税合计 = 金额 + 金额 × 税率</span>
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
/* 1:1 from screen-schedule11.jsx EStyles(.e11-fgrp / .e11-chip / .e11-input 段,112-128) */
.e11-fgrp { display:flex; flex-direction:column; gap:7px; }
.e11-flabel { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); }
.e11-frow { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.e11-frow3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; }
.e11-seg { display:flex; gap:6px; }
.e11-chip { flex:1; height:38px; border:1px solid var(--border-subtle); background:var(--surface-white); border-radius:8px; cursor:pointer; font-family:var(--font-sans); font-size:13px; color:var(--text-secondary); display:flex; align-items:center; justify-content:center; gap:6px; transition:all var(--dur-fast); }
.e11-chip:hover { background:var(--surface-card); }
.e11-chip.on { border-color:var(--ink-900); background:var(--ink-900); color:#fff; }
.e11-cdot { width:8px; height:8px; border-radius:50%; flex:0 0 auto; }
.e11-input, .e11-select { height:38px; width:100%; box-sizing:border-box; border:1px solid var(--border-subtle); border-radius:8px; padding:0 12px; font-family:var(--font-sans); font-size:13.5px; color:var(--text-primary); background:var(--surface-white); outline:none; transition:border-color var(--dur-fast); }
.e11-input.mono { font-family:var(--font-mono); text-align:right; }
.e11-input:focus, .e11-select:focus { border-color:var(--border-strong); }
.e11-input::placeholder { color:var(--text-disabled); }
.e11-sub2 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; padding:13px 14px; background:var(--surface-card); border-radius:var(--radius-md); }
.e11-sub2 .k { font-size:11px; color:var(--text-muted); }
.e11-sub2 .v { font-size:14px; font-weight:var(--fw-semibold); font-family:var(--font-mono); margin-top:2px; color:var(--text-primary); }
.e11-hint { font-size:11px; color:var(--text-disabled); }
</style>
