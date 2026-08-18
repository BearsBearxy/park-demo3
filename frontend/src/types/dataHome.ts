// 数据中心首页 DTOs — 逐字对齐后端 dto/DataHomeOverviewDTO.java(DATA-HOME-REDESIGN spec §3)。
//
// 2026-08-18 重设计:旧契约有 kpis/tasks/recent/progress* 四组字段,但整页把同一批信息说了三遍 ——
// 4 个 KPI 卡里 3 个是下方栏目的重复,而「本期待办」本身是「完整度」的子集(旧后端直接遍历同一个
// sources 生成 tasks)。用户反馈「无从下手、信息量过多、没有主次」即源于此,故整组删除。
//
// 现在只剩两段:chain(出账链,有先后依赖 → 流水线) + schedules(附表,互相独立 → 清单),
// 外加 blockers(前置条,**只在有问题时非空**;空数组时前端整条不渲染)。

export interface DataHomePeriodDTO {
  year: number
  month: number
  label: string   // "YYYY年M月"
}

/** 前置条:合同缺口 / 参数过期。它们不按月完成,不进流水线。 */
export interface DataHomeBlockerDTO {
  kind: 'contract-gap' | 'param-stale'
  text: string
  cta: string
  go: string      // 导航 value
}

export interface DataHomeStepDTO {
  key: string
  label: string
  status: 'done' | 'current' | 'todo'
  detail: string  // 抄表给「已抄 N 块」不给分母(分母口径归抄表屏,见后端头注)
  go: string
}

/** currentIndex = -1 表示 4 步全部完成。 */
export interface DataHomeChainDTO {
  currentIndex: number
  steps: DataHomeStepDTO[]
}

export interface DataHomeItemDTO {
  name: string
  tag: string
  done: boolean
  go: string
}

export interface DataHomeSchedulesDTO {
  done: number
  total: number
  items: DataHomeItemDTO[]
}

export interface DataHomeOverviewDTO {
  period: DataHomePeriodDTO | null   // null = 库里一条数据都没有(全新库)
  months: string[]                   // 顶部下拉可切月份('YYYY-MM' 升序)
  blockers: DataHomeBlockerDTO[]     // 空 = 整条不渲染
  chain: DataHomeChainDTO
  schedules: DataHomeSchedulesDTO
}
