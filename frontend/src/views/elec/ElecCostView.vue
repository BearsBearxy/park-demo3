<script setup lang="ts">
// 电费成本总览(ELEC-COST-SPEC §4 列表形态)— 与附表11 月度电费并列的新屏,由 ElecView 功能门进入。
// 两张列表卡(数据层「一切皆列表」惯例,LIST-PAGE-SPEC 定宽列律/行高等高;本屏行数=电表×费项 固定量级,不分页):
//   ① 费项清单:电表分组行(表名+类型徽标+该表小计,底色区分) → 费项行(缩进一级) → 楼栋拆分子行(缩进两级,chevron 展开);
//      列=项目|金额|电量|来源|备注;拆分口径不变(有拆分行合计=Σ拆分读时派生,与合计行并存黄警)。
//   ② 派生指标:一行一指标,列=指标|本月值|公式|缺失数据源(缺源行置灰,值列「—」)。
// 编辑模式(EDIT-MODE-SPEC v2):浏览态=完全只读,一切纯文本(DOM 无输入框);金额/备注行内输入、
// 电表增删改、电价参数小节、导入、模拟填充全部收编辑态。viewer 永远浏览态。年月选择 years 数据驱动(同 PvMeterView)。
import { ref, computed, onMounted, onDeactivated, watch } from 'vue'
import { onReactivated } from '@/composables/onReactivated'
import { useDeepPeriod } from '@/composables/useDeepPeriod'
import FPEditModeButton from '@/components/fp/FPEditModeButton.vue'
import FPReviewActions from '@/components/fp/FPReviewActions.vue'
import {
  elecCostApi,
  type ElecMeterDTO, type ElecMeterKind, type ElecCostEntryDTO, type ElecPriceCfgDTO, type ElecMetricDTO,
} from '@/api/elecCost'
import type { ImportResultDTO } from '@/types/import'
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { useAuthStore } from '@/stores/auth'
import FPElevateDialog from '@/components/fp/FPElevateDialog.vue'
import FPLockDialogs from '@/components/fp/FPLockDialogs.vue'
import { S } from '@/utils/lockScopes'
import { useEditMode } from '@/composables/useEditMode'
import { useReviewStore } from '@/stores/review'
import { useMonthGate } from '@/composables/useMonthGate'
import FPMonthGate from '@/components/fp/FPMonthGate.vue'
import FPLoadBar from '@/components/fp/FPLoadBar.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import { useDeferredFlag } from '@/composables/useDeferredFlag'
import { usePresenceStore } from '@/stores/presence'
import { iconFor } from '@/components/ds/icon'
import Button from '@/components/ds/Button.vue'
import Card from '@/components/ds/Card.vue'
import Select from '@/components/ds/Select.vue'
import Input from '@/components/ds/Input.vue'
import FpImportModal from '@/components/import/FpImportModal.vue'
import ImportResultToast from '@/components/import/ImportResultToast.vue'
import { parserProps, runImport, type ImportCtx } from '@/utils/importRegistry'
import { ELEC_FEE_LABEL, ELEC_SUB_LABEL, elecFeeLabel } from '@/utils/elecCostExcel'

const auth = useAuthStore()
// RBAC:费项/表名录入是 entry;电价参数是计费口径,归 param-policy(simulate 会写 price-cfg,同门)
const canEntry = computed(() => auth.can('entry:edit'))
const canPrice = computed(() => auth.can('param-policy:edit'))

// ── 编辑模式(EDIT-MODE-SPEC v2):不跨会话,组件 ref;KeepAlive 切页签回来也回浏览态(安全默认) ──
// 编辑模式 + 提权入口(EDIT-MODE-SPEC v3 / ELEVATION-SPEC):无权限的账号也看得到按钮,
// 点了弹主管授权窗;切页签不再回浏览态(只关浮层)。
/**
 * 弹卡标题写的是**审核键那张表**的人话名「园区电费模型」(后端 ReviewKind),
 * 不是屏名「电费成本总览」—— 交审后所有报错、清单行、审计日志都用前者,
 * 这里换成屏名,人拿着弹卡上的名字在待审清单里一个都搜不到。
 */
const reviewLabel = computed(() => `园区电费模型 · ${acctMonth.value}`)
const { editMode, canEnter, asking, toggle: toggleEdit, cancelAsk, onElevated, heldByOther,
        lockedBy, evictedBy, lockScope, onTaken, reviewNote, reviewTip, reviewKeys } =
  useEditMode(['entry:edit', 'param-policy:edit'], {
    scope: () => S.elecCost(year.value, month.value),
    // 审核键(§7.1):**elec-model**,不是 elec-cost —— 后者是附表11 的报送台账(ElecView/elec_record)。
    // 两把键 2026-09-07 用户拍板拆开;这一把没有清单行,也不进整月锁账的集合。
    reviewKey: () => (year.value && month.value
      ? `elec-model:${year.value}-${String(month.value).padStart(2, '0')}` : null),
  })
// 编辑态 × 分区权限:费项录入走 editE,电价参数走 editC
// ⚠ 两扇门都要 `&& !loadErr`(照 PvMeterView 三轮复查后的形状):本月费项没加载成功时
//   表里逐格是「—」的假底数,放行录入 = 对着假底数写真数据。
const editE = computed(() => editMode.value && !loadErr.value && canEntry.value)
const editC = computed(() => editMode.value && !loadErr.value && canPrice.value)
onDeactivated(() => { meterDlg.value = false; importing.value = false })
// 编辑态**就地**转假(被接管 / 30 分钟提权到期)也要关写弹窗 —— 它们的 v-if 只判自己的 ref
watch(editMode, v => {
  if (v) return
  meterDlg.value = false
  importing.value = false
})

const pad2 = (n: number) => String(n).padStart(2, '0')
const fq = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 })
const fy = (n: number) => '¥' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// ── 期间:选期矩阵门(2026-08-29「两本账」设计稿 §③,同 PvMeterView/CpMeterView) ──
// 顶栏那对年月 Select 已撤 —— 改前系统按 latestPeriodOf 自己 snap 到最后一个有费项行的月,
// 用户从没被问过要看哪个月(§7-1 禁止的「顺手落进某个期」)。
// 期存 store 不存屏内 ref:侧栏点击走 openFresh 会重建组件,屏内 ref 每次被清掉。
// ⚠ null = **还没回来**;[] = 回来了、就是没有。
//   这两件事必须分开:后端三个 /months 端点在空表时正常返回 [](不抛错),
//   若用 `!dataMonths.length` 当加载中,零数据时门永久转圈、矩阵一次都不渲染,
//   而它是进这本账的唯一入口 —— 那本账从此不可达,第一条也录不进去。
//   出账链那道同形的门用的是真 `loaded` 布尔(stores/billingPeriod),这里对齐它。
const dataMonths = ref<string[] | null>(null)
const monthsErr = ref<string | null>(null)
const review = useReviewStore()
const { year: gy, month: gm, picked, ym: gateYm, pick: pickCell, clear: clearPeriod,
        rows: gateRows, addEarlier, addLater, removeYear } = useMonthGate({
  key: 'elec-cost',
  store: ['elec-cost', 'all'],
  months: () => dataMonths.value ?? [],
  // 月卡审核角标(设计稿 §9.2-④):一格一把键,四档灰/橙/绿/红。
  // ⚠ `elec-model:` 这个字面量与上面 reviewKey 里那份**故意各写一份**:收进一个共用函数,
  //   门禁 reviewGateCoverage 认的那四种声明形状里 `reviewKey: () => …` 那条就扫不到
  //   「这一屏声明了 elec-model」,后端加键漏接屏时它不会红(同 LedgerView 的两处)。两处要一起改。
  reviewOf: (ym) => review.statusOf(`elec-model:${ym}`),
})
// 角标要按年取一趟闸道。矩阵态没有期 ⇒ useEditMode 那条 ensureFor 挂的键恒 null,一趟都不发;
// 少了这条,statusOf 永远回「还不知道」,角标一个也画不出来。纵排几年就几趟(ensureYear 自带缓存与在途去重)。
watch(() => gateRows.value.map(r => r.year).join(','), () => {
  for (const r of gateRows.value) void review.ensureYear(r.year)
}, { immediate: true })
const year = computed(() => gy.value ?? 0)
const month = computed(() => gm.value ?? 0)
const acctMonth = computed(() => `${year.value}-${pad2(month.value)}`)

// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM 直落该月 —— 只 pick 进 screenPeriod,取数交给下面的 onMounted / watch(gateYm)。
// 必须在 onMounted / watch(gateYm) / onReactivated 之前调用:期先落定,首载才只拉一次;切回时也先于重读改期。
// 只有年的链接不动(本屏只认整月)。本屏没有草稿(金额 / 备注 / 电价全是即时乐观提交),不传 dirty、也不接 note。
// 本屏按月锁(S.elecCost(year, month)):编辑态里被深链换月 = 换 scope,useEditMode 的 scopeWhileEditing 守卫接手,与屏内换月同一条路。
useDeepPeriod({
  current: () => ({ p: gateYm.value }),
  apply: (t) => { if (t.month != null) pickCell(t.year, t.month) },
  // 本屏与父屏共用同一个页签 value(一个 value 两个组件,靠父屏的 mode 切换)——
  // 两个 useDeepPeriod 实例会往同一格 ctx 里对写,而子屏卸载时不回滚,页签会留着子屏的月
  // 对着父屏的年表撒谎(整期复查实测)。页签上下文由父屏一家写。
  ctx: () => null,
})

// ── 数据 ──
const meters = ref<ElecMeterDTO[] | null>(null)
const entries = ref<ElecCostEntryDTO[] | null>(null)
const metrics = ref<ElecMetricDTO[] | null>(null)
const cfgs = ref<ElecPriceCfgDTO[] | null>(null)

const metersErr = ref('')
/** 电表清单。裸 await 一挂 meters 恒为 null → 永久转圈无重试口;独立槽 + 竞态守卫同 PvMeterView。 */
let mtSeq = 0
async function loadMeters() {
  const my = ++mtSeq
  try {
    const data = await elecCostApi.meters()
    if (my === mtSeq) { meters.value = data; metersErr.value = '' }
  } catch {
    if (my === mtSeq) metersErr.value = '电表清单加载失败,请重试'
  }
}
/** 失败条上的「重试」:只重来挂掉的那一份。 */
function retryLoad() {
  if (metersErr.value) loadMeters()
  if (readErr.value) loadMonth()
}
/** 任一份没拿全 —— 写入口按这个判。 */
const loadErr = computed(() => readErr.value || metersErr.value)

/** 换期重取的退让(§06 第一档)。 */
const reloading = ref(false)
const veil = useDeferredFlag(reloading)
/** 本期取数失败的人话。只在**成功**时清。 */
const readErr = ref<string | null>(null)
async function loadYears() {
  // 名字沿用(多处调用),实际刷的是**账期清单** —— 选期矩阵吃的是它,年下拉已随 §7-1 退场。
  // 不碰 year/month:期归 store,写操作只该让矩阵上多亮一格,不该把人挪到别的月去。
  await loadMonths()
}
// 竞态守卫:快速切年月只接受最新一次请求(防乱序落表)
let seq = 0
async function loadMonth() {
  const my = ++seq
  reloading.value = true
  try {
    const [es, ms, cs] = await Promise.all([
      elecCostApi.entries(year.value, month.value),
      elecCostApi.metrics(year.value, month.value),
      elecCostApi.priceCfg(acctMonth.value),
    ])
    if (my === seq) { entries.value = es; metrics.value = ms; cfgs.value = cs; readErr.value = null }
  } catch (e) {
    // 失败时不留旧数据顶着新期标:清空 → 表体让位给错误条
    if (my === seq) {
      entries.value = []
      metrics.value = []
      // ⚠ cfgs 也要落位(spec agent 抓到的移植洞):本屏是**三**份数据,首次选期就失败时
      //   cfgs 还是 null,模板 `!cfgs` 让整屏停在转圈 —— 失败条/重试口一次都不渲染。
      cfgs.value = cfgs.value ?? []
      readErr.value = (e as { message?: string })?.message ?? '本月费项加载失败'
    }
  } finally {
    if (my === seq) reloading.value = false
  }
}
// 金额/参数编辑后指标口径变化,静默重取指标表(entries 已乐观落位,不整月重拉)
// ⚠ 必须挂 seq(复查计划里点名的竞态):无守卫时两笔连着改 → 两趟并发乱序落表,
//   或换期后旧期的指标回包盖进新期 —— 「7 月标题 + 3 月指标」。
let mSeq = 0
async function reloadMetrics() {
  // 两道围栏:seq 防换期串台;mSeq 防**同期两笔连改**的两趟乱序回包(它们持同一个 seq,
  // 只看 seq 时后到者赢 —— 第一笔的旧指标盖掉第二笔的新指标)。
  const my = seq
  const mine = ++mSeq
  try {
    const ms = await elecCostApi.metrics(year.value, month.value)
    if (my === seq && mine === mSeq) metrics.value = ms
  } catch { /* 保留旧值:指标是派生的展示面,失败不值得打断录入 */ }
}
/** 矩阵点格:年月一起定,再拉该月费项。 */
async function onPickCell(y: number, m: number) {
  pickCell(y, m)
  await loadMonth()
}
async function loadMonths() {
  monthsErr.value = null
  try { dataMonths.value = await elecCostApi.months() }
  catch (e) { monthsErr.value = (e as { message?: string })?.message ?? '账期清单加载失败' }
}
onMounted(() => {
  loadMeters()
  loadMonths()
  if (picked.value) loadMonth()   // 会话内选过期 → 直落表,不再撞矩阵
})
// KeepAlive 切回重读(spec §12;照 CpMeterView 的三支):导入中心导完切回来,矩阵与本月不能还是导入前的
onReactivated(() => {
  loadMeters()
  loadMonths()
  if (picked.value) loadMonth()
})
watch(gateYm, () => { if (picked.value) loadMonth() })

// ── 电表排序(总表→宿舍→运营,组内 sortNo 由后端排好)与费项行值域 ──
const KIND_LABEL: Record<ElecMeterKind, string> = { master: '总表', dorm: '宿舍', ops: '运营' }
const KIND_ORDER: Record<ElecMeterKind, number> = { master: 0, dorm: 1, ops: 2 }
const orderedMeters = computed(() =>
  (meters.value ?? []).slice().sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.sortNo - b.sortNo))

