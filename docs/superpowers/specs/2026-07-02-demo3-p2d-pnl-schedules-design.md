# demo3 · P2-D 设计 — 损益附表 1–5（园区全局年度矩阵，手录 + 导入）

- **状态**：待用户复审
- **日期**：2026-07-02
- **作者**：Claude（brainstorming）
- **项目**：demo3 · P2 账簿与报表 第四刀（承接 A/B/C 三大报表）
- **事实源**：真实母册 `2025全年发生额、预算对比/2025年收入、费用统计（2025.12.31）(1).xlsx` 的 5 张 sheet：`附表1租金损益明细`(45行)/`附表2电费损益明细`(61)/`附表3水费损益明细`(19)/`附表4其他运管费用收益`(40)/`附表5费用支出明细`(85)；原型 `screen-schedule5/schedule2/water/ops-pnl/expense.jsx`（仅 UI 参考）。

---

## 0. 定性（与 A/B/C 的区别）

5 张附表**同一版式**（实测）：`分组列(区域/科目名称/项目/科目) | 科目细分 | 1月..12月 | 本年合计 | 备注`（附表5 多一空列，解析按表头文字定位不受影响）。特征：
- **园区全局**（无公司维度）→ 归 **P1 附表模式**（park-wide 专表 + `SchedYearGate` 年份门），不塞 P2 的 company 维 `report_*` 表。
- **行是数据非模板**（科目细分随年演化，含"小计/损益/合计"行）→ 行按 (schedule, year) 存库。
- **年度矩阵**（行×12月）→ 宽表存 12 月列（demo3 已有 `monthly_ledger` 宽表先例），非 (year,month) 长表。

**继承决策**：手录+导入并存；文件忠实；本年合计客端派生不落库；逐行备注（P1 附表惯例）；居中弹窗 §7；加载门 §6；导入 clear+insert + import_log。

## 1. D 特有决策（Decision Log）

| # | 决策 | 取舍 |
|---|---|---|
| D1 | **一张通用宽表 `pnl_row`** 服务 5 张附表（`schedule ∈ s1..s5`），行=科目细分，12 月金额列内联 | 同版式；每 schedule-年 19~85 行，宽表最简 |
| D2 | 「小计/损益/合计」行**存文件值 + kind 样式标记**（按标签含 小计/损益/合计/总计 识别 kind，仅作分带/加粗渲染）；编辑明细**不自动重算小计**（与手工 Excel 一致）；自动派生列 backlog | 用户拍板 |
| D3 | 本年合计列**客端派生**（行内 Σ12月），不落库不导入 | 派生不落列 |
| D4 | **一个参数化 View 服务 5 条路由**（rent-pnl/elec-pnl/water-pnl/ops-pnl/expense-pnl → 同一 `PnlScheduleView`，per-schedule config：标题/分组列名/sheet 名），charging 7/8 先例 | 5 屏结构全同 |
| D5 | 年份门用 **`SchedYearGate`**（P1 共享件，store-key `pnl-s1`..`pnl-s5`），年范围由后端 overview 确定性给 | P1 惯例 |
| D6 | 导入：各屏导各自 sheet——`FpImportModal` `sheetMatch`（如 /附表1租金损益/）从母册挑表；**年从标题自动识**（`2025年租金损益明细` → 2025，识别不到用当前年槽）；整 (schedule,year) clear+insert | C 刚建的能力直接复用 |
| D7 | registry 5 条 `pnl_s1`..`pnl_s5`（import_log 白名单同加）；context 无需公司（园区全局），年自动识 → `context:'none'` | 每屏一 tile（后续导入中心卡） |
| D8 | 手录：单元格金额、备注、增/删行（行属分组：新增行带 group_label 下拉/自填）、保存整年 clear+insert | 对等导入 |

## 2. 数据模型（V26 + V27 种子）

