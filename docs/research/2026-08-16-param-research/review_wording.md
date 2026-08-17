# 参数读侧用语规范复核（后端 4810d36 + 前端 c069b90）

> 复核员：只读复核（不改代码；只跑测试、只读接口、headless Chrome 截屏 + DOM 扫描）。日期 2026-08-17。
> 对照：任务下发的「用语规范（唯一口径）」+ `docs/design/S21-PARAM-CENTER-SPEC.md` §5.2 禁词 + LIST-PAGE-SPEC 行高 56px + EDIT-MODE v2。
> 范围：`backend/.../service/ParamRegistry.java`、`ParamService.java`；`frontend/src/utils/paramRegistry.ts`、`__fixtures__/param-registry.json`、`paramCenterLogic.ts`、`poolLedgerLogic.ts`、`coefBookLogic.ts`；`views/params/*`、`views/alloc/LossLedgerView.vue`、`views/alloc/PoolLedgerView.vue`、`views/bills/CoefBookWindow.vue`。
> 结论一句话：**①两端注册表逐字一致成立；②两个月 809 行 API 的 label/valueText/rangeText/sourceChain（含 formula/hint/scopeLabel）禁词 0 命中；③ 1440 / 1280 两宽度 `/params` 四区 + 五个抽屉 0 截断、公共电核算抽屉③ 0 新增截断；但楼栋损耗二期「位置」列有 2 处截断、池抽屉③「面积基数来源」仍显裸键、历史/变更记录抽屉值列仍是原始数字 —— 共 3 项必须再改；其余为非本刀残留与观察。**

---

## 0. 验证记录（做了什么、看到什么）

| 项 | 方法 | 结果 |
|---|---|---|
| 前端门禁 | `cd frontend; npm run typecheck` / `npm test` | typecheck EXIT 0；vitest **106 文件 / 1268 用例全绿** |
| 后端门禁 | `mvnw.cmd -q test -Dtest=ParamRegistryTest,ParamApiIT`（Testcontainers MySQL） | ParamRegistryTest 7/7、ParamApiIT 8/8 全绿，EXIT 0（详见文末） |
| ① 注册表镜像 | `paramRegistry.spec.ts`「逐键 label/unit/group/defaultMode/monthlyCheck/valueKind/enumOptions/formula/hint/tenantEditable/pairedWith/monthOnly 相同」toEqual 全等（44 键）；`backend/target/param-registry.json`（ParamRegistryTest.exportJson 12:41:03 产出，晚于 ParamRegistry.java 12:28 最后修改）与 `frontend/src/utils/__fixtures__/param-registry.json` **SHA256 全等**（E71E1A8D…9341） | 成立 |
| ② API 禁词 | 登录取 token 后 `GET /api/params?ym=2024-02&zone=all` 与 `?ym=2023-08`（各 809 行；`zone=all` 与不带 zone 同）逐行扫 label / valueText / rangeText / sourceChain / formula / hint / scopeLabel / unit / note，禁词集 `Σ vs 裸 池分母 T= T = 默认·所有月份 （价目参数） 分母 = 分母= 初始版本 ROUND 包干 building: rule: meter: tenant:` | **系统文案字段 0 命中**；只有 DB 自由文本 `note` 命中（2024-02：包干 49 / Σ 6 / ROUND 5 / 初始版本 1 / 裸 1；2023-08：包干 49 / ROUND 11 / 初始版本 37 / Σ 4）—— spec §5.2 明写 note 不受禁词规则管，见 §6 |
| ② 文案形态 | 同上两份 JSON 的 distinct rangeText / valueText 模式 / sourceChain 模式 | rangeText 只有 `仅 X` / `X 起长期` / `长期` / `X 及以前`（后者是「初始版本被后续版本截断」的新写法，未含禁词）；valueText 千分位（`148,918.01 ㎡`、`-8,000 度`、`11,435.07 元`）、布尔状态句（参与 / 不参与、计入 / 不计入、仅总表 / 总表 + 铝缆）、引用显名（`仅「A座总电」`、`并入「二期 三车间」核算`、`独立核算`、`全部总表`）；面积基数池分摊基数行 valueText=`148,918.01 ㎡`、sourceChain 末项=`取自「园区分摊面积基数」`（rule 4/9/13/15/17/18/21 → 园区、25/100 → 一期 80,000、40 → A座电梯 12,487.04、90/91 → 宿舍 15,510）；户级链 `星州（户）:0.15 元/度 \| 全园:0.16 元/度` |
| ③ 截断扫描 | headless Chrome（CDP，`--headless=new`，Emulation 1440×1000 与 1280×1000），localStorage 注 token 登录；每个状态跑 DOM 扫描：可见、非 inline、有文字的元素中 `scrollWidth>clientWidth+1` 或 `scrollHeight>clientHeight+2`，排除 overflow auto/scroll 的滚动容器，按 `overflow hidden/clip/text-overflow/line-clamp` 判「clipped」、否则「spill」；同时截屏存 scratchpad | 见 §3 表 |
| ④ 残留缩写 | `Grep` 前端 `views/params`、`views/alloc`、`views/bills/CoefBookWindow.vue`、`utils/{paramCenterLogic,poolLedgerLogic,coefBookLogic}.ts` 的 `Σ / vs / T= / ROUND / 裸 / 池分母 / 分母 = / 价目参数 / 初始版本 / 包干 / 加度 / 剔出 / 改… / 旧→新 / p1 / p2 / dorm / fold_price / (ref) / bill_notice / sign= / area_base`，只计**上屏字符串**（模板文本、title、placeholder、label、选项），不计注释 | 见 §4 |

