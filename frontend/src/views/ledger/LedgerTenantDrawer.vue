<script setup lang="ts">
// ③ 租户明细抽屉 — 1:1 from screen-ledger.jsx drawer branch (669-715).
// 数据用②已加载的行(无额外请求)。
import { computed, ref } from 'vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPStat from '@/components/fp/FPStat.vue'
import FPSectionLabel from '@/components/fp/FPSectionLabel.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import type { FPTenantOption } from '@/components/fp/fpTenantPicker'
import Button from '@/components/ds/Button.vue'
import { lgColumns } from '@/utils/ledgerColumns'
import { toLedgerColumns } from '@/utils/bookTemplate'
import type { ArchivedCol, Book } from '@/types/book'
import type { LedgerRowDTO } from '@/types/ledger'

const props = defineProps<{
  row: LedgerRowDTO | null
  /** 当前账册(模板驱动费用分组;缺省回退静态 lgColumns) */
  book?: Book | null
  companyName: string
  year: number
  monthNo: number
  prevMonth: number
  /** 本月归档列(spec §2):有钱但模板不渲染的自定义列,同样进费用明细,否则明细之和对不上应收合计 */
  archived?: ArchivedCol[]
  /** 绑定候选(全部档案,退租户带标注);行级绑定字段有它才渲染选择器 */
  tenants?: FPTenantOption[]
  /** 编辑模式 + entry:edit 才能绑/解/换(EDIT-MODE §1:浏览态只显示状态) */
  canBind?: boolean
  /** 行级绑定动作(抄表 commitTenant 同款:选中即提交,失败由父层回滚提示) */
  onBind?: (rowId: number, tenantId: number | null, addAlias?: boolean) => Promise<void>
  /** 行级改账面名(抄表「企业名称原文」同款:change 即提交;未绑定行改对名字自动配档) */
  onRename?: (rowId: number, tenantName: string) => Promise<void>
}>()
const emit = defineEmits<{ close: [] }>()

// 勾了才把账面名记进租户别名(默认关);每次提交后复位,不跨行残留
const rememberName = ref(false)
// 绑定中防重(评审A4同款:锁住整个请求在途期)
const binding = ref(false)
const boundName = computed(() =>
  props.row?.tenantId != null
    ? props.tenants?.find(t => t.id === props.row!.tenantId)?.name ?? `#${props.row!.tenantId}`
    : null)
async function commitBind(tenantId: number | null) {
  const r = props.row
  if (!r || r.id == null || !props.onBind || binding.value) return
  if (tenantId === r.tenantId) return
  binding.value = true
  // 只有"绑上去"才谈得上记名字;解绑不记
  try { await props.onBind(r.id, tenantId, tenantId != null && rememberName.value) }
  finally { binding.value = false; rememberName.value = false }
}
async function commitRename(e: Event) {
  const r = props.row
  const v = (e.target as HTMLInputElement).value.trim()
  if (!r || r.id == null || !props.onRename || binding.value) return
  if (!v || v === r.tenantName) { (e.target as HTMLInputElement).value = r.tenantName; return }
  binding.value = true
  try { await props.onRename(r.id, v) } finally { binding.value = false }
}

