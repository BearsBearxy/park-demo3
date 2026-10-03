# 授权胶囊 · 三大报表 · 计费参数 · 导入进度 · 横条收尾 · 实现规范（2026-10-03）

**管什么**：怎么实现、谁做哪块。「做成什么样」以画布为准。
- 画布：`../运维文档/设计稿/未实现/授权条-三大报表-计费参数-导入-2026-10-02/`（Design 画布第 35 版，08–11 节）。逐块渲图在同目录 `_shots-v35/`，**图就是规格**；图和本文、和画板旁便签不一致时以图为准。
- 横条清单：同目录 `横条盘点-2026-10-03.json`（47 处核实 + 7 处补漏）。
- 分支：`jfen/elev-reports-params-import`，叠在 `jfen/hint-impl`（0.25.0，未推）之上；本批版本 **0.26.0**（功能更新：授权入口换了位置、报表公司选择换了位置、计费参数整屏重排、导入有进度）。

---

## 1. 定下的做法（2026-10-03 用户：「按照现在设计稿，规范按你决定」）

稿和现行规范冲突的地方，**一律按稿**，同一批改掉规范原文：

| # | 稿上的做法 | 推翻 / 改动的规范 | 改到哪 |
|---|---|---|---|
| D1 | 满宽授权条撤掉，改顶栏钥匙胶囊 + 420 宽卡片（08-A/B） | ELEVATION-SPEC「全局横幅」 | ELEVATION-SPEC |
| D2 | 最后 1 分钟胶囊变橙，出一条不自收的回执「授权还剩 1 分钟」 | 新增 | ELEVATION-SPEC |
| D3 | 点「结束授权」时有未保存改动 → 先问（08-B「结束前先问」） | 新增 | ELEVATION-SPEC、EDIT-MODE §6 |
| D4 | 到期 / 提前失效 / 一份先到期，三句分开写（08-B） | EDIT-MODE §6.2 原句 | EDIT-MODE-SPEC §6.2 |
| D5 | 三大报表公司选择收进期间条下拉；选期矩阵标题里是同一个下拉；一家公司都没有时「新增公司」进空态 | BOOK-WORKBENCH §7-2「左栏」——只对三大报表；台账、附表 1–5、附表 10 仍用左栏（稿没画） | BOOK-WORKBENCH-SPEC §7-2 |
| D6 | 三大报表撤掉四张 KPI 卡 | — | BOOK-WORKBENCH-SPEC |
| D7 | 资产负债表左右两半合成一张 6 列表，段合计上移到组头行 | — | BOOK-WORKBENCH-SPEC |
| D8 | 三大报表 0 与空一律写「–」 | — | BOOK-WORKBENCH-SPEC |
| D9 | 选期矩阵月卡不放金额（悬停也不出） | — | BOOK-WORKBENCH-SPEC |
| D10 | 页底「ⓘ 单位：元 · 口径」说明行删掉：单位挪到表格工具条右端「单位：元」，口径公式挂到合计行（净利润行 / 总计行 / 合计行）名称上的悬停说明（`v-tip`），年份门那条并进副标题 | 横条盘点第二类，用户 10-03 选推荐 | LIST-PAGE-SPEC、PAGE-BEHAVIOR §2 |
| D11 | 计费参数长页拆成「左目录 + 右当前区」，按「对谁设」分六区；公摊池、楼栋损耗一对象一行 | S21-PARAM-CENTER-SPEC 版式 | S21-PARAM-CENTER-SPEC |
| D12 | 改参数卡 400 宽贴格弹出；「从哪个月起」只给三选：仅本月 / 自本月起用到更晚一版为止 / 原地更正当前生效那版；不能选任意月 | S21 原「起始月可选」 | S21-PARAM-CENTER-SPEC |
| D13 | 导入点下去后弹窗不关，内容区换进度卡；逐段导入（附表 10）画真进度，单次请求画「还在动」不写百分比；200ms 内结束不出卡 | 新增 | UI-OVERLAY-SPEC（导入弹窗节）、IMPORT-GUIDE |
| D14 | 导入中弹窗关不掉（× 悬停说明、遮罩和 Esc 不关、遮罩盖住页签条），关浏览器标签走浏览器自己的确认 | UI-OVERLAY §3.5 加一个例外 | UI-OVERLAY-SPEC |
| D15 | 逐段导入只有网络或 5xx 失败才给「从第 N 段接着导」；4xx（审核闸等）整单拒，主按钮「返回修改」 | 新增 | UI-OVERLAY-SPEC、IMPORT-GUIDE |

