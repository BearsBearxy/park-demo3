<script setup lang="ts">
import { computed } from 'vue'
import { iconFor } from '@/components/ds/icon'
import Avatar from '@/components/ds/Avatar.vue'
import FPContractStatus from '@/components/fp/FPContractStatus.vue'
import { fpWan } from '@/utils/money'
import type { BuildingDTO } from '@/types/building'

const props = defineProps<{ building: BuildingDTO }>()
const emit = defineEmits<{ open: [b: BuildingDTO] }>()

const IconComp = computed(() => iconFor(props.building.phase === 4 ? 'bed-double' : 'building-2'))

function occBarColor(rate: number) {
  return rate >= 90 ? 'var(--hue-blue)' : rate >= 75 ? 'var(--fill-slate)' : 'var(--hue-orange)'
}

// ponytail: tenant avatars — BuildingDTO has tenantIds (ids only), Avatar renders initials by id index
const shownIds = computed(() => props.building.tenantIds.slice(0, 4))
const extraCount = computed(() => Math.max(0, props.building.tenantIds.length - 4))
</script>

<template>
  <div
    class="bd-card"
    :style="{ opacity: building.status === 0 ? 0.72 : 1 }"
    @click="emit('open', building)"
    @mouseenter="($event.currentTarget as HTMLElement).style.cssText += 'box-shadow:0 8px 24px rgba(28,28,28,.10);transform:translateY(-2px)'"
    @mouseleave="($event.currentTarget as HTMLElement).style.cssText = ($event.currentTarget as HTMLElement).style.cssText.replace(/box-shadow:[^;]+;/,'').replace(/transform:[^;]+;/,'')"
  >
    <!-- Row 1: name + icon -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
      <div style="min-width:0">
        <div style="font-size:16px;font-weight:var(--fw-semibold);color:var(--text-primary)">{{ building.name }}</div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:5px">
          <FPContractStatus :status="building.status === 1 ? 'active' : 'terminated'" />
          <span style="font-size:var(--fs-label);color:var(--text-muted)">{{ building.kind }} · {{ building.floorCount }} 层 · {{ building.unitCount }} 单元</span>
        </div>
      </div>
      <span style="width:38px;height:38px;border-radius:11px;background:var(--surface-white);display:grid;place-items:center;color:var(--text-secondary);flex:0 0 auto">
        <component :is="IconComp" :size="19" />
      </span>
    </div>

    <!-- Row 2: occ rate bar -->
    <div>
      <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:6px">
        <span style="font-size:var(--fs-label);color:var(--text-muted)">出租率</span>
        <span style="font-size:15px;font-weight:var(--fw-semibold);font-family:var(--font-mono);color:var(--text-primary)">
          {{ building.status === 0 ? '停用' : building.occRate + '%' }}
        </span>
      </div>
      <div style="height:6px;border-radius:999px;background:var(--ink-040);overflow:hidden;width:100%">
        <div :style="{ width: building.occRate + '%', height: '100%', background: occBarColor(building.occRate), borderRadius: '999px', transition: 'width .3s var(--ease-standard)' }" />
      </div>
    </div>

    <!-- Row 3: stats grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px">
      <div>
        <div style="font-size:10.5px;color:var(--text-disabled)">可租面积</div>
        <div style="font-size:13px;font-weight:var(--fw-medium);font-family:var(--font-mono)">{{ building.rentableArea.toLocaleString('en-US') }}</div>
      </div>
      <div>
        <div style="font-size:10.5px;color:var(--text-disabled)">在租 / 空置</div>
        <div style="font-size:13px;font-weight:var(--fw-medium);font-family:var(--font-mono)">{{ building.occupiedCount }} / {{ building.vacantCount }}</div>
      </div>
      <div>
        <div style="font-size:10.5px;color:var(--text-disabled)">月租金</div>
        <div style="font-size:13px;font-weight:var(--fw-medium);font-family:var(--font-mono)">{{ fpWan(building.monthlyRent) }}</div>
      </div>
    </div>

    <!-- Row 4: avatars + expiry badge -->
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:12px;border-top:1px solid var(--divider)">
      <div style="display:flex;align-items:center">
        <span
          v-for="(id, i) in shownIds"
          :key="id"
          :style="{ marginLeft: i ? '-8px' : '0', borderRadius: '50%', boxShadow: '0 0 0 2px var(--surface-white)', display:'inline-flex' }"
        >
          <Avatar :name="String(id)" :size="26" />
        </span>
        <span
          v-if="extraCount > 0"
          style="margin-left:-8px;width:26px;height:26px;border-radius:50%;background:var(--surface-sunken);box-shadow:0 0 0 2px var(--surface-white);display:grid;place-items:center;font-size:11px;font-weight:var(--fw-semibold);color:var(--text-muted)"
        >+{{ extraCount }}</span>
      </div>
      <span
        v-if="building.expiringCount > 0"
        style="display:inline-flex;align-items:center;gap:5px;font-size:11.5px;color:rgb(168,98,0);background:rgba(255,149,0,.14);padding:3px 9px;border-radius:999px"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        {{ building.expiringCount }} 单元即将到期
      </span>
      <span v-else style="font-size:11.5px;color:var(--text-disabled)">{{ building.tenantIds.length }} 户在租</span>
    </div>
  </div>
</template>

<style scoped>
.bd-card {
  background: var(--surface-card);
  border-radius: var(--radius-xl);
  padding: 18px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border: 1px solid transparent;
  transition: box-shadow var(--dur-fast), transform var(--dur-fast);
}
</style>
