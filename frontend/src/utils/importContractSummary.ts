// 「园区租户租金合同明细汇总(2024年3月).xlsx」解析器 —— 合同期限四件套 + 计费行整组,一户一行上 /contracts/import-full。
// 三 sheet 分工(剖析实证):
//   「明细」648 数据行 = 一行一费项 → 计费行唯一来源(1:1 出 BillingLine,按 (租户,位置) 聚成标的段);
//   「汇总」146 数据行 = 一行一租户 → 只取期限四件套(AD起/AE止/AF类型/AG原文)+AH阶梯价+AI备注,并用 AB 月费用合计对账;
//   「未提取及特殊」15 户 = 空置/无期限说明,不参与导入(其中 10 户同时在汇总里 AD 空,报告标「期限待人工补」)。
// 为什么以明细为准:汇总宽表每户只有 22 个费用列,同户多张通知单会被折叠;明细长表逐费项 1:1 无折叠。
// 清洗规则(剖析实证,逐条落地):
//   ① 费项别名归一:电梯维保费/变压器维保费/「土地使用税、房产税」;
//   ② 明细 7 行「收费项目」为空(押金/保证金/冲减,非计费项)→ 行级错误跳过,不静默丢;
//   ③ 12 户 AD 空(relative 2 户「自竣工验收次日起计九年」+ 未提取 10 户)→ 起止留空,remark 标「期限待人工补」;
//   ④ 同名跨期户(李李/广联各 2 行)按「期 + 企业全称」为键,绝不按简称合并;
//   ⑤ 无前缀泛项(租金/企业管理服务费/基础设施维护费)按同 (租户,位置) 组的租金行类型归属,组内无租金行 → factory 兜底;
//      非租金费项(电梯/变压器/土地使用税)同样继承组主类型,门禁/网络钉死 dorm,其他费用不带段类型。
// 金额口径:有「单价(元/㎡)」→ per_sqm_month(面积×单价);否则 per_month + 月单价直填月额(不反推单价,不造精度)。
// 多租期(AF=multiple,25 户)裁定落地(2026-07-24):AG 原文抓所有日期对 →
//   「连续段」(前段止 +1~2 天 = 后段起)成串 = A 类真续签 → terms[] 上抛,后端拆成续签链;
//   非连续 = B 类多标的并存 → 不拆,期限只取「覆盖 2024-03 的那段」(多段覆盖取最长),其余段起止落 remark。
//   计费行恒挂「覆盖 2024-03 的那段」(明细长表就是当期执行价);该段之前的古老周期丢弃,原文仍整段留在 termText。
import type { FeeKey, PropertyType, BillingLineImport } from '@/types/contract'
import { PINNED_FEES, COND_FEES, OPTIONAL_FEES, RENT_KEY_OF, feeLabel } from '@/types/contract'

export const CONTRACT_FULL_TEMPLATE_COLS =
  ['期', '租户简称', '企业全称', '物业位置', '计费行数', '明细月合计', '租赁期限', '期限类型']

// 类型钉死允许集 = PINNED ∪ COND ∪ OPTIONAL(镜像后端 ContractService.ALLOWED_FEES;枚举唯一事实源在 types/contract)。
// other 不属任何类型 → 该费项恒不带 propertyType(后端 propertyType 空即跳过钉死校验)。
const ALLOWED = Object.fromEntries(
  (Object.keys(PINNED_FEES) as PropertyType[]).map(p =>
    [p, new Set<FeeKey>([...PINNED_FEES[p], ...COND_FEES[p], ...OPTIONAL_FEES])]),
) as Record<PropertyType, Set<FeeKey>>

const FEE_ALIAS: Record<string, string> = {
  电梯维保费: '电梯维护费', 变压器维保费: '变压器维护费', '土地使用税、房产税': '土地使用税',
}
const PT_PREFIX: [string, PropertyType][] =
  [['厂房', 'factory'], ['办公室', 'office'], ['宿舍', 'dorm'], ['商铺', 'shop'], ['空地', 'land']]
const PHASE_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5 }
const TERM_TYPES = ['explicit', 'multiple', 'relative', 'none']
const TERM_PENDING = '期限待人工补'