// 费项行定义(中文名取自 elecCostExcel 单一事实源,与后端 FEE_BY_LABEL/SUB_BY_LABEL 镜像;拆分值域 spec §3)
interface FeeRow { key: string; label: string; hint?: string; subs?: { key: string; label: string }[] }
const sub = (k: string) => ({ key: k, label: ELEC_SUB_LABEL[k] })
const feeRow = (key: string, extra?: Omit<FeeRow, 'key' | 'label'>): FeeRow => ({ key, label: ELEC_FEE_LABEL[key], ...extra })
const FEE_ROWS_BY_KIND: Record<ElecMeterKind, FeeRow[]> = {
  master: [
    feeRow('tou_industrial', { subs: [sub('bg'), sub('t3_industry')] }),
    feeRow('basic_industrial', { subs: [sub('bg'), sub('t3_industry')] }),
    feeRow('commercial', { hint: '固定电价', subs: [sub('a'), sub('t3_chuangye')] }),
    feeRow('pv_grid_income', { hint: '余电上网卖给电网,抵减购电成本' }),
    feeRow('pf_reward', { hint: '功率因数达标电网减免,抵减购电成本' }),
  ],
  dorm: [{ key: 'usage', label: elecFeeLabel('usage', 'dorm') }],
  ops: [{ key: 'usage', label: elecFeeLabel('usage', 'ops') }, feeRow('allocated')],
}

// ── 费项索引与拆分口径(合计与拆分并存 → 拆分Σ为准,合计行黄警) ──
const entryMap = computed(() => {
  const m = new Map<string, ElecCostEntryDTO>()
  for (const e of entries.value ?? []) m.set(`${e.meterId}|${e.feeKey}|${e.subKey}`, e)
  return m
})
const entryOf = (mid: number, fee: string, sub = '') => entryMap.value.get(`${mid}|${fee}|${sub}`)
const splitEntries = (mid: number, f: FeeRow) =>
  (f.subs ?? []).map(s => entryOf(mid, f.key, s.key)).filter((e): e is ElecCostEntryDTO => !!e)
const hasSplit = (mid: number, f: FeeRow) => splitEntries(mid, f).length > 0
const splitSum = (mid: number, f: FeeRow) => splitEntries(mid, f).reduce((s, e) => s + e.amount, 0)
const dirtyTotal = (mid: number, f: FeeRow) => hasSplit(mid, f) && !!entryOf(mid, f.key, '')

// 拆分行展开(键=meterId|feeKey);无拆分数据也可展开开始拆录(编辑态)
const opened = ref<Set<string>>(new Set())
function toggleOpen(mid: number, fee: string) {
  const k = `${mid}|${fee}`
  const next = new Set(opened.value)
  if (next.has(k)) next.delete(k); else next.add(k)
  opened.value = next
}
const isOpen = (mid: number, fee: string) => opened.value.has(`${mid}|${fee}`)

// ── 费项清单扁平行(分组行/费项行/拆分子行/并存合计行 一张表一个 v-for,判别联合供模板窄化) ──
interface GroupRow { t: 'group'; key: string; m: ElecMeterDTO; subtotal: number }
interface DataRow {
  t: 'fee' | 'split' | 'dirty'
  key: string
  m: ElecMeterDTO
  label: string
  hint?: string
  feeKey: string
  subKey: string
  e?: ElecCostEntryDTO
  chevron?: boolean      // fee 行有拆分值域 → 展开箭头
  open?: boolean
  derived?: boolean      // fee 行有拆分数据 → 金额/电量=Σ拆分读时派生(只读)
  dAmount?: number
  dQty?: number | null
  dirty?: boolean        // 合计与拆分并存黄警
}
type FlatRow = GroupRow | DataRow
const rows = computed<FlatRow[]>(() => {
  const out: FlatRow[] = []
  for (const m of orderedMeters.value) {
    const fees = FEE_ROWS_BY_KIND[m.kind]
    // 该表小计=Σ费项金额(核对用途,有拆分的费项按拆分Σ计;抵减类费项亦计入——纯算术合计,业务净额看指标表)
    const subtotal = fees.reduce((s, f) => s + (hasSplit(m.id, f) ? splitSum(m.id, f) : entryOf(m.id, f.key)?.amount ?? 0), 0)
    out.push({ t: 'group', key: `g${m.id}`, m, subtotal })
    for (const f of fees) {
      const split = hasSplit(m.id, f)
      const open = !!f.subs && isOpen(m.id, f.key)
      const dirty = dirtyTotal(m.id, f)
      if (split) {
        const qs = splitEntries(m.id, f).filter(e => e.qty != null)
        out.push({
          t: 'fee', key: `f${m.id}|${f.key}`, m, label: f.label, hint: f.hint, feeKey: f.key, subKey: '',
          chevron: true, open, derived: true, dAmount: splitSum(m.id, f),
          dQty: qs.length ? qs.reduce((s, e) => s + (e.qty ?? 0), 0) : null, dirty,
        })
      } else {
        out.push({
          t: 'fee', key: `f${m.id}|${f.key}`, m, label: f.label, hint: f.hint, feeKey: f.key, subKey: '',
          e: entryOf(m.id, f.key), chevron: !!f.subs, open,
        })
      }
      if (open) {
        for (const s of f.subs ?? []) {
          out.push({ t: 'split', key: `s${m.id}|${f.key}|${s.key}`, m, label: s.label, feeKey: f.key, subKey: s.key, e: entryOf(m.id, f.key, s.key) })
        }
        // 并存脏数据的合计行:展开后单列出,编辑态清空即删(否则黄警无处消除)
        if (dirty) out.push({ t: 'dirty', key: `d${m.id}|${f.key}`, m, label: '合计行(与拆分并存,清空可删)', feeKey: f.key, subKey: '', e: entryOf(m.id, f.key) })
      }
    }
  }
  return out
})
const fmtQty = (r: DataRow) => {
  const q = r.derived ? r.dQty : r.e?.qty
  return q == null ? '—' : fq(q)
}
const SRC_LABEL: Record<string, string> = { manual: '手工', import: '导入', simulated: '模拟' }

// 本月模拟值计数(工具栏灰标提示)
const simCount = computed(() => (entries.value ?? []).filter(e => e.source === 'simulated').length)

