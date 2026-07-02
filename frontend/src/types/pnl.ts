// 损益附表 1–5 DTO — 逐字镜像后端 dto/Pnl*.java(P2-D spec §3)。schedule='s1'..'s5',园区全局无公司维度。
// 月值 null=未录(区分 0);本年合计客端派生(rowYearTotal)不落库;kind 按标签识别仅作分带渲染。

export type PnlKind = 'detail' | 'subtotal' | 'pnl' | 'total'

export interface PnlRowDTO {
  rowKey: string            // 合成 r<n>(整年 clear+insert,无跨年匹配)
  groupLabel: string        // 分组列(区域/科目名称/项目/科目;合并单元格已向下填充)
  label: string             // 科目细分
  kind: PnlKind
  note: string | null
  m: (number | null)[]      // 长度 12(1月..12月),null=未录
  sortOrder: number
}

export interface PnlYearDTO {
  year: number
  rows: PnlRowDTO[]
}

// 年份卡元数据(overview.years 元素,SchedYearGate 用)
export interface PnlYearMeta {
  year: number
  hasData: boolean
  rowCount: number
}

export interface PnlOverviewDTO {
  years: PnlYearMeta[]
}
