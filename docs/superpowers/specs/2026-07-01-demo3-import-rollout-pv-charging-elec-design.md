# demo3 导入推广（光伏/电动车桩/汽车桩/电费成本）— 设计规范

- 状态：直接实现（用户 2026-07-01 提供 4 个真实记账模板 + 决策；"完成 spec 后直接 workflow 实现"）。
- 标准：遵 `docs/design/IMPORT-GUIDE.md`（**按真实文件定，不按猜的定**）。复用已建：FpImportModal/ImportResultToast/matchByHeader/parseYearMonth/importSections/ImportSummary；后端 clear/upsert/clearImported/batchDelete 范式（见 office 按月 upsert）。
- 用户决策：① 充电桩**改运营商分类**（重做 charging_cat 字典）；② 汽车**只导单月、聚合行(年/年范围/小计)跳过并报告**；③ 本刀做**全部四屏**。

## 0. 真实模板结构（dump 事实）

- **光伏(附表6)** `pv_record`：多段堆叠（`一期B-G座光伏发电明细`/`二期光伏发电明细`/`三期（3、4车间）光伏发电明细`），每段两行表头 + 逐月。列：`记账月份`(日期)|`发生月份`(日期)|`光伏发电总量(千瓦时)`|`光伏发电电费总金额(元)`|`消纳电量(千瓦时)`|`消纳电费金额(元)`|`上网电量(千瓦时)`|`上网收益(元)`|备注。年小计/合计行穿插。日期 = datetime。
- **电动车桩(附表8)** `charging_record` no=8：单年(标题`2025年…`)，数据起 col B。列：`充电桩类别`(运营商,合并/下填)|`月份`(日期)|`充电电量(千瓦时)`|`充电金额收入(元,已扣手续费)`|`充电成本(元)`|`充电利润(元)`|备注。按类别分组(叮叮充/电信)各 12 月 + 小计 + 总计。
- **汽车桩(附表7)** `charging_record` no=7：列：`充电桩类别`(运营商,合并下填)|`期间`(**异构**:`2024年`/`2025年1-9月`/单月日期/`小计`)|`充电电量`|`充电收入金额`|`手续费及服务费金额`|`充电成本金额`|`利润`|备注。类别万城万/小桔。
- **电费成本(附表11)** `elec_record`：两行表头。col A `记账期`(YYYYMM,如`202501`,下填)|col B `期`(一期/二期,下填)|`开票日期`(日期)|`用电时段`(峰/平/谷,真实文件**空**)|`用电类别`(大工业用电/居民生活/商业)|`单位`|`电量`|`不含税单价`|`不含税金额`|`税率`|`税额`|`价税合计`|`计费需量`|`单价`|`基本用电费`。每(记账期,期)有多条用电类别行 + 大工业行带基本用电(计费需量/单价/基本用电费) + 小计行。

## 1. 实体字段映射事实源

| 屏 | 行身份 | 维度 | 导入字段(模板列→实体) | 派生不导 |
|---|---|---|---|---|
| 光伏 | (phase,记账月) | phaseId(段标题→p1/p2/p3) | 记账月份→acctMonth、发生月份→occurMonth、消纳电量→selfKwh、消纳电费金额→selfAmt、上网电量→gridKwh、上网收益→gridAmt、备注→note | gen=selfKwh+gridKwh、fee=selfAmt+gridAmt（总量/总额列不导） |
| 电动车 | (cat,记账月) | cat(运营商名→cat_id) | 类别→cat、月份→acctMonth、充电电量→kwh、充电金额收入(已扣手续费)→**fee 直接**、充电成本→cost、备注→note | profit=fee−cost（利润列不导） |
| 汽车 | (cat,记账月) | cat(运营商名→cat_id) | 类别→cat、期间→acctMonth(仅单月)、充电电量→kwh、**fee=充电收入金额−手续费及服务费金额**、充电成本金额→cost | profit=fee−cost（利润列不导；收入/手续费仅供算 fee 不单存） |
| 电费 | energy:(phase,月,类别)；basic:(phase,月) | phaseId(期→p1/p2)、type(energy/basic) | 记账期→acctMonth(YYYYMM→YYYY-MM)、期→phaseId、开票日期→invDate、用电类别→cat、单位→unit、电量→qty、不含税单价→price、税率→rate；basic：计费需量→demand、单价→price | amount/tax/total/不含税金额/税额/价税合计/基本用电费 全派生不导 |

