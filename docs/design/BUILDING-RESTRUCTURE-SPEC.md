# BUILDING-RESTRUCTURE-SPEC — 楼栋管理按真实结构重建方案

状态:设计稿(零代码改动)。调查日期 2026-07-21,dev 库(localhost:8080)实测数据为准。
拍板结论(用户):现 8 粗栋不符合园区真实结构,按真实结构重建 —— **一~六车间各自成栋、一期 A-G 座各自成栋、宿舍分栋**,含楼层/房间与租户安排;合同/单元/面积模型现挂 8 栋须迁移。

---

## 1. 现状调查

### 1.1 表结构与 FK 链

```
building ──< unit          (unit.building_id FK, ON DELETE CASCADE)
building ──< contract      (contract.building_id FK, RESTRICT)
unit     ──< contract      (contract.unit_id FK, ON DELETE SET NULL)
tenant   ──< contract      (contract.tenant_id FK, RESTRICT)
building ──? meter         (meter.building_id 无 FK,裸 INT NULL)
meter    ──< meter_reading (meter_reading.meter_id FK)
```

证据:

| 结构 | 文件:行号 | 要点 |
|---|---|---|
| building 表 | `backend/src/main/resources/db/migration/V1__schema.sql:7-21` | name 唯一键 uk_building_name(:19);phase TINYINT;floor_count/total_area/rentable_area/status/per_floor |
| unit 表 | `V1__schema.sql:23-34` | uk(building_id, unit_no)(:31);**FK ON DELETE CASCADE**(:33) —— 删栋自动清单元 |
| contract 表 | `V1__schema.sql:55-74` | building_id NOT NULL、unit_id NULL |
| contract 三 FK 补齐 | `V16__integrity_constraints.sql:7-10` | fk_ct_building RESTRICT(有合同删不掉栋);fk_ct_unit ON DELETE SET NULL |
| contract V33 面积模型列 | `V33__contract_area_rentfree.sql` + `entity/Contract.java:10-11` | building_area/unit_price/rent_free,可空 |
| meter 表 | `V45__meter.sql:3-20` | uk(kind, zone, name);zone=p1/p2/dorm;area=区域自由文本 |
| meter v2 关联列 | `V46__meter_v2.sql:4-7` | tenant_id/building_id **裸 INT NULL 无 FK**;ownership 四值 |
| meter_reading | `V45__meter.sql:25-48` | uk(meter_id, ym),只挂 meter,不直接挂楼栋 |
| 实体 | `entity/Building.java:5-13`、`entity/Unit.java:5-11`、`entity/Contract.java:5-16`、`entity/Meter.java:5-24` | 与表一一对应 |

**关键结论:楼栋只被三处引用 —— unit(级联)、contract(RESTRICT)、meter(无约束)。台账/账单/报表/后端分析全部不挂楼栋**(`service/BillsService.java`、`service/AnalysisService.java`、`V4__ledger.sql` grep building 均 0 命中),重建的爆炸半径限定在「楼栋-单元-合同-抄表」四张表和其前端消费屏。

### 1.2 dev 库现有数据形态(2026-07-21 API 实测,admin/admin123)

现 8 栋(GET /api/buildings):

| id | 名称 | phase | 合同数 | 挂接电水表数 | 月租金合计 |
|---|---|---|---|---|---|
| 11 | 一期 B-G座 | 1 | 51 | 180 | 927,310.82 |
| 12 | 一期 宿舍区 | 1 | 41 | 9 | 282,631.70 |
| 13 | 一期 A座 | 1 | 38 | 115 | 267,768.10 |
| 14 | 一期 空地 | 1 | 4 | 0 | 21,042.70 |
| 15 | 二期 一至四车间 | 2 | 57 | 104 | 2,199,520.66 |
| 16 | 二期 五、六车间 | 2 | 22 | 60 | 848,988.58 |
| 17 | 三期 | 3 | 15 | 2 | 75,528.73 |
| 18 | 散租宿舍 | 4 | 54 | 0 | 48,910.92 |

合同(GET /api/contracts,282 条):**全部 active、全部 unitId 已挂**;buildingArea/unitPrice/rentFree 各仅 1 条非空(面积模型基本未启用);rentArea 全 0。合同全部是 `realDataMigrate.ts` link 步骤派生的占位合同(合同号 S10-xxxx,月租=附表10 最新非零月值,无起止日期)—— 见 `frontend/src/tools/realDataMigrate.ts:505-535`(删栋重建+每归属一份合同)。

