# 表档案按月记录 · 实施计划（2026-09-24）

规格：`docs/design/METER-TIMELINE-SPEC.md`（下称 SPEC）。本文只管「谁在哪个阶段改哪些文件、怎么验」。
勘察依据：工作流 wf_9ca6b2f0（后端消费点 146 处 / 测试与脚本 108 处 / 前端 100 处 + 机制问答 B1–B12、F1–F12）。

---

## 0. 全局约束（每个阶段都适用）

- **不提交、不推送、不 git checkout/stash/reset**。工作区有大量别人的未提交改动，只动自己阶段的文件。
- 源码是 **UTF-8 + CRLF**。改文件用 Edit/Write，或 Python（`io.open(..., encoding='utf-8', newline='')`，锚点按 CRLF）。**禁止用 PowerShell 读写源码**（会毁 UTF-8）。
- 后端测试**同一时刻只能有一个阶段在跑**（Testcontainers 复用同一个库，两套并跑会死锁）。前端 vitest 可并行。
- 判绿看产物：后端数 `target/surefire-reports`/`failsafe-reports` 的 `Tests run:` 与 `FAILURE`；前端看 vitest 的 `Tests  N passed` 行；类型门禁用 `npm run typecheck`（裸 vue-tsc 什么都不查）。管道会吃退出码。
- 过程中只跑相关测试文件；全量只在 F 阶段跑一次。
- 门禁：`QueryHygieneTest`（service 里 `selectList(null)` 全等计数，新表查询用 wrapper）、`ReviewGuardCoverageTest`（写端点方法体含 `reviewGuard.assert` 或 `@NoReviewGuard(reason)`，豁免上限 ≤47，**新端点一律真守，不加豁免**）、`PermissionCoverageTest`（写端点登记 PermissionRegistry）、`ControllerLayerTest`（controller 不碰 mapper）、`BillNoticeWarnTest`（新告警码走 BILL-NOTICE-WARN-SPEC §7 九步）、`changelog.spec`。
- 开发库：docker 容器 `demo3-mysql`，宿主 13306，root/root，库 `park_demo3`（客户端 `"/c/Program Files/MySQL/MySQL Workbench 8.0 CE/mysql.exe"`）。**不许改 `park_demo3`**；验证迁移用临时库 `park_demo3_mig`（从备份灌入）。备份：scratchpad `park_demo3-before-timeline-20260924.sql`。
- 新写的每条守卫断言都要破坏验证：改坏生产代码 → 只有那一条转红 → 用字符串替换还原。

---

## 1. 接口契约（B 阶段实现，C 阶段消费；改动须回写本节）

