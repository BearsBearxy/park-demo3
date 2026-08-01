# 刀E：复核修正（LOC-MEMBER-FIXUP-SPEC）

> 定稿 2026-07-31。承接 METER-LOC-MEMBER-SPEC（刀A/刀D）落地后的用户报障 3 条 + 三路验证挑出的待修 6 条。
> **本 spec 的每一条都先复核过**，复核结论与证据写在条目里；标「待复核」的条目由实现方先复现再动手，禁止凭猜改。

## 0. 复核结论汇总

| # | 报障/发现 | 复核结论 | 定性 |
|---|---|---|---|
| E1 | 天面做成了一整块，要一行一行分开 | **属实**，是我把定位列做了 rowspan；原册区域/楼层列是**每行都填**的，只有分摊系数/标准/已分摊/盈亏 才合并 | 确认，改法明确 |
| E2 | 编辑态改费项保存无反应 | **未复现成功**：后端 `AllocRule.feeName` 带 `FieldStrategy.ALWAYS`（会写 null）、`apply()`/`updateRule` 路径看不出问题 → **必须先复现再改** | 待复核 |
| E3 | 一堆没单元号/没电表号/租户名错的导入 | **属实且比报障更严重**：库里有 **310 块影子表**（重复建档），全部带读数 | 确认，需治理方案 |
| E4 | §D.1 楼层两源冲突 | 属实但 V3 举证多数是错的，真实冲突 4 例 | 确认，改法明确 |
| E5 | 桶数可超 coefficient | 属实，4 个池超，合计超收约 1,038 元 | 确认，改法明确 |
| E6 | direct 池候选未生效 | 属实，5 参重载是死代码 | 确认 |
| E7 | 导入冲掉人工改的位置字段 | 属实 | 确认 |
| E8 | §A.3 留空=跨层落不住 | 属实 | 确认 |
| E9 | rule 49 锚点空转测试 / rule 22 无验证 | 属实 | 确认 |
| E10 | sideRank 回退误判 | 属实（「东风车间」会判成东侧） | 确认，低危 |

---

## E1 逐表行去掉定位列合并（用户报障①）

**用户原话**：「我要的不是在前端做成一整块的天面，而是做成跟用户的 excel 数据表一样一行一行分开的，如果有共用一个数值的你要么一个数复制几行，要么就一个填一个其他几个派生」

**复核**：对着原册截图逐列数——原册 A座天面 4 行里，`区域=A座` 写了 4 次、`楼层=天面` 写了 4 次、`电表名称` 各不同、`应分摊金额` 逐行（151.3/298.82/225.28/335.78）；**只有** `分摊系数 12487.04`、`分摊单价 1.11416875`、`分摊标准 0.08`、`已分摊 839`、`盈亏 −172.18` 是跨 4 行的合并单元格。

我当前实现把「楼层·方位」和「池名称」也做了 `rowspan`，屏上就成了一个大块。**方向反了**。

**改法**（`PoolLedgerView.vue`）：

| 列 | 现在 | 改成 |
|---|---|---|
| 楼层·方位 | rowspan 合并 | **每行都渲染**（复制） |
| 池名称 | rowspan 合并 | **每行都渲染**（复制），`Σ 用量/金额` 副标题只在**首行**显示 |
| 电表 / 倍率 / 上月 / 本月 / 用量 / 应分摊 | 逐行 | 不变 |
| 分摊语义 / 分摊标准 / 摊出 / 差额 / 实收 / 盈亏 / 备注 / 系数(月) / 加度(月) | rowspan 合并 | **保持合并**（= 原册的合并单元格） |

- 复制出来的定位/池名从第 2 行起用 `--text-tertiary` 淡显，让人一眼看出是同一个池的续行，同时保留「一行一行分开」的形状。
- 池内第 2 行起保留现有的虚线上边框（`.pl-sub`）作为池块分隔。
- 导出 AOA 同步：`楼栋 / 楼层·方位 / 池名称` 三列改成**每行都填**（现在是只填首行）；合并类列维持只填首行。

