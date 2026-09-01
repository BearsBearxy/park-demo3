# 光伏分栋分析新屏 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把「分栋抄表分析」从 `PvRoiView` 拆成独立屏 `pv-meter-analysis`，接上外部天气/辐照，用中位数抛光 + 块自助做楼栋级异常识别，第一层出钱不出统计量。

**Architecture:** 三条互相独立的链先各自落地——① weather 域（migration + 后端四件套 + 导入类型）；② 模拟器改造（不改就无法验收，见 Spec §08）；③ 前端公式层纯函数。三条齐了再拼屏（第一层 → 第二层 → 方法页/工作台），最后卸 `PvRoiView` 的抄表区。**公式层零 Vue 依赖、零 IO**，全部可单测。

**Tech Stack:** Spring Boot 3 + MyBatis-Plus + Flyway / Vue 3 `<script setup>` + TypeScript strict + ECharts / JUnit 5 + Vitest

**Spec:** `docs/design/PV-ANALYSIS-SPEC.md`（权威版）。设计稿：Artifact `592f1d86-c6a1-4bc3-97bd-1c6363704464`。
设计稿与仓库现状的四处出入见 Spec §10 —— **以 Spec 为准**。

---

## Global Constraints

- **不要接管道跑测试。** `./mvnw test | tail` / `npx vitest run 2>&1 | tail` 的退出码取自 `tail`（恒 0），会把红报成绿。见 `docs/design/IMPORT-GUIDE.md:59`。直接跑，或读完整输出 grep `Tests run` / `ERROR` / `Failed Tests`。
- **后端测试命令**（PowerShell，cwd = `backend`）：`.\mvnw.cmd -q test "-Dtest=X"`。`-Dtest=` 必须加引号，否则逗号被 PowerShell 当数组分隔符。合刀前必须亲跑一次全量 `.\mvnw.cmd test`。
- **前端测试命令**（cwd = `frontend`）：`npx vitest run <路径>`。类型闸 `npm run build`（含 vue-tsc 实跑）。
- **worktree 里没有 `frontend/node_modules`**，vitest 会往主 checkout 找然后报 `Cannot find package 'vite'`。
  主仓 `C:\financial_dashboard\demo3\frontend\node_modules` 是现成的，且两边 `package.json`/`package-lock.json` 逐字一致，
  建目录联接即可，别再 `npm ci` 一遍：
  `cmd //c mklink //J "frontend\node_modules" "C:\financial_dashboard\demo3\frontend\node_modules"`
- **每条新断言必须做破坏验证**：改坏对应的 production 那一行 → **只有那一条**转红。前置不足的断言等于假绿，本项目栽过三次。本刀最容易假绿的两条是护栏「有效日 < 20 不出结论」与「参与站 < 8 降级」（Spec §07）。
- **migration 起号前先 `ls`**：`backend/src/main/resources/db/migration/`。当前最大 V116，Java 侧 `backend/src/main/java/db/migration/` 只有 V35。历史迁移**不可改**。
- **第一层永不出现统计术语**（Spec §06「不确定性怎么说」的黑名单）。写文案前回去读那一段。
- **不动** `PvMeterController` / `PvMeterService` 的抄表 CRUD 与导入，**不动** `GET /api/pv-meter/readings`。本刀在 `PvMeterService` 里只碰 `simulateDays` 与它的权重来源。
- **不新建后端分析接口**。13 站 × 365 日的统计在浏览器里是毫秒级（Spec §05 开头）。
- **`AnaEChart` 的 `height` 只许取 170 / 200 / 250 / 300 / 440**（`AnaEChart.vue:77`）。

---

## 开工闸门（不是代码，Spec §01）

代码骨架可以先做，**但下面三项没到位不许上线，也不许拿假容量出结论**：

- [ ] **① 13 栋真实装机容量 kWp** —— `pv_station.capacity_kwp` 现在全 NULL，界面上的值是模拟器按 950h 反推的假值。
- [ ] **② 自用/上网分表电量 + 分时电价 + 总投资额** —— 缺这三样，主指标只能退回「电量」，第一层的钱口径立不住。
- [ ] **③ 二期/三期哪些栋有光伏表** —— 决定 V118 的 `metered` 要 UPDATE 哪几行，以及第一版覆盖 5 栋还是 13 栋。

**闸门未过时**：Task 1–7 全部可做（骨架 + 公式 + 模拟数据验收）；Task 8–12 可做但屏上必须挂「当前使用模拟容量，数字不可对外」的横幅，合并到 master 前撤掉。

---

## 文件结构

**新建 · 后端**

| 文件 | 职责 |
|---|---|
| `resources/db/migration/V117__weather_hour.sql` | 逐小时天气与辐射表 |
| `resources/db/migration/V118__pv_station_metered.sql` | `metered` 字段 |
| `resources/db/migration/V119__weather_switch_params.sql` | 三个断闸参数种子 |
| `java/.../entity/WeatherHour.java` | 实体 |
| `java/.../mapper/WeatherHourMapper.java` | **日聚合 SQL 在这里**（不落库） |
| `java/.../dto/WeatherDayDTO.java` / `WeatherImportRequest.java` | record |
| `java/.../service/WeatherService.java` | 导入 + 日聚合，零业务规则 |
| `java/.../controller/WeatherController.java` | 两个端点 |
| `test/java/.../api/WeatherApiIT.java` | 导入幂等 + 日聚合口径 + 权限 |