---

## 1. ① 两端注册表逐字一致

- `paramRegistry.spec.ts` 对 fixture 44 键逐键 `toEqual`（label / unit / group / defaultMode / monthlyCheck / valueKind / enumOptions / formula / hint / tenantEditable / pairedWith / monthOnly）—— 通过。
- fixture 与后端 `ParamRegistryTest.exportJson` 的产物字节全等；产物时间戳晚于 `ParamRegistry.java` 最后修改，dev 后端进程 13:03 启动晚于 12:30 编译 —— 运行中的后端与文件一致。
- 逐键人工对照任务下发的 44 条 label / unit / formula / hint 要点：label 与单位**全部一致**（含 `供电局综合电价（月均）`、`分摊基数（层数或面积）`、`损耗费计费基数（形态）/（按栋）`、`损耗率分母`、`不计入楼栋合计的电表`、`电费一口价`、`公共电费固定月额`）；formula 与规范文本一致（`park_share_div` 写「四舍五入到 2 位」，`elec_grid_avg` 写「本月未填时按 平段电价 + 电力管理费」）；hint 在规范要点之上多了几处具体锚点（如 `elec_flat`「二期公摊池成本的底价（供电局综合电价未填时…）」、`elec_grid_avg`「…2024-02 二期 1.09312」、`sharp_as_peak_ratio`「二期 2023 下半年 1 → 0.0994 → 0」、`loss_rate_manual`「如 B座 0.0156、二三四车间 0.0015」、`loss_exclude`「力美C201电 / 四车间工地 / 广告字分表」、`fire_amount_fixed`「175.48 / 72.59」、`loss_base_form_b{bid}`「邓宇峰：三车间组 F、六车间组默认」）—— 都是人话补充，无禁词，两端一致，不算偏离。
- `loss_variant` 枚举文字与规范逐字相同；`loss_head / loss_c_meter / loss_recon / loss_exclude / loss_denom_cable` 的 formula 已改成「是否参与…」「该表不计入…」「收取损耗率的分母取 仅总表 或 总表 + 铝缆」等人话句。
- 后端门禁：`ParamRegistryTest`（含 exportJson 重导）+ `ParamApiIT` —— **结果见文末「后端测试结果」**。

## 2. ② API 文案

- 两个月 809 行：label / valueText / rangeText / sourceChain / formula / hint / scopeLabel 全部 **0 命中**（Σ、vs、裸、池分母、T=、默认·所有月份、（价目参数）、分母 =、初始版本、ROUND、包干、内部标识）。
- 值文案：数字千分位；布尔状态句；枚举字典文字；引用型显名字（`仅「A座总电」`）；面积基数池只读行 valueText=`148,918.01 ㎡`、sourceChain 末项 `取自「园区分摊面积基数」`。
- 生效区间：`仅 2024-02` / `2023-10 起长期` / `长期` / `2023-10 及以前`。最后一种是初始版本被后续版本截断时的写法（如 一期 B座 损耗核算方式 `2023-10 及以前`、二期 损耗率分母 `2023-09 及以前`），不在规范列出的四种之内但无禁词、语义清楚 —— 建议把它补进 spec §5.2 的形态清单（文档同步，不改代码）。
- 命中链首项 = 生效来源、后项 = 上级，前端「来自」列据此显 全园设置 / 一期设置 / 本栋设置 / 本池设置 / 本期设置 / 户级例外（覆盖 全园 0.16 元/度） / 取自「…」。

