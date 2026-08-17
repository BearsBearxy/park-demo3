# S21 计费参数中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把散在四处、三套版本语义的计费参数统一成「键+作用域+生效方式+值+日志」一张模型，落成一个人话的「计费参数」页 + 保存→重算闭环，并按源册定稿一期公摊分摊度数 G 与损耗率公式（招商中心 −670 默认污染归零、loss_g_adj 并入调整度数、手工率/分母含铝缆/并栋按月版本）。

**Architecture:** 后端加 `mode` 列统一 `tenant_price_cfg` / `alloc_cfg` 的版本语义，一个 `VersionResolver` 服务两表；`ParamRegistry`（Java + TS 镜像）是唯一白名单与人话来源；`ParamService/ParamController` 提供 `/api/params` 读写/历史/状态/重算，旧 `PUT /price-cfg`、`PUT /alloc/cfg` 内部改走它；前端新页 `views/params/ParamCenterView.vue` 取代价目管理页，楼栋损耗/公共电核算的月参入口收敛为只读+跳转。

**Tech Stack:** Spring Boot 3 + MyBatis-Plus + Flyway（MySQL 8）；Vue 3 + TS + Pinia + Vitest；既有 DS 组件（Button/Select/Segmented/Badge/Popover/FPDrawer）。

**Spec:** `docs/design/S21-PARAM-CENTER-SPEC.md`（下文 §x 均指它）。调研证据：`docs/research/2026-08-16-param-research/`。

## Global Constraints
- 已生成三个月（2023-08 / 2023-10 / 2024-02）的池/损耗/催缴单取值**一格不变**是迁移红线（spec §7.2）；2024-02 锚点 = 298 单 / 3461 行 / 批次 `BN20260811135134` 总额逐分相等。
- 页面文案禁止出现 `p1|p2|dorm|building:|rule:|meter:|tenant:|默认·所有月份|=0|=1|=2`（spec §5.2），前端 spec 用正则断言。
- EDIT-MODE-SPEC v2：浏览态零写入口；WRITE-KEEP-CONTEXT 铁律二：保存后只 patch 该行不重拉整页；LIST-PAGE-SPEC 行高/列宽。
- 前端检查必须 `npm run typecheck`（裸 `vue-tsc --noEmit` 无效）；后端 `mvn -q test` 全量 EXIT 0；IT 写路径月份用 `2099-XX` 槽。
- 迁移文件写完**直接重启后端让 Flyway 跑**，不要 `docker exec mysql < V9x.sql` 手工预跑（DDL 非幂等会把 Flyway 卡死）。dev 后端启动口径见 `.claude/launch.json` `demo3-backend`（`DB_PORT=13306`）。
- 写库必带 `--default-character-set=utf8mb4`；只读核对用 `docker exec demo3-mysql mysql -uroot -proot --default-character-set=utf8mb4 park_demo3 -e "..."`。
- 禁止双会话/双 agent 同时改同一工作区；每个 Task 结束 `git -C C:\financial_dashboard\demo3 status` 确认只含本任务文件再提交。
- 版本号推进不在本刀（v0.11.0 已发，S21 攒到下个 tag）。

---

## File Structure（先定边界）

**后端 `backend/src/main/java/com/park/demo3/`**
- `service/VersionResolver.java`（新）— 纯函数：`(rows, ym) → hit`；两表共用。
- `service/ParamRegistry.java`（新）— 键注册表：白名单、人话、分组、作用域种类、默认 mode、值域字典；`PriceCfgService.CFG_KEYS/MONTHLY_KEYS` 改为从这里取。
- `service/ParamService.java`（新）— 读（站在 ym 看的全部生效行 + 命中链 + 名字解析）、写（校验→落对应表→日志→evict）、历史、状态、重算。
- `service/PriceCfgService.java`（改）— `resolveHit` 用 `mode`；`upsert` 委托 `ParamService.write`。
- `service/AllocService.java`（改）— `loadCtx` 用 resolver 建 cfg map；`groupG` 去 g_adj；`groupRate` 加手工率/分母含铝缆；`lossPrice/ruleCostAmount` 走价目簿；`saveCfg` 委托；快照加 `formula_rate` 列。
- `service/BillNoticeService.java`（不改算式；仅确认 `loss_base_park_amount` 走 resolver 的 month 语义）。
- `controller/ParamController.java`（新）；`controller/PriceCfgController.java` / `AllocController.java`（保留端点）。
- `entity/ParamChangeLog.java`、`mapper/ParamChangeLogMapper.java`（新）；`entity/AllocCfg.java` / `TenantPriceCfg.java` 加 `mode`；`entity/AllocLossResult.java` 加 `formulaRate/manualRate`。
- `dto/ParamRowDTO.java`、`ParamPutReq.java`、`ParamHistoryDTO.java`、`ParamStatusDTO.java`、`RecalcResultDTO.java`（新）。
- `resources/db/migration/V96__param_mode_and_log.sql`、`V97__param_data_s21.sql`（新）。
- 测试：`service/VersionResolverTest`、`service/ParamRegistryTest`、`api/ParamApiIT`（新）；`AllocServiceTest`（改 tenantLossRate 签名）、`PriceCfgApiIT`（mode 断言）。

**前端 `frontend/src/`**
- `utils/paramRegistry.ts`（新，Java 镜像；含 `PRICE_KEYS` 迁入）+ `paramRegistry.spec.ts`。
- `utils/paramCenterLogic.ts`（新，纯逻辑：分组/文案/区间/命中链/脏计数）+ `paramCenterLogic.spec.ts`。
- `api/params.ts`（新）。
- `views/params/ParamCenterView.vue`（新页）、`views/params/ParamEditPopover.vue`、`views/params/ParamHistoryDrawer.vue`、`views/params/ParamChangesDrawer.vue`（新）。
- `nav/fpNav.ts`（`price-cfg` → `params`「计费参数」）、`router/index.ts`（VIEWS 映射 + `/price-cfg` 重定向）。
- `views/alloc/LossLedgerView.vue`（删面板与 G调整、三格改只读+跳转、G 悬浮分解、stale 条）、`views/alloc/PoolLedgerView.vue`（两列只读+跳转、stale 条）、`views/bills/BillNoticesView.vue`（stale 条）、`views/bills/CoefBookWindow.vue` + `utils/coefBookLogic.ts`（键从注册表取，新增 3 键）。
- 删除：`views/price-cfg/PriceCfgView.vue`、`utils/priceCfgLogic.ts`（+spec）、`api/priceCfg.ts`（复制上月电价接口迁 `api/params.ts`）。