另两条接着 0.25.0 的：
- 楼栋 / 租户 / 账号三屏首次进屏名称列会挪一次（列宽按全部数据算，数据没到不知道多长）——**接受**，LAYOUT-STABILITY §7.1 记一条例外。
- 有编辑权的人浏览态也按编辑框宽度预留列宽——**保持**。

横条盘点里还挂着「要你定」的电表详情抽屉 897 行「旧数据只读」：**保留旧数据只读**，把整行横条改成抽屉标题旁的页面状态签「旧数据 · 只读」，悬停说明写原因并带重试（第 4 级）。

---

## 2. 稿 → 任务覆盖表（对着 `_shots-v35/` 逐块数）

「做」列写由哪个任务（§3）落地。「不做」写理由。

### 08 授权

| 画板 | 块（图上位置） | 做 |
|---|---|---|
| ElevChip | 顶栏右区 AI 图标与铃铛之间的蓝描边胶囊：钥匙 + mm:ss，28 高 | T1 |
| ElevChip | 贴胶囊右对齐弹出的 420 宽卡片：卡头「临时授权 / 剩余 mm:ss」；授权人（头像 + 名）、可修改（权限签 + 「所有页面都能改」）、时间（hh:mm 授权 → hh:mm 到期）；一句「期间的每一次修改，操作日志里都会同时记下你和{授权人}的名字。」；卡底两句 + 「结束授权」 | T1 |
| ElevChip | 页面不变暗；满宽条（App.vue `.app-elev`）删掉 | T1 |
| ElevChip-dark | 暗色只换令牌色 | T1 |
| ElevStates | 正常 | T1 |
| ElevStates | 最后 1 分钟：胶囊橙色 + 不自收回执「授权还剩 1 分钟」 | T1 |
| ElevStates | 到期：胶囊消失 + 回执「授权已到期，已退出编辑」 | T1 |
| ElevStates | 提前失效：回执「授权提前失效了，已退出编辑」 | T1 |
| ElevStates | 一份先到期：回执「「{权限名}」的授权已到期，已退出编辑」 | T1 |
| ElevStates | 点「完成」后：胶囊消失，不出回执 | T1 |
| ElevStates | 多份：胶囊尾部带份数；卡头「临时授权 · N 份 / 先到期的剩 mm:ss」；每份一行（权限签、授权人、hh:mm 到期、倒计时）；句子「哪一份到期，用到它的页面就退出编辑。」；卡底「N 份一起结束」+「结束授权」 | T1 |
| ElevStates | 结束前先问：确认框「结束授权？」正文给页名和处数，按钮「继续编辑」/「放弃改动并结束授权」（红） | T1 |
| ElevStates | 远程批准：授权人旁「远程批准」，时间行「hh:mm 批准 → hh:mm 到期」 | T1 |
| ElevStates | 最后 1 分钟卡片：钥匙和剩余时间变橙，卡底句「到期后，用到这份授权的页面会退出编辑」 | T1 |
| ElevStates | 弹窗开着时（系数簿 / 收款簿 / 催缴单明细）：弹窗标题旁挂同一枚胶囊；回执在遮罩之上 | T1 |
| ElevStates | 手机：胶囊只留钥匙（圆形），页名让位截断；最后 1 分钟钥匙变橙 + 回执；点钥匙卡片贴顶栏下占满宽，时间写在卡里；到期回执 | T1 |
| ElevNow | 现状对照 | 不做：对照板 |

### 09 三大报表

