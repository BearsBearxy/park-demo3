# demo3 P1 月度台账(Ledger)子系统 — 设计规范

> 事实源:`_handoff_extracted/untitled/project/app/screen-ledger.jsx` + `ledger-tenants-data.js`(数据模型/费用口径) + `fin-common.jsx`(多公司动线参照)。像素事实源:`园区管理系统(单文件离线版).html`。组件保真基准:`docs/design/DESIGN-FIDELITY.md`。
> 状态:草案,待用户复审。

---

## 1. 目标与范围

**目标**:把「多管理公司、一行一租户的月度费用宽表」做成工程化全栈子系统 —— 真实库表 + 读写 API + 四级录入屏 + Excel 导出。

**本 spec 范围(第一步)**:
- `management_company` 公司注册表(增删改名,共享基础实体)
- `monthly_ledger` 稀疏宽表存储 + 读写 API
- 四级前端屏(⓪选公司 → ①年/月历 → ②月度宽表 → ③租户明细抽屉)手工录入
- 「从上月复制」(含结余结转)
- Excel **导出**(前端 SheetJS)
- 确定性种子(3 公司 × 真实租户 × 2026 年 1–5 月)

**不做(后续登记)**:Excel **导入**(下一份 spec,解析/校验/事务上表) · 跨公司**全部汇总**(P2 三大报表) · bills/bank-flow/附表子系统 · data-home 聚合。

---

## 2. 全局约束(Global Constraints)

- Java 17(本机仅 JDK 17,用 `./mvnw`);Spring Boot 3.3.5 + MyBatis-Plus + Flyway;统一 `Result<T>` 封装;JWT 保护。
- 前端 Vue3 `<script setup lang=ts>` + Vite;仅用 DS 令牌与组件;**禁紫禁绿禁渐变**;等宽数字 `var(--font-mono)`。
- **派生值绝不落库**:`totalReceivable`(=Σ21费用列)、`balanceEnd`(=balancePrev+应收−收款)读时算,不建列。
- **稀疏存储**:只持久化有数据的台账行;显示时 LEFT-JOIN 在租租户名单补零。
- ledger 行 **FK 到真实 `tenant` 表**(13 个在租租户,id 1–13;id 14 已退租不计);弃用原型独立租户名单。
- 多公司各自维护**同结构独立台账**,互不影响;公司与费用列**无固定绑定**;ledger 自身选择页**无「全部汇总」**(那是 P2 报表概念)。
- 金额 `DECIMAL(14,2)`;计算用 `BigDecimal`,四舍五入 2 位。

---

## 3. 数据模型

### 3.1 21 个费用列(固定,源 `ledger-tenants-data.js` FEE,顺序即列序)

| 组 | key → 标签(宽度 px) |
|---|---|
| 租金 | factoryRent 厂房租金(96) · factoryMgmtFee 厂房企业管理服务费(130) · shopRent 商铺、宿舍租金(112) · dormRent 宿舍租金(88) · dormFacilitiesFee 宿舍配套费(96) · shopMgmtFee 商铺企业管理服务费(130) |
| 基础设施维护费 | factoryInfraMaint 厂房基础设施维护费(130) · shopInfraMaint 商铺、宿舍基础设施维护费(152) · dormInfraMaint 宿舍基础设施维护费(130) |
| 办公室、厂房费用 | elevatorMaint 电梯维护费(96) · transformerMaint 变压器维护费(104) · landUseTax 土地使用税(96) · networkFee 网络通讯费(96) · accessCtrlMaint 门禁设施维护费(112) · officeOtherFee 其他费用(88) |
| 宿舍费用 | dormOtherFee 宿舍其他费用(104) |
| {prev}月电费 | basicElectricity 基本用电费(96) · standardElectricity 基准电费(88) · electricityMaint 电维护费(88) |
| {prev}月水费 | standardWater 基准水费(88) · waterMaint 水维护费(88) |

固定左列:tenantName 租户(132) · balancePrev `{prev}月结余`(104)。
固定右列:totalReceivable 本月应收合计(116,派生) · totalCollected 本月收款(104) · balanceEnd 本月结余(104,派生) · note 备注(150)。
> 组名「{prev}月电费/水费」与「{prev}月结余」中的 `{prev}` = 当前月的上一月号(1 月→12),前端按所选月动态渲染。

