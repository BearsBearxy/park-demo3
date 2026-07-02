// 收入核对 DTO — 逐字镜像后端 dto/Recon*.java(P2-E spec §3)。纯派生读模型,前端只渲染。
// 实体键=tenantName(E1 软引用归并);状态三档容差 0.005(E3);onlySide=单侧独有科目(E2)。

export type ReconStatus = 'ok' | 'diff' | 'miss'
export type ReconOnlySide = 'ledger' | 's10'

// 同名科目对照行:两侧 Σ 后比,delta=ledgerAmt−s10Amt;单侧科目另一侧 null 并标 onlySide。
export interface FeeLine {
  key: string
  label: string
  ledgerAmt: number | null
  s10Amt: number | null
  delta: number
  onlySide: ReconOnlySide | null
}

// 台账侧分卡(按管理公司,E4)
export interface LedgerCard {
  companyName: string
  total: number
  fees: Record<string, number>
}

// 附表10 侧分卡(按期区,E4)
export interface S10Card {
  phase: number
  total: number
  fees: Record<string, number>
}

export interface ReconEntity {
  tenantId: number | null      // 匹配上的真实租户;附表10 独有实体为 null
  tenantName: string
  status: ReconStatus
  ledgerTotal: number
  s10Total: number
  diff: number
  marked: boolean              // 处置标记(recon_mark,E5)
  markNote: string | null
  fees: FeeLine[]
  ledgerCards: LedgerCard[]
  s10Cards: S10Card[]
}

export interface ReconMonth {
  year: number
  month: number
  entities: ReconEntity[]      // 无数据月空数组,不 404
}

// 月卡元数据(overview.months 元素)
export interface ReconMonthMeta {
  month: number
  hasData: boolean
  entityCount: number
  okCount: number
  diffCount: number
  missCount: number
}

export interface ReconOverview {
  year: number
  months: ReconMonthMeta[]
}