**新建 · 前端**

| 文件 | 职责 |
|---|---|
| `src/api/weather.ts` | `weatherApi.daily(year)` |
| `src/utils/weatherExcel.ts` + `.spec.ts` | CSV 解析纯函数 |
| `src/views/analysis/pvMeterAna.logic.ts` + `.spec.ts` | **全部公式**（Spec §05） |
| `src/views/analysis/PvMeterAnaView.vue` | 三层 + 工作台 |

**修改**

| 文件 | 改什么 |
|---|---|
| `java/.../service/ParamRegistry.java` | 新建 `S_GLOBAL_ONLY` + `WEATHER_SOURCE_OPTS` + `static{}` 三行 |
| `java/.../security/PermissionRegistry.java` | 一行 `/api/weather/**` |
| `java/.../service/PvMeterService.java` | `simulateDays` 共享天气因子 + 种入故障 |
| `frontend/src/utils/paramRegistry.ts` | `PARAM_DEFS` **同位**插三项 |
| `src/utils/importRegistry.ts` + `.spec.ts` | `key='weather'`；:28 的 24 → 25 |
| `src/nav/fpNav.ts` + `__tests__/fpNav.spec.ts` | 「专题分析」组加屏；50 → 51；:1 头注释 49 → 51 |
| `src/router/index.ts` | **`VIEWS` 表加一行**（Spec §10 ①，漏了会静默变占位页） |
| `src/views/pv/PvMeterView.vue` | 未装表行灰徽标 + 禁用 + 不开抽屉 |
| `src/views/analysis/PvRoiView.vue` | 卸抄表区（468 → ~230） |
| `src/views/analysis/pvRoi.logic.ts` + `.spec.ts` | 删迁走的 4 个函数（:76-163）与对应断言 |

---

## Task 1: 三个 migration

**Files:** 新建 `V117__weather_hour.sql` / `V118__pv_station_metered.sql` / `V119__weather_switch_params.sql`

**Interfaces:** Consumes 无（本任务是根）。Produces `weather_hour` 表、`pv_station.metered` 列、三个 `alloc_cfg` 键 —— Task 2/3/5/11 全部依赖。

- [x] **Step 1: 起号前确认最大版本没变**

```bash
ls backend/src/main/resources/db/migration/ | sort -V | tail -3
```

必须是 V116。若已被别的刀占用，整体往后顺延并同步改本文件与 Spec §02 的版本号。

- [x] **Step 2: 照 Spec §02 逐字写三个文件**

SQL 与注释在 Spec §02，**照抄不要改口径**。三处特别注意：
1. `weather_hour` 的 `UNIQUE KEY uk_weather_hour (obs_time)` —— 幂等 upsert 靠它。
2. `metered` 必须 `AFTER phase`，`DEFAULT 1`（现有 13 行全部落 1，二/三期核实后单独 UPDATE）。
3. `alloc_cfg.cfg_value` 是 `DECIMAL(14,8)`，`weather_source` **只能存整数**（0/1/2），不能存 `'import'`。

- [x] **Step 3: 验证**

起后端（或跑任一 IT），Flyway 必须把三个版本都 applied：

```bash
cd backend && ./mvnw -q test "-Dtest=SeedIT"
```

破坏验证：把 V118 的 `AFTER phase` 删掉 → 列位置变了但 CI 不红（Flyway 不管列序）。**这一步没有断言可破坏**，靠 Step 4 的 IT 兜。

- [x] **Step 4: `WeatherApiIT` 先写一条最小 schema 断言**

`SELECT` 一下 `weather_hour` 的空表与 `pv_station.metered` 的默认值，确认迁移真的跑过。这条断言在 Task 3 会被扩成完整 IT。

---

## Task 2: ParamRegistry 三个断闸键（前后端同位）

**Files:**（落地时发现比设计稿多两个 —— 注册表在这个仓里是**五处同步**，不是两处）
- Modify: `backend/src/main/java/com/park/demo3/service/ParamRegistry.java`
- Modify: `backend/src/test/java/com/park/demo3/service/ParamRegistryTest.java` —— **`SPEC_KEYS` 白名单必须同步**，:54 有反向断言「spec 外的键」
- Modify: `frontend/src/utils/paramRegistry.ts`
- Modify: `frontend/src/utils/__fixtures__/param-registry.json` —— **从 `backend/target/param-registry.json` 拷**（由 `ParamRegistryTest.exportJson` 生成）
- Modify: `frontend/src/utils/paramRegistry.spec.ts` —— `PARAM_DEFS.length` 写死，45 → 48
- Test: `backend/.../ParamPermissionSplitTest`（已存在，跑绿即可）

**Interfaces:** Consumes Task 1 的 V119 种子。Produces 参数中心三行；本刀内**无人消费**（断闸是给将来接付费 API 用的），所以这个任务可与 Task 3+ 并行。

- [x] **Step 1: 读现状，确认插入点与两个坑**

