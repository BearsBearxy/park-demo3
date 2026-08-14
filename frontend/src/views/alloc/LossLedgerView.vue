<script setup lang="ts">
// 楼栋损耗(POOL-ENGINE-SPEC §6,S3-B1 刀2)— 新路由 /alloc-loss,紧随公共电核算。
// FPLedgerTable 手法(sticky 首列/34px 行/mono 空值'–'/tfoot 钉底);行数≤20 不虚拟滚动。
// units=楼栋损耗快照;对账区两行=读时派生(供电侧总表 vs 单元总表Σ/分表Σ),单元行后接续渲染。
// 编辑态(EDIT-MODE-SPEC v2):调整度数/调整损耗/g_adj 行内改 → PUT /cfg scope=building:{id}
// 月行 loss_adj_qty/loss_adj_rate/loss_g_adj(commitAdj 模式)→ 提示重新生成。
import { ref, computed, onMounted, onDeactivated, watch } from 'vue'
import { useRouter } from 'vue-router'
import { allocApi, type AllocCfgDTO, type AllocLossDTO, type AllocRuleDTO } from '@/api/alloc'
import { metersApi, type MeterDTO } from '@/api/meters'
import { buildingApi } from '@/api/building'
import type { BuildingDTO } from '@/types/building'
import { POOL_ZONE_LABEL, buildLossReconRows, lossFooter } from '@/utils/poolLedgerLogic'
import { resolveCfg, upsertMonthCfg } from '@/utils/allocLogic'
import { buildYearOptions } from '@/utils/yearGate'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import Segmented from '@/components/ds/Segmented.vue'

const auth = useAuthStore()
const canEdit = computed(() => !auth.isReadonly)

// ── 编辑模式(EDIT-MODE-SPEC v2):不跨会话;KeepAlive 切页签回来也回浏览态 ──
const editMode = ref(false)
onDeactivated(() => { editMode.value = false })

const pad2 = (n: number) => String(n).padStart(2, '0')
const fmt = (v: number | null | undefined) =>
  v == null ? '–' : v.toLocaleString('en-US', { maximumFractionDigits: 2 })
const fpct = (r: number | null | undefined) => (r == null ? '–' : (r * 100).toFixed(2) + '%')
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback

// ── 账期 + zone Segmented(只有一期/二期;宿舍无损耗单元) ──
const today = new Date()
const year = ref(today.getFullYear())
const month = ref(today.getMonth() + 1)
const dataYears = ref<number[]>([])
const yearOpts = computed(() =>
  buildYearOptions(dataYears.value, today).map(y => ({ value: String(y), label: `${y}年` })))
