<script setup lang="ts">
// 催缴单屏 v2(S4-BILL-NOTICE-SPEC §7 S4-4 v2 拍板):一个租户一条(该户全部单据合并,
// 对齐 Excel 每租户一张 worksheet);一期/二期/三期分 tab(期归属=在租合同楼栋 phase→premise 前缀→兜底一期);
// 屏上不显收款主体/单据类/状态(引擎照旧拆单落库,只是 UI 聚合);签发/作废本轮撤下(api 端点保留)。
// 明细抽屉两 tab:场地租金(S5 刀4:fee_group='rent' 落库行,厂房/办公室/宿舍逐间块+面积拆解+折算式备注)在前、
// 水电费(全单明细合并,沿用 premise 分带小计+取价审计链悬浮)在后;
// 改造三:维护费块公摊按纸单合并成一行(五项,多池加总,构成进费项名悬浮),金额一分不改。
// 列表照 PoolLedgerView 手法(sticky 表头/34px 行/tfoot 钉底/zone Segmented)+LIST-PAGE-SPEC 列宽铁律;
// 账外户(offbook)整行降淡。写操作 admin(viewer 隐藏),GET 全员。
import { computed, onMounted, ref, watch } from 'vue'
import {
  billNoticesApi, type BillNoticeDTO, type BillNoticeDetailDTO, type BillNoticeLineDTO,
} from '@/api/billNotices'
import { contractApi } from '@/api/contract'
import { PROPERTY_TYPE_LABEL, type ContractDTO, type PropertyType } from '@/types/contract'
import { buildingApi } from '@/api/building'
import type { BuildingDTO } from '@/types/building'
import { metersApi } from '@/api/meters'
import { buildYearOptions } from '@/utils/yearGate'
import {
  aggregateByTenant, auditTitle, billFeeLabel, billFeeTitle, billQtyCell, crossBuildingMark, dormPriceCells,
  groupByBuilding, groupDormExcelStyle, groupExcelStyle, groupRentByPremise, mergeMaintRows, rentAreaText,
  rentByTenant, rentFeeName, resolvePhase, segLabel, tenantBuildings, tenantKpis,
  type CrossMark, type QtyCell, type ShareMergeRow, type TenantBuildings, type TenantNoticeRow,
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
interface DisplayRow extends TenantNoticeRow {
  rent: number | null; phase: 1 | 2 | 3
  bld: TenantBuildings          // 改造二:主楼栋(归组用)+全部楼栋
  mark: CrossMark | null        // 跨楼栋轻标记(单栋户 null)
}
const tenantRows = computed<DisplayRow[]>(() => aggregateByTenant(rows.value ?? []).map(t => {
  const cs = contractsByTenant.value.get(t.tenantId) ?? []
  const bld = tenantBuildings(cs)
  return {
    ...t,
    rent: rentMap.value.get(t.tenantId) ?? null,
    phase: resolvePhase(
      cs.map(c => {
        const b = bById.value.get(c.buildingId)
        return { phase: b?.phase ?? 0, name: b?.name ?? '' }
      }),
      t.premiseText),
    bld,
    mark: crossBuildingMark(bld),
  }
}))

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
// 改造二:期 tab 内按主楼栋分组(入参=筛选后的行 → 搜索/仅看警告/换期自动重算,空组不出现)
const groups = computed(() => groupByBuilding(filtered.value, r => r.bld.main))
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
let dlgSeq = 0

async function openDetail(r: DisplayRow) {
  dlgOpen.value = true
  dlgTab.value = 'rent'
  dlgRow.value = r
  dlgLoading.value = true
  details.value = []
  const my = ++dlgSeq
  try {
    const ds = await Promise.all(r.noticeIds.map(id => billNoticesApi.detail(id)))
    if (my !== dlgSeq) return
    details.value = ds
  } catch (e) {
    if (my !== dlgSeq) return
    alert(errMsg(e, '明细加载失败')); dlgOpen.value = false
  } finally { if (my === dlgSeq) dlgLoading.value = false }
}

// 水电 tab v3(可莱恩 worksheet 版式):非宿舍单→电/水两部逐场地「费块+维护费块」;
// dorm 单→宿舍逐间子表;末行合计=非宿舍+宿舍。行归块在 billNoticeLogic 纯函数,此处只拍平成渲染行。
// S5 起单内混租金行(fee_group='rent'),水电 tab 只吃非 rent 行。
const utilLines = computed(() => details.value.map(d => ({ ...d, lines: d.lines.filter(l => l.feeGroup !== 'rent') })))
const mainLines = computed(() => utilLines.value.filter(d => d.noticeKind !== 'dorm').flatMap(d => d.lines))
const dormLines = computed(() => utilLines.value.filter(d => d.noticeKind === 'dorm').flatMap(d => d.lines))
const xg = computed(() => groupExcelStyle(mainLines.value))
const dorm = computed(() => groupDormExcelStyle(dormLines.value))
const utilGrand = computed(() => r2(xg.value.total + dorm.value.total))
// 非宿舍表拍平:band(块头)/line(明细行,块内重编号)/merge(公摊合并行)/sub(块小计)/part(部合计)。
// 改造三:维护费块过 mergeMaintRows——公摊五项各一行(纸单口径),小计仍取 groupExcelStyle 的原始行累加。
type UtilRowVM =
  | { t: 'band'; label: string }
  | { t: 'line'; no: number; l: BillNoticeLineDTO; q: QtyCell }   // q=刀D 可验算的乘数/单位/显示价
  | { t: 'merge'; no: number; m: ShareMergeRow<BillNoticeLineDTO> }
  | { t: 'sub' | 'part'; label: string; amount: number }
const utilRows = computed<UtilRowVM[]>(() => {
  const out: UtilRowVM[] = []
  const block = (
    label: string, ls: BillNoticeLineDTO[], subLabel: string | null, subAmount: number, merge = false,
  ) => {
    if (!ls.length) return
    out.push({ t: 'band', label })
    const rows = merge ? mergeMaintRows(ls) : ls.map(l => ({ kind: 'line' as const, line: l }))
    rows.forEach((r, i) => out.push(r.kind === 'line'
      ? { t: 'line', no: i + 1, l: r.line, q: billQtyCell(r.line) }
      : { t: 'merge', no: i + 1, m: r.row }))
    if (subLabel) out.push({ t: 'sub', label: subLabel, amount: subAmount })
  }
  const g = xg.value
  for (const p of g.elec.groups) {
    block(`电费(${p.label})`, p.fee, '场地电费合计', p.feeTotal)
    block(`用电维护费(${p.label})`, p.maint, '场地维护费合计', p.maintTotal, true)
  }
  if (g.elec.groups.length) out.push({ t: 'part', label: '电费、用电维护费合计', amount: g.elec.total })
  for (const p of g.water.groups) {
    block(`水费(${p.label})`, p.fee, null, 0)
    block(`用水维护费(${p.label})`, p.maint, null, 0, true)
    out.push({ t: 'sub', label: `场地水费、维护费合计(${p.label})`, amount: p.subtotal })
  }
  if (g.water.groups.length) out.push({ t: 'part', label: '水费、用水维护费合计', amount: g.water.total })
  block('其他费项', g.other, '其他费项合计', g.otherTotal)
  return out
})

// 宿舍子表(S7 缺口③):两价各补到能验平自己那段的位数;配不上间的 extras 也铺出乘数/单价,同样逐行可验
const dormElecRows = computed(() => dorm.value.elec.rooms.map(r => ({ r, c: dormPriceCells(r.main, r.mgmt) })))
const dormWaterRows = computed(() => dorm.value.water.rooms.map(r => ({ r, c: dormPriceCells(r.main, null) })))
const dormElecExtras = computed(() => dorm.value.elec.extras.map(l => ({ l, q: billQtyCell(l) })))
const dormWaterExtras = computed(() => dorm.value.water.extras.map(l => ({ l, q: billQtyCell(l) })))
// 路灯/绿化水公摊格悬浮:面积×分摊单价=金额(与主表同一套判定,该格只有金额没法心算)
function shareTitle(l: BillNoticeLineDTO | null): string | undefined {
  if (!l) return undefined
  const q = billQtyCell(l)
  return q.qty == null ? undefined : `${q.qty} ${q.unit} × ${q.price} = ${fmt2(l.amount)}`
}

// 场地租金 tab(S5 刀4):渲染 fee_group='rent' 落库行,按 premise 分块(厂房/办公室/宿舍逐间)
const rentLines = computed(() => details.value.flatMap(d => d.lines).filter(l => l.feeGroup === 'rent'))
const rentG = computed(() => groupRentByPremise(rentLines.value))
const rentBandLabel = (g: { type: PropertyType | null; label: string }) =>
  g.type ? `${PROPERTY_TYPE_LABEL[g.type]}(${g.label})` : g.label

const drawerSub = computed(() => {
  const r = dlgRow.value
  if (!r) return ''
  const cn = (contractsByTenant.value.get(r.tenantId) ?? []).length
  return [ym.value, `在租合同 ${cn} 份`, `明细 ${r.lineCount} 行`].join(' · ')
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
      <FPStat label="本期总额(元)" :value="fmt2(kpis.total)" tint="sky" sub="S5 起含租金板块" />
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
            <th>行数</th>
            <th title="该户全部单据本期合计之和(租金+水电,含宿舍单);账外户降淡不入应收">本期合计(元)</th>
            <th title="该户当月在租合同月租之和;参考口径:整月,未含免租期/按天折">月租金(参考)</th>
            <th title="门禁告警:缺价/表未归属合同/费项未设收款公司/合计为负…各单去重合并,悬停「!」看原文">警告</th>
          </tr>
        </thead>
        <tbody>
          <!-- 楼栋分组:组头(楼栋名 · 户数 · 组内本期合计)+ 组内租户行;跨栋户只在主楼栋组出现一次 -->
          <template v-for="g in groups" :key="g.id ?? 'none'">
            <tr class="bn-band">
              <td class="l" :colspan="3">
                <span class="bn-band-lbl">{{ g.name }}</span><span class="bn-band-sub">{{ g.count }} 户</span>
              </td>
              <td><span class="bn-sumc">{{ fmt2(g.total) }}</span></td>
              <td :colspan="2"></td>
            </tr>
            <tr v-for="r in g.rows" :key="r.tenantId" :class="{ offbook: r.offbook }" @click="openDetail(r)">
              <td class="l">
                <span class="bn-tname" :title="r.tenantName ?? undefined">{{ r.tenantName ?? '#' + r.tenantId
                  }}<em v-if="r.mark" class="bn-xb" :title="r.mark.tip">{{ r.mark.badge }}</em></span>
              </td>
              <td class="l"><span class="bn-txt dim" :title="r.premiseText ?? undefined">{{ r.premiseText || '–' }}</span></td>
              <td><span class="bn-nv">{{ r.lineCount }}</span></td>
              <td><span class="bn-sumc" :class="{ neg: r.totalAmount < 0 }">{{ fmt2(r.totalAmount) }}</span></td>
              <td><span class="bn-nv" :class="{ empty: r.rent == null }">{{ fmt2(r.rent) }}</span></td>
              <td class="ct"><span v-if="r.warn" class="bn-warn" :title="r.warn">!</span></td>
            </tr>
          </template>
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
      :full="true"
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
          <div class="bn-hfld"><label>本期合计</label><span class="mono">{{ fmt2(dlgRow.totalAmount) }} 元</span></div>
          <div class="bn-hfld"><label>月租金(参考)</label><span class="mono" :class="{ dim: dlgRow.rent == null }">{{ dlgRow.rent == null ? '–' : fmt2(dlgRow.rent) + ' 元' }}</span></div>
          <div class="bn-hfld"><label>上期欠费</label><span class="mono dim" title="催缴闭环接口点,S4 恒 0,待收款流水接入">{{ fmt2(dlgRow.prevDue) }} 元</span></div>
        </div>

        <Segmented :options="DLG_TABS" v-model="dlgTab" size="sm" />

        <!-- 场地租金 tab(S5 刀4):fee_group='rent' 落库行,一场地一块(厂房/办公室/宿舍逐间);
             面积列显「建筑+公摊」拆解,备注列显按天折算式/免租期扣减 -->
        <template v-if="dlgTab === 'rent'">
          <div v-if="rentG.groups.length === 0" class="bn-empty">本月无租金行 —— 重新生成后按合同条款派生</div>
          <div v-else class="bn-dwrap">
            <table class="bn-dtable">
              <colgroup>
                <col style="width:38px" />
                <col style="width:200px" />
                <col style="width:92px" />
                <col style="width:120px" />
                <col style="width:110px" />
                <col /><!-- 备注:唯一弹性列 -->
              </colgroup>
              <thead>
                <tr>
                  <th>#</th>
                  <th class="l">费项</th>
                  <th>单价</th>
                  <th title="行带建筑+公摊两格时显拆解(如 1528+458);按间计费显间数">面积/间数</th>
                  <th>金额(元)</th>
                  <th class="l" title="非整月按天折算式(如 1130÷31×26);免租期扣减">备注</th>
                </tr>
              </thead>
              <tbody>
                <template v-for="g in rentG.groups" :key="g.label">
                  <tr class="bn-band">
                    <td :colspan="6" class="l"><span class="bn-band-lbl">{{ rentBandLabel(g) }}</span></td>
                  </tr>
                  <tr v-for="(l, i) in g.lines" :key="i">
                    <td><span class="bn-nv dim">{{ i + 1 }}</span></td>
                    <td class="l"><span class="bn-txt" :title="l.feeKey">{{ rentFeeName(l.feeKey, g.type) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: l.priceSnap == null }">{{ fmt(l.priceSnap) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: l.qty == null }">{{ rentAreaText(l.qty, l.baseSnap) ?? '–' }}</span></td>
                    <td><span class="bn-sumc" :class="{ neg: l.amount < 0 }">{{ fmt2(l.amount) }}</span></td>
                    <td class="l"><span class="bn-txt dim" :title="l.note ?? undefined">{{ l.note || '' }}</span></td>
                  </tr>
                  <tr class="bn-sub">
                    <td :colspan="4" class="l"><span class="bn-txt dim">小计 · {{ g.label }}</span></td>
                    <td><span class="bn-sumc">{{ fmt2(g.subtotal) }}</span></td>
                    <td></td>
                  </tr>
                </template>
              </tbody>
              <tfoot>
                <tr>
                  <th :colspan="4" class="l"><span class="bn-foot-lbl">租金板块合计</span></th>
                  <th><span class="bn-foot-v">{{ fmt2(rentG.total) }}</span></th>
                  <th></th>
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
                <col style="width:98px" /><!-- 费项:租户单口径下最长「水管网维护费」6 字;池名已移进悬浮,不再需要 272px -->
                <col style="width:120px" />
                <col style="width:38px" />
                <col style="width:84px" />
                <col style="width:84px" />
                <col style="width:52px" />
                <col style="width:96px" /><!-- 用量:刀D 后带单位后缀「3,200 ㎡」「1,867.89 元」,84px 会截 -->
                <col style="width:92px" /><!-- 单价:最少可验算位数,大额行要显到 8 位「0.63586875」 -->
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
                  <th title="乘数列:按面积摊的行显面积(㎡)、线路损耗显金额基数(元),其余显用量;
悬浮单元格看原度数。逐行 用量×单价=金额 可心算">用量</th>
                  <th title="按能验算的最少位数显示(0.0271 不会被压成 0.03);悬浮看落库原值。
消防/楼层照明/电梯的按面积摊行落库价是电价(元/度),等效元/㎡ 率没落库——此处显 金额÷面积,悬浮该格看说明">单价</th>
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
                    <td class="l"><span class="bn-txt" :class="{ help: r0.l.feeKey.startsWith('share_') }" :title="billFeeTitle(r0.l)">{{ billFeeLabel(r0.l.feeKey) }}</span></td>
                    <td class="l"><span class="bn-txt" :class="{ dim: !r0.l.meterLabel }">{{ r0.l.meterLabel ?? '–' }}</span></td>
                    <td class="l"><span class="bn-txt">{{ segLabel(r0.l.seg) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r0.l.prevRead == null }">{{ fmt(r0.l.prevRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r0.l.currRead == null }">{{ fmt(r0.l.currRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r0.l.factorSnap == null }">{{ fmt(r0.l.factorSnap) }}</span></td>
                    <td>
                      <span class="bn-nv" :class="{ empty: r0.q.qty == null }" :title="r0.q.title ?? undefined">
                        {{ r0.q.unit === '元' ? fmt2(r0.q.qty) : fmt(r0.q.qty) }}<em v-if="r0.q.unit" class="bn-u">{{ r0.q.unit }}</em>
                      </span>
                    </td>
                    <td><span class="bn-nv" :class="{ empty: r0.l.priceSnap == null }" :title="r0.l.priceSnap != null ? String(r0.l.priceSnap) : undefined">{{ r0.q.price }}</span></td>
                    <td><span class="bn-sumc" :class="{ neg: r0.l.amount < 0 }">{{ fmt2(r0.l.amount) }}</span></td>
                    <td class="l"><span class="bn-txt dim" :title="r0.l.note ?? undefined">{{ r0.l.note || '' }}</span></td>
                    <td class="ct">
                      <span v-if="auditTitle(r0.l)" class="bn-info" :title="auditTitle(r0.l)!">
                        <component :is="iconFor('info')" :size="13" />
                      </span>
                    </td>
                  </tr>
                  <!-- 公摊合并行(纸单口径:一项一行,多池加总);表/段留 –,构成逐条在费项名悬浮里 -->
                  <tr v-else-if="r0.t === 'merge'">
                    <td><span class="bn-nv dim">{{ r0.no }}</span></td>
                    <td class="l"><span class="bn-txt help" :title="r0.m.title">{{ r0.m.label }}</span></td>
                    <td class="l"><span class="bn-txt dim">–</span></td>
                    <td class="l"><span class="bn-txt dim">–</span></td>
                    <td :colspan="3"></td>
                    <td>
                      <span class="bn-nv" :class="{ empty: r0.m.qty == null }">
                        {{ r0.m.qty == null ? '–' : r0.m.unit === '元' ? fmt2(r0.m.qty) : fmt(r0.m.qty)
                        }}<em v-if="r0.m.qty != null && r0.m.unit" class="bn-u">{{ r0.m.unit }}</em>
                      </span>
                    </td>
                    <td><span class="bn-nv" :class="{ empty: r0.m.price == null }">{{ r0.m.price ?? '–' }}</span></td>
                    <td><span class="bn-sumc" :class="{ neg: r0.m.amount < 0 }">{{ fmt2(r0.m.amount) }}</span></td>
                    <td class="l"><span class="bn-txt dim">{{ r0.m.note || '' }}</span></td>
                    <td></td>
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
                  <col style="width:92px" /><!-- 用量:extras 行带单位后缀「5,214.64 ㎡」,76px 会截 -->
                  <col style="width:102px" /><!-- 基准电价:补位到能验平,实测最长 10 字符「0.63586875」(宿舍楼四座338室/保障房2·3号楼),90px 会截 -->
                  <col style="width:74px" />
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
                    <th title="按能验算的最少位数显示;悬浮看落库原值">基准电价</th>
                    <th title="电力管理费单价">管理费</th>
                    <th title="金额=用量×基准电价 + 用量×管理费,两段各自四舍五入到分后相加(引擎逐行落库口径,
不是用量×两价之和——合并会差 1 分)">金额(元)</th>
                    <th title="面积×公摊单价,悬浮该格看算式">路灯分摊</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="({ r: r1, c }, i) in dormElecRows" :key="i">
                    <td><span class="bn-nv dim">{{ i + 1 }}</span></td>
                    <td class="l"><span class="bn-txt" :title="r1.room">{{ r1.room }}{{ r1.main.seg ? '·' + segLabel(r1.main.seg) : '' }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.area == null }">{{ fmt(r1.area) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.prevRead == null }">{{ fmt(r1.main.prevRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.currRead == null }">{{ fmt(r1.main.currRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.qty == null }">{{ fmt(r1.main.qty) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.priceSnap == null }" :title="r1.main.priceSnap != null ? `落库原值 ${r1.main.priceSnap};电费段 ${fmt2(r1.main.amount)} 元` : undefined">{{ c.price }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.mgmt == null }" :title="r1.mgmt ? `落库原值 ${r1.mgmt.priceSnap};管理费段 ${fmt2(r1.mgmt.amount)} 元` : undefined">{{ c.mgmt }}</span></td>
                    <td><span class="bn-sumc" :class="{ neg: r1.amount < 0 }">{{ fmt2(r1.amount) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.share == null }" :title="shareTitle(r1.share)">{{ r1.share ? fmt2(r1.share.amount) : '–' }}</span></td>
                  </tr>
                  <!-- 配不上间的公摊/损耗行平铺兜底(现状:路灯一行整段/损耗行);乘数与单价照铺,同样逐行可验 -->
                  <tr v-for="({ l, q }, i) in dormElecExtras" :key="'x' + i">
                    <td></td>
                    <td class="l"><span class="bn-txt dim" :class="{ help: l.feeKey.startsWith('share_') }" :title="billFeeTitle(l)">{{ billFeeLabel(l.feeKey) }}</span></td>
                    <td :colspan="3"></td>
                    <td>
                      <span class="bn-nv" :class="{ empty: q.qty == null }" :title="q.title ?? undefined">
                        {{ q.unit === '元' ? fmt2(q.qty) : fmt(q.qty) }}<em v-if="q.unit" class="bn-u">{{ q.unit }}</em>
                      </span>
                    </td>
                    <td><span class="bn-nv" :class="{ empty: l.priceSnap == null }" :title="l.priceSnap != null ? String(l.priceSnap) : undefined">{{ q.price }}</span></td>
                    <td></td>
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
                  <col style="width:92px" /><!-- 用量:extras 行带单位后缀「5,214.64 ㎡」,76px 会截 -->
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
                    <th title="按能验算的最少位数显示;悬浮看落库原值">单价</th>
                    <th title="金额=用量×单价(四舍五入到分)">金额(元)</th>
                    <th title="面积×公摊单价,悬浮该格看算式">绿化水公摊</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="({ r: r1, c }, i) in dormWaterRows" :key="i">
                    <td><span class="bn-nv dim">{{ i + 1 }}</span></td>
                    <td class="l"><span class="bn-txt" :title="r1.room">{{ r1.room }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.prevRead == null }">{{ fmt(r1.main.prevRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.currRead == null }">{{ fmt(r1.main.currRead) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.qty == null }">{{ fmt(r1.main.qty) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.main.priceSnap == null }" :title="r1.main.priceSnap != null ? String(r1.main.priceSnap) : undefined">{{ c.price }}</span></td>
                    <td><span class="bn-sumc" :class="{ neg: r1.amount < 0 }">{{ fmt2(r1.amount) }}</span></td>
                    <td><span class="bn-nv" :class="{ empty: r1.share == null }" :title="shareTitle(r1.share)">{{ r1.share ? fmt2(r1.share.amount) : '–' }}</span></td>
                  </tr>
                  <tr v-for="({ l, q }, i) in dormWaterExtras" :key="'x' + i">
                    <td></td>
                    <td class="l"><span class="bn-txt dim" :class="{ help: l.feeKey.startsWith('share_') }" :title="billFeeTitle(l)">{{ billFeeLabel(l.feeKey) }}</span></td>
                    <td :colspan="2"></td>
                    <td>
                      <span class="bn-nv" :class="{ empty: q.qty == null }" :title="q.title ?? undefined">
                        {{ q.unit === '元' ? fmt2(q.qty) : fmt(q.qty) }}<em v-if="q.unit" class="bn-u">{{ q.unit }}</em>
                      </span>
                    </td>
                    <td><span class="bn-nv" :class="{ empty: l.priceSnap == null }" :title="l.priceSnap != null ? String(l.priceSnap) : undefined">{{ q.price }}</span></td>
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
/* 楼栋分组头(抽屉 bn-band 同款;34px 行高铁律照旧,组小计对齐「本期合计」列) */
.bn-table tr.bn-band td, .bn-table tbody tr.bn-band:hover td { height: 34px; background: var(--surface-sunken); border-top: 1px solid var(--border-strong); cursor: default; }
/* 跨楼栋轻标记(悬浮列全部楼栋) */
.bn-xb { margin-left: 6px; padding: 1px 5px; border-radius: var(--radius-full); background: var(--surface-sunken); font-style: normal; font-size: 10.5px; color: var(--text-muted); cursor: help; }
.bn-xb:hover { color: var(--hue-blue); }
.bn-noro { text-align: center !important; padding: 40px 16px !important; color: var(--text-disabled); font-size: var(--fs-label); cursor: default !important; }
.bn-table tfoot th { position: sticky; bottom: 0; z-index: 5; height: 40px; font-weight: var(--fw-semibold); background: var(--surface-white); border-top: 2px solid var(--border-strong); font-family: var(--font-mono); color: var(--text-primary); text-align: right; }
.bn-table tfoot th.l { text-align: left; }
.bn-foot-lbl { display: block; text-align: left; font-family: var(--font-sans); font-size: 12.5px; color: var(--text-primary); }
.bn-foot-v { display: block; text-align: right; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--brand-deep); }

/* 单元格家族(pl 同款) */
.bn-tname { display: block; font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bn-txt { display: block; text-align: left; font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bn-txt.dim { color: var(--text-muted); }
/* 公摊费项名可悬浮看来源(同 .bn-info 手法:cursor:help + hover 变蓝) */
.bn-txt.help { cursor: help; }
.bn-txt.help:hover { color: var(--hue-blue); }
.bn-nv { display: block; text-align: right; font-size: 12px; color: var(--text-secondary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.bn-nv.empty, .bn-nv.dim { color: var(--text-disabled); }
.bn-u { font-style: normal; font-size: 10px; color: var(--text-disabled); margin-left: 2px; }   /* 刀D 乘数单位后缀 */
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

/* flex:0 0 auto——fp-dwr-body 是定高 flex 列,不禁 shrink 各表会被等比压扁出内部滚动条(2026-08-05 报障);
   整卡只留 body 一条滚动,overflow:auto 仅兜横向 */
.bn-dwrap { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); overflow: auto; flex: 0 0 auto; }
.bn-bar, .bn-hgrid, .bn-dsec, .bn-grand { flex-shrink: 0; }
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
