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
| `FpImportModal` | `components/import/FpImportModal.vue` | 居中弹窗,720 × 700 固定(2026-10-10 改稿,0.34.0),三步:选数据 → 核对 → 导入(见下「三步与核对页」)。上传(.xlsx / .csv)或粘贴(TSV,粘进来就认)→ 二维数组 → 三种解析模式之一 → 核对页 → 交 `runner` 原地跑(全仓 17 处入口都给了 runner;不给仍 emit 只是兼容,新屏必须给) |
| `importParse` | `utils/importParse.ts` | TSV/CSV → 二维数组(支持引号/CRLF/空行) |
| `importHeaderMatch` | `utils/importHeaderMatch.ts` | **按表头名字匹配**(单段):定表头块→列名映射→**按数据内容定位关键列**→数据行 |
| `importSections` | `utils/importSections.ts` | **智能整表拆段**(多段):按标题行拆段→识别年/月/期+版面→逐段 matchByHeader |
| `ImportSummary` | `components/import/ImportSummary.vue` | 核对页的分段表:一句「认出 N 段 M 行」+ 每段一行(勾选 · 文件里的标题 · 月份 · 期区 · 行数;按年的少期区一列)。缺期区的段标橙、不勾,选了就勾上;导不了的段(`reason`)标橙、勾不上。里面没有按钮,主按钮在弹窗底栏「导入 N 段 · M 行」 |
| `ImportProgressCard` / `ImportResultCard` | `components/import/` | 点「导入」后弹窗不关,原地换进度卡 → 结果卡 / 失败卡(UI-OVERLAY-SPEC §8);接线协议在 `importRun.ts` 头注释 |
| `ImportResultToast` | `components/import/ImportResultToast.vue` | **已没有屏挂它**(0.26.0 起结果都在导入弹窗里原地出,别再接);只剩它自己的测试和 `noInteractionLayoutShift.spec` 里两条豁免指着它,删组件时一起删 |
| `SaveConfirmDialog` | `components/import/SaveConfirmDialog.vue` | 退出编辑保存确认 |

**FpImportModal 三种模式**（按 props 选其一）：
- `parseRow`（位置映射，最弱，仅简单表，台账在用）
- `columnMap`（单段按名字匹配，扛多行表头/分类列/合计列）
- `phaseLayouts`（智能整表，多段+多版面，附表10 在用）

**三步与核对页**（2026-10-10 改稿，0.34.0；图是 `运维文档/设计稿/…/导入中心-2026-10-10/弹窗改稿/md-v2-*`）：
- **① 选数据**：拖放区 +「选文件」「粘贴表格」+ 格式提示；粘贴在 paste 事件里当场解析，没有「解析」钮（超过 200ms 才出「正在识别 N 行…」）。下面「文件要长这样」小样表 + 规矩，取 registry 每类的 `sample` / `rules`（`parserProps` 带上）。认不出 → 拖放区换成认不出卡（「重新选文件」「粘贴表格」），小样表和规矩留在原位。底栏只有「取消」。
- **② 核对**，四种：
  - 平铺：「认出 N 行：a 行能导，b 行导不了」；表里**全部行**、表内滚动，导不了的排最前、淡琥珀底、末列写原因；按钮「导入 a 行」。
  - 多段（附表10 / 工资 / 光伏发电 / 园区抄表多表 / 合同工作簿 / 三大报表 / 预算）：`ImportSummary`；逐段导的（`segmented`）加蓝底提示条。解析结果同时带 `bad` 的（附表6 记账月份认不出的行），表下面照样列出、写原因，记进「要核对」。
  - 台账：顶上「导到 X年X月 · 公司」条。文件月份 ≠ 要导的月 → **必须二选一才能导**（选之前主按钮灰、左边写「先选导到哪个月」）；本月已有台账 → 写会盖掉几家（结转虚行不算，`overwriteTargets`）。这两条由 registry 台账的 `precheck` 在进核对页时算；选了文件里的月，由 `ImportRunProgress.ym` 交给 runner，runner 用它代替屏上的月。分段台账两条都不出。**没有 `confirm` prop 了**，开跑前不再弹确认框。
  - 园区抄表补问：解析结果带 `ask`（标题缺月份 / 区 / 表类**任一项**）就出蓝底问题框，三项预填，改任一项重新解析；不再静默按一期电表导。区的选项和识别用同一份 `ctx.zones`（`resolveZones`）。
- **③ 导入**：进度卡 → 结果卡（「导进去 N 行」，单位随 registry 的 `unit`：行 / 家 / 户 / 块表）或失败卡，见 UI-OVERLAY-SPEC §8。
- **标题和那几样字只从 `parserProps` 来**：标题 =「导入」+ registry 的 `name`（「导入附表10 销售收入」），各屏不再写 `:title`；导入中心也走 `parserProps`（同一份 `sub` / `rules` / `sample` / `unit` / 台账 `precheck`），台账另给 `retarget`（「导到 … 改」回选公司 / 月份的小窗）。