- `S_*` 常量在 `ParamRegistry.java:30-37`，**没有 `S_GLOBAL_ONLY`**，本刀新建。
- 枚举字典 `ZONE_CALC_KIND_OPTS` 在 :43，`WEATHER_SOURCE_OPTS` 挨着它放。
- `alloc(...)` 签名在 :60（13 个参数），照 :132 的 `zone_calc_kind` 那行的形状。
- **坑①** `ParamPermissionSplitTest` 钉死 `group==MONTHLY ⟺ monthlyCheck==true` → 三个键必须 `Group.CONSTANT` + `monthlyCheck=false`。
- **坑②** `DEFS` 是 `LinkedHashMap`，登记顺序 = 前端 `PARAM_DEFS` 数组顺序，**前端 spec 逐位比对**。

- [x] **Step 2: 后端三行（Spec §02 逐字）**

- [x] **Step 3: 前端 `PARAM_DEFS` 同位置插三项**

先跑一次 `npx vitest run src/utils/paramRegistry.spec.ts` 看它**怎么红的** —— 报的是哪个下标不匹配，就插在哪。

- [x] **Step 4: 验证 + 破坏**

```bash
cd backend && ./mvnw -q test "-Dtest=ParamPermissionSplitTest+ParamRegistryTest"
cd frontend && npx vitest run src/utils/paramRegistry.spec.ts
```

破坏验证：把 `weather_api_enabled` 的 `Group.CONSTANT` 改成 `Group.MONTHLY` → `ParamPermissionSplitTest` **必须红**。把前端三项挪到数组末尾 → 前端 spec **必须红**。两条都恢复。

---

## Task 3: weather 后端域（entity → controller → 权限）

**Files:** 新建 §09「新建 · 后端」的 6 个 java 文件 + `WeatherApiIT`；Modify `PermissionRegistry.java`

**Interfaces:** Consumes Task 1 的 `weather_hour`。Produces `GET /api/weather/daily?year=` → `WeatherDayDTO[]`、`POST /api/weather/import` → `ImportResultDTO`。Task 4（导入）与 Task 8（外部锚）依赖。

- [x] **Step 1: 先写失败 IT**

`backend/src/test/java/com/park/demo3/api/WeatherApiIT.java`，照 `PvMeterApiIT` 的骨架（同目录）。四条：

1. **导入幂等** —— 同一 `obs_time` 导两次，`weather_hour` 只有一行，值取后一次。
2. **日聚合口径** —— 塞 24 行 GHI 各 500 W/m2 → `ghiKwh` 必须是 `12.00`（`SUM(ghi)/1000`），`hours=24`。
3. **hours 是护栏** —— 只塞 20 行 → `hours=20`（**不是补齐成 24，也不是整日丢弃**）。前端靠这个数剔日（Spec §07）。
4. **权限** —— viewer 账号 `GET /api/weather/daily` 通；`POST /api/weather/import` 得 **403**。

- [x] **Step 2: Entity / Mapper / DTO**

照 Spec §03.1–3.3。三点房内风格：字段裸写靠 `map-underscore-to-camel-case`；只有两个时间戳带 `@TableField(fill)`；DTO 一律 record。
**日聚合 SQL 写在 Mapper 的 `@Select` 里，不落第二张表** —— 理由在 Spec §03.2。

- [x] **Step 3: Service**

`importRows` 逐行处理，两类行级错误（时间格式非法 / 辐射为负）**跳过该行不整批拦**，与 `PvMeterService.importRows` 同口径。
合法行 `delete(obs_time)` 后 `insert`，`source='import'`。返回三参 `ImportResultDTO`（`notices` 走默认 `List.of()`）。

- [x] **Step 4: Controller + 权限登记**

- controller 返回**裸 DTO/List**，不手写 `Result`（`ResponseWrapAdvice` 统一包）。
- 构造注入，无 `@Autowired`。
- **`PermissionRegistry` 构造器加一行**，挨着 :118-122 的 `/api/pv-meter` 段：

```java
add(null, "/api/weather/**", Perm.METER_READING_EDIT);   // method=null 表示所有非 GET
```

漏这一行 → 写端点 403 **且** `PermissionCoverageTest` 红。

- [x] **Step 5: 验证 + 破坏**

```bash
cd backend && ./mvnw -q test "-Dtest=WeatherApiIT+PermissionCoverageTest"
```

破坏验证四条：① 把 `SUM(ghi)/1000` 改成 `SUM(ghi)` → 口径断言红；② 把 `COUNT(*)` 换成常量 24 → hours 断言红；③ 去掉 `delete(obs_time)` → 幂等断言红；④ 注掉 `PermissionRegistry` 那一行 → 权限断言 + `PermissionCoverageTest` 红。**只有对应那条红**。

---

## Task 4: 天气导入类型

**Files:** 新建 `src/utils/weatherExcel.ts` + `.spec.ts`、`src/api/weather.ts`；Modify `src/utils/importRegistry.ts` + `.spec.ts`

**Interfaces:** Consumes Task 3 的 `POST /api/weather/import`。Produces 导入中心多一个 `key='weather'` 类型。

- [x] **Step 1: 先写 `weatherExcel.spec.ts`**

四条：① 标准表头解析出 8 个字段；② **别名**（`太阳辐射` → `ghi`、`气温` → `tempC`）命中；③ **单位后缀**（`短波太阳辐射(W/m²)`）靠 `matchByHeader` 的前缀匹配自动吃掉；④ 非法时间 / 负辐射 → 行级错误 `rowIndex >= 0`，表头识别失败 → `rowIndex = -1`。

