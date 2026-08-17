import http from './index'

// 公摊分摊(PB-ALLOCATION-SPEC)DTO — 逐字对齐后端 dto/Alloc*。
// GET=viewer 可读,写=admin。用量唯一来源=P-A meter_reading 派生;本域出口=alloc_result(P-C 契约)。

export type AllocZone = 'p1' | 'p2' | 'dorm'
// none=不分摊全额挂亏;ref=纯标准行(只出std不出应分摊,不入合计)— POOL-ENGINE-SPEC §2
// carrier(V73)=冲减载体:表已在别池以 sign=-1 冲减,本行只陈列用量不出应分摊、不入金额合计(账册 W89 为空)
// V81 起后端还会返回 'manual'(§H4.2e 原册 r12/r47-49 四个无电表行,qty/cost 恒 null)。
// 拆两层:AllocMethod=后端真实值域(读侧一律用它);AllocMethodEditable=屏上可选值域,
// 排掉 manual(人工指定的池不该由抽屉单选组新建/改写)。
export type AllocMethodEditable = 'direct' | 'area' | 'floor' | 'loss' | 'none' | 'ref' | 'carrier'
export type AllocMethod = AllocMethodEditable | 'manual'
export type AllocFeeKey =
  | 'share_elec_fire' | 'share_elec_elevator' | 'share_elec_light'
  | 'share_elec_floor' | 'share_elec_loss' | 'share_green_water' | 'share_water' | 'park_loss_pool'
// 分摊标准算式(NULL=按zone默认:p2=amount_over_base,p1/dorm=qty_price_over_base)
export type AllocStdKind = 'amount_over_base' | 'qty_price_over_base' | 'qty_over_base'
export type AllocLinkType = 'fold_price' | 'fold_qty'

export interface AllocMemberDTO {
  tenantId: number
  weight: number | null          // floor=层份额(1/0.5/null=层内按面积二拆);area/direct=忽略
}

export interface AllocRuleDTO {
  id: number
  zone: AllocZone
  name: string
  buildingId: number | null
  method: AllocMethod
  coefficient: number | null     // area=受益面积Σ㎡;floor=层数(可小数)
  extraQty: number               // 人工加度(电梯+170 等)
  feeKey: AllocFeeKey
  note: string | null
  sortNo: number
  meterIds: number[]
  members: AllocMemberDTO[]
  // S3-B1 增量(后端并行刀落地,可选=兼容旧行)
  roundScale?: number
  stdKind?: AllocStdKind | null
  baseKey?: string | null
  meters?: AllocRuleMeterReq[]
  links?: AllocRuleLinkReq[]
}

// S3-B1 池引擎扩展(POOL-ENGINE-SPEC §4):绑表带正负号/池间折入链
export interface AllocRuleMeterReq { meterId: number; sign: number }
export interface AllocRuleLinkReq { ruleId: number; type: AllocLinkType }

export interface AllocRuleReq {
  zone: AllocZone
  name: string
  buildingId?: number | null
  method: AllocMethod
  coefficient?: number | null
  extraQty?: number | null
  feeKey: AllocFeeKey
  note?: string | null
  meterIds: number[]
  members: AllocMemberDTO[]
  // S3-B1 增量(AllocRuleReq 增 sign/round_scale/std_kind/base_key/links);
  // meters 含 sign 与 meterIds 同发,后端以 meters 优先
  roundScale?: number
  stdKind?: AllocStdKind | null
  baseKey?: string | null
  meters?: AllocRuleMeterReq[]
  links?: AllocRuleLinkReq[]
  // V69:池名由后端按定位自动生成并覆盖 name;memberMonth=null 写默认长期行,'YYYY-MM' 只覆盖该月
  floorLabel?: string | null
  side?: string | null
  feeName?: string | null
  memberMonth?: string | null
}

// 参数原值行(acctMonth ''=初始版本;S21 后屏上取值/改值一律走 api/params,本端点仅过渡保留)
export interface AllocCfgDTO {
  id: number
  scope: string                  // p1/p2 或 building:{id}
  cfgKey: string
  value: number | null
  acctMonth: string              // ''=默认行
  note: string | null
}

export interface AllocCfgReq {
  scope: string
  cfgKey: string
  acctMonth?: string | null      // 空=默认行
  value: number | null           // null=删行回退默认
  note?: string | null
}

export interface AllocResultDTO {
  id: number
  tenantId: number
  tenantName: string | null
  buildingId: number | null
  buildingName: string | null
  ym: string
  feeKey: AllocFeeKey
  ruleId: number | null          // 损耗行/manual/多规则合并=null
  qty: number | null
  amount: number
  rateSnap: number | null        // 损耗率/元每层/元每㎡ 快照
  priceSnap: number | null
  source: 'gen' | 'manual'
  note: string | null
  generatedAt: string
}

