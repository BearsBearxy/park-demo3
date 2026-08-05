# S5 场地化账单实施计划（四刀）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 催缴单 = 租金大板块（正式出单、按天折、免租期）+ 水电大板块，一个地块一个地块给；最终锚点=可莱恩 2024-02 整单 13,290.02+427.64 逐分全等。

**Architecture:** 场地粒度=合同计费行（S5-PREMISE-BILL-SPEC §0#5）。V90 加 `area_shared`+`fee_group` 两列；租金派生并入 BillNoticeService.generate 同一事务；公摊份额改按 `area+IFNULL(area_shared,0)`；存量数据手术走 backend/scripts/fixes（只起草→备份→应用→验证锚点）。

**Tech Stack:** Spring Boot 3 + MyBatis-Plus + Flyway（后端）；Vue3+TS+Vitest（前端）；dev MySQL=docker demo3-mysql:13306。

## Global Constraints

- 规格唯一事实源：`docs/design/S5-PREMISE-BILL-SPEC.md`（引用为 S5 §n）
- 后端全量验证：`.\mvnw.cmd -q verify` 退出码 0 为裁决；定向 `-Dit.test=A,B`（逗号分隔）
- 前端验证：`npm run typecheck`（禁裸跑 vue-tsc）+ `npx vitest run`
- IT 槽约定：月份槽独占（BillNoticeApiIT 已占 2090-01..10，新用例从 2090-11 起领）；绝对计数断言只圈自建数据
- dev 库操作：`docker exec demo3-mysql mysql -uroot -proot --default-character-set=utf8mb4 park_demo3`（中文 LIKE 必须带 charset；PowerShell 管道中文乱码→落文件）
- 数据手术：脚本只起草落 `backend/scripts/fixes/`，应用前 `mysqldump > backup-before-s5-刀N-日期.sql`，头注释=目的+依据+验证段+回滚
- 不改任何已应用迁移（V1~V89）；新迁移号从 **V90** 起
- 已知拍板遗留（悬案）：438室、C402 楼层公共 10.03 —— 刀1 Task 3 产出材料给用户，拍板前引擎行为不变
- git 提交尾行：`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: V90 迁移 + 实体/DTO/校验 + 合同编辑器公摊面积格

**Files:**
- Create: `backend/src/main/resources/db/migration/V90__premise_bill.sql`
- Modify: `backend/src/main/java/com/park/demo3/entity/ContractBillingTerm.java`（加 areaShared）
- Modify: `backend/src/main/java/com/park/demo3/entity/BillNoticeLine.java`（加 feeGroup）
- Modify: `backend/src/main/java/com/park/demo3/service/ContractService.java`（validateLines 加 areaShared≥0）
- Modify: `backend/src/main/java/com/park/demo3/dto/`（BillingLine 读写 DTO + BillNoticeDetailDTO.Line 加 feeGroup）
- Modify: `frontend/src/types/contract.ts`、`frontend/src/api/billNotices.ts`（同步字段）
- Modify: `frontend/src/views/contracts/` 计费行编辑器（公摊面积输入格 + 「面积=建筑面积」提示文案）
- Test: `backend/src/test/java/com/park/demo3/api/ContractApiIT.java`（就近加用例）

**Interfaces:**
- Produces: `ContractBillingTerm.getAreaShared(): BigDecimal|null`；`BillNoticeLine.feeGroup: 'rent'|'elec'|'water'`；分摊面积公式 `allocArea(t) = t.area + IFNULL(t.areaShared, 0)`（Task 4/7 消费）

- [ ] **Step 1: 写 V90**

```sql
-- V90__premise_bill.sql — S5 §1:公摊面积单列 + 明细行费用组
ALTER TABLE contract_billing_term
  ADD COLUMN area_shared DECIMAL(12,2) NULL
  COMMENT '公摊面积;非空=area为建筑面积(分摊按area+area_shared,账单显示拆解),空=area已含公摊;宿舍留空(S5 §1)';