**验收**：A座天面 4 行的「天面」「电梯」各出现 4 次；`12487.04㎡分摊`、`0.08`、`0.00`、`−1,011.18` 各只出现 1 次且纵向跨 4 行。

---

## E2 编辑态改费项保存无反应（用户报障② · 待复核）

**复核到哪一步**：
- 后端 `AllocRule.feeName` 标了 `@TableField(updateStrategy = FieldStrategy.ALWAYS)`，MP 的「null 不更新」坑在这个字段上**不成立**。
- `AllocService.apply()` 第 419 行 `r.setFeeName(...)`、第 423-425 行 `noLocation` 三元式逻辑上都对。
- `submitPool` 的 payload 带了 `feeName`；`updateRule` 走 `apply → updateById → saveChildren`。
- **看不出确定病因，禁止凭猜改。**

**顺带复核出的两个真实隐患**（同一段代码，与本条一并处理）：
1. `openPoolDlg` 用 `ruleById.value.get(r.ruleId)` 取 `feeKey/coefficient/extraQty`。而 `rules` 是 `loadRules().catch(() => {})` **静默失败**加载的——一旦这次请求失败，`rule` 为 undefined，`feeKey` 静默回落 `'share_elec_floor'`、`coefficient/extraQty` 变空串，**保存即把这三个字段冲掉**。
2. `submitPool` 成功后没有任何成功提示，用户无法区分「存了但没变化」与「压根没存」。

**实现要求**：
1. **先写一条后端往返 IT**：建池（feeName=A）→ `PUT /api/alloc/rules/{id}`（feeName=B）→ `GET /api/alloc/pools` 断言 `feeName=B` 且 `autoName` 末段随之改。绿了就说明后端无辜，问题在前端；红了直接定位后端。
2. 按 IT 结果定位并修复真正的病因，**在提交物里写明根因**。
3. 无论根因在哪，一并做掉：`loadRules()` 失败不再静默（失败时禁用保存并提示重试）；保存成功给一条轻提示。

---

## E3 影子表治理（用户报障③）

**复核结论 —— 比报障更严重。**

用户看到的「幸悦电1 / 黄路生电 / 沈振电 / 周应佳电 / 林观平620电」五行「园区公摊」，是**同一块表的第二份档案**：

| 真档案（位置/编码/租户齐全） | 影子档案（全空） |
|---|---|
| `231 孙洋洋电` A座·四楼437室·幸悦·`220605000134` | `1140 幸悦电1` area/spot/tenant_name/code **全 NULL**，ownership=share |
| `239 暨南医美电` A座·四楼420室·黄路生·`220605000146` | `1141 黄路生电` |
| `240 辰威电` A座·四楼422室·沈振·`220605000148` | `1142 沈振电` |
| `1424 A座-四楼427室-电表①` A座·四楼428室·周应佳·`220605000033` | `1143 周应佳电` |
| `257 次生代620电` A座·六楼620室·林观平·`221103010139` | `1144 林观平620电` |

**全库规模**（`area+spot+tenant_name+code` 四项全空）：

| zone | 块数 | 读数条数 |
|---|---|---|
| dorm | **289** | 317（2024-02 / 2024-05） |
| p1 | 15 | 15 |
| p2 | 6 | 6 |
| **合计** | **310** | **338** |

宿舍那 289 块更离谱：`陈昌辉尖 / 陈昌辉峰 / 陈昌辉平 / 陈昌辉谷` —— **一户被拆成四块表**，说明宿舍册的尖/峰/平/谷四列被当成四块独立表导入了。

**根因**：真档案的 `name`（标识名）里嵌了**过期的租户名**（孙洋洋/暨南医美/辰威/次生代），租户一换，新册的标识列写成新租户名（幸悦电1/沈振电），导入身份键三层 L1(编码)→L2(位置)→L3(标识名) 全部落空 → 静默新建。而新册那几行的区域/位置列在解析后为空，L2 也接不住。

