<script setup lang="ts">
// no-review: 母册系数簿已有同型守卫 assertMonthEditable(P6 录入即冻结),不重复挂审核闸;
//            后端同款豁免见 BookService 上的 @NoReviewGuard。
// 系数簿窗口(S14-COEF-BOOK-SPEC §3 v3 定稿):催缴单页入口的批量系数编辑器——居中窗口卡片
// (编辑池弹窗同款 FPDrawer 容器)。交互=选租户→选系数→统一修改条改→保存:
// 期页签+搜索/系数下拉(一次一个)/生效月(默认=催缴单页 ym,版本自该月起前滚)/多选+表头全选
// (=当前筛选可见行)/统一修改条唯一改值入口(表格无逐行输入框)/暂存-提交模型(保存一次性顺序提交,
// 失败中断报错并刷新已提交部分)。层份键仅二期页签开放;viewer 只读查看(编辑模式按钮走 canEdit)。
// S21:价目键源=计费参数注册表(coefBookLogic.COEF_KEYS),读 GET /params?ym&key= 写 PUT /params;值控件按 valueKind(enum→Select)。
import { computed, ref, watch, onUnmounted } from 'vue'
import { textW } from '@/composables/useWideTable'
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
import { useScreen } from '@/composables/useTabShells'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import DatePicker from '@/components/ds/DatePicker.vue'
import Segmented from '@/components/ds/Segmented.vue'
import FPDrawer from '@/components/fp/FPDrawer.vue'
import FPElevateDialog from '@/components/fp/FPElevateDialog.vue'
import FPTakeoverDrawer from '@/components/fp/FPTakeoverDrawer.vue'
import FPEvictedDialog from '@/components/fp/FPEvictedDialog.vue'
import { useEditLock } from '@/composables/useEditLock'
import { S } from '@/utils/lockScopes'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import FPEmpty from '@/components/fp/FPEmpty.vue'
import FPElevChip from '@/components/fp/FPElevChip.vue'
import { ask, askLeave } from '@/utils/ask'
import { receipt } from '@/utils/receipt'

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
// 改动数 = 暂存条数(EDIT-MODE-SPEC §6.1):关页签 / 关浏览器按它问,0 条不拦。锁与 openEditor 递同一个函数,auth 按函数去重
const dirtyN = () => stash.value.size
const lock = useEditLock(() => { editMode.value = false }, () => canEdit.value, dirtyN)
const { lockedBy, evictedBy } = lock
/** 这一期(按生效月)此刻被谁占着 —— 取自在场表，不用点按钮撞门。 */
const heldByOther = lock.watchScope(() => S.coefBook(effYear.value, effMonth.value))
watch(editMode, (on) => { if (!on) lock.release() })

async function onEditBtn() {
  if (loadErr.value) return   // 没读到就不进编辑(授权窗批下来走的也是这里)
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
const screen = useScreen()
watch(editMode, (on) => { if (on) auth.openEditor(meId, screen, dirtyN, ['param-policy:edit']); else auth.closeEditor(meId) })
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
const uniErr = ref('')
watch([uni, coefId, clearMode], () => { uniErr.value = '' })

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
// 生效月可选范围 = 改前年下拉的年份区间(buildYearOptions,连续)的首年 1 月 … 末年 12 月
const effYears = computed(() => buildYearOptions(props.years, today))
const effMin = computed(() => `${effYears.value[0]}-01`)
const effMax = computed(() => `${effYears.value[effYears.value.length - 1]}-12`)

// ── 数据:价目键站在生效月的生效行(后端已级联解析) + 当月池快照(层份成员) + p2 规则(池费项在 rule 上);竞态守卫 ──
const PRICE_KEY_PARAM = COEF_KEYS.filter(k => !k.floorShare).map(k => k.id).join(',')
const loading = ref(false)
const priceRows = ref<ParamRowDTO[]>([])
const pools = ref<AllocPoolRowDTO[]>([])
const rules = ref<AllocRuleDTO[]>([])
const loadErr = ref('')
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
    loadErr.value = ''
  } catch (e) {
    if (my !== seq) return
    loadErr.value = errMsg(e, '系数簿数据加载失败')
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
  load()
})

// ── 行构建:期归属/主楼栋与催缴单列表同源;组=楼栋(空组不出现) ──
const rowsAll = computed(() => buildCoefRows(props.contracts, props.buildings))
const filtered = computed(() => rowsAll.value.filter(r =>
  r.phase === +phase.value
  && (q.value.trim() === '' || r.tenantName.includes(q.value.trim()))))
