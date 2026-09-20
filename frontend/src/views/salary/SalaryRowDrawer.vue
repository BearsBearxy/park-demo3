<script setup lang="ts">
// S 档卡片的「点开抽屉看整行」(RESPONSIVE-LAYOUT-SPEC §5.3 逐字:「一行一张卡,
// 卡上 3–4 个关键字段,点开抽屉看整行」)。只读。
//
// 为什么不是复用 SalaryRecordDrawer:那个是**空白新增表单**(标题「新增工资记录」,
// props 只有 initYear/initMonth/years,emit 的是一条 SalaryRecordReq),它显示不了一条
// 已有行 —— 点张三的卡弹出一张空表是错的,不是省事。桌面点行本来就没有任何行为,
// 所以这条动线在宽档不存在,只给 S 档补上被卡片挡掉的那 14 根列。
//
// 分组与次序逐字照 SalaryTable 的两级表头:同一行在表里和抽屉里读到的是同一个次序。
import { computed } from 'vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import { finMoney } from '@/utils/finFmt'
import type { SalaryRecordDTO } from '@/types/salary'

const props = defineProps<{ row: SalaryRecordDTO }>()
defineEmits<{ close: [] }>()

const groups = computed(() => {
  const r = props.row
  return [
    { t: '月工资大类', items: [
      ['基本', finMoney(r.base)], ['岗位', finMoney(r.post)], ['绩效奖金', finMoney(r.perf)],
      ['全勤奖', finMoney(r.attend)], ['技能津贴', finMoney(r.skill)], ['学历津贴', finMoney(r.edu)],
      ['其它津贴', finMoney(r.other)], ['合计工资', finMoney(r.wageTotal)],
    ] },
    { t: '补贴 / 招商提成', items: [
      ['午餐补助', finMoney(r.lunch)], ['高温及其他', finMoney(r.heat)], ['招商提成', finMoney(r.commission)],
    ] },
    // 考勤是天数不是钱,不走 finMoney;「全勤 / 非全勤」是后端派生列 fullAttend 的既有表内说法
    { t: '考勤', items: [
      ['应出勤', `${r.shouldDays} 天`], ['请假', `${r.leaveDays} 天`],
      ['实出勤', `${r.actualDays} 天`], ['全勤考核', r.fullAttend ? '全勤' : '非全勤'],
    ] },
    { t: '代缴代扣', items: [
      ['社保', finMoney(r.social)], ['上月个税', finMoney(r.tax)],
      ['其他', finMoney(r.otherDeduct)], ['合计扣款', finMoney(r.deduct)],
    ] },
  ]
})
</script>

<template>
  <FPDrawer
    :open="true"
    :title="row.name"
    :subtitle="`${row.acctMonth} · ${row.role || '职种/职务未填'}`"
    icon="wallet"
    :width="460"
    @close="$emit('close')"
  >
    <!-- 卡上那两个数在抽屉顶部复述一遍:从卡片过来的人不用再找 -->
    <div class="s12-rd-top">
      <div><div class="k">应发工资</div><div class="v">{{ finMoney(row.gross) }}</div></div>
      <div><div class="k">实发金额</div><div class="v">{{ finMoney(row.net) }}</div></div>
      <div><div class="k">签收</div><div class="v sm">{{ row.sign ? '已签' : '待签' }}</div></div>
    </div>

    <div v-for="g in groups" :key="g.t" class="s12-rd-grp">
      <div class="s12-rd-sec">{{ g.t }}</div>
      <dl class="s12-rd-dl">
        <template v-for="it in g.items" :key="it[0]">
          <dt>{{ it[0] }}</dt>
          <dd>{{ it[1] }}</dd>
        </template>
      </dl>
    </div>

    <div class="s12-rd-grp">
      <div class="s12-rd-sec">备注</div>
      <p class="s12-rd-note">{{ row.note || '—' }}</p>
    </div>
  </FPDrawer>
</template>

<style scoped>
.s12-rd-top { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; padding:13px 14px; background:var(--surface-card); border-radius:var(--radius-md); }
.s12-rd-top .k { font-size:11px; color:var(--text-muted); }
.s12-rd-top .v { margin-top:2px; font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-size:14px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.s12-rd-top .v.sm { font-family:var(--font-sans); }

.s12-rd-grp { display:flex; flex-direction:column; gap:6px; }
.s12-rd-sec { font-size:11px; font-weight:var(--fw-semibold); color:var(--text-muted); letter-spacing:.02em; }
.s12-rd-dl { display:grid; grid-template-columns:auto 1fr; gap:0; margin:0; }
.s12-rd-dl dt { padding:7px 0; font-size:12px; color:var(--text-secondary); border-bottom:1px solid var(--divider); }
.s12-rd-dl dd { padding:7px 0; margin:0; text-align:right; font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-size:12px; color:var(--text-primary); border-bottom:1px solid var(--divider); }
.s12-rd-note { margin:0; font-size:12px; color:var(--text-secondary); line-height:1.5; white-space:pre-wrap; }
</style>
