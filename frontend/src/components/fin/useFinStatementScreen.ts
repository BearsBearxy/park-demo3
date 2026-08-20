// 三大报表(利润表 is / 资产负债表 bs / 科目余额表 tb)共用的屏状态机。
// 三屏动线完全同构:L1 选公司 → L1.5 年份门 → L2 月历 → L3 正文;此前各抄一份,
// 一个竞态/加载门的修法要改三处,漏一处就出现「利润表修好了、资产负债表还闪旧数据」。
// 这里只收敛「搬运」部分:公司增删改、年历/本期加载(含竞态守卫)、状态迁移、编辑草稿与 dirty、
// 保存外壳、导入接线。行定义/取值口径/KPI/表格/保存载荷/导出仍留在各屏——数值计算一格都不在这里。
import { ref, computed, onMounted, type Ref } from 'vue'
import { companyApi } from '@/api/ledger'
import { reportApi } from '@/api/report'
import type { CompanyDTO } from '@/types/ledger'
import type { ReportPeriodDTO, ReportSaveRequest } from '@/types/report'
import type { ImportResultDTO } from '@/types/import'
import type { FinCompany } from '@/components/fin/FinCompanyPicker.vue'
import type { FinMonthMeta } from '@/components/fin/FinMonthGrid.vue'
import type { FinDialog } from '@/components/fin/FinDialogs.vue'
import type { ImportRec } from '@/components/import/FpImportModal.vue'
import { useReportYearGate } from '@/components/fin/useReportYearGate'
import { maxSelectableYear } from '@/utils/yearGate'
import { runImport } from '@/utils/importRegistry'
import { finMoney } from '@/utils/finFmt'

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

  // ── 状态机 ───────────────────────────────────────────────
  const companyId = ref<number | 'all' | null>(null)  // null → L1 选公司;'all' → 全部汇总(只读)
  const year = ref(new Date().getFullYear())
  const month = ref<number | null>(null)                // null → L2 月历
  const edit = ref(false)
  const saving = ref(false)
  const maxYear = maxSelectableYear()   // 与年份门区间上界同源(今年+1)

  // ── 数据 ─────────────────────────────────────────────────
  const companies = ref<CompanyDTO[]>([])
  const companiesLoaded = ref(false)                    // L1 首次加载完成前转圈,不闪空网格
  const yearMonths = ref<FinMonthMeta[] | null>(null)   // L2 月历(有数据/预览)
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

  // ── L1 载入公司 ──────────────────────────────────────────
  onMounted(loadCompanies)
  async function loadCompanies() {
    companies.value = await companyApi.list()
    companiesLoaded.value = true
  }

  // ── L2 载入年历 ──────────────────────────────────────────
  // 单公司:reportApi.year;全部汇总:各公司 year 合并(hasData 取或,预览取和)。竞态守卫。
  const showPreview = (v: number) => !opts.zeroPreviewHidden || !!v
  let yearReq = 0
  async function loadYear() {
    if (companyId.value == null) return
    const reqId = ++yearReq
    let metas: FinMonthMeta[]
    if (isAll.value) {
      const all = await Promise.all(companies.value.map(c => reportApi.year(stmt, c.id, year.value)))
      metas = Array.from({ length: 12 }, (_, i) => {
        const m = i + 1
        let hasData = false, preview = 0
        for (const y of all) {
          const mm = y.months.find(x => x.month === m)
          if (mm?.hasData) { hasData = true; preview += mm.netPreview }
        }
        return { month: m, hasData, preview: hasData && showPreview(preview) ? finMoney(preview) : undefined }
      })
    } else {
      const y = await reportApi.year(stmt, companyId.value as number, year.value)
      metas = Array.from({ length: 12 }, (_, i) => {
        const m = i + 1
        const mm = y.months.find(x => x.month === m)
        return {
          month: m, hasData: !!mm?.hasData,
          preview: mm?.hasData && showPreview(mm.netPreview) ? finMoney(mm.netPreview) : undefined,
        }
      })
    }
    if (reqId === yearReq) yearMonths.value = metas
  }

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

  // ── 年份门(公司→年份→月历,同附表) ────────────────────────
  const { yearGated, gateYears, yearCards, gateCurrent, loadGateYears, resetGate, pickYear, backToYearGate } =
    useReportYearGate({
      stmt, companyId, companies, year,
      // period 一并清:否则 yearMonths 加载期间 v-if 链穿透到旧 period,数据表闪现
      onEnterYear: async () => { yearMonths.value = null; period.value = null; await loadYear() },
    })

  // ── 状态迁移 ─────────────────────────────────────────────
  async function pickCompany(id: number | string) {
    companyId.value = id as number
    month.value = null; edit.value = false; yearMonths.value = null; period.value = null
    resetGate()
    await loadGateYears()
  }
  function pickAll() {
    companyId.value = 'all'
    month.value = null; edit.value = false; yearMonths.value = null; period.value = null
    resetGate()
    loadGateYears()
  }
  function goGate() {
    companyId.value = null; month.value = null; edit.value = false
    resetGate()
    loadCompanies()
  }
  async function setYear(y: number) {
    year.value = y
    yearMonths.value = null; period.value = null
    await loadYear()
  }
  async function pickMonth(m: number) {
    month.value = m; edit.value = false; draft.value = {}
    opts.resetLocal(); opts.onPickMonth?.()
    period.value = null
    await loadPeriod()
  }
  function backToMonths() {
    if (edit.value) cancelEdit()
    month.value = null
  }

  // ── 编辑流 ───────────────────────────────────────────────
  function enterEdit() {
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
  function onNewCompany() { dlg.value = { type: 'company', mode: 'new' } }
  function onEditCompany(c: FinCompany) {
    dlg.value = { type: 'company', mode: 'edit', company: c }
  }
  function onDeleteCompany(c: FinCompany) { dlg.value = { type: 'delco', company: c } }
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
      if (companyId.value === d.company.id) goGate()
      else companies.value = await companyApi.list()
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
    companyId, year, month, edit, saving, maxYear,
    companies, companiesLoaded, yearMonths, period, draft, dirty, dlg,
    isAll, company, companyName, finCompanies,
    yearGated, gateYears, yearCards, gateCurrent,
    pickCompany, pickAll, goGate, setYear, pickYear, pickMonth, backToYearGate, backToMonths,
    loadYear, loadPeriod,
    enterEdit, requestCancel, saveConfirm, finishEdit, save, onDiscard,
    onNewCompany, onEditCompany, onDeleteCompany, submitCompany, confirmDelete,
    importing, importResult, importSummary, onImport, requestImport,
  }
}