**当前危害**：
- 抄表屏冒出 310 行没有位置、没有编码、归属被默认成「园区公摊」的假表，用户完全看不懂。
- 金额侧**暂时**干净：A座 `d_qty=34876.50` 与原册「A座总用电量 34876.5」完全一致，说明影子表没进楼栋分表Σ（它们 `area` 为空，不归任何区块）。
- **但这是定时炸弹**：刀A 刚把 `area` 做成可编辑，任何人给影子表填一次区域，它的用量立刻并进楼栋Σ 与公摊池分母，造成重复计量。

**本刀范围（只做识别与隔离，不做自动合并）**：

1. **DB 层加标记，不删数据**：新增迁移给 `meter` 加 `suspect VARCHAR(16) NULL COMMENT '存疑档案:shadow=疑似重复建档(位置/编码/企业名称全空)'`，按上述四空条件回填 310 条。**不自动删、不自动合并** —— 合并要人工认对，认错就丢读数。
2. **抄表屏**：`suspect='shadow'` 的行加醒目「存疑·疑似重复」徽标 + 行底色；筛选器加一档「只看存疑」。
3. **护栏（关键）**：`suspect='shadow'` 的表**一律不进**楼栋分表Σ 与公摊池分母（`inSubSigma` 加一条排除），把定时炸弹拆掉；同时在损耗屏与池屏的 warn 里点名「本月有 N 块存疑表未计入」。
4. **导入侧**：新建表时若同 `(kind,zone,building_id)` 下已存在「读数序列高度相似」的表，落一条导入告警（不阻断），提示可能重复建档。相似判据：**同一 ym 的 `curr_total` 完全相等**（幸悦 4169.89、沈振 2448.37、周应佳 16.82 都是精确相等，判据成立且零误伤风险）。
5. 影子表的**人工合并/清理**留给下一刀（需要用户逐条认对），本刀只出一份 `scripts/shadow-meter-audit.tsv` 清单（真档案 ↔ 影子档案配对 + 读数对比），供用户核对。

**验收**：310 条被标记；抄表屏能筛出来；`alloc_loss_result` 与 `alloc_pool_result` 重新生成后与刀前**零差异**（因为它们本来就没进 Σ，加护栏后仍不进）。

---

## E4 §D.1 楼层两源冲突：加告警，不改优先级

**复核**：121 条自动分桶成员行里，L1（合同→单元）只覆盖 **21** 条，86 条靠 L2（户内表）接住，14 条未定层。

逐条看那 21 条：绝大多数 L1 与 L2 一致或 **L1 更全**（健明包装 L1=一楼+五楼、L2 只有一楼）。真实冲突 4 例，最典型是 **邓宇峰：`unit_no='天面'` 但 `floor=1`，电表说二楼** —— 主数据脏。

**所以不反转优先级**（反转会丢掉 L1 更全的那些），改为：**两源都非空且不相等时落 warn 点名到户**，让人去修主数据。

warn 文案：`池「X」租户「Y」楼层两源不一致:合同单元=A、户内表=B,已按合同单元计;请核对主数据`

## E5 桶数超 coefficient：落 warn，不封顶

**复核**：多个池桶数 > 账册分母。

> **⚠ 清单已按 L1 优先口径重算于 2026-07-31（§F9）。**下表是重算后的结果；本条初稿写的
> 「rule 3（5.80 vs 9 桶）/ rule 11（6 vs 8）/ rule 2（7 vs 9）/ rule 10（7 vs 8）、合计超收 1,038.39 元」
> 是按 **L2-only（只看户内表）** 口径估的，与实现（§D.1 **合同单元优先**）不一致，作废。

**2024-02 全部 26 个 floor 池重算（只读 SQL，摊出侧照 §D.2 逐桶按面积二拆复算；
`cost_amount / std_value` 直接取库内快照，红线列一格未动）**：

