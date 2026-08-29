<script setup lang="ts">
// 系数簿窗口(S14-COEF-BOOK-SPEC §3 v3 定稿):催缴单页入口的批量系数编辑器——居中窗口卡片
// (编辑池弹窗同款 FPDrawer 容器)。交互=选租户→选系数→统一修改条改→保存:
// 期页签+搜索/系数下拉(一次一个)/生效月(默认=催缴单页 ym,版本自该月起前滚)/多选+表头全选
// (=当前筛选可见行)/统一修改条唯一改值入口(表格无逐行输入框)/暂存-提交模型(保存一次性顺序提交,
// 失败中断报错并刷新已提交部分)。层份键仅二期页签开放;viewer 只读查看(编辑模式按钮走 canEdit)。
// S21:价目键源=计费参数注册表(coefBookLogic.COEF_KEYS),读 GET /params?ym&key= 写 PUT /params;值控件按 valueKind(enum→Select)。
import { computed, ref, watch, onUnmounted } from 'vue'
import FPEditModeButton from '@/components/fp/FPEditModeButton.vue'
import { paramsApi, type ParamRowDTO } from '@/api/params'
import { allocApi, type AllocPoolRowDTO, type AllocRuleDTO } from '@/api/alloc'
import type { ContractDTO } from '@/types/contract'
import type { BuildingDTO } from '@/types/building'
import { buildYearOptions } from '@/utils/yearGate'
import { groupByBuilding } from '@/utils/billNoticeLogic'
import {
  COEF_KEYS, buildCoefRows, buildFloorPlan, buildPricePlan, coefMeta, floorMemberships,
  floorStashAfter, poolsOfFeeKey, resolveCoefPrice, type CoefStash, type CoefTenantRow,
} from '@/utils/coefBookLogic'
import { useAuthStore } from '@/stores/auth'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import Segmented from '@/components/ds/Segmented.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPElevateDialog from '@/components/fp/FPElevateDialog.vue'
import FPTakeoverDrawer from '@/components/fp/FPTakeoverDrawer.vue'
import FPEvictedDialog from '@/components/fp/FPEvictedDialog.vue'
import { useEditLock } from '@/composables/useEditLock'
import { S } from '@/utils/lockScopes'
import FPToast from '@/components/fp/FPToast.vue'

const props = defineProps<{
  open: boolean
  ym: string                  // 催缴单页当前账期(生效月默认值)
  phase: string               // 初始期页签('1'|'2'|'3')
  contracts: ContractDTO[]    // 当月在租合同(租户清单/期归属/楼栋同源)
  buildings: BuildingDTO[]
  years: number[]             // 年下拉数据(页面同源)
}>()
const emit = defineEmits<{ close: [] }>()

const auth = useAuthStore()
// RBAC:系数簿改的是计费口径,不能沿用宿主催缴单页的 billing 权(那是 billing 直通 param 的漏洞)
const canEdit = computed(() => auth.can('param-policy:edit'))
// 无权的账号也看得到「编辑模式」按钮(只要能请求提权),点了弹主管授权窗 —— ELEVATION-SPEC。
// 藏掉的话财务专员只会以为系数簿是只读的。
const asking = ref<string[] | null>(null)
const canAsk = computed(() => canEdit.value || auth.can('elevate:request'))
const errMsg = (e: unknown, fallback: string) => (e as { message?: string })?.message ?? fallback
const pad2 = (n: number) => String(n).padStart(2, '0')
const today = new Date()

// ── 窗口态:期页签/搜索/系数/生效月/编辑模式/暂存/选中 ──
const phase = ref('1')
const PHASE_OPTS = [
  { value: '1', label: '一期' }, { value: '2', label: '二期' }, { value: '3', label: '三期' },
]
const q = ref('')
const coefId = ref(COEF_KEYS[0].id)
const effYear = ref(today.getFullYear())
const effMonth = ref(today.getMonth() + 1)
const effYm = computed(() => `${effYear.value}-${pad2(effMonth.value)}`)
const editMode = ref(false)

