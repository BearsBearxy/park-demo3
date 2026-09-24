import http from './index'
import type { ImportResultDTO } from '../types/import'
import type { MeterOwnership } from '../utils/meterSplit'

// 园区抄表(METER-SPEC)DTO — 逐字对齐后端 dto/Meter* / MeterImportRequest。
// GET=viewer 可读,写=admin。与办公室水电 /api/office 零共享。

export type MeterKind = 'elec' | 'water'
// 值域由后端 /api/zones 数据驱动(p\d+|dorm),不再写死。放宽后编译器不再帮忙查
// 字典下标 —— 所有 label 取值必须走 zoneLabel() 的兜底。
export type MeterZone = string
export type { MeterOwnership }

// 表类型(S2-BIND-SPEC §1 device_type;meter_type 列已被「表类」原文占用故另立):null=未录
export type MeterDeviceType = 'single' | 'three' | 'multi' | 'demand' | 'bidir'
export const DEVICE_TYPE_LABEL: Record<MeterDeviceType, string> = {
  single: '单相', three: '三相', multi: '多功能', demand: '需量', bidir: '双向',
}

export interface MeterDTO {
  id: number
  kind: MeterKind
  zone: MeterZone
  name: string                  // 首列标识名,同区同类唯一
  area: string | null
  spot: string | null
  // V74 位置结构化(楼栋→楼层→方位→房号):稳定标识,分组/排序/池选表走这三列,spot 只留原文与导入身份键
  floorLabel: string | null     // 负一层/一楼…十楼/天面;null=跨层或不适用
  side: string | null           // 东/西/南/北侧
  roomNo: string | null
  // V76 §F6 / V78 §G5:上面三列是否人工设定,**位掩码逐列**——bit0(1)=楼层 / bit1(2)=方位 / bit2(4)=房号。
  // 某位 0=与「位置原文」解析一致 → 导入跟着原文重解析(表挪了地方那一列自动跟上);
  // 1=人工覆盖或显式清空 → 导入该列不动,原文变了只在导入结果里落一条提醒。后端按结果派生,不用前端上报。
  // (可选签名同 suspect:后端恒给,写成可选只为不逼既有测试夹具逐个补)
  locManual?: number
  tenantName: string | null     // 企业名称原文(§6.1 未匹配兜底+对账审计)
  tenantId: number | null       // §6 v2:租户 FK,户内表关联;多命中待核=null
  buildingId: number | null     // §6 v2:楼栋 FK,区域→楼栋映射
  // 所在楼栋的期区(null=没挂楼栋)。和上面的 zone 不同 = 表自己写的期区和它所在的楼对不上。
  // 筛期区看 zone、位置显示看楼栋,两者不一致时表会出现在不对的页签里。
  // 可选=旧测试夹具不带这一格
  buildingZone?: string | null
  ownership: MeterOwnership     // §6 v2:tenant/share/ops/infra/park/register(刀H §H2 计度寄存器,不进任何Σ)
  // V77 §G2:上面两列(ownership/buildingId)是否人工设定。0=自动 → 导入按自动分类照常回写;
  // 1=人工设定 → 导入两列一列不动,判定与人工值不同时在导入结果里落一条提醒。后端按 PUT 结果派生,不用前端上报。
  // (可选签名同 locManual:后端恒给,写成可选只为不逼既有测试夹具逐个补)
  ownerManual?: number
  meterType: string | null
  deviceType: MeterDeviceType | null   // S2 V63:表类型(单相/三相/多功能/需量/双向)
  subName: string | null
  code: string | null
  factor: number                // 倍率
  // ── METER-TIMELINE-SPEC(V129 起):上面的归属 / 位置列都是「站在 ym 看」的那一段;
  //    旧的 retiredYm / activeFromYm / removedYm 三列已删,由下面的状态段取代。until = 本段最后一个月(含),null = 链尾 ──
  status: MeterStatusValue | null   // 该月:在用 / 停用(在册不计)/ 已拆;null = 该月不在册
  statusFrom: string | null
  statusUntil: string | null
  assignFrom: string | null
  assignUntil: string | null
  assignSrc: MeterRowSrc | null
  changedThisMonth: boolean     // 该表在 ym 有自己的归属行或状态行,且与上一行不同(第一行不算)
  tenantManual?: number         // 租户人工设定标记(只锁这一段);可选签名同 locManual
  // METER-TIMELINE-SPEC §10.3 本月册子已核:这块表在 ym 导入的册子里出现过没有;file/at = 该表该月最近一笔。
  // 不带 ym 拉(站在最新看)恒 false / null。(可选签名同 locManual:后端恒给,只为不逼既有测试夹具逐个补)
  bookSeen?: boolean
  bookFile?: string | null
  bookAt?: string | null        // ISO 本地时间,如 2026-09-24T10:30:00
  // V75 §E3/§F1 两级存疑(判据都以「区域/位置/企业名称/编码四项全空」打底):
  //   'shadow'     = 还配到一块档案完整、同 (kind,zone,building_id)、同月上下期示数与倍率全等的表
  //                  → 疑似同一块物理表的第二份档案,红底徽标,后端**不**计入楼栋分表Σ;
  //   'incomplete' = 配不上,只是档案没填全 → 黄底徽标,用量**照常**计入Σ。
  // 在档案抽屉保存一次=认领,后端自动清标。
  // (可选签名:后端恒给该字段,写成可选只为不逼既有测试夹具逐个补 null)
  suspect?: 'shadow' | 'incomplete' | null
  sortNo: number
  readingCount: number
}