// jsx lgFmt: 0/empty → "" (drawer shows "0.00" fallback, jsx 681-683)
function lgFmt(v: number | null | undefined): string {
  if (v == null || v === 0) return ''
  return Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
const fmt0 = (v: number | null | undefined) => lgFmt(v) || '0.00'

const groups = computed(() =>
  (props.book ? toLedgerColumns(props.book.definition, props.prevMonth, props.archived) : lgColumns(props.prevMonth)).groups)

// 仅非零费用,按组分组并算组内小计 (jsx 693-705)
const feeGroups = computed(() => {
  const r = props.row
  if (!r) return []
  return groups.value
    .map(g => {
      const items = g.cols.filter(c => Number((r as any)[c.key]) > 0)
      const gsum = items.reduce((s, c) => s + Number((r as any)[c.key]), 0)
      return { name: g.name, items, gsum }
    })
    .filter(g => g.items.length > 0)
})
const hasFees = computed(() => feeGroups.value.length > 0)

const balTone = computed(() => {
  const b = props.row?.balanceEnd ?? 0
  return b < 0 ? 'var(--hue-red)' : b > 0 ? 'var(--hue-orange)' : 'var(--text-primary)'
})
</script>

<template>
  <FPDrawer
    :open="!!row"
    :title="row?.tenantName ?? ''"
    :subtitle="`${year} 年 ${monthNo} 月 · ${companyName} · 租户台账明细`"
    icon="user"
    :width="560"
    @close="emit('close')"
  >
    <template v-if="row">
      <!-- 3 stat: 应收 / 收款 / 结余(结余正橙负红)jsx 680-684 -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
        <FPStat label="应收合计" :value="fmt0(row.totalReceivable)" tint="blue" />
        <FPStat label="本月收款" :value="fmt0(row.totalCollected)" tint="slate" />
        <div :style="{ background: 'var(--surface-card)', borderRadius: 'var(--radius-lg)', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }">
          <span style="font-size:var(--fs-micro);color:var(--text-muted);white-space:nowrap">本月结余</span>
          <span :style="{ fontSize: '19px', fontWeight: 'var(--fw-semibold)', fontFamily: 'var(--font-mono)', lineHeight: '1.1', color: balTone }">{{ fmt0(row.balanceEnd) }}</span>
        </div>
      </div>

      <!-- 租户绑定(抄表屏「表档案」同款动线:账面名/绑定都在这里改,表格不做行内编辑) -->
      <div>
        <FPSectionLabel icon="git-compare">租户绑定</FPSectionLabel>
        <div class="lg-dw-fld">
          <label>账面名(导入原文,与档案名可不一致)</label>
          <input v-if="canBind" class="lg-dw-in" type="text" :value="row.tenantName"
                 :disabled="binding" title="回车/失焦保存;未绑定行改对名字会自动配档"
                 @change="commitRename" />
          <span v-else>{{ row.tenantName }}</span>
        </div>
        <div v-if="canBind && tenants" class="lg-dw-bind">
          <FPTenantPicker
            :tenants="tenants"
            :model-value="row.tenantId"
            :disabled="binding"
            :placeholder="row.tenantId == null ? '选择租户档案(绑定后参与按租户汇总/核对)' : undefined"
            @update:model-value="commitBind($event)"
          />
          <Button v-if="row.tenantId != null" size="sm" variant="ghost" :disabled="binding"
                  @click="commitBind(null)">解绑</Button>
        </div>
        <!-- 默认不勾(2026-08-27 拍板):自动记会把源册的错别字固化成系统认可的写法。
             这一下点击就是让人分辨「老板名/曾用名」(该记)与「这次打错了」(该去改源册)。 -->
        <label v-if="canBind && tenants && row.tenantId == null" class="lg-dw-remember">
          <input type="checkbox" v-model="rememberName" :disabled="binding" />
          <span>今后源册里写「{{ row.tenantName }}」都认到所选租户
            <em>会写入该租户别名,影响所有公司、所有月份的导入</em>
          </span>
        </label>
        <div v-else class="lg-dw-bind-ro">
          <template v-if="row.tenantId != null">
            已绑定:<b>{{ boundName ?? '…' }}</b>
            <span v-if="boundName && boundName !== row.tenantName" class="hint">(账面名「{{ row.tenantName }}」保持不变)</span>
          </template>
          <template v-else>
            <span class="unb">未绑定</span> 账面名未挂到租户档案 —— 进入「编辑」模式后可在此绑定
          </template>
        </div>
      </div>

      <!-- 结转:上月结余 jsx 686-689 -->
      <div>
        <FPSectionLabel icon="corner-down-right">结转</FPSectionLabel>
        <div class="lg-dw-row"><span class="fee">{{ prevMonth }} 月结余</span><span class="amt">{{ fmt0(row.balancePrev) }}</span></div>
      </div>

      <!-- 费用分组(仅非零,按组 + 组内小计)jsx 693-705 -->
      <div v-if="!hasFees" class="lg-dw-empty">该租户在 {{ companyName }} 暂无费用记账</div>
      <div v-for="g in feeGroups" :key="g.name">
        <div class="lg-dw-gt"><span>{{ g.name }}</span><b>{{ lgFmt(g.gsum) }}</b></div>
        <div v-for="c in g.items" :key="c.key" class="lg-dw-row">
          <span class="fee">{{ c.label }}</span><span class="amt">{{ lgFmt((row as any)[c.key]) }}</span>
        </div>
      </div>

      <!-- 备注 jsx 706-711 -->
      <div v-if="row.note">
        <FPSectionLabel icon="sticky-note">备注</FPSectionLabel>
        <p style="margin:0;font-size:13px;color:var(--text-secondary);line-height:1.6">{{ row.note }}</p>
      </div>
    </template>
  </FPDrawer>
</template>

<style scoped>
.lg-dw-fld { display:flex; flex-direction:column; gap:5px; margin-bottom:10px; }
.lg-dw-fld label { font-size:11px; color:var(--text-muted); }
.lg-dw-fld span { font-size:13px; color:var(--text-primary); }
.lg-dw-in {
  height:32px; padding:0 10px; font-size:13px; color:var(--text-primary);
  background:var(--surface-page); border:1px solid var(--border-subtle);
  border-radius:var(--radius-sm); outline:none; width:100%;
}
.lg-dw-in:focus { border-color:var(--hue-blue); }
.lg-dw-bind { display:flex; align-items:center; gap:8px; }
.lg-dw-bind > :first-child { flex:1 1 auto; min-width:0; }
.lg-dw-bind-ro { font-size:12px; color:var(--text-secondary); line-height:1.6; }
.lg-dw-bind-ro b { color:var(--text-primary); }
.lg-dw-bind-ro .hint { color:var(--text-muted); }
.lg-dw-bind-ro .unb {
  display:inline-block; font-size:11px; font-weight:var(--fw-medium); line-height:1;
  padding:2px 6px; border-radius:var(--radius-full); margin-right:6px;
  color:var(--status-warning); border:1px solid var(--status-warning);
}
/* 1:1 from screen-ledger.jsx LgStyles 241-249 */
.lg-dw-empty { padding:40px 0; text-align:center; color:var(--text-disabled); font-size:13px; }
.lg-dw-gt { font-size:11.5px; font-weight:var(--fw-semibold); color:var(--text-muted); margin-bottom:8px; display:flex; align-items:center; justify-content:space-between; }
.lg-dw-gt b { color:var(--text-secondary); font-family:var(--font-mono); }
.lg-dw-row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:9px 0; border-bottom:1px solid var(--divider); font-size:12px; }
.lg-dw-row:last-child { border-bottom:none; }
.lg-dw-row .fee { color:var(--text-secondary); }
.lg-dw-row .amt { font-family:var(--font-mono); font-variant-numeric:tabular-nums; color:var(--text-primary); font-weight:var(--fw-medium); }
/* 记住账面名:默认不勾。说明文字压小压灰 —— 它是后果告知,不是招徕 */
.lg-dw-remember { display:flex; align-items:flex-start; gap:7px; margin-top:8px; cursor:pointer; font-size:var(--fs-label); color:var(--text-secondary); }
.lg-dw-remember input { margin-top:2px; flex:0 0 auto; accent-color:var(--hue-blue); cursor:pointer; }
.lg-dw-remember em { display:block; font-style:normal; font-size:var(--fs-micro); color:var(--text-disabled); margin-top:2px; }
</style>
