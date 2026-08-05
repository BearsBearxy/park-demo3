# 催缴单派生实现规格（S4-BILL-NOTICE-SPEC）

> 2026-08-05 定稿。上游：BILL-DERIVE-SPEC（计价判定树 B + DDL 草案，本文只做增补不重复）。
> 依据：六模块就绪度审计（4 路代码审计 + 8 条论断对抗复核 + dev 库实况）。
> 本文是**实现规格**：锁定拍板项、修订 DDL、定 fee_key 映射、定派生算法与刀序。

---

## 1. 拍板定案（审计遗留 4 项）

| # | 问题 | 定案 | 依据 |
|---|---|---|---|
| 1 | 损耗基数口径：代码=户用电**度数**×I×price_loss vs 规范=(电费+公摊)**金额**×率 | **两算并存，S4-3 用 2024-02 Excel 通知单逐户对照后定死**；引擎先按代码口径出行，金额口径算进 `note` 备查 | 池引擎的度数口径已过逐格验证，但通知单的损耗行没验过；空谈不如实证 |
| 2 | 宿舍房间表判据 | **加 `meter.is_dorm_room` 列**（V89），建档时定死；回填脚本按「zone='dorm' AND ownership='tenant' AND 名称含纯房号」初判+人工核 | room_no 在宿舍区几乎全空（解析正则要求「室」字）；BILL-DERIVE-SPEC §6.1 原建议 |
| 3 | 账外户 | **`tenant.offbook` 标（V89）**；账外户照常出单但 `notice_kind='offbook'`，不进应收口径；名单按 BOOK-STRUCTURE-2024-02 的 10 个账外 sheet 落 fixes 脚本 | BILL-DERIVE-SPEC §6.8 建议出单+标记 |
| 4 | `kind='master_lease'` 整租合同 | **派生引擎直接排除**（现仅 S10-0135 火炬园一份），防与散户双算 | 与 KPI 口径一致 |

另两项复核修正随定案落地：

- **amountOverride 语义以代码为准**：它是 `per_month` 模式的值字段，不是全局 override。修正实体注释与前端注释（**V52 迁移文件不动**——改已应用迁移会炸 Flyway checksum）。纸面价覆盖惯例（仁恒）本就按「翻成 per_month + amount_override」落地，与代码一致。
- **容量费不复用 `lineMonthly`**：`per_kva_month` 分支只返回 kva 本身。派生引擎走 `resolve('capacity_fee', ym, tenantId, zone)`（22.6 已在 V60 种入，可莱恩 23 走 `tenant:{id}` 例外）。

## 2. S4-0 修缮刀（引擎开工前的地基，全部带 IT）

| # | 改动 | 位置 |
|---|---|---|
| 0.1 | `PriceCfgService.resolve` 返回值扩成 `PriceHit(BigDecimal value, String scope, String acctMonth)`；同时把整表一次载入按 (scope,cfg_key) 分组的内存索引（表 <100 行，派生是 户×费项×段 量级，现状 N+1）。11 处既有调用点跟改（AllocService 10 + IT） | PriceCfgService.java:108 |
| 0.2 | `AllocService.memberAmounts()` 与 `Contribution` 提升为包级可见；新增 `poolContributions(ym)`：按 ym 返回**逐池×户级**贡献行（ruleId/tenantId/feeKey/qty/base/rate/price/amount），复用池快照与现有份额解析，不另写算法 | AllocService.java:903/777 |
| 0.3 | `resolveBinding`/`usageSummary` 补排 `suspect='shadow'`（与 AllocService 六处同口径；当前库无 shadow 行，属防患） | MeterBindingService.java:110/208 |
| 0.4 | 新建 `BillFeeMap`：派生行 fee_key → 附表10 colId 的静态映射（§4），含单测 | 新文件（service 包） |
| 0.5 | `ContractService.inForceOn` 提升可见性（派生引擎复用「某月在租」判定） | ContractService.java:65 |
| 0.6 | 注释修正：ContractBillingTerm.java L20、frontend types/contract.ts 的 amountOverride 注释改为「per_month 模式的月额值；其他 billMode 下忽略」 | 两处 |

## 3. V89 DDL（对 BILL-DERIVE-SPEC §4 草案的修订）

草案照抄，**修订如下**（原因：审计发现份额与绑定不落库、按月换绑不支持）：

`bill_notice_line` 增列：