const groups = computed(() => groupByBuilding(filtered.value, r => r.bld.main))
// 租户列(列宽铁律,2026-10-02):按全部户名定宽(12.5px 粗体 + 内边距 16),余宽落进行末空列,不再是唯一弹性列。
// 按 rowsAll 算:换期页签、搜索列不挪位。
const tenantW = computed(() => Math.max(textW(['租户'], 11.5, 16), ...rowsAll.value.map(r => textW([r.tenantName], 12.5, 16))))
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
      if (!(n in curMeta.value.enumOptions)) { uniErr.value = `请选择${curMeta.value.label}`; return }
    } else if (t === '' || !isFinite(n)) { uniErr.value = `请输入数字(${curMeta.value.unit})`; return }
    v = n
  }
  uniErr.value = ''
  for (const id of selected.value) stash.value.set(id, v)
}
function unstash(id: number) { stash.value.delete(id) }

// 切期页签/系数/生效月:有暂存先确认放弃(暂存绑定在当前系数+生效月上)
async function guardDrop(to: string): Promise<boolean> {
  const n = stash.value.size
  if (n === 0) return true
  if (!(await ask({
    title: `切换到「${to}」？`, body: `这页有 ${n} 处改动还没保存。`,
    action: '放弃改动并切换', cancel: '继续编辑', danger: true,
  }))) return false
  stash.value.clear()
  return true
}
async function setPhase(v: string) {
  if (v === phase.value || !(await guardDrop(PHASE_OPTS.find(o => o.value === v)?.label ?? v))) return
  phase.value = v
  selected.value.clear()
}
async function setCoef(v: string) {
  if (v === coefId.value || !(await guardDrop(coefMeta(v).label))) return
  coefId.value = v
  selected.value.clear()
}
// 年月合成一个月份字段(改前年下拉、月下拉各走一遍同样的 guardDrop + load)
async function setEffYm(v: string) {
  if (v === effYm.value || !(await guardDrop(v))) return
  effYear.value = +v.slice(0, 4)
  effMonth.value = +v.slice(5, 7)
  load()
}

// ── 保存:顺序提交(价目键=逐户 PUT /params 序列含配套键,注册表校验+变更日志;层份键=逐池 PUT /alloc/rules
//    整组月版本);失败中断报错并刷新已提交部分;成功回执+重拉 ──
const saving = ref(false)
async function onSave() {
  // 自守:失败回执上的「重试」点下去时可能已退出编辑 / 换了月且没读到
  if (saving.value || stash.value.size === 0 || !editMode.value || loadErr.value) return
  const meta = curMeta.value
  saving.value = true
  try {
    if (meta.floorShare) {
      const items = buildFloorPlan(pools.value, rules.value, meta.feeKey!, stash.value, effYm.value)
      if (items.length === 0) {
        receipt.warn(`暂存租户都不在任何${meta.label}池成员名单,无可提交项(名单增删请去 公共电核算→编辑池)`)
        stash.value.clear()
        return
      }
      const done: number[] = []
      for (const it of items) {
        try { await allocApi.updateRule(it.ruleId, it.req) }
        catch (e) {
          stash.value = floorStashAfter(items, done, stash.value)
          receipt.fail(errMsg(e, `池「${it.poolName}」保存失败`) + `;之前 ${done.length} 个池已提交生效,窗口数据已刷新`,
            { label: '重试', run: () => void onSave() })
          await load()
          return
        }
        done.push(it.ruleId)
      }
      const n = new Set(items.flatMap(i => i.touched)).size
      stash.value.clear()
      receipt.ok(`已保存 ${n} 户${meta.label} · 自 ${effYm.value} 起版本组生效(整名单快照)`)
    } else {
      const items = buildPricePlan(meta, stash.value, effYm.value)
      let ok = 0
      for (const it of items) {
        try { for (const req of it.reqs) await paramsApi.put(req, effYm.value) }
        catch (e) {
          receipt.fail(errMsg(e, `「${nameOf(it.tenantId)}」保存失败`) + `;之前 ${ok} 户已提交生效,窗口数据已刷新`,
            { label: '重试', run: () => void onSave() })
          await load()
          return
        }
        stash.value.delete(it.tenantId)
        ok++
      }
      receipt.ok(`已保存 ${ok} 户${meta.label} · 自 ${effYm.value} 起生效`)
    }
    selected.value.clear()
    uni.value = ''
    await load()
  } finally { saving.value = false }
}