- [x] **Step 2: `weatherExcel.ts`**

`WEATHER_COLUMN_MAP` 见 Spec §04.1。
**必踩的坑**：`matchByHeader` 把关键列的值一律塞进 `rec.tenantName`（`importHeaderMatch.ts:169`），不管 `nameLabels` 叫什么。天气的关键列是**时间**，所以从 `tenantName` 里取时间串。

- [x] **Step 3: `api/weather.ts`**

照 `src/api/pvMeter.ts` 的形状，只有 `daily(year)` 一个方法。导入走 `importRegistry` 里的直调（与 `pvMeter` 同，见 `importRegistry.ts:574` 的 ponytail 注释）。

- [x] **Step 4: 注册表条目**

照抄 `importRegistry.ts:559-583` 的 `pvMeter` 形状。三个坑（Spec §04.2）：`ctx` 是同一引用不能改无参工厂；`_parseErrors` **整体赋值**不能 push；`icon: 'sun'` 已在 `icon.ts:43`。

- [x] **Step 5: 同步 key 清单断言**

`importRegistry.spec.ts:28`：文案 `has the 24 expected keys` → `25`，数组加 `'weather'` 后**重排序**（断言是 `.sort()` 后比）。

- [x] **Step 6: 验证 + 破坏**

```bash
cd frontend && npx vitest run src/utils/weatherExcel.spec.ts src/utils/importRegistry.spec.ts
```

破坏验证：把 `_parseErrors` 从整体赋值改成 `push` → 换文件重解析的那条断言必须红（若没有这条断言，**先补上再破坏**）。

---

## Task 5: 模拟器改造 —— 不改无法验收

**Files:** Modify `backend/src/main/java/com/park/demo3/service/PvMeterService.java`（`simulateDays` :246-264）；Test `backend/.../PvMeterServiceTest`（若无则新建）

**Interfaces:** Consumes 无。Produces 带共享 β(d) 与一处种入阶跃的模拟抄表 —— **Task 6–9 的全部验收都依赖它**。

- [x] **Step 1: 先自查现状（不写代码）**

打开 `PvRoiView` 的「各站发电效率」柱图，在模拟数据下**应呈现三段各自持平的台阶**（一期五根等高、二期六根等高、三期两根等高）。看到台阶 = 确认了 Spec §08 诊断的第 ② 条。

- [x] **Step 2: 写失败测试**

`PvMeterServiceTest` 两条：
1. **共享天气因子** —— 同一 phase 两个站在同一月的日权重序列，**相关系数必须 > 0.5**（现在是 0，因为种子含站 id）。
2. **种入阶跃** —— F 座 7/18 之后的日均 `gen/cap` 相对 7/18 之前**下降 25–31%**。

- [x] **Step 3: 改权重来源 —— 两处都要改（设计稿只写了一处，不够）**

**设计稿的 `w[d] *= 0.72` 单独用是无效的**：`self_d = 月量 × w_d/Σw`，整月同乘一个数分子分母对消，
故障出了当月完全看不见，8 月起 F 座又是一片绿。必须再打一处：

```java
// ① 站间拆分权重 = 容量 × 故障「月系数」——水平持续掉下来；少拿的那份由同期其余站分掉，
//    Σ全站 仍等于 phase 月真实值，月度恒等不破
PvStation::getId, s -> s.getCapacityKwp().multiply(faultMonth(s, month1))

// ② 日权重 = 共享天气 × 站内扰动 × 故障「逐日系数」——7/18 那一跳在当月内看得见
Random park = new Random(year * 100L + month);        // ← 不含站 id
Random site = new Random(st.getId() * 100000L + year * 100L + month);
w[d] = (0.55 + park.nextDouble() * 0.9) * (0.92 + site.nextDouble() * 0.16)
     * faultDay(st, month1.withDayOfMonth(d + 1));
```

**月系数 = 逐日系数的月内均值**（7 月 ≈ 0.8826），不能写成常数 0.72 —— 两者自洽后故障前的日
才恰好回到正常水平；写常数的话 7 月前半月被垫高 13%，变点量出来的落差是错的。

⚠ `Random self` 会与日循环里已有的 `BigDecimal self` 撞名，命名为 `site`。

- [x] **Step 4: 保住既有恒等口径**

`simulateDays` 现有的「末日补差保 Σ日 = 月真实值分毫不差」**必须保留**。改的只是权重来源，不是分配机制。
`note` 在故障月追加「;含种入故障(F座 7/18 起 −28%,仅供检测验收)」——
既有断言是 `startsWith("模拟:附表6 p1 2099-01")` + `contains(...)`，追加后缀安全。

> **断言写在哪**：不能写在月合计上（末日/末站补差会把差额吞回去，恒为绿）。
> 用「F座 ÷ B座」的比值 —— 两站容量固定，这个比值把年度总量、容量反推、共享天气因子全约掉了。

- [x] **Step 5: 验证 + 破坏**

```bash
cd backend && ./mvnw -q test "-Dtest=PvMeterServiceTest+PvMeterApiIT"
```

