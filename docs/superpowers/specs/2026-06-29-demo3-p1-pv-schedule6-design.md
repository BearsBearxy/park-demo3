# demo3 P1 附表6 光伏发电(PV)子系统 — 设计规范

> 事实源:`_handoff_extracted/untitled/project/app/screen-schedule6.jsx` + `schedule6-data.js`(数据模型/口径)+ `ledger-common.jsx`/`sched-common.jsx`(共享外壳脚手架参照)。像素事实源:`园区管理系统(单文件离线版).html`。组件保真基准:`docs/design/DESIGN-FIDELITY.md`(含 §6 加载态)。
> 状态:已批准设计,直接进实现。

---

## 1. 目标与范围

**目标**:把「附表6 光伏发电」做成工程化全栈子系统,**同时沉淀出所有 P1 录入类附表复用的共享外壳脚手架**(年份选择层 + 统一页头 + 逐行备注)。

**本 spec 范围**:
- **共享附表脚手架**(`src/components/sched/`):`SchedYearGate`(⓪ 年份选择层)、`SchedHeader`(统一页头)、`SchedNoteCell`(逐行备注单元格)。后续附表 7/8/10/11/12/办公三期水电全复用。
- **附表6 全栈切片**:`pv_phase` + `pv_record` 库表 + 读写 API + 两级前端屏(⓪ 选年 → 逐月发电台账,按期分组)+ 新增记账抽屉 + 逐行备注 + Excel 导出 + 确定性种子。

**不做(后续登记)**:Excel **导入**(编辑态「导入」为禁用占位,统一导入另开 spec)· 表内逐行改数值(附表6 录入 = 抽屉新增 + 删除 + 逐行备注,不在表里改数)· 年份增删管理弹窗(见 §2 取舍)· KPI 卡片 · 期别 cost/capacity 的展示(留给 P3「光伏投资回收」)。

---

## 2. 全局约束 + 取舍

- Java 17(本机仅 JDK 17,用 `./mvnw`);Spring Boot 3.3.5 + MyBatis-Plus + Flyway;统一 `Result<T>`;JWT 保护;controller 返回裸 DTO 由 `ResponseWrapAdvice` 包装;业务错误抛 `BizException`。
- 前端 Vue3 `<script setup lang=ts>` + Vite;仅 DS 令牌与组件;**禁紫禁绿禁渐变**;等宽数字 `var(--font-mono)`;**套用 DESIGN-FIDELITY §6 加载门**(数据屏 loading gate + 首屏 router.isReady 已全局生效)。
- **派生值绝不落库**:发电总量 `gen = selfKwh + gridKwh`、电费总额 `fee = selfAmt + gridAmt`,service 读时算,不建列。
- 金额/电量 `DECIMAL`;计算用 `BigDecimal`,四舍五入 2 位。
- **取舍(YAGNI,已与用户确认)**:
  1. **年份选择不耦合系统时钟、不做增删管理弹窗**。年份范围 = `[2024 .. maxDataYear + 1]`(maxDataYear = 有记录的最大记账年;无数据时 `[2024..2025]`),**确定性、不读 `new Date()`**;「最新」高亮 = `maxDataYear`(对齐台账 current=有数据最大单位的口径)。往未来年录一条记录即自然延展范围,无需手动加年。
  2. **无 KPI 卡片**(对齐 `ledger-common`「取消 KPI」);**无表内逐行改数值**。
  3. **导入延后**(占位);**导出保留**(前端 SheetJS,懒加载 `import('xlsx')`,复用既有模式)。
  4. **备注存 `pv_record.note` 列**(附表6 行即记录),不另建备注表。
  5. **种子记录锁定**:`source='seed'` 的行不可删(DELETE → 409,对齐原型「官方台账不可删除」);`source='manual'` 可删。

---

## 3. 数据模型

### 3.1 迁移 V6 建表

