# demo3 P1 附表10 导入增强:智能整表导入 + 批量删除 + 保存确认 — 设计规范

- 状态：已批准（2026-07-01 brainstorming），待用户复审
- 背景：用户真实 .xlsx(`附表10测试.xlsx`)一张 sheet 含多月×多期(2025年1月二期/1月散租宿舍/2月一期/2月二期/2月散租宿舍…),每段一个「2025年X月{期}园区费用明细表」标题行。当前导入只能单段导到当前槽、不能批量删导入行、退出编辑直接落库。
- 复用：已建 `importHeaderMatch.matchByHeader`(按表头名字匹配,扛车间列/小计/多行表头)、`FpImportModal`、s10 导入端点。

## 1. 目标与范围（三件套，一次设计）

- **A 智能整表导入**：上传/粘贴整张多段 Excel → 按标题行拆段 → 识别 年/月/期 → 汇总确认(可改) → 各段导到对应槽 → 跳转。
- **B 批量删除导入**：编辑态「清空本期导入」一键 + 表内勾选多行批删。
- **C 退出编辑保存确认**：点「完成」若有改动先弹确认,保存才落库。

范围：均**附表10**（C 其余录入屏后续同法）。

## 2. A · 智能整表导入

### 2.1 拆段 + 识别（`utils/importSections.ts`）
`splitSections(matrix, phaseLayouts, nameLabels) => Section[]`：
- **标题行正则** `/(\d{4})\s*年\s*(\d{1,2})\s*月.*?(一期|二期|三期|宿舍)/`：捕获 year、month、phaseName（`散租宿舍`含「宿舍」→宿舍）。`phaseName→phase`：一期1/二期2/三期3/宿舍4。
- **段边界**：每个标题行到下一个标题行前一行(或表尾)。标题前若有数据=无标题前导段(year/month/phase 留空待用户填)。
- **版面自动识别**（不依赖期号）：段表头块含「办公室租金/保障房」→ office,否则 factory。`phaseLayouts` 提供 office/factory 两套 `columnMap`。
- **逐段解析**：用识别出的版面 columnMap 走 `matchByHeader`(自动处理车间列/小计/多行表头/列乱序),得 `records`。
- 返回 `Section { year?:int, month?:int, phase?:int, layout:'office'|'factory', records:Rec[], rowCount:int, error?:string }`。
- **单段无标题**（用户只粘一张表）→ 0 标题行 → 整体当一段,year/month/phase 留空(汇总屏默认填当前 S10View 选中槽,可改)。

### 2.2 汇总确认屏（`ImportSummary.vue`，扛识别不全）
弹窗解析后,若检测到段(标题或单段)→ 显示汇总表,每段一行：
- `[年] [月] [期(下拉:一/二/三期/宿舍)]` 可编辑(识别到的预填,缺的留空标红待填) · `识别 N 户` · `[✓ 导入]` 勾选。
- 校验：年(2000-2100)/月(1-12)/期必填且非空才可导;有空 → 该行禁勾 + 提示。
- 「全部导入」按钮 → 对勾选且合法的段，逐段调用导入。

### 2.3 落库 + 跳转
- 逐段 `POST /api/s10/import { phase, acctMonth:\`${year}-${MM}\`, rows }`（**重导语义=先清该槽 source=import 再插**,见 §5）。聚合各段 `ImportResultDTO`。
- **导完跳转**：S10View 把 year/month/phase 设为第一段成功槽 → `reloadOverview` + `loadMonth`。结果提示(`ImportResultToast` 扩展)列出各段 `年月期 · 导入N/跳过M/错误K`。
- S10View 传 `phaseLayouts = { office: leavesOf('office')→colMap, factory: leavesOf('factory')→colMap }` + `nameLabels` 给 FpImportModal;modal 走 splitSections。

## 3. B · 批量删除导入