| 方法 路径 | 入参 | 出参 / 行为 | 守卫 |
|---|---|---|---|
| GET `/api/meters?kind&zone&ym` | ym 缺省=最新 | `MeterDTO[]` 站在 ym 的投影（见下） | 读 |
| POST `/api/meters` | MeterReq + `fromYm`（缺省 `1900-01`）；旧的 `retiredYm/activeFromYm/removedYm` 已删（B2） | 建资产 + assign@fromYm + status active@fromYm | fromYm 起到最大已生成月有审核锁 → 423，**落库前**拒（新表不在任何单里，冻结只可能来自审核锁） |
| PUT `/api/meters/{id}` | `MeterAssetReq`：kind zone name code factor deviceType meterType suspect（kind/zone 是资产列，同 SPEC §1.1，留着给同名校验与改期区） | 只写资产列；请求里多带的归属字段忽略（不写任何归属行） | @NoReviewGuard（资产无期间，保留原豁免名额） |
| PUT `/api/meters/assign` | `{ym, mode: correct\|from, meterIds[], patch{tenantId,tenantName,buildingId,ownership,area,spot,floorLabel,side,roomNo,subName}, alsoMigrateCopies}`；patch **只写出现的键**，值 `null`/`""` = 清空（ownership 不能空），别的键 400 | 逐表写行（correct：ym 早于第一行 / 还没有行时按 from 写 ym）；**起始月由 meterIds 第一块表定，同房间的其余表用同一个起始月写**（SPEC §3.3，E）；租户组 / 归属组值变了置该组标记，位置三列按 V78 位掩码（给了值且≠按 spot 解析才置位；改了 spot 而该列位为 0 → 跟着重解析）；from 新行换了租户 → 不继承 contract_id；区域/位置/企业名称由空变非空 → 清 meter.suspect（§F4）；返回 `[{meterId, fromYm, until}]`（真改了的行，until 同 MeterDTO） | 每块表的受影响区间（目标行 + 复本行）查冻结：审核锁 423，其余冻结**整批** 409 点名，一块都不写 |
| POST `/api/meters/assign/clear-manual` | `{meterId, ym}` | 清掉 assignAt(ym) 那一行的三组标记；被清掉的位置列回到按 spot 解析的值（「改回按册子」）；租户/归属值不动；返回空 | 同上（该行区间） |
| GET `/api/meters/{id}/timeline?ym`（ym 必填） | | `{assign[], status[], log[], impact:{correct:{from,until,locked[]}\|null, from:{from,until,locked[]}, migrateCopies:n}, siblings[]}`；assign/status 是整行（含 id src batchId 标记），升序；log 是 meter_archive_log 整行、新的在前；correct 在 ym 早于第一行时为 null；locked 项 `{ym, reason}`；siblings 项 `{meterId,name,kind,tenantName}`（站在 ym 同楼栋 + 同房号（canon）、在册未拆） | 读 |
| POST `/api/meters/{id}/status` | `{fromYm, status, replaceFromYm?}`；replaceFromYm = 把那一行挪到 fromYm（**改月**，第一行只能这样改） | 写 status 行（挪月 = 删旧行 + 写新行，同一事务）；挪月只能在前后两行之间，越过或落到相邻行那个月 → 409（E） | 区间冻结（挪月时两段区间的并）：审核锁 423，其余 409 |
| DELETE `/api/meters/{id}/status/{fromYm}` | | 删行（第一行 409；没有这一行 404） | 区间冻结 |
| GET `/api/meters/{id}/status-impact?fromYm&status` | | `{from, until, locked[], readings:[{ym,usage}], pools:[{id,name}], contractNo}`；readings 只列区间内用量非零的月，status=active 时恒 `[]`；pools 名字带期区前缀（池名原样）；contractNo = assignAt(fromYm) 钉的合同 | 读 |
| POST `/api/meters/import` | 行 + `fileName`（可空，>255 截断） | `MeterImportResultDTO` + `batchId` + `changes:[{meterId,label,field,before,after,from,until}]`（B1 已实现：一表一字段一条，field 另含 `status`；新建的表不列；until 同 MeterDTO = 本段最后一个月、null = 链尾） | 本批月份 METERS 锁 + G11 |
| POST `/api/meters/import-batches/{batchId}/revert` | batchId = 36 位 UUID | 按 archive_log 逆序还原；`data` = 还原条数（int）。无此批 404；之后又改过（现状 ≠ 后像，batch_id 不比）/ 波及冻结月 409 并列出（整批不动） | 区间冻结 |
| GET `/api/meters/readings/delete-preview` / DELETE `/api/meters/readings` | 现有 | 预览多报 `assignRows/statusRows`（B1 已实现）、`bookRows`（SPEC §10：该月 meter_book_seen 记录，作用域同读数 kind/zone，实删一并删）；实删时这些行的区间波及冻结月 → 409 列出、整批不删。**该月催缴单（2026-09-24 用户反馈批删死胡同）**：预览多报 `draftNotices/voidNotices/lockedNotices/lockedTenants`（户名去重全量，屏上与 409 只列前 5 户「等 N 户」）；请求加 `dropDraftNotices`（缺省 false）。实删：有锁定单（confirmed/exported/issued）→ 409 点户名、指到催缴单屏作废；只有 draft/void 且没勾 → 409 让人勾；勾了 → 删该月**全部** draft/void 单（整月，不随 kind/zone；明细行与告警 FK CASCADE）再删读数，同一事务。`dropEmptyMeters` 删完零读数的表若别的月的单明细里还有它 → 跳过进 `meterBlocked`（标签带「别的月的催缴单里还有它」） | 现有；勾了且有单时另加 BILL_NOTICES 月守卫（423）+ `billing-run:edit`（同 generate） |
| GET `/api/meters/{id}/delete-impact` / DELETE `/api/meters/{id}?dropDraftNotices`（2026-09-25 用户「为什么删除南盛物流要去计费参数重新生成」） | dropDraftNotices 缺省 false | impact = `{readings, poolBindings:[池名], notices:[{noticeId,ym,tenantName,status,lines}], draftCount(草稿+已作废), lockedCount}`。删：有读数 409 → 在池里 409 → 明细里有它的单（FOR UPDATE 读）：有锁定单 409 点「月 户名(状态 N 行)」叫先作废；只有草稿/已作废没勾 409 指到确认框勾选项；勾了 → 删**这几张**整单（明细/告警 CASCADE）+ 这些月各记一条 data_change_log（`meter-archive`）+ 删表，同一事务；告警（`W_METER_NO_CONTRACT / W_METER_BIND_STALE`）payload 指着它的单不删，那几个月也记；每次删表落 `AuditLogService.log("meter.delete", 表名(id), 删表[;连带删催缴单:…])`。与批删共用 `guardOpenNotices / dropNotices` | 读；删单分支 BILL_NOTICES 月锁 423 + `billing-run:edit`（同 generate）；delete 仍挂 @NoReviewGuard（无单分支原理由不变） |
| PUT `/api/meters/{id}/bind` | `{contractId\|null, ym, mode: correct\|from}`（ym、mode 必填） | 写该行 contract_id（mode 同 PUT /assign；那一段本来就是它 = 不写） | 区间冻结：审核锁 423，其余 409 |
| POST `/api/meters/auto-link-by-name` | 现有 | 逐行就地补 tenant_id，跳过冻结行（算 skipped，计数按表） | 逐行冻结（@NoReviewGuard 保留，reason 改为逐行 frozenMonths） |
| GET `/api/meters/binding?ym` | 现有 | Row 加 `suggestion:{tenantId,tenantName,contractId,contractNo}\|null`：status 为 manual / override_stale，或所用合同房号对不上（`Pin.undecided`）时，找本月在租、计费行位置房号含本表房号（`BillNoticeService.roomTokens/tok`）的**他户**（家族根不同）合同，多份按楼栋收窄，唯一才给。钉的合同不属于本段租户家族 → 不采用：自动定得出用自动的（`pinnedContractNo` 带出钉的那份），定不出 = override_stale 且 `contractId=null` | 读 |
| GET `/api/contracts/{id}/terminate-preview?on` | on 空 = 今天 | `{vacateFrom, meters:[{meterId,label,roomNo,checked}]}`(B3 已实现):meters = 站在解约月租户是这户、在册未拆(停用也算)的表;vacateFrom = 解约次月;checked = 表房号 token(`BillNoticeService.roomTokens`)∩ 这份合同计费行位置的 token 非空;label = `BillNoticeService.meterTag`(裸数字表名回落「位置 + 表序」) | 读 |
| POST `/api/contracts/{id}/terminate` | `{terminatedOn, vacateMeterIds[]}`(vacateMeterIds 可空 = 原行为,不碰档案) | 终止 + 每块勾的表在解约次月写一行空置(tenant_id / tenant_name / contract_id 置空、tenant_manual 置 0,其余照次月那一段抄;src=contract);只写那一行。勾的表解约月不挂这户 → 400;次月那一段已不是这户(已换租)→ 跳过 | 先判后写:每块表 [次月, 下一行) 或链尾到最大已生成月查冻结,审核锁 423,其余 409 整批拒,合同也不终止(@NoReviewGuard 已拆,换真守卫) |
| POST `/api/bill-notices/{id}/void` | `{reason}` 必填(`@NotBlank @Size(max=255)`,违反 = HTTP 400) | 作废(未作废的单都可作废,含已确认 / 已导出)+ `AuditLogService.log("bill-notice.void", "ym · 户名 · 单 #id", "作废;理由:…")`;`AuditLogService` 统一把 target / detail 截到列宽 128 / 255(unconfirm 原先超长整条写失败被吞,一并修了) | 现有 BILL_NOTICES 月守卫 |
| GET `/api/bill-notices/{id}` | 现有 | 行加 `archiveTenantId/archiveTenantName`:表行与 `viewAt(单的 ym)` 的归属比,租户 id 不同时 `archiveTenantName` 非 null(id 为空 = 档案没认出户,name 取企业名称原文,空串 = 空置);一致或非表行两个都 null | 读 |
| POST `/api/bill-notices/generate` | 现有 | 本月锁定单(confirmed/exported/issued)明细里出现过的表,档案现挂别户时不进那户草稿(一行都不出),出告警 `W_METER_BILLED_ELSEWHERE`(payload = 表 id,hint = meterTag) | 现有 |
| GET `/api/params/status?ym` | 现有 | 加 `lastChangeSource: param\|meter\|null`(lastChangeAt 取参数流水与 data_change_log 较晚的那次,说它来自哪边)、`staleSources: [param?, meter?]`(让本月过期的来源);`stale` 并入 data_change_log;`pendingChanges` 仍只数参数 | 读 |
| GET `/api/alloc/pools?ym` | 现有 | `meters[]`(MeterBind)加 `status / statusFrom`:站在 ym 这块表的状态段(null = 未在册)与起始月。池引擎:+1 绑定只在该月归属 ∈ {share, park, ops, infra}(= poolCandidates)时计入,-1 扣减表照旧 | 读 |
| GET `/api/system/logs?src=meter` | 现有 | 第 5 路来源 `meter`(meter_archive_log):action = `assign\|status . insert\|update\|delete`,target = 「表名 · 起始月」(表删了 `#id`),detail = 「旧 → 新 · 来源 · 文件名 · 行定位」(状态行比状态、归属行比企业名称原文;来源:导入 / 手改 / 合同终止 / 上线迁移);actors 并集含 operator | 读 |

