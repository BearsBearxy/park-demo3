# demo3 · P1 设计 — 导入中心 hub + import_log（P-Import-3）

- **状态**：待用户复审
- **日期**：2026-07-01
- **作者**：Claude（brainstorming）
- **项目**：厂房园区管理系统 demo3
- **前置**：统一 Excel 导入 P-Import-1（共享引擎）、P-Import-2（其余 5 屏接入）均已完成；本 spec 收口 P-Import-3。规范见 `docs/design/IMPORT-GUIDE.md`。

---

## 0. 背景与目标

导入能力已推广到 8 个录入屏（月度台账 + 附表 6/7/8/10/11/12/13/14），但**分散在各屏、无统一入口、无历史记录**。fpNav 的 `import`（导入中心）当前仍是占位屏。

本期做两件事：
1. **import_log 历史表**：把「谁在何时、往哪个数据类型、用哪个文件、导入了多少行、结果如何」持久化，供审计与排障。
2. **导入中心屏**：1:1 还原设计稿 `screen-import.jsx`——数据类型卡片（本期是否已导入 + 最近导入）+ 导入记录表；卡片「上传」**在中心内就地开该类型的导入抽屉**（复用各屏已验证的解析器）。

**设计事实源**：`_handoff_extracted/untitled/project/app/screen-import.jsx`（布局/像素）、`datacenter-data.js` 的 `importTypes`/`importHistory`（字段形状，UI mock，真数据来自后端）。

---

## 1. 锁定决策（Decision Log）

| # | 决策 | 取舍 |
|---|---|---|
| I1 | 卡片「上传」**在导入中心内就地开导入抽屉**（不跳转到各屏） | 用户明确；复用各屏解析器 |
| I2 | 各屏导入配置**抽成共享 `importRegistry.ts`**（单一事实源，8 屏与 hub 都从它取） | 用户明确；根除两处维护漂移 |
| I3 | import_log **由前端在共享导入链一处上报**（`POST /api/import-log`），**不改 8 个现有导入端点** | 后端收不到文件名（Excel 前端解析）；rows/ok/warn 本就是后端返回值的转发；单管理员审计无需后端权威落库 |
| I4 | **不做**顶部拖拽区自动识别文件类型 | 8 套异构真实模板自动辨识风险高，与 IMPORT-GUIDE 铁律相悖；改「选类型再导」 |
| I5 | **不做**模板下载、导入撤销/回滚 | 无模板产物；import_log 为只读审计 |
| I6 | `operator` 字段**保留**（现填单管理员 displayName） | 测试期单管理员，后续多用户不确定；字段廉价、前向兼容 |
| I7 | 办公/三期水电**拆两张卡**（`office_13`/`office_14`） | 用户明确；各卡锁定附表号，免 13/14 选择器特判 |
| I8 | 记录表 `days=30` 过滤、无「加载更多」 | YAGNI；日后翻页再加参数 |

**上下文档位**（决定卡片「上传」前是否需目标选择器）：
- `none`（文件自足或卡片已锁定标的）：`s10`(附表10 智能整表自带期/月)、`pv`(期×月自足)、`salary`(标题按月分段)、`elec`(行含期/月)、`charging_7`/`charging_8`(卡片锁定附表号)、`office_13`/`office_14`(卡片锁定附表号)。
- `ledger`（需先选 **公司 + 年 + 月**）：`ledger`（台账导入端点 `POST /api/ledger/companies/{id}/import?year=&month=` 需三者，文件不含公司）。

---

## 2. 数据模型 — import_log

### 迁移 `V20__import_log.sql`（纯新增表，不改现有表；无种子）