| rule | 池 | 分母 | 桶数 | 应分摊 | 摊出 | 超收 |
|---|---|---|---|---|---|---|
| **3** | 二期 一车间·电梯+低压电房照明 | 5.80 | **7** | 843.14 | 1017.60 | **+174.46** |
| **11** | 二期 四车间·电梯+低压电房照明 | 6.00 | **7** | 1719.52 | 2006.13 | **+286.61** |
| **22** | 二期 六车间·电梯+低压电房照明 | 6.00 | **7** | 995.74 | 1161.73 | **+165.99** |

**超分母池 = 3 个，超收合计 627.06 元**（初稿的 1,038.39 作废）。

关键变化：rule 2 与 rule 10 **不再超** —— 两池实测都是 7 桶，而分母恰为 7.00，`7 > 7` 不成立，落不出 warn。
rule 22 反倒是初稿漏掉的第三个超分母池。

**未超但摊出 > 应分摊的池（不落 §E5 warn，因为判据是桶数比分母，不是金额）**：
rule 50（3 桶=分母 3，摊出 907.50 vs 应分摊 718.08，超 189.42 —— 账册加度 170 度造的**正当**盈余，
907.50 = 账册已分摊 AE，见下）、rule 69（+111.42）、rule 70（+111.41）、rule 49（+0.01）、
rule 77（+3.42）、rule 78/79/10（+0.01）。**摊出零**的 6 个池（58/59/60/68/88/89）无受益人，
走的是「无受益人，应分摊 X 元未摊到户」那条 warn，与本条无关。

**不封顶**：rule 50 的超收（907.50 vs 应分摊 718.08）是**正当的** —— 账册用加度 170 度故意把度差亏损转成盈余（`POOL-FORMULA-AUDIT-2024-02.md:158` 原文），且 907.50 与账册已分摊 AE=907.5 吻合。一刀切封顶会打死这个已验证锚点。

**改为**：`桶数 > coefficient` 时落 warn：`池「X」按 N 层拆但账册分母为 M 层,摊出超应分摊 Z 元,请核对系数或成员楼层`。同时在 METER-LOC-MEMBER-SPEC §D.2 补一句反向口径。

## E6 direct 池候选：接上 method 透传 + 补租户选择器

`AllocController.poolCandidates` 只收 4 参，`AllocService` 的 5 参 `method` 重载**无任何调用方**，`Candidates.tenantNote` 也没人读。

**改法**：
1. 控制器加 `@RequestParam(required = false) String method` 透传 5 参重载。
2. 前端 `poolCandidates()` 带上 `method`。
3. **同时**给 direct 池的受益人段补一个全库租户选择器（复用已有的 `FPTenantPicker`，不引新依赖）—— 否则候选变空后那唯一一户没法挑（这正是上一刀 D2 主动缓做的原因，缓得对，但不能一直缓）。
4. 补一条 IT：direct 池的 `tenants` 为空数组且 `tenantNote` 非空。

## E7 导入不再冲掉人工改过的位置字段

`MeterService.applyDesc`：`if (spot 非空) { m.setSpot(...); applyLoc(m, null, null, null); }` —— 三个 null 触发「按 spot 重解析」，把抽屉里人工改过的楼层/方位/房号冲掉。刀A 刚把「细化位置」写成导入报错的自救指引，下次导入就推翻它；且该函数头注释写着「空值不清既有」，与这行行为相反。

**改法**：导入侧**只在目标字段当前为 NULL 时才回填**（`if (m.getFloorLabel() == null) ...`），已有值一律不动。`spot` 本身照常更新（它是身份键）。

## E8 §A.3「留空=跨层」落得住

`applyLoc` 把 blank 当「按 spot 重解析」，所以抽屉里清空楼层后会被 spot 解析回来，用户看到「改了没生效」。

**改法**：`MeterReq` 区分 `null`（不指定 → 按 spot 解析）与 `""`（显式清除 → 置 NULL）。`applyLoc` 只在参数为 `null` 时走 `parseFloor`。前端 select 的空选项提交 `""`。

## E9 补两个锚点的真验证

