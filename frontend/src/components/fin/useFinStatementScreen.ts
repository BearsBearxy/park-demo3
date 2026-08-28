// 三大报表(利润表 is / 资产负债表 bs / 科目余额表 tb)共用的屏状态机。
//
// 动线(2026-08-29 改,设计稿 §3.2a):**左栏常驻公司 + 选期矩阵 → 正文**,两层。
// 改前是四层串行:整屏选公司 → 年份门 → 月历 → 正文,而且换个公司看要退回第一屏重走三道门
// (BOOK-WORKBENCH-SPEC §7-2 原文要求实体切换在左栏)。年份门 + 月历合成一张
// BookMonthMatrix,就是 2026-08-24 拍板的「选期矩阵 v3 取代年份 tab」,当时没推到报表层。
// 结果与月度台账、附表10 一模一样:选公司(左栏,常驻)→ 点月格 → 正文。
//
// 三屏动线完全同构;此前各抄一份,
// 一个竞态/加载门的修法要改三处,漏一处就出现「利润表修好了、资产负债表还闪旧数据」。
// 这里只收敛「搬运」部分:公司增删改、年历/本期加载(含竞态守卫)、状态迁移、编辑草稿与 dirty、
// 保存外壳、导入接线。行定义/取值口径/KPI/表格/保存载荷/导出仍留在各屏——数值计算一格都不在这里。
import { ref, computed, watch, onMounted, type Ref } from 'vue'
import { companyApi } from '@/api/ledger'
import { reportApi } from '@/api/report'
import type { CompanyDTO, YearMonthsDTO } from '@/types/ledger'
import type { ReportPeriodDTO, ReportSaveRequest } from '@/types/report'
import type { ImportResultDTO } from '@/types/import'
import type { FinDialog } from '@/components/fin/FinDialogs.vue'
import type { RailItem } from '@/components/fp/BookRail.vue'
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { loadExtraYears, saveExtraYears, buildYearRows } from '@/utils/matrixYears'
import { maxSelectableYear } from '@/utils/yearGate'
import { S } from '@/utils/lockScopes'
import { useEditLock } from '@/composables/useEditLock'
import { runImport } from '@/utils/importRegistry'
import { finMoney } from '@/utils/finFmt'
import { useAuthStore } from '@/stores/auth'

/** 公司的最小形状。原先长在 FinCompanyPicker 上,那个整屏选择器已随四层动线退场。 */
export interface FinCompany { id: number | string; name: string; short?: string }

/** 一个月格:有没有数据 + 一行小字(净额预览)。原先长在 FinMonthGrid 上。 */
export interface FinMonthMeta { month: number; hasData: boolean; preview?: string }

// BookMonthMatrix 的 book 只是「有没有选中的东西」一个比特(见该组件 prop 注释)。
// 模块级常量而非每次渲染新建 {}:身份稳定,不白白触发子组件重渲。
const MATRIX_BOOK = {}