const monthOpts = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` }))
const ym = computed(() => `${year.value}-${pad2(month.value)}`)
const zone = ref<string>('p1')
const ZONE_OPTS = [{ value: 'p1', label: '一期' }, { value: 'p2', label: '二期' }]

// ── 数据(竞态守卫) ──
const loss = ref<AllocLossDTO | null>(null)
const cfgs = ref<AllocCfgDTO[]>([])
// 「本月口径」面板要把 scope 里的 id 翻成人看得懂的名字,故一并拉表/栋/池档案(失败降级为显 id)
const meters = ref<MeterDTO[]>([])
const buildings = ref<BuildingDTO[]>([])
const rules = ref<AllocRuleDTO[]>([])
let seq = 0
async function loadMonth() {
  const my = ++seq
  const [ls, cs] = await Promise.all([
    allocApi.loss(ym.value),
    allocApi.cfg(ym.value).catch(() => [] as AllocCfgDTO[]),
  ])
  if (my !== seq) return
  loss.value = ls; cfgs.value = cs
}
function loadMasters() {
  metersApi.list().then(d => { meters.value = d }).catch(() => { /* 降级显 id */ })
  buildingApi.list().then(d => { buildings.value = d }).catch(() => { /* 降级显 id */ })
  allocApi.rules().then(d => { rules.value = d }).catch(() => { /* 降级不列加度 */ })
}
onMounted(async () => {
  loadMasters()
  try {
    dataYears.value = await allocApi.years()
    const latest = dataYears.value[dataYears.value.length - 1]
    if (latest && latest !== year.value) { year.value = latest; return }   // watch 触发 loadMonth
  } catch { /* 年份失败不阻断 */ }
  loadMonth()
})
watch([year, month], loadMonth)

const generated = computed(() => loss.value?.generated ?? false)
const units = computed(() => (loss.value?.units ?? []).filter(u => u.zone === zone.value))
const reconRows = computed(() =>
  buildLossReconRows((loss.value?.recon ?? []).find(r => r.zone === zone.value)))
const foot = computed(() => lossFooter(units.value))

// 列模型:铝缆列仅 p2,公摊分摊度数列仅 p1
const isP2 = computed(() => zone.value === 'p2')
// 基础 9 列(位置/总表/分表/损耗量/原率/调整度/调整损/收租率/备注)+铝缆(p2)+公摊度数(p1)
const colCount = computed(() => 9 + (isP2.value ? 1 : 0) + (zone.value === 'p1' ? 1 : 0))
const LBL_W = 210
const w = (px: number) => ({ width: px + 'px', minWidth: px + 'px', maxWidth: px + 'px' })
const fixLbl = { ...w(LBL_W), left: '0px', borderRight: '1px solid var(--border-subtle)' }

// G(公摊分摊度数)的算式:屏上只给一个数,用户没法核对它怎么来的 —— 2023-08 实测与源册差 670 度,
// 根因是某个园区公摊池挂着「不限月份」的默认加度。把算式和该去哪查写进悬浮,至少能顺藤摸瓜。
const G_TITLE = 'G = Σ(一期园区公摊池本月净量) ÷ 均摊座数(park_share_div,现为 6),各栋同值。\n'
  + '池的净量含该池的「加度」——加度若填在规则默认行(不限月份),会对每个月都生效。\n'
  + '要核对构成:去「公共电核算」屏看 fee_key=园区损耗池 的那几行与它们的「加度(月)」。'

// ── ⭐「本月口径」面板(2026-08-14):把左右屏上数字的**隐藏参数**摊开 ──────────────────
// 起因:2023-08 与源册逐格核对出三处差额,根因全是同一个形状 —— 为某个月校准的参数写在
// **默认行(acct_month 为空 ⇒ 对所有月份生效)**,而屏上一个字都看不到:
//   ① 招商中心池 extra_qty=−670(规则默认列)→ 公摊分摊度数 276.95 vs 源册 388.62,差 670
//   ② meter:307「力美C201电」loss_exclude(默认行)→ C座分表少 293
//   ③ building:25「G座」loss_variant=2 不核算 → 分表落 0、−100%,还污染对账与合计
// 用户既核不出差在哪、也不知道去哪改。此面板逐条列出对本 zone 生效的口径,并**标明作用月份**:
// 「默认(所有月份)」是最容易背着人生效的那种,单独标红。
const cfgOpen = ref(false)
const meterName = (id: number) => meters.value.find(m => m.id === id)?.name ?? `表#${id}`
const bldName = (id: number) => buildings.value.find(b => b.id === id)?.name ?? `栋#${id}`
const bldZone = (id: number) => buildings.value.find(b => b.id === id)?.phase
// 可改的三类:剔出Σ / 损耗口径 / 池加度。⭐一律只写**本月行**,默认行分毫不动 ——
// 默认行是别的月份(2024-02)校准出来的,为了修 2023-08 去改它会把那个月一起弄坏。
// 月行存在即压过默认行(loadCtx:默认行先落、月行覆盖),所以「本月改回来」是安全且可逆的:
// 清空月行(value=null → saveCfg 删行)就退回默认。
type CalibEdit = 'exclude' | 'variant' | 'extra' | null
interface CalibRow {
  kind: string; target: string; detail: string; scope: string; monthly: boolean
  edit: CalibEdit; cur: string          // 当前生效值(月行优先),给控件回显
}
const VARIANT_OPTS = [
  { value: '0', label: '正常核算(总表−分表)' },
  { value: '1', label: '纯公摊式(G÷总表+加点)' },
  { value: '2', label: '不核算(只陈列)' },
]
const LOSS_VARIANT_TEXT: Record<string, string> = {
  '1': '纯公摊式(率=G÷总表+加点)', '2': '不核算(只陈列,不出损耗率)',
}
const calibRows = computed<CalibRow[]>(() => {
  const out: CalibRow[] = []
  const inZone = (bid: number) => {
    const p = bldZone(bid)
    return p == null || (zone.value === 'p1' ? p === 1 : p === 2)
  }
  // ⭐必须按 (scope,cfgKey) 归并后再判,不能逐条遍历 cfgs(2026-08-14 自查两个真缺陷):
  //  ① cfgs 是 selectEffective = 默认行 ∪ 当月行,逐条遍历会让同一个 building 的 loss_variant
  //     出**两行**(一条默认一条本月),面板里看着像有两套口径;
  //  ② 更糟的是 `&& c.value` 这种真值判断:勾「本月计入Σ」写的是 loss_exclude=**0**,0 在 JS 里是假值,
  //     该月行直接被跳过 → 只剩 value=1 的默认行 → :checked 回落 false → 复选框保存成功却自己弹回,
  //     用户以为没存上。所以一律走 resolveCfg(月行优先回退默认,已有单测)拿**有效值**,
  //     再用 hasMonth 单独判「本月是否有覆盖行」。
  const seen = new Set<string>()
  const hasMonth = (scope: string, key: string) =>
    cfgs.value.some(c => c.scope === scope && c.cfgKey === key && !!c.acctMonth)
  for (const c of cfgs.value) {
    const k = `${c.scope}|${c.cfgKey}`
    if (seen.has(k)) continue
    seen.add(k)
    const [pfx, idStr] = c.scope.split(':')
    const id = Number(idStr)
    const eff = resolveCfg(cfgs.value, c.scope, c.cfgKey)
    const monthly = hasMonth(c.scope, c.cfgKey)
    if (pfx === 'meter' && c.cfgKey === 'loss_exclude') {
      const m = meters.value.find(x => x.id === id)
      if (m && m.buildingId != null && !inZone(m.buildingId)) continue
      const excluded = eff != null && eff !== 0
      out.push({ kind: excluded ? '剔出总表/分表Σ' : '本月已改回计入Σ', target: meterName(id),
        detail: `${m?.buildingId != null ? bldName(m.buildingId) + ' · ' : ''}`
          + (excluded ? '该表用量不计入 C(总表)与 D(分表)' : '本月已覆盖为计入 C/D(默认是剔出)'),
        scope: c.scope, monthly, edit: 'exclude', cur: excluded ? '1' : '0' })
    } else if (pfx === 'building' && inZone(id)) {
      if (c.cfgKey === 'loss_variant')
        out.push({ kind: '损耗口径', target: bldName(id),
          detail: LOSS_VARIANT_TEXT[String(eff)] ?? `正常核算(总表−分表)`,
          scope: c.scope, monthly, edit: 'variant', cur: String(Number(eff ?? 0)) })
      else if (c.cfgKey === 'loss_c_meter')
        out.push({ kind: '组C只取此总表', target: bldName(id),
          detail: `${meterName(Number(eff))} —— 该栋其余总表既不入 C 也不入 D`,
          scope: c.scope, monthly, edit: null, cur: '' })
      else if (c.cfgKey === 'loss_head')
        out.push({ kind: '并入他栋核算', target: bldName(id),
          detail: `与 ${bldName(Number(eff))} 合成一组共用总表`, scope: c.scope, monthly, edit: null, cur: '' })
      else if (c.cfgKey === 'loss_recon' && Number(eff) === 0)
        out.push({ kind: '不入对账Σ', target: bldName(id),
          detail: '该栋不参与下方「供电侧总表 vs 单元Σ」两行对账', scope: c.scope, monthly, edit: null, cur: '' })
    }
  }
  // 池加度:−670 那条住在 alloc_rule.extra_qty 列(不是 alloc_cfg),cfg 里看不到,必须单独捞
  for (const r of rules.value) {
    if (r.zone !== zone.value || !r.extraQty) continue
    const monthRow = cfgs.value.find(c => c.scope === `rule:${r.id}` && c.cfgKey === 'extra_qty' && c.acctMonth)
    const eff = monthRow ? monthRow.value : r.extraQty
    out.push({ kind: '池加度(影响公摊分摊度数)', target: r.name,
      detail: `${eff} 度计入该池净量`
        + (r.feeKey === 'park_loss_pool' ? ' —— 园区公摊池,直接进 G 的分子' : ''),
      scope: `rule:${r.id}`, monthly: !!monthRow, edit: 'extra', cur: String(eff ?? '') })
  }
  return out
})