**MeterDTO（站在 ym）**：资产列 + 归属列（取 assignAt）+ `status`（active/retired/removed/null=未在册）`statusFrom statusUntil assignFrom assignUntil assignSrc changedThisMonth tenantManual ownerManual locManual`；**去掉** `activeFromYm retiredYm removedYm`。（A2 已实现）`statusUntil / assignUntil` = 本段**最后一个月（含）**，null = 链尾；`changedThisMonth` = 该表在 ym 有自己的归属行（与上一行 `MeterTimeline.diff` 非空）或自己的状态行（与上一行状态不同），第一行不算；ym 缺省时站在 `9999-12` 看，`changedThisMonth` 恒 false。SPEC §10.3 另加 `bookSeen bookFile bookAt`：该表在 ym 导入的册子里出现过没有（meter_book_seen 有任意一行 (表, ym)），file / at = 该表该月最近一笔（`bookAt` 是 ISO 本地时间串）；list(ym) 一次查全月；ym 缺省恒 false / null。导入对每一行认到表（含新建）且非行级错误的记一笔（G2、G11 也记），撤销导入删本批的记录（撤销被拒 / 404 时不动）。

**同码在册（2026-09-25 用户拍板，SPEC §9「同码」）**：同 kind + 编码的两块表不许同一个月都在册（active / retired 算在册）。POST `/api/meters`、PUT `/api/meters/{id}`（改了编码或表类）、POST / DELETE `/api/meters/{id}/status`、POST `/api/meters/readings`（早月自愈）写完会新叠上 → body.code 409「编码 X 在 YYYY-MM 已有「表名」在册」，落库前拒；POST `/api/meters/import-batches/{batchId}/revert`、DELETE `/api/meters/readings`（批删本期）删 / 还原状态行后会叠上 → 整批 409 点名「表名(id N):编码 X 在 …」；导入 G10 自愈与导入新建表 → 行级错误。判定只有 `MeterService.codeClash` 一处（批量改链经 `codeClashes`：同批里的另一块表拿它改后的链比）。编码比较经 `codeNorm`（NFKC + 去首尾空白 + 大写，对齐 `meter.code` 的 `utf8mb4_0900_ai_ci`；重音不归，导入新建表那条路查库兜住）。导入按编码认到多块表时按行的月份挑在册的那块，剩零块或多块照旧报重复并点名在册区间（都不在册另给出路：核对月份 / 改在册区间再重导）。导入时编码栏「已拆」的行先处理，errors / notices / matches 按行号排回。

---

## 2. 阶段与文件归属