ALTER TABLE bill_notice_line
  ADD COLUMN fee_group VARCHAR(8) NULL COMMENT 'rent/elec/water;板块分组与paymap首路由(S5 §1)';
UPDATE bill_notice_line SET fee_group = CASE
  WHEN fee_key IN ('water','water_pipe','share_green_water') THEN 'water' ELSE 'elec' END;
```

- [ ] **Step 2: 实体/DTO/校验跟改**（areaShared `@DecimalMin("0")`；validateLines 数组加 areaShared；detail DTO Line 加 feeGroup 透传）
- [ ] **Step 3: ContractApiIT 加失败测试**——PUT 计费行带 `"areaShared":458` 回读=458；带 `-1` 报 400。先跑确认红：`.\mvnw.cmd -q verify "-Dit.test=ContractApiIT"`
- [ ] **Step 4: 实现至绿**（同命令 exit 0）
- [ ] **Step 5: 前端编辑器加格 + typecheck/vitest 绿**
- [ ] **Step 6: 重启 dev 后端（preview_stop/start）确认 Flyway 89→90；提交** `feat(s5): V90 公摊面积+费用组`

### Task 2: 宿舍逐间拆行手术（数据）

**Files:**
- Create: `backend/scripts/fixes/dorm-room-split-20260805.sql`（只起草）
- Create: `backend/scripts/fixes/dorm-room-split-review.tsv`（人工核对清单）

**Interfaces:**
- Consumes: 无代码依赖（纯数据）；源册=宿舍水电册 + 2024-03 合同册（`C:\financial_dashboard\2025全年发生额、预算对比\...`）
- Produces: 宿舍段计费行一间一行（location=单间房号原文，area=该间面积）——Task 5 租金逐间行、Task 7 宿舍 premise 房号 依赖此数据形态

- [ ] **Step 1: 摸底查询**——`SELECT contract_id, location, area FROM contract_billing_term WHERE property_type='dorm' AND (location LIKE '%、%' OR location LIKE '%-%室%')` 列全部合并行（预期含 可莱恩 S10-0057「430、431、432、434室」184.48）
- [ ] **Step 2: 起草拆行脚本**——每条合并行 DELETE+逐间 INSERT（费项/单价/bill_mode 继承原行，area=册面单间面积；护栏=按 contract_id+location+fee_key 精确匹配原行，Σ新行面积与原行差>0.5㎡ 的进 review.tsv 不自动拆）；**可莱恩 436/438 面积 26.17/46.89→36.53/36.53 一并修**（S5 §5①锚点）
- [ ] **Step 3: 备份→应用→验证**——验证段：可莱恩 S10-0057 宿舍行=6 行×单间面积 74.52/31.93/46.02/32.01/36.53/36.53，Σ=257.54 不变；全库 dorm 行 Σ面积 前后差=0（±可莱恩修正 20.36）
- [ ] **Step 4: 提交** `data(s5): 宿舍计费行逐间拆分`

### Task 3: area_shared 补录 + 租金核对清单 + 两悬案材料（数据）

**Files:**
- Create: `backend/scripts/fixes/area-shared-backfill-20260805.sql`（只起草）
- Create: `backend/scripts/fixes/area-shared-rent-review.tsv`（租金核对清单，给用户）

**Interfaces:**
- Produces: 受影响户计费行 area_shared 落值（Task 4/7 的分摊公式立即受益）；438/C402 拍板材料

- [ ] **Step 1: 提取**——两册「租户分摊公共用电金额」sheet 逐户逐场地抄 租赁面积列；与库内该户该场地 rent 行 area 对比，差>0.5㎡ 的 = 补录对象（可莱恩 A602 差 458、B201 差 1350 为已知锚点）
- [ ] **Step 2: 起草补录 SQL**——`UPDATE contract_billing_term SET area_shared=<差额> WHERE contract_id=? AND location=? AND fee_key LIKE 'rent_%' AND area_shared IS NULL`；同批产出 review.tsv：户/场地/建筑面积(库)/册面面积/差额/**该户月租金(库) vs 单价×册面面积**两列——纸面租金按哪个面积计，逐户给用户过目（S5 §5②：租金不静默变）
- [ ] **Step 3: 438/C402 拍板材料**——438：档案/合同/读数三方证据 vs 册面未收（已有取证，整理成两段结论+两个选项）；C402：rule 57 成员摘除 vs 补 C402 合同（同）。发给用户，**不阻塞后续 Task**（引擎拍板前行为不变）
- [ ] **Step 4: 备份→应用补录 SQL→验证**——可莱恩两行 area_shared=458/1350；`SELECT COUNT(*) FROM contract_billing_term WHERE area_shared IS NOT NULL` 与 review.tsv 行数一致
- [ ] **Step 5: 提交** `data(s5): 公摊面积补录+租金核对清单`

### Task 4: A座电梯池成员 + 一期绿化水池（数据+一处引擎公式）

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/service/AllocService.java`（areaByZoneTenant/显式成员面积改分摊公式）
- Create: `backend/scripts/fixes/p1-elevator-green-20260805.sql`（rule40 成员 + 绿化水建池 + green_area_base 15510→80000）
- Test: `backend/src/test/java/com/park/demo3/service/AllocPoolContributionsIT.java`（就近加用例）

