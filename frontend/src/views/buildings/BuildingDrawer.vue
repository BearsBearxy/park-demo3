<script setup lang="ts">
import { ref, computed } from 'vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPContractStatus from '@/components/fp/FPContractStatus.vue'
import FPStat from '@/components/fp/FPStat.vue'
import FPSectionLabel from '@/components/fp/FPSectionLabel.vue'
import FPUnitMap from '@/components/fp/FPUnitMap.vue'
import Avatar from '@/components/ds/Avatar.vue'
import Button from '@/components/ds/Button.vue'
import { fpMoney, fpWan } from '@/utils/money'
import type { BuildingDTO, BuildingDetailDTO, UnitDTO } from '@/types/building'
import type { UnitDTO as MapUnit } from '@/components/fp/FPUnitMap.vue'

const props = defineProps<{
  open: boolean
  building: BuildingDTO | null
  detail: BuildingDetailDTO | null
}>()

const emit = defineEmits<{ close: [] }>()

const selUnit = ref<UnitDTO | null>(null)

// reset selection when drawer opens new building
// FPUnitMap 回传的就是本组件经 :building 传入的完整 UnitDTO,仅事件签名较窄,cast 回来
function onPick(u: MapUnit) { selUnit.value = u as UnitDTO }

// ponytail: derive tenant list from units — no extra API call
const tenants = computed(() => {
  if (!props.detail) return []
  const seen = new Set<number>()
  const result: { id: number; companyName: string; units: UnitDTO[]; rent: number }[] = []
  for (const u of props.detail.units) {
    if (u.tenantId == null || seen.has(u.tenantId)) continue
    seen.add(u.tenantId)
    const unitGroup = props.detail.units.filter(x => x.tenantId === u.tenantId)
    const rent = unitGroup.reduce((s, x) => s + (x.monthlyRent ?? 0), 0)
    result.push({ id: u.tenantId, companyName: u.companyName ?? '—', units: unitGroup, rent })
  }
  return result
})

const b = computed(() => props.building)
const units = computed(() => props.detail?.units ?? [])

// unit-status label map — mirrors FPUnitMap
const STATUS_LABEL: Record<string, string> = {
  occupied: '在租', expiring: '即将到期', reserved: '待入驻', vacant: '空置',
}

// contract status for selected unit (best active contract status label)
function selUnitContractStatus(u: UnitDTO): string {
  if (!u.tenantId) return 'vacant'
  // Infer from unit status
  return u.status === 'occupied' ? 'active' : u.status === 'expiring' ? 'expiring' : 'draft'
}

function resetSel() { selUnit.value = null }
</script>