| 阶段 | 内容 | 独占文件（其它阶段不许碰） | 必跑测试 |
|---|---|---|---|
| **A1** 地基 | V128 建 `meter_assign / meter_status / meter_archive_log / data_change_log`，按 SPEC §7 灌数（**先不删旧列**）；实体/Mapper；`MeterTimelineService`（viewAt / latest / rows / writeAssign / writeStatus / deleteStatus / affectedMonths / frozenMonths / canonical diff）；在 `park_demo3_mig` 上跑迁移并核数 | 新文件 + migration V128 | 新 `MeterTimelineServiceTest`（纯函数：pick、区间、链尾到最大已生成月、canonical diff）+ `MeterTimelineIT`（写一行不碰别行、R4 三段走查、冻结） |
| **A2** 换读侧 | 后端全部读消费点（MeterService/AllocService/MeterBindingService/BillNoticeService/ParamService/ContractService）改走 viewAt(ym)/latest；`outOfService` 读 status；MeterDTO 投影；`list(kind,zone,ym)`；现有写路径（create/update/import/bind/autoLink/batchDelete）先改成经 timeline 写（导入：每个导入月写本月行）；V129 删旧列与 `fk_meter_contract / idx_meter_loc`（新 assign 表带同款 `ON DELETE SET NULL` 的合同 FK）；修测试夹具（测试月份在 2090–2099，无月写入须从 `1900-01` 起生效） | 上述 service、Meter/MeterDTO/MeterReq、V129、受影响测试 | MeterApiIT AllocApiIT MeterBindingApiIT BillNoticeApiIT AllocServiceTest AllocPoolContributionsIT PoolSeedIT BillNoticePremiseTest ReviewGuardCoverageTest QueryHygieneTest |
| **B1** 导入 | SPEC §3.2 G1–G11、canonical 变化判据、changes 清单、batchId/fileName、批级断言、revert 端点、batchDelete 连带删 import 行并回退自愈、读数写入记 data_change_log；前端 `api/meters.ts` 导入与撤销函数、`importRegistry.ts` 传 fileName 并透传 batchId/changes | MeterService 导入段、MeterController 导入端点、`api/meters.ts`（导入部分）、`importRegistry.ts` | MeterApiIT 导入组（每条护栏一条 IT）+ importRegistry.spec |
| **B2** 手改与状态 | SPEC §3.3 §3.4 §3.6 后两条：assign PUT（两种模式、同房间、migrate 复本）、clear-manual、timeline GET、status POST/DELETE/impact、create fromYm、手录读数早于首月自愈、bind 带月与家族校验、autoLink 跳冻结、binding suggestion；PermissionRegistry；前端 `api/meters.ts` 其余函数与类型 | MeterService 手改段、MeterBindingService、MeterController、MeterBindingController、PermissionRegistry、`api/meters.ts`（其余） | MeterApiIT / MeterBindingApiIT 新组、ReviewGuardCoverageTest、PermissionCoverageTest |
| **B3** 下游 | SPEC §3.6 终止、§5 全部：终止 preview/空置；池 +1 绑定按当月归属过滤；生成排除已锁单的表 + 新告警码（九步）；detail 档案比对；void 带理由与审计；snap() 并入 data_change_log；操作日志新来源 `meter`；前端 `api/contract.ts api/billNotices.ts api/system.ts` 与告警文案表 | ContractService/Controller、AllocService、BillNoticeService/Controller、ParamService、AuditQueryMapper/SystemService、WarnCode、`billNoticeWarnCopy.ts(+spec)` | ContractApiIT BillNoticeApiIT AllocApiIT AuditLogApiIT BillNoticeWarnTest ParamApiIT(stale) |
| **C1** 抄表屏 | list(ym) 且切月重拉；状态筛选加「本月有变化」「期区对不上」；隐藏表提示改按状态段说话；新增表弹窗「自 M 起在册」；导出只导在册且按月取档案；抄表格开放起始底数 +「缺底数」状态；导入结果弹层列 changes；批删预览报数 | MeterView.vue、MeterLedgerGrid.vue、useMeterWorkbench.ts(+spec)、meterExcel.ts(+spec)、ImportResultToast.vue、meterWriteGuards/meterNarrow spec | 上述 spec + typecheck |
| **C2** 抽屉 | 「档案变更」页签（段、状态段、日志、撤销这次导入）；改归属的两选一对话框（区间、冻结灰显、同房间、migrate 复本复选）；人工设定徽标 +「改回按册子」；状态列表（加/删、拆除问最后抄表月、读数确认、池与合同提示）；绑定页带月 + 建议「从本月起改归 X」；资产字段仍走 PUT | MeterDetailDrawer.vue 及其新拆出的子组件（放 `views/meters/`） | 新 drawer spec + typecheck |
| **C3** 其它屏 | 合同终止框列表与文案；催缴单：档案不一致橙点、「作废」带理由、需重算文案；池编辑：已拆灰行、移出确认；需重算文案所有显示处（paramCenterLogic staleText、BillNotices/Loss/PoolLedger/首页/矩阵）；操作日志新来源与动作码；PoolLedger/ParamCenter 的 list 带 ym | ContractDrawer.vue、BillNoticesView.vue、PoolLedgerView.vue、ParamCenterView.vue、SystemLogsView.vue、paramCenterLogic.ts(+spec)、billingPeriod.ts | 相关 spec + typecheck |
| **D** 对抗复查 | 四个镜头：R1–R6 与金额（双收/漏收/冻结绕过）；消费点与口径（trace-consumers）；编辑态/锁/失败态形状（fp-edit-lock-shapes）；屏上文案（screen-copy-adversary） | 只读 | — |
| **E** 修补 | 坐实的发现逐条修 | 按发现 | 相关测试 |
| **F** 收口 | changelog 0.20.0（功能更新）+ 配图组件 + package.json；SPEC/相邻规范互指；全量后端 verify + 前端 vitest + typecheck 各一次；独立破坏验证抽查 | changelog.ts、art.ts、Art0200.vue、package.json、docs | 全量 |

A1→A2→B1→B2→B3 串行（后端测试互斥）；C1/C2/C3 在 B3 之后并行；D 在 C 之后；E、F 串行。

### 2.1 A1 交接（后面阶段照这里接，改签名须回写本节）

- **审核闸写在调用方**：`MeterTimelineService` 不做冻结与审核闸。凡是写档案的端点，其 service 方法体里**先**调 `reviewGuard.assertEditable(ReviewKind.METERS, months, null)`，**再**调 `timeline.frozenMonths(meterId, months)` 决定拒绝（手改/状态/合同/撤销）或降级（导入 G11）。`ReviewGuardCoverageTest` 只认端点所转调的 service 方法体里的 `reviewGuard.assert`，写在 timeline 里它认不到。months 用 `timeline.affectedMonths(meterId, "assign"|"status", fromYm)` 取。
- 读：`viewAt(ym)` / `latest()` 返回 `View`，`view.assign(id)`（早于首行取首行）、`view.status(id)`（早于首行 = null = 不在册）；`view.assigns()/statuses()` 是 `meterId → 按 from_ym 升序的行`，until / changedThisMonth 自己用 `MeterTimeline.until / diff` 算。`rows(meterId)` 取单表全部行。
- 写：`writeAssign(MeterAssign, Ctx)`（整行覆盖，src/batchId 取 Ctx，值一格没变不留底）、`writeStatus(id, fromYm, status, Ctx)`、`deleteStatus(id, fromYm, Ctx)`、`deleteAssign(id, fromYm, Ctx)`（§3.5 撤销/批删用）。`Ctx(src, batchId, fileName, rowRef, operator)`，operator 空取当前登录名。「状态第一行不能删」由 B2 端点拦，deleteStatus 不拦（撤销导入要能删自愈行）。
- 需重算：`recordChange(months, "meter-reading")` 给 B1 记读数改动；早于库里最早已生成月的月份不记。
- `frozenMonths` 回 `[{ym, reason}]`，reason 例：`园区抄表已审核` / `园区抄表待审核` / `含这块表的催缴单已导出` / `含这块表的催缴单已确认`，同月多条用「、」连。
- `meter_archive_log` 的「表」列名是 `tbl`（SPEC 写 `table`，MySQL 保留字）。