// 本月改口径:一律写月行(acct_month=ym),默认行不动;传 null=删月行退回默认。
// WRITE-KEEP-CONTEXT-SPEC 铁律二:保存成功只 patch cfgs 里那一条,不再 loadMonth() 重拉整月 ——
// 屏上数字本就是旧快照(所以才有下面那条提示条),重拉也不会让它们变新,唯一会变的就是这一条参数;
// 而重拉会把 loss/cfgs 两个 ref 整体换掉,面板每行控件回显重建、用户刚点的那格视觉上「跳一下」。
// m 快照:回包到达前用户可能换了月,换了就别把上个月的值补进本月名单(同 PoolLedgerView.commitRuleCfg)。
function commitCalib(scope: string, key: string, value: number | null) {
  const m = ym.value
  allocApi.saveCfg({ scope, cfgKey: key, acctMonth: m, value })
    .then(() => {
      cfgDirty.value = true
      if (m === ym.value) upsertMonthCfg(cfgs.value, scope, key, m, value)
    })
    .catch(e => alert(errMsg(e, '保存失败，请重试')))
}
// 「本月计入Σ」= 写 loss_exclude=0 月行压过默认的 1;取消勾选=删月行,退回默认(剔出)
const onExclude = (r: CalibRow, includeThisMonth: boolean) =>
  commitCalib(r.scope, 'loss_exclude', includeThisMonth ? 0 : null)
