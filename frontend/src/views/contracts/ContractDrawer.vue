<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { contractApi } from '@/api/contract'
import type { ContractDTO, ContractDetailDTO } from '@/types/contract'
import { fpMoney, fpWan } from '@/utils/money'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPStat from '@/components/fp/FPStat.vue'
import FPSectionLabel from '@/components/fp/FPSectionLabel.vue'
import FPContractStatus from '@/components/fp/FPContractStatus.vue'
import FPTenantStatus from '@/components/fp/FPTenantStatus.vue'
import Avatar from '@/components/ds/Avatar.vue'
import Button from '@/components/ds/Button.vue'
import { iconFor } from '@/components/ds/icon'

const props = defineProps<{
  open: boolean
  contract: ContractDTO | null
}>()
const emit = defineEmits<{ close: [] }>()

const detail = ref<ContractDetailDTO | null>(null)

watch(() => props.contract, async (c) => {
  detail.value = null
  if (c) detail.value = await contractApi.detail(c.id)
})

// ponytail: ctTimeline ported 1:1 from screen-contracts.jsx ctTimeline()
function ctTimeline(c: ContractDTO) {
  if (c.status === 'draft') {
    return [
      { state: 'now',     t: '创建草稿',  m: '合同已起草,待确认条款' },
      { state: 'pending', t: '待签约',    m: '签约日期未定' },
      { state: 'pending', t: '待生效',    m: '起止日期未定' },
    ]
  }
  const steps: { state: string; t: string; m: string }[] = [
    { state: 'done', t: '签约', m: c.signDate  || '—' },
    { state: 'done', t: '生效', m: c.startDate || '—' },
  ]
  if (c.status === 'active') {
    const elapsed = Math.max(0, c.termMonths - Math.round((c.daysToEnd ?? 0) / 30.44))
    steps.push({ state: 'now',     t: '执行中',  m: `已执行约 ${elapsed} 个月 · 距到期 ${c.daysToEnd} 天` })
    steps.push({ state: 'pending', t: '到期',    m: c.endDate || '—' })
  } else if (c.status === 'expiring') {
    steps.push({ state: 'now',     t: '即将到期', m: `剩余 ${c.daysToEnd} 天 · 建议尽快续签` })
    steps.push({ state: 'pending', t: '到期',    m: c.endDate || '—' })
  } else if (c.status === 'expired') {
    steps.push({ state: 'end', t: '已到期', m: c.endDate || '—' })
  } else if (c.status === 'terminated') {
    steps.push({ state: 'end', t: '已终止', m: (c.endDate || '—') + ' · 提前解约' })
  }
  return steps
}

const steps = computed(() => props.contract ? ctTimeline(props.contract) : [])

const subtitle = computed(() => {
  const c = props.contract
  const biz = detail.value?.tenant.businessType ?? ''
  if (!c) return ''
  return `${c.buildingName}${c.floorInfo ? ' ' + c.floorInfo : ''} · ${biz}`
})

const totalValue = computed(() => {
  const c = props.contract
  return c && c.monthlyRent && c.termMonths ? c.monthlyRent * c.termMonths : 0
})
</script>

