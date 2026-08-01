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
}

// 删除返回体 — 对齐后端 DeleteResultDTO(record)。skipped=跳过的种子行数。
export interface DeleteResultDTO {
  deleted: number
  skipped: number
}
