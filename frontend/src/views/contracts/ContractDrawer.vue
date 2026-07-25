<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { contractApi } from '@/api/contract'
import type { ContractDTO, ContractDetailDTO, BillingLineDTO, PropertyType } from '@/types/contract'
import { POWER_TYPE_LABEL, lineMonthly, defaultBillMode, feeLabel, inferPropertyType, PROPERTY_TYPE_LABEL, BUILDING_RENT_KEYS } from '@/types/contract'
import { fpMoney } from '@/utils/money'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPSectionLabel from '@/components/fp/FPSectionLabel.vue'
import FPContractStatus from '@/components/fp/FPContractStatus.vue'
import FPTenantStatus from '@/components/fp/FPTenantStatus.vue'
import FPContractTimeline from './FPContractTimeline.vue'
import FPContractChain from './FPContractChain.vue'
import FPRentTierBar from './FPRentTierBar.vue'
import Avatar from '@/components/ds/Avatar.vue'
import Button from '@/components/ds/Button.vue'
import { iconFor } from '@/components/ds/icon'

const props = defineProps<{
  open: boolean
  contract: ContractDTO | null
  chain?: { c: ContractDTO; seq: number }[]   // 整条续签链(CONTRACT-CARD-V2-SPEC §4.1),由父级 chainOf 传入
}>()
// edit/renew:父级打开对应弹窗;terminated:携最新 DTO 由父级刷新 list+summary+drawer;deleted:父级关抽屉+刷新
// jump:点链上其它期,父级切换 openContract(§4.1)
const emit = defineEmits<{ close: []; edit: [ContractDTO]; renew: [ContractDTO]; terminated: [ContractDTO]; deleted: []; jump: [ContractDTO] }>()

const detail = ref<ContractDetailDTO | null>(null)
// 本地日期(非 toISOString:那是 UTC,东八区 00:00-08:00 会算成前一天,阶梯当前档边界日会判错)
const today = (() => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
})()

// ─── 操作:终止 / 删除(确认弹窗) ──────────────────────────
const askTerminate = ref(false)
const askDelete = ref(false)
const busy = ref(false)

const canTerminate = computed(() =>
  ['active', 'expiring', 'draft'].includes(props.contract?.status ?? ''))
const canRenew = computed(() =>
  !['terminated', 'renewed'].includes(props.contract?.status ?? ''))

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

