<script setup lang="ts">
// 账单管理(BILLS-SPEC 2026-07-16):应收账单工具,数据源=附表10(billsApi.s10);
// 成员=租户主数据家族(tenantApi.list 的 parentId 关系,非台账行)——实收/结余属台账,本屏不展示。
// 进入流程=期间门(§3):年份门(复用 SchedYearGate)→ 月历(FinMonthGrid 同款,无数据月禁选)→ 列表;
// 禁止默认落最新月。KeepAlive 会话内保持已选期间,刷新/侧边栏重进重新走门。
// 抽屉=转置工资条(行=费用项,列=成员)+单户导出/打印;批量导出=zip 一户一 xlsx(billExcel)。
// 收款公司指引(BILLS-SPEC §5):非零金额格下方公司短名徽标,admin 编辑模式下点开 popover 单选即 PUT
// (EDIT-MODE-SPEC v2:浏览态与 viewer 同为只读徽标);映射进页拉一次全量缓存,与台账记账/期数完全不联动。
// 布局遵 LIST-PAGE-SPEC(无 KPI 栏,主列全宽,卡片定高 flex 链不变)。
import { ref, computed, watch, onMounted, onDeactivated, h } from 'vue'
import { onReactivated } from '@/composables/onReactivated'
import { billsApi, type BillS10RowDTO } from '@/api/bills'
import { tenantApi } from '@/api/tenant'
import type { TenantDTO } from '@/types/tenant'
import type { CompanyDTO } from '@/types/ledger'
import type { S10ColId } from '@/types/s10'
import { companyApi } from '@/api/ledger'
import { analysisApi } from '@/api/analysis'
import { useAuthStore } from '@/stores/auth'
import { buildFamilies, buildPayslip, exportBillFile, exportBillsZip, type BillFamily, type BillMember, type PayCoLookup } from '@/utils/billExcel'
import { printBill } from '@/utils/billPrint'
import Popover from '@/components/ds/Popover.vue'
import PopoverItem from '@/components/ds/PopoverItem.vue'
import { fpSortRows } from '@/components/fp/fpSort'
import type { SortState } from '@/components/fp/fpSort'
import { fpMoney, fpWan } from '@/utils/money'
import Button from '@/components/ds/Button.vue'
import Card from '@/components/ds/Card.vue'
import Select from '@/components/ds/Select.vue'
import FPSortableTable from '@/components/fp/FPSortableTable.vue'
import { useFitRows } from '@/components/fp/useFitRows'
import FPPager from '@/components/fp/FPPager.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPSectionLabel from '@/components/fp/FPSectionLabel.vue'
import SchedYearGate, { type YearCard } from '@/components/sched/SchedYearGate.vue'
import { iconFor } from '@/components/ds/icon'

// ─── state ───────────────────────────────────────────────
const availMonths = ref<string[]>([])              // 'YYYY-MM' 升序(附表10有数据的月,analysis/months.sources.s10)
const year = ref<number | null>(null)
const month = ref<number | null>(null)
const tenants = ref<TenantDTO[] | null>(null)      // 家族主数据,取一次;null=首载 gate
const s10Rows = ref<BillS10RowDTO[] | null>(null)  // 本期附表10行;null=首载 gate
const q = ref('')
const sort = ref<SortState | null>(null)           // null → 应收降序(buildFamilies 默认序)
const page = ref(1)
const tableWrapEl = ref<HTMLElement | null>(null)
const pageSize = useFitRows(tableWrapEl)
const openFam = ref<BillFamily | null>(null)
const exporting = ref(false)

// ─── 收款公司指引(BILLS-SPEC §5) ─────────────────────────
const auth = useAuthStore()
const companies = ref<CompanyDTO[]>([])        // 公司主数据全量 = popover 候选列表
const paymap = ref(new Map<string, number>())  // `${tenantId}|${feeKey}` → companyId,进页拉一次全量缓存
const openPay = ref<string | null>(null)       // 当前展开 popover 的格键(单开)

// ── 编辑模式(EDIT-MODE-SPEC v2,同 Pv/CpMeterView):不跨会话;KeepAlive 切页签回来也回浏览态(安全默认) ──
const editMode = ref(false)
onDeactivated(() => { editMode.value = false })
watch(editMode, v => { if (!v) openPay.value = null })   // 退出编辑模式收起徽标 popover(抽屉开着也生效)

