# 日期选择器 · KPI 卡 · 暗色模式 · 实现计划（2026-09-19）

规范：`docs/design/DATE-PICKER-SPEC.md`、`docs/design/KPI-CARD-SPEC.md`、`docs/design/DARK-MODE-SPEC.md`。
设计稿：`../运维文档/设计稿/未实现/日期选择器与KPI卡-2026-09-19/`、`../运维文档/设计稿/未实现/暗色模式-2026-09-19/`。**图是规格**；像素值 / 色值以各自 `gen-画板生成脚本.mjs` 的 CSS 与令牌表为准。
分支 `jfen/picker-kpi-dark`（从 origin/master 8a4d92d）。一个 PR，一个版本 0.15.0（功能更新：暗色模式；改进：日期选择器、KPI 卡）。

## 0. 怎么做

- **一个工作流**，勘察已做完（盘点 + 覆盖清单），工作流里是 落地 → 对抗复查 → 修 → 照稿 / 文案复查；验收我自己做。与 `subagent-driven-development` 技能「每任务一轮」的结构冲突，按 `one-workflow-per-thing` 走：不按任务切工作流。
- **文件按人分，不交叉**：第一批三人并行，各自只改自己名下的文件（§2 每个任务写了文件）；第二批（收字面量）在第一批完成后才开始，按目录分三份。
- 令牌（`tokens.css` 浅色新令牌 + 整个暗色块）**已由我先写好**，所有人只引用、不改 tokens.css（要加令牌就在回报里提，由我加）。
- 过程中只跑相关 spec（`npx vitest run <files> --reporter=json --outputFile=…`，读 JSON 判绿）；`npm run typecheck`，不用 `npx vue-tsc`。每条新断言做破坏验证。全量、typecheck、build、浏览器截图留到收口我各跑一次。跑过全量后还原 `anaSkeletonParity.spec.ts.snap`（除非本次 KPI 高度变化就是它该变的，届时逐条核对）。
- 不碰不是我的未跟踪文件：`backend/src/test/java/com/park/demo3/arch/ControllerLayerTest.java`、`docs/design/SCAFFOLD.md`、`frontend/src/api/__tests__/axiosBoundary.spec.ts`。

## 1. 稿 → 任务覆盖表（对着截图逐块数，2026-09-19 覆盖清单 253 块）

标注（标题、说明段、数据表、色值表）与对照（现状截图、参考图、未选方案）不是界面，**不做**：稿 1 的 #1–8、11–16、24–30、32–34、66、69–71、83–85、94、97、99、115–119、121–122、124–125、129；稿 2 的 #130–132、136–139、141–170、172–174、189–194、215–219、225、227–228、233–234、247–249、251、253。其中 #116「其余 8 种归类表」、#148–150「实现量」的内容进规范（KPI-CARD-SPEC §5、DARK-MODE-SPEC §4）。