**导不了的行：先导能导的**（用户 2026-10-10 拍板）：
- 解析器在解析时就交 `bad: [{ row, cells, reason }]`（`BadRow`，`utils/importHeaderMatch`），`reason` 写大白话（「日期认不出」「没有 9月31日」）；合计、小计、空行这类本来就该跳过的照旧静默跳过，不算导不了。多段的认不出写在段的 `reason` 上。
- 核对页只发能导的行；没发的行数由弹窗写进 `ImportRunProgress.bad`，`runImport` 记进导入记录的「要核对」。结果卡把核对页的 `bad` 和后端报的 `errors` 逐条列出，不折叠。
- `ctx._parseErrors` 那条「导完才报」的路已删，新解析器别再走。

**点「导入」之后**（2026-10-03，UI-OVERLAY-SPEC §8）：屏给 `FpImportModal` 传 `:runner`(必须给),弹窗就不关,原地出进度、结果、失败。
- runner = `runImport`(写 + 记导入记录)+ 刷新本页,收尾一律 `settle(res, p, refresh)`:刷新失败不算导入失败。错误**抛给弹窗**,别自己 `receipt.fail` —— 弹窗按错误分:网络断 / 5xx 与 4xx 写法不同。
- 写口自守照旧:失锁了 runner 返回 `null`(弹窗回到核对页)。
- 屏在编辑态转假的 watch、页签停用的 `onDeactivated` 里收导入窗,一律写 `if (!importBusy.value) importing.value = false`:在跑的不收(`importBusyGuard.spec` 扫全仓)。
- 导完要跳到别的期(附表10 跳第一段的册 / 年月、附表12 跳首段年月)的,跳期放进 `@close` 的关窗函数,别放进 runner:锁按期的屏一换期就退出编辑,放在 runner 里会把人踢出编辑态。
- 一次导入发多次请求的 run(工资逐月、水电逐年、台账整册逐公司)每写完一次调 `ctx._run?.wrote(累计写入数)`:后面那次失败时前面的不回滚,失败卡据此写「前面已写入 a 行」而不是「一行都没写进去」。
- `runImport` 返回 `{ res, logIds }`,屏上把 `.res` 交给 `settle`。一个落点一条导入记录(registry 的 `target(ctx, picks)` 给落点,逐段 / 逐公司的经 `ctx._seg` 报段)。整单被拒(后端 4xx 信封,含审核闸)也记一条 `rejected`,`note` = 后端原句;断网 / 5xx 不记(那是没导成,不是被拒)。
- 导入写口一律带 `silentNetError`(`api/index.ts`):失败只在失败卡里说一遍,底部全局网络报错不出。新加导入写口要带上(`api/__tests__/silentNetError.spec.ts` 扫)。
- 导完行高亮(动效板 ⑤):导入中心、月度台账、园区抄表在点「完成」关窗那一刻给导进去的行挂 `fp-row-flash`(`styles/motion.css`,浅蓝底 2s 褪;格子自带底色的表把动画挂到 `td` 上)。挂早了亮在弹窗后面,人看不见。
- 进度回调 `p` 一律塞进 `ctx._run` 再调 `runImport`:写完它把步骤推到「记下这次导入」;三大报表 / 台账整册开跑前新建了公司、写入又被拒时,它让失败卡多写「新建的 N 家公司已留下」。
- **逐段**(`segmented`,附表10):registry 的 run 认 `ctx._run`,从 `_run.from` 段起发、每段写完报 `_run.segDone`;断在网络 / 5xx 时用户点「从第 k 段接着导」只重发第 k 段起。新接逐段的类型,后端那一段的写法必须「重发同一段结果相同」(清本槽导入行再插 + 整段一个事务),否则不许开 `segmented`。屏有编辑锁的再传 `ctx._alive = () => edit`:每段发之前问一次,失锁就停(后端写口不校验锁)。
- 用户看到的:进度卡(逐段画真进度,单次请求只画「还在动」不写百分比,200ms 内跑完不出卡)→ 结果卡(「导进去 N 行」+ 导进去 / 没导两块数,没导的行逐条列出;多段都导进去写「一期、二期、三期都在库里了。」,台账写「9月水电的台账已经在库里了。」)→ 或失败卡(「第 k 段(期区)没导进去」/ 没回应时「第 k 段(期区)没等到服务器的结果」/「导入失败，这次一行都没写进去」/ 多次请求断在后面时「导入没做完，前面已写入 a 行」);导入中弹窗关不掉。

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