| 画板 | 块 | 做 |
|---|---|---|
| ReportIS | 期间条：「‹ 换期 2025-10」+ 公司下拉胶囊 + 竖线 + 报表步骤条（利润表—资产负债表—科目余额表—附表1–5—收入核对） | T2 |
| ReportIS | 公司下拉：全部汇总（N 家）、各公司（当前打勾）、底部「新增公司 / 重命名 / 删除（红）」，有 master:edit 才出底部 | T2 |
| ReportIS | 左栏 208 宽公司栏撤掉（三大报表） | T2 |
| ReportIS | 标题行右侧「导出 Excel / 交审 N 月 / 编辑模式」；四张 KPI 卡撤掉 | T2 |
| ReportIS | 卡头左「N 项」、右「单位：元」 | T2 |
| ReportIS | 表：项目 / 行次 / 本月金额（浅蓝底 + 加粗 + 表头下划线）/ 本年累计金额 / 填充列 | T2 |
| ReportIS | 带「其中」的父项是可收起的分组行：「营业税金及附加 其中 6 项」+ 折叠箭头；子项缩进 | T2 |
| ReportIS | 0 与空写「–」 | T2 |
| ReportIS | 净利润贴底，不透明底，负数红 | T2 |
| ReportBS | 一张 6 列表：资产 / 行次 / 期末余额 / 负债和所有者权益 / 行次 / 期末余额 / 填充列；按行成对排，短的一边空行补齐 | T2 |
| ReportBS | 组头行「流动资产 10 项 · 合计」带段合计金额与行次，可收起 | T2 |
| ReportBS | 存货「其中 4 项（明细，不另加进合计）」 | T2 |
| ReportBS | 负债合计 47 是小计行（上边线） | T2 |
| ReportBS | 贴底一行同时放「资产总计 30」与「负债和所有者权益（或股东权益）总计 53」 | T2 |
| ReportTB | 卡头：搜索「搜索科目代码 / 名称」+「17 / 127 项」+ 右「单位：元」 | T2 |
| ReportTB | 两层表头：科目代码、科目名称 / 期初余额·本期发生额·本年累计发生额·期末余额 各分借贷 | T2 |
| ReportTB | 期末余额两列浅蓝底，期末借方加粗；表头下划线 | T2 |
| ReportTB | 树：按实际深度缩进，父级「N 个下级」+ 折叠箭头，展开后子级显示 | T2 |
| ReportTB | 合计贴底 | T2 |
| ReportTB-dark | 暗色钱列底用令牌 col-key | T2 |
| ReportTB-1366 | 窄时固定列按先后退：钉「代码 + 名称」与「期末借方」，期末贷方原地变普通列；名称省略号；数字不截断 | T2 |
| ReportStates | 本月未录入：标题旁状态签「本月未录入」（橙点），只剩导出 + 编辑 | T2 |
| ReportStates | 资产≠负债+权益：标题旁红签「资产 ≠ 负债 + 权益 · 差 x」+ 贴底行就地标「● 多 x」 | T2 |
| ReportStates | 期末借贷不平：红签「期末借贷不平 · 差 x」+ 合计行就地标 | T2 |
| ReportStates | 加载失败：内容区 FPEmpty 错误态「{年} 年 {月} 月的利润表没读到 / 屏上不显示上一次读到的数字 / 重试」；编辑入口同宽禁用，悬停「本期没读到，不能编辑」 | T2 |
| ReportStates | 编辑中：标题旁「编辑中 · N 处改动」；右侧「导入 / ··· / 取消 / 保存」；勾选列 + 卡头「删除所选 (N)」；格子是输入框 | T2 |
| ReportStates | 科目余额表编辑中：「新增科目」在标题行 | T2 |
| ReportStates | 父项两种写法：「减：营业成本 2 个子类 · 自动合计」+ 子类输入行 | T2 |
| ReportStates | 全部汇总：标题旁「6 家合计 · 只读」，只剩「导出 Excel」 | T2 |
| ReportStates | 已审核：灰药丸「🔒 已审核 · 李审 10-28」 | T2 |
| ReportPickEmpty | 选期矩阵：标题「利润表 • [公司 ▾]」，下拉同上；副句；「+ 补更早年份」；年行 × 12 月卡（空卡虚线「–」，有数实底，当前描边）；「+ 添加 N 年」 | T2 |
| ReportPickEmpty | 月卡不写金额（D9） | T2 |
| ReportPickEmpty | 一家公司都没有：FPEmpty「还没有管理公司 / 利润表 按公司 × 年月分期 / + 新增公司」（有 master:edit 才出按钮） | T2 |
| ReportPickAmount | 四种放法对照（用户选 A，不放） | 不做：对照板，A 即 D9 |