// METER-TIMELINE-SPEC §1.3 状态段 / 行来源
export type MeterStatusValue = 'active' | 'retired' | 'removed'
export type MeterRowSrc = 'import' | 'manual' | 'migrate' | 'contract'

// POST /meters 建表:资产 + 自 fromYm 起的归属行与「在用」状态行。factor 空=1。
// 编辑不走这里:资产列 update(MeterAssetReq),归属 assign,状态 setStatus/deleteStatus,合同 bind。
export interface MeterReq {
  kind: MeterKind
  zone: MeterZone
  name: string
  area?: string | null
  spot?: string | null
  // V74:留空/不传=后端按 spot 重解析;显式给值=人工覆盖(后端不记「是否人工改过」,靠调用方带值)
  floorLabel?: string | null
  side?: string | null
  roomNo?: string | null
  tenantName?: string | null
  tenantId?: number | null      // §6 v2
  buildingId?: number | null    // §6 v2
  ownership?: string            // §6 v2:tenant/share/ops/infra/park(表单串型,后端 VARCHAR;空=默认 share)
  meterType?: string | null
  deviceType?: string | null    // S2 V63:表类型
  subName?: string | null
  code?: string | null
  factor?: number | null
  suspect?: '' | 'shadow' | 'incomplete'
  fromYm?: string              // 自这个月起在册(SPEC §3.4「新增表从当前查看月起在册」);不传 = 1900-01(一直在册)
}

// PUT /meters/{id}:只收资产列(不分月)。factor 空=1。
export interface MeterAssetReq {
  kind: MeterKind
  zone: MeterZone
  name: string
  meterType?: string | null
  deviceType?: string | null
  code?: string | null
  factor?: number | null
  // §G5 存疑标的人工入口,三态:不传=保留原标;''=人工解除(「认领为独立表」,重新进Σ);
  // 'shadow'/'incomplete'=人工打标。二态(null=解除)会让任何一个不带该字段的 PUT 顺手把标清掉。
  suspect?: '' | 'shadow' | 'incomplete'
}

// ── METER-TIMELINE-SPEC §3.3 按月改归属(PUT /meters/assign) ──
// correct = 更正 ym 所在的那一段(起始月 F ≤ ym);from = 自 ym 起变更(在 ym 写一行)。F = ym 时两者相同。
export type MeterAssignMode = 'correct' | 'from'
// 只写出现的键;null / '' = 清空(ownership 不能空)。位置三列给了值且与按位置原文解析不同 → 该列人工标记;
// 租户组 / 归属组的值变了 → 该组人工标记
export interface MeterAssignPatch {
  tenantId?: number | null
  tenantName?: string | null
  buildingId?: number | null
  ownership?: MeterOwnership
  area?: string | null
  spot?: string | null
  floorLabel?: string | null
  side?: string | null
  roomNo?: string | null
  subName?: string | null
}
export interface MeterAssignReq {
  ym: string
  mode: MeterAssignMode
  meterIds: number[]            // 同房间的表一起写,各按自己的链定目标行
  patch: MeterAssignPatch
  alsoMigrateCopies: boolean    // 一并更正目标行之后紧挨着的、上线时复制的同一份档案
}
// 真改了的每一行(没变的不列);until = 本段最后一个月(含),null = 链尾
export interface MeterAssignWritten { meterId: number; fromYm: string; until: string | null }