单元:占位形态,**每栋单元数=归属租户数、unit_no=101 起顺号、area 全 0、floor 全 1**(实测 GET /api/buildings/15 units;生成逻辑 `realDataMigrate.ts:513-517` + `BuildingService.java:113-128` perFloor 自动铺单元)。即:**单元层没有任何真实房间信息,重挂无历史包袱**。

### 1.3 buildingId/unitId 消费端全景(grep 全量)

后端(写/校验路径):

| 文件:行号 | 用途 |
|---|---|
| `service/BuildingService.java:19-20` | PHASE 硬编码 Map{1:一期,2:二期,3:三期,4:宿舍};kind():phase==4→宿舍 否则 厂房 |
| `service/BuildingService.java:38-60` | 楼栋 DTO 派生:出租率=已租单元面积/可租面积、月租合计、租户数 |
| `service/BuildingService.java:103-131` | 新建楼栋,perFloor>0 自动铺单元(unit_no=floor*100+seq) |
| `service/BuildingService.java:148-153` | 删栋守卫:有合同 409;单元随 FK 级联删 |
| `service/BuildingService.java:180-209` | 单元 CRUD(重号 409/超层 409/有合同不可删) |
| `service/ContractService.java:166-171` | 建/改合同校验 buildingId 存在、unit 属于该栋 |
| `service/ContractService.java:208-225` | applyReq 全字段 PUT(含 buildingId/unitId)——重挂就走这条 |
| `service/ContractService.java:247-251` | DTO 派生 floorInfo("3F-301")与 buildingName |
| `service/MeterService.java:204,216` | 表档案建/导入时写 building_id(导入非空才覆盖) |
| `mapper/ContractMapper.java:7-8`、`mapper/UnitMapper.java:7-8` | selectByBuildingId |
| `controller/ContractController.java:29-31` | PUT /api/contracts/{id} 全字段更新(迁移可直接用) |
| `controller/BuildingController.java:23-37`、`controller/UnitController.java:16-22` | 楼栋/单元 CRUD 端点齐全 |

前端(消费/展示路径):

| 文件:行号 | 用途 | 重建影响 |
|---|---|---|
| `frontend/src/utils/meterSplit.ts:68-88` | **AREA_BUILDING 静态映射表**:抄表「区域」列→8 栋名正则 | ★必改:整表重写为新栋规则 |
| `frontend/src/utils/importRegistry.ts:192-196,403-406` | 导入前预取楼栋清单喂给解析器 | 自动适配(按名匹配) |
| `frontend/src/views/meters/MeterView.vue:109,125-127,337-341,391,600-615` | 楼栋列显示/行内改挂/新增表选栋 | 自动适配(下拉数据驱动) |
| `frontend/src/views/contracts/ContractsView.vue:68-74` | **phaseName 启发式:从 buildingName 里找「一期/二期/三期/宿舍」关键词** | ★命名须保关键词,否则期区列错 |
| `frontend/src/views/contracts/ContractsView.vue:105,133-137` | 按楼栋名搜索/楼栋列 | 自动适配 |
| `frontend/src/views/contracts/ContractNewDialog.vue:47-48,84-113,168,194-195` | 楼栋→单元二级联动下拉 | 自动适配 |
| `frontend/src/views/analysis/park.logic.ts:9-16,23-50` | 分析层楼栋行(按月租降序)+期区聚合 | 栋数 8→约20,楼栋行变长;期区合计以「栋 phase」聚,phase 不变则锚点不变 |
| `frontend/src/analysis/anaData.ts:239-240` | fetchBuildings 会话缓存 | 自动适配 |
| `frontend/src/views/buildings/BuildingsView.vue:89-93,110-148` | 期区 tab 计数(硬编码 1-4)+列表 | 自动适配 |
| `frontend/src/views/buildings/BuildingDrawer.vue:73-164`、`BuildingNewDialog.vue:15,64-65` | 楼栋抽屉/单元编辑/新建(phase 自由数字≥1) | 自动适配 |
| `ExpiryView.vue:160-178`、`TenantDrawer.vue:182`、`TenantPortfolioView.vue:325`、`ContractDrawer.vue` | buildingName 纯展示 | 自动适配 |
| `frontend/src/utils/importRegistry.spec.ts:430` | 测试钉死 `'一期 B-G座'` 栋名 | ★P3 改断言 |
| `frontend/src/utils/meterSplit.spec.ts`、`meterExcel.spec.ts` | 钉死 AREA_BUILDING 现行为 | ★P3 随映射表同改 |
| `frontend/src/tools/realDataMigrate.ts:222-228,420-425,485-489` | 一次性迁移工具钉死旧 8 栋名 | 不改(历史工具),脚本头加过期注记 |

