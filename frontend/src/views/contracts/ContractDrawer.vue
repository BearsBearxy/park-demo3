<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import { contractApi } from '@/api/contract'
import type { ContractDTO, ContractDetailDTO, BillingLineDTO, PropertyType } from '@/types/contract'
import { POWER_TYPE_LABEL, lineMonthly, defaultBillMode, feeLabel, inferPropertyType, PROPERTY_TYPE_LABEL, BUILDING_RENT_KEYS } from '@/types/contract'
import { fpMoney } from '@/utils/money'
import FPSectionLabel from '@/components/fp/FPSectionLabel.vue'
import FPContractStatus from '@/components/fp/FPContractStatus.vue'
import FPTenantStatus from '@/components/fp/FPTenantStatus.vue'
import FPContractTimeline from './FPContractTimeline.vue'
import FPContractChain from './FPContractChain.vue'
import Avatar from '@/components/ds/Avatar.vue'
import Button from '@/components/ds/Button.vue'
import { iconFor } from '@/components/ds/icon'

const props = defineProps<{
  contract: ContractDTO | null
  chain?: { c: ContractDTO; seq: number }[]   // 整条续签链(CONTRACT-CARD-V2-SPEC §4.1),由父级 chainOf 传入
}>()
// edit/renew:父级打开对应弹窗;terminated:携最新 DTO 由父级刷新 list+summary+detail;deleted:父级清选中+刷新
// jump:点链上其它期,父级切换 openContract(§4.1)
const emit = defineEmits<{ edit: [ContractDTO]; renew: [ContractDTO]; terminated: [ContractDTO]; deleted: []; jump: [ContractDTO] }>()

const detail = ref<ContractDetailDTO | null>(null)

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

// immediate:master-detail 下本组件是 v-if 挂载(选中才 mount),挂载时 contract 已就位;
// 非 immediate 的 watch 不会在首挂时触发→detail 永远为 null(标的段/租户状态不出)。
watch(() => props.contract, async (c) => {
  detail.value = null
  askTerminate.value = false
  askDelete.value = false
  if (c) detail.value = await contractApi.detail(c.id)
}, { immediate: true })

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
// 连续费用网格(REWORK Option A):系数折进单价(×n)、间数折进面积(N间)、固定费单价列空;每段小计。
const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 })
const isFixed = (l: BillingLineDTO) => !isSqm(l) && !isRoom(l)
const areaCell = (l: BillingLineDTO) =>
  isSqm(l) ? num(l.area) : (isRoom(l) ? (l.roomCount != null ? l.roomCount + ' 间' : '—') : '—')