```sql
contract_id  INT UNSIGNED NULL COMMENT '出账时表→合同归属快照(绑定是表级属性,不快照则回溯漂移)',
share_src    VARCHAR(16)  NULL COMMENT '公摊份额来源: member/area/floor/auto;快照当时的解析路径',
```

- `base_snap` 语义扩展：公摊行存**该户份额基数**（层数/㎡/weight），不是池级基数。
- 既有草案列全保留（premise/meter_label/seg/prev_read/curr_read/factor_snap/qty/price_snap/price_key/price_scope/price_month/rule_branch/pool_rule_id/amount/note）。

同迁移加：

```sql
ALTER TABLE meter  ADD COLUMN is_dorm_room TINYINT NOT NULL DEFAULT 0 COMMENT '宿舍房间表(房号计费分间);判定树②分支唯一判据';
ALTER TABLE tenant ADD COLUMN offbook      TINYINT NOT NULL DEFAULT 0 COMMENT '账外户:出单不入应收(notice_kind=offbook)';
```

**bill_pay_company 不改表**。宿舍段拆收款主体不加维度，走 §4 的单据级规则。

## 4. fee_key 词汇与收款主体映射

`bill_notice_line.fee_key` 词汇（**沿用 alloc_result 现值，不造第三套**）：

| 行类 | fee_key | → 附表10 colId（查 bill_pay_company 用） |
|---|---|---|
| 电费段 | `elec` | `elecStd` |
| 电力管理费 | `mgmt_fee` | `elecMaint` |
| 装机容量费 | `capacity` | `elecBasic`（基本用电费=容量费，附表10 现成列） |
| 水费段 | `water` | `waterStd` |
| 水管网维护费 | `water_pipe` | `waterMaint` |
| 楼层公共/电梯/消防/路灯 | `share_elec_floor/elevator/fire/light` | `elecStd` |
| 线路损耗 | `share_elec_loss` | `elecStd` |
| 绿化水公摊 | `share_green_water` | `waterStd` |

拆单规则（替代给 paymap 加维度）：

1. 逐行按上表映射查 `bill_pay_company(tenant_id, colId)` 得收款公司；查无 → 落该户 `elecStd`/`waterStd` 同类兜底；再无 → 单据打 `warn`。
2. **宿舍段例外**：`is_dorm_room` 表产生的行 + dorm 段公摊行，整段拆进 `notice_kind='dorm'` 的单，收款公司取该户 `dormRent` 映射（宿舍收租方=创显），无则同上兜底。
3. 同 (ym, tenant, pay_company, notice_kind) 聚成一张单——一户一套账，物理可多张纸。

fee_key 核对结论（2026-08-05，S4-1 已做）：92 出账池 + 5 损耗侧全过，**无新错**——绿化水泵疑点早在
`pool-fee-key-fix-20260730.sql` 修掉且 dev 已应用；p1 消防类挂 floor 是原册 I/S 合并列口径（不是错，不许改）；
广告字 src 池经 fold_price 出账、自身 fee_key 永不触达催缴单。

## 5. 派生算法 `BillNoticeService.generate(ym)`

单事务，幂等 = `gen_batch` + 先删后插（只删 `status='draft'` 的本批生成单；`issued` 单拒绝覆盖，须先 void）：

```
1 语境：readings(ym) / meters(在服务中,非shadow) / resolveBinding(ym) / 合同(inForceOn, 排 master_lease)
       / poolContributions(ym)[S4-0.2] / alloc_loss_result(ym) / PriceCfg 全量索引 / paymap
2 逐租户电表：判定树 B（BILL-DERIVE-SPEC §2.1）——
   ① 该表当月 curr_peak/flat/valley 任一非空 → 四段行（尖按 sharp_as_peak_ratio 实收峰价）+ mgmt 0.16
   ② is_dorm_room → 居民价 + mgmt 0.16
   ③ 否则商业价 + mgmt 0.32
   ④ tenant:{id} 例外覆盖任一档（resolve 的 scope 链天然处理）
   每行落 price_key/price_scope/price_month/rule_branch 审计链
3 水表：is_dorm_room → 3.85+管网0 / 否则 3.95+0.5 / 户级例外——同链
4 容量费：合同 kva 非空 → kva × resolve('capacity_fee')；起租月按天折（当月天数口径）
5 公摊行：poolContributions 逐池落行（pool_rule_id/share_src/base_snap 快照）
6 损耗行：alloc_loss_result.tenant_rate（组粒度）；宿舍段 resolve('loss_rate',dorm)=0.012；
   基数=户用电度数（定案#1），金额口径写 note 备查
7 拆单归集（§4），offbook 户 notice_kind='offbook'
8 门禁与告警：BILL-DERIVE-SPEC §2.5 的 24 户例外未录 → 该户单打 warn；表在 manual 桶
   （无合同归属）→ 降级挂租户出单+warn；本期合计为负 → 单头 warn
9 回填：按 pool 聚合本批公摊行 → alloc_pool_result.allocated_amount/gap_amount（V71 正名的那两列）
```

