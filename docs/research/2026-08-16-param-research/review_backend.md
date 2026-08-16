# S21 后端对抗性复核（Task 1~9，ffe3fab..409e8cb）

> 复核员：后端只读复核（不改代码）。日期 2026-08-16。对照 `docs/design/S21-PARAM-CENTER-SPEC.md` 与 `docs/superpowers/plans/2026-08-16-s21-param-center.md`。
> 范围：V96/V97/V98 迁移、VersionResolver、PriceCfgService/AllocService 接管、ParamRegistry、ParamService/ParamController、AllocService 损耗率定稿、测试与 dev 实测。
> 结论一句话：**底盘可用，红线（2024-02/2023-10/2023-08 池/损耗快照）在 dev 库上成立，`mvn test` 全绿；无「严重」级问题；4 项「中」级需在 Task 10~14 前拍板/补一刀，其余为低危与文案/边角。**（跟进 2026-08-16：M2/M3/M4 已修并附测试，见各条「已修」；M1 属口径拍板，事实核实与选项见其条下。）

---

## 0. 验证记录（做了什么、看到什么）

| 项 | 方法 | 结果 |
|---|---|---|
| 全量测试 | `backend\mvnw.cmd -q test`（Testcontainers mysql:8.0 空库跑全部迁移） | 见文末「测试结果」小节（81 个测试类 / 625 用例，0 失败 0 错误） |
| V96/V97/V98 dev 库 | `flyway_schema_history` 顶三条 = 96/97/98 | 已应用；`loss_g_adj` 0 行、`loss_adj_qty month` 5 行（含 building:13 −1500）、`coefficient from` 73 行（36 条 2024-02 + 37 条 '' 迁自 alloc_rule）、rule 23 `extra_qty` 列 0 / `alloc_rule.coefficient` 全 NULL、B/C 座 loss_variant 各两版本、p2 loss_denom_cable 两版本、一车间 loss_head 两版本、p1 elevator_area_base 5 版本、`price_flat/price_loss/green_rate_live/lamp_rate_live/dorm.loss_rate/p2.lamp_rate|green_rate` 0 行 |
| ④ G 去 g_adj 后 2024-02 A座 | `alloc_loss_result` 2024-02 building 13 | g_qty 86.80 / adj_qty −1500 / tenant_rate **0.0616**（= 并入前）；B/C 座 share_only 0.0213/0.0190；二期 30/32/34/35 = 0.0271/0.0255/0.0287/0.0381（与 S15 锚点同）；formula_rate=tenant_rate、manual_rate NULL、denom_qty=C（2024-02 二期不含铝缆）；2023-08 二期 32/34 denom=C+铝缆 29192/166239.2 |
| GET /api/params 实测 | dev 后端 8181，`?ym=2024-02&zone=p1`（482 行）与 `?ym=2023-08&zone=all`（771 行） | 抽行核对见 §1；禁词正则扫 label/valueText/scopeLabel/rangeText/sourceChain **0 命中** |
| status/history/changes | `GET /api/params/status?ym=2024-02`、`/history?key=loss_variant&scope=building:20`、`/changes?ym=2024-02` | priceOk 6/6、pendingChanges 0、stale false；history 两版本 + 三条 migrate 日志；changes 空（migrate 不计入）✓ |

### 1. 读侧抽行（语义核对，全部符合 spec §2.2/§5.2）
- `loss_variant @ 一期 B座`：2024-02 → 1「纯公摊…」`2023-11 起长期` rowId 有；2023-08 → 0「正常核算…」`初始版本 ~ 2023-10` ✓（from 前滚 + 下一版本推区间）
- `extra_qty @ 招商中心·净电（池）`：2024-02 → −670 `仅 2024-02` hasMonthRow；2023-08 → 空（默认扣度已归 0）✓（month 精确）
- `loss_adj_qty @ 一期 A座` 2024-02 → −1500 度 `仅 2024-02`（note「并自 loss_g_adj」）✓
- `loss_denom_cable @ 二期 三车间` 2023-08 → 「分母 = 总表 + 铝缆」`初始版本 ~ 2023-09`，sourceChain=[二期:…]，rowId 空 ✓（级联首中在期级）
- `loss_head @ 二期 一车间` 2023-08 → 「并入 二期 五车间」`初始版本 ~ 2023-09` ✓；三车间/五车间/六车间 → 「独立核算」（无行默认语义）✓
- `coefficient @ 一期 A座·天面·电梯（池）`（base_key 池）→ 只读「分母 = A座电梯面积基数 14818.35（价目参数）」editable=false；2024-02 → 12487.04 `2024-02 起长期` ✓
- `capacity_fee @ 可莱恩（户）` → 23，sourceChain=[可莱恩（户）:23 ; 全园:22.6] ✓
- `mgmt_fee @ 全园` → 0.16 `长期（初始版本）` ✓；`elec_commercial @ 全园` 2024-02 → month `仅 2024-02` ✓

