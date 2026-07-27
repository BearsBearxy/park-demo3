<script setup lang="ts">
import { ref, computed, watch, onMounted, h } from 'vue'
import { contractApi } from '@/api/contract'
import { fpSortRows } from '@/components/fp/fpSort'
import type { SortState } from '@/components/fp/fpSort'
import type { ContractDTO, ContractSummaryDTO } from '@/types/contract'
import { fpMoney } from '@/utils/money'
import Button from '@/components/ds/Button.vue'
import Card from '@/components/ds/Card.vue'
import Avatar from '@/components/ds/Avatar.vue'
import Select from '@/components/ds/Select.vue'
import FPPhaseTabs from '@/components/fp/FPPhaseTabs.vue'
import FPSortableTable from '@/components/fp/FPSortableTable.vue'
import { useFitRows } from '@/components/fp/useFitRows'
import FPPager from '@/components/fp/FPPager.vue'
import FPContractStatus from '@/components/fp/FPContractStatus.vue'
import ContractDrawer from './ContractDrawer.vue'
import ContractNewDialog from './ContractNewDialog.vue'
import { leafIds, chainOf } from './chain'
import FpImportModal from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import { parserProps, runImport, type ImportCtx } from '@/utils/importRegistry'
import type { ImportResultDTO } from '@/types/import'
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'

// ─── state ───────────────────────────────────────────────
const contracts = ref<ContractDTO[]>([])
const summary = ref<ContractSummaryDTO | null>(null)
const statusFilter = ref('all')
const phase = ref('全部期数')
const q = ref('')
const activeOn = ref('')       // 某日在租筛选(§5.2):非空→后端 asOfDate 过滤
const showHistory = ref(false) // 含历史续签(§5.3):默认只显每链最新期(叶子)
const sort = ref<SortState | null>({ key: 'daysToEnd', dir: 'asc' })
const page = ref(1)
const tableWrapEl = ref<HTMLElement | null>(null)
const pageSize = useFitRows(tableWrapEl)   // 自适应每页行数:正好填满卡片,不滚动直接翻页
const openContract = ref<ContractDTO | null>(null)
const showNew = ref(false)
const editFrom = ref<ContractDTO | null>(null)
const renewFrom = ref<ContractDTO | null>(null)

async function reload() {
  ;[contracts.value, summary.value] = await Promise.all([contractApi.list(activeOn.value || undefined), contractApi.summary()])
}
onMounted(reload)
watch(activeOn, reload)   // 某日在租=后端过滤,切换即重拉

async function onCreated() {
  showNew.value = false
  await reload()
}

// 编辑/续签/终止成功:抽屉切换为返回的最新 DTO(watch 重拉 detail),列表+KPI 重拉
async function onEdited(dto: ContractDTO) {
  editFrom.value = null
  openContract.value = dto
  await reload()
}
async function onRenewed(dto: ContractDTO) {
  renewFrom.value = null
  openContract.value = dto
  await reload()
}
async function onTerminated(dto: ContractDTO) {
  openContract.value = dto
  await reload()
}
async function onDeleted() {
  openContract.value = null
  await reload()
}

// ─── phase filter ─────────────────────────────────────────
// ponytail: phaseName not in ContractDTO; we derive it inline from buildingName suffix heuristic
// matching the reference data pattern (建筑物名含"一期"/"二期"/"三期"/"宿舍")
function phaseOf(c: ContractDTO): string {
  if (c.buildingName.includes('一期')) return '一期'
  if (c.buildingName.includes('二期')) return '二期'
  if (c.buildingName.includes('三期')) return '三期'
  if (c.buildingName.includes('宿舍')) return '宿舍'
  return ''
}

// ─── lifecycle tabs ───────────────────────────────────────
// 合同生命周期标签集,经 FPPhaseTabs :tabs 传入(spec §2:禁止复制样式另建 tab 组件;
// 原 ContractLifecycleTabs.vue 样式复制品已删,常量收编于此)
const LIFECYCLE = [
  { k: 'all',        label: '全部' },
  { k: 'draft',      label: '草稿' },
  { k: 'active',     label: '执行中' },
  { k: 'expiring',   label: '即将到期' },
  { k: 'expired',    label: '已到期' },
  { k: 'terminated', label: '已终止' },
  { k: 'renewed',    label: '已续签' },   // 被新一期取代的旧期:非叶子,勾选"含历史续签"后才有行
]

