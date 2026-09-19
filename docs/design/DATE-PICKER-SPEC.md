# 日期选择器规范（DATE-PICKER-SPEC）

2026-09-19 定稿。设计稿：`../运维文档/设计稿/未实现/日期选择器与KPI卡-2026-09-19/`，线上画布 https://claude.ai/artifact/BBoUHJc2Jk5bZEM9kBxVuU。
画板 **Picker**（组件本身）、**PickerInPlace**（放在哪）。**图是规格**，本文是它的摘要；像素值以生成脚本
`gen-画板生成脚本.mjs` 里 `.dp*` 一族 CSS 为准，不一致以图为准（`mockup-is-the-spec`）。

## 1. 为什么

全站 20 处系统原生日期 / 月份框打开的是操作系统弹窗（样式不可控、按浏览器语言显示、暗色下不跟），
分析屏期间条和各记账抽屉用「年下拉 + 月下拉」两个控件拼一个月份。统一成一个组件。

## 2. 用户拍板（2026-09-19）

| # | 定了什么 |
|---|---|
| D1 | 范围 = 20 处原生框 + 11 处分析屏期间条 + 11 处年月下拉对；**另加报表中心、导入中心 2 处年份控件**，和旁边的月下拉合成一个月份字段（稿上待定项，用户「按推荐来」）。整页的选期矩阵 / 年卡入口不动 |
| D2 | 选中 = `--hue-blue` 实底白字 600（4.83:1）；区间中段 `--accent-blue`。参考图的淡紫不用 |
| D3 | 设计师定、用户认可的：日历固定 6 行（翻月面板不变高）；表格行内日期格只写 `09/14`（96 宽放不下整串）；「上次选的」= 同一字段上一次选定的值 |

## 3. 组件

`frontend/src/components/ds/DatePicker.vue`，一个组件四种面板：

| mode | 值（v-model，字符串，与原生框相同格式） | 面板 |
|---|---|---|
| `date` | `YYYY-MM-DD` | 月历 7×6 |
| `range` | `[from, to]`，两个 `YYYY-MM-DD` | 月历 7×6，首尾实底、中段连成一条 |
| `month` | `YYYY-MM` | 12 个月 3×4 |
| `year` | `YYYY` | 12 年一页 3×4 |

其余入参：`min` / `max`（超出的格不可点、快捷变灰）、`variant`（触发器样式，§5）、`clearable`、`placeholder`、
`fieldId`（「上次选的」按它记）、`short`（行内格只写月/日）、`hasData?(v)`（月份/年份面板里没数据的格变灰，仍可点与否由调用方定）、`disabled`、`invalid`、`aria-label`。

### 3.1 面板（画板 Picker 第 1–3 节）

- 外壳：宽 304、白底（暗色 `--surface-raised`）、1px `--border-subtle`、圆角 12、`--shadow-pop`。
- 第一行 = **可以直接打字的值**，44 高、mono 15：`2026 / 09 / 19`，斜杠淡色；区间写 `起 – 止`，止没选时淡色占位。回车 / 失焦解析，解析不了标红（`--delta-down-text` 字 + 红底线），不改值。
- 第二行 44 高：左边快捷胶囊（24 高、`--surface-sunken` 底、12 号）——单日 / 区间「今天」「上次选的」，月份「本月」「上个月」，年份「今年」「去年」；超出 min/max 的快捷变灰。右边 ‹ 标题 › 翻页（28 方钮）。
- 星期行：**周一开头**，写 一 二 三 四 五 六 日，12 号 `--text-muted`。
- 日格 40×34；**固定 6 行**。
- 格子状态（画板 Picker 第 2 节 10 种）：默认 `--text-primary`；悬停 `--bg-hover`；今天 = 数字下 4px 蓝点；选中 = `--hue-blue` 实底白字 600；今天且选中 = 点变白；非本月 `--text-muted`，可点，点了翻到那个月；不可选 `--text-disabled`，不响应悬停；区间首尾实底、中段 `--accent-blue` 连成一条，行首行尾收圆角；已选起点时悬停处画 2px 蓝圈预览。
- 月份 / 年份面板：3×4，格 52 高；本月 / 今年一个蓝点；没数据的格 `--text-disabled`。

### 3.2 行为