// ─── 期间门状态(BILLS-SPEC §3) ──────────────────────────
const gateReady = ref(false)               // availMonths/tenants 已落位(区分「加载中」与「无数据」)
const gated = ref(false)                   // 已选定期间进入列表
const gateYear = ref<number | null>(null)  // 门内已选年;null=年份层,非 null=月历层

// ─── 期间(年月来自真实附表10覆盖月,不硬编码) ────────────
const years = computed(() => [...new Set(availMonths.value.map(m => +m.slice(0, 4)))])
const monthsOf = (y: number | null) => availMonths.value.filter(m => +m.slice(0, 4) === y).map(m => +m.slice(5, 7))
const yearOpts = computed(() => years.value.map(y => ({ value: String(y), label: `${y}年` })))
const monthOpts = computed(() => monthsOf(year.value).map(m => ({ value: String(m), label: `${m}月` })))

function setYear(y: number) {
  year.value = y
  const ms = monthsOf(y)
  if (month.value == null || !ms.includes(month.value)) month.value = ms[ms.length - 1] ?? null
}

// ─── 取数(竞态守卫同 SalaryView loadMonth;切期保留旧数据到新数据落位,不闪 gate) ──
let seq = 0
async function loadRows() {
  if (year.value == null || month.value == null) { s10Rows.value = []; return }
  const my = ++seq
  const data = await billsApi.s10(year.value, month.value)
  if (my === seq) s10Rows.value = data
}

// 页签切回:家族聚合吃 parentId 关系树,租户改名/关联变更后回拉
onReactivated(() => { tenantApi.list().then(ts => { tenants.value = ts }).catch(() => {}) })

onMounted(async () => {
  // paymap 是辅助指引数据:endpoint 异常不拖垮整页(徽标退化为全「未设置」)
  const [dto, ts, cos, pm] = await Promise.all([
    analysisApi.months(), tenantApi.list(), companyApi.list(),
    billsApi.paymap().catch(() => []),
  ])
  tenants.value = ts
  companies.value = cos
  paymap.value = new Map(pm.map(r => [`${r.tenantId}|${r.feeKey}`, r.companyId]))
  availMonths.value = dto.sources?.['s10'] ?? dto.months ?? []
  // 不默认预选最新月——必须先过期间门(BILLS-SPEC §3);全库无附表10时门无意义,直接放行空态
  if (!availMonths.value.length) { gated.value = true; s10Rows.value = [] }
  gateReady.value = true
})

// ─── 期间门派生与迁移(年卡样式同报表 SchedYearGate,月历同 FinMonthGrid) ──
const gateCards = computed<YearCard[]>(() =>
  years.value.map(y => ({ year: y, hasData: true, metric: `${monthsOf(y).length} 个月`, label: '已录入月份' })),
)
const gateCurrent = computed(() => years.value[years.value.length - 1] ?? new Date().getFullYear())
const gateMonths = computed(() => (gateYear.value != null ? monthsOf(gateYear.value) : []))
const gateYearIdx = computed(() => (gateYear.value != null ? years.value.indexOf(gateYear.value) : -1))
// ponytail: 年胶囊在有数据年数组里步进(availMonths 可能有断年,±1 算术会踩进全灰死胡同)
function stepGateYear(d: number) {
  const i = gateYearIdx.value + d
  if (i >= 0 && i < years.value.length) gateYear.value = years.value[i]
}
function pickGateMonth(m: number) {
  if (!gateMonths.value.includes(m)) return   // 无附表10数据的月禁选
  year.value = gateYear.value
  month.value = m
  gated.value = true
}
// 列表态「重选」回门(重新走 年→月;toolbar 年月 Select 仍可就地切换)
function backToGate() { gateYear.value = null; gated.value = false }

watch([year, month], loadRows)
watch([q, sort, year, month], () => { page.value = 1 })

// ─── 家族构建与派生(billExcel 纯函数,默认应收降序) ───────
const families = computed(() =>
  tenants.value && s10Rows.value ? buildFamilies(tenants.value, s10Rows.value) : [],
)
const recvSum = computed(() => families.value.reduce((s, f) => s + f.totalReceivable, 0))
// 标题副行:金额看量级选格式(≥10万 用「万」,小额保留到元)
const subtitle = computed(() => {
  if (year.value == null || month.value == null || !s10Rows.value) return '—'
  const amt = recvSum.value >= 100000 ? fpWan(recvSum.value) : fpMoney(recvSum.value)
  return `${year.value}年${month.value}月 · 本期应收合计 ${amt} · ${families.value.length} 户账单`
})

