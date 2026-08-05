<script setup lang="ts">
// 催缴单屏 v2(S4-BILL-NOTICE-SPEC §7 S4-4 v2 拍板):一个租户一条(该户全部单据合并,
// 对齐 Excel 每租户一张 worksheet);一期/二期/三期分 tab(期归属=在租合同楼栋 phase→premise 前缀→兜底一期);
// 屏上不显收款主体/单据类/状态(引擎照旧拆单落库,只是 UI 聚合);签发/作废本轮撤下(api 端点保留)。
// 明细抽屉两 tab:场地租金(逐份在租合同计费行,lineMonthly 参考口径:整月/未含免租期按天折)在前、
// 水电费(全单明细合并,沿用 premise 分带小计+取价审计链悬浮)在后。
// 列表照 PoolLedgerView 手法(sticky 表头/34px 行/tfoot 钉底/zone Segmented)+LIST-PAGE-SPEC 列宽铁律;
// 账外户(offbook)整行降淡。写操作 admin(viewer 隐藏),GET 全员。
import { computed, onMounted, ref, watch } from 'vue'
import {
  billNoticesApi, type BillNoticeDTO, type BillNoticeDetailDTO, type BillNoticeLineDTO,
} from '@/api/billNotices'
import { contractApi } from '@/api/contract'
import { feeLabel, lineMonthly, type BillingLineDTO, type ContractDTO } from '@/types/contract'
import { buildingApi } from '@/api/building'
import type { BuildingDTO } from '@/types/building'
import { metersApi } from '@/api/meters'
import { buildYearOptions } from '@/utils/yearGate'
import {
  aggregateByTenant, auditTitle, billFeeLabel, groupDormExcelStyle, groupExcelStyle,
  rentByTenant, resolvePhase, segLabel, tenantKpis, type TenantNoticeRow,
} from '@/utils/billNoticeLogic'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import Segmented from '@/components/ds/Segmented.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPStat from '@/components/fp/FPStat.vue'

const auth = useAuthStore()
const canEdit = computed(() => !auth.isReadonly)

const pad2 = (n: number) => String(n).padStart(2, '0')
const fmt = (v: number | null | undefined) =>
  v == null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
const fmt2 = (v: number | null | undefined) =>
  v == null ? '–' : v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback
const r2 = (v: number) => Math.round(v * 100) / 100

// ── 账期(年数据驱动;bill-notices 无 years 端点,复用抄表年份——单随读数走,alloc 屏同手法) ──
const today = new Date()
const year = ref(today.getFullYear())
const month = ref(today.getMonth() + 1)
const dataYears = ref<number[]>([])
const yearOpts = computed(() =>
  buildYearOptions(dataYears.value, today).map(y => ({ value: String(y), label: `${y}年` })))