### 2.2 A2 交接（V129 已删 meter 旧列；后面阶段照这里接）

- **读**：带月份的消费点一律 `timeline.metersAt(ym)` → `List<MeterAt>`（资产列 + assignAt(ym) + statusAt(ym)，sort_no→id 序，**不在册的表也在内**，`status=null`）；没有月份语境传 `MeterTimeline.LATEST`（ParamService 名字表、导入的身份索引）。`MeterAt` 字段与删列前的 `Meter` 同名（池引擎/催缴单/绑定读法没改），`toAssign(fromYm)` 落成归属行，`assetInto(Meter)` 写回资产列。表还没有任何归属行时 `ownership` 取 `share`（列默认）。
- **在不在服务**：唯一定义点 `MeterService.outOfService(MeterAt)`，**不收 ym**——m 本身就是站在某月取的；`status ≠ active`（未在册/停用/已拆）一律不计。`retired / notYetActive / removedGone` 三个旧判定已删。
- **副本**：`viewAt / rows` 给的是副本，`writeAssign / writeStatus` 值没变时回调用方自己的对象。原因：MyBatis 一级缓存在同一事务里对同一句查询回同一批对象，调用方改了 `rows()` 拿到的行再 `writeAssign`，旧行就是被改过的同一个对象 → 判成没变 → 写丢且不报错（A2 在绑定上实测撞到；`MeterTimelineIT.rowsHandedOutAreCopies_mutateThenWritePersists` 守着）。
- **过渡写法（代码里标 `⏳`，B2 替换）**：
  - POST `/api/meters`：`MeterReq.fromYm`（缺省 `1900-01`）起写归属行；状态 active@(`activeFromYm` 缺省 = fromYm)，`retiredYm/removedYm` 照下条映射。
  - PUT `/api/meters/{id}`：本次**改到的**归属字段（与最新一行比）对该表**全部**归属行做同一更正，没改到的字段各行原样；三个旧账期**各自三态**（null = 保留现状，`""` = 清掉，值 = 设成它），经 `MeterService.legacyStatus` 重排整条状态链（口径同 V128 灌数）；三个都 null = 状态不动。
  - PUT `/{id}/bind`：钉到该表全部归属行；POST `/auto-link-by-name`：逐行就地补 `tenant_id`（只补 `ownership=tenant AND tenant_id IS NULL` 的行），计数按表。
- **导入（B1 接）**：身份索引站在 LATEST 认表；底子 = `assignAt(M)`（本批写过的行随写随进内存链）；把原 `applyDesc` 护栏（位置/归属人工标记、换楼提示、复合名、编码占用）搬到这一行上；**每个导入月写 M 那一行**（src=import，batchId 暂空）；`statusAt(M)==null` → 补 active@M（旧 V87 自愈，未按「有无读数」细分，G10 归 B1）；编码/表类/倍率仍写回 meter（G7 归 B1）。
- **删表**：`meter_assign / meter_status` 对 meter 是 `ON DELETE CASCADE`，batchDelete / delete 不用另删；`meter_archive_log` 不挂外键，留史。
- `GET /api/meters` 加了 `ym`（`MeterController.list`，B2 独占文件里只动了这一处）。
- QueryHygieneTest：AllocService 27→23、BillNoticeService 10→9、ParamService 5→4（`meters.selectList(null)` 换成 `metersAt(ym)`）。

### 2.3 B1 交接（导入 / 撤销 / 批删；后面阶段照这里接）