- `floorWeight_explicitShareUnchanged` 现在只做 `82.67×0.5=41.34` 的算术复算，**不调用任何被改代码**，删掉 weight 分支它照样绿。改成喂 `floorBuckets`/`memberAmounts` 一组 weight 与 null **混合**的成员数据。
- §D.3 第 4 个锚点（rule 22 二期六车间电梯，`165.96 × 实际层数`）**完全没有验证**，补上。

## E10 sideRank 回退收紧

`meterGroup.sideRank` 在 `side` 为空时对整段 `spot` 做 `includes('东'/'西'/'南'/'北')`，「东风车间」这类名称会被误判成东侧。收紧为匹配 `[东西南北]侧`。只影响组内排序，不影响金额。

---

---

# 刀F：刀E 的复核修正（2026-07-31 第二轮验证产出）

> 刀E 十条全部落地且测试全绿，但三路验证挑出 2 条 high **都指向我在 §E3 写错的判据**，另有若干中低危。
> **V75 尚未应用到 dev（Flyway 仍停在 74），炸弹还没装上——必须在应用前把 F1/F2 修掉。**

## F1【high】护栏判据错：「档案四空」不等于「重复建档」

**我的错**：§E3 用「area+spot+tenant_name+code 四项全空」当重复判据。这是**档案完整度**条件，不是重复性条件。

**后果（已复核证实）**：`1415 黎镇源临电(栋30) / 1416 佳亿兴电 / 1417 广聚运通电 / 1418 欧伟杰临电(栋31) / 1419 广联临电(栋33)` 五块**真表**（`ownership=share`、挂栋、E3 自己的清单里 basis 写「无匹配」）会被标 shadow 并**永久踢出楼栋分表Σ**。今天用量恰为 0.00（prev==curr）所以没暴雷，下月抄出非零读数就静默消失，E=D−C 偏低、损耗率与租户损耗费一起算少。

**另一处连带错**：我在 §E3 写「影子表 area 为空不归任何区块，金额侧暂时干净」——**错**。`inSubSigma` 的归组走 `building_id` 不走 `area`。我拿 `alloc_loss_result` 里 02:10 的**旧快照** 34876.50 当活数据的证据，而用户 03:57 又导了一次，真档案补上了读数，与影子档案变成双份。活数据实际是 33841.90。

**改法 —— 两级标记**：

| 标记 | 判据 | 进 Σ / 池分母 | 屏上 |
|---|---|---|---|
| `suspect='shadow'` | 四空 **AND** 能配到一块**档案完整**（area/code/tenant_name 至少一项非空）的同 `kind/zone/building_id` 表，且**同月 prev+curr+factor 三格全等** | **否**（护栏排除） | 红底「存疑·疑似重复」 |
| `suspect='incomplete'` | 四空但配不上 | **是**（照常计入） | 黄底「档案不全」 |

**实测分布**（新判据，只读 SQL 已验）：`shadow=10`（全在一期，正是那批双份档案）/ `incomplete=300`（含 5 块 p2 临电、289 块宿舍分时表）。5 块 p2 临电正确落入 `incomplete`，保住 Σ。

宿舍那 289 块配不上是**正确**的——它们是「分时四列被拆成四块表」，不是同一块表的两份档案，读数本就不相等。它们 `building_id` 为 NULL、不进任何 Σ，属纯展示噪音，`incomplete` + 屏上提示即可。

V75 的回填条件按新判据重写。

## F2【high】导入重复探针误报率约 30%，「零误伤」被证伪

**我的错**：§E3.4 写「同月 `curr_total` 完全相等，判据零误伤风险」。实测碰撞：`225 A4东侧总1 / 226 A4东侧总2`（都 0.10，2024-02 与 2024-05 两次都撞）、`236 A4西侧消防灯 / 253 A6东侧消防灯`（2024-05 都 184.69）——**真·不同表**。宿舍水表小整数读数最多 5 块互撞。

而现实现撞上即 `setSuspect("shadow")` → 当场被踢出 Σ，屏上只有一条聚合 warn。

