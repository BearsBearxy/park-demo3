# demo3 Excel 导入规范 (Import Guide)

> **本文件是 Excel 导入功能的实现标准与避坑事实源；新屏接入导入、改导入逻辑必须遵循。**
> 来源：附表10(销售收入)导入的实战（2026-06-30 ~ 2026-07-01，用户真实 `附表10测试.xlsx`）。

---

## 一、为什么需要这份规范

附表10 导入从「位置映射」一路被真实 Excel 打到「按数据内容的智能整表导入」，踩了一连串坑（多行表头、车间分类列、合计列、小计行、租户列不在固定位、前后端路由不一致、JsonPath 断言、curl 中文编码…）。这些坑对**每个录入屏的导入都会重演**。先把它们定成规范，避免重复踩。

**铁律一句话**：**真实 Excel 远比设想乱；列映射按数据内容、不按固定位置；拿用户真实文件实测，别按截图/描述猜结构。**

---

## 二、导入架构（共享件，新屏复用）

| 件 | 路径 | 职责 |
|---|---|---|
| `FpImportModal` | `components/import/FpImportModal.vue` | 右滑抽屉:上传(.xlsx 懒加载 SheetJS / .csv) + 从 Excel 粘贴(TSV) → 二维数组 → 三种解析模式之一 → 预览/汇总 → emit |
| `importParse` | `utils/importParse.ts` | TSV/CSV → 二维数组(支持引号/CRLF/空行) |
| `importHeaderMatch` | `utils/importHeaderMatch.ts` | **按表头名字匹配**(单段):定表头块→列名映射→**按数据内容定位关键列**→数据行 |
| `importSections` | `utils/importSections.ts` | **智能整表拆段**(多段):按标题行拆段→识别年/月/期+版面→逐段 matchByHeader |
| `ImportSummary` | `components/import/ImportSummary.vue` | 多段汇总确认屏(年/月/期可改+勾选) |
| `ImportResultToast` | `components/import/ImportResultToast.vue` | 结果:导入/跳过/错误(可展开) |
| `SaveConfirmDialog` | `components/import/SaveConfirmDialog.vue` | 退出编辑保存确认 |

**FpImportModal 三种模式**（按 props 选其一）：
- `parseRow`（位置映射，最弱，仅简单表，台账在用）
- `columnMap`（单段按名字匹配，扛多行表头/分类列/合计列）
- `phaseLayouts`（智能整表，多段+多版面，附表10 在用）

**后端导入端点范式**（每子系统一个 `POST .../import`）：
- **语义 = 清本槽导入行再插**：导入前 `delete where <slot>+source='import'`，再把 rows 全 `insert(source='import')`。重导干净、手动行不动。`@Transactional`。
- 返回 `ImportResultDTO{imported, skipped, errors:[{rowIndex,label,reason}]}`。
- 配套 `DELETE .../imported?<slot>`（清空本槽导入）+ `DELETE .../batch{ids}`（按 id 批删，`source='seed'` 跳过计 skipped）。

---

## 三、真实 Excel 解析规则（matchByHeader 必守）

**绝不假设固定列位置/列顺序/单行表头。** 真实表实测结论：

1. **多行表头**：标题行 + 分组行 + 叶子行（3 行甚至更多）。`skipHeader` 只跳 1 行不够。
   → 表头块末行 = **最后一个含 ≥2 个列标签命中的行**；逐列**跨整个表头块**找列名（捕获落在分组行的单列标签如「其他费用」「空地租金」）。
2. **关键列（租户/员工/…）不在固定位、表头可能在别行**：如「租户」表头在 r0c0，但数据租户在 c1（c0 是前置「车间」分类列）。
   → **关键列按数据内容定位**：非已映射列里、数据行「文本(非数字/非空/非小计)」最多的列。**别按表头行里找标签**（那行该列可能是空的）。