// ── 退出编辑(有暂存先问存不存;不存再问放弃)与关闭 ──
async function exitEdit() {
  const n = stash.value.size
  if (n > 0) {
    if (await ask({ title: `退出编辑前保存 ${n} 条暂存？`, action: `保存 ${n} 条并退出`, cancel: '不保存' })) {
      await onSave()
      if (stash.value.size > 0) return   // 保存失败/部分提交:留在编辑态处理余下
    } else if (await askLeave({ page: '系数簿', count: n, verb: '退出编辑' })) {
      stash.value.clear()
    } else return
  }
  editMode.value = false
  selected.value.clear()
  auth.closeEditor(meId)        // 显式出集合:watch 是 pre flush,下一行同步就要用到结果
  void auth.endElevation()      // 退出编辑 = 结束授权(ELEVATION-SPEC)
}
async function onClose() {
  if (saving.value) return
  if (!(await askLeave({ page: '系数簿', count: stash.value.size }))) return
  stash.value.clear()
  emit('close')
}
</script>

<template>
  <FPDrawer :open="open" title="系数簿" icon="sliders-horizontal" :width="1080" :fixed-height="true"
            :subtitle="`批量修改租户系数 · 版本语义与计费参数页一致:自生效月起前滚,历史账期不动`"
            @close="onClose">
    <!-- 遮罩盖住了顶栏:临时授权的胶囊挂一枚在弹窗头(画布 08 ElevStates) -->
    <template #badge><FPElevChip variant="dialog" /></template>
    <!-- 已失败时不换成「加载中…」:重试在途失败件留在原地,到数才退场 -->
    <div v-if="loading && !loadErr" class="cb-empty">加载中…</div>
    <template v-else>
      <!-- 工具条一行两态,不另起一行、表格不往下挪(横条盘点 2026-10-03):
           浏览态 = 期页签+搜索 | 系数下拉+生效月;编辑态右半换成统一修改条(v3 唯一改值入口),期页签+搜索留着挑户。
           编辑中系数和生效月不换 —— 暂存绑在它们上面,编辑锁的键就是生效月;写在下面那行说明里,要换先退出编辑。
           输错的红字压在说明那一行的位置上(absolute),也不多占一行。 -->
      <div v-if="editMode" class="cb-controls cb-unibar">
        <Segmented :options="PHASE_OPTS" :model-value="phase" size="sm" @update:model-value="setPhase" />
        <input v-model="q" class="cb-search" type="text" placeholder="搜租户名" />
        <span style="flex:1"></span>
        <span>已选 <b>{{ selected.size }}</b> 户</span>
        <span class="cb-sep">·</span>
        <span>统一修改为</span>
        <!-- 值控件按注册表 valueKind:枚举(损耗基数形态)→字典 Select;其余数字输入 -->
        <div v-if="curMeta.enumOptions" style="width:240px">
          <Select :options="enumOpts" :model-value="uni" size="sm" :disabled="clearMode"
                  :placeholder="clearMode ? '清除(空值)' : '请选择'" @update:model-value="uni = $event" />
        </div>
        <input v-else v-model="uni" class="cb-uni-in" :disabled="clearMode"
               :placeholder="clearMode ? '清除(空值)' : curMeta.unit" @keydown.enter.prevent="applyUni" />
        <Button variant="outline" size="sm" :disabled="selected.size === 0" @click="applyUni">应用到选中</Button>
        <label v-tip="'清除模式:应用空值=删除该生效月版本,回退上一版本/默认(层份=回按楼层自动分)'" class="cb-chk">
          <input type="checkbox" v-model="clearMode" />
          清除模式
        </label>
        <p class="fp-field-err cb-uni-err"><template v-if="uniErr">{{ uniErr }}</template></p>
      </div>
      <div v-else class="cb-controls">
        <Segmented :options="PHASE_OPTS" :model-value="phase" size="sm" @update:model-value="setPhase" />
        <input v-model="q" class="cb-search" type="text" placeholder="搜租户名" />
        <span style="flex:1"></span>
        <span class="cb-lbl">系数</span>
        <div style="width:250px">
          <Select :options="coefOpts" :model-value="coefId" size="sm" @update:model-value="setCoef" />
        </div>
        <span class="cb-lbl">生效月</span>
        <!-- 年下拉 + 月下拉 → 一个月份字段 120 宽(DATE-PICKER-SPEC §5 第 6 节) -->
        <div style="width:120px">
          <DatePicker mode="month" size="sm" align="end" :model-value="effYm" :min="effMin" :max="effMax"
                      aria-label="生效月" @update:model-value="setEffYm" />
        </div>
      </div>
      <!-- 位置常驻(LAYOUT-STABILITY-SPEC §4.2):切系数时提示有无都占一行,不许把下面的表格顶走 -->
      <div class="cb-hint">
        <template v-if="editMode && !uniErr">改的是「{{ curMeta.label }}」· 自 {{ effYm }} 起生效<template v-if="curMeta.hint"> · {{ curMeta.hint }}</template></template>
        <template v-else-if="!editMode && curMeta.hint">{{ curMeta.hint }}</template>
      </div>

      <!-- 加载失败换掉表格(不再弹窗关窗):期页签 / 系数 / 生效月照常可切,重试接上 load -->
      <FPLoadError v-if="loadErr" :sub="loadErr" @retry="load">{{ effYear }} 年 {{ effMonth }} 月的系数没读到</FPLoadError>
      <!-- 层份键在一期/三期页签禁用:空状态换掉表格 -->
      <FPEmpty v-else-if="floorLocked" sub="请切到「二期」页签查看与编辑。">层份类系数(电梯 / 消防)只在二期开放</FPEmpty>

      <template v-else>
        <!-- 租户表:楼栋分组;列=☑|租户|楼栋|当前生效值·生效自(例外徽标)|暂存新值(只读+撤销,无逐行输入框) -->
        <div class="cb-wrap">
          <table class="cb-table">
            <colgroup>
              <col v-if="editMode" style="width:36px" />
              <col :style="{ width: tenantW + 'px' }" /><!-- 租户:按内容定宽 -->
              <col style="width:150px" />
              <col :style="{ width: curMeta.enumOptions ? '320px' : '230px' }" /><!-- 枚举字典文字长 -->
              <col v-if="editMode" :style="{ width: curMeta.enumOptions ? '260px' : '170px' }" />
              <col /><!-- 行末空列 .fp-fill:余宽落这里 -->
            </colgroup>
            <thead>
              <tr>
                <th v-if="editMode" class="ct">
                  <input v-tip="'全选=当前筛选可见行'" type="checkbox" :checked="allChecked" @change="toggleAll" />
                </th>
                <th class="l">租户</th>
                <th class="l">楼栋</th>
                <th v-tip="'版本链解析(与派生引擎同口径);「例外」=户级行命中,灰体=继承分区/全园默认'">当前生效值 · 生效自</th>
                <th v-if="editMode" v-tip="`暂存新值(自 ${effYm} 起生效);×=单行撤销`">暂存新值</th>
                <th class="fp-fill" aria-hidden="true"></th>
              </tr>
            </thead>
            <tbody>
              <template v-for="g in groups" :key="g.id ?? 'none'">
                <tr class="cb-band">
                  <td class="l" :colspan="editMode ? 5 : 3">
                    <span class="cb-band-lbl">{{ g.name }}</span><span class="cb-band-sub">{{ g.count }} 户</span>
                  </td>
                  <td class="fp-fill" aria-hidden="true"></td>
                </tr>
                <tr v-for="r in g.rows" :key="r.tenantId"
                    :class="{ sel: selected.has(r.tenantId) }"
                    @click="editMode && toggleRow(r.tenantId)">
                  <td v-if="editMode" class="ct">
                    <input type="checkbox" :checked="selected.has(r.tenantId)" @click.stop @change="toggleRow(r.tenantId)" />
                  </td>
                  <td class="l"><span v-tip="r.tenantName" class="cb-tname">{{ r.tenantName }}</span></td>
                  <td class="l">
                    <span v-tip="r.bld.all.length > 1 ? r.bld.all.map(b => b.name).join('、') : undefined"
                          class="cb-txt dim">
                      {{ r.bld.main?.name ?? '–' }}<em v-if="r.bld.all.length > 1" class="cb-xb">+{{ r.bld.all.length - 1 }}栋</em>
                    </span>
                  </td>
                  <td>
                    <span v-tip="curMap.get(r.tenantId)?.title" class="cb-val"
                          :class="{ dim: !curMap.get(r.tenantId)?.exception && !curMeta.floorShare }">
                      {{ curMap.get(r.tenantId)?.text ?? '—' }}
                      <em v-if="curMap.get(r.tenantId)?.eff" class="cb-eff">{{ curMap.get(r.tenantId)?.eff }}</em>
                      <em v-if="curMap.get(r.tenantId)?.exception" class="cb-ex">例外</em>
                      <em v-if="curMap.get(r.tenantId)?.zoneUnset" v-tip="'该楼期区未标注,以上是全园价,不是本期专属价'"
                          class="cb-zwarn">未标注期区</em>
                    </span>
                  </td>
                  <td v-if="editMode">
                    <span v-if="stash.has(r.tenantId)" class="cb-stash">
                      <b :class="{ del: stash.get(r.tenantId) == null }">
                        {{ stash.get(r.tenantId) == null ? '清除(回退)' : curMeta.enumOptions ? enumText(stash.get(r.tenantId)!) : stash.get(r.tenantId) }}
                      </b>
                      <button v-tip="'撤销该行暂存'" class="cb-undo" @click.stop="unstash(r.tenantId)">
                        <component :is="iconFor('x')" :size="12" />
                      </button>
                    </span>
                    <span v-else class="cb-txt dim ct-r">–</span>
                  </td>
                  <td class="fp-fill" aria-hidden="true"></td>
                </tr>
              </template>
              <tr v-if="filtered.length === 0">
                <td class="cb-noro" :colspan="editMode ? 6 : 4">本期无匹配租户 —— 换期页签或搜索条件试试</td>
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
      <FPEditModeButton v-else-if="!floorLocked && !loading" :edit="false" :disabled="!!loadErr"
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

