# 公摊池按月配置 + G1 · 实施计划（2026-09-26）

来源：对账报告 `docs/research/pool-book-recon-2026-09-25.md`（下称报告）与分类清单（G1、M2、M9、S2、S10）。
用户 2026-09-26 拍板：「S2 改成 122.43，S10 按你说的改，然后开始实现 G1 和两项能力」。版本 **0.22.0**（master 现 0.21.0，功能更新）。

---

## 0. 全局约束

- **不提交、不推送、不 git checkout/stash/reset**。只动本任务的文件。未跟踪的 `scripts/pool-recon/`、`PoolReconRunner.java`、报告是本任务的工具，可以改。
- 源码 **UTF-8 + CRLF**。改文件用 Edit/Write 或 Python（`io.open(..., encoding='utf-8', newline='')`，锚点按 CRLF）。**禁止用 PowerShell 读写源码**。
- 后端测试同一时刻只能一个 agent 在跑（Testcontainers 共用库）。mvnw 用 PowerShell：`& "C:\financial_dashboard\demo3\backend\mvnw.cmd" -f "C:\financial_dashboard\demo3\backend\pom.xml" ...`（Git Bash 里 `cmd //c` 找不到它）。
- 判绿看产物：后端数 `backend/target/surefire-reports`（和 failsafe-reports）里的 `Tests run / Failures / Errors`；前端看 vitest 的 `Tests  N passed` 行；类型门禁 `npm run typecheck`。管道会吃退出码。**先删旧报告再跑**，别读到上一次的。
- 过程中只跑相关测试文件；全量只在验收阶段跑一次。
- 门禁：`QueryHygieneTest`（service 里 `selectList(null)` 计数全等，新查询用 wrapper）、`ReviewGuardCoverageTest`（新写路径真守，不加豁免）、`PermissionCoverageTest`、`ControllerLayerTest`、`changelog.spec`。
- 每条新断言都要**破坏验证**：改坏生产代码 → 只有那一条转红 → 用精确字符串替换还原。
- 开发库 `park_demo3`（容器 demo3-mysql，13306，root/root，客户端 `"/c/Program Files/MySQL/MySQL Workbench 8.0 CE/mysql.exe"`）**只读**。可写的只有临时库 `park_demo3_recon`（对账用，已导入 2023-08～2024-02 与 2024-05 读数，**不要再 `--import`，不要 `mkdb`**）。

---

## 1. 决定（D1–D8）

**D1 池绑定表按月版本。** `alloc_rule_meter` 加 `acct_month`，语义照抄受益人 `alloc_rule_member`（`AllocService.pickMembers`，S14）：同一池同一 `acct_month` 的行是一个版本组；站在 ym 取 `acct_month ≤ ym` 最大的那组；`''` = 初始版；全在 ym 之后 = 空。存量行全部 `''`，行为不变。唯一键改为 `(rule_id, meter_id, acct_month)`。

**D2 折入关系按月版本。** `alloc_rule_link` 加 `acct_month`，版本组按 **dst 池**分（抽屉里折入链就是在 dst 池上编辑的）。成环检查按站在 ym 的有效链做。

**D3 空版本组要能表示。**「从 M 月起一块都不绑 / 一条都不折入」必须可存（M9 的折入目标换池就需要：旧目标池从某月起入向链为空）。做法：新表 `alloc_rule_version(rule_id, part('meter'|'link'), acct_month)`，主键三列。取版本时候选月份 = 该池该部分的行的 `acct_month` ∪ 版本表的 `acct_month`；取到的组没有行 = 空。写一个版本组时（含空组）同时 upsert 版本表那一行。行表里不出现 NULL 的 meter_id / src_rule_id，现有消费方不用判空。受益人不改（不在本次范围；它同样表示不了「从 M 起为空」，在收口消息里报一句）。