// ── 金额提交(编辑态;乐观更新失败回滚;清空=删行;PUT upsert 后 source→manual,模拟徽标即时消失) ──
function commitAmount(meterId: number, feeKey: string, subKey: string, raw: string) {
  // 写口自守:editMode 会就地转假(接管/提权到期),调用者各有各的 v-if,守发请求这层才不漏
  if (!editE.value) return
  // 在途自守(照 CpMeter.commitMeter):fp-stale 的 pointer-events 挡不住已聚焦输入框的回车提交
  if (reloading.value) return
  if (!entries.value) return
  // ⚠ 回滚围栏(复查坐实的最狠一条):本屏的乐观回滚是**整数组置换**(prev = 整份 entries),
  //   样板是改行对象 —— 换期后旧行对象已出渲染树,天然免疫;整数组置换把免疫丢了:
  //   在途换期后失败回滚会把旧期整表盖进新期,「8 月标题 + 7 月费项」,
  //   之后每笔录入都按 acctMonth=8 月把 7 月语境的数写成 8 月真数据。
  const my = seq
  const t = raw.trim()
  const cur = entryOf(meterId, feeKey, subKey)
  const prev = entries.value
  if (t === '') {
    if (!cur) return
    entries.value = prev.filter(e => e.id !== cur.id)   // 清空=删行;拆分删净后合计口径自动回落
    elecCostApi.deleteEntry(cur.id)
      .then(reloadMetrics)
      .catch(e => {
        if (my === seq) entries.value = prev   // 期没换才有资格回滚;换过了 loadMonth 已重取真值
        alert((e as { message?: string })?.message ?? '删除失败，请重试')
      })
    return
  }
  const v = Number(t)
  if (!isFinite(v) || v < 0) { alert('请输入非负数字'); return }
  if (cur && v === cur.amount) return
  // 手工覆盖模拟行时丢弃「模拟:...」推导备注(不再成立);其余保留原备注与电量
  const note = cur ? (cur.source === 'simulated' ? null : cur.note) : null
  const optimistic: ElecCostEntryDTO = cur
    ? { ...cur, amount: v, note, source: 'manual' }
    : { id: -Date.now(), meterId, meterName: '', acctMonth: acctMonth.value, feeKey, subKey, amount: v, qty: null, note: null, source: 'manual' }
  entries.value = cur ? prev.map(e => (e.id === cur.id ? optimistic : e)) : [...prev, optimistic]
  elecCostApi.upsertEntry({ meterId, acctMonth: acctMonth.value, feeKey, subKey: subKey || null, amount: v, qty: cur?.qty ?? null, note })
    .then((dto) => {
      entries.value = (entries.value ?? []).map(e => (e.id === optimistic.id ? dto : e))
      reloadMetrics()
      // 空月录第一笔 → 矩阵那格要亮(dataMonths 是着色唯一数据源;同 CpMeter 的移植教训)
      void loadYears()
    })
    .catch(e => {
      if (my === seq) entries.value = prev
      alert((e as { message?: string })?.message ?? '保存失败，请重试')
    })
}

// ── 备注提交(编辑态;仅已有费项行可改——备注随金额行存储,无行无备注) ──
function commitNote(e: ElecCostEntryDTO | undefined, raw: string) {
  if (!editE.value) return
  if (reloading.value) return
  if (!e || !entries.value) return
  const my = seq
  const note = raw.trim() || null
  if (note === e.note) return
  const prev = entries.value
  // 后端 upsert source 统一置 manual(动过即手工,模拟徽标随之消失)
  const optimistic: ElecCostEntryDTO = { ...e, note, source: 'manual' }
  entries.value = prev.map(x => (x.id === e.id ? optimistic : x))
  elecCostApi.upsertEntry({ meterId: e.meterId, acctMonth: e.acctMonth, feeKey: e.feeKey, subKey: e.subKey || null, amount: e.amount, qty: e.qty, note })
    .then(dto => { entries.value = (entries.value ?? []).map(x => (x.id === e.id ? dto : x)) })
    .catch(err => {
      if (my === seq) entries.value = prev
      alert((err as { message?: string })?.message ?? '保存失败，请重试')
    })
}

// ── 电表增删改(编辑态;1:1 照 PvMeterView commitStationName/delStation 模式) ──
function commitMeterName(m: ElecMeterDTO, raw: string) {
  if (!editE.value) return
  const v = raw.trim()
  if (!v) { alert('电表名称不能为空'); return }
  if (v === m.name) return
  const prev = m.name
  m.name = v
  elecCostApi.updateMeter(m.id, { name: v, kind: m.kind })
    .catch(e => { m.name = prev; alert((e as { message?: string })?.message ?? '保存失败，请重试') })   // 重名 409 中文文案直达
}
async function delMeter(m: ElecMeterDTO) {
  if (!editE.value) return
  if (!confirm(`确认删除电表「${m.name}」?有费项数据的电表不可删除。`)) return
  try { await elecCostApi.deleteMeter(m.id); await loadMeters() }
  catch (e) { alert((e as { message?: string })?.message ?? '删除失败') }   // 有数据 409 → 中文守卫文案
}

// 新增电表弹窗(名称 + 类型;类型决定费项值域,建后有数据不可改类)
const meterDlg = ref(false)
const mForm = ref({ name: '', kind: 'ops' })   // kind 存 string 适配 Select,提交时窄化
const mErr = ref('')
const KIND_OPTS = [
  { value: 'master', label: '总表(工业分时/基本/商业/光伏上网/功率奖励)' },
  { value: 'dorm', label: '宿舍(用电费用)' },
  { value: 'ops', label: '运营性(电表费用+分摊额度)' },
]
function openMeterDlg() {
  mForm.value = { name: '', kind: 'ops' }
  mErr.value = ''
  meterDlg.value = true
}
async function submitMeter() {
  if (!editE.value) return
  const name = mForm.value.name.trim()
  if (!name) { mErr.value = '请输入电表名称'; return }
  try {
    await elecCostApi.createMeter({ name, kind: mForm.value.kind as ElecMeterKind })
    meterDlg.value = false
    await loadMeters()
  } catch (e) {
    mErr.value = (e as { message?: string })?.message ?? '新增电表失败'   // 重名 409 中文文案
  }
}

// ── 电价参数小节(编辑态,指标表下方):4 参数 当月值/默认值 列表行内编辑,乐观更新失败回滚 ──
const CFG_META: Record<string, { label: string; unit: string }> = {
  pv_grid_price: { label: '光伏上网电价', unit: '元/kWh' },
  grid_posted_price: { label: '南网公告电价', unit: '元/kWh' },
  third_party_price: { label: '第三方售电执行电价', unit: '元/kWh' },
  pf_reward_rate: { label: '功率因数奖励率', unit: '比例,如 0.005' },
}
function commitCfg(c: ElecPriceCfgDTO, scope: 'month' | 'default', raw: string) {
  if (!editC.value) return
  if (reloading.value) return   // 在途窗口里表头已是新月、行还是旧月的
  const my = seq
  const t = raw.trim()
  const v = t === '' ? null : Number(t)
  if (v != null && (!isFinite(v) || v < 0)) { alert('请输入非负数字'); return }
  if (v === (scope === 'month' ? c.monthValue : c.defaultValue)) return
  const prev = cfgs.value
  const next: ElecPriceCfgDTO = { ...c, [scope === 'month' ? 'monthValue' : 'defaultValue']: v }
  next.value = next.monthValue ?? next.defaultValue      // 解析规则同后端:当月优先回退默认
  next.source = next.monthValue != null ? 'month' : next.defaultValue != null ? 'default' : null
  cfgs.value = (prev ?? []).map(x => (x.cfgKey === c.cfgKey ? next : x))
  // value=null 删行回退默认(后端语义);note 原样保留不覆写
  elecCostApi.savePriceCfg({ acctMonth: scope === 'month' ? acctMonth.value : '', cfgKey: c.cfgKey, value: v, note: c.note })
    .then(reloadMetrics)
    .catch(e => {
      if (my === seq) cfgs.value = prev
      alert((e as { message?: string })?.message ?? '保存失败，请重试')
    })
}