```sql
CREATE TABLE pv_phase (
  id         VARCHAR(4)  NOT NULL,            -- p1 / p2 / p3
  name       VARCHAR(48) NOT NULL,
  short      VARCHAR(8)  NOT NULL,            -- 2 字简称
  online     VARCHAR(7)  NULL,               -- YYYY-MM 并网月
  cost       DECIMAL(16,2) NOT NULL DEFAULT 0,   -- 一次性工程成本(供 P3 光伏投资回收;本页不显)
  capacity   DECIMAL(12,6) NOT NULL DEFAULT 0,   -- 装机容量 MW(供 P3)
  cap_note   VARCHAR(32) NULL,
  sort_no    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE pv_record (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  phase_id    VARCHAR(4)  NOT NULL,
  acct_month  VARCHAR(7)  NOT NULL,           -- YYYY-MM 记账月
  occur_month VARCHAR(7)  NOT NULL,           -- YYYY-MM 发生月
  self_kwh    DECIMAL(14,2) NOT NULL DEFAULT 0,   -- 自消纳电量
  self_amt    DECIMAL(14,2) NOT NULL DEFAULT 0,   -- 自消纳金额
  grid_kwh    DECIMAL(14,2) NOT NULL DEFAULT 0,   -- 上网电量
  grid_amt    DECIMAL(14,2) NOT NULL DEFAULT 0,   -- 上网收益
  note        VARCHAR(255) NULL,
  source      VARCHAR(8)  NOT NULL DEFAULT 'manual',  -- seed / manual
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pv_acct (acct_month),
  KEY idx_pv_phase (phase_id),
  CONSTRAINT fk_pv_phase FOREIGN KEY (phase_id) REFERENCES pv_phase(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```
DB 列 snake_case;Java 字段/JSON camelCase(`map-underscore-to-camel-case` 已开)。`gen`/`fee` **不建列**。

### 3.2 公式
```
gen(发电总量) = self_kwh + grid_kwh
fee(电费总额) = self_amt + grid_amt
年合计 / 期组小计 = 各列对该切片求和
年份范围 = [2024 .. maxDataYear + 1];最新年 = maxDataYear
```

---

## 4. 后端 API(均 JWT 保护,`Result<T>` 封装,`com.park.demo3`)

- `GET /api/pv/phases` → `List<PvPhaseDTO>{ id, name, short, online }`(按 sortNo)。`short` 用 `@JsonProperty("short")`(Java 字段 `shortName`,避关键字)。
- `GET /api/pv/overview` → `PvOverviewDTO{ currentYear, years: [ YearMeta{ year, hasData, totalFee, count } ] }`
  - years 覆盖 §3.2 范围;hasData = 该年有记录;totalFee = 该年 Σfee;count = 该年记录数;currentYear = maxDataYear(无数据→范围上界-1)。
- `GET /api/pv/records?year=YYYY` → `PvYearDTO`
  ```
  { year, phases:[PvPhaseDTO], rows:[ PvRecordDTO ], total: PvTotal }
  PvRecordDTO{ id, phase, phaseName, acctMonth, occurMonth, selfKwh, selfAmt, gridKwh, gridAmt, gen, fee, note, source }
  PvTotal{ gen, fee, selfKwh, selfAmt, gridKwh, gridAmt }
  ```
  - rows = 该年(按 acct_month 年份)全部记录,按 `acct_month` 升序;phaseName 由 phase join 派生;gen/fee 派生算好;total = 全年合计。前端按 phase 分组渲染 + 组头小计。
- `POST /api/pv/records` body `PvRecordReq{ phase, acctMonth, occurMonth, selfKwh, selfAmt, gridKwh, gridAmt, note? }` → 新增(source=manual),返回 `PvRecordDTO`。phase 不存在 → 409。
- `PATCH /api/pv/records/{id}/note` body `{ note }` → 改备注,返回 `PvRecordDTO`。
- `DELETE /api/pv/records/{id}` → 删除;`source='seed'` → 409(「官方台账,不可删除」);不存在 → 404。

**后端文件**:entity `PvPhase`/`PvRecord`;mapper `PvPhaseMapper`/`PvRecordMapper`(BaseMapper);dto `PvPhaseDTO`/`PvOverviewDTO`(含 `YearMeta`)/`PvYearDTO`(含 `PvRecordDTO`/`PvTotal`)/`PvRecordReq`/`PvNoteReq`;service `PvService`(overview 年份范围派生 / records 读+派生+分期合计 / create / updateNote / delete+seed 守卫;`recalc(gen,fee)` 共享);controller `PvController`。

---

## 5. 前端

### 5.1 共享附表脚手架 `src/components/sched/`
1:1 移植 `ledger-common.jsx` + `SchedYearGate`(去掉年份增删),Vue 化:
- **`SchedYearGate.vue`** — ⓪ 年份选择层。props `{ icon, title, sub, years: YearCard[], current, footer }`,`YearCard{ year, hasData, metric, label }`;emits `pick(year)`。年份卡网格(有数据显 metric+label,无数据虚线「待录入·进入后可录入」,最新年蓝色高亮「最新」角标 + 右上 hover 箭头)。**不含新增/删除年份**。
- **`SchedHeader.vue`** — 统一页头。props `{ icon, title, sub, year, edit }`;emits `back`、`toggle-edit`;slots `#edit-actions`(仅编辑态)、`#static-actions`(常显)。返回 + 标题 + 年份徽标 + 编辑模式徽标 + 编辑/完成按钮。
- **`SchedNoteCell.vue`** — 逐行备注。props `{ note, edit, placeholder }`;emits `save(text)`(编辑态 input,blur/change 时 emit;只读态文本/「—」)。