### 1.4 抄表挂接现状(meter.building_id)

1138 块表(电 639/水 499),每表 1 条读数(共 1138 条 meter_reading)。**已挂楼栋 470 块、未挂 668 块**(任务背景写 469,实测当日 470,差 1 为手工新增):

| 旧栋 | 挂接数 | 未挂原因分布(zone) |
|---|---|---|
| 11 一期 B-G座 | 180 | — |
| 12 一期 宿舍区 | 9 | dorm 未挂 624:区域「一栋275/四栋275/二栋23/三栋13」是**中文数字**,`meterSplit.ts:71` 的 `/\d+栋/` 只认阿拉伯数字,全部漏挂 |
| 13 一期 A座 | 115 | — |
| 15 二期 一至四车间 | 104 | p2 未挂 18:园区6/铝缆4/钢构车间2/保安室/变压器/总水表等公共设施 |
| 16 二期 五、六车间 | 60 | — |
| 17 三期 | 2 | p1 未挂 26:招商中心13/园区3/无区域7/供水总表等 |

抄表「区域」列真实值分布(设计新栋清单的直接依据,实测计数):

- **p1(一期)**:A座 114+A座自装总电表 1;B座 28;C座 50;D座 30;E座 36;F座 29;G座 6;B-G座 1(总表);招商中心 13;园区/工地/供水总表等公共 15
- **p2(二期)**:一车间 38+一车间总用电量 1;二车间 18;三车间 24;四车间 24;五车间 26;六车间 34;钢构车间 2;铝缆 4;园区/变压器/总水表等公共 12
- **dorm(宿舍)**:一栋 275;四栋 275;二栋 23;三栋 13;三/四栋 2(跨栋);宿舍 2;路灯/绿化/公交站等公共 12;无区域 35

---

## 2. 目标模型设计

### 2.1 新楼栋清单(从抄表区域列归纳)

命名规范:**「{期区前缀} {真实结构名}」**,期区前缀必须保留「一期/二期/三期/宿舍」字样 —— `ContractsView.vue:68-74` 的期区启发式和搜索都吃这个词。phase 数值**继承旧栋不变**(分析层期区聚合锚点不动)。

| # | 新栋名 | phase | 来源旧栋 | 证据(抄表区域/合同) |
|---|---|---|---|---|
| 1 | 一期 A座 | 1 | 13(沿用改名或原样保留) | A座 115 表、38 合同 |
| 2-7 | 一期 B座 / C座 / D座 / E座 / F座 / G座 | 1 | 11 拆 6 | B 28/C 50/D 30/E 36/F 29/G 6 表 |
| 8 | 一期 空地 | 1 | 14 原样保留 | 场地租赁 4 合同,非建筑 |
| 9-12 | 一期 宿舍一栋 / 二栋 / 三栋 / 四栋 | 1 | 12 拆 4 | dorm 一栋 275/二栋 23/三栋 13/四栋 275 表 |
| 13-16 | 二期 一车间 / 二车间 / 三车间 / 四车间 | 2 | 15 拆 4 | 一 39/二 18/三 24/四 24 表 |
| 17-18 | 二期 五车间 / 六车间 | 2 | 16 拆 2 | 五 26/六 34 表 |
| 19 | 三期 创业大厦 | 3 | 17 拆 2(见开放问题) | `meterSplit.ts:75` 已有名;无表/合同细分信号 |
| 20 | 三期 工业大厦 | 3 | 同上 | 同上 |
| 21 | 散租宿舍 | 4 | 18 原样保留 | 54 合同无栋别信号 |

