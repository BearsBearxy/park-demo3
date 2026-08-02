<script setup lang="ts">
import { ref, computed, watch, onMounted, h } from 'vue'
import { tenantApi } from '@/api/tenant'
import { invalidateAnaCache } from '@/analysis/anaData'
import { fpSortRows } from '@/components/fp/fpSort'
import type { SortState } from '@/components/fp/fpSort'
import type { TenantDTO, TenantSummaryDTO } from '@/types/tenant'
import { fpMoney, fpWan } from '@/utils/money'
import KpiCard from '@/components/ds/KpiCard.vue'
import Button from '@/components/ds/Button.vue'
import Card from '@/components/ds/Card.vue'
import Avatar from '@/components/ds/Avatar.vue'
import Select from '@/components/ds/Select.vue'
import Badge from '@/components/ds/Badge.vue'
import FPPhaseTabs from '@/components/fp/FPPhaseTabs.vue'
import FPSortableTable from '@/components/fp/FPSortableTable.vue'
import { useFitRows } from '@/components/fp/useFitRows'
import FPPager from '@/components/fp/FPPager.vue'
import FPTenantStatus from '@/components/fp/FPTenantStatus.vue'
import { familySort } from './tenantsFamily'
import TenantDrawer from './TenantDrawer.vue'
import TenantNewDialog from './TenantNewDialog.vue'
import { iconFor } from '@/components/ds/icon'

// ponytail: industryTone config — 1:1 from screen-tenants.jsx comments
const INDUSTRY_TONE: Record<string, 'blue' | 'slate' | 'cyan' | 'orange' | 'neutral'> = {
  '智能制造': 'blue', '精密机械': 'slate', '电子信息': 'cyan', '生物医药': 'blue',
  '新材料': 'slate', '仓储物流': 'cyan', '包装印刷': 'orange', '光电': 'blue',
  '纺织': 'orange', '食品': 'cyan', '配套服务': 'neutral',
}
function industryTone(bt: string) { return INDUSTRY_TONE[bt] ?? 'neutral' }

// ─── state ───────────────────────────────────────────────
const tenants = ref<TenantDTO[]>([])
const summary = ref<TenantSummaryDTO | null>(null)
const phase = ref<string | number>('all')
const q = ref('')
const statusFilter = ref('全部状态')
// 默认 sort=null → 家族聚合名称序视图;点列头进普通排序,列头「取消排序」回到聚合视图(spec §T2)
const sort = ref<SortState | null>(null)
const page = ref(1)
const tableWrapEl = ref<HTMLElement | null>(null)
const pageSize = useFitRows(tableWrapEl)   // 自适应每页行数:正好填满卡片,不滚动直接翻页

const openTenant = ref<TenantDTO | null>(null)
const newDlg = ref(false)
const editDlg = ref(false)

async function reload() {
  ;[tenants.value, summary.value] = await Promise.all([tenantApi.list(), tenantApi.summary()])
}
onMounted(reload)

// 新增成功 → 关弹窗并重拉 list+summary;租户 CRUD 使分析层缓存失效(派生审计病根B)
async function onTenantCreated() {
  newDlg.value = false
  invalidateAnaCache()
  await reload()
}

// 编辑成功 → 关弹窗、重拉后用新列表行刷新 drawer(drawer 展示的 DTO 来自列表行)
async function onTenantUpdated() {
  const id = openTenant.value?.id
  editDlg.value = false
  invalidateAnaCache()
  await reload()
  if (id != null) openTenant.value = tenants.value.find(t => t.id === id) ?? null
}

// 删除成功 → 关 drawer 并重拉 list+summary
async function onTenantDeleted() {
  openTenant.value = null
  invalidateAnaCache()
  await reload()
}

// ─── computed ─────────────────────────────────────────────
const phaseCounts = computed(() => {
  const c: Record<string | number, number> = { all: tenants.value.length, 1: 0, 2: 0, 3: 0, 4: 0 }
  for (const t of tenants.value) c[t.phase] = (c[t.phase] ?? 0) + 1
  return c
})

const STATUS_MAP: Record<string, number> = { '在租': 1, '已退租': 2, '黑名单': 0 }

const filtered = computed(() =>
  tenants.value
    .filter(t => phase.value === 'all' || t.phase === phase.value)
    .filter(t => statusFilter.value === '全部状态' || t.status === STATUS_MAP[statusFilter.value])
    // 联系人/电话可空(新增租户选填),?? 兜底防 null.includes 炸
    .filter(t => !q.value.trim() || t.companyName.includes(q.value.trim()) || (t.contactName ?? '').includes(q.value.trim()) || (t.contactPhone ?? '').includes(q.value.trim()))
)