// ─── 标的段(§6.1):按 propertyType+location 分组;段头=类型徽标+位置+段面积;
//     段体=该类型钉死费用行(费项名+面积+单价+系数+间数+月单价只读),条件项(电梯/变压器)有才显。──
const segGroups = computed(() => {
  const groups: { propertyType: PropertyType; location: string; lines: BillingLineDTO[] }[] = []
  for (const l of detail.value?.billingLines ?? []) {
    const pt = (l.propertyType ?? inferPropertyType(l.feeKey)) as PropertyType
    let g = groups.find(x => x.propertyType === pt && x.location === l.location)
    if (!g) { g = { propertyType: pt, location: l.location, lines: [] }; groups.push(g) }
    g.lines.push(l)
  }
  return groups
})
function segArea(lines: BillingLineDTO[]): number | null {
  let s = 0, has = false
  for (const l of lines) if (BUILDING_RENT_KEYS.includes(l.feeKey) && l.area != null) { s += l.area; has = true }
  return has ? Math.round(s * 100) / 100 : null
}
const num = (v: number | null | undefined) => (v != null ? v.toLocaleString('en-US') : '—')
const emode = (l: BillingLineDTO) => (l.billMode || defaultBillMode(l.feeKey))
const isSqm = (l: BillingLineDTO) => emode(l) === 'per_sqm_month'
const isRoom = (l: BillingLineDTO) => emode(l) === 'per_room_year' || emode(l) === 'per_room_month'
const rowMonthly = (l: BillingLineDTO): string => {
  const m = lineMonthly(l, props.contract?.kva)
  return m != null ? m.toLocaleString('en-US') : '待录'
}

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
  } else if (c.status === 'renewed') {
    steps.push({ state: 'end', t: '已续签', m: (c.endDate || '—') + ' · 被新一期取代' })
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

// 面积口径(2026-07-24 裁定):唯一录入点=计费行 area;顶部只读汇总消除重复。
const BUILDING_RENT: string[] = [...BUILDING_RENT_KEYS]
function sumArea(keys: string[]): number | null {
  let s = 0, has = false
  for (const l of detail.value?.billingLines ?? [])
    if (keys.includes(l.feeKey) && l.area != null) { s += l.area; has = true }
  return has ? Math.round(s * 100) / 100 : null
}
const rentAreaShow = computed(() => sumArea(BUILDING_RENT) ?? props.contract?.rentArea ?? null)
const landAreaSum = computed(() => sumArea(['rent_land']))

// 租户联系方式:联系人/电话可空,过滤后拼接;全空则整行不显(不再渲染 null · null)
const contactLine = computed(() =>
  [detail.value?.tenant.contactName, detail.value?.tenant.contactPhone].filter(Boolean).join(' · '))
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
      <Button variant="filled" size="sm" :disabled="!canRenew" @click="contract && emit('renew', contract)">
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
          <div v-if="contactLine" style="font-size:12px;color:var(--text-muted)">{{ contactLine }}</div>
        </div>
        <FPTenantStatus v-if="detail" :status="detail.tenant.status" />
      </div>

      <!-- 1.5 续签链 chip 条(V2-SPEC §4.1):单期合同不渲染,旧期亦可跳到现行期 -->
      <FPContractChain
        v-if="chain && chain.length > 1"
        :chain="chain" :current-id="contract.id" @jump="emit('jump', $event)" />

      <!-- 2. 合同信息块(一次性,不重复;§6.1) -->
      <div>
        <FPSectionLabel icon="info">合同信息</FPSectionLabel>
        <div class="fp-field"><span class="k">楼栋</span><span class="v">{{ contract.buildingName }}</span></div>
        <div class="fp-field"><span class="k">楼层 / 房号</span><span class="v mono">{{ contract.floorInfo || '—' }}</span></div>
        <div class="fp-field"><span class="k">建筑面积</span><span class="v mono">{{ contract.buildingArea != null ? contract.buildingArea.toLocaleString('en-US') + ' ㎡' : '—' }}</span></div>
        <div class="fp-field"><span class="k">租赁面积</span><span class="v mono">{{ rentAreaShow != null ? rentAreaShow.toLocaleString('en-US') + ' ㎡' : '—' }}</span></div>
        <div v-if="landAreaSum != null" class="fp-field"><span class="k">空地面积</span><span class="v mono">{{ landAreaSum.toLocaleString('en-US') }} ㎡</span></div>
        <div class="fp-field"><span class="k">押金</span><span class="v mono">{{ fpMoney(contract.deposit) }}</span></div>
        <!-- 电费签约要素(裁定④):KVA 仅大工业行显示 -->
        <div class="fp-field"><span class="k">用电分类</span>
          <span class="v" :class="{ pending: !contract.powerType }">{{ contract.powerType ? POWER_TYPE_LABEL[contract.powerType] ?? contract.powerType : '待录' }}</span></div>
        <div v-if="contract.powerType === 'industrial'" class="fp-field"><span class="k">配电容量 KVA</span>
          <span class="v mono" :class="{ pending: contract.kva == null }">{{ contract.kva != null ? contract.kva.toLocaleString('en-US') : '待录' }}</span></div>
        <div class="fp-field"><span class="k">签约日期</span><span class="v mono">{{ contract.signDate || '待签约' }}</span></div>
        <div class="fp-field"><span class="k">租赁期限</span><span class="v mono">{{ contract.startDate ? contract.startDate + ' → ' + contract.endDate : '待定' }}</span></div>
        <!-- 期限原文/分年阶梯价已降级到「原始留档」折叠块(V2-SPEC §3) -->
        <!-- F2 合同期时间轴:蓝=计租 红=免租 竖线=今天 -->
        <div class="cd-tlwrap">
          <FPContractTimeline :start-date="contract.startDate" :end-date="contract.endDate" :rent-free="contract.rentFree" />
        </div>
        <div class="fp-field"><span class="k">租期</span><span class="v mono">{{ contract.termMonths ? contract.termMonths + ' 个月' : '—' }}</span></div>
      </div>

      <!-- 2.5 租金阶梯(V2-SPEC §5):参考排程,不参与计费;单段/无阶梯不渲染 -->
      <div v-if="(detail?.rentTiers?.length ?? 0) > 1">
        <FPSectionLabel icon="trending-up">租金阶梯</FPSectionLabel>
        <FPRentTierBar :tiers="detail!.rentTiers" :today="today" :contract-unit-price="contract.unitPrice" />
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

      <!-- 4. 标的段列表(§6.1:每段=类型徽标+位置+段面积 + 该类型钉死费用行只读;条件项有才显) -->
      <div>
        <FPSectionLabel icon="list">标的段与费用</FPSectionLabel>
        <div v-if="segGroups.length" class="cd-bl">
          <div v-for="(g, gi) in segGroups" :key="gi" class="cd-bl-grp">
            <div class="cd-bl-loc">
              <span class="cd-seg-badge">{{ PROPERTY_TYPE_LABEL[g.propertyType] }}</span>
              <span class="cd-seg-name">{{ g.location }}</span>
              <span v-if="segArea(g.lines) != null" class="cd-seg-area">{{ segArea(g.lines)!.toLocaleString('en-US') }} ㎡</span>
            </div>
            <div class="cd-bl-head">
              <span class="fx">费项</span><span>面积</span><span>单价</span><span>系数</span><span>间数</span><span>月单价</span>
            </div>
            <div v-for="l in g.lines" :key="l.id" class="cd-bl-row">
              <span class="fx">{{ l.feeName || feeLabel(g.propertyType, l.feeKey) }}</span>
              <span class="mono">{{ isSqm(l) ? num(l.area) : '—' }}</span>
              <span class="mono">{{ isSqm(l) || isRoom(l) ? num(l.unitPrice) : '—' }}</span>
              <span class="mono">{{ isSqm(l) && l.coeff != null && l.coeff !== 1 ? l.coeff : '—' }}</span>
              <span class="mono">{{ isRoom(l) ? num(l.roomCount) : '—' }}</span>
              <span class="mono cd-bl-mo" :class="{ pending: rowMonthly(l) === '待录' }">{{ rowMonthly(l) }}</span>
            </div>
          </div>
        </div>
        <div v-else class="fp-field"><span class="k">标的段</span><span class="v pending">待录(编辑合同添加标的段)</span></div>
      </div>

      <!-- 5. 原始留档(V2-SPEC §3):结构化视图之外,合同白纸黑字原文折叠备查 -->
      <details v-if="contract.termText || contract.tierPriceNote" class="cd-raw">
        <summary>原始留档（合同白纸黑字原文）</summary>
        <div v-if="contract.termText" class="fp-field"><span class="k">期限原文</span><span class="v cd-wrap">{{ contract.termText }}</span></div>
        <div v-if="contract.tierPriceNote" class="fp-field"><span class="k">分年阶梯价</span><span class="v cd-wrap">{{ contract.tierPriceNote }}</span></div>
      </details>

      <!-- 6. 备注 -->
      <div v-if="contract.remark">
        <FPSectionLabel icon="sticky-note">备注</FPSectionLabel>
        <p style="margin:0;font-size:13px;color:var(--text-secondary);line-height:1.6">{{ contract.remark }}</p>
      </div>
    </template>
  </FPDrawer>

  <!-- 终止确认 -->
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
/* fp-field / fp-tl classes come from fp-master-ui injectMasterStyles (global) — ponytail: scoped fallback below */
.fp-field { display:flex; align-items:baseline; justify-content:space-between; gap:16px; padding:7px 0; border-bottom:1px dashed var(--divider); }
.fp-field:last-child { border-bottom:none; }
.fp-field .k { font-size:var(--fs-label); color:var(--text-muted); white-space:nowrap; flex:0 0 auto; }
.fp-field .v { font-size:var(--fs-body); color:var(--text-primary); text-align:right; min-width:0; }
.fp-field .v.mono { font-family:var(--font-mono); }
.fp-field .v.cd-wrap { white-space:pre-wrap; word-break:break-word; line-height:1.5; }   /* 期限原文可长可多段,允许换行 */
.fp-field .v.pending { color:var(--text-disabled); font-family:var(--font-sans); }

.cd-tlwrap { padding:10px 0 12px; border-bottom:1px dashed var(--divider); }

/* 标的段列表:段头=类型徽标+位置+段面积;段体=6 列只读费用行 */
.cd-bl { margin:8px 0 4px; display:flex; flex-direction:column; gap:10px; }
.cd-bl-grp { border:1px solid var(--border-subtle); border-radius:var(--radius-md); overflow:hidden; }
.cd-bl-loc { display:flex; align-items:center; gap:8px; padding:7px 10px; background:var(--surface-card); }
.cd-seg-badge { padding:2px 9px; border-radius:999px; background:var(--hue-blue); color:#fff; font-size:11.5px; font-weight:var(--fw-semibold); }
.cd-seg-name { font-size:12.5px; font-weight:var(--fw-semibold); color:var(--text-secondary); }
.cd-seg-area { margin-left:auto; font-size:11.5px; font-family:var(--font-mono); color:var(--text-muted); }
.cd-bl-head, .cd-bl-row { display:grid; grid-template-columns:1.5fr .8fr .9fr .55fr .55fr 1fr; gap:6px; padding:5px 10px; align-items:baseline; }
.cd-bl-head { font-size:11px; color:var(--text-muted); border-bottom:1px dashed var(--divider); }
.cd-bl-head span, .cd-bl-row span:not(.fx) { text-align:right; }
.cd-bl-head .fx, .cd-bl-row .fx { text-align:left; }
.cd-bl-row { font-size:12.5px; color:var(--text-primary); border-top:1px dashed var(--divider); }
.cd-bl-grp .cd-bl-row:first-of-type { border-top:none; }
.cd-bl-row .mono { font-family:var(--font-mono); }
.cd-bl-mo { font-weight:var(--fw-semibold); }
.cd-bl-mo.pending { color:var(--text-disabled); font-family:var(--font-sans); font-weight:var(--fw-regular); }

/* 原始留档(V2-SPEC §3):默认折叠,展开看原文 */
.cd-raw { border:1px dashed var(--divider); border-radius:var(--radius-md); padding:6px 10px; }
.cd-raw > summary { cursor:pointer; font-size:var(--fs-label); color:var(--text-muted); }

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

/* 确认弹窗:z-index 320 压过 FPDrawer(300/301) */
.cd-mask { position:fixed; inset:0; background:rgba(28,28,28,.34); z-index:320; display:grid; place-items:center; padding:24px; box-sizing:border-box; backdrop-filter:blur(2px); opacity:0; animation:cdfade .16s forwards; }
@keyframes cdfade { to { opacity:1; } }
.cd-dlg { width:min(420px,92vw); background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:16px; box-shadow:0 24px 64px rgba(28,28,28,.28); animation:cdrise .2s var(--ease-standard) both; }
@keyframes cdrise { from { opacity:0; transform:translateY(8px) scale(.985); } to { opacity:1; transform:translateY(0) scale(1); } }
.cd-dlg-h { padding:20px 22px 0; }
.cd-dlg-h h3 { margin:0; font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.cd-dlg-h p { margin:6px 0 0; font-size:12.5px; line-height:1.5; color:var(--text-muted); }
.cd-dlg-f { display:flex; justify-content:flex-end; gap:8px; padding:20px 22px 20px; }
</style>