**改法**：
1. 判据换成与 F1 同款：**新表四空 + 已有表档案完整 + 三格全等**。`225/226` 档案完整，第一道就过不了。
2. **只提示不打标**：导入结果里出一条「疑似重复建档」清单（表名 + 疑似对应的真表），**不自动设 suspect、不触发护栏**。打标要人工在档案抽屉确认。

## F3【medium】护栏只挡 D 不挡 C，warn 文案说了没做的事

`inSubSigma` 只在 `lossGroups` 的分表分支被调用；`infra` 总表走 `headQty` 分支不过它。而 warn 文案写「未计入楼栋分表Σ **与公摊池分母**」——公摊池分母走显式 `alloc_rule_meter`，根本不经 `inSubSigma`（实测 `meter 1139` 已标 shadow 仍绑在 rule 61 上）。

**改法**：池侧真挡——`poolSegQty` 遍历绑定表时跳过 `shadow` 并落行级 warn；`infra` 侧同样跳过 shadow（一块重复的总表进 C 同样是重复计量）。文案与实现对齐。

## F4【medium】改一个倍率就解除存疑

`MeterService.apply()` 末尾无条件 `setSuspect(null)`，而抽屉里每个行内编辑都走全量 `update` → 改个倍率就把标记清了，护栏立刻失效、红徽标消失、无从追溯。

**改法**：只有当本次提交**真的补齐了识别信息**（area / spot / code / tenantName 至少一项由空变非空）才清标；否则保留。

## F5【medium】新增表弹窗的空值语义与抽屉相反

`MeterView.submitMeter` 用 `trimOrNull(mForm.floorLabel)`，空选项 `value=''` → `trimOrNull('')` 返回 **null**，而后端新三态里 `null` = 「按 spot 解析」。所以新建一块 `spot='四楼西侧101室'` 的表并显式选「—(跨层/不适用)」，落库仍是 `四楼/西侧`。Select 的 label 写着「可空=跨层」，是假的。抽屉那条路 `reqOf` 发 `''` 才是对的。

**改法**：新增弹窗三列改发 `''`（与抽屉一致）。

## F6【medium】表挪了地方，楼层不跟随（§E7 的 spec 级缺口）

§E7 我给的判据是 `if (m.getFloorLabel() == null)` 才回填，于是**已有值一律不动**。但 `meter.floor_label` 是 §D.1 二级回退的数据源，直接决定 floor 池的桶数与逐户金额。一块表从三楼挪到五楼，导入把 `spot` 改成五楼、`floor_label` 停在三楼 → 桶算错、钱算错，屏上 spot 与楼层自相矛盾且零告警。

**改法**：`meter` 加 `loc_manual TINYINT NOT NULL DEFAULT 0`。人工在抽屉改过位置三列即置 1；导入时 `loc_manual=0` 的**跟着 spot 重解析**（表挪地方能自动跟上），`=1` 的不动但**落一条 warn**（「表 X 的位置原文已变为 A，而人工设定的楼层仍是 B，请核对」）。这样人工修正保得住、位置迁移也跟得上。

## F7～F13（medium/low，改法明确）

| # | 问题 | 改法 |
|---|---|---|
| F7 | 前端 `meterSplit.inSubSigma` 未同步 shadow 排除，抄表屏楼栋合计比损耗屏多算（A座 2024-02 多 107.80）；该函数注释自己写着「与后端同一口径，勿分叉」 | 前端同步排除 `shadow`；`incomplete` 照算 |
| F8 | `floorWeight_explicitShareNotBucketed` 把「weight 非空不入桶」这句判断**抄进了测试**，删掉 `AllocService` 里那行它照样绿 | 改成走 `memberAmounts` 级别，或在 `AllocApiIT` 建一个 weight 与 null **混合**的 floor 池 |
| F9 | rule 22 实测 **7 桶**（按 §D.1 合同单元优先），不是 spec §D.3 写的 5 桶；§E5 的超分母池清单（rule 2/3/10/11、合计 1038.39）是按 L2-only 口径统计的，**不全** | 按 L1 优先口径重算清单与合计，更新 METER-LOC-MEMBER-SPEC §D.3 与本 spec §E5 的数字 |

