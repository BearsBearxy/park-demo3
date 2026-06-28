<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { tenantApi } from '@/api/tenant'
import type { TenantDTO, TenantDetailDTO, ContractHistoryDTO, TenantCategoryDTO } from '@/types/tenant'
import { fpMoney } from '@/utils/money'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPStat from '@/components/fp/FPStat.vue'
import FPSectionLabel from '@/components/fp/FPSectionLabel.vue'
import FPContractStatus from '@/components/fp/FPContractStatus.vue'
import FPTenantStatus from '@/components/fp/FPTenantStatus.vue'
import Badge from '@/components/ds/Badge.vue'
import Button from '@/components/ds/Button.vue'
import { iconFor } from '@/components/ds/icon'

const props = defineProps<{
  open: boolean
  tenant: TenantDTO | null
}>()
const emit = defineEmits<{ close: [] }>()

const detail = ref<TenantDetailDTO | null>(null)
const categoryMap = ref<Record<number, string>>({})

watch(() => props.tenant, async (t) => {
  detail.value = null
  if (!t) return
  if (Object.keys(categoryMap.value).length === 0) {
    const cats: TenantCategoryDTO[] = await tenantApi.categories()
    categoryMap.value = Object.fromEntries(cats.map(c => [c.id, c.name]))
  }
  detail.value = await tenantApi.detail(t.id)
}, { immediate: true })

const categoryName = computed(() =>
  props.tenant?.categoryId != null ? (categoryMap.value[props.tenant.categoryId] ?? '—') : '—'
)

// ponytail: industryTone config — same map as TenantsView
const INDUSTRY_TONE: Record<string, 'blue' | 'slate' | 'cyan' | 'orange' | 'neutral'> = {
  '智能制造': 'blue', '精密机械': 'slate', '电子信息': 'cyan', '生物医药': 'blue',
  '新材料': 'slate', '仓储物流': 'cyan', '包装印刷': 'orange', '光电': 'blue',
  '纺织': 'orange', '食品': 'cyan', '配套服务': 'neutral',
}
function industryTone(bt: string) { return INDUSTRY_TONE[bt] ?? 'neutral' }

const ACTIVE_STATUSES = new Set(['active', 'expiring', 'draft'])

const contracts = computed(() => {
  if (!detail.value) return []
  return [...detail.value.contracts].sort((a, b) =>
    (a.startDate ?? '') < (b.startDate ?? '') ? 1 : -1
  )
})

const currentCount = computed(() =>
  contracts.value.filter(c => ACTIVE_STATUSES.has(c.status as string)).length
)

const subtitle = computed(() => {
  const t = props.tenant
  if (!t) return ''
  return `FP-T-${1000 + t.id} · 入驻 ${t.since ?? '—'}`
})
</script>

<template>
  <FPDrawer
    :open="open"
    :title="tenant?.companyName ?? ''"
    :subtitle="subtitle"
    icon="building"
    :width="620"
    @close="emit('close')"
  >
    <template #badge>
      <FPTenantStatus v-if="tenant" :status="tenant.status" />
      <Badge v-if="tenant" :tone="industryTone(tenant.businessType)" variant="subtle">
        {{ tenant.businessType }}
      </Badge>
    </template>

    <template #footer>
      <Button variant="gray" size="sm">
        <template #leading>
          <component :is="iconFor('pencil')" :size="14" />
        </template>
        编辑档案
      </Button>
      <Button variant="filled" size="sm">
        <template #leading>
          <component :is="iconFor('plus')" :size="14" />
        </template>
        新增合同
      </Button>
    </template>

    <!-- 联系信息 2×2 grid -->
    <div v-if="tenant" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;background:var(--surface-card);border-radius:var(--radius-lg);padding:14px 16px">
      <div style="display:flex;align-items:center;gap:9px">
        <component :is="iconFor('user')" :size="15" style="color:var(--text-muted);flex:0 0 auto" />
        <div>
          <div style="font-size:10.5px;color:var(--text-disabled)">联系人</div>
          <div style="font-size:13px;font-weight:var(--fw-medium)">{{ tenant.contactName }}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:9px">
        <component :is="iconFor('phone')" :size="15" style="color:var(--text-muted);flex:0 0 auto" />
        <div>
          <div style="font-size:10.5px;color:var(--text-disabled)">联系电话</div>
          <div style="font-size:13px;font-weight:var(--fw-medium);font-family:var(--font-mono)">{{ tenant.contactPhone }}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:9px">
        <component :is="iconFor('briefcase')" :size="15" style="color:var(--text-muted);flex:0 0 auto" />
        <div>
          <div style="font-size:10.5px;color:var(--text-disabled)">所属分类</div>
          <div style="font-size:13px;font-weight:var(--fw-medium)">{{ categoryName }}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:9px">
        <component :is="iconFor('map-pin')" :size="15" style="color:var(--text-muted);flex:0 0 auto" />
        <div>
          <div style="font-size:10.5px;color:var(--text-disabled)">主要单元</div>
          <div style="font-size:13px;font-weight:var(--fw-medium)">{{ tenant.primaryBuilding ?? '—' }}</div>
        </div>
      </div>
    </div>

    <!-- 3 FPStat -->
    <div v-if="tenant" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
      <FPStat label="月租金" :value="fpMoney(tenant.monthlyRent)" tint="blue" />
      <FPStat label="在租面积" :value="tenant.leasedArea.toLocaleString('en-US')" sub="㎡" tint="slate" />
      <FPStat label="当前合同" :value="String(currentCount)" :sub="`累计 ${tenant.contractCount} 份`" tint="sky" />
    </div>

    <!-- 合同历史 -->
    <div v-if="detail">
      <FPSectionLabel icon="file-text">合同历史 · {{ contracts.length }}</FPSectionLabel>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div
          v-for="c in contracts"
          :key="c.contractNo"
          style="display:flex;align-items:center;gap:11px;padding:10px 12px;background:var(--surface-card);border-radius:var(--radius-md)"
        >
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-family:var(--font-mono);font-size:12.5px;font-weight:var(--fw-medium)">{{ c.contractNo }}</span>
              <FPContractStatus :status="c.status" />
            </div>
            <div style="font-size:11.5px;color:var(--text-muted);margin-top:3px">
              {{ c.buildingName }} {{ c.floorInfo }} · {{ c.startDate ? c.startDate + ' → ' + c.endDate : '待签约' }}
            </div>
          </div>
          <span style="font-family:var(--font-mono);font-size:12.5px;font-weight:var(--fw-semibold)">{{ fpMoney(c.monthlyRent) }}</span>
        </div>
        <div v-if="contracts.length === 0" style="padding:16px;text-align:center;color:var(--text-disabled);font-size:13px">暂无合同记录</div>
      </div>
    </div>

    <!-- 备注 -->
    <div v-if="tenant?.remark">
      <FPSectionLabel icon="sticky-note">备注</FPSectionLabel>
      <p style="margin:0;font-size:13px;color:var(--text-secondary);line-height:1.6">{{ tenant.remark }}</p>
    </div>

    <!-- ponytail: 账单概览(近4月) deferred to P2 — no bill data source until 账单/ledger subsystem is built -->

  </FPDrawer>
</template>
