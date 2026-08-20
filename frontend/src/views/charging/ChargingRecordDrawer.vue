<script setup lang="ts">
// 右抽屉「新增记账」— 1:1 from screen-charging.jsx ChDrawer(155-231),用共享 FPDrawer 壳。
// 类别 chips(带色点) + 记账月(年/月) + 电量 + 手续费及服务费 / 充电成本 + 备注
// + 自动利润 + 校验(电量 + 至少一组金额);提交 chargingApi.create。
import { ref, computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import type { ChargingCatDTO, ChargingRecordReq } from '@/types/charging'

const props = defineProps<{
  no: number
  cats: ChargingCatDTO[]
  initCat: string   // 'all' | cat id
  initYear: number
  years: number[]   // overview 年份范围
}>()
const emit = defineEmits<{ close: []; save: [req: ChargingRecordReq] }>()

// cat.tint 名 → CSS var(对齐 jsx CH_TINT)
const TINT: Record<string, string> = {
  slate: 'var(--fill-slate)', blue: 'var(--fill-blue)', cyan: 'var(--fill-cyan)',
}
const tintOf = (t: string | null) => TINT[t ?? ''] ?? 'var(--fill-slate)'

// 类别:初值取当前筛选类别,'all' 退回首类(jsx 156)
const cat = ref(props.initCat === 'all' ? props.cats[0]?.catId ?? '' : props.initCat)
const acctY = ref(String(props.initYear))
const acctM = ref('1')
const kwh = ref('')
const fee = ref('')
const cost = ref('')
const note = ref('')

const months = Array.from({ length: 12 }, (_, i) => String(i + 1))
const yearOpts = computed(() => props.years.map(y => ({ value: String(y), label: y + '年' })))
const monthOpts = months.map(m => ({ value: m, label: m + '月' }))

const num = (v: string) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
const profit = computed(() => num(fee.value) - num(cost.value))
// 电量 + 至少一组金额(jsx 166)
const valid = computed(() => !!kwh.value && (!!fee.value || !!cost.value))

const yuan = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function save() {
  if (!valid.value) return
  emit('save', {
    scheduleNo: props.no,
    cat: cat.value,
    acctMonth: acctY.value + '-' + acctM.value.padStart(2, '0'),
    kwh: num(kwh.value),
    fee: num(fee.value),
    cost: num(cost.value),
    note: note.value.trim() || null,
  })
}
</script>

<template>
  <FPDrawer
    :open="true"
    title="新增记账"
    subtitle="登记某一充电桩类别的月度电量、手续费及服务费与成本,系统自动归入对应年份并计算利润"
    :icon="no === 8 ? 'bike' : 'car'"
    :width="440"
    @close="emit('close')"
  >
    <!-- 类别 chips -->
    <div class="ch-fgrp">
      <span class="ch-flabel">充电桩类别</span>
      <div class="ch-seg">
        <button
          v-for="c in cats"
          :key="c.catId"
          :class="['ch-chip', { on: cat === c.catId }]"
          @click="cat = c.catId"
        ><span class="ch-cdot" :style="{ background: tintOf(c.tint) }"></span>{{ c.short }}</button>
      </div>
    </div>

    <!-- 记账月(年 + 月) -->
    <div class="ch-fgrp">
      <span class="ch-flabel">记账月份</span>
      <div class="ch-frow">
        <Select :options="yearOpts" v-model="acctY" />
        <Select :options="monthOpts" v-model="acctM" />
      </div>
    </div>

    <!-- 电量 -->
    <div class="ch-fgrp">
      <span class="ch-flabel">充电电量（千瓦时）</span>
      <input class="ch-input mono" inputmode="decimal" placeholder="如 42000" v-model="kwh" />
    </div>

    <!-- 手续费及服务费 / 充电成本 -->
    <div class="ch-frow">
      <div class="ch-fgrp">
        <span class="ch-flabel">手续费及服务费（元）</span>
        <input class="ch-input mono" inputmode="decimal" placeholder="收入" v-model="fee" />
      </div>
      <div class="ch-fgrp">
        <span class="ch-flabel">充电成本（元）</span>
        <input class="ch-input mono" inputmode="decimal" placeholder="成本" v-model="cost" />
      </div>
    </div>

    <!-- 备注 -->
    <div class="ch-fgrp">
      <span class="ch-flabel">备注</span>
      <input class="ch-input" placeholder="选填" v-model="note" />
    </div>

    <!-- 自动利润 -->
    <div class="ch-fgrp">
      <span class="ch-flabel">利润（自动计算）</span>
      <div class="ch-sub2">
        <div>
          <div class="k">利润 = 手续费及服务费 − 充电成本</div>
          <div class="v" :style="{ color: profit < 0 ? 'var(--hue-red)' : 'var(--hue-blue)' }">¥{{ yuan(profit) }}</div>
        </div>
      </div>
      <span class="ch-hint">填入电量与金额后,利润随之实时更新</span>
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
/* 1:1 from screen-charging.jsx ChStyles(.ch-fgrp / .ch-chip / .ch-input 段,110-125) */
.ch-fgrp { display:flex; flex-direction:column; gap:7px; }
.ch-flabel { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); }
.ch-frow { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.ch-seg { display:flex; gap:6px; }
.ch-chip { flex:1; height:38px; border:1px solid var(--border-subtle); background:var(--surface-white); border-radius:8px; cursor:pointer; font-family:var(--font-sans); font-size:13px; color:var(--text-secondary); display:flex; align-items:center; justify-content:center; gap:6px; transition:all var(--dur-fast); }
.ch-chip:hover { background:var(--surface-card); }
.ch-chip.on { border-color:var(--ink-900); background:var(--ink-900); color:#fff; }
.ch-cdot { width:8px; height:8px; border-radius:50%; flex:0 0 auto; }
.ch-input { height:38px; width:100%; box-sizing:border-box; border:1px solid var(--border-subtle); border-radius:8px; padding:0 12px; font-family:var(--font-sans); font-size:var(--fs-body); color:var(--text-primary); background:var(--surface-white); outline:none; transition:border-color var(--dur-fast); }
.ch-input.mono { font-family:var(--font-mono); text-align:right; }
.ch-input:focus { border-color:var(--border-strong); }
.ch-input::placeholder { color:var(--text-disabled); }
.ch-sub2 { display:grid; grid-template-columns:1fr; gap:10px; padding:13px 14px; background:var(--surface-card); border-radius:var(--radius-md); }
.ch-sub2 .k { font-size:11px; color:var(--text-muted); }
.ch-sub2 .v { font-size:17px; font-weight:var(--fw-semibold); font-family:var(--font-mono); margin-top:2px; }
.ch-hint { font-size:11px; color:var(--text-muted); }
</style>