破坏验证：把 `park` 的种子改回含 `st.getId()` → 相关系数断言必须红。删掉种入那三行 → 阶跃断言必须红。
**回归**：既有的月度恒等断言（`PvMeterApiIT` 里的 simulate 幂等/合计）必须仍绿。

---

## Task 6: 公式层 A —— 归一化、过滤、中位数抛光

**Files:** 新建 `src/views/analysis/pvMeterAna.logic.ts` + `.spec.ts`

**Interfaces:** Consumes 无（纯函数）。Produces `specificYield` / `okDay` / `medianPolish` → `PolishResult`。Task 7/8 依赖。

- [x] **Step 1: 写夹具与失败测试**

`pvMeterAna.logic.spec.ts` 手造一个 5 站 × 30 日的小矩阵，`eff = α(s)·β(d)` 精确可算（无噪声），已知答案：
1. `medianPolish` 在无噪声矩阵上必须**精确还原** α 与 β（到 1e-9）。
2. **显式重锚** —— `median(alpha)` 与 `median(beta)` 必须都是 0。这条**单独一个 it**，因为 §5.5 的 `parkHealth` 直接吃 β，锚定漂移会变成假趋势。
3. **崩溃点** —— 5 站里 2 站整列置 0，α/β 估计相对无污染版**偏移 < 5%**（中位数的稳健性）。换成均值实现这条必红。
4. **过滤器只打 GHI** —— 传一个只按 `gen` 过滤的 `okDays` 会漏掉故障日；断言 `okDay` 的入参类型是 `WeatherDay` 而非 `DayRow`（类型层守，`npm run build` 兜）。
5. **`gen=0` 两义** —— 表离线的格子必须是 `NaN` 且**不参与**矩阵；有太阳发 0 的格子进「零值日率」通道，`resid` 里没有它。

- [x] **Step 2: 实现**

Spec §5.1–5.2。房内注释惯例：文件头一行写「屏名 + 口径 + 单测文件名」，每个导出函数上方写清**口径与边界**（缺数怎么办、除零怎么办）。

抛光实现四步（Spec §5.2 的代码注释就是伪码）：建矩阵跳过 `!metered / capKwp==null / !okDays.has(date) / gen<=0` → `while (iter < 20 && maxDelta > 1e-8)` 行中位数/列中位数交替 → **显式重锚** → `converged = (iter < 20)`。

- [x] **Step 3: 验证 + 破坏**

```bash
cd frontend && npx vitest run src/views/analysis/pvMeterAna.logic.spec.ts
```

破坏验证：**删掉显式重锚那两行** → 重锚断言必须红（若不红说明迭代恰好收敛到锚点，把 `maxDelta` 阈值放宽到 1e-3 重试，让「只迭代 2~3 轮」的情形暴露出来）。把 `median` 换成 `mean` → 崩溃点断言必须红。

---

## Task 7: 公式层 B —— 显著性、变点、形状

**Files:** Modify `pvMeterAna.logic.ts` + `.spec.ts`

**Interfaces:** Consumes Task 6 的 `PolishResult.resid`。Produces `robustSigma` / `shrinkSigma` / `blockBootstrapP` / `bhFdr` / `changePoint` / `classifyShape`。Task 9/10 依赖。

- [x] **Step 1: 写失败测试**

1. **`robustSigma` 对阶跃免疫** —— 同一条噪声序列，加一个 30% 阶跃前后，`robustSigma` 变化 < 10%；直接对 r 取 MAD 的话会涨 2 倍以上。**这条是「越坏的楼越不报警」的守门断言。**
2. **`shrinkSigma` 有下限** —— `sigmaS = 0`（读数取整导致 MAD=0）时返回 `floor`，不返回 0（防 z=∞）。
3. **`blockBootstrapP` 的两处 +1** —— 观测值比全部零分布都小时，`p` 必须是 `1/(B+1)` 而**不是 0**（p=0 会让 BH 排序失去意义）。
4. **`blockBootstrapP` 是单侧** —— 观测均值显著**偏高**时 `p` 接近 1，不是接近 0。
5. **自相关下 p 不乐观** —— 造一条 ρ=0.5 的 AR(1) 序列，`blockBootstrapP` 的 p 必须**显著大于**同数据的 √N 正态 p（这条直接量化 Spec §5.3 的「乐观 1–3 个数量级」）。
6. **`bhFdr` 顺序不变性** —— 打乱 pvals 顺序，返回的布尔数组按原下标对齐后一致。
7. **`changePoint` 给区间** —— 在一条已知 index=100 的阶跃上，`index` 落在 `[ciLo, ciHi]` 内且 `ciHi - ciLo >= 14`（赢家诅咒，区间本来就宽；返回 `ciLo === ciHi` 是错的）。
8. **`classifyShape` 认 sawtooth** —— 造「负趋势 + 降雨日之后跳升」的序列必须判 `sawtooth`；同样负趋势但雨后不回弹必须判 `ramp`。这两条分别对应「可安排清洗」与「测直流侧压降」，判错了派错人。

- [x] **Step 2: 实现**

