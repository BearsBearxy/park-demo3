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
// edit/renew:父级打开对应弹窗;terminated:携最新 DTO 由父级刷新 list+summary+drawer;deleted:父级关抽屉+刷新
const emit = defineEmits<{ close: []; edit: [ContractDTO]; renew: [ContractDTO]; terminated: [ContractDTO]; deleted: [] }>()

const detail = ref<ContractDetailDTO | null>(null)

// ─── 操作:终止 / 删除(确认弹窗) ──────────────────────────
const askTerminate = ref(false)
const askDelete = ref(false)
const busy = ref(false)

const canTerminate = computed(() =>
  ['active', 'expiring', 'draft'].includes(props.contract?.status ?? ''))

async function doTerminate() {
  if (!props.contract || busy.value) return
  busy.value = true
  try {
    const dto = await contractApi.terminate(props.contract.id)
    askTerminate.value = false
    emit('terminated', dto)
  } catch (e) {
    alert((e as { message?: string })?.message ?? '操作失败')
  } finally {
    busy.value = false
  }
}

async function doDelete() {
  if (!props.contract || busy.value) return
  busy.value = true
  try {
    await contractApi.remove(props.contract.id)
    askDelete.value = false
    emit('deleted')
  } catch (e) {
    alert((e as { message?: string })?.message ?? '操作失败')
  } finally {
    busy.value = false
  }
}

watch(() => props.contract, async (c) => {
  detail.value = null
  askTerminate.value = false
  askDelete.value = false
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
      <Button variant="borderless" size="sm" :disabled="!canTerminate" @click="askTerminate = true">
        <template #leading><component :is="iconFor('x-circle')" :size="14" /></template>
        终止
      </Button>
      <Button variant="borderless" size="sm" @click="askDelete = true">
        <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
        删除
      </Button>
      <Button variant="gray" size="sm" @click="contract && emit('edit', contract)">
        <template #leading><component :is="iconFor('pencil')" :size="14" /></template>
        编辑
      </Button>
      <Button variant="filled" size="sm" :disabled="contract?.status === 'terminated'" @click="contract && emit('renew', contract)">
        <template #leading><component :is="iconFor('rotate-ccw')" :size="14" /></template>
        续签
      </Button>
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

  <!-- 终止确认(1:1 FinDialogs delco .fin-mask/.fin-dlg 结构;z-index 高于抽屉) -->
  <Teleport to="body">
    <div v-if="askTerminate && contract" class="cd-mask" @mousedown="askTerminate = false">
      <div class="cd-dlg" role="dialog" aria-modal="true" @mousedown.stop>
        <div class="cd-dlg-h">
          <h3>终止合同</h3>
          <p>确认终止合同「{{ contract.contractNo }}」?其占用的单元将变为空置。</p>
        </div>
        <div class="cd-dlg-f">
          <Button variant="gray" size="sm" @click="askTerminate = false">取消</Button>
          <Button variant="danger" size="sm" :disabled="busy" @click="doTerminate">
            <template #leading><component :is="iconFor('x-circle')" :size="14" /></template>
            确认终止
          </Button>
        </div>
      </div>
    </div>
  </Teleport>

  <!-- 删除确认 -->
  <Teleport to="body">
    <div v-if="askDelete && contract" class="cd-mask" @mousedown="askDelete = false">
      <div class="cd-dlg" role="dialog" aria-modal="true" @mousedown.stop>
        <div class="cd-dlg-h">
          <h3>删除合同</h3>
          <p>删除合同为不可逆操作,一般仅用于误录。确认删除合同「{{ contract.contractNo }}」?</p>
        </div>
        <div class="cd-dlg-f">
          <Button variant="gray" size="sm" @click="askDelete = false">取消</Button>
          <Button variant="danger" size="sm" :disabled="busy" @click="doDelete">
            <template #leading><component :is="iconFor('trash-2')" :size="14" /></template>
            确认删除
          </Button>
        </div>
      </div>
    </div>
  </Teleport>
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

/* 确认弹窗:1:1 FinDialogs .fin-mask/.fin-dlg(scoped 须自带);z-index 320 压过 FPDrawer(300/301) */
.cd-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:320; display:grid; place-items:center; padding:24px; box-sizing:border-box; backdrop-filter:blur(2px); opacity:0; animation:cdfade .16s forwards; }
@keyframes cdfade { to { opacity:1; } }
.cd-dlg { width:min(420px,92vw); background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:16px; box-shadow:0 24px 64px rgba(28,28,28,.28); animation:cdrise .2s var(--ease-standard) both; }
@keyframes cdrise { from { opacity:0; transform:translateY(8px) scale(.985); } to { opacity:1; transform:translateY(0) scale(1); } }
.cd-dlg-h { padding:20px 22px 0; }
.cd-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.cd-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.cd-dlg-f { display:flex; justify-content:flex-end; gap:8px; padding:20px 22px 20px; }
</style>