**D4 写入语义（createRule / updateRule）。** 现有字段 `memberMonth` 就是这次编辑的生效月，三部分共用：
- 受益人：行为不变。
- 绑定表、折入：`memberMonth` 为空 → 替换 `''` 组（等同今天）。非空 = M → 把提交的集合（绑定：meterId+sign；折入：srcRuleId+type）和站在 M 的有效组比，**相同就什么都不写**；不同就用 M 替换（没有就新建）M 组并写版本表。理由：系数簿等只改受益人的按月编辑不能顺手给绑定表拍快照，否则以后改初始版本对后面的月份不起作用。
- 调用方不带 `meters` 也不带 `meterIds`（null）时，要先查清有没有调用方依赖「null = 清空」。查清前不改这一语义，查到的情况写进回报。
- 冻结守卫：新版本从 M 生效到该部分下一个版本之前（没有下一个 = 到最后已生成月），这一段里有冻结月就拒（审核锁 423，其余按现有约定）。若现有 `assertRuleEditable` 只守 M 一个月，就改成守整段——受益人走的是同一个入口，一起修，并在回报里写明。
- 「需重算」标记：照受益人按月编辑 / ParamService 写 from 行时的现有做法，给受影响的已生成月记 data_change_log。没有现成做法就不新造，回报里写明。
- 改池日志（`params.logRuleChange`）写清绑定表、折入变了什么、从哪月起。

**D5 取整位按月。** `round_scale` 改成参数表里的键（照 S21 把 coefficient 挪进 `alloc_cfg` 的做法）：`ParamRegistry` 加 alloc 键 `round_scale`（S_RULE、常量组、默认 from、整数、只许 2 或 3），前端 `paramRegistry.ts` 同步。迁移为 `round_scale ≠ 2` 的池写 `''` 初始版本行；引擎按 ym 解析，没有行 = 2；`alloc_rule.round_scale` 列保留但引擎不再读、updateRule 不再写。抽屉：新建池的选择框照旧（落成初始版本行，同初始分摊基数）；既有池改为只读一行 +「去计费参数页改」（照 coefficient 的 `roParamLine / gotoParams`）。

**D6 G1。** `AllocService` 1962 行一带：ref 池若是站在 ym 有效的 `fold_price` 链的**源池**，保留 cost（同普通池：段量 × 段价），计入应分摊 Σ；摊出仍只走折入标准；其余 ref / carrier 仍为 null（#12 广联加价档是折入目标、与 #11 共用表 47，保持 null）。前端 `poolLedgerLogic.ts` `bandFooter` 同步：这类行的 cost 计入合计（度数是否也计入，以源册二期合计行为准核对后定），改 `poolLedgerLogic.spec.ts` 里「ref 不计」那条。先 grep 全部 costAmount / cost() 消费方（户级 1219 行、盈亏、损耗与对账、导出打印……），逐个确认改后仍成立。验收：2024-02 两池应分摊 = 源册，二期合计 = 14333.60（源册 W126）；七个月两池都与源册相等；任何户的收费不变。

**D7 读侧与抽屉。**
- `/api/alloc/rules?ym`、`/api/alloc/pools?ym` 的绑定表和折入链返回站在 ym 的有效组；池行里的 `MeterBind` / `Link` 各加 `src`（`'default' | 'month'`，同受益人）。
- 所有「这块表被哪些池绑着」的判断（删表挡、表抽屉、候选、未入池提示……）按**任一版本**算，文字不变；「本月没绑」类判断按站在 ym 的有效组。
- 抽屉里的「只改本月（ym）起…」勾选框挪到抽屉级（园区自担等所有方法都显示），覆盖绑定表、折入链、受益人三部分，文案说清三部分都从本月起用、之前的月份不动。初始勾选 = 三部分里任一部分站在 ym 的有效组来自按月版本。

**D8 公告 0.22.0。** 按 `docs/design/RELEASE-NOTES-SPEC.md` §8 走：功能更新；重点卡 = 公摊池的绑定表和折入能按月设（新增），配 `Art0220.vue`；改进写取整位挪到计费参数页（用法变了）；应分摊合计会变（二期两块广告字池计入）——写清从哪个月起、哪些数变、已结账月份不变、户的收费不变。整版 ≤ 450 字。

---