**Interfaces:**
- Consumes: Task 1 的 `allocArea` 公式、Task 3 的 area_shared 数据
- Produces: `AllocService` 内 area 法份额一律 = Σ该户 rent 行 `area+IFNULL(area_shared,0)`（按行分场地）；Task 7 的 splitShare 直接继承

- [ ] **Step 1: 失败测试**——AllocPoolContributionsIT 新用例（槽 2091-02）：自建户两条 rent 行（area 100/area_shared 50 与 area 200/无 shared），area 法池贡献基数=350 非 300
- [ ] **Step 2: 改 AllocService**——areaByZoneTenant 与显式成员 areaByTenant 从 contract.rent_area 改为 Σ计费行 `(area+IFNULL(area_shared,0))`（仅 BUILDING_RENT_KEYS 行；无计费行的合同回退 rent_area 并入 warn）。跑绿
- [ ] **Step 3: 起草+应用 p1-elevator-green SQL**——rule40 补 A座电梯成员（名单=分摊表电梯列非空的A座户）；新建 p1 绿化水池绑表 390/391/392；`UPDATE tenant_price_cfg SET cfg_value=80000 WHERE scope='p1' AND cfg_key='green_area_base'`（15510 误拷修正，S5 §3.1）
- [ ] **Step 4: 重启后端→重生成 2024-02 核算+催缴单→dev 锚点**——可莱恩 share 行：电梯 A602=158.88、路灯 79.44/162.00、绿化水 17.87/36.45（`SELECT ... WHERE company_name='可莱恩' AND fee_key LIKE 'share%'` 逐行对）
- [ ] **Step 5: 全量 verify exit 0；提交** `feat(s5): 分摊面积公式+电梯绿化水池落地`

