<script setup lang="ts">
import { computed } from 'vue'
import { Clock } from 'lucide-vue-next'
import { UNIT_STATUS } from './unitStatus'

export interface UnitDTO {
  id: number
  floor: number
  unitNo: string
  area: number | null
  status: 'occupied' | 'expiring' | 'reserved' | 'vacant'
  tenantId?: number | null
  companyName?: string | null
}

interface Props {
  building: { units: UnitDTO[] }
  selectedNo?: string | null
}

const props = defineProps<Props>()
const emit = defineEmits<{ pick: [unit: UnitDTO] }>()

const byFloor = computed(() => {
  const map: Record<number, UnitDTO[]> = {}
  for (const u of props.building.units) {
    ;(map[u.floor] ??= []).push(u)
  }
  return map
})

const floors = computed(() =>
  Object.keys(byFloor.value).map(Number).sort((a, b) => b - a)
)
</script>

<template>
  <div>
    <!-- legend -->
    <div class="fp-legend" style="margin-bottom:12px">
      <span v-for="(info, k) in UNIT_STATUS" :key="k" class="lg">
        <span
          class="sw"
          :style="{
            background: info.sw,
            border:
              k === 'vacant'   ? '1px dashed var(--border-strong)' :
              k === 'reserved' ? '1px dashed rgba(50,173,230,.5)'  : 'none',
          }"
        />
        {{ info.label }}
      </span>
    </div>

    <!-- stacked floor map -->
    <div class="fp-stack">
      <div v-for="f in floors" :key="f" class="fp-stack-row">
        <div class="fp-stack-flr">{{ f }}F</div>
        <div class="fp-stack-units">
          <div
            v-for="u in byFloor[f]"
            :key="u.id"
            class="fp-unit"
            :class="[u.status, { sel: selectedNo === u.unitNo }]"
            @click="emit('pick', u)"
          >
            <span class="u-no">
              <span>{{ u.unitNo }}</span>
              <Clock v-if="u.status === 'expiring'" :size="12" />
            </span>
            <span class="u-nm">
              {{ u.companyName ?? UNIT_STATUS[u.status]?.label }}
            </span>
            <span class="u-ar">
              {{ u.area != null ? Number(u.area).toLocaleString('zh-CN') + ' ㎡' : '' }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ponytail: styles ported 1:1 from fp-master-ui.jsx injectMasterStyles() */
.fp-legend { display:flex; align-items:center; gap:16px; flex-wrap:wrap; }
.fp-legend .lg { display:inline-flex; align-items:center; gap:6px; font-size:var(--fs-label); color:var(--text-muted); }
.fp-legend .sw { width:13px; height:13px; border-radius:4px; flex:0 0 auto; }

.fp-stack { display:flex; flex-direction:column; gap:6px; }
.fp-stack-row { display:flex; align-items:stretch; gap:8px; }
.fp-stack-flr {
  flex:0 0 auto; width:38px;
  display:flex; align-items:center; justify-content:center;
  font-family:var(--font-mono); font-size:12px; font-weight:var(--fw-semibold);
  color:var(--text-muted); background:var(--surface-card); border-radius:var(--radius-sm);
}
.fp-stack-units { flex:1 1 auto; min-width:0; display:flex; gap:8px; }

.fp-unit {
  flex:1 1 0; min-width:88px; border-radius:10px; padding:8px 10px;
  cursor:pointer; display:flex; flex-direction:column; gap:3px;
  border:1px solid transparent;
  transition:transform var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast);
  box-sizing:border-box;
}
.fp-unit:hover { transform:translateY(-1px); box-shadow:0 4px 14px rgba(28,28,28,.10); }

.fp-unit.occupied { background:var(--accent-slate); color:rgb(64,84,124); }
.fp-unit.occupied .u-no { color:rgb(48,66,104); }
.fp-unit.expiring  { background:rgba(255,149,0,.16); color:rgb(168,98,0); }
.fp-unit.reserved  { background:var(--accent-cyan); color:rgb(22,118,160); border:1px dashed rgba(50,173,230,.5); }
.fp-unit.vacant    { background:transparent; color:var(--text-disabled); border:1px dashed var(--border-strong); }
.fp-unit.sel       { outline:2px solid var(--ink-900); outline-offset:1px; }

.fp-unit .u-no {
  font-family:var(--font-mono); font-size:12px; font-weight:var(--fw-semibold);
  display:flex; align-items:center; justify-content:space-between; gap:6px;
}
.fp-unit .u-nm { font-size:11.5px; line-height:1.25; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.fp-unit .u-ar { font-size:10.5px; font-family:var(--font-mono); opacity:.7; }
</style>