// ── GET /meters/{id}/timeline?ym ──
export interface MeterAssignRow {
  id: number
  meterId: number
  fromYm: string
  tenantId: number | null
  tenantName: string | null
  buildingId: number | null
  ownership: MeterOwnership
  area: string | null
  spot: string | null
  floorLabel: string | null
  side: string | null
  roomNo: string | null
  subName: string | null
  contractId: number | null     // 人工钉的合同,只对这一段有效
  tenantManual: number
  ownerManual: number
  locManual: number
  src: MeterRowSrc
  batchId: string | null
}
export interface MeterStatusRow {
  id: number
  meterId: number
  fromYm: string
  status: MeterStatusValue
  src: MeterRowSrc
  batchId: string | null
}
// 档案每一次写的前后像;row_ref「撤销导入 <batchId>」= 撤销那一次写的
export interface MeterArchiveLogRow {
  id: number
  meterId: number
  tbl: 'assign' | 'status'
  fromYm: string
  action: 'insert' | 'update' | 'delete'
  beforeJson: string | null
  afterJson: string | null
  src: MeterRowSrc
  batchId: string | null
  fileName: string | null
  rowRef: string | null
  operator: string | null
  at: string
}
export interface MeterLockedMonth { ym: string; reason: string }   // SPEC §4 冻结月与人话原因
export interface MeterSpan { from: string; until: string | null; locked: MeterLockedMonth[] }
export interface MeterTimelineDTO {
  assign: MeterAssignRow[]      // 按 fromYm 升序
  status: MeterStatusRow[]
  log: MeterArchiveLogRow[]     // 新的在前
  impact: {
    correct: MeterSpan | null   // ym 早于第一行 / 还没有行时为 null
    from: MeterSpan
    migrateCopies: number
  }
  siblings: { meterId: number; name: string; kind: MeterKind; tenantName: string | null }[]   // 同楼栋同房号、在册未拆
}

// ── SPEC §3.4 状态段 ──
export interface MeterStatusReq {
  fromYm: string
  status: MeterStatusValue
  replaceFromYm?: string        // 把自这个月起的那一行挪到 fromYm(改月;第一行不能删,只能这样改)
}
export interface MeterStatusImpactDTO {
  from: string
  until: string | null
  locked: MeterLockedMonth[]
  readings: { ym: string; usage: number }[]   // 区间里的非零用量月(停用 / 拆除后不再计费);status=active 时为空
  pools: { id: number; name: string }[]       // 这块表所在的公摊池
  contractNo: string | null                   // fromYm 那一段钉的合同
}

// usage* = (curr−prev)×factorSnap 后端派生(缺读数=null);漏抄/倒走/时段不符徽标由 meterLogic 派生
export interface MeterReadingDTO {
  id: number
  meterId: number
  ym: string                    // YYYY-MM
  prevTotal: number | null
  currTotal: number | null
  prevSharp: number | null
  prevPeak: number | null
  prevFlat: number | null
  prevValley: number | null
  currSharp: number | null
  currPeak: number | null
  currFlat: number | null
  currValley: number | null
  factorSnap: number            // 倍率快照;改表倍率不回溯
  usageTotal: number | null
  usageSharp: number | null
  usagePeak: number | null
  usageFlat: number | null
  usageValley: number | null
  note: string | null
  source: 'manual' | 'import'
}

// factor_snap 落库时快照表倍率,req 不带
export interface MeterReadingReq {
  meterId: number
  ym: string
  prevTotal?: number | null
  currTotal?: number | null
  prevSharp?: number | null
  prevPeak?: number | null
  prevFlat?: number | null
  prevValley?: number | null
  currSharp?: number | null
  currPeak?: number | null
  currFlat?: number | null
  currValley?: number | null
  note?: string | null
}