- **导入一行的顺序**（`MeterService.importRows`）：严格月份（01–12，非法 = 行级错误）→ 认表（G8：按位置 / 标识不认 M 月已拆的表，按编码照认）→ G5（按编码认到别的期区 = 行级错误，整行连读数都不写）→ G6（同批同表同月读数不同 = 后一行行级错误）→ 底子 `assignAt(M)` 上叠册子（`applyDesc`，G1 G2 G3 G4 在这里）→ 状态计划 `statusPlan`（G4 / G10 / 新表）→ G11 查 `frozenMonths`（M 行归属区间 ∪ 有状态计划时的状态区间）→ 写。
- **G11 冻结**：读数照写；归属、状态、资产列（编码 / 表类 / 倍率）一格不改，索引也不换；册子与档案真有不同（diff 非空或有状态计划）才出提示。**新建的表不查冻结**（它不在任何单里；但若更后的月已审，新表会出现在那些月——见遗留）。
- **G10 / 新表**：老表只有本行「本月止」任一格非空才补 active@M；**自动建档的新表不论有无读数都 active@M**（= 新装，同旧行为，SPEC §3.4「新增表自 M 起在册」）。
- **G4**：企业名称含「停用」→ 不当名字（也不收本行 tenantId），retired@M；编码含「已拆」→ 不当编码（不认表、不写回），有读数 removed@M+1、无读数 removed@M；同时有两个字样按已拆。
- **G3**：企业名称与底子不同（canon 比）、本行没给 tenantId、底子有 tenantId → M 行 tenantId 置空 + 提示；同名没给 id = 同一户，照挂。**G2** 新增租户组：`tenant_manual=1` 时企业名称 / tenantId 一格不动，册子不同（canon 比）才提示。
- **G7**：`meter.factor` 只在 M ≥ 该表最新读数月（库里 + 本批已写）时写回；新表取行倍率。
- **G9**：批末才判，旧表若也在本批同一个月出现就不算换表（行序不定，边走边判会误报两块都在用的同址表）。
- **同月已有一行且值一格不差（来源 / 批次号除外）不写**：重导同一份册子不落变更记录、不亮需重算，原行的 src / batch_id 照留。
- **批级断言**：批末查 `meter_archive_log where batch_id=本批` 的 distinct from_ym，必须 ⊆ 本批月份 ∪ G4 拆表的次月，否则 500 整批回滚（数的是真落库的变更记录，不是计划）。
- **需重算（data_change_log，source=`meter-reading`）**：导入（本批写到读数的月）、`createReading`、`updateReading`（新旧两月）、`deleteReading`、`batchDelete` 实删都记。
- **撤销 `revertImport`**：逆序模拟一遍——每条变更记录的「现状」必须等于它的后像（否则 = 之后又改过，含撤过一次），再按每块表的区间查冻结；任一不过整批 409 列出（最多点名 10 处）。过了才写：前像为空 → deleteAssign/deleteStatus，否则按前像的 src 写回（migrate 仍是 migrate），batch_id 清空；这次写的变更记录 `row_ref = "撤销导入 <batchId>"`、src = 被还原行的来源（C2 显示「撤销」要看 row_ref）。末了对波及月统一补 `meter-archive` 需重算（还原成 migrate 的行 timeline 不记）。**不还原**：读数、资产列、自动建档建出来的 meter 资产行（撤掉后它没有归属/状态行 = 哪个月都不在册，读数还在）。
- **批删**：`from_ym=本期 且 src=import` 的归属行与状态行，作用域同读数（kind/zone）；实删前按这些行的区间查冻结，有就 409 整批不删；删用 `Ctx.of("manual")` 留底。
- **前端**：`types/import.ts` 的 `ImportResultDTO` 加了 `batchId? / changes?: ImportChange[]`（C1 结果弹层读它）；`ImportTypeEntry.run` 多一个可选 `fileName`，`runImport` 透传；`metersApi.importRows(rows, fileName?)`、`metersApi.revertImport(batchId): Promise<number>`；`MeterDeleteDTO.assignRows? / statusRows?`（写成可选只为不逼 C1 的两个测试夹具补字段）。
- **提示文案**（G2 G3 G4 G5 G6 G8 G9 G11、撤销 / 批删拒绝）都是新写的，D 阶段过 screen-copy-adversary。

### 2.4 B2 交接（手改 / 状态 / 绑定；后面阶段照这里接）