### 3.2 公式

```
totalReceivable = Σ(21 费用列)
balanceEnd      = balancePrev + totalReceivable − totalCollected
页脚合计行       = 各列对当前可见行求和
```

### 3.3 迁移 V4 建表

```sql
CREATE TABLE management_company (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(64) NOT NULL,
  short      VARCHAR(8)  NOT NULL,         -- 2 字简称,徽标/头像用
  sort_no    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_company_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE monthly_ledger (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  company_id   INT UNSIGNED NOT NULL,
  tenant_id    INT UNSIGNED NOT NULL,
  period_year  SMALLINT UNSIGNED NOT NULL,
  period_month TINYINT  UNSIGNED NOT NULL,         -- 1..12
  -- 21 费用列(顺序同 §3.1),均 DECIMAL(14,2) DEFAULT 0
  factory_rent DECIMAL(14,2) NOT NULL DEFAULT 0, factory_mgmt_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  shop_rent DECIMAL(14,2) NOT NULL DEFAULT 0, dorm_rent DECIMAL(14,2) NOT NULL DEFAULT 0,
  dorm_facilities_fee DECIMAL(14,2) NOT NULL DEFAULT 0, shop_mgmt_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  factory_infra_maint DECIMAL(14,2) NOT NULL DEFAULT 0, shop_infra_maint DECIMAL(14,2) NOT NULL DEFAULT 0,
  dorm_infra_maint DECIMAL(14,2) NOT NULL DEFAULT 0,
  elevator_maint DECIMAL(14,2) NOT NULL DEFAULT 0, transformer_maint DECIMAL(14,2) NOT NULL DEFAULT 0,
  land_use_tax DECIMAL(14,2) NOT NULL DEFAULT 0, network_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  access_ctrl_maint DECIMAL(14,2) NOT NULL DEFAULT 0, office_other_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  dorm_other_fee DECIMAL(14,2) NOT NULL DEFAULT 0,
  basic_electricity DECIMAL(14,2) NOT NULL DEFAULT 0, standard_electricity DECIMAL(14,2) NOT NULL DEFAULT 0,
  electricity_maint DECIMAL(14,2) NOT NULL DEFAULT 0,
  standard_water DECIMAL(14,2) NOT NULL DEFAULT 0, water_maint DECIMAL(14,2) NOT NULL DEFAULT 0,
  -- 录入字段
  balance_prev    DECIMAL(14,2) NOT NULL DEFAULT 0,
  total_collected DECIMAL(14,2) NOT NULL DEFAULT 0,
  note            VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ledger (company_id, period_year, period_month, tenant_id),
  KEY idx_ledger_cym (company_id, period_year, period_month),
  CONSTRAINT fk_ledger_company FOREIGN KEY (company_id) REFERENCES management_company(id),
  CONSTRAINT fk_ledger_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenant(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```
DB 列 snake_case;Java 字段/JSON camelCase(MyBatis-Plus `map-underscore-to-camel-case` 已开)。`total_receivable`/`balance_end` **不建列**。

### 3.4 删除守卫

`DELETE /api/companies/{id}`:若该公司存在任一 `monthly_ledger` 行 → 409 `Result.error`(「该公司已有台账数据,不可删除」),否则物理删除。

---

## 4. 后端 API(均 JWT 保护,`Result<T>` 封装)

### 4.1 公司注册表 `CompanyController`
- `GET /api/companies` → `List<CompanyDTO>{id,name,short,sortNo}`,按 sortNo,id 排序
- `POST /api/companies {name}` → `CompanyDTO`;后端派生 short(规则同原型:去「园区」前缀、去「有限/管理/运营/物业/公司/产业」词、取前 2 字);名重复 → 409
- `PUT /api/companies/{id} {name}` → `CompanyDTO`;重名 409
- `DELETE /api/companies/{id}` → 见 §3.4

