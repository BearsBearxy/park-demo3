<script setup lang="ts">
// 租户对标(tenant-peer)v1 — design-boards T8/T9:新建屏(理由见 docs/superpowers/plans/
// 2026-09-11-design-boards.md「画板 Peer」一节:选中单个租户看它在同类里的位置,与既有
// TenantPortfolioView 的组合层视角不是同一个主语)。
//
// 本轮只做板上「单位租金对标」这一张卡(T9)。「哪些期区能给区间」「电费会翻车」「为什么可信」
// 三卡是 T10/T11,下一任务做,不在本文件。
//
// 页签「单位租金/电费/缴费行为」:板(board-peer.txt)只写了「单位租金」这一页的内容——电费/缴费行为
// 两个页签在设计稿里**没有对应的卡片规格**(不是「本任务先跳过」,是稿子本身没定义画什么),
// 所以这两个页签禁用 + hover 提示,不替设计稿编内容。等设计稿补上那两页的规格,再实现。
//
// 数据变换纯函数见 ./TenantPeer.logic.ts(单测,含 break-verify 记录见 t8-report.md)。
import { computed, onMounted, ref, watch } from 'vue'
import { onReactivated } from '@/composables/onReactivated'
import AnaShell from './AnaShell.vue'
import AnaEChart from '@/components/ana/AnaEChart.vue'
import AnaMethodNote from '@/components/ana/AnaMethodNote.vue'
import AnaEmpty from '@/components/ana/AnaEmpty.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import { fetchBuildings, fetchContractDetail, fetchContracts, fetchTenants } from '@/analysis/anaData'
import type { ContractDTO, PropertyType } from '@/types/contract'
import type { TenantDTO } from '@/types/tenant'
import { PROPERTY_TYPE_LABEL } from '@/types/contract'
import { fint } from '@/components/ana/anaFmt'
import {
  MIN_SAMPLE, buildPeerRows, primaryRowOf, eligibleTenants, phaseZoneLabel, phaseStatsOf,
  buildUnitRentHist, unitRentReadout, unitRentRefText, unitRentHistOption, dominantPropertyType,
  type PeerRow,
} from './TenantPeer.logic'

const loaded = ref(false)
const err = ref('')
const contracts = ref<ContractDTO[]>([])
const phaseOf = ref<Map<number, number>>(new Map())
const tenants = ref<TenantDTO[]>([])

async function reload() {
  // 切回重读会重跑本函数:错误不清,重试成功后屏上仍挂着上次的失败文案(P3 T2 评审坐实)
  err.value = ''
  try {
    const [cs, bs, ts] = await Promise.all([fetchContracts(), fetchBuildings(), fetchTenants()])
    contracts.value = cs
    phaseOf.value = new Map(bs.map((b) => [b.id, b.phase]))
    tenants.value = ts
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e)
  } finally {
    loaded.value = true
  }
}
onMounted(reload)
// 侧栏点击自 P3 起是「恢复现场」,不再重建实例——纯读屏没有草稿要保,合同/楼栋改了回来要看最新的。
onReactivated(() => { void reload() })

// asOf 显式取一次今天(同 ExpiryView 的既有约定:「在租」是合同快照,不随期间选择器变化;
// 全局约束①要求锚点显式传入,故 .logic.ts 内部不碰系统时钟,只在这里取一次)。
const today = new Date()
const asOf = today.toLocaleDateString('sv')
const periodLabel = asOf.slice(0, 7)

const peerRows = computed(() => buildPeerRows(contracts.value, phaseOf.value, asOf))
// F4 修复轮1:徽章期区取 tenant.phase,不是 building.phase——两者可能不一致(见 TenantPeer.logic.ts 注释)。
const tenantPhaseOf = computed(() => new Map(tenants.value.map((t) => [t.id, t.phase])))
const tenantOptions = computed(() => eligibleTenants(peerRows.value, tenantPhaseOf.value))

// ── 租户选择(默认候选首户;候选变化时若当前选中已不在候选里才改选,避免用户手选后被悄悄换人)──
const selTenantId = ref<number | null>(null)
watch(tenantOptions, (opts) => {
  if (selTenantId.value != null && opts.some((o) => o.id === selTenantId.value)) return
  selTenantId.value = opts[0]?.id ?? null
}, { immediate: true })

const primaryRow = computed<PeerRow | null>(() =>
  selTenantId.value == null ? null : primaryRowOf(peerRows.value, selTenantId.value))

// ── 头部「物业类型」:只为选中租户的主合同查一次计费行(不为整批同类都查,理由见 TenantPeer.logic.ts)──
const propTypeCache = ref<Map<number, PropertyType | null>>(new Map())
watch(primaryRow, async (row) => {
  if (!row || propTypeCache.value.has(row.contractId)) return
  try {
    const detail = await fetchContractDetail(row.contractId)
    propTypeCache.value.set(row.contractId, dominantPropertyType(detail.billingLines))
  } catch {
    propTypeCache.value.set(row.contractId, null)
  }
}, { immediate: true })
const propertyTypeLabel = computed(() => {
  const row = primaryRow.value
  if (!row) return '—'
  if (!propTypeCache.value.has(row.contractId)) return '…'
  const pt = propTypeCache.value.get(row.contractId)
  return pt ? PROPERTY_TYPE_LABEL[pt] : '—'
})

// ── 单位租金对标(T9):同类 = 选中租户所在期区、在租、已录面积的合同(含本户自己) ──
const phaseZone = computed(() => (primaryRow.value ? phaseZoneLabel(primaryRow.value.phase) : ''))
const phaseValues = computed(() =>
  primaryRow.value ? peerRows.value.filter((r) => r.phase === primaryRow.value!.phase).map((r) => r.unitRent) : [])
