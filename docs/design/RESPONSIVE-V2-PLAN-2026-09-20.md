# 响应式 v2 实施计划（手机 / 平板，含分析屏手机体验）

> 2026-09-20 立。输入是两份设计稿共 29 块画板：
> `运维文档/设计稿/未实现/响应式手机平板-2026-09-20/`（14 块）与
> `分析屏手机体验-2026-09-20/`（15 块）。
>
> 本文件是「稿 → 任务」的覆盖表与分期，**不是规范**。规范是
> `RESPONSIVE-LAYOUT-SPEC.md`（v1，2026-08-29），本计划的 P0 会改它的几句。

## 0. 对稿方式与结果

一块画板一轮，**先看 `_shots/*.png` 那张图**，再回 `.dc.html` 取图上写死的数值，
再去 `frontend/src` 找落点（`coverage-table-from-image.md`：覆盖表对着图数，
不从抽取的文字写）。之后四个只读复查面各跑一轮：完整性 / 越界 / 拍板一致性 / 待定项默认值。

| | |
|---|---|
| 画板 | 29 块 |
| 块级要求 | **822 条**（§9 全表） |
| 已符合（零改动，只复核） | 314 |
| 需改 | 309 |
| 新建 | 111 |
| 存疑 | 88 |
| 体量 | S 529 / M 239 / L 54 |
| 图与板上文字清单不一致 | 184 处（以**图**为准，`mockup-is-the-spec.md`） |
| 复查结论 | 32 条（挡工 3 / 要改 19 / 提醒 10） |

## 1. 两件已拍板的范围决定（2026-09-20）

### 1.1 三大报表**不**卡片化 —— 从拍板③的名单里划掉

拍板③ 原本逐字点名了「三大报表」，但对稿时两块画板都把它判成不卡片化，理由在源码里成立：

- `views/reports/balance-sheet/BalanceSheetView.vue:34` `BS_COLUMNS` 只有 **1 根**数值列（期末余额）
- `views/reports/income-statement/IncomeStatementTable.vue:22-26` 只有 **2 根**
- `components/fin/FinReportTable.vue:68-73` colgroup 四根写死

一行只有 1~2 个数，做成卡片后点开抽屉看到的还是那 1~2 个数。

**结论**：三大报表改走「首列 sticky + 横滚」（规范 §5.3 本来就是这么要求的）。
行→卡片名单只剩**月度台账（27 列）、损益附表、工资、电量**四类。已写进 §5.3。

### 1.2 导入中心手机版**不做** —— 保持规范原判

Import 那一整块（27 条块级要求，16 需改 + 6 新建）建立在推翻
`RESPONSIVE-LAYOUT-SPEC.md:318`「不再迁移：导入中心」之上——这条不在已拍板的六条里，
是稿自己拉回来的。

**结论**：不推翻。导入中心继续只挂 800px 地板横滚兜底，是全站唯一没摘地板的屏，保持现状。
Import 那 27 条整块退出计划（§4 第 11 条），`:318` 与 §10-P3 排期表不动。

## 2. 十条待定项的默认值（未反对即照此执行）

| | 项 | 默认 | 依据 / 附带条件 |
|---|---|---|---|
| a | 手机卡片密度 | **88** | 稿 §3 表按表分档：台账 88 / 附表10 88 / 损益附表 64 / 附表12 88 / 附表11 96。**任务书照表写，不许写「统一 88」**。不碰 `mx-list.css:118` 的 `.mx-rowcard`(72)。`useFitRows.ts:19` 在 S 档 pageSize 恒 10，与卡高无关 |
| b | 宽表抽屉默认展开 | **有值** | 等于现状。但现状判据 `LedgerTenantDrawer.vue:79` 是 `Number(...) > 0`，**负数（抵减/退补）会和零一起被整条藏掉且无 title 兜底**——同一次改动里把判据改成 `!== 0`，并把「有值 / 全部」段控一起做，不得分两次发 |
| c | KPI 降两列 | **M（≤960）** | 不是偏好是补缺陷：`ds/KpiCard.vue:109` 的 `.kc-l` 无 `:title`、`:146` 只有 ellipsis、`:101` 的 `useFitDown` 只管数值不管标签；768 下 4 列每格 151、扣 padding 40 后 111，「营业收入(本月)」被截且悬停也看不全。改 3 处副本 600→960（IncomeStatement:522 / BalanceSheet:573 / TrialBalance:547）并同步重写注释（现注释的理由「390 上每格 <90px」改档后不成立） |
| d | 报表数值列 168→120 | **不开** | 见 §4 不做清单第 2 条 |
| e | FPStat 390 形态 | **三列 + 16 号** | 零代码：`FPStat.vue:21` 的 `useFitDown` 已在跑，S 档抽屉全屏后每格约 81px，20 号「¥148,620」约 96px 放不下 → 自动降 16（约 77px）。选「两列 + 通栏」反而锁死后面：`BuildingDrawer.vue:217` 是 6 张、`BillNoticesView.vue:676` 是 4 张，「第三张通栏」在那两处无意义。本项唯一动手的是稿点名的圆角：`@media(max-width:600px){.fs{border-radius:var(--radius-md)}}` |
| f | 分析屏工具条 74→98 | **做** | 余量只有约 11px。`AnaShell.vue:302-304` 注释原文记着 390 预算「≈ 300，留余量」；34 钮抬到 44、seg 换成 44 高之后两行各约 352–355 对可用宽 366，余量没了，折成三行代价是 +68 不是 +24。实施三条：① seg 规则写 `.anx-tools .anx-seg`，**不写全局 `.anx-seg`**（`ana.css:13` 是全局，会连屏内 mini seg 一起抬）；② 日期框走 `--dp-h`（`DatePicker.vue:571`），不动 ds 组件；③ 390 与 375 各实测一次确认仍是两行，并按新数重写那段注释 |
| g | 光伏判据脚 32→64 | **做，但目标不是 64** | 现状是 16+2+16=**34**（稿写的 32 漏了 `gap:2`）。按稿的两列网格 5 条 +「去改」占第六格 = 3 行 = **52**，放开第二行折一次 = **68**。64 在两种排法下都对不上。`PvMeterAnaView.vue:564` 已有一条 ponytail 注释把缺口和解法都写好了；`:443` 的口径说明靠 `title` 兜底，触屏读不到。**同一次改动必须同步 `:365` 的骨架高度账**，`views/__tests__/anaSkeletonParity.spec.ts` 盯着 |
| h | 「更多分析」折叠线 | **常显 ≤4 张图，结论条不计入** | 不是「第 4 块之后」。按字面做驾驶舱会少常显一张图（它是 4 图 + 结论条 = 5 常显）。稿已写死六屏数目：驾驶舱 9 块 → 5 常显 4 折；到期墙 9 → 4 常显 5 折；充电桩 4 图 → 2 常显 2 折；园区 6 → 3 常显 3 折；租户 6 → 3 常显 3 折；电费 3 图 → 3 全显。折叠件做成 ana 层一个公用块，别逐屏写 |
| i | 分析层手机落地页 | **做，排最后** | 判定：**算稿要求**（图上完整画了，`no-unrequested-features` 的判据是「稿上没画出来的不算」），且是拍板④「在外面临时查一个数」的唯一落点。但**按图直接做不了**：六枚瓦里三枚取不到数（在租租户「环比 +3 户」两个候选来源都无 delta；「本月发电 48.2万 kWh」那枚瓦在 `pvAnaV4.logic.ts:210` 的值是日期不是电量；「自发自用抵扣 18.3%」全仓只在 `views/pv/PvView.vue`，分析层没有），而稿自己写死「值全部取自各屏已有的 KPI 瓦 / 结论条，不新算指标」。**首版砍到能取到数的三枚**。落点只改 `MobileBottomNav.vue:25-26` 与 `MobileNavDrawer.vue:54-55`（这两个组件只在 `tier==='s'` 挂载，天然只影响手机）；`navAccess.ts:52` 的登录落点不动 |
| j | 到期墙当前档蓝描边 | **不加** | 见 §4 不做清单第 3 条 |

## 3. 分期

每期一个 PR。版本号在各期收口时按 `RELEASE-NOTES-SPEC.md` §2.1 四问现判，这里不预分配。

### P0 · 先改口径（不改行为，解开后面所有期的锁）

1. **`RESPONSIVE-LAYOUT-SPEC.md:193` 两句改写**（挡工）。原文「各档一律内部横滚；列宽常量与 colgroup 不因档位变」同时与拍板③（行→卡片）和②（平板收列宽）正面冲突，不改这句，按 ②③ 落的每一条都是违规。改法：横滚那句改成「S 档按名单行→卡片，其余横滚」；「列宽常量不因档位变」限定到 **sticky offset 有 JS 依赖**的表（`FPLedgerTable.vue:56-80` 那种列宽累加），`FinReportTable` 无 JS 读 col 宽，不在此列。
2. §5.3 的卡片名单按 §1.1 写死：月度台账 / 损益附表 / 工资 / 电量，**三大报表不在名单里**。
3. `:318` 与 §10-P3 **不动**（§1.2：导入中心保持「不再迁移」）。
4. **字号回阶梯**：五块板新写了 13px / 17px，越出 `UI-CONSISTENCY-SPEC.md:44` 的阶梯（28/24/20/16/15/14/12/11，`tokens.css:84-93` 无 13 也无 17）。17 → `--fs-h2`(20) 或 `--fs-h3`(16)；13 → `--fs-body`(14) 或 `--fs-label`(12)。五处：JourneyEntry 改后屏 17、AnaShellPhone §3 表第1行 13、PvMain §1 蓝框栋名 13、WideCardPhone §3 屏样4 明细行 13、PvDrawer §1 每档 13。只换字号不动版式。
5. **十条读数句压线**。按 `anaCopyLint.spec.ts:34-36`（HINT_MAX=24 / READ_MAX=30 / REF_MAX=28）同一取法实测，稿上新写的句子有 10 条超标：读数句 6 条（PvMain §2 第4行 53、PvCharts2 §9 年档 36、PvCharts1 §③ 35、PvCharts2 §8 35、PvCharts1 §④ 34、ExpiryPhone §5 Pareto 31），参照系 4 条（PvCharts2 §8 35、PvCharts2 §9 月档 34、PvCharts1 §④ 33、ExpiryPhone §5 30）。**PvMain 那条剥掉插值后仍 44 字，怎么写都红**，砍成两段或把「全园中位」挪进 `.ana-ref`。稿 Rules §4 规则 2「本稿 43 条读数句全部过线」这句实测不成立，撤掉，改成「进任务书前逐条跑 anaCopyLint」。
6. **两句屏上文案删掉**（撞 2026-09-12 拍板的「屏上不许提设计稿、写实测不写行话」）：HomePhone「最近打开」副标「页签在手机上的化身」（是设计说明漏进屏）；PvDrawer「另 3 块：控制图 · 逐月点图 · 明细表 —— 用上面的段控切」（「段控」是组件名不是用户词）。
7. **覆盖表补四条导语行**（完整性复查：小节导语是仲裁依据，漏了就没人能判）：响应式 Rules §6「『不出现』和『藏起来』不是一回事，功能入口一个都不许藏」；分析屏 Rules §3「先试隔标签、再试降高、最后才换图种」；分析屏 Main §1「四级洞按拿不到数的严重程度排，不按数量排」；§2「每块屏板要回答自己那一处最难」。

### P1 · 跨屏机制（一处改，多屏受益；按「改一处影响几屏」排）

分析屏稿 Rules §7 自己给了这个顺序，照它走：

1. ✅ **`.hint-touch` 三分** —— **2026-09-20 已落地（0.15.4）**。`.hint-desk` 原在 ≤600 整段隐藏，
   8 屏 16 处交互话术消失（**按卡片处算；源码出现 32 次，因为骨架分支和真数据分支同一句写两遍**）。
   改成成对写：`ana.css` 基档藏 `.hint-touch`、S 档藏 `.hint-desk` 显 `.hint-touch`，16 处各配一句手机版
   （「点击深链成本总览对应月」→「点图看成本总览」）。`views/__tests__/anaHintTouch.spec.ts` 6 条断言钉配对。

   **落地时改了稿的两处**（都是对抗复查逼出来的，稿上那样做会出错）：
   - **B 类不是「直接删」**。稿写「租户箱线『(悬停看租户)』整句删掉，由读数句顶替」，但那张卡**现在没有读数句**
     （读数句是下面第 2 项的活），而散点的 tooltip 是 `trigger:'item'`，触屏点得出来。删了等于手机上没人知道点能看租户。
     改成和其余 15 处一样配对：桌面「(悬停看租户)」/ 手机「(点看租户)」。真正该删的只有
     `PvResidualHeat.vue` 那句「· 悬停看数」——那句裸写在 `.hint` 里没包 `.hint-desk`，手机上一直显着，值又直接印在格子里。
   - **到期墙 Pareto 的「点柱→清单展开」**，箭头是在说「效果发生在别处」。手机单列堆叠后清单离得更远，
     去掉箭头会读成「在本卡里展开」。手机版写成「点柱展开下面清单」。

   **顺带修了文案门禁的尺子**（`anaCopyLint.spec.ts`）。成对写之后，`hintTexts()` 把桌面那套和手机那套
   **加起来数**，而用户永远只看得到一套：ElecAnalysisView 那条桌面读 23 字、手机读 19 字，两边都达标，
   合量却是 31 字。改成按档各读一遍，棘轮 `HINT_OVER_BASELINE` **31 → 23**（往下拧）。
   这是这个文件第二次修尺子，第一次是 I6 的配平取法——同一条理由：**量不准的时候先把尺子修好，再谈往下降**。
2. **读数句接管**（20 屏）。`.ana-read` / `.ana-ref` 产品已有，默认写结论；1 级洞（数字只活在悬停提示里）共 **39 张图**，是本轮优先级最高的一类。
3. ~~**AnaEChart 图高降档**（24 屏）~~ —— **实测已经做完了，本期零改动**。`anaChartHeight.ts:10` 的
   `S_HEIGHT = { 440:260, 300:260, 250:220, 200:180, 170:150 }` 与稿 §1 那张表逐字一致；
   `AnaEChart.vue:128` 在组件内部统一套用，22 个调用点无一例外；`AnaSkelChart.vue:9` 用同一个函数，
   骨架与图同高。对稿时被判成「需改」是错的 —— 稿那张表是在**记录现状**，不是在提要求。
   本期只复核，不动代码。（**只降 AnaEChart，不降自绘 SVG** 这条仍然成立，自绘那批是下面第 4 项。）
4. **自绘图判容器宽不判视口宽**（13 个组件）。`width < 420` 的 `computed`，顺带修桌面 `.av2-s4` 窄栏里被压扁的同一批图。

   **⚠ 稿上给这一项的理由是错的，别照抄**。稿 §6/§7 的现状诊断写「整幅 viewBox 按 660→336 等比缩，
   11px 轴标签实际渲染 5.6px」—— 实测不成立：`PvDayChart.vue:167`、`PvYieldBand.vue:167`、
   `PvAnchorBars.vue:122`、`PvControlChart.vue:111` 等每一处都是 `:width="W"` 配 `:viewBox="0 0 W H"`，
   而 `W` 就是 `useWidth` 量出来的 `clientWidth` —— **渲染宽恒等于 viewBox 宽，缩放比永远是 1**。
   全仓零个 `width="100%"`、零个 `preserveAspectRatio`。字号一个都没被缩过。
   错误的出处多半是 `components/ana/useWidth.ts` 那行注释：**jsdom 里没有 ResizeObserver，宽度停在初始值**
   （496 / 646 / 999 / 1025），画稿时在 jsdom 口径下读到宽 viewBox 配窄卡，就推出了等比缩。

   **真正要修的是稿自己的对照表列的那几件**（它们与缩放无关，各自独立成立）：
   - 标签太密：31 个日标签挤在 302px 里 = 每标 9.7px，标得下不到一半 → 隔一标 / 换刻度；
   - 行高点不准：`PvAlphaBars` 22、`PvAnchorBars` 26、`PvRevenueBars` 27，都低于 §6 的行内次级 36 下限 → 30；
   - 栋名列 120 在 336 宽里吃掉三分之一 → 76；
   - 值只在 hover 里 → 行尾直标（手机没有 hover，这条与 P1-2 同源）；
   - 图高降档（236→200 / 250→210 / 272→230 …）；
   - **`PvLedgerScatter` 是全批唯一真·固定宽**（`:15` `SQ = 300`、`:109` `flex: 0 0 300px`）→ 量容器。

   拍板⑤「自绘图重画手机版、字号保住 11px、不许整幅缩放」仍然成立 —— 只是「不许缩放」这条现状本来就满足，
   要做的是上面那几件。
5. **工具条 74→98**（§2-f）与 **KPI 瓦折叠门槛改 ≤600**（不是稿写的 ≤1100——那会让 601–1100 都按手机折，撞拍板②「平板 = 小桌面」且撞「除 600/960/1280 外不许新增断点值」；`breakpoints.ts:7` 是唯一事实源，全仓 `max-width:1100` 只有 5 处存量豁免，其中 `ana.css:139` 只管 `.av2-s4/s6/s8` 栅格，与 `.av2-kpis`(`:131`/`:180`) 无关）。

### P2 · 分析屏八屏

光伏三屏（分栋主态 + 自绘图 11 张重画 + 单栋抽屉）→ 驾驶舱 → 园区 / 租户 → 到期墙 → 电费 / 充电桩 / 回收。

自绘 SVG **重画手机版，字号保住 11px，不许整幅缩放**（拍板⑤）。手段优先级照 P0-7 补进去的那条导语：
**先试隔标签、再试降高、最后才换图种**——全稿 39 张图里真正换图种的只有 1 张。

### P3 · 宽表行→卡片 + 卡片密度

名单（§1.1）：**月度台账 / 损益附表 / 工资 / 电量**。三大报表不在名单里，
本期给它做的是「首列 sticky + 横滚」那一半（ReportPhone 板划定的两件事：加 sticky、收列宽——
收列宽见 §4 第 2 条，不做，所以三大报表本期只剩 sticky 一件）。现状六处宽表（`LedgerView.vue:983`、`SalaryView.vue:368`、`MeterView.vue:739`、
`PnlScheduleView.vue:458`、`TrialBalanceView.vue:399`、`S10View.vue:711`）统一是「表内横滚 + 一根 sticky 首列 + 一行荐桌面提示」，没有一处是卡片。
`FPSortableTable.vue:247` 已有 ≤600 卡片分支，但那是 mx 列表页的 72px 定高卡，**装不下 27 列的整行抽屉，不能直接复用**。
录入仍建议去桌面（§11.2 已拍板）。

### P4 · 平板档内容口径 + 三个指标卡的窄屏补洞

平板外壳层已符合拍板②（`AppShell.vue:162-168` 只有 S 档才换手机栏，M 档图标轨与页签条照渲，侧栏是 `.fp-sb-float` 浮层）。
**没有的是内容层的共同口径**：全仓 960px 断点 17 处，散在 `AnaShell.vue:287`、`LedgerView.vue:963`、`S10View.vue:872`、三大报表 `.fin-two` 降单列，各写各的。本期给出「表格保持表格、只收工具行和列宽」这一条口径并逐处收编。
指标卡三处洞见 §2-c / §2-e。导入中心不并入（§1.2）。

### P5 · 分析层手机落地页「查一个数」

排最后——前面几期做完它才有东西可链。按 §2-i 砍到三枚。

## 4. 不做（写下来让你能裁，不是默默省的）

| # | 不做的 | 理由 |
|---|---|---|
| 1 | 存量野断点清账（`ParkView.vue:452` 900 / `DataHomeView.vue:791` 900 / `ContractDrawer.vue:383` 880 / `LoginView.vue:592` 1080 / `:602` 560） | 稿自己写在「不做」一栏、「只记一笔」。它确实和「除三值外不许新增断点」互相拆台，但那是清账动作不是版式决定，要做单开一个 PR，别混进照稿批次 |
| 2 | 报表数值列 168→120 | 技术上安全（全仓无 JS 读列宽，168 只出现一处），但**买不到承诺的东西**：`FinReportTable.vue:110` 没有 `table-layout:fixed`，auto 布局下 `<col width>` 只是建议值；`.fin-nv`(`:137`) 是 `nowrap` 且无 ellipsis，`finFmt.ts:9` 的 `finSigned` 恒出两位小数，「48,213,600.00」在 12px mono + padding 24 下约 118px——数一大列就自己撑回去。稿承诺的「表宽 424 · 横滚 66px」只在小数额时成立，代价却是明文违反规范 §5.3。真正解决「滚过去不知道在看哪一行」的是首列 sticky，与 168 无关 |
| 3 | 到期墙当前档蓝描边 | 稿给的理由「现在桌面上靠读者自己对」与产品不符：`expiry.logic.ts:776` 给历史续签率那档带了 `tag '历史'`，`ExpiryView.vue:332` 渲染的是「71% 历史」，**屏上本来就有文字标记，而且文字强于颜色**。稿自己把这条写成「可被否」。真要加强，把 tag 改成「历史 71%」——一个字符串，不是一个新视觉件 |
| 4 | FormPhone「错误行不占预留位，整块下移可接受」 | 推翻 `LAYOUT-STABILITY-SPEC.md:78` §4.2 且会让 `:135-137` 那道现成门禁变红。`ds/Input.vue:104` 的注释逐字写着「用户正要点的『确认』按钮在他手指底下跑掉」，而改后 sheet 的主按钮正是贴底那一颗。现状 `.ds-in-msg` / `.lg-dlg-erm:144` / `.ct-erm:866` / `.bd-erm:448` 都已有 `min-height`，保留 = 零改动 |
| 5 | KpiCard padding 20→14 | 与 §2-c 降两列互相撤销：降两列的算术是按「扣 padding 40」推的，先收到 14 则 768 下内容宽变 123，已接近标签所需的 124，降两列的理由被抽掉一半。两块动的是同一个共用组件、同一个 M 档。降两列已解决截断，收 padding 是第二个解法叠上来 |
| 6 | 报表屏页内选期（126px 日期控件） | **mock 底纹不是稿要求**：`ReportPhone.dc.html:521-522`（现状台）与 `:542-543`（改后台）逐字相同，板上一个字没提过它。板子自己把本块范围写死成两件事（`:516`「能动的只有：给首列加 sticky、把数值列宽收一档」）。真要做是新交互，单独拍板 |
| 7 | 园区屏 KPI 四瓦（含「单位面积月租 ¥18.2/㎡ · 中位 ¥17.4」） | 同上，mock 底纹。`ParkTenantPhone.dc.html:258`/`:275` 现状台与改后台是同一组，改后台说明 `:268` 只列了四件事、不含 KPI。**照瓦名实施等于顺手做一个稿没要求的新指标**；产品里没有这个口径，要做先过数据可行性 |
| 8 | WideCardPhone §1 注释② 把「新增租户 / 批量删除 / 未绑定 N」折进 ⋯ | 撞 §11.2（2026-08-30 拍板「不禁止、不隐藏、不优化」）与 §5.3「编辑入口不藏」；`LedgerWideTable.vue:394` 注释逐字写「用户 2026-08-23 反馈『入口找不到』后定为常驻」。⋯ 只收「导出 Excel / 账册模板」（与 `:318-321` 现状一致），其余留在行内。板自己的注释③「藏进 ⋯ 就是隐藏」对这三颗同样成立 |
| 9 | ListPhone §2「页大小下拉是原生 `<select>`」 | **已过期**。0.15.2 / 0.15.3 已清完并加了门禁（`Pagination.vue:120` 起渲染的是 `ds/Select`）。照这行会派人去删一个不存在的 select |
| 10 | hint 棘轮先拍板「减字 vs 抬基线」 | 不阻塞。按门禁同一取法实测：全仓 103 段 hint，当前超 24 字 19 处，余 12 处；8 屏内含「点击」的 hint 里只有 `ElecAnalysisView.vue`(23 字)、`ParkView.vue`(24 字) 两处会因 +4~6 字跨线，`CockpitView.vue` 那条 30 字本来就超。做完跑一次 anaCopyLint，真红了再减那两处的字 |
| 11 | **导入中心手机版整块（27 条块级要求）** | 2026-09-20 拍板：不推翻 `RESPONSIVE-LAYOUT-SPEC.md:318`「不再迁移：导入中心」。它继续只挂 800px 地板横滚兜底——全站唯一没摘地板的屏（`ImportCenterView.vue` 全文 355 行零 `@media` 零 `.fp-fluid`），保持现状 |
| 12 | **三大报表行→卡片** | 2026-09-20 拍板：从拍板③名单划掉（§1.1）。本轮只给它做首列 sticky |

## 5. 验收（沿用 `RESPONSIVE-LAYOUT-SPEC.md` §9，加两条）