| # | 稿 · 画板 · 位置 | 块 | 任务 |
|---|---|---|---|
| 9, 35 | 稿1 Main③ / Picker① | 单日面板：可打字值行、今天 / 上次选的、‹ 月 ›、周一开头、固定 6 行、19 今天 + 选中 | T1 |
| 10, 36 | Main③ / Picker① | 区间面板：首尾实底、中段连条 | T1 |
| 37 | Picker① | 月份面板 3×4、本月点、选中 | T1 |
| 38 | Picker① | 年份面板 12 年一页 | T1 |
| 39–47 | Picker② | 格子 10 种状态（默认 / 悬停 / 今天 / 选中 / 今天且选中 / 非本月 / 不可选 / 区间首尾 / 中段折行 / 悬停预览圈） | T1 |
| 48–51 | Picker③ | 边界：下限、只点了起点、数据只到 8 月（9–12 灰）、年份无数据 | T1 |
| 52–55 | Picker④ | 打字行 4 态：空 / 输入中 / 已填 / 打错（红） | T1 |
| 56–65 | Picker⑤ | 触发器：字段 6 态（空 / 有值 / 悬停 / 打开 / 出错 / 禁用）、筛选胶囊（空 / 有值带 × / 区间）、行内格 | T1 |
| 67–68 | Picker⑦ | 手机底部面板：新增合同开始日期、经营驾驶舱月份 | T1 |
| 72–73 | PickerInPlace① | 合同弹窗 开始 / 结束 / 签订日期；免租期起止合成区间字段；附表11 开票日期（面板右对齐） | T2 |
| 74 | PickerInPlace① | 免租期区间下限 = 合同开始日 | T2 |
| 75 | PickerInPlace② | 分桩 / 分栋运营账抄表行内日期格（只开当月、`09/14`） | T2 |
| 76 | PickerInPlace③ | 合同管理「按某天查看」chip（选了日期后「含历史续签」隐藏） | T2 |
| 77 | PickerInPlace③ | 操作日志 起–止 区间 chip | T2 |
| 78–79 | PickerInPlace④ | 新增租户「入驻年月」；表详情停用 / 退场 / 启用账期（行内）、抄表行月份；导入弹窗账期补录条 | T2 |
| 80–81 | PickerInPlace⑥ | 年下拉 + 月下拉 → 一个月份字段（7 处记账抽屉 + 其余 4 处）；报表中心、导入中心年份控件一起合并 | T4 |
| 82, 198 | PickerInPlace⑤ / 稿2 Analysis | 分析屏期间条：段控 + 期间字段 + ‹ ›（按月 / 按年）；只按年 4 屏 = 标签 + 年份字段 120 + ‹ › | T3 |
| 17–23, 95–96 | Main④ / KpiA② | 分析屏小卡 7 张，sky / slate 交替，无趋势线，1440 与 1366 两宽 | T5 |
| 86–93 | KpiA① | 列表大卡：楼栋管理左栏 4 张、利润表顶部 4 列（slate / blue / sky / cyan，右上图标，净利润负数红） | T5 |
| 98 | KpiA③ | 楼栋详情抽屉小卡 3 列 7 张（3 张带底色） | T5 |
| 100–104 | KpiA④ | 小卡 5 态：加载 / 负数红 / 只有说明 / 警示说明 / 数字太长降 16 | T5 |
| 105–110 | KpiA④ | 大卡 6 态：加载 / 有涨跌 / 成本反转 / 负数 / 太长降 20 / 警示说明 | T5 |
| 111–114 | KpiA④ | 抽屉小卡：加载（有底 / 无底）、本月结余负红 / 正橙 | T5 |
| 31, 120 | Main⑤ / KpiFormula① | 利润公式条 A：每数一格浅底、运算符、尾注换行靠右 | T6 |
| 123 | KpiFormula② | 杜邦 A：ROE 大格 + 三因子各一格浅底 | T6 |
| 126–128 | KpiFormula③ | 收入核对平衡条 A：已配平 / 有差额 / 缺记 | T6 |
| 135, 252 | 稿2 Main① / Mobile | 手机导航抽屉「外观」段控（版本更新上一行，高 44） | T7 |
| 133–134 | 稿2 Main① | 账号菜单「外观」一行，浅色 / 深色 / 跟随系统（图是规格，现状并没有这一行） | T7 |
| 140 | 稿2 Main② | 已选 ② 中性深灰整套底色 | T0（已做） |
| 171 | Tokens 底部 | 语义色在暗底上的样子（红绿橙蓝黄） | T0（已做） |
| 175–178 | Shell | 暗色外壳：图标栏（当前项亮底深字）、侧栏、页签条、顶栏（头像身份色压暗）、页头按钮反转 | T8 + T10 |
| 179–182, 220–221 | Shell / Kpi① | 暗色 KPI 大卡（同色相压暗） | T5（令牌 T0） |
| 183 | Shell | 期区胶囊，没选中的数量 `--text-muted` | T8 |
| 184–185 | Shell | 段控、搜索框（`--border-control`）、状态下拉展开（浮层 `--surface-raised`） | T8 |
| 186–188 | Shell | 表格（行高 56、悬停、出租率条按语义色）、分页钮边框 `--border-control` | T8 + T10 |
| 195–197 | Analysis | 分析屏外壳暗色 | T8 + T10 |
| 199–205, 222 | Analysis / Kpi② | 暗色分析屏小卡 7 张 | T5（令牌 T0） |
| 206–214 | Analysis | 暗色图表：柱 / 折线 / 面积、坐标、图例、悬停提示框 `--tip-bg`、标注气泡 | T9 |
| 223–224 | Kpi③④ | 暗色抽屉小卡、公式条 | T5 T6（令牌 T0） |
| 226 | Kpi⑤ | 四个 accent 暗底 | T0（已做） |
| 229–232 | Components① | 暗色日期面板四种（选中亮底深字） | T1 |
| 235 | Components② | 弹窗 + 遮罩 `--scrim`、`--shadow-dialog` | T8 |
| 236 | Components② | 抽屉 | T8 |
| 237 | Components③ | 按钮 4 种 × 3 态（实底反转、危险按钮字 `--control-solid-text`、描边 `--border-control`） | T8 |
| 238 | Components③ | 段控（选中格 `--surface-raised`）、期区胶囊、外观段控 | T8 T7 |
| 239 | Components④ | 输入框 4 态 | T8 |
| 240 | Components⑤ | 提示条 4 种（红与全站统一）+ 刷新条（按钮白边 45%） | T8 |
| 241 | Components⑤ | 橙色警示条 `--warn-bg` / `--warn-text`、编辑中胶囊 | T8 + T10 |
| 242 | Components⑥ | 徽标与状态点（青挪到 200°、已续签灰蓝） | T8（令牌 T0） |
| 243 | Components⑦ | 骨架微光 `.fp-shim` 两端 `--ink-040` | T8 |
| 244 | Components⑧ | 滚动条 35% 白 | T8（令牌 T0） |
| 245 | Components⑧ | 编辑模式按钮四态（空闲边 `--border-control-strong`）、编辑行 | T8 |
| 246 | Components⑨ | 命令面板（选中行 `--row-selected`） | T8 |
| 250 | Mobile | 暗色手机首页 | T8 + T10 |