// ── 编辑锁(CONCURRENCY-SPEC §3.2) ──
// ⚠ 键取**生效月 effYm**,不是催缴单页当前的 ym —— 生效月由本窗口内独立选择,两者可以不同。
//   取错了会锁住一个没人在改的月,而真正在改的那个月毫无保护(§3.1 E 段点名的坑)。
// 这把锁与计费参数 / 公共电核算 / 催缴单三屏**共占同一把**:它们打的是同一批快照表。
const lock = useEditLock(() => { editMode.value = false }, () => canEdit.value)
const { lockedBy, evictedBy } = lock
/** 这一期(按生效月)此刻被谁占着 —— 取自在场表，不用点按钮撞门。 */
const heldByOther = lock.watchScope(() => S.coefBook(effYear.value, effMonth.value))
watch(editMode, (on) => { if (!on) lock.release() })

async function onEditBtn() {
  if (!canEdit.value) { asking.value = ['param-policy:edit']; return }
  if (await lock.acquire(S.coefBook(effYear.value, effMonth.value))) editMode.value = true
}
async function onTaken() {
  lockedBy.value = null
  if (await lock.acquire(S.coefBook(effYear.value, effMonth.value))) editMode.value = true
}
// ⚠ 本窗口不走 useEditMode(有自己的退出语义),但必须登记进 auth.editors ——
//   不登记的话守卫两头都失效:别的页面退出编辑时会把本窗口正用着的授权一起结束掉,
//   而本窗口退出时又会被别的页面挡住结束不了。
const meId = Symbol('coef-book')
watch(editMode, (on) => { if (on) auth.openEditor(meId); else auth.closeEditor(meId) })
onUnmounted(() => auth.closeEditor(meId))
const stash = ref<CoefStash>(new Map())

// ── 被接管时的「复制我的改动」:暂存(租户 → 新值)导 TSV ──
// stash 在退出编辑/被踢时整个丢弃 —— 值是 null 表示「清除该户例外,回默认」。
function stashAsTsv(): string {
  const TAB = '\t', NL = '\n'
  const meta = curMeta.value
  const head = ['租户', `${meta.label}${meta.unit ? `(${meta.unit})` : ''}`, '生效起'].join(TAB)
  const body = [...stash.value.entries()].map(([tid, v]) =>
    [nameOf(tid), v == null ? '(清除,回默认)' : String(v), effYm.value].join(TAB))
  return [head, ...body].join(NL)
}
const selected = ref(new Set<number>())
const uni = ref('')
const clearMode = ref(false)

const curMeta = computed(() => coefMeta(coefId.value))
// 层份键仅二期开放:一期/三期页签下禁用编辑并提示(表格让位提示条)
// 「层份仅二期」同一条规则的三份拷贝之一,另两份:本文件下方 allocApi.rules('p2') 调用、coefBookLogic.ts poolsOfFeeKey 的 p.zone === 'p2' 过滤
const floorLocked = computed(() => curMeta.value.floorShare && phase.value !== '2')
const coefOpts = COEF_KEYS.map(k => ({
  value: k.id, label: k.floorShare ? `${k.label}(仅二期)` : k.unit ? `${k.label}(${k.unit})` : k.label,
}))
// 枚举键(损耗基数形态)统一修改条用 Select 字典;值存数字,显示文字
const enumOpts = computed(() =>
  Object.entries(curMeta.value.enumOptions ?? {}).map(([v, l]) => ({ value: v, label: l })))
const enumText = (v: number) => curMeta.value.enumOptions?.[v] ?? String(v)
const yearOpts = computed(() =>
  buildYearOptions(props.years, today).map(y => ({ value: String(y), label: `${y}年` })))
