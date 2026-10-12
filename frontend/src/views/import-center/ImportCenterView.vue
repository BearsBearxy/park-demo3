<!-- Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ -->
<script setup lang="ts">
// 导入中心(2026-10-10 改稿 ix-v2-main / wide / filter / allok / ro / dialog;实现规范
// docs/superpowers/specs/2026-10-10-import-center-modal-impl-design.md T6 + T9 导入中心那半)。
// 页头选一个月 → 清单每样数据问「选中这个月的数有没有」(GET /api/import-log/coverage,和本月出账同一套判据,U1);
// 下面是近 30 天的导入记录(GET /api/import-log/page,服务端分页,每页行数按卡片高度放满、至少 8 行)。
import { ref, computed, h, nextTick, onMounted, onBeforeUnmount, onActivated, onDeactivated, watch, withDirectives } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Clipboard } from 'lucide-vue-next'
import { useTabsStore } from '@/stores/tabs'
import { parsePeriod } from '@/nav/deepLink'
import { fpAllPages } from '@/nav/fpNav'
import { iconFor } from '@/components/ds/icon'
import { vTip } from '@/directives/tip'
import Button from '@/components/ds/Button.vue'
import Select from '@/components/ds/Select.vue'
import DatePicker from '@/components/ds/DatePicker.vue'
import FPAlertChip from '@/components/fp/FPAlertChip.vue'
import FPAlertPanel, { type AlertGroup } from '@/components/fp/FPAlertPanel.vue'
import FPPhaseTabs from '@/components/fp/FPPhaseTabs.vue'
import FPPager from '@/components/fp/FPPager.vue'
import FPEmpty from '@/components/fp/FPEmpty.vue'
import FPLoadError from '@/components/fp/FPLoadError.vue'
import FPSortableTable, { type SortableColumn } from '@/components/fp/FPSortableTable.vue'
import { useFitRows } from '@/components/fp/useFitRows'
import FpImportModal, { type ImportPayload } from '@/components/import/FpImportModal.vue'
import { settle, n0, type ImportOutcome, type ImportRunProgress } from '@/components/import/importRun'
import { onReactivated } from '@/composables/onReactivated'
import { IMPORT_TYPES, parserProps, runImport, type ImportCtx, type ImportGroup, type ImportTypeEntry, type ImportViewLink } from '@/utils/importRegistry'
import { useAuthStore } from '@/stores/auth'
import { canViewPage } from '@/nav/navAccess'
import { useZonesStore } from '@/stores/zones'
import { importLogApi } from '@/api/importLog'
import { companyApi } from '@/api/ledger'
import { booksApi } from '@/api/books'
import type { Book } from '@/types/book'
import { chargingApi } from '@/api/charging'
import type { ImportCoverageChip, ImportCoverageDTO, ImportLogDTO, ImportLogPageDTO } from '@/types/importLog'
import type { CompanyDTO } from '@/types/ledger'

// 权限挂在 import kind 上而非本屏(RBAC §15.7):没有它导进去的那一屏的写权,这一行不显示。
// 一样都导不了 = 只读态(U3,ix-v2-ro):清单整块换成空态卡,导入记录照常 —— 进得来这一屏(导入中心 · 查看)就能看谁导了什么。
const auth = useAuthStore()
const visibleTypes = computed(() => IMPORT_TYPES.filter(t => t.module.some(p => auth.can(p))))
const readOnly = computed(() => !visibleTypes.value.length)
const TYPE: Record<string, ImportTypeEntry> = Object.fromEntries(IMPORT_TYPES.map(t => [t.key, t]))
const zones = useZonesStore()
const route = useRoute()
const router = useRouter()
const tabs = useTabsStore()