约 21 栋(8→21)。**不建**:招商中心(13 表,园区自用办公,表挂 ownership=ops 即可,无租赁)、钢构车间/铝缆(共 6 表,附属小构筑物,先留空楼栋,见开放问题)。

### 2.2 楼层/房间建模:复用 unit,不新增层级

**结论:unit 表就是房间表,一行未改即满足需求。** `unit(building_id, floor, unit_no, area)` 已有楼层(floor TINYINT)、房号(unit_no)、面积(area),uk(building_id, unit_no) 天然防重(`V1__schema.sql:23-34`);单元 CRUD、楼层守卫(超层 409)、自动编号全在 `BuildingService.java:158-209`;合同挂 unit_id、楼栋出租率按单元面积派生(`BuildingService.java:38-60`)全部现成。

不做的事(YAGNI):不建 floor 独立表(楼层无独立属性)、不建 room 新表(和 unit 完全同构)、不加 building.parent 树(期区=phase 已表达)。P2 的「房间层级」=**把占位单元换成真实房间清单**(真实 floor/unit_no/area),纯数据工作+既有 API。

唯一可能的 schema 触碰(P2 再定,先不做):unit_no 现 VARCHAR(16),真实房号如「3F-301东」若超长再放宽;floor TINYINT UNSIGNED 无负数,若有地下层(抄表见「负一层」spot)需改 SMALLINT —— 到 P2 有真实房表再决定,记 V4x。

### 2.3 面积模型衔接

合同 V33 面积列(buildingArea/unitPrice)现仅 1 条非空,重建不受其牵制;楼栋 total_area/rentable_area 现全 0(占位),P2 随真实房间表一并补录,出租率派生自动恢复意义。

---

## 3. 迁移方案

### 3.1 迁移载体:API 脚本,不走 Flyway

新增一次性工具 `frontend/src/tools/buildingRestructure.ts`(vite-node 运行,四模式 `dry / plan / apply / verify`),完全仿照 `realDataMigrate.ts` 先例。理由:

1. **数据每环境不同**:CI 测试库是 V2 种子(6 个假栋,`V2__seed.sql:14-20`),dev/云端是真实 8 栋 —— Flyway 数据迁移要么在 CI 空转要么写双份守卫;脚本按环境跑(dev 本机、云端 47.76.99.211 走同一 API)。
2. **合同重挂需要人工确认**(§3.3 的第三类信号),Flyway 无交互;脚本 `plan` 模式先吐映射清单 CSV 供人审,`apply` 才落库。
3. 先例一致:dev 切真实数据、附表10 派生合同都是脚本干的(`realDataMigrate.ts` 头注释:1-7 行)。

本期**无 schema 迁移**(建栋/挂合同/挂表全是数据);若 P2 决定放宽 unit_no/floor 再占用 V47。

### 3.2 旧8栋→新栋映射表(脚本内置常量,name-keyed)

| 旧栋(id 按 name 查,不硬编码 id) | 新栋 | 合同重挂方式 |
|---|---|---|
| 一期 A座 | 一期 A座 | **原地保留**(名称不变,零迁移) |
| 一期 空地 | 一期 空地 | 原地保留 |
| 散租宿舍 | 散租宿舍 | 原地保留 |
| 一期 B-G座 | B/C/D/E/F/G座 六栋 | 信号②+③,残余人工 |
| 一期 宿舍区 | 宿舍一~四栋 | 信号③,残余人工 |
| 二期 一至四车间 | 一~四车间 四栋 | 信号②(附表10 分组),残余③ |
| 二期 五、六车间 | 五/六车间 两栋 | 信号③,残余人工 |
| 三期 | 创业大厦/工业大厦 | **全量人工**(无信号);P1 先保留旧栋承载,拆分挂起(开放问题①) |

### 3.3 合同/单元重挂:三类信号

重挂 = `PUT /api/contracts/{id}`(全字段,`ContractController.java:29-31`)改 buildingId+unitId;目标单元由脚本在新栋预建(`POST /api/buildings/{id}/units`,占位同现状)。旧占位单元在合同迁走后无引用,随旧栋后续删除级联清掉,不单独处理。

