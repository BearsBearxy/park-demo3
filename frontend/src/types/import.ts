// 共享导入返回体 — 逐字对齐契约/后端 ImportResultDTO / ImportError。
export interface ImportError {
  rowIndex: number
  label: string
  reason: string
}

export interface ImportResultDTO {
  imported: number
  skipped: number
  errors: ImportError[]
  // 抄表导入专有(METER-IMPORT-SPEC §4):逐行匹配依据,结果弹层按 matchBy 分组计数。其余导入器不给。
  matches?: { rowIndex: number; label: string; matchBy: 'code' | 'addr' | 'name' | 'new'; meterId: number }[]
  // 刀G:提示(归属被人工钉住/位置被冻结/疑似重复建档)。这些行**已成功导入**,与 errors 分开渲染。
  notices?: ImportError[]
  // 抄表导入专有(METER-TIMELINE-SPEC §3.2):本批档案改动的批次号(撤销导入用)与档案变化清单
  batchId?: string
  changes?: ImportChange[]
}

// 抄表导入的一条档案变化:一表一字段。field = tenant/buildingId/ownership/area/spot/floorLabel/side/roomNo/
// subName/contractId/status;before/after 是原值(tenant 为企业名称原文,楼栋/合同为 id);
// 影响 from ~ until,until = 这一段最后一个月(含),null = 一直到以后
export interface ImportChange {
  meterId: number
  label: string
  field: string
  before: string | null
  after: string | null
  from: string
  until: string | null
}

// 删除返回体 — 对齐后端 DeleteResultDTO(record)。skipped=跳过的种子行数。
export interface DeleteResultDTO {
  deleted: number
  skipped: number
}
