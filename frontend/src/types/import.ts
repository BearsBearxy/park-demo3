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
}

// 删除返回体 — 对齐后端 DeleteResultDTO(record)。skipped=跳过的种子行数。
export interface DeleteResultDTO {
  deleted: number
  skipped: number
}