// 导入行:kind/zone/name=档案 upsert 键;ym 逐行自带(整册各 sheet 月份可不同)
export interface MeterImportRow {
  kind: MeterKind
  zone: MeterZone
  name: string
  ym: string
  area?: string
  spot?: string
  tenantName?: string
  tenantId?: number | null      // §6 v2:解析期拆分挂 id,多命中/未命中=null
  buildingId?: number | null    // §6 v2:区域→楼栋映射
  ownership?: MeterOwnership    // §6 v2:归属自动分类
  meterType?: string
  subName?: string
  code?: string
  factor?: number
  prevTotal?: number | null
  currTotal?: number | null
  prevSharp?: number | null
  prevPeak?: number | null
  prevFlat?: number | null
  prevValley?: number | null
  currSharp?: number | null
  currPeak?: number | null
  currFlat?: number | null
  currValley?: number | null
  note?: string
}

// 刀H §H5 按账期批量删除:预览与实删同一形状(后端同一个方法两条路径,数字必然一致)。
// derived=该 ym 四张派生快照表的行数(整月口径,不随 kind/zone 收窄);
// manualKept=保留的手工分摊行点名;meterDeleted=连带删掉的表档案;meterBlocked=池成员或别的月催缴单里还有它、跳过的表档案。
// 级联勾选项,两端点共用;不传=后端默认全开
export interface MeterDeleteOpt {
  cascade?: boolean          // 该月派生快照(池核算/逐表明细/损耗/分摊 gen 行)
  dropEmptyMeters?: boolean  // 删完零读数的表档案(池成员表撞 FK 自动跳过)
  // 连带删该月草稿 / 已作废的催缴单(按户整月出,不分电表水表与期区);不传 = 不删,该月有这类单时后端 409
  dropDraftNotices?: boolean
}

export interface MeterDeleteDTO {
  ym: string
  readings: number
  meters: number
  metersEmptied: number
  derived: number
  manualKept: string[]
  meterDeleted: string[]
  meterBlocked: string[]
  // METER-TIMELINE-SPEC §3.5:连带删掉的本期导入写下的归属行 / 状态行(from = 本期 且来源 = 导入)。
  // (可选签名同 MeterDTO.locManual:后端恒给,写成可选只为不逼既有测试夹具逐个补)
  assignRows?: number
  statusRows?: number
  bookRows?: number          // §10.2 连带删掉的本月「册子里有这块表」记录条数(作用域同读数)
  // 该月的催缴单(2026-09-24):草稿 / 已作废可随 dropDraftNotices 连带删;锁定 = 已确认 / 已导出,>0 时删不了。
  // lockedTenants = 锁定单的户名(去重、全量,屏上只列前 5 户)。可选同上
  draftNotices?: number
  voidNotices?: number
  lockedNotices?: number
  lockedTenants?: string[]
}

// 删一块表前的确认框(GET /meters/{id}/delete-impact):readings / poolBindings(所在公摊池名)非空 = 删不了;
// notices = 明细里有它的催缴单(按月、单号升序,lines = 它在这张单里占几行);
// draftCount = 草稿 + 已作废(勾「同时删掉」随表一起删),lockedCount = 已确认 / 已导出 / 历史签发(要先作废)
export interface MeterDeleteImpactDTO {
  readings: number
  poolBindings: string[]
  notices: { noticeId: number; ym: string; tenantName: string | null; status: string; lines: number }[]
  draftCount: number
  lockedCount: number
}

// ── S2-BIND-SPEC §3:表→合同绑定(读侧派生,按账期月判定) ──
export type BindBucket = 'date_missing' | 'ambiguous' | 'bld_mismatch' | 'no_contract'
export type BindStatus =
  | 'auto' | 'auto_bld'            // 自动归属(候选唯一/楼栋对位唯一)
  // 人工绑定。钉的那份不覆盖 ym 时按月落到同链(递增段/续签)覆盖该月的那一段,仍是 override;
  // stale=链上也没有覆盖该月的段、自动归属同样定不出 —— 警示不静默失效
  | 'override' | 'override_stale'
  | 'manual'                       // 待处理队列(带 bucket 分桶原因)
  | 'pending'                      // 待核:ownership=tenant 且 tenant_id NULL 且原文有意义
  | 'placeholder'                  // 占位槽:原文 NULL/'-'/'（空）'/'已停用',不计入待核收敛