## 2. 共享基础设施（WI-0，先做）

1. **matchByHeader 加「填充型分组列」`groupLabels?: string[]`**：分组列(合并单元格/稀疏)按表头名匹配定位，值**向下填充**(数据行空则继承上一非空)；每条记录附 `__groups: Record<originalLabel, value>`。供充电桩「充电桩类别」(下填)。不影响现有调用（默认无 group）。回归 importHeaderMatch.spec 全绿 + 新增下填用例。
2. **parseYearMonth 扩展**（`utils/parseYearMonth.ts`）：① 加 `YYYYMM`(6 位纯数字,如 `202501`→2025-01；与序列号区分：6 位且 ≤209912 视为 YYYYMM)；② `2024年`/`2025年1-9月`/`小计`/`总计`/`合计` 等聚合/汇总串明确返回 null（汽车跳过用）。补 spec 用例。
3. **充电桩类别重做迁移 `V19__charging_cat_operators.sql`**：清 charging_cat + 旧 charge-type charging_record 种子 → 重 INSERT 运营商类别：no=7 `wancheng`(万城万)/`xiaoju`(小桔)、no=8 `dingding`(叮叮充)/`dianxin`(电信)（cat_id 取拼音、name 取中文、short/tint/sort 补默认）。可选插少量运营商口径 demo 行（source=seed）使屏不空；否则留空待导入。**注**：迁移不可改既有 V 文件，新增 V19。

## 3. 各屏导入实现

### WI-PV 光伏(附表6)
- 新建 `utils/importPvSections.ts`：按段标题正则 `/(一|二|三)期.*光伏发电明细/`(或含「期」+「光伏」)切段 → 段→phaseId(一→p1/二→p2/三→p3)；每段 matchByHeader（nameLabels=`['记账月份']` 日期行身份；`发生月份`/`备注` 作 text 列）→ 行 parseYearMonth(记账月份)→acctMonth、parseYearMonth(发生月份)→occurMonth；小计/合计行跳过。
- 后端：`POST /api/pv/import` body `{rows:[{phaseId,acctMonth,occurMonth,selfKwh,selfAmt,gridKwh,gridAmt,note?}]}`；**按(phaseId,acctMonth)upsert**（删被导入(phase,月)任意来源行再插，覆盖种子、不波及未导入；参照 office）。`clearImported`(按年删 import)、`batchDelete`。校验 acctMonth/phaseId。
- 前端 PvView：FpImportModal 走自定义解析(见 §4)→ 段×行汇总确认(复用 ImportSummary 或直接导)→ `pvApi.importRows`。加清空本期导入 + 批删（编辑态复选框，参照 utilities）。
- IT `PvImportApiIT`/`PvDeleteApiIT`：多段各落各期、跨年、upsert 替换种子、清空、批删。

### WI-Charging 电动车(8)+汽车(7)
- 新建 `utils/importChargingRows.ts`：matchByHeader（nameLabels=`['月份','期间']` 行身份=月；groupLabels=`['充电桩类别']` 运营商下填；列 `充电电量`→kwh、`充电成本(金额)`→cost、`充电金额收入`/`充电收入金额`→incomeRaw、`手续费及服务费金额`→serviceFee）。每行：
  - cat：__groups['充电桩类别'] 运营商名 → 经字典(cats DTO，name→cat_id)解析；未知 → 收 errors 跳过。
  - acctMonth：parseYearMonth(月份/期间)；**null(聚合/年/范围)→ 收 errors 跳过并报告**（汽车主要）。
  - fee：no=8 直接 = incomeRaw（已扣手续费）；no=7 = incomeRaw − serviceFee。
- 后端：`POST /api/charging/{no}/import` body `{rows:[{cat,acctMonth,kwh,fee,cost,note?}]}`；**按(scheduleNo,cat,acctMonth)upsert**；`clearImported`(按 no+年删 import)、`batchDelete`。cat 必须在 charging_cat 白名单(否则 errors)。
- 前端 ChargingView(共用,no=7/8)：FpImportModal 自定义解析；运营商字典从 `cats` 取；汽车/电动车同一 View 已 no 区分，列差异由解析处理(汽车多 收入/手续费两列算 fee)。清空+批删。
- IT `ChargingImportApiIT`/`ChargingDeleteApiIT`：电动车按月入各运营商、汽车跳聚合只入单月、fee 计算(7 减手续费/8 直取)、upsert、清空、批删。