## 3. ③ 截断扫描（1440 与 1280）

| 状态 | 1440 命中 / 扫描元素 | 1280 命中 / 扫描元素 | 说明 |
|---|---|---|---|
| /params 2023-08 一期 浏览 | 0 / 1286 | 0 / 1246 | |
| /params 2023-08 一期 ①② 展开未设置 + ⑤ 展开 | 0 / 6432 | 0 / 6392 | |
| /params 2023-08 一期 编辑态 | 0 / 6445 | 0 / 6405 | |
| 修改弹窗（商业电价） | 0 / 6452 | 0 / 6412 | |
| 历史抽屉 | 0 / 6461 | 0 / 6421 | |
| 变更记录抽屉（15 条） | 0 / 6590 | 0 / 6550 | |
| 新增例外抽屉 | 0 / 6455 | 0 / 6415 | |
| /params 2024-02 二期 浏览 / 展开 | 0 / 1835 · 0 / 3192 | 0 / 1795 · 0 / 3152 | |
| /params 2024-02 全园 / 宿舍 | 0 / 3302 · 0 / 1162 | 0 / 3262 · 0 / 1122 | |
| 楼栋损耗 2023-08 一期 | 0 / 249 | 0 / 209 | |
| 楼栋损耗 2023-08 二期 | **2 / 170** | **2 / 130** | 「位置」sticky 列 230px：`二期 二车间/二期 三车间/二期 四车间(二期 三车间供电)` 需 331px（截 102px）、`二期 一车间/二期 五车间(二期 五车间供电)` 需 259px（截 30px）→ 见 issue 1 |
| 楼栋损耗 2024-02 二期 / 一期 | **1** / 196 · 0 / 254 | **1** / 156 · 0 / 214 | 同上第一条 |
| 公共电核算 2024-02 一期 浏览 / 编辑 | 17 / 2686 · 17 / 3174 | 17 / 2646 · 17 / 3134 | 16 clipped 全在**主表**（既有）：池名 `一期 A座·一楼·联塑精铟`（截 8px）、Σ 副标题 8 处（`A东侧货梯 · Σ 907.57 度 / 1,011.18 元` 等，截 14~61px）、带尾块名 6 处（`A座电梯及楼层公共电合计` 截 10px）、`杨文正公共电 !` 纵向 3px；提交信息已声明「池核算主表余 16 处…不在本刀」，本次复核数目一致 |
| 公共电核算 2024-02 一期 抽屉③（一期园区·绿化水） | 17 / 4194 | 17 / 4154 | **抽屉自身 0 新增**（17 = 主表既有）；只读句 `分摊基数 80,000 ㎡（取自「绿化水分摊面积基数」）· 加减度数 未设置` 完整 |
| 公共电核算 2024-02 二期 编辑 / 抽屉③（二期园区·消防水稳压泵） | 3 / 1132 · 3 / 2152 | 3 / 1092 · 3 / 2112 | 3 处均为主表池名（`园区生活水泵、消防控制室` 截 69px / `电梯+低压电房照明` 29px / `广告字灯（火炬园广告字）` 21px，既有）；抽屉 0 新增，只读句 `分摊基数 148,918.01 ㎡（取自「园区分摊面积基数」）· 加减度数 未设置` |
| 系数簿抽屉（1280） | — | 0（仅生效月 Select 触发器 2px 舍入） | 提示语已是「一口价 / 电力管理费」口径 |

补充实测：楼栋损耗 二期 2023-08「收取损耗率」格 `手工指定 0.15%（公式 3.00%）` 把该列从 160 撑到 186px（`.ll-table width:max-content`），**不截断**；对账两行的供电局读数落「总表用电量」列、各栋合计落「分表用电量」列，`供电局总表 vs 各栋总表合计` 178px 未截。公共电核算编辑态「分摊基数（当月）」「加减度数（当月）」两列 156px：`80,000 面积基数`、`148,918.01 面积基数`、`-670 仅本月`、`7 长期`、`5.8 长期` 全部 scrollWidth==clientWidth，不截。

## 4. ④ 仍存在的口头缩写 / 程序员文案（上屏字符串）

**A. 本刀四屏之内**