const monthOpts = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` }))

// ── 数据:价目键站在生效月的生效行(后端已级联解析) + 当月池快照(层份成员) + p2 规则(池费项在 rule 上);竞态守卫 ──
const PRICE_KEY_PARAM = COEF_KEYS.filter(k => !k.floorShare).map(k => k.id).join(',')
const loading = ref(false)
const priceRows = ref<ParamRowDTO[]>([])
const pools = ref<AllocPoolRowDTO[]>([])
const rules = ref<AllocRuleDTO[]>([])
let seq = 0
async function load() {
  const my = ++seq
  loading.value = true
  try {
    const [ps, pl, rs] = await Promise.all([
      paramsApi.list(effYm.value, 'all', { key: PRICE_KEY_PARAM }),
      allocApi.pools(effYm.value).catch(() => ({ generated: false, rows: [] as AllocPoolRowDTO[] })),
      // 层份仅二期开放,写死 'p2':另两份拷贝见本文件 floorLocked、coefBookLogic.ts poolsOfFeeKey
      allocApi.rules('p2').catch(() => [] as AllocRuleDTO[]),
    ])
    if (my !== seq) return
    priceRows.value = ps
    pools.value = pl.rows
    rules.value = rs
  } catch (e) {
    if (my !== seq) return
    alert(errMsg(e, '系数簿数据加载失败'))
    emit('close')
  } finally { if (my === seq) loading.value = false }
}
watch(() => props.open, o => {
  // ⚠ 关窗 = 退出编辑态。本组件是 `<CoefBookWindow :open="coefOpen">`,**永远挂载着**,
  //   只切 open —— onUnmounted 那道兜底在这里根本不会触发。
  //   这一行以前不在,于是关窗后 editMode 停在 true:锁不还、在场表停在 edit,
  //   别人的按钮一直挂着「张三 编辑中」,而那条 3 秒 ping 还在替他续锁。
  //   置假之后由上面那条 `watch(editMode)` 把锁还掉。
  if (!o) { editMode.value = false; return }
  phase.value = props.phase
  const [y, m] = props.ym.split('-')
  effYear.value = +y
  effMonth.value = +m
  q.value = ''
  coefId.value = COEF_KEYS[0].id
  editMode.value = false
  clearMode.value = false
  uni.value = ''
  stash.value.clear()
  selected.value.clear()
  okMsg.value = ''
  load()
})

// ── 行构建:期归属/主楼栋与催缴单列表同源;组=楼栋(空组不出现) ──
const rowsAll = computed(() => buildCoefRows(props.contracts, props.buildings))
const filtered = computed(() => rowsAll.value.filter(r =>
  r.phase === +phase.value
  && (q.value.trim() === '' || r.tenantName.includes(q.value.trim()))))
const groups = computed(() => groupByBuilding(filtered.value, r => r.bld.main))
const nameOf = (id: number) => rowsAll.value.find(r => r.tenantId === id)?.tenantName ?? `#${id}`
// 搜索缩小可见集时同步剪掉隐藏选中(全选/应用都只作用当前筛选可见行)
watch(q, () => {
  const vis = new Set(filtered.value.map(r => r.tenantId))
  for (const id of [...selected.value]) if (!vis.has(id)) selected.value.delete(id)
})

// ── 当前生效值:价目键=GET /params 行按 户→期→全园 找(例外徽标=户级行命中自身版本),值/区间用后端人话;
//    层份键=当月池成员行(weight+src),hover 明示逐池构成(spec §4 改前披露) ──
// 期区取该户主楼栋上的真实 zone 字段,不由 phase 猜:宿舍楼 phase=1 但 zone=dorm,
// 三期楼栋在手工标注前 zone=NULL(V113 迁移故意留空,见 ParamService.java:328 同款顾虑)。
// 找不到楼栋 / 楼栋期区未标注时返回 null——resolveCoefPrice 据此跳过期级作用域直接落全园价,
// 这本就是「期区未定」应有的行为;下方渲染处补一个「未标注期区」角标,不让这次全园价落得无声无息。
//
// ⚠ 有意不镜像 AllocService.zoneOfBuilding(backend AllocService.java:142)的表兜底:引擎口径是
// 「building.zone 优先,NULL 才回退该栋首块表的 zone」,给「新建楼栋忘了填期区但已经录了表」兜底。
// 这里只认 building.zone。两者只在一种情况下会分歧:一栋已经挂表计费的楼栋,期区被手工清成
// 「(未标注)」——引擎仍按表的 zone 正常出账(账单不受影响),但本窗口会显示全园价 + 「未标注期区」
// 角标,直到期区被重新标注。即「系数簿这里看到的当前生效值」暂时对不上「即将计费的口径」,是纯展示
// 口径分歧,不是算错账。没有镜像是因为镜像需要本组件目前不取的表数据(props 没有、pools() 只覆盖
// 配了电梯/消防层份池的楼栋,不是全量表注册表)——为这个理论上少发生的编辑序列(先录表、后清期区)
// 专门加一趟 /api/meters 全量拉取,不值得。真出现这个分歧,把期区重新标注上就消失了。
const zoneOf = (r: CoefTenantRow): string | null =>
  props.buildings.find(b => b.id === r.bld.main?.id)?.zone ?? null