<template>
  <FPDrawer
    :open="open"
    :title="b?.name ?? ''"
    :subtitle="b ? `${b.phaseName} · ${b.kind} · ${b.floorCount} 层` : ''"
    :icon="b?.phase === 4 ? 'bed-double' : 'building-2'"
    :width="640"
    @close="emit('close'); resetSel()"
  >
    <template #badge>
      <FPContractStatus v-if="b" :status="b.status === 1 ? 'active' : 'terminated'" />
    </template>

    <template #footer>
      <Button variant="gray" size="sm">
        <template #leading><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></template>
        编辑楼栋
      </Button>
      <Button variant="filled" size="sm">
        <template #leading><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg></template>
        新增合同
      </Button>
    </template>

    <!-- A: 6 FPStat grid -->
    <div v-if="b" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
      <FPStat
        label="出租率" tint="blue"
        :value="b.status === 0 ? '停用' : b.occRate + '%'"
        :sub="`${b.leasedArea.toLocaleString('en-US')} / ${b.rentableArea.toLocaleString('en-US')} ㎡`"
      />
      <FPStat
        label="在租单元" tint="slate"
        :value="`${b.occupiedCount}/${b.unitCount}`"
        :sub="`空置 ${b.vacantCount} · 待入驻 ${b.reservedCount}`"
      />
      <FPStat
        label="月租金" tint="sky"
        :value="fpWan(b.monthlyRent)"
        :sub="`${b.tenantIds.length} 户在租`"
      />
      <FPStat label="总面积" :value="b.totalArea.toLocaleString('en-US')" sub="㎡" />
      <FPStat label="可租面积" :value="b.rentableArea.toLocaleString('en-US')" sub="㎡" />
      <FPStat label="即将到期" :value="String(b.expiringCount)" sub="单元(90 天内)" />
    </div>

    <!-- B: Unit map -->
    <div v-if="detail">
      <FPSectionLabel icon="layout-grid">
        楼层单元图
        <template #right>
          <span style="font-size:11px;color:var(--text-disabled)">点击单元查看租户</span>
        </template>
      </FPSectionLabel>
      <FPUnitMap
        :building="{ units }"
        :selectedNo="selUnit?.unitNo ?? null"
        @pick="onPick"
      />
    </div>

    <!-- C: Selected unit panel -->
    <div
      v-if="selUnit"
      style="background:var(--surface-card);border-radius:var(--radius-lg);padding:14px 16px"
    >
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px" :style="{ marginBottom: selUnit.tenantId ? '10px' : '0' }">
        <span style="display:flex;align-items:center;gap:9px">
          <span style="font-family:var(--font-mono);font-size:14px;font-weight:var(--fw-semibold)">{{ selUnit.floor }}F-{{ selUnit.unitNo }}</span>
          <span style="font-size:12px;color:var(--text-muted);font-family:var(--font-mono)">{{ selUnit.area?.toLocaleString('en-US') }} ㎡</span>
        </span>
        <span style="font-size:12px;color:var(--text-muted)">{{ STATUS_LABEL[selUnit.status] }}</span>
      </div>
      <div v-if="selUnit.tenantId" style="display:flex;align-items:center;gap:10px">
        <Avatar :name="selUnit.companyName ?? ''" :size="32" />
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:var(--fw-medium)">{{ selUnit.companyName }}</div>
          <div style="font-size:11.5px;color:var(--text-muted)">
            {{ selUnit.businessType }} · {{ selUnit.contractNo ?? '—' }} · {{ fpMoney(selUnit.monthlyRent) }}/月
          </div>
        </div>
        <FPContractStatus :status="selUnitContractStatus(selUnit)" />
      </div>
      <div v-else style="font-size:12.5px;color:var(--text-muted)">
        该单元当前{{ STATUS_LABEL[selUnit.status] }}，可发起招商或新增合同。
      </div>
    </div>

    <!-- D: Tenant list -->
    <div>
      <FPSectionLabel icon="users">在租租户 · {{ tenants.length }}</FPSectionLabel>
      <div v-if="tenants.length === 0" style="font-size:13px;color:var(--text-disabled);padding:8px 0">暂无在租租户</div>
      <div v-else style="display:flex;flex-direction:column;gap:2px">
        <div
          v-for="t in tenants"
          :key="t.id"
          style="display:flex;align-items:center;gap:11px;padding:9px 8px;border-radius:var(--radius-sm)"
        >
          <Avatar :name="t.companyName" :size="30" />
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:var(--fw-medium)">{{ t.companyName }}</div>
            <div style="font-size:11.5px;color:var(--text-muted)">
              {{ t.units.map(u => u.unitNo).join('、') }} · {{ t.units.reduce((s, u) => s + (u.area ?? 0), 0).toLocaleString('en-US') }} ㎡
            </div>
          </div>
          <span style="font-family:var(--font-mono);font-size:12.5px;font-weight:var(--fw-semibold)">{{ fpMoney(t.rent) }}</span>
        </div>
      </div>
    </div>

    <!-- E: Remark -->
    <div v-if="b?.remark">
      <FPSectionLabel icon="sticky-note">备注</FPSectionLabel>
      <p style="margin:0;font-size:13px;color:var(--text-secondary);line-height:1.6">{{ b.remark }}</p>
    </div>
  </FPDrawer>
</template>