export interface AllocGenerateResultDTO {
  rows: number
  tenants: number
  manualKept: number
  warnings: string[]
}

// 抽屉逐费项明细(表级现算):stale=现算≠快照「读数已变,可重新生成」
export interface AllocDetailRowDTO {
  feeKey: AllocFeeKey
  ruleId: number | null
  ruleName: string | null
  qty: number | null
  amount: number
  rateSnap: number | null
  priceSnap: number | null
  source: 'gen' | 'manual'
  note: string | null
  liveAmount: number | null
  stale: boolean
}

export interface AllocManualReq {
  tenantId: number
  ym: string
  feeKey: string
  qty?: number | null
  amount: number
  note?: string | null
}

// 损耗率表一行(读时派生):lossQty=分表Σ−总表(负=有损耗)
export interface AllocLossRowDTO {
  zone: AllocZone
  buildingId: number
  buildingName: string
  headQty: number
  subQty: number
  lossQty: number
  rawRate: number | null
  shareQty: number
  adjQty: number
  adjRate: number | null
  tenantRate: number | null
}

// 对账一行:行=规则(+损耗组 ruleId=null);diff=已分摊−成本(正盈负亏)
export interface AllocReconRowDTO {
  ruleId: number | null
  name: string
  zone: AllocZone
  feeKey: AllocFeeKey
  qty: number
  price: number | null
  costAmount: number | null
  allocated: number
  diff: number | null
}

export interface AllocReconDTO {
  lossRows: AllocLossRowDTO[]
  rows: AllocReconRowDTO[]
  allocSum: number               // 本月分摊合计(互认提示:vs 电费成本模型 allocated)
  elecCostAllocated: number
}