export function useFinStatementScreen(opts: {
  stmt: 'is' | 'bs' | 'tb'
  // 清屏内私有草稿态(选集;tb 还有科目增删计数与科目树回滚)。进出编辑、切月、保存后都走它。
  resetLocal: () => void
  // 零值预览抑制:bs/tb 不存 'cur',后端 netPreview 恒 0,月卡显 ¥0.00 是误导 → 只标「已录入」。
  zeroPreviewHidden?: boolean
  // 本期(读取或保存)到手后的屏内派生:tb 拷科目树工作副本。
  onPeriod?: (p: ReportPeriodDTO) => void
  // 切月时额外要清的屏内视图态(tb 的折叠集与搜索词);不随进出编辑清,故不并入 resetLocal。
  onPickMonth?: () => void
  // 屏内额外「已改处」计数(tb 的科目增删),计入 dirty。
  extraDirty?: Ref<number>
}) {
  const { stmt } = opts

  // 三大报表的录入 = report(RBAC §2)。无权时 L3 正文与 KPI 照常显示,只是没有「编辑模式」入口。
  // 公司增删改是 master 的活,不在这里判 —— 左栏管理区那三个按钮由各屏按 master:edit 自判。
  const auth = useAuthStore()
  const canEdit = computed(() => auth.can('report:edit'))

  // ── 状态机 ───────────────────────────────────────────────
  // null 只在公司清单到手前存在(空库也可能一直是 null);'all' → 全部汇总(只读)
  const companyId = ref<number | 'all' | null>(null)
  const year = ref(new Date().getFullYear())
  const month = ref<number | null>(null)                // null → 选期矩阵;有值 → 正文
  const edit = ref(false)
  const saving = ref(false)
  const maxYear = maxSelectableYear()   // 与年份门区间上界同源(今年+1)

  // ── 数据 ─────────────────────────────────────────────────
  const companies = ref<CompanyDTO[]>([])
  const companiesLoaded = ref(false)                    // L1 首次加载完成前转圈,不闪空网格
  const gateYears = ref<YearMonthsDTO[] | null>(null)   // 本公司有数据的年(矩阵的数据年)
  const yearMetas = ref(new Map<string, FinMonthMeta[]>())  // 分年月格缓存,键 `${公司}:${年}`
  const extraYears = ref<number[]>([])                  // 手工年(localStorage,屏+公司键)
  const period = ref<ReportPeriodDTO | null>(null)      // L3 服务端本期快照(读态源)
  const draft = ref<Record<string, number>>({})         // L3 编辑草稿:key=`${rowKey}|${field}`
  const dlg = ref<FinDialog | null>(null)
  const dirty = computed(() => Object.keys(draft.value).length + (opts.extraDirty?.value ?? 0))

  const isAll = computed(() => companyId.value === 'all')
  const company = computed(() => companies.value.find(c => c.id === companyId.value) ?? null)
  const companyName = computed(() => (isAll.value ? null : company.value?.name ?? null))
  const finCompanies = computed<FinCompany[]>(() =>
    companies.value.map(c => ({ id: c.id, name: c.name, short: c.short })),
  )
  /** 左栏的项:「全部汇总」置顶 + 各公司。公司没有版本,徽标位给「全部汇总」标家数。 */
  const railItems = computed<RailItem[]>(() => [
    { id: 'all', name: '全部汇总', tag: `${companies.value.length} 家` },
    ...companies.value.map(c => ({ id: c.id, name: c.name })),
  ])

  // ── 载入公司 ─────────────────────────────────────────────
  // 进屏自动选中第一家:左栏常驻,「选公司」不再是一道门,没理由让人对着空占位再点一下。
  // 不默认「全部汇总」——那一档要按公司数发 N 倍请求,当默认落点太贵;它在左栏第一项,一点即到。
  onMounted(async () => {
    await loadCompanies()
    if (companyId.value == null && companies.value.length) await pickCompany(companies.value[0].id)
  })
  async function loadCompanies() {
    companies.value = await companyApi.list()
    companiesLoaded.value = true
  }

  // ── L2 载入年历 ──────────────────────────────────────────
  // 单公司:reportApi.year;全部汇总:各公司 year 合并(hasData 取或,预览取和)。竞态守卫。
  const showPreview = (v: number) => !opts.zeroPreviewHidden || !!v
  const metaKey = (y: number) => `${String(companyId.value)}:${y}`
  /** 当前公司当前年的 12 格 —— 正文态回矩阵时它已就绪。 */
  const yearMonths = computed<FinMonthMeta[] | null>(
    () => yearMetas.value.get(metaKey(year.value)) ?? null)

  /** 取某一年的 12 格。单公司直查;全部汇总跨公司合并(hasData 取或,预览取和)。 */
  async function fetchYear(y: number): Promise<FinMonthMeta[]> {
    if (isAll.value) {
      const all = await Promise.all(companies.value.map(c => reportApi.year(stmt, c.id, y)))
      return Array.from({ length: 12 }, (_, i) => {
        const m = i + 1
        let hasData = false, preview = 0
        for (const yy of all) {
          const mm = yy.months.find(x => x.month === m)
          if (mm?.hasData) { hasData = true; preview += mm.netPreview }
        }
        return { month: m, hasData, preview: hasData && showPreview(preview) ? finMoney(preview) : undefined }
      })
    }
    const yy = await reportApi.year(stmt, companyId.value as number, y)
    return Array.from({ length: 12 }, (_, i) => {
      const m = i + 1
      const mm = yy.months.find(x => x.month === m)
      return {
        month: m, hasData: !!mm?.hasData,
        preview: mm?.hasData && showPreview(mm.netPreview) ? finMoney(mm.netPreview) : undefined,
      }
    })
  }

  // 竞态守卫:快速切公司时丢弃先发出但后到达的过期响应
  let yearReq = 0
  /** 只刷当前年(保存 / 导入后用:hasData 与预览会变)。 */
  async function loadYear() {
    if (companyId.value == null) return
    const reqId = ++yearReq
    const key = metaKey(year.value)
    const metas = await fetchYear(year.value)
    if (reqId === yearReq) yearMetas.value = new Map(yearMetas.value).set(key, metas)
  }
  /** 本公司有数据的年份全集(矩阵的数据年)。全部汇总跨公司按年合并。 */
  async function loadGateYears() {
    if (companyId.value == null) return
    const reqId = ++yearReq
    const lists = isAll.value
      ? await Promise.all(companies.value.map(c => reportApi.years(stmt, c.id)))
      : [await reportApi.years(stmt, companyId.value as number)]
    if (reqId !== yearReq) return
    const merged = new Map<number, number>()
    for (const l of lists) for (const y of l) merged.set(y.year, Math.max(merged.get(y.year) ?? 0, y.months))
    gateYears.value = [...merged.entries()].map(([yr, months]) => ({ year: yr, months }))
      .sort((a, b) => a.year - b.year)
  }
  /** 逐数据年并行取月格。不清旧值 —— 回矩阵时旧卡先显、到位原位翻牌(LAYOUT-STABILITY)。 */
  async function loadMatrix() {
    if (companyId.value == null) return
    const reqId = ++yearReq
    const cid = String(companyId.value)
    const years = (gateYears.value ?? []).map(y => y.year)
    const res = await Promise.all(years.map(y => fetchYear(y).catch(() => null)))
    if (reqId !== yearReq) return
    const next = new Map(yearMetas.value)
    res.forEach((metas, i) => { if (metas) next.set(`${cid}:${years[i]}`, metas) })
    yearMetas.value = next
  }

  // ── 矩阵年份行(数据年 ∪ 当前年 ∪ 手工年,连续补满;与台账同一套 utils/matrixYears) ──
  const EXTRA_SCREEN = `report-${stmt}`
  interface MatrixCell { month: number; hasData: boolean; badge?: string; cur?: boolean }
  const matrixYears = computed(() => {
    if (companyId.value == null) return []
    const cur = new Date().getFullYear()
    const cid = String(companyId.value)
    const out = buildYearRows((gateYears.value ?? []).map(y => y.year), cur, extraYears.value).map(r => {
      // 非数据年不看缓存:整年删空后年份降级为手工年,残留概览不得再翻出有数据卡
      const metas = r.manual ? undefined : yearMetas.value.get(`${cid}:${r.year}`)
      const months: MatrixCell[] = Array.from({ length: 12 }, (_, i) => {
        const mm = metas?.[i]
        return { month: i + 1, hasData: !!mm?.hasData, badge: mm?.preview }
      })
      return {
        year: r.year,
        months,
        sub: r.year === cur ? '当前年' : r.manual ? '手工年' : undefined,
        removable: r.manual && extraYears.value.includes(r.year) && months.every(m => !m.hasData),
      }
    })
    // 全年份范围内最近有数据的那一个月描边
    for (let i = out.length - 1; i >= 0; i--) {
      const j = out[i].months.map(m => m.hasData).lastIndexOf(true)
      if (j >= 0) { out[i].months[j].cur = true; break }
    }
    return out
  })
  function setExtra(years: number[]) {
    if (companyId.value == null) return
    saveExtraYears(EXTRA_SCREEN, String(companyId.value), years)
    extraYears.value = loadExtraYears(EXTRA_SCREEN, String(companyId.value))
  }
  function addEarlier() {
    const r = matrixYears.value
    setExtra([...extraYears.value, (r.length ? r[0].year : new Date().getFullYear()) - 1])
  }
  function addLater() {
    const r = matrixYears.value
    setExtra([...extraYears.value, (r.length ? r[r.length - 1].year : new Date().getFullYear()) + 1])
  }
  function removeYear(y: number) { setExtra(extraYears.value.filter(x => x !== y)) }
  /** 矩阵的「已选中」比特:没选公司时为 null,组件显占位。 */
  const matrixBook = computed(() => (companyId.value == null ? null : MATRIX_BOOK))

  // ── L3 载入本期 ──────────────────────────────────────────
  function setPeriod(data: ReportPeriodDTO) {
    period.value = data
    opts.onPeriod?.(data)
  }
  let periodReq = 0
  async function loadPeriod() {
    if (companyId.value == null || month.value == null) return
    const reqId = ++periodReq
    const data = isAll.value
      ? await reportApi.allPeriod(stmt, year.value, month.value)
      : await reportApi.period(stmt, companyId.value as number, year.value, month.value)
    if (reqId === periodReq) setPeriod(data)
  }

  // ── 状态迁移(两层:左栏选公司 → 矩阵点月格 → 正文) ────────
  /** 左栏点一项。'all' = 全部汇总(只读)。编辑态切公司会丢草稿,先问。 */
  async function pickCompany(id: number | string) {
    if (id === companyId.value) return
    if (edit.value && dirty.value > 0 &&
        !window.confirm(`正在编辑本期,切换公司将丢弃 ${dirty.value} 处未保存的修改,继续?`)) return
    companyId.value = (id === 'all' ? 'all' : Number(id))
    month.value = null; edit.value = false; draft.value = {}; period.value = null
    opts.resetLocal()
    gateYears.value = null
    // 月格缓存按公司分键,不清 —— 切回看过的公司旧卡先显、到位原位翻牌
    extraYears.value = loadExtraYears(EXTRA_SCREEN, String(companyId.value))
    await loadGateYears()
    await loadMatrix()
  }
  /** 矩阵点格:年与月一起定(§7-1 明确选期门,pick 自带年份)。 */
  async function pickCell(y: number, m: number) {
    year.value = y; month.value = m; edit.value = false; draft.value = {}
    opts.resetLocal(); opts.onPickMonth?.()
    period.value = null
    await loadPeriod()
  }
  /** 正文态「换期」回矩阵。保存/导入可能让空月转有数据 → 顺手刷一遍。 */
  function backToMatrix() {
    if (edit.value) cancelEdit()
    month.value = null
    // 不 await:竞态守卫已有,旧卡先显后替不闪空
    loadGateYears().then(loadMatrix).catch(() => { /* 拉失败保持旧值,不抛 unhandledrejection */ })
  }

  // ── 编辑锁(CONCURRENCY-SPEC §3.1 B) ──
  // ⚠ 「全部汇总」视图不可写(save() 第一行就 return),S.report 对它返回 null → 不上锁。
  //   给一个存不了盘的视图上锁,只会平白挡住别人。
  const lockScope = () => S.report(stmt, companyId.value, year.value, month.value)
  // 被接管时**只退编辑态,不清草稿** —— 他还要把没保存的东西复制走。
  const lock = useEditLock(() => { edit.value = false }, () => canEdit.value)
  const { lockedBy, evictedBy } = lock
  /** 这一期此刻被谁占着 —— 取自在场表，不用点按钮撞门（设计稿 C-2）。 */
  const heldByOther = lock.watchScope(lockScope)
  // 退出编辑的路有四条(取消/完成/保存成功/换期),用 watch 兜住 —— 漏一条就是一把没人认领的锁。
  watch(edit, (on) => { if (!on) lock.release() })

  // ── 编辑流 ───────────────────────────────────────────────
  async function enterEdit() {
    const sc = lockScope()
    if (sc && !(await lock.acquire(sc))) return
    draft.value = {}; opts.resetLocal(); edit.value = true
  }
  /** 接管成功 → 锁已经是我们的了,直接进编辑态。 */
  async function onTaken() {
    lockedBy.value = null
    const sc = lockScope()
    if (sc) await lock.acquire(sc)
    draft.value = {}; opts.resetLocal(); edit.value = true
  }
  // 裸丢弃。内部调用方(save 成功后、onImport 整期替换后)已确认过或本就该无声丢,
  // 所以确认对话框不放这儿 —— 放这儿会让那两条路径二次弹窗。UI 按钮走下面的 requestCancel。
  function cancelEdit() {
    edit.value = false; draft.value = {}; opts.resetLocal()
  }
  /** 「取消」按钮:有草稿先问。改前一点即弃,整期录入无声消失。 */
  function requestCancel() {
    if (dirty.value > 0 && !window.confirm(`放弃本期 ${dirty.value} 处未保存的修改?`)) return
    cancelEdit()
  }
  // 退出编辑:有改动先弹保存确认,无改动直接退。
  const saveConfirm = ref(false)
  function finishEdit() {
    if (dirty.value > 0) { saveConfirm.value = true; return }
    edit.value = false
  }
  // 保存:屏只给本期载荷(懒构造,与原先「先关确认再算 cells」的时序一致),
  // 其余(saving 闸 / 整期回写 / 清草稿 / 刷月历 / 失败提示)三屏一致。
  async function save(buildBody: () => ReportSaveRequest) {
    if (companyId.value == null || month.value == null || isAll.value) return
    saveConfirm.value = false
    saving.value = true
    try {
      setPeriod(await reportApi.save(stmt, companyId.value as number, year.value, month.value, buildBody()))
      edit.value = false; draft.value = {}; opts.resetLocal()
      await loadYear()  // 刷新月历(hasData/预览)
    } catch (e) {
      alert((e as { message?: string })?.message ?? '保存失败')
    } finally {
      saving.value = false
    }
  }
  function onDiscard() {
    saveConfirm.value = false
    cancelEdit()
  }

  // ── 公司增删改 ────────────────────────────────────────────
  // 左栏管理区的三个动作。原先长在整屏选择器的公司卡上(行内 hover),
  // 那一层退场后改为**作用于当前选中的那一家** —— 左栏高亮的就是它,没有歧义。
  function onNewCompany() { dlg.value = { type: 'company', mode: 'new' } }
  function onEditCompany(c?: FinCompany) {
    const t = c ?? (company.value ? { id: company.value.id, name: company.value.name } : null)
    if (!t) return   // 停在「全部汇总」时无对象可改
    dlg.value = { type: 'company', mode: 'edit', company: t }
  }
  function onDeleteCompany(c?: FinCompany) {
    const t = c ?? (company.value ? { id: company.value.id, name: company.value.name } : null)
    if (!t) return
    dlg.value = { type: 'delco', company: t }
  }
  async function submitCompany(name: string) {
    const d = dlg.value
    if (d?.type !== 'company') return
    try {
      if (d.mode === 'edit' && d.company) {
        await companyApi.rename(Number(d.company.id), name)
      } else {
        await companyApi.create(name)
      }
      dlg.value = null
      companies.value = await companyApi.list()
    } catch (e) {
      alert((e as { message?: string })?.message ?? '保存公司失败')
    }
  }
  async function confirmDelete() {
    const d = dlg.value
    if (d?.type !== 'delco') return
    try {
      await companyApi.remove(Number(d.company.id))
      dlg.value = null
      const gone = companyId.value === d.company.id
      companies.value = await companyApi.list()
      // 删的是当前选中那家 → 左栏还得有个落点(原来退回整屏选择器,那一层已经没有了)
      if (gone) {
        companyId.value = null
        if (companies.value.length) await pickCompany(companies.value[0].id)
      }
    } catch (e) {
      alert((e as { message?: string })?.message ?? '删除公司失败')
    }
  }

  // ── 导入 Excel(合并多公司 → 逐公司段,未匹配公司自动新建)───────
  // 仅单公司 + 已选月可导入(isAll / 未选月由模板按钮禁用兜底)。目标期 = 当前 year/month。
  const importing = ref(false)
  const importResult = ref<ImportResultDTO | null>(null)
  const importSummary = ref('')
  /** 「导入」按钮:草稿会在导入后被整期替换掉(见下方 onImport 里的 cancelEdit),
   *  所以确认必须前移到**打开弹窗之前** —— 原先那句丢弃发生在文件已解析、导入已落库之后,
   *  用户走到那一步已经没有回头路了,等于无声吞掉整期录入。 */
  function requestImport() {
    if (dirty.value > 0 &&
        !window.confirm(`本期有 ${dirty.value} 处修改尚未保存。\n导入会整期替换本期数据,这些修改将丢失。\n\n仍要导入?`)) return
    importing.value = true
  }
  async function onImport(picks: { label?: string; records: ImportRec[] }[], fileName: string) {
    importing.value = false
    if (month.value == null) return
    try {
      importResult.value = await runImport(`report_${stmt}`, picks, { year: year.value, month: month.value }, fileName)
      importSummary.value = picks.map(p => `${p.label ?? ''}:${p.records.length} 行`).join('\n')
      if (edit.value) cancelEdit()                 // 导入=整期替换:先退出编辑(未保存草稿作废)再重拉
      companies.value = await companyApi.list()   // 可能自动新建了公司
      await loadPeriod()                           // 刷新本期(本公司若在导入名单则见新值)
      await loadYear()
    } catch (e) {
      alert((e as { message?: string })?.message ?? '导入失败')
    }
  }

  return {
    canEdit,
    companyId, year, month, edit, saving, maxYear,
    companies, companiesLoaded, yearMonths, period, draft, dirty, dlg,
    isAll, company, companyName, finCompanies,
    railItems, matrixYears, matrixBook, gateYears,
    pickCompany, pickCell, backToMatrix, addEarlier, addLater, removeYear,
    loadYear, loadMatrix, loadPeriod,
    enterEdit, onTaken, lockedBy, evictedBy, heldByOther, lockScope, requestCancel, saveConfirm, finishEdit, save, onDiscard,
    onNewCompany, onEditCompany, onDeleteCompany, submitCompany, confirmDelete,
    importing, importResult, importSummary, onImport, requestImport,
  }
}