---

## 2. 发现清单

### 严重
无。

### 中

**M1. 二期损耗费/对账单价改走 `elec_flat + mgmt_fee`，与退役的 `p2.price_loss=1.25312` 不等价（spec §4.3 的「1.25312 = 平段+0.16 的 2024-02 版」与库数据不符）**
- 文件：`backend/src/main/java/com/park/demo3/service/AllocService.java:1420-1430`（`lossPrice`）、`:1078-1096`（`ruleCostAmount`）；`V98__loss_result_formula_rate.sql:12`（删 price_loss）。
- 事实：dev 库 `tenant_price_cfg` 2024-02 `elec_flat=0.72076875`，+0.16 = **0.88076875**；V47 种子 `p2.price_loss=1.253120` 注为「1.09312+0.16（分摊分析 K27 硬编码常数）」——1.09312 不是任何 2024-02 分段裸价（峰 1.20606875 / 尖 1.50076875 / 谷 0.29116875）。一期 `1.11417 → 0.79416875+0.32=1.11416875` 仅是截断差，可接受。
- 后果：`alloc_result` 2024-02 二期 `share_elec_loss` 52 行 `price_snap` 已由 1.25312 变为 0.880769（sum 2258.58，按比例约少 30%）；`recon` 对账屏二期池 `ruleCostAmount` 同口径变化。**催缴单不受影响**（BillNoticeService E2 损耗行 = 链基数×率，`BillNoticeService.java:431-435`），池/损耗快照亦不受影响，故未触红线；但「户级分摊结果」屏（度数口径）与对账屏二期数字变了，且 Task 6 提交只声明「池/损耗快照逐格全等」，未核对 alloc_result。
- 复现：`docker exec demo3-mysql mysql ... -e "select ym,price_snap,count(*),sum(amount) from alloc_result where fee_key='share_elec_loss' group by 1,2"` → 2024-02 出现 0.880769。
- 建议：请用户拍板二期损耗计费价口径（平段？峰段？源册 K27 的 1.09312 出处），拍板前不要把 `alloc_result` 二期损耗行当锚点；若源册就是常数 1.25312，需保留一个可配置键（如 `p2` 级 `price_override`/新键）而不是硬走平段。
- **实现工程师复核（2026-08-16，不改代码，待拍板）**：事实核实成立——dev `tenant_price_cfg` 2024-02 `elec_flat=0.72076875`（+0.16=0.88076875），`alloc_result` 2024-02 二期 `share_elec_loss` 52 行 `price_snap=0.880769`（sum 2258.58）；代码是 spec §4.3 的字面实现，错的是 spec 括注「1.25312 = 平段+0.16 的 2024-02 版」。1.09312 的出处：`BOOK-STRUCTURE-2024-02.md` §5.2.4 火炬园 `L24 = 1.093123（硬编码）… 高压2947.5×1.093123`，`PB-ALLOCATION-SPEC.md` 亦注「K27=1.09312+0.16 … 单价=供电局月均+0.16 每月变」——即 **2024-02 供电局高压综合月均价**，不是任何分时段裸价，也不在价目簿里（价目簿只有 5 段裸价）。影响面：二期源册户级损耗费 = `ROUND(损耗率 × 金额基数,2)`（`p2_2023-12.md` §D2、BillNoticeService E2），从不走「度数×率×单价」，故催缴单/池/损耗快照三个红线对象都与此价无关；只有「户级分摊结果」屏 `alloc_result.share_elec_loss`（度数口径）与对账屏 `ruleCostAmount` 的二期成本额受影响。可选口径请用户二选一：(a) 维持 spec §4.3 平段+0.16（分析口径，与池成本同源；2024-02 二期损耗行 −30% 只是口径变更非算错）；(b) 新增 `p2` 级月参键（如 `loss_price_p2` / 复用 `price_override`）承载「供电局月均综合价+0.16」逐月手录，复刻 K27。未拍板前不写代码（YAGNI），也不把 2024-02 `alloc_result` 二期损耗行当锚点。