### 10 计费参数

| 画板 | 块 | 做 |
|---|---|---|
| ParamBrowse | 标题行：「计费参数」+「本月电价 6/6」+「改动都已重算 · 生成于 …」签 + 全园/一期/二期/宿舍分段；右「无待处理 / 交审 N 月 / 编辑模式」 | T3 |
| ParamBrowse | 左目录卡：搜索「搜参数 / 池 / 栋 / 户」；「本月改动 N」；六区（全园与期级 / 公摊池 / 楼栋损耗 / 户级例外 / 光伏分栋判据 / 固定规则），带「改 n」与对象数 | T3 |
| ParamBrowse | 右当前区卡：区名 + 一句说明；表：参数 / 范围 / 本月值（key 列）/ 生效区间 / 来自 / 历史图标 | T3 |
| ParamBrowse | 组头行「每月核对 9 项 · 电价照抄供电局账单」「长期常数 12 项 · 改一次，管到下次改」可收起 | T3 |
| ParamBrowse | 生效区间徽标：「仅 2024-02」（橙）、「长期」（蓝）、「2024-02 起长期」；「未核对」；参数名旁「● 本月改」 | T3 |
| ParamBrowse | 说明 / 算式列撤掉，挪到参数名的悬停说明 | T3 |
| ParamEdit | 公摊池区：搜「池名 / 位置」+ 筛选「全部 / 有设置 / 本月改过」+ 右侧图例「[–] = 没单独设置」 | T3 |
| ParamEdit | 一池一行：池（位置灰 + 名字）/ 期 / 加减度数「按月」/ 手工用量「按月」/ 分摊基数（key）/ 附加金额 / 指定单价 / 小数位 / 历史 | T3 |
| ParamEdit | 编辑态空格子「+ 设置」虚线；标题行「完成」黑钮 | T3 |
| ParamEdit | 贴格 400 宽改值卡：标题 + 对象副句；值输入 + 单位 + 「当前 x」；「从哪个月起」三选（D12）+ 说明句；备注；底部红字「删除「… 起」这一版」/ 取消 / 保存 | T3 |
| ParamEdit | 深链落点五条（表格画在板下半） | T3 |
| ParamEdit | 1366 宽固定列先后：池 → 分摊基数 | T3 |
| ParamChanges | 本月改动表：时间 / 参数（含范围）/ 旧 → 新 / 谁（含「x 授权」）；「重算本月」行；筛选；点一行跳到那一项 | T3 |
| ParamChanges | 某项历史：居中卡，月份时间轴色段、版本列表（「本月在用」）、变更记录表 | T3 |
| ParamLoss | 楼栋损耗区：一栋一行，调整度数（key）/ 手工损耗率 / 损耗率加点 / 损耗核算方式 / 总表取数 / 损耗核算归组 / 供电局对账 / 不计入楼栋合计的表（签 + 「+」）/ 历史；没单独设写「默认」灰 | T3 |
| ParamTenant | 户级例外：按户分组（组头户名、期、项数，可收起），搜户名；行：参数 + 单位 + 本月改 / 值（key）/ 生效区间 / 覆盖了（「全园 0.16」或「（无默认值）」）/ 删除（编辑态）/ 历史；卡头右「+ 新增例外」「批量修改 → 系数簿」 | T3 |
| ParamMisc | 「复制上月电价」挂在每月核对组头右侧（编辑态） | T3 |
| ParamMisc | 光伏分栋判据表 | T3 |
| ParamMisc | 固定规则只读编号列表（原文照抄 ParamCenterView） | T3 |
| ParamLongNow | 现状对照 | 不做：对照板 |