// ── 模拟填充 2025(编辑态):确认弹窗→POST simulate→结果 alert→重载并跳 2025 ──
const simulating = ref(false)
const presence = usePresenceStore()
async function onSimulate() {
  if (!editC.value) return   // simulate 会写 price-cfg,判电价那扇门(同按钮)
  if (simulating.value) return
  // ⚠ simulate 写 **2025 全年**(费项+电价参数),而本屏只持当前月的 S.elecCost(year, month)
  //   月锁 —— 不查其它月就是绕过别人的期锁写别人的账。服务端对 /simulate 不查锁,
  //   这道闸是唯一防线(照 CpMeterView.onSimulate 的整套:先扫、confirm 后 ping 复检)。
  const busyOn = () => {
    for (let m = 1; m <= 12; m++) {
      const who = presence.editorsUnder(S.elecCost(2025, m)).find(e => !e.self)
      if (who) return { who, m }
    }
    return null
  }
  const pre = busyOn()
  if (pre) {
    alert(`模拟填充会写 2025 全年,而 ${pre.who.displayName} 正在编辑 2025年${pre.m}月 —— 等他退出编辑模式再跑。`)
    return
  }
  if (!confirm('模拟填充 2025 全年：按附表11/附表6/附表13 等真实数据推导本模型的空缺费项与电价参数。\n\n只写空位与既有「模拟」灰标行，绝不覆盖手工录入/导入的数据。确认执行？')) return
  // confirm() 阻塞事件循环,名单冻结在弹框前 —— 返回后刷一拍复检(TOCTOU,同 CpMeter)
  await presence.ping()
  const late = busyOn()
  if (late) {
    alert(`模拟填充会写 2025 全年,而 ${late.who.displayName} 正在编辑 2025年${late.m}月 —— 等他退出编辑模式再跑。`)
    return
  }
  simulating.value = true
  try {
    const r = await elecCostApi.simulate(2025)
    alert(`模拟完成：填充 ${r.filled} 条，跳过 ${r.skipped} 条（手工/导入占位或值未变）。`)
    await loadYears()
    // 模拟填充写的是 2025 全年。不再自动把人挪到 2025 ——
    // 期归 store,矩阵上那一年会亮起来,要看点进去即可(改前是 year.value = 2025 直接跳)。
    if (picked.value) await loadMonth()
  } catch (e) {
    alert((e as { message?: string })?.message ?? '模拟填充失败')
  } finally {
    simulating.value = false
  }
}

// ── 导入(编辑态;registry key='elecCost' 闭环:解析→预览→确认→入库→import_log) ──
const importing = ref(false)
const importResult = ref<ImportResultDTO | null>(null)
const importCtx: ImportCtx = {}
// registry 'elecCost' 为并行刀契约(同 pvMeter Wave2-B 模式):解析配置与 run 落在 importRegistry;
// 未合入时按钮降级提示,不在渲染期抛错炸屏
let elecCostParser: ({ templateCols: string[] } & Record<string, unknown>) | null = null
try { elecCostParser = parserProps('elecCost', importCtx) } catch { elecCostParser = null }
function openImport() {
  if (!elecCostParser) { alert('导入解析器(importRegistry elecCost)尚未接入。'); return }
  importing.value = true
}
async function onImport(payload: ImportRec[] | { label?: string; records: ImportRec[] }[], fileName: string) {
  importing.value = false
  if (!editE.value) return
  try {
    importResult.value = await runImport('elecCost', payload as never, importCtx, fileName)
    await Promise.all([loadMonth(), loadYears()])
  } catch (e) {
    alert((e as { message?: string })?.message ?? '导入失败')
  }
}

// ── 指标格式:pvLoss 电量口径 kWh,其余金额 元(后端契约) ──
function fmtMetric(mt: ElecMetricDTO): string {
  if (mt.value == null) return '—'
  return mt.key === 'pvLoss' ? fq(mt.value) + ' kWh' : fy(mt.value)
}
</script>