- 四宽实测 **1440 / 1180 / 768 / 390**，外加 844×390 横屏与 961/1000（L 档下缘）抽查；1440 与现状零差异。
- 只用 600/960/1280；宽档规则写在窄档之前。
- 触屏仿真过一遍：无 hover 唯一入口、无 <36px 触达、S 档输入 16px。
- 同档内交互零位移（`noInteractionLayoutShift` 门禁）；colgroup 列数未变。
- **新增**：`anaCopyLint` 全绿（P0-5 的十条压线是前提）。
- **新增**：`anaSkeletonParity` 全绿（§2-g 改判据脚高度必然动到它）。
- 全量 vitest / `npm run typecheck` / `npm run build`，按 JSON 报告数产物判绿（不看退出码）。

## 6. 复查 32 条的处置一览

| 面 | 条数 | 处置 |
|---|---|---|
| 完整性 | 5（要改 2 / 提醒 3） | 两条导语补进覆盖表 → P0-7；三条记法不一致，实质不漏 |
| 越界 | 5（要改 3 / 提醒 2） | 三条判为 mock 底纹或改规范动作 → §4 第 6/7 条与 §1.2；两条回到「只记一笔」→ §4 第 1 条 |
| 拍板一致性 | 11（挡工 2 / 要改 6 / 提醒 3） | 挡工两条 → §1.1 与 P0-1；要改六条 → P0-4/5/6、P1-5、§4 第 8 条；提醒三条 → §4 第 10 条、§1.2、§4 第 9 条 |
| 待定项 | 11（挡工 1 / 要改 8 / 提醒 2） | 全部落进 §2 的十行表；挡工那条（KpiCard padding 与降两列互撤）→ §4 第 5 条 |

---

## 7. 覆盖表（508 条要动的块）

「已符合」的 314 条不列（零改动，只在各期收口时复核）。
每行是图上的一块；**判定与要求以图为准**，图与板上文字清单不一致的 184 处已按图取。
全量 822 条（含已符合）在 `运维文档/设计稿/未实现/覆盖表-全量822条-2026-09-20.md`。

**两处按本计划覆盖图的例外**：
① `Import` 那一节的 22 行整块**不做**（§1.2 / §4 第 11 条），归期列里的 `P4?` 作废；
② `WideCardVariants` / `ReportPhone` 里涉及三大报表卡片化的行按 §1.1 作废。
除这两处外，图仍是规格。

另外 §2 与 P0-4/5/6 记下的七处修正，是**图与产品门禁冲突**的地方（字号阶梯、anaCopyLint、
屏上文案三条拍板、断点唯一事实源）——这几条以本计划为准，画板不重跑。其余一律以图为准。