---

## Phase A — 底盘：mode 列 + 统一解析 + 注册表 + 迁移（Task 1~5）

### Task 1: V96 迁移 —— mode 列 + 变更日志表 + 现有行 mode 转换

**Files:**
- Create: `backend/src/main/resources/db/migration/V96__param_mode_and_log.sql`
- Modify: `backend/src/main/java/com/park/demo3/entity/AllocCfg.java`、`entity/TenantPriceCfg.java`（+ `private String mode;`）
- Create: `backend/src/main/java/com/park/demo3/entity/ParamChangeLog.java`、`mapper/ParamChangeLogMapper.java`

**Interfaces:**
- Produces: 列 `alloc_cfg.mode`、`tenant_price_cfg.mode`（`ENUM('from','month')`）；表 `param_change_log`。

- [ ] **Step 1: 写迁移 SQL**（spec §7.1/§7.2 转换规则逐条落成 UPDATE）
```sql
-- V96__param_mode_and_log.sql
ALTER TABLE alloc_cfg
  ADD COLUMN mode ENUM('from','month') NOT NULL DEFAULT 'from' COMMENT 'from=自acct_month起长期(空=初始版);month=仅该月' AFTER acct_month,
  DROP INDEX uk_alloc_cfg, ADD UNIQUE KEY uk_alloc_cfg (scope, cfg_key, acct_month, mode);
ALTER TABLE tenant_price_cfg
  ADD COLUMN mode ENUM('from','month') NOT NULL DEFAULT 'from' AFTER acct_month,
  DROP INDEX uk_price, ADD UNIQUE KEY uk_price (scope, cfg_key, acct_month, mode);
-- 价目簿:电价 6 键月行=仅当月;永龙照抄金额=仅当月;其余保持 from(=旧常数键前滚语义)
UPDATE tenant_price_cfg SET mode='month' WHERE acct_month<>'' AND cfg_key IN
  ('elec_peak','elec_sharp','elec_flat','elec_valley','elec_resident','elec_commercial','loss_base_park_amount');
-- alloc_cfg:默认行 from;2024-02 月行按键分类(spec §7.2)
UPDATE alloc_cfg SET mode='month' WHERE acct_month<>'' AND cfg_key IN ('extra_qty','manual_qty','loss_adj_qty','loss_g_adj');
-- (coefficient/std_add/price_override/loss_adj_rate 的 2024-02 行保持 from = 自 2024-02 起长期)
-- loss_g_adj 并入 loss_adj_qty(同签名:G+g ≡ E−G−a 中 a=g)
INSERT INTO alloc_cfg (scope,cfg_key,cfg_value,acct_month,mode,note)
  SELECT scope,'loss_adj_qty',cfg_value,acct_month,'month',CONCAT('并自 loss_g_adj:',IFNULL(note,'')) FROM alloc_cfg WHERE cfg_key='loss_g_adj'
  ON DUPLICATE KEY UPDATE cfg_value = alloc_cfg.cfg_value + VALUES(cfg_value);
DELETE FROM alloc_cfg WHERE cfg_key='loss_g_adj';
CREATE TABLE param_change_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ts DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor VARCHAR(64) NOT NULL DEFAULT '',
  tbl ENUM('price','alloc') NOT NULL,
  scope VARCHAR(24) NOT NULL, cfg_key VARCHAR(32) NOT NULL,
  acct_month CHAR(7) NOT NULL DEFAULT '', mode ENUM('from','month') NOT NULL DEFAULT 'from',
  old_value DECIMAL(14,8) NULL, new_value DECIMAL(14,8) NULL,
  note VARCHAR(255) NULL,
  action ENUM('set','delete','recalc','migrate') NOT NULL DEFAULT 'set',
  ym CHAR(7) NULL COMMENT 'recalc 动作的账期',
  PRIMARY KEY (id), KEY idx_pcl_key (scope, cfg_key, acct_month), KEY idx_pcl_ts (ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
INSERT INTO param_change_log (actor,tbl,scope,cfg_key,acct_month,mode,new_value,note,action)
  SELECT 'migrate','alloc',scope,cfg_key,acct_month,mode,cfg_value,'V96 mode 转换',  'migrate' FROM alloc_cfg;
```
- [ ] **Step 2: 实体加字段**：两实体各加 `private String mode;`；新建 `ParamChangeLog`（@Data @TableName("param_change_log")，字段同表，`ts` 用 `@TableField(fill=INSERT)`? —— 否：日志时间用 DB 默认，实体 `ts` 不加 fill）；`ParamChangeLogMapper extends BaseMapper<ParamChangeLog>`。
- [ ] **Step 3: 起后端跑 Flyway**：`preview_start demo3-backend`（或 IT 直接跑），确认 `flyway_schema_history` V96 success=1；只读核对：`SELECT cfg_key,mode,COUNT(*) FROM alloc_cfg GROUP BY 1,2` —— 期望 `loss_g_adj` 0 行、`loss_adj_qty` month 5 行（含 building:13 −1500）、`coefficient` from 36 行。
- [ ] **Step 4: 既有测试仍绿**：`mvn -q test -Dtest=AllocServiceTest,PriceCfgApiIT,AllocApiIT`（此时 resolver 未改，行为不变）。
- [ ] **Step 5: Commit** `feat(param): V96 alloc_cfg/tenant_price_cfg 加 mode 列 + param_change_log + loss_g_adj 并入调整度数`

### Task 2: VersionResolver（两表共用的取值纯函数）+ 单测

**Files:**
- Create: `backend/src/main/java/com/park/demo3/service/VersionResolver.java`
- Test: `backend/src/test/java/com/park/demo3/service/VersionResolverTest.java`