const onVariant = (r: CalibRow, v: string) =>
  commitCalib(r.scope, 'loss_variant', v === '' ? null : Number(v))
function onExtra(r: CalibRow, raw: string) {
  const t = raw.trim()
  if (t === '') { commitCalib(r.scope, 'extra_qty', null); return }   // 清空=退回规则默认值
  const v = Number(t)
  if (!isFinite(v)) { alert('请输入数字'); return }
  commitCalib(r.scope, 'extra_qty', v)
}
const calibDefaults = computed(() => calibRows.value.filter(r => !r.monthly).length)

// ── 行内人工参数(编辑态):building:{headBuildingId} 月行,commitAdj 模式 → 提示重新生成 ──
const cfgDirty = ref(false)
const cfgRaw = (buildingId: number, key: string) =>
  cfgs.value.find(c => c.scope === `building:${buildingId}` && c.cfgKey === key && c.acctMonth === ym.value)
// 带着同一账期跳过去:换屏后还要用户自己再选一遍年月,是最容易把人绕晕的一步
const router = useRouter()
function gotoGenerate() {
  // ⚠ 路由表是纯 path(fpNav 生成,没有 name),push({name}) 会静默失败 —— 实测点了不动窝
  router.push({ path: '/alloc', query: { ym: ym.value, generate: '1' } })
}
// 同 commitCalib:铁律二,只 patch 这一条。行内三格(调整度数/调整损耗/G调整)的编辑态回显取自
// cfgRaw(=cfgs),patch 完即正确;只读态那几格取快照(u.adjQty…),本就要等重新生成才变,与提示条一致。
function commitAdj(buildingId: number, key: 'loss_adj_qty' | 'loss_adj_rate' | 'loss_g_adj', raw: string) {
  const t = raw.trim()
  const v = t === '' ? null : Number(t)
  if (v != null && !isFinite(v)) { alert('请输入数字'); return }
  commitCalib(`building:${buildingId}`, key, v)
}
</script>