export interface BindCandidateDTO {
  contractId: number
  contractNo: string
  buildingName: string | null
  startDate: string | null
  endDate: string | null
  locations?: string[]             // 费项位置标签「费项名·位置(含单元)」,每 distinct location 一条
}

// rows 每块租户表;candidates 仅 manual 时给(供 UI 选定绑定)
export interface MeterBindingRowDTO {
  meterId: number
  status: BindStatus
  bucket?: BindBucket | null
  contractId?: number | null
  contractNo?: string | null
  /** 人工绑定钉的那份合同号,仅当它没被直接用上时给(本月落到了同链另一段,或退回了自动归属) */
  pinnedContractNo?: string | null
  locations?: string[]             // 绑定合同的费项位置标签;未绑定=[]
  candidates?: BindCandidateDTO[]
  hasReading: boolean
  // METER-TIMELINE-SPEC §3.6:待绑定 / 房号对不上所用合同的行,本月在租、场地房号含这块表房号的他户合同(唯一才给);
  // 屏上「从本月起改归 X」。可选签名:后端恒给(无建议为 null),写成可选只为不逼既有夹具逐个补
  suggestion?: BindSuggestionDTO | null
}

export interface BindSuggestionDTO {
  tenantId: number
  tenantName: string | null
  contractId: number
  contractNo: string
}

// summary=服务端各状态计数;UI 收敛卡用 summarizeBinding(rows) 客户端派生(rows 全量自足,免形状耦合)
export interface MeterBindingDTO {
  summary: Record<string, number>
  rows: MeterBindingRowDTO[]
}

// GET /meters/usage-summary?ym 户×月聚合(S3 输入面):仅 ownership=tenant 且 tenant_id 非空的表
export interface MeterUsageSummaryRowDTO {
  tenantId: number
  tenantName: string
  kind: MeterKind
  meterCount: number
  missingReadings: number
  usageTotal: number | null
  usageSharp: number | null
  usagePeak: number | null
  usageFlat: number | null
  usageValley: number | null
}