<template>
  <!-- 首载 gate:表/费项/指标未落位不闪空态 -->
  <!-- ⓪ 没有期 → 选期矩阵(§7-1 明确选期门)。会话内选过一次之后不再出现 -->
  <FPMonthGate
    v-if="!picked"
    title="电费成本总览"
    icon="gauge"
    sub="选择月份进入该月费项清单与派生指标 · 空月可直接进入录入 / 导入"
    :rows="gateRows"
    :scope-of="(y, m) => S.elecCost(y, m)"
    :loading="dataMonths === null && !monthsErr"
    :error="monthsErr"
    @pick="onPickCell"
    @add-earlier="addEarlier"
    @add-later="addLater"
    @remove-year="removeYear"
    @retry="loadMonths"
  />

  <!-- 电表清单一次都没拿到:硬失败面(照 PvMeterView) -->
  <div v-else-if="!meters && metersErr" class="ec-gate-fail">
    <component :is="iconFor('alert-triangle')" :size="18" />
    <span>{{ metersErr }}</span>
    <Button variant="outline" size="sm" @click="loadMeters">重试</Button>
  </div>

  <div v-else-if="!meters || !entries || !metrics || !cfgs" class="page-loading"><span class="page-spin" /></div>

  <div v-else class="ec-page">
    <!-- 换期在途的唯一信号(§06 第一档) -->
    <FPLoadBar :on="veil" />
    <!-- 标题行 -->
    <div class="ec-head">
      <div class="ec-headl">
        <div>
          <h2 class="ec-title"><span class="ic"><component :is="iconFor('gauge')" :size="18" /></span>电费成本总览</h2>
          <p class="ec-sub">园区电费物理模型 · 总表/宿舍/运营电表按费项逐月录入 · 派生收益指标 · 金额单位 元</p>
        </div>
      </div>
      <!-- 电表增删=写入口,仅编辑态(EDIT-MODE-SPEC v2) -->
      <Button v-if="editE" variant="outline" size="sm" @click="openMeterDlg">
        <template #leading><component :is="iconFor('plus')" :size="14" /></template>
        新增电表
      </Button>
    </div>

    <!-- 工具栏:模拟值提示 + 年月选择(只读操作不受管) + 编辑态按钮组 -->
    <div class="mx-toolbar">
      <div v-if="simCount > 0" class="ec-simhint" title="来源列灰「模拟」徽标为系统按附表真实数据推导的模拟值;录入真实金额后自动转为手工数据">
        <component :is="iconFor('info')" :size="13" />本月 {{ simCount }} 条模拟值(灰标)
      </div>
      <div v-else />
      <div class="mx-toolbar-right">
        <!-- 年月下拉已撤:期由选期矩阵一处选定(§7-1),这里只显示是几月 + 回矩阵的口 -->
        <button class="ec-permonth" @click="clearPeriod">
          <component :is="iconFor('arrow-left')" :size="13" />换月
        </button>
        <span class="ec-per">{{ gateYm }}</span>
        <!-- 导入/模拟填充=写入口,收编辑态(EDIT-MODE-SPEC v2) -->
        <Button v-if="editE" variant="outline" size="sm" @click="openImport">
          <template #leading><component :is="iconFor('upload')" :size="14" /></template>
          导入
        </Button>
        <!-- simulate 会给缺配置的月份写 price-cfg(RBAC-SPEC §5.3 ③),故判电价那扇门 -->
        <Button v-if="editC" variant="outline" size="sm" :disabled="simulating" @click="onSimulate">
          <template #leading><component :is="iconFor('wand-2')" :size="14" /></template>
          模拟填充 2025
        </Button>
        <!-- 审核动作簇(§01):长在编辑按钮**左边**,同一条 flex 行 —— 编辑按钮位一个像素不动。
             四态八格由组件自己判(全站唯一那一份),屏这一层只负责喂键与人话名。 -->
        <FPReviewActions :keys="reviewKeys" :label="reviewLabel" :can-edit="canEnter" :edit="editMode" />
        <!-- 失败态禁"进"不禁"出"(:disabled 不分编辑态,不带 !editMode 会把「完成」也禁掉 → 死锁) -->
        <FPEditModeButton :edit="editMode" :held-by-other="heldByOther" :can-enter="canEnter"
                          :review-note="reviewNote" :review-tip="reviewTip"
                          :disabled="!editMode && !!loadErr"
                          :title="!editMode && loadErr ? '数据未加载成功,先点失败条上的「重试」再进编辑' : undefined"
                          @toggle="toggleEdit()" />
      </div>
    </div>

    <FPLoadError v-if="loadErr" @retry="retryLoad">
      <div v-if="readErr">{{ year }}年{{ month }}月费项加载失败:{{ readErr }} —— 表内为空,不拿上一期的数顶替,编辑模式已锁。</div>
      <div v-if="metersErr">{{ metersErr }} —— 电表清单停留在上次拉到的版本。</div>
    </FPLoadError>

    <!-- 空态引导。⚠ 排除 loadErr:失败态下 entries 被清成 [],「暂无」会把失败说成「真的没有」 -->
    <div v-if="!loadErr && entries.length === 0" class="ec-empty">
      <component :is="iconFor('info')" :size="14" />
      <span>
        {{ year }}年{{ month }}月暂无费项数据 ——
        <template v-if="editE">可直接在下方清单行内录入金额,或「导入」长表 Excel,或「模拟填充 2025」按附表真实数据推导。</template>
        <template v-else-if="canEntry">进入右上角「编辑模式」可录入金额、导入或模拟填充。</template>
        <template v-else>各费项显示为「—」。</template>
      </span>
    </div>

    <!-- ① 费项清单(主表)。fp-stale 带 pointer-events:none —— 旧数据不许被点、被录 -->
    <Card surface="white" :padding="0" class="ec-listcard"
          :class="{ 'fp-stale': veil }" :aria-busy="veil">
      <div class="ec-cardhead">
        <div class="ec-cardtitles">
          <span class="ec-cardtitle">费项清单 · {{ year }}年{{ month }}月</span>
          <span class="ec-cardsub">每月按电表填报各费项金额；浏览核对，修改请进编辑模式</span>
        </div>
      </div>
      <table class="ec-table">
        <colgroup><col /><col style="width:130px" /><col style="width:110px" /><col style="width:90px" /><col /></colgroup>
        <thead>
          <tr><th>项目</th><th class="num">金额(元)</th><th class="num">电量(kWh)</th><th>来源</th><th>备注</th></tr>
        </thead>
        <tbody>
          <tr v-for="r in rows" :key="r.key"
              :class="{ 'ec-grouprow': r.t === 'group', 'ec-subrow': r.t === 'split' || r.t === 'dirty' }">
            <!-- 电表分组行:表名+类型徽标+该表小计,底色区分;编辑态名称行内改+删 -->
            <template v-if="r.t === 'group'">
              <td class="lbl g">
                <input v-if="editE" class="ec-nameedit" type="text" :value="r.m.name"
                       title="电表名,回车/失焦保存(需唯一)"
                       @change="commitMeterName(r.m, ($event.target as HTMLInputElement).value)" />
                <span v-else class="ec-gname">{{ r.m.name }}</span>
                <span class="ec-kind">{{ KIND_LABEL[r.m.kind] }}</span>
                <button v-if="editE" class="ec-del" title="删除电表(有费项数据不可删)" @click="delMeter(r.m)">
                  <component :is="iconFor('trash-2')" :size="14" />
                </button>
              </td>
              <td class="num gsum" title="该表各费项金额合计(核对用;有拆分的费项按拆分Σ计,抵减类费项亦计入)">{{ fy(r.subtotal) }}</td>
              <td colspan="3" />
            </template>
            <!-- 费项行(缩进一级)/拆分子行·并存合计行(缩进两级) -->
            <template v-else>
              <td class="lbl" :class="[r.t === 'fee' ? 'lv1' : 'lv2', { warn: r.t === 'dirty' }]">
                <button v-if="r.chevron" class="ec-chev" :class="{ open: r.open }"
                        :title="r.open ? '收起楼栋拆分' : '展开楼栋拆分'"
                        @click="toggleOpen(r.m.id, r.feeKey)">
                  <component :is="iconFor('chevron-right')" :size="14" />
                </button>
                <span v-else class="ec-chevpad" />
                <component :is="iconFor('corner-down-right')" v-if="r.t === 'split'" :size="12" />
                <component :is="iconFor('alert-triangle')" v-if="r.t === 'dirty'" :size="12" />
                <span :title="r.hint">{{ r.label }}</span>
                <span v-if="r.t === 'fee' && r.dirty" class="ec-warn"
                      title="合计行与拆分行并存,金额以拆分Σ为准(spec §3);展开后清空合计行可消除本警示">并存⚠</span>
              </td>
              <td class="num">
                <!-- 有拆分行:金额=Σ拆分读时派生(只读),展开子行修改;其余行编辑态行内输入,浏览态纯文本 -->
                <span v-if="r.derived" class="ec-derived" title="由楼栋拆分行求和派生;展开子行修改">{{ fy(r.dAmount ?? 0) }}</span>
                <input v-else-if="editE" class="ec-in" type="number" min="0" step="0.01"
                       :value="r.e?.amount ?? ''" placeholder="—"
                       title="金额(元),回车/失焦保存;清空=删除该费项行"
                       @change="commitAmount(r.m.id, r.feeKey, r.subKey, ($event.target as HTMLInputElement).value)" />
                <span v-else :class="{ zero: !r.e }">{{ r.e ? fy(r.e.amount) : '—' }}</span>
              </td>
              <td class="num qty" :class="{ zero: fmtQty(r) === '—' }">{{ fmtQty(r) }}</td>
              <td class="src">
                <span v-if="r.e?.source === 'simulated'" class="ec-sim" :title="r.e.note ?? '模拟数据'">模拟</span>
                <span v-else-if="r.e" class="ec-srctxt">{{ SRC_LABEL[r.e.source] }}</span>
              </td>
              <td class="note">
                <input v-if="editE && r.e && !r.derived" class="ec-in txt" type="text"
                       :value="r.e.note ?? ''" placeholder="—" title="备注,回车/失焦保存"
                       @change="commitNote(r.e, ($event.target as HTMLInputElement).value)" />
                <span v-else-if="r.e?.note" class="ec-notetxt" :title="r.e.note">{{ r.e.note }}</span>
              </td>
            </template>
          </tr>
        </tbody>
      </table>
    </Card>

    <!-- ② 派生指标表:一行一指标;缺源行置灰,值列「—」。
         纯读面,但换期在途旧值顶新表头同样是错话 —— 整屏退让口径一致 -->
    <Card surface="white" :padding="0" class="ec-listcard"
          :class="{ 'fp-stale': veil }" :aria-busy="veil">
      <div class="ec-cardhead">
        <div class="ec-cardtitles">
          <span class="ec-cardtitle">派生指标 · {{ year }}年{{ month }}月</span>
          <span class="ec-cardsub">按费项清单与电价参数自动计算;缺失数据源的指标置灰,补齐来源后即出值</span>
        </div>
      </div>
      <table class="ec-table">
        <colgroup><col style="width:200px" /><col style="width:150px" /><col /><col style="width:240px" /></colgroup>
        <thead>
          <tr><th>指标</th><th class="num">本月值</th><th>公式</th><th>缺失数据源</th></tr>
        </thead>
        <tbody>
          <tr v-for="mt in metrics" :key="mt.key" :class="{ miss: mt.missing.length > 0 }">
            <td class="lbl lv1"><span class="ec-chevpad" /><span>{{ mt.label }}</span></td>
            <td class="num mval" :class="{ neg: (mt.value ?? 0) < 0, zero: mt.value == null }">{{ fmtMetric(mt) }}</td>
            <td class="formula" :title="mt.formulaText">{{ mt.formulaText }}</td>
            <td class="missing" :title="mt.missing.join('；') || undefined">{{ mt.missing.join('；') }}</td>
          </tr>
        </tbody>
      </table>
    </Card>

    <!-- ⚠ 第二写面必须盖 veil(CpMeter 电表卡的同款教训,这屏又漏了一次):
         在途窗口里表头已是新月「{{ month }}月值」,行还是旧月的 —— 不盖就完全可点可录 -->
    <Card v-if="editC" surface="white" :padding="0" class="ec-listcard"
          :class="{ 'fp-stale': veil }" :aria-busy="veil">
      <div class="ec-cardhead">
        <div class="ec-cardtitles">
          <span class="ec-cardtitle"><component :is="iconFor('sliders-horizontal')" :size="15" style="vertical-align:-2px;margin-right:6px" />电价参数</span>
          <span class="ec-cardsub">取值:当月值优先,缺省回退默认值;清空当月值即回退 · 政策会变,按月维护</span>
        </div>
      </div>
      <table class="ec-table">
        <colgroup><col /><col style="width:170px" /><col style="width:170px" /><col style="width:190px" /></colgroup>
        <thead>
          <tr><th>参数</th><th class="num">{{ month }}月值</th><th class="num">长期默认值</th><th class="num">生效值</th></tr>
        </thead>
        <tbody>
          <tr v-for="c in cfgs" :key="c.cfgKey">
            <td class="lbl lv1">
              <span class="ec-chevpad" />
              <span :title="c.note ?? undefined">{{ CFG_META[c.cfgKey]?.label ?? c.cfgKey }}</span>
              <span class="ec-unit">{{ CFG_META[c.cfgKey]?.unit }}</span>
            </td>
            <td class="num">
              <input class="ec-cfgin" type="number" min="0" step="0.0001"
                     :value="c.monthValue ?? ''" placeholder="—" title="当月值,回车/失焦保存;清空=回退默认"
                     @change="commitCfg(c, 'month', ($event.target as HTMLInputElement).value)" />
            </td>
            <td class="num">
              <input class="ec-cfgin" type="number" min="0" step="0.0001"
                     :value="c.defaultValue ?? ''" placeholder="—" title="长期默认值,回车/失焦保存"
                     @change="commitCfg(c, 'default', ($event.target as HTMLInputElement).value)" />
            </td>
            <td class="num eff" :class="{ zero: c.value == null }">
              {{ c.value != null ? c.value : '未配置' }}
              <span v-if="c.source" class="ec-cfgsrc">{{ c.source === 'month' ? '当月' : '默认' }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </Card>

    <!-- 新增电表轻量弹窗(仅编辑态入口) -->
    <div v-if="meterDlg" class="ec-mask" @mousedown="meterDlg = false">
      <div class="ec-dlg" @mousedown.stop>
        <div class="ec-dlg-h">
          <h3>新增电表</h3>
          <p>类型决定可录费项:总表 5 费项 / 宿舍 用电费用 / 运营性 费用+分摊。建表后有数据不可改类型。</p>
        </div>
        <div class="ec-dlg-b">
          <Input v-model="mForm.name" label="电表名称" placeholder="如:充电桩总表" size="sm" />
          <Select v-model="mForm.kind" label="类型" :options="KIND_OPTS" size="sm" />
          <div class="ec-dlg-err">{{ mErr }}</div>
        </div>
        <div class="ec-dlg-f">
          <Button variant="gray" size="sm" @click="meterDlg = false">取消</Button>
          <Button variant="filled" size="sm" @click="submitMeter">
            <template #leading><component :is="iconFor('check')" :size="14" /></template>
            新增
          </Button>
        </div>
      </div>
    </div>

    <!-- 导入(registry key='elecCost':长表 电表|费项|拆分|月份|金额|电量|备注) -->
    <FpImportModal
      v-if="importing && elecCostParser"
      title="导入 电费成本"
      sub="上传/粘贴长表(电表|费项|拆分|月份|金额|电量|备注);费项/拆分收中文名,(表,月,费项,拆分)重复导入自动覆盖"
      v-bind="elecCostParser"
      @close="importing = false"
      @import="onImport"
      @import-sections="onImport"
    />
    <ImportResultToast v-if="importResult" :result="importResult" @close="importResult = null" />
    <FPElevateDialog
      :page="`电费成本总览 · ${year}-${String(month).padStart(2, '0')}`" :action="'录入费项金额 / 改电价口径'" :perms="asking" what="修改电价口径" @close="cancelAsk" @elevated="onElevated" />
    <FPLockDialogs :locked-by="lockedBy" :evicted-by="evictedBy" :scope="lockScope()"
                   :what="`电费成本总览 ${year}-${String(month).padStart(2, '0')}`"
                   @taken="onTaken" @close-takeover="lockedBy = null" @close-evicted="evictedBy = null" />
  </div>
</template>

<style scoped>
/* 页面:纵排两卡,壳层 main.fp-content 自带滚动,不做视口定高(行数=电表×费项 固定量级,不分页不裁行) */
.ec-permonth {
  display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto;
  padding: 5px 10px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm);
  background: var(--surface-white); cursor: pointer;
  font-family: var(--font-sans); font-size: var(--fs-label); color: var(--text-muted);
  transition: color var(--dur-fast), border-color var(--dur-fast);
}
.ec-permonth:hover { color: var(--hue-blue); border-color: var(--hue-blue); }
.ec-per { flex: 0 0 auto; font-family: var(--font-mono); font-size: 13px; font-weight: var(--fw-bold); }