### WI-Elec 电费成本(附表11)
- 新建 `utils/importElecRows.ts`（**bespoke**，最复杂）：两行表头跨行；col A `记账期`(YYYYMM 下填)、col B `期`(下填→phaseId)。逐数据行（跳 `小计`/合计）：
  - 记账期→acctMonth（parseYearMonth YYYYMM）、期→phaseId（一期→p1/二期→p2/三期→p3）、开票日期→invDate（parseYearMonth→YYYY-MM-DD 或留串）。
  - **energy 记录**：每行 type=energy，cat=用电类别、unit=单位、qty=电量、price=不含税单价、rate=税率、period=用电时段(空则 null)。
  - **basic 记录**：行若有 `计费需量` 非空（大工业行）→ 额外产出 type=basic 记录：demand=计费需量、price=单价(如 36.1)、rate=同行税率或 0。
  - 输出扁平 `{type,phaseId,acctMonth,invDate,period?,cat?,unit?,qty?,demand?,price,rate,note?}` 列表。
- 后端：`POST /api/elec/import` body `{rows:[…]}`；**按(phaseId,acctMonth)upsert**（删被导入(phase,月)任意来源 energy+basic 行再插——一个月一期整体替换）；`clearImported`、`batchDelete`。校验 type∈{energy,basic}、phaseId、acctMonth。
- 前端 ElecView：已有「导入 Excel」按钮(占位)→ 接 FpImportModal 自定义解析；清空+批删。
- IT `ElecImportApiIT`/`ElecDeleteApiIT`：一(记账期,期)产出多 energy + 1 basic、小计跳过、YYYYMM 解析、派生不入、upsert 替换种子、清空、批删。

## 4. FpImportModal 自定义解析通路
- 加可选 prop `customParse?: (matrix: string[][]) => { records?: ImportRec[]; sections?: {label:string; records:ImportRec[]}[]; error?: string }`。给了即走自定义：单 records → 直接预览(复用现有预览表 + `导入 N 条`)；多 sections → 复用 ImportSummary（隐期、按段标签显示）。各屏传自己的 importXxx 解析器（内部用 matchByHeader/groupLabels/parseYearMonth）。保持上传/粘贴/拖拽外壳与 cellDates xlsx 读取不变。
- 不破坏现有 4 通路（parseRow/columnMap/phaseLayouts/salarySections）。

## 5. 假数据(seed)可删（这 3 个服务对齐 salary/office）
- 去 seed 删除保护：`PvService`/`ChargingService`/`ElecService` 的 delete/batchDelete 去 `"seed".equals→409 / skip` 分支；前端 PvTable/ChargingTable/ElecTable 去 checkbox/删除按钮 seed 锁、selectAll/toggleSelect 去 seed 跳过。`clearImported` 仍只删 import。对应 ServiceTest/ApiIT 的 seed→409 断言翻转为成功，删共享种子的 IT 用例加 `@Transactional` 回滚、导入用例用无种子年份(参照本仓 office 修法)。
- S10 不在范围，保持其 seed 保护。

## 6. 验证（IMPORT-GUIDE 铁律 — 编排者亲验）
- 后端**全量 `./mvnw test`**（含全部新 IT；JsonPath 过滤断言用 isNotEmpty/isEmpty 不用 .value(scalar)；删种子 IT @Transactional 隔离）。
- 前端 build + vitest（importPvSections/importChargingRows/importElecRows/groupLabels/parseYearMonth 用例）。
- **起真后端 + preview 用 4 个真实 xlsx 走 upload 路径肉眼验**：光伏(三段各落各期/跨年)、电动车(各运营商逐月)、汽车(跳聚合只入单月 + fee=收入−手续费核对)、电费(一记账期多 energy+1 basic/派生算对)；含中文走浏览器；0 console error；验后 DB drop+remigrate 还原种子、清理 public 临时文件。
- opus 对抗复审发现项 → 修复再验。

## 7. 明确不做（OUT）
- 汽车聚合期间(年/年范围)入库（跳过+报告，需要时下一刀扩模型）；电费 用电时段 峰/平/谷 拆分（真实文件无，按单类别行入）；运营商自动建类（未知运营商跳过报告,字典手动补）；save-confirm 退出确认；import_log 历史。