### 3.1 后端
- `DELETE /api/s10/imported?phase=&acctMonth=`（query param,避开与 GET `{phase}/{year}/{month}` 路径模式冲突）→ `clearImported(phase,acctMonth)`：删 `phase+acct_month+source='import'` 行 → 回 `{deleted:int}`。phase 白名单(1-4) + acctMonth @Pattern。
- `DELETE /api/s10/batch`（body `S10BatchDeleteReq{ ids:List<Long> }`）→ 按 id 删,`source='seed'` 跳过 → 回 `{deleted:int, skipped:int}`(skipped=种子)。

### 3.2 前端（S10View 编辑态）
- 「清空本期导入」按钮(编辑动作区)→ 确认弹窗(显示本期 source=import 行数)→ `DELETE .../imported` → `loadMonth`+`reloadOverview`。
- S10Table 编辑态加**复选框列**(种子行 checkbox 禁用)；S10View 维护 `selectedIds`；选中>0 显「删除选中(N)」→ `DELETE /api/s10/batch` → 重载。删除走批删端点,不再逐行。

## 4. C · 退出编辑保存确认（`SaveConfirmDialog.vue`）

- S10View `finishEdit`：当前若 `edit && dirty.size>0` → 弹「有 {n} 处修改,保存吗？[保存修改] [放弃修改] (×关闭=继续编辑)」。
  - 保存修改 → 现行为(脏行逐个 `saveRecord` upsert)+ 退出编辑。
  - 放弃修改 → `loadMonth`(丢弃本地改动,重载服务端)+ 退出编辑。
  - 关闭/取消 → 留在编辑态。
- `dirty.size===0` → 直接退出(无弹窗)。

## 5. 后端改动汇总

- **s10 `importRows` 改语义**：导入前先 `delete where phase+acct_month+source='import'`,再把 rows 全部 `insert`(source='import', tenant_id=null)。即**重导=替换本槽导入行**(手动行不动)。原 upsert-by-name 改为 clear+insert。`@Transactional`。
- 新增 `clearImported(phase,acctMonth)` + 控制器 `DELETE .../imported`。
- 新增 `batchDelete(ids)`(种子跳过) + 控制器 `DELETE /api/s10/batch` + `S10BatchDeleteReq`。
- 测试：`S10ImportApiIT` 补「重导替换(旧导入行被清、手动行保留)」；新 `S10DeleteApiIT`(清空本期导入计数 / 批删跳过种子)。

## 6. 前端新增/改动清单

- 新增 `utils/importSections.ts`(+spec)、`components/import/ImportSummary.vue`、`components/import/SaveConfirmDialog.vue`。
- 改 `FpImportModal.vue`（解析后若 splitSections 得段 → 出 ImportSummary;否则保留单段直导）、`S10View.vue`（传 phaseLayouts、智能导入回调按段落库+跳转、清空本期导入、勾选批删、保存确认）、`S10Table.vue`（编辑态复选框列,种子禁选,emit 选择）、`api/s10.ts`（importRows 不变 / clearImported / batchDelete）。

## 7. 测试 + 验证（三类缺口铁律）

- 后端**编排者亲跑全量 `./mvnw test`**（含新 IT:重导替换 / 清空导入 / 批删跳种子）。
- 前端 build + vitest：`importSections.spec`(多段拆分+年月期识别+版面识别+单段无标题回退)、ImportSummary 渲染、SaveConfirmDialog。
- 起真后端 + preview **用用户真实多段 .xlsx 文件上传**：汇总屏列出 1月二期/1月宿舍/2月一期… 各 N 户、第一段(无标题)期号可补、确认导入 → 跳转第一段、各槽真值；清空本期导入；勾选批删(种子禁选);编辑改动→完成→保存确认弹窗(保存/放弃)。0 console error。opus 对抗复审 + verify。

## 8. 明确不做（OUT）

import_log 导入历史/撤销批次(P-Import-3)、台账/其余屏的智能导入与保存确认(后续)、跨 sheet 多工作表(当前单 sheet 多段已覆盖真实文件)、三期/一期 在无标题且版面相同(office/factory)时的自动期号区分(交汇总屏用户确认)。