// ── S3-B1 池核算(POOL-ENGINE-SPEC §4,字段名=前后端共同契约不得偏离) ──
// GET /api/alloc/pools:rows=全部规则(config)左连当月快照;无快照月 generated=false 且数值列 null
// V69:池=楼栋+楼层+侧向+费项四级定位,name 由后端自动生成(autoName);受益人 members 勾选+按月留痕
export interface AllocPoolMeterDTO {
  meterId: number
  name: string                   // 内部标识名(仅审计;界面显示 label)
  sign: number
  label: string | null           // 位置化标签「四楼西侧·电表①」
  spot: string | null
  subName: string | null
  meterType: string | null
}
export interface AllocPoolLinkDTO { ruleId: number; name: string; type: AllocLinkType }
// V73 逐表明细行(原册一表一行:A座天面四部梯各占一行),来自 alloc_pool_meter_result 快照。
// costAmount 只在 p1/dorm「逐表 ROUND 再求和」口径下有值;p2 池级一次 ROUND、净额池/手输量池 → null,
// 此时应分摊列由池行 rowspan 显池级合计(不把池金额按比例摊回逐表冒充逐表数)。
export interface AllocPoolLineDTO {
  meterId: number
  label: string                  // 区域·位置·用途·表号(V73 补全,不再只有「天面·电表①」)
  area: string | null
  spot: string | null
  // 刀I §I3 逐行身份两列的来源(原册 B/C/D 永远逐行写,从不纵向合并):
  // floorLabel=该表的结构化楼层(「四楼」,方位另存 side);useName=原册 D 列「企业名称」
  // (名不副实,实为用电部位/归属:走廊灯/西侧租户、东侧货梯、消防控制箱)。
  // 可选=老快照/未重启后端时缺字段,消费方(lineFloor/lineUseName)按缺失回落池级值。
  floorLabel?: string | null
  useName?: string | null
  subName: string | null
  meterType: string | null
  code: string | null
  sign: number
  factorSnap: number | null
  prevTotal: number | null
  currTotal: number | null
  qtyTotal: number | null
  qtySharp: number | null
  qtyPeak: number | null
  qtyFlat: number | null
  qtyValley: number | null
  costAmount: number | null
}
// 刀I §I2 净额构成项:净额池的绑定表在原册「公共电分摊明细」上**根本没有行**(招商中心那 7 块是
// 「一期园区电」S44:S50 的中间量),故它们不出逐表行,只作主行 hover 明细。
// qty=带 sign 的**有符号**净量(相加即得池净量);meterId=null 的一项是原册硬编码扣度(N8 `=-670`),不是电表。
export interface AllocPoolNetPartDTO {
  meterId: number | null
  label: string
  sign: number
  qty: number | null
}
// 在租三态(2026-07-30):yes=在租;no=已退租;unknown=合同缺起止日期,判不了(不等于退租)
export type AllocInForce = 'yes' | 'no' | 'unknown'
// 受益人一行:src=month(该月覆盖)/default(默认长期行);unitNo 按池定位取,取不到=null
export interface AllocPoolMemberDTO {
  tenantId: number
  tenantName: string | null
  unitNo: string | null
  weight: number | null
  inForce: AllocInForce
  src: 'month' | 'default'
  // 刀D:该户在本池楼栋解析出的楼层(§D.1 合同单元→户内表两级回退,读时现算不落库),
  // 跨多层用「、」连;null=未定层(会与其他未定层户合摊 1 份)
  floorLabel: string | null
}
// GET /api/alloc/pool-candidates:该定位可组成的表 + 该定位在租租户(preChecked=按合同预勾)
export interface AllocMeterCandDTO {
  meterId: number
  label: string
  spot: string | null
  subName: string | null
  meterType: string | null
  ownership: string              // share/park/ops/infra(infra=总表,标注不预勾)
  usage: number | null
}
export interface AllocTenantCandDTO {
  tenantId: number
  tenantName: string | null
  unitNo: string | null
  inForce: AllocInForce | null
  preChecked: boolean | null
}
// tenantNote:tenants 为空时的原因说明(刀D §D.4 direct 户对户池不推「该定位在租租户」);其余情况 null
export interface AllocCandidatesDTO {
  meters: AllocMeterCandDTO[]
  tenants: AllocTenantCandDTO[]
  tenantNote: string | null
}
// GET /api/alloc/member-diff:该定位本月在租租户 与 池当前受益人 的差集(页面提醒条)
// 有侧向的池不产出 added(unit 无侧向字段,判不了);removed 只收确凿退租(inForce='no')
export interface AllocMemberDiffDTO {
  ruleId: number
  poolName: string
  added: AllocTenantCandDTO[]
  removed: AllocTenantCandDTO[]
}
export interface AllocPoolRowDTO {
  ruleId: number
  zone: AllocZone
  name: string
  // V80(§H4.2 b/d)原册锚点:bookBlock=原册 7 个合计行块名原文(屏上按它分带),
  // bookKey=原册 A 列自然键(屏上池名称列优先显它)。二期/宿舍原册无块结构 → 两者 null。
  bookBlock: string | null
  bookKey: string | null
  groupLabel: string             // =楼栋名,无楼栋='园区级'
  method: AllocMethod
  stdKind: AllocStdKind | null
  roundScale: number
  baseKey: string | null
  sortNo: number                 // 保 Excel 原行序
  note: string | null
  // V69 四级定位(floorLabel 空=整栋,side 空=整层,buildingId 空=园区级)
  buildingId: number | null
  buildingName: string | null
  floorLabel: string | null
  side: string | null
  feeName: string | null
  autoName: string               // 按定位自动生成的池名(前端只读展示)
  // 园区级池未显式勾受益人 → 后端按「该期全园在租名册」自动摊(不进 member-diff 提醒条)
  autoMembers: boolean
  members: AllocPoolMemberDTO[]
  meters: AllocPoolMeterDTO[]
  links: AllocPoolLinkDTO[]
  lines: AllocPoolLineDTO[]      // V73 当月逐表明细快照;未生成月为空数组
  netParts?: AllocPoolNetPartDTO[]  // §I2 净额池构成(非净额池空表);可选=与既有测试夹具兼容
  qtyTotal: number | null
  qtySharp: number | null
  qtyPeak: number | null
  qtyFlat: number | null
  qtyValley: number | null
  extraQty: number | null        // 加度/扣度(进标准分子不进应分摊)
  costAmount: number | null      // 应分摊(W/AD)
  baseSnap: number | null        // 分摊基数快照(层数T/面积AA)
  stdValue: number | null        // 分摊标准(V/AC,已含 foldAdd)
  foldAdd: number | null         // 折入叠加档(0.005/0.007)
  priceSnap: number | null
  // ⚠语义(刀3 正名,V71 COMMENT 同步):屏上列头=「摊出」「差额」,不是账册 AE/AF。
  // 账册 AE「已分摊」=从电费总表按费目列拉回的实收,AF「盈亏」=实收−应分摊 —— 两者待 bill_notice
  // 落地后才有来源,屏上另立「实收/盈亏」两列恒 '–'(POOL-ENGINE-SPEC §6.1)。
  allocatedAmount: number | null // 摊出:引擎按受益人配置正向试算摊到户的合计(非实收)
  gapAmount: number | null       // 差额:摊出−应分摊(名单/面积基数与账册不同批时会有差)
  warn: string | null
  // 刀D §D.6:floor 池分桶明细串「按 3 层拆:二楼 1 户 / 三楼 1 户 / 未定层 2 户」,做「摊出」列 title
  // ——让「为什么摊出少于应分摊」在屏上看得见。读时现算(楼层不落库),非 floor 池 null。
  // 可选=与既有测试夹具(不含本字段)兼容,同 roundScale/stdKind 那批增量字段的写法。
  allocNote?: string | null
}
export interface AllocPoolsDTO { generated: boolean; rows: AllocPoolRowDTO[] }