### 4.2 台账 `LedgerController`
- `GET /api/ledger/companies/{id}/overview?year=YYYY` → `LedgerOverviewDTO`
  ```
  { companyName, year, monthsWithData, ytdRecv, avgRecv, activeTenants,
    months: [ { month, recv, coll, tenants, status } x12 ] }   // status: done|current|empty
  ```
  - 某月有任一 ledger 行 = 已录入。status:无数据→empty;有数据且 `month == 该年有数据月份的最大值`→current(「进行中」);其余有数据→done。(不耦合系统时钟,确保种子里最新月恒为「当前」,对齐原型。)recv/coll = 该月各行应收/收款之和;tenants = 该月 totalReceivable>0 的行数。ytdRecv=Σ各月 recv;avgRecv=ytdRecv/monthsWithData;activeTenants=当前在租租户数(13)。
- `GET /api/ledger/companies/{id}/months/{year}/{month}` → `LedgerMonthDTO`
  ```
  { companyName, year, month, prevMonth,
    rows: [ { tenantId, tenantName, balancePrev, <21 费用 camelCase>,
              totalCollected, note, totalReceivable, balanceEnd } ],  // 派生两列由后端算好
    footer: { <每列合计>, totalReceivable, totalCollected, balanceEnd } }
  ```
  - **行 = 全部在租租户**(13),按 tenant.id;存储有行则取值,无则全零。派生两列后端算好返回(前端编辑态再前端重算)。
- `PUT /api/ledger/companies/{id}/months/{year}/{month}` body `{ rows:[{tenantId, balancePrev, <21费用>, totalCollected, note}] }` → 保存
  - 逐行:任一费用/balancePrev/totalCollected≠0 或 note 非空 → upsert(按 uk_ledger);全空 → 若存在则删除。事务。返回刷新后的 `LedgerMonthDTO`。
- `POST /api/ledger/companies/{id}/months/{year}/{month}/copy-from-prev` → 「从上月复制」
  - 以上月(同公司)各行为模板写入本月:21 费用照搬、`balancePrev := 上月该租户 balanceEnd`、`totalCollected := 0`、note 清空;本月已有行则覆盖。事务。返回本月 `LedgerMonthDTO`。上月无数据 → 409(「上月无台账数据」)。

### 4.3 后端文件(`com.park.demo3`)
- entity:`ManagementCompany`、`MonthlyLedger`(Lombok `@Data`,21 费用字段)
- mapper:`ManagementCompanyMapper`、`MonthlyLedgerMapper`(BaseMapper;月查询用 `selectList(QueryWrapper)`)
- dto:`CompanyDTO`、`LedgerOverviewDTO`(内含 `MonthMeta`)、`LedgerMonthDTO`(内含 `LedgerRowDTO`、`LedgerFooter`)、`LedgerSaveRequest`
- service:`CompanyService`(CRUD+short 派生+删除守卫)、`LedgerService`(overview/月读稀疏补零/保存 upsert+删空/copy-from-prev;`recalc(row)` 共享派生)
- controller:`CompanyController`、`LedgerController`

---

## 5. 前端(路由 `ledger` → `LedgerView.vue`)

状态机:`companyId(null=⓪) · year · month(null=①) · drawerTenantId · edit`。1:1 对齐 `screen-ledger.jsx` 四级动线 + DESIGN-FIDELITY 令牌。

- **⓪ `LedgerCompanyPicker.vue`**:页头(标题「月度台账」+ 新建公司按钮)+ 公司卡网格(头像簢称 + 名称 + 「记账租户 N 户」「{当前月}月应收 ¥X万」)+ 虚线「新建管理公司」卡 + 脚注。`LedgerNewCompanyDialog.vue`(名称输入、重名校验、提交→`POST /companies`→进入①)。
- **① `LedgerMonthGrid.vue`**:页头(公司徽标〔点击回⓪〕+ 年份胶囊 + 导入Excel〔**禁用占位**,tooltip「导入即将上线」〕)+ 4 KPI(已录入月份 N/12 · 全年累计应收 · 月均应收 · 记账租户)+ 12 月卡片(当前月高亮「当前/进行中」、已录显 ¥万 + N 户、空月虚线「暂无数据」不可点)。数据来自 overview。
- **② `LedgerWideTable.vue` + `FPLedgerTable.vue`**:页头(返回 + 徽标 + 〔读态〕导出Excel·编辑 /〔编辑态〕从上月复制·取消·保存)+ 4 KPI(应收合计/已收合计/期末余额/记账租户)+ 工具栏(搜索租户 + 提示)+ **宽表** + 脚注。
  - `FPLedgerTable`:两级表头(组 colSpan + 叶列)、左右 sticky 固定列(含表头/页脚 z-index 分层,源 lgStyles)、tbody filler 撑高、tfoot 合计行(应收=brand-deep、结余=橙/红)。读态显示格式化数字/「–」;编辑态费用列 number 输入、备注 text 输入、租户名/上月结余/应收/结余只读;点租户名 → ③。
  - 保存:`PUT`;取消:还原服务端数据;从上月复制:`POST copy-from-prev` 重载。`lgRecalc(row)` 前端纯函数(编辑时即时重算应收/结余/页脚)+ vitest。