```sql
CREATE TABLE import_log (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  data_type   VARCHAR(32)  NOT NULL,               -- registry 键
  type_label  VARCHAR(64)  NOT NULL,               -- 显示名（历史稳定，不随 registry 改动漂移）
  file_name   VARCHAR(255) NOT NULL,               -- 文件名；粘贴导入存 '（粘贴）'
  target      VARCHAR(64)  NULL,                    -- 目标槽人读串，如 '2026-05 · 综合公司'；无则 NULL
  rows        INT          NOT NULL DEFAULT 0,      -- 解析总行
  ok          INT          NOT NULL DEFAULT 0,      -- 成功写入（=ImportResultDTO.imported）
  warn        INT          NOT NULL DEFAULT 0,      -- 跳过+错误数（=skipped + errors.size）
  status      VARCHAR(16)  NOT NULL,               -- complete | partial | rejected
  operator    VARCHAR(64)  NULL,                    -- 登录 displayName（单管理员）
  created_at  DATETIME     NOT NULL,               -- MyBatis-Plus 自动填充
  PRIMARY KEY (id),
  KEY idx_type_time (data_type, created_at),        -- 支撑「每类最新」
  KEY idx_time (created_at)                         -- 支撑「近 N 天倒序」
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

**status 派生**（上报时前端算，后端信任存储）：
- `rejected`：`ok == 0`（模板不匹配/未识别到有效记录/导入抛错，一行没进）。
- `partial`：`ok > 0 && warn > 0`（部分行被跳过或报错）。
- `complete`：`ok > 0 && warn == 0`。

### 实体 / Mapper
- `entity/ImportLog.java`：`@TableName("import_log")`，`created_at` 用 `@TableField(fill = INSERT)`（复用既有 `MetaObjectHandler`，与 AuthUser 一致）。
- `mapper/ImportLogMapper.java`：`extends BaseMapper<ImportLog>`；`default` 方法 `latestByType()`（取每 data_type 最新一条）与 `recent(int days, int limit)`（近 N 天倒序），均用 `QueryWrapper` 组合，无手写 XML。
  - `latestByType`：数据量小，`selectList(orderByDesc created_at)` 后 Java 端按 data_type 取首条即可（避免窗口函数/分组 SQL 复杂度）。

---

## 3. 后端端点（`ImportLogController`，`/api/import-log`，统一 `Result<T>` 信封）

| 动词 | 路径 | 入参 | 返回（裸类型，经 ResponseWrapAdvice 裹 Result） |
|---|---|---|---|
| POST | `/api/import-log` | `@Valid ImportLogReq` | `ImportLogDTO`（新建行） |
| GET | `/api/import-log/overview?days=30&historyLimit=100` | `@Validated` 范围校验 | `ImportLogOverviewDTO{ latestByType: ImportLogDTO[], history: ImportLogDTO[] }` |

- `ImportLogReq{ @NotBlank dataType; @NotBlank typeLabel; @NotBlank fileName; String target; @Min(0) int rows,ok,warn; @Pattern(complete|partial|rejected) status }`。
- `ImportLogDTO{ id, dataType, typeLabel, fileName, target, rows, ok, warn, status, operator, createdAt }`。
- `latestByType`：每 data_type 最新一条（**不限 30 天**，供卡片状态）。`history`：近 `days` 天倒序、截断 `historyLimit`（供记录表）。仿 data-home `overview` 单次拉取模式。
- **operator 取值**：登录用户 displayName。由 `SecurityContext` 取当前用户名（JWT sub → AuthUser.displayName）；单管理员即「管理员」。取不到则存 NULL。
- **service 层校验**：`dataType`/`status` 属枚举白名单（防脏值）；越界抛 `BizException`（与既有 service 一致，映射 NOT_FOUND/BAD_REQUEST）。
- 无删除端点（只读审计，I5）。

---

## 4. 前端 — 共享 registry + 记录链

### 4.1 `utils/importRegistry.ts`（单一事实源）

每个可导入类型一条（共 **9** 条：`ledger`、`s10`、`pv`、`charging_7`、`charging_8`、`elec`、`salary`、`office_13`、`office_14`）：

```ts
interface ImportTypeEntry {
  key: string            // data_type，落 import_log
  label: string          // '工资明细'
  tag: string            // '附表12' / '凭证'
  icon: string           // lucide 名（与 fpNav 一致）
  context: 'none' | 'ledger'
  modalProps: (ctx) => FpImportModalProps  // title/sub/templateCols/解析模式(columnMap|customParse|phaseLayouts|parseRow|sectionTitleRe)/nameLabels/defaults
  run: (payload, ctx) => Promise<ImportResultDTO>  // 现各屏 onImport 体搬进来（含 charging 按 no+cats、ledger 按 company/year/month 分、office 按 no、elec/salary/s10 分段聚合）
  target: (ctx) => string | null           // 组装 import_log.target 人读串
}
```

- **`runImport(key, payload, ctx, fileName)`**（registry 模块导出的**唯一导入入口**）：
  1. `res = await entry.run(payload, ctx)`（真正调 `xxxApi.importRows/import`）。
  2. 算 `status`、`target`，`POST /api/import-log`（best-effort：失败仅 console.warn，不阻断，不吞 res）。
  3. 返回 `res` 给调用方弹 `ImportResultToast`。
- **8 屏与 hub 都只调 `runImport`** ⇒ 单一记录链，任何触发点都落 log。

### 4.2 `FpImportModal` 小改
- `import` / `importSections` 的 emit **附带 `fileName`**（组件内部已有 `fileName.value`，仅未外抛）：`import: [recs, fileName]`、`importSections: [picks, fileName]`。
- 粘贴导入 fileName 为空 → 上报时用 `'（粘贴）'`。
- 8 屏调用点随本次重构一并更新（配置搬进 registry 后，屏内改 `v-bind` registry.modalProps + `@import`/`@importSections` 调 `runImport`）。**行为不变**（回归测试保证）。

### 4.3 各屏改造（I2）
把各 View 现有 `onImport`/`onSmartImport`/`customParse`/`columnMap` 等移进对应 registry 条目；屏内 `<FpImportModal>` 从 registry 取 `modalProps`。改造清单：`LedgerView`、`S10View`、`PvView`、`ChargingView`(7/8 两实例)、`ElecView`、`SalaryView`、`UtilitiesView`(13/14)。

---

## 5. 导入中心屏 `ImportCenterView`（1:1 还原 screen-import.jsx）

路由：`import` 从 `PlaceholderView` 换成 `views/import-center/ImportCenterView.vue`。遵 **DESIGN-FIDELITY §6 加载门**（overview 未就绪显转圈，不闪假空态）。

**结构（自上而下）：**
1. **页头** `.im-head`：标题「导入中心」+ 副标题「所有 Excel 数据的统一入口 · 导入即归集到对应台账与报表」；动作区「下载模板」（禁用占位，I5）/「上传 Excel」（→ 打开类型选择）。
2. **顶部区** `.im-drop`：原型自动识别拖拽区 → 改为**「选择数据类型上传」**（点击列出 9 类型 → 选中开该类型导入流程）。文案随之改（不再宣称「系统自动识别类型」）。
3. **按数据类型导入** 网格 `.im-grid`：**9 张卡**（台账/销售收入/光伏/汽车充电桩/电动车充电桩/电费成本/工资明细/办公水电/三期水电）。每卡：图标 + 名 + 附表标签 + 状态药丸（`已是最新`/`有告警`/`部分`/`未导入`，由 `latestByType[key]` 派生：complete→done、partial→partial、warn>0→warn、无记录→missing）+ 最近导入时间 + 行数；「上传」按钮 → **就地开导入抽屉**：
   - `context:'ledger'`：抽屉前先显 **公司(下拉)+年+月** 选择器，选定后开 `FpImportModal`。
   - `context:'none'`：直接开 `FpImportModal`（卡片已锁定 no/期，或文件自足）。
   - 导入完成 → `runImport` 已落 log → 刷新 overview（卡片状态 + 记录表翻新）+ 弹 `ImportResultToast`。
4. **导入记录表** `.im`（`Card` + 复用 `FPSortableTable`）：列 = 文件 / 类型 / 行数 / 结果（`ok`成功·`warn`告警；`rejected`→「已拒绝 · 模板不匹配」）/ 操作人 / 时间 / 状态徽标；默认时间倒序；标题右侧「近 30 天」。数据 = overview.history。

**DS 复用**：`Card`/`Button`/`StatusBadge`/`FPSortableTable`/`iconFor` 均已存在。新增仅 `ImportCenterView` + 就地导入所需的公司/年月选择器（可复用 Ledger 现有选择器组件或简单 `Select`）。

---

## 6. 错误处理

- 后端：`ImportLogReq` 校验失败 → 400（`GlobalExceptionHandler` 既有）；`dataType`/`status` 越白名单 → `BizException`。
- 前端：`runImport` 中 log 上报失败**不阻断导入主流程**（best-effort，console.warn）；导入本身失败照旧由各屏 `run` 抛出、`ImportResultToast` 展示。
- 卡片 overview 加载失败 → 加载门转圈 + 复用既有列表屏错误态；401 走 axios 拦截器跳登录。

---

## 7. 测试

**后端**（Testcontainers 真库，编排者**亲跑全量 `./mvnw test`**，不接管道，不信 agent test-compile — IMPORT-GUIDE §四）：
- `ImportLogApiIT`：POST 记录往返；`overview.latestByType` 每 data_type 只取最新一条；`overview.history` 近 `days` 天倒序 + `historyLimit` 截断；status 三态；无 token → 401；非法 `status`/`days` → 400。
- `ImportLogServiceTest`（Mockito）：latestByType 归约逻辑、status 白名单校验。

**前端**（vitest）：
- `importRegistry` 单测：每类 `modalProps` 与改造前该屏一致（回归防漂移）；`runImport` 的 status/target 组装；log POST 失败不吞 result。
- `FpImportModal` emit fileName 的既有 spec 扩展。

**真跑肉眼验**（起真后端 8080 + demo3-mysql:13306 + preview）：
- 导入中心 9 卡渲染 + 状态药丸对真值；`ledger` 卡先选公司+年月再导；`office_13/14` 两卡各导对子表。
- 用真实 xlsx 端到端导入（含中文走浏览器，**不用 curl 发中文** — IMPORT-GUIDE §四）→ 记录表出现新行（文件名/类型/行数/结果/时间/操作人/状态全对）、对应卡片状态翻新、0 console error。
- 各原屏（如 /salary）导入仍正常且**也落 log**（验证单一记录链）。

---

## 8. 完成定义（DoD）

- [ ] V20 迁移干净 apply；import_log 实体/Mapper/DTO/Req/Service/Controller 两端点。
- [ ] `importRegistry.ts` 9 条 + `runImport` 记录链；`FpImportModal` emit fileName；8 屏改造为消费 registry。
- [ ] `ImportCenterView` 1:1 还原原型三块 + 就地导入（ledger 上下文选择器）；`import` 路由换真屏。
- [ ] 后端全量 `./mvnw test` 绿（含新 ImportLogApiIT）；前端 `npm run build` + vitest 绿。
- [ ] 真后端 + 真实 xlsx preview 肉眼验全过（记录落库、卡片翻新、原屏导入也落 log、0 console error）。

---

## 9. 显式延后（backlog，非阻断）

- 顶部拖拽区自动识别文件类型（I4）。
- 模板下载 / 单类模板按钮（I5）。
- 导入撤销/回滚。
- 记录表翻页 / 「加载更多」（I8）。
- 报表类导入卡（利润表/资产负债表/科目余额表）——随 P2 报表层建成后再加入 registry 与卡片。
- 多用户 operator（I6，届时 operator 已在库，仅需接入用户体系）。