| # | 位置 | 文案 | 判定 |
|---|---|---|---|
| A1 | `views/alloc/PoolLedgerView.vue:1023` 池抽屉③「面积基数来源」`<Input>` | 值格显裸键（实测 一期园区·绿化水 显 `green_area_base`、二期园区·消防水稳压泵 显 `area_base`），placeholder「如 area_base（园区分摊面积基数）；空 = 用本池分摊基数」 | **issue 2**（字段名上屏） |
| A2 | `views/params/ParamHistoryDrawer.vue:29,45,61`、`ParamChangesDrawer.vue:37,63` | 版本值 / 变更（旧 → 新）列 `String(v)`：枚举键显 `0` / `1`（一期 B座 损耗核算方式 版本 `0` → `1`、变更 `— → 1`）、布尔键同、数字无千分位无单位（`— → -8000`） | **issue 3**（枚举值上屏、无千分位） |
| A3 | `utils/poolLedgerLogic.ts:312-313` 楼栋损耗对账两行 label | `供电局总表 vs 各栋总表合计` / `供电局总表 vs 各栋分表合计` | 与任务规范逐字一致（规范给的就是 vs），但与注册表 `loss_recon.formula`「供电局总表 与 各栋总表合计 / 各栋分表合计」用字不同 —— 观察，不列 issue；若要彻底去 vs，两处同改「与」 |
| A4 | `views/alloc/PoolLedgerView.vue:390-391` 池抽屉⑤ 折入链类型选项 | `折入标准(fold_price)` / `折入度数(fold_qty)` | 既有、同一抽屉但非 ③，非本刀；建议下刀去括号内枚举值 |
| A5 | `PoolLedgerView.vue:774` 列头 title | `逐表金额(p1/宿舍逐表ROUND口径);二期为池级一次ROUND…` | 既有 tooltip（p1 / ROUND） |
| A6 | `PoolLedgerView.vue:768,780,782` 列头 title | `「−」=以 sign=-1 从本池冲减`、`待账单模块(bill_notice)落地后…`×2 | 既有 tooltip（字段名 / 表名） |
| A7 | `PoolLedgerView.vue:919`、`utils/poolLedgerLogic.ts:296` | tfoot `纯标准行(ref)不入合计;冲减载体(carrier)只计度数不计金额`；导出合计备注 `ref 行不计;carrier 只计度数不计金额` | 既有（枚举值） |
| A8 | `utils/poolLedgerLogic.ts:195` 池首行副标题 | `Σ 153 度 / 680.85 元` | 既有主表 Σ（提交信息已声明不在本刀） |
| A9 | `views/params/ParamEditPopover.vue:88` 删除按钮 | `删除 2023-08 专属值（恢复长期值）` —— 对只能按月生效的电价键（无长期值可恢复，删了就是「缺」）措辞不准 | 观察（非禁词） |
| A10 | API valueText | `0 比例`、`0.003 比率`（单位跟值同格） | 规范如此（单位跟值同格）；读起来生硬，可考虑比例/比率类只在 label 下小字显单位 —— 观察 |

**B. 参数链之外（顺手列，非本刀）**

- `views/meters/MeterDetailDrawer.vue:124,130`：`本表用量不计入楼栋分表Σ、不进池分母` / `重新计入楼栋分表Σ 与池分母`。
- `utils/billNoticeLogic.ts:525`：费项悬浮 `价目月 初始版本(自始生效)`。
- DB 自由文本 `note`（历史 / 变更记录抽屉「备注」列、池抽屉「备注」框、分摊标准 ❄ title 原样渲染）：`粤海华创 包干价已含维护/管理费(§2.5)` 等 49 条 mgmt_fee 户级注记、`抄表册段落Σ剔除行,不入损耗C/D:…`、`源册 2023-11 起 B座 I=ROUND(G/C,4)+H`、`S21:自 alloc_rule.coefficient 列迁入(初始版本)`（2023-08 视角 37 条）、`2024-02 二期综合月均裸价(退役常数 1.25312−0.16;…)`。spec §5.2 明写「禁词规则只管系统文案…不管 note」；要清也只能走 V 迁移改注记（本刀禁写 dev 库），建议另立小刀或不动。

---

## 5. issues（必须再改）