**Interfaces（Produces）:**
```java
public final class VersionResolver {
    public record Row(String scope, String key, String acctMonth, String mode, BigDecimal value, Integer id) {}
    public record Hit(BigDecimal value, String scope, String acctMonth, String mode, Integer id) {}
    /** rows=同一 (scope,key) 的全部行;ym='YYYY-MM'。month 精确命中优先,否则 from 中 acctMonth<=ym 最大('' 最小)。 */
    public static Hit resolveOne(List<Row> rows, String ym);
    /** scopes 按级联序(具体→一般),首中即返。index: key -> scope -> rows */
    public static Hit resolve(Map<String, Map<String, List<Row>>> index, String key, String ym, List<String> scopes);
    /** 全部行 → 站在 ym 的 (scope|key → value) 扁平表(供 AllocService.loadCtx 无痛替换) */
    public static Map<String, BigDecimal> effectiveMap(List<Row> all, String ym);
    /** 生效区间文本用:同 (scope,key) from 链里,acctMonth 之后的下一版本起点(无=null) */
    public static String nextFrom(List<Row> rows, String acctMonth);
}
```
- [ ] **Step 1: 写失败测试**（Given rows 集合，断言）：① `''from=1, 2024-02 from=2` → ym 2023-08→1、2024-02→2、2024-05→2；② `''from=1, 2024-02 month=9` → 2024-02→9、2024-03→1；③ 同月 from 与 month 并存 → month 胜；④ 级联 `tenant:5` 无行、`p2` 有 → 命中 p2 且 `scope=='p2'`；⑤ `effectiveMap` 对 3 组键各给正确值；⑥ `nextFrom('',…)`。
- [ ] **Step 2: 跑 `mvn -q test -Dtest=VersionResolverTest`** 期望编译失败/红。
- [ ] **Step 3: 实现**（字符串比较 `YYYY-MM` 字典序=时间序；`''` 最小）。
- [ ] **Step 4: 绿。Commit** `feat(param): VersionResolver 两表统一取值规则(from/month/级联)`

### Task 3: 接管两处消费点（行为不变的重构）

**Files:**
- Modify: `service/PriceCfgService.java`（`resolveHit` 改用 `mode`；`upsert` 写入时 `mode = MONTHLY_KEYS.contains(key)?'month':'from'`——过渡，Task 5 再改注册表默认；缓存索引结构改 `key|scope → List<Row>`）
- Modify: `service/AllocService.java:929-933`（`loadCtx`：`cfg = VersionResolver.effectiveMap(all rows, ym)`）、`mapper/AllocCfgMapper.java`（`selectEffective` 保留给 cfgList；新增 `selectAll()`）、`saveCfg`（`AllocCfgReq` 加可选 `mode`，缺省：acctMonth 非空⇒`month`，空⇒`from`）
- Modify: `dto/AllocCfgReq.java`、`dto/AllocCfgDTO.java`、`dto/PriceCfgReq.java`、`dto/PriceCfgDTO.java`（+`mode`）

- [ ] **Step 1: 先跑基线**：`mvn -q test -Dtest=AllocServiceTest,PriceCfgApiIT,AllocApiIT,PoolSeedIT` 绿；记录 dev `alloc_loss_result` 2024-02 与 2023-08 全表快照到 scratch（`SELECT * ... INTO OUTFILE` 不可用 → `mysql -e ... > snap_before.tsv`）。
- [ ] **Step 2: 改 PriceCfgService.resolveHit**：`monthly ? !m.equals(ym) : m.compareTo(ym)>0` → 用 `VersionResolver.resolveOne(rowsOf(scope,key), ym)`；`upsert/copy` 落 `mode`；`selectByKey` 加 mode 参数（唯一键含 mode）。
- [ ] **Step 3: 改 AllocService.loadCtx**：整表 `cfgs.selectList(null)` → `effectiveMap`。`cfgList(ym)` 改为返回**站在 ym 生效的每 (scope,key) 一行 + 该 (scope,key) 是否有 month 行**（前端 allocLogic.resolveCfg 兼容期只读）。
- [ ] **Step 4: 重跑 Step 1 测试 + 重生成 2024-02/2023-08 池损耗（`POST /api/alloc/generate`）** → `alloc_loss_result` 与 `snap_before.tsv` 全等（含 A座 g_qty：现在 G=388.62−?…注意：并入后 2024-02 A座 `g_qty` 列会变成 share 值（原 = share + g_adj），而 `tenant_rate` 不变——快照 diff 允许仅 `g_qty` 列 +1500 这一处差异，其余全等）。
- [ ] **Step 5: Commit** `refactor(param): 价目簿/池参数取值统一走 VersionResolver(mode 列),行为对齐旧语义`

### Task 4: V97 数据修正（G 归零 / 口径版本化 / 死行 / 电梯基数链 / 价路收敛）

**Files:**
- Create: `backend/src/main/resources/db/migration/V97__param_data_s21.sql`

