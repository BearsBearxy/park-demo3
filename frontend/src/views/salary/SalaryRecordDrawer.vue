<script setup lang="ts">
// 右抽屉「新增工资」— 1:1 from screen-schedule12.jsx WDrawer(188-272),用共享 FPDrawer 壳。
// 月份 select + 姓名 + 职务 datalist + 分节录入(月工资大类7 / 补贴提成3 / 考勤2 / 代缴代扣3)
// + 备注 + 自动 合计/应发/实发(提交前本地预览,提交后后端权威派生);提交 salaryApi.create。
import { ref, computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import Button from '@/components/ds/Button.vue'
import type { SalaryRecordReq } from '@/types/salary'

const props = defineProps<{
  initYear: number
  initMonth: number
  years: number[]     // overview 年份范围
}>()
const emit = defineEmits<{ close: []; save: [req: SalaryRecordReq] }>()

const acctY = ref(String(props.initYear))
const acctM = ref(String(props.initMonth))
const name = ref('')
const role = ref('')
const f = ref({
  base: '', post: '', perf: '', attend: '', skill: '', edu: '', other: '',
  lunch: '', heat: '', commission: '',
  shouldDays: '22', leaveDays: '0',
  social: '', tax: '', otherDeduct: '',
  note: '',
})

const months = Array.from({ length: 12 }, (_, i) => String(i + 1))

const num = (v: string) => { const n = parseFloat(v); return isNaN(n) ? 0 : n }

// 本地预览派生(jsx wWageTotal/wGross/wNet):提交后由后端重算落库口径
const wageTotal = computed(() =>
  num(f.value.base) + num(f.value.post) + num(f.value.perf) + num(f.value.attend) +
  num(f.value.skill) + num(f.value.edu) + num(f.value.other))
const gross = computed(() => wageTotal.value + num(f.value.lunch) + num(f.value.heat) + num(f.value.commission))
const net = computed(() => gross.value - num(f.value.social) - num(f.value.tax) - num(f.value.otherDeduct))

const yuan = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// 校验(jsx 205):姓名 + (基本 或 岗位)
const valid = computed(() => !!name.value.trim() && (!!f.value.base || !!f.value.post))

function save() {
  if (!valid.value) return
  emit('save', {
    acctMonth: acctY.value + '-' + acctM.value.padStart(2, '0'),
    name: name.value.trim(),
    role: role.value.trim() || null,
    base: num(f.value.base), post: num(f.value.post), perf: num(f.value.perf), attend: num(f.value.attend),
    skill: num(f.value.skill), edu: num(f.value.edu), other: num(f.value.other),
    lunch: num(f.value.lunch), heat: num(f.value.heat), commission: num(f.value.commission),
    shouldDays: num(f.value.shouldDays), leaveDays: num(f.value.leaveDays),
    social: num(f.value.social), tax: num(f.value.tax), otherDeduct: num(f.value.otherDeduct),
    note: f.value.note.trim() || null,
  })
}
</script>

<template>
  <FPDrawer
    :open="true"
    title="新增工资记录"
    subtitle="登记一名员工某月工资,合计 / 应发 / 实发自动计算"
    icon="wallet"
    :width="500"
    @close="emit('close')"
  >
    <!-- 月份 / 姓名 / 职务 -->
    <div class="s12-frow3">
      <div class="s12-fgrp">
        <span class="s12-flabel">所属月份</span>
        <div class="s12-frow">
          <select class="s12-select" v-model="acctY"><option v-for="y in years" :key="y" :value="String(y)">{{ y }}年</option></select>
          <select class="s12-select" v-model="acctM"><option v-for="m in months" :key="m" :value="m">{{ m }}月</option></select>
        </div>
      </div>
      <div class="s12-fgrp">
        <span class="s12-flabel">姓名</span>
        <input class="s12-input" v-model="name" placeholder="如:张三" />
      </div>
      <div class="s12-fgrp">
        <span class="s12-flabel">职种/职务</span>
        <input class="s12-input" v-model="role" placeholder="如:运维工程师" list="s12-roles" />
        <datalist id="s12-roles">
          <option value="总经理"></option><option value="副总经理"></option><option value="财务主管"></option>
          <option value="招商经理"></option><option value="招商专员"></option><option value="物业主管"></option>
          <option value="运维工程师"></option><option value="行政文员"></option><option value="安保队长"></option>
          <option value="保洁主管"></option>
        </datalist>
      </div>
    </div>

    <!-- 月工资大类 -->
    <div class="s12-sec">月工资大类</div>
    <div class="s12-frow3">
      <div class="s12-fgrp"><span class="s12-flabel">基本工资</span><input class="s12-input mono" inputmode="decimal" v-model="f.base" /></div>
      <div class="s12-fgrp"><span class="s12-flabel">岗位工资</span><input class="s12-input mono" inputmode="decimal" v-model="f.post" /></div>
      <div class="s12-fgrp"><span class="s12-flabel">绩效奖金</span><input class="s12-input mono" inputmode="decimal" v-model="f.perf" /></div>
      <div class="s12-fgrp"><span class="s12-flabel">全勤奖</span><input class="s12-input mono" inputmode="decimal" v-model="f.attend" /></div>
      <div class="s12-fgrp"><span class="s12-flabel">岗位技能津贴</span><input class="s12-input mono" inputmode="decimal" v-model="f.skill" /></div>
      <div class="s12-fgrp"><span class="s12-flabel">学历津贴</span><input class="s12-input mono" inputmode="decimal" v-model="f.edu" /></div>
      <div class="s12-fgrp"><span class="s12-flabel">其它津贴</span><input class="s12-input mono" inputmode="decimal" v-model="f.other" /></div>
    </div>

    <!-- 补贴 / 招商提成 -->
    <div class="s12-sec">补贴 / 招商提成</div>
    <div class="s12-frow3">
      <div class="s12-fgrp"><span class="s12-flabel">午餐补助</span><input class="s12-input mono" inputmode="decimal" v-model="f.lunch" /></div>
      <div class="s12-fgrp"><span class="s12-flabel">高温及其他</span><input class="s12-input mono" inputmode="decimal" v-model="f.heat" /></div>
      <div class="s12-fgrp"><span class="s12-flabel">招商提成</span><input class="s12-input mono" inputmode="decimal" v-model="f.commission" /></div>
    </div>

    <!-- 考勤 -->
    <div class="s12-sec">考勤</div>
    <div class="s12-frow">
      <div class="s12-fgrp"><span class="s12-flabel">应出勤(天)</span><input class="s12-input mono" inputmode="decimal" v-model="f.shouldDays" /></div>
      <div class="s12-fgrp"><span class="s12-flabel">请假(天)</span><input class="s12-input mono" inputmode="decimal" v-model="f.leaveDays" /></div>
    </div>

    <!-- 代缴代扣 -->
    <div class="s12-sec">代缴代扣</div>
    <div class="s12-frow3">
      <div class="s12-fgrp"><span class="s12-flabel">社保</span><input class="s12-input mono" inputmode="decimal" v-model="f.social" /></div>
      <div class="s12-fgrp"><span class="s12-flabel">上月个税</span><input class="s12-input mono" inputmode="decimal" v-model="f.tax" /></div>
      <div class="s12-fgrp"><span class="s12-flabel">其他</span><input class="s12-input mono" inputmode="decimal" v-model="f.otherDeduct" /></div>
    </div>

    <!-- 备注 -->
    <div class="s12-fgrp"><span class="s12-flabel">备注</span><input class="s12-input" v-model="f.note" placeholder="选填" /></div>

    <!-- 自动合计 -->
    <div class="s12-sub2">
      <div><div class="k">合计工资</div><div class="v">¥{{ yuan(wageTotal) }}</div></div>
      <div><div class="k">应发工资</div><div class="v">¥{{ yuan(gross) }}</div></div>
      <div><div class="k">实发金额</div><div class="v">¥{{ yuan(net) }}</div></div>
    </div>

    <template #footer>
      <Button variant="gray" @click="emit('close')">取消</Button>
      <Button variant="filled" :disabled="!valid" @click="save">
        <template #leading><component :is="iconFor('check')" :size="16" /></template>
        保存
      </Button>
    </template>
  </FPDrawer>
</template>

<style scoped>
/* 1:1 from screen-schedule12.jsx WStyles(.w12-fgrp / .w12-input / .w12-sub2 段,115-126) */
.s12-sec { font-size:11.5px; font-weight:var(--fw-semibold); color:var(--text-muted); letter-spacing:.02em; }
.s12-fgrp { display:flex; flex-direction:column; gap:6px; }
.s12-flabel { font-size:12px; font-weight:var(--fw-medium); color:var(--text-secondary); }
.s12-frow { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
.s12-frow3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; }
.s12-input, .s12-select { height:36px; width:100%; box-sizing:border-box; border:1px solid var(--border-subtle); border-radius:8px; padding:0 11px; font-family:var(--font-sans); font-size:13px; color:var(--text-primary); background:var(--surface-white); outline:none; transition:border-color var(--dur-fast); }
.s12-input.mono { font-family:var(--font-mono); text-align:right; }
.s12-input:focus, .s12-select:focus { border-color:var(--border-strong); }
.s12-input::placeholder { color:var(--text-disabled); }
.s12-sub2 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; padding:13px 14px; background:var(--surface-card); border-radius:var(--radius-md); }
.s12-sub2 .k { font-size:11px; color:var(--text-muted); }
.s12-sub2 .v { font-size:14px; font-weight:var(--fw-semibold); font-family:var(--font-mono); margin-top:2px; color:var(--text-primary); }
</style>