稿上没画、规范里补的最小项：「上次选的」的存法；外观的首帧脚本与按账号存法；字面量门与令牌对比度检查。

## 2. 任务

**T0 令牌（已做）**：`tokens.css` 加 15 个浅色新令牌 + `:root[data-theme="dark"]` 整块，值取自暗色稿 `darkOf(DIRS.d2)`。

**第一批（并行，文件不交叉）**

**T1–T4 日期选择器**（一人）——文件：新建 `components/ds/DatePicker.vue`（+ 必要的小文件放同目录）及其 spec；DATE-PICKER-SPEC §5 表里列的全部视图文件；`views/analysis/AnaShell.vue`（期间条，以及 `.anx-kpis` 最小高 109 → 120 这一行，替 T5 改）。
- T1 组件本体：四种面板、四种触发器、打字解析、键盘、min/max、快捷（含「上次选的」）、手机底部面板、暗色（全用令牌；选中字 `--control-solid-text`）。spec 覆盖：选中 / 区间 / 月份 / 年份回写格式、min/max 不可点、打错不改值、Esc 只关自己、点外面关、上次选的读写与越界隐藏、固定 6 行。
- T2 原生框 20 处；T3 AnaShell 期间条 11 屏；T4 年月下拉对 11 处 + 报表中心 / 导入中心年份控件。**逐处核对值、事件、min/max、禁用条件不变**，相关视图已有的 spec 要仍然过（找出引用这些视图 / 选择器的 spec 一起跑）。