3. **前置分类列**（一至四车间/五、六车间）：表头匹配不上 → 自动忽略；关键列定位用数据内容，不受影响。
4. **尾部「合计/备注」列**：列名匹配不上 → 忽略（**别按位置读，否则合计落到末叶子**，如宿舍误落「一栋保障房租金」）。
5. **小计/总计行**（「X车间合计：」「二期园区总计：」）：关键列值含 `合计|小计|总计` 或为空 → 跳过。
6. **列名标签规整**：`normalizeHeader` 去空格 + 去 `、，·（）()／/。.` 等标点后匹配（用户标签与 demo3 标签常差标点，如「土地使用税、房产税」）。
7. **智能整表多段**：标题行正则 `/(\d{4})\s*年\s*(\d{1,2})\s*月.*?(一期|二期|三期|宿舍)/` 拆段（散租宿舍→宿舍）；版面由内容识别（含「办公室租金/保障房」=office 否则 factory），**不靠期号**；无标题前导段/单段回退当前槽默认，交汇总屏让用户补。

---

## 四、验证铁律（这些坑每轮都可能重演）

1. **编排者必须亲跑全量 `./mvnw test`**——agent 的 `test-compile` 绿 **不算数**。真跑抓到过：单测 mock 不回填自增 id 致 NPE、IT 断言 bug、列表查询缺确定性 ORDER BY。
2. **后台跑测试别接管道**：`./mvnw test | tail` 的退出码取自 `tail`(0)，**掩盖 mvnw 失败**，task-notification 误报 exit 0。用 `./mvnw test`(不接管道) 或读输出 grep "Tests run/ERROR"。
3. **JsonPath 过滤器 `[?(@..)]` 返数组**：断言"某行存在"用 `.isNotEmpty()`，**别用 `.value(标量)`**（数组 vs 标量 / Integer vs Long → "expected:<15> but was:<15>" 值同却 failed）。
4. **curl 发中文 body 在 Windows 终端必乱码致 500**（`Invalid UTF-8 byte`，非后端 bug，是终端编码）。**含中文的 POST 验证走浏览器(前端发正确 UTF-8) 或 ASCII 占位名**。
5. **前后端路由务必端到端连通**：两 agent 各自选路径会漂移（前 `/api/companies/{id}/ledger/import` vs 后 `/api/ledger/companies/{id}/import`）→ 运行期 404。复审务必查连通。
6. **build/vue-tsc 绿 ≠ 运行期对**：Vue 模板默认 loose check、契约形状漂移、dead emit、**复用别组件 scoped class 致零样式**——必须**起真后端 + preview 用真实文件肉眼扫整屏**。
7. **DELETE 带 body**（批删 `http.delete(url,{data})`）：Spring `@RequestBody` + Tomcat 可读，IT 须覆盖。
8. **DELETE 静态路径 vs 模板路径**：`DELETE /imported`(静态) 与 `DELETE /{id}`(模板) 共存时静态优先；为稳，清空类用 query param（`?phase=&acctMonth=`）避开与 `GET {phase}/{year}/{month}` 撞。

---

## 五、给新屏接入导入的清单

各录入屏数据模型不同（附表10=租户型；光伏/充电桩/电费/办公水电=记录型；工资=员工型），导入须各自定**行身份(关键列)**与**列→字段映射**。步骤：

1. **后端**：加 `POST .../import`（clear+insert 语义）+ `DELETE .../imported` + `DELETE .../batch` + `ImportResultDTO`/`DeleteResultDTO`。复用既有 FEE/COLS set。IT 覆盖：重导替换、清空导入、批删跳种子、非法参数 400。
2. **前端**：
   - 该屏列定义 → `columnMap`（`{label,key}[]`，复用屏自己的列常量）。
   - 关键列名（租户/姓名/月份/类别…）→ `nameLabels`。**若行身份是"月份/类别"而非"名字"**，matchByHeader 的"文本最多列"启发式可能不适用 → 该屏自定关键列识别（如按"是否像 YYYY-MM/类别枚举"），或要求用户粘到具体槽。
   - 接 `FpImportModal`（`columnMap` 模式，或简单屏用 `parseRow`）。
   - 「清空本期导入(N)」按钮 + 编辑态复选框批删 + 退出编辑 `SaveConfirmDialog`。
3. **验证**：亲跑 `./mvnw test` + 真实文件 preview 肉眼扫（见 §四）。

> **智能整表多段导入（importSections）是附表10 专有**（按 期×月 多段）。记录型屏一般单段导到当前年/期槽即可，不必套 importSections。
