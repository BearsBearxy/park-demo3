# 园区抄表 v5（METER-V5-SPEC）— 数据表格工作台

> 定稿 2026-07-27（用户确认 mockup）。**推翻 v4 的三平级段范式**（月度分组区块/档案/绑定就绪三段全部退役），
> 对标成熟租赁后台：账期驱动 + 统计卡收敛 + 筛选驱动的单一数据表格 + 详情抽屉。
> **后端零改动**（数据全部来自既有端点：GET /meters、GET /meters/readings?ym、GET /meters/binding?ym、写端点照旧）。
> 保留资产：meterExcel 导入链/importRegistry 接线/meterSplit/meterLogic/meterGroup（计算复用，不再渲染区块）/EDIT-MODE·LIST-PAGE·DESIGN-FIDELITY 铁律。

## 1. 页面结构（单视图，无段切换）

**标题行**：h2「园区抄表」+ 账期（年 Select + 月 Select）+ **抄表进度条**（已抄/租户表数，跟随当前筛选的 kind/zone）；右侧：下载模板/导出当月（常驻）、导入（编辑态）、新增表（编辑态）、编辑模式按钮（最右）。

**统计卡行**（6 张，跟随 kind/zone 筛选；**点击=设置状态筛选**，再点取消，选中卡高亮）：
租户表总数｜已抄｜未抄｜异常（倒走+时段不符）｜待核/待绑定（双数）｜派生就绪（auto+auto_bld+override）。

**筛选条**：电/水 Segmented → 分区 Select → **楼栋 Select**（数据驱动清单）→ 归属 Select（全部/租户/公摊/经营/总表）→ 状态 Select（全部/已抄/未抄/倒走/时段不符/待核/待绑定/占位槽）→ 搜索（租户/原文/房号/表号/编码）→「重置」。

**数据表格**（useFitRows+FPPager 分页，56px 行高列宽铁律，table-layout:fixed）9 列：
☑｜租户（+「待核」小徽标+「分时」徽标）｜楼栋·房号(spot)｜表号(subName)｜倍率｜上月示数｜**本月示数**｜用量｜状态。
- 本月示数：浏览态文本（未录=虚线「待录入」）；编辑态 input 即时写回（无读数 POST/有 PUT，@click.stop）。
- 用量：分时表加虚线下划线，悬停 tooltip 出「尖·峰·平·谷」四段。
- **状态列单徽标，最差优先**：待核＞待绑定＞时段不符＞倒走＞未抄＞已抄＞占位；tooltip 列全维度。统计卡各自独立计数不受优先级影响。
- 表尾：楼栋筛选唯一时出**合计行**（租户+公摊用量合计，总+四段）与**损耗行**（分表Σ−infra 总表，负超 -5% 黄标）——复用 meterGroup 计算函数。
- 批量：☑ 选中出底部操作条「已选 N ·导出所选」（仅此一个批量操作，YAGNI）。

## 2. 尖峰平谷三层披露（用户确认稿）

1. **默认**：分时表一行到底+「分时」徽标+用量悬停四段；直读表（多数）无任何额外元素。
2. **展开行**：行首箭头（仅分时表）→ 四段子条：尖/峰/平/谷各一格（编辑态 input+每格旁实时该段用量），右侧实时校验「Σ段 = 总 ✓」/「差 X.X」红显——时段不符从事后检查变成录入时拦截。
3. **「分时列」开关**（工具栏，替代 v4 原始行至开关）：整表横排 上/本月·总尖峰平谷 列（卡内横滚），Excel 逐格校对场景。

## 3. 键盘流（编辑态核心体验）

本月示数格 Enter/失焦保存后：直读表 → 焦点自动跳**下一行本月示数**；分时表 → 自动展开子条进尖段 → Tab/Enter 依次 峰/平/谷 → 末段 Enter 保存收起并跳下一行。跳行目标=当前筛选排序下的下一块表（配合"点未抄卡→筛出未抄"即一路 Enter 抄完全月）。

## 4. 详情抽屉（点行打开，FPDrawer，三页签）

【表档案】原档案行内编辑项集中：楼栋/租户 FPTenantPicker/归属/表名称/倍率/表类型 Select + 删除表（409 守卫照旧）。
【历史读数】原 ReadingDrawer 内容：逐月增删改、补历史月。
【合同绑定】原 BindingPanel 行操作集中：当前绑定状态与分桶原因、候选合同列表选定绑定（PUT /bind）、date_missing 唯一候选一键确认、解绑；待核表此页签先出租户挂接。
「按名精确匹配一键挂」保留为待核卡点击后工具栏侧按钮（编辑态）。

## 5. 组件与文件

MeterView.vue（壳：标题/进度/统计卡/筛选条）+ MeterGrid.vue（表格/展开行/键盘流/合计损耗行）+ MeterDetailDrawer.vue（三页签）+ composables/useMeterWorkbench.ts（rows 组装：meters×readings×binding 合流、状态派生、统计卡计数、筛选、键盘流 next-target——**纯函数可测**）。
退役删除：panels/MonthlyPanel.vue、panels/RosterPanel.vue、panels/BindingPanel.vue、useMeterFilters.ts（并入 workbench）、meterBindQueue.ts（绑定逻辑并入抽屉页签，可复用部分保留）。旧组件相关 spec 测试同步替换为 workbench 单测。