<template>
  <div v-if="!loss" class="page-loading"><span class="page-spin" /></div>

  <div v-else class="ll-page">
    <!-- 标题行 -->
    <div class="ll-head">
      <div class="ll-head-l">
        <h2 class="ll-title"><span class="ic"><component :is="iconFor('trending-down')" :size="18" /></span>楼栋损耗</h2>
        <div style="width:110px">
          <Select :options="yearOpts" :model-value="String(year)" size="sm" @update:model-value="year = +$event" />
        </div>
        <div style="width:92px">
          <Select :options="monthOpts" :model-value="String(month)" size="sm" @update:model-value="month = +$event" />
        </div>
        <Segmented :options="ZONE_OPTS" v-model="zone" size="sm" />
      </div>
      <div class="ll-actions">
        <Button v-if="canEdit" :variant="editMode ? 'filled' : 'outline'" size="sm" @click="editMode = !editMode">
          <template #leading><component :is="iconFor(editMode ? 'check' : 'pencil')" :size="14" /></template>
          {{ editMode ? '完成' : '编辑模式' }}
        </Button>
      </div>
    </div>

    <!-- 提示条:本月未生成 / 参数已变请重新生成(生成入口在公共电核算屏) -->
    <div v-if="!generated" class="ll-bar">
      <component :is="iconFor('info')" :size="14" />
      <span>{{ year }}年{{ month }}月未生成 —— 损耗快照为空;在「公共电核算」屏点「生成本月」后此处落数。</span>
    </div>
    <!-- 改完不生效是本屏最大的坑:三格都只写参数,重算在**另一个屏**,而那个屏的「重新生成」
         按钮还要先开它自己的编辑模式才出现。光写一句话等于让人去猜,故直接给一个按钮送过去。 -->
    <!-- 铁律三:这条是**写出来的**提示条,一冒出来就把下面 flex:1 的表格挤矮、内容上移、
         底部行被切掉,用户刚改的那行可能滑出视口。故编辑态常驻占位(只切 visibility);
         浏览态没有写入口不占位,已脏则照常显示。同 PoolLedgerView 的 .pl-bar.ghost。 -->
    <div v-if="editMode || cfgDirty" class="ll-bar warn" :class="{ ghost: !cfgDirty }">
      <component :is="iconFor('alert-triangle')" :size="14" />
      <span>参数已存,但屏上数字仍是旧快照 —— 损耗要在「公共电核算」屏重算才生效
        (那边需先点「编辑模式」,「重新生成」按钮才会出现)。</span>
      <Button variant="outline" size="sm" @click="gotoGenerate">
        <template #leading><component :is="iconFor('refresh-cw')" :size="14" /></template>
        去公共电核算重新生成
      </Button>
    </div>

    <!-- 「本月口径」:屏上数字背后的隐藏参数。不列出来,与源册对不上时无从查起 -->
    <div v-if="calibRows.length" class="ll-bar calib">
      <component :is="iconFor('sliders-horizontal')" :size="14" />
      <span>本月对 {{ POOL_ZONE_LABEL[zone] }} 生效的口径参数 <b>{{ calibRows.length }}</b> 条<template
        v-if="calibDefaults"> —— 其中 <b class="em">{{ calibDefaults }}</b> 条是「默认(所有月份)」,
        它们多半是给某一个月校准的,却对每个月都生效</template>。</span>
      <button class="ll-link" @click="cfgOpen = !cfgOpen">{{ cfgOpen ? '收起' : '展开' }}</button>
      <div v-if="cfgOpen" class="ll-caliblist">
        <div v-for="(r, i) in calibRows" :key="i" class="ll-calibrow">
          <span class="k">{{ r.kind }}</span>
          <span class="t">{{ r.target }}</span>
          <span class="d">{{ r.detail }}</span>
          <!-- 只在编辑态出控件,且**只写本月行** —— 默认行是别的月校准的,动它会连坐那个月 -->
          <template v-if="editMode && r.edit">
            <label v-if="r.edit === 'exclude'" class="ll-cbx"
                   title="勾上=本月把这块表算回 C/D 两个Σ(写本月行压过默认);取消=退回默认(剔出)">
              <!-- 绑**有效值**而非 monthly:勾选态要回答「本月到底算不算进Σ」,不是「有没有月行」 -->
              <input type="checkbox" :checked="r.cur === '0'"
                     @change="onExclude(r, ($event.target as HTMLInputElement).checked)" />
              本月计入Σ
            </label>
            <select v-else-if="r.edit === 'variant'" class="ll-csel"
                    title="只改本月的损耗口径;选「跟随默认」=删本月行退回默认"
                    :value="r.monthly ? r.cur : ''"
                    @change="onVariant(r, ($event.target as HTMLSelectElement).value)">
              <option value="">跟随默认</option>
              <option v-for="o in VARIANT_OPTS" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <input v-else class="ll-cin" type="number" step="any"
                   :value="r.monthly ? r.cur : ''" :placeholder="`默认 ${r.cur}`"
                   title="只改本月的加度;清空=退回规则默认值。源册某月不该有这笔调整时,这里填 0"
                   @change="onExtra(r, ($event.target as HTMLInputElement).value)" />
          </template>
          <span class="m" :class="{ em: !r.monthly }">{{ r.monthly ? `仅 ${ym}` : '默认 · 所有月份' }}</span>
          <span class="s">{{ r.scope }}</span>
        </div>
        <div v-if="!editMode" class="ll-calibhint">点右上「编辑模式」可逐条改本月口径(只写本月,不动默认)。</div>
      </div>
    </div>

    <!-- 台账式宽表:单元行 + 对账区两行(供电侧总表 vs 单元合计) + tfoot 合计 -->
    <div class="ll-wrap">
      <table class="ll-table">
        <thead>
          <tr>
            <th class="ll-th ll-fix-th ll-fix" :style="fixLbl">位置</th>
            <th class="ll-th" :style="w(108)">总表用电量</th>
            <th v-if="isP2" class="ll-th" :style="w(104)" title="仅陈列,不入总表/分表合计">铝缆用电量</th>
            <th class="ll-th" :style="w(108)">分表用电量</th>
            <th class="ll-th" :style="w(100)">损耗量</th>
            <th class="ll-th" :style="w(92)">原损耗率</th>
            <th v-if="zone === 'p1'" class="ll-th" :style="w(116)" title="一期:园区公共池/均摊座数+g_adj;编辑态改 g_adj">公摊分摊度数</th>
            <th class="ll-th" :style="w(96)" title="人工调整度数(如 −1500),building 月行 loss_adj_qty">调整度数</th>
            <th class="ll-th" :style="w(92)" title="人工加点(一期 0.003~0.018/二期 0.002),building 月行 loss_adj_rate">调整损耗</th>
            <th class="ll-th" :style="w(116)">收取租户损耗率</th>
            <th class="ll-th" :style="w(170)">备注</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in units" :key="u.headBuildingId">
            <td class="ll-fix" :style="fixLbl">
              <span class="ll-lbl" :title="u.label">
                {{ u.label }}
                <span v-if="u.variant === 'share_only'" class="ll-var" title="纯公摊式:率=G/C+加点">公摊式</span>
                <span v-else-if="u.variant === 'none'" class="ll-var dim" title="不核算(组内无分表或 D=C)">不核算</span>
              </span>
            </td>
            <td><span class="ll-nv" :class="{ empty: u.cQty == null }">{{ fmt(u.cQty) }}</span></td>
            <td v-if="isP2"><span class="ll-nv" :class="{ empty: u.cableQty == null }">{{ fmt(u.cableQty) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: u.dQty == null }">{{ fmt(u.dQty) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: u.eQty == null, neg: (u.eQty ?? 0) < 0 }">{{ fmt(u.eQty) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: u.rawRate == null }">{{ fpct(u.rawRate) }}</span></td>
            <!-- ⭐名实分离(2026-08-14 用户报障「改了跟没改一样,既不显示也没改读数」):
                 这一格只读显的是**派生值 G**,而编辑框绑的是 loss_g_adj(对 G 的增减量,默认空)。
                 改前编辑态只出输入框 → 用户看到空白以为「没值」,填 388.62 以为是「设成 388.62」,
                 实际是「在 276.95 上再加 388.62」。现在编辑态把 G 与调整量并排显示,谁是谁一眼可见。 -->
            <td v-if="zone === 'p1'">
              <div v-if="editMode" class="ll-gcell">
                <span class="ll-gbase" :title="G_TITLE">{{ fmt(u.gQty) }}</span>
                <input class="ll-ni" type="number" step="any"
                       :value="cfgRaw(u.headBuildingId, 'loss_g_adj')?.value ?? ''"
                       placeholder="±调整"
                       :title="`在派生值 G=${fmt(u.gQty)} 上加减多少(如 −1500),留空=不调整。\n这里填的不是 G 本身。\n${G_TITLE}`"
                       @change="commitAdj(u.headBuildingId, 'loss_g_adj', ($event.target as HTMLInputElement).value)" />
              </div>
              <span v-else class="ll-nv" :class="{ empty: u.gQty == null }" :title="G_TITLE">{{ fmt(u.gQty) }}</span>
            </td>
            <td>
              <input v-if="editMode" class="ll-ni" type="number" step="any"
                     :value="cfgRaw(u.headBuildingId, 'loss_adj_qty')?.value ?? ''"
                     placeholder="–" title="人工调整度数,回车/失焦保存;清空=删行"
                     @change="commitAdj(u.headBuildingId, 'loss_adj_qty', ($event.target as HTMLInputElement).value)" />
              <span v-else class="ll-nv" :class="{ empty: u.adjQty == null }">{{ fmt(u.adjQty) }}</span>
            </td>
            <td>
              <input v-if="editMode" class="ll-ni" type="number" step="any"
                     :value="cfgRaw(u.headBuildingId, 'loss_adj_rate')?.value ?? ''"
                     placeholder="–" title="人工加点(小数,如 0.003),回车/失焦保存"
                     @change="commitAdj(u.headBuildingId, 'loss_adj_rate', ($event.target as HTMLInputElement).value)" />
              <span v-else class="ll-nv" :class="{ empty: u.adjRate == null }">{{ fpct(u.adjRate) }}</span>
            </td>
            <td><span class="ll-rate" :class="{ empty: u.tenantRate == null }">{{ fpct(u.tenantRate) }}</span></td>
            <td><span class="ll-txt" :title="u.note ?? undefined">{{ u.note ?? '–' }}</span></td>
          </tr>
          <tr v-if="units.length === 0">
            <td class="ll-noro" :colspan="colCount">{{ POOL_ZONE_LABEL[zone] }}本月无损耗单元(需生成快照)</td>
          </tr>
          <!-- 对账区两行(读时派生;p1 的Σ排除 A座 loss_recon=0) -->
          <tr v-for="(r, i) in reconRows" :key="'rc' + i" class="ll-recon">
            <td class="ll-fix" :style="fixLbl"><span class="ll-lbl">{{ r.label }}</span></td>
            <td><span class="ll-nv" :class="{ empty: r.cQty == null }">{{ fmt(r.cQty) }}</span></td>
            <td v-if="isP2"></td>
            <td><span class="ll-nv" :class="{ empty: r.dQty == null }">{{ fmt(r.dQty) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: r.loss == null, neg: (r.loss ?? 0) < 0 }">{{ fmt(r.loss) }}</span></td>
            <td><span class="ll-nv" :class="{ empty: r.rate == null }">{{ fpct(r.rate) }}</span></td>
            <td :colspan="colCount - 5 - (isP2 ? 1 : 0)"></td>
          </tr>
        </tbody>
        <!-- tfoot 合计:Σ总表/铝缆/分表/损耗量(率不合计) -->
        <tfoot>
          <tr>
            <th class="ll-fix" :style="fixLbl"><span class="ll-foot-lbl">合　计</span></th>
            <th><span class="ll-foot-v">{{ fmt(foot.cQty) }}</span></th>
            <th v-if="isP2"><span class="ll-foot-v">{{ fmt(foot.cableQty) }}</span></th>
            <th><span class="ll-foot-v">{{ fmt(foot.dQty) }}</span></th>
            <th><span class="ll-foot-v">{{ fmt(foot.eQty) }}</span></th>
            <th :colspan="colCount - 4 - (isP2 ? 1 : 0)"></th>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
</template>

<style scoped>
.ll-page { display: flex; flex-direction: column; gap: 14px; height: 100%; min-height: 0; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%; }

.ll-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.ll-head-l { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.ll-title { margin: 0 6px 0 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.ll-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.ll-actions { display: flex; align-items: center; gap: 8px; }

.ll-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--fs-label); color: var(--text-secondary); }
.ll-bar.warn { border-color: var(--hue-orange); background: rgb(255, 250, 235); color: rgb(138, 97, 0); }
/* 铁律三占位态:仍占高、仍参与 flex 计算,只是看不见 —— 提示条出现时表格一格都不动 */
.ll-bar.ghost { visibility: hidden; }
/* 本月口径面板:中性蓝(这不是错误,是「你该知道的隐藏前提」);默认行标红提醒它跨月生效 */
.ll-bar.calib { flex-wrap: wrap; border-style: solid; border-color: rgb(206, 223, 252); background: rgb(238, 244, 255); color: rgb(28, 84, 168); font-size: 12px; }
.ll-bar.calib b { font-variant-numeric: tabular-nums; }
.ll-bar.calib b.em { color: var(--hue-red); }
.ll-link { border: none; background: none; padding: 0 2px; font: inherit; color: var(--hue-blue); cursor: pointer; text-decoration: underline; }
.ll-caliblist { flex-basis: 100%; display: flex; flex-direction: column; gap: 2px; margin-top: 6px; max-height: 200px; overflow: auto; }
.ll-calibrow { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 4px 8px; border-radius: var(--radius-sm); background: var(--surface-white); font-size: 11.5px; color: var(--text-secondary); }
.ll-calibrow .k { flex: 0 0 auto; font-weight: var(--fw-semibold); color: var(--text-primary); }
.ll-calibrow .t { flex: 0 0 auto; color: var(--hue-blue); }
.ll-calibrow .d { flex: 1 1 200px; min-width: 0; }
.ll-calibrow .m { flex: 0 0 auto; padding: 1px 7px; border-radius: var(--radius-full); background: var(--bg-sunken); font-size: var(--fs-micro); }
.ll-calibrow .m.em { background: rgb(255, 238, 237); color: var(--hue-red); }
.ll-calibrow .s { flex: 0 0 auto; font-family: var(--font-mono); font-size: 10.5px; color: var(--text-disabled); }
.ll-cbx { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 4px; font-size: 11.5px; color: var(--hue-blue); cursor: pointer; white-space: nowrap; }
.ll-cbx input { accent-color: var(--hue-blue); cursor: pointer; }
.ll-csel { flex: 0 0 auto; height: 24px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-white); font-size: 11.5px; color: var(--text-primary); }
.ll-cin { flex: 0 0 96px; height: 24px; box-sizing: border-box; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-white); text-align: right; font-size: 11.5px; padding: 0 6px; font-family: var(--font-mono); color: var(--text-primary); }
.ll-cin::-webkit-outer-spin-button, .ll-cin::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.ll-calibhint { padding: 4px 8px; font-size: 11px; color: var(--text-muted); }

/* ── 宽表(FPLedgerTable 手法) ── */
.ll-wrap { flex: 1 1 auto; min-height: 0; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--surface-white); }
.ll-table { border-collapse: separate; border-spacing: 0; width: max-content; min-width: 100%; font-family: var(--font-sans); }
.ll-table th, .ll-table td { border-bottom: 1px solid var(--divider); box-sizing: border-box; padding: 0; }
.ll-table thead th { position: sticky; top: 0; background: var(--surface-card); color: var(--text-muted); font-size: 11.5px; font-weight: var(--fw-semibold); text-align: center; padding: 0 8px; z-index: 4; height: 38px; }
.ll-fix-th { z-index: 8; vertical-align: middle; }
.ll-table tbody td { height: 34px; background: var(--surface-white); vertical-align: middle; }
.ll-table tbody tr:hover td { background: var(--surface-card); }
.ll-fix { position: sticky; z-index: 3; background: var(--surface-white); }
.ll-table tbody tr:hover .ll-fix { background: var(--surface-card); }