- [ ] **Step 1: 写 SQL**（每条注明源册依据）
```sql
-- 0) 池默认列归一(spec §2.4):alloc_rule.coefficient/extra_qty 搬成 alloc_cfg rule:{id} 初始版本行,两列退出引擎
INSERT IGNORE INTO alloc_cfg (scope,cfg_key,cfg_value,acct_month,mode,note)
  SELECT CONCAT('rule:',id),'coefficient',coefficient,'','from','S21:自 alloc_rule.coefficient 列迁入(初始版本)'
  FROM alloc_rule WHERE coefficient IS NOT NULL;
INSERT IGNORE INTO alloc_cfg (scope,cfg_key,cfg_value,acct_month,mode,note)
  SELECT CONCAT('rule:',id),'extra_qty',extra_qty,'','from','S21:自 alloc_rule.extra_qty 列迁入(初始版本)'
  FROM alloc_rule WHERE extra_qty<>0 AND id<>23;          -- 现库仅 rule 23 非零 ⇒ 实际零行
UPDATE alloc_rule SET coefficient=NULL, extra_qty=0;
ALTER TABLE alloc_rule MODIFY coefficient DECIMAL(12,2) NULL COMMENT 'S21 退出引擎:分母只存 alloc_cfg rule:{id}.coefficient 版本链(本列仅历史)',
                      MODIFY extra_qty  DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'S21 退出引擎:加度只存 alloc_cfg rule:{id}.extra_qty(本列仅历史)';
-- 1) 招商中心净电:默认加度归 0;扣度做月参(2023-12 源册 N8=-800-670;2024-02 已有 -670 月行)
UPDATE alloc_rule SET note=CONCAT(IFNULL(note,''),'|S21:默认扣度归0,扣度走 rule:23.extra_qty 月行') WHERE id=23;
INSERT IGNORE INTO alloc_cfg (scope,cfg_key,cfg_value,acct_month,mode,note) VALUES ('rule:23','extra_qty',-1470,'2023-12','month','2023-12 源册 公共电分摊明细!N8=-800-670');
-- 2) 一期 B/C 座损耗口径版本化:'' 净额式;2023-11 起纯公摊(源册 11/12 月 I=ROUND(G/C,4)+H;2024-02 同)
UPDATE alloc_cfg SET cfg_value=0, note='S21:2023-10 及以前净额式(源册 08 公式/09-10 手工率)' WHERE scope IN ('building:20','building:21') AND cfg_key='loss_variant' AND acct_month='';
INSERT IGNORE INTO alloc_cfg (scope,cfg_key,cfg_value,acct_month,mode,note) VALUES
 ('building:20','loss_variant',1,'2023-11','from','源册 2023-11 起 B座 I=ROUND(G/C,4)+H'),
 ('building:21','loss_variant',1,'2023-11','from','源册 2023-11 起 C座 I=ROUND(G/C,4)+H');
-- 3) 二期:分母含铝缆 08/09;一车间 08/09 并入五车间,10 起独立
INSERT IGNORE INTO alloc_cfg (scope,cfg_key,cfg_value,acct_month,mode,note) VALUES
 ('p2','loss_denom_cable',1,'','from','二期 2023-08/09 源册 G5=ROUND(F5/(C5+C6+C7+D6),4)'),
 ('p2','loss_denom_cable',0,'2023-10','from','2023-10 起分母只取总表'),
 ('building:30','loss_head',34,'','from','一车间 08 跟五车间(I4=I8)/09 与五车间联算'),
 ('building:30','loss_head',30,'2023-10','from','2023-10 起一车间独立核算 F4=E4-C4');
-- 4) 电梯面积基数版本链(源册 AA27 五月四值 + 2024-02)
UPDATE tenant_price_cfg SET acct_month='2024-02', mode='from' WHERE scope='p1' AND cfg_key='elevator_area_base' AND acct_month='';
INSERT IGNORE INTO tenant_price_cfg (scope,cfg_key,acct_month,mode,cfg_value,note) VALUES
 ('p1','elevator_area_base','','from',14818.35,'2023-08 源册 公共电分摊明细!AA27'),
 ('p1','elevator_area_base','2023-09','from',12957.7,'2023-09 AA27'),
 ('p1','elevator_area_base','2023-10','from',12027.34,'2023-10/11 AA27'),
 ('p1','elevator_area_base','2023-12','from',12624.4,'2023-12 AA27');
-- 5) 死行/退役键
DELETE FROM tenant_price_cfg WHERE cfg_key IN ('green_rate_live','lamp_rate_live');
DELETE FROM tenant_price_cfg WHERE cfg_key='loss_rate' AND scope='dorm';
DELETE FROM tenant_price_cfg WHERE scope='p2' AND cfg_key IN ('lamp_rate','green_rate');
DELETE FROM alloc_cfg WHERE cfg_key IN ('price_flat','price_loss','price_norm','price_sharp','price_peak','price_valley');
INSERT INTO param_change_log (actor,tbl,scope,cfg_key,acct_month,mode,note,action) VALUES ('migrate','alloc','rule:23','extra_qty','','from','V97 S21 数据修正(见文件头)','migrate');
```
（`loss_denom_cable` / `loss_rate_manual` 是新键，Task 6 才被引擎消费；先落行无害。）
- [ ] **Step 1b: 引擎停读两列**（与 V97 同一提交，否则迁移后分母全空）：`AllocService.coefficientOf` → `cfgVal(ctx,"rule:"+id,"coefficient")`（不再回退 `rule.getCoefficient()`）；`poolExtra` → `nz(cfgVal(...,"extra_qty"))`；`ruleCostAmount` 里 `rule.getExtraQty()` 改 `poolExtra`；`validateRule`「area/floor 无 baseKey 须 coefficient>0」改为查 `cfgs.selectByKey("rule:"+id,"coefficient","")`（新建池时 `AllocRuleReq.coefficient` 非空 ⇒ `apply` 后经 `saveCfg` 写 `'' from` 行；既有池更新不再写列）；`AllocRuleDTO.coefficient/extraQty` 改为回传**当月生效值**（读 cfg）供抽屉只读行显示。
- [ ] **Step 2: 重启后端跑 V97**；只读核对 6 条 SELECT（`rule:*.coefficient ''` 行数 = 迁移前 `alloc_rule.coefficient IS NOT NULL` 行数 / rule 23 extra 0 / building:20 两行 / p2 cable 两行 / p1 elevator 5 行 / dead 0 行）。
- [ ] **Step 3: 重生成 2024-02 与 2023-08**：`alloc_pool_result`（含 `base_snap/extra_qty_snap`）/`alloc_loss_result`/催缴单总额与基线全等（rule 23 2024-02 月行仍 −670；B/C 座 2024-02 取 2023-11 起的 1；A座电梯 2024-02 取 12487.04；2023-08 各池 base 与迁移前相同）。**这一步是红线。**
- [ ] **Step 4: Commit** `feat(param): V97 S21 数据修正——池默认列归一/招商中心默认扣度归0/一期B、C口径版本化/二期铝缆与并栋按月/电梯基数版本链/死行清理`

### Task 5: ParamRegistry（Java）+ 白名单接管 + 单测

**Files:**
- Create: `backend/src/main/java/com/park/demo3/service/ParamRegistry.java`
- Test: `backend/src/test/java/com/park/demo3/service/ParamRegistryTest.java`
- Modify: `PriceCfgService.CFG_KEYS/MONTHLY_KEYS` → 委托 registry；`AllocService.saveCfg` 用 registry 校验 scope/key。