interface CurCell { text: string; eff: string; exception: boolean; zoneUnset?: boolean; title?: string }
const curMap = computed<Map<number, CurCell>>(() => {
  const meta = curMeta.value
  const m = new Map<number, CurCell>()
  if (meta.floorShare) {
    const fps = poolsOfFeeKey(pools.value, rules.value, meta.feeKey!)
    for (const r of filtered.value) {
      const ms = floorMemberships(fps, r.tenantId)
      if (ms.length === 0) { m.set(r.tenantId, { text: '—', eff: '', exception: false, title: `该户不在任何${meta.label.slice(0, 2)}池成员名单` }); continue }
      m.set(r.tenantId, {
        text: ms.map(x => x.weight == null ? '自动' : String(x.weight)).join(' / '),
        eff: ms.some(x => x.src === 'month') ? '月版本' : '长期',
        exception: false,
        title: ms.map(x => `${x.poolName}:${x.weight == null ? '自动(层内按面积分)' : x.weight + ' 份'}(${x.src === 'month' ? '月版本' : '长期'})`).join('\n'),
      })
    }
  } else {
    for (const r of filtered.value) {
      const z = zoneOf(r)
      const hit = resolveCoefPrice(priceRows.value, meta.writes[0].key, r.tenantId, z)
      if (!hit) { m.set(r.tenantId, { text: '—', eff: '', exception: false, title: '整链无版本(按引擎默认)' }); continue }
      // 「未标注期区」角标只在期区未标注**且真的因此落到全园价**时才点亮:resolveCoefPrice 先试户级
      // (tenant:{id}),户级命中时压根没问过 zone,z==null 与本次命中无关,点了角标就是撒谎
      // (fix-round 1 review 抓到:户级命中时角标 + 「例外」徽标同框互相矛盾)。
      const zoneCausedFallback = z == null && hit.scope === ''
      m.set(r.tenantId, {
        text: hit.valueText || String(hit.value),
        eff: hit.rangeText,
        exception: hit.exception,
        zoneUnset: zoneCausedFallback,
        title: `命中链: ${hit.chain.join(' → ')};非户级=继承默认价(灰体)`
          + (zoneCausedFallback ? ';该楼期区未标注,已跳过期级作用域按全园价命中(非本期专属价)' : ''),
      })
    }
  }
  return m
})

// ── 多选 + 表头全选(=当前筛选可见行) ──
const allChecked = computed(() =>
  filtered.value.length > 0 && filtered.value.every(r => selected.value.has(r.tenantId)))
function toggleRow(id: number) {
  if (selected.value.has(id)) selected.value.delete(id)
  else selected.value.add(id)
}
function toggleAll() {
  if (allChecked.value) selected.value.clear()
  else for (const r of filtered.value) selected.value.add(r.tenantId)
}

// ── 统一修改条(v3:唯一改值入口,表格无逐行输入框);清除模式=应用空值删该月版本回退 ──
function applyUni() {
  if (selected.value.size === 0) return
  let v: number | null = null
  if (!clearMode.value) {
    const t = uni.value.trim()
    const n = Number(t)
    if (curMeta.value.enumOptions) {
      if (!(n in curMeta.value.enumOptions)) { alert(`请选择${curMeta.value.label}`); return }
    } else if (t === '' || !isFinite(n)) { alert(`请输入数字(${curMeta.value.unit})`); return }
    v = n
  }
  for (const id of selected.value) stash.value.set(id, v)
}
function unstash(id: number) { stash.value.delete(id) }

// 切期页签/系数/生效月:有暂存先确认放弃(暂存绑定在当前系数+生效月上)
function guardDrop(): boolean {
  if (stash.value.size === 0) return true
  if (!confirm(`有 ${stash.value.size} 条未保存暂存,切换将放弃这些改动。继续?`)) return false
  stash.value.clear()
  return true
}
function setPhase(v: string) {
  if (v === phase.value || !guardDrop()) return
  phase.value = v
  selected.value.clear()
}
function setCoef(v: string) {
  if (v === coefId.value || !guardDrop()) return
  coefId.value = v
  selected.value.clear()
}
function setEffYear(v: string) {
  if (+v === effYear.value || !guardDrop()) return
  effYear.value = +v
  load()
}
function setEffMonth(v: string) {
  if (+v === effMonth.value || !guardDrop()) return
  effMonth.value = +v
  load()
}

