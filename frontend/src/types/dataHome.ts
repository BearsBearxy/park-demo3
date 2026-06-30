// 数据中心首页 DTOs — 逐字对齐后端 dto/DataHome*.java(spec §4)。
// 纯只读聚合屏:所有数字从已建子系统真实数据派生,前端不重算。

export interface DataHomePeriodDTO {
  year: number
  month: number
  label: string   // "YYYY年M月"
}

export interface DataHomeKpiDTO {
  label: string
  value: string
  sub: string
  tint: string    // slate | sky | blue | cyan
  icon: string    // lucide kebab name
}

export interface DataHomeSourceDTO {
  name: string
  tag: string
  status: 'done' | 'missing'
  updated: string   // 'M/d' 或 '—'
  go: string        // 路由 value
}

export interface DataHomeTaskDTO {
  label: string
  meta: string
  cta: string
  go: string
  sev: 'warning' | 'info' | 'danger'
}

export interface DataHomeRecentDTO {
  source: string
  period: string
  time: string      // 'M/d HH:mm'
}

export interface DataHomeOverviewDTO {
  period: DataHomePeriodDTO
  progressDone: number
  progressTotal: number
  pct: number
  kpis: DataHomeKpiDTO[]      // 4 枚
  sources: DataHomeSourceDTO[] // 9 个
  tasks: DataHomeTaskDTO[]
  recent: DataHomeRecentDTO[]  // 6 条
}