// root → 子数(全量口径,不随过滤变),供名称旁「+N」徽标
const childCount = computed(() => {
  const m = new Map<number, number>()
  for (const t of tenants.value) if (t.parentId != null) m.set(t.parentId, (m.get(t.parentId) ?? 0) + 1)
  return m
})

const TABLE_COLUMNS = computed(() => [
  {
    key: 'companyName', header: '企业名称',
    sortValue: (r: TenantDTO) => r.companyName,
    render: (r: TenantDTO) => {
      const isChild = r.parentName != null
      const kids = childCount.value.get(r.id) ?? 0
      // 长名防撑宽:外包 max-width:240px 容器 + title 出全文(spec 表格溢出治理 §W1)
      return h('span', { title: r.companyName, style: { display: 'flex', alignItems: 'center', gap: '10px', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingLeft: isChild ? '16px' : undefined } }, [
        // 子租户:「└」前缀+缩进,标出从属关系(spec §T2)
        isChild ? h('span', { style: { color: 'var(--text-disabled)', flex: '0 0 auto' } }, '└') : null,
        h(Avatar, { name: r.companyName, size: 30 }),
        h('span', { style: { display: 'flex', flexDirection: 'column', minWidth: 0 } }, [
          h('span', { style: { display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 } }, [
            h('span', { style: { fontWeight: 'var(--fw-medium)', color: 'var(--text-primary)', whiteSpace: 'nowrap', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' } }, r.companyName),
            // root 有子:「+N」小徽标(N=子数,全量口径)
            kids > 0 ? h('span', { style: { flex: '0 0 auto', fontSize: 'var(--fs-micro)', color: 'var(--text-secondary)', background: 'var(--bg-sunken)', borderRadius: 'var(--radius-full)', padding: '1px 6px' } }, `+${kids}`) : null,
          ]),
          // 次行:子租户显示关联的主租户(同受 max-width 约束截断),否则显示编号
          r.parentName
            ? h('span', { style: { fontSize: 'var(--fs-micro)', color: 'var(--text-disabled)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, `关联:${r.parentName}`)
            : h('span', { style: { fontSize: 'var(--fs-micro)', color: 'var(--text-disabled)', fontFamily: 'var(--font-mono)' } }, `FP-T-${1000 + r.id}`),
        ]),
      ])
    },
  },
  {
    key: 'contactName', header: '联系人', width: '84px',
    render: (r: TenantDTO) => h('span', { style: { color: 'var(--text-secondary)' } }, r.contactName),
  },
  {
    key: 'contactPhone', header: '联系电话', width: '134px', mono: true,
    render: (r: TenantDTO) => h('span', { style: { color: 'var(--text-muted)', fontSize: '12px' } }, r.contactPhone),
  },
  {
    key: 'businessType', header: '经营类型', width: '108px',
    render: (r: TenantDTO) => h(Badge, { tone: industryTone(r.businessType), variant: 'subtle' }, () => r.businessType),
  },
  {
    key: 'primaryBuilding', header: '所在楼栋', width: '150px',
    sortValue: (r: TenantDTO) => r.primaryBuilding ?? '',
    render: (r: TenantDTO) => h('span', { style: { color: 'var(--text-secondary)', whiteSpace: 'nowrap', fontSize: '12.5px' } }, r.primaryBuilding ?? '—'),
  },
  {
    key: 'monthlyRent', header: '月租金', width: '108px', align: 'right' as const, mono: true,
    sortValue: (r: TenantDTO) => r.monthlyRent,
    render: (r: TenantDTO) => h('span', { style: { fontWeight: 'var(--fw-semibold)', color: r.monthlyRent ? 'var(--text-primary)' : 'var(--text-disabled)' } }, fpMoney(r.monthlyRent)),
  },
  {
    key: 'contractCount', header: '合同', width: '64px', align: 'right' as const, mono: true,
    sortValue: (r: TenantDTO) => r.contractCount,
    render: (r: TenantDTO) => h('span', { style: { color: 'var(--text-muted)' } }, String(r.contractCount)),
  },
  {
    key: 'status', header: '状态', width: '84px',
    render: (r: TenantDTO) => h(FPTenantStatus, { status: r.status }),
  },
])

// sort=null → 家族聚合名称序(默认视图);有 sort → 普通全表排序(聚合让位)
const sortedFiltered = computed(() =>
  sort.value ? fpSortRows(filtered.value, sort.value, TABLE_COLUMNS.value) : familySort(filtered.value),
)
const pageCount = computed(() => Math.max(1, Math.ceil(sortedFiltered.value.length / pageSize.value)))
const safePage = computed(() => Math.min(page.value, pageCount.value))
const paged = computed(() => sortedFiltered.value.slice((safePage.value - 1) * pageSize.value, safePage.value * pageSize.value))

watch([phase, q, statusFilter, sort], () => { page.value = 1 })
</script>

<template>
  <div style="display:flex;flex-direction:column;gap:20px;max-width:1600px;margin:0 auto;width:100%;height:100%">
    <!-- 1. Title row -->
    <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap">
      <div>
        <h2 style="margin:0;font-size:var(--fs-h2);font-weight:var(--fw-semibold)">租户管理</h2>
        <p style="margin:5px 0 0;font-size:var(--fs-label);color:var(--text-muted)">
          在租租户档案 · 主数据 · 共 {{ summary ? tenants.length : '…' }} 户
        </p>
      </div>
      <div style="display:flex;gap:8px">
        <!-- ponytail: 租户导入未实现,按钮显式 disabled(诚实),避免可点无响应 -->
        <span title="导入开发中">
          <Button variant="outline" size="sm" disabled>
            <template #leading>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            </template>
            导入
          </Button>
        </span>
        <Button variant="filled" size="sm" @click="newDlg = true">
          <template #leading>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </template>
          新增租户
        </Button>
      </div>
    </div>

    <!-- data body: gated on first load so we never flash empty KPIs / 共0户 / 没有匹配 -->
    <template v-if="summary">
    <!-- 2. KPI 左栏 + 主内容(spec 表格溢出治理 §3,三屏统一样式) -->
    <div class="mx-body">
    <aside class="mx-kpirail">
      <KpiCard label="在租租户" :value="String(summary.tenantActive)" tint="slate" :style="{ padding: '20px' }">
        <template #icon><component :is="iconFor('users')" :size="16" /></template>
      </KpiCard>
      <KpiCard label="园区出租率" :value="`${summary.occRate}%`" tint="sky" :style="{ padding: '20px' }">
        <template #icon><component :is="iconFor('building-2')" :size="16" /></template>
      </KpiCard>
      <KpiCard label="月租金合计" :value="fpWan(summary.monthlyRent)" tint="blue" :style="{ padding: '20px' }">
        <template #icon><component :is="iconFor('coins')" :size="16" /></template>
      </KpiCard>
      <KpiCard label="合同将到期" :value="String(summary.expiringTenants)" delta="户需续签" trend="down" tint="cyan" :style="{ padding: '20px' }">
        <template #icon><component :is="iconFor('clock')" :size="16" /></template>
      </KpiCard>
    </aside>
    <div class="mx-main">

    <!-- 3. Phase tabs + toolbar(spec §2:单行,tabs 左 / 搜索+Select 右,样式收编 mx-list.css) -->
    <div class="mx-toolbar">
      <FPPhaseTabs v-model="phase" :counts="phaseCounts" />
      <div class="mx-toolbar-right">
        <div class="mx-search">
          <span class="mx-search-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </span>
          <input v-model="q" placeholder="搜索企业 / 联系人 / 电话" />
        </div>
        <div style="width:130px">
          <Select :options="['全部状态', '在租', '已退租', '黑名单']" v-model="statusFilter" size="sm" />
        </div>
      </div>
    </div>

    <!-- 4. Table card(spec §3:卡片定高 flex column,分页器停靠卡片内底部) -->
    <Card surface="white" :padding="0" class="mx-listcard">
      <div ref="tableWrapEl" class="mx-tablewrap">
        <FPSortableTable
          :columns="TABLE_COLUMNS"
          :rows="paged"
          rowKey="id"
          :sort="sort"
          :rowHover="true"
          @sortChange="sort = $event"
          @rowClick="openTenant = $event"
        />
      </div>
      <div v-if="filtered.length === 0" style="text-align:center;padding:40px;color:var(--text-disabled)">没有匹配的租户</div>
      <!-- 5. Pager(spec §5:.mx-pagerbar 贴卡片底边;0 行时整条隐藏,不留孤立分隔线) -->
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
    </div>
    </template>
    <div v-else class="page-loading"><span class="page-spin" /></div>

    <!-- 6. Drawer -->
    <TenantDrawer
      :open="!!openTenant"
      :tenant="openTenant"
      @close="openTenant = null"
      @edit="editDlg = true"
      @deleted="onTenantDeleted"
    />

    <!-- 7. 新增租户弹窗 -->
    <TenantNewDialog v-if="newDlg" @close="newDlg = false" @created="onTenantCreated" />

    <!-- 8. 编辑租户弹窗(复用新增弹窗,initial=编辑态) -->
    <TenantNewDialog v-if="editDlg && openTenant" :initial="openTenant"
                     @close="editDlg = false" @updated="onTenantUpdated" />
  </div>
</template>
