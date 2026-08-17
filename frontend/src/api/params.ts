import http from './index'
import type { ParamGroup, ParamMode } from '@/utils/paramRegistry'
import { prevYm } from '@/utils/paramCenterLogic'

// 计费参数中心(S21-PARAM-CENTER-SPEC §6)DTO — 逐字对齐后端 dto/Param*。
// GET=已登录可读,写/重算=ADMIN。列表是「站在 ym 看的全部生效参数行」(四区),后端已做人话解析
// (scopeLabel/valueText/rangeText/sourceChain),前端只分组与渲染(utils/paramCenterLogic)。

export type ParamZone = 'all' | 'p1' | 'p2' | 'dorm'

// = 后端 ParamRowDTO
export interface ParamRowDTO {
  key: string
  label: string
  unit: string
  group: ParamGroup           // 键的主场分区(户级作用域行前端一律归 ④,见 groupRows)
  scope: string               // 行描述的对象:''|p1|p2|dorm|building:{id}|meter:{id}|rule:{id}|tenant:{id}(写回 PUT 用)
  scopeLabel: string          // 人话:全园 / 一期 / A座 / 招商中心净电（池）/ 力美C201电（表）/ 力灏（户）
  value: number | null        // 站在 ym 的生效值(无命中=null,默认语义)
  valueText: string           // 值带单位/枚举字典/表名/布尔句
  mode: ParamMode | null      // 命中行的生效方式(无命中=null)
  acctMonth: string           // 命中行的版本起点(''=初始版本)
  rangeText: string           // 仅 2023-08 / 2023-08 起长期 / 2023-08 ~ 2023-10 / 长期（初始版本）
  sourceChain: string[]       // 命中链每级 `scopeLabel:value`
  formula: string | null
  hint: string | null
  editable: boolean
  monthlyCheck: boolean       // ① 区月核对项
  hasMonthRow: boolean        // 该 (scope,key) 在 ym 有专属 month 行
  rowId: number | null        // 命中行 id(「改错」原地更正需要;无命中=null)
  note: string | null
}

// = 后端 ParamPutReq:value=null 删该版本行;correction=true 改错(原地覆盖当前命中行,不新建版本);mode 缺省=注册表默认
export interface ParamPutReq {
  key: string
  scope: string
  acctMonth?: string | null   // ''=初始版本
  mode?: ParamMode | null
  value: number | null
  note?: string | null
  correction?: boolean | null
}

// = 后端 ParamStatusDTO(状态条 + stale 判据 spec §6.3)
export interface ParamStatusDTO {
  priceOk: number             // 本月电价已配置键数
  priceTotal: number          // 电价键总数(6)
  pendingChanges: number      // 自上次重算起改动条数
  lastChangeAt: string | null
  poolSnapshotAt: string | null   // alloc_pool_result 生成时间(null=本月未生成)
  billBatchAt: string | null      // 催缴单批次时间
  stale: boolean              // 参数晚于快照 → 池/损耗/催缴单为旧结果
  otherMonthsAffected: string[]   // from 版本波及的其它已生成月份
}

// valueText / oldText / newText:值的人话文案(后端与列表行同一格式器:枚举字典 / 布尔状态句 / 引用显名 / 千分位+单位);值空则 null → 页面显「—」
export interface ParamVersionDTO { acctMonth: string; mode: ParamMode; value: number; valueText: string | null; note: string | null; rangeText: string }
export interface ParamChangeDTO {
  ts: string; actor: string; action: 'set' | 'delete' | 'recalc' | 'migrate'
  key?: string; scope?: string; scopeLabel?: string; label?: string
  acctMonth: string; mode: ParamMode; oldValue: number | null; newValue: number | null
  oldText: string | null; newText: string | null; note: string | null
  ym?: string | null          // recalc 动作的账期
}
export interface ParamHistoryDTO { versions: ParamVersionDTO[]; changes: ParamChangeDTO[] }

// = 后端 RecalcResultDTO(池 → 损耗 → 催缴单 三步重生成摘要)
export interface RecalcResultDTO {
  pools: number; lossUnits: number; notices: number; skippedConfirmed: number; warnings: string[]
}

export interface PriceCfgCopyResultDTO { copied: number; skipped: number }

export const paramsApi = {
  // 站在 ym 看的全部生效参数行(四区);zone=all|p1|p2|dorm。
  // scope=作用域前缀 / key=逗号分隔键名 —— 公共电核算/楼栋损耗只读镜像只要几十行,别拉整页几百行
  list: (ym: string, zone: ParamZone = 'all', filter?: { scope?: string; key?: string }): Promise<ParamRowDTO[]> =>
    http.get('/params', { params: { ym, zone, ...filter } }),
  status: (ym: string): Promise<ParamStatusDTO> => http.get('/params/status', { params: { ym } }),
  // 写一行(注册表校验/日志/evict),返回该键站在 ym(缺省 acctMonth)的新生效行(铁律二:只 patch 该行);
  // 页面传自己的账期 ym,回包才与屏上其它行同一账期(删版本行 / 改错时 acctMonth 可能不是页面账期)
  put: (req: ParamPutReq, ym?: string): Promise<ParamRowDTO> => http.put('/params', req, { params: { ym } }),
  history: (key: string, scope: string): Promise<ParamHistoryDTO> =>
    http.get('/params/history', { params: { key, scope } }),
  changes: (ym: string, limit = 200): Promise<ParamChangeDTO[]> =>
    http.get('/params/changes', { params: { ym, limit } }),
  // 池 + 楼栋损耗 + 催缴单重生成(已确认/已导出户跳过并计数)
  recalc: (ym: string): Promise<RecalcResultDTO> => http.post('/params/recalc', null, { params: { ym } }),
  // 「复制上月电价」:仅电价 6 键上月版本 → ym,已有跳过(幂等);走旧 POST /api/price-cfg/copy
  copyPrev: (ym: string): Promise<PriceCfgCopyResultDTO> =>
    http.post('/price-cfg/copy', { fromYm: prevYm(ym), toYm: ym }),
}