1. **楼栋损耗 二期「位置」列截断**：`frontend/src/views/alloc/LossLedgerView.vue:85` `LBL_W = 230`，`.ll-lbl`（:282）`overflow:hidden; text-overflow:ellipsis`；二期归组标签 `二期 二车间/二期 三车间/二期 四车间(二期 三车间供电)` 需 331px、`二期 一车间/二期 五车间(二期 五车间供电)` 需 259px，1440 / 1280 两宽、2023-08 / 2024-02 两月都截（仅靠 title 补救，违背「用户可见文字一律不截断」；提交信息只验了 2023-08 一期 0/249）。建议 `LBL_W` 抬到 ≥ 350（或按 units 里最长 label 取 max），34px 行高不换行。
2. **池抽屉③「面积基数来源」仍显裸键**：`frontend/src/views/alloc/PoolLedgerView.vue:1023` `<Input v-model="form.baseKey" label="面积基数来源" placeholder="如 area_base（园区分摊面积基数）；空 = 用本池分摊基数">` —— 值格与 placeholder 都是字段键（`area_base` / `green_area_base` / `lamp_area_base` / `elevator_area_base`），违反「不出现字段名」。建议换 `Select`：选项 = 注册表里 4 个面积基数键（按 label 显 `园区分摊面积基数` / `路灯分摊面积基数` / `绿化水分摊面积基数` / `A座电梯分摊面积基数`，value 仍是键）+ 首项「用本池分摊基数」（value ''）；提交体不变，不碰取值逻辑。
3. **历史 / 变更记录抽屉值列仍是原始数字**：`frontend/src/views/params/ParamHistoryDrawer.vue:29`（`fmtV = String(v)`，:45 `{{ v.value }}`、:61 `旧 → 新`）与 `ParamChangesDrawer.vue:37,63` —— 枚举键显 `0` / `1`（一期 B座 损耗核算方式 版本 `0`→`1`、变更 `— → 1`）、布尔键显 0/1、数字无千分位无单位（`— → -8000`），违反「布尔用状态句 / 不出现枚举值 / 数字带千分位」。建议按 `paramDef(key)`（历史抽屉有 `row.key`，变更记录有 `c.key`）格式化：enum → `enumOptions[v]`；bool → 与 `ParamEditPopover.BOOL_TEXT` 同一份状态句（抬到 `paramCenterLogic` 共用）；数字 → 千分位 + `unit`；引用型暂显原 id 或后端补文字。纯展示层，不改写路径。

## 6. 观察（不必改 / 供参考）

- rangeText 新形态 `X 及以前` 建议补进 spec §5.2 形态清单（文档）。
- `ParamCenterView.gotoCoefBook` 跳 `/bill-notices?ym=…&coef=1`，但 `BillNoticesView.vue` 不读任何 route.query（`useRoute` 未引入）：既不落到该月也不自动开系数簿（实测 1280 落地页仍显默认月、抽屉未开）。功能缺口非文案，与本刀无关，记下。
- 楼栋损耗对账两行的 `vs` 与注册表 `loss_recon.formula` 的「与」不一致（A3）；二选一统一即可。
- 历史抽屉变更表「生效」列写 `2023-11 起`（`ParamHistoryDrawer.vue:60`），变更记录抽屉同列写 `2023-11 起长期`（`ParamChangesDrawer.vue:39`）；两处措辞可统一成「X 起长期」。
- 公共电核算主表 16 处既有截断（池名 / Σ 副标题 / 块名）与提交信息一致，本刀不背。
- 「沿用」表现符合规范：值照常显 + 灰徽标「沿用 2023-10 起设置 / 沿用长期设置」+ 橙「未核对」；面积基数池「来自」列 `取自「园区分摊面积基数」` 可点跳 ② 区对应行并高亮；③ 区「不计入楼栋合计的电表：」+「设为不计入」；变更记录列头「变更（旧 → 新）」；弹窗布尔选项 参与 / 不参与、计入 / 不计入、仅总表 / 总表 + 铝缆；楼栋损耗列头 损耗调整度数 / 损耗率加点 / 收取损耗率、抬头「核算口径设置」；公共电核算列头 分摊基数（当月）/ 加减度数（当月）、抽屉「面积基数来源」「初始分摊基数（层数或受益面积 ㎡）」；⑤ 固定规则六句无 Σ / ROUND；系数簿提示 一口价 / 电力管理费 —— 均已核实。

## 后端测试结果

`mvnw.cmd -q -f backend/pom.xml test -Dtest=ParamRegistryTest,ParamApiIT`（Testcontainers mysql:8.0，V1~V100 全量迁移）：**ParamRegistryTest 7/7、ParamApiIT 8/8 全绿，mvn EXIT 0**；`exportJson` 重新产出的 `backend/target/param-registry.json`（13:43:26）与 `frontend/src/utils/__fixtures__/param-registry.json` **SHA256 仍全等** —— ① 两端镜像一致再次成立。