// ── 保存:顺序提交(价目键=逐户 PUT /params 序列含配套键,注册表校验+变更日志;层份键=逐池 PUT /alloc/rules
//    整组月版本);失败中断报错并刷新已提交部分;成功 toast+重拉 ──
const saving = ref(false)
const okMsg = ref('')
// 自动消失与关闭按钮由 FPToast 内部管（LAYOUT-STABILITY-SPEC §2 优先级 2：浮层，不进文档流）
function flashOk(msg: string) { okMsg.value = msg }
async function onSave() {
  if (saving.value || stash.value.size === 0) return
  const meta = curMeta.value
  saving.value = true
  try {
    if (meta.floorShare) {
      const items = buildFloorPlan(pools.value, rules.value, meta.feeKey!, stash.value, effYm.value)
      if (items.length === 0) {
        alert(`暂存租户都不在任何${meta.label}池成员名单,无可提交项(名单增删请去 公共电核算→编辑池)`)
        stash.value.clear()
        return
      }
      const done: number[] = []
      for (const it of items) {
        try { await allocApi.updateRule(it.ruleId, it.req) }
        catch (e) {
          stash.value = floorStashAfter(items, done, stash.value)
          alert(errMsg(e, `池「${it.poolName}」保存失败`) + `;之前 ${done.length} 个池已提交生效,窗口数据已刷新`)
          await load()
          return
        }
        done.push(it.ruleId)
      }
      const n = new Set(items.flatMap(i => i.touched)).size
      stash.value.clear()
      flashOk(`已保存 ${n} 户${meta.label} · 自 ${effYm.value} 起版本组生效(整名单快照)`)
    } else {
      const items = buildPricePlan(meta, stash.value, effYm.value)
      let ok = 0
      for (const it of items) {
        try { for (const req of it.reqs) await paramsApi.put(req, effYm.value) }
        catch (e) {
          alert(errMsg(e, `「${nameOf(it.tenantId)}」保存失败`) + `;之前 ${ok} 户已提交生效,窗口数据已刷新`)
          await load()
          return
        }
        stash.value.delete(it.tenantId)
        ok++
      }
      flashOk(`已保存 ${ok} 户${meta.label} · 自 ${effYm.value} 起生效`)
    }
    selected.value.clear()
    uni.value = ''
    await load()
  } finally { saving.value = false }
}

// ── 退出编辑(有暂存先 confirm 保存/放弃)与关闭 ──
async function exitEdit() {
  if (stash.value.size > 0) {
    if (confirm(`有 ${stash.value.size} 条暂存未保存。「确定」=先保存再退出;「取消」=下一步选择放弃`)) {
      await onSave()
      if (stash.value.size > 0) return   // 保存失败/部分提交:留在编辑态处理余下
    } else if (confirm(`放弃这 ${stash.value.size} 条暂存改动?`)) {
      stash.value.clear()
    } else return
  }
  editMode.value = false
  selected.value.clear()
  auth.closeEditor(meId)        // 显式出集合:watch 是 pre flush,下一行同步就要用到结果
  void auth.endElevation()      // 退出编辑 = 结束授权(ELEVATION-SPEC)
}
function onClose() {
  if (saving.value) return
  if (stash.value.size > 0
    && !confirm(`有 ${stash.value.size} 条未保存暂存,关闭将放弃。确认关闭?`)) return
  stash.value.clear()
  emit('close')
}
</script>