### 5.2 附表6 屏 `src/views/pv/`(路由 `pv-income` 换 PvView)
状态机:`year(null=⓪) · phase('all') · edit · drawer`。1:1 对齐 `screen-schedule6.jsx`。
- **`PvView.vue`** — 持有 phases/overview/yearData;`year==null` 渲 `SchedYearGate`(由 overview 映射 YearCard);选中渲表。编辑态动作:新增记账(开抽屉)、导入(禁用占位 tooltip「导入即将上线」)、导出(SheetJS 懒加载)。
- **`PvTable.vue`** — 卡片内单滚动表;期分段:`全部` 时按 phase 分组(组头:期名 + 本年 N 月 + 发电 X 万 kWh + 各列小计),否则平铺;列:记账月 · 发生月 · 发电总量(kWh) · 电费总额(元) · 自消纳电量/金额 · 上网电量/收益 · 备注 · [编辑态] 删除;sticky thead + tfoot 本年合计(品牌蓝加粗);`手动` 角标(source=manual);seed 行删除位显锁。空年引导态(编辑态给「新增记账」)。
- **`PvRecordDrawer.vue`** — 右抽屉「新增记账」:期 chips + 记账月(年/月 select)+ 发生月(年/月 select)+ 自消纳(电量/金额)+ 上网(电量/收益)+ 自动总计(发电总量/电费总额)+ 校验(至少一组电量 + 一组金额)。提交 `POST /records`。
- 顶部期筛选 `Segmented`(全部 / 一期 / 二期 / 三期,来自 phases.short);删除/新增/改备注后重载该年。
- `api/pv.ts` + `types/pv.ts`(TS 接口逐字对齐后端 record DTO);**套用 §6 加载门**(overview 未到显转圈)。

---

## 6. Excel 导出(前端 SheetJS,懒加载)
- `src/utils/pvExcel.ts`:`exportPvYear(dto, year)` `async` + `const XLSX = await import('xlsx')`(对齐 `ledgerExcel` 懒加载模式,不进路由初始块)。
- 列序同表:期 · 记账月 · 发生月 · 发电总量 · 电费总额 · 自消纳电量 · 自消纳金额 · 上网电量 · 上网收益 · 备注;末行本年合计。文件名 `附表6-光伏发电-{年}年.xlsx`。

---

## 7. 种子(迁移 V6,确定性,源 `schedule6-data.js`)
- **pv_phase 3 期**:`p1` 一期 B-G 座(简称 一期,online 2024-09,cost 6518271.85,capacity 2.055,capNote「1.725 + 0.33」,sort 1);`p2` 二期(二期,2025-06,6495227.93,3.04673,null,2);`p3` 三期(3、4 车间)(三期,2025-12,1773384.21,0.781685,null,3)。
- **pv_record 27 条**(全量照搬 `schedule6-data.js` records,source=seed):一期 17 条(2024-09…2026-01)、二期 8 条(2025-06…2026-01)、三期 2 条(2025-12、2026-01),字段 phase/acctMonth/occurMonth/selfKwh/selfAmt/gridKwh/gridAmt 一一对应,note 空。
- maxDataYear = 2026 → 年份范围 2024–2027,最新年 2026;按记账年分布:2024=4 条、2025=20 条、2026=3 条。

---

## 8. 测试
- **后端**:`PvServiceTest`(recalc gen/fee、overview 年份范围 = [2024..maxData+1] 且 current=maxData、records 分期合计、delete seed 守卫 409);`PvApiIT`(Testcontainers:phases 形状、overview 形状+年份范围、某年 records 行数+派生、新增往返、改备注、删除 seed→409 / 删除 manual→ok、401)。命名 `*Test`/`*IT`。
- **前端**:派生/合计纯函数 vitest(若抽出);`SchedYearGate` 渲染(最新年高亮/待录入态)。
- **DoD**:`./mvnw test` 全绿 + 前端 `npm run build` + `npm run test` 全绿 + 真跑 `/pv-income` ⓪→选年→期分组表→新增记账→删除→改备注→导出 0 console error + §6 加载门生效 + 导出文件可打开。

## 9. 验收口径(对齐设计稿)
⓪ 年份卡:有数据显「全年电费收益 ¥X万 · N 条」、最新年高亮、未来年虚线待录入;进表按期分组、组头小计、tfoot 本年合计品牌蓝;编辑态可新增记账(抽屉)/删除(seed 锁定)/逐行备注;导出列序同表;派生发电总量/电费总额绝不落库;年份范围确定性(不耦合系统时钟)。