export const metersApi = {
  // 站在 ym 看的档案(不传 = 各表最新一行);不在册的表也在内(status=null)。切月必须重拉(SPEC §2)
  list: (kind?: MeterKind, zone?: MeterZone, ym?: string): Promise<MeterDTO[]> =>
    http.get('/meters', { params: { kind, zone, ym } }),
  // 自 fromYm 起在册;这段月份有审核锁 → 423
  create: (req: MeterReq): Promise<MeterDTO> => http.post('/meters', req),
  // 只改资产列;同(kind,zone,name) 重名 409;改倍率只影响之后新录读数
  update: (id: number, req: MeterAssetReq): Promise<MeterDTO> => http.put(`/meters/${id}`, req),
  // ── METER-TIMELINE-SPEC §3.3 §3.4:按月改归属 / 状态。受影响区间有冻结月 → 审核锁 423、其余 409 点名,一行不写 ──
  assign: (req: MeterAssignReq): Promise<MeterAssignWritten[]> => http.put('/meters/assign', req),
  // 「改回按册子」:清掉 ym 所在那一段的三组人工标记(位置三列回到按位置原文解析)
  clearManual: (meterId: number, ym: string): Promise<void> =>
    http.post('/meters/assign/clear-manual', { meterId, ym }),
  timeline: (id: number, ym: string): Promise<MeterTimelineDTO> =>
    http.get(`/meters/${id}/timeline`, { params: { ym } }),
  setStatus: (id: number, req: MeterStatusReq): Promise<void> => http.post(`/meters/${id}/status`, req),
  // 撤回误标;第一行不能删(409),只能 setStatus 带 replaceFromYm 改月
  deleteStatus: (id: number, fromYm: string): Promise<void> => http.delete(`/meters/${id}/status/${fromYm}`),
  statusImpact: (id: number, fromYm: string, status: MeterStatusValue): Promise<MeterStatusImpactDTO> =>
    http.get(`/meters/${id}/status-impact`, { params: { fromYm, status } }),
  deleteImpact: (id: number): Promise<MeterDeleteImpactDTO> => http.get(`/meters/${id}/delete-impact`),
  // 有读数 / 绑公摊池 / 在已确认或已导出的催缴单里 409;只在草稿 / 已作废单里时要带 dropDraftNotices(连单一起删,
  // 那几个月显示需重算,要出账运行权限),不带 409;不存在 404
  remove: (id: number, dropDraftNotices = false): Promise<void> =>
    http.delete(`/meters/${id}`, { params: { dropDraftNotices } }),
  // 有读数的账期全集('YYYY-MM' 升序);默认月取 max —— 替代原来逐月拉整月读数(单月千余行)的 12 次探测
  months: (): Promise<string[]> => http.get('/meters/months'),
  readings: (ym: string): Promise<MeterReadingDTO[]> => http.get('/meters/readings', { params: { ym } }),
  // 某表逐月历史(抽屉)
  meterReadings: (id: number): Promise<MeterReadingDTO[]> => http.get(`/meters/${id}/readings`),
  // factorSnap=当时表倍率快照;同表同月 409
  createReading: (req: MeterReadingReq): Promise<MeterReadingDTO> => http.post('/meters/readings', req),
  updateReading: (id: number, req: MeterReadingReq): Promise<MeterReadingDTO> =>
    http.put(`/meters/readings/${id}`, req),
  deleteReading: (id: number): Promise<void> => http.delete(`/meters/readings/${id}`),
  // §H5 批量删除:先预览(GET,只算不删)后执行(DELETE,不可逆,仅 admin)。
  // 两条端点参数同形(后端同一个方法),勾选项一变预览必须重拉 —— 否则复述的数字与实删对不上。
  deletePreview: (ym: string, opt?: MeterDeleteOpt): Promise<MeterDeleteDTO> =>
    http.get('/meters/readings/delete-preview', { params: { ym, ...opt } }),
  batchDelete: (ym: string, opt?: MeterDeleteOpt): Promise<MeterDeleteDTO> =>
    http.delete('/meters/readings', { params: { ym, ...opt } }),
  // 表按 (kind,zone,name) 建档/刷新,读数按 (表,ym) 幂等覆盖;行级错误跳过不整批拦。
  // 档案只写导入月那一行;fileName 进档案变更记录;结果带 batchId(撤销用)与 changes(逐表逐字段的档案变化)
  importRows: (rows: MeterImportRow[], fileName?: string): Promise<ImportResultDTO> =>
    http.post('/meters/import', { rows, fileName }),
  // METER-TIMELINE-SPEC §3.5 撤销一次导入写下的档案改动(读数不动);之后又改过或波及冻结月 → 409 并列出。回还原条数
  revertImport: (batchId: string): Promise<number> => http.post(`/meters/import-batches/${batchId}/revert`),
  // ── S2-BIND-SPEC §3 ──
  // 归属覆盖率报表:summary+每块租户表状态行(选定月判定)
  binding: (ym: string): Promise<MeterBindingDTO> => http.get('/meters/binding', { params: { ym } }),
  // 写 override(contractId=null 解绑);校验合同存在。钉在 ym 那一段上:correct = ym 所在的那一段,from = 自 ym 起写一行
  bind: (id: number, contractId: number | null, ym: string, mode: MeterAssignMode): Promise<void> =>
    http.put(`/meters/${id}/bind`, { contractId, ym, mode }),
  // 按 tenant_name 原文=租户档案名精确唯一匹配的待核段批量挂 tenant_id;幂等;区间有冻结月的段跳过(算 skipped)
  autoLinkByName: (): Promise<{ linked: number; skipped: number }> =>
    http.post('/meters/auto-link-by-name'),
  usageSummary: (ym: string): Promise<MeterUsageSummaryRowDTO[]> =>
    http.get('/meters/usage-summary', { params: { ym } }),
}