<template>
  <FPDrawer :open="open" title="系数簿" icon="sliders-horizontal" :width="1080" :fixed-height="true"
            :subtitle="`批量修改租户系数 · 版本语义与计费参数页一致:自生效月起前滚,历史账期不动`"
            @close="onClose">
    <div v-if="loading" class="cb-empty">加载中…</div>
    <template v-else>
      <!-- 成功提示(5s 自消)。page 模式贴屏幕底部:弹窗 body 是 overflow:auto 滚动容器,
           absolute 贴底会跟着内容滚走;且 --z-toast(400) > --z-modal-2(320),不被弹窗遮住 -->
      <FPToast v-model="okMsg" placement="page" :duration="5000" />

      <!-- 控制行:期页签+搜索 | 系数下拉+生效月 -->
      <div class="cb-controls">
        <Segmented :options="PHASE_OPTS" :model-value="phase" size="sm" @update:model-value="setPhase" />
        <input v-model="q" class="cb-search" type="text" placeholder="搜租户名" />
        <span style="flex:1"></span>
        <span class="cb-lbl">系数</span>
        <div style="width:250px">
          <Select :options="coefOpts" :model-value="coefId" size="sm" @update:model-value="setCoef" />
        </div>
        <span class="cb-lbl">生效月</span>
        <!-- 期间选择器宽度按 LIST-PAGE-SPEC §2:年 110 / 月 92。96/84 会把「2024年」截成「202…」 -->
        <div style="width:110px">
          <Select :options="yearOpts" :model-value="String(effYear)" size="sm" @update:model-value="setEffYear" />
        </div>
        <div style="width:92px">
          <Select :options="monthOpts" :model-value="String(effMonth)" size="sm" @update:model-value="setEffMonth" />
        </div>
      </div>
      <!-- 位置常驻(LAYOUT-STABILITY-SPEC §4.2):切系数时提示有无都占一行,不许把下面的表格顶走 -->
      <div class="cb-hint"><template v-if="curMeta.hint">{{ curMeta.hint }}</template></div>

      <!-- 层份键在一期/三期页签禁用:提示条让位表格 -->
      <div v-if="floorLocked" class="cb-bar">
        <component :is="iconFor('info')" :size="14" />
        <span>层份类系数(电梯/消防)仅二期开放 —— 请切到「二期」页签查看与编辑。</span>
      </div>

      <template v-else>
        <!-- 统一修改条(v3 唯一改值入口):勾选租户→输一个值→应用到选中;清除模式=应用空值回退 -->
        <div v-if="editMode" class="cb-unibar">
          <span>已选 <b>{{ selected.size }}</b> 户</span>
          <span class="cb-sep">·</span>
          <span>统一修改为</span>
          <!-- 值控件按注册表 valueKind:枚举(损耗基数形态)→字典 Select;其余数字输入 -->
          <div v-if="curMeta.enumOptions" style="width:300px">
            <Select :options="enumOpts" :model-value="uni" size="sm" :disabled="clearMode"
                    :placeholder="clearMode ? '清除(空值)' : '请选择'" @update:model-value="uni = $event" />
          </div>
          <input v-else v-model="uni" class="cb-uni-in" :disabled="clearMode"
                 :placeholder="clearMode ? '清除(空值)' : curMeta.unit" @keydown.enter.prevent="applyUni" />
          <Button variant="outline" size="sm" :disabled="selected.size === 0" @click="applyUni">应用到选中</Button>
          <label class="cb-chk"
                 title="清除模式:应用空值=删除该生效月版本,回退上一版本/默认(层份=回按楼层自动分)">
            <input type="checkbox" v-model="clearMode" />
            清除模式
          </label>
        </div>

        <!-- 租户表:楼栋分组;列=☑|租户|楼栋|当前生效值·生效自(例外徽标)|暂存新值(只读+撤销,无逐行输入框) -->
        <div class="cb-wrap">
          <table class="cb-table">
            <colgroup>
              <col v-if="editMode" style="width:36px" />
              <col /><!-- 租户:唯一弹性列 -->
              <col style="width:150px" />
              <col :style="{ width: curMeta.enumOptions ? '320px' : '230px' }" /><!-- 枚举字典文字长 -->
              <col v-if="editMode" :style="{ width: curMeta.enumOptions ? '260px' : '170px' }" />
            </colgroup>
            <thead>
              <tr>
                <th v-if="editMode" class="ct">
                  <input type="checkbox" :checked="allChecked" title="全选=当前筛选可见行" @change="toggleAll" />
                </th>
                <th class="l">租户</th>
                <th class="l">楼栋</th>
                <th title="版本链解析(与派生引擎同口径);「例外」=户级行命中,灰体=继承分区/全园默认">当前生效值 · 生效自</th>
                <th v-if="editMode" :title="`暂存新值(自 ${effYm} 起生效);×=单行撤销`">暂存新值</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="g in groups" :key="g.id ?? 'none'">
                <tr class="cb-band">
                  <td class="l" :colspan="editMode ? 5 : 3">
                    <span class="cb-band-lbl">{{ g.name }}</span><span class="cb-band-sub">{{ g.count }} 户</span>
                  </td>
                </tr>
                <tr v-for="r in g.rows" :key="r.tenantId"
                    :class="{ sel: selected.has(r.tenantId) }"
                    @click="editMode && toggleRow(r.tenantId)">
                  <td v-if="editMode" class="ct">
                    <input type="checkbox" :checked="selected.has(r.tenantId)" @click.stop @change="toggleRow(r.tenantId)" />
                  </td>
                  <td class="l"><span class="cb-tname" :title="r.tenantName">{{ r.tenantName }}</span></td>
                  <td class="l">
                    <span class="cb-txt dim"
                          :title="r.bld.all.length > 1 ? r.bld.all.map(b => b.name).join('、') : undefined">
                      {{ r.bld.main?.name ?? '–' }}<em v-if="r.bld.all.length > 1" class="cb-xb">+{{ r.bld.all.length - 1 }}栋</em>
                    </span>
                  </td>
                  <td>
                    <span class="cb-val" :class="{ dim: !curMap.get(r.tenantId)?.exception && !curMeta.floorShare }"
                          :title="curMap.get(r.tenantId)?.title">
                      {{ curMap.get(r.tenantId)?.text ?? '—' }}
                      <em v-if="curMap.get(r.tenantId)?.eff" class="cb-eff">{{ curMap.get(r.tenantId)?.eff }}</em>
                      <em v-if="curMap.get(r.tenantId)?.exception" class="cb-ex">例外</em>
                      <em v-if="curMap.get(r.tenantId)?.zoneUnset" class="cb-zwarn"
                          title="该楼期区未标注,以上是全园价,不是本期专属价">未标注期区</em>
                    </span>
                  </td>
                  <td v-if="editMode">
                    <span v-if="stash.has(r.tenantId)" class="cb-stash">
                      <b :class="{ del: stash.get(r.tenantId) == null }">
                        {{ stash.get(r.tenantId) == null ? '清除(回退)' : curMeta.enumOptions ? enumText(stash.get(r.tenantId)!) : stash.get(r.tenantId) }}
                      </b>
                      <button class="cb-undo" title="撤销该行暂存" @click.stop="unstash(r.tenantId)">
                        <component :is="iconFor('x')" :size="12" />
                      </button>
                    </span>
                    <span v-else class="cb-txt dim ct-r">–</span>
                  </td>
                </tr>
              </template>
              <tr v-if="filtered.length === 0">
                <td class="cb-noro" :colspan="editMode ? 5 : 3">本期无匹配租户 —— 换期页签或搜索条件试试</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </template>

    <template #footer>
      <template v-if="editMode">
        <Button variant="gray" size="sm" :disabled="saving" @click="exitEdit">退出编辑</Button>
        <Button variant="filled" size="sm" :disabled="stash.size === 0 || saving" @click="onSave">
          <template #leading><component :is="iconFor('check')" :size="14" /></template>
          {{ saving ? '保存中…' : `保存(${stash.size})` }}
        </Button>
      </template>
      <!-- 编辑态走上面的 [退出编辑][保存]，这里只负责浏览态那三态。
           作用域取**生效月** effYm，与计费参数/公共电核算/催缴单共占同一把 billing-chain 月锁。 -->
      <FPEditModeButton v-else-if="!floorLocked && !loading" :edit="false"
                        :held-by-other="heldByOther" :can-enter="canAsk" @toggle="onEditBtn" />
      <Button variant="outline" size="sm" @click="onClose">关闭</Button>
    </template>
    <FPElevateDialog
      :page="`系数簿 · 自 ${effYm} 起生效`" :action="'修改系数簿(计费口径)'" :perms="asking" what="修改系数簿(计费口径)"
                     @close="asking = null" @elevated="asking = null; void onEditBtn()" />
    <FPTakeoverDrawer :holder="lockedBy" :scope="S.coefBook(effYear, effMonth)"
                      :what="`系数簿 · 自 ${effYm} 起生效`"
                      @close="lockedBy = null" @taken="onTaken" />
    <FPEvictedDialog :eviction="evictedBy" :what="`系数簿 · 自 ${effYm} 起生效`"
                     :dirty-count="stash.size" :copy-text="stashAsTsv"
                     @close="evictedBy = null" />
  </FPDrawer>
