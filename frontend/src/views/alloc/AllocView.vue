<script setup lang="ts">
// 公摊分摊(PB-ALLOCATION-SPEC §3)— 独立屏,数据中心·出账链组(园区抄表之后)。
// 顶部 Segmented 三段(会话内记住,KeepAlive):分摊规则 / 月度分摊(默认) / 损耗与对账。
// 抄表=录「量」,本屏=生成「钱」:用量唯一来源=P-A meter_reading 派生;生成=快照写入,
// 读数事后重导不让已出账数字漂移(抽屉现算与快照不符标「读数已变,可重新生成」)。
// 编辑模式遵 EDIT-MODE-SPEC v2:浏览态完全只读;viewer 永远浏览态。列表遵 LIST-PAGE-SPEC 定宽列/等高行
// (行数=规则×1/租户×1 固定量级,沿 ElecCostView 卡片内不分页形态)。
import { ref, computed, onMounted, onDeactivated, watch } from 'vue'
import {
  allocApi,
  type AllocCfgDTO, type AllocDetailRowDTO, type AllocFeeKey, type AllocMethod,
  type AllocReconDTO, type AllocResultDTO, type AllocRuleDTO, type AllocZone,
} from '@/api/alloc'
import { metersApi, type MeterDTO } from '@/api/meters'
import { tenantApi } from '@/api/tenant'
import { buildingApi } from '@/api/building'
import type { TenantDTO } from '@/types/tenant'
import type { BuildingDTO } from '@/types/building'
import {
  ALLOC_FEE_KEYS, ALLOC_FEE_LABEL, ALLOC_METHOD_LABEL,
  buildAllocExportAoa, buildMonthlyGrid, resolveCfg, type AllocGridRow,
} from '@/utils/allocLogic'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Card from '@/components/ds/Card.vue'
import Select from '@/components/ds/Select.vue'
import Input from '@/components/ds/Input.vue'
import Segmented from '@/components/ds/Segmented.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPTenantPicker from '@/components/fp/FPTenantPicker.vue'
import type { FPTenantOption } from '@/components/fp/fpTenantPicker'

const auth = useAuthStore()
const canEdit = computed(() => !auth.isReadonly)

// ── 编辑模式(EDIT-MODE-SPEC v2):不跨会话;KeepAlive 切页签回来也回浏览态 ──
const editMode = ref(false)
onDeactivated(() => { editMode.value = false; ruleDlg.value = false; manualDlg.value = false })

const pad2 = (n: number) => String(n).padStart(2, '0')
const fq = (n: number | null | undefined) =>
  n == null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const fy = (n: number | null | undefined) =>
  n == null ? '—' : '¥' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fpct = (r: number | null | undefined) => (r == null ? '—' : (r * 100).toFixed(2) + '%')
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback

// ── 三段 Segmented(会话记忆=组件 ref)+ zone tabs + 年月(years 数据驱动,同 PV 口径) ──
const seg = ref('monthly')
const SEG_OPTS = [
  { value: 'rules', label: '分摊规则' },
  { value: 'monthly', label: '月度分摊' },
  { value: 'recon', label: '损耗与对账' },
]
const zone = ref<string>('p1')
const ZONE_OPTS = [{ value: 'p1', label: '一期' }, { value: 'p2', label: '二期' }]

const today = new Date()
const year = ref(today.getFullYear())
const month = ref(today.getMonth() + 1)
const dataYears = ref<number[]>([])
const yearOpts = computed(() =>
  [...new Set([...dataYears.value, today.getFullYear()])].sort((a, b) => a - b)
    .map(y => ({ value: String(y), label: `${y}年` })))