Spec §5.3–5.4。四处不许简化：
- `robustSigma` 用**一阶差分** MAD，不是对 r 直接 MAD。
- `blockBootstrapP` 块长 14–21 天，`p = (1 + #{null <= obs}) / (B + 1)`，**单侧**。
- `changePoint` 零分布用**循环分块置换**（逐日置换会摧毁自相关，零分布被压得过窄）；两端修剪 15%；**合并方差**不用 Welch；落差用样本分割去偏（奇数日找变点、偶数日估落差）。
- `classifyShape` 拟形状库比 **BIC**，不要指望变点算法回答形状。

- [x] **Step 3: 验证 + 破坏**

```bash
cd frontend && npx vitest run src/views/analysis/pvMeterAna.logic.spec.ts
```

破坏验证：把 `blockBootstrapP` 换成 `z = mean·√N/σ` 的正态 p → 断言 5 必须红。把两处 `+1` 去掉 → 断言 3 必须红。把 `changePoint` 的分块置换换成逐日置换 → p 值明显变小，断言 7 的区间宽度必须红。

---

## Task 8: 公式层 C —— 外部锚、先天缺陷、换算成钱

**Files:** Modify `pvMeterAna.logic.ts` + `.spec.ts`

**Interfaces:** Consumes Task 6 的 `PolishResult`、Task 3 的 `WeatherDayDTO[]`。Produces `parkHealth` / `clearSkyIndex` / `congenitalCheck` / `gapMoney` / `alertLevel`。Task 9 依赖。

- [x] **Step 1: 写失败测试**

1. **`parkHealth` 在 log 域做差** —— 造一批 `ghiKwh` 逐渐趋零的日子，`logH` 必须仍有限；比值实现会 Cauchy 化炸掉。
2. **`parkHealth` 看得见共模劣化** —— 造「全园每天一起降 0.1%」的数据：`resid` 纹丝不动（这本身是一条断言，证明盲区真实存在），但 `logH` 必须有显著负趋势。**这是外部辐照存在的唯一强理由。**
3. **`clearSkyIndex` 自检** —— `kt` 的 95 分位逐月下滑时返回「源可疑」标记（不是「电站坏了」）。
4. **`congenitalCheck` 的 CI 用块自助** —— σ≈8%、365 天、13 站的夹具下，相邻两站的 CI **必须有重叠**。naive SE 实现会得到 13 个互不重叠的区间（图上显示「每栋都显著不同」）。
5. **`gapMoney` 按自用电价** —— 传自用价 0.86 与上网价 0.391，结果必须用 0.86。搞错了整屏的数就是错的。
6. **`alertLevel` 三重门槛** —— `q=0.001, days=200, annualGap=800` 必须返回 `'ok'`（**不是 risk**）。这是本项目最重要的一条产品规则：统计显著但金额不够的，绝不上屏。

- [x] **Step 2: 实现**

Spec §5.5–5.7。`congenitalCheck` 的 `suspect` 判定要能区分「先天缺陷」与「突发故障」——两者派给不同的人。

- [x] **Step 3: 验证 + 破坏**

破坏验证：`parkHealth` 改成比值 → 断言 1 必须红。`alertLevel` 去掉 `annualGap >= 5000` 那个与项 → 断言 6 必须红。`congenitalCheck` 的 CI 换 naive SE → 断言 4 必须红。

---

## Task 9: 第一层（新屏骨架 + 导航 + 路由）

**Files:** 新建 `src/views/analysis/PvMeterAnaView.vue`；Modify `src/nav/fpNav.ts`、`src/nav/__tests__/fpNav.spec.ts`、`src/router/index.ts`

**Interfaces:** Consumes Task 6–8 的全部纯函数、`pvMeterApi.readings(year)`、`weatherApi.daily(year)`。Produces 屏 `pv-meter-analysis` 与它的 `summary` 结果视图。Task 10/11 依赖。

> **Step 0（设计稿与 plan 都漏了）：`pv_station.metered` 只建了列，没透出到 DTO。**
> V118 加了列，但 `PvStation` entity / `PvStationDTO` / `toStationDTO` / 前端 `PvStationDTO` 四处都没有它，
> 分析屏拿不到 `metered`，「未装表」与「漏抄」还是混在一起。Task 14 也要它。
> `WeatherApiIT.v118_metered_透出到_stations_接口` 就是防这条。

- [x] **Step 1: 导航 + 路由 + 计数（先做这一步，先让屏可达）**

三处一起改，缺一处就静默出问题：
1. `fpNav.ts:60` 的「**专题分析**」组，`pv-roi`（:66）之后加：
   `{ value: 'pv-meter-analysis', label: '光伏分栋分析', icon: 'sun', kind: 'ana' }`
2. `fpNav.ts:1` 头注释 `49屏×4层` → `51屏×4层`（现值 50 就已经是错的）。
3. **`router/index.ts` 的 `VIEWS` 表加一行**（挨着 `'pv-roi'`）：
   `'pv-meter-analysis': () => import('@/views/analysis/PvMeterAnaView.vue'),`
   **漏这一行该屏静默降级成 `PlaceholderView`**，`routeMap.spec.ts:11` 会红（Spec §10 ①）。
4. `fpNav.spec.ts` 三处：:5 的文案 `has 4 layers and 50 items` → 51、:7 的 `toHaveLength(50)` → 51、:11 的 `toHaveLength(50)` → 51。

跑：`npx vitest run src/nav src/router`。破坏验证：注掉 `VIEWS` 那一行 → `routeMap.spec.ts` 必须红。