const monthOpts = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` }))
const ym = computed(() => `${year.value}-${pad2(month.value)}`)

// ── 数据:催缴单 + 当月在租合同(期归属/月租金参考用,取月中 15 日)同拉;竞态守卫 ──
const rows = ref<BillNoticeDTO[] | null>(null)
const contracts = ref<ContractDTO[]>([])
const buildings = ref<BuildingDTO[]>([])
let seq = 0
async function loadMonth() {
  const my = ++seq
  const [ns, cs] = await Promise.all([
    billNoticesApi.list(ym.value).catch(() => [] as BillNoticeDTO[]),
    contractApi.list(`${ym.value}-15`).catch(() => [] as ContractDTO[]),
  ])
  if (my !== seq) return
  rows.value = ns
  contracts.value = cs
}
onMounted(async () => {
  buildingApi.list().then(bs => { buildings.value = bs }).catch(() => { /* 楼栋失败按 premise 回退归期 */ })
  try {
    dataYears.value = await metersApi.years()
    const latest = dataYears.value[dataYears.value.length - 1]
    if (latest && latest !== year.value) { year.value = latest; return }   // watch 触发 loadMonth
  } catch { /* 年份失败不阻断 */ }
  loadMonth()
})
watch([year, month], loadMonth)

// ── 一户一条聚合 + 期归属 + 月租金(参考) ──
const bById = computed(() => new Map(buildings.value.map(b => [b.id, b])))
const contractsByTenant = computed(() => {
  const m = new Map<number, ContractDTO[]>()
  for (const c of contracts.value) {
    const a = m.get(c.tenantId)
    if (a) a.push(c); else m.set(c.tenantId, [c])
  }
  return m
})
const rentMap = computed(() => rentByTenant(contracts.value))
interface DisplayRow extends TenantNoticeRow { rent: number | null; phase: 1 | 2 | 3 }
const tenantRows = computed<DisplayRow[]>(() => aggregateByTenant(rows.value ?? []).map(t => ({
  ...t,
  rent: rentMap.value.get(t.tenantId) ?? null,
  phase: resolvePhase(
    (contractsByTenant.value.get(t.tenantId) ?? []).map(c => {
      const b = bById.value.get(c.buildingId)
      return { phase: b?.phase ?? 0, name: b?.name ?? '' }
    }),
    t.premiseText),
})))

// ── 期 tab(PoolLedgerView 的 zone Segmented 手法;一级页签不参与重置) ──
const phase = ref<string>('1')
const PHASE_OPTS = [
  { value: '1', label: '一期' }, { value: '2', label: '二期' }, { value: '3', label: '三期' },
]
const phaseRows = computed(() => tenantRows.value.filter(r => r.phase === +phase.value))

// ── KPI 条(户数/水电总额/月租金合计(参考)/警告户数,随当前期 tab 联动) ──
const kpis = computed(() => tenantKpis(phaseRows.value))

// ── 筛选:仅看有警告/租户搜索 ──
const warnOnly = ref(false)
const q = ref('')
const filtered = computed(() => phaseRows.value.filter(r =>
  (!warnOnly.value || !!r.warn)
  && (q.value.trim() === '' || (r.tenantName ?? '').includes(q.value.trim()))))
const footLines = computed(() => filtered.value.reduce((s, r) => s + r.lineCount, 0))
const footTotal = computed(() => filtered.value.reduce((s, r) => s + (r.totalAmount ?? 0), 0))
const footRent = computed(() => filtered.value.reduce((s, r) => s + (r.rent ?? 0), 0))

// ── 重新生成(admin;confirm 后 POST generate,轻提示显摘要,完成刷新) ──
const generating = ref(false)
const okMsg = ref('')
let okTimer: ReturnType<typeof setTimeout> | undefined
function flashOk(msg: string) {
  okMsg.value = msg
  clearTimeout(okTimer)
  okTimer = setTimeout(() => { okMsg.value = '' }, 5000)
}
async function onGenerate() {
  if (generating.value) return
  if (!confirm(`重新生成 ${ym.value} 催缴单:先删后插覆盖本月草稿/作废单,按当前读数与价目重派;已签发单跳过不覆盖(须先作废)。确认?`)) return
  generating.value = true
  try {
    const res = await billNoticesApi.generate(ym.value)
    flashOk(`已生成 ${res.generated} 单 / ${res.lines} 行,${res.warned} 单带警告(含已签发跳过户)`)
    await loadMonth()
  } catch (e) { alert(errMsg(e, '生成失败')) } finally { generating.value = false }
}

// ── 明细抽屉(两 tab:场地租金在前/水电费在后;竞态守卫同列表手法) ──
const dlgOpen = ref(false)
const dlgTab = ref<string>('rent')
const DLG_TABS = [{ value: 'rent', label: '场地租金' }, { value: 'util', label: '水电费' }]
const dlgLoading = ref(false)
const dlgRow = ref<DisplayRow | null>(null)
const details = ref<BillNoticeDetailDTO[]>([])
// 场地租金带:逐份在租合同;计费行抽屉打开才拉、每合同一次并缓存(lines=null 表载入失败)
interface RentBand { contract: ContractDTO; lines: BillingLineDTO[] | null }
const rentBands = ref<RentBand[]>([])
const rentLoading = ref(false)
const blCache = new Map<number, BillingLineDTO[]>()
let dlgSeq = 0

async function openDetail(r: DisplayRow) {
  dlgOpen.value = true
  dlgTab.value = 'rent'
  dlgRow.value = r
  dlgLoading.value = true
  details.value = []
  rentBands.value = []
  const my = ++dlgSeq
  loadRentBands(r.tenantId, my)
  try {
    const ds = await Promise.all(r.noticeIds.map(id => billNoticesApi.detail(id)))
    if (my !== dlgSeq) return
    details.value = ds
  } catch (e) {
    if (my !== dlgSeq) return
    alert(errMsg(e, '明细加载失败')); dlgOpen.value = false
  } finally { if (my === dlgSeq) dlgLoading.value = false }
}
async function loadRentBands(tenantId: number, my: number) {
  rentLoading.value = true
  const bands = await Promise.all((contractsByTenant.value.get(tenantId) ?? []).map(async c => {
    if (!blCache.has(c.id)) {
      try { blCache.set(c.id, (await contractApi.detail(c.id)).billingLines) } catch { /* 该带显载入失败 */ }
    }
    return { contract: c, lines: blCache.get(c.id) ?? null }
  }))
  if (my !== dlgSeq) return
  rentBands.value = bands
  rentLoading.value = false
}

// 水电 tab v3(可莱恩 worksheet 版式):非宿舍单→电/水两部逐场地「费块+维护费块」;
// dorm 单→宿舍逐间子表;末行合计=非宿舍+宿舍。行归块在 billNoticeLogic 纯函数,此处只拍平成渲染行。
const mainLines = computed(() => details.value.filter(d => d.noticeKind !== 'dorm').flatMap(d => d.lines))
const dormLines = computed(() => details.value.filter(d => d.noticeKind === 'dorm').flatMap(d => d.lines))
const xg = computed(() => groupExcelStyle(mainLines.value))
const dorm = computed(() => groupDormExcelStyle(dormLines.value))
const utilGrand = computed(() => r2(xg.value.total + dorm.value.total))
// 非宿舍表拍平:band(块头)/line(明细行,块内重编号)/sub(块小计)/part(部合计)
type UtilRowVM =
  | { t: 'band'; label: string }
  | { t: 'line'; no: number; l: BillNoticeLineDTO }
  | { t: 'sub' | 'part'; label: string; amount: number }
const utilRows = computed<UtilRowVM[]>(() => {
  const out: UtilRowVM[] = []
  const block = (label: string, ls: BillNoticeLineDTO[], subLabel: string | null, subAmount: number) => {
    if (!ls.length) return
    out.push({ t: 'band', label })
    ls.forEach((l, i) => out.push({ t: 'line', no: i + 1, l }))
    if (subLabel) out.push({ t: 'sub', label: subLabel, amount: subAmount })
  }
  const g = xg.value
  for (const p of g.elec.groups) {
    block(`电费(${p.label})`, p.fee, '场地电费合计', p.feeTotal)
    block(`用电维护费(${p.label})`, p.maint, '场地维护费合计', p.maintTotal)
  }
  if (g.elec.groups.length) out.push({ t: 'part', label: '电费、用电维护费合计', amount: g.elec.total })
  for (const p of g.water.groups) {
    block(`水费(${p.label})`, p.fee, null, 0)
    block(`用水维护费(${p.label})`, p.maint, null, 0)
    out.push({ t: 'sub', label: `场地水费、维护费合计(${p.label})`, amount: p.subtotal })
  }
  if (g.water.groups.length) out.push({ t: 'part', label: '水费、用水维护费合计', amount: g.water.total })
  block('其他费项', g.other, '其他费项合计', g.otherTotal)
  return out
})

// 场地租金 tab:月额=lineMonthly 镜像(per_kva 取合同 kva);小计按合同、全户合计跨合同
const lineMon = (b: RentBand, l: BillingLineDTO) => lineMonthly(l, b.contract.kva)
const bandTotal = (b: RentBand) => r2((b.lines ?? []).reduce((s, l) => s + (lineMon(b, l) ?? 0), 0))
const rentGrand = computed(() => r2(rentBands.value.reduce((s, b) => s + bandTotal(b), 0)))
const rentFeeName = (l: BillingLineDTO) => l.feeName ?? feeLabel(l.propertyType ?? null, l.feeKey)

const drawerSub = computed(() => {
  const r = dlgRow.value
  if (!r) return ''
  const cn = (contractsByTenant.value.get(r.tenantId) ?? []).length
  return [ym.value, `在租合同 ${cn} 份`, `水电 ${r.lineCount} 行`].join(' · ')
})
</script>

<template>
  <div v-if="!rows" class="page-loading"><span class="page-spin" /></div>

  <div v-else class="bn-page">
    <!-- 标题行:h2+账期+期页签;右=重新生成(admin) -->
    <div class="bn-head">
      <div class="bn-head-l">
        <h2 class="bn-title"><span class="ic"><component :is="iconFor('file-check-2')" :size="18" /></span>催缴单</h2>
        <div style="width:96px">
          <Select :options="yearOpts" :model-value="String(year)" size="sm" @update:model-value="year = +$event" />
        </div>
        <div style="width:84px">
          <Select :options="monthOpts" :model-value="String(month)" size="sm" @update:model-value="month = +$event" />
        </div>
        <Segmented :options="PHASE_OPTS" v-model="phase" size="sm" />
      </div>
      <div class="bn-actions">
        <Button v-if="canEdit" variant="outline" size="sm" :disabled="generating" @click="onGenerate">
          <template #leading><component :is="iconFor(rows.length ? 'refresh-cw' : 'play')" :size="14" /></template>
          {{ generating ? '生成中…' : rows.length ? '重新生成' : '生成本月' }}
        </Button>
      </div>
    </div>

    <!-- KPI 条(随当前期 tab 联动) -->
    <div class="bn-kpis">
      <FPStat label="户数" :value="String(kpis.count)" tint="blue" />
      <FPStat label="水电总额(元)" :value="fmt2(kpis.total)" tint="sky" />
      <FPStat label="月租金合计(参考,元)" :value="fmt2(kpis.rent)" sub="整月口径,未含免租期/按天折" />
      <FPStat label="警告户数" :value="String(kpis.warned)" :sub="kpis.warned ? '悬停行尾「!」看原文' : undefined" />
    </div>

    <!-- 生成摘要轻提示(5s 自消) -->
    <div v-if="okMsg" class="bn-bar ok">
      <component :is="iconFor('check')" :size="14" />
      <span>{{ okMsg }}</span>
    </div>
    <div v-if="rows.length === 0" class="bn-bar">
      <component :is="iconFor('info')" :size="14" />
      <span>{{ year }}年{{ month }}月暂无催缴单。
        <template v-if="canEdit">点右上「生成本月」按当月读数、价目与公摊快照派生。</template>
        <template v-else>请管理员生成。</template>
      </span>
    </div>

    <!-- 筛选行:仅看有警告 + 租户搜索 -->
    <div class="bn-toolbar">
      <label class="bn-chk">
        <input type="checkbox" v-model="warnOnly" />
        仅看有警告
      </label>
      <span style="flex:1"></span>
      <input v-model="q" class="bn-search" type="text" placeholder="搜租户名" />
    </div>

    <!-- 一行一户(pl-table 手法:sticky 表头/34px 行/tfoot 钉底合计) -->
    <div class="bn-wrap">
      <table class="bn-table">
        <colgroup>
          <col style="width:220px" />
          <col /><!-- 位置:唯一弹性列 -->
          <col style="width:88px" />
          <col style="width:130px" />
          <col style="width:130px" />
          <col style="width:52px" />
        </colgroup>
        <thead>
          <tr>
            <th class="l">租户</th>
            <th class="l" title="该户全部单据场地去重合并,明细内按场地分段小计">位置</th>
            <th>水电行数</th>
            <th title="该户全部单据本期合计之和(含宿舍单);账外户降淡不入应收">水电合计(元)</th>
            <th title="该户当月在租合同月租之和;参考口径:整月,未含免租期/按天折">月租金(参考)</th>
            <th title="门禁告警:缺价/表未归属合同/费项未设收款公司/合计为负…各单去重合并,悬停「!」看原文">警告</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filtered" :key="r.tenantId" :class="{ offbook: r.offbook }" @click="openDetail(r)">
            <td class="l">
              <span class="bn-tname" :title="r.tenantName ?? undefined">{{ r.tenantName ?? '#' + r.tenantId }}</span>
            </td>
            <td class="l"><span class="bn-txt dim" :title="r.premiseText ?? undefined">{{ r.premiseText || '–' }}</span></td>
            <td><span class="bn-nv">{{ r.lineCount }}</span></td>
            <td><span class="bn-sumc" :class="{ neg: r.totalAmount < 0 }">{{ fmt2(r.totalAmount) }}</span></td>
            <td><span class="bn-nv" :class="{ empty: r.rent == null }">{{ fmt2(r.rent) }}</span></td>
            <td class="ct"><span v-if="r.warn" class="bn-warn" :title="r.warn">!</span></td>
          </tr>
          <tr v-if="filtered.length === 0">
            <td class="bn-noro" :colspan="6">
              {{ rows.length === 0 ? '本月尚未生成催缴单' : '本期无匹配租户 —— 换期页签或筛选条件试试' }}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <th class="l"><span class="bn-foot-lbl">合　计 · {{ filtered.length }} 户</span></th>
            <th></th>
            <th><span class="bn-foot-v">{{ footLines }}</span></th>
            <th><span class="bn-foot-v">{{ fmt2(footTotal) }}</span></th>
            <th><span class="bn-foot-v">{{ fmt2(footRent) }}</span></th>
            <th></th>
          </tr>
        </tfoot>
      </table>
    </div>

    <!-- 明细抽屉:户头 + 场地租金/水电费两 tab;底部只留关闭(签发/作废撤下,端点保留) -->
    <FPDrawer
      :open="dlgOpen"
      :title="dlgRow ? (dlgRow.tenantName ?? '#' + dlgRow.tenantId) : '催缴单明细'"
      :subtitle="drawerSub"
      icon="file-check-2"
      :width="960"
      :fixedHeight="true"
      @close="dlgOpen = false"
    >
      <div v-if="dlgLoading || !dlgRow" class="bn-empty">加载中…</div>
      <template v-else>
        <!-- 户头(警告=各单去重合并) -->
        <div v-if="dlgRow.warn" class="bn-bar warn">
          <component :is="iconFor('alert-triangle')" :size="14" />
          <span class="bn-warn-multi">{{ dlgRow.warn }}</span>
        </div>
        <div class="bn-hgrid">
          <div class="bn-hfld"><label>位置</label><span :class="{ dim: !dlgRow.premiseText }">{{ dlgRow.premiseText || '—' }}</span></div>
          <div class="bn-hfld"><label>水电合计</label><span class="mono">{{ fmt2(dlgRow.totalAmount) }} 元</span></div>
          <div class="bn-hfld"><label>月租金(参考)</label><span class="mono" :class="{ dim: dlgRow.rent == null }">{{ dlgRow.rent == null ? '–' : fmt2(dlgRow.rent) + ' 元' }}</span></div>
          <div class="bn-hfld"><label>上期欠费</label><span class="mono dim" title="催缴闭环接口点,S4 恒 0,待收款流水接入">{{ fmt2(dlgRow.prevDue) }} 元</span></div>
        </div>

        <Segmented :options="DLG_TABS" v-model="dlgTab" size="sm" />

        <!-- 场地租金 tab:逐份在租合同一带,行=计费行,月额=lineMonthly 参考口径 -->
        <template v-if="dlgTab === 'rent'">
          <div class="bn-refnote">参考口径:整月,未含免租期/按天折</div>
          <div v-if="rentLoading" class="bn-empty">计费行加载中…</div>
          <div v-else-if="rentBands.length === 0" class="bn-empty">本月无在租合同</div>
          <div v-else class="bn-dwrap">
            <table class="bn-dtable">
              <colgroup>
                <col style="width:38px" />
                <col style="width:160px" />
                <col /><!-- 位置:唯一弹性列 -->
                <col style="width:92px" />
                <col style="width:92px" />
                <col style="width:110px" />
              </colgroup>
              <thead>
                <tr>
                  <th>#</th>
                  <th class="l">费项</th>
                  <th class="l">位置</th>
                  <th>单价</th>
                  <th title="按㎡计费显面积,按间计费显间数">面积/间数</th>
                  <th>月额(元)</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="b in rentBands" :key="b.contract.id">
                  <tr class="bn-band">
                    <td :colspan="6" class="l">
                      <span class="bn-band-lbl">{{ b.contract.contractNo }}</span>
                      <span class="bn-band-sub">{{ b.contract.startDate ?? '–' }} ~ {{ b.contract.endDate ?? '–' }} · {{ b.contract.floorInfo }}</span>
                    </td>
                  </tr>
                  <tr v-if="b.lines === null">
                    <td :colspan="6" class="l"><span class="bn-txt dim">计费行载入失败</span></td>
                  </tr>
                  <tr v-else-if="b.lines.length === 0">
                    <td :colspan="6" class="l"><span class="bn-txt dim">未录计费行</span></td>
                  </tr>
                  <tr v-for="(l, i) in b.lines ?? []" :key="l.id">
                    <td><span class="bn-nv dim">{{ i + 1 }}</span></td>
                    <td class="l"><span class="bn-txt" :title="l.feeKey">{{ rentFeeName(l) }}</span></td>
                    <td class="l"><span class="bn-txt dim" :title="l.location || undefined">{{ l.location || '–' }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: l.unitPrice == null }">{{ fmt(l.unitPrice) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: (l.area ?? l.roomCount) == null }">{{ fmt(l.area ?? l.roomCount) }}</span></td>
                    <td><span class="bn-sumc" :class="{ neg: (lineMon(b, l) ?? 0) < 0 }">{{ fmt2(lineMon(b, l)) }}</span></td>
                  </tr>
                  <tr class="bn-sub">
                    <td :colspan="5" class="l"><span class="bn-txt dim">小计 · {{ b.contract.contractNo }}</span></td>
                    <td><span class="bn-sumc">{{ fmt2(bandTotal(b)) }}</span></td>
                  </tr>
                </template>
              </tbody>
              <tfoot>
                <tr>
                  <th :colspan="5" class="l"><span class="bn-foot-lbl">全户合计(参考)</span></th>
                  <th><span class="bn-foot-v">{{ fmt2(rentGrand) }}</span></th>
                </tr>
              </tfoot>
            </table>
          </div>
        </template>

        <!-- 水电费 tab v3(可莱恩 worksheet 版式):非宿舍 电/水两部逐场地费块+维护费块 → 宿舍逐间子表 → 末行合计 -->
        <template v-else>
          <div class="bn-dwrap">
            <table class="bn-dtable">
              <colgroup>
                <col style="width:38px" />
                <col style="width:98px" />
                <col style="width:120px" />
                <col style="width:38px" />
                <col style="width:84px" />
                <col style="width:84px" />
                <col style="width:52px" />
                <col style="width:84px" />
                <col style="width:82px" />
                <col style="width:94px" />
                <col /><!-- 备注:唯一弹性列 -->
                <col style="width:30px" />
              </colgroup>
              <thead>
                <tr>
                  <th>#</th>
                  <th class="l">费项</th>
                  <th class="l">表</th>
                  <th class="l" title="分时段:尖/峰/平/谷">段</th>
                  <th>上月行至</th>
                  <th>本月行至</th>
                  <th>倍率</th>
                  <th>用量</th>
                  <th>单价</th>
                  <th>金额(元)</th>
                  <th class="l">备注</th>
                  <th title="取价审计链:price_key/作用域/价目月/判定分支"></th>
                </tr>
              </thead>
              <tbody>
                <template v-for="(r0, i) in utilRows" :key="i">
                  <tr v-if="r0.t === 'band'" class="bn-band">
                    <td :colspan="12" class="l"><span class="bn-band-lbl">{{ r0.label }}</span></td>
                  </tr>
                  <tr v-else-if="r0.t === 'line'">
                    <td><span class="bn-nv dim">{{ r0.no }}</span></td>
                    <td class="l"><span class="bn-txt" :title="r0.l.feeKey">{{ billFeeLabel(r0.l.feeKey) }}</span></td>
                    <td class="l"><span class="bn-txt" :class="{ dim: !r0.l.meterLabel }">{{ r0.l.meterLabel ?? '–' }}</span></td>
                    <td class="l"><span class="bn-txt">{{ segLabel(r0.l.seg) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r0.l.prevRead == null }">{{ fmt(r0.l.prevRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r0.l.currRead == null }">{{ fmt(r0.l.currRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r0.l.factorSnap == null }">{{ fmt(r0.l.factorSnap) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r0.l.qty == null }">{{ fmt(r0.l.qty) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r0.l.priceSnap == null }" :title="r0.l.priceSnap != null ? String(r0.l.priceSnap) : undefined">{{ fmt(r0.l.priceSnap) }}</span></td>
                    <td><span class="bn-sumc" :class="{ neg: r0.l.amount < 0 }">{{ fmt2(r0.l.amount) }}</span></td>
                    <td class="l"><span class="bn-txt dim" :title="r0.l.note ?? undefined">{{ r0.l.note || '' }}</span></td>
                    <td class="ct">
                      <span v-if="auditTitle(r0.l)" class="bn-info" :title="auditTitle(r0.l)!">
                        <component :is="iconFor('info')" :size="13" />
                      </span>
                    </td>
                  </tr>
                  <tr v-else :class="r0.t === 'part' ? 'bn-part' : 'bn-sub'">
                    <td :colspan="9" class="l">
                      <span :class="r0.t === 'part' ? 'bn-part-lbl' : 'bn-txt dim'">{{ r0.label }}</span>
                    </td>
                    <td><span class="bn-sumc">{{ fmt2(r0.amount) }}</span></td>
                    <td :colspan="2"></td>
                  </tr>
                </template>
                <tr v-if="utilRows.length === 0 && dormLines.length === 0">
                  <td :colspan="12" class="bn-noro">本单无水电行</td>
                </tr>
              </tbody>
            </table>
          </div>

          <!-- 宿舍子表(该户有 dorm 单才出):电=逐间宽行(电表+管理费+路灯分摊),水=水表+绿化水公摊 -->
          <template v-if="dormLines.length">
            <div class="bn-dsec">宿舍水电费(逐间)</div>
            <div class="bn-dwrap">
              <table class="bn-dtable">
                <colgroup>
                  <col style="width:38px" />
                  <col /><!-- 房号:唯一弹性列 -->
                  <col style="width:76px" />
                  <col style="width:90px" />
                  <col style="width:90px" />
                  <col style="width:76px" />
                  <col style="width:90px" />
                  <col style="width:70px" />
                  <col style="width:94px" />
                  <col style="width:84px" />
                </colgroup>
                <thead>
                  <tr>
                    <th>#</th>
                    <th class="l">房号</th>
                    <th title="路灯/绿化水分摊行的面积基数快照">租赁面积</th>
                    <th>上月行至</th>
                    <th>本月行至</th>
                    <th>用量</th>
                    <th>基准电价</th>
                    <th title="电力管理费单价,金额列=用量×(基准电价+管理费)">管理费</th>
                    <th>金额(元)</th>
                    <th title="面积×公摊单价">路灯分摊</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(r1, i) in dorm.elec.rooms" :key="i">
                    <td><span class="bn-nv dim">{{ i + 1 }}</span></td>
                    <td class="l"><span class="bn-txt" :title="r1.room">{{ r1.room }}{{ r1.main.seg ? '·' + segLabel(r1.main.seg) : '' }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.area == null }">{{ fmt(r1.area) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.prevRead == null }">{{ fmt(r1.main.prevRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.currRead == null }">{{ fmt(r1.main.currRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.qty == null }">{{ fmt(r1.main.qty) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.priceSnap == null }" :title="r1.main.priceSnap != null ? String(r1.main.priceSnap) : undefined">{{ fmt(r1.main.priceSnap) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.mgmt == null }">{{ fmt(r1.mgmt?.priceSnap ?? null) }}</span></td>
                    <td><span class="bn-sumc" :class="{ neg: r1.amount < 0 }">{{ fmt2(r1.amount) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.share == null }">{{ r1.share ? fmt2(r1.share.amount) : '–' }}</span></td>
                  </tr>
                  <!-- 配不上间的公摊/损耗行平铺兜底(现状:路灯一行整段/损耗行) -->
                  <tr v-for="(l, i) in dorm.elec.extras" :key="'x' + i">
                    <td></td>
                    <td class="l"><span class="bn-txt dim" :title="l.note ?? l.feeKey">{{ billFeeLabel(l.feeKey) }}</span></td>
                    <td :colspan="6"></td>
                    <td><span class="bn-sumc">{{ fmt2(l.amount) }}</span></td>
                    <td></td>
                  </tr>
                  <tr class="bn-sub">
                    <td :colspan="9" class="l"><span class="bn-txt dim">宿舍电费小计</span></td>
                    <td><span class="bn-sumc">{{ fmt2(dorm.elec.total) }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="bn-dwrap">
              <table class="bn-dtable">
                <colgroup>
                  <col style="width:38px" />
                  <col /><!-- 房号:唯一弹性列 -->
                  <col style="width:90px" />
                  <col style="width:90px" />
                  <col style="width:76px" />
                  <col style="width:90px" />
                  <col style="width:94px" />
                  <col style="width:94px" />
                </colgroup>
                <thead>
                  <tr>
                    <th>#</th>
                    <th class="l">房号</th>
                    <th>上月行至</th>
                    <th>本月行至</th>
                    <th>用量</th>
                    <th>单价</th>
                    <th>金额(元)</th>
                    <th title="面积×公摊单价">绿化水公摊</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(r1, i) in dorm.water.rooms" :key="i">
                    <td><span class="bn-nv dim">{{ i + 1 }}</span></td>
                    <td class="l"><span class="bn-txt" :title="r1.room">{{ r1.room }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.prevRead == null }">{{ fmt(r1.main.prevRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.currRead == null }">{{ fmt(r1.main.currRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.qty == null }">{{ fmt(r1.main.qty) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.priceSnap == null }">{{ fmt(r1.main.priceSnap) }}</span></td>
                    <td><span class="bn-sumc" :class="{ neg: r1.amount < 0 }">{{ fmt2(r1.amount) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.share == null }">{{ r1.share ? fmt2(r1.share.amount) : '–' }}</span></td>
                  </tr>
                  <tr v-for="(l, i) in dorm.water.extras" :key="'x' + i">
                    <td></td>
                    <td class="l"><span class="bn-txt dim" :title="l.note ?? l.feeKey">{{ billFeeLabel(l.feeKey) }}</span></td>
                    <td :colspan="4"></td>
                    <td><span class="bn-sumc">{{ fmt2(l.amount) }}</span></td>
                    <td></td>
                  </tr>
                  <tr class="bn-sub">
                    <td :colspan="7" class="l"><span class="bn-txt dim">宿舍水费小计</span></td>
                    <td><span class="bn-sumc">{{ fmt2(dorm.water.total) }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="bn-grand">
              <span>宿舍水电费、水电维护费合计</span>
              <span class="bn-foot-v">{{ fmt2(dorm.total) }}</span>
            </div>
          </template>

          <div class="bn-grand strong">
            <span>水电费、维护费合计</span>
            <span class="bn-foot-v">{{ fmt2(utilGrand) }}</span>
          </div>
        </template>
      </template>

      <template #footer>
        <Button variant="outline" size="sm" @click="dlgOpen = false">关闭</Button>
      </template>
    </FPDrawer>
  </div>
</template>

<style scoped>
.bn-page { display: flex; flex-direction: column; gap: 14px; height: 100%; min-height: 0; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%; }

/* 标题行(pl-head 家族) */
.bn-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.bn-head-l { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bn-title { margin: 0 6px 0 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.bn-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.bn-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* KPI 条 */
.bn-kpis { flex: 0 0 auto; display: grid; grid-template-columns: repeat(4, minmax(150px, 1fr)); gap: 12px; }

/* 提示条(pl-bar 家族) */
.bn-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--fs-label); color: var(--text-secondary); flex-wrap: wrap; }
.bn-bar.warn { border-color: var(--hue-orange); background: rgb(255, 250, 235); color: rgb(138, 97, 0); }
.bn-bar.ok { border-style: solid; border-color: var(--hue-green); background: rgb(240, 251, 244); color: rgb(21, 108, 60); }
/* 各单 warn 换行合并后逐行显示 */
.bn-warn-multi { white-space: pre-line; }

/* 筛选行 */
.bn-toolbar { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.bn-chk { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-secondary); cursor: pointer; }
.bn-chk input { accent-color: var(--hue-blue); }
.bn-search { width: 230px; height: 32px; padding: 0 12px; box-sizing: border-box; border: 1px solid var(--border-subtle); border-radius: var(--radius-full); font-size: 12.5px; background: var(--surface-white); color: var(--text-primary); }
.bn-search:focus { outline: none; border-color: var(--hue-blue); }

/* ── 列表宽表(pl-table/FPLedgerTable 手法:sticky 表头/34px 行/tfoot 钉底) ── */
.bn-wrap { flex: 1 1 auto; min-height: 0; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--surface-white); }
.bn-table { border-collapse: separate; border-spacing: 0; width: 100%; table-layout: fixed; font-family: var(--font-sans); }
.bn-table th, .bn-table td { border-bottom: 1px solid var(--divider); box-sizing: border-box; padding: 0 8px; overflow: hidden; }
.bn-table thead th { position: sticky; top: 0; height: 34px; background: var(--surface-card); color: var(--text-muted); font-size: 11.5px; font-weight: var(--fw-semibold); text-align: right; z-index: 4; white-space: nowrap; }
.bn-table thead th.l, .bn-table td.l { text-align: left; }
.bn-table td.ct { text-align: center; }
.bn-table tbody td { height: 34px; background: var(--surface-white); vertical-align: middle; text-align: right; cursor: pointer; }
.bn-table tbody tr:hover td { background: var(--surface-card); }
/* 账外户视觉降淡(出单不入应收) */
.bn-table tbody tr.offbook { opacity: .55; }
.bn-table tbody tr:last-child td { cursor: default; }
.bn-noro { text-align: center !important; padding: 40px 16px !important; color: var(--text-disabled); font-size: var(--fs-label); cursor: default !important; }
.bn-table tfoot th { position: sticky; bottom: 0; z-index: 5; height: 40px; font-weight: var(--fw-semibold); background: var(--surface-white); border-top: 2px solid var(--border-strong); font-family: var(--font-mono); color: var(--text-primary); text-align: right; }
.bn-table tfoot th.l { text-align: left; }
.bn-foot-lbl { display: block; text-align: left; font-family: var(--font-sans); font-size: 12.5px; color: var(--text-primary); }
.bn-foot-v { display: block; text-align: right; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--brand-deep); }

/* 单元格家族(pl 同款) */
.bn-tname { display: block; font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bn-txt { display: block; text-align: left; font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bn-txt.dim { color: var(--text-muted); }
.bn-nv { display: block; text-align: right; font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bn-nv.empty, .bn-nv.dim { color: var(--text-disabled); }
.bn-sumc { display: block; text-align: right; font-weight: var(--fw-semibold); color: var(--hue-blue); font-size: 12px; font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.bn-sumc.neg { color: var(--hue-red); }

/* 警告角标(悬停显原文) */
.bn-warn { display: inline-grid; place-items: center; width: 16px; height: 16px; border-radius: var(--radius-full); background: rgb(255, 238, 237); color: var(--hue-red); font-size: 11px; font-weight: var(--fw-semibold); cursor: help; }

/* ── 抽屉:户头 + 两 tab 明细行表(md-htable 家族) ── */
.bn-empty { padding: 40px 12px; text-align: center; color: var(--text-disabled); font-size: var(--fs-label); }
.bn-hgrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px 18px; margin-bottom: 12px; }
.bn-hfld { min-width: 0; }
.bn-hfld label { display: block; margin-bottom: 4px; font-size: var(--fs-label); color: var(--text-muted); }
.bn-hfld span { font-size: var(--fs-body); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: block; }
.bn-hfld .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.bn-hfld .dim, .bn-hfld .mono.dim { color: var(--text-disabled); }
.bn-bar.warn + .bn-hgrid { margin-top: 12px; }

/* 租金参考口径灰字标注 */
.bn-refnote { font-size: 11.5px; color: var(--text-muted); margin: -12px 0 -10px; }

.bn-dwrap { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: auto; }
.bn-dtable { width: 100%; border-collapse: separate; border-spacing: 0; table-layout: fixed; font-size: 12px; white-space: nowrap; }
.bn-dtable th, .bn-dtable td { box-sizing: border-box; padding: 0 8px; border-bottom: 1px solid var(--divider); overflow: hidden; text-overflow: ellipsis; }
.bn-dtable thead th { position: sticky; top: 0; z-index: 2; height: 30px; text-align: right; font-weight: var(--fw-medium); font-size: 11px; color: var(--text-muted); background: var(--surface-card); }
.bn-dtable thead th.l, .bn-dtable td.l { text-align: left; }
.bn-dtable td.ct { text-align: center; }
.bn-dtable tbody td { height: 30px; text-align: right; background: var(--surface-white); vertical-align: middle; }
.bn-dtable tbody tr:last-child td { border-bottom: none; }
/* 分带(pl-band 轻量版;水电=premise 段,租金=合同带)与小计行 */
.bn-dtable tr.bn-band td { height: 30px; background: var(--surface-sunken); border-top: 1px solid var(--border-strong); }
.bn-band-lbl { font-size: 12px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.bn-band-sub { margin-left: 8px; font-size: 11.5px; color: var(--text-muted); }
.bn-dtable tr.bn-sub td { background: var(--surface-card); }
/* 部合计行(电费、用电维护费合计/水费、用水维护费合计)比块小计重一档 */
.bn-dtable tr.bn-part td { background: var(--surface-sunken); border-top: 1px solid var(--border-strong); }
.bn-part-lbl { font-size: 12px; font-weight: var(--fw-semibold); color: var(--text-primary); }
/* 宿舍子表节标题 + 合计横条(宿舍段合计/末行全户合计) */
.bn-dsec { font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); margin-bottom: -6px; }
.bn-grand { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-card); font-size: 12.5px; color: var(--text-primary); }
.bn-grand.strong { background: var(--surface-sunken); border-color: var(--border-strong); font-weight: var(--fw-semibold); }
.bn-grand .bn-foot-v { font-size: 12.5px; }
.bn-dtable tfoot th { position: sticky; bottom: 0; height: 34px; background: var(--surface-white); border-top: 2px solid var(--border-strong); text-align: right; font-family: var(--font-mono); }
.bn-dtable tfoot th.l { text-align: left; }
/* 审计链 info 图标 */
.bn-info { display: inline-grid; place-items: center; color: var(--text-disabled); cursor: help; }
.bn-info:hover { color: var(--hue-blue); }
</style>