</template>

<style scoped>
.cb-empty { padding: 40px 12px; text-align: center; color: var(--text-disabled); font-size: var(--fs-label); }

/* 提示/成功条(bn-bar 家族) */
.cb-bar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--fs-label); color: var(--text-secondary); }

/* 控制行 */
.cb-controls { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.cb-lbl { font-size: 12px; color: var(--text-muted); }
.cb-search { width: 180px; height: 32px; padding: 0 12px; box-sizing: border-box; border: 1px solid var(--border-subtle); border-radius: var(--radius-full); font-size: 12.5px; background: var(--surface-white); color: var(--text-primary); }
.cb-search:focus { outline: none; border-color: var(--hue-blue); }
.cb-hint { flex: 0 0 auto; margin-top: -14px; min-height: 16px; line-height: 16px; font-size: 11.5px; color: var(--text-muted); }

/* 统一修改条(v3 唯一改值入口) */
.cb-unibar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; padding: 8px 12px; border: 1px solid var(--border-subtle); border-radius: var(--radius-md); background: var(--surface-card); font-size: 12.5px; color: var(--text-secondary); flex-wrap: wrap; }
.cb-unibar b { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.cb-sep { color: var(--text-disabled); }
.cb-uni-in { width: 120px; height: 30px; padding: 0 10px; box-sizing: border-box; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 12.5px; background: var(--surface-white); color: var(--text-primary); }
.cb-uni-in:focus { outline: none; border-color: var(--hue-blue); }
.cb-uni-in:disabled { background: var(--surface-sunken); color: var(--text-disabled); }
.cb-uni-in::placeholder { color: var(--text-disabled); font-family: var(--font-sans); }
.cb-chk { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-secondary); cursor: help; }
.cb-chk input { accent-color: var(--hue-blue); cursor: pointer; }