**Interfaces（Produces）:**
```java
public final class ParamRegistry {
    public enum Table { PRICE, ALLOC }
    public enum Group { MONTHLY, CONSTANT, RULE, TENANT, RETIRED }   // ①②③④/退役
    public enum ScopeKind { GLOBAL, ZONE, BUILDING, METER, RULE, TENANT }
    public enum ValueKind { NUMBER, RATE, MONEY, INT, BOOL, ENUM, REF_METER, REF_BUILDING, REF_RULE }
    public record Def(String key, Table table, String label, String unit, Group group, Set<ScopeKind> scopes,
                      String defaultMode, boolean monthlyCheck, ValueKind valueKind,
                      Map<Integer,String> enumOptions, String formula, String hint, boolean pairedWith /*mgmt 双键*/) {}
    public static Def get(String key);              // 未注册 → null
    public static Collection<Def> all();
    public static boolean allowed(String key, String scope);   // 键存在且 scope 形态允许
    public static String defaultMode(String key);
    public static Table tableOf(String key);
}
```
注册表内容 = spec §3.1~§3.4 全部键（含新键 `loss_rate_manual`、`loss_denom_cable`、`lamp_rate`、`fire_amount_fixed`、`loss_base_form`、`loss_base_form_b{bid}`（key 前缀匹配）、`loss_base_park_meter/amount`、`park_share_div`、`loss_head/loss_c_meter/loss_recon/loss_supply_meter/loss_exclude`、`manual_qty/price_override/std_add`）；退役键（`loss_g_adj、price_flat、price_loss、price_norm/sharp/peak/valley、green_rate_live、lamp_rate_live、loss_rate`）**不注册**（写入 400）。人话 label/formula 文本照 spec §3 与 §5.2 规则写。
- [ ] **Step 1: 测试**：① 每个 spec §3 键 `get(key)!=null`；② `allowed("loss_variant","building:13")` 真、`allowed("loss_variant","p1")` 假；③ `defaultMode("elec_peak")=="month"`、`defaultMode("coefficient")=="from"`；④ 退役键 `get==null`；⑤ 所有 label 不含 `_`、不含 `building:`；⑥ `PriceCfgService` 白名单 = registry 中 table==PRICE 键集合。
- [ ] **Step 2: 实现 + 接管** `PriceCfgService.upsert` 白名单校验改 `ParamRegistry.allowed(key, scope)`，`AllocService.saveCfg` 同（scope/key 不合法 400「参数键不在注册表」）。
- [ ] **Step 3: 全量 `mvn -q test`** 绿（PriceCfgApiIT 白名单外用例仍 400）。
- [ ] **Step 4: Commit** `feat(param): ParamRegistry 单一白名单+人话注册表,价目/池参数写入口统一校验`

---

## Phase B — 引擎公式 + ParamService/API（Task 6~9）

### Task 6: 损耗率公式定稿（手工率 / 分母含铝缆 / G 分解 / 价路收敛）

**Files:**
- Modify: `service/AllocService.java`：`tenantLossRate`（加 `denom` 参数）、`groupRate`（读 `loss_rate_manual`、`loss_denom_cable`）、`groupG`（去 g_adj）、`lossPrice`（走 priceCfg）、`ruleCostAmount`（走 priceCfg）、`lossTable/computeLossUnits`（落 `formula_rate`、`manual_rate`、`denom_qty`）、G 分解（`gParts`：池名+净量列表进 `AllocLossRowDTO`）
- Modify: `entity/AllocLossResult.java`、`dto/AllocLossRowDTO.java`（+`formulaRate/manualRate/denomQty/gParts`）
- Create: `resources/db/migration/V98__loss_result_formula_rate.sql`（`ALTER TABLE alloc_loss_result ADD formula_rate DECIMAL(10,6) NULL, ADD manual_rate DECIMAL(10,6) NULL, ADD denom_qty DECIMAL(14,2) NULL`）
- Test: `service/AllocServiceTest.java`（`tenantLossRate` 新签名 + 手工率 + 铝缆分母用例）

**Interfaces:**
```java
// 纯函数(单测锁定)
public static BigDecimal tenantLossRate(String variant, BigDecimal lossQty, BigDecimal shareQty,
        BigDecimal adjQty, BigDecimal adjRate, BigDecimal denom);   // denom = C 或 C+cable
// groupRate: manual!=null ? manual : tenantLossRate(...)
```
- [ ] **Step 1: 测试红**：① net：E=−13471.14,G=388.62,a=−8000,C=106245 → 0.0552（一期 2023-08 A座源册 H5）；② share_only：G=388.62,C=28792.8,r=0.003 → ROUND(0.0135,4)+0.003=0.0165；③ 铝缆分母：E=−44.89,G=0,a=0,denom=19220+9972 → −ROUND(−44.89/29192,4)=0.0015（二期 2023-08 二三四车间）；④ 手工率覆盖：groupRate 返回 0.0156 且 formulaRate 仍算出。
- [ ] **Step 2: 实现**：`groupRate` 读 `building:{head}.loss_rate_manual`（cfgVal）与 `loss_denom_cable`（先 `building:{head}` 再 zone 级：`cfgVal(ctx,"building:"+head,…)` 空则 `cfgVal(ctx,zone,…)`）；`groupG` = `shareQtyOf` 只；`lossPrice(zone)`：p1/dorm = `elec_commercial+mgmt_fee_commercial`，p2 = `elec_flat+mgmt_fee`（priceCfg.resolve，null 则 warn 跳过）；`ruleCostAmount` p1 同上、p2 四段 `elec_*+mgmt_fee`；快照落三新列；`AllocLossRowDTO.gParts = List<{name, qty}>`（从 shareQtyOf 收集）。
- [ ] **Step 3: 绿 + 重生成 2024-02 与 2023-08**：2024-02 `tenant_rate` 全等基线（B/C 座 share_only 值不变：G 现在不含 g_adj，但 B/C 用 share_only 且原 g_adj 只挂 A座 → A座 net 用 a=−1500 等价）；2023-08 A座 G=388.62（rule 23 默认 0）。
- [ ] **Step 4: Commit** `feat(alloc): 损耗率定稿——手工率覆盖/分母含铝缆/去 g_adj/G 分解/损耗价与对账价走价目簿月价`

### Task 7: ParamService 读侧 + `GET /api/params` + 状态