const stats = computed(() => phaseStatsOf(phaseValues.value))
const hist = computed(() => (stats.value ? buildUnitRentHist(phaseValues.value, stats.value.p90) : null))
const histOpt = computed<object>(() =>
  hist.value && stats.value && primaryRow.value
    ? unitRentHistOption(hist.value, stats.value, primaryRow.value.tenantName, primaryRow.value.unitRent)
    : {})
const readout = computed(() =>
  primaryRow.value ? unitRentReadout(primaryRow.value.unitRent, phaseValues.value, phaseZone.value) : null)
const refText = computed(() => unitRentRefText(phaseValues.value.length, phaseZone.value, periodLabel))

// ── 页签(板上三个,只有「单位租金」有内容——见文件头注释)──
type TabKey = 'rent' | 'elec' | 'pay'
const tab = ref<TabKey>('rent')
const TABS: { k: TabKey; l: string; on: boolean }[] = [
  { k: 'rent', l: '单位租金', on: true },
  { k: 'elec', l: '电费', on: false },
  { k: 'pay', l: '缴费行为', on: false },
]
</script>

<template>
  <AnaShell period-mode="none" scope-chip="合同快照">
    <div v-if="!loaded" class="page-loading"><span class="page-spin" /></div>

    <div v-else-if="err" class="ak-page">
      <AnaEmpty label="分析数据加载失败" :hint="err" />
    </div>

    <div v-else-if="!tenantOptions.length" class="ak-page">
      <AnaEmpty label="没有在租且已录面积的合同" hint="录入合同起止日期与租赁面积后,此处按同期区呈现单位租金分布" to="/contracts" toText="去录入合同" />
    </div>

    <div v-else class="ak-page">
      <div class="tp-head">
        <div class="tp-head-l">
          <h2 class="ak-title">{{ periodLabel }} · {{ primaryRow?.tenantName ?? '—' }}</h2>
          <p class="ak-sub">{{ phaseZone }} · {{ propertyTypeLabel }} {{ primaryRow ? fint(primaryRow.rentArea) : '—' }} ㎡</p>
        </div>
        <FPTenantPicker v-model="selTenantId" :tenants="tenantOptions" placeholder="选择租户" class="tp-picker" />
      </div>

      <div class="anx-seg tp-tabs" role="group" aria-label="对标维度">
        <button v-for="t in TABS" :key="t.k" :class="{ on: tab === t.k }" :disabled="!t.on"
          :title="t.on ? undefined : '设计稿未定义该页签内容,暂不可用'" @click="tab = t.k">{{ t.l }}</button>
      </div>

      <div v-if="tab === 'rent'" class="av2-card">
        <div class="av2-card-h">
          <span class="t">单位租金对标</span>
          <span class="hint">元/㎡·月 · {{ phaseZone }}在租合同</span>
        </div>
        <template v-if="stats && hist && primaryRow">
          <AnaEChart :option="histOpt" :height="280" />
          <p v-if="hist.overflowCount" class="tp-overflow">{{ hist.overflowCount }} 份 &gt; {{ hist.capHi }},最高 {{ hist.overflowMax.toFixed(1) }}</p>
          <p v-if="readout" class="ana-read">{{ readout }}</p>
          <p class="ana-ref">{{ refText }}</p>
          <AnaMethodNote>
            单位租金 = 合同月租(含管理费/基础维护等五费项合计,不是租金单价字段本身)÷ 租赁面积。
            同类 = {{ phaseZone }}在租(非草稿、非整体承租、起止日期覆盖 {{ periodLabel }})、已录面积、
            且月租含租金计费行的合同——monthly_rent 若只有维护/电梯/变压器等费用、没有任何 rent_* 行,
            那不是便宜,是数据缺口,已排除(与数据总览页「N 份合同无租金计费行」同一判据)。按期区分组、
            不按物业类型再拆:真正会让这张图失真的是上面已排除的那批缺口合同,不是物业类型混杂——
            经核实这批同类解析出的物业类型全部是厂房或缺口(不含 rent_* 行),没有第二类物业类型能撑起
            「两拨价格」这个说法。
            p10/中位/p90 为线性插值分位;样本 &lt; {{ MIN_SAMPLE }} 份不画区间、不印百分比。
            「80% 的同类在这段」是 p10~p90 这两个分位点之间本来就该有的那部分,不是历史命中率那种校准声明。
          </AnaMethodNote>
        </template>
        <AnaEmpty v-else label="同类样本不足" :hint="`${phaseZone}在租且已录面积的合同仅 ${phaseValues.length} 份,不足 ${MIN_SAMPLE} 份,无法画分布区间`" />
      </div>

      <div v-else class="av2-card">
        <div class="av2-card-h"><span class="t">{{ TABS.find((t) => t.k === tab)?.l }}</span></div>
        <AnaEmpty label="该页签设计稿未定义内容" hint="board-peer.txt 只给了「单位租金」这一页的规格,电费/缴费行为两页没有可实现的规格" />
      </div>
    </div>
  </AnaShell>
</template>

<style scoped>
.tp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 14px; flex-wrap: wrap; }
.tp-head-l { min-width: 0; }
.tp-picker { width: 240px; flex: 0 0 auto; }
.tp-tabs { margin-bottom: 14px; }
.tp-overflow { font-size: var(--fs-micro); color: var(--text-muted); margin: 4px 0 0; }
</style>
