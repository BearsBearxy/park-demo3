<script setup lang="ts">
// 右抽屉「新增记账」— 1:1 from screen-utilities.jsx UtDrawer(163-235),用共享 FPDrawer 壳。
// 记账月 + 所属月(年/月 select)+ 电费(用电量/单价)+ 水费(用水量/单价)+ 自动金额;
// 单价默认随 tab:office 0.8123/4.15、phase3 0.7965/3.85。校验:至少填用电量或用水量。
import { ref, computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import Button from '@/components/ds/Button.vue'
import type { OfficeRecordReq } from '@/types/utilities'

const props = defineProps<{
  no: number          // 13 office / 14 phase3
  name: string        // 「办公水电」/「三期水电」
  icon: string
  initYear: number
  years: number[]     // overview 年份范围
}>()
const emit = defineEmits<{ close: []; save: [req: OfficeRecordReq] }>()

const isOffice = props.no === 13

const acctY = ref(String(props.initYear))
const acctM = ref('1')
const belongY = ref(String(props.initYear))
const belongM = ref('1')
const elecQty = ref('')
const elecPrice = ref(isOffice ? '0.8123' : '0.7965')
const waterQty = ref('')
const waterPrice = ref(isOffice ? '4.15' : '3.85')
const note = ref('')

const months = Array.from({ length: 12 }, (_, i) => String(i + 1))

const num = (v: string) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }
const elecAmt = computed(() => num(elecQty.value) * num(elecPrice.value))
const waterAmt = computed(() => num(waterQty.value) * num(waterPrice.value))
// 至少填一组量(jsx 176)
const valid = computed(() => !!elecQty.value || !!waterQty.value)

const yuan = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function save() {
  if (!valid.value) return
  emit('save', {
    scheduleNo: props.no,
    acctMonth: acctY.value + '-' + acctM.value.padStart(2, '0'),
    belongMonth: belongY.value + '-' + belongM.value.padStart(2, '0'),
    elecQty: num(elecQty.value),
    elecPrice: num(elecPrice.value),
    waterQty: num(waterQty.value),
    waterPrice: num(waterPrice.value),
    note: note.value.trim() || null,
  })
}
</script>

<template>
  <FPDrawer
    :open="true"
    :title="'新增记账 · ' + name"
    subtitle="登记某月用电量、用水量与基准单价,金额自动计算并归入对应年份"
    :icon="icon"
    :width="460"
    @close="emit('close')"
  >
    <!-- 记账月 + 所属月 -->
    <div class="ut-frow">
      <div class="ut-fgrp">
        <span class="ut-flabel">月份（记账）</span>
        <div class="ut-frow">
          <select class="ut-select" v-model="acctY"><option v-for="y in years" :key="y" :value="String(y)">{{ y }}年</option></select>
          <select class="ut-select" v-model="acctM"><option v-for="m in months" :key="m" :value="m">{{ m }}月</option></select>
        </div>
      </div>
      <div class="ut-fgrp">
        <span class="ut-flabel">所属月份</span>
        <div class="ut-frow">
          <select class="ut-select" v-model="belongY"><option v-for="y in years" :key="y" :value="String(y)">{{ y }}年</option></select>
          <select class="ut-select" v-model="belongM"><option v-for="m in months" :key="m" :value="m">{{ m }}月</option></select>
        </div>
      </div>
    </div>

    <!-- 电费 -->
    <div class="ut-fgrp">
      <span class="ut-flabel"><span class="dot" style="background:var(--hue-blue)"></span>电费</span>
      <div class="ut-frow">
        <input class="ut-input mono" inputmode="decimal" placeholder="用电量 千瓦" v-model="elecQty" />
        <input class="ut-input mono" inputmode="decimal" placeholder="基准单价 元/千瓦" v-model="elecPrice" />
      </div>
    </div>

    <!-- 水费 -->
    <div class="ut-fgrp">
      <span class="ut-flabel"><span class="dot" style="background:var(--hue-cyan)"></span>水费</span>
      <div class="ut-frow">
        <input class="ut-input mono" inputmode="decimal" placeholder="用水量 吨" v-model="waterQty" />
        <input class="ut-input mono" inputmode="decimal" placeholder="基准单价 元/吨" v-model="waterPrice" />
      </div>
    </div>

    <!-- 备注 -->
    <div class="ut-fgrp">
      <span class="ut-flabel">备注</span>
      <input class="ut-input" placeholder="选填" v-model="note" />
    </div>

    <!-- 自动金额 -->
    <div class="ut-fgrp">
      <span class="ut-flabel">金额（自动计算）</span>
      <div class="ut-sub2">
        <div><div class="k">电费金额</div><div class="v">¥{{ yuan(elecAmt) }}</div></div>
        <div><div class="k">水费金额</div><div class="v">¥{{ yuan(waterAmt) }}</div></div>
        <div><div class="k">水电费合计</div><div class="v">¥{{ yuan(elecAmt + waterAmt) }}</div></div>
      </div>
      <span class="ut-hint">填入用电量 / 用水量后,金额随之实时更新</span>
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
/* 1:1 from screen-utilities.jsx UtStyles(.ut-fgrp / .ut-input / .ut-sub2 段,105-116) */
.ut-fgrp { display:flex; flex-direction:column; gap:7px; }
.ut-flabel { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); display:flex; align-items:center; gap:6px; }
.ut-flabel .dot { width:8px; height:8px; border-radius:50%; }
.ut-frow { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.ut-input, .ut-select { height:38px; width:100%; box-sizing:border-box; border:1px solid var(--border-subtle); border-radius:8px; padding:0 12px; font-family:var(--font-sans); font-size:13.5px; color:var(--text-primary); background:var(--surface-white); outline:none; transition:border-color var(--dur-fast); }
.ut-input.mono { font-family:var(--font-mono); text-align:right; }
.ut-input:focus, .ut-select:focus { border-color:var(--border-strong); }
.ut-input::placeholder { color:var(--text-disabled); }
.ut-sub2 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; padding:13px 14px; background:var(--surface-card); border-radius:var(--radius-md); }
.ut-sub2 .k { font-size:11px; color:var(--text-muted); }
.ut-sub2 .v { font-size:14px; font-weight:var(--fw-semibold); font-family:var(--font-mono); margin-top:2px; color:var(--text-primary); }
.ut-hint { font-size:11px; color:var(--text-muted); }
</style>