// ── 契约形状(逐字对齐后端 ContractFullImportRequest.Row;type 而非 interface,以便直接当 ImportRec 上抛) ──
export type ContractFullLine = BillingLineImport & { propertyType: PropertyType | null }
export type ContractTerm = { startDate: string; endDate: string; text: string; amountNote: string | null }
export type ContractFullRow = {
  tenantName: string; tenantFullName: string; phase: number | null; buildingHint: string
  startDate: string | null; endDate: string | null
  termText: string | null; termType: string | null
  tierPriceNote: string | null; remark: string | null
  terms?: ContractTerm[]          // 长度 >1 才出:A 类续签链(升序,[0] = 挂计费行的当期)
  lines: ContractFullLine[]
}
export type ContractReportRow = {
  phase: string; tenantName: string; tenantFullName: string
  lineCount: number; segments: number; term: string; termType: string
  detailTotal: number; summaryTotal: number | null; diff: number; issues: string
}
export interface ContractRowError { rowIndex: number; label: string; reason: string }
export interface ContractParseResult {
  rows: ContractFullRow[]; report: ContractReportRow[]; errors: ContractRowError[]; error?: string
}

const nz = (v: unknown): string => String(v ?? '').replace(/\s/g, '')
const num = (v: unknown): number | null => {
  const s = String(v ?? '').replace(/[,，¥￥\s]/g, '')
  if (s === '' || s === '-') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const r2 = (n: number): number => Math.round(n * 100) / 100 + 0   // +0 把 -0 归正(差异列显示/断言用)
const isRent = (k: FeeKey): boolean => k.startsWith('rent_')

/** 费项原文 → (段类型前缀, 费项枚举);'RENT' = 无前缀泛称租金,待按组主类型定型。未识别返回 null。 */
export function mapFeeItem(raw: string): { pt: PropertyType | null; key: FeeKey | 'RENT' } | null {
  const n = FEE_ALIAS[nz(raw)] ?? nz(raw)
  if (n === '') return null
  const hit = PT_PREFIX.find(([p]) => n.startsWith(p))
  const pt = hit ? hit[1] : null
  const body = hit ? n.slice(hit[0].length) : n
  switch (body) {
    case '租金': return { pt, key: pt ? RENT_KEY_OF[pt] : 'RENT' }
    case '企业管理服务费': return { pt, key: 'mgmt' }
    case '基础设施维护费': return { pt, key: 'infra' }
    case '电梯维护费': return { pt, key: 'elevator' }
    case '变压器维护费': return { pt, key: 'transformer' }
    case '门禁设施维护费': return { pt: 'dorm', key: 'access' }
    case '网络通讯费': return { pt: 'dorm', key: 'network' }
    case '土地使用税': return { pt, key: 'land_tax' }
    case '其他费用': return { pt: null, key: 'other' }
    default: return null
  }
}

// ── 多租期解析(AF=multiple) ────────────────────────────────────────
// yyyy年M月d日 / yyyy.M.d / yyyy-MM-dd(「日」可缺,张木兰「2026年11月14」);金额里的小数不会误命中(需两侧都有日期分隔符)
const DATE_RE = /(\d{4})\s*[年.\-/]\s*(\d{1,2})\s*[月.\-/]\s*(\d{1,2})\s*日?/g
const ANCHOR_FROM = '2024-03-01', ANCHOR_TO = '2024-03-31'   // 明细长表 = 2024-03 执行期
const CONT_MAX_GAP = 2      // 前段止 +1~2 天 = 后段起 → 判「连续段」(真续签)
// ponytail: 短于 90 天的日期对 = 签订日/移交日噪声(三龙 2022-06-24 签订→07-24 移交),真租期最短也按年计
const MIN_TERM_DAYS = 90
const pad2 = (n: number) => String(n).padStart(2, '0')
const dayDiff = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000
const trimSep = (s: string) => s.replace(/^[\s;；,，。、:：/]+|[\s;；,，。、:：/]+$/g, '')

/** AG 原文 → 按出现序两两成对的租期段(噪声对丢弃);text = 该段原文切片,amountNote = 段后带「元」的尾注。 */
export function parseTerms(raw: string): ContractTerm[] {
  const hits: { iso: string; at: number; end: number }[] = []
  for (const m of raw.matchAll(DATE_RE)) {
    const y = +m[1], mo = +m[2], d = +m[3]
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue
    hits.push({ iso: `${y}-${pad2(mo)}-${pad2(d)}`, at: m.index!, end: m.index! + m[0].length })
  }
  const out: ContractTerm[] = []
  for (let i = 0; i + 1 < hits.length; i += 2) {
    const a = hits[i], b = hits[i + 1]
    if (dayDiff(a.iso, b.iso) < MIN_TERM_DAYS) continue      // 含 止<起 的坏对
    const textEnd = hits[i + 2] ? hits[i + 2].at : raw.length
    const tail = trimSep(raw.slice(b.end, textEnd))
    out.push({
      startDate: a.iso, endDate: b.iso,
      text: trimSep(raw.slice(a.at, textEnd)),
      amountNote: /\d[\d.,]*\s*元/.test(tail) ? tail : null,
    })
  }
  return out
}

/** 多租期分流:chain[0] = 覆盖 2024-03 的那段(计费行挂它),chain 其余 = 该段之后的续签期;
 *  renewal = 主串本身是连续续签串(A 类;chain 长度可能仍为 1——前期是已结束的古老周期,如李富全);
 *  others = 主串之外的并存标的段(B 类的兄弟标的 / A 类的补充协议),起止落 remark。无段覆盖 2024-03 → null。 */
export function splitMultiTerm(raw: string):
  { chain: ContractTerm[]; others: ContractTerm[]; renewal: boolean } | null {
  const terms = parseTerms(raw)
  if (!terms.length) return null
  const runs: ContractTerm[][] = [[terms[0]]]
  for (let i = 1; i < terms.length; i++) {
    const gap = dayDiff(terms[i - 1].endDate, terms[i].startDate)
    if (gap >= 1 && gap <= CONT_MAX_GAP) runs[runs.length - 1].push(terms[i])
    else runs.push([terms[i]])
  }
  // 选主串:含覆盖段的 run 里取最长(旭化成主合同 4 期串 > 空地补充协议单段),再同长取覆盖段跨度最大
  let best: { run: ContractTerm[]; idx: number; span: number } | null = null
  for (const run of runs) {
    const idx = run.findIndex(t => t.startDate <= ANCHOR_TO && t.endDate >= ANCHOR_FROM)
    if (idx < 0) continue
    const span = dayDiff(run[idx].startDate, run[idx].endDate)
    if (!best || run.length > best.run.length || (run.length === best.run.length && span > best.span))
      best = { run, idx, span }
  }
  if (!best) return null
  // 主串里覆盖段之前的古老周期整段丢弃(不建合同、不进 remark,原文仍在 termText)
  return {
    chain: best.run.slice(best.idx),
    others: terms.filter(t => !best!.run.includes(t)),
    renewal: best.run.length > 1,
  }
}

interface RawLine {
  loc: string; item: string; pt: PropertyType | null; key: FeeKey | 'RENT'
  area: number | null; unit: number | null; monthly: number | null; actual: number | null; note: string | null
}
interface Bucket { phase: string; short: string; full: string; byLoc: Map<string, RawLine[]> }

// 表头按「以关键词开头」定位列(不认列号,汇总册 37 列/明细 12 列都按名字取)
const colOf = (header: string[], key: string): number => header.findIndex(h => nz(h).startsWith(key))
const pickSheet = (sheets: { name: string; matrix: string[][] }[], key: string) =>
  sheets.find(s => (s.matrix[0] ?? []).some(c => nz(c).startsWith(key)))

export function parseContractWorkbook(sheets: { name: string; matrix: string[][] }[]): ContractParseResult {
  const empty = { rows: [], report: [], errors: [] }
  const detail = pickSheet(sheets, '收费项目')
  if (!detail) return { ...empty, error: '未找到「明细」表(表头需含「收费项目」列)' }
  const summary = pickSheet(sheets, '期限类型')
  if (!summary) return { ...empty, error: '未找到「汇总」表(表头需含「期限类型」列)' }

  const dh = detail.matrix[0] ?? []
  const D = {
    phase: colOf(dh, '期'), short: colOf(dh, '租户'), full: colOf(dh, '企业全称'), loc: colOf(dh, '物业'),
    item: colOf(dh, '收费项目'), area: colOf(dh, '面积'), unit: colOf(dh, '单价'),
    monthly: colOf(dh, '月单价'), actual: colOf(dh, '本月应收'), note: colOf(dh, '备注'),
  }
  if (D.short < 0 || D.full < 0 || D.loc < 0 || D.item < 0)
    return { ...empty, error: '「明细」表缺列:需含 租户/企业全称/物业名称/收费项目' }
  const sh = summary.matrix[0] ?? []
  const S = {
    phase: colOf(sh, '期'), short: colOf(sh, '租户'), full: colOf(sh, '企业全称'), loc: colOf(sh, '物业'),
    total: colOf(sh, '月费用合计'), start: colOf(sh, '租赁期限起'), end: colOf(sh, '租赁期限止'),
    type: colOf(sh, '期限类型'), text: colOf(sh, '期限原文'), tier: colOf(sh, '分年阶梯价'), remark: colOf(sh, '合同期备注'),
  }
  if (S.full < 0 || S.start < 0 || S.end < 0 || S.type < 0 || S.text < 0)
    return { ...empty, error: '「汇总」表缺列:需含 企业全称/租赁期限起/租赁期限止/期限类型/期限原文' }

  const errors: ContractRowError[] = []
  const cell = (row: string[], c: number): string => (c < 0 ? '' : String(row[c] ?? '').trim())

  // ── 明细长表 → 按「期+企业全称」分桶(④ 同名跨期不合并),桶内按位置分组 ──
  const buckets = new Map<string, Bucket>()
  detail.matrix.slice(1).forEach((row, i) => {
    const full = cell(row, D.full), short = cell(row, D.short)
    if (!full && !short) return
    const rowIndex = i + 2                       // Excel 行号(1 表头)
    const label = `${cell(row, D.phase)}·${short || full}`
    const item = cell(row, D.item)
    if (!item) {                                 // ② 押金/保证金/冲减行:无收费项目 → 跳过并报错
      errors.push({ rowIndex, label, reason: `收费项目为空,跳过(${cell(row, D.loc) || '无位置'})` })
      return
    }
    const m = mapFeeItem(item)
    if (!m) { errors.push({ rowIndex, label, reason: `费项无法归一到 13 枚举: ${item}` }); return }
    const key = `${nz(cell(row, D.phase))}\u0000${full}`
    let b = buckets.get(key)
    if (!b) { b = { phase: cell(row, D.phase), short, full, byLoc: new Map() }; buckets.set(key, b) }
    const loc = nz(cell(row, D.loc)) || '主'
    const arr = b.byLoc.get(loc) ?? []
    arr.push({
      loc, item, pt: m.pt, key: m.key,
      area: num(row[D.area]), unit: num(row[D.unit]),
      monthly: num(row[D.monthly]), actual: num(row[D.actual]),
      note: cell(row, D.note) || null,
    })
    b.byLoc.set(loc, arr)
  })

  // ── 汇总宽表 → 期限四件套索引(同键) ──
  const terms = new Map<string, string[]>()
  for (const row of summary.matrix.slice(1)) {
    const full = cell(row, S.full)
    if (!full) continue
    terms.set(`${nz(cell(row, S.phase))}\u0000${full}`, row)
  }

  const rows: ContractFullRow[] = []
  const report: ContractReportRow[] = []
  for (const [key, b] of buckets) {
    const issues: string[] = []
    const lines: ContractFullLine[] = []
    let detailTotal = 0
    for (const [loc, raws] of b.byLoc) {
      // ⑤ 组主类型 = 该位置首条租金行的段类型;无租金行 → factory 兜底
      const main = raws.find(r => r.key !== 'RENT' && isRent(r.key as FeeKey))?.pt ?? 'factory'
      for (const r of raws) {
        const feeKey: FeeKey = r.key === 'RENT' ? RENT_KEY_OF[main] : r.key
        let pt: PropertyType | null = feeKey === 'other' ? null : (r.pt ?? main)
        // 原文与上下文标准名不一致(别名/泛称)才留痕,逐字同名不写噪声备注
        const renamed = r.item !== feeLabel(pt, feeKey)
        if (pt && !ALLOWED[pt].has(feeKey)) {    // 钉死集越界(办公室基础设施维护费一类历史组合)→ 去段类型保数据,报告点名
          issues.push(`${r.item}(${loc})不属「${pt}」钉死集,已去段类型待人工归属`)
          pt = null
        }
        const notes = [r.note, renamed ? `原文「${r.item}」` : null].filter(Boolean)
        const sqm = r.unit != null && r.area != null
        const amount = r.monthly ?? r.actual
        lines.push({
          propertyType: pt, location: loc, feeKey,
          area: r.area, unitPrice: sqm ? r.unit : null, coeff: null, roomCount: null,
          billMode: sqm ? 'per_sqm_month' : 'per_month',
          amountOverride: sqm ? null : amount,
          note: notes.length ? notes.join(';') : null,
        })
        if (r.monthly != null) detailTotal += r.monthly
      }
    }

    const t = terms.get(key)
    if (!t) issues.push('汇总表无对应行,期限未导')
    const start = t ? cell(t, S.start) : ''
    const end = t ? cell(t, S.end) : ''
    const typeRaw = t ? cell(t, S.type) : ''
    if (typeRaw && !TERM_TYPES.includes(typeRaw)) issues.push(`期限类型非枚举「${typeRaw}」,已置空`)
    if (!start) issues.push(TERM_PENDING)        // ③ 12 户 AD 空
    const termText = t ? nz(cell(t, S.text)) || null : null

    // 多租期分流:A 类出 terms[](后端拆续签链),B 类只改主期限、其余段落 remark;两类都不再用汇总合成的大区间
    let startDate = start || null, endDate = end || null
    let chain: ContractTerm[] | undefined
    const extraTerms: string[] = []
    if (typeRaw === 'multiple' && termText) {
      const split = splitMultiTerm(termText)
      if (!split) issues.push('multiple 原文未解出覆盖 2024-03 的租期段,起止沿用汇总值')
      else {
        startDate = split.chain[0].startDate
        endDate = split.chain[0].endDate
        if (split.chain.length > 1) {
          chain = split.chain
          issues.push(`A 类续签链 ${split.chain.length} 期(${split.chain.map(x => x.startDate).join('/')})`)
        } else if (split.renewal) {
          issues.push('A 类续签链,覆盖 2024-03 已是末期,古老周期丢弃')
        } else {
          issues.push(`B 类多标的并存 ${split.others.length + 1} 段,期限取主标的 ${startDate}~${endDate}`)
        }
        for (const o of split.others) extraTerms.push(`本标的租期 ${o.startDate}→${o.endDate}`)
      }
    }
    const remark = [t ? cell(t, S.remark) : '', !start ? TERM_PENDING : '', ...extraTerms]
      .filter(Boolean).join(';')
    const summaryTotal = t ? num(t[S.total]) : null
    const phase = PHASE_NUM[nz(b.phase).charAt(0)] ?? null
    if (summaryTotal != null && Math.abs(r2(detailTotal) - summaryTotal) > 0.5)
      issues.push(`与汇总月合计差 ${r2(detailTotal - summaryTotal)} 元`)

    rows.push({
      tenantName: b.short, tenantFullName: b.full, phase,
      buildingHint: t ? nz(cell(t, S.loc)) : [...b.byLoc.keys()].join('；'),
      startDate, endDate,
      termText,
      termType: typeRaw && TERM_TYPES.includes(typeRaw) ? typeRaw : null,
      tierPriceNote: t ? cell(t, S.tier) || null : null,
      remark: remark || null,
      ...(chain ? { terms: chain } : {}),
      lines,
    })
    report.push({
      phase: b.phase, tenantName: b.short, tenantFullName: b.full,
      lineCount: lines.length, segments: b.byLoc.size,
      term: startDate ? `${startDate}~${endDate ?? ''}` : '', termType: typeRaw,
      detailTotal: r2(detailTotal), summaryTotal, diff: summaryTotal == null ? 0 : r2(detailTotal - summaryTotal),
      issues: issues.join(';'),
    })
  }

  // 汇总有、明细无 → 该户无计费行可导(不静默丢,报告点名)
  for (const [key, t] of terms) {
    if (buckets.has(key)) continue
    const [ph, full] = key.split('\u0000')
    report.push({
      phase: ph, tenantName: cell(t, S.short), tenantFullName: full,
      lineCount: 0, segments: 0, term: cell(t, S.start) ? `${cell(t, S.start)}~${cell(t, S.end)}` : '',
      termType: cell(t, S.type), detailTotal: 0, summaryTotal: num(t[S.total]), diff: 0,
      issues: '明细表无计费行,未导入',
    })
    errors.push({ rowIndex: 0, label: full, reason: '明细表无计费行,未导入' })
  }
  return { rows, report, errors }
}

export function contractReportCsv(rows: ContractReportRow[]): string {
  const head = ['期', '租户简称', '企业全称', '计费行数', '位置段数', '租赁期限', '期限类型', '明细月合计', '汇总月合计', '差异', '问题']
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const body = rows.map(r => [r.phase, r.tenantName, r.tenantFullName, r.lineCount, r.segments,
    r.term, r.termType, r.detailTotal, r.summaryTotal ?? '', r.diff, r.issues].map(esc).join(','))
  return '﻿' + head.join(',') + '\n' + body.join('\n')
}