/* 工具条:浏览 / 编辑两态同一行同高 */
.cb-controls { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-height: 32px; }
.cb-lbl { font-size: 12px; color: var(--text-muted); }
.cb-search { width: 180px; height: 32px; padding: 0 12px; box-sizing: border-box; border: 1px solid var(--border-control); border-radius: var(--radius-full); font-size: 12.5px; background: var(--surface-white); color: var(--text-primary); }
.cb-search:focus { outline: none; border-color: var(--hue-blue); }
.cb-hint { flex: 0 0 auto; margin-top: -14px; min-height: 16px; line-height: 16px; font-size: 11.5px; color: var(--text-muted); }

/* 统一修改条(编辑态的工具条):右半换成批量改值;红字压在下面说明行的位置(说明行 margin-top:-14 → 工具条下沿 +8) */
.cb-unibar { position: relative; font-size: 12.5px; color: var(--text-secondary); }
.cb-unibar b { color: var(--text-primary); font-variant-numeric: tabular-nums; }
.cb-sep { color: var(--text-disabled); }
.cb-uni-err { position: absolute; left: 0; top: calc(100% + 8px); margin: 0; line-height: 16px; }
.cb-uni-in { width: 120px; height: 30px; padding: 0 10px; box-sizing: border-box; border: 1px solid var(--border-control); border-radius: var(--radius-sm); text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: 12.5px; background: var(--surface-white); color: var(--text-primary); }
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
.cb-ex { margin-left: 5px; padding: 1px 5px; border-radius: var(--radius-full); background: rgba(255, 149, 0, 0.14); font-style: normal; font-size: 10.5px; color: var(--orange-text); font-family: var(--font-sans); }
.cb-zwarn { margin-left: 5px; padding: 1px 5px; border-radius: var(--radius-full); background: rgba(120, 120, 120, 0.14); font-style: normal; font-size: 10.5px; color: var(--text-muted); font-family: var(--font-sans); }

/* 暂存新值(只读)+单行撤销 */
.cb-stash { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; }
.cb-stash b { font-size: 12px; color: var(--hue-blue); font-family: var(--font-mono); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cb-stash b.del { color: var(--hue-red); font-family: var(--font-sans); font-weight: var(--fw-medium); }
.cb-undo { flex: 0 0 auto; display: inline-grid; place-items: center; width: 18px; height: 18px; border: none; border-radius: var(--radius-sm); background: transparent; color: var(--text-muted); cursor: pointer; padding: 0; }
.cb-undo:hover { background: var(--surface-sunken); color: var(--hue-red); }
</style>