- [x] **Step 2: 屏骨架 + AnaShell 四条硬约束**

```vue
<AnaShell period-mode="year" :compare="CMP">
```

`const CMP: CompareMode[] = ['yoy']` 是**模块级常量**（传给 AnaShell 的必须同一份引用）。四条约束（Spec §06）：
① 只读 `period.sel.value.year`，**不读** `gran`/`month`（`AnaShell.spec.ts:35` 有断言守着）；
② `#kpis` 槽的 `v-if` 写在 `<template #kpis>` **内层**；
③ `AnaEChart` 的 `height` 只取 170/200/250/300/440；
④ ECharts option 里颜色写字面值，不引 CSS 变量。

- [x] **Step 3: 一份数据、一次计算、一个 snapshot id**

整屏**只跑一次**计算，产出一个结果对象带 `snapshotId`。第一层渲染它的 `summary` 视图。
**工作台永远不是另一次计算**（Spec §06.4 铁律）。页脚显示 snapshot id。

- [x] **Step 4: 四张 KPI 卡 + 楼栋明细表 + 一张图**

结构与列见 Spec §06.1。表按**缺口金额降序**，点行下钻（Task 10）。

- [x] **Step 5: 三段写死的文案**

**回到 Spec §06.1 逐字抄**。「这个数怎么来的」那一段**一字不要改** —— 用户问「你凭什么说 C 栋应该发更多」，答不上来这屏就废了。
四盏灯的定义写在**灯旁边**，不是只写在帮助里；末尾加「这套判断平均一个月误报不到 1 次。」

- [x] **Step 6: 术语黑名单自检**

第一层的 DOM 里 grep 一遍，以下**一个都不许出现**：`p`、`q`、`±2σ`、`95% 置信区间`、`显著`、`PR`、`α`、`β`、`kWh/kWp`、`等效利用小时`、`残差`、`归一化`。
建议把这条写成一个 spec 断言（mount 第一层，`wrapper.text()` 不含黑名单词）。

- [x] **Step 7: 验证**

```bash
cd frontend && npx vitest run src/views/analysis src/nav src/router && npm run build
```

---

## Task 10: 护栏（十条，Spec §07）

**Files:** Modify `PvMeterAnaView.vue`、`pvMeterAna.logic.ts`；Test 新建 `src/views/analysis/__tests__/pvMeterAnaGuards.spec.ts`

**Interfaces:** Consumes Task 9 的屏。Produces 十条护栏的显式暴露。

> **本任务是整刀最容易假绿的地方。** 每一条护栏都要有一条**会红的**断言，且必须逐条破坏验证。
> 「显正常」而不是「显样本不足」是一块无法区分「真没事」和「算错了」的绿。

- [x] **Step 1: 表驱动写十条断言**

照 `src/views/__tests__/lockDialogsCoverage.spec.ts` 的表驱动结构（以后加护栏加一行）。十条对应 Spec §07 十行。

- [x] **Step 2: 逐条实现**

十条里有两条最容易漏且后果最重：
- **某站有效日 < 20** → 状态显「**样本不足**」，**不出结论**。显「正常」就是假绿。
- **当日参与站 < 8** → **当天整屏降级**为「仅同比，不做同类比较」并明确告知。4 栋掉线就能污染中位数 β，导致全园当天集体误报。

其余八条照 Spec §07 表格逐行落。

- [x] **Step 3: 逐条破坏验证（不许跳）**

十条各改坏对应的 production 一行 → **只有那一条**转红。特别是把「有效日 < 20」的阈值改成 0 → 那一条必须红；把「参与站 < 8」的降级分支注掉 → 那一条必须红。

---

## Task 11: 第二层 · 单栋详情

**Files:** Modify `PvMeterAnaView.vue`

**Interfaces:** Consumes Task 9 的结果对象 + Task 7 的 `changePoint`/`classifyShape`。

- [x] **Step 1: 锚点下钻**

从表行点进来，**同一个 URL 加锚点，不是另一套页面**。未选中站时整区**不渲染**（不是渲染空态）。

- [x] **Step 2: 四块内容**

见 Spec §06.2 表格。主图是**累计缺口曲线（纵轴=元）**，`s12 · h300`：折点 = 开始变差、斜率 = 元/天、终点 = 至今一共亏多少。

- [x] **Step 3: 变点必须同时写区间**

`折点 · 7 月中旬` + `区间 7/11–7/26 — 不是精确到天`。只写日期不写区间 = 承诺了算法给不了的精度。
加一条断言：变点标注的 DOM 里必须同时含起止日。

- [x] **Step 4: 技术细节折叠**

残差时序 + ±2σ 带收在「显示技术细节」开关下，y 轴写「每天比应发少多少度」，±2σ 改名「正常波动范围」。

---

## Task 12: 第三层方法页 + 分析工作台

**Files:** Modify `PvMeterAnaView.vue`

**Interfaces:** Consumes Task 9 的**同一个**结果对象（`full` 视图）。

- [x] **Step 1: 方法与口径页**

模型公式、抛光迭代与收敛、BH-FDR、变点算法与三重门槛，**以及数据质量记录**（Spec §06.3 的那段格式）。不暴露这一层，所有数字不可审计，财务不会认。

- [x] **Step 2: 工作台 A/B/C 三组**