## 2. 临时库验证（park_demo3_recon）

1. 先备份现有产物：`scripts/pool-recon/out/<月>/{diff.csv,report.md,engine.json}` → `scripts/pool-recon/out-before-0220/<月>/`。
2. 把新迁移 SQL 直接在临时库执行（runner 里 Flyway 是关的）。
3. 按报告配：
   - **M2**：#16 五车间电梯，初始版不绑表 58，2023-10 起绑（sign −1）。
   - **M9**：#9 园区消防设施、#13 绿化水泵、#15/#21 广告字在 2023-08～12 各月的取整位与折入关系，按源册逐月配（值从源册 / 报告 / extract 产物里取，写明出处格）。
   - **S2**：2023-09 一期 C2消防（编码 220710000079）本月读数 1224.30 → 122.43（该月用量变 33.96）。
   - **S10**：二期损耗 `loss_rate_manual`：一车间 2023-11 = 0.0146、2023-12 = 0.0112、2024-01 = 0.0178；二三四车间单元 2023-12 = 0.0230。`loss_adj_qty` 一车间：2023-11 少收 1000 度、2023-12 多收 1000 度、2024-01 多收 500 度（符号约定照库里已配的 2024-02「多收 300 度」那行）。
   配置尽量走与屏上相同的服务方法；直接写 SQL 时，行的形状必须和服务写出来的一致。
4. 依次 `python scripts/pool-recon/recon.py run <月>`（2023-08 … 2024-02，**不加 `--import`**）。
5. 对比前后：G1 / M2 / M9 / S2 / S10 各目标格差异归零（S2 只剩 S1 断链残差）；其他格差异不许变大。

---

## 3. 追加：分摊标准固定值（2026-09-26 用户拍板「绿化水改成按当时的固定价」）

源册 2023-08～2024-02 各户表的绿化水都按 2023 年冻结价 0.01 元/㎡ 收（隐藏格『公共电分摊』M109，库里 alloc_cfg rule:13 frozen_2023 仅备查），不跟公摊页 V64。用户选「按当时的固定价」，推翻 V62（2026-07-27）里「引擎不读冻结价」对绿化水的那部分。路灯、六车间消防等其它冻结价**这次不动**。

- **E1 新参数** `std_fixed`「分摊标准（固定值）」：S_RULE、ValueKind.MONEY、默认 mode = month（只管当月）、常量组、monthlyCheck=false，值 > 0；进 ParamService.POOL_KEYS，每个池都能在计费参数页设。`frozen_2023` 不改（仍仅备查）。
- **E2 引擎**：按面积 / 按层摊的池（area / floor），站在 ym 解析到 std_fixed 就用它作这个月的分摊标准（户金额 = ROUND(固定值 × 面积或层份, 2)，与现算标准同一条路径），缺读数也照收；应分摊（cost）仍按用量现算，差额进盈亏。其它方法忽略这个参数。折入到别池的标准用的是实际生效的标准。
- **E3 读侧与屏**：池行加 `stdFixed: boolean`（站在 ym 生效）；公共电核算屏「分摊标准」格对固定值做标记并在 title 说明。
- **E4 公告**：0.22.0 加一条新增，讲清在哪设、填了的月份重新生成后户的金额按它算、审过的月份不变。
- **E5 临时库**：rule:13 std_fixed 2023-08～2024-02 各一条 month 行 = 0.01，重跑七个月，看户级绿化水。
- **线上**：合并部署后在计费参数页给「二期园区·绿化水泵」逐月填这七条，再重新生成这些月。

> **§3 撤销（同日）**：用户问「不能用计费费项覆盖吗」——能，已有。催缴单 `BillNoticeService.collectPrice` 对二期绿化水按户级收取价 `green_rate`（计费参数「绿化水公摊单价（户）」）收，开发库 37 户已设 0.01（scripts/fixes/s13-p2-share-20260810.sql）。对账比的是公摊核算层的户级贡献，不是催缴单，所以那 51 格是比错了层。std_fixed 不做，工作流 wf_e1dd124e-742 在改文件前已停。