**Files:**
- Create: `service/ParamService.java`（读侧）、`controller/ParamController.java`、`dto/ParamRowDTO.java`、`dto/ParamStatusDTO.java`
- Test: `api/ParamApiIT.java`（读侧用例）

**Interfaces（Produces）:**
```java
public record ParamRowDTO(String key, String label, String unit, String group, String scope, String scopeLabel,
    BigDecimal value, String valueText, String mode, String acctMonth, String rangeText,
    List<String> sourceChain, String formula, String hint, boolean editable, boolean monthlyCheck,
    boolean hasMonthRow, Integer rowId, String note) {}
public record ParamStatusDTO(int priceOk, int priceTotal, int pendingChanges, LocalDateTime lastChangeAt,
    LocalDateTime poolSnapshotAt, LocalDateTime billBatchAt, boolean stale, List<String> otherMonthsAffected) {}
// GET /api/params?ym=YYYY-MM&zone=all|p1|p2|dorm   → List<ParamRowDTO>
// GET /api/params/status?ym=                        → ParamStatusDTO
```
读侧算法：对注册表每键 × 该键在库中出现过的作用域（+ 池/栋/表/户全集里"应有一行"的：`loss_variant/loss_head/loss_c_meter/loss_recon/loss_denom_cable` 对该 zone 每个损耗栋出一行即使无行(值=默认语义)；`coefficient/extra_qty/manual_qty/price_override/std_add` 对该 zone 每个池出一行（无行显空；**`base_key` 非空的池不出 `coefficient` 行**，改出一条只读行 `分母 = {baseKey 的 label} {值}（价目参数）` 指向该键，spec §2.4））→ `VersionResolver.resolve` 站在 ym → `rangeText`（`仅 2023-08`/`2023-08 起长期`/`2023-08 ~ 2023-10`/`长期（初始版本）`）→ `sourceChain`（命中链每级 `scopeLabel:value`）→ `scopeLabel` 用 building/meter/rule/tenant 名称表；`valueText` 按 valueKind（枚举字典/表名/栋名/布尔句）。`status.stale` 按 spec §6.3。
- [ ] **Step 1: IT 红**：① `GET /api/params?ym=2024-02&zone=p1` 含 `key=='loss_variant'&&scopeLabel=='一期 B座'` 且 `valueText` 含「纯公摊」、`rangeText=='2023-11 起长期'`；② `key=='extra_qty'&&scopeLabel` 含「招商中心」`value==-670`、`rangeText=='仅 2024-02'`；③ 2023-08 同键 `value==0`；④ 全部行 `label/valueText/scopeLabel/rangeText` 不匹配 `/(p1|p2|dorm|building:|rule:|meter:|tenant:|默认)/`；⑤ status 2024-02 `priceOk==6`。
- [ ] **Step 2: 实现** → 绿 → **Commit** `feat(param): GET /api/params 站在账期看的全部生效参数(人话/命中链/区间)+状态`

### Task 8: ParamService 写侧 + 历史 + 重算 + 旧端点委托

**Files:**
- Modify: `service/ParamService.java`（write/delete/history/changes/recalc）、`controller/ParamController.java`、`PriceCfgService.upsert`（委托）、`AllocService.saveCfg`（委托）
- Create: `dto/ParamPutReq.java`、`dto/ParamHistoryDTO.java`、`dto/RecalcResultDTO.java`
- Test: `api/ParamApiIT.java`（写侧用例）

**Interfaces:**
```java
public record ParamPutReq(@NotBlank String key, @NotBlank String scope,
    @Pattern(regexp="(\\d{4}-(0[1-9]|1[0-2]))?") String acctMonth,
    @Pattern(regexp="from|month") String mode, BigDecimal value /*null=删该版本行*/,
    String note, Boolean correction /*true=改错:覆盖当前命中行,不新建版本*/) {}
// PUT  /api/params                    → ParamRowDTO(写后站在 acctMonth 或 ym 的新生效行)
// GET  /api/params/history?key=&scope=  → ParamHistoryDTO{versions:[{acctMonth,mode,value,note,rangeText}], changes:[{ts,actor,action,acctMonth,mode,oldValue,newValue,note}]}
// GET  /api/params/changes?ym=&limit=   → List<change>
// POST /api/params/recalc?ym=           → RecalcResultDTO{pools,lossUnits,notices,skippedConfirmed,warnings}
```
写规则：`ParamRegistry.allowed` 否则 400；`mode` 缺省 `defaultMode(key)`；`correction=true` 时找 `resolve` 命中行原地改值（命中行 scope 必须等于 req.scope，否则 400「该值来自上级作用域，请新建版本」）；删除（value=null）仅当该行覆盖月份 ∩ 已生成月份为空，否则 400「已被 2024-02 使用，请改用新版本」；每次写 `param_change_log`；`table==PRICE` 时 `PriceCfgService.evict()`。`recalc`：`alloc.generate(ym)` → `billNotice.generate(ym)` → 日志 `action=recalc,ym`。旧端点：`PriceCfgService.upsert(req)`/`AllocService.saveCfg(req)` 内部构造 `ParamPutReq` 走同一 write（mode 缺省规则见 spec §6 兼容行）。
- [ ] **Step 1: IT 红**（2099 槽）：① PUT month 行 → GET 该月命中、次月不命中；② PUT from 行 → 次月命中；③ correction 改错原地不新增行、日志 old→new；④ 未注册键 400；⑤ 删被使用版本 400（对 2024-02 已生成：PUT `rule:23.extra_qty 2024-02 value=null` → 400）；⑥ history 返回版本+日志；⑦ recalc 2099-05（无读数）→ 200 摘要 pools=0 且日志一条；⑧ 旧 `PUT /api/price-cfg` 仍可写且日志有记录。
- [ ] **Step 2: 实现 → 绿 → 全量 `mvn -q test` → Commit** `feat(param): PUT/history/changes/recalc + 旧价目/池参端点内部改走 ParamService(校验+日志)`

### Task 9: 后端收尾 —— cfgList 兼容 DTO、AllocController 端点、注释修订