### 11 导入等待

| 画板 | 块 | 做 |
|---|---|---|
| ImportSeg | 点导入后弹窗不关，内容区换进度卡：「正在导入 N 条」+ 文件名·段数；真进度条；「第 k 段 · 年月 · 期 · n 条」/「已写入 a / N 条」；步骤：读取文件 / 逐段写入 k/K 段 / 记下这次导入 / 刷新本页；底部取消、导入中…都禁用 | T5 |
| ImportOne | 单次请求：「正在导入 N 格」+ 公司·期；右「已用 m:ss」；不确定进度条（减少动态时呼吸）；「这一步一次写完，中途没有进度可看」；步骤列表；200ms 内结束不出卡 | T5 |
| ImportDone | 同一张卡原地变结果：标题「导入完成」+「用时 · 本期已刷新」；两格统计（成功写入 / 跳过）；分公司明细；有跳过时「n 条提示」「n 行未导入」两段可展开；从导入中心来的多「去查看」；「知道了」 | T5 |
| ImportFail | 逐段失败（网络 / 5xx）：「第 k 段没导进去」+ 已写入说明 + 红框段信息与原因 + 红进度 + 段列表；「关闭」/「从第 k 段接着导」 | T5 |
| ImportFail | 4xx 整单拒：「导入失败，这次一格都没写进去」+ 红框原因 +「本期还是导入前的数据。」；「关闭」/「返回修改」；新建公司数 > 0 时多一句「新建的 N 家公司已留下」 | T5 |
| ImportBusyClose | 导入中 × 不响应、悬停「导入完成前不能关闭」；遮罩、Esc 不关；遮罩盖住页签条；beforeunload 确认 | T5 |

### 横条盘点（第一类 + 第二类）

| 位置 | 做 |
|---|---|
| App.vue:117 授权条 | T1 |
| DataHomeView:566 blockers 两条 → 「待处理」入口 | T4 |
| DataHomeView:471 主管「待批授权」行 → 撤掉（与铃铛重复），在编辑者收成标题行胶囊 | T4 |
| DataHomeView:481 审核员「待审核」行 → 标题行筛选胶囊 +「本月已审 a/b」计数 | T4 |
| MeterView:1004 / 1010 S/M 档两条 → 状态签 / 段内入口 | T4 |
| 手机档「编辑模式 · 小屏可录入…」：IncomeStatementView:439、TrialBalanceView:462 → T2；LedgerView:821、PnlScheduleView:470、SalaryView:375 → T4；S10View:738 → T5 | 见左 |
| ImportCenterView:251 假拖放区 → 并进副句 | T5 |
| PoolLedgerView:1439 名单变动块 → 名单行就地「新在租 / 已退租」；:1432 园区自担 → FPEmpty sm | T4 |
| ExportNoticeWindow:170 → 公司账户下拉旁就地「不印」 | T4 |
| MeterAssignDialog:88 → 选项副句 | T4 |
| MeterDetailDrawer:531 / 818 → 字段 / 按钮旁；:840 补 32px 预留；:897 → 标题旁「旧数据 · 只读」 | T4 |
| ReconWorkbench:233 → 标题旁状态签，按钮挪标题行右端，删重复说明句 | T2 |
| FpImportModal:290 / 314、ImportSummary:126 / 100 → 并进预览卡头 / 表头 | T5 |
| FinDialogs:104 → 并进副标题 | T2 |
| FPTenantIssuePanel:66 → 卡内「编辑模式下可绑定」 | T4 |
| FinCashflowView:314 → 并进 fin-modal-sub | T4 |
| TemplateEditorPanel:432 → 并进副句 | T4 |
| ReportsHomeView:149 → 标题旁状态签 + 说明并进副句 | T2 |
| CoefBookWindow:424 / PayBookWindow:287 编辑态批量条 → 替换表格工具条，不加行 | T1（这两个弹窗 T1 要挂胶囊） |
| CockpitView:551、ContractDrawer:350 → 补 32px 预留 | T4 |
| 第二类 ⓘ 页底说明行：IS:455 / BS:488 / TB:490 → T2；LedgerWideTable:545、PnlScheduleView:489、SchedYearGate:141 → T4 | 见左 |