.ll-lbl { display: inline-flex; align-items: center; gap: 6px; padding: 0 10px; font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.ll-var { flex: 0 0 auto; font-size: var(--fs-micro); font-weight: var(--fw-regular); color: var(--hue-blue); background: rgb(232, 240, 254); border-radius: var(--radius-full); padding: 1px 7px; cursor: help; }
.ll-var.dim { color: var(--text-muted); background: var(--bg-sunken); }

.ll-nv { display: block; text-align: right; font-size: 12px; padding: 0 8px; color: var(--text-secondary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ll-nv.empty { color: var(--text-disabled); }
.ll-nv.neg { color: var(--hue-red); }
.ll-rate { display: block; text-align: right; font-size: 12px; padding: 0 8px; font-weight: var(--fw-semibold); color: var(--hue-blue); font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; }
.ll-rate.empty { color: var(--text-disabled); font-weight: var(--fw-regular); }
.ll-txt { display: block; text-align: left; font-size: 12px; padding: 0 10px; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* 对账区两行(分隔带样式对标 mlg-bsum) */
.ll-table tbody tr.ll-recon td { height: 40px; background: var(--surface-sunken); border-top: 2px solid var(--border-strong); border-bottom: 2px solid var(--border-strong); }
.ll-table tbody tr.ll-recon + tr.ll-recon td { border-top: none; }

/* G 格编辑态:左派生值(灰,只读)+右调整输入 —— 两个量并排,谁是谁一眼可见 */
.ll-gcell { display: flex; align-items: center; gap: 4px; padding: 0 4px; }
.ll-gbase { flex: 0 0 auto; font-size: 11.5px; color: var(--text-muted); font-family: var(--font-mono); font-variant-numeric: tabular-nums; cursor: help; }
.ll-gcell .ll-ni { flex: 1 1 auto; min-width: 0; }

/* 行内 input(透明格) */
.ll-ni { width: 100%; box-sizing: border-box; border: 1px solid transparent; background: transparent; text-align: right; font-size: 12px; padding: 3px 6px; outline: none; color: var(--text-primary); font-family: var(--font-mono); border-radius: var(--radius-sm); }
.ll-ni:focus { background: var(--accent-blue); border-color: var(--hue-blue); }
.ll-ni::-webkit-outer-spin-button, .ll-ni::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.ll-ni::placeholder { color: var(--text-disabled); }

.ll-noro { text-align: center; padding: 40px 16px; color: var(--text-disabled); font-size: var(--fs-label); }

.ll-table tfoot th { position: sticky; bottom: 0; z-index: 5; height: 40px; font-weight: var(--fw-semibold); background: var(--surface-white); border-top: 2px solid var(--border-strong); font-family: var(--font-mono); color: var(--text-primary); }
.ll-table tfoot th.ll-fix { z-index: 7; }
.ll-foot-lbl { display: block; padding: 0 10px; text-align: left; font-family: var(--font-sans); font-size: 12.5px; color: var(--text-primary); }
.ll-foot-v { display: block; text-align: right; padding: 0 8px; font-size: 12px; font-variant-numeric: tabular-nums; color: var(--brand-deep); }
</style>