绑定优先级：`resolveBinding(ym)` 的行级结果（含 override/auto/auto_bld），**不是**只认 meter.contract_id；出账时把命中的 contract_id 快照进行。

表序号：`meter.sub_name` 排序，NULL 按 `sort_no,id` 顺位补显示号，不回写档案（BILL-DERIVE-SPEC §1.1）。

## 6. 数据前置（与代码并行）

| 任务 | 载体 | 说明 |
|---|---|---|
| 24 户例外价录入 | `backend/scripts/fixes/tenant-price-exceptions.sql` | 按 BILL-DERIVE-SPEC §2.5 清单写 `tenant:{id}` scope；名字→id 现场核对；录后 2024-02 判定树应 100% |
| 宿舍分时 7 户手术 | `backend/scripts/fixes/dorm-tou-merge.sql`（+读数补导） | 28 块空档案（尖/峰/平/谷后缀）删除；分时读数从宿舍册 Excel 灌进基础档案的 8 分时列（7 户中 3 户连基础档读数都缺） |
| is_dorm_room 回填 | `backend/scripts/fixes/dorm-room-backfill.sql` | 初判+人工核对清单输出 |
| offbook 名单 | 同上或独立 fixes | 按 BOOK-STRUCTURE-2024-02 的账外 sheet 清单 |
| fee_key 脏映射核对 | 人工过 92 池 | §4 末段 |
| 26 户合同无起止日期 | 已有存量待办 | inForceOn 会静默漏派——录不齐前这些户出不了单，门禁列警告 |

## 7. 刀序与验收锚点

| 刀 | 内容 | 验收 |
|---|---|---|
| S4-0 | §2 六项修缮 | 后端全量 IT 绿 + 前端 typecheck/vitest 绿；行为零变化（纯重构+补漏） |
| S4-1 | V89 + 数据前置脚本 | 迁移干净重启；例外录入后 spot-check 判定树；宿舍手术前后锚点对账 |
| S4-2 | 引擎 + Controller（generate/list/detail/void） | 新 IT：判定树各分支/拆单/幂等/门禁/负数行 |
| S4-3 | 2024-02 全量复刻 | 与 Excel 通知单逐行对：明细行命中 100%（例外已录），不命中零无法解释项；损耗两口径对照定案 |
| S4-4 | 催缴单屏 + sidebar 出账链 | 目视验收：一户一单列表/单据明细/警告门禁/重新生成 |

**S4-4 v2 拍板（2026-08-05 用户指示，推翻 v1 按单据行陈列）**：
1. 列表**一个租户一条**，对齐 Excel 每租户一张 worksheet；该户全部单据（含宿舍单）合并进同一条，**不做宿舍分类**。
2. **屏上不显示收款主体拆单**——引擎照旧按 paymap 拆单落库（bill_notice 模型不动），只是 UI 聚合；人工审核完成后用户再指示收款公司拆分的展示与签发流。
3. 抽屉分**「场地租金」「水电费」两个 tab**：租金 tab 取该户当月在租合同的计费行（lineMonthly 参考口径：整月、未含免租期/按天折，标注说明）；水电 tab 合并该户全部单据明细行按场地分带。
4. 列表按**一期/二期/三期分 tab**；期归属 = 在租合同楼栋 phase（宿舍类楼栋归一期）→ 回退 premise 前缀 → 兜底一期。
5. 签发/作废按钮本轮撤下（端点保留），待人工审核后按用户指示恢复。

## 8. 遗留（明确不在 S4 做）

- 租金单派生（免租期区间相交、月中按天折的租金侧、amountOverride 相关）——BILL-FORWARD 后续刀
- prev_due 上期欠费接收款流水（催缴闭环，接口点已留 0）
- 一户多单合并展示形态（S4-4 先按 Excel 纵向堆叠范式）
- 批量删读数端点对 bill_notice 的级联守卫（S4-2 落表时一并加 409 守卫，防「读数删了单还在」）
