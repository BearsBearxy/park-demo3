# 表→合同绑定与门禁（S2-BIND-SPEC）— UTILITY-BILLING 刀3 · S2 切片

> 定稿 2026-07-27（开工拍板）。目标：终结正向派生最后一个 blocker「表⇄合同断链」。
> 侦察基线（dev 库 2024-05 实测，见本 spec §6）：910 块租户表，自动归属可达 ~408，人工兜底 ~230-360。
> 抄表数据模型**不动**（1134 块表真实数据），只加列与读侧服务。UI 载体=METER-V4-SPEC（抄表页推翻重做）。

## 1. V63 迁移

```sql
ALTER TABLE meter
  ADD COLUMN contract_id INT UNSIGNED NULL COMMENT '人工绑定覆盖:优先于自动归属规则;口径错位表指认一次持久化' AFTER tenant_id,
  ADD COLUMN device_type VARCHAR(16) NULL COMMENT '表类型:single单相|three三相|multi多功能(分时)|demand需量|bidir双向;口径2026-07-27拍板' AFTER meter_type,
  ADD CONSTRAINT fk_meter_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE SET NULL;
```
不建 meter_contract_bind 表（ponytail: override 列够用——口径错位是表级稳定属性非月度属性；若未来需按月换绑再升级绑定表）。
meter_type 列已被「表类」原文占用（户内用电/公共用电…），表类型另立 device_type。

## 2. 归属规则（读侧派生，按账期月判定）

`resolveContract(meter, ym)` 五级，实现于 MeterBindingService：
1. **override**：meter.contract_id 非空 → 直接采用（若该合同不覆盖 ym 仍采用但标 `override_stale` 警示，不静默失效）；
2. **候选集**：meter.tenant_id 所在**家族**（COALESCE(parent_id,id) 同根全部户）的非草稿、**起止日期齐全**且区间覆盖 ym 的合同（区间重叠：start≤月末 AND end≥月初）——必须放宽到家族（10 份宿舍/商铺合同挂子户、表挂根户，约 72 块表受影响）；
3. 候选唯一 → `auto`；
4. 多条 → meter.building_id 对位后唯一 → `auto_bld`（仅 48 块受益，口径错位 101 块对不上——楼栋对位是弱信号，勿加权重）；
5. 其余 → `manual` 队列，带**分桶原因**：`date_missing`（家族有合同但起止日期 NULL——129 块/26 户，若候选唯一标"一键确认"）｜`ambiguous`（对位后仍多条）｜`bld_mismatch`（对位落空=口径错位）｜`no_contract`（29 块/8 户）。

**规则4修订（2026-08-04，仁恒报障）**：对位落空时，先查家族**本栋缺日期合同**——命中则归 `date_missing` 桶、候选=本栋缺日期合同（唯一时一键确认），而不是 `bld_mismatch`+错栋候选。多楼栋合同户（仁恒：A座/C座 3 份在租 + 宿舍一栋 1 份缺日期 S10-0062）原先被别栋在租合同遮蔽：对位正确的合同因缺日期进不了候选集（规则2），规则5 的 date_missing 又只在零覆盖时触发——正确答案在抽屉里不可见，违背"不设静默兜底"的本意。

表级状态另有三类（先于规则判定）：`pending` 待核（ownership='tenant' 且 tenant_id NULL 且原文有意义）｜`placeholder` 占位槽（原文 NULL/'-'/'（空）'/'已停用'，约 145 块，不计入待核收敛指标）｜非 tenant 表不参与绑定。
**不设静默兜底**：「唯一无日期合同直接挂」虽可救 80 块但掩盖数据缺陷——进 manual 队列标 `date_missing` 一键确认（确认=写 override）。

## 3. 端点（挂 /api/meters 下，权限走全局门）

- `GET /api/meters/binding?ym=` → record{summary, rows[]}：summary=各状态计数（auto/auto_bld/override/override_stale/manual 按桶/pending/placeholder/漏抄数）；rows 每块租户表={meterId, status, bucket?, contractId?, contractNo?, candidates:[{contractId,contractNo,buildingName,startDate,endDate}](manual 时给候选供 UI 选), hasReading}。**这就是归属覆盖率报表**。
- `PUT /api/meters/{id}/bind` → req{contractId(null=解绑)}：写 override；校验合同存在。
- `POST /api/meters/auto-link-by-name` → 按 tenant_name 原文=租户档案名精确唯一匹配的待核表批量挂 tenant_id（侦察实测 19 块），返回{linked, skipped}。幂等。
- `GET /api/meters/usage-summary?ym=` → 户×月聚合（S3 输入面）：rows[]={tenantId, tenantName, kind, meterCount, missingReadings, usageTotal, usageSharp/Peak/Flat/Valley}——复用 MeterService.usage()，只聚合 ownership='tenant' 且 tenant_id 非空的表。

## 4. 明确不做（本切片）

power_type 补录（383 份合同全 NULL 零信号，预填方案作废；电价类别归 S3 按 kva>0 启发+人工，另行拍板）；合同日期回填（数据任务非代码：26 户名单由 binding 报表 date_missing 桶直接给出，回填后自动归属自然提升）；缺档 8 户补合同（业务拍板）。

## 4.5 实施裁量与实测记录（2026-07-27 按实修订）

- override_stale 仅在被绑合同**起止齐全且确定不覆盖**账期时才标（缺日期合同经一键确认后不永久误报）；
- 「家族有合同、日期齐全但不覆盖该月」归 no_contract 桶（不另立桶）；
- **漏抄口径=用量不可派生**（读数行缺失或本月行至为空）——比"行缺失"更诚实：2024-05 全部 910 块租户表有读数行，但 520 行本月行至为空（5 月导入的是表底档基准）；
- 年月选择器在月度段与绑定段共用（绑定按账期月判定）；
- **dev 实测（2024-05）全中锚点**：自动归属 408（直连 360+对位 48）／manual 266（date_missing 128/ambiguous 2/bld_mismatch 101/no_contract 35）／待核 91／占位 145／漏抄 520（电 397+水 123）。

## 5. 测试与验收

MeterBindingApiIT（共享容器/2099 槽/探针）：override 优先与 stale 警示／家族放宽命中（子户合同+根户表）／date_missing 分桶／building 对位唯一／no_contract／pending 与 placeholder 分类／bind 写与解绑／auto-link-by-name 幂等／usage-summary 聚合与漏抄计数。
**dev 实测锚点（2024-05）**：自动归属(auto+auto_bld) ≥ 406；placeholder ≈145；待核 ≈91；漏抄=0。浏览器目视=METER-V4 绑定面板数字与此吻合。

## 6. 侦察基线数据（2026-07-27 dev 实测，供回归对照）

租户表 910（电479/水431）；tenant_id 已挂 674；cov 分布(2024-05)=0:165 / 1:358 / 2:144 / 3:7；多合同 151 中楼栋对位唯一 48、落空 101、仍多 2；cov=0 拆因=缺日期 129(26户)/不覆盖 7(2户)/无合同 29(8户)；家族错位=表挂子户 1 vs 合同挂子户 10；未挂 236 中占位/停用 ≈145、名称精确可匹配 19；meter_reading 仅 2024-05（1134 条全表零漏抄）。