- 点触发器开；再点、点外面（capture 阶段）、Esc 关，**Esc 只关自己**（UI-OVERLAY-SPEC）。
- 面板贴在触发器下方 6px、左对齐；靠右边放不下时右对齐（如附表11 抽屉开票日期）；下面放不下时翻到上面。层级 `--z-popover`。
- 键盘：方向键移一格，PageUp / PageDown 翻月（月份面板翻年），Enter 选中，Esc 关。
- 选中即关、回写值；区间选完止才关。区间只点了起点就点外面 / Tab 出去 = 放弃这一半，原值不动（不回写 `[起, '']`）。选了和现在一样的值不发事件（同原生框）。清除（×）只在 `clearable` 时出；触屏（`hover: none`）上常驻，不等悬停。
- 面板里的回车：焦点在「今天」/ 翻页钮 / 关闭这类按钮上时交给按钮自己；在打字行上才是「选中键盘所在的格」。宿主的 `title` 只落在触发器上。
- 「上次选的」：选定时写 `localStorage["fp-dp-last:<账号>:<fieldId>"]`；没有值或超出 min/max 就不出这颗。读写包 try/catch。
- 手机（≤600）：面板改为从底部升起的面板，点按区 ≥44（日格 44 高、月格 52、翻页钮 44、快捷胶囊 44）。

## 4. 触发器（画板 Picker 第 4 节、PickerInPlace）

| variant | 用在 | 样子 |
|---|---|---|
| `field` | 弹窗 / 抽屉里的表单字段 | 36 高、圆角 12（抽屉里 8，照原字段）、1px `--border-control`、右侧日历图标；值 mono；聚焦 / 打开 `--hue-blue` 边；出错 `--hue-red` 边 |
| `cell` | 抽屉表格行内（抄表行） | 30 高、圆角 8、12 号；`short` 时只写 `09/14` |
| `chip` | 工具条筛选 | 34 高、圆角 12、左侧图标 15、有值时蓝边蓝字 + × 清除 |
| `inline` | 表详情抽屉的账期行内编辑 | 32 高、右对齐 mono 14 |

字段宽度、文字、位置照原处不变（PickerInPlace 各节写了每处的宽）。

## 5. 放在哪（44 处，PickerInPlace 第 1–6 节）

| 节 | 原来 | 现在 | 文件 |
|---|---|---|---|
| 1 表单字段 | 原生 date ×6 | `date` field；免租期起止合成一个 `range` field（下限 = 合同开始日，上限 = 结束日） | ContractNewDialog（开始 / 结束 / 签订 / 免租起止）、ElecRecordDrawer（开票日期） |
| 2 抽屉表格行内 | 原生 date ×4（min/max = 当月） | `date` cell，`short`，只开当月、翻页钮灰 | CpMeterView、PvMeterView |
| 3 工具条 chip | 原生 date ×3 | 合同管理「按某天查看」`date` chip（选了日期后「含历史续签」照旧隐藏）；操作日志起–止合成一个 `range` chip | ContractsView、SystemLogsView |
| 4 月份字段 | 原生 month ×7 | `month` field / cell / inline | TenantNewDialog（入驻年月）、MeterDetailDrawer（停用 / 退场 / 启用账期 inline、抄表行 cell）、FpImportModal（账期补录条） |
| 5 分析屏期间条 | 按月/按年段控 + 年下拉 + 月下拉 + 两箭头（11 屏） | 段控 + **一个期间字段**（按月 → `month` 面板，按年 → `year` 面板）+ ‹ ›；只按年的 4 屏（电费成本分析、预算对比、利润表分析、损益附表分析）= 期间标签 + `year` 字段 120 宽 + ‹ › | views/analysis/AnaShell.vue |
| 6 年月下拉对 | ds/Select 年 + 月 ×11 | 一个 `month` field | CoefBookWindow、ElecRecordDrawer、ChargingRecordDrawer、PvRecordDrawer（×2）、SalaryRecordDrawer、UtilitiesRecordDrawer（×2）、ChargingAnalysisView（年，`year`）、ReportsHomeView、ImportCenterView |

报表中心（ReportsHomeView 年份步进 + 月下拉）、导入中心（ImportCenterView 年数字框 + 月下拉）：合成一个 `month` field（D1）。

值、事件、min/max、禁用条件与原来**逐处一致**：只换控件，不改谁能选什么。

## 6. 不做

- 带时刻的两种（参考图里有，产品没有选时刻的地方）。
- 选期矩阵 15 处、年卡入口 5 处、月份胶囊 1 处、核对屏月卡 1 处、手输年月 3 处里的导入汇总逐段年月、年卡「新增年份」2 处、26 个「换期」返回按钮。