/* 表(bn-table 手法:sticky 表头/34px 行;fixedHeight 抽屉内 wrap 自滚) */
.cb-wrap { flex: 1 1 auto; min-height: 0; overflow: auto; border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); background: var(--surface-white); }
.cb-table { border-collapse: separate; border-spacing: 0; width: 100%; table-layout: fixed; font-family: var(--font-sans); }
.cb-table th, .cb-table td { border-bottom: 1px solid var(--divider); box-sizing: border-box; padding: 0 8px; overflow: hidden; }
.cb-table thead th { position: sticky; top: 0; height: 34px; background: var(--surface-card); color: var(--text-muted); font-size: 11.5px; font-weight: var(--fw-semibold); text-align: right; z-index: 4; white-space: nowrap; }
.cb-table thead th.l, .cb-table td.l { text-align: left; }
.cb-table th.ct, .cb-table td.ct { text-align: center; }
.cb-table tbody td { height: 34px; background: var(--surface-white); vertical-align: middle; text-align: right; }
.cb-table tbody tr:hover td { background: var(--surface-card); }
.cb-table tbody tr.sel td { background: rgba(10, 132, 255, 0.06); }
.cb-table input[type='checkbox'] { accent-color: var(--hue-blue); cursor: pointer; }
.cb-table tr.cb-band td { height: 34px; background: var(--surface-sunken); border-top: 1px solid var(--border-strong); }
.cb-band-lbl { font-size: 12px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.cb-band-sub { margin-left: 8px; font-size: 11.5px; color: var(--text-muted); }
.cb-noro { text-align: center !important; padding: 40px 16px !important; color: var(--text-disabled); font-size: var(--fs-label); }
.cb-tname { display: block; font-size: 12.5px; font-weight: var(--fw-semibold); color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cb-txt { display: block; text-align: left; font-size: 12px; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cb-txt.dim { color: var(--text-muted); }
.cb-txt.ct-r { text-align: right; color: var(--text-disabled); }
.cb-xb { margin-left: 6px; padding: 1px 5px; border-radius: var(--radius-full); background: var(--surface-sunken); font-style: normal; font-size: 10.5px; color: var(--text-muted); cursor: help; }

/* 当前生效值:值 + 生效自 + 例外徽标;继承默认灰体 */
.cb-val { display: block; text-align: right; font-size: 12px; color: var(--text-primary); font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: help; }
.cb-val.dim { color: var(--text-muted); }
.cb-eff { font-style: normal; font-size: 10.5px; color: var(--text-muted); margin-left: 4px; font-family: var(--font-sans); }
.cb-ex { margin-left: 5px; padding: 1px 5px; border-radius: var(--radius-full); background: rgba(255, 149, 0, 0.14); font-style: normal; font-size: 10.5px; color: rgb(178, 100, 0); font-family: var(--font-sans); }
.cb-zwarn { margin-left: 5px; padding: 1px 5px; border-radius: var(--radius-full); background: rgba(120, 120, 120, 0.14); font-style: normal; font-size: 10.5px; color: var(--text-muted); font-family: var(--font-sans); }

/* 暂存新值(只读)+单行撤销 */
.cb-stash { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; }
.cb-stash b { font-size: 12px; color: var(--hue-blue); font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cb-stash b.del { color: var(--hue-red); font-family: var(--font-sans); font-weight: var(--fw-medium); }
.cb-undo { flex: 0 0 auto; display: inline-grid; place-items: center; width: 18px; height: 18px; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); cursor: pointer; padding: 0; }
.cb-undo:hover { background: var(--surface-sunken); color: var(--hue-red); }
</style>
