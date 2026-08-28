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
  retiredYm: string | null      // V68:自该账期起停用(含当月不计);null=在用
  activeFromYm: string | null   // V87:启用账期,该月前不在服务中;null=一直在册
  removedYm: string | null      // V88:退场账期,该月起不再显示(退租/拆表);null=未退场
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

// 新增/编辑共用;PUT 带全量。factor 空=1。
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
  retiredYm?: string | null     // V68 停用账期;null=在用(撤销停用)
  activeFromYm?: string | null  // V87 启用账期;null=一直在册
  removedYm?: string | null     // V88 退场账期;null=未退场
  // §G5 存疑标的人工入口,三态同 floorLabel:不传=保留原标;''=人工解除(「认领为独立表」,重新进Σ);
  // 'shadow'/'incomplete'=人工打标。二态(null=解除)会让任何一个不带该字段的 PUT 顺手把标清掉。
  suspect?: '' | 'shadow' | 'incomplete'
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
// manualKept=保留的手工分摊行点名;meterDeleted=连带删掉的表档案;meterBlocked=撞池绑定 FK 跳过的表档案。
// 级联勾选项,两端点共用;不传=后端默认全开
export interface MeterDeleteOpt {
  cascade?: boolean          // 该月派生快照(池核算/逐表明细/损耗/分摊 gen 行)
  dropEmptyMeters?: boolean  // 删完零读数的表档案(池成员表撞 FK 自动跳过)
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
}

// ── S2-BIND-SPEC §3:表→合同绑定(读侧派生,按账期月判定) ──
export type BindBucket = 'date_missing' | 'ambiguous' | 'bld_mismatch' | 'no_contract'
export type BindStatus =
  | 'auto' | 'auto_bld'            // 自动归属(候选唯一/楼栋对位唯一)
  | 'override' | 'override_stale'  // 人工绑定(stale=合同不覆盖 ym,警示不静默失效)
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
  locations?: string[]             // 绑定合同的费项位置标签;未绑定=[]
  candidates?: BindCandidateDTO[]
  hasReading: boolean
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
  list: (kind?: MeterKind, zone?: MeterZone): Promise<MeterDTO[]> =>
    http.get('/meters', { params: { kind, zone } }),
  create: (req: MeterReq): Promise<MeterDTO> => http.post('/meters', req),
  // 同(kind,zone,name) 重名 409;改倍率只影响之后新录读数
  update: (id: number, req: MeterReq): Promise<MeterDTO> => http.put(`/meters/${id}`, req),
  // 有读数 409 守卫;不存在 404
  remove: (id: number): Promise<void> => http.delete(`/meters/${id}`),
  // 有读数的年份升序;空表=[](年选择器数据驱动)
  years: (): Promise<number[]> => http.get('/meters/years'),
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
  // 表按 (kind,zone,name) 建档/刷新,读数按 (表,ym) 幂等覆盖;行级错误跳过不整批拦
  importRows: (rows: MeterImportRow[]): Promise<ImportResultDTO> => http.post('/meters/import', { rows }),
  // ── S2-BIND-SPEC §3 ──
  // 归属覆盖率报表:summary+每块租户表状态行(选定月判定)
  binding: (ym: string): Promise<MeterBindingDTO> => http.get('/meters/binding', { params: { ym } }),
  // 写 override(contractId=null 解绑);校验合同存在
  bind: (id: number, contractId: number | null): Promise<void> =>
    http.put(`/meters/${id}/bind`, { contractId }),
  // 按 tenant_name 原文=租户档案名精确唯一匹配的待核表批量挂 tenant_id;幂等
  autoLinkByName: (): Promise<{ linked: number; skipped: number }> =>
    http.post('/meters/auto-link-by-name'),
  usageSummary: (ym: string): Promise<MeterUsageSummaryRowDTO[]> =>
    http.get('/meters/usage-summary', { params: { ym } }),
}