- **③ `LedgerTenantDrawer.vue`**:页内右抽屉。3 stat(应收合计/本月收款/本月结余,结余按正橙负红)+ 「结转」分组(上月结余)+ 费用分组(仅非零,按 §3.1 组,组内小计)+ 备注。数据用②已加载行,无额外请求。

复用 DS:`KpiCard`/`Button`/`SearchField`/`Card`/`Avatar`。新增 lucide 图标按需补 `icon.ts`(layers/repeat/calendar-check/banknote/scale/corner-down-right 等)。路由 `ledger` 由 `PlaceholderView` 换 `LedgerView`。前端 `src/api/ledger.ts` + `src/types/ledger.ts`。

---

## 6. Excel 导出(前端 SheetJS)

- 加 `xlsx` 依赖(当前未装)。`src/utils/ledgerExcel.ts`:`exportLedgerMonth(dto)` 用已加载行生成工作簿。
- 列序同屏:租户 · 上月结余 · 21 费用(可加组名行作为合并表头) · 本月应收合计 · 本月收款 · 本月结余 · 备注;末行合计。
- 文件名 `{公司名}-{年}{月}月-月度台账.xlsx`。仅②读态可导出。

---

## 7. 种子(迁移 V5)

- **3 公司**:`园区租赁管理公司`(租赁) · `园区综合服务公司`(综合) · `园区水电管理公司`(水电),sort_no 1/2/3。
- **台账数据**:挂到真实在租租户(id 1–13),覆盖 **2026 年 1–5 月**(① 网格显示 1–5 已录、6 月起空)。按原型费用域稀疏分配:租赁公司填租金族列、综合公司填管理/维护族列、水电公司填水电族列(对应 ledger-tenants-data.js 的 RENT/MGMT/UTIL 划分);各租户按其楼栋/类型给合理金额。
- **结余链**:每月 `balance_prev := 上月同(公司,租户) balance_end`,首月(1 月)balancePrev 取少量非零制造真实感;total_collected 默认全额结清、个别行留差额演示负/正结余。
- 量级:稀疏 —— 每公司每月仅其收款租户有行(非 13×3×5 全量),保持可读。

---

## 8. 测试

- **后端**:`CompanyServiceTest`(short 派生、重名、删除守卫)、`LedgerServiceTest`(recalc 应收/结余、稀疏补零成 13 行、保存 upsert+删空、copy-from-prev 结余结转);`LedgerApiIT`(Testcontainers:公司 CRUD + 删除 409、overview 形状、月读 13 行、保存往返、copy-from-prev、401)。
- **前端**:`lgRecalc` vitest;`FPLedgerTable` 渲染(两级表头/固定列/页脚合计)、编辑态即时重算;`LedgerCompanyPicker` 渲染。
- DoD:`./mvnw test` 全绿 + 前端 `npm run build`+`npm run test` 全绿 + 运行期渲染 `/ledger` 四级动线 0 console error + Excel 导出文件可打开。

---

## 9. 验收口径(对齐设计稿)

⓪ 公司卡显示记账租户数 + 当前月应收(¥万);① 年历当前月高亮、空月虚线;② 宽表两级表头 + 左右固定列横滚不动 + 页脚合计 + 编辑态即时重算应收/结余 + 不收的列留空;③ 抽屉仅列非零费用分组带小计;「从上月复制」结转上月结余;导出文件列序同屏。多公司各自独立、互不影响。