见 Spec §06.4 表格。入口在第三层之后或 `/pv-meter-analysis#lab`，**刻意不在第一层露面**。

B 组五张诊断图**全部必做**，其中**残差 vs 年积日是上线前必做** —— 有稳定年周期 = 模型缺项（季节性遮挡）**不是故障**，不做这个春秋各刷一批假变点。

- [x] **Step 3: snapshot id 一致性断言**

一条断言：第一层的「本月缺口」与工作台逐站缺口求和**分毫不差**，且两处显示的 snapshot id 相同。
破坏验证：让工作台重新跑一次计算 → 这条必须红（对应 Spec §06.4 的铁律）。

---

## Task 13: 卸 PvRoiView 抄表区 + 迁函数

**Files:** Modify `PvRoiView.vue`、`pvRoi.logic.ts`、`pvRoi.logic.spec.ts`

**Interfaces:** Consumes Task 9–12（新屏必须先能用，否则功能中断）。

> **顺序不能提前。** 新屏没上线就先卸旧区 = 中间态里这批分析谁都看不到。

- [x] **Step 1: 四个函数与类型迁到 `pvMeterAna.logic.ts`**

`pvRoi.logic.ts:76-163` 的 `MeterStation` / `MeterReading` / `StationEffRow` / `stationEfficiency` / `EffTrend` / `monthlyEfficiency` / `ConsRow` / `consumptionRows` / `RevRow` / `revenueByStation` 整体搬走。
**先搬再删** —— 搬完跑一次新 spec 绿了，再回来删。

- [x] **Step 2: `pvRoi.logic.spec.ts` 对应断言迁到新 spec**

不是删掉，是**搬过去**。搬完两边都跑。

- [x] **Step 3: `PvRoiView.vue` 删抄表区**

468 行 → 约 230 行。**同时删掉因此变孤儿的 import**（只删你自己改出来的孤儿，不碰既有死代码）。

- [x] **Step 4: 验证**

```bash
cd frontend && npx vitest run src/views/analysis && npm run build
```

`npm run build` 的 vue-tsc 会抓到漏删的 import。

---

## Task 14: PvMeterView 未装表行

**Files:** Modify `src/views/pv/PvMeterView.vue`

**Interfaces:** Consumes Task 1 的 `pv_station.metered`。

- [x] **Step 1: 三样一起改**

`metered=0` 的行：**灰徽标「未装表」+ 容量/单价单元格禁用 + 点行不开抽屉**。三样缺一样都会让人以为「这栋只是漏抄了」。

- [x] **Step 2: 断言**

一条：`metered=0` 的行点击后抽屉**不打开**。破坏验证：去掉不开抽屉的守卫 → 必须红。

> 编辑态/锁的既有形状不动（`docs/design/EDIT-MODE-SPEC.md`、`CONCURRENCY-SPEC.md` §4）。本任务只加只读态的显示分支。

---

## Task 15: 全刀验收（Spec §08 八条）

- [x] **Step 1: 全量跑**

```bash
cd backend && ./mvnw.cmd test
```

```bash
cd frontend && npx vitest run && npm run build
```

**不接管道。** 读完整输出 grep `Tests run` / `ERROR` / `Failed Tests`。

> **落地结论(2026-08-31)**:八条全过。两条在跑的过程中发现规格本身要改 ——
> ④ 的「ρ₁ 非零」对模拟数据不成立且方向反了(见 Spec §08 那条的说明);
> ① 一度过不了,不是检测逻辑错,是**置换分辨率**卡死:B=199 时 p 的下限就是 0.005,
> 而 BH 在 11 个站的族里要求 p ≤ 0.05/11 = 0.00455,**结构上够不到红灯**。
> B 提到 999 + 提前终止 + 变点扫描换前缀和,整屏从 837ms 降到 **103ms**,分辨率反而高了 5 倍。

- [x] **Step 2: 八条验收标准逐条过**

1. **种入故障能被检出** —— F 座 −28% 阶跃判为 risk，变点日期落在 7/18 **±3 周**内（不是 ±3 天）。
2. **健康站不误报** —— 其余站 q=0.05 下无 risk；跑 12 个月全年误报总数 ≤ 1。
3. **逐条破坏验证** —— Task 2–14 每条断言都做过；这里复查最容易假绿的两条护栏。
4. **ACF 诊断有输出** —— 残差 ACF 画得出来且 ρ₁ 非零（ρ₁=0 说明 Task 5 的共享天气因子没生效）。
5. **两层数字一致** —— 随机抽 3 个月，第一层缺口 = 工作台逐站缺口求和，**分毫不差**，snapshot id 相同。
6. **护栏可见** —— 人为删掉某站某月 11 天抄表 → 该站必须是「数据不全」灰灯，**不是**「正常」绿灯。
7. **权限** —— `PermissionCoverageTest` 绿；viewer GET 通、POST `/api/weather/import` 403。
8. **导航与路由计数** —— `fpNav.spec.ts` 50 → 51 三处同步；`routeMap.spec.ts` 绿。

- [x] **Step 3: 上线闸门复查**

回到本文件顶部的「开工闸门」三项。**未过闸不合并到 master**，或合并时保留「当前使用模拟容量」横幅并在 PR 描述里写明。