<template>
  <FPDrawer
    :open="open"
    :title="contract?.contractNo ?? ''"
    :subtitle="subtitle"
    icon="file-text"
    :width="600"
    @close="emit('close')"
  >
    <template #badge>
      <FPContractStatus v-if="contract" :status="contract.status" />
    </template>

    <template #footer>
      <!-- draft -->
      <template v-if="contract?.status === 'draft'">
        <Button variant="gray" size="sm">
          <template #leading><component :is="iconFor('pencil')" :size="14" /></template>
          编辑
        </Button>
        <Button variant="filled" size="sm">
          <template #leading><component :is="iconFor('check')" :size="14" /></template>
          确认生效
        </Button>
      </template>
      <!-- expired / terminated -->
      <template v-else-if="contract?.status === 'expired' || contract?.status === 'terminated'">
        <Button variant="gray" size="sm">
          <template #leading><component :is="iconFor('archive')" :size="14" /></template>
          归档
        </Button>
        <Button variant="filled" size="sm">
          <template #leading><component :is="iconFor('rotate-ccw')" :size="14" /></template>
          续签新约
        </Button>
      </template>
      <!-- active / expiring -->
      <template v-else>
        <Button variant="borderless" size="sm">
          <template #leading><component :is="iconFor('x-circle')" :size="14" /></template>
          终止
        </Button>
        <Button variant="gray" size="sm">
          <template #leading><component :is="iconFor('pencil')" :size="14" /></template>
          编辑
        </Button>
        <Button variant="filled" size="sm">
          <template #leading><component :is="iconFor('rotate-ccw')" :size="14" /></template>
          续签
        </Button>
      </template>
    </template>

    <template v-if="contract">
      <!-- 1. 租户卡 -->
      <div style="display:flex;align-items:center;gap:12px;background:var(--surface-card);border-radius:var(--radius-lg);padding:13px 15px">
        <Avatar :name="contract.tenantName" :size="40" />
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:var(--fw-semibold)">{{ contract.tenantName }}</div>
          <div style="font-size:12px;color:var(--text-muted)">
            {{ detail ? `${detail.tenant.contactName} · ${detail.tenant.contactPhone}` : '—' }}
          </div>
        </div>
        <FPTenantStatus v-if="detail" :status="detail.tenant.status" />
      </div>

      <!-- 2. 3×FPStat -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px">
        <FPStat label="月租金" :value="fpMoney(contract.monthlyRent)" tint="blue" />
        <FPStat label="租赁面积" :value="contract.rentArea.toLocaleString('en-US')" sub="㎡" tint="slate" />
        <FPStat label="押金" :value="fpMoney(contract.deposit)" :sub="contract.status === 'draft' ? '待收' : '已收'" tint="sky" />
      </div>

      <!-- 3. 生命周期时间线 -->
      <div>
        <FPSectionLabel icon="git-commit-horizontal">合同生命周期</FPSectionLabel>
        <div class="fp-tl">
          <div v-for="(s, i) in steps" :key="i" class="fp-tl-step">
            <div class="fp-tl-rail">
              <span class="fp-tl-dot" :class="{ done: s.state === 'done', now: s.state === 'now', end: s.state === 'end' }"></span>
              <span v-if="i < steps.length - 1" class="fp-tl-line" :class="{ done: s.state === 'done' }"></span>
            </div>
            <div class="fp-tl-body">
              <div class="fp-tl-t">{{ s.t }}</div>
              <div class="fp-tl-m">{{ s.m }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 4. 合同明细 -->
      <div>
        <FPSectionLabel icon="list">合同明细</FPSectionLabel>
        <div class="fp-field"><span class="k">租户</span><span class="v">{{ contract.tenantName }}</span></div>
        <div class="fp-field"><span class="k">楼栋</span><span class="v">{{ contract.buildingName }}</span></div>
        <div class="fp-field"><span class="k">楼层 / 房号</span><span class="v mono">{{ contract.floorInfo || '—' }}</span></div>
        <div class="fp-field"><span class="k">租赁面积</span><span class="v mono">{{ contract.rentArea.toLocaleString('en-US') }} ㎡</span></div>
        <div class="fp-field"><span class="k">月租金</span><span class="v mono">{{ fpMoney(contract.monthlyRent) }}</span></div>
        <div class="fp-field"><span class="k">押金</span><span class="v mono">{{ fpMoney(contract.deposit) }}</span></div>
        <div class="fp-field"><span class="k">签约日期</span><span class="v mono">{{ contract.signDate || '待签约' }}</span></div>
        <div class="fp-field"><span class="k">租赁期间</span><span class="v mono">{{ contract.startDate ? contract.startDate + ' → ' + contract.endDate : '待定' }}</span></div>
        <div class="fp-field"><span class="k">租期</span><span class="v mono">{{ contract.termMonths ? contract.termMonths + ' 个月' : '—' }}</span></div>
        <div v-if="totalValue" class="fp-field"><span class="k">合同总额</span><span class="v mono">{{ fpWan(totalValue) }}</span></div>
      </div>

      <!-- 5. 备注 -->
      <div v-if="contract.remark">
        <FPSectionLabel icon="sticky-note">备注</FPSectionLabel>
        <p style="margin:0;font-size:13px;color:var(--text-secondary);line-height:1.6">{{ contract.remark }}</p>
      </div>
    </template>
  </FPDrawer>
</template>

<style scoped>
/* fp-field / fp-tl classes come from fp-master-ui injectMasterStyles (global) — ponytail: no re-def needed */
/* scoped fallback for fp-field in case global styles not injected */
.fp-field { display:flex; align-items:baseline; justify-content:space-between; gap:16px; padding:7px 0; border-bottom:1px dashed var(--divider); }
.fp-field:last-child { border-bottom:none; }
.fp-field .k { font-size:var(--fs-label); color:var(--text-muted); white-space:nowrap; flex:0 0 auto; }
.fp-field .v { font-size:var(--fs-body); color:var(--text-primary); text-align:right; min-width:0; }
.fp-field .v.mono { font-family:var(--font-mono); }

.fp-tl { display:flex; flex-direction:column; gap:0; }
.fp-tl-step { display:flex; gap:12px; }
.fp-tl-rail { flex:0 0 auto; display:flex; flex-direction:column; align-items:center; }
.fp-tl-dot { width:13px; height:13px; border-radius:50%; border:2px solid var(--border-strong); background:var(--surface-white); flex:0 0 auto; margin-top:3px; }
.fp-tl-dot.done { background:var(--hue-blue); border-color:var(--hue-blue); }
.fp-tl-dot.now  { background:var(--hue-orange); border-color:var(--hue-orange); box-shadow:0 0 0 4px rgba(255,149,0,.18); }
.fp-tl-dot.end  { background:var(--ink-900); border-color:var(--ink-900); }
.fp-tl-line { flex:1 1 auto; width:2px; background:var(--divider); min-height:18px; margin:2px 0; }
.fp-tl-line.done { background:var(--hue-blue); }
.fp-tl-body { padding-bottom:16px; }
.fp-tl-step:last-child .fp-tl-body { padding-bottom:0; }
.fp-tl-t { font-size:var(--fs-body); font-weight:var(--fw-medium); color:var(--text-primary); }
.fp-tl-m { font-size:var(--fs-label); color:var(--text-muted); margin-top:2px; }
</style>