// ─── 续签链聚合(§5.3):默认每链只显叶子(最新一期);含历史/某日在租时显全量 ──────
const leaves = computed(() => leafIds(contracts.value))
// 有上一期(parentContractId 非空)的合同 id → 列表内标"续"徽标,点开抽屉看历史
const hasHistoryIds = computed(() =>
  new Set(contracts.value.filter(c => c.parentContractId != null).map(c => c.id)))
// 某日在租=后端已过滤该日在执行的历史/当前期,不折叠;否则默认折叠到叶子,勾选含历史显全量
const displayBase = computed(() =>
  activeOn.value || showHistory.value ? contracts.value : contracts.value.filter(c => leaves.value.has(c.id)))

const lifecycleCounts = computed(() => {
  // seed all lifecycle keys to 0 so empty-status tabs show "0" (matches design), not blank
  const c: Record<string, number> = { all: displayBase.value.length, draft: 0, active: 0, expiring: 0, expired: 0, terminated: 0, renewed: 0 }
  for (const r of displayBase.value) c[r.status] = (c[r.status] ?? 0) + 1
  return c
})

// ─── filtered ─────────────────────────────────────────────
const filtered = computed(() =>
  displayBase.value
    .filter(c => statusFilter.value === 'all' || c.status === statusFilter.value)
    .filter(c => phase.value === '全部期数' || phaseOf(c) === phase.value)
    .filter(c => !q.value.trim() ||
      c.contractNo.includes(q.value.trim()) ||
      c.tenantName.includes(q.value.trim()) ||
      c.buildingName.includes(q.value.trim()))
)

