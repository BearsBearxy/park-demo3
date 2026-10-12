/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
export interface ImportLogDTO {
  id: number
  dataType: string
  typeLabel: string
  fileName: string
  target: string | null
  rows: number
  ok: number
  warn: number
  status: 'complete' | 'partial' | 'rejected'
  operator: string | null
  createdAt: string
  // 导到哪(V141;旧记录全空 → 不出「去看」):月 2026-09 / 日 2026-10-01 / 年 2026。后端恒给(可为 null),可选只为旧测试夹具
  periodFrom?: string | null
  periodTo?: string | null
  companyId?: number | null
  /** 期区:抄表 / 光伏 / 附表11 是 p1/p2/p3/dorm,附表10 是 1..4 */
  zone?: string | null
  /** 被拒原因(后端信封 message) */
  note?: string | null
}
export interface ImportLogReq {
  dataType: string
  typeLabel: string
  fileName: string
  target?: string | null
  rows: number
  ok: number
  warn: number
  status: 'complete' | 'partial' | 'rejected'
  periodFrom?: string | null
  periodTo?: string | null
  companyId?: number | null
  zone?: string | null
  note?: string | null
}

// 导入中心「这个月有没有」(GET /api/import-log/coverage?ym=),每类一条,判据同本月出账。
// kind:chips = 公司 / 期区胶囊;day = 到 X月X日(upTo = YYYY-MM-DD);month = 到 N月(upTo = YYYY-MM);
//      year = N年已有(has);has = 有 / 没有;na = 不按月(合同)
export interface ImportCoverageChip { label: string; code: string; done: boolean }
export interface ImportCoverageDTO {
  key: string
  kind: 'chips' | 'day' | 'month' | 'year' | 'has' | 'na'
  chips?: ImportCoverageChip[]
  upTo?: string
  has?: boolean
  missing: boolean
  /** 上次导入:时间、谁、行数(合同类是户数) */
  last?: { at: string; operator: string | null; rows: number }
}

// 导入记录分页(GET /api/import-log/page):固定近 30 天,同一响应带三个页签的数
export interface ImportLogPageQuery {
  /** 从 1 起 */
  page?: number
  size?: number
  status?: 'partial' | 'rejected'
  /** 同一屏的几类合并筛(如 elec + elecCost) */
  dataType?: string[]
}
export interface ImportLogPageDTO {
  total: number
  rows: ImportLogDTO[]
  counts: { all: number; partial: number; rejected: number }
}
