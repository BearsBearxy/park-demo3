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
}
export interface ImportLogOverviewDTO {
  latestByType: ImportLogDTO[]
  history: ImportLogDTO[]
}