- **信号①名称直配**:旧栋整体=新栋(A座/空地/散租),合同不动。覆盖 96 份合同。
- **信号②附表10 分组**:二期合同的车间归属在《附表10测试.xlsx》第 0 列分组里是**逐车间**的(一车间/二车间/…),`realDataMigrate.ts:427-444` scanPhase2Groups 已解析过、只是当时折叠成两栋(`:485`)。脚本复用该解析,直接得到 57 份二期合同的目标车间。执行时验证:若文件里五、六车间也是合并组,则 16 栋的 22 份合同降级走信号③。
- **信号③抄表租户×区域**:675 块表已挂 tenant_id(§1.4),表的「区域」列即该租户的真实位置 —— `(tenant_id, 区域)` 聚合出每租户的栋别(一租户多表多区域时取表数最多的区域,冲突则标「待人工」)。用于:B-G座 51 份、宿舍区 41 份、五六车间兜底。
- **残余人工**:plan 模式输出 `restructure-plan.csv`(合同号/租户/旧栋/建议新栋/信号来源/置信),无信号行留空由用户填,apply 读回执行。预计人工量:三期 15 份 + 各栋无表租户若干,估 30-50 行。

月租金、面积、日期等字段原样带过(applyReq 全字段 PUT,读 detail 回填)。

### 3.4 meter.building_id 重映射(P3)

1. **重写 `meterSplit.ts:68-76` AREA_BUILDING** 为新栋规则,并修中文数字缺陷:
   - `/^一栋/→宿舍一栋`、`/^二栋/→宿舍二栋`、`/^三栋(?!\/)/→宿舍三栋`、`/^四栋/→宿舍四栋`(dormOnly)
   - `/([A-G])座/→一期 $1座`(逐座);`/([一二三四五六])车间/→二期 X车间`(逐车间)
   - `三期|创业大厦|工业大厦` 按开放问题①结论细化
   - 跨栋/公共(三/四栋、B-G座总表、园区、路灯、总水表)→ null 留空,归属徽标已表达其公共性
2. **存量刷挂**:脚本对 1138 块表按新规则重算 building_id,`PUT /api/meters/{id}`(`MeterController.java:31`)批量刷;预计挂接 470→约 1090(dorm 586+p1 293+p2 208 可归栋)。
3. 后续导入自动走新规则(导入非空才覆盖档案,`MeterService.java:216`,不会把手工改过的挂接冲掉)。

### 3.5 旧栋处置:停用,不删除

拆分型旧栋(11/12/15/16/17)在合同全部迁走后 `status=0` 停用(`PUT /api/buildings/{id}`),**不删除**:

- 停用即冻结:出租率记 0(`BuildingService.java:39,50`)、汇总只按启用栋计(`BuildingService.java:211-221`),不污染指标;
- 保留审计痕迹与回滚锚点(§4);
- 物理删除留到 P3 验收通过后一次清理(那时合同已迁空,`delete` 守卫放行,单元 FK 级联清,`BuildingService.java:148-153`)。meter 若仍挂旧栋 id 会显「—」(无 FK 悬挂,`MeterView.vue:125` 兜底),故删除必须排在 §3.4 刷挂之后。

### 3.6 幂等与执行顺序

脚本每步 name-keyed、可重跑:建栋前查同名跳过(后端本身 name 唯一 409,`BuildingService.java:105-106`);重挂前比对当前 buildingId 相同即跳过;刷表同理。顺序:

```
备份 → 建新栋(13个) → plan(吐CSV人审) → apply(合同+单元重挂) → 验收①(锚点) →
旧栋停用 → [P3] meterSplit 改造+存量刷表 → 验收② → 旧栋物理删除
```

---

## 4. 回滚策略

1. **第一道:全库备份**。执行前跑既有 `本地数据库备份.cmd`(dev)/云端 mysqldump(deploy 工具包先例);任何一步炸,恢复备份即回原点。这是主回滚路径。
2. **第二道:计划文件即逆映射**。apply 前 plan CSV 落盘(合同id/旧building_id/旧unit_id/新building_id/新unit_id;表id/旧building_id/新building_id),脚本带 `rollback` 模式按 CSV 反向重放 —— 适合「迁完发现个别栋映射错」的局部回退,不必整库恢复。
3. **旧栋停用不删**保证反向重挂目标始终存在;物理删除是最后一步且在双重验收之后,删除后仅剩备份可回滚(所以删除前再备份一次)。
4. 前端改动(meterSplit/测试断言)在 git,revert 即回滚,与数据回滚解耦。

