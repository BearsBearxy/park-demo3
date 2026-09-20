<script setup lang="ts">
// S 档卡片的「点开抽屉看整行」(RESPONSIVE-LAYOUT-SPEC §5.3 逐字:「一行一张卡,
// 卡上 3–4 个关键字段,点开抽屉看整行」)。只读。
//
// 为什么不是复用 ElecRecordDrawer:那个是**空白新增表单**(编辑态工具条的「新增记账」入口),
// 显示不了一条已有行。桌面点行本来就没有任何行为,所以这条动线在宽档不存在 ——
// 它只给 S 档补上被卡片挡掉的那几列:开票日期 / 时段 / 用电类别 / 不含税单价 / 税率 /
// 税额 / 价税合计 / 备注。不补的话卡上有 :active 反馈却什么都不发生,而那几列在手机上
// 彻底读不到(本屏没有「按表格查看」那条退路)。
//
// 字段次序逐字照 ElecTable 的表头:同一行在表里和抽屉里读到的是同一个次序。
import { computed } from 'vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import type { ElecRecordDTO } from '@/types/elec'

const props = defineProps<{ row: ElecRecordDTO }>()
defineEmits<{ close: [] }>()

// 表里的数字格式(ElecTable num()):千分位 + 两位小数,整数位可指定 0 位
const num = (v: number | null | undefined, d = 2) =>
  Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })
const dash = (v: string | null | undefined) => v || '—'

const energy = computed(() => props.row.type === 'energy')

const items = computed<[string, string][]>(() => {
  const r = props.row
  return [
    ['开票日期', dash(r.invDate)],
    ...(energy.value
      ? ([
          ['时段', dash(r.period)],
          ['用电类别', dash(r.cat)],
          ['电量', `${num(r.qty, 0)} 度`],
        ] as [string, string][])
      : ([['计费需量', `${num(r.demand, 0)} kVA`]] as [string, string][])),
    ['不含税单价', num(r.price, 4) + ' 元'],
    ['不含税金额', num(r.amount) + ' 元'],
    // 税率库里存的是小数(0.13),表头只写「税率」不带单位 —— 这里也照表里那个写法
    ['税率', num(r.rate * 100, 0) + '%'],
    ['税额', num(r.tax) + ' 元'],
    ['价税合计', num(r.total) + ' 元'],
  ]
})

// 来源徽标的措辞与表内 .e11-userbadge / .e11-importbadge 逐字一致,不另造说法
const sourceText = computed(() =>
  props.row.source === 'manual' ? '手动' : props.row.source === 'import' ? '导入' : '系统',
)
</script>

<template>
  <FPDrawer
    :open="true"
    :title="row.acctMonth + ' · ' + row.phaseName"
    :subtitle="(energy ? '电量电费' : '基本电费') + ' · 来源' + sourceText"
    icon="zap"
    :width="460"
    @close="$emit('close')"
  >
    <!-- 卡上那个数在抽屉顶部复述一遍:从卡片过来的人不用再找 -->
    <div class="e11-rd-top">
      <div><div class="k">价税合计</div><div class="v">{{ num(row.total) }}</div></div>
      <div><div class="k">不含税金额</div><div class="v">{{ num(row.amount) }}</div></div>
    </div>

    <dl class="e11-rd-dl">
      <template v-for="it in items" :key="it[0]">
        <dt>{{ it[0] }}</dt>
        <dd>{{ it[1] }}</dd>
      </template>
    </dl>

    <div class="e11-rd-grp">
      <div class="e11-rd-sec">备注</div>
      <p class="e11-rd-note">{{ row.note || '—' }}</p>
    </div>
  </FPDrawer>
</template>

<style scoped>
.e11-rd-top { display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:13px 14px; background:var(--surface-card); border-radius:var(--radius-md); }
.e11-rd-top .k { font-size:11px; color:var(--text-muted); }
.e11-rd-top .v { margin-top:2px; font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-size:14px; font-weight:var(--fw-semibold); color:var(--text-primary); }

.e11-rd-dl { display:grid; grid-template-columns:auto 1fr; gap:0; margin:0; }
.e11-rd-dl dt { padding:7px 0; font-size:12px; color:var(--text-secondary); border-bottom:1px solid var(--divider); }
.e11-rd-dl dd { padding:7px 0; margin:0; text-align:right; font-family:var(--font-mono); font-variant-numeric:tabular-nums; font-size:12px; color:var(--text-primary); border-bottom:1px solid var(--divider); }

.e11-rd-grp { display:flex; flex-direction:column; gap:6px; }
.e11-rd-sec { font-size:11px; font-weight:var(--fw-semibold); color:var(--text-muted); letter-spacing:.02em; }
.e11-rd-note { margin:0; font-size:12px; color:var(--text-secondary); line-height:1.5; white-space:pre-wrap; }
</style>