const monthOpts = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` }))
const ym = computed(() => `${year.value}-${pad2(month.value)}`)

// ── 数据 ──
const rules = ref<AllocRuleDTO[] | null>(null)
const results = ref<AllocResultDTO[] | null>(null)
const cfgs = ref<AllocCfgDTO[] | null>(null)
const recon = ref<AllocReconDTO | null>(null)
const tenants = ref<TenantDTO[]>([])
const buildings = ref<BuildingDTO[]>([])
const meters = ref<MeterDTO[]>([])

async function loadRules() { rules.value = await allocApi.rules() }
// 竞态守卫:快速切年月只接受最新一次请求
let seq = 0
async function loadMonth() {
  const my = ++seq
  const [rs, cs, rc] = await Promise.all([
    allocApi.result(ym.value), allocApi.cfg(ym.value), allocApi.recon(ym.value),
  ])
  if (my !== seq) return
  results.value = rs; cfgs.value = cs; recon.value = rc
}
onMounted(async () => {
  loadRules()
  tenantApi.list().then(ts => { tenants.value = ts })
  buildingApi.list().then(bs => { buildings.value = bs })
  metersApi.list('elec').then(ms => { meters.value = ms })
  try {
    dataYears.value = await allocApi.years()
    const latest = dataYears.value[dataYears.value.length - 1]
    if (latest && latest !== year.value) { year.value = latest; return }   // watch 触发 loadMonth
  } catch { /* 年份失败不阻断 */ }
  loadMonth()
})
watch([year, month], loadMonth)

const tenantById = computed(() => new Map(tenants.value.map(t => [t.id, t])))
const buildingName = computed(() => new Map(buildings.value.map(b => [b.id, b.name])))
const tenantOpts = computed<FPTenantOption[]>(() =>
  tenants.value.map(t => ({ id: t.id, name: t.companyName, phase: t.phase })))

// ── 分摊规则段 ──
const zoneRules = computed(() => (rules.value ?? []).filter(r => r.zone === zone.value))
const meterName = computed(() => new Map(meters.value.map(m => [m.id, m.subName ?? m.name])))
// 绑定候选=公摊表(ownership=share,meterSplit 关键词分类即为此刀定制;含 ops 兜底人工挑)
const bindCandidates = computed(() =>
  meters.value.filter(m => m.zone === ruleForm.value.zone && (m.ownership === 'share' || m.ownership === 'ops')))
const bindQ = ref('')
const bindFiltered = computed(() => {
  const kw = bindQ.value.trim()
  return kw
    ? bindCandidates.value.filter(m => m.name.includes(kw) || (m.subName ?? '').includes(kw) || (m.area ?? '').includes(kw))
    : bindCandidates.value
})

const ruleDlg = ref(false)
const ruleErr = ref('')
interface RuleForm {
  id: number | null; zone: AllocZone; name: string; buildingId: number | null
  method: AllocMethod; coefficient: string; extraQty: string
  feeKey: AllocFeeKey; note: string; meterIds: number[]
  members: { tenantId: number; weight: string }[]
}
const ruleForm = ref<RuleForm>(emptyRule())
function emptyRule(): RuleForm {
  return { id: null, zone: zone.value as AllocZone, name: '', buildingId: null, method: 'floor',
    coefficient: '', extraQty: '', feeKey: 'share_elec_floor', note: '', meterIds: [], members: [] }
}
const METHOD_OPTS = (Object.keys(ALLOC_METHOD_LABEL) as AllocMethod[])
  .map(k => ({ value: k, label: ALLOC_METHOD_LABEL[k] }))
const FEE_OPTS = ALLOC_FEE_KEYS.map(k => ({ value: k, label: ALLOC_FEE_LABEL[k] }))
const buildingOpts = computed(() => [{ value: '', label: '(园区级,不挂楼栋)' },
  ...buildings.value.map(b => ({ value: String(b.id), label: b.name }))])

function openRuleDlg(r?: AllocRuleDTO) {
  ruleErr.value = ''
  ruleForm.value = r
    ? { id: r.id, zone: r.zone, name: r.name, buildingId: r.buildingId, method: r.method,
        coefficient: r.coefficient == null ? '' : String(r.coefficient),
        extraQty: r.extraQty ? String(r.extraQty) : '', feeKey: r.feeKey, note: r.note ?? '',
        meterIds: [...r.meterIds],
        members: r.members.map(m => ({ tenantId: m.tenantId, weight: m.weight == null ? '' : String(m.weight) })) }
    : emptyRule()
  bindQ.value = ''
  ruleDlg.value = true
}
function toggleBind(id: number) {
  const i = ruleForm.value.meterIds.indexOf(id)
  if (i >= 0) ruleForm.value.meterIds.splice(i, 1)
  else ruleForm.value.meterIds.push(id)
}
const pickTenant = ref<number | null>(null)
function addMember(id: number | null) {
  if (id == null) return
  if (!ruleForm.value.members.some(m => m.tenantId === id))
    ruleForm.value.members.push({ tenantId: id, weight: ruleForm.value.method === 'floor' ? '1' : '' })
  pickTenant.value = null
}
async function submitRule() {
  const f = ruleForm.value
  if (!f.name.trim()) { ruleErr.value = '请输入规则名'; return }
  const num = (s: string) => (s.trim() === '' ? null : Number(s))
  try {
    const req = {
      zone: f.zone, name: f.name.trim(), buildingId: f.buildingId,
      method: f.method, coefficient: num(f.coefficient), extraQty: num(f.extraQty),
      feeKey: f.feeKey, note: f.note.trim() || null, meterIds: f.meterIds,
      members: f.members.map(m => ({ tenantId: m.tenantId, weight: num(m.weight) })),
    }
    if (f.id == null) await allocApi.createRule(req)
    else await allocApi.updateRule(f.id, req)
    ruleDlg.value = false
    await loadRules()
  } catch (e) { ruleErr.value = errMsg(e, '保存失败') }
}
async function delRule(r: AllocRuleDTO) {
  if (!confirm(`确认删除规则「${r.name}」?已有分摊结果的规则不可删除(历史月已快照)。`)) return
  try { await allocApi.deleteRule(r.id); await loadRules() }
  catch (e) { alert(errMsg(e, '删除失败')) }
}

// ── 参数小节(规则段,编辑态;沿电费成本模型参数样式:月值优先回退默认) ──
const ZONE_CFG_META: Record<string, { key: string; label: string; unit: string }[]> = {
  p1: [
    { key: 'price_flat', label: '单一商业电价', unit: '元/kWh=月均+0.16' },
    { key: 'price_loss', label: '损耗计费价', unit: '元/kWh,缺省用商业价' },
    { key: 'park_share_div', label: '园区公共电均摊栋数', unit: '栋' },
  ],
  p2: [
    { key: 'price_sharp', label: '尖电价', unit: '元/kWh=分时基准+0.16' },
    { key: 'price_peak', label: '峰电价', unit: '元/kWh' },
    { key: 'price_norm', label: '平电价', unit: '元/kWh' },
    { key: 'price_valley', label: '谷电价', unit: '元/kWh' },
    { key: 'price_loss', label: '损耗计费价', unit: '元/kWh(K27 常数收编)' },
  ],
}
const cfgRaw = (scope: string, key: string, acctMonth: string) =>
  (cfgs.value ?? []).find(c => c.scope === scope && c.cfgKey === key && c.acctMonth === acctMonth)
function commitCfg(scope: string, key: string, monthly: boolean, raw: string) {
  const t = raw.trim()
  const v = t === '' ? null : Number(t)
  if (v != null && !isFinite(v)) { alert('请输入数字'); return }
  allocApi.saveCfg({ scope, cfgKey: key, acctMonth: monthly ? ym.value : '', value: v })
    .then(loadMonth)
    .catch(e => alert(errMsg(e, '保存失败，请重试')))
}

// ── 月度分摊段 ──
const grid = computed<AllocGridRow[]>(() => buildMonthlyGrid(results.value ?? []))
const genRows = computed(() => (results.value ?? []).filter(r => r.source === 'gen'))
const generatedAt = computed(() => genRows.value[0]?.generatedAt?.replace('T', ' ').slice(0, 16) ?? null)
const generating = ref(false)
async function onGenerate() {
  if (generating.value) return
  const regen = genRows.value.length > 0
  if (regen && !confirm(`重新生成 ${ym.value}:先删后插覆盖本月全部生成行(手工行保留)。读数或规则已变时金额将按当前数据重算。确认?`)) return
  generating.value = true
  try {
    const r = await allocApi.generate(ym.value)
    const warn = r.warnings.length ? `\n\n警告 ${r.warnings.length} 条:\n` + r.warnings.slice(0, 8).join('\n')
      + (r.warnings.length > 8 ? `\n…共 ${r.warnings.length} 条` : '') : ''
    alert(`生成完成:写入 ${r.rows} 行 / ${r.tenants} 户,保留手工行 ${r.manualKept} 条。${warn}`)
    await loadMonth()
  } catch (e) { alert(errMsg(e, '生成失败')) } finally { generating.value = false }
}
async function onExport() {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildAllocExportAoa(grid.value, ym.value)), '公摊分摊')
  XLSX.writeFile(wb, `公摊分摊-${ym.value}.xlsx`)
}

// 抽屉:该户逐费项明细(表级现算;与快照不符标黄「读数已变」)
const openTenant = ref<AllocGridRow | null>(null)
const detail = ref<AllocDetailRowDTO[] | null>(null)
async function openDrawer(row: AllocGridRow) {
  openTenant.value = row
  detail.value = null
  const d = await allocApi.resultDetail(row.tenantId, ym.value)
  if (openTenant.value?.tenantId === row.tenantId) detail.value = d
}
async function delManual(d: AllocDetailRowDTO) {
  const row = (results.value ?? []).find(r => r.tenantId === openTenant.value?.tenantId && r.feeKey === d.feeKey)
  if (!row || !confirm(`确认删除手工行「${ALLOC_FEE_LABEL[d.feeKey]}」?`)) return
  try {
    await allocApi.deleteResult(row.id)
    await loadMonth()
    if (openTenant.value) detail.value = await allocApi.resultDetail(openTenant.value.tenantId, ym.value)
  } catch (e) { alert(errMsg(e, '删除失败')) }
}

// 手工行弹窗(孵化协议固定收取等)
const manualDlg = ref(false)
const manualErr = ref('')
const mForm = ref({ tenantId: null as number | null, feeKey: 'share_elec_fire' as string, amount: '', note: '' })
function openManualDlg() {
  mForm.value = { tenantId: null, feeKey: 'share_elec_fire', amount: '', note: '' }
  manualErr.value = ''
  manualDlg.value = true
}
async function submitManual() {
  const f = mForm.value
  const v = Number(f.amount)
  if (f.tenantId == null) { manualErr.value = '请选择租户'; return }
  if (!isFinite(v)) { manualErr.value = '请输入金额'; return }
  try {
    await allocApi.saveManual({ tenantId: f.tenantId, ym: ym.value, feeKey: f.feeKey, amount: v, note: f.note.trim() || null })
    manualDlg.value = false
    await loadMonth()
  } catch (e) { manualErr.value = errMsg(e, '保存失败') }
}

// ── 损耗与对账段(读时派生;负值黄警示不阻断) ──
const zoneLossRows = computed(() => (recon.value?.lossRows ?? []).filter(l => l.zone === zone.value))
const zoneReconRows = computed(() => (recon.value?.rows ?? []).filter(r => r.zone === zone.value))
// 人工两列行内改=改 alloc_cfg(scope=building:{id} 默认行)
function commitAdj(buildingId: number, key: 'loss_adj_qty' | 'loss_adj_rate', raw: string) {
  commitCfg(`building:${buildingId}`, key, false, raw)
}
// 互认提示行:本月分摊合计 vs 电费成本模型 allocated(黄标不强拦,勾稽归对账刀)
const hintMismatch = computed(() => {
  const r = recon.value
  return !!r && r.elecCostAllocated > 0 && Math.abs(r.allocSum - r.elecCostAllocated) > 0.005
})

const FEE_COLS = ALLOC_FEE_KEYS
</script>

<template>
  <div v-if="!rules || !results || !recon" class="page-loading"><span class="page-spin" /></div>

  <div v-else class="al-page">
    <!-- 标题行 -->
    <div class="al-head">
      <div>
        <h2 class="al-title"><span class="ic"><component :is="iconFor('share-2')" :size="18" /></span>公摊分摊</h2>
        <p class="al-sub">公共电表分摊到户 · 变压器损耗率收取 · 已/未分摊对账 — 用量取自园区抄表,生成即快照</p>
      </div>
      <div class="al-headr">
        <Button v-if="editMode && seg === 'rules'" variant="outline" size="sm" @click="openRuleDlg()">
          <template #leading><component :is="iconFor('plus')" :size="14" /></template>
          新增规则
        </Button>
        <Button v-if="editMode && seg === 'monthly'" variant="outline" size="sm" @click="openManualDlg">
          <template #leading><component :is="iconFor('pen-line')" :size="14" /></template>
          手工行
        </Button>
      </div>
    </div>

    <!-- 工具栏:段切换 + zone tabs + 年月 + 动作 -->
    <div class="mx-toolbar">
      <Segmented :options="SEG_OPTS" v-model="seg" size="sm" />
      <div class="mx-toolbar-right">
        <Segmented v-if="seg !== 'monthly'" :options="ZONE_OPTS" v-model="zone" size="sm" />
        <div style="width:110px">
          <Select :options="yearOpts" :model-value="String(year)" size="sm" @update:model-value="year = +$event" />
        </div>
        <div style="width:92px">
          <Select :options="monthOpts" :model-value="String(month)" size="sm" @update:model-value="month = +$event" />
        </div>
        <Button v-if="seg === 'monthly'" variant="outline" size="sm" :disabled="grid.length === 0" @click="onExport">
          <template #leading><component :is="iconFor('download')" :size="14" /></template>
          导出当月
        </Button>
        <Button v-if="editMode && seg === 'monthly'" variant="outline" size="sm" :disabled="generating" @click="onGenerate">
          <template #leading><component :is="iconFor(genRows.length ? 'refresh-cw' : 'play')" :size="14" /></template>
          {{ genRows.length ? '重新生成' : '生成本月' }}
        </Button>
        <Button v-if="canEdit" :variant="editMode ? 'filled' : 'outline'" size="sm" @click="editMode = !editMode">
          <template #leading><component :is="iconFor(editMode ? 'check' : 'pencil')" :size="14" /></template>
          {{ editMode ? '完成' : '编辑模式' }}
        </Button>
      </div>
    </div>

    <!-- ══ 分摊规则段 ══ -->
    <template v-if="seg === 'rules'">
      <Card surface="white" :padding="0" class="al-listcard">
        <div class="al-cardhead">
          <div class="al-cardtitles">
            <span class="al-cardtitle">分摊规则 · {{ zone === 'p1' ? '一期' : '二期' }}</span>
            <span class="al-cardsub">Z 列口径结构化:整笔归户 / 按面积 / 按层均摊 / 并入损耗;规则改了重生成即可,历史月已快照不受影响</span>
          </div>
        </div>
        <table class="al-table">
          <colgroup><col /><col style="width:100px" /><col style="width:96px" /><col style="width:76px" /><col style="width:100px" /><col style="width:88px" /><col style="width:110px" /><col style="width:84px" /><col v-if="editMode" style="width:88px" /></colgroup>
          <thead>
            <tr><th>规则名</th><th>楼栋</th><th>方法</th><th class="num">绑定表</th><th class="num">系数</th><th class="num">人工加度</th><th>费项</th><th class="num">受益人</th><th v-if="editMode"></th></tr>
          </thead>
          <tbody>
            <tr v-if="zoneRules.length === 0"><td :colspan="editMode ? 9 : 8" class="al-empty">本期区暂无规则{{ editMode ? ',点右上「新增规则」开始录入(≈30 条人工录入,无导入)' : '' }}</td></tr>
            <tr v-for="r in zoneRules" :key="r.id" :class="{ click: editMode }" @click="editMode && openRuleDlg(r)">
              <td class="lbl" :title="r.note ?? undefined">{{ r.name }}</td>
              <td>{{ r.buildingId != null ? (buildingName.get(r.buildingId) ?? '#' + r.buildingId) : '园区级' }}</td>
              <td><span class="al-method" :class="'m-' + r.method">{{ ALLOC_METHOD_LABEL[r.method] }}</span></td>
              <td class="num">{{ r.meterIds.length }}</td>
              <td class="num">{{ r.coefficient != null ? fq(r.coefficient) : '—' }}</td>
              <td class="num">{{ r.extraQty ? fq(r.extraQty) : '—' }}</td>
              <td>{{ ALLOC_FEE_LABEL[r.feeKey] }}</td>
              <td class="num">{{ r.method === 'loss' ? '全园动态' : r.members.length }}</td>
              <td v-if="editMode" class="al-ops" @click.stop>
                <button class="al-iconbtn" title="编辑规则" @click="openRuleDlg(r)"><component :is="iconFor('pencil')" :size="14" /></button>
                <button class="al-iconbtn danger" title="删除(有结果 409 守卫)" @click="delRule(r)"><component :is="iconFor('trash-2')" :size="14" /></button>
              </td>
            </tr>
          </tbody>
        </table>
      </Card>

      <!-- 参数小节(编辑态;月值优先回退默认,清空月值即回退) -->
      <Card v-if="editMode" surface="white" :padding="0" class="al-listcard">
        <div class="al-cardhead">
          <div class="al-cardtitles">
            <span class="al-cardtitle"><component :is="iconFor('sliders-horizontal')" :size="15" style="vertical-align:-2px;margin-right:6px" />分摊参数 · {{ zone === 'p1' ? '一期' : '二期' }}</span>
            <span class="al-cardsub">单价=供电局月均+0.16 每月变;取值:当月值优先,缺省回退默认值;楼栋损耗人工项在「损耗与对账」段行内改</span>
          </div>
        </div>
        <table class="al-table">
          <colgroup><col /><col style="width:170px" /><col style="width:170px" /><col style="width:170px" /></colgroup>
          <thead><tr><th>参数</th><th class="num">{{ month }}月值</th><th class="num">长期默认值</th><th class="num">生效值</th></tr></thead>
          <tbody>
            <tr v-for="meta in ZONE_CFG_META[zone]" :key="meta.key">
              <td class="lbl">{{ meta.label }}<span class="al-unit">{{ meta.unit }}</span></td>
              <td class="num">
                <input class="al-in" type="number" step="0.000001" :value="cfgRaw(zone, meta.key, ym)?.value ?? ''"
                       placeholder="—" title="当月值,回车/失焦保存;清空=回退默认"
                       @change="commitCfg(zone, meta.key, true, ($event.target as HTMLInputElement).value)" />
              </td>
              <td class="num">
                <input class="al-in" type="number" step="0.000001" :value="cfgRaw(zone, meta.key, '')?.value ?? ''"
                       placeholder="—" title="长期默认值,回车/失焦保存"
                       @change="commitCfg(zone, meta.key, false, ($event.target as HTMLInputElement).value)" />
              </td>
              <td class="num eff">{{ cfgs ? (resolveCfg(cfgs, zone, meta.key) ?? '未配置') : '—' }}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </template>

    <!-- ══ 月度分摊段(默认) ══ -->
    <template v-else-if="seg === 'monthly'">
      <div v-if="grid.length === 0" class="al-emptybar">
        <component :is="iconFor('info')" :size="14" />
        <span>
          {{ year }}年{{ month }}月暂无分摊结果 ——
          <template v-if="editMode">配好规则后点「生成本月」;固定收取(孵化协议等)用「手工行」。</template>
          <template v-else-if="canEdit">进入右上角「编辑模式」可生成本月分摊。</template>
          <template v-else>等待管理员生成。</template>
        </span>
      </div>
      <Card surface="white" :padding="0" class="al-listcard">
        <div class="al-cardhead">
          <div class="al-cardtitles">
            <span class="al-cardtitle">月度分摊 · {{ year }}年{{ month }}月</span>
            <span class="al-cardsub">一行一户,金额=生成时快照;点行看逐费项明细(现算与快照不符标「读数已变」)</span>
          </div>
          <span v-if="generatedAt" class="al-genat" title="生成动作写入=快照语义;重新生成=按月先删后插覆盖(手工行保留)">生成于 {{ generatedAt }}</span>
        </div>
        <div class="al-tablewrap">
          <table class="al-table">
            <colgroup><col /><col style="width:96px" /><col v-for="k in FEE_COLS" :key="k" style="width:104px" /><col style="width:110px" /></colgroup>
            <thead>
              <tr>
                <th>租户</th><th>楼栋</th>
                <th v-for="k in FEE_COLS" :key="k" class="num">{{ ALLOC_FEE_LABEL[k] }}</th>
                <th class="num">合计(元)</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="g in grid" :key="g.tenantId" class="click" @click="openDrawer(g)">
                <td class="lbl">
                  <span class="al-tname">{{ g.tenantName }}</span>
                  <span v-if="g.hasManual" class="al-manual" title="含手工行(生成时保留不覆盖)">手工</span>
                </td>
                <td>{{ g.buildingName ?? '—' }}</td>
                <td v-for="k in FEE_COLS" :key="k" class="num" :class="{ zero: g.fees[k] == null }">
                  {{ g.fees[k] ? fy(g.fees[k]!.amount) : '—' }}
                </td>
                <td class="num total">{{ fy(g.total) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </template>

    <!-- ══ 损耗与对账段 ══ -->
    <template v-else>
      <!-- 互认提示行(单向读 elec-cost,黄标不强拦) -->
      <div class="al-emptybar" :class="{ warn: hintMismatch }">
        <component :is="iconFor(hintMismatch ? 'alert-triangle' : 'git-compare')" :size="14" />
        <span>本月分摊合计 <b>{{ fy(recon.allocSum) }}</b> vs 电费成本模型「分摊额度」 <b>{{ fy(recon.elecCostAllocated) }}</b>
          <template v-if="hintMismatch"> — 两侧不一致,提示核对(勾稽不强拦)</template>
        </span>
      </div>

      <Card surface="white" :padding="0" class="al-listcard">
        <div class="al-cardhead">
          <div class="al-cardtitles">
            <span class="al-cardtitle">损耗率 · {{ zone === 'p1' ? '一期' : '二期' }} · {{ year }}年{{ month }}月</span>
            <span class="al-cardsub">损耗量=分表Σ−总表(负=有损耗);调整度数/上浮率为人工参数(编辑态行内改);收取率=生成时快照进损耗费</span>
          </div>
        </div>
        <table class="al-table">
          <colgroup><col /><col style="width:110px" /><col style="width:110px" /><col style="width:110px" /><col style="width:96px" /><col style="width:110px" /><col style="width:96px" /><col style="width:110px" /></colgroup>
          <thead>
            <tr><th>楼栋(组)</th><th class="num">总表量</th><th class="num">分表Σ</th><th class="num">损耗量</th><th class="num">原损耗率</th><th class="num">调整度数</th><th class="num">上浮率</th><th class="num">收取租户损耗率</th></tr>
          </thead>
          <tbody>
            <tr v-if="zoneLossRows.length === 0"><td colspan="8" class="al-empty">本期区本月无损耗数据(需配电总表(infra)与楼栋关联读数)</td></tr>
            <tr v-for="l in zoneLossRows" :key="l.buildingId" :class="{ warn: (l.rawRate ?? 0) < -0.05 }">
              <td class="lbl">{{ l.buildingName }}</td>
              <td class="num">{{ fq(l.headQty) }}</td>
              <td class="num">{{ fq(l.subQty) }}</td>
              <td class="num" :class="{ neg: l.lossQty < 0 }">{{ fq(l.lossQty) }}</td>
              <td class="num">{{ fpct(l.rawRate) }}</td>
              <td class="num">
                <input v-if="editMode" class="al-in" type="number" step="0.01" :value="l.adjQty || ''"
                       placeholder="—" title="人工调整度数(如 −1500「待调整8500度」),存 alloc_cfg 默认行"
                       @change="commitAdj(l.buildingId, 'loss_adj_qty', ($event.target as HTMLInputElement).value)" />
                <span v-else>{{ l.adjQty ? fq(l.adjQty) : '—' }}</span>
              </td>
              <td class="num">
                <input v-if="editMode" class="al-in" type="number" step="0.001" :value="l.adjRate ?? ''"
                       placeholder="—" title="人工上浮率(一期 0.003~0.018/二期 0.002)"
                       @change="commitAdj(l.buildingId, 'loss_adj_rate', ($event.target as HTMLInputElement).value)" />
                <span v-else>{{ l.adjRate != null ? fpct(l.adjRate) : '—' }}</span>
              </td>
              <td class="num rate">{{ fpct(l.tenantRate) }}</td>
            </tr>
          </tbody>
        </table>
      </Card>

      <Card surface="white" :padding="0" class="al-listcard">
        <div class="al-cardhead">
          <div class="al-cardtitles">
            <span class="al-cardtitle">已/未分摊对账 · {{ zone === 'p1' ? '一期' : '二期' }}</span>
            <span class="al-cardsub">行=规则(+损耗组);成本=规则用量×单价全额;差额=已分摊−成本(舍入差+未覆盖户);实收侧 P-C 后补</span>
          </div>
        </div>
        <table class="al-table">
          <colgroup><col /><col style="width:110px" /><col style="width:100px" /><col style="width:110px" /><col style="width:120px" /><col style="width:120px" /><col style="width:120px" /></colgroup>
          <thead>
            <tr><th>规则 / 损耗组</th><th>费项</th><th class="num">本月用量</th><th class="num">单价</th><th class="num">成本金额</th><th class="num">已分摊</th><th class="num">差额</th></tr>
          </thead>
          <tbody>
            <tr v-if="zoneReconRows.length === 0"><td colspan="7" class="al-empty">本期区本月无对账数据</td></tr>
            <tr v-for="(r, i) in zoneReconRows" :key="i">
              <td class="lbl">{{ r.name }}</td>
              <td>{{ ALLOC_FEE_LABEL[r.feeKey] }}</td>
              <td class="num" :class="{ neg: r.qty < 0 }">{{ fq(r.qty) }}</td>
              <td class="num">{{ r.price != null ? r.price.toFixed(4) : '—' }}</td>
              <td class="num">{{ fy(r.costAmount) }}</td>
              <td class="num">{{ fy(r.allocated) }}</td>
              <td class="num diff" :class="{ neg: (r.diff ?? 0) < 0, pos: (r.diff ?? 0) > 0 }">{{ fy(r.diff) }}</td>
            </tr>
          </tbody>
        </table>
      </Card>
    </template>

    <!-- 抽屉:该户逐费项明细(现算) -->
    <FPDrawer :open="!!openTenant" :title="openTenant?.tenantName ?? ''"
              :subtitle="`${ym} 分摊明细 · 金额=生成时快照,现算列=当前读数重算`" icon="share-2" :width="720"
              @close="openTenant = null">
      <div v-if="!detail" class="page-loading"><span class="page-spin" /></div>
      <table v-else class="al-table">
        <colgroup><col style="width:110px" /><col /><col style="width:90px" /><col style="width:90px" /><col style="width:100px" /><col style="width:100px" /><col style="width:90px" /><col v-if="editMode" style="width:44px" /></colgroup>
        <thead>
          <tr><th>费项</th><th>规则</th><th class="num">电量</th><th class="num">率快照</th><th class="num">金额(快照)</th><th class="num">现算</th><th>来源</th><th v-if="editMode"></th></tr>
        </thead>
        <tbody>
          <tr v-if="detail.length === 0"><td :colspan="editMode ? 8 : 7" class="al-empty">该户本月无分摊行</td></tr>
          <tr v-for="d in detail" :key="d.feeKey">
            <td class="lbl">{{ ALLOC_FEE_LABEL[d.feeKey] }}</td>
            <td :title="d.note ?? undefined">{{ d.ruleName ?? (d.feeKey === 'share_elec_loss' ? '损耗链(动态)' : d.source === 'manual' ? '手工' : '多规则合并') }}</td>
            <td class="num">{{ fq(d.qty) }}</td>
            <td class="num">{{ d.rateSnap != null ? (d.feeKey === 'share_elec_loss' ? fpct(d.rateSnap) : fq(d.rateSnap)) : '—' }}</td>
            <td class="num total">{{ fy(d.amount) }}</td>
            <td class="num">
              <span v-if="d.stale" class="al-stale" :title="`现算 ${fy(d.liveAmount)} ≠ 快照:读数已变,可重新生成`">{{ fy(d.liveAmount) }} ⚠</span>
              <span v-else class="zero">{{ d.liveAmount != null ? fy(d.liveAmount) : '—' }}</span>
            </td>
            <td><span class="al-src">{{ d.source === 'manual' ? '手工' : '生成' }}</span></td>
            <td v-if="editMode">
              <button v-if="d.source === 'manual'" class="al-iconbtn danger" title="删除手工行" @click="delManual(d)">
                <component :is="iconFor('trash-2')" :size="14" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </FPDrawer>

    <!-- 规则弹窗(编辑态) -->
    <div v-if="ruleDlg" class="al-mask" @mousedown="ruleDlg = false">
      <div class="al-dlg wide" @mousedown.stop>
        <div class="al-dlg-h">
          <h3>{{ ruleForm.id == null ? '新增' : '编辑' }}分摊规则</h3>
          <p>方法语义:整笔归户=单租户整笔;按面积=系数填受益租赁面积Σ㎡(园区路灯填园区面积);按层均摊=系数填层数(可小数,折扣用等效系数);并入损耗=无受益人,走损耗链向全园收取。</p>
        </div>
        <div class="al-dlg-b">
          <div class="al-formrow">
            <Select v-model="ruleForm.zone" label="期区" :options="ZONE_OPTS" size="sm" />
            <Input v-model="ruleForm.name" label="规则名" placeholder="如:B座电梯" size="sm" />
            <Select :model-value="ruleForm.buildingId == null ? '' : String(ruleForm.buildingId)" label="楼栋" :options="buildingOpts" size="sm"
                    @update:model-value="ruleForm.buildingId = $event === '' ? null : +$event" />
          </div>
          <div class="al-formrow">
            <Select v-model="ruleForm.method" label="方法" :options="METHOD_OPTS" size="sm" />
            <Select v-model="ruleForm.feeKey" label="出口费项" :options="FEE_OPTS" size="sm" />
            <Input v-model="ruleForm.coefficient" label="系数(面积Σ/层数)" placeholder="loss/整笔留空" size="sm" />
            <Input v-model="ruleForm.extraQty" label="人工加度" placeholder="如 170" size="sm" />
          </div>
          <Input v-model="ruleForm.note" label="备注" placeholder="如:电梯用电加170度" size="sm" />

          <div class="al-bindsec">
            <div class="al-bindhead">
              <span class="al-bindtitle">绑定电表(公摊表多选,可多表合并)· 已选 {{ ruleForm.meterIds.length }}</span>
              <input v-model="bindQ" class="al-bindq" type="text" placeholder="搜表名/区域" />
            </div>
            <div class="al-bindlist">
              <label v-for="m in bindFiltered" :key="m.id" class="al-bindrow">
                <input type="checkbox" :checked="ruleForm.meterIds.includes(m.id)" @change="toggleBind(m.id)" />
                <span class="nm">{{ m.name }}</span>
                <span class="meta">{{ m.area ?? '' }} {{ m.subName ?? '' }}</span>
              </label>
              <div v-if="bindFiltered.length === 0" class="al-empty">本期区无匹配公摊表</div>
            </div>
          </div>

          <div v-if="ruleForm.method !== 'loss'" class="al-bindsec">
            <div class="al-bindhead">
              <span class="al-bindtitle">受益人清单 · {{ ruleForm.members.length }} 户
                <span class="al-unit">(按层:weight=层份额,1 整层/0.5 对半/留空=层内按面积二拆;按面积:weight 忽略)</span>
              </span>
            </div>
            <div class="al-memrow" v-for="(m, i) in ruleForm.members" :key="m.tenantId">
              <span class="nm">{{ tenantById.get(m.tenantId)?.companyName ?? '#' + m.tenantId }}</span>
              <input v-if="ruleForm.method === 'floor'" v-model="m.weight" class="al-in w" type="number" step="0.001" placeholder="面积二拆" title="层份额;留空=层内按面积二拆" />
              <button class="al-iconbtn danger" title="移除" @click="ruleForm.members.splice(i, 1)">
                <component :is="iconFor('x')" :size="14" />
              </button>
            </div>
            <div style="max-width:320px">
              <FPTenantPicker :tenants="tenantOpts" :model-value="pickTenant" placeholder="添加受益租户…"
                              @update:model-value="addMember($event)" />
            </div>
          </div>
          <div class="al-dlg-err">{{ ruleErr }}</div>
        </div>
        <div class="al-dlg-f">
          <Button variant="gray" size="sm" @click="ruleDlg = false">取消</Button>
          <Button variant="filled" size="sm" @click="submitRule">
            <template #leading><component :is="iconFor('check')" :size="14" /></template>
            保存
          </Button>
        </div>
      </div>
    </div>

    <!-- 手工行弹窗(编辑态) -->
    <div v-if="manualDlg" class="al-mask" @mousedown="manualDlg = false">
      <div class="al-dlg" @mousedown.stop>
        <div class="al-dlg-h">
          <h3>手工分摊行 · {{ ym }}</h3>
          <p>孵化协议固定收取等无公式项;同户同费项覆盖为手工,生成时保留不覆盖。</p>
        </div>
        <div class="al-dlg-b">
          <FPTenantPicker :tenants="tenantOpts" v-model="mForm.tenantId" placeholder="选择租户" />
          <Select v-model="mForm.feeKey" label="费项" :options="FEE_OPTS" size="sm" />
          <Input v-model="mForm.amount" label="金额(元)" placeholder="如 63.8" size="sm" />
          <Input v-model="mForm.note" label="备注" placeholder="如:孵化协议固定收取" size="sm" />
          <div class="al-dlg-err">{{ manualErr }}</div>
        </div>
        <div class="al-dlg-f">
          <Button variant="gray" size="sm" @click="manualDlg = false">取消</Button>
          <Button variant="filled" size="sm" @click="submitManual">
            <template #leading><component :is="iconFor('check')" :size="14" /></template>
            保存
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 页面纵排卡片(壳层滚动;规则/租户行数固定量级,沿 ElecCostView 形态不分页) */
.al-page { display: flex; flex-direction: column; gap: 16px; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%; }

.al-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.al-headr { display: flex; gap: 8px; }
.al-title { margin: 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.al-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.al-sub { margin: 5px 0 0; font-size: var(--fs-label); color: var(--text-muted); }

/* 提示条(空态/互认) */
.al-emptybar { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--fs-label); color: var(--text-secondary); }
.al-emptybar.warn { border-color: var(--hue-orange); background: rgb(255, 250, 235); color: rgb(138, 97, 0); }

/* 列表卡(LIST-PAGE-SPEC 形态) */
.al-listcard { border: 1px solid var(--border-subtle); overflow: hidden; }
.al-cardhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 14px 18px 12px; border-bottom: 1px solid var(--divider); }
.al-cardtitles { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.al-cardtitle { font-size: 14.5px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.al-cardsub { font-size: var(--fs-label); color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.al-genat { flex: 0 0 auto; font-size: var(--fs-micro); color: var(--text-muted); cursor: help; }
.al-tablewrap { overflow-x: auto; }

/* 表格:定宽列律+等高行(46px);内容 ellipsis 不撑行 */
.al-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-family: var(--font-sans); }
.al-table th { position: sticky; top: 0; background: var(--surface-white); padding: 8px 14px; text-align: left; font: var(--type-label); font-weight: var(--fw-regular); color: var(--text-muted); white-space: nowrap; border-bottom: 1px solid var(--divider); }
.al-table th.num { text-align: right; }
.al-table tbody tr { height: 46px; border-bottom: 1px solid var(--divider); }
.al-table tbody tr:last-child { border-bottom: none; }
.al-table tbody tr.click { cursor: pointer; }
.al-table tbody tr.click:hover td { background: var(--bg-panel); }
.al-table tbody tr.warn td { background: rgb(255, 250, 235); }
.al-table td { padding: 0 14px; vertical-align: middle; font-size: 12.5px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.al-table td.num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.al-table td.zero, .al-table td.num.zero, .al-table .zero { color: var(--text-disabled); }
.al-table td.num.neg { color: var(--hue-red); }
.al-table td.num.total { font-weight: var(--fw-semibold); }
.al-table td.num.rate { font-weight: var(--fw-semibold); }
.al-table td.num.diff.neg { color: var(--hue-red); }
.al-table td.num.diff.pos { color: rgb(21, 128, 61); }
.al-table td.lbl { font-weight: var(--fw-medium); }
.al-table td.eff { color: var(--text-secondary); }
.al-empty { text-align: center; color: var(--text-disabled); font-size: var(--fs-label); }

/* 方法徽标 */
.al-method { display: inline-block; font-size: var(--fs-micro); border-radius: var(--radius-full); padding: 1px 8px; }
.al-method.m-direct { color: var(--hue-blue); background: rgb(232, 240, 254); }
.al-method.m-area { color: rgb(21, 128, 61); background: rgb(222, 244, 229); }
.al-method.m-floor { color: rgb(154, 88, 10); background: rgb(252, 243, 232); }
.al-method.m-loss { color: var(--text-secondary); background: var(--bg-sunken); }

.al-tname { font-weight: var(--fw-medium); }
.al-manual { margin-left: 6px; font-size: var(--fs-micro); color: var(--hue-blue); background: rgb(232, 240, 254); border-radius: var(--radius-full); padding: 1px 7px; cursor: help; }
.al-src { font-size: var(--fs-micro); color: var(--text-muted); }
.al-stale { color: rgb(138, 97, 0); background: rgb(255, 244, 214); border-radius: var(--radius-full); padding: 1px 8px; font-size: var(--fs-micro); cursor: help; }
.al-unit { margin-left: 6px; font-size: var(--fs-micro); color: var(--text-disabled); font-weight: var(--fw-regular); }

/* 行内输入(编辑态) */
.al-in { width: 100%; min-width: 0; box-sizing: border-box; height: 30px; padding: 0 8px; text-align: right; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-white); font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-body); color: var(--text-primary); transition: border-color var(--dur-fast) var(--ease-standard); appearance: textfield; -moz-appearance: textfield; }
.al-in::-webkit-outer-spin-button, .al-in::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.al-in:focus { outline: none; border-color: var(--hue-blue); }
.al-in::placeholder { color: var(--text-disabled); }
.al-in.w { width: 110px; flex: 0 0 auto; }

.al-ops { text-align: right; }
.al-iconbtn { width: 26px; height: 26px; border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-muted); display: inline-grid; place-items: center; transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.al-iconbtn:hover { background: var(--bg-hover); color: var(--text-primary); }
.al-iconbtn.danger:hover { background: rgb(255, 238, 237); color: var(--hue-red); }

/* 弹窗(同 ElecCostView .ec-dlg 家族) */
.al-mask { position: fixed; inset: 0; background: rgba(28, 28, 28, .34); z-index: 140; display: grid; place-items: center; }
.al-dlg { width: min(460px, 92vw); background: var(--surface-white); border-radius: var(--radius-xl); box-shadow: 0 16px 48px rgba(28, 28, 28, .22); overflow: hidden; }
.al-dlg.wide { width: min(680px, 94vw); max-height: 88vh; display: flex; flex-direction: column; }
.al-dlg-h { padding: 20px 22px 0; }
.al-dlg-h h3 { margin: 0; font-size: 16px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.al-dlg-h p { margin: 6px 0 0; font-size: 12px; line-height: 1.5; color: var(--text-muted); }
.al-dlg-b { padding: 14px 22px 4px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }
.al-dlg-err { font-size: 11.5px; color: var(--hue-red); min-height: 14px; }
.al-dlg-f { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 22px 20px; }
.al-formrow { display: flex; gap: 10px; }
.al-formrow > * { flex: 1; min-width: 0; }

/* 绑定表/受益人小节 */
.al-bindsec { border: 1px solid var(--border-subtle); border-radius: var(--radius-md); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.al-bindhead { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.al-bindtitle { font-size: 12.5px; font-weight: var(--fw-medium); color: var(--text-primary); }
.al-bindq { height: 28px; padding: 0 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-full); font-size: 12px; }
.al-bindq:focus { outline: none; border-color: var(--hue-blue); }
.al-bindlist { max-height: 180px; overflow-y: auto; display: flex; flex-direction: column; }
.al-bindrow { display: flex; align-items: center; gap: 8px; padding: 5px 4px; font-size: 12.5px; cursor: pointer; border-radius: var(--radius-sm); }
.al-bindrow:hover { background: var(--bg-hover); }
.al-bindrow .nm { font-weight: var(--fw-medium); }
.al-bindrow .meta { color: var(--text-muted); font-size: var(--fs-micro); overflow: hidden; text-overflow: ellipsis; }
.al-memrow { display: flex; align-items: center; gap: 10px; padding: 3px 4px; font-size: 12.5px; }
.al-memrow .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
</style>