// ─── table columns ────────────────────────────────────────
const TABLE_COLUMNS = computed(() => [
  {
    key: 'contractNo',
    header: '合同编号',
    width: '158px',
    mono: true,
    render: (r: ContractDTO) => h('span', {
      style: { display: 'inline-flex', alignItems: 'center', gap: '6px' }
    }, [
      h('span', { style: { fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)' } }, r.contractNo),
      // V59 整体承租徽标:批发性质,不计出租率/KPI
      r.kind === 'master_lease'
        ? h('span', { title: '整体承租,不计出租率与月租金KPI', style: { fontSize: '10px', fontFamily: 'var(--font-sans)', padding: '1px 6px', borderRadius: '999px', background: 'rgba(214,138,42,0.12)', color: 'var(--hue-orange)' } }, '整租')
        : null,
      // 徽标按 linkType 区分(ESCALATION-SPLIT-SPEC §1):递增段≠续签换约
      hasHistoryIds.value.has(r.id)
        ? (r.linkType === 'escalation'
          ? h('span', { title: '同约递增段,点开查看各档', style: { fontSize: '10px', fontFamily: 'var(--font-sans)', padding: '1px 6px', borderRadius: '999px', background: 'rgba(64,158,170,0.12)', color: 'var(--hue-cyan)' } }, '递增')
          : h('span', { title: '有续签历史,点开查看', style: { fontSize: '10px', fontFamily: 'var(--font-sans)', padding: '1px 6px', borderRadius: '999px', background: 'rgba(24,134,254,0.12)', color: 'var(--hue-blue)' } }, '续'))
        : null,
    ]),
  },
  {
    key: 'tenantName',
    header: '租户',
    render: (r: ContractDTO) => h('span', {
      style: { display: 'flex', alignItems: 'center', gap: '9px' }
    }, [
      h(Avatar, { name: r.tenantName, size: 28 }),
      h('span', { style: { fontWeight: 'var(--fw-medium)', whiteSpace: 'nowrap' } }, r.tenantName),
    ]),
  },
  {
    key: 'loc',
    header: '楼栋 / 房号',
    width: '158px',
    sortValue: (r: ContractDTO) => r.buildingName,
    render: (r: ContractDTO) => h('span', {
      style: { display: 'flex', flexDirection: 'column' }
    }, [
      h('span', { style: { color: 'var(--text-secondary)', whiteSpace: 'nowrap' } }, r.buildingName),
      h('span', { style: { fontSize: 'var(--fs-micro)', color: 'var(--text-disabled)', fontFamily: 'var(--font-mono)' } }, r.floorInfo),
    ]),
  },
  {
    key: 'rentArea',
    header: '租赁面积 ㎡',   /* F1:既有 rent_area 语义明确为租赁面积(计租面积) */
    width: '84px',
    align: 'right' as const,
    mono: true,
    sortValue: (r: ContractDTO) => r.rentArea,
    render: (r: ContractDTO) => h('span', {}, r.rentArea.toLocaleString('en-US')),
  },
  {
    key: 'monthlyRent',
    header: '月租金',
    width: '104px',
    align: 'right' as const,
    mono: true,
    sortValue: (r: ContractDTO) => r.monthlyRent,
    render: (r: ContractDTO) => h('span', {
      style: { fontWeight: 'var(--fw-semibold)' }
    }, fpMoney(r.monthlyRent)),
  },
  {
    key: 'range',
    header: '租赁期间',
    width: '186px',
    sortValue: (r: ContractDTO) => r.startDate ?? '9999',
    render: (r: ContractDTO) => h('span', {
      style: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-muted)' }
    }, r.startDate ? `${r.startDate} → ${r.endDate}` : '待签约'),
  },
  {
    key: 'daysToEnd',
    header: '距到期',
    width: '96px',
    align: 'right' as const,
    // ponytail: draft→1e9 (末尾), expired/terminated→1e8 (沉底前), active/expiring→actual days asc
    sortValue: (r: ContractDTO) =>
      r.daysToEnd == null ? 1e9 :
      (r.status === 'expired' || r.status === 'terminated') ? 1e8 :
      r.daysToEnd,
    render: (r: ContractDTO) => {
      const pill = (text: string, fg: string, bg: string) => h('span', {
        style: { display: 'inline-block', fontFamily: 'var(--font-mono)', fontSize: '11.5px', fontWeight: 'var(--fw-semibold)',
                 padding: '2px 8px', borderRadius: '999px', color: fg, background: bg, whiteSpace: 'nowrap' },
      }, text)
      if (r.status === 'draft')       return h('span', { style: { color: 'var(--text-disabled)', fontSize: '12px' } }, '—')
      if (r.status === 'expired')     return pill('已到期', 'var(--hue-red)', 'oklch(0.95 0.03 20)')
      if (r.status === 'terminated')  return h('span', { style: { color: 'var(--text-disabled)', fontSize: '12px' } }, '已终止')
      const d = r.daysToEnd ?? 0
      if (d <= 30)                    return pill(`${d} 天`, 'var(--hue-red)', 'oklch(0.95 0.03 20)')
      if (d <= 90)                    return pill(`${d} 天`, 'rgb(168,98,0)', 'oklch(0.95 0.045 78)')
      return h('span', { style: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-secondary)' } }, `${d} 天`)
    },
  },
  {
    key: 'status',
    header: '状态',
    width: '92px',
    render: (r: ContractDTO) => h(FPContractStatus, { status: r.status }),
  },
])

// ─── sort / page ──────────────────────────────────────────
const sortedFiltered = computed(() => fpSortRows(filtered.value, sort.value, TABLE_COLUMNS.value))
const pageCount = computed(() => Math.max(1, Math.ceil(sortedFiltered.value.length / pageSize.value)))
const safePage = computed(() => Math.min(page.value, pageCount.value))
const paged = computed(() => sortedFiltered.value.slice((safePage.value - 1) * pageSize.value, safePage.value * pageSize.value))

watch([statusFilter, phase, q, sort, activeOn, showHistory], () => { page.value = 1 })

// ─── 计费字段导入(BILL-FORWARD 刀1 二次返工,registry key 'billingTerms';按钮状态机遵9屏统一规范) ──
const auth = useAuthStore()
const importing = ref(false)
const importResult = ref<ImportResultDTO | null>(null)
const importCtx: ImportCtx = {}
async function onImport(payload: ImportRec[] | { label?: string; records: ImportRec[] }[], fileName: string) {
  importing.value = false
  try {
    importResult.value = await runImport('billingTerms', payload as never, importCtx, fileName)
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
  await reload()   // 条款不改列表行,但重拉保证抽屉再开时读到最新
}
</script>

<template>
  <div style="display:flex;flex-direction:column;gap:20px;max-width:1600px;margin:0 auto;width:100%;height:100%">
    <!-- 1. Header -->
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div>
        <h2 style="margin:0;font-size:var(--fs-h2);font-weight:var(--fw-semibold)">合同管理</h2>
        <p style="margin:5px 0 0;font-size:var(--fs-label);color:var(--text-muted)">
          租赁合同与续签 · 主数据 · 共 {{ summary ? displayBase.length : '…' }} 份
        </p>
      </div>
      <!-- 导入=计费字段(BILL-FORWARD 刀1 二次返工);viewer 无写入口(EDIT-MODE-SPEC) -->
      <div style="display:flex;gap:8px">
        <Button v-if="!auth.isReadonly" variant="outline" size="sm" @click="importing = true">
          <template #leading><component :is="iconFor('upload')" :size="14" /></template>
          导入计费字段
        </Button>
        <Button variant="filled" size="sm" @click="showNew = true">
          <template #leading><component :is="iconFor('plus')" :size="14" /></template>
          新增合同
        </Button>
      </div>
    </div>

    <!-- data body: gated on first load so we never flash empty KPIs / 共0份 / 没有匹配 -->
    <template v-if="summary">
    <!-- KPI 顶条已去除(用户要求:让左侧列表更宽显示更多列);状态计数仍在生命周期 tabs 上 -->
    <!-- 筛选/搜索:全宽置顶(sidebar 列表太窄放不下这排控件) -->
    <div class="mx-toolbar mx-toolbar-top">
      <FPPhaseTabs v-model="statusFilter" :counts="lifecycleCounts" :tabs="LIFECYCLE" />
      <div class="mx-toolbar-right">
        <label class="mx-asof" :class="{ on: !!activeOn }" title="只看某日期仍在执行中的合同">
          <component :is="iconFor('calendar-check')" :size="15" />
          <input type="date" v-model="activeOn" />
          <button v-if="activeOn" type="button" class="mx-asof-x" title="清除日期筛选" @click.prevent="activeOn = ''">
            <component :is="iconFor('x')" :size="13" />
          </button>
        </label>
        <label v-if="!activeOn" class="mx-hist-toggle" :class="{ on: showHistory }" title="显示被续签取代的历史期">
          <input type="checkbox" v-model="showHistory" />
          含历史续签
        </label>
        <div class="mx-search">
          <span class="mx-search-icon"><component :is="iconFor('search')" :size="16" /></span>
          <input v-model="q" placeholder="搜索合同编号 / 租户 / 楼栋" />
        </div>
        <div style="width:130px">
          <Select :options="['全部期数','一期','二期','三期','宿舍']" v-model="phase" size="sm" />
        </div>
      </div>
    </div>

    <div class="mx-md">
      <!-- 左:合同列表 sidebar(紧凑列表项;详情占主区) -->
      <div class="mx-md-list">
        <Card surface="white" :padding="0" class="cl-card">
          <div class="cl-scroll">
            <button v-for="c in paged" :key="c.id" type="button" class="cl-item"
                    :class="{ sel: openContract?.id === c.id }" @click="openContract = c">
              <Avatar :name="c.tenantName" :size="30" />
              <div class="cl-main">
                <div class="cl-l1">
                  <span class="cl-name">{{ c.tenantName }}</span>
                  <span class="cl-money">{{ fpMoney(c.monthlyRent) }}</span>
                </div>
                <div class="cl-l2">
                  <span class="cl-no">{{ c.contractNo }}</span>
                  <span v-if="c.kind === 'master_lease'" class="cl-master" title="整体承租,不计出租率与月租金KPI">整租</span>
                  <FPContractStatus :status="c.status" />
                </div>
              </div>
            </button>
            <div v-if="filtered.length === 0" class="cl-empty">没有匹配的合同</div>
          </div>
          <div v-if="filtered.length > 0" class="mx-pagerbar">
            <FPPager compact :page="safePage" :pageCount="pageCount" :total="filtered.length" @page="page = $event" />
          </div>
        </Card>
      </div>

      <!-- 右:详情列(内联 ContractDrawer,点行展开不弹模态;未选显占位) -->
      <div class="mx-md-detail">
        <ContractDrawer
          v-if="openContract"
          :contract="openContract"
          :chain="chainOf(contracts, openContract.id)"
          @jump="openContract = $event"
          @edit="editFrom = $event"
          @renew="renewFrom = $event"
          @terminated="onTerminated"
          @deleted="onDeleted"
        />
        <div v-else class="mx-md-empty">
          <component :is="iconFor('file-text')" :size="40" />
          <p>从左侧选择一份合同查看详情</p>
        </div>
      </div>
    </div>
    </template>
    <div v-else class="page-loading"><span class="page-spin" /></div>

    <!-- 5.5 计费字段导入(registry key 'billingTerms':整册 parseWorkbook → 每户一段勾选;多合同户人选其一) -->
    <FpImportModal
      v-if="importing"
      title="导入 合同计费字段 · 月度租金工作簿"
      sub="上传月度租金工作簿(每租户一 sheet,含通知单块),自动提取五费项(租金/管理费/基础维护/电梯/变压器)按 sheet 名落到生效合同固定字段;多合同户请勾选归属合同;流水账等 sheet 须手录;导入后自动下载到户报告"
      v-bind="parserProps('billingTerms', importCtx)"
      @close="importing = false"
      @import="onImport"
      @import-sections="onImport"
    />
    <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />

    <!-- 6. 新增合同弹窗 -->
    <ContractNewDialog v-if="showNew" @close="showNew = false" @created="onCreated" />

    <!-- 7. 编辑 / 续签弹窗(从抽屉操作区打开,压在抽屉之上) -->
    <ContractNewDialog v-if="editFrom" :initial="editFrom" @close="editFrom = null" @saved="onEdited" />
    <ContractNewDialog v-if="renewFrom" :renew-from="renewFrom" @close="renewFrom = null" @saved="onRenewed" />
  </div>
</template>

<!-- .mx-* 布局样式收编于全局 styles/mx-list.css(LIST-PAGE-SPEC 单一事实源);下方仅本屏工具栏新增控件 -->
<style scoped>
/* 某日在租日期选择器 + 含历史续签开关(§5.2/§5.3):贴合工具栏右侧既有控件高度 */
.mx-asof { display:inline-flex; align-items:center; gap:6px; height:34px; padding:0 8px; border:1px solid var(--border-subtle); border-radius:var(--radius-md); background:var(--surface-white); color:var(--text-muted); cursor:pointer; }
.mx-asof.on { border-color:var(--hue-blue); color:var(--hue-blue); }
.mx-asof input[type="date"] { border:none; outline:none; background:none; font-size:12.5px; font-family:var(--font-mono); color:var(--text-primary); cursor:pointer; }
.mx-asof-x { display:grid; place-items:center; width:20px; height:20px; border:none; background:none; border-radius:var(--radius-sm); color:var(--text-muted); cursor:pointer; }
.mx-asof-x:hover { background:var(--bg-hover); color:var(--hue-red); }
.mx-hist-toggle { display:inline-flex; align-items:center; gap:6px; height:34px; padding:0 10px; border:1px solid var(--border-subtle); border-radius:var(--radius-md); font-size:12.5px; color:var(--text-secondary); cursor:pointer; white-space:nowrap; }
.mx-hist-toggle.on { border-color:var(--hue-blue); color:var(--hue-blue); }
.mx-hist-toggle input { accent-color:var(--hue-blue); }
</style>