const priceCell = (l: BillingLineDTO) => {
  if (isSqm(l)) return num(l.unitPrice) + (l.coeff != null && l.coeff !== 1 ? ' ×' + l.coeff : '')
  if (isRoom(l)) return num(l.unitPrice)
  return '—'
}
const segSubtotal = (lines: BillingLineDTO[]): number => {
  let s = 0
  for (const l of lines) { const m = lineMonthly(l, props.contract?.kva); if (m != null) s += m }
  return s
}
// 合同标准月租金合计 = 各计费行月单价之和(参考,非账单实收;账单含免租/proration 属账单管理)
const contractMonthlyTotal = computed(() => {
  let s = 0
  for (const l of detail.value?.billingLines ?? []) {
    const m = lineMonthly(l, props.contract?.kva)
    if (m != null) s += m
  }
  return s
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
  <div v-if="contract" class="cd-inline">
    <div class="cd-inline-bar">
      <div class="cd-inline-title">
        <component :is="iconFor('file-text')" :size="18" aria-hidden="true" />
        <div style="min-width:0">
          <div class="cd-inline-no">{{ contract.contractNo }}</div>
          <div class="cd-inline-sub">{{ subtitle }}</div>
        </div>
        <FPContractStatus :status="contract.status" />
      </div>
      <div class="cd-inline-actions">
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
      </div>
    </div>

    <div class="cd-inline-body">
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
        <!-- 连续费用网格:表头一次,按段分组(段带+费用行+小计),底部合同合计;字体/列沿 demo3 原生 -->
        <div v-if="segGroups.length" class="cd-ch">
          <div class="cd-ch-head">
            <span class="fx">费项</span><span>面积</span><span>单价</span><span>月额</span>
          </div>
          <template v-for="(g, gi) in segGroups" :key="gi">
            <div class="cd-ch-band">
              <span class="cd-ch-dot" />
              <span class="cd-ch-type">{{ PROPERTY_TYPE_LABEL[g.propertyType] }}</span>
              <span class="cd-ch-loc">{{ g.location }}</span>
              <span v-if="segArea(g.lines) != null" class="cd-ch-area">{{ segArea(g.lines)!.toLocaleString('en-US') }} ㎡</span>
            </div>
            <div v-for="l in g.lines" :key="l.id" class="cd-ch-row">
              <span class="fx">{{ l.feeName || feeLabel(g.propertyType, l.feeKey) }}<span v-if="isFixed(l)" class="cd-ch-fx">固定</span></span>
              <span class="mono dim">{{ areaCell(l) }}</span>
              <span class="mono dim">{{ priceCell(l) }}</span>
              <span class="mono cd-ch-mo" :class="{ pending: rowMonthly(l) === '待录' }">{{ rowMonthly(l) }}</span>
            </div>
            <div class="cd-ch-sub"><span>小计</span><span class="mono">{{ fmt(segSubtotal(g.lines)) }}</span></div>
          </template>
          <div class="cd-ch-total">
            <span>合同月租金合计（标准）<span class="cd-ch-note"> · 参考,非账单实收</span></span>
            <span class="mono">{{ fmt(contractMonthlyTotal) }}</span>
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
    </div>
  </div>

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
/* 内联右面板外壳(去 FPDrawer 模态):bar(标题+操作) / body(可滚内容)两段,高度撑满右栏 */
.cd-inline { display:flex; flex-direction:column; height:100%; background:var(--surface-white); border:1px solid var(--border-subtle); border-radius:var(--radius-lg); overflow:hidden; }
.cd-inline-bar { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 16px; border-bottom:1px solid var(--divider); flex:0 0 auto; }
.cd-inline-title { display:flex; align-items:center; gap:10px; min-width:0; }
.cd-inline-no { font-size:15px; font-weight:var(--fw-semibold); }
.cd-inline-sub { font-size:12px; color:var(--text-muted); }
.cd-inline-actions { display:flex; gap:6px; flex:0 0 auto; }
.cd-inline-body { flex:1 1 auto; overflow-y:auto; padding:16px; display:flex; flex-direction:column; gap:18px; }
/* 详情占主区很宽,内容封顶到舒适阅读宽度(左对齐),避免 label/value 拉太开、费用网格过稀 */
.cd-inline-body > * { max-width:940px; width:100%; }

/* fp-field / fp-tl classes come from fp-master-ui injectMasterStyles (global) — ponytail: scoped fallback below */
.fp-field { display:flex; align-items:baseline; justify-content:space-between; gap:16px; padding:7px 0; border-bottom:1px dashed var(--divider); }
.fp-field:last-child { border-bottom:none; }
.fp-field .k { font-size:var(--fs-label); color:var(--text-muted); white-space:nowrap; flex:0 0 auto; }
.fp-field .v { font-size:var(--fs-body); color:var(--text-primary); text-align:right; min-width:0; }
.fp-field .v.mono { font-family:var(--font-mono); }
.fp-field .v.cd-wrap { white-space:pre-wrap; word-break:break-word; line-height:1.5; }   /* 期限原文可长可多段,允许换行 */
.fp-field .v.pending { color:var(--text-disabled); font-family:var(--font-sans); }

.cd-tlwrap { padding:10px 0 12px; border-bottom:1px dashed var(--divider); }

/* 标的段与费用:连续费用网格(REWORK Option A)。一张对齐表,段带分组+小计,底部合同合计。列=费项/面积/单价/月额 */
.cd-ch { margin:8px 0 4px; border:1px solid var(--border-subtle); border-radius:var(--radius-md); overflow:hidden; }
.cd-ch-head, .cd-ch-row { display:grid; grid-template-columns:1.7fr .85fr .95fr 1.15fr; gap:8px; padding:7px 13px; align-items:baseline; }
.cd-ch-head { font-size:11px; color:var(--text-muted); background:var(--surface-card); border-bottom:1px solid var(--border-subtle); }
.cd-ch-head span:not(.fx), .cd-ch-row span:not(.fx) { text-align:right; }
.cd-ch-head .fx, .cd-ch-row .fx { text-align:left; }
.cd-ch-band { display:flex; align-items:center; gap:8px; padding:7px 13px; background:rgba(28,28,28,.02); }
.cd-ch-sub + .cd-ch-band { border-top:1px solid var(--border-subtle); }
.cd-ch-dot { width:5px; height:5px; border-radius:50%; background:var(--hue-blue); flex:0 0 auto; }
.cd-ch-type { font-size:12px; font-weight:var(--fw-semibold); color:var(--text-secondary); }
.cd-ch-loc { font-size:12px; color:var(--text-muted); min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.cd-ch-area { margin-left:auto; font-size:11px; font-family:var(--font-mono); color:var(--text-muted); flex:0 0 auto; }
.cd-ch-row { font-size:12.5px; color:var(--text-primary); }
.cd-ch-row + .cd-ch-row { border-top:1px dashed var(--divider); }
.cd-ch-row .mono { font-family:var(--font-mono); }
.cd-ch-row .dim { color:var(--text-muted); }
.cd-ch-fx { font-size:10.5px; color:var(--text-muted); margin-left:6px; }
.cd-ch-mo { font-weight:var(--fw-semibold); color:var(--text-primary); }
.cd-ch-mo.pending { color:var(--text-disabled); font-family:var(--font-sans); font-weight:var(--fw-regular); }
.cd-ch-sub { display:flex; justify-content:flex-end; gap:8px; padding:6px 13px; font-size:11.5px; color:var(--text-secondary); background:rgba(28,28,28,.02); }
.cd-ch-sub .mono { font-family:var(--font-mono); font-weight:var(--fw-semibold); color:var(--text-primary); }
.cd-ch-total { display:flex; align-items:baseline; justify-content:space-between; padding:11px 13px; background:var(--surface-card); border-top:1px solid var(--border-subtle); font-size:12.5px; color:var(--text-secondary); }
.cd-ch-total .mono { font-family:var(--font-mono); font-size:16px; font-weight:var(--fw-semibold); color:var(--text-primary); }
.cd-ch-note { font-size:11px; color:var(--text-muted); }

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
