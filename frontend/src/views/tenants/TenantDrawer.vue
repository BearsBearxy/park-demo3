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
import { useAuthStore } from '@/stores/auth'
import { ask } from '@/utils/ask'
import { receipt } from '@/utils/receipt'

const auth = useAuthStore()

const props = defineProps<{
  open: boolean
  tenant: TenantDTO | null
}>()
const emit = defineEmits<{ close: []; edit: []; deleted: [] }>()

const detail = ref<TenantDetailDTO | null>(null)
const categoryMap = ref<Record<number, string>>({})

// ── 删除:ask(十件 ⑨)问过再删;失败报回执带「重试」(十件 ⑧),重试钉住当时那户 ──
const delBusy = ref(false)
async function askDelete() {
  const t = props.tenant
  if (!t || delBusy.value) return
  if (await ask({
    title: `删除「${t.companyName}」？`,
    body: '删除后不能撤销。有合同或台账记录的租户删不了，要先处理相关数据。',
    action: '删除租户',
    danger: true,
  })) await remove(t)
}
async function remove(t: TenantDTO) {
  if (delBusy.value) return
  delBusy.value = true
  try {
    await tenantApi.remove(t.id)
    emit('deleted')
  } catch (e) {
    const m = (e as { message?: string })?.message
    receipt.fail(m ? `删除租户失败：${m}` : '删除租户失败', { label: '重试', run: () => void remove(t) })
  } finally {
    delBusy.value = false
  }
}

watch(() => props.tenant, async (t) => {
  detail.value = null
  if (!t) return
  if (Object.keys(categoryMap.value).length === 0) {
    const cats: TenantCategoryDTO[] = await tenantApi.categories()
    categoryMap.value = Object.fromEntries(cats.map(c => [c.id, c.name]))
  }
  const d = await tenantApi.detail(t.id)
  if (props.tenant !== t) return   // 竞态守卫:快速换行时旧详情弃写(审计4)
  detail.value = d
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
      <Button v-if="auth.can('tenants:edit')" variant="danger" size="sm" :disabled="delBusy" @click="askDelete">
        <template #leading>
          <component :is="iconFor('trash-2')" :size="14" />
        </template>
        删除
      </Button>
      <Button v-if="auth.can('tenants:edit')" variant="gray" size="sm" @click="emit('edit')">
        <template #leading>
          <component :is="iconFor('pencil')" :size="14" />
        </template>
        编辑
      </Button>
      <!-- 新增合同=合同写(contracts:edit),与租户档案的 tenants:edit 分属两个权限点 -->
      <Button v-if="auth.can('contracts:edit')" variant="filled" size="sm">
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
          <div style="font-size:10.5px;color:var(--text-muted)">联系人</div>
          <div style="font-size:13px;font-weight:var(--fw-medium)">{{ tenant.contactName }}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:9px">
        <component :is="iconFor('phone')" :size="15" style="color:var(--text-muted);flex:0 0 auto" />
        <div>
          <div style="font-size:10.5px;color:var(--text-muted)">联系电话</div>
          <div style="font-size:13px;font-weight:var(--fw-medium);font-family:var(--font-mono)">{{ tenant.contactPhone }}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:9px">
        <component :is="iconFor('briefcase')" :size="15" style="color:var(--text-muted);flex:0 0 auto" />
        <div>
          <div style="font-size:10.5px;color:var(--text-muted)">所属分类</div>
          <div style="font-size:13px;font-weight:var(--fw-medium)">{{ categoryName }}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:9px">
        <component :is="iconFor('map-pin')" :size="15" style="color:var(--text-muted);flex:0 0 auto" />
        <div>
          <div style="font-size:10.5px;color:var(--text-muted)">主要单元</div>
          <div style="font-size:13px;font-weight:var(--fw-medium)">{{ tenant.primaryBuilding ?? '—' }}</div>
        </div>
      </div>
      <div v-if="tenant.parentName" style="display:flex;align-items:center;gap:9px;grid-column:1/-1">
        <component :is="iconFor('corner-down-right')" :size="15" style="color:var(--text-muted);flex:0 0 auto" />
        <div>
          <div style="font-size:10.5px;color:var(--text-muted)">关联主租户</div>
          <div style="font-size:13px;font-weight:var(--fw-medium)">{{ tenant.parentName }}</div>
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
    <!-- 详情在途:先按**已知条数**占位（加载态设计稿 §07）。
         tenant.contractCount 随列表行一起到，比 detail 早 —— 所以这里能画准，
         详情落位时抽屉不长高。区间守卫是防脏数据把抽屉撑爆／占不满。 -->
    <div v-if="!detail && tenant">
      <FPSectionLabel icon="file-text">合同历史</FPSectionLabel>
      <div style="display:flex;flex-direction:column;gap:6px">
        <div
          v-for="i in Math.min(6, Math.max(1, tenant.contractCount))"
          :key="'sk-' + i"
          aria-hidden="true"
          style="display:flex;align-items:center;gap:11px;padding:10px 12px;background:var(--surface-card);border-radius:var(--radius-md)"
        >
          <div style="flex:1;min-width:0">
            <span class="fp-shim" style="display:block;width:44%;height:12.5px"></span>
            <span class="fp-shim" style="display:block;width:68%;height:11.5px;margin-top:5px"></span>
          </div>
          <span class="fp-shim" style="display:block;width:62px;height:12.5px"></span>
        </div>
      </div>
    </div>
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