// 搜索:户名含成员名
const filtered = computed(() =>
  families.value.filter(f => {
    const kw = q.value.trim()
    return !kw || f.rootName.includes(kw) || f.members.some(m => m.tenantName.includes(kw))
  }),
)

// 小徽标(成员数/未关联档案)统一样式
const badge = (text: string, tone?: string) =>
  h('span', { style: { flex: '0 0 auto', fontSize: 'var(--fs-micro)', color: tone ?? 'var(--text-secondary)', background: 'var(--bg-sunken)', borderRadius: 'var(--radius-full)', padding: '1px 6px' } }, text)

// 列宽铁律(BILLS-SPEC §3):户名/应收显式定宽,成员构成无 width——fixedLayout 下吸收全部余宽,
// 紧贴应收列不留空隙;列位置不随内容/翻页漂移。溢出治理同 TenantsView 名称列(nowrap+ellipsis+title)。
const TABLE_COLUMNS = computed(() => [
  {
    key: 'rootName', header: '户名', width: '300px',
    sortValue: (f: BillFamily) => f.rootName,
    render: (f: BillFamily) =>
      h('span', { title: f.rootName, style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, overflow: 'hidden' } }, [
        h('span', { style: { fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)', whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, f.rootName),
        // 家族成员数徽标(仅多户家族)
        f.members.length > 1 ? badge(`${f.members.length}户`) : null,
        // 匹配不到租户档案的附表10行独立成户(BILLS-SPEC §2)
        f.unlinked ? badge('未关联租户档案', 'var(--hue-orange)') : null,
      ]),
  },
  {
    key: 'totalReceivable', header: '本期应收', width: '160px', align: 'right' as const, mono: true,
    sortValue: (f: BillFamily) => f.totalReceivable,
    render: (f: BillFamily) => h('span', { style: { fontWeight: 'var(--fw-semibold)' } }, fpMoney(f.totalReceivable)),
  },
  {
    key: 'membersPreview', header: '成员构成',
    sortValue: (f: BillFamily) => f.members.length,
    render: (f: BillFamily) => {
      const names = f.members.filter(m => m.child).map(m => m.tenantName).join('、')
      return h('span', { title: names || undefined, style: { display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-muted)', fontSize: 'var(--fs-label)' } }, names || '—')
    },
  },
])

const sortedFiltered = computed(() =>
  sort.value ? fpSortRows(filtered.value, sort.value, TABLE_COLUMNS.value) : filtered.value,
)
const pageCount = computed(() => Math.max(1, Math.ceil(sortedFiltered.value.length / pageSize.value)))
const safePage = computed(() => Math.min(page.value, pageCount.value))
const paged = computed(() => sortedFiltered.value.slice((safePage.value - 1) * pageSize.value, safePage.value * pageSize.value))

// ─── 抽屉(工资条明细,家族数据已在行内,纯同步派生) ────────
const payslip = computed(() => (openFam.value ? buildPayslip(openFam.value) : null))
// 无附表10记录的成员集中到表下备注(BILLS-SPEC §4:提示不入列头,避免撑宽成员列)
const missingNames = computed(() => payslip.value?.members.filter(m => m.missing).map(m => m.tenantName) ?? [])
// 工资条列宽铁律(BILLS-SPEC §4):费用项140 + (成员数+1)×128,总宽只随成员数确定性变化。
// 3 成员=652px:留出抽屉 body 纵向滚动条(~13px)后仍不溢出 720px 抽屉
const slipWidth = computed(() => (payslip.value ? 140 + (payslip.value.members.length + 1) * 128 : 0))
watch(openFam, () => { openPay.value = null })   // 关抽屉/换户时收起徽标 popover

// ─── 收款公司徽标派生与写入(BILLS-SPEC §5) ───────────────
const coById = computed(() => new Map(companies.value.map(c => [c.id, c])))
const payKey = (m: BillMember, k: S10ColId) => `${m.tenantId}|${k}`
const payCoIdOf = (m: BillMember, k: S10ColId): number | null =>
  m.tenantId == null ? null : paymap.value.get(payKey(m, k)) ?? null
// 徽标显示短名(CompanyDTO.short);无映射 → null(呈现「未设置」)
const payShort = (m: BillMember, k: S10ColId): string | null => {
  const id = payCoIdOf(m, k)
  return id != null ? coById.value.get(id)?.short ?? null : null
}
// 仅编辑态可设(EDIT-MODE-SPEC v2:浏览态与 viewer 同为只读徽标);tenantId 空的未关联户无处落映射,禁设置
const canEditPay = (m: BillMember) => editMode.value && !auth.isReadonly && m.tenantId != null
// 导出/打印用全名 lookup(billExcel PayCoLookup 契约)
const payCoName: PayCoLookup = (tid, k) => {
  if (tid == null) return null
  const id = paymap.value.get(`${tid}|${k}`)
  return id != null ? coById.value.get(id)?.name ?? null : null
}
function setPayCo(m: BillMember, k: S10ColId, companyId: number) {
  if (m.tenantId == null) return
  // 乐观更新:徽标/面板即时响应,不等写库往返(本地 Docker MySQL 落盘 300ms+,云端更久);失败回滚并提示
  const key = payKey(m, k)
  const prev = paymap.value.get(key)
  paymap.value.set(key, companyId)
  openPay.value = null
  billsApi.setPaymap({ tenantId: m.tenantId, feeKey: k, companyId }).catch(() => {
    if (prev === undefined) paymap.value.delete(key)
    else paymap.value.set(key, prev)
    alert('收款公司保存失败，请重试')
  })
}

// ─── 导出(批量=zip 一户一 xlsx,全量无欠费过滤;欠费口径属台账/催缴清单) ──
async function doExportAll() {
  if (!families.value.length || exporting.value || year.value == null || month.value == null) return
  exporting.value = true
  try {
    await exportBillsZip(families.value, year.value, month.value, payCoName)
  } finally {
    exporting.value = false
  }
}

// 抽屉内单户导出
async function doExportOne() {
  if (!openFam.value || exporting.value || year.value == null || month.value == null) return
  exporting.value = true
  try {
    await exportBillFile(openFam.value, year.value, month.value, payCoName)
  } finally {
    exporting.value = false
  }
}

// 抽屉内打印账单(BILLS-SPEC §6):A4 版式新窗自动 print
function doPrint() {
  if (!openFam.value || year.value == null || month.value == null) return
  printBill(openFam.value, year.value, month.value, payCoName)
}
</script>

<template>
  <!-- ⓪ 首载 gate:availMonths/tenants 落位前不闪门/列表 -->
  <div v-if="!gateReady" class="page-loading"><span class="page-spin" /></div>

  <!-- ① 期间门·年份层(BILLS-SPEC §3:复用报表 SchedYearGate;本屏只读消费附表10,scoped 隐藏「新增年份」) -->
  <SchedYearGate
    v-else-if="!gated && gateYear == null"
    class="bills-gate"
    icon="receipt"
    title="账单管理"
    sub="先选择年份与月份,再进入该期应收账单列表 · 数据源=附表10"
    :years="gateCards"
    :current="gateCurrent"
    store-key="bills"
    footer="仅可选择有附表10数据的期间;账单数据随附表10导入自动更新。"
    @pick="gateYear = $event"
  />

  <!-- ② 期间门·月历层(FinMonthGrid 一字同款样式;无数据月置灰禁选——组件空月可点不合本屏,故内联轻量门屏) -->
  <div v-else-if="!gated" class="fin-page">
    <div class="fin-head">
      <div class="fin-head-l">
        <button class="fin-back" title="返回年份选择" @click="gateYear = null"><component :is="iconFor('arrow-left')" :size="16" /></button>
        <div>
          <h2 class="fin-title">账单管理</h2>
          <p class="fin-sub"><span class="mono">{{ gateYear }} 年</span> · 选择月份,进入该期应收账单列表</p>
        </div>
      </div>
      <span class="fin-ypill">
        <button :disabled="gateYearIdx <= 0" title="上一个有数据年" @click="stepGateYear(-1)"><component :is="iconFor('chevron-left')" :size="15" /></button>
        <span class="v">{{ gateYear }}</span>
        <button :disabled="gateYearIdx >= years.length - 1" title="下一个有数据年" @click="stepGateYear(1)"><component :is="iconFor('chevron-right')" :size="15" /></button>
      </span>
    </div>

    <div class="fin-mlabel">{{ gateYear }} 年 <span class="hint">· 点击月份进入该期账单列表;灰色月份无附表10数据</span></div>

    <div class="fin-mgrid">
      <template v-for="m in 12" :key="m">
        <div v-if="gateMonths.includes(m)" class="fin-mcard" @click="pickGateMonth(m)">
          <div class="fin-mc-head">
            <div class="fin-mc-month">{{ m }}<span class="u">月</span></div>
            <span class="fin-mc-dot"></span>
          </div>
          <div class="fin-mc-sub">已录入</div>
        </div>
        <!-- 无附表10数据的月:置灰禁选(BILLS-SPEC §3),与报表「空月可点录入」有意不同——本屏无录入入口 -->
        <div v-else class="fin-mcard empty dis">
          <div class="fin-mc-head"><div class="fin-mc-month">{{ m }}<span class="u">月</span></div></div>
          <div class="fin-mc-empty">无附表10数据</div>
        </div>
      </template>
    </div>

    <p class="fin-foot"><component :is="iconFor('info')" :size="13" />仅可选择有附表10数据的月份;在导入中心导入附表10后即可查看对应期间账单。</p>
  </div>

  <!-- ③ 列表 -->
  <div v-else style="display:flex;flex-direction:column;gap:20px;max-width:1600px;margin:0 auto;width:100%;height:100%">
    <!-- 1. Title row(BILLS-SPEC §3:无 KPI 卡,副行直接给合计) -->
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div>
        <h2 style="margin:0;font-size:var(--fs-h2);font-weight:var(--fw-semibold)">账单管理</h2>
        <p style="margin:5px 0 0;font-size:var(--fs-label);color:var(--text-muted)">
          {{ subtitle }}
          <!-- 轻量回门入口(BILLS-SPEC §3):重新走 年→月 选择 -->
          <button class="bills-regate" title="重新选择期间" @click="backToGate">重选</button>
        </p>
      </div>
    </div>

    <!-- data body: 首载 gate,tenants+s10 落位前不闪「共0条」 -->
    <template v-if="tenants && s10Rows">
    <!-- 无 KPI 栏 → 主列全宽,卡片定高 flex 链保持(LIST-PAGE-SPEC §3) -->
    <div class="mx-main" style="flex:1 1 auto;min-height:0">

    <!-- 2. Toolbar(单行;左=年月选择器,右=搜索+单个批量导出) -->
    <div class="mx-toolbar">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:110px">
          <Select :options="yearOpts" :model-value="year != null ? String(year) : undefined" placeholder="年份"
                  size="sm" :disabled="!years.length" @update:model-value="setYear(+$event)" />
        </div>
        <div style="width:92px">
          <Select :options="monthOpts" :model-value="month != null ? String(month) : undefined" placeholder="月份"
                  size="sm" :disabled="!years.length" @update:model-value="month = +$event" />
        </div>
      </div>
      <div class="mx-toolbar-right">
        <div class="mx-search">
          <span class="mx-search-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input v-model="q" placeholder="搜索户名或成员名" />
        </div>
        <Button variant="filled" size="sm" :disabled="exporting || families.length === 0" @click="doExportAll">
          <template #leading><component :is="iconFor('download')" :size="14" /></template>
          批量导出
        </Button>
        <!-- 编辑模式(EDIT-MODE-SPEC v2,Pv/Cp 同款):收款公司徽标唯一写入口;导出/打印=只读常驻 -->
        <Button v-if="!auth.isReadonly" :variant="editMode ? 'filled' : 'outline'" size="sm" @click="editMode = !editMode">
          <template #leading><component :is="iconFor(editMode ? 'check' : 'pencil')" :size="14" /></template>
          {{ editMode ? '完成' : '编辑模式' }}
        </Button>
      </div>
    </div>

    <!-- 3. Table card(卡片定高 flex column,分页器停靠卡片内底部) -->
    <Card surface="white" :padding="0" class="mx-listcard">
      <div ref="tableWrapEl" class="mx-tablewrap">
        <FPSortableTable
          :columns="TABLE_COLUMNS"
          :rows="paged"
          rowKey="rootName"
          :sort="sort"
          :rowHover="true"
          :fixedLayout="true"
          @sortChange="sort = $event"
          @rowClick="openFam = $event"
        />
      </div>
      <div v-if="filtered.length === 0" style="text-align:center;padding:40px;color:var(--text-disabled)">
        {{ families.length === 0 ? '该期间无附表10数据' : '没有匹配的户名' }}
      </div>
      <div v-if="filtered.length > 0" class="mx-pagerbar">
        <FPPager
          :page="safePage"
          :pageCount="pageCount"
          :total="filtered.length"
          @page="page = $event"
        />
      </div>
    </Card>
    </div>
    </template>
    <div v-else class="page-loading"><span class="page-spin" /></div>

    <!-- 4. 家族账单抽屉:转置工资条(行=费用项,列=成员;BILLS-SPEC §4) -->
    <FPDrawer
      :open="!!openFam"
      :title="openFam?.rootName ?? ''"
      :subtitle="`${year}年${month}月 · 家族账单明细`"
      icon="receipt"
      :width="720"
      :fixedHeight="true"
      @close="openFam = null"
    >
      <template v-if="openFam && payslip">
        <!-- 卡片高度恒定(BILLS-SPEC §4):撑满抽屉内容高,行少的家族卡片不塌缩 -->
        <div class="bill-slip-page">
          <FPSectionLabel icon="users">成员应收明细（附表10）</FPSectionLabel>
          <!-- ponytail: 定宽下 ≤3 成员(≤670px)必不溢出,不设 overflow——徽标 popover 需 visible 不被裁;≥4 成员才开横滚兜底(BILLS-SPEC §4,此时 popover 被容器裁剪,滚动可及) -->
          <div class="bill-slip-wrap" :class="{ 'bs-scroll': payslip.members.length >= 4 }">
            <table class="bill-slip" :style="{ minWidth: slipWidth + 'px' }">
              <colgroup>
                <col style="width:140px" />
                <col v-for="m in payslip.members" :key="m.tenantName" style="width:128px" />
                <col /><!-- 合计:唯一弹性列吸收余宽(BILLS-SPEC §4),min-width 由整表 min-width 保障 -->
              </colgroup>
              <thead>
                <tr>
                  <th class="bs-name">费用项</th>
                  <!-- 列头只放成员名(BILLS-SPEC §4);无记录成员置灰,提示集中在表下备注 -->
                  <th v-for="m in payslip.members" :key="m.tenantName" :class="{ 'bs-off': m.missing }" :title="m.tenantName">
                    <span v-if="m.child" style="color:var(--text-disabled)">└ </span>{{ m.tenantName }}
                  </th>
                  <th>合计</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="r in payslip.rows" :key="r.key">
                  <td class="bs-name">{{ r.label }}</td>
                  <td v-for="(v, i) in r.values" :key="payslip.members[i].tenantName"
                      :class="payslip.members[i].missing ? 'bs-dash' : { 'bs-zero': v === 0 }">
                    <template v-if="payslip.members[i].missing">—</template>
                    <template v-else>
                      <div>{{ fpMoney(v) }}</div>
                      <!-- 收款公司徽标(BILLS-SPEC §5):仅非零金额格;admin 编辑模式下点开公司单选 popover,选中即 PUT -->
                      <div v-if="v !== 0">
                        <Popover
                          v-if="canEditPay(payslip.members[i])"
                          align="end" :width="240"
                          :model-value="openPay === payKey(payslip.members[i], r.key)"
                          @update:model-value="val => openPay = val ? payKey(payslip!.members[i], r.key) : null"
                        >
                          <template #trigger>
                            <button class="bs-co" :class="{ unset: !payShort(payslip.members[i], r.key) }"
                                    title="设置该费用项的收款公司">
                              {{ payShort(payslip.members[i], r.key) ?? '未设置' }}
                            </button>
                          </template>
                          <div class="bs-co-lbl">转入公司</div>
                          <PopoverItem v-for="c in companies" :key="c.id"
                                       @click="setPayCo(payslip.members[i], r.key, c.id)">
                            <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis">{{ c.name }}</span>
                            <component :is="iconFor('check')" v-if="payCoIdOf(payslip.members[i], r.key) === c.id"
                                       :size="14" style="color:var(--hue-blue);flex:0 0 auto" />
                          </PopoverItem>
                        </Popover>
                        <!-- 浏览态/viewer/tenantId 空的未关联户:只读徽标禁点(EDIT-MODE-SPEC v2),title 给缘由 -->
                        <span v-else class="bs-co ro" :class="{ unset: !payShort(payslip.members[i], r.key) }"
                              :title="payslip.members[i].tenantId == null ? '未关联租户档案，无法设置收款公司'
                                : !auth.isReadonly ? '进入编辑模式后可设置收款公司' : undefined">
                          {{ payShort(payslip.members[i], r.key) ?? '未设置' }}
                        </span>
                      </div>
                    </template>
                  </td>
                  <td class="bs-sum">{{ fpMoney(r.total) }}</td>
                </tr>
                <tr class="bs-total">
                  <td class="bs-name">合计</td>
                  <td v-for="(t, i) in payslip.memberTotals" :key="payslip.members[i].tenantName"
                      :class="{ 'bs-dash': payslip.members[i].missing }">
                    {{ payslip.members[i].missing ? '—' : fpMoney(t) }}
                  </td>
                  <td class="bs-sum">{{ fpMoney(payslip.grandTotal) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <!-- 催收要看得见谁缺数(BILLS-SPEC §2/§4):集中备注,不进列头 -->
          <div v-if="missingNames.length" class="bs-missnote">无附表10记录：{{ missingNames.join('、') }}</div>
        </div>
      </template>
      <template #footer>
        <!-- 打印账单(BILLS-SPEC §6):A4 版式,与 xlsx 同构含转入公司指引 -->
        <Button variant="outline" size="sm" :disabled="!payslip" @click="doPrint">
          <template #leading><component :is="iconFor('printer')" :size="14" /></template>
          打印账单
        </Button>
        <Button variant="filled" size="sm" :disabled="!payslip || exporting" @click="doExportOne">
          <template #leading><component :is="iconFor('download')" :size="14" /></template>
          导出账单
        </Button>
      </template>
    </FPDrawer>
  </div>
</template>

<style scoped>
/* ─── 期间门 ─────────────────────────────────────────── */
/* ponytail: 复用 SchedYearGate 但本屏是只读消费端,scoped 隐藏「新增年份」卡与其提示文案(共享组件零改动;组件加 prop 时可替换) */
.bills-gate :deep(.sm-ynew),
.bills-gate :deep(.sm-gate-label .hint) { display: none; }

/* 列表副行「重选」回门小按钮 */
.bills-regate { border: none; background: none; padding: 0; margin-left: 8px; font-family: inherit; font-size: var(--fs-label); color: var(--hue-blue); cursor: pointer; }
.bills-regate:hover { text-decoration: underline; }

/* 月历层:1:1 取自 FinMonthGrid 样式(该组件空月可点+公司徽标不合本屏,仅样式同款);.dis=无数据月置灰禁选 */
.fin-page { display:flex; flex-direction:column; gap:16px; width:100%; height:100%; min-height:0; box-sizing:border-box; font-family:var(--font-sans); color:var(--text-primary); }
.fin-head { flex:0 0 auto; display:flex; align-items:flex-end; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.fin-head-l { display:flex; align-items:center; gap:12px; min-width:0; }
.fin-back { width:34px; height:34px; flex:0 0 auto; border:1px solid var(--border-subtle); background:var(--surface-white); border-radius:var(--radius-md); cursor:pointer; display:grid; place-items:center; color:var(--text-secondary); transition:background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.fin-back:hover { background:var(--bg-hover); color:var(--text-primary); }
.fin-title { margin:0; font-size:var(--fs-h2); font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-sub { margin:4px 0 0; font-size:var(--fs-label); color:var(--text-muted); }
.fin-sub .mono { font-family:var(--font-mono); font-variant-numeric:tabular-nums; }
.fin-ypill { display:inline-flex; align-items:center; gap:2px; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-full); padding:3px; }
.fin-ypill button { width:28px; height:28px; border:none; background:transparent; border-radius:var(--radius-full); cursor:pointer; color:var(--text-secondary); display:grid; place-items:center; transition:background var(--dur-fast) var(--ease-standard); }
.fin-ypill button:hover:not(:disabled) { background:var(--bg-hover); color:var(--text-primary); }
.fin-ypill button:disabled { opacity:.4; cursor:not-allowed; }
.fin-ypill .v { font-size:13.5px; font-weight:var(--fw-semibold); color:var(--text-primary); font-family:var(--font-mono); font-variant-numeric:tabular-nums; padding:0 8px; white-space:nowrap; }
.fin-mlabel { flex:0 0 auto; display:flex; align-items:center; gap:8px; font-size:var(--fs-body); font-weight:var(--fw-semibold); color:var(--text-primary); }
.fin-mlabel .hint { font-size:12px; font-weight:var(--fw-regular); color:var(--text-muted); }
.fin-mgrid { flex:0 0 auto; display:grid; grid-template-columns:repeat(4, minmax(0,1fr)); gap:14px; }
.fin-mcard { position:relative; display:flex; flex-direction:column; min-height:116px; padding:16px 18px; box-sizing:border-box; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); cursor:pointer; transition:border-color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard); }
.fin-mcard:hover { border-color:var(--border-strong); box-shadow:0 4px 16px rgba(28,28,28,.07); }
.fin-mcard.empty { background:transparent; border-style:dashed; }
.fin-mcard.dis { cursor:default; opacity:.55; }
.fin-mcard.dis:hover { border-color:var(--border-subtle); box-shadow:none; }
.fin-mc-head { display:flex; align-items:flex-start; justify-content:space-between; }
.fin-mc-month { font-size:23px; font-weight:var(--fw-semibold); letter-spacing:-0.02em; line-height:1; color:var(--text-primary); }
.fin-mc-month .u { font-size:13px; font-weight:var(--fw-medium); color:var(--text-muted); margin-left:3px; }
.fin-mc-dot { width:7px; height:7px; border-radius:50%; background:var(--status-info); flex:0 0 auto; margin-top:6px; }
/* margin-top:auto:本屏月卡无金额预览,文案贴底与空卡对齐 */
.fin-mc-sub { font-size:11.5px; color:var(--text-muted); margin-top:auto; }
.fin-mc-empty { margin-top:auto; font-size:12.5px; color:var(--text-disabled); display:inline-flex; align-items:center; gap:6px; }
.fin-foot { flex:0 0 auto; margin:0; font-size:12px; color:var(--text-muted); display:flex; align-items:center; gap:6px; }

/* 转置工资条列宽铁律(BILLS-SPEC §4):table-layout:fixed,费用项140+每成员128 定宽,
   合计=唯一弹性列吸收余宽(同列表页铁律);卡片恒占满抽屉内容宽,单费用项/单成员家族与满表同宽同观感。
   表 min-width=定宽总和(slipWidth):≥4 成员合计压到下限时溢出,.bs-scroll 开 overflow-x
   (常态不设:overflow-x:auto 会把 overflow-y 隐式提为 auto,裁剪收款公司 popover),
   滚动发生在 wrap 内 → .bs-name sticky 生效,费用项列不随横滚移动;边框在 wrap 上不切表体 */
/* 卡片高度恒定(BILLS-SPEC §4):容器撑满抽屉内容高(fp-dwr-body 为定高 flex column),
   行少的家族卡片不塌缩——wrap flex:1 兜住剩余高度;行多时自然超高,抽屉 body 滚动 */
.bill-slip-page {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
}
.bill-slip-wrap {
  flex: 1 1 auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  width: 100%;
  box-sizing: border-box;
}
.bill-slip-wrap.bs-scroll { overflow-x: auto; }
.bill-slip {
  table-layout: fixed;
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  white-space: nowrap;
}
.bill-slip th,
.bill-slip td {
  padding: 7px 10px;
  text-align: right;
  border-bottom: 1px solid var(--divider);
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.bill-slip thead th {
  font-family: inherit;
  font-weight: var(--fw-medium);
  font-size: 11px;
  color: var(--text-muted);
  background: var(--surface-card);
  overflow: hidden;          /* fixed 布局下长成员名走省略号,不撑列(title 出全名) */
  text-overflow: ellipsis;
}
.bill-slip thead th.bs-off { color: var(--text-disabled); }
.bill-slip .bs-name {
  text-align: left;
  font-family: inherit;
  font-weight: var(--fw-medium);
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--surface-white);
}
.bill-slip thead .bs-name { background: var(--surface-card); }
.bill-slip .bs-zero { color: var(--text-disabled); }
.bill-slip .bs-dash { color: var(--text-disabled); }
.bill-slip .bs-sum { font-weight: var(--fw-semibold); }
.bill-slip .bs-total td {
  border-bottom: none;
  background: var(--surface-card);
  font-weight: var(--fw-semibold);
}
.bill-slip .bs-total .bs-name { background: var(--surface-card); }
/* 无附表10记录备注:集中一行放表下(BILLS-SPEC §4),不进列头 */
.bs-missnote {
  margin-top: 6px;
  font-size: 11px;
  color: var(--hue-orange);
}

/* 收款公司徽标(BILLS-SPEC §5):非零金额格下方,短名;灰「未设置」;viewer/未关联户 .ro 禁点 */
.bs-co {
  display: inline-block;
  max-width: 110px;   /* 130px 定宽列内含 padding,徽标不撑列 */
  margin-top: 2px;
  padding: 1px 7px;
  border: none;
  border-radius: var(--radius-full);
  background: var(--bg-sunken);
  font-family: var(--font-sans);
  font-size: 10px;
  line-height: 1.5;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: pointer;
}
button.bs-co:hover { background: var(--bg-hover); color: var(--text-primary); }
.bs-co.unset { color: var(--text-disabled); }
.bs-co.ro { cursor: default; }
.bs-co-lbl { padding: 2px 8px 6px; font: var(--type-label); color: var(--text-muted); text-align: left; }
</style>