**T5–T6 KPI 卡**（一人）——文件：`components/ds/KpiCard.vue`、`components/ana/AnaKpiTile.vue`、`components/fp/FPStat.vue`；AnaKpiTile 的 19 个调用视图（删 `trend`）；`views/ledger/LedgerTenantDrawer.vue`；`views/reports/income-statement|balance-sheet|trial-balance/*View.vue`（`.fin-kval`）；`views/buildings|tenants|system/*View.vue` 的 kpirail 覆盖；`views/buildings/BuildingDrawer.vue`、`views/tenants/TenantDrawer.vue`、`views/bills/BillNoticesView.vue`；`views/analysis/FinPnlView.vue`、`FinBalanceView.vue`、`views/reports/recon/ReconWorkbench.vue`；相关 spec 与骨架（`AnaShell` 占位小卡由 T3 那人改高度，你只需保证占位与真卡同高）。
- T5 三组件照 KPI-CARD-SPEC §3；T6 算式类照 §4。spec：tint 位置顺序、无趋势线、利润类负数红 / 收入不红、成本反转、说明行不带箭头、固定两行高、加载时盒子同高。

**T7–T9、T11–T12 暗色外壳**（一人）——文件：新建 `stores/appearance.ts` + spec；`index.html`（首帧脚本）；`components/shell/*`（IconRail 账号菜单「外观」行、Toolbar、TabStrip、SidebarPanel、AppShell、CommandPalette、ChangelogDialog、WhatsNewDialog、mobile/*）；`components/ds/*`（**除** DatePicker、KpiCard）；`components/fp/FPToast.vue`、`FPPhaseTabs.vue`、`FPEditModeButton.vue`、`FPDrawer.vue`、`FPSideDrawer.vue`、`FPTakeoverDrawer.vue`、`FPEvictedDialog.vue`、`FPLockDialogs.vue`、`FPPresenceBar.vue`；`styles/base.css`、`styles/scrollbar.css`、`styles/mx-list.css`；`components/ana/anaTheme.ts`、`AnaEChart.vue`、`chartTip.ts`；新建 `src/__tests__/tokens.spec.ts`、字面量门 spec；DS skill 令牌镜像 `~/.claude/skills/factory-park-design/tokens/*.css`。
- T7 外观开关（DARK-MODE-SPEC §3）。T8 共用组件暗色（§4 实底上的字 / 控件边框 / 段控 / 骨架 / §5 全部）。T9 图表两套主题 + 切换重建（§6）。T11 `tokens.spec` 与字面量门（§7，字面量门先按收完之后的目标写，基线数由第二批收完后我定）。T12 镜像同步。

**第二批（第一批全部完成后，并行）**

**T10 收字面量**（三人，按目录分；DARK-MODE-SPEC §4 的规则与白名单）：
- A：`views/analysis/**`、`components/ana/**`（anaTheme.ts 除外）
- B：`components/**` 其余（shell、fp、sched、ds、import、fin）、`styles/*`（tokens.css 除外）、`App.vue`
- C：`views/**` 其余（`views/analysis` 与 `LoginView.vue` 除外；`bills/Export*Window.vue` 白名单）
每处换成浅色值相同的令牌；没有同值令牌又反复出现的，在回报里提议新令牌（名字、浅色值、暗色值建议），不自己改 tokens.css。回报：换了多少处、剩下哪些（文件:行 + 理由）。

**T13 更新公告 0.15.0**（我，收口时）：照 RELEASE-NOTES-SPEC，功能更新（弹）；feature = 暗色模式（配图 `Art0150.vue`）；改进 = 日期选择器、KPI 卡。

## 3. 复查与验收

1. 对抗复查两路（第二批之后）：(a) 选择器 + KPI —— 专找行为变了而没断言的：值格式、min/max、禁用、事件时机、键盘、骨架同高、利润红规则的调用点；(b) 暗色 —— 浅色外观有没有被改动（字面量换令牌时浅色值不同）、漏收的白块黑字、首帧闪、跟随系统、图表切换、对比度。
2. 修一轮（一人）。
3. 收口前：`mockup-coverage-check` 对着 §1 表数屏上落点；`screen-copy-adversary` 过新上屏的字（外观 / 浅色 / 深色 / 跟随系统、今天 / 上次选的 / 本月 / 上个月 / 今年 / 去年、打错提示）。
4. 我：全量 vitest（JSON）、typecheck、build 各一次；浏览器截图浅色 / 暗色（登录由用户自己来）；T13；推送、开 PR。