### F8/F9 落地记录（2026-07-31）

**F8**：分支边界改由 `AllocApiIT.poolFloorMixedWeight_explicitShareNotBucketed` 锁——同一个 floor 池里
weight 与 null **混合**（tE weight=0.5 + t2/t3 自动分桶），走 `generate → memberAmounts` 真实调度路径。
tE 的合同挂四楼、`members[].floorLabel=四楼`，所以它没进桶只可能是 weight 分支拦下的，排除「定不出楼层」这个替代解释。
**验收实跑**：注释掉 `AllocService` 第 952 行 `if (m.getWeight() != null) continue;` 后本用例变红
（`allocatedAmount expected:<92.85> but was:<111.42>`，另有 tE 金额 18.57→37.14、盈亏 −18.57→0.00 同步失守），
还原后 `AllocApiIT` 20/20 绿。原纯函数用例更名为 `floorWeight_explicitShareArithmetic`，
注释里写明它只锁两侧算术、盖不住调度。

**F9**：见上方 §E5 重算表与 METER-LOC-MEMBER-SPEC §D.3。**超分母池 3 个（rule 3/11/22），超收合计 627.06 元。**
重算用只读 SQL 复刻 §D.1 两级回退（L1=覆盖 2024-02 的非草稿合同 → `contract.unit_id` ∪ `contract_unit` → `unit.floor`，
按池 `building_id` 过滤；L1 空才看 `meter.ownership='tenant'` 且未停用的 `floor_label`）＋ §D.2 逐桶按面积二拆。
交叉验证：rule 22 得 7 桶 / 摊出 1161.73 / 超收 165.99，与 `AllocServiceTest.floorBuckets_rule22_sevenFloorBuckets`
逐户手核出来的数字**逐分相同**；rule 50 得 907.50（＝账册已分摊 AE）、rule 49 得 330.69（现值不变）。
⚠ 库内 `alloc_pool_result` 2024-02 的 `allocated_amount` 仍是**刀D 前的旧快照**（rule 22 还写着 165.96＝只摊 1 份），
本次重算未依赖它，只取了红线列 `cost_amount / std_value`。
| F10 | §E1 去 rowspan 后分隔线方向反了：池**内**每行有虚线、池**间**反而没有 | 虚线改到池首行的上边框（池间分隔），池内续行不画线 |
| F11 | `rulesFailed` 为真时三元式盖住 `poolErr`，后端 400 看不见 | 两条都显示 |
| F12 | 抽屉里 `area/code/tenantName` 的「留空=清除」失效（`Meter.java` 这三列仍是 MP 默认 `NOT_NULL` 策略，`set(null)` 被整列剔除） | 三列各加 `@TableField(updateStrategy = FieldStrategy.ALWAYS)` |
| F13 | `AllocService` 的 4 参 `poolCandidates` 重载在控制器改走 5 参后成为死代码 | 删 |

## F14【待用户拍板 · 不在本刀实现范围】招商中心电1/2 挂错栋

`meter 223 招商中心电1 / 224 招商中心电2` 现挂 `building_id=41` + `ownership=infra`，而 `V66 §4` 明文写「净效果=招商中心电1/2(1142.4) 计入 A座分表Σ」。这 1142.40 度目前从 A座 D 里掉出去了。

对账闭合：`33734.10（加护栏后的活数据） + 1142.40 = 34876.50`，**逐分等于原册「A座总用电量 34876.5」**。

即：F1 护栏 + 恢复 V66 口径，A座就精确回到账册锚点。**但改主数据归属要用户点头，本刀只列证据不动手。**

---

# 刀F 实现计划