#### Main(总览 · 导读)  — 共 40 块，已符合 18，要动 22　→ P0

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §1 断点体系四条铁律 | 桌面优先 max-width;宽档规则写在窄档之前;除 600 / 960 / 1280 外不许新增断点值;平板不另立第五档 —— 竖屏落 M、横屏落 L。  | 需改 | M | frontend/src/styles/breakpoints.ts:7;docs/design/RESPONSIVE-LAYOUT-SPE |
| §2 拍板② 平板档 601–960 = 小桌面 | 竖屏 iPad 768 落这里。保留左侧图标轨和页签条,目录仍是点开的浮层;表格保持表格、不卡片化,只收工具行和列宽。和桌面认知一致。  | 需改 | M | frontend/src/components/shell/AppShell.vue:162-168 与 :335-341(外壳侧已符合); |
| §2 拍板③ 手机上的宽表 = 行→卡片 | 月度台账 / 三大报表 / 损益附表 / 工资 / 电量这类几十列的表,一行一张卡,卡上 3–4 个关键字段,点开抽屉看全部列。录入仍建议去桌面。  | 新建 | L | 现状对照点:LedgerView.vue:983、SalaryView.vue:368、MeterView.vue:739、PnlSched |
| §3 板 02 · Rules 规则层 | 断点、触点 44、安全区、降列规则、字号、间距、窄屏不出现的东西。  | 存疑 | M | docs/design/RESPONSIVE-LAYOUT-SPEC.md:216(§6 触屏与 iOS,按 hover:none 生效); |
| §3 板 05 · ListPhone mx 列表页 · 手机 | 楼栋管理:KPI 横滑、搜索、72px 行卡、分页。  | 需改 | M | frontend/src/styles/mx-list.css:119(.mx-rowcard height: 72px)、:147-150 |
| §3 板 06 · WideCardPhone 宽表→卡片 · 手机(蓝边重点) | 月度台账 27 列:卡片列表 + 整行抽屉 + 期间条收纳。  | 新建 | L | frontend/src/views/ledger/LedgerView.vue:983-987(现状 S 档只有 .lgw-s-hint  |
| §3 板 07 · WideCardVariants 卡片密度三选一(蓝边重点) | 紧凑 64 / 标准 88 / 带收缴条 96,并给其余 B 级表点名套哪一种。  | 新建 | M | frontend/src/styles/mx-list.css:116-119(现存唯一行卡几何 .mx-rowcard height: 7 |
| §3 板 08 · AnaPhone 分析屏 · 手机 | 经营驾驶舱。这一层已经做完了,本块是复核 + 验证 108 定高。  | 存疑 | S | frontend/src/views/analysis/AnaShell.vue:268(.anx-kpis min-height: 120 |
| §3 板 09 · ReportPhone 报表屏 · 手机 | 利润表:KPI 两列 + 科目树三列收两列。  | 需改 | M | frontend/src/views/reports/income-statement/IncomeStatementView.vue:51 |
| §3 板 10 · HomePhone 首页 · 手机 | 搜索、本月出账入口、收藏磁贴、最近打开。  | 需改 | M | frontend/src/views/home/HomeView.vue:55(fp-fluid,自己收单列不吃 800px 地板);Hom |
| §3 板 11 · FormPhone 表单与浮层 · 手机 | 全屏 sheet、日期底部面板、下拉、错误位、底部主按钮。  | 需改 | M | frontend/src/components/ds/DatePicker.vue:155(tier === 's' → sheet)、:4 |
| §3 板 12 · KpiNarrow 三个指标卡的窄屏形态(蓝边重点) | KpiCard / AnaKpiTile / FPStat 各画三档,补零响应式的洞。  | 新建 | M | frontend/src/components/ds/KpiCard.vue:1(161 行,全文零 @media);frontend/sr |
| §3 板 13 · TabletContent 平板档内容排布 | 列表页 / 分析屏 / 报表屏在 768 上的三条。  | 需改 | M | frontend/src/styles/mx-list.css:102-104(≤1100 .mx-md 单列,768 命中);fronte |
| §3 板 14 · Import 导入中心 · 手机(蓝边重点) | 全站唯一没做过窄屏的屏:上传区、卡片墙、记录表。  | 新建 | M | frontend/src/views/import-center/ImportCenterView.vue:1(355 行,零 @media |
| §4 C 行 · 只收了工具行或 KPI 降列 | 若干 —— 电量/光伏/充电桩/公用事业工具行两行化;三大报表 KPI repeat(4)→两列;几处只改搜索框字号。本稿怎么补:第 09/12/13 块 —— 降列规则提到 M 档(.fi | 需改 | M | frontend/src/views/reports/balance-sheet/BalanceSheetView.vue:555 与 :5 |
| §4 零 行 · 一件都没做 | 1 屏 —— 导入中心:零 @media、零 tier、零 .fp-fluid,吃 800px 地板。本稿怎么补:第 14 块 摘地板 + 卡片墙单列 + 记录走行卡 + 补上传进度(现在一 | 新建 | M | frontend/src/views/import-center/ImportCenterView.vue:1;frontend/src/s |
| §5 不做 · 存量野断点的收编 | ParkView / DataHomeView 900、ContractDrawer 880、LoginView 1080/560:是实施期的清账动作,不是版式决定,稿上只记一笔。  | 需改 | S | frontend/src/views/analysis/ParkView.vue:452;frontend/src/views/data-h |
| §5 待拍板 1 · 第 07 块卡片密度 | 紧凑 64 / 标准 88 / 带收缴条 96。稿的推荐:标准 88。  | 存疑 | S | frontend/src/styles/mx-list.css:116-119(现存 .mx-rowcard height: 72px) |
| §5 待拍板 2 · 第 06 块抽屉默认范围 | 「有值的 12 项」还是「全部 21 项」。稿的推荐:默认有值。  | 存疑 | S | frontend/src/utils/bookTemplate.ts:44-62;backend/src/main/java/com/par |
| §5 待拍板 3 · 第 12/13 块 KPI 降两列的档位 | 只在 S(≤600),还是 M(≤960)就降。稿的推荐:M 就降。  | 存疑 | S | frontend/src/components/ana/ana.css:179-180(.av2-kpis 现在 ≤600);fronten |
| §5 待拍板 4 · 第 09 块报表表数值列 168 → 120 | 它擦着规范 §5.3「列宽常量不因档位变」那一句。技术上安全(FinReportTable 没有按列宽算 sticky offset 的 JS),但要不要开这个口子由你定。  | 存疑 | S | frontend/src/components/fin/FinReportTable.vue:72(<col style="width:16 |
| §5 待拍板 5 · 第 12 块 FPStat 在 390 上三列还是 2+1 | 三列要接受数字降到 16 号,2+1 保得住 20 号但不再并排。稿的推荐:三列 + 16 号。  | 存疑 | S | frontend/src/components/fp/FPStat.vue:38(.fs-n font-size: var(--fs-h2) |

#### Rules（规则层，四档 · 一套值）  — 共 52 块，已符合 39，要动 13　→ P0

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §1 注·层叠序 | 层叠序恒为宽档在前窄档在后：1280 → 1100（存量豁免）→ 960 → 600 → print；窄档块插到宽档前会被按源序压回  | 需改 | S | frontend/src/components/ana/ana.css:138,139,179; frontend/src/styles/m |
| §2 行内次级操作 ≥ 36×36 | 行内次级操作热区 ≥ 36 × 36；视觉尺寸可不变（图标仍 24×24），热区用 padding 扩到 36  | 需改 | S | frontend/src/components/ds/IconButton.vue:24 |
| §2 输入控件 S 档 ≥ 16px | 输入控件在 S 档字号 ≥ 16px；--fs-input-m: 16px，只在 ≤600 媒体块引用；S 档演示高 44  | 需改 | S | frontend/src/styles/tokens.css:96; frontend/src/components/ds/Input.vu |
| §3 手机高度链图 | safe-area-inset-top 47 / 顶栏 52 / 内容 overflow-y:auto 高度基准 100dvh / 底栏 56 / safe-area-inset-botto | 需改 | S | frontend/src/components/shell/mobile/MobileTopBar.vue:50; frontend/src |
| §3 安全区三件套③100dvh | 高度基准 100dvh 不用 100vh：iOS 地址栏收起时 100vh 链会把超出部分裁掉  | 需改 | S | frontend/src/views/LoginView.vue:468; frontend/src/views/PlaceholderVi |
| §3 安全区三件套⑤backdrop-filter 前缀 | backdrop-filter 一律补 -webkit- 前缀：iOS ≤17 无前缀不识别；图上写「现状 15 处遮罩在 iOS 上本来就没模糊」  | 需改 | M | frontend/src/components/fin/FinDialogs.vue; frontend/src/components/sh |
| §3 旋屏③断点边缘不抖 | 同一宽度进出多次结果必须一致，不许在断点边缘抖动  | 存疑 | S | frontend/src/composables/useViewport.ts; frontend/src/composables/__te |
| §4 栅格降列·报表 KPI .fin-kpis | XL/L repeat(4) / M repeat(2)(加粗) / S repeat(2)；图上标「改」——现状只在 ≤600 降，768 上 4 列每格 152、金额降到 20 还是紧， | 需改 | S | frontend/src/views/reports/balance-sheet/BalanceSheetView.vue:555,573- |
| §4 栅格降列·分析屏 KPI .av2-kpis | XL auto-fit minmax(120) / L 同左 / M repeat(4)(加粗) / S repeat(2)；图上标「改」——现状 M 档 auto-fit 在 644 宽下 | 需改 | S | frontend/src/components/ana/ana.css:131,180 |
| §4 栅格降列·卡片墙 | 楼栋 / 导入中心 / 功能门：XL–M auto-fill minmax(248px, 1fr) 天然自适应；S minmax(min(100%, 248px), 1fr) 防容器比 mi | 需改 | S | frontend/src/views/buildings/BuildingsView.vue:280; frontend/src/views |
| §5 间距·KpiCard padding | XL/L 20 / M 14 / S 14；图上标「改」——本稿补  | 需改 | S | frontend/src/components/ds/KpiCard.vue:140 |
| §6 窄屏不出现·Ctrl K / 方向键 / Esc 提示 | hover:none 档消失；谁接手 = 无；触屏没有这些键，写出来是假话  | 需改 | S | frontend/src/components/shell/CommandPalette.vue:276-280; frontend/src |
| §6 窄屏不出现·页签双击固定 | hover:none 档消失；谁接手 = 常显的 Pin 钮；双击不能当唯一入口  | 存疑 | S | 无（全仓 grep dblclick 0 命中）；固定入口现在在 frontend/src/components/shell/TabStri |

#### ShellPhone（手机外壳，390 × 844 · iPhone 14/15 逻辑像素）  — 共 21 块，已符合 21，要动 0　→ —

全部已符合，只做复核。

#### ShellTablet（平板外壳 —— 按小桌面做，768 × 1024 · iPad 竖屏）  — 共 24 块，已符合 16，要动 8　→ P4

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §1 表·第4行 页签条 44 保留 / 关闭+固定钮触屏常显 | 页签条高 44，M 保留；关闭钮与固定钮在触屏常显。  | 需改 | M | frontend/src/components/shell/TabStrip.vue:487（height:44px）、:606-609（@ |
| §1 表·第5行 顶栏 48 / 面包屑只留屏名 / 搜索收图钮 / 头像组收 +N | 顶栏高 48 不变；M 档面包屑只留屏名、搜索框收成图钮、在线头像组收成「+N」。  | 需改 | S | frontend/src/components/shell/Toolbar.vue:197-198（height:48px）、:374-38 |
| §1 差别②·工具行允许两行且行组成静态确定 | M 档工具行固定两行：第一行期区胶囊，第二行「卡片墙/列表」段控 + 搜索 + 状态下拉。不靠内容宽度自然换行（会随文案长短在一行两行间跳，sticky 条高度跟着跳）。  | 需改 | M | frontend/src/styles/mx-list.css:16-17（.mx-toolbar flex-wrap:wrap / .mx |
| §1 差别③·列宽压、列数不动（可租 ㎡ / 条 54→36 / td padding 16→1 | M 档：「可租面积 ㎡」表头缩成「可租 ㎡」、出租率条从 54 收到 36、td padding 16→10，一列都不删。  | 需改 | M | frontend/src/views/buildings/BuildingsView.vue:146（header '可租面积 ㎡'，wid |
| §1 差别④·头像组收成「+N 人」定宽徽记(L 档起) | 在线头像组在 L 档起收成「+N 人」定宽徽记，人数变化不挪版。  | 需改 | S | frontend/src/components/fp/FPPresenceBar.vue:109-114（@media max-width: |
| §1 防③·双击固定失效 / Pin 钮常显 / hover:hover 自动回来 | 触屏无双击语义，双击固定失效；Pin 钮常显即唯一入口；iPad 接触控板时 hover:hover 自动回来。  | 存疑 | M | frontend/src/components/shell/TabStrip.vue:373（@contextmenu 是固定的唯一入口）、 |
| §2 左图·XL 1440 × 900「现状，一个像素不动」 | XL 档一个像素不动。  | 存疑 | S | frontend/src/components/shell/AppShell.vue:218-333（宽档规则在 960 媒体查询之外）；f |
| §2 右图·M 768 × 1024 整屏（KPI 四卡一行） | M 档 KPI 轨转横排，四卡一行不换行，gap 12，每卡 flex:1 1 160px。  | 需改 | S | frontend/src/styles/mx-list.css:71-75（@media max-width:1100 → flex-dir |

#### TabletContent（平板档的内容排布，768 × 1024 · 内容可用宽 642）  — 共 27 块，已符合 10，要动 17　→ P4

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §① 小节说明·列表页(楼栋管理) | KPI 从左侧竖轨转成顶部横排 4 个（mx-list.css 的 ≤1100 存量豁免块，已实现）；工具行两行、行组成静态确定；表格 7 列全留，只压列宽与 td padding。  | 需改 | S | frontend/src/styles/mx-list.css:71-75 |
| §① 屏样·改后 楼栋管理 @ 768 | 768 宽下：左图标轨与 Chrome 式页签条保留；KPI 顶部横排 4 张；期区胶囊「全部13/一期4/二期4/三期3/宿舍2」独占一行；第二行「卡片墙 | 需改 | M | frontend/src/views/buildings/BuildingsView.vue:242-333；frontend/src/co |
| §① delta 行2·KpiCard padding | 卡内 padding 20 → 14；图标 18 → 16；内容宽从 112 挪到 124，副行「在租 7.38 / 可租 8.43 万㎡」不再被截。列数不动。  | 需改 | S | frontend/src/components/ds/KpiCard.vue:140（.kc padding:20px）、:148（.kc- |
| §① delta 行3·期区胶囊高 | 胶囊高 34 → 32。触屏上整条胶囊组仍 ≥44 可达（外框 padding 4，32+4×2=40，稿以整组为可达面积）。  | 需改 | S | frontend/src/components/fp/FPPhaseTabs.vue:54（.fp-phasetab height:34px |
| §① delta 行4·工具行 | 1 行 → 2 行。第一行期区胶囊，第二行段控 + 搜索 + 状态下拉。行组成不随内容抖（静态确定，不靠 flex-wrap 撞出来）。  | 需改 | S | frontend/src/styles/mx-list.css:16（.mx-toolbar flex-wrap:wrap）；fronten |
| §① delta 行5·表格 td padding | td padding 16 → 10。7 列 × 12px × 2 = 省 84px。  | 需改 | M | frontend/src/components/fp/FPSortableTable.vue:199（td padding '0 16px' |
| §① delta 行6·出租率条 | 条 54 → 36。条短了，百分数不变（右侧 40px 数字列不动）。  | 需改 | S | frontend/src/views/buildings/BuildingsView.vue:156（h('span',{style:{fl |
| §① delta 行7·表头文案 | 「可租面积 ㎡」→「可租 ㎡」。同一列，只换表头写法（不删列、不改数据）。  | 需改 | S | frontend/src/views/buildings/BuildingsView.vue:146（header: '可租面积 ㎡'） |
| §① delta 行8·分页器 | pill 32 → 高度反而增到 36、宽收到 26。  | 需改 | S | frontend/src/components/ds/Pagination.vue:78-80（pillBase minWidth:32px |
| §① 局部对照·KPI 卡 @152 | 两张 152 宽的园区出租率卡并排：现状 padding 20，副行「在租 7.38 / 可租 8.4…」被截；改后 padding 14，副行「在租 7.38 / 可租 8.43 万㎡」全 | 需改 | S | 同上 KpiCard.vue:140/:148；副行内容来源 frontend/src/views/buildings/BuildingsV |
| §① 黄框·一列都不删 | 一列都不删。768 上 7 列压完是 642 − 表内 padding ≈ 刚好；再窄也只许横滚。删列 = 用户在平板上看到的数据和桌面不一样，那是两个产品。  | 存疑 | M | frontend/src/views/buildings/BuildingsView.vue:121-163（TABLE_COLUMNS，实 |
| §② 屏样·经营驾驶舱 @ 768 · KPI 定 4 列 | 768 宽下：工具条已两行（期间/按月按年/年月选择 一行，对比 seg + 截至 + 设置钮 一行）；KPI 7 张排成 4 + 3；结论条三条一行；柱图与环图单列满宽、高度不降档。  | 需改 | M | frontend/src/views/analysis/CockpitView.vue:340-361（7 张 AnaKpiTile）、An |
| §② 说明卡·KPI 定 4 列改 | auto-fit, minmax(120px, 1fr) 在 642 宽下排 5 列，7 张瓦成 5 + 2：第二排右边空三格，每格只有 122，最长标签被截。定 4 列后每格 154，排成 | 需改 | S | frontend/src/components/ana/ana.css:131（.av2-kpis auto-fit minmax(120p |
| §② 卡内对照样·现状 5 列 vs 改后 4 列 | 现状 · auto-fit 排 5 列：每格 122，7 张瓦成 5+2，第二排空三格，最长标签被截（「预算达成(1-12…」）。改后 · 定 4 列：每格 154，7 张瓦成 4+3，标签 | 需改 | S | 同上 ana.css:131；数来源 frontend/src/views/analysis/CockpitView.vue:343-360 |
| §③ 小节说明·报表屏(利润表) | 整块只改一行 CSS：把 .fin-kpis 降两列的媒体条件从 600 改成 960。四张报表屏同时生效。  | 存疑 | S | frontend/src/views/reports/income-statement/IncomeStatementView.vue:52 |
| §③ 屏样·改后 利润表 @ 768 · KPI repeat(2) | 768 上 2 列，每格 315：标签「营业收入(本月)」「营业利润(本月)」「利润总额(本月)」「净利润(本月)」全出不截，数也放得下。KPI 占两行，表格部分与现状一致不变。  | 需改 | S | frontend/src/views/reports/income-statement/IncomeStatementView.vue:52 |
| §③ 说明卡·KPI repeat(4) → repeat(2) 改 | 现状 .fin-kpis 只在 ≤600 降两列。768 上 4 列每格 151，扣 padding 40 后内容宽只剩 111；标签 7 个汉字 ≈ 98 + 图标 18 + 缝 8 =  | 需改 | S | frontend/src/views/reports/income-statement/IncomeStatementView.vue:52 |

#### HomePhone（首页 · 手机 390×844）  — 共 14 块，已符合 6，要动 8　→ P4

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| 手机屏样·改后 @390 | 改后纵序 = 品牌 → 搜索(无 Ctrl K) → 本月出账入口条 → 收藏 → 最近打开。入口条插在搜索框与收藏区之间，margin-top 20，宽度占满内容区。  | 需改 | M | frontend/src/views/home/HomeView.vue:62-69（插入点在第 66 行 </button> 与第 68  |
| §两处改动·①去掉搜索框里的「Ctrl K」提示 | 加一条 @media (hover: none) { .hm-kbd { display: none } }，与命令面板里的 kbd 提示走同一条规则。理由：现状 .hm-kbd 没有任何  | 需改 | S | frontend/src/views/home/HomeView.vue:65（kbd 元素）、144-153（.hm-kbd 规则，缺 h |
| §两处改动·②加「本月出账」入口条(条高 68，收藏 6→5) | 新建入口条：min-height 68、padding 12/14、圆角 16、gap 12、margin-top 20、宽度 100%。理由：本月出账现在只是收藏里的一格磁贴(和利润表同等 | 新建 | M | 无（HomeView.vue 无此块）；目标屏 data-home 定义在 frontend/src/nav/fpNav.ts:12-13（ |
| §没改的·②最近打开 1 列不变、行高 ≥44、条数跟 tabs.recent 走 | 最近打开保持 1 列，行高 ≥44；它是页签的化身，条数跟 tabs.recent 走。  | 存疑 | S | frontend/src/views/home/HomeView.vue:263（1 列）、264（min-height:44px）、36（ |
| §入口条的写法·①配色(--accent-blue / --surface-white / -- | 条底 --accent-blue；图标底 --surface-white，图标与右端 › 用 --info-text-on-tint（浅底上写字的那个蓝，对比 4.5 以上）；主行字 --t | 新建 | S | frontend/src/styles/tokens.css:137,215,216（浅色）、356,386,387（暗色） |
| §入口条的写法·②副行「5 道工序 · 已完成 2」是实测数 | 副行必须是实测数：五道取自 nav/billingChain.ts 的 CHAIN（计费参数 → 园区抄表 → 公共电核算 → 楼栋损耗 → 催缴单，顺序不可改），不是人数出来的。不写「进展 | 新建 | M | frontend/src/nav/billingChain.ts:12-15（CHAIN）、28-38（chainStepsOf）；fron |
| §入口条的写法·③整条 68 > 44 触达，右端 › 是 20px 图标不是按钮 | 整条最小高 68 > 44 触达；右端 › 是 20px 图标，不是可单独点的按钮 —— 整条一个点击目标。  | 新建 | S | 无（新块）；同款「整行一个按钮」写法可抄 frontend/src/views/home/HomeView.vue:103-107（.hm- |
| 改后屏·「最近打开」副标「页签在手机上的化身」 | 改后屏在「最近打开」标题旁加一行 12px muted 副标：页签在手机上的化身。  | 存疑 | S | frontend/src/views/home/HomeView.vue:101（<div class="hm-sh"><b>最近打开</b |

#### ListPhone（mx 列表页 · 手机，楼栋管理 390 × 844）  — 共 27 块，已符合 15，要动 12　→ P3

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §1 改后屏样（楼栋管理 @ 390，5 字段） | 卡上 5 个字段：楼栋名、月租金、期数、在租数、出租率条、状态。定高 72 不变、每页 10 张不变。图上示例：2 号厂房 ¥16.2万 / 一期 · 8/8 / 100% / 执行中；5  | 需改 | M | frontend/src/views/buildings/BuildingsView.vue:306-316（现只有 4 字段） |
| §1 几何注② 第一行 20px 行高 | 第一行 20px 行高：楼栋名（14px / 字重 500，溢出省略号）+ 月租金（mono 14px / 字重 600，右端对齐）。  | 需改 | S | frontend/src/styles/mx-list.css:132（.mx-rowcard-main） |
| §1 几何注③ 第二行 18px 行高 | 第二行 18px 行高，横向顺序：期数 · 在租 n/N → 出租率条（宽 44）+ 数（宽 40）→ 状态徽标（右端，flex:0 0 auto 豁免省略号）。  | 需改 | S | frontend/src/styles/mx-list.css:133-134（.mx-rowcard-sub） |
| §1 我改了两处·① 月租金提到第一行右端 | 把月租金提到第一行右端。理由：桌面表有「月租金」列，现在卡上一个钱字都没有；位置选右端，一列 mono 数字竖着能对齐。图上四张卡的值：¥16.2万 / ¥18.9万 / ¥20.7万 /  | 需改 | S | frontend/src/views/buildings/BuildingsView.vue:307（现只有 row.name）；数据与格式 |
| §1 我改了两处·② 出租率从灰字换成条 + 数 | 出租率从 12px 灰字换成进度条 + 数。条色沿用桌面表：≥90 蓝 / ≥75 灰蓝 / 其余橙。条宽 44（= 44×44 触点的一半），数宽 40。不发明新东西。  | 需改 | S | frontend/src/views/buildings/BuildingsView.vue:113-120（OccBar，阈值 ≥90 v |
| §1 没改的·KPI 胶囊 140 定宽与横向滑动不动（padding 20→14 归第 12  | 不动 KPI 胶囊的 140 定宽与横向滑动 —— 现状已经对；只把 KpiCard 的 padding 从 20 收到 14（该项归第 12 块画板 KpiNarrow）。  | 需改 | S | 140 定宽 + 横滑：frontend/src/styles/mx-list.css:143-146（flex-wrap:nowrap;  |
| §2 分页条图样 @ 358 · 定高 52 · 跳页钮 36 高 · pill 26×36 | 分页条宽 358、定高 52；跳页钮高 36；页码 pill 26 宽 × 36 高。图上内容：「1 / 2 ∧」「共 13 条」右侧「‹ 1 2 ›」。  | 需改 | S | frontend/src/styles/mx-list.css:150（.mx-pagerbar padding: 8px 10px）、:1 |
| §2 触达账·pill 高 32→36、宽 32→26 | pill 在 S 档高度反而要增（32→36），宽要收（32→26）：手指比鼠标粗，但 390 上放不下 4 个 32 宽的圆。  | 需改 | S | 宽已改：frontend/src/styles/mx-list.css:154。高未改：frontend/src/components/ds |
| §2 触达账·跳页钮 36 高、去掉 116px 下限 | 跳页钮 36 高、去掉 116px 下限，靠内容撑。  | 需改 | S | 116 下限已去：frontend/src/styles/mx-list.css:151（压 frontend/src/components |
| §3 栅格套用规则·楼栋管理 | 第一行：楼栋名 · 月租金。第二行：期数 · 在租 n/N · 出租率条 · 状态。  | 需改 | M | frontend/src/views/buildings/BuildingsView.vue:306-316 |
| §3 栅格套用规则·租户管理 | 第一行：租户名 · 月租金合计。第二行：所在楼栋 · 在租单元数 · 合同状态。  | 存疑 | M | frontend/src/views/tenants/TenantsView.vue:271-281 |
| §3 栅格套用规则·合同管理 | 第一行：租户名 · 月租金。第二行：合同号 · 起止日期 · 状态（含「整体承租」徽标）。  | 存疑 | M | frontend/src/views/contracts/ContractsView.vue:377-392（.cl-item 列表项）；几 |

#### WideCardPhone（宽表 → 卡片 · 手机；月度台账 · 27 列 · 390 × 844）  — 共 26 块，已符合 11，要动 15　→ P3

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §1 屏样2·改后 卡片列表 @390 | 一行一张卡、4 个字段，同一屏从 1.5 列变 5 户。卡定高 88，padding 0 4px，底 1px divider，列内 gap 5；第一行=租户名 14/500 省略号 + 右端 | 新建 | M | 无（台账无卡片形态）；最近的同类是 frontend/src/styles/mx-list.css:118-136 .mx-rowcard（ |
| §1 屏样3·改后 编辑态 | 编辑锁按下 → 按钮换成「编辑中」+ 锁图标（outline / t44 / padding 0 14px / gap 6），提示行填字。卡片列表本身一个像素不变——编辑态不换形态、不藏入口 | 需改 | S | frontend/src/views/ledger/LedgerWideTable.vue:364-378（编辑模式按钮三态同宽 min-w |
| §1 注释①·顶栏第一行怎么收 | 桌面「返回钮 + 账册名 + 年月」三件，手机第一行 = 屏名（16/600 省略号）+ 副标题「8 户 · 27 列」12px --text-muted + 右端一个 126px 定宽日期 | 需改 | M | frontend/src/views/ledger/LedgerWideTable.vue:275-282（现在是 34x34 返回钮 +  |
| §1 注释②·顶栏第二行工具行 | 第二行 = 搜索（flex 撑满，44 高 / 16px 字，radius full，--surface-card 底，左内嵌放大镜）+ 编辑锁按钮（outline t44）+ ⋯ 溢出菜单 | 需改 | M | frontend/src/views/ledger/LedgerWideTable.vue:391-406（现工具条：SearchField |
| §1 注释③·编辑锁不进溢出菜单 | 编辑锁按钮留在第二行不进 ⋯。判据是规范 §11.2「不禁止、不隐藏、不优化」——藏进 ⋯ 就是隐藏。它是这一行里唯一带文字的按钮。  | 需改 | S | frontend/src/views/ledger/LedgerWideTable.vue:361-378（编辑模式入口，带 entry:e |
| §2 字段表·第3行 本月收款 | 来自 fixedRight[1]。理由：和应收成对，手机上翻台账最常回答的问题是「这户收齐没有」。卡上进第三行「已收 ¥x · 收缴 n%」11px。  | 需改 | S | frontend/src/utils/ledgerColumns.ts:69（totalCollected, w:104, kind:'nu |
| §2 字段表·第4行 本月结余 | 来自 fixedRight[2] · bal。= 上月结余 + 应收 − 收款。是状态不是明细，所以画成胶囊（已结清 / 欠 ¥x / 余 ¥x），颜色走令牌：正橙（--hue-orange | 需改 | S | frontend/src/utils/ledgerColumns.ts:70（balanceEnd, kind:'bal'）；fronten |
| §2 字段表·第5行 7月结余（上不了卡） | fixedLeft[1]。上不了卡：它是上下文，而且已经折进「本月结余」里了 → 进抽屉的头部小字（图上抽屉里写「7月结余 0」）。  | 需改 | S | frontend/src/utils/ledgerColumns.ts:30（balancePrev, label 是 prev+'月结余' |
| §2 字段表·第6行 备注（上不了卡） | fixedRight[3]。上不了卡：长度不定（150px 列宽在桌面上都常被截），折行会破 88 定高 → 进抽屉的头部，并且在抽屉里给全文不截。  | 需改 | S | frontend/src/utils/ledgerColumns.ts:71（note, w:150, kind:'note'）；front |
| §3 抽屉骨架·S 档全屏化 | S 档覆盖层全屏化（规范 §4.4）：头 52（标题 + ✕，padding 0 6px 0 16px，标题 16/600 省略号，底 1px divider）、体 flex:1 内滚（pa | 需改 | M | frontend/src/components/fp/FPDrawer.vue:185-196（S 档全屏接管已有）；:120-127（头  |
| §3 屏样4·默认 只列有值的 12 项 | 头部三张 FPStat 横排 grid-template-columns:repeat(3,1fr) gap 8，S 档尺寸 .fs.s = radius 12 / padding 10px | 需改 | L | frontend/src/views/ledger/LedgerTenantDrawer.vue:104-108（三张 FPStat，现 g |
| §3 屏样5·切到「全部 21」 | 段控一点，空口袋全部展开，值写「—」。图上第一组「租金」展开成 6 行（厂房租金 86,400 / 厂房企业管理服务费 12,960 / 商铺、宿舍租金 — / 宿舍租金 — / 宿舍配套费 | 需改 | S | frontend/src/views/ledger/LedgerTenantDrawer.vue:79（items = g.cols.fil |
| §3 侧卡·抽屉的排法 5 条 | ① 头部三张 FPStat 用 fp/FPStat 不新造组件，S 档收到 3 列；② 一行上下文 = 7月结余 · 备注 · 右端「有值 / 全部」段控，备注在这里给全文不截；③ 6 个分 | 需改 | M | frontend/src/components/fp/FPStat.vue（①已有组件）；frontend/src/views/ledger |
| §3 侧卡·要你拍板：默认 12 还是 21 | 抽屉默认显示「有值的 12 项」还是「全部 21 项」？稿里推荐默认有值：典型租户只占 12 个口袋，默认全部会让 9 行破折号把真正有钱的几行推到屏幕外。段控记不记住上次的选择，也一并定。 | 存疑 | S | 无（两个默认都还没实现） |
| §3 侧卡·横滚宽表不删，降级成第二形态 | ⋯ 菜单里留一条「按表格查看」，点开就是现在那张横滚表。理由：核对模板列序、对着 Excel 逐列比的时候表格仍是对的形态。卡片是默认，不是唯一。  | 新建 | M | frontend/src/views/ledger/LedgerWideTable.vue:318-321（FPMoreMenu，现 2 项 |

#### WideCardVariants（卡片密度：三选一）  — 共 26 块，已符合 12，要动 14　→ P3

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| 板头·三选一决定 | 同一张表·同一批数据·390 宽三档对照；三种都合规(都 ≥44 触达、字号都在阶梯上、定高都能让骨架卡对齐)，差别只有「一屏看几户 vs 一眼能看清几个数」；请挑一种，后面所有 B 级表按 | 存疑 | S | 无 |
| §1 手机屏样·损益附表 @390 | 390 宽手机壳；顶栏 ← + 标题「损益附表」+ 搜索 + 铃铛(角标 2)；页标题 16px/600「损益附表 · 2026」+ 12px 灰副题「一期公司 · 17 列 · 1702p | 需改 | S | C:/financial_dashboard/demo3/frontend/src/components/shell/mobile/Mobi |
| §1 右侧盒·这就是要卡片化的理由 | ① 台账那张(第 06 块)是列太多：27 列铺 2918px。② 损益附表是标签太宽，收敛 sticky 救不了(sticky 那根本身最宽)。③ 两张走同一条路但落不同密度：台账标准 8 | 需改 | M | PnlTable.vue:161 (.pt-table width:max-content)、:167/:174-176 (min-widt |
| §2 密度档·紧凑 64px | 卡高定高 64px，两行。第一行：租户名 14px/500 单行省略号 + 应收 mono 14px/600 贴右端。第二行：「收」灰字 12px + 实收 mono 12px + 结余贴最 | 需改 | M | C:/financial_dashboard/demo3/frontend/src/styles/mx-list.css:118-134 ( |
| §2 密度档·标准 88px（图上标「推荐」） | 卡高定高 88px，三行。第一行：租户名 14px/500 + 状态胶囊贴右(高 22px、6px 圆点、12px 字、subtle 内边距 0 2px；已结清=--ok-soft/--ok | 需改 | M | styles/mx-list.css:118-134 (.mx-rowcard 72px 两行，无第三行、无 20px 大字位)；compo |
| §2 密度档·带收缴条 96px | 标准 88 的三行不动，底部再加一条 4px 收缴进度条(收款 ÷ 应收)：轨 --ink-100、条 --fill-blue、border-radius 999px、margin-top  | 新建 | M | 无 |
| §2 蓝框·我推荐标准 88 | ① 台账这屏的主角是一个数(本月应收合计)，紧凑档把三个数放同一号字里等于说三个一样重要。② 结余画成胶囊而不是数字：它本来就是三态(已结清/欠/余)，胶囊比「0」更快。③ 96 的条好看， | 存疑 | S | 无 |
| §2 硬条件④·金额右对齐/mono/tabular-nums/负号 − | 金额右对齐、mono、tabular-nums、负号用 −(U+2212)。  | 需改 | S | utils/money.ts:7-11 (fpWan 负号统一 Unicode −)；utils/finFmt.ts:2 (报表 2 位小数 |
| §3 小节头 + 导语·模板落在哪 | 「套」= 用同一个卡片模板 + 同一个抽屉壳，只换字段映射。模板做进 FPSortableTable / FPLedgerTable 的 S 档分支，调用方只给 4 个字段名，不逐屏手写版式 | 存疑 | L | components/fp/FPSortableTable.vue:247-277 (S 档卡片分支 + #card 具名插槽，已有兜底映射 |
| §3 行1·月度台账 27 → 标准 88 | 月度台账，27 列，套「标准 88」；卡上四个字段：租户 · 本月应收合计 · 本月收款 · 本月结余；理由：钱是主体，应收要能一眼比大小，给它一整行。  | 新建 | M | views/ledger/LedgerWideTable.vue:408 (挂 FPLedgerTable)；components/fp/F |
| §3 行2·附表10 销售收入 25/20 → 标准 88 | 附表10 销售收入，25 / 20 列，套「标准 88」；卡上四个字段：租户 · 本年合计 · 当月计费 · 状态；理由：与台账同构(同一套 BookTemplate 机制)，形态跟着一样。 | 新建 | M | views/sales-income/S10Table.vue:356-366 (现只有 §5.3 sticky 收敛)；views/sal |
| §3 行3·损益附表(年度矩阵) 17 → 紧凑 64 | 损益附表(年度矩阵)，17 列，套「紧凑 64」；卡上字段：科目细分 · 本年合计 ·(分组名作小字)；12 个月的值进抽屉；理由：一行只有「合计 + 12 个月」，行数多(几十条科目)，密 | 新建 | M | views/reports/pnl/PnlTable.vue:218-230 (现只有 §5.3 sticky 收敛)；views/repo |
| §3 行4·附表12 工资明细 18 → 标准 88 | 附表12 工资明细，18 列，套「标准 88」；卡上四个字段：姓名 · 应发合计 · 实发 · 扣款合计；理由：和台账同一个「应收 / 实收 / 差额」结构，套同一种。  | 新建 | M | views/salary/SalaryTable.vue:278-285 (现只有左 sticky 收敛到姓名一根)；views/salar |
| §3 行5·附表11 电费成本/电量 14 → 带收缴条 96 | 附表11 电费成本 / 电量，14 列，套「带收缴条 96」；卡上四个字段：楼栋(或链路) · 本月电费 · 用电量 · 损耗率条；理由：这屏有一个天然的 0–100% 比值(损耗率 / 分 | 存疑 | M | views/elec/ElecTable.vue:394-400 (现按 §5.4 定宽表处理：列/min-width 一根不动，窄了横滚) |

#### ReportPhone（报表屏 · 手机，利润表 390 × 844）  — 共 19 块，已符合 10，要动 9　→ P3

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §1 改后手机屏 @390·表宽424横滚66已推到底 | 数值列 168→120，colgroup 变 136 / 48 / 120 / 120，表宽收到 424；「项目」列 sticky，滚到最右也还在。图里画的是推到底那一帧（内容左移 68px | 需改 | M | frontend/src/components/fin/FinReportTable.vue:72（168 待改 120）、:111-113 |
| §1 右栏box2·改动一：「项目」列 S 档加 sticky | S 档（≤600）给第一列加 sticky。规范 §5.3 写的是「S 档 sticky 只留一根首列 + 表头」，台账那边 FPLedgerTable 已照做，报表表一根都没有。加一根就够 | 需改 | S | frontend/src/components/fin/FinReportTable.vue:111-113（现无首列 sticky，落点在 |
| §1 右栏box3·改动二(拍板)：数值列 168→120 | 168 是桌面为「1,234,567.89」这一级数留的宽度；390 上两列吃掉 336，表宽 520，要横滚 162px 才看得全。收到 120 后表宽 424、横滚只剩 66px，而 1 | 存疑 | S | frontend/src/components/fin/FinReportTable.vue:72（col width:168px）、:13 |
| §1 右栏box4条3·编辑不拦不藏 / 提示行常驻 20px | 编辑按钮留在工具行（图上：14 项 chip 靠左，编辑/导出靠右，同一行，按钮 sm 高 32px），提示行常驻 20px（图上橙色，原文「编辑模式 · 小屏可录入，建议在桌面端操作」，1 | 需改 | M | frontend/src/views/reports/income-statement/IncomeStatementView.vue:39 |
| §2 表第1行·利润表 / 现金流量表 | 形态=科目树四列。做什么：同上——首列 sticky；数值列宽待拍板。  | 存疑 | S | 利润表 frontend/src/views/reports/income-statement/IncomeStatementView.vu |
| §2 表第2行·资产负债表 | 形态=科目树四列 × 2。做什么：.fin-two ≤960 降单列（现状），两张表上下堆叠，各自首列 sticky。  | 需改 | S | frontend/src/views/reports/balance-sheet/BalanceSheetView.vue:34（BS_CO |
| §2 表第3行·科目余额表 | 形态=行→卡片（标准 88）。做什么：它有期初借/期初贷/本期借/本期贷/期末借/期末贷 6 个数值列，属第 07 块的 B 级表。  | 存疑 | L | frontend/src/views/reports/trial-balance/TbTable.vue:43-47（colgroup 96 |
| §2 表第5行·损益附表 | 形态=行→卡片（紧凑 64）。做什么：见第 07 块——12 个月的值进抽屉。注意它不是 colgroup 表（PnlTable 用的是 sticky 类），可以卡片化。  | 存疑 | L | frontend/src/views/reports/pnl/PnlTable.vue:161（width:max-content，确无 c |
| 手机屏页头·日期选择器 + 副标题(图上有，板上文字未提) | 页头右侧放一个定宽 126px 的日期字段（年/月，带日历图标，S 档高 44px 触达）；标题 16px semibold，副标题 12px var(--text-muted)，内容为「一 | 存疑 | M | frontend/src/views/reports/income-statement/IncomeStatementView.vue:34 |

#### FormPhone（表单与浮层·手机，画布 390×844）  — 共 15 块，已符合 6，要动 9　→ P4

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §1 小节·全屏化判据段 | 规范 §4.4 的「S 档覆盖层全屏化」目前只覆盖 FPDrawer / FpImportModal / FPSideDrawer 三个标准件；各屏自带的居中弹卡（新增楼栋、新增账册、批量删 | 需改 | L | 已覆盖三件：components/fp/FPDrawer.vue:185-199、components/import/FpImportMod |
| §1 屏样B·改后 全屏 sheet @390 | 头 52 + 体 flex:1 内滚 + 脚贴底 + safe-area 34。输入框 44 高 / 16px 字。主按钮撑满、取消定宽 108 —— 拇指够得着的是右边。  | 需改 | L | 壳照抄 components/fp/FPDrawer.vue:185-199（≤600 全屏分支）；头高对照 components/ds/D |
| §1 卡·改动：把全屏化推到「带表单的弹窗」 | 判据不是「是不是弹窗」，是里面有没有输入控件。有输入 → S 档全屏 sheet（输入要 44 高 / 16px，居中卡装不下）；只有一句话 + 两个钮 → 仍是居中小卡。SaveConfi | 需改 | M | 判据两侧的样本：有输入 → views/buildings/BuildingNewDialog.vue:133、views/contract |
| §1 卡·错误位 | 错误说明在输入框下方，12px，--hue-red，带一个 13px 图标。不用 toast —— toast 会飘走，而错误要一直在那儿直到改对。错误行不占预留位：一次性表单出错时整块下移 | 存疑 | M | 当前错误行：components/ds/Input.vue:132-136（.ds-in-msg min-height:14px; --fs |
| §1 卡·底部操作条 | 脚部 padding: 10px 16px 34px（34 = safe-area-bottom），底色 --surface-raised，顶边一条 divider。主按钮 flex:1 撑 | 需改 | M | 现状脚部：views/buildings/BuildingNewDialog.vue:145（.lg-dlg-f justify-conte |
| §2 小节·下拉与日期都从底部升起 | 下拉主力是自绘 ds/Select（贴附 popover）。贴附 popover 在 390 上会顶出视口，所以 S 档换底部面板 —— 和 DatePicker 用同一套壳：把手 36×5 | 需改 | M | 壳的来源 components/ds/DatePicker.vue:673（.dp-hdl 36×5）、:674（.dp-sh height |
| §2 屏样C·ds/Select 现状 @390 | 记录现状：贴附 popover。字段在右半屏（工具行里的「全部状态」就是）时，面板宽 220 从 left 214 起算 = 右缘 434 > 视口 390，右边 44px 出屏；选项行高  | 需改 | M | components/ds/Select.vue:296-314（position:absolute; top:calc(100% + 6p |
| §2 屏样D·ds/Select 改后 @390 | 底部面板，选项行高 52、字号 16、选中右端打勾，面板最高 60dvh 超出内滚。壳同 DatePicker：把手 36×5、标题行 52（左标题右 ✕）、底部 34 安全区。  | 新建 | M | 无（components/ds/Select.vue 全文 grep sheet/dvh/bottom:0 命中 0 次，只有贴附分支）。壳 |
| §2 卡·Select 要补的 | S 档补一个和 DatePicker 同宽的底部面板分支：选项行高 52（>44，一排选项要好戳）、字号 16、选中项右端打勾、面板最高 60dvh 超出内滚。触发字段那半边字号已经做了；没 | 需改 | M | 已做的字号桥 components/ds/Select.vue:376-378（@media (max-width:600px) { --d |

#### AnaPhone（分析屏 · 手机 / 经营驾驶舱 390×844 / 画板 1500×1949）  — 共 20 块，已符合 16，要动 4　→ P1

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| 手机屏样 B·图表区 @ 390 | 图高 300→260；x 轴只画 9月/11月/1月/3月/5月/7月（自动避让，隔一个）；气泡「2026-08 园区利润 −¥655.3万」钳在图内不出血；卡头保留图例（营业收入 / 成本 | 存疑 | M | components/ana/anaChartHeight.ts:10（300→260）；components/ana/AnaEChart. |
| 平板 4 列·本块唯一真改动 | .av2-kpis 在平板档从 auto-fit 改定 4 列；ana.css 现在没有 960 块。规格画在第 13 块（TabletContent）。  | 需改 | S | components/ana/ana.css:131（现状 auto-fit minmax(120px)）；ana.css:138（1280 |
| §2 表行2·order −1 / .av2-s8·.av2-core | order −1 给 .av2-s8 / .av2-core；这屏上是「营业收入与成本费用(月)」。理由：桌面上占 8 栏的那张图就是这屏的主图，窄屏里它还是主图。  | 存疑 | S | components/ana/ana.css:192；views/analysis/CockpitView.vue:480（.av2-car |
| §2 表行3·(不写) DOM 序 | 不写 order，其余按 DOM 序：收入构成 → 园区利润 → 其余。>600 不写 order，桌面零差异。  | 存疑 | S | views/analysis/CockpitView.vue:499（s4 收入构成 · 本月）、:511（s12 收入趋势 · 下月预测） |

#### KpiNarrow（三个指标卡的窄屏形态，v0.15.0 新东西的洞）  — 共 34 块，已符合 19，要动 15　→ P4

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §1 图B M 768·现状 repeat(4) | 每格 151，扣 padding 40 后内容宽 111。放不下的是标签不是数字：「营业收入(本月)」7 汉字≈98 + 图标 18 + 缝 8 = 124 > 111，标签被截成「营业收入 | 需改 | S | frontend/src/views/reports/balance-sheet/BalanceSheetView.vue:555 + :5 |
| §1 图C M 768·改后 repeat(2) | 每格 315，padding 14 后内容宽 287。四张卡排成 2×2。字号统一 24（不降）。  | 需改 | M | BalanceSheetView.vue:568-571（在既有 @media(max-width:960px) 里加 .fin-kpis{ |
| §1 图D S 390·repeat(2) | 每格 173，padding 14 后内容宽 145。标签 124 < 145、数值 104 < 145，两样都放得下，字号一个不降。  | 需改 | S | 列数已有：BalanceSheetView.vue:573-575、IncomeStatementView.vue:522-524、Tria |
| §2 图F M 768·现状 auto-fit→5列 | 容器 642 宽下 auto-fit 排 5 列，每格 122。7 张瓦排成 5+2，第二排右边空三格；「在租租户(计数口径)」标签在 98 内容宽下截成「在租租户(计…」。  | 需改 | S | frontend/src/components/ana/ana.css:131（基础规则，无 M 档覆盖）；:138/:139 的 1280 |
| §2 图G M 768·改后 repeat(4) | 定 4 列，每格 154。7 张排成 4+3，参差小一半，标签不截。  | 需改 | S | frontend/src/components/ana/ana.css:139 之后、:179 之前新开 @media(max-width: |
| §3 落点声明·FPStat 用在哪 | fp/FPStat 的落点 = 各屋抽屉的头部小卡（台账行抽屉、楼栋详情、合同详情）。  | 存疑 | S | frontend/src/views/ledger/LedgerTenantDrawer.vue:104（inline grid repea |
| §3 图L S 390·改两列+通栏 | 上排两张每格 175，padding 不动、内容宽 147 > 96，20 号保得住；结余一张通栏。代价是多占 46px 高，且三个数不再并排。  | 存疑 | M | 若采纳需改 LedgerTenantDrawer.vue:104 的内联 grid（repeat(3,1fr) → ≤600 两列 + 第三 |
| §3 橙框·选哪条（要用户点头） | 收 padding 救不了：10/12 只把内容宽从 86 挪到 90，而「¥148,620」在 20 号下要 96。真正的选项两条：① 三列 + 接受 16 号（= 现状机制，useFit | 存疑 | S | 圆角落点：FPStat.vue:35（border-radius:var(--radius-lg)=16）；对齐目标：AnaKpiTile. |
| §4 KpiCard·栅格列数 | XL/L = 4；M 平板 4 → 2「改」；S 手机 = 2。理由：768 上 4 列每格 151，扣 padding 只剩 111；标签「营业收入(本月)」+ 图标 = 124 放不下， | 需改 | M | XL/M 现状 repeat(4)：BalanceSheetView.vue:555 / IncomeStatementView.vue:5 |
| §4 KpiCard·padding | XL/L = 20；M 20 → 14「改」；S 20 → 14「改」。省 12px 给数字。  | 需改 | S | frontend/src/components/ds/KpiCard.vue:140（.kc{padding:20px}，全档写死，无媒体块 |
| §4 KpiCard·内部 gap | XL/L = 12；M = 8「改」；S = 8「改」。管标签 / 数 / 副行三段之间。  | 需改 | S | frontend/src/components/ds/KpiCard.vue:140（.kc{gap:12px}） |
| §4 KpiCard·图标 | XL/L = 18；M = 16「改」；S = 16「改」。跟 padding 一起收，图标不喧宾夺主。  | 需改 | S | frontend/src/components/ds/KpiCard.vue:148（.kc-i :deep(svg){width:18px |
| §4 AnaKpiTile·栅格列数 | XL/L = auto-fit 120；M auto-fit → 4「改」；S = 2。理由：642 宽下 auto-fit 排 5 列、7 张瓦成 5+2 参差；定 4 列是 4+3。  | 需改 | S | frontend/src/components/ana/ana.css:131（auto-fit,minmax(120px,1fr)）、:1 |
| §4 FPStat·栅格列数 | XL/L = 3–4（调用方定）；M = 3；S = 3（或 2+1，待拍板）。台账整行抽屉里就是 3 张（应收 / 收款 / 结余）。  | 存疑 | M | LedgerTenantDrawer.vue:104（repeat(3,1fr) gap:10）；TenantDrawer.vue:166（ |
| §4 FPStat·圆角 | XL/L = 16；M = 16；S 16 → 12「改」。小卡配小圆角，和同屏 AnaKpiTile 的 12 一致。  | 需改 | S | frontend/src/components/fp/FPStat.vue:35（border-radius:var(--radius-lg |

#### Import（导入中心 · 手机，390 × 844）  — 共 27 块，已符合 3，要动 24　→ P4?

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §1 小节·现状诊断 | ImportCenterView.vue 零 @media、零 tier 分支、零 .fp-fluid，现在吃 base.css M↓(max-width:960px) 的屏级地板 min- | 需改 | S | frontend/src/styles/base.css:130；frontend/src/views/import-center/Impo |
| §1 屏样A·现状 @390 | 卡片墙 auto-fill minmax(248px,1fr) 在 800 地板下排 3 列、每列 248px，而 390 视口内容区只有 358px —— 第二列起全在屏外。页头/上传区/ | 需改 | S | frontend/src/views/import-center/ImportCenterView.vue:335；frontend/src |
| §1 屏样B·改后 @390 顶部 | 屏根挂 .fp-fluid 摘地板后：页头两行(标题 20px + 副标题，右侧「下载模板」消失)；上传区竖排；「按数据类型导入」副标题改成「6 类 · 卡片显示最近导入状态」；卡片墙单列， | 需改 | M | frontend/src/views/import-center/ImportCenterView.vue:227-278；frontend |
| §1 屏样C·改后 @390 往下滑 | 卡片墙到底后是「导入记录 · 近 30 天」：6 列表换成 72px 定高行卡，和 mx 列表页同一个 .mx-rowcard，不另写版式。图上 4 张卡：月度台账·2026-08·一期公司 | 需改 | M | frontend/src/views/import-center/ImportCenterView.vue:284；frontend/src |
| §1 表第1行·屏根 | 现状「(无)」→ 改后 class="im fp-fluid"，摘 800px 地板。  | 需改 | S | frontend/src/views/import-center/ImportCenterView.vue:227；frontend/src |
| §1 表第2行·页头 | 现状「标题 + 副标题 + 右侧『下载模板』一行」→ 改后 S 档副标题截短、「下载模板」收进 ⋯（它现在是 disabled 的占位钮）。图上改后屏副标题实文是「所有 Excel 数据的统 | 需改 | S | frontend/src/views/import-center/ImportCenterView.vue:228-237(.im-head |
| §1 表第3行·上传区 .im-drop | 现状：横排，图标 52、两行字，padding 24 → 改后：竖排，图标 40、标题一行、说明另起一行，padding 16。图上改后屏说明文案缩成「在下面选类型 → 就地上传 → 按模板 | 需改 | S | frontend/src/views/import-center/ImportCenterView.vue:241-247(模板)；:327 |
| §1 表第4行·卡片墙 .im-grid | auto-fill minmax(248px, 1fr) → minmax(min(100%, 248px), 1fr)，规范 §5.5，防容器比 min 值还窄时溢出。  | 需改 | S | frontend/src/views/import-center/ImportCenterView.vue:335 |
| §1 表第5行·磁贴内部 | 现状 padding 16 / gap 12 / 上传钮 sm 28 高 → 改后 padding 12 / gap 10 / 上传钮 44 高 16px 字。  | 存疑 | M | frontend/src/views/import-center/ImportCenterView.vue:336(.im-tile pad |
| §1 表第6行·导入记录表 | 现状 FPSortableTable 6 列 → 改后走 S 档 #card 分支。这屏现在没给 #card 映射，会走兜底(第一列主字段 + 二三列次级)，要补本屏映射。  | 需改 | M | frontend/src/views/import-center/ImportCenterView.vue:284(调用处，无 #card  |
| §1 蓝框·导入记录的 #card 映射 | 第一行：类型 · 范围（如「月度台账 · 2026-08 · 一期公司」，省略号）+ 右端 成功 / 失败数（有失败才出现红色那半截）。第二行：时间 + 右端 操作人。72px 定高，和 m | 存疑 | M | frontend/src/styles/mx-list.css:118-134(.mx-rowcard 72px / -main / -su |
| §1 橙框·这屏本来被规范判为「不再迁移」 | 规范 §11.1 把导入中心列在「明确不做」那一层（零 S 档投入，只读兜底）。本稿把它拉回来，理由：它是层首页级别的入口，且「上传一个文件」手机上做得到。但只做到「选类型 + 起导入」—— | 需改 | S | docs/design/RESPONSIVE-LAYOUT-SPEC.md:318(「不再迁移」名单原文)；frontend/src/com |
| §2 小节·进度这件事产品里一件都没有 | 任务书点名的四件里「进度」产品里一件都没有：FpImportModal.vue 全文 0 处 spin / busy / pending，解析是一个 await、期间屏上不变；「导入 N 条 | 新建 | L | frontend/src/components/import/FpImportModal.vue:159-198(handleFile)；: |
| §2 屏样A·现状 选完文件到解析完 | 412 行的抄表表解析要几秒，这几秒里屏上一个像素都不变 —— 用户不知道它在动还是卡了，最常见的反应是再点一次。图上红字：「没有上传中 / 解析中 / 校验中，解析完才一次性冒出总数」。  | 需改 | M | frontend/src/components/import/FpImportModal.vue:175-178(await readAoa |
| §2 屏样B·改后① 读取中 | 文件片：park-2026-09.xlsx / 2.4 MB · 3 个工作表 / 右侧「换一个」。进度槽常驻 min-height 58：标题「读取文件」+ 右端「40%」+ 进度条 +  | 新建 | M | frontend/src/components/import/FpImportModal.vue:236-244(页签)；:246-257( |
| §2 屏样C·改后② 按模板列校验中 | 进度槽标题「按模板列校验」+ 右端「78%」+ 下行「园区抄表模板 14 列 · 已过 322 / 412 行」。三步清单：读取文件 ✓完成 / 解析工作表 ✓完成 / 3 按模板列校验(蓝 | 新建 | M | frontend/src/components/import/FpImportModal.vue:270-274(模板列顺序，templat |
| §2 屏样D·改后③ 结果 | 标题「导入完成，有 6 行未导入」+ 副行「park-2026-09.xlsx · 412 行」。三档分开：✓ 成功写入 406 / ⊘ 未导入 6（可展开，红）/ ⓘ 提示（已导入，仅需知 | 需改 | M | frontend/src/components/import/ImportResultToast.vue:30-86(卡体)；:39-42( |
| §2 蓝框第1条·分三步，不是一根笼统的条 | 读取文件 → 解析工作表 → 按模板列校验。这三步在源码里本来就是分开的(handleFile → parseWorkbook → 各屏 parseRow)，只是没往屏上说。手机上网络和 C | 新建 | L | frontend/src/components/import/FpImportModal.vue:159(handleFile)；:95(r |
| §2 蓝框第2条·百分比只在算得出来的那一步给 | 校验是逐行的、有分母(412 行)；读大文件也有分母。解析工作表这一步没有分母 —— 那一步只显「解析 3 个工作表」不显百分比，不编一个假的。  | 新建 | M | frontend/src/components/import/FpImportModal.vue:176(readAoaWorkbook 返 |
| §2 蓝框第3条·槽常驻不插拔 | min-height 58 恒占位，空闲时是空的。不这么写的话，进度条一出现就把下面的预览表往下顶 58px。  | 新建 | S | frontend/src/components/import/FpImportModal.vue:380-381(.fpimp-msgs m |
| §2 蓝框第4条·取消要能点 | 进行中时脚部只剩一个「取消导入」，通栏 44 高。  | 需改 | S | frontend/src/components/import/FpImportModal.vue:335-341(.fpimp-f 两钮各  |
| §2 橙框第1条·整个文件读不了 | 不是 xlsx / 损坏：进度槽换成红字一行「文件解析失败：…」，三步清单停在第一步。源码里 err 这条路已经有了，只是现在没有进度槽可停。  | 需改 | S | frontend/src/components/import/FpImportModal.vue:288(.fpimp-msg err)；: |
| §2 橙框第2条·解析出来但一行都不合格 | 走汇总屏，「导入 0 条」按钮 disabled，消息槽写清是哪一列没对上。  | 需改 | S | frontend/src/components/import/FpImportModal.vue:337-340(:disabled="!r |
| §2 橙框第3条·部分行不合格（最常见） | 照导不误，结果屏分成「成功写入 406 / 未导入 6 / 提示 2」三档。未导入的逐行给行号 + 原因，并给一个「导出未导入的 6 行」—— 让用户拿着这 6 行回 Excel 改，而不是 | 需改 | M | frontend/src/components/import/ImportResultToast.vue:39-42(两档 stat)；:6 |

#### Main（经营分析屏 · 手机端体验 · 导读板）  — 共 28 块，已符合 11，要动 17　→ P0

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §1 洞表·1级 hover-only 39 张图 | 「数字只在 hover tooltip 里，不 hover 一个数都看不到」= 39 张图。自绘 12 张(PvDayChart/PvYieldBand/PvAnchorBars/PvCon | 需改 | L | frontend/src/views/analysis/PvDayChart.vue:24,110,167；frontend/src/vie |
| §1 洞表·2级 省略号+title 38 处 | 「hover 才出的提示(省略号 + title)」= 38 处。KPI 瓦 37 枚：数值降到 16px 仍超 → 省略号 + title(图标 AnaKpiTile.vue:31,41) | 需改 | M | frontend/src/components/ana/AnaKpiTile.vue:29,38-39,52,54-55；frontend/ |
| §1 洞表·3级 .hint-desk 藏话术 32 次=16 卡片处 | 「话术被 CSS 藏掉但功能还在」= 本稿 8 屏 32 次 = 16 个卡片处（灰字另注：全层 15 屏 56 次 = 29 处）。.hint-desk 在 ≤600 整段 display | 需改 | M | frontend/src/components/ana/ana.css:195；frontend/src/views/analysis/Co |
| §1 洞表·4级 dataZoom.slider 被剔 1 处 | 「交互被移除」= 1 处。AnaEChart.vue:35-43 在 S 档剔除所有 dataZoom.slider。全仓只有一处用它：cockpit.logic.ts:509 驾驶舱主图。 | 需改 | S | frontend/src/components/ana/AnaEChart.vue:35-44；frontend/src/views/ana |
| §1 洞表·独有 说的和能做的对不上 1 处 | 光伏分栋屏整屏 0 个 .hint-desk，所以 PvResidualHeat.vue:101 卡头那句「悬停看数」在手机上照常显示 —— 而手机根本没有 hover。同屏另两句「点芯片换 | 需改 | S | frontend/src/views/analysis/PvResidualHeat.vue:101 |
| §1 红框·一句话的根因 | 这 13 个自绘图组件里，零个 @media、零个宽度分支 —— 全部只有一套「桌面」几何，窄屏下靠容器把 SVG 等比压扁。11px 的轴标签在 336 宽的卡里被压成 7–8px，而中文 | 存疑 | S | frontend/src/components/ana/useWidth.ts:1-22；frontend/src/styles/base. |
| §1 蓝框·硬要求1 主线 journey | 主线 journey =「在外面临时查一个数」：开会、谈判、路上被问到，掏出手机查一个具体数字或给对方看一眼。稿把「最快几步拿到那个数」当主线设计。→ 第 02 / 03 块。  | 新建 | L | 无 |
| §1 蓝框·硬要求2 自绘图重画手机版 11px 不缩 | 自绘 SVG 图在手机上重画手机版：减数据点 / 换图种 / 竖排，字号保住 11px 不缩。不许整幅 viewBox 等比缩小。→ 第 08 / 09 / 14 块。  | 新建 | L | frontend/src/components/ana/anaChartHeight.ts:12（注释「⚠ 只管 AnaEChart:自绘图 |
| §2 8屏索引·① 光伏分栋分析 | PvMeterAnaView.vue：6 瓦 + 主卡(芯片 34 + 大图 272 + 判据脚 2×16) + 3 档段控 + 档内卡片区(min-height 1200) + FPDra | 需改 | L | frontend/src/views/analysis/PvMeterAnaView.vue:364,381,532,560,569,580 |
| §2 8屏索引·② 电费成本分析 | ElecAnalysisView.vue：无 KPI · 模拟数据条 + 结论条 4 句 + 3 张 AnaEChart(4线×12 / 堆叠9段×12 / 双轴×12)。最难：12 个月  | 需改 | M | frontend/src/views/analysis/ElecAnalysisView.vue |
| §2 8屏索引·③ 充电桩分析 | ChargingAnalysisView.vue：工具槽段控 + 年份 DatePicker · 结论条 4 句 + 4 张 AnaEChart。最难：4 张图全靠 tooltip，一个数都 | 需改 | M | frontend/src/views/analysis/ChargingAnalysisView.vue；frontend/src/comp |
| §2 8屏索引·④ 经营驾驶舱 | CockpitView.vue：7 瓦 + 期间横幅×2 + 结论条 + 9 个块(含自绘预测 280、5 列回测表、欠费模态)。最难：块最多；手机上最常被查的也是它。  | 需改 | L | frontend/src/views/analysis/CockpitView.vue:3；frontend/src/views/analy |
| §2 8屏索引·⑤ 园区维度 | ParkView.vue：4 瓦 + TreeMap 300 + 3 列表 + 环图 + 散点(mini 段控) + 出租率数字卡 + 面积转换。最难：TreeMap 块内 label 11 | 需改 | M | frontend/src/views/analysis/ParkView.vue；frontend/src/components/ana/e |
| §2 8屏索引·⑥ 租户维度 | TenantPortfolioView.vue：6 瓦 + 帕累托 Top20 + 环图 + 箱线(mini 段控) + 续约风险(空态) + 生命周期条 + 7 列×12 行表。最难：To | 需改 | M | frontend/src/views/analysis/TenantPortfolioView.vue；frontend/src/compo |
| §2 8屏索引·⑦ 到期墙 | ExpiryView.vue：9 瓦 + 8 季柱 + 租金带 280(自绘) + 4 列表 + 续签 112(自绘) + 4 列表 + Pareto + 环图 + 7 列表。最难：9 瓦两 | 需改 | L | frontend/src/views/analysis/ExpiryView.vue；frontend/src/components/ana |
| §2 8屏索引·⑧ 光伏回收 | PvRoiView.vue：5 瓦 + 爬坡图(全仓唯一 calloutMark 气泡「回收 2029-04」) + 进度数字卡 + 分期柱 + 4 列表(max-height 210)。最 | 需改 | M | frontend/src/views/analysis/PvRoiView.vue；frontend/src/components/ana/ |
| §4 红线·口径说明不许为排版删内容 | 口径说明(判据脚这类)不许为了排版删内容 —— 放不下就换排法。  | 需改 | S | frontend/src/views/analysis/PvMeterAnaView.vue:564,569 |

#### Rules（分析屏手机体验-2026-09-20 / Rules.png + Rules.dc.html）  — 共 79 块，已符合 15，要动 64　→ P0

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §1 自绘图表·PvDayChart | 桌面 236 固定 → 手机 200；折线 + 带；数据点 逐日 31 → 逐周中位 5；备注「换刻度是全稿唯一一处减点」  | 需改 | M | frontend/src/views/analysis/PvDayChart.vue:20（H=236, padL=44, padR=14, |
| §1 自绘图表·PvYieldBand | 桌面 250 固定 → 手机 210；折线 + 带；12 点不变；x 标签隔一标 | 需改 | S | frontend/src/views/analysis/PvYieldBand.vue:16（H=250, PL=44, PR=62, PT |
| §1 自绘图表·PvAnchorBars | 桌面 8 + n×26 + 34 → 手机 8 + n×30 + 34；横条；13 → 12（在网）；备注「行高抬到触点；值直标行尾」  | 需改 | M | frontend/src/views/analysis/PvAnchorBars.vue:17（PL=96, NAME_X=86, RIGH |
| §1 自绘图表·PvLedgerScatter | 桌面 固定 300×334 → 手机 量容器宽，正方形绘图区；散点；13 点不变；备注「现在写死，必须拆」  | 需改 | M | frontend/src/views/analysis/PvLedgerScatter.vue:15（SQ=300, PL=40, PT=1 |
| §1 自绘图表·PvConsumption | 桌面 272 固定 → 手机 230；堆叠柱 + 右轴线；12 不变；备注「图例挪到图下」 | 需改 | S | frontend/src/views/analysis/PvConsumption.vue:16（H=272, PL=46, PR=46,  |
| §1 自绘图表·PvRevenueBars | 桌面 6 + n×27 + 26 → 手机 6 + n×30 + 26；横堆叠条；13 → 12；备注「同 AnchorBars」  | 需改 | M | frontend/src/views/analysis/PvRevenueBars.vue:16（PL=104, RIGHT=84, TOP |
| §1 自绘图表·PvAlphaBars | 桌面 n×22 + 14 → 手机 n×30 + 14；双向条 + 淡带；13 → 12；备注「行可点，22 太窄」  | 需改 | M | frontend/src/views/analysis/PvAlphaBars.vue:23（ROW_H=22）、:82（height =  |
| §1 自绘图表·PvResidualHeat | 桌面 格 clamp(28,·,56) 行 28 → 手机 格宽钉 28、栋名列 sticky、格区横滑；热力格；13×12 = 156 不变；备注「横滑 94px 到底，零信息损失」  | 需改 | M | frontend/src/views/analysis/PvResidualHeat.vue:42（cw = max(28, min(56, |
| §1 自绘图表·PvQualityGrid 月档 | 桌面 格 59×64 → 手机 格 44×48；日历格；数据点不变；备注「7×44 + 6 gap + 行头 22 = 334 ≤ 336」  | 需改 | S | frontend/src/views/analysis/PvQualityGrid.vue:57（非 compact 分支 {cw:59,  |
| §1 自绘图表·PvQualityGrid 年档 | 桌面 格 12×12 无字、横滚 53 周 → 手机 12 行月条，点月展开到天；图种栏写「换图种」；365 → 12 行 + 下钻；备注「全稿唯一一处换图种」  | 新建 | L | frontend/src/views/analysis/PvQualityGrid.vue:55-57（compact = weeks >  |
| §1 自绘图表·PvAcfBars | 桌面 138 固定 → 手机 130；柱；14 不变；备注「标签隔一标」  | 需改 | S | frontend/src/views/analysis/PvAcfBars.vue:20（H=138, PAD_L=30, PAD_R=8, |
| §1 自绘图表·PvNullHist | 桌面 138 固定 → 手机 130；直方图；12 不变；备注「标签隔一标」  | 需改 | S | frontend/src/views/analysis/PvNullHist.vue:21（H=138, PAD_L=30, PAD_R=8 |
| §1 自绘图表·PvDriftChart（抽屉） | 桌面 300 固定 → 手机 240；折线 + 变点线；31 不变；备注「标签隔 5 标」  | 需改 | S | frontend/src/views/analysis/PvDriftChart.vue:19（H=300, padT=14, padB=2 |
| §1 自绘图表·PvControlChart（抽屉） | 桌面 250 固定 → 手机 210；控制图散点；31 不变；备注「超范围点半径 4，其余 2.6」  | 需改 | S | frontend/src/views/analysis/PvControlChart.vue:20（H=250, padT=14, padB |
| §1 自绘图表·PvBetaChart（抽屉） | 桌面 200 固定 → 手机 180；逐月点图 12 槽；12 不变；备注「缺的槽照写『投产前/不足/未到』」  | 需改 | S | frontend/src/views/analysis/PvBetaChart.vue:19（H=200, padT=16, padB=30 |
| §1 自绘图表·AnaRentBandChart | 桌面 280 · 最小字号 10 → 手机 240 · 字号 11 · padL 54→40；折线 + 带；12 不变；备注「全稿唯一——处字号低于 11」  | 需改 | M | frontend/src/components/ana/AnaRentBandChart.vue:33（padL:54, padR:52,  |
| §1 自绘图表·AnaForecastChart | 桌面 280 → 手机 240；折线 + 预测区间；12 不变；备注「区间上下沿进读数句」  | 需改 | M | frontend/src/components/ana/AnaForecastChart.vue:37（box padL:52, padR: |
| §2 断点写在组件里·narrow computed | 13 个自绘组件全部已在用 useWidth(el) 量容器宽，所以断点是一行 computed：const narrow = computed(() => width.value < 42 | 新建 | M | frontend/src/components/ana/useWidth.ts:5（useWidth(init=480)）；13 个消费者， |
| §2 几何三元·每组各挂一个 | 高、行高、padL、标签步长、刻度粒度 各挂一个三元（narrow ? 手机值 : 桌面值）  | 新建 | M | 各自绘图组件的常量行，如 PvDayChart.vue:20、PvAnchorBars.vue:17、PvRevenueBars.vue:1 |
| §2 不加 @media(max-width:600px) | 本稿不加 @media：① 抽屉里三张图视口 390 容器 366（碰巧对），但平板抽屉宽 720 / 视口 768 时视口判「宽」而容器其实也宽；② 真正出错的是桌面上的窄栏 .av2-s | 需改 | S | frontend/src/components/ana/ana.css:138-139（.av2-s4 在 1280 降 6 栏、1100  |
| §2 两处例外用 CSS | PvResidualHeat（DOM 格）与 PvQualityGrid（SVG + DOM 混合）的滚动容器与 sticky 栋名列是纯 CSS，写在组件 scoped 里，不进 ana. | 新建 | S | frontend/src/views/analysis/PvResidualHeat.vue:137-160（scoped .prh-*）、 |
| §3 图种替换·堆叠柱 9 段(费项) | 桌面 堆叠柱 9 段(费项) → 手机 堆叠柱 Top3 + 其余；换的时机：单段占比 < 5% 或段数 > 5；本稿用在 电费 · 总表电费结构  | 新建 | M | frontend/src/views/analysis/ElecAnalysisView.vue:151（图2 总表电费结构堆叠柱） |
| §3 图种替换·堆叠柱 13 段(按桩) | 桌面 堆叠柱 13 段(按桩) → 手机 堆叠柱 按区 3 段；换的时机：有现成的上级分组维度时按它并，不按占比乱并；本稿用在 充电桩 · 桩月度量收  | 新建 | M | frontend/src/views/analysis/ChargingAnalysisView.vue:130（图1 桩月度量收双轴）、: |
| §3 图种替换·多折线 3 家 | 桌面 多折线 3 家 → 手机 1 线 + 范围带；换的时机：同类多序列 ≥ 3 条且关心的是「有没有哪一条明显偏开」；本稿用在 充电桩 · 电表损耗率  | 新建 | M | frontend/src/views/analysis/ChargingAnalysisView.vue:4（图3 电表损耗率月度线，负值红 |
| §3 图种替换·TreeMap 18 块 | 桌面 TreeMap 18 块 → 手机 TreeMap 前 6 块 + 其余一块；换的时机：块内放不下「名字 + 值」两行 11px（约 80×34）；本稿用在 园区 · 楼栋月租  | 新建 | M | frontend/src/views/analysis/ParkView.vue:83-91（treemapOption, type:'tr |
| §3 图种替换·日历格 365 天 | 桌面 日历格 365 天 → 手机 12 行月条 + 点月下钻；换的时机：格数 > 一屏能写字的格数（7 列 × 44）；本稿用在 光伏 · 抄表日历 年档  | 新建 | L | frontend/src/views/analysis/PvQualityGrid.vue:55-57（compact 年档分支） |
| §3 图种替换·折线 31 点(逐日) | 桌面 折线 31 点(逐日) → 手机 折线 5 点(逐周中位)；换的时机：点距 < 6px 且相邻点无独立语义；本稿用在 光伏 · 逐日比值  | 新建 | M | frontend/src/views/analysis/PvDayChart.vue:104-108（xTicks 逐 5 标）、:20（H |
| §3 图种替换·宽表 ≥ 5 列 | 桌面 宽表 ≥ 5 列 → 手机 两行行卡；换的时机：列宽 < 该列最长值的字宽；本稿用在 租户清单 7 列 / 回测表 5 列 / 明细表 4 列  | 需改 | M | frontend/src/styles/mx-list.css:118-134（.mx-rowcard height:72px + .mx- |
| §3 图种替换·居中模态 | 桌面 居中模态 → 手机 整屏 sheet；换的时机：手机上一律；本稿用在 欠费清单 / 板块趋势  | 新建 | M | frontend/src/views/analysis/CockpitView.vue:236-251（segModal 板块趋势）、:29 |
| §4 一屏最多 4 张图常显 | 一屏最多 4 张图常显；超出的进「更多分析」折叠段，标题上写还有几块、分别是什么（不是一个光秃秃的「展开」）  | 新建 | L | 无（全仓 grep「更多分析」「更多指标」零命中） |
| §4 四个固定位置 ①②③④ | 按「站着被问时要的」排，不按重要性排。四个位置固定：① 结论条（不算图）② 主图（.av2-s8 / .av2-core）③ 构成或名单 ④ 一个趋势或一张表。本稿实测：驾驶舱 9 块 →  | 需改 | M | frontend/src/components/ana/ana.css:186-188（.av2-lead order:-2；.av2-s8 |
| §4 KPI 规则 2·常显最多 6 枚(3 行) | 常显最多 6 枚（3 行），超出折叠。到期墙 9 → 4+5、驾驶舱 7 → 6+1  | 新建 | M | frontend/src/views/analysis/AnaShell.vue:226-230（#kpis 插槽 + .anx-kpis） |
| §4 KPI 规则 3·列举型副行最多列 3 项 | 列举型副行最多列 3 项，第 4 项起换成「点看…▾」+ 常驻展开带（不是浮层）  | 新建 | M | frontend/src/components/ana/AnaKpiTile.vue:59（.av2-kpi .d height:32px; |
| §4 KPI 规则 4·不靠 title 传信息 | 不靠 title 传信息。title 只当截断兜底，手机上等于不存在  | 需改 | S | frontend/src/components/ana/ana.css:155-157（.av2-card-h .hint 注释里明写「不给 |
| §4 KPI 规则 5·副行先说为什么没有数 | 副行先说为什么没有数，再说口径（驾驶舱「园区利润」那枚）  | 需改 | S | frontend/src/views/analysis/CockpitView.vue（园区利润 KPI 瓦；未定位到具体行） |
| §4 读数句规则 1·每张图都有 | 每张图都有读数句，默认态不用点就写着东西  | 需改 | L | frontend/src/components/ana/ana.css:161（.ana-read）、:164（.ana-ref） |
| §4 读数句规则 7·「已选 ✕」芯片放 .ana-read 外面 | 「已选 ✕」芯片放 .ana-read 外面，否则它自己那 4~6 字会被算进句长  | 新建 | S | 无（分析屏上没有「已选 ✕」芯片；PvChips.vue:120 的 .chip 是楼栋芯片条，不是已选芯片） |
| §5 点代替悬停·命中带 | 形态：时间轴类按 x 等分 n 条；格类格本身；行类整行。判据/出处：照 PvDayChart.vue:110 已有的「取 x 最近的已过去刻度，不要求对准点」  | 需改 | M | frontend/src/views/analysis/PvDayChart.vue:110-117（onMove 取最近已过去刻度） |
| §5 点代替悬停·图上记号 | 形态：竖线（--pv-tip-hair）/ 空心环（calloutMark）/ 行描边。判据：只标位置不写字，字在读数句里  | 需改 | M | frontend/src/components/ana/anaTheme.ts:242（calloutMark）；竖线现有 frontend |
| §5 点代替悬停·读数句接管 | 形态：整数换成那个点；句首插芯片「已选 7月 ✕」。判据：芯片必须在 <p class="ana-read"> 外面——门禁 anaCopyLint.spec.ts 量的是 .ana-rea | 新建 | M | frontend/src/components/ana/ana.css:161（.ana-read）；.readrow 全仓零命中 |
| §5 点代替悬停·退出 | 形态：点别处 = 换点 · 点 ✕ = 回默认 · 离开这张卡 = 回默认。判据：没有浮层要关  | 新建 | M | 无 |
| §5 点代替悬停·直标(免点) | 形态：≤8 个数据点时值直接写在图元上，11px。判据：柱宽 > 值的字宽 —— 336÷8 = 42 > 5 字符 × 6.6 = 33  | 需改 | M | frontend/src/views/analysis/PvAnchorBars.vue:110-118（值标在行尾，已有雏形）、front |
| §5 不要做成「点击弹 tooltip」 | 点击弹 tooltip 等于把 hover 换成 tap，三个问题一个没解决：手指遮住数据点、浮层要找地方关、不点就仍然一个数都没有。读数句接管把这三件一次解决，而且复用产品已有的两个类，不 | 新建 | S | frontend/src/components/ana/ana.css:161（.ana-read）、:164（.ana-ref） |
| §5 门禁 2·行话 σ | anaCopyLint.spec.ts 的 JARGON 禁 σ / 标准差 / 置信，只豁免 PvLabTable.vue 与 PvMeterAnaView.vue。PvNullHist. | 需改 | S | frontend/src/views/__tests__/anaCopyLint.spec.ts:207-210（JARGON_SRC /  |
| §5 门禁 3·hint 棘轮 | HINT_MAX=24、超标处数有基线 HINT_OVER_BASELINE=31「只许减少」。.hint-touch 是增量文本，门禁扫源码、两套都算——本稿 14 处 A 类每句加 4~ | 存疑 | M | frontend/src/views/__tests__/anaCopyLint.spec.ts:34（HINT_MAX=24）、:48（H |
| §6 .hint-desk 三分·A 类（14 处） | A 类（14 处）「点击 X 看 Y」→ 加兄弟类 .hint-touch，S 档显它：去掉桌面方位词、「点击」缩成「点」  | 新建 | M | 分析屏 8 屏中含「点击」的 hint-desk 共 28 次 = 14 处，如 frontend/src/views/analysis/P |
| §6 .hint-desk 三分·B 类（1 处） | B 类（1 处）租户箱线「(悬停看租户)」→ 直接删，读数句顶替。另有光伏分栋那处不在 hint-desk 里的「悬停看数」，单独算，见第 01 块「独有」那行  | 需改 | S | frontend/src/views/analysis/TenantPortfolioView.vue（class="hint-desk"> |
| §6 .hint-desk 三分·C 类（1 处） | C 类（1 处）驾驶舱主图「拖选缩放」→ 继续藏；它与 A 共用同一个 .hint-desk，要拆成两个 span  | 需改 | S | frontend/src/views/analysis/CockpitView.vue:391 与 :484（<span class="hi |
| §6 三分的总量·两行 CSS + 16 处 | 14 + 1 + 1 = 16 个卡片处（源码 32 次），实现是两行 CSS + 这 16 处文案，不动布局  | 新建 | M | frontend/src/components/ana/ana.css:193-195（.hint-desk { display:none  |
| §6 触点清单·全部抬到 44 | 工具条 期间段控 / 日期框 / 翻页钮 / 设置钮、屏内段控 .anx-seg、卡头 .anx-seg.mini、芯片 .chip —— 全部抬到 44  | 需改 | M | frontend/src/views/analysis/AnaShell.vue:247（.anx-icobtn 34×34）、:273（. |
| §6 触点清单·日期框字号抬到 16 | 日期框字号抬到 16  | 需改 | S | frontend/src/components/ds/DatePicker.vue:580（.dp-trg font-size: var(- |
| §6 主动多占高度·工具条 74 → 98 | 工具条 74 → 98（+24，且 sticky 每屏常占）——换来四个全屏级控件点得中  | 需改 | M | frontend/src/views/analysis/AnaShell.vue:243（.anx-tools sticky, paddin |
| §6 主动多占高度·光伏判据脚 32 → 64 | 光伏判据脚 32 → 64（+32）——口径说明不许为排版删内容，两列网格放全五条  | 需改 | M | frontend/src/views/analysis/PvMeterAnaView.vue:226（B2 判据脚 §3.3）、:437（固 |
| §6 主动多占高度·带 mini 段控的卡头 20 → 64 | 带 mini 段控的卡头 20 → 64（+44 × 2 处）——园区散点、租户箱线  | 需改 | M | frontend/src/components/ana/ana.css:26-27（.anx-seg.mini padding 2px /  |
| §6 手机上不出现·hover tooltip | hover tooltip 与「悬停看数」话术不出现；谁定的：本稿；理由：没有 hover。读数句顶替  | 需改 | M | frontend/src/views/analysis/PvResidualHeat.vue:101（「悬停看数」裸在 .hint 里）；各 |
| §6 手机上不出现·「右侧/左图/上方」方位词 | 「右侧 / 左图 / 上方」这类桌面方位词不出现；谁定的：本稿；理由：单列堆叠后方位全错  | 需改 | S | frontend/src/views/analysis/ParkView.vue:237/:325（「点击下钻右侧明细」）等 A 类 14  |
| §6 手机上不出现·KPI 瓦 title 当信息通道 | KPI 瓦的 title 兜底当作信息通道不出现；谁定的：本稿；理由：没有 hover。列举型副行改写 + 常驻展开带  | 需改 | M | frontend/src/components/ana/AnaKpiTile.vue:59（.d 两行钳位）、frontend/src/co |
| §7 实施顺序 1·.hint-touch 两行 CSS + 16 处文案三分 | 改什么：.hint-touch 两行 CSS + 16 处文案三分（源码 32 次）；影响：全层 15 屏；在哪块板：05；先做它的理由：最便宜、最快能验；且 B 类那 5 处现在是假话  | 新建 | M | frontend/src/components/ana/ana.css:195（.hint-desk display:none）；15 个屏 |
| §7 实施顺序 2·外壳触点抬 44 | 改什么：外壳触点抬 44（AnaShell + ana.css）；影响：全层 20 屏；在哪块板：05；理由：一处改全层生效  | 需改 | M | frontend/src/views/analysis/AnaShell.vue:247/:273/:296-305、frontend/sr |
| §7 实施顺序 3·读数句铺到全部 AnaEChart（24 张） | 改什么：读数句铺到全部 AnaEChart（24 张）；影响：6 屏；在哪块板：04 / 11 / 12 / 13 / 14；理由：ECharts 那批不用改组件，只在屏侧加两行 <p> + | 需改 | L | frontend/src/components/ana/ana.css:161/:164/:168（.ana-read / .ana-ref |
| §7 实施顺序 4·自绘图加 narrow computed + 几何三元 | 改什么：自绘图加 narrow computed + 几何三元（13 组件）；影响：2 屏（光伏两屏）；在哪块板：08 / 09 / 10 / 14；理由：组件内改，每个组件独立可验  | 新建 | L | frontend/src/components/ana/useWidth.ts:5 + 13 个 Pv* 消费者的常量行（见 §1 各行落点 |
| §7 实施顺序 5·宽表 → 行卡（6 张表） | 改什么：宽表 → 行卡（6 张表）；影响：4 屏；在哪块板：10 / 12 / 13 / 14；理由：复用上一份稿的 .mx-rowcard  | 需改 | M | frontend/src/styles/mx-list.css:118-140、frontend/src/components/fp/FPS |
| §7 实施顺序 6·折叠段「更多分析 / 更多指标」 | 改什么：折叠段「更多分析 / 更多指标」；影响：5 屏；在哪块板：06 / 12 / 13 / 14；理由：纯 DOM，无几何风险  | 新建 | L | 无（全仓零命中）；相关 frontend/src/components/ana/ana.css:186-188（.av2-lead / .a |
| §7 实施顺序 7·分析层手机落地页（新屏） | 改什么：分析层手机落地页（新屏）；影响：1 屏（新）；在哪块板：03；理由：唯一一个新屏，放最后——前六项做完它才有东西可链  | 新建 | L | 无（frontend/src/router/index.ts:51-71 无分析层落地页路由） |

#### AnaShellPhone（分析屏外壳 · 手机版）  — 共 25 块，已符合 10，要动 15　→ P1

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §1 改后屏 · 工具条四控件抬到 44 | 工具条全部控件抬到 44；两行工具条总高 74 → 98（多占 24px）；日期框宽 112 → 126；第一屏可用高 655 → 631（−3.7%）。工具条是 sticky，这 24px | 新建 | M | frontend/src/views/analysis/AnaShell.vue:296-309（@media max-width:600p |
| §1 改后屏 · TreeMap 卡头 hint 末尾加「点块看明细」 | 卡头 hint 从「块面积＝月租(万)· 颜色＝分期」变成「块面积＝月租(万)· 颜色＝分期 · 点块看明细」，末句用链接色（--text-link）。  | 需改 | S | frontend/src/views/analysis/ParkView.vue:237（骨架分支）, ParkView.vue:325（真 |
| §1 改后屏 · TreeMap 下加读数句 + 参照系脚 | 图下加 .ana-read「前 6 栋占全园月租 56.9%；其余 12 栋并成一块。」（12px/18），再加 .ana-ref「n=18 栋 · 有效合同月租 · 万元」（11px/16 | 新建 | M | frontend/src/components/ana/ana.css:161,164（.ana-read / .ana-ref 两条规则已 |
| §1 改后屏 · TreeMap 合成 6 块 +「其余 12 栋」 | S 档 TreeMap 只画前 6 栋，余下 12 栋合成一块「其余 12 栋 85.5万」，块内标签（栋名 + 万元）可读；现状那 18 个小块在 390 宽下标签互相截断。  | 存疑 | M | frontend/src/views/analysis/ParkView.vue:326（`<AnaEChart :option="tree |
| §2 表第1行 · A 类 14 处 → 加 .hint-touch 兄弟 span | 14 个卡片处（电费 1 / 充电桩 2 / 驾驶舱 4 / 园区 2 / 租户 1 / 到期墙 3 / 光伏回收 1）不藏，改成换一句：加兄弟 span .hint-touch，S 档显它 | 新建 | L | frontend/src/views/analysis/ElecAnalysisView.vue:287,349; ChargingAnal |
| §2 表第2行 · B 类 1 处 → 删「悬停看租户」+ 改光伏「悬停看数」 | 租户箱线「(悬停看租户)」整句删掉（读数句已经在图下写着数了）。⚠ 光伏分栋屏那句「悬停看数」不在 .hint-desk 里，现在手机上照常显示 —— 是本稿必须动的一句。  | 新建 | S | frontend/src/views/analysis/TenantPortfolioView.vue:297,381（`<span cla |
| §2 表第3行 · C 类 1 处 → 驾驶舱主图拆两个 span | 驾驶舱主图 hint「· 点击月柱切换期间 · 拖选缩放」必须拆成两个 span：前半进 .hint-touch 写「点月柱切期间」，后半「拖选缩放」留在 .hint-desk 继续藏（S  | 新建 | S | frontend/src/views/analysis/CockpitView.vue:391（骨架分支）, CockpitView.vue |
| §2 右栏 · 「实现是两行 CSS」蓝框 | 两行 CSS：`.hint-touch { display:none }` 和 `@media(max-width:600px){ .hint-desk{display:none} .hin | 新建 | S | frontend/src/components/ana/ana.css:195（现有 `.hint-desk { display:none; |
| §3 表第1行 · 工具条 期间粒度段控 | 28 高 · 12px → 44 高 · 13px。理由：换期是分析层最高频的动作。  | 需改 | S | frontend/src/views/analysis/AnaShell.vue:148-151（按月/按年模板）; frontend/sr |
| §3 表第2行 · 工具条 日期框 | 32 高 · 13px → 44 高 · 16px。理由：S 档输入控件下限 16px，否则 iOS 聚焦时整页缩放。宽度稿上 112 → 126。  | 需改 | S | frontend/src/views/analysis/AnaShell.vue:154-158（`.anx-selw style="wid |
| §3 表第3行 · 工具条 上/下期钮 | 28×28 → 44×44。理由：相邻两个钮，小于 44 极易点错。稿上圆角 8 → 12。  | 需改 | S | frontend/src/views/analysis/AnaShell.vue:159-164（模板）; AnaShell.vue:273 |
| §3 表第4行 · 工具条 设置钮 | 34×34 → 44×44。稿上圆角 10 → 12。理由栏写「—」。  | 需改 | S | frontend/src/views/analysis/AnaShell.vue:192（模板 .anx-icobtn）; AnaShell |
| §3 表第5行 · 屏内段控 .anx-seg | 28 高 → 44 高。理由：光伏三档、充电桩汽车/电动车都在这一类。  | 存疑 | M | frontend/src/components/ana/ana.css:13-14（.anx-seg，真消费者只有 TenantEnergy |
| §3 表第6行 · 卡头 mini 段控 .anx-seg.mini | 22 高 · 11px → 44 高 · 12px。理由：园区散点对数/线性、租户箱线月租/面积。  | 需改 | M | frontend/src/components/ana/ana.css:26-27（`.anx-seg.mini { padding:2px |
| §3 表第7行 · 芯片 .chip | 34 高 → 44 高。理由：光伏 13 枚栋名芯片（第 07 块）。  | 需改 | M | frontend/src/views/analysis/PvChips.vue:120（`.pvc { height: 34px }`）,  |

#### KpiPhone（KPI 瓦 · 手机形态）  — 共 30 块，已符合 11，要动 19　→ P1

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| 题头胶囊·两列 173 / 内容宽 149 / 定高 108 不动 | 手机档（S ≤600）KPI 条定两列，每格 173px；卡内 padding 12+12 后内容宽 149px；卡高 108px 不变。  | 需改 | S | frontend/src/components/ana/ana.css:180（S 档 .av2-kpis 定两列）；frontend/sr |
| 题头算式·390 − .anx-body padding 32 − 栅格 gap 6 = 352 | 390 视口 − 横向留白 32（左右各 16）− 栅格 gap 6 = 352，352/2 = 每格 173，再减卡内 padding 24 = 内容宽 149。  | 存疑 | S | frontend/src/views/analysis/AnaShell.vue:266（.anx-kpis padding: 12px 2 |
| §1 瓦样5·租户「集中度指数(HHI) 1682」 | 标签「集中度指数(HHI)」11 字符约 132px < 149px，刚好不截；副行「中等集中 · >2500为高度集中」占两行。  | 存疑 | S | 无（TenantEnergyView.vue:310-317 六枚瓦里没有 HHI；最接近的集中度瓦是 ExpiryView.vue:137 |
| §2 小节头·列举型副行是真正的洞 | 光伏 6 瓦里有 3 枚副行是 kpiTiles 里的 list(xs)「把名字一个个列出来」；栋多时两行截断 + title 悬停看全——手机上等于那几个名字消失了。  | 需改 | M | frontend/src/views/analysis/pvAnaV4.logic.ts:193（const list = (xs) =>  |
| §2 现状屏样·本段出范围栋数 5 栋（副行被 clamp 截） | 副行「一期 3-4座 · 二期 1座 · 二期 2座 · 三期 B栋 · 三期 D栋」在 -webkit-line-clamp:2 下第三项起看不见。  | 需改 | S | frontend/src/views/analysis/pvAnaV4.logic.ts:199；frontend/src/componen |
| §2 现状屏样·缺抄条数 41 条（副行被 clamp 截） | 副行「二期 2座 7 · 三期 C栋 6 · 三期 D栋 5 · 一期 7座 4 · 二期 3座 3」第三项起看不见。  | 需改 | S | frontend/src/views/analysis/pvAnaV4.logic.ts:208（list(k.miss.map(x =>  |
| §2 改后屏样·本段出范围栋数 → 副行只写「点看是哪几栋 ▾」 | 副行去掉全部栋名，只剩「点看是哪几栋 ▾」；值 5 栋不变。  | 新建 | M | frontend/src/views/analysis/pvAnaV4.logic.ts:199（note 改成动作串）；或 fronten |
| §2 改后屏样·缺抄条数 → 副行只写「点看分布 ▾」 | 副行去掉全部栋名与条数明细，只剩「点看分布 ▾」；值 41 条不变。  | 新建 | M | frontend/src/views/analysis/pvAnaV4.logic.ts:208 |
| §2 常驻带屏样·「本段出范围的 5 栋」+ 5 枚带色点芯片 | 点瓦 → KPI 条下面插一条常驻带（不是浮层），栋名做成带色点的芯片；点芯片直接把主图换成那栋；再点一次瓦收起。  | 新建 | L | frontend/src/views/analysis/PvChips.vue:1-40（现成芯片长相，GAP 6，行高恒 34）；fron |
| §2 表行1·本段出范围栋数（改） | 现状副行「一期 3-4座 · 三期 B栋」→ 改后「点看是哪几栋 ▾」。判据：2 栋名 = 15 字符 ≈ 165px，两行 298 够；但 5 栋就不够。  | 需改 | S | frontend/src/views/analysis/pvAnaV4.logic.ts:199 |
| §2 表行2·缺抄条数（改） | 现状副行「二期 2座 7 · 三期 C栋 6 · 三期 D栋 5」→ 改后「点看分布 ▾」。判据：3 项 ≈ 210px，两行刚好；4 项起截断。  | 需改 | S | frontend/src/views/analysis/pvAnaV4.logic.ts:208 |
| §2 注释框·为什么是「常驻带」不是浮层 | 浮层会盖住 KPI 条下面的内容，手机上还要再点一次才关得掉。常驻带插在 KPI 条与正文之间，推下去而不是盖上去，再点一次瓦收起。芯片可点 = 顺手解决了「13 枚芯片里找那一栋」。  | 新建 | M | frontend/src/views/analysis/PvChips.vue:6（现状用 ds/Popover 浮层收「其余 N 栋」）； |
| §2 注释框·判据：列举型副行什么时候改写 | 项数 × 单项字宽 > 298（两行容量）时改写。实测栋名平均 6 字符 ≈ 72px + 分隔 ≈ 12px，≥ 4 项就超。规则：列举型副行最多列 3 项，第 4 项起换成「点看…▾」。 | 新建 | M | frontend/src/views/analysis/pvAnaV4.logic.ts:193（list() 是唯一改写落点，4 处调用全 |
| §3 小节头·9 瓦两列 564px 占第一屏 89% | 9 瓦两列 = 5 行 × 108 + 4 × 6 = 564px，占第一屏可用高（631，工具条抬 44 之后）的 89%；第一张图要滑到第二屏才看得见。  | 需改 | S | frontend/src/views/analysis/ExpiryView.vue:127（:kpi-hold="loading ? 9  |
| §3 现状屏样·9 瓦全展开（第 9 枚独占一行左半） | 9 枚瓦两列排 5 行，第 9 枚（2026-09 预计）独占一行左半、右半是空的（auto-fit 两列，奇数个必有一个空位）；滑完 564px 才到第一张图。  | 需改 | S | frontend/src/views/analysis/ExpiryView.vue:130-149（9 枚 AnaKpiTile，DOM  |
| §3 改后屏样·4 枚常显 | 常显四枚按此序：合同总数 412 份 / 当前合约租金 ¥198.4万/月（有效合同 386 份）/ 未来12月到期 64 份（涉及 ¥31.7万/月）/ 最近的缺口 3 月（2026-12 | 需改 | M | frontend/src/views/analysis/ExpiryView.vue:130、133-134、140-141、148-149 |
| §3 改后屏样·「⌄ 更多指标 … 5 枚 ›」折叠行 | 折叠行一条：⌄ 更多指标 + 灰字预览「租金中位数 · 有租金合同 · Top10 集中度 · 历史续签率 · 下月预计」+ 右端「5 枚 ›」。点开原地展开，不跳转。  | 新建 | M | 无（components/fp/ 与 components/ds/ 里没有这个形状；最接近的 ds/Popover 是浮层，不符 §2 已定 |
| §3 注释框（橙）·收起的五枚不是次要，是不值第一屏 | 收起五枚 = 租金中位数 / 有租金合同 / Top10 集中度 / 历史续签率 / 下月预计。「更多指标」是折叠不是删除，一次点击就全在。桌面不折叠：≥1100 时 9 枚 auto-fi | 存疑 | S | frontend/src/views/analysis/ExpiryView.vue:135-139、146-147（这五枚）；fronte |
| §3 注释框·这条规则推广到其它屏（8 屏 KPI 计数） | 手机上 KPI 常显最多 6 枚（3 行），超出折叠。本稿 8 屏：光伏 6 不折、驾驶舱 7 → 6+1、园区 4 不折、租户 6 不折、到期墙 9 → 4+5、光伏回收 5 不折、电费与 | 需改 | L | 光伏 6：frontend/src/views/analysis/pvAnaV4.logic.ts:198-213；驾驶舱 7：fronte |

#### HoverFix（方法 · 点代替悬停）  — 共 23 块，已符合 2，要动 21　→ P1

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §0 方法论断言·tooltip 搬到图外 | 1 级洞 = 39 张图的数只在 tooltip 里。不许靠「把 tooltip 改成点击触发」解决——手指会遮住它指着的那个点，而且浮层一出现就得再找地方关掉。解法 = 把 tooltip | 需改 | L | frontend/src/components/ana/ana.css:161（.ana-read）、frontend/src/compon |
| §1 范式定义·两态同 DOM | 一张图 = 卡头 + 图 + 两行读数句。读数句两态：默认（不用点，写头条读数）与接管（点过一个点，写那个点）。这两态用同一个 DOM、同样的高度，切换零位移。  | 需改 | L | frontend/src/components/ana/ana.css:161-168；frontend/src/views/analysi |
| §1 手机屏样 A·现状 不点就是一片线 | 390×844 手机壳；顶栏 ☰ +「光伏分栋分析」+ 🔍 + 🔔(2)；卡头「等效小时轨迹 · 三期 B栋」+ hint「线=这栋 · 带=这栋自己的范围」；y 轴 6.5 / 5.4 | 需改 | M | frontend/src/views/analysis/PvYieldBand.vue:123-130（onMove 只绑 mousemov |
| §1 手机屏样 B·改后 默认态(不用点) | 卡头 hint 尾部加蓝字「· 点图看某月」；图下常驻两行：.ana-read 写「全年等效 1042.6 h，比全园中位高 4.4 h；4月 出范围。」；.ana-ref 写「n=12 月 | 需改 | M | frontend/src/views/analysis/PvYieldBand.vue:200（现有 .ana-ref 图注需换成 n/口径 |
| §1 手机屏样 C·改后 接管态(点了 7月) | 点图上任意一处 → 最近的刻度被选中 → 图上一条竖线 + 高亮实心点落在 7月；.ana-read 整条换成「[已选 7月 ✕] 三期 B栋 7月 等效 5.40 h，全园中位 5.40  | 新建 | L | 无（PvYieldBand.vue 没有点击/选中态）；取数可复用 frontend/src/views/analysis/PvYieldB |
| §2 规则①·读数句常驻 | 适用每张图。默认态写这张图的头条读数：最新 / 选中的那个值 + 一句结论。不用点就看得见——这是 1 级洞的正解。产品已有 .ana-read(12px) + .ana-ref(11px) | 需改 | L | frontend/src/components/ana/ana.css:155-164（含「不许收进 ⓘ 浮层」原话）；frontend/s |
| §2 规则②·点一下接管 | 适用有 2 个以上数据点的图。点图上任意一处 → 取最近的那个点（不要求点准）→ 读数句整条换成那个点的读数，句首多一枚「已选 7月 ✕」芯片。命中判定照 PvDayChart.vue:11 | 新建 | L | frontend/src/views/analysis/PvDayChart.vue:110-117（最近刻度算法原样可用）；fronten |
| §2 规则③·图上留一个记号 | 接管态下：竖线（时间轴类）/ 环（格类、点类）/ 描边（条类）。只标位置，不写字——字在读数句里。竖线色 --pv-tip-hair、环用 calloutMark 的空心环。  | 需改 | M | frontend/src/views/analysis/pvAnaColors.ts:79（TIP_HAIR）、frontend/src/v |
| §2 规则④·退出不用找按钮 | 接管态下：点图上别处 = 换一个点；点芯片上的 ✕ = 回默认态；离开这张卡 = 回默认态。没有浮层要关。  | 新建 | M | 无 |
| §2 规则⑤·点数少就直接写在图上 | ≤ 8 个数据点的图（8 季到期柱、4 段续签带、单元格式的进度卡）值直接标在图元上，11px，连点都不用点。判据是放得下：336 宽 ÷ 8 = 42px/柱，11px mono 每字约  | 新建 | M | frontend/src/views/analysis/ExpiryView.vue:176（到期墙 · 未来 8 季）；frontend/ |
| §3 判据总则·哪一个数值得常驻 | 不是所有数都值得常驻。判据只有一条：这张图的读者进来是想知道哪一个数。那个数常驻，其余的点出。  | 新建 | S | 无 |
| §3 判据表 行1·时间序列(线/柱/带) | 默认句（常驻）= 最新一期的值 + 与参照的关系；点出来的 = 任意一期的值。  | 需改 | M | frontend/src/views/analysis/PvYieldBand.vue:200、frontend/src/views/ana |
| §3 判据表 行2·一栋一行/一户一行(横条) | 默认句 = 选中那行的值 + 它在全体里的位置；点出来的 = 任意一行——但横条图的值本来就该直接写在行尾，见规则 ⑤。  | 需改 | M | frontend/src/views/analysis/PvAnchorBars.vue:17,156；frontend/src/views |
| §3 判据表 行3·构成(环图/堆叠) | 默认句 = 合计 + 最大的一块占比；点出来的 = 任意一块的值与占比。  | 需改 | M | frontend/src/views/analysis/PvConsumption.vue（堆叠柱 + 损耗率折线）；frontend/sr |
| §3 判据表 行4·散点/热力格 | 默认句 = 有多少个点在范围外（个数，不是定性）；点出来的 = 任意一个点 / 格。  | 需改 | M | frontend/src/views/analysis/PvLedgerScatter.vue:5,15；frontend/src/view |
| §3 判据表 行5·预测/区间 | 默认句 = 末期的点估与区间 + 区间是按多少画的；点出来的 = 任意一期的点估与区间。  | 需改 | S | frontend/src/views/analysis/CockpitView.vue:447-448,519-520（forecastRe |
| §3 卡·接管态不改图高也不改卡高 | .ana-read 行盒 18、.ana-ref 行盒 16，两态同高。芯片 20 高、vertical-align:1px，塞在 .ana-read 的行盒里不撑行。默认句可能比接管句长， | 存疑 | S | frontend/src/components/ana/ana.css:168（.ana-read.hold/.ana-ref.hold m |
| §4 命中带·时间轴类 | 整幅绘图区按 x 切成 n 条等宽命中带：12 个月 → 每带 (336−34−6)/12 = 24.7px。带宽小于 44 是可以的——它不是按钮，是「最近点」判定；相邻带是同一张图的相邻 | 需改 | M | frontend/src/views/analysis/PvYieldBand.vue:16（H 250, PL 44, PR 62, PT |
| §4 命中带·格类 | 热力格 28×28、日历格：格本身就是命中区，点到哪格算哪格，不做最近点。  | 需改 | S | frontend/src/views/analysis/PvResidualHeat.vue:138,141,147（行高 28、格 28× |
| §4 命中带·行类 | 横条：整行 30 高 × 全宽 = 命中区，已 ≥44 的一半且是行不是点，实测好点。  | 存疑 | S | frontend/src/views/analysis/PvAnchorBars.vue:17,156；frontend/src/views |
| §4 真正需要 ≥44 的是这些 | 退出芯片的 ✕ = 20×20 视觉 + 44×44 透明命中盒；卡头里的 mini 段控 .anx-seg.mini 在 S 档抬到 44 高；芯片行的每枚芯片 34 → 44；工具条的期 | 需改 | M | frontend/src/components/ana/ana.css:26-27（.anx-seg.mini 现 padding 2 +  |

#### Journey（主线 · 在外面临时查一个数）  — 共 22 块，已符合 7，要动 15　→ P1

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §1 A·现状动线 6 步 | 6 步逐步点名：①解锁·点「分析」＝底栏第 3 枚(MobileBottomNav) ②落在经营驾驶舱＝分析层首页，块最多那屏，要等 7 瓦 + 9 块全部拉完(CockpitView) ③ | 需改 | M | frontend/src/components/shell/mobile/MobileBottomNav.vue:25；frontend/s |
| §1 A·改后 步2「落在「查一个数」」 | 分析层落地页不是驾驶舱，是「查一个数」：常查的 6 个数摆在第一屏；或直接搜「三期B」。步卡落点标注为「本稿第 03 块」（本板不画落地页本体）。  | 新建 | L | 无 |
| §1 A·改后 步3「光伏分栋 · 已选中那栋」 | 深链带 #st=10 进屏：芯片行滚到它、主图已经是它。不需要第二次点。落点 PvMeterAnaView。  | 需改 | M | frontend/src/views/analysis/PvMeterAnaView.vue:338（/#st=(\d+)/ 解析）、:34 |
| §1 手机屏样·光伏分栋分析（改后落屏） | 自上而下：顶栏 ☰ +「光伏分栋分析」+ 🔍 + 🔔(角标 2)；期间行 按月/按年 段控 + 「2026 / 08」日期钮 + ‹ › 步进；工具行「截至 2026-08」+ 设置钮； | 需改 | L | frontend/src/views/analysis/AnaShell.vue:146-163（期间行）、:226（.anx-kpis.a |
| §1 说明框「省下的 3 步来自哪」 | ①不再先落驾驶舱(省 1 步)：分析层首页换成「查一个数」落地页。驾驶舱仍在，只是不当门厅——它是 9 个块的屏，做门厅要等最久。②不再开导航抽屉(省 1 步)：常查的数直接是入口，点的是「 | 需改 | L | frontend/src/nav/fpNav.ts:52（home:'cockpit' ← 要改的那一个字）；frontend/src/na |
| §1 说明框「最后一步为什么能拿到数」 | 主图下面那条读数句(.ana-read / .ana-ref)默认就写着这栋这一段的结论与口径，不用点。要别的日子，点图上任意一处，读数句接管成那一天（详见第 04 块）。明确写「这两个类是 | 新建 | L | frontend/src/components/ana/ana.css:161（.ana-read margin 8px 0 0 / --f |
| §2 B·现状动线 5 步 | 5 步：①点「分析」(MobileBottomNav) ②驾驶舱——不是要的屏(CockpitView) ③抽屉 → 电费成本(MobileNavDrawer) ④结论条——在第一屏，这一件 | 需改 | M | frontend/src/views/analysis/ElecAnalysisView.vue:138-149（trendOption：t |
| §2 B·现状 步4「结论条已经对了」 | 图上把这一件单独判为「已经对了」：结论条排在第一屏，写死机制为「.av2-lead order −2 已在产品里」，因此现状的前 4 步不算坏。  | 存疑 | S | frontend/src/views/analysis/ElecAnalysisView.vue:336-341（.av2-card.ea- |
| §2 B·改后 步2「落地页 · 点「本年电费」瓦」 | 落地页上那枚瓦上已经写着 ¥1172.4万 与同比——不用进屏就能看见数。落点标注「本稿第 03 块」。  | 新建 | M | 无 |
| §2 B·改后 步3「电费屏 · 结论条 + 读数句」 | 图 1（收益四指标月度趋势）的读数句默认写「本年自发自用抵扣 ¥214.6万，占 18.3%」。落点标注「本稿第 04 / 11 块」。  | 新建 | M | frontend/src/views/analysis/ElecAnalysisView.vue:345-352（图1 卡 .av2-car |
| §3 C·现状动线 6 步 | 6 步：①点「分析」②驾驶舱 ③抽屉 → 到期墙 ④9 瓦两列 = 5 行，要滑过 564px 才见第一张图(ExpiryView) ⑤「未来12月到期 64 份」——份数有了，金额在另一瓦 | 需改 | M | frontend/src/views/analysis/ExpiryView.vue:130-149（9 枚 AnaKpiTile）、:14 |
| §3 C·现状 步4「9 瓦两列 = 5 行，要滑 564px」 | 图上写死：9 瓦、两列、5 行、滑过 564px 才见第一张图。  | 需改 | M | frontend/src/components/ana/AnaKpiTile.vue:50（.av2-kpi height:108px）；f |
| §3 C·现状 步6「租金带图」 | 每月锁定值与区间上下沿只在 hover 里；最小字号还是 10px。落点 AnaRentBandChart。  | 需改 | M | frontend/src/components/ana/AnaRentBandChart.vue:94（@mousemove/@mousel |
| §3 C·改后 步2「落地页 · 点「未来12月到期」瓦」 | 落地页那枚瓦上写着「64 份 · ¥31.7万/月」——份数和金额并在一枚瓦的字面上。落点标注「本稿第 03 块」。  | 新建 | M | frontend/src/views/analysis/ExpiryView.vue:140-141（rentRoll.expiringCo |
| §3 C·改后 步3「到期墙 · 锚到「先谈哪几户」」 | 进屏直接锚到「先谈哪几户」；4 列表在手机上是行卡，租户 / 到期月 / 月租 / 剩余天数四件都在字面上。落点标注「本稿第 14 块」。  | 新建 | M | frontend/src/views/analysis/ExpiryView.vue:284-301（「先谈哪几户」卡）、:287（thea |

#### JourneyEntry（入口 · 分析层手机落地页）  — 共 19 块，已符合 5，要动 14　→ P5

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| 板头·主张：S 档分析层首页换成落地页 | 底栏「分析」现在落 cockpit —— 7 瓦 + 9 个块，是这一层最重的一屏；三条动线里它都只是路过，没有一条问句的答案在驾驶舱第一屏上。改成一个只回答「那个数是多少」的落地页，内容恰 | 需改 | L | frontend/src/nav/fpNav.ts:52（analysis 层 home: 'cockpit'）；frontend/src/ |
| §1 改后屏样·「查一个数」落地页整屏 | 整屏自上而下：顶栏标题写「分析」（层名，不是屏名）+ 搜索图标 + 铃铛红点 2；胶囊搜索框（高 48 / 左内边距 16 右 12 / gap 10 / radius 999 / 1px  | 新建 | L | frontend/src/components/shell/mobile/MobileTopBar.vue:28-42（顶栏已有 汉堡/标题 |
| §1 蓝框·为什么是「数瓦」不是「屏瓦」 | 两条硬规则：(1) 瓦上先把数写出来——问句是「收缴率多少」不是「打开驾驶舱」，六成问句到瓦上就结束（引 §02 问句 B 从 5 步变 3 步，第 3 步只为看口径）；(2) 瓦的副行只写 | 新建 | S | frontend/src/components/ana/ana.css:195-196（.hint-desk：S 档整段隐藏桌面交互话术，同 |
| §1 三件·①常查的数（固定六枚固定顺序） | 固定六枚、固定顺序，排序规则写死为「§02 三条问句的落点优先」：①本月营业收入 ②收缴率(问句「这个月怎么样」) ③在租租户 ④本月发电(问句 A) ⑤未来12月到期(问句 C) ⑥本年电 | 存疑 | M | frontend/src/views/analysis/CockpitView.vue:343,350,357；frontend/src/v |
| §1 三件·②最近看过（3 行带上下文） | 3 行，带上次看的上下文（例：「三期 B栋 · 2026-08」）——回到的是那个状态，不是屏的默认态。声明产品已有深链（#st= / p= / ym=）。  | 需改 | M | frontend/src/stores/tabs.ts:39（MAX_RECENT = 8）、:84（recent 从 localStora |
| §1 三件·③搜一个数（48 高 / 16px） | 一个输入框，48 高、16px 字（S 档输入控件下限）。搜三类：指标名、楼栋名、租户名。  | 需改 | M | frontend/src/components/shell/CommandPalette.vue:72-78（输入框，placeholder |
| §1 不做·③桌面不动 | 这页只在 S 档（≤600）当层首页。桌面进分析层仍落 cockpit——大屏上驾驶舱第一屏就能看到 7 瓦 + 主图，它在那里是好门厅。  | 需改 | M | frontend/src/styles/breakpoints.ts:8（BP.s = 600）；frontend/src/composab |
| §2 说明·点一枚瓦 = router.push + # 锚点 | 点一枚瓦 = router.push 到那个屏 + # 锚到那张卡。明确「锚点是新的，深链参数是产品已有的」。  | 新建 | L | frontend/src/stores/tabs.ts:205（openFresh）、:212（openDeep）；frontend/src |
| §2 表·行1 本月营业收入 | 瓦 = 本月营业收入；瓦上的值 −¥63.6万；副行「8 月 · 环比 −107.1%」；点进去落在 驾驶舱 · 月度收入；值从哪来 = CockpitView 第 1 瓦（损益附表 1~5 | 需改 | S | frontend/src/views/analysis/CockpitView.vue:343-344（第 1 瓦 营业收入，:delta= |
| §2 表·行2 收缴率 | 瓦 = 收缴率；值 81.3%；副行「距目标 96%」；点进去落在 驾驶舱 · 收缴率 vs 目标；值从哪来 = CockpitView 第 4 瓦（台账 Σ实收 / Σ应收）。  | 需改 | S | frontend/src/views/analysis/CockpitView.vue:350-351（第 4 瓦 收缴率）；:423 与  |
| §2 表·行3 在租租户 | 瓦 = 在租租户；值 385 户；副行「环比 +3 户」；点进去落在 租户维度 · KPI；值从哪来 = TenantPortfolioView 第 1 瓦。  | 存疑 | M | frontend/src/views/analysis/TenantPortfolioView.vue:254（第 1 瓦 在租租户，not |
| §2 表·行4 本月发电 | 瓦 = 本月发电；值 48.2万 kWh；副行「数据到 09-12 · 已抄 74%」；点进去落在 光伏分栋 · 主图；值从哪来 = PvMeterAnaView「数据到」瓦 + 主图分母。 | 存疑 | M | frontend/src/views/analysis/pvAnaV4.logic.ts:210（「数据到」瓦：value = dataTh |
| §2 表·行5 未来12月到期 | 瓦 = 未来12月到期；值 64 份；副行「涉及 ¥31.7万/月」；点进去落在 到期墙 · 先谈哪几户；值从哪来 = ExpiryView 第 6 瓦 + 第 3 瓦金额。  | 需改 | S | frontend/src/views/analysis/ExpiryView.vue:140-141（渲染序第 6 瓦 未来12月到期，va |
| §2 表·行6 本年电费 | 瓦 = 本年电费；值 ¥1172.4万；副行「自发自用抵扣 18.3%」；点进去落在 电费成本 · 结论条；值从哪来 = ElecAnalysisView 结论条第 1 句。  | 存疑 | M | frontend/src/views/analysis/ElecAnalysisView.vue:96-99（CONCL 四项，第 1 项  |

#### PvMain（光伏分栋分析 · 主态）  — 共 22 块，已符合 5，要动 17　→ P2

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §① 板头 + 导语 | 前提陈述：PvMeterAnaView 全部自绘（0 个 AnaEChart），所以 anaChartHeight.ts 的 S 档降档（440/300→260、250→220、200→18 | 存疑 | S | C:/financial_dashboard/demo3/frontend/src/components/ana/anaChartHeigh |
| §❶ 屏样 A · 主态 @390 · 现状 | 记录现状三处硬伤：① 芯片行 6 枚就换行 + 「其余 7 栋 ▾」弹层（弹层宽 280px）；② 主图 272 高，但 12 个 x 标签挤在 302px 里（每标 25px，「10月」1 | 需改 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvChips.vue:1 |
| §❶ 屏样 B · 主态 @390 · 改后 | 改后整屏：工具条两行（第一行 按月/按年 seg + 2026/08 日期字段 + ‹ ›，第二行 截至 2026-08 + 设置钮），控件全部 44 高；KPI 两列 3 行、每瓦定高 1 | 需改 | L | C:/financial_dashboard/demo3/frontend/src/views/analysis/AnaShell.vue: |
| §❶ 红框「判据脚：放不下就换排法，不是删字」 | 五条判据 + 「去改」一行 nowrap 里约 620px，卡内只有 336。改后：两列网格，每列 163px，五条各占一格、第六格放「去改 →」；第二行的范围窗口句允许折行（white-s | 需改 | S | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvMeterAnaVie |
| §❶ 蓝框「芯片行：13 枚怎么放」 | 现状按容器宽折叠、超出收进「其余 N 栋 ▾」弹层（280px），390 上只放得下 5–6 枚。改后：单行横向滚动，不折叠。44 高、圆角 22、栋名 13px。选中那枚自动滚进视野（深链 | 需改 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvChips.vue:1 |
| §❶ 灰框「这屏那句『悬停看数』」 | PvResidualHeat.vue:101 的卡头 hint 末尾写着「· 悬停看数」，而这屏一个 .hint-desk 都没有 —— 它在手机上照常显示。删掉这三个字，读数句顶替（第 0 | 需改 | S | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvResidualHea |
| §② 块清单第1行 · 工具条 | 桌面：一行 · 期间 + 粒度 + 截至 + 设置。手机改后：两行 · 控件全部 44（标「改」）。默认读数句：—。  | 需改 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/AnaShell.vue: |
| §② 块清单第2行 · KPI 6 瓦 | 桌面 auto-fit 一行。手机改后：两列 3 行 · 定高 108（标「不改」）；列举型副行改写（标「改」）。默认读数句：—（瓦本身就是数）。  | 需改 | S | C:/financial_dashboard/demo3/frontend/src/components/ana/ana.css:131,1 |
| §② 块清单第3行 · 芯片行 34 | 桌面：按宽折叠 + 「其余 N 栋 ▾」。手机改后：44 高 · 单行横滚 · 选中自动滚进视野（标「改」）。默认读数句：—。  | 需改 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvChips.vue:1 |
| §② 块清单第4行 · 主图 272 | 桌面：PvDayChart / PvYieldBand，272 高。手机改后：200 · x 标签隔一标 · 逐日档改逐周中位（标「改」）。默认读数句写「三期 B栋 全年等效 1042.6  | 需改 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvDayChart.vu |
| §② 块清单第5行 · 判据脚 2×16 | 桌面：两行 nowrap。手机改后：两列网格 + 第二行可折行，总高 64（标「改」）。默认读数句：—（它是口径不是读数）。  | 需改 | S | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvMeterAnaVie |
| §② 块清单第6行 · 段控 3 档 | 桌面：28 高 + 说明同一行。手机改后：44 高 · 说明另起一行（标「改」）。默认读数句：—。  | 需改 | S | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvMeterAnaVie |
| §② 块清单第7行 · 档内卡片区 | 桌面：绝对水平 4 块 / 账面量 5 块 / 高级分析 6 块。手机改后：单列堆叠 · 每档最多 4 块常显，其余折叠（标「改」）。默认读数句：各块见第 08 / 09 块。  | 新建 | L | C:/financial_dashboard/demo3/frontend/src/components/ana/ana.css:138-1 |
| §③ 小节头 + 导语「三档里哪 4 块常显」 | 判据同第 06 块：手机上一屏默认最多 4 张图，其余进「更多分析」。排序用 journey：出门在外看这屏，问的是「这栋发得正不正常」。  | 新建 | S | 无 |
| §③ 常显表第1行 · 绝对水平 | 常显 4 块 = 主图(逐月比值) · 等效小时轨迹(B3) · 各栋锚点条(A2) · 分栋收益条；折叠 = —（这档本来就 4 块）。  | 存疑 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvMeterAnaVie |
| §③ 常显表第2行 · 账面量（默认档） | 常显 4 块 = 主图 · 台账×实测散点(B6) · 自用/上网/损耗(B7) · 分栋收益(B8)；折叠 = 装机核对表 1 块。  | 存疑 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvMeterAnaVie |
| §③ 常显表第3行 · 高级分析 | 常显 4 块 = α 双向条(L5) · 残差热力格(L3) · 抄表日历(L6) · 自相关柱(L1)；折叠 = 零假设直方图(L2) · 收敛线(L4)。  | 存疑 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvMeterAnaVie |

#### PvCharts1（自绘图手机版 · 第一批）  — 共 48 块，已符合 12，要动 36　→ P2

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| 板头 · 三手段优先级 | 13 个自绘图组件零个 @media。手机版手段按优先级:① 减数据点(换刻度) ② 降高 ③ 换图种;字号永远不动(轴标签保 11px)。板头断言现状 = 整幅 viewBox 按 660 | 存疑 | S | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvDayChart.vu |
| §① 现状诊断 · PvDayChart | 现状缩到 390:11px 轴标签实渲 5.6px;31 个日标签挤在 302px 里 = 每标 9.7px,实际只标得下不到一半;线与带压扁后带宽看不出来。  | 存疑 | S | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvDayChart.vu |
| §② 现状诊断 · PvYieldBand | 12 个月标签缩到 5.6px,「10月」两个字挤成一团。  | 存疑 | S | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvYieldBand.v |
| §③ 现状诊断 · PvAnchorBars | 栋名列 120px 缩到 61px,「一期 3-4座」6 个字放不下;条上只有粗值,精确值在 hover 里。  | 存疑 | S | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvAnchorBars. |
| §④ 现状诊断 · PvLedgerScatter | 尺寸写死 300×334,比 336 还窄,所以手机上反而是唯一不糊的一张;但一个 hover 都没有(源码注释明写不加),13 个点一个数都读不出来。  | 需改 | S | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvLedgerScatt |
| §⑤ 现状诊断 · PvConsumption | 堆叠三段在缩后每柱 11px 宽,最上面那段「路上损掉」只有 1–2px;右轴百分比标签缩到 5.6px。  | 存疑 | S | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvConsumption |
| §① 改后手机屏样 · PvDayChart | svg 336×200。逐周中位 5 点;x 标签 W1–W5 全标(x = 63.6 / 122.8 / 182 / 241.2 / 300.4,y=192,11px mono 居中);y | 新建 | M | 读数句无落点(类在 C:/financial_dashboard/demo3/frontend/src/components/ana/ana |
| §② 改后手机屏样 · PvYieldBand | svg 336×210。12 个月点不减,x 标签隔一标 6 个;y 轴 5 档 2.2 / 3.2 / 4.3 / 5.4 / 6.4(x=29 右对齐 11px mono);单位「h」提 | 新建 | M | 读数句无落点;几何 C:/financial_dashboard/demo3/frontend/src/views/analysis/PvY |
| §③ 改后手机屏样 · PvAnchorBars | svg 336×388 = 8 + 12×30 + 20。栋名 x=0 左对齐 12px sans;条 x=76 起、height 14 rx 3;值 x=336 右对齐 mono 11 w | 存疑 | L | 无;几何 C:/financial_dashboard/demo3/frontend/src/views/analysis/PvAnchor |
| §④ 改后手机屏样 · PvLedgerScatter | svg 300×310,两轴同刻度 0 / 25 / 50 / 75 / 100(y 标 x=25 右对齐、x 标 y=304,11px mono),padL 30;点 r=4.5;选中点加 | 新建 | M | 无;几何 C:/financial_dashboard/demo3/frontend/src/views/analysis/PvLedger |
| §⑤ 改后手机屏样 · PvConsumption | svg 336×230。左轴 5 档 0 / 22.3 / 44.6 / 66.9 / 89.2(x=29 右对齐 11px mono);右轴 3 档 0% / 3% / 6%(x=307  | 新建 | M | 图例已在图下 C:/financial_dashboard/demo3/frontend/src/views/analysis/PvCons |
| §① 表·图种 | 桌面 折线 + 分位带 + 散点 → 手机 折线 + 分位带(标「减」)  | 需改 | S | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvDayChart.vu |
| §① 表·数据点 | 桌面 31(日档) / 12(月档) → 手机 5 周中位(日档) / 12(月档)  | 新建 | L | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvDayChart.vu |
| §① 表·高 | 桌面 236 固定 → 手机 200  | 需改 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvDayChart.vu |
| §① 表·x 标签 | 桌面 31 个全标 → 手机 5 个全标  | 需改 | S | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvDayChart.vu |
| §① 表·hover | 桌面 全图跟随竖线 → 手机 点 → 读数句接管  | 新建 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvDayChart.vu |
| §① 表·默认读数句 | 默认写最新一周的比值与它相对自己范围的位置;点某周 → 换成那一周,并在 .ana-ref 里写这周是哪几天。  | 新建 | M | 类已有 C:/financial_dashboard/demo3/frontend/src/components/ana/ana.css:1 |
| §② 表·高 | 桌面 250 固定 → 手机 210  | 需改 | S | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvYieldBand.v |
| §② 表·x 标签 | 桌面 12 个全标 → 手机 隔一标 6 个  | 需改 | S | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvYieldBand.v |
| §② 表·hover | 桌面 有 → 手机 点 → 读数句接管 | 新建 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvYieldBand.v |
| §② 表·默认读数句 | 默认写全年合计等效 + 与全园中位的关系 + 出范围的月份;点某月 → 那个月的等效、全园中位、这栋自己的上下沿。 | 新建 | M | 无(:198 只有 ana-ref) |
| §③ 表·图种 | 桌面 横向条 → 手机 不变  | 存疑 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvAnchorBars. |
| §③ 表·行数 | 桌面 13(含未装表) → 手机 12(未装表的行不画条,写在图下)  | 需改 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvAnchorBars. |
| §③ 表·行高 | 桌面 26 → 手机 30(触点)  | 需改 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvAnchorBars. |
| §③ 表·栋名列 | 桌面 120 → 手机 76(「一期 3-4座」12px 约 72)  | 需改 | S | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvAnchorBars. |
| §③ 表·值 | 桌面 条上只有粗值 → 手机 行尾直标,mono 11  | 存疑 | S | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvAnchorBars. |
| §③ 表·默认读数句 | 默认写当前选中那栋的值与它的排名;点某行 = 换选中栋(产品已有),读数句跟着换。  | 新建 | M | 读数句无;选中栋链路已有 C:/financial_dashboard/demo3/frontend/src/views/analysis/ |
| §④ 表·尺寸 | 桌面 固定 300×334 → 手机 量容器宽,正方形绘图区,取 min(容器宽 − 30, 容器宽)  | 需改 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvLedgerScatt |
| §④ 表·hover | 桌面 无 → 手机 点 → 读数句接管  | 新建 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvLedgerScatt |
| §④ 表·默认读数句 | 默认写有几个点落在容差带外,以及是哪几栋(≤3 栋列名,≥4 栋只写个数 + 点看);点某点 → 那栋的台账装机、实测装机、差多少。  | 新建 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvLedgerScatt |
| §⑤ 表·高 | 桌面 272 固定 → 手机 230  | 需改 | S | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvConsumption |
| §⑤ 表·x 标签 | 桌面 12 全标 → 手机 隔一标(1/3/5/7/9/11月,6 个) | 需改 | S | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvConsumption |
| §⑤ 表·hover | 桌面 有 → 手机 点 → 读数句接管 | 新建 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvConsumption |
| §⑤ 表·默认读数句 | 默认写最新一期的三段拆分 + 损耗率,并指出损耗率在 12 期里的位置(第几高,不写「异常」)。  | 新建 | M | 无;:172 只有 ana-ref |
| §❶ 结论 · 只有一张真的换了刻度 | 只有 PvDayChart 日档(31 点)换刻度 —— 它是这批里唯一点多到看不清的。其余四张点数一个没减:12 个月、13 栋、13 个点。换刻度是最后手段,不是第一手段:先试 x 标签 | 新建 | S | 无(实施顺序规则,不落代码) |
| §❶ 结论 · 一处固定宽必须拆 | PvLedgerScatter 写死 300×334。在 iPhone SE(375,卡内 321)上横向溢出 21px,在平板两列布局里留一大块白。改成量容器宽后,正方形边长取 min(容 | 需改 | M | C:/financial_dashboard/demo3/frontend/src/views/analysis/PvLedgerScatt |

#### PvCharts2（自绘图手机版 · 第二批，6 张）  — 共 36 块，已符合 13，要动 23　→ P2

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §6 现状诊断·PvRevenueBars@390 | 整幅 viewBox 按 660→336 等比缩，11px 轴标签实际渲染 5.6px；两段堆叠缩后第二段常常只有 3–5px；值在 hover 里。行高 27。  | 存疑 | S | frontend/src/views/analysis/PvRevenueBars.vue:16,18,103 |
| §6 改后手机屏样·整体 | 同 PvAnchorBars：行高 27→30、栋名列 120→76、合计值直标行尾、拆分放读数句。高 = 6 + 12×30 = 366（即 TOP 6 保留、底部 26 的横轴区归零，屏 | 需改 | M | frontend/src/views/analysis/PvRevenueBars.vue:16,23,102-125 |
| §6 对照表 行2·行数 | 行数 13 → 12（在网），标「改」。  | 需改 | S | frontend/src/views/analysis/PvRevenueBars.vue:22,42；数据口径在 views/analys |
| §6 对照表 行3·行高 | 行高 27 → 30，标「改」。  | 需改 | S | frontend/src/views/analysis/PvRevenueBars.vue:16 (ROW=27) |
| §6 对照表 行4·栋名列 | 栋名列 120 → 76，标「改」。  | 需改 | S | frontend/src/views/analysis/PvRevenueBars.vue:16 (PL=104)、:111-112 (do |
| §6 对照表 行5·值 | 值 hover → 行尾直标合计，拆分进读数句，标「改」。  | 需改 | S | frontend/src/views/analysis/PvRevenueBars.vue:121 (合计已直标 totEnd+8)、:11 |
| §6 对照表 行7·默认读数句 | 默认写选中栋的合计与两段拆分 + 12 栋合计；点某行 = 换选中栋。屏样句：「三期B栋 ¥7.9万：自己用了 5.7、卖上网 2.2。」参照句「n=12 栋在网 · 本年累计 · 万元」。 | 新建 | M | 无（PvRevenueBars.vue 只有 :142 的 .ana-ref，没有 .ana-read）；行命中已有 :126-128，但没 |
| §7 现状诊断·PvAlphaBars@390 | 整幅 viewBox 按 660→336 等比缩，11px 轴标签实际渲染 5.6px；行高 22 在手机上行本身就难点（可点）；淡带与实条在缩后粘成一条。  | 存疑 | S | frontend/src/views/analysis/PvAlphaBars.vue:23 (ROW_H=22)、:32 (useWidt |
| §7 改后手机屏样·整体 | 行高 22→30（触点 + 淡带看得出），栋名列缩到 76，值直标；保留 =1 竖线与 95% 淡带。  | 需改 | M | frontend/src/views/analysis/PvAlphaBars.vue:23,28 (NAME_R=60),31 (X0=6 |
| §7 对照表 行2·行数 | 行数 13 → 12，标「改」。  | 需改 | S | frontend/src/views/analysis/PvAlphaBars.vue:45 (nRows = rows + short + |
| §7 对照表 行3·行高 | 行高 22 → 30，标「改」。 | 需改 | S | frontend/src/views/analysis/PvAlphaBars.vue:23 (ROW_H=22)、:96 (rowT) |
| §7 对照表 行4·高 | 高 n×22+14 = 300 → n×30+14 = 374，标「改」。  | 需改 | S | frontend/src/views/analysis/PvAlphaBars.vue:82 (height: nRows*ROW_H +  |
| §7 对照表 行6·默认读数句 | 默认写最高与最低那两栋 + 有几栋的区间跨过 =1（写个数，不写「显著」）。屏样句：「最高 三期A栋 +18%，最低 二期2座 −14%；4 栋跨过 =1。」  | 需改 | S | frontend/src/views/analysis/PvAlphaBars.vue:151 (.ana-read 现写选中栋 α + 名 |
| §8 改后·栋名列钉住 + 格区横滑 | 不换图种、不减格。栋名列 position:sticky 钉在左边，格区横滑；一屏看得见 8 个半月，滑 94px 到底。屏上带提示条「← 已横滑到 4 月 · 栋名列钉住不走 · 再滑 4 | 需改 | M | frontend/src/views/analysis/PvResidualHeat.vue:103 (.prh-grid)、:132-13 |
| §8 改后·点格 → 读数句写全四件 | 点格 → 读数句写全四件：栋名 + 年月 + 残差 % + 方向。屏样句「三期 B栋 · 2026-05 残差 +9.0%，比自己常年水平多发。」参照句「n=12 栋 × 9 月 · 残差中 | 新建 | M | 无（PvResidualHeat.vue 没有 .ana-read、没有 .ana-ref、格上只有 @mouseenter :115，没有 |
| §8 说明框·删掉「· 悬停看数」 | 卡头 hint 末尾的「· 悬停看数」删掉。这屏一个 .hint-desk 都没有，所以它在手机上一直显示着 —— 说的和能做的对不上，全稿唯一一处。读数句顶上之后不必换成「点格看数」。  | 需改 | S | frontend/src/views/analysis/PvResidualHeat.vue:101（hint 裸写「· 悬停看数」）；对照 |
| §9 改后·年档换成 12 行月条 | 换图种：一年 = 12 行，每行一条 100% 宽的四段堆叠条 + 行尾直写「缺 N 天 / 全齐 / 还没到」。每一行都有字，高 = 12×30 = 360。卡头 hint「一行一个月 · | 新建 | L | frontend/src/views/analysis/PvQualityGrid.vue:50-53（现只有 compact / 月档两套 |
| §9 改后·点某月 → 展开到天(月档几何) | 月档格 59×64 → 44×48：7 列 × 44 + 6 gap + 行头 22 = 334 ≤ 336，横向不滚。格内日期 12px + 第二行 11px 原样保留。屏头「2026-0 | 需改 | M | frontend/src/views/analysis/PvQualityGrid.vue:53 (月档 cw59/ch64/gap4)、: |
| §9 说明框·月档不换只缩格 | 59×64 → 44×48。判据是格内两行字：日期 12px(两位数约 14px)、第二行「缺 2」11px 约 26px，44 宽放得下。行头从「周一…周日」缩成「一…日」，22px 宽。 | 需改 | S | frontend/src/views/analysis/PvQualityGrid.vue:29 (WD 已经是 ['一'…'日'])、:7 |
| §10⑪ 小节头·两张小图诊断 | 这两张高 138，在 336 上缩后轴标签 5.6px。它们是给要复算这屏数字的人看的(段控说明原文)，但既然这一档在手机上留着，图就得读得出来。  | 存疑 | S | frontend/src/views/analysis/PvAcfBars.vue:20 (H=138)、PvNullHist.vue:21 |
| §10⑪ 现状图@336 |  | 存疑 | S | frontend/src/views/analysis/PvAcfBars.vue:52 (tick: lag===last  |
| §10 改后·PvAcfBars 手机版 | 高 138 → 130，x 标签隔一标（图上标 0/2/4/6/8/10/12），加读数句。图种与点数都不动 —— 14 根柱在 336 上每根 21px，够。读数句「滞后 1 阶 0.62 | 需改 | S | frontend/src/views/analysis/PvAcfBars.vue:20 (H=138)、:123 (.pacf-plot  |
| §11 改后·PvNullHist 手机版 | 同样处理（高 138→130、x 标签隔一标）。默认句写实测偏差落在重排分布的哪个位置 —— 写位置不写判断。横轴单位换成「倍平时起伏」，x 标签 −3/−2/−1/0/+1/+2；σ 是产 | 需改 | M | frontend/src/views/analysis/PvNullHist.vue:21 (H=138)、:107 (.pnh-plot  |

#### PvDrawer（单栋抽屉 · 手机版）  — 共 18 块，已符合 3，要动 15　→ P2

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §1 小节规则·整屏 sheet + 四档段控 | 三图+一表竖排在 390 上是 240 + 210 + 180 + 8×56 = 1078px，要滑两屏半。改成一次看一块：顶部四档段控「变点 / 控制图 / 逐月 / 明细」切换（画板实写 | 新建 | L | frontend/src/views/analysis/PvMeterAnaView.vue:544-550（.pma-drawer 里三图 |
| 现状屏·抽屉宽 720 塞进 390 | 图上画：内容卡宽 684 溢出 390 视口，三张图按桌面高 300+250+200 竖排、明细表在下，合计 1078px，脚部「上一栋/下一栋」在屏外。板上文字称 FPDrawer 写死  | 存疑 | S | frontend/src/views/analysis/PvMeterAnaView.vue:532（:width="720"）；front |
| §1 改后①·变点屏（PvDriftChart 300→240） | SVG 336×240（桌面 646×300 → 手机 336×240）。折线 + 常态线（虚线）+ 变点竖线（红）。31 天标签隔 5 标：1 / 6 / 11 / 16 / 21 / 2 | 需改 | M | frontend/src/views/analysis/PvDriftChart.vue:19（const H = 300, padT 14 |
| §1 改后②·控制图屏（250→210） | SVG 336×210。散点 + 两道范围线（橙虚线上沿 / 红虚线下沿）。超范围的点半径 4、其余 2.6，且上红色 —— 不靠颜色单独表意。纵轴 6.3 / 5.7 / 4.8 / 4  | 需改 | M | frontend/src/views/analysis/PvControlChart.vue:20（const H = 250）、:72-7 |
| §1 改后③·逐月点图屏（200→180） | SVG 336×180。12 槽保留，缺的槽写「投产前 / 不足 / 未到」。这张只降高、不改画法（点数只有 12、字本来就在图上）。纵轴 1.4 / 1.1 / 0.9 / 0.6，x 轴 | 需改 | S | frontend/src/views/analysis/PvBetaChart.vue:19（const H = 200, padT 16, |
| §1 改后④·明细表 4 列 → 行卡 | 4 列（日期 / 读数 / 比值 / 状态）在 336 上每列 84px 放不下「1842 kWh」。改两行行卡、行高 56、一屏 8 张：第一行 日期（09-12）+ 读数右对齐 mono | 需改 | M | frontend/src/views/analysis/PvDetailTable.vue:13（ROW_H 32 / HEAD_H 24  |
| §2 表第1行·容器 | 桌面 右侧抽屉 width:720 → 手机 整屏 sheet，top:47（压住状态栏以下），圆角 20 0 0。画板 CSS 实写：.sheet { position:absolute; | 需改 | S | frontend/src/components/fp/FPDrawer.vue:185-196（≤600：width:100%!import |
| §2 表第2行·三图排布 | 桌面 竖排、一次全见 → 手机 四档段控，一次一块。  | 新建 | M | frontend/src/views/analysis/PvMeterAnaView.vue:544-550 |
| §2 表第3行·图高 | 桌面 300 / 250 / 200 → 手机 240 / 210 / 180。  | 需改 | S | frontend/src/views/analysis/PvDriftChart.vue:19；frontend/src/views/ana |
| §2 表第4行·明细表 | 桌面 4 列 × 可见 8 行 → 手机 行卡，两行 × 56 高。  | 需改 | M | frontend/src/views/analysis/PvDetailTable.vue:13、:70-91；frontend/src/s |
| §2 表第5行·上一栋/下一栋 | 桌面 抽屉内按钮、循环 → 手机 脚部常驻两枚，44 高；下一栋那枚写出栋名。图上脚条：.sheet-f { padding:10px 12px 30px; border-top; gap: | 需改 | M | frontend/src/views/analysis/PvMeterAnaView.vue:536-541（badge 槽两枚图标钮）、: |
| §2 表第6行·标题栏 | 桌面 栋名 + 关闭 → 手机 返回箭头 + 栋名 + 上下栋箭头(44)。图上：.sheet-h padding 10px 10px 10px 14px + 下边框；左一枚裸 20×20  | 需改 | M | frontend/src/components/fp/FPDrawer.vue:56-70（fp-dwr-hd：icon + title + |
| §2 注释框①·为什么是段控不是继续竖排 | 竖排 1078px 意味着「下一栋」按钮要滑到底才点得到 —— 而逐栋翻看正是这个抽屉存在的理由。段控把每一块压进一屏，脚部两枚按钮常驻，翻栋不用滚。代价：一次只看得见一块；接受 —— 这四 | 新建 | S | 无 |
| 屏内提示·「另 3 块」一行 | 11px 灰字（color: text-muted、padding 2）一行：「另 3 块：控制图 · 逐月点图 · 明细表 —— 用上面的段控切」。  | 存疑 | S | 无 |
| 屏内表脚·「共 255 天 · 已抄 240 · 缺抄 15」 | 11px 灰字一行：「共 255 天 · 已抄 240 · 缺抄 15」。  | 需改 | S | frontend/src/views/analysis/PvDetailTable.vue:54-61（foot computed）、:92 |

#### CockpitPhone（④ 经营驾驶舱 · 手机版）  — 共 21 块，已符合 3，要动 18　→ P2

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §1 改后手机屏样 · 驾驶舱 @390 · 亮色 | 6 瓦 + 「更多 1 枚」= 330px；结论条紧跟横幅；主图读数句常驻；4 块进折叠；总高约 1980px，滑 3 屏。屏框 390×844，状态条 47px，顶栏 52px，底栏 90 | 需改 | L | frontend/src/views/analysis/AnaShell.vue:244（.anx-body padding 24px）;  |
| §2 第 1 行 · 工具条 | 常显（换期是入口）。改后画法：第一行「按月/按年」分段（t44：高 44、内边距 4、每档高 36 / 字 13 / 左右 14）+ 期间字段（t44：高 44、圆角 12、字 16、宽 1 | 需改 | M | frontend/src/views/analysis/AnaShell.vue:148-151（seg）; frontend/src/vi |
| §2 第 2 行 · KPI 6 枚 + 「更多 1 枚」 | 桌面 7 枚 → 手机常显 6 枚（2 列 × 3 行）+ 折 1 枚。瓦片 108px 高、2 列 gap 6、圆角 12、内边距 12；标签 12/18，主数值 mono 20/26（放 | 需改 | M | frontend/src/views/analysis/CockpitView.vue:340-363（7 枚）; frontend/src |
| §2 第 4 行 · 结论条 | 常显 · order −2，是这屏在手机上的头条。图上画成**竖排 4 句**（.concl 纵向 gap 7），每句 = 7px 语义色圆点 + 12/18 正文 + **行尾 chevr | 需改 | M | frontend/src/views/analysis/CockpitView.vue:466-475（模板）; frontend/src/ |
| §2 第 5 行 · 月度收入 · 预测护栏（主图） | 常显 · .av2-s8 order −1。AnaEChart 高 300→230（图宽 336）。读数句 + 参照系两行本来就是常驻的，手机照搬：「已选 8月 / 8月 收入 −¥63.6 | 需改 | S | frontend/src/views/analysis/CockpitView.vue:480-496; frontend/src/view |
| §2 第 6 行 · 收入构成 环图 | 常显。AnaEChart 高 300→116，且手机版改成**环 116×116 在左、图例竖排在右**的并排版式；图例每行 = 10px 色块 + 名称 + 右对齐加粗百分比 + **金额 | 需改 | M | frontend/src/views/analysis/CockpitView.vue:499-506; frontend/src/view |
| §2 第 7 行 · 收缴率 vs 目标 | 常显。AnaEChart 高 250→190。卡头 hint 手机版写「2026年近 6 期 · **点柱看欠费清单**」（后半截用链接色）。卡下读数句「8月 收缴 81.3%，距目标差 1 | 需改 | M | frontend/src/views/analysis/CockpitView.vue:536-543; frontend/src/view |
| §2 第 8 行 · 异常速览 | 常显（零图表开销，本来就是一行一句话，手机上最省地方）。图上画成 3 行，每行 min-height 40px、内边距 0 2：7px 语义色圆点 + 两行文字（标题 12px/500 +  | 需改 | M | frontend/src/views/analysis/CockpitView.vue:545-559; frontend/src/view |
| §2 第 9 行 · 收入趋势 · 下月预测 | 折叠（预测是坐下来看的；它与主图讲同一件事的不同侧面）。自绘 280→240。  | 需改 | S | frontend/src/views/analysis/CockpitView.vue:511-524; frontend/src/comp |
| §2 第 10 行 · 分期收入堆叠 | 折叠（三期的拆分在现场很少被问到）。AnaEChart 250→190。  | 需改 | S | frontend/src/views/analysis/CockpitView.vue:527-534; frontend/src/view |
| §2 第 11 行 · 这条带过去准不准 | 折叠。5 列表 → 行卡。理由：回测是给「要不要信这条带」的人看的，不是给查数的人。  | 需改 | M | frontend/src/views/analysis/CockpitView.vue:563-587（ak-tbl 5 列）; front |
| §2 第 12 行 · 欠费清单模态 6 列 | 模态 → 整屏 sheet，从点收缴率图柱进。理由：第 04 块的规则 ④ —— sheet 有明确的关闭，模态在手机上不该是浮层。  | 需改 | M | frontend/src/views/analysis/CockpitView.vue:608-632（.cv2-mask/.cv2-mod |
| §3 主图：唯一一处 dataZoom slider | cockpit.logic.ts:509 是全仓唯一写了 dataZoom.slider 的地方，S 档被 AnaEChart.vue:35-43 剔掉，只剩 inside 捏合平移、无可见 | 需改 | S | frontend/src/views/analysis/cockpit.logic.ts:509（逐字命中，行号也对）; frontend/ |
| §3 自绘预测图 280→240 | AnaForecastChart 降高 40（280→240），x 标签隔一标，预测段的区间上下沿写进读数句（现在只在图上有带、数在 hover）。  | 需改 | S | frontend/src/components/ana/AnaForecastChart.vue:16（height 默认 280）; fr |
| §3 5 列回测表 → 行卡 | 5 列（站在哪个月末 / 下月预测 / 区间 / 实际 / 中没中）在 336 上每列 67px：「869 ~ 967」这种 9 字符 mono ≈ 60px 刚好，但「2026-03 月末 | 需改 | M | frontend/src/views/analysis/CockpitView.vue:568-583（5 列 thead/tbody）;  |
| §3 欠费清单模态 6 列 → 整屏 sheet | 点「收缴率 vs 目标」的柱进。桌面是居中模态，手机上改整屏 sheet：顶部标题栏带返回，6 列换成行卡（租户 + 欠费金额 / 账期 + 逾期天数），脚部一枚「导出催缴单」—— 稿称这枚 | 存疑 | M | frontend/src/views/analysis/CockpitView.vue:608-632（6 列：租户/公司/应收/实收/欠费 |
| §3 KPI 第 3 枚副行文案（这屏最容易出的错） | KPI 第 3 枚「园区利润」为负时数字标红（profit 入参），副行写「利润率 — 基数过小 · 1-9月」。红色 + 「—」在两列 173px 的瓦上很像加载失败。处理：保持红色（它是 | 需改 | S | frontend/src/views/analysis/CockpitView.vue:347-348（园区利润瓦，profit 入参 +  |
| §3 journey 主线的具体含义（排序理由） | 三条问句里 B（电费）和 C（到期）都不落在这屏，只有一类落在这里：「这个月整体怎么样 / 收了多少 / 亏没亏」。所以手机排序只服务这一类：结论条 → 主图(收入) → 构成(钱从哪来)  | 需改 | M | frontend/src/components/ana/ana.css:183-192（S 档 order：.av2-lead −2 / . |

#### ParkTenantPhone（⑤园区维度 ParkView + ⑥租户维度 TenantPortfolioView，各一屏代表）  — 共 28 块，已符合 5，要动 23　→ P2

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §0 导语·三个处理手段 | 共同难点＝「块内要写字」的图：TreeMap 块内 label 11px、帕累托 Top20 的 20 根柱、7 列 × 12 行的宽表，三者在 336 宽上都放不下字。三个手段各不相同：T | 存疑 | S | 无（纲领句，落点分散在下面各块） |
| §1 ⑤园区·现状诊断条 | TreeMap 18 个块在 336×190 里，最小的块 55×62；源码判据是 w>54 && h>30 才写字，所以 18 个块刚好都在写 → 18 个 11px 名字挤成一片。3 列 | 需改 | S | frontend/src/views/analysis/ParkView.vue:93（label fontSize 11 / lineHe |
| §1 ⑤园区·改后说明条 | 四件事：TreeMap 只画前 6 块 + 「其余 12 栋」一块；3 列表换行卡；环图图例补金额；散点 / 出租率 / 面积转换进折叠。  | 需改 | L | frontend/src/views/analysis/ParkView.vue:323-424 |
| §1 手机壳·期间行 + 截至行 | 期间行：按月 | 存疑 | S | frontend/src/views/analysis/AnaShell.vue:146-165（期间组）；frontend/src/vie |
| §1 ⑤园区·KPI 行（2 列 × 2 行） | 2 列栅格，四瓦：在租楼栋 18 栋 / 建筑面积 21.4 万㎡；月租金总额 ¥198.4万 / 有效合同 386 份；出租率 92.6% / 按可租面积；单位面积月租 ¥18.2/㎡ / | 存疑 | M | frontend/src/components/ana/ana.css:179-181（.av2-kpis @600 两列）；fronten |
| §1 ⑤园区·TreeMap 并块（前 6 + 其余 12 栋） | S 档只画前 6 块（一期3-4座 32.4万 / 二期1座 21.8万 / 三期A栋 18.2万 / 一期5-6座 16.4万 / 二期2座 13.1万 / 三期B栋 11.0万），其余  | 需改 | M | frontend/src/views/analysis/ParkView.vue:83-100（treemapOption.data 全量  |
| §1 注①·TreeMap 并块判据 | 判据＝块内放得下「名字 + 值」两行 11px：名字最长 6 个汉字 ≈ 66px + 内距 14 = 80 宽，两行 ≈ 34 高。336×190 按面积排，第 7 块起低于这个门槛。点「 | 新建 | M | frontend/src/views/analysis/ParkView.vue:101-105（现有 onTreeClick 只做过滤，无 |
| §1 ⑤园区·TreeMap 卡头手机文案「点块看租户」 | 卡头 hint 在 S 档补一句可点的触屏话术「· 点块看租户」（蓝色链接色）。  | 新建 | S | frontend/src/views/analysis/ParkView.vue:325（现有 .hint-desk「· 点击下钻右侧明细」 |
| §1 ⑤园区·TreeMap 结论句 + 参照系行 | 结论句：「前 6 栋占全园月租 56.9%；其余 12 栋并成一块。」参照系行：「n=18 栋 · 有效合同月租 · 万元」。  | 新建 | S | frontend/src/components/ana/ana.css:161（.ana-read）、:164（.ana-ref）；fron |
| §1 ⑤园区·租户明细 3 列表 → 行卡 | 3 列表换行卡，6 行：第一行 租户名 + 右对齐 ¥12.4万；第二行 一期 3-4座 ——右端—— 到期 2027-03。卡头补「共 386 份 · 点行看合同」。  | 需改 | M | frontend/src/views/analysis/ParkView.vue:339-352（.pk-tbl-wrap max-heig |
| §1 ⑤园区·期区环图 + 图例补金额 | 环图下补图例行，每行 期名 + 占比 + 金额：一期 42% 83.3万 / 二期 33% 65.5万 / 三期 25% 49.6万。结论句「三个期区合计 ¥198.4万/月，一期占 42% | 新建 | M | frontend/src/views/analysis/ParkView.vue:115-123（donutOption，label 只有  |
| §1 ⑤园区·「更多分析」折叠（3 块） | 把 楼栋×租户散点、出租率、面积转换 三张卡收进一个默认收起的「更多分析」折叠，副标列出三块名字并标「3 块」。  | 新建 | L | frontend/src/views/analysis/ParkView.vue:359-371（散点）、:373-392（出租率）、:39 |
| §1 注②·散点 mini 段控 22 → 44 | .anx-seg.mini 从 22 高 / 11px 抬到 44 高。它在卡头右端，抬到 44 后卡头变两行 —— .av2-card-h 的 flex-wrap 允许这件事。代价：卡头高 | 需改 | S | frontend/src/components/ana/ana.css:26-27（.anx-seg.mini padding 2px /  |
| §2 ⑥租户·现状诊断条 | 帕累托 Top20 每柱 15px，20 个序号标签挤在一起；7 列 × 12 行清单表整块横向溢出（7 列 × 80 = 560 > 336）。  | 需改 | S | frontend/src/views/analysis/TenantPortfolioView.vue:79（PAR_N=20）、:93（b |
| §2 ⑥租户·改后说明条 | 帕累托柱不减、标签隔 4 标；清单表换两行行卡，7 个字段全在；箱线 / 续约风险 / 生命周期进折叠。  | 需改 | L | frontend/src/views/analysis/TenantPortfolioView.vue:345-444 |
| §2 ⑥租户·帕累托 x 标签隔 4 标 | 20 根柱一根不减；x 标签隔 4 标，只出 1 / 5 / 9 / 13 / 17；横轴口径改为租金排名序号。累计折线与右轴百分比（0% / 50% / 100%）保留，左轴 0 / 3. | 需改 | M | frontend/src/views/analysis/TenantPortfolioView.vue:87（xAxis axisLabel |
| §2 注④·帕累托减标签不减柱 | 20 根柱在 336 上每根 15px —— 柱本身看得清（15px 宽的柱不糊），糊的是 20 个序号标签（每个 11px ≈ 13px，间距 2px）。所以 x 标签隔 4 标(1/5/ | 需改 | S | frontend/src/views/analysis/TenantPortfolioView.vue:93（barWidth:14）、:9 |
| §2 ⑥租户·帕累托卡头「点柱看租户」+ 已选芯片 | 卡头 hint 补「· 点柱看租户」；点柱后在图下出一个「已选 Top1」可清除芯片。  | 新建 | M | frontend/src/views/analysis/TenantPortfolioView.vue:352（现有 hint 无 hint |
| §2 ⑥租户·帕累托结论句 + 参照系 | 结论句「Top1 宏远电子 ¥12.4万，Top10 累计 31.4%。」参照系「n=386 户 · 横轴 = 租金排名 · 万元/月」。  | 新建 | S | frontend/src/components/ana/ana.css:161、:164；frontend/src/views/analys |
| §2 ⑥租户·期区环图 + 户数图例 + 点扇区筛清单 | 图例三行带户数：一期 42% 162 户 / 二期 33% 127 户 / 三期 25% 96 户。卡头补「· 点扇区筛清单」。结论句「一期 162 户 占月租 42%；点扇区把下面的清单筛 | 需改 | M | frontend/src/views/analysis/TenantPortfolioView.vue:361-368（.tp2-dl 图例 |
| §2 ⑥租户·7 列 × 12 行 → 两行行卡 | 7 个字段：租户 / 楼栋 / 期区 / 月租金 / 面积 / 单位租金 / 到期。两行行卡：第一行 = 租户名(可省略) + 月租金(右对齐，主字段)；第二行 = 楼栋 · 期区 ——右端 | 需改 | L | frontend/src/views/analysis/TenantPortfolioView.vue:428-441（7 列 .ak-tb |
| §2 ⑥租户·「更多分析」折叠（3 块） | 把 合同月租分布(箱线/散点带)、续约风险、合同生命周期 三张卡收进默认收起的「更多分析」折叠，副标列名字并标「3 块」。  | 新建 | L | frontend/src/views/analysis/TenantPortfolioView.vue:372-393（散点带 + .ak- |
| §2 注⑥·续约风险空态照显 | 「合同起止日期未录入，无法评估到期与续约风险」空态照显、不折叠 —— 它告诉用户缺什么数据，AnaEmpty 带着「去合同录入」的入口。空态本身很矮（约 90px），不占地方。  | 存疑 | S | frontend/src/views/analysis/TenantPortfolioView.vue:395-402；frontend/s |

#### EnergyPhone（② 电费成本分析 + ③ 充电桩分析 + ⑧ 光伏回收，1700×3499）  — 共 22 块，已符合 8，要动 14　→ P2

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §0 板头·三屏共用处理链 | 三屏合计 9 张 AnaEChart、一个常驻的数都没有。三屏共用同一套处理：结论条可点 → 图下读数句 → 堆叠段数在手机上并档。  | 需改 | L | 电费 3 张 frontend/src/views/analysis/ElecAnalysisView.vue:351,361,370；充电 |
| §1 小节头·电费深链话术被 .hint-desk 藏了 | 三张图都点击深链成本总览对应月，这句话现在被 .hint-desk 藏了（≤600 整段 display:none）  | 需改 | S | ElecAnalysisView.vue:349（`<span class="hint-desk"> · 点击深链成本总览对应月</span |
| §1 手机屏样·电费 @ 390 · 改后 | 结论条提到最前；四句各自可点并给出 › 记号；堆叠九段并成 Top3 + 其余；三张图各一条读数句 —— 格式「已选 7月 ×｜7月 自发自用抵扣 ¥23.0万，12 期里最高。」+ 参照行 | 需改 | M | ElecAnalysisView.vue:338-342（结论条）、:193-206（structOption）、:138-149（tren |
| §1 说明·九段堆叠 336 宽每段 2.1px | 9 个费项 × 12 个月；最大「电度电费」占 44%、最小「退补」占 0.9%，后者在 220 高的柱上是 2px，图例却给了它一行 11px 的字。改后并成 Top3 + 「其余 6 项 | 存疑 | M | ElecAnalysisView.vue:193-206（structOption，stack 'st'，barMaxWidth 30）、: |
| §1 说明·结论条在手机上是「四个入口」不是「四句话」 | 源码里这四句本来就可点（深链到对应的月 / 对应的卡）。桌面有手型、手机什么都没有，所以每句行尾补一枚 ›。不是新增功能，是把已有的可点性说出来。  | 需改 | S | ElecAnalysisView.vue:339-341（`<button v-for="c in conclusion" class="e |
| §1 说明·模拟数据条不删、但让位 | 「本页含模拟数据(灰标口径)，真实电费单导入后自动替换」必须留（数据诚实），但不该占第一眼。改后排在结论条之后、图之前，样式降到 11px 灰底条。手机上靠 order，桌面 DOM 序不变 | 需改 | S | ElecAnalysisView.vue:322-325（.ea-simbar）、:382（.ea-simbar 已是 var(--fs-m |
| §2 手机屏样·充电桩 @ 390 · 改后 | 工具条第一行 = 段控(44) + 年份(44) + 翻页(44)，第二行 = 截至 + 设置；结论条 4 句（每句带 ›）+ 「查看分桩明细 →」；4 张图折叠成 2 张常显 + 2 张收 | 需改 | M | AnaShell.vue:288-291（两行结构已有）、:273（翻页钮 28×28，要 44）；ana.css:101（.ak-seg2 |
| §2 表第1行·桩月度量收(堆叠+线) | 桌面高 300 / 手机高 220；13 台桩按区并成 3 段（现在是按桩 13 段）【改】；x 隔一标  | 需改 | M | ChargingAnalysisView.vue:323（:height="300"）、:133（chart1Opt）；降档表 fronte |
| §2 表第2行·运营商收益占比(环) | 桌面高 250 / 手机高 116 环 + 图例；环缩到 116，图例行带百分比与金额（现在只有色块+名）【改】  | 存疑 | M | ChargingAnalysisView.vue:332（:height="250"）、:171（donutOpt） |
| §2 表第3行·手续费率(柱) | 桌面高 250 / 手机高 170；3 根柱，值直标柱顶（第 04 块规则 ⑤）【改 · 折叠】  | 存疑 | M | ChargingAnalysisView.vue:342（:height="250"）、:184（feeOpt） |
| §2 表第4行·电表损耗率(多折线) | 桌面高 250 / 手机高 200；3 家折线 → 1 线 + 范围带，点月出三家值【改 · 折叠】  | 存疑 | M | ChargingAnalysisView.vue:352（:height="250"）、:200-211（lossOpt，三家各一条 lin |
| §2 说明·「按桩堆叠 13 段」并成「按区 3 段」 | 13 台桩 × 12 个月，每柱 24px 宽 ÷ 13 段 = 每段不到 2px，而且图例 13 行会把图挤没。并档判据同电费：按已有的分组维度并（桩本来就有 A/B/C 区归属），不按占 | 需改 | M | ChargingAnalysisView.vue:133（chart1Opt 按桩出 series）、:311（goDetail 按钮已在结 |
| §3 手机屏样·光伏回收 @ 390 · 改后 | 爬坡图 260→220、季度标签隔 3 标（22Q1/23Q3/25Q1/26Q3/28Q1）；加读数句「累计收益 ¥1394.7万，占总投资 36.5%。」+ 参照行「n=44 个记账月  | 需改 | M | PvRoiView.vue:210（高）、:78（xAxis 无 interval）、:208（卡头 hint）、:105-125（phas |
| §3 说明·卡内 max-height:210 的滚动框要去掉 | 明细表在卡里套了一个 210 高的滚动区（≈5 行可见）。桌面上它是为了不让卡被 44 行撑爆；手机上它是一个嵌套滚动。改后：整卡不限高，行卡直接排，超过 5 行的部分「下滑加载」。页面只有 | 需改 | S | PvRoiView.vue:286（.roi2-tblwrap { max-height: 210px; overflow: auto; } |

#### ⑦ 到期墙 · 手机版（ExpiryPhone.dc.html，Main 索引里的第 14 块）  — 共 29 块，已符合 2，要动 27　→ P2

| 块 | 要求 | 判定 | 量 | 落点 |
|---|---|---|---|---|
| §1 手机屏样·改后 @390 | 4 瓦常显（合同总数 / 当前合约租金 / 未来12月到期 / 最近的缺口）+ 5 瓦折进「更多指标 … 5 枚 ›」折叠条；8 季柱值直标；「先谈哪几户」名单提到租金带之前；租金带 pad | 需改 | L | frontend/src/views/analysis/ExpiryView.vue:127-151（瓦序：合同总数/当前合约租金/有租金合 |
| §1 注释卡·AnaRentBandChart 字号低于 11 | 源码最小字号 10px，是全稿唯一一处低于 11；改后 10 → 11。代价是 y 轴标签变宽：11px 下约 33px + 刻度线 6 = padL 40 就够；padL 54 → 40  | 需改 | S | frontend/src/components/ana/AnaRentBandChart.vue:160（.arb-unit 10px）、1 |
| §1 注释卡·AnaRenewalChart 112 高两件事 | 手机上高度不变（112 已经很矮）。① 份数直接写在段内（80 / 22 / 10），段名写在带上方；② 带下面那行算式「续签 80 / 到期 112 = 71.4%」直接写出来。这张图不需 | 存疑 | M | frontend/src/views/analysis/ExpiryView.vue:315-316（:height="112"）；fron |
| §1 注释卡·「续签率变一档」表标当前档 | 4 列（续签率 / 末月租金 / 差额 / 差幅）换行卡后，给最接近当前续签率（71.4%）的那一行加一道蓝描边 + 「≈ 当前 71.4%」。这是本稿在这屏加的唯一一个视觉标记，写在这里让 | 存疑 | M | frontend/src/views/analysis/ExpiryView.vue:326-342（表）、332（第一列已印 tag）；f |
| §2 取舍表 1·KPI 9 瓦 | 桌面 auto-fit → 手机两列；常显 4 + 折 5。常显 4 = 合同总数 / 当前租金 / 未来12月到期（份数+金额合并）/ 最近的缺口（口径来自第 06 块 KpiPhone） | 需改 | M | frontend/src/components/ana/ana.css:179-180（≤600 两列，已符合）；frontend/src/ |
| §2 取舍表 2·到期墙 未来 8 季 | 250 → 190；常显 · 值直标。8 根柱每根 38px，11px 的「18」放得下 → 第 04 块规则 ⑤  | 存疑 | M | frontend/src/views/analysis/ExpiryView.vue:261（AnaEChart :height="250" |
| §2 取舍表 3·先谈哪几户 4 列表 | 表 → 行卡；提到第 3 位（桌面上它排在租金带之后，手机上提前）。问句 C 的正解是名单  | 需改 | M | frontend/src/views/analysis/ExpiryView.vue:284-301（卡，DOM 序在租金带 273-279 |
| §2 取舍表 4·合约租金带 未来 12 月 | 自绘 280 → 240；常显（主图）。10px → 11px、padL 54 → 40、标签隔一标  | 需改 | S | frontend/src/views/analysis/ExpiryView.vue:276（AnaRentBandChart :heigh |
| §2 取舍表 5·续签率从哪来 | 自绘 112 → 112（不变）；折叠。理由：它是「71.4% 这个数怎么来的」——口径，不是现场问句  | 新建 | M | frontend/src/views/analysis/ExpiryView.vue:305-319（av2-s6 卡） |
| §2 取舍表 6·续签率变一档 4 列表 | 表 → 行卡；折叠（情景推演，坐下来看）  | 需改 | M | frontend/src/views/analysis/ExpiryView.vue:326-342 |
| §2 取舍表 7·合同金额 Pareto | 300 → 220；折叠。理由：与「租金集中度」讲同一件事，且 Top10 集中度已在 KPI 瓦  | 存疑 | M | frontend/src/views/analysis/ExpiryView.vue:346（AnaEChart :height="300" |
| §2 取舍表 8·租金集中度环图 | 300 → 116；折叠  | 存疑 | M | frontend/src/views/analysis/ExpiryView.vue:352（AnaEChart :height="300" |
| §2 取舍表 9·合同清单 7 列表 | 表 → 行卡；折叠。412 行的全量清单，做法同第 13 块（ParkTenantPhone）的租户清单  | 需改 | M | frontend/src/views/analysis/ExpiryView.vue:365-400（7 列表 + 行内展开 381-395 |
| §3 租金带几何·高 | 桌面 280 → 手机 240（标「改」）。判据：与 AnaForecastChart 同档（自绘 280 档） | 需改 | S | frontend/src/views/analysis/ExpiryView.vue:276 |
| §3 租金带几何·最小字号 | 桌面 10 → 手机 11（标「改」）。判据：中文可读性下限，全稿唯一一处低于 11  | 需改 | S | frontend/src/components/ana/AnaRentBandChart.vue:160、169、171 |
| §3 租金带几何·padL | 桌面 54 → 手机 40（标「改」）。判据：单位「万/月」挪到 y 轴顶，标签只剩 5 字符 ≈ 33px  | 需改 | S | frontend/src/components/ana/AnaRentBandChart.vue:33（box padL 54, padR  |
| §3 租金带几何·每列宽 | 桌面 (W−62)/12 → 手机 (336−46)/12 = 24.2  | 存疑 | S | frontend/src/components/ana/AnaRentBandChart.vue:33、47-48（innerW = wid |
| §3 租金带几何·x 标签 | 桌面 12 个全标 → 手机隔一标 6 个（标「改」）。判据：「10月」11px ≈ 22px > 24.2 − 4 间距  | 需改 | S | frontend/src/components/ana/AnaRentBandChart.vue:109（v-for geo.xTicks  |
| §3 租金带几何·hover 竖线 + SVG 气泡 | 桌面有 → 手机「点 → 读数句接管」（标「改」）。判据：第 04 块；SVG 气泡在 336 宽上会贴边  | 新建 | L | frontend/src/components/ana/AnaRentBandChart.vue:50-58（onMove）、140-147 |
| §3 注释卡·读数句只改内容 | ExpiryView.vue:184-185 已写着「末月租金预计 000~000」+「月度口径 · 万元 · 过去000份到期中0份续签」。改后默认句把锁定值写进去：「末月(8月)锁定 ¥ | 需改 | S | frontend/src/views/analysis/ExpiryView.vue:184-185（骨架）、277-278（真句）；fro |
| §4 续签率带 @336·现状 | 一条横带分四段，段内不写数、段名不写——续签 80 / 退租 22 / 转租 10 这三个数只在 hover 里。带子本身只告诉你「蓝的那段比较长」  | 存疑 | M | frontend/src/components/ana/AnaRenewalChart.vue:87-94；frontend/src/vie |
| §4 续签率带 @336·改后 | 高度不变 112。份数直标段内（80 / 22 / 10）、段名（续签 / 退租 / 转租）写在带上方；带下那行算式「续签 80 / 到期 112 = 71.4%」直接写出来。不加接管态—— | 存疑 | M | frontend/src/components/ana/AnaRenewalChart.vue:75-104；frontend/src/vi |
| §4 续签率变一档 4 列表 → 行卡 | 4 列（续签率 / 末月租金 / 差额 / 差幅）换行卡：主行「续签率 60%」+ 右「¥188.2万」，次行「−¥7.9万 · −4.0%」。四档 60/70/80/90；给最接近当前 7 | 存疑 | M | frontend/src/views/analysis/ExpiryView.vue:326-342（表头 329：续签率 / {末月} 月 |
| §5 Pareto @336·现状 | 20 根柱在 336 上每根 15px——柱本身看得清，糊的是 20 个序号标签（每个 11px 约 13px，间距 2px）；累计折线与右轴百分比在 260 高下还行，但每根柱的值只在 t | 存疑 | S | frontend/src/views/analysis/expiry.logic.ts:60-82（paretoOption）、70-73（ |
| §5 Pareto @336·改后 | 高 300→220；x 标签隔 4 标（1 / 5 / 9 / 13 / 17），柱一根不减；加读数句「Top1 合同 ¥12.4万/月，Top10 累计 31.4%」+ ana-ref「n | 需改 | M | frontend/src/views/analysis/ExpiryView.vue:344-347（卡无 ana-read/ana-ref |
| §5 注释卡·为什么它在折叠线以下 | 三条理由：① 头条数已在 KPI 瓦（Top10 集中度 31.4% 是第 7 枚瓦），Pareto 多出来的是分布形状；② 与第 8 块租金集中度环图讲同一件事，两块一起折；③ 问句 C  | 新建 | S | frontend/src/views/analysis/ExpiryView.vue:137（Top10 集中度瓦）、344-363（Par |
| §5 注释卡·与租户维度帕累托的差别 | 同构但口径不同：租户维度横轴是租户（385 户），这张是合同（386 份）。读数句的 .ana-ref 必须写出来：这张写「n=386 份生效合同」，租户维度那张写「n=386 户」  | 新建 | S | frontend/src/views/analysis/ExpiryView.vue:344-347（本屏 Pareto 卡无 ana-re |