// ── 日期字 ──────────────────────────────────────────────
const pad2 = (n: number) => String(n).padStart(2, '0')
const THIS_YEAR = new Date().getFullYear()
/** 今年的只写月(「9月」),别的年带上年 */
const ymText = (y: number, m: number) => (y === THIS_YEAR ? `${m}月` : `${y}年${m}月`)
const dayText = (v: string) => `${ymText(+v.slice(0, 4), +v.slice(5, 7))}${+v.slice(8, 10)}日`
/** 「上次 10月8日」:只写月日 */
const mdOf = (at: string) => `${+at.slice(5, 7)}月${+at.slice(8, 10)}日`
const addMonth = (v: string, n: number) => {
  const d = new Date(+v.slice(0, 4), +v.slice(5, 7) - 1 + n, 1)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`
}
/** 导入记录「导到哪」的期:月 9月 / 7月–9月,日 10月1日–9日,年 2026年 */
function perText(from?: string | null, to?: string | null): string {
  if (!from) return ''
  const t = to || from
  if (from.length === 4) return from === t ? `${from}年` : `${from}年–${t}年`
  if (from.length === 7) {
    const a = ymText(+from.slice(0, 4), +from.slice(5, 7))
    if (from === t) return a
    return `${a}–${t.slice(0, 4) === from.slice(0, 4) ? `${+t.slice(5, 7)}月` : `${+t.slice(0, 4)}年${+t.slice(5, 7)}月`}`
  }
  const a = dayText(from)
  if (from === t) return a
  const b = t.slice(0, 7) === from.slice(0, 7) ? `${+t.slice(8, 10)}日`
    : t.slice(0, 4) === from.slice(0, 4) ? `${+t.slice(5, 7)}月${+t.slice(8, 10)}日`
    : `${+t.slice(0, 4)}年${+t.slice(5, 7)}月${+t.slice(8, 10)}日`
  return `${a}–${b}`
}
// 合同两类按户数,其余按行(抄表、台账在清单和记录里也写「行」,同稿)
const unitOf = (key: string) => (TYPE[key]?.unit === '户' ? '户' : '行')

// ── 页头的月 ────────────────────────────────────────────
// 期间深链(SIDEBAR-UX-REDESIGN §4.2):?p=YYYY-MM 定页头的月,co 是台账小窗的缺省公司。只有年的链接(?p=YYYY)不认。
// 读一次即可(产出方要 tabs.openFresh('import') 再 push,KeepAlive 缓存实例不再读 query,与 PoolLedgerView 同口径)。
const parsed = parsePeriod(route.query as Record<string, unknown>)
const deep = parsed?.month != null ? parsed : null
// 缺省 = 上个月:月初导的是上个月的数(稿上 10 月里看的是 9 月)
const ym = ref(deep ? `${deep.year}-${pad2(deep.month!)}` : addMonth(`${new Date().getFullYear()}-${pad2(new Date().getMonth() + 1)}`, -1))

// ── 这个月有没有(coverage) ───────────────────────────────
type Cov = Record<string, ImportCoverageDTO>
const cov = ref<Cov | null>(null)
const covYm = ref('')   // cov 是哪个月的
const covErr = ref(false)
let covSeq = 0
const fetchCov = (m: string): Promise<Cov> => importLogApi.coverage(m).then(list => Object.fromEntries(list.map(c => [c.key, c])))
async function loadCov() {
  const my = ++covSeq
  const m = ym.value
  try {
    const c = await fetchCov(m)
    if (my === covSeq) { cov.value = c; covYm.value = m; covErr.value = false }
  } catch {
    if (my === covSeq) { cov.value = null; covErr.value = true }
  }
}
// 换月不清空:新数到之前状态格、组头数空着(不让上个月的状态顶着这个月的名头),
// 入口胶囊按上个月的留着,新数到了一次换上 —— 胶囊不消失
watch(ym, () => { void loadCov() })
const fresh = computed(() => cov.value != null && covYm.value === ym.value)
const ymOf = (v: string) => ymText(+v.slice(0, 4), +v.slice(5, 7))

const isMiss = (k: string) => !!cov.value?.[k]?.missing
const missCount = computed(() => visibleTypes.value.filter(t => isMiss(t.key)).length)

// 「还差 N 样」点开 = 贴着胶囊的问题面板(用户 2026-10-11 定;原稿 ix-v2-filter 的筛选态作废:
// 胶囊带 ▾ 却是筛清单,筛出来的行又不写缺什么)。一样一行写这个月缺什么,点一行直接导;清单不动。
const alertOpen = ref(false)
const CO_KEYS = new Set(['ledger', 'report_is', 'report_bs', 'report_tb'])
/** 面板一行的右半句:cov 是哪个月就按哪个月说(换月取数中胶囊和面板还是上个月的) */
function missText(key: string): string {
  const c = cov.value?.[key]
  if (!c) return ''
  if (c.kind === 'chips') {
    const all = c.chips ?? []
    const miss = all.filter(x => !x.done)
    if (!all.length) return CO_KEYS.has(key) ? '还没有启用的公司' : '还没有期区'   // 新园区:不是这个月没数
    return CO_KEYS.has(key) && miss.length > 1 && miss.length === all.length ? `${miss.length} 家都没有` : `${miss.map(x => x.label).join('、')}没有`
  }
  if (c.kind === 'day') return c.upTo ? `只到 ${dayText(c.upTo)}` : '没有'
  if (c.kind === 'year') return `${covYm.value.slice(0, 4)}年没有`
  if (c.kind === 'month') return `${ymOf(covYm.value)}没有`
  return '没有'
}
const alertGroups = computed<AlertGroup[]>(() => [{
  key: 'miss', title: `${ymOf(covYm.value)}还差这几样`, desc: '点一行打开这一样的导入。',
  // 和清单同一个先后(两列五组、组内照 registry)
  items: GROUPS.flat().flatMap(g => visibleTypes.value.filter(t => t.group === g && isMiss(t.key))).map(t => {
    // 胶囊类只缺一家 / 一个期区:带上它,同点橙胶囊(台账选好那家、抄表补问选好那个区)
    const miss = (cov.value?.[t.key]?.chips ?? []).filter(x => !x.done)
    const code = CHIP_ACT.has(t.key) && miss.length === 1 ? miss[0].code : undefined
    return { text: t.name, hint: missText(t.key), onClick: () => { alertOpen.value = false; void openImport(t, code) } }
  }),
}])

// 公司 / 期区的名字(导入记录「导到哪」用):公司胶囊 code = 公司 id,期区胶囊 code = p1… / 附表10 的 1..4。
// 攒着不清:导入记录不按页头的月筛,换月取数中 / 取数失败时记录里的公司名、期区名也不能跟着掉
const labelOf = ref(new Map<string, string>())
watch(cov, (c) => {
  if (!c) return
  const m = new Map(labelOf.value)
  for (const k of ['ledger', 'report_is', 'report_bs', 'report_tb']) for (const x of c[k]?.chips ?? []) m.set(`co:${x.code}`, x.label)
  for (const k of ['meter', 's10']) for (const x of c[k]?.chips ?? []) m.set(`z:${x.code}`, x.label)
  labelOf.value = m
})

// ── 清单:两列五组(组名、组内顺序照 registry;右列不随左列空掉往左挪) ──
const GROUPS: ImportGroup[][] = [['出账 · 每月工序', '记账 · 按月', '记账 · 按年'], ['账簿与报表', '档案']]
interface RowView {
  key: string; name: string; desc: string; icon: string; entry: ImportTypeEntry
  chips: (ImportCoverageChip & { act: boolean })[]
  dot: { k: 'ok' | 'miss' | 'na'; text: string } | null
  lastLine: string                                   // 窄:「上次 10月8日」/「从没导过」
  last: { d: string; who: string } | null           // 宽(ix-v2-wide):日期 / 谁 · N 行
}
// 橙胶囊能点(K3):台账开选目标小窗,抄表 / 附表10 / 三大报表直接开导入弹窗
const CHIP_ACT = new Set(['ledger', 'meter', 's10', 'report_is', 'report_bs', 'report_tb'])
function rowOf(t: ImportTypeEntry): RowView {
  const c = fresh.value ? cov.value?.[t.key] : undefined
  const dot = (miss: boolean, text: string) => ({ k: miss ? 'miss' as const : 'ok' as const, text })
  let st: Pick<RowView, 'chips' | 'dot'> = { chips: [], dot: null }
  if (c?.kind === 'chips' && !c.chips?.length) st = { chips: [], dot: dot(c.missing, '没有') }
  else if (c?.kind === 'chips') st = { chips: (c.chips ?? []).map(x => ({ ...x, act: !x.done && CHIP_ACT.has(t.key) })), dot: null }
  else if (c?.kind === 'day') st = { chips: [], dot: dot(c.missing, c.upTo ? `到 ${dayText(c.upTo)}` : '没有') }
  // 录到的月不早于所选月却还缺 = 所选月那一行没有(附表7 只有 10–12 月、选 1 月):写「1月没有」,写「到 12月」读着像齐了
  else if (c?.kind === 'month') st = { chips: [], dot: dot(c.missing, c.missing && c.upTo && c.upTo >= ym.value ? `${ymOf(ym.value)}没有`
    : c.upTo ? `到 ${ymOf(c.upTo)}` : '没有') }
  else if (c?.kind === 'year') st = { chips: [], dot: dot(c.missing, c.has ? `${ym.value.slice(0, 4)}年已有` : '没有') }
  else if (c?.kind === 'has') st = { chips: [], dot: dot(c.missing, c.has ? '有' : '没有') }
  else if (c?.kind === 'na') st = { chips: [], dot: { k: 'na', text: '不按月' } }
  const l = c?.last
  return {
    key: t.key, name: t.name, desc: t.desc, icon: t.icon, entry: t, ...st,
    lastLine: !c ? '' : l ? `上次 ${mdOf(l.at)}` : '从没导过',
    last: l ? { d: mdOf(l.at), who: `${l.operator || '—'} · ${n0(l.rows)} ${unitOf(t.key)}` } : null,
  }
}
const columns = computed(() => GROUPS.map(gs => gs.map(name => {
  const all = visibleTypes.value.filter(t => t.group === name)
  // 组头:n/m(齐的 / 全部);状态没到先空着
  const count = !fresh.value ? '' : `${all.filter(t => !isMiss(t.key)).length}/${all.length}`
  return { name, rows: all.map(rowOf), count }
}).filter(g => g.rows.length)))

// 宽到放得下第四列时「上次导入」单列(ix-v2-wide,1920 那块):按清单自己的宽判断,导航收起 / 展开都算。
// 1400 = 两列各 690:名字一列还剩 ~170,放得下最长的「合同 · 月度租金工作簿」
const WIDE_AT = 1400
const colsEl = ref<HTMLElement | null>(null)
const wide = ref(false)
const ro = typeof ResizeObserver !== 'undefined'
  ? new ResizeObserver(es => { wide.value = (es[0]?.contentRect.width ?? 0) >= WIDE_AT })
  : null
watch(colsEl, (el, old) => {
  if (old) ro?.unobserve(old)
  if (el) ro?.observe(el)
})
onBeforeUnmount(() => ro?.disconnect())

// ── 打开某类导入 ────────────────────────────────────────
const importing = ref(false)
const activeKey = ref<string | null>(null)
const ctx = ref<ImportCtx>({})
// 胶囊带进来的缺省值(K3):附表10 的期区号、园区抄表的期区 code
const openArgs = ref<{ phase?: number; zone?: string }>({})
// 账册模板缓存(§3 现行版全局生效:导入中心的列匹配也必须跟现行版,不退静态种子表 —— 审查#25/#29)
let ledgerBooks: Book[] | null = null
let s10Books: Book[] | null = null

async function openImport(entry: ImportTypeEntry, code?: string) {
  activeKey.value = entry.key
  // 页头那个月是这次导入的缺省月(抄表补问的月份、三大报表导到哪个月、损益附表认不出年时的年)
  ctx.value = { year: +ym.value.slice(0, 4), month: +ym.value.slice(5, 7) }
  openArgs.value = {}
  if (entry.key === 's10') {
    if (!s10Books) s10Books = await booksApi.list('s10').catch(() => null)
    if (s10Books) ctx.value.bookDefs = Object.fromEntries(s10Books.filter(b => b.phase != null).map(b => [b.phase!, b.definition]))
    if (code) openArgs.value = { phase: +code }
  }
  // 期区清单喂 meter sheet 名反查与补问框的区选项(同 MeterView 页内导入同一份 store)
  if (entry.key === 'meter') {
    await zones.ensure()
    ctx.value.zones = zones.list
    if (code) openArgs.value = { zone: code }
  }
  if (entry.key === 'ledger') { await openLedgerForm(code); return }
  if (entry.key.startsWith('charging_')) ctx.value.cats = await chargingApi.cats(Number(entry.key.split('_')[1]))
  importing.value = true
}

// ── 台账选目标小窗(ix-v2-dialog) ─────────────────────────
// 「导入」钮:公司空着(深链带了 co 就用它)、月份 = 页头月;橙胶囊:公司 = 那一家
const ledgerForm = ref(false)
// Esc 关这个小窗(UI-OVERLAY-SPEC:浮层 Esc 只关自己;里面的下拉 / 日期面板开着时它们自己先吃掉 Esc,不冒到这里)
const onLfKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && ledgerForm.value) ledgerForm.value = false }
onMounted(() => window.addEventListener('keydown', onLfKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onLfKey))
const companies = ref<CompanyDTO[]>([])
const lf = ref<{ companyId: number | null; ym: string }>({ companyId: null, ym: ym.value })
const coName = (c: CompanyDTO) => c.short || c.name
const companyOpts = computed(() => companies.value.map(c => ({ value: String(c.id), label: coName(c) })))
const lfCo = computed(() => companies.value.find(c => c.id === lf.value.companyId) ?? null)
async function openLedgerForm(code?: string) {
  if (!companies.value.length) companies.value = await companyApi.list()
  const want = code ? +code : typeof deep?.co === 'number' ? deep.co : null
  lf.value = { companyId: companies.value.some(c => c.id === want) ? want : null, ym: ym.value }
  ledgerForm.value = true
}
// 那家那个月有没有台账:页头那个月直接看清单的胶囊,别的月另问一次(同一个接口、同一套判据)
const lfHas = ref<boolean | null>(null)
let lfSeq = 0
watch([() => lf.value.companyId, () => lf.value.ym, ledgerForm], async () => {
  const my = ++lfSeq
  lfHas.value = null
  const id = lf.value.companyId
  if (!ledgerForm.value || id == null) return
  const pick = (c: Cov | null) => c?.ledger?.chips?.find(x => x.code === String(id))?.done ?? null
  if (lf.value.ym === ym.value && fresh.value) { lfHas.value = pick(cov.value); return }
  try {
    const c = await fetchCov(lf.value.ym)
    if (my === lfSeq) lfHas.value = pick(c)
  } catch { /* 问不到就不写这句 */ }
})
const lfNote = computed(() => {
  const c = lfCo.value
  if (!c || lfHas.value == null) return ''
  const when = ymText(+lf.value.ym.slice(0, 4), +lf.value.ym.slice(5, 7))
  return lfHas.value ? `${coName(c)} ${when}已有台账，文件里有的列会盖掉旧数。` : `${coName(c)} ${when}还没有台账。`
})
async function confirmLedger() {
  const c = lfCo.value
  if (!c) return
  if (!ledgerBooks) ledgerBooks = await booksApi.list('ledger').catch(() => null)
  ctx.value = {
    companyId: c.id, companyName: c.name, year: +lf.value.ym.slice(0, 4), month: +lf.value.ym.slice(5, 7),
    companyNames: companies.value.map(x => x.name),   // 整册拆段的 sheet 名识别用
    // 现行版模板(§3):列匹配与模板列跟账册;导入中心无列映射面板宿主,未匹配列由 registry 整批拦并指去台账页处置(§4 兜底口径)
    bookDef: ledgerBooks?.find(b => b.companyId === c.id)?.definition,
  }
  ledgerForm.value = false
  importing.value = true
}

// ── 导入弹窗 ────────────────────────────────────────────
const activeEntry = computed<ImportTypeEntry | null>(() => (activeKey.value ? TYPE[activeKey.value] ?? null : null))
type ModalBind = ReturnType<typeof parserProps> & { defaultYear?: number; defaultMonth?: number; defaultPhase?: number; retarget?: () => void }
// 空对象兜底仅为类型占位:模板 v-if="importing && activeEntry" 保证渲染时必有 activeEntry
// 和各屏同一条路(parserProps):标题、sub、规矩、小样表、单位、台账的核对页预检(月份对不上二选一、会盖掉几家)都从这里来
const modalBind = computed<ModalBind>(() => {
  const e = activeEntry.value
  if (!e) return {} as ModalBind
  const pp = parserProps(e.key, ctx.value)
  const a = openArgs.value
  const fb = pp.fallbackPicker as Record<string, unknown> | undefined
  return {
    defaultYear: ctx.value.year, defaultMonth: ctx.value.month,   // 缺省月 = 页头月(或台账小窗选的月)
    ...pp,
    ...(a.phase ? { defaultPhase: a.phase } : {}),
    ...(a.zone && fb ? { fallbackPicker: { ...fb, zone: a.zone } } : {}),
    ...(e.key === 'ledger' ? { retarget: backToLedgerForm } : {}),   // 「导到 … 改」:回到选公司 / 月份的小窗
  }
})
function backToLedgerForm() {
  importing.value = false
  ledgerForm.value = true
}

// 导完「去 X 看」(X = registry.landing):从这次的第一个落点拼深链;看不了那一屏就不出(RBAC v3:查看不可提权)
const viewTo = ref<ImportViewLink | null>(null)
const goLabel = computed(() => (viewTo.value && activeEntry.value ? `去${activeEntry.value.landing}看` : undefined))
// 导完先把新数取好放着,关窗那一刻再换上(动效板 ⑤:关窗瞬间 → 计数瞬间换、胶囊 320ms、行亮 2s 都在人眼前发生)
type Snap = { cov: Cov; ym: string; rec: ImportLogPageDTO }
let staged: Snap | null = null
let ran = false
let justDone: { key: string; logIds: number[] } | null = null

// 导入弹窗的 runner(UI-OVERLAY-SPEC §8):弹窗不关,写 + 记 import_log;失败交给弹窗的失败卡。
// ctx 带上 _run:附表10 逐段画真进度、断了从断的那段接着导。
async function runEntry(payload: ImportPayload, fileName: string, p?: ImportRunProgress): Promise<ImportOutcome | null> {
  const e = activeEntry.value
  if (!e) return null
  viewTo.value = null
  ran = true
  // 台账核对页选了「改成导到文件里的那个月」:写进那个月、导入记录也记那个月(不是小窗里选的月)
  const c: ImportCtx = p?.ym ? { ...ctx.value, year: +p.ym.slice(0, 4), month: +p.ym.slice(5, 7) } : ctx.value
  const { res, logIds } = await runImport(e.key, payload, { ...c, _run: p }, fileName)
  // target 在 run 之后取(台账整册、三大报表的公司 id 那时才认完),第一个落点就是「去看」的那一屏那一期
  const t = e.target(c, payload)[0]
  const link = t && res.imported > 0 ? e.viewLink({ ...t, status: 'complete' } as ImportLogDTO) : null
  viewTo.value = link && canViewPage(link.path, auth.can) ? link : null
  justDone = { key: res.imported > 0 ? e.key : '', logIds }
  return settle(res, p, async () => { staged = await fetchAll() })
}
function onModalClose() {
  importing.value = false
  if (!ran) return
  ran = false
  const s = staged
  const d = justDone
  staged = null; justDone = null
  void (s ? Promise.resolve(s) : fetchAll()).then(applyAll, () => {}).then(() => { if (d) flash(d.key || null, d.logIds) })
}
function goView() {
  const to = viewTo.value
  importing.value = false
  ran = false; staged = null; justDone = null   // 切走了:回来时 onReactivated 重读,不亮
  if (to) go(to)
}
// 页面里的链接 = 全新实例、新页签紧挨本页右边(openDeep,TAB-BAR-SPEC §2),导入中心不被换掉。
// 要全新实例:附表6 / 7 / 8 / 11 的 ?mode=、办公·三期水电的 ?tab= 只在 setup 读一次,复用活着的页签就落不到那本账
// (同分析屏点进录入屏;那一屏正在编辑时 openFresh 不换实例,只切过去,不冲掉没保存的改动)。
function go(to: ImportViewLink) {
  tabs.openDeep(to.path.slice(1))
  void router.push(to)
}
const canHome = computed(() => canViewPage('/data-home', auth.can))

// ── 行高亮(T9):导进去的那一行 + 新记录行浅蓝底 2s 褪(motion.css .fp-row-flash) ──
const flashRow = ref<string | null>(null)
const flashLogs = ref<number[] | null>(null)
let active = true
function flash(key: string | null, ids: number[]) {
  // 同一行连亮两次也要重播:先摘掉类,下一帧再挂(写法照 PoolLedgerView gotoDiff)
  flashRow.value = null; flashLogs.value = null
  void nextTick(() => {
    if (!active) return
    const onPage = new Set((rec.value?.rows ?? []).map(r => r.id))
    const lit = ids.filter(id => onPage.has(id))
    flashRow.value = key
    flashLogs.value = lit.length ? lit : null
  })
}
function onRowFlashEnd(e: AnimationEvent) { if (e.animationName === 'fp-row-flash') flashRow.value = null }
// KeepAlive 停用时动画只发 cancel 不发 end,类留着的话回来又闪一次;停用期间取回的新数也不亮(回来时 onReactivated 重读)
onDeactivated(() => { active = false; flashRow.value = null; flashLogs.value = null })
onActivated(() => { active = true })

// ── 导入记录 ────────────────────────────────────────────
const TABS = [{ k: 'all', label: '全部' }, { k: 'partial', label: '要核对' }, { k: 'rejected', label: '被拒' }]
const tab = ref<'all' | 'partial' | 'rejected'>('all')
// 去处 = 导进去的那一屏(写权的屏前缀;预算写权挂在导入中心上,屏是预算对比)。同一屏的几类合并筛(附表11 + 园区电费模型)
const PAGE_LABEL: Record<string, string> = Object.fromEntries(fpAllPages().map(p => [p.value, p.label]))
const screenOf = (t: ImportTypeEntry) => (t.key === 'budget' ? 'budget' : t.module[0].split(':')[0])
const DESTS = [...IMPORT_TYPES.reduce((m, t) => m.set(screenOf(t), [...(m.get(screenOf(t)) ?? []), t.key]), new Map<string, string[]>())]
  .map(([value, keys]) => ({ value, label: PAGE_LABEL[value] ?? value, keys }))
const destOpts = [{ value: '', label: '全部去处' }, ...DESTS.map(d => ({ value: d.value, label: d.label }))]
const dest = ref('')
const page = ref(1)
const recWrap = ref<HTMLElement | null>(null)
const pageSize = useFitRows(recWrap, 56, 8, 8)
const rec = ref<ImportLogPageDTO | null>(null)
const recErr = ref('')
const filtered = computed(() => tab.value !== 'all' || !!dest.value)
const pageCount = computed(() => Math.max(1, Math.ceil((rec.value?.total ?? 0) / pageSize.value)))
const query = (p: number) => ({
  page: p, size: pageSize.value,
  status: tab.value === 'all' ? undefined : tab.value,
  dataType: DESTS.find(d => d.value === dest.value)?.keys,
})
// seq:连切页签 / 翻页时只认最后一次请求;每页行数变了才重拉(同 SystemLogsView)
let recSeq = 0
let lastSize = 0
async function loadRec() {
  const my = ++recSeq
  lastSize = pageSize.value
  try {
    const r = await importLogApi.page(query(page.value))
    if (my !== recSeq) return
    rec.value = r
    recErr.value = ''
  } catch (e) {
    if (my !== recSeq) return
    rec.value = null
    recErr.value = (e as { message?: string })?.message || '服务异常'
  }
}
watch([tab, dest], () => { page.value = 1; void loadRec() })
watch(pageSize, (n) => { if (n !== lastSize) { page.value = 1; void loadRec() } })
function goPage(n: number) { page.value = n; void loadRec() }

async function fetchAll(): Promise<Snap> {
  const m = ym.value
  const [c, r] = await Promise.all([fetchCov(m), importLogApi.page(query(1))])
  return { cov: c, ym: m, rec: r }
}
// 导完回来:清单与计数原地换(不清空,胶囊才有橙 → 灰那一下),记录回第一页(新记录在最上面)
function applyAll(s: Snap) {
  covSeq++; recSeq++
  cov.value = s.cov; covYm.value = s.ym; covErr.value = false
  page.value = 1; rec.value = s.rec; recErr.value = ''
}
onMounted(() => { void loadCov(); void loadRec() })
// KeepAlive 切回重读(别的屏导完 / 删掉的,回来要是新的)
onReactivated(() => { void loadCov(); void loadRec() })

// 结果列:N 行 /「N 行 · M 行要核对」(琥珀)/「被拒 · 原因」(红,没有去看)
function linkOf(r: ImportLogDTO): ImportViewLink | null {
  const l = TYPE[r.dataType]?.viewLink(r) ?? null
  return l && canViewPage(l.path, auth.can) ? l : null
}
const isPaste = (r: ImportLogDTO) => !r.fileName || r.fileName === '（粘贴）'
const recCols: SortableColumn<ImportLogDTO>[] = [
  { key: 'createdAt', header: '时间', width: 100, mono: true, sortable: false,
    render: (r) => h('span', { class: 'ix-time' }, r.createdAt.slice(5, 16).replace('T', ' ')) },
  { key: 'dest', header: '导到哪', width: 230, sortable: false, render: (r) => {
    const per = [perText(r.periodFrom, r.periodTo),
      r.companyId != null ? labelOf.value.get(`co:${r.companyId}`) : '',
      r.zone ? labelOf.value.get(`z:${r.zone}`) : ''].filter(Boolean)
    return h('span', null, [
      h('span', { class: 'ix-dest' }, TYPE[r.dataType]?.name ?? r.typeLabel),
      per.length ? h('span', { class: 'ix-per' }, ` · ${per.join(' · ')}`) : null,
    ])
  } },
  { key: 'fileName', header: '来源', width: 190, sortable: false, render: (r) => isPaste(r)
    ? h('span', { class: 'ix-src paste' }, [h(Clipboard, { size: 14 }), h('span', null, '粘贴')])
    : h('span', { class: 'ix-src' }, [h(iconFor('file-spreadsheet'), { size: 14 }),
        withDirectives(h('span', { class: 'ix-fn' }, r.fileName), [[vTip, r.fileName]])]) },
  { key: 'result', header: '结果', width: 170, sortable: false, render: (r) => {
    if (r.status === 'rejected') {
      const t = r.note ? `被拒 · ${r.note}` : '被拒'
      return withDirectives(h('span', { class: 'ix-res bad' }, t), [[vTip, t]])
    }
    const u = unitOf(r.dataType)
    return h('span', { class: 'ix-res' }, [`${n0(r.ok)} ${u}`, r.warn > 0 ? h('span', { class: 'ix-w' }, ` · ${n0(r.warn)} ${u}要核对`) : null])
  } },
  { key: 'operator', header: '谁导的', width: 48, sortable: false, render: (r) => h('span', { class: 'ix-who' }, r.operator || '—') },
  { key: 'go', header: '', align: 'right', sortable: false, end: true, render: (r) => {
    const l = linkOf(r)
    return l ? h('button', { type: 'button', class: 'ix-go', onClick: (e: MouseEvent) => { e.stopPropagation(); go(l) } },
      ['去看 ', h(iconFor('arrow-right'), { size: 12 })]) : ''
  } },
]
</script>

<template>
  <div class="ix fp-fluid">
    <!-- 页头:标题 + 月份 + ‹ › + 入口胶囊(只读态只剩标题) -->
    <div class="ix-head">
      <h2 class="ix-title">导入中心</h2>
      <template v-if="!readOnly">
        <span class="ix-pd"><DatePicker mode="month" size="sm" :model-value="ym" aria-label="月份" @update:model-value="ym = $event" /></span>
        <button class="ix-nav" type="button" aria-label="上个月" @click="ym = addMonth(ym, -1)"><component :is="iconFor('chevron-left')" :size="15" /></button>
        <button class="ix-nav" type="button" aria-label="下个月" @click="ym = addMonth(ym, 1)"><component :is="iconFor('chevron-right')" :size="15" /></button>
        <!-- 还差 N 样(点了弹问题面板)/ 都齐了灰「无待导入」不可点、位置不动(同一颗胶囊同尺寸) -->
        <span v-if="cov" class="ix-alert">
          <FPAlertPanel v-if="missCount" v-model:open="alertOpen" :count="missCount" label="还差" unit="样" :groups="alertGroups" />
          <FPAlertChip v-else :count="0" quiet-label="无待导入" disabled />
        </span>
      </template>
    </div>

    <template v-if="!readOnly">
      <FPLoadError v-if="covErr" @retry="loadCov">这个月各样数据有没有，没读到</FPLoadError>
      <div v-else ref="colsEl" class="ix-cols" :class="{ 'is-wide': wide }">
        <div v-for="(col, ci) in columns" :key="ci" class="ix-col">
          <section v-for="g in col" :key="g.name" class="ix-grp">
            <div class="ix-gh">{{ g.name }}<span class="n">{{ g.count }}</span></div>
            <div class="ix-rows">
              <div v-for="r in g.rows" :key="r.key" class="ix-row" :data-key="r.key"
                   :class="{ 'fp-row-flash': flashRow === r.key }"
                   @animationend="onRowFlashEnd" @animationcancel="onRowFlashEnd">
                <span class="ix-ico"><component :is="iconFor(r.icon)" :size="15" /></span>
                <div class="ix-nm">
                  <div class="ix-name">{{ r.name }}</div>
                  <div class="ix-desc">{{ r.desc }}</div>
                </div>
                <div v-if="wide" class="ix-last">
                  <template v-if="r.last"><span class="d">{{ r.last.d }}</span><span>{{ r.last.who }}</span></template>
                  <span v-else>{{ r.lastLine }}</span>
                </div>
                <div class="ix-st">
                  <span class="ix-st1">
                    <!-- 胶囊同一个元素从橙变灰(320ms),所以能点的也不换成 button -->
                    <span v-for="c in r.chips" :key="c.code" class="ix-chip" :class="{ miss: !c.done, act: c.act }"
                          :role="c.act ? 'button' : undefined" :tabindex="c.act ? 0 : undefined"
                          @click="c.act && openImport(r.entry, c.code)" @keydown.enter="c.act && openImport(r.entry, c.code)">{{ c.label }}</span>
                    <span v-if="r.dot" class="ix-dot" :data-k="r.dot.k">{{ r.dot.text }}</span>
                  </span>
                  <span v-if="!wide && r.lastLine" class="ix-lst">{{ r.lastLine }}</span>
                </div>
                <div class="ix-act">
                  <Button variant="outline" size="sm" @click="openImport(r.entry)">
                    <template #leading><component :is="iconFor('upload')" :size="14" /></template>导入
                  </Button>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </template>
    <!-- 只读态(ix-v2-ro):锁头 + 一句 + 灰字 + 去本月出账 -->
    <div v-else class="ix-empty">
      <span class="ix-eico"><component :is="iconFor('lock')" :size="20" /></span>
      <div class="ix-et">这个账号只能看导入记录</div>
      <div class="ix-es">要导数据，请管理员在角色里勾上那一屏的「编辑」</div>
      <Button v-if="canHome" variant="outline" size="sm" @click="go({ path: '/data-home', query: {} })">去本月出账看进度</Button>
    </div>

    <!-- 导入记录:近 30 天,不按页头的月筛;定高布局链(页根 min-height:100% → 卡片 flex:1 → 表格区)量出每页几行 -->
    <section class="ix-card">
      <div class="ix-ch">
        <span class="ix-ct">导入记录</span>
        <FPPhaseTabs v-model="tab" :tabs="TABS" :counts="rec?.counts" />
        <span class="ix-sp" />
        <span class="ix-sel"><Select v-model="dest" :options="destOpts" size="sm" aria-label="去处" /></span>
        <span class="ix-30">近 30 天</span>
      </div>
      <!-- 空 / 加载 / 失败都留在 wrap 里(它是 useFitRows 的量高锚点);没到先按每页行数画骨架行(精确占位,数据落下零位移) -->
      <div ref="recWrap" class="ix-tw">
        <FPLoadError v-if="recErr" :sub="recErr" @retry="loadRec">导入记录没读到</FPLoadError>
        <FPEmpty v-else-if="rec && !rec.rows.length" size="sm">{{ filtered ? '这个筛选下近 30 天没有导入记录' : '近 30 天还没有导入记录' }}</FPEmpty>
        <FPSortableTable v-else :columns="recCols" :rows="rec?.rows ?? []" row-key="id" :skeleton-rows="rec ? 0 : pageSize"
                         :flash-key="flashLogs" @flash-end="flashLogs = null" />
      </div>
      <div v-if="rec && rec.rows.length" class="mx-pagerbar">
        <FPPager :page="page" :page-count="pageCount" :total="rec.total" @page="goPage" />
      </div>
    </section>
  </div>

  <!-- 台账选目标小窗(ix-v2-dialog):没有三步条 -->
  <div v-if="ledgerForm" class="ix-scrim" @mousedown="ledgerForm = false">
    <div class="app-dlg ix-dlg" role="dialog" aria-modal="true" aria-labelledby="ix-dlg-t" @mousedown.stop>
      <div class="app-dlg-h"><h3 id="ix-dlg-t">导入月度台账：哪家公司、哪个月？</h3></div>
      <div class="ix-dlgb">
        <label>公司
          <Select :options="companyOpts" :model-value="lf.companyId == null ? '' : String(lf.companyId)"
                  placeholder="请选择公司" @update:model-value="lf.companyId = +$event" />
        </label>
        <label>月份
          <DatePicker mode="month" :model-value="lf.ym" aria-label="月份" @update:model-value="lf.ym = $event" />
        </label>
        <p v-if="lfNote" class="ix-dlgn">{{ lfNote }}</p>
      </div>
      <div class="ix-dlgf">
        <Button variant="gray" size="sm" @click="ledgerForm = false">取消</Button>
        <Button variant="filled" size="sm" :disabled="!lfCo" @click="confirmLedger">下一步：选文件</Button>
      </div>
    </div>
  </div>

  <FpImportModal
    v-if="importing && activeEntry"
    v-bind="modalBind"
    :runner="runEntry"
    :segmented="activeKey === 's10'"
    :go="goLabel"
    @go="goView"
    @close="onModalClose"
  />
</template>

<style scoped>
/* 数值照抄画板 ix-v2-*.dc.html(视觉词汇来自产品组件) */
.ix { display:flex; flex-direction:column; gap:20px; width:100%; min-height:100%; box-sizing:border-box; }
.ix svg { max-width:none; flex:none; }
.ix-head { display:flex; align-items:center; gap:8px; min-height:36px; flex-wrap:wrap; }
.ix-title { margin:0 8px 0 0; font-size:var(--fs-h2); font-weight:var(--fw-semibold); color:var(--text-primary); }
.ix-pd { flex:0 0 124px; }
.ix-nav { display:inline-flex; align-items:center; justify-content:center; width:32px; height:32px; box-sizing:border-box; border:1px solid var(--border-subtle); border-radius:var(--radius-sm); background:var(--surface-white); color:var(--text-secondary); cursor:pointer; padding:0; }
.ix-nav:hover { background:var(--surface-card); }
.ix-alert { margin-left:8px; display:inline-flex; }
.ix-head :deep(.fac.quiet:disabled) { cursor:default; }

/* 清单:两列五组 */
.ix-cols { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); gap:20px; align-items:start; }
.ix-col { display:flex; flex-direction:column; gap:16px; min-width:0; }
.ix-grp { display:flex; flex-direction:column; gap:8px; }
.ix-gh { display:flex; align-items:baseline; gap:8px; font-size:var(--fs-micro); font-weight:var(--fw-semibold); color:var(--text-secondary); }
.ix-gh .n { font-family:var(--font-mono); font-weight:var(--fw-regular); color:var(--text-muted); }
.ix-rows { border:1px solid var(--border-subtle); border-radius:var(--radius-sm); overflow:hidden; background:var(--surface-white); }
.ix-row { display:flex; align-items:center; gap:10px; height:52px; padding:0 12px; border-bottom:1px solid var(--border-subtle); box-sizing:border-box; }
.ix-row:last-child { border-bottom:none; }
.ix-ico { width:28px; height:28px; border-radius:var(--radius-sm); background:var(--accent-slate); display:grid; place-items:center; color:var(--ink-900); flex:none; }
.ix-nm { flex:1 1 auto; min-width:0; }
.ix-name { font-size:var(--fs-body); font-weight:var(--fw-medium); color:var(--text-primary); line-height:20px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ix-desc { font-size:var(--fs-micro); line-height:16px; color:var(--text-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.ix-last { flex:0 0 190px; display:flex; flex-direction:column; font-size:var(--fs-micro); line-height:16px; color:var(--text-muted); white-space:nowrap; }
.ix-last .d { color:var(--text-secondary); }
.ix-st { flex:0 0 172px; display:flex; flex-direction:column; align-items:flex-start; justify-content:center; gap:2px; }
.ix-st1 { display:flex; align-items:center; gap:4px; }
.ix-lst { font-size:var(--fs-micro); line-height:16px; color:var(--text-muted); white-space:nowrap; }
/* 胶囊:齐的灰、缺的橙;变齐那一下 320ms(动效板 ⑤「水电」从橙变回普通) */
.ix-chip { display:inline-flex; align-items:center; height:22px; padding:0 8px; box-sizing:border-box; border-radius:var(--radius-full); border:1px solid var(--border-subtle); background:var(--surface-card); font-size:var(--fs-micro); color:var(--text-secondary); white-space:nowrap;
  transition:background-color var(--dur-slow) var(--ease-standard), border-color var(--dur-slow) var(--ease-standard), color var(--dur-slow) var(--ease-standard); }
.ix-chip.miss { border-color:var(--status-warning); background:var(--warn-soft); color:var(--warn-text); }
.ix-chip.act { cursor:pointer; }
.ix-dot { display:inline-flex; align-items:center; gap:6px; font-size:var(--fs-label); color:var(--text-secondary); white-space:nowrap; }
.ix-dot::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--hue-blue); }
.ix-dot[data-k="miss"] { color:var(--warn-text); }
.ix-dot[data-k="miss"]::before { background:var(--status-warning); }
.ix-dot[data-k="na"] { color:var(--text-muted); }
.ix-dot[data-k="na"]::before { display:none; }
.ix-act { flex:0 0 64px; display:flex; justify-content:flex-end; }

/* 只读态空态卡 */
.ix-empty { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; min-height:200px; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); text-align:center; padding:24px 16px; box-sizing:border-box; }
.ix-eico { width:40px; height:40px; border-radius:50%; background:var(--surface-card); display:grid; place-items:center; color:var(--text-muted); margin-bottom:4px; }
.ix-et { font-size:var(--fs-body); font-weight:var(--fw-medium); color:var(--text-primary); }
.ix-es { font-size:var(--fs-label); color:var(--text-muted); margin-bottom:8px; }

/* 导入记录卡:flex 1 吃满剩下的高;表格区 basis = 留白 10 + 表头 ~29 + 8 行 × 56 —— 至少放得下 8 行,放不下由外层滚 */
.ix-card { flex:1 0 auto; display:flex; flex-direction:column; border:1px solid var(--border-subtle); border-radius:var(--radius-lg); background:var(--surface-white); overflow:hidden; }
.ix-ch { display:flex; align-items:center; gap:14px; padding:10px 12px 10px 16px; border-bottom:1px solid var(--divider); flex-wrap:wrap; }
.ix-ct { font-size:var(--fs-h4); font-weight:var(--fw-semibold); color:var(--text-primary); }
.ix-ch :deep(.fp-phasetab) { height:28px; padding:0 14px; font-size:var(--fs-label); }
.ix-ch :deep(.fp-phasetab .ct) { font-size:var(--fs-micro); }
.ix-sp { flex:1; }
.ix-sel { width:130px; }
.ix-30 { font-size:var(--fs-micro); color:var(--text-muted); }
.ix-tw { flex:1 0 490px; min-height:490px; overflow:hidden; padding-top:10px; display:flex; flex-direction:column; }
.ix-tw :deep(.ix-time) { font-size:var(--fs-label); color:var(--text-muted); }
.ix-tw :deep(.ix-dest) { font-size:var(--fs-label); font-weight:var(--fw-medium); color:var(--text-primary); }
.ix-tw :deep(.ix-per), .ix-tw :deep(.ix-who) { font-size:var(--fs-label); color:var(--text-secondary); }
.ix-tw :deep(.ix-src) { display:inline-flex; align-items:center; gap:6px; font-size:var(--fs-label); color:var(--text-secondary); }
.ix-tw :deep(.ix-src svg) { color:var(--text-muted); max-width:none; flex:none; }
.ix-tw :deep(.ix-src.paste) { color:var(--text-muted); }
.ix-tw :deep(.ix-fn) { max-width:260px; overflow:hidden; text-overflow:ellipsis; }
.ix-tw :deep(.ix-res) { display:inline-block; max-width:320px; overflow:hidden; text-overflow:ellipsis; vertical-align:middle; font-size:var(--fs-label); color:var(--text-secondary); }
.ix-tw :deep(.ix-res .ix-w) { color:var(--warn-text); }
.ix-tw :deep(.ix-res.bad) { color:var(--hue-red); }
.ix-tw :deep(.ix-go) { display:inline-flex; align-items:center; gap:3px; padding:0; border:none; background:none; font-family:var(--font-sans); font-size:var(--fs-micro); color:var(--text-link); cursor:pointer; }
.ix-tw :deep(.ix-go svg) { max-width:none; flex:none; }

/* 台账选目标小窗:卡片用全站 .app-dlg(App.vue),遮罩同改前 */
.ix-scrim { position:fixed; inset:0; z-index:320; background:var(--scrim); display:grid; place-items:center; }
.ix-dlg { width:min(432px, 92vw); }
.ix-dlgb { display:flex; flex-direction:column; gap:14px; padding:16px 22px 4px; }
.ix-dlgb label { display:flex; flex-direction:column; gap:6px; font-size:var(--fs-label); color:var(--text-secondary); }
.ix-dlgn { margin:0; font-size:var(--fs-label); color:var(--text-muted); }
.ix-dlgf { display:flex; justify-content:flex-end; gap:10px; padding:18px 22px 20px; }

/* 窄屏(稿没画,沿用现有响应式,只保证不横向滚):两列叠成一列;手机上行内容换行、高度链改自然流 */
@media (max-width: 960px) { /* M↓ */
  .ix-cols { grid-template-columns:minmax(0,1fr); }
}
@media (max-width: 600px) { /* S */
  .ix { min-height:0; }
  .ix-row { flex-wrap:wrap; height:auto; padding:8px 12px; row-gap:6px; }
  .ix-nm { flex-basis:calc(100% - 38px); }
  .ix-st { flex:1 1 auto; }
  .ix-st1 { flex-wrap:wrap; }
  .ix-card { flex:0 0 auto; }
  .ix-tw { flex:0 0 auto; min-height:0; overflow:visible; }
}
</style>