.ec-gate-fail {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  height: 100%; color: var(--hue-red); font-size: 13px;
}
/* position: relative —— FPLoadBar 是 absolute,宿主不给参照它会认 AppShell 的 .fp-main-card */
.ec-page { position: relative; display: flex; flex-direction: column; gap: 16px; box-sizing: border-box; max-width: 1600px; margin: 0 auto; width: 100%; }

/* ── 标题行(同 PvMeterView .pm-head 家族) ── */
.ec-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.ec-headl { display: flex; align-items: center; gap: 12px; min-width: 0; }
.ec-title { margin: 0; display: flex; align-items: center; gap: 11px; font-size: var(--fs-h2); font-weight: var(--fw-semibold); color: var(--text-primary); }
.ec-title .ic { width: 34px; height: 34px; border-radius: 10px; background: var(--surface-sunken); display: grid; place-items: center; color: var(--text-secondary); flex: 0 0 auto; }
.ec-sub { margin: 5px 0 0; font-size: var(--fs-label); color: var(--text-muted); }

/* 工具栏左侧模拟值提示 */
.ec-simhint { display: flex; align-items: center; gap: 6px; font-size: var(--fs-label); color: var(--text-muted); cursor: help; }

/* ── 空态引导条 ── */
.ec-empty { display: flex; align-items: center; gap: 8px; padding: 10px 14px; border: 1px dashed var(--border-strong); border-radius: var(--radius-md); background: var(--surface-card); font-size: var(--fs-label); color: var(--text-secondary); }