```sql
CREATE TABLE pnl_row (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  schedule    VARCHAR(4)   NOT NULL,               -- 's1'..'s5'
  year        INT          NOT NULL,
  row_key     VARCHAR(40)  NOT NULL,               -- 合成 r<n>(整年 clear+insert,无跨年匹配需求)
  group_label VARCHAR(64)  NOT NULL DEFAULT '',    -- 分组列(区域/科目名称/项目/科目;向下填充合并单元格)
  label       VARCHAR(160) NOT NULL,               -- 科目细分
  kind        VARCHAR(12)  NOT NULL DEFAULT 'detail', -- detail|subtotal|pnl|total(按标签识别,仅渲染用)
  note        VARCHAR(255) NULL,                    -- 备注(文件尾列/逐行手录)
  m1 DECIMAL(18,2) NULL, m2 DECIMAL(18,2) NULL, m3 DECIMAL(18,2) NULL, m4 DECIMAL(18,2) NULL,
  m5 DECIMAL(18,2) NULL, m6 DECIMAL(18,2) NULL, m7 DECIMAL(18,2) NULL, m8 DECIMAL(18,2) NULL,
  m9 DECIMAL(18,2) NULL, m10 DECIMAL(18,2) NULL, m11 DECIMAL(18,2) NULL, m12 DECIMAL(18,2) NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL,
  updated_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_pnl (schedule, year, row_key),
  KEY idx_pnl (schedule, year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- 月值 NULL=未录（区分 0）；kind 识别规则：label 含 `损益`→pnl、含 `小计`→subtotal、含 `合计|总计`→total、否则 detail（识别在导入/保存时定，存库）。
- **V27 种子**：s1 2025 取真实附表1 前几行（一期租金收入/企业服务费/小计/损益 各带 12 月值），演示分带/派生合计。

## 3. 后端（新 Pnl 子系统，P1 附表范式）

`PnlController` `/api/pnl/{schedule}`（schedule 白名单 s1..s5，越界 `BizException(BAD_REQUEST)`）：

| 动词 | 路径 | 返回 | 说明 |
|---|---|---|---|
| GET | `/{schedule}/overview` | `PnlOverviewDTO{years:[{year,hasData,rowCount}]}` | SchedYearGate（确定性范围 [minDataYear..maxDataYear+1]∪BASE，同 P1 惯例，不耦合时钟） |
| GET | `/{schedule}/{year}` | `PnlYearDTO{rows:[PnlRowDTO]}` | 按 sort_order；`PnlRowDTO{rowKey,groupLabel,label,kind,note,m:[12个可空]}` |
| PUT | `/{schedule}/{year}` | `PnlYearDTO` | 保存整年（clear+insert，`@Transactional`） |
| POST | `/{schedule}/import?year=` | `ImportResultDTO` | 整 (schedule,year) clear+insert |

`PnlService`/`PnlRowMapper`（裸 BaseMapper+default，零 XML）。`ImportLogService.KNOWN_TYPES` 加 `pnl_s1`..`pnl_s5`。

## 4. 前端

- `reports/pnlSchedules.ts`：5 条 config `{schedule:'s1'..'s5', route, title:'附表1 · 租金损益明细', groupCol:'区域', sheetRe:/附表1租金损益/, storeKey:'pnl-s1'}`（s2 科目名称/s3 科目名称/s4 项目/s5 科目）+ `rowYearTotal(row)=Σ非空月值` 纯函数。
- `views/reports/pnl/PnlScheduleView.vue`（**一个 View，由路由 meta 找 config**）：① `SchedYearGate`（overview）→ ② 矩阵表 `PnlTable.vue`（自带 scoped：sticky 首列 分组+科目细分（分组同值向下省略显示）、12 月列、本年合计（派生）尾列 sticky、编辑态备注列；kind=subtotal/pnl/total 行分带底色/加粗——参照原型 s2 样式带）；编辑态：单元格金额/备注/新增行（居中弹窗：分组+科目细分+kind 自动识）/删行/保存（PUT 整年）/退出确认；导入按钮 → FpImportModal（`sheetMatch=config.sheetRe`+`customParse`）；导出懒加载。**§6.2 v-else 紧邻；切年不清 data（防闪规范）。**
- `utils/importPnlSchedule.ts`：单 sheet 矩阵 → 行集。表头定位（含「科目细分」与「1月」）；分组列向下填充；逐行 label=科目细分、12 月 cleanNum(`- `→null 或 0？——**空/`-`→NULL**（未录）、真实 0 保留)、备注列；跳标题/表头/空行；**年识别**：标题行 `/(\d{4})年/` → year；kind 按 D2 规则。产出 `{year, rows:[{groupLabel,label,kind,note,m:[...]}]}`。
- registry `pnl_s1`..`pnl_s5`（`context:'none'`；`run`: 解析出的 year（用户可在确认屏改？——v1 直接用识别年，识别失败用当前屏年槽）→ `pnlApi.import(schedule, year, {rows})`；target `${year} · 附表N`）。
- `api/pnl.ts` + `types/pnl.ts`。路由 5 值 → `PnlScheduleView`。

## 5. 测试

- 后端（亲跑全量）：`PnlApiIT`——save 整年读回+重存覆盖、import clear+insert、overview 确定性年范围、非法 schedule 400、401。
- 前端 vitest：`pnlSchedules`（rowYearTotal 空值处理）+ `importPnlSchedule`（表头定位/分组向下填充/kind 识别/年识别/`- `→NULL/备注列）。
- 真跑：真实母册 5 张 sheet 全喂解析器实测（行数 45/61/19/40/85 量级、抽查 一期租金收入 1月 1,141,774.45、kind 分带）；preview 年门→矩阵→编辑→保存→导入；0 console error。

## 6. DoD

- [ ] V26+V27 迁移；Pnl 实体/Mapper/Service/Controller 4 端点 + PnlApiIT；import_log +5 键；全量 `./mvnw test` 绿。
- [ ] pnlSchedules config + PnlScheduleView/PnlTable（一 View 五路由）+ importPnlSchedule + registry 5 条 + api/types + 路由。
- [ ] build+vitest 绿；真实母册 5 sheet 解析实测 + preview 肉眼验 + 0 error。

## 7. 显式延后

- 小计/损益自动派生（现存文件值）；「总项损益/分项损益」两张汇总 sheet（母册另两表，属 E/F 范畴）；水附表的「下钻台账」联动；预算对比（`2025全年发生额、预算对比.xlsx`，属 P3 分析）；E 勾稽；F 报表中心。