**M2. 电价 6 键可以用 `mode=from` 写入，绕过「缺当月电价=门禁」；status 的 `priceOk` 又只数 month 行 → 门禁与状态条口径分裂**
- 文件：`ParamService.java:352-354`（只在 month=='' 时拦；对 `mode` 不设限）、`AllocService.java:1716-1728`（`priceGate` 走 `priceCfg.resolve`，from 行会前滚）、`ParamService.java:499-501`（priceOk 只数 `mode='month'`）、`PriceCfgService.java:81-88`（copy 只按 `acct_month=fromYm` 找源）。
- 复现（勿在 dev 跑，逻辑推演即成立）：`PUT /api/params {key:"elec_peak",scope:"",acctMonth:"2024-03",mode:"from",value:1.2}` → 200；此后 2024-04/05… `priceGate` 全过、池成本按 1.2 算，而 `GET /api/params/status?ym=2024-05` 报 priceOk 5/6，「复制上月电价」从 2024-04 复制时也找不到它。
- 建议：`write()` 对 `PriceCfgService.MONTHLY_KEYS`（电价 6 键 + `loss_base_park_amount`）强制 `mode=month`（非 month → 400「该键只能按月生效」）；spec §2.1「保存时用户可改」与 §3.1「缺当月=门禁」冲突，按后者收口。
- **已修（2026-08-16）**：`ParamService.write` 对 `MONTHLY_KEYS` 非 month → 400「「{label}」只能按月生效」（旧 `PUT /api/price-cfg` 同路径同拦）；测试 `ParamApiIT.put_registryGate_400` 加 4 断言（elec_peak/loss_base_park_amount from 400、同键 month 可写、旧端点 from 400）。前端 Task 11 编辑弹窗对这 7 键应不出「起长期」选项（后端已兜底）。

**M3. 「删被使用版本 400」判据只看月份覆盖，不看行是否在快照之后才创建 → 任何新建的初始版本 `''` 行 / 起点 ≤ 最新已生成月的 from 行都不可删**
- 文件：`ParamService.java:421-430`（`usedBy`）。
- 复现：dev 已生成 2023-08/2023-10/2024-02。今天新建 `PUT {key:"mgmt_fee",scope:"tenant:X",acctMonth:"",value:0.15}`（误加户级例外）→ 想删：`PUT {…,value:null}` → 400「已被 2023-08 使用，请改用新版本」——但 2023-08 快照生成时这行根本不存在。同理误建的 `loss_adj_qty` 2024-02 month 行也删不掉，只能「改错」成别的值，且 spec 明说不做「结束于 X 月」按钮，于是这类误录只能永久留行。
- 建议：判据改为「覆盖月份里存在快照且 `alloc_pool_result.generated_at`（或催缴单批次）**晚于该行 `created_at`**」（两表都有 `created_at` INSERT fill）；spec §5.3 原意即「取用过」。ParamApiIT `recalc_status_deleteUsedVersion` 只测了未来月，未覆盖此场景。
- **已修（2026-08-16）**：`ParamService.usedBy` 加 `createdAt`：覆盖月份里存在池快照/催缴单批次（含 recalc 兜底时间，复用 `snap()`）且其时间 **≥ 该行 created_at**（同一秒按已使用，保守）才算使用；迁移(SQL)插入行的 created_at 走 DB 默认钟(容器 UTC 偏早)只会更保守。测试 `recalc_status_deleteUsedVersion` 末尾加：重算后新建的 `''` 初始版本行 / `2099-09` 起 from 行 / `2099-10` month 行三者可删并回落上级，重算前就有的 `extra_qty` 行仍 400。⚠ 过渡期：V97 新插的版本行（如 B/C 座 `loss_variant 2023-11`）created_at 晚于现有 2024-02 快照 → 目前可删；Task 14 重算三个月后即锁定。

**M4. `POST /api/price-cfg/copy`（复制上月电价）绕过 `ParamService.write`：无 `param_change_log`、无 actor**
- 文件：`PriceCfgService.java:77-92`。
- 后果：spec §5.3「保存即写库 + 变更日志」与 §6.3 stale 判据都以日志为准；复制上月电价是每月第一步写入，却在「变更记录」页看不到、`status.pendingChanges` 不计。极端场景（该月已有池快照但缺某段电价——dorm 门禁只查 `elec_commercial`，缺 `elec_resident` 也能生成）复制补价后 stale 不亮。
- 建议：copy 逐行改走 `ParamService.write`（或至少批量落 `set` 日志 + 保持 evict）。
- **已修（2026-08-16）**：复制搬进 `ParamService.copyElec(fromYm,toYm)`（`PriceCfgService.copy` 删除，`PriceCfgController` 转调；端点/返回体 `{copied,skipped}` 不变）：只取 fromYm `mode=month` 的电价 6 键行，目标已有跳过，其余逐行 `write()`（注册表门 + `param_change_log` set/actor + evict）。测试 `PriceCfgApiIT.copy_monthlyKeysOnly_idempotent` 加断言：history 里 2099-08 一条 set/month/1.5/admin，`status?ym=2099-08` priceOk 2 且 pendingChanges 3（2 复制 + water from）。