---

## 3. 任务与文件归属

同一文件只归一个任务。别人的文件不碰；需要别人改的，写进返回值。

| 任务 | 管什么 | 独占文件（含同目录 `__tests__`） | 规范 |
|---|---|---|---|
| T1 授权 | 08 全部；系数簿 / 收款簿批量条 | App.vue、components/shell/{Toolbar,AppShell}.vue、shell/mobile/*、stores/auth.ts、stores/presence.ts、新 components/fp/FPElevChip.vue、views/bills/{CoefBookWindow,PayBookWindow}.vue、views/bills/BillNoticesView.vue（只动明细弹窗头）、utils/receipt.ts（如需不自收 warn） | ELEVATION-SPEC、EDIT-MODE §6 |
| T2 三大报表 | 09 全部；报表区横条 | views/reports/{income-statement,balance-sheet,trial-balance,home,recon}/**、components/fin/**、components/fp/BookMonthMatrix.vue | BOOK-WORKBENCH-SPEC |
| T3 计费参数 | 10 全部 | views/params/**、后端 param 相关 controller/service/test | S21-PARAM-CENTER-SPEC |
| T4 横条收尾 | 横条清单 T4 行；第二类台账 / 附表 | views/data-home/**、views/meters/**、views/ledger/{LedgerView,LedgerWideTable}.vue、views/reports/pnl/**、views/salary/**、components/sched/**、views/alloc/PoolLedgerView.vue、views/bills/ExportNoticeWindow.vue、components/fp/{FPTenantIssuePanel,TemplateEditorPanel}.vue、views/analysis/{FinCashflowView,CockpitView}.vue、views/contracts/ContractDrawer.vue | LIST-PAGE-SPEC、PAGE-BEHAVIOR §2、LAYOUT-STABILITY §7.1 |
| T5 导入（第一段） | 11 全部的共享件；附表 10 逐段与接着导；自己名下的导入入口 | components/import/**、新进度卡组件、views/sales-income/**、views/import-center/**、Charging/CpMeter/Contracts/ElecCost/Elec/PvMeter/Pv/Utilities 各 View 的导入处理段、后端附表 10 导入 | UI-OVERLAY-SPEC、IMPORT-GUIDE |
| T5b 导入（第二段） | T1–T4 收工后，把进度卡接到 T2 / T4 名下的导入入口（useFinStatementScreen、MeterView、LedgerView、PnlScheduleView、SalaryView） | 只动这些文件的导入处理段 | — |

T4 改 SchedYearGate 只改组件内部，不动它的 5 个调用方（调用方归 T5）。

---

## 4. 这次不做

- 稿没画的：三大报表的手机 / 平板档（沿用现有响应式）；台账、附表 1–5、附表 10 的公司左栏（D5 只管三大报表，两边暂时不一致）；计费参数编辑态的「新增例外」表单内容、光伏判据和固定规则的编辑；导入「解析阶段」（选文件到点导入之间）。
- 对照板：ElevNow、ReportPickAmount、ParamLongNow。
- 横条第三类（分析结论句、弹窗正文、合规块内提示、图例、合计行）不动，只给 CockpitView:551、ContractDrawer:350 补预留。

---

## 5. 门禁与验收判据

- `npm run typecheck` 0 错误；vitest 全量只在收口跑一次，按 JSON 产物数（失败 0、文件数不少于改前）；`npm run build` 成功；动了后端的跑对应 `mvn -q test -Dtest=…`。
- 新断言逐条做破坏验证（改坏实现 → 红 → 改回）。
- 屏上不许出现：满宽提示条、ⓘ、「设计稿」三个字、截断的数字。
- 对抗复查在验收之前：正确性、规范与版式稳定、屏上文案、对稿覆盖四面。
- 收口在 1920 与 1366 下实际打开截图核对。