- **冻结闸的形状**（`MeterService.frozenOf / refuseFrozen`，`MeterBindingService.bind` 同口径）：先 `timeline.frozenMonths(id, 区间)`，再把**查出来的那几个月**交给 `reviewGuard.assertEditable(METERS, …)` —— 审核锁 → 423（全站同一句），剩下的冻结（含这块表的催缴单已确认/已导出）→ 409 点名。与 §2.1「先整段 assertEditable 再 frozenMonths」锁住的月份集合相同（同一张 review_state、scope 空、submitted/approved），但整段交给 reviewGuard 是逐月一次 selectById，自 1900-01 起的行链尾到最大已生成月两千多次。
- **写前先判、判完才写**：PUT /assign 多表时先把每块表的区间都查完，任一冻结整批 409（点名每块），一行不写；建表在 `meters.insert` **之前**判（新表没 id，按 0 号表问 frozenMonths，只会查出审核锁）。测试类是 `@Transactional`，服务里抛异常后外层事务照样看得见已写的行 —— 「先写后判」在 IT 里会假装没回滚。
- **写哪一行**：`MeterService.targetFrom(rows, ym, mode)`（correct 且 ym 落在某段 → 那段的 F；否则 ym）+ `rowAt(rows, id, from)`（有这一行取副本，没有就照 assignAt(from) 复制一行，链空则空行）。bind 与 PUT /assign 共用；`span / fromsOf / label / frozenText` 也改成包内可见给 MeterBindingService 用。
- **PUT /assign 的 patch**：只写出现的键；`patched()` 负责置标记（租户组 / 归属组值变了 → 1；位置三列按 V78 位掩码，与建表 `locManualMask` 同口径）。`alsoMigrateCopies` 只动目标行之后**紧挨着**的 `src=migrate` 且 `MeterTimeline.diff(改前, 行)` 为空的段，遇到第一行不是就停。值一格没变（id/来源/批次号除外）的行不写、不进返回。
- **状态**：POST 写一行 / `replaceFromYm` 挪月；DELETE 第一行 409。`legacyStatus / writeLegacyStatus / carry` 与 MeterReq 的三个旧账期已删（A2 的 ⏳ 过渡写法全部拆掉）。
- **手录读数自愈**：`createReading` 加了 `@Transactional`；`healBeforeFirst`：本月止任一格非空且 statusAt(M)=null → 状态 active@M，归属最早一行晚于 M 时照它在 M 补一行（src=manual）；补的区间 [M, 第一行) 有冻结 → 409 整条拒（读数也不写）。B1 的 `recordChange` 那一行保留。
- **绑定**：`resolveBinding` 里钉的合同家族根 ≠ 这一段租户家族根 → `ownPin=false`：不落段、不采用；自动定不出时 override_stale 的 `contractId=null`（不再回落 `m.contractId`），`pinnedContractNo` 带出钉的那份。`suggestion` 见 §1。`bind` 去掉 @NoReviewGuard 换真守卫；`autoLinkByName` 逐行 frozenMonths，冻结行算 skipped，@NoReviewGuard 保留、reason 已改写。
- **PermissionRegistry**：四个新写端点在 `/api/meters/**` 之前显式登记为 meter-master（与 /** 同值，钉住）。
- **测试**：MeterApiIT 新组独占 2088（8 条），MeterBindingApiIT 新组独占 2087（5 条）；迁到新端点的旧用例：meterCrud / ownershipRegister / dupNotice⑧ / meterLoc 三处 / meterOwner / perColumnPin / suspectClaim（改走资产 PUT）/ A2 过渡用例重写为 `timeline_putAssetOnly_assignByMonth_statusRows`；MeterBindingApiIT 的 bind 助手、BillNoticeApiIT 的 bind 助手带 `ym + mode=correct`（钉 1900-01 那一段 = 原先「钉整块表」）；AllocApiIT 的停用表改走 POST /status。
- **前端**：`api/meters.ts` 的 MeterDTO 去掉三个旧账期、加状态段/归属段字段；新增 MeterAssetReq / MeterAssign* / MeterTimelineDTO / MeterStatus* / BindSuggestionDTO 与 `assign clearManual timeline setStatus deleteStatus statusImpact`，`list` 加 ym，`bind` 加 ym+mode。`npm run typecheck` 余 42 个错误，全在 C 阶段文件（MeterDetailDrawer 29、useMeterWorkbench(+spec) 9、MeterView 2、meterNarrow/meterWriteGuards spec 各 1），都是读旧三列或 bind 少两个参数。**注意**：抽屉现在把整条 MeterReq 交给 `update`，类型上仍然过（MeterReq 结构兼容 MeterAssetReq），但归属字段会被后端忽略 —— C2 必须改走 `assign`。
- **新文案**（冻结拒绝「要改的月份里有冻结的,这次…没有改」、第一行不能删、patch 校验）D 阶段过 screen-copy-adversary。

### 2.5 B3 交接(下游;后面阶段照这里接)

- **终止**:`ContractService.terminate(id, on, vacateMeterIds)` + `terminatePreview(id, on)`;冻结闸同 §2.4 的形状(先 `frozenMonths`,查出来的月交 `reviewGuard`),`ContractService#terminate` 从 `ReviewGuardCoverageTest.NO_MONTH_COLUMN` 移出(那份名单会拒绝对不上豁免的名字)。`ContractServiceTest` 构造多两个 null(不勾表 = 不碰档案,碰了就 NPE)。空置行**不置人工标记**:之后导入新户的册子照常写进来。
- **池**:`AllocService.bindCounts(b, m)` 是唯一判据(loadCtx 的 bindsByRule 过滤);`pools()` 多一次 `viewAt(ym)` 取状态段起始月。池里某月起归了租户的 +1 表**没有告警**,池量静默少这一块(同停用表的「挂零」陈列);要报再加。
- **催缴单**:新告警码按 BILL-NOTICE-WARN-SPEC §7 九步做完(§1.1c 是实测那一步)。`meterTag` 改成包内可见(终止预览复用)。detail 的档案比对走 `timeline.viewAt(单的 ym)`,只在单里有表行时查。
- **需重算**:`ParamService.snap()` 读 `data_change_log` 该月最新一条;`staleSources / lastChangeSource` 给 C3 写「改过参数 / 改过抄表」。`DataHomeServiceTest` 三处 ParamStatusDTO 字面量补了两个参数。
- **操作日志**:`AuditQueryMapper` 第 5 路 + `actors()` 并集 + `SystemService` 白名单;`AuditLogApiIT.SOURCES` 从产品代码读,自动覆盖。
- **前端类型**(C3 消费):`api/contract.ts` `terminate(id, on?, vacateMeterIds?)` / `terminatePreview` + `types/contract.ts` `ContractTerminatePreviewDTO`;`api/billNotices.ts` `void(id, reason)`(原来无调用方)、明细行 `archiveTenantId? / archiveTenantName?`;`api/params.ts` `lastChangeSource? / staleSources?`;`types/system.ts` `AuditSource` 加 `meter`;`api/alloc.ts` `AllocPoolMeterDTO.status? / statusFrom?`。新字段一律可选,只为不逼既有夹具补字段,后端恒下发。
- **测试**:全部独占 2085 年(ContractWriteApiIT 2085-03/04/06、BillNoticeApiIT 2085-02、AllocApiIT 2085-03、ParamApiIT 2085-07、AuditLogApiIT 用 2085-01..03 的档案流水)。同一事务里用 JdbcTemplate 写库会绕过 MyBatis 一级缓存(`lockedNotices` 读到旧的空结果),造冻结数据一律走 mapper。
- **新文案**(D 阶段过 screen-copy-adversary):告警 `W_METER_BILLED_ELSEWHERE` 的 title/desc;终止 400/409 两句;作废理由校验「必须写明理由」;操作日志 detail 里的「在用 / 停用 / 已拆」「导入 / 手改 / 合同终止 / 上线迁移」。

### 2.6 E 修补(对抗复查坐实的 14 条;后面阶段照这里接)

- **后端**:状态挪月不许越过相邻行(409);同房间的表用主表(meterIds 第一块)的起始月写;撤销比对不比 batch_id(先撤后一批再撤前一批可以);导入换户写新行不继承合同钉(同 assignByMonth);终止的空置行 tenant_manual=0;删表 409 文案指到「档案变更 → 在册状态」;首页前置条按 staleSources 说「计费参数 / 抄表数据 / 两者」改过还没重算(`DataHomeService.staleWho`,同前端)。
- **前端**:状态弹框月份框 min/max 限在前后两行之间;两个弹框保存途中取消/关闭不响应;同房间那句写明起始月;`bindReason`(抽屉与悬停)和 `W_METER_BIND_STALE`(块头改「表绑的合同本月用不上」)都说出「钉的是别户合同」这一成因;`healRows` 不算本月已有读数的表(改读数后端不补在册,说明条同步);抽屉 `editMode && !loadErr`;切回页签重拉表档案;抽屉新录读数时分段没加载出来先重拉、仍失败就不存;绑定页签分段失败给失败条 + 重试。
- **没做**:同房间的表各自的冻结月不在弹框里灰显(仍由后端 409 整批点名)。

### 2.7 F 收口(2026-09-24)

- **公告**:`package.json` 0.19.0 → 0.20.0(功能更新,§2.1 第 1 问);`changelog.ts` 0.20.0 一段(重点卡「园区抄表的档案变更」+ 新增 2 + 改进 3 + 修复 3,整版 447 字);配图 `Art0200.vue`(「在册状态」三段缩样,内宽 178 下三行不溢出、高 131 < 文字 152,不撑高卡片)登记进 `art.ts`。
  「已算好的金额不变」的出处:V128 逐格比 0 处不等(A1)+ 开发库池里 +1 绑定的表归属全是 share / ops(按月过滤不剔任何一块)+ 锁定单 7 张明细 11 块表、现挂别户 0 块。
- **规范互指**:METER-SPEC(§1 / §2 / §6.1 / §8.1)、METER-IMPORT-SPEC(§3.2 / §3.3 / §4)、S2-BIND-SPEC(§1 / §2 规则1 / §3)、S21-PARAM-CENTER-SPEC(§5.5 / §6.3)、EDIT-MODE-SPEC(§1.1)各加一句指回;BILL-NOTICE-WARN-SPEC §1.1c 已有,实测条数复数一致。SPEC 按落地回写:§1.4 列名改 `tbl`,新增 §9 落地记录(A1–E 的偏离逐条)。
- **全量**:后端 `mvnw -B verify` 122 个报告文件 1053 条 0 失败 0 错误(9 分 15 秒);前端 vitest 315 文件 4388 条全过;`npm run typecheck` 0 错(775 个 src 文件在查)。
- **独立破坏验证**(串替换改坏 → 跑 → 反向串替换并核 sha1):R4 写一行顺手改后面 → `MeterTimelineIT.writeOneRow…` 红(12 条里 1 红);审核锁冻结关掉 → 3 红(两条 423 + frozenMonths IT);已导出单冻结去掉 `exported` → 7 红;G5 关掉 → `importG5…` 1 红;锁定单排除关掉 → `BillNoticeApiIT.t40` 1 红;拆除不写 L+1 → 抽屉 spec 22 条里 1 红;导入改写底子那一段 → 批级断言先拦(18 红),再关掉批级断言 → `timeline_importWritesOwnMonth…` 的「早月后导不许改后面的月(R4)」红。还原后四个类重跑 94 条全绿。

---

## 3. 覆盖表（用户旅程复核 35 条 + 今天就有的 4 条 → 落点）

| 缺口 | SPEC | 阶段 |
|---|---|---|
| 「同上不写」让后面月被早月插行带走（J1-1/J3-M1） | §3.2 每月写本月行 | A2/B1 |
| 人工标记整表级（J1-6/J3-4） | §1.2 §3.2 G2 §3.3 | A1/B1/B2/C2 |
| 合同钉整表级（J2-3/J3-1/J5-6） | §1.2 §3.6 | A2/B2/C2 |
| 手改被导入冲回（J2-4/J1-M1） | §3.2 G2 | B1 |
| 审核锁只守当月（J3-7/J4-4/J5-3） | §4 | A1/B1/B2/B3/C2 |
| 倍率被老册改写（J1-M2） | G7 | B1 |
| 错码/同批重码（J1-2） | G5 G6 | B1 |
| 「停用」「已拆」字样（J1-4） | G4 | B1 |
| 推导列噪音（J1-5） | canonical 判据 | A1/B1 |
| 新户名未认出沿用老户（J2-1） | G3 | B1 |
| 已拆表被认领（J1-M3） | G8 | B1 |
| 导入前后看不到变化（J1-8） | §3.2 changes | B1/C1 |
| 删本期撤不掉档案行（J1-7/J3-3/J4-M2） | §3.5 | B1/C1 |
| 错配导入无法撤回（J5-10） | §3.5 revert | B1/C2 |
| 退租不联动（J2-2） | §3.6 终止 | B3/C3 |
| 新签不引导（J2-7） | §3.6 suggestion | B2/C2 |
| 同房间多表（J2-6） | §3.3 | B2/C2 |
| 月中换租整月归一户（J2-8） | §3.6 文案 | C2/C3 |
| 切月不重拉 / 导出串月（J3-2，今天就有） | §2 §6 | A2/C1 |
| 抽屉无时间线与来源（J3-6） | §1.4 | A1/B2/C2 |
| 筛不出本月有变化（J3-8） | §6 | A2/C1 |
| 首段之前取不到（J3-M2） | §2 §3.4 自愈 | A1/B2 |
| 拆表当月读数被吞（J4-1，今天就有） | §3.4 | B2/C2 |
| 标拆/停后读数静默（J4-2） | §3.4 确认 | B2/C2 |
| 换表不衔接（J4-3） | G9 + §3.4 提示 | B1/B2/C2 |
| 新增表出现在历史月（J4-5，今天就有） | §3.4 | B2/C1 |
| 导出含非在册表（J4-6） | §6 | C1 |
| 停用无终点无撤回（J3-5/J4-7） | §3.4 列表 | B2/C2 |
| 池绑定改所有月（J4-M1） | §5 池 | B3/C3 |
| 新装表缺底数显已抄（J4-M3） | §3.4 | C1 |
| 换户后重算双收（J5-1，今天就有） | §4 冻结 + §5 生成排除 | A1/B3 |
| 池绑定不分月致双算（J5-2） | §5 池 | B3 |
| 需重算不亮（J5-4/J2-9/J5-8） | §1.5 §5 | A1/B1/B3/C3 |
| 已导出单不一致无提示（J5-5） | §5 | B3/C3 |
| 已导出错单无更正出口（J5-9） | §5 作废 | B3/C3 |
| 档案改动查不到谁改（J5-7） | §1.4 §5 操作日志 | A1/B3/C3 |
| 导入提示被前端丢掉（本轮已修） | — | 已完成 |

不做项与理由见 SPEC §8。复核判为 speculative 的两条（J1-3 身份索引按月、J2-5 一键挂分月）不做。
