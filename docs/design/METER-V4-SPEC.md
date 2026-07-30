# 园区抄表 v4（METER-V4-SPEC）— 页面推翻重做

> 定稿 2026-07-27（用户拍板：页面含版式与表格摆放整体推翻重做）。取代 METER-SPEC §6/§7 的页面章节；
> **数据模型/后端 11 端点/导入链/三组纯函数（meterSplit/meterGroup/meterLogic）全部保留不动**（1134 块表真实数据 + spec 锁定资产）。
> S2 新能力（绑定/待核/门禁）以本页为 UI 载体，契约见 S2-BIND-SPEC。

## 0. v3 的痛点清单（本次要消灭的）

1139 行单文件；月度段 15 列原始行至码直排（校对视图当工作视图）；一表一抽屉录入 4 击 11 框；月度段无搜索；全量 DOM 无分页；待核只能肉眼找；meterType 全链路存在但无列；≥10 处原生 alert 杂音（commitFactor 每存必弹）。

## 1. 页面骨架（LIST-PAGE-SPEC + EDIT-MODE-SPEC v2 全部铁律适用）

标题行（h2「园区抄表」+ 副标题「抄表 · 表档案 · 派生绑定」）→ `.mx-toolbar`：
左=FPPhaseTabs 三段【月度抄表】【表档案】【绑定就绪】；
右=.mx-toolbar-right：**全局搜索**（三段共用，匹配 租户名/原文/方位/表名称/编码）→ 电/水 Segmented → 分区 Select(全部/一期/二期/宿舍) → 年月 Select(仅月度段) → 导入/模板/导出（现有三按钮，导入收编辑态）→「编辑模式/完成」。
组件拆分：MeterView.vue(壳,<300行) + panels/MonthlyPanel.vue + panels/RosterPanel.vue + panels/BindingPanel.vue + ReadingDrawer.vue + composables/useMeterFilters.ts（搜索/过滤共享）。KeepAlive 记忆段与过滤；onDeactivated 复位编辑态。

## 2. 月度抄表段（保留 v3 分组区块，收敛列 + 就地录入）

- 分组区块/汇总行/损耗行/徽标三件套照搬（meterGroup/meterLogic 不动）；**区块默认折叠**，仅第一个展开（搜索命中时自动展开命中区块）。
- **默认 7 列**：租户｜表名称(subName)｜倍率｜上月总｜本月总｜用量｜状态。TOU 明细不再直排——用量列 hover tooltip 显四段；工具栏加「原始行至」开关切回 15 列校对视图（列定义复用，勿删）。
- **就地批量录入（编辑态，替代 4 击 11 框）**：本月总列变行内 input（@change 即时写回：该表该月无读数则 POST 新建、有则 PUT），TOU 表在行展开条内给四段输入。上月行至只读（上月读数或档案基准）。抽屉降级为**历史查看+补历史月**（点行仍可开）。
- 倍率快照语义：行内 title 提示，删除 commitFactor 的每存必弹 alert。

## 3. 表档案段（平铺分页，恢复 LIST-PAGE 标准形态）

- **useFitRows + FPPager 分页**（v3 全量 DOM 废除；56px 行高/列宽铁律）。
- 列（11）：期数｜楼栋｜方位｜租户｜归属｜**表类型(device_type)**｜表名称｜编码｜倍率｜**绑定合同**｜读数条数。
- 行内编辑（编辑态，沿用乐观更新+回滚）：楼栋/租户 FPTenantPicker/归属/表名称/倍率（现有5项）+ device_type Select(单相/三相/多功能/需量/双向/未录) + 绑定合同（点开 popover：显自动归属结果与候选，选定=PUT /bind 写 override，可解绑）。
- 归属 chips 保留并加**「待核 N」chip**（一键过滤 pending 表）。

## 4. 绑定就绪段（新增，S2 工作台=归属覆盖率报表落地）

数据源=GET /api/meters/binding?ym（选定月）。
- 顶部**收敛指标卡行**（6 张紧凑卡）：自动归属(auto+auto_bld)｜人工绑定(override,含 stale 警示)｜待处理(manual)｜待核(pending)｜占位槽(placeholder)｜漏抄。
- 主体=**待办队列表**（只列非绿状态行，分页）：表（期/栋/名称）｜租户｜状态桶 Badge（date_missing/ambiguous/bld_mismatch/no_contract/pending/stale）｜候选/原因｜操作列（编辑态）：
  - `pending` → 行内 FPTenantPicker 挂租户；
  - `date_missing` 且候选唯一 → **「确认绑定」一键**（写 override）；
  - `ambiguous`/`bld_mismatch` → 候选合同 Select 选定绑定；
  - `no_contract` → 只读提示（补合同是业务动作）。
- 工具栏侧（编辑态）：「按名精确匹配一键挂」按钮（POST auto-link-by-name，confirm 带预估数）。
- 空态=全绿时显「该月派生就绪 ✓」结论条。

## 5. 交付与验收

前端：新 4 组件+composable、旧 MeterView 拆解迁移、meter api 扩 binding/bind/autoLink/usageSummary 四方法、device_type/绑定列、原始行至开关、就地录入；vitest：分组/过滤 composable 与绑定队列组装纯函数单测；typecheck+全量测试绿。
目视验收（dev 2024-05）：绑定面板计数吻合 S2-BIND-SPEC §6 基线（自动 ≥406/待核 ≈91/占位 ≈145/漏抄 0）；月度段折叠展开/就地录入/原始码开关；档案段分页与绑定 popover。