## 7. v5.1 表格范式修订（2026-07-27 用户确认 mockup）——台账同款电子表格

**用户裁定：表格要「月度台账/附表10 那种」= FPLedgerTable 范式。** 本节取代 §1 表格段/§2 三层披露/§3 键盘流；壳层（账期/进度/统计卡/筛选条）与详情抽屉不变。

范式参照（照抄其结构与 CSS 手法，勿直接复用 ledger 专用组件）：`components/fp/FPLedgerTable.vue`（双级表头 rowspan+colspan/sticky offset 列宽累加/tfoot sticky bottom/34px 行高/mono 右对齐空值"–"/lg-filler 撑高/hover 行高亮/透明格内 input focus 蓝底）+ `views/ledger/LedgerWideTable.vue`（草稿态编辑/保存/取消）+ S10View（dirty 集合+SaveConfirmDialog）。

1. **新组件 MeterLedgerGrid.vue**（取代 MeterGrid.vue）：
   - fixedLeft=租户（click→抽屉，待核显 coral 名+徽标）；中部=楼栋·房号｜表号｜倍率(右对齐)｜「上月行至」组｜「本月行至」组；fixedRight=用量(总,派生,蓝)｜状态(badge)。
   - 电表两组各 5 列（总/尖/峰/平/谷）；水表各 1 列（总）——**分时列常驻**，v5 的展开行与「分时列」开关退役。
   - 双级表头 sticky 顶（34+38px），tfoot sticky 底：合　计｜本月行至组=「已抄 n / 未抄 m」｜用量=Σ(当前筛选行)。行至列不做列合计（示数合计无意义）。
   - **无分页**：wrap overflow:auto 充满卡高（filler 行撑高），FPPager/useFitRows 对本表退役；☑选择列与「导出所选」退役（导出当月覆盖）。
2. **草稿式编辑（台账/附表10 同款，取代即时写回）**：编辑模式内「本月行至」全部格子=透明 input 点格直改（上月行至只读基准）；draft map(meterId→5 值)，用量列按 draft 实时重算；工具栏 tag「编辑中 · N 处改动」；点「完成」dirty>0 → **SaveConfirmDialog**（保存修改/放弃修改/×留在编辑态）；保存=变更表批量提交（无读数 POST/有 PUT），行级失败收集后 alert 并保留该行 dirty。
3. **键盘流**：Tab/Enter 沿行内可编辑格横向走格，行尾进下一行首格（电子表格式）。
4. **校验**：电表本月总非空且四段齐时 |Σ段−总|>max(1,总×1%) → 该行用量格红显+title「时段不符」；倒走(用量<0)同红显。落库不拦（与既有导入口径一致，徽标事后仍标）。
5. useMeterWorkbench 相应瘦身（去分页/展开/next-target，加 draft 重算与页脚合计纯函数），单测同步。
6.5 **行窗口化虚拟滚动（2026-07-28 卡顿修复）**：实测 220 行/3409 格时滚动步进强制布局 ~9ms/整表重排 14ms（帧预算 16.6ms）→掉帧卡滞。修复=只渲染可视窗口±缓冲行（行高恒定：数据行 34/汇总行 40，flatten 组→显示列表算前后 spacer 高度），passive scroll+rAF 节流更新窗口；键盘流跨窗边界用 pending-focus（滚入后聚焦）；sticky 表头/页脚/列、草稿、校验、汇总行语义全部不变；顺带 sticky 格 box-shadow 换 border（去阴影绘制成本）。窗口范围计算为纯函数带单测。

6. **楼栋分组汇总行（2026-07-28 用户增补）**：表体按楼栋分组（buildingName，无楼栋='未挂楼栋'；按首现序稳定分组、组内行序不变），**每组末插一行「{楼栋名} · 总用电量」**兼作分隔——左侧自租户列起 colspan 显标签，用量列=Σ组内 **tenant+share** 行用量（infra 不计防重复、ops 非收费口径不计，=meterGroup §7.2 汇总口径，title 显四段合计），随 draft 实时重算；样式=浅底加粗+上边框 strong，sticky 列同步；一期/二期车间/宿舍栋一体适用。页脚全表合计与楼栋唯一筛选的合计/损耗行保留不变。

## 6. 测试与验收

单测：useMeterWorkbench（行合流/状态最差优先/统计卡口径/筛选/键盘流 next-target/Σ段校验）；meterGroup/meterExcel/meterSplit 既有 spec 不动。typecheck+全量 vitest 绿。
目视（dev 2024-05）：统计卡=910/390/520/异常N/91·266/408；点卡筛选联动；键盘流（编辑态录一格再清空还原）；分时展开与 Σ 校验；抽屉三页签；楼栋筛选合计+损耗行；分时列校对视图。