### 低

- **L1. 新建池的 `extraQty` 入参会写成 `rule:{id}.extra_qty '' from` 行（对所有月生效）**——正是 S21 要消灭的「rule 23 默认扣度 −670 污染所有月」形态。`AllocService.java:96-99`（createRule）。前端 Task 12 只保留「初始分母」输入，此路径将成死代码；建议后端直接不接 extraQty（或强制 month）。
- **L2. `deleteRule` 不清理 `alloc_cfg rule:{id}` 行**（`AllocService.java:557-562`）。S21 后每个 area/floor 新池都有 `coefficient '' from` 行，删池即留孤儿；`GET /api/params?zone=all` 会出「池#N（池）」行（zone 视图因 `zoneOfRule` 为空被过滤掉）。建议删池时同删 `rule:{id}` 全部 cfg 行并记 delete 日志。
- **L3. `Names.lossBuildings` 把只挂供电侧总表的伪楼栋也算作损耗栋**（`ParamService.java:303-304`）：dev 实测 2024-02 p1 出现「一期 B-G座」的 loss_variant/loss_head/loss_c_meter/loss_recon/loss_denom_cable 5 行（该栋只有 `loss_supply_meter` 指向的 B-G座总电，引擎 `lossGroups` 会跳过它）。建议排除 `loss_supply_meter`/`loss_exclude` 表所在且无其它电表的栋。
- **L4. `POOL_KEYS` 对每个池都出 `coefficient/extra_qty/manual_qty/price_override/std_add` 五行**，direct/none/loss/ref/carrier 池的「分母」行没有意义（2023-08 all 视图 constant 区 366 行大半为空）。spec 原文如此（「无行显空」），但建议 `coefficient` 只对 area/floor 池出行。
- **L5. `param_change_log` 迁移基线行 `ts` 用 DB 默认 `CURRENT_TIMESTAMP`（容器 UTC）**，dev 实测 history 里 migrate 行 `2026-08-16T05:48:07`（比本机早 8h）与 Java 写入的 set/recalc 行不同钟；只影响 history 展示（stale 已排除 migrate）。`ParamChangeLog.java` 头注释「ts 用 DB 默认」也已过期（ParamService 实际用 `LocalDateTime.now()`）。
- **L6. `valueOk` 引用型（loss_head/loss_c_meter/loss_supply_meter/loss_base_park_meter）只查整数性，不查 id 存在**（`ParamService.java:388-396`）；写入不存在的栋 id 会让 `lossGroups` 生出 head=#N 的幽灵组。前端选择器会挡，但 API 层建议校验存在。
- **L7. 备注列（note）来自库内种子，含内部标识**（dev 实测 3 处：`water_pipe ''` note「(dorm 行 0)」、`price_override rule:100` note「tenant:*.water」、`fire_amount_fixed tenant:68` note「alloc_cfg rule:20/4」）。后端禁词只承诺 label/valueText/scopeLabel/rangeText/sourceChain；若前端把 note 上屏并用全页正则断言（spec §8.4）会假红——要么前端断言排除 note，要么迁移清洗这几条 note。
- **L8. `PriceCfgService.CFG_KEYS = ParamRegistry.keysOf(PRICE)` 含字面量 `loss_base_form_b{bid}`**；现无 `CFG_KEYS.contains(key)` 直接调用（都走 `ParamRegistry.get` 前缀匹配），但若日后有人复用该集合做白名单会漏 `loss_base_form_b32`。同理 `write()` 对字面量键 `loss_base_form_b{bid}` 也会放行落一条垃圾行（`ParamRegistry.get` 模板命中）。
- **L9. `recalc` 单事务包住 `alloc.generate` + `billNotice.generate`**：催缴单侧任何 BizException 会把已算好的池/损耗一并回滚，用户只看到出账错误却不知池也没更新（可接受，但提示语宜说明）。
- **L10. 旧端点 `PUT /api/alloc/cfg` 在前端 Task 12 落地前的过渡期语义漂移**：V96 把既有 `coefficient/std_add/price_override/loss_adj_rate` 2024-02 月行转成 `from`，而旧「系数(月)」入口新写的行缺省是 `month`（`AllocService.saveCfg` 缺省规则），同一键混用两种语义；Task 12 后入口收敛即消失，此处只记不改。
- **L11. 前后端注册表镜像靠手工拷贝 fixture**（`ParamRegistryTest` 导出 → 拷到 `frontend/src/utils/__fixtures__/param-registry.json`）：Java 改了不拷则前端 spec 仍绿。可考虑 CI 里 diff 两份或后端加 `GET /api/params/registry`。