### Task 5: 租金派生引擎

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/service/BillNoticeService.java`（rentLines/prorate/rentFreeCut 三方法 + generate 接线）
- Modify: `backend/src/main/java/com/park/demo3/service/BillFeeMap.java`（rent 13 枚举→附表10 colId）
- Test: `backend/src/test/java/com/park/demo3/api/BillNoticeApiIT.java`（t11~t14，槽 2090-11..14——**先 grep 确认未被他人占用**）

**Interfaces:**
- Consumes: `ContractService.lineMonthly(term, kva)`（static，已 public）、`MeterBindingService.covers`、Task 1 的 feeGroup
- Produces: fee_group='rent' 的明细行（premise=行 location、rule_branch='rent'、note=折算式）；Task 9 UI 按它渲染租金板块

- [ ] **Step 1: BillFeeMap 扩 rent 映射（含单测）**

```java
// S5 §2:rent 侧 (property_type, fee_key) → 附表10 colId;mgmt/infra 按段类型分列
// rent_factory→factoryRent  rent_office→officeRent  rent_dorm→dormRent  rent_shop→shopRent  rent_land→landRent
// mgmt: factory→factoryMgmtFee office→officeMgmtFee shop→shopMgmtFee
// infra: factory→infraFactory office→infraOffice shop→infraShop dorm→infraDorm(宿舍基础设施费=dormFacilityFee 由 rent_dorm 段判定,见册面科目核对)
// elevator→elevatorMaint  transformer→transformerMaint  access→accessMaint  network→networkFee  land_tax→landUseTax  other→otherFee
```
（BillFeeMapTest 断言全部映射值 ∈ RECON_FEES s10Key 集合）

- [ ] **Step 2: t11 失败测试（整月租金）**——自建户+合同（2089-01-01~2099-12-31）带 billingLines：`rent_factory per_sqm_month area=100 unitPrice=10` + `mgmt per_sqm_month area=100 unitPrice=2`；generate(2090-11) 断言 rent 行 2 条、金额 1000.00/200.00、feeGroup='rent'、premise=行 location、noticeKind 拆单按 factoryRent paymap
- [ ] **Step 3: prorate/rentFreeCut 实现**

```java
// 在租天数/当月天数;整月=1(不出折算note)
private static BigDecimal prorate(Contract c, LocalDate first, LocalDate last) {
    LocalDate s = c.getStartDate().isAfter(first) ? c.getStartDate() : first;
    LocalDate e = c.getEndDate().isBefore(last) ? c.getEndDate() : last;
    long days = ChronoUnit.DAYS.between(s, e) + 1;
    int len = first.lengthOfMonth();
    return days >= len ? BigDecimal.ONE
        : new BigDecimal(days).divide(new BigDecimal(len), 8, RoundingMode.HALF_UP);
}
// 免租期仅扣 rent_* 费项(管理费/基础设施费照收,园区惯例);区间与本月相交天数按天折
private static BigDecimal rentFreeCut(Contract c, BigDecimal monthly, LocalDate first, LocalDate last) {
    // 解析 c.getRentFree() JSON 数组 [{"start","end"}](复用 ContractService.validateRentFree 同一解析口径),
    // Σ(相交天数)/lengthOfMonth × monthly,r2;解析失败=0并入warn
}
// rentLines():逐 covering 合同(排 master_lease/draft;缺日期→整户 warn「缺起止日期,租金未派生」不出行)
// 逐计费行:monthly=lineMonthly(t,c.getKva());null→warn跳过;amt=r2(monthly×ratio);rent_*再减rentFreeCut;
// note=非整月时「1130÷31×26」式折算式;premise=t.location;fee_group='rent';rule_branch='rent'
```

- [ ] **Step 4: t12 按天折**（合同 2090-12-06 起租，slot 2090-12：`monthly×26/31`，note 含「÷31×26」）；t13 免租期（rent_free 覆盖整月→rent 行 0.00、mgmt 行照收）；t14 缺日期户 warn 且无 rent 行。逐个红→绿
- [ ] **Step 5: 全量 verify exit 0；重启+重生成 2024-02；dev 抽查**——可莱恩月租金板块逐行=合同条款（S10-0057 六间宿舍逐间行）
- [ ] **Step 6: 提交** `feat(s5): 租金正式派生(按天折/免租期/拆单)`

### Task 6: 水电行名带池名 + 宿舍房号 premise

**Files:**
- Modify: `backend/src/main/java/com/park/demo3/service/BillNoticeService.java`（detail 读时 join alloc_rule.name）
- Modify: `backend/src/main/java/com/park/demo3/dto/BillNoticeDetailDTO.java`（Line 加 poolName）
- Modify: `frontend/src/utils/billNoticeLogic.ts` + `BillNoticesView.vue`（行名=「费项·池名」；宿舍行 premise 已因 Task 2 变单间房号，分组函数按房号出行）
- Test: BillNoticeApiIT 就近断言 + billNoticeLogic.spec.ts

**Interfaces:**
- Consumes: Task 2 的逐间数据形态；bill_notice_line.pool_rule_id
- Produces: `BillNoticeDetailDTO.Line.poolName: String|null`

- [ ] **Step 1: detail join + DTO 字段 + IT 断言**（share 行 poolName 非空=alloc_rule.name）
- [ ] **Step 2: 前端行名渲染 + 宿舍逐间断言更新；typecheck/vitest 绿**
- [ ] **Step 3: 提交** `feat(s5): 公摊行带池名+宿舍真房号`

### Task 7: 可莱恩整单锚点复刻（刀3 验收）

**Files:**
- Modify: `demo3/scripts/verify_bill_notice_202402.py`（损耗列标签修正：amount 已是金额口径）
- Create: 无（验证性任务）

- [ ] **Step 1: 重启→重生成 2024-02 核算+催缴单**
- [ ] **Step 2: 可莱恩逐行对**——非宿舍 13,290.02：A602(电425.36+管171.39+楼层0+电梯158.88+损耗35.99+路灯79.44) + B201(容量7187.50+四段3314.95+管550.91+楼层82.67+电梯302.50+损耗78.81+路灯162.00) + 水(222.57+517.05)；宿舍 427.64（438 按拍板口径，未拍板前允许 +5.41+2.19+0.94 已归因差）；C402 10.03 按拍板（未拍板前允许 −10.03 已归因差）
- [ ] **Step 3: 2024-02 全量对账重跑**——命中率与上轮（64.1%/82.5%）对比入报告
- [ ] **Step 4: 提交** `test(s5): 可莱恩整单锚点+全量对账第三轮`

### Task 8: 催缴单页面租金板块（刀4）

**Files:**
- Modify: `frontend/src/views/bills/BillNoticesView.vue`（场地租金 tab 改渲染 fee_group='rent' 落库行：厂房块/办公室块/宿舍逐间块，显示面积拆解「1528+458」、折算式备注；删「参考口径」灰字与现算逻辑）
- Modify: `frontend/src/utils/billNoticeLogic.ts`（groupRentByPremise 纯函数）
- Test: `frontend/src/utils/billNoticeLogic.spec.ts`

- [ ] **Step 1: groupRentByPremise 失败测试**（可莱恩缩样：A602 块 2 行/宿舍 430室 块 4 行/块小计/全户合计）→ 实现绿
- [ ] **Step 2: 视图接线**；typecheck+vitest 绿
- [ ] **Step 3: 浏览器目视验收**（用户 Chrome：可莱恩租金板块与其 worksheet 并排）；截图留档
- [ ] **Step 4: 提交** `feat(s5): 租金板块正式明细上屏`；更新 memory + S5 spec 状态段

---

## Self-Review 记录

- 规格覆盖：S5 §1→Task1；§2→Task5；§3.1→Task4；§3.2/3.3→Task6；§4 合同页→Task1、催缴单页→Task8；§5①→Task2、②→Task3、③④→Task4、⑤→Task3.Step3、⑥=既有警告机制（Task5 缺日期 warn 覆盖）；§6 刀3 锚点→Task7。无缺口。
- 占位扫描：数据手术类步骤给的是"提取程序+已知锚点+验证段"，非 TBD；引擎步骤含代码。通过。
- 类型一致：`allocArea` 公式在 Task1 定义、Task4/7 消费同名；feeGroup 值域三处一致；poolName 仅 Task6 定义使用。通过。