| # | 步骤 | 独占文件 | 自检 |
|---|---|---|---|
| 1 | **F1 两级标记（改 V75，勿新建 V76）** | `V75__meter_suspect.sql`、`entity/Meter.java`、`dto/MeterDTO.java`、`service/MeterService.java`、`service/AllocService.java`(inSubSigma)、`api/MeterApiIT.java` | IT 锁 shadow/incomplete 两态；只读 SQL 证 shadow=10 / incomplete=300 |
| 2 | **F2/F3/F4 探针与护栏** | `service/MeterService.java`、`service/AllocService.java`、`api/MeterApiIT.java`、`api/AllocApiIT.java` | IT 锁「225/226 不被标」「shadow 不进池量」「改倍率不清标」 |
| 3 | **F6 loc_manual** | `V76__meter_loc_manual.sql`(新建)、`entity/Meter.java`、`dto/MeterReq.java`、`service/MeterService.java`、`views/meters/MeterDetailDrawer.vue`、`api/MeterApiIT.java` | IT 锁「未人工确认→跟随 spot」「人工确认→不动且落 warn」 |
| 4 | **F5/F11/F12/F13 收口** | `views/meters/MeterView.vue`、`views/alloc/PoolLedgerView.vue`、`entity/Meter.java`、`service/AllocService.java` | build + IT |
| 5 | **F7/F10 前端口径与分隔线** | `utils/meterSplit.ts`(+spec)、`views/alloc/PoolLedgerView.vue` | vitest + build |
| 6 | **F8/F9 测试与清单重算** | `service/AllocServiceTest.java`、`api/AllocApiIT.java`、两份 spec 的数字 | 删掉被测那行断言必须变红 |

**并行三验**：V1 回归红线（含「shadow=10 / incomplete=300」「5 块 p2 临电仍入 Σ」「225/226 未被标」三条专项）；V2 逐条核 F1–F13；V3 对抗复核。

**红线不变**；纪律不变（改 .vue 必跑 `npm run build`；禁止手工预跑迁移；不重启前后端）。

---

# 实现计划

**先复核，再动手**（E2 是唯一「待复核」项，必须先复现）：

| # | 步骤 | 独占文件 | 自检 |
|---|---|---|---|
| 1 | **E2 复核+修复** | `AllocApiIT.java`（先加往返 IT）→ 定位后修 `AllocService.java` 或 `PoolLedgerView.vue` | 往返 IT 绿 + 根因写进提交物 |
| 2 | **E1 逐表行去合并** | `views/alloc/PoolLedgerView.vue`、`utils/poolLedgerLogic.ts`(+spec) | `npm run build` + vitest |
| 3 | **E3 影子表治理** | `V75__meter_suspect.sql`、`entity/Meter.java`、`dto/MeterDTO.java`、`service/MeterService.java`、`service/AllocService.java`(inSubSigma)、`views/meters/*`、`scripts/shadow-meter-audit.tsv` | IT + build + 生成清单 |
| 4 | **E4/E5 分摊告警** | `service/AllocService.java`、`AllocServiceTest.java` | 单测锁两条 warn |
| 5 | **E6 direct 候选** | `controller/AllocController.java`、`api/alloc.ts`、`views/alloc/PoolLedgerView.vue`、`AllocApiIT.java` | IT 断言 tenants 空 |
| 6 | **E7/E8 导入与清空口径** | `service/MeterService.java`、`dto/MeterReq.java`、`views/meters/MeterDetailDrawer.vue`、`MeterApiIT.java` | IT 锁「导入不冲人工值」「空串=清除」 |
| 7 | **E9/E10 补测与收紧** | `AllocServiceTest.java`、`utils/meterGroup.ts`(+spec) | 单测绿 |

**并行三验**：V1 回归红线（`alloc_pool_result`/`alloc_loss_result` 对 baseline 零差异 + 既有锚点单测未放水）；V2 逐条核 E1–E10 验收线；V3 对抗复核（默认怀疑前两者，专找「测试能过但实现不对」，并核实 E3 的护栏真的拆掉了炸弹）。

**红线不变**：`cost_amount / std_value / base_snap / qty_* / alloc_loss_result` 算法一律不动。

**纪律**（本轮已踩过）：改 `.vue` 必须 `npm run build`；禁止手工预跑迁移 SQL；不重启前后端；测试不许放水。