### 已核实无问题的关注点（备查）
- ① VersionResolver：`resolveOne` month 精确 > from 最大(''最小)，`resolve` 级联首中；`PriceCfgService.resolveHit` 旧「键∈MONTHLY_KEYS」= 新「行 mode」（dev 电价 6 键全部为 month 行、无 '' 行；常数键全 from），`AllocService.loadCtx` 旧 ''∪ym = 新 effectiveMap 在 2023-08/2023-10/2024-02 三个月逐值等价（V96 把 2024-02 月行按键分类，''→from）。`ruleById` 用 `cfgEffective(null)`→ym '' 只取初始版本 = 旧默认列语义 ✓。
- ② V96/V97/V98 在空库（IT）与 dev 都跑通；V96 的 `INSERT…SELECT * FROM (…) AS g ON DUPLICATE KEY UPDATE … g.g_value` 在 mysql:8.0 通过；V97 按 `book_key`/楼栋名定位不硬编码 id；V97 头注释说明「price_flat/price_loss 留到 V98 同批删」逻辑自洽。
- ③ 池默认列归一：`coefficientOf/poolExtra` 只读参数表；`validateRule` 新建看入参、既有池查参数表任一 >0；`createRule` 初始分母经 `saveCfg→ParamService.write` 落 `'' from` 并记日志；`AllocRuleDTO.coefficient/extraQty` 回传生效值；`pools()` 无快照月加度取当月生效参数；`PoolSeedIT` 断言已改查 alloc_cfg。dev 复核 `alloc_rule.coefficient` 全 NULL、`extra_qty` 全 0。
- ⑤ 写侧：未注册键/退役键/作用域形态不符 → 400（ParamApiIT `put_registryGate_400` + AllocApiIT 三条）；改错命中上级作用域 → 400；删被使用版本 → 400；每次 set/delete/recalc 落日志（actor 来自 SecurityContext，IT 断言 admin）；PRICE 写后 `priceCfg.evict()`（含事务后二次失效）；旧 `PUT /api/price-cfg`/`PUT /api/alloc/cfg` 走同一 write（IT `legacyEndpoints_writeThroughParamService`）；写=admin（SecurityConfig 非 GET 全 ADMIN）。
- ⑥ 读侧禁词：dev 两次抽样 0 命中（见 §0）；registry label/formula/hint 亦无 `_`/内部标识（ParamRegistryTest 锁定）。
- ⑦ recalc：`alloc.generate(ym)`（门禁→池→损耗→alloc_result）→ `billNotice.generate(ym)`（已确认/已导出跳过计数）→ 日志 `recalc`+ym；摘要 `{pools, lossUnits, notices, skippedConfirmed, warnings}` 与 spec §5.5 一致；stale 判据排除 migrate、以最近 recalc 兜底催缴单批次时间（整月已确认户的情况）合理；日志 ts 与快照 generated_at 同用 JVM 时钟。
- 红线补充：Task 4 提交对 2024-02 已核「池/逐表/损耗/户级结果/催缴单全等」；Task 6 之后 dev 库 2024-02 催缴单批次仍是 2026-08-12（未重生成），按 E2 口径推演不受损耗价影响；建议 Task 14 重算后按 spec §8.1 逐分核对一次以闭环。

---

## 3. 测试结果
- `backend\mvnw.cmd -q test`（2026-08-16 18:36~18:49，Testcontainers mysql:8.0 空库）：**EXIT=0**；Flyway「Successfully applied 98 migrations … now at version v98」（V96/V97/V98 空库跑通）；surefire 81 个测试类 / **625 用例，0 失败 / 0 错误 / 0 跳过**（含 ParamApiIT 8、ParamRegistryTest、VersionResolverTest 6、AllocServiceTest 55、AllocApiIT、PoolSeedIT、PriceCfgApiIT）。
- 复核后无孤儿进程：maven 测试 JVM 已退出，仅剩 dev 后端（8181，18:28 启动）与 demo3-mysql 容器。
- 本复核未改任何代码/库数据（dev 只做 GET 与只读 SQL）；本文件为唯一新增文件，未提交（`docs/research/` 目录本就处于未跟踪状态，随主线一起提交）。