// GET /api/alloc/loss:units=楼栋损耗快照;recon=读时派生(供电侧总表 vs 单元合计)
export interface AllocLossUnitDTO {
  headBuildingId: number
  label: string                  // 合并组='二/三/四车间(三车间供电)'
  zone: AllocZone
  cQty: number | null            // 总表用电量
  cableQty: number | null        // 铝缆用电量(仅陈列)
  dQty: number | null            // 分表用电量Σ
  eQty: number | null            // 损耗量
  rawRate: number | null
  gQty: number | null            // 公摊分摊度数(仅p1)
  adjQty: number | null          // 调整度数(二期H列)
  adjRate: number | null         // 调整损耗加点
  variant: 'net' | 'share_only' | 'none'
  tenantRate: number | null      // 收取租户损耗率(手工率非空时=手工率)
  note: string | null
  // S21:公式率 / 手工率并排;gParts=G 分解(一期园区公摊池 池名+本次生成的池快照净量,Σ÷gDiv=gQty;二期 null)。
  // 可选=与既有测试夹具兼容(同 netParts/allocNote 那批增量字段的写法)
  formulaRate?: number | null
  manualRate?: number | null
  gParts?: { name: string; qty: number }[] | null
  gDiv?: number | null
}
export interface AllocLossReconDTO {
  zone: AllocZone
  supplyQty: number | null
  sumC: number | null
  sumD: number | null
  lossVsC: number | null
  rateVsC: number | null
  lossVsD: number | null
  rateVsD: number | null
}
export interface AllocLossDTO { generated: boolean; units: AllocLossUnitDTO[]; recon: AllocLossReconDTO[] }

export const allocApi = {
  // 抄表年∪结果年升序(年下拉数据驱动)
  years: (): Promise<number[]> => http.get('/alloc/years'),
  rules: (zone?: AllocZone): Promise<AllocRuleDTO[]> => http.get('/alloc/rules', { params: { zone } }),
  createRule: (req: AllocRuleReq): Promise<AllocRuleDTO> => http.post('/alloc/rules', req),
  updateRule: (id: number, req: AllocRuleReq): Promise<AllocRuleDTO> => http.put(`/alloc/rules/${id}`, req),
  // 有分摊结果 409;不存在 404
  deleteRule: (id: number): Promise<void> => http.delete(`/alloc/rules/${id}`),
  cfg: (ym: string): Promise<AllocCfgDTO[]> => http.get('/alloc/cfg', { params: { ym } }),
  saveCfg: (req: AllocCfgReq): Promise<void> => http.put('/alloc/cfg', req),
  // 按 ym 先删后插 gen 行幂等;manual 保留;返回缺抄警告清单
  generate: (ym: string): Promise<AllocGenerateResultDTO> =>
    http.post('/alloc/generate', null, { params: { ym } }),
  result: (ym: string): Promise<AllocResultDTO[]> => http.get('/alloc/result', { params: { ym } }),
  resultDetail: (tenantId: number, ym: string): Promise<AllocDetailRowDTO[]> =>
    http.get(`/alloc/result/${tenantId}`, { params: { ym } }),
  saveManual: (req: AllocManualReq): Promise<AllocResultDTO> => http.post('/alloc/result/manual', req),
  // 仅 manual 行可删;gen 行 409
  deleteResult: (id: number): Promise<void> => http.delete(`/alloc/result/${id}`),
  recon: (ym: string): Promise<AllocReconDTO> => http.get('/alloc/recon', { params: { ym } }),
  // S3-B1 池核算两屏(POOL-ENGINE-SPEC §4)
  pools: (ym: string): Promise<AllocPoolsDTO> => http.get('/alloc/pools', { params: { ym } }),
  // V69:池组成候选(表按定位过滤 + 该定位在租租户预勾);floor 传楼层显示名如'四楼'
  // §E6:method 已接通 —— 'direct'(户对户)返回空 tenants + tenantNote,那唯一一户由
  // PoolLedgerView 的全库租户选择器(FPTenantPicker)指定;表候选不受 method 影响。
  poolCandidates: (ym: string, buildingId?: number | null, floor?: string | null, side?: string | null,
                   method?: AllocMethod | null): Promise<AllocCandidatesDTO> =>
    http.get('/alloc/pool-candidates', { params: { ym, buildingId, floor, side, method } }),
  memberDiff: (ym: string): Promise<AllocMemberDiffDTO[]> =>
    http.get('/alloc/member-diff', { params: { ym } }),
  loss: (ym: string): Promise<AllocLossDTO> => http.get('/alloc/loss', { params: { ym } }),
}