---

## 5. 分期与验收清单

### P1 楼栋+映射迁移(合同/单元重挂)

做:建 13 个新栋 → plan/人审 → 合同 282 份重挂 → 旧栋 11/12/15/16 停用(17 三期视开放问题①)。前端零改动(全数据驱动自动适配)。

验收:
- [ ] GET /api/buildings:新栋清单齐、旧拆分栋 status=0;栋名全含期区关键词
- [ ] 合同总数不变(282)、全 active、无一份仍挂停用栋;每份 unitId 属于其新栋(后端校验兜底,`ContractService.java:166-171`)
- [ ] **锚点等式**:按 phase 聚合的月租合计与迁移前逐分一致(一期 1,498,753.32 / 二期 3,048,509.24 / 三期 75,528.73 / 宿舍 48,910.92);ParkView 期区行数值不变
- [ ] ContractsView 期区列无「其他」漏归;楼栋筛选/搜索按新栋名可用
- [ ] 后端 IT 全绿(CI 种子库不受影响,脚本不进 CI)、前端 vitest+typecheck 全绿(P1 无前端改动,应天然绿)

### P2 房间层级(真实楼层/房间/面积)

做:向用户收各栋真实楼层数/房间表(或从租赁台账房号整理)→ 批量换占位单元为真实单元(floor/unit_no/area)→ 合同挂到真实房间 → 楼栋 total_area/rentable_area 补录;届时评估 unit_no 长度/负楼层是否占用 V47。

验收:
- [ ] 每栋 floorCount/单元数/面积=真实值;出租率不再是 0 分母假 100%
- [ ] 合同 floorInfo 显示真实「3F-301」(`ContractService.java:247`)
- [ ] 楼栋抽屉逐层视图与真实结构一致(人工目视)

### P3 抄表/合同消费端切换

做:meterSplit AREA_BUILDING 重写(含中文数字修复)+ 存量 1138 表刷挂 + 测试断言更新(`importRegistry.spec.ts:430`、`meterSplit.spec.ts`、`meterExcel.spec.ts`)+ 验收后旧栋物理删除。

验收:
- [ ] meter 挂接数 470→≥1050;dorm 未挂从 624 降到仅公共/跨栋残余
- [ ] MeterView 楼栋列/楼栋行内改下拉全为新栋;按新栋名筛选正确
- [ ] 重导一次真实抄表工作簿:档案 upsert 幂等、新表自动挂新栋
- [ ] 全部前端测试+typecheck 绿(`npm run typecheck`,勿裸跑 vue-tsc)
- [ ] 旧栋删除后 GET /api/buildings 无停用残留;meter 无悬挂旧 id

---

## 6. 风险与开放问题

1. **三期拆创业/工业大厦无任何自动信号**(15 份合同、仅 2 块表):建议 P1 保留旧「三期」栋继续承载,新建两大厦 0 合同,由用户在合同编辑里手工迁,迁空后停用旧栋 —— 拆分不阻塞主线。**需用户确认:三期是否本期就拆。**
2. **五、六车间合同拆分依赖附表10 分组粒度**:若文件里是合并组「五、六车间」,22 份合同走抄表信号③+人工。执行时 dry 模式先验证。
3. **钢构车间/铝缆(6 块表)、招商中心(13 块表)不建栋**:表楼栋留空。若用户想在楼栋管理里看到它们,再补两个 phase=2 小栋,一行脚本的事。**需用户确认。**
4. **宿舍商铺**:旧宿舍区含商铺租金(shopRent,`realDataMigrate.ts:424`),重挂到「宿舍X栋」哪一栋靠信号③;抄表 spot 有「一楼商铺」可辅助,残余人工。
5. **分析层楼栋行变长**(8→21 行,`park.logic.ts:23-33`):数值口径不变,仅展示密度问题,不属本 spec 范围,验收目视即可。
6. **散租宿舍 54 份合同不动**:无栋别信号,强拆无依据。若未来有房号台账,并入宿舍 N 栋走 P2。
7. **一租户多位置**:信号③按表数最多区域归栋,B-G 座内一户多座的会给错建议 —— plan CSV 人审是兜底,置信列会标「多区域冲突」。