- [ ] `AllocCfgDTO` 加 `mode`；`GET /api/alloc/cfg` 保留（前端过渡期用）；`AllocService` 内 `loss_g_adj` 相关注释/`G_TITLE` 文案删改；`POOL-ENGINE-SPEC.md` §3.4 附注「S21：见 S21-PARAM-CENTER-SPEC §4」。
- [ ] `mvn -q test` 全绿；Commit `chore(param): 后端收尾与 spec 交叉引用`

---

## Phase C — 前端：注册表镜像 + 计费参数页 + 入口收敛（Task 10~14）

### Task 10: `paramRegistry.ts` + `paramCenterLogic.ts`（纯逻辑先行，TDD）

**Files:**
- Create: `frontend/src/utils/paramRegistry.ts`、`frontend/src/utils/paramRegistry.spec.ts`、`frontend/src/utils/paramCenterLogic.ts`、`frontend/src/utils/paramCenterLogic.spec.ts`、`frontend/src/api/params.ts`
- Delete（Task 13 才删）：`utils/priceCfgLogic.ts`

**Interfaces（Produces）:**
```ts
// paramRegistry.ts
export type ParamGroup = 'monthly' | 'constant' | 'rule' | 'tenant'
export type ParamMode = 'from' | 'month'
export interface ParamDef { key: string; label: string; unit: string; group: ParamGroup; defaultMode: ParamMode;
  monthlyCheck: boolean; valueKind: 'number'|'rate'|'money'|'int'|'bool'|'enum'|'ref_meter'|'ref_building'|'ref_rule';
  enumOptions?: Record<number,string>; formula?: string; hint?: string; tenantEditable?: boolean; pairedWith?: string }
export const PARAM_DEFS: ParamDef[]            // 与 Java 逐键一致(测试断言键集合与 label 相同——用后端 GET /api/params/registry? 否:用一份 JSON fixture `paramRegistry.fixture.json` 由后端测试导出、前端 spec 比对)
export const paramDef = (key: string) => ParamDef | undefined
// paramCenterLogic.ts
export interface ParamRow { /* = ParamRowDTO */ }
export function groupRows(rows: ParamRow[]): { monthly: ParamRow[]; constant: ParamRow[]; rule: RuleGroup[]; tenant: ParamRow[] }
export interface RuleGroup { scopeLabel: string; rows: ParamRow[] }   // ③ 按栋/期折叠
export function rangeBadge(r: ParamRow): { text: string; tone: 'month'|'from'|'inherit' }
export function forbiddenText(s: string): boolean            // /(p1|p2|dorm|building:|rule:|meter:|tenant:|默认·所有月份)/
export function pendingSummary(status: ParamStatus): string  // 状态条文案
export function copyPrevMonthKeys(): string[]                // 电价 6 键
```
- [ ] **Step 1: spec 红**：`groupRows` 四区分配；`rangeBadge` 三态文案；`forbiddenText` 对 `'building:13'` 真、`'一期 B座'` 假；注册表 fixture 一致（后端 `ParamRegistryTest` 输出 `backend/target/param-registry.json` → 拷到 `frontend/src/utils/__fixtures__/param-registry.json`，spec 比对 key/label/group/defaultMode）。
- [ ] **Step 2: 实现 → `npm test -- paramRegistry paramCenterLogic` 绿 → Commit** `feat(param): 前端参数注册表镜像 + 参数中心纯逻辑(TDD)`

### Task 11: `ParamCenterView.vue` + 编辑弹窗 + 历史/变更抽屉 + 路由

**Files:**
- Create: `views/params/ParamCenterView.vue`、`views/params/ParamEditPopover.vue`、`views/params/ParamHistoryDrawer.vue`、`views/params/ParamChangesDrawer.vue`
- Modify: `nav/fpNav.ts:15`（`{ value: 'params', label: '计费参数', icon: 'sliders-horizontal', kind: 'params' }` 替换 price-cfg 行）、`router/index.ts`（`'params': () => import('@/views/params/ParamCenterView.vue')`；`'price-cfg'` 保留键但组件改为 redirect 到 `/params`——路由表是 fpNav 生成，最简：在 VIEWS 里让 `'price-cfg'` 也指向 ParamCenterView 并从 nav 移除）、`nav/fpNav.spec.ts`（计数与 layer 断言）
- Test: `views/params/__tests__/paramCenterView.spec.ts`（挂载渲染：四区标题、状态条、禁词断言 `forbiddenText` 扫全文、编辑态才出 [改…]）

页面结构照 spec §5.1；数据流：`onMounted` → `paramsApi.list(ym, zone)` + `paramsApi.status(ym)`；`watch([year,month,zone])` 重载（`++seq` 竞态守卫）；`editMode`（EDIT-MODE v2，onDeactivated 复位）；`ParamEditPopover`（props: row, ym；emits save({value, mode, acctMonth, note, correction})）→ `paramsApi.put` → 成功后 `rows[i] = 返回行`（铁律二）+ `status.pendingChanges++`；[重算本月] → confirm → `paramsApi.recalc(ym)` → 摘要 flash → 重载 status；[复制上月电价] → `paramsApi.copyPrev(ym)`（旧 `POST /api/price-cfg/copy`）；④ 区 [+ 新增例外] 用 `FPTenantPicker` + 键 Select（注册表 `tenantEditable`）+ 值 + 生效方式；[批量修改 → 系数簿] 跳 `/bill-notices?ym=&coef=1`；③ 区栋级 [改…] 值控件按 valueKind：enum→Select、bool→Segmented、ref_meter→表 Select（`metersApi.list()` 按栋过滤）、ref_building→栋 Select；「剔出合计的表 [+ 添加]」= 选表 → PUT `loss_exclude=1`。
- [ ] **Step 1: 写 spec（渲染 + 禁词 + 编辑态开关）红 → 实现页面 → 绿；`npm run typecheck` 净。**
- [ ] **Step 2: 浏览器验收**（`preview_start demo3-frontend`，后端已起）：2024-02 一期四区有数据；③ 区 B座显示「损耗按纯公摊算…」「2023-11 起长期」；① 区 A座「损耗调整度数 −1500 仅 2024-02」；改 A座调整度数为 −1400（仅本月）→ 状态条「参数已改 1 项」→ 点重算 → 楼栋损耗屏 A座率变化 → 改回 −1500 重算 → 与基线全等。截图存 scratch。
- [ ] **Step 3: Commit** `feat(ui): 计费参数页(四区/人话/命中链/历史/变更记录/重算闭环),取代价目管理`