/* ── 列表卡(LIST-PAGE-SPEC 形态:Card+表格,卡头=标题+副标题) ── */
.ec-listcard { border: 1px solid var(--border-subtle); overflow: hidden; }
.ec-cardhead { display: flex; align-items: center; gap: 10px; padding: 14px 18px 12px; border-bottom: 1px solid var(--divider); }
.ec-cardtitles { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.ec-cardtitle { font-size: 14.5px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.ec-cardsub { font-size: var(--fs-label); color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── 表格:定宽列律(colgroup+fixed,至多弹性列吸收余宽)+行高等高铁律(46px,内容 ellipsis 不撑行) ── */
.ec-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-family: var(--font-sans); }
.ec-table th { position: sticky; top: 0; background: var(--surface-white); padding: 8px 16px; text-align: left; font: var(--type-label); font-weight: var(--fw-regular); color: var(--text-muted); white-space: nowrap; border-bottom: 1px solid var(--divider); }
.ec-table th.num { text-align: right; }
.ec-table tbody tr { height: 46px; border-bottom: 1px solid var(--divider); }
.ec-table tbody tr:last-child { border-bottom: none; }
.ec-table td { padding: 0 16px; vertical-align: middle; font-size: 12.5px; color: var(--text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ec-table td.num { text-align: right; font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.ec-table td.zero, .ec-table td.num.zero { color: var(--text-disabled); }

/* 项目列:分组行/费项行(缩进一级)/拆分子行(缩进两级);house style 沿用 td 直接 flex(既有屏已验证) */
.ec-table td.lbl { display: flex; align-items: center; gap: 6px; height: 46px; }
.ec-table td.lbl.lv1 { padding-left: 28px; }
.ec-table td.lbl.lv2 { padding-left: 56px; color: var(--text-secondary); }
.ec-table td.lbl.warn { color: var(--hue-orange); }

/* 电表分组行:底色区分 + 小计 semibold */
.ec-grouprow { background: var(--bg-sunken); }
.ec-gname { font-weight: var(--fw-semibold); overflow: hidden; text-overflow: ellipsis; }
.ec-grouprow td.gsum { font-weight: var(--fw-semibold); cursor: help; }
.ec-kind { flex: 0 0 auto; font-size: var(--fs-micro); color: var(--text-muted); background: var(--surface-white); border: 1px solid var(--border-subtle); border-radius: var(--radius-full); padding: 1px 8px; }

/* 拆分子行/并存合计行底色 */
.ec-subrow { background: var(--surface-card); }
.ec-derived { color: var(--text-secondary); cursor: help; }
.ec-unit { font-size: var(--fs-micro); color: var(--text-disabled); }

/* 拆分展开箭头 */
.ec-chev { width: 20px; height: 20px; flex: 0 0 auto; border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-muted); display: inline-grid; place-items: center; transition: transform var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard); }
.ec-chev:hover { background: var(--bg-hover); }
.ec-chev.open { transform: rotate(90deg); }
.ec-chevpad { width: 20px; flex: 0 0 auto; }

/* 合计/拆分并存黄警 */
.ec-warn { font-size: var(--fs-micro); color: var(--hue-orange); background: rgb(255, 247, 232); border-radius: var(--radius-full); padding: 1px 7px; cursor: help; }

/* 来源列:模拟=灰徽标(title=推导来源),手工/导入=灰文本 */
.ec-sim { font-size: var(--fs-micro); color: var(--text-muted); background: var(--bg-sunken); border-radius: var(--radius-full); padding: 1px 7px; cursor: help; }
.ec-srctxt { font-size: var(--fs-micro); color: var(--text-disabled); }
.ec-notetxt { color: var(--text-secondary); }

/* 编辑态行内输入(金额/备注;静默融入单元格,hover/聚焦显边框,同 PvMeterView .pm-edit 家族) */
.ec-in { width: 100%; min-width: 0; box-sizing: border-box; height: 30px; padding: 0 8px; text-align: right; border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-body); color: var(--text-primary); transition: border-color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard); appearance: textfield; -moz-appearance: textfield; }
.ec-in::-webkit-outer-spin-button, .ec-in::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.ec-in:hover { border-color: var(--border-subtle); background: var(--surface-white); }
.ec-in:focus { outline: none; border-color: var(--hue-blue); background: var(--surface-white); }
.ec-in::placeholder { color: var(--text-disabled); }
.ec-in.txt { text-align: left; font-family: var(--font-sans); font-size: 12.5px; }

/* 电表名行内编辑(编辑态;同 .pm-edit.l 家族) */
.ec-nameedit { box-sizing: border-box; height: 30px; padding: 0 8px; max-width: 220px; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-white); font-family: var(--font-sans); font-size: 12.5px; font-weight: var(--fw-medium); color: var(--text-primary); transition: border-color var(--dur-fast) var(--ease-standard); }
.ec-nameedit:focus { outline: none; border-color: var(--hue-blue); }
.ec-del { width: 26px; height: 26px; flex: 0 0 auto; border: none; background: transparent; border-radius: var(--radius-sm); cursor: pointer; color: var(--text-muted); display: inline-grid; place-items: center; transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard); }
.ec-del:hover { background: rgb(255, 238, 237); color: var(--hue-red); }

/* ── 派生指标表:缺源行置灰;公式列 fs-label 灰 ── */
.ec-table td.mval { font-weight: var(--fw-semibold); }
.ec-table td.mval.neg { color: var(--hue-red); }
.ec-table td.mval.zero { font-weight: var(--fw-regular); }
.ec-table td.formula { font-size: var(--fs-label); color: var(--text-disabled); }
.ec-table td.missing { font-size: var(--fs-label); color: var(--text-muted); }
.ec-table tbody tr.miss { background: var(--surface-card); }
.ec-table tbody tr.miss td.lbl { color: var(--text-muted); }

/* ── 电价参数小节输入/生效值 ── */
.ec-cfgin { width: 100%; box-sizing: border-box; height: 30px; padding: 0 8px; text-align: right; border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); background: var(--surface-white); font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-size: var(--fs-body); color: var(--text-primary); transition: border-color var(--dur-fast) var(--ease-standard); appearance: textfield; -moz-appearance: textfield; }
.ec-cfgin::-webkit-outer-spin-button, .ec-cfgin::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.ec-cfgin:focus { outline: none; border-color: var(--hue-blue); }
.ec-cfgin::placeholder { color: var(--text-disabled); }
.ec-table td.eff { color: var(--text-secondary); }
.ec-cfgsrc { margin-left: 6px; font-size: var(--fs-micro); font-family: var(--font-sans); color: var(--text-muted); background: var(--bg-sunken); border-radius: var(--radius-full); padding: 1px 7px; }

/* ── 新增电表弹窗(同 PvMeterView .pm-dlg 家族) ── */
.ec-mask { position: fixed; inset: 0; background: rgba(28, 28, 28, .34); z-index: 140; display: grid; place-items: center; }
.ec-dlg { width: min(440px, 90vw); background: var(--surface-white); border-radius: var(--radius-xl); box-shadow: 0 16px 48px rgba(28, 28, 28, .22); overflow: hidden; }
.ec-dlg-h { padding: 20px 22px 0; }
.ec-dlg-h h3 { margin: 0; font-size: 16px; font-weight: var(--fw-semibold); color: var(--text-primary); }
.ec-dlg-h p { margin: 6px 0 0; font-size: 12.5px; line-height: 1.5; color: var(--text-muted); }
.ec-dlg-b { padding: 16px 22px 4px; display: flex; flex-direction: column; gap: 12px; }
.ec-dlg-err { font-size: 11.5px; color: var(--hue-red); min-height: 14px; }
.ec-dlg-f { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 22px 20px; }
</style>