### Task 12: 楼栋损耗屏 / 公共电核算屏 / 催缴单屏收敛 + stale 条

**Files:**
- Modify: `views/alloc/LossLedgerView.vue`（删 `calibRows/cfgOpen/commitCalib/onExclude/onVariant/onExtra/VARIANT_OPTS/LOSS_VARIANT_TEXT/G_TITLE` 与面板模板；三格改只读文本+徽标「仅本月/长期」；G 格悬浮 = `gParts` 分解式 `（45.28 + 59.57 + …）÷ 6 = 388.62`；表头「收取租户损耗率」若 `manualRate!=null` 显「手工 0.0156（公式 0.0096）」；标题栏加 Button「本月口径 → 计费参数」`router.push({path:'/params',query:{ym,zone,section:'rule'}})`；stale 条：`paramsApi.status(ym)` → `stale` 时显「参数于 HH:mm 更新，本屏为旧快照 [去重算]」）
- Modify: `views/alloc/PoolLedgerView.vue`（编辑态「系数(月)」「加度(月)」两列 → 只读显示当月生效值 + 徽标 + 点击跳 `/params?ym&section=constant&rule={id}`；删 `commitRuleCfg`；**池抽屉「③怎么摊」**：删「基数(层数/受益面积Σ㎡)」「默认加度」两个 Input，替换为只读一行「当月分母 T={coefficient}（{rangeText}）· 加度 {extraQty}（{rangeText}）→ [去计费参数页改]」（值来自 `AllocRuleDTO.coefficient/extraQty` 当月生效值 + `paramsApi.list` 的 rangeText，或直接调 `GET /api/params?ym&zone` 过滤该池两行）；**仅新建池**表单显示「初始分母」Input（area/floor 且无基数键时必填，payload 仍走 `AllocRuleReq.coefficient`）；抽屉「只改本月」文案改「自本月起（版本组）」；stale 条同上）
- Modify: `views/bills/BillNoticesView.vue`（标题行 stale 条 + [去重算] 跳 `/params`）
- Modify: `utils/allocLogic.ts`（`resolveCfg/upsertMonthCfg` 若无其它调用则删 + spec 同步）
- Test: 相关 spec 更新（LossLedgerView 若有 spec 断言面板文本 → 改）

- [ ] **Step 1: 改 → `npm test` + typecheck 净。**
- [ ] **Step 2: 浏览器**：楼栋损耗屏无「本月口径」面板；G 悬浮出现分解式且 2023-08 A座 G=388.62；公共电核算两列只读带徽标；改参后三屏出 stale 条，重算后消失。
- [ ] **Step 3: Commit** `feat(ui): 楼栋损耗/公共电核算/催缴单 月参入口收敛为只读+跳转,G 分解悬浮,参数过期提示条`

### Task 13: 系数簿接注册表 + 删旧价目页文件

**Files:**
- Modify: `utils/coefBookLogic.ts`（`COEF_KEYS` 从 `paramRegistry` 里 `tenantEditable` 键生成，新增 `lamp_rate / fire_amount_fixed / loss_base_form`（enum 用 Select））、`views/bills/CoefBookWindow.vue`（值控件按 valueKind）
- Delete: `views/price-cfg/PriceCfgView.vue`、`utils/priceCfgLogic.ts`、`utils/priceCfgLogic.spec.ts`、`api/priceCfg.ts`（`copy` 已迁 `api/params.ts`）
- Modify: 全仓 grep `priceCfgLogic|PRICE_KEYS|api/priceCfg` 的引用改指注册表

- [ ] `npm test` + typecheck 净；浏览器：系数簿下拉多三键、`loss_base_form` 显 A/B/C/F/G 文字。Commit `feat(ui): 系数簿键源改注册表(+路灯收取价/消防固定额/损耗基数形态),删旧价目页`

### Task 14: 用参数页录入 2023-08 演示参数 + 逐格对账 + 文档

- [ ] 用浏览器（不是 SQL）在 `/params` 2023-08：A座 `loss_adj_qty −8000`（仅本月，备注「源册 一期园区损耗!D5 +8000 旭化成线路」）、E座 `−1000`、B座 `loss_rate_manual 0.0156`、二期 三车间组 `loss_rate_manual 0.0015`；[重算本月]。
- [ ] 核对楼栋损耗 2023-08：G 全 388.62；A 0.0552 / B 0.0156(手工,公式 0.0096) / C 0.0033 / D 0.0144 / E 0.0196 / F ≈0.0083（D 差 143.2 记归因）/ G座 不核算；二期 六车间 0.0578、二三四 0.0015(手工)、一/五车间按含铝缆分母（D 缺口记归因）。变更记录页有 5 条 set + 1 条 recalc。
- [ ] 2024-02 重算：298 单 / 3461 行 / 总额与 `BN20260811135134` 全等（脚本 diff）。
- [ ] 文档：`S21-PARAM-CENTER-SPEC.md` 状态改「已落地」+ 验收数字；`PRICE-CFG-SPEC.md` 头部加「已被 S21 取代」；`memory` 归档。
- [ ] Commit `docs(param): S21 落地记录 + 2023-08 逐格对账`

---

## Self-Review
- **Spec 覆盖**：§2 模型→T1/T2/T3；§3 目录→T5/T10；§4 公式→T6；§5 页面→T11/T12/T13；§6 API→T7/T8；§7 迁移→T1/T4/T6(V98)；§8 验收→T3/T4/T11/T14。§9 五个待拍板项在实施前由用户裁定（默认按 spec 正文执行）。
- **占位扫描**：无 TBD；每任务有测试断言与提交信息。
- **签名一致**：`VersionResolver.Row/Hit/resolveOne/resolve/effectiveMap`（T2）被 T3/T7 使用；`ParamRowDTO` 字段（T7）= 前端 `ParamRow`（T10）；`tenantLossRate(...denom)`（T6）在 AllocServiceTest 更新；`ParamPutReq`（T8）= 前端 `paramsApi.put` 载荷。
