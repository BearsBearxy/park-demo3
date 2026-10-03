# 账号与权限规范（RBAC-SPEC）v2

> 状态：**设计定稿，未实现**。2026-08-21 立，同日按「读全开」重写为 v2。
> 配套：[CONCURRENCY-SPEC.md](CONCURRENCY-SPEC.md)（权限决定谁能改，并发决定同时改的人互相不打架）。

---

## 0. 核心模型（v2 一句话）

> ⚠ **2026-10-04 用户拍板推翻了 v2 的拍板 #8「读全开」、#10「无权的屏除股东外一律显示」与 #11「工资全开」**。
> 现行模型是 **v3「读写分开」**，见 [§11](#11-v3读写分开2026-10-04-用户拍板)。
> 本节与 §1 的 #8 / #10 / #11 保留作历史；§2、§3、§4、§5.1、§5.4、§6 里凡是讲「读」的地方，
> 各节开头都标了 v3 改了什么，读的规则一律以 §11 为准。写的规则（§5.2 映射表等）不变。

> ## 读全开，写分权。

| | 规则 |
|---|---|
| **读** | 任何已登录账号，**全站所有数据都能看、都能显示**。零权限判断 |
| **写** | 按 11 个业务模块分权 |
| **唯一例外** | `system`（用户列表、角色配置、操作日志）**读也要管** —— 不能让财务看到所有账号和权限配置 |
| **导航可见性** | **与权限脱钩**，按角色单独配「能看到哪几层」 |

落到界面上就是：**所有人都能进任何屏、看到所有录入的数字和系数；权限只决定「编辑模式」按钮
（以及合同的新增/编辑/续签/终止/删除这类直接写按钮）出不出现。**

### 0.1 为什么 v1 的「读也分权」被推翻

v1 把每个模块做成 `view` / `edit` 两个动作，读也按模块拦。落到这套代码上立刻炸出一串问题：

- 总经理有 `analysis:view` 但没 `meter:view` → 「充电桩分析」整屏加载失败、「光伏投资回收」下半空白、
  上网电价**静默回退种子默认值**（图照画、数字可能不对，最难发现的一种坏）
- 园区股东只有 `analysis:view` → 分析层 15 屏共用的取数层 `anaData.ts` 要调
  `pnlApi` / `reportApi` / `tenantApi` / `contractApi` / `buildingApi` / `pvApi`… 全被拦，账号做出来是空壳
- 分析屏 12 处深链点过去撞墙
- `/api/analysis/*-tenant-months` 本来就返回逐户明细，`view` 的隔离根本不成立

**根因**：分析层是纯只读派生层，它的数据天然来自全站。给读分权 = 给一个只读消费者设上游门禁，
挡住的不是坏人，是它自己。

**而且现有后端本来就是「读全开」**：`SecurityConfig` 那一行就是
`GET = 任意已登录 / 非 GET = ADMIN`。v1 是自作主张加了读的门。
v2 把它去掉，只把后半句的 `hasRole("ADMIN")` 换成模块映射表。

**代价（已拍板接受）**：任何登录账号能读到全站数据，含逐人逐月工资明细
（`salary_record` 有姓名 + 基本/岗位/绩效/全勤/技能/学历/午餐/高温/招商提成逐项）。
拍板 #11：工资也全开，「反正财务本来就在录这张表」，后续读/改的再分配留给客户自己在角色屏配。

---

## 1. 用户拍板记录（2026-08-21）

| # | 问题 | 拍板 |
|---|------|------|
| 1 | 要不要按管理公司隔离数据 | **不做**。所有财务都管全部 6 家。表结构留口子 |
| 2 | 催缴单「生成」算哪一档 | **普通财务**（财务专员）能生成 |
| 3 | 新账号密码怎么给 | 管理员设初始密码 + **首次登录强制改密** |
| 4 | 总经理能不能看台账附表 | **能看**。园区股东**不看** ← 新增「园区股东」角色 |
| 5 | 台账保存改成只提交 dirty 行 | **先不做** |
| 6 | 强制接管门槛 | 见 CONCURRENCY-SPEC §4.3 |
| 7 | 操作历史 | 高权限用户要能看。**接管事件**与**系数修改**必须留存 |
| 8 | 园区股东「不看台账附表」是哪一种 | **导航层隐藏**。v2 下这就是全部含义 —— API 层本就全开。⚠ **v3 推翻**：股东只有 `analysis:view` + `report:view`，台账附表的接口对他 403（§11.2） |
| 9 | 年度预算导入归谁 | **财务**（`entry:edit`） |
| 10 | 无权的屏在导航里显示吗 | **除股东外一律显示**。v2 下点进去看到的是**完整数据**，只是不能改。⚠ **v3 推翻**：没有查看权的屏导航不列，直接打开落「无权查看」页（§11.2） |
| 11 | 读要不要分权 | **不分。全部开放给所有账号可读可显示**，工资明细也全开。后续再分配留给客户自己配。⚠ **v3 推翻**：每模块查看 / 编辑两项，工资单独 `salary:view`（§11） |

---

## 2. 权限点（18 个）

> ⚠ **v3 已改**：加了 9 个查看点，总数 27；`system:view` 不再是「唯一的读权限点」。权威清单见 §11.1 与 `Perm.ALL`。
> 下表是 v2 的 18 个点，含义不变；9 个查看点见 §11.1。

**11 个业务模块的 `edit` + `system:view` + `system:edit` + `lock:takeover` + `elevate:request` + `company:manage` + `book-template:edit` + `book-template:switch` + `review:approve`。**

> 2026-08-22 新增第 14 个 `elevate:request`（ELEVATION-SPEC）。
> 2026-08-24 新增第 15 / 16 个 `company:manage`、`book-template:edit`；2026-08-26 第 17 个 `book-template:switch`。
> 2026-09-03 拍板、R1 落地第 18 个 `review:approve`（SIDEBAR-UX-REDESIGN §7.3）。
> 权威清单是后端 `Perm.ALL`（顺序即角色屏矩阵行序）与 `Perm.META`（矩阵渲染读的是 META，只加 ALL 永远勾不上）。

| 权限点 | 管什么 |
|--------|--------|
| `master:edit` | 楼栋、单元、租户、租户分类、管理公司、收款账户的增删改 |
| `contract:edit` | 合同的**新增 / 编辑 / 续签 / 终止 / 删除**，含计费行（租金单价口径） |
| `param-policy:edit` | 计费口径：常量/规则/户级例外键、公摊规则与配置、电价配置、收款指引、**系数簿** |
| `param-monthly:edit` | 月度计费录入：`paramRegistry` 里 `monthlyCheck=true` 的 **14** 个键 + 复制上月电价。**V104 起不再给财务专员**（电价决定每一户账单，收归主管级；专员每月请主管当场授权一次，见 ELEVATION-SPEC §5.1） |
| `meter-master:edit` | 表档案：表倍率、表↔合同绑定、删表、光伏电站档案、充电桩桩库 |
| `meter-reading:edit` | 抄表读数增删改、导入、按年 simulate。**导入时改已有表的倍率另要 `meter-master:edit`**（2026-10-03 安全审计 F15）：没有的话倍率不改、本行读数按档案倍率记，只给提示 |
| `billing-run:edit` | 公摊生成、损耗、分摊结果、`params/recalc`、催缴单生成、单据备注 |
| `billing-issue:edit` | 催缴单确认、签发、作废、标记已导出、收款公司槽 |
| `entry:edit` | 月度台账、附表 6/7/8/10/11/12（含工资）、办公·三期水电、年度预算导入 |
| `report:edit` | 三大报表、损益附表 1–5、收入核对处置标记 |
| `system:edit` | 用户、角色、日志的管理 |
| `system:view` | **唯一的读权限点**：能不能看到用户列表、角色配置、操作日志 |
| `lock:takeover` | **能授权别人接管**编辑锁（不是能自己接管），见 CONCURRENCY-SPEC §4.3 |
| `elevate:request` | **能不能请主管当场授权**。没有这项的账号（`viewer` / `shareholder`）连编辑模式按钮都看不到，见 ELEVATION-SPEC |
| `review:approve` | **审核通过 / 退回 / 撤销**某张表某个月（SIDEBAR-UX-REDESIGN §7）。交审不设独立权限点 —— 该表的 edit 权即交审权，映射见下面 §2.2。**进 `Perm.NOT_ELEVATABLE`**：审核能当场借 30 分钟的话，录审分离当场作废（录入方可以请主管借一次权把自己刚录的东西审掉） |

`analysis` **没有权限点** —— 分析层是纯只读层。它唯一落库的写是年度预算导入，按拍板 #9 归 `entry:edit`；
另一个「写」是 `anaSettings.ts` 的目标与阈值，存 localStorage 不落库（文件头注释明写）。

### 2.1 四次拆分的理由

| 拆分 | 触发它的事实 |
|------|-------------|
| `param` → `policy` + `monthly` | 拍板 #2 说催缴单生成归专员。~~生成的前置是 14 个 `monthlyCheck` 键 + `recalc`，不拆专员出不了账~~ → **2026-08-22 修正**：拆仍然要拆（两者语义不同），但 `param-monthly` 已不给专员 —— 提权提供了每月一次的授权通道，原来那个「不给他就出不了账」的前提不再成立 |
| `meter` → `master` + `reading` | 表倍率是直接乘进度数的计费系数，表↔合同绑定决定这块表的电算到谁头上 —— 属口径，不是抄表 |
| `billing` → `run` + `issue` | 拍板 #2 只说了「生成」。签发/作废是对外不可逆闸门（生成时已签发单跳过不覆盖，须先作废） |
| `alloc` 归入 `billing-run`，规则归入 `param-policy` | 公共电核算与楼栋损耗两屏在初版划分里**根本没有归属**，而它们含分摊规则增删改 |

---

### 2.2 审核键 kind → 交审权限点（SIDEBAR-UX-REDESIGN §7）

交审不设独立权限点：**该表的 edit 权即交审权**。但「该表的 edit 权」这张表是**新写的一张**，
不是 §5.2 的复用 —— §5.2 是 126 条 **URL 路径 → 权限点**的有序表，而这里要的是
**审核键 kind → 权限点**；两者不同轴，而且那个映射对 `params` 与 `elec-cost` 根本不是函数
（`params` 屏同时含 policy 与 monthly 两档；`/api/elec-cost/price-cfg` 归 param-policy、其余归 entry）。

落点在后端 `security/ReviewKind` 枚举的 `perms()`，满足其一即可（同 `PermissionRegistry` 的 anyOf 语义）：

| kind | 交审要的权限点 | 守卫落在哪个 service |
|---|---|---|
| `params` | `param-policy:edit` **或** `param-monthly:edit` | `ParamService` |
| `meters` | `meter-reading:edit` | `MeterService` |
| `alloc` · `alloc-loss` | `billing-run:edit` | `AllocService` |
| `bill-notices` | `billing-run:edit` | `BillNoticeService` |
| `ledger`（scope=companyId） | `entry:edit` | `LedgerService` |
| `s10`（scope=1..4） | `entry:edit` | `S10Service` |
| `salary` | `entry:edit` | `SalaryService` |
| `utilities`（scope=office\|phase3） | `entry:edit` | **`OfficeService`**（URL `/api/utilities`） |
| `pv` | `entry:edit` | `PvService` |
| `charging-car` · `charging-ebike` | `entry:edit` | `ChargingService`（按 scheduleNo 7/8 分 kind） |
| `elec-cost`（附表11 报送台账） | `entry:edit` | **`ElecService`**（`/api/elec`，表 `elec_record`） |
| `elec-model`（园区电费模型） | `entry:edit` | **`ElecCostService`**（`/api/elec-cost`，表 `elec_cost_entry`） |

`POST /api/review/{key}/submit` 要哪个权限点取决于 key 里的 kind，URL 层判不出来 ——
照 `PUT /api/params` 那条既有例外：URL 层放行「任一相关 edit 权」，真正的 kind→perm 判定下沉到 `ReviewService.submit`。

---

## 3. 角色

预置 6 个系统角色（`builtin=1`，不可删）。客户可在此之上自建。

> ⚠ **v3 已改（V134）**：下表补了 9 个查看点的行；园区股东只有 `analysis:view` + `report:view`，导航层加了账簿与报表；
> 总经理 / 只读 / 园区股东三者**不再相同**。`RoleApiIT.presetRolesMatchSpec` 钉着这张表。

| 权限点 | 系统管理员 | 财务主管 | 财务专员 | 总经理 | 园区股东 | 只读 |
|--------|:---:|:---:|:---:|:---:|:---:|:---:|
| master:edit | ✓ | ✓ | — | — | — | — |
| contract:edit | ✓ | ✓ | — | — | — | — |
| param-policy:edit | ✓ | ✓ | — | — | — | — |
| param-monthly:edit | ✓ | ✓ | **✓** | — | — | — |
| meter-master:edit | ✓ | ✓ | — | — | — | — |
| meter-reading:edit | ✓ | ✓ | **✓** | — | — | — |
| billing-run:edit | ✓ | ✓ | **✓** | — | — | — |
| billing-issue:edit | ✓ | ✓ | — | — | — | — |
| entry:edit | ✓ | ✓ | **✓** | — | — | — |
| report:edit | ✓ | ✓ | **✓** | — | — | — |
| system:view | ✓ | — | — | — | — | — |
| system:edit | ✓ | — | — | — | — | — |
| lock:takeover | ✓ | ✓ | — | — | — | — |
| master:view · contract:view · param:view · meter:view · billing:view · entry:view（v3） | ✓ | ✓ | ✓ | ✓ | — | ✓ |
| salary:view（v3） | ✓ | ✓ | — | — | — | — |
| report:view · analysis:view（v3） | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| **导航可见层** | 全部 | 全部 | 全部 | 全部 | **经营分析、账簿与报表**（v3；v2 是仅经营分析） | 全部 |

> ⚠ 下面这段是 v2 的结论，v3 下不成立：股东少了 6 个模块的查看，总经理多了 `elevate:request`（ELEVATION-SPEC）。
>
> **总经理 / 园区股东 / 只读 三者在权限上完全相同**（一个 `edit` 都没有），
> 差别**只在导航可见层**。这不是设计缺陷，是 v2 模型的直接结果 ——
> 读全开之后，「只能看」的角色之间本来就没有权限差别，差别只在给他看什么入口。

**第 7 个预置角色 `reviewer`「审核员」**（2026-09-03 拍板 D16，R1 的 V124 落库）：只有 `review:approve`，**零 `:edit`、无 `elevate:request`**，`nav_layers='data,reports,analysis'`。V134 起另带 8 个查看点（工资除外）。
上面那张矩阵**六个既有角色一格都不改** —— 尤其财务主管默认**不带**审核权，录审分离靠角色分配保证；
例外是 `admin`，它是「全部权限」角色（V101 起每个新权限点都给它），所以也持有 `review:approve`。
系统不拦「同一账号既录又审」；客户若给主管勾了审核权，录审分离由客户自己负责。

> **⚠ 2026-09-23 修:「零 `:edit`、无 `elevate:request`」把审核员挡在了 15 个屏外面。**
> 屏上那一簇审核按钮(`FPReviewActions`,全站唯一一份)的显示门原来是 `canEdit && ready`,
> 而 `canEdit` 来自 `useEditMode` 的 `canEnter = hasAny(perms) || can('elevate:request')` ——
> 对纯审核员**恒假**。后端三个动作都正确挂在 `review:approve` 上、催缴单屏也把审核键
> (`bill-notices:{ym}`)挂上了,而唯一能审的那个角色登进去一颗审核按钮都看不见。
> 显示门已改成 `canEdit || isReviewer`(判据仍在后端,前端只决定画不画)。
> 断言在 `FPReviewActions.spec.ts`:`canEdit=false` + 只有 `review:approve` → 画「通过 / 退回」;
> `canEdit=false` 且无审核权 → 仍然一颗不画。两条都破坏验证过。

**向后兼容**：现有 `admin` → 系统管理员，`viewer` → 只读。老账号与老 JWT 照常认。

---

## 4. 导航可见性

> ⚠ **v3 已改**：导航是两道门叠在一起 —— 层看 `nav_layers`，屏看这一屏的查看权（`nav/navAccess.ts`）；
> 没有查看权的屏不列，直接打开落「无权查看」页（`views/NoAccessView.vue`）。园区股东的 `nav_layers` 是 `analysis,reports`。

**与权限脱钩**，角色表上单独一列 `nav_layers`，值是可见的业务层（`fpNav.ts` 的 `NavLayer.id` 已有这三个值）：

```
data      数据中心
reports   账簿与报表
analysis  经营分析
```

| 角色 | nav_layers | 效果 |
|------|-----------|------|
| 园区股东 | `['analysis']`（v3：`['analysis','reports']`） | 左边只有「经营分析」一层，另两层的图标按钮不出现（v3：多了账簿与报表） |
| 其余 5 个 | `['data','reports','analysis']` | 全部可见 |

**`system` 层不在这个字段里** —— 它的可见性直接跟 `system:view` 走。没有该权限一律不显示这一层，
不适用「显示但锁」。理由：它不是业务功能，让财务看到「用户管理」入口只会诱导他们去点。
行业惯例同此（GitHub 的 Settings、Odoo 的 Settings 都是无权即不显示）。

客户可在角色权限屏勾选这三个层，**不用改代码**。

> ⚠ v3 下这段不成立：有了「无权查看」页，见 §11.2 规则 8 的前端部分。
>
> v2 下**不需要「无权限」占位页**：能看到的屏都能进、都有完整数据。
> 唯一进不去的是 `system` 层，而它压根不显示，也就点不到。手打 URL 兜底跳首页即可。

---

## 5. 后端强制点

### 5.1 SecurityConfig 改动很小

> ⚠ **v3 已改**：「读段」不再是任何已登录 —— `GET /api/**` 交给 `ReadAccessManager`，查 `PermissionRegistry.registerReads`，
> 默认拒绝（§11.2 规则 2）。系统管理段不再是「唯一读也管的」，只是排在通用读规则前面先命中。

```
放行段（必须在最前，否则容器健康检查拿 401，backend 永远 unhealthy）
   /actuator/health, /actuator/health/**              → 放行
   /swagger-ui/**, /swagger-ui.html, /v3/api-docs/**  → 放行
   /api/auth/login                                    → 放行

系统管理段（唯一读也管的）
   GET     /api/system/**                             → system:view
   非 GET  /api/system/**                             → system:edit
   /actuator/**（health 以外）                         → system:view

读段
   GET /api/**                                        → v3：ReadAccessManager 查读规则表，默认拒绝（v2 是任何已登录）

写段
   非 GET /api/**                                     → 按 §5.2 映射表
```

把现在那一行 `非 GET → hasRole("ADMIN")` 换成映射表，**就是全部改动**。

### 5.2 写端点映射表（126 条，有序）

#### 三条匹配铁律

1. **按 path segment 匹配，不是字符串前缀。** 用 Spring 的 `PathPattern`（`/api/elec/**` 不会命中 `/api/elec-cost`）。
   若实现成 `startsWith("/api/elec")`，`PUT /api/elec-cost/price-cfg` 会落到 `entry:edit` —— 录入员直接拿到四个电价键的写权限。
   同型隐患：`/api/pv` ⊂ `/api/pv-meter`、`/api/bills` 与 `/api/bill-notices`、`/api/salary/import` 与 `/api/salary/imported`。
2. **最长字面前缀优先。** `DELETE /api/s10/imported` 必须排在 `DELETE /api/s10/{id}` 之前，否则被模板规则吃掉。
3. **默认拒绝。** 表里没有的写路径一律 403。

#### 表（从上到下首个命中生效）

```
# ═══ 任意已登录可写 ═══
   POST /api/import-log                          → 任意已登录     ★见 §5.3-⑦

# ═══ 例外段（必须排在各自 controller 的默认规则之前）═══
   /api/alloc/rules/**                           → param-policy
   /api/alloc/cfg                                → param-policy
   /api/alloc/**                                 → billing-run
   POST /api/params/recalc                       → billing-run    ★见 §5.3-①
   /api/params/**, /api/price-cfg/**             → param-policy
       └ 例外：group='monthly' 的 13 个键的 PUT  → param-monthly  ★见 §5.3-②
   /api/elec-cost/price-cfg                      → param-policy
   POST /api/elec-cost/simulate                  → param-policy   ★见 §5.3-③
   /api/elec-cost/**                             → entry
   /api/bills/paymap                             → billing-issue
   /api/bill-notices/confirm                     → billing-issue
   /api/bill-notices/mark-exported               → billing-issue
   /api/bill-notices/{id}/issue                  → billing-issue
   /api/bill-notices/{id}/void                   → billing-issue
   /api/bill-notices/**                          → billing-run
   /api/meters/readings/**                       → meter-reading   ★见 §5.3-④
   POST /api/meters/import                       → meter-reading   ★抄表导入,必须排在下一行之前
   /api/meters/**                                → meter-master
   /api/pv-meter/stations/**                     → meter-master
   POST /api/pv-meter/simulate                   → meter-master   ★见 §5.3-⑤
   /api/pv-meter/**                              → meter-reading
   /api/cp-meter/stations/**                     → meter-master
   POST /api/cp-meter/simulate                   → billing-run    ★见 §5.3-⑥
   /api/cp-meter/**                              → meter-reading
   POST /api/budget/import                       → entry          ★拍板 #9

# ═══ 审核（SIDEBAR-UX-REDESIGN §7.3）═══
# submit 的权限点看 key 里的 kind,URL 层判不出来 —— 放行「任一相关 edit 权」,细分下沉 ReviewService
POST /api/review/*/submit    → param-policy | param-monthly | meter-reading | billing-run | entry
POST /api/review/*/approve   → review:approve
POST /api/review/*/return    → review:approve
POST /api/review/*/withdraw  → review:approve
POST /api/review/*/recall    → 同 submit（录入方撤自己交的，本人判定下沉 ReviewService）
# GET /api/review 不登记 —— 本表只管非 GET,读全开

# ═══ 默认段（单模块 controller）═══
   /api/buildings/**, /api/units/**, /api/tenants/**,
   /api/tenant-categories/**, /api/companies/**,
   /api/company-accounts/**                      → master
   /api/contracts/**                             → contract
   /api/ledger/**, /api/s10/**, /api/pv/**,
   /api/charging/**, /api/elec/**, /api/salary/**,
   /api/utilities/**                             → entry
   /api/reports/**, /api/pnl/**, /api/recon/**   → report
```

> 相比 v1 要覆盖 221 条，v2 只需覆盖 **126 个写端点**。v1 那 22 个前缀陷阱里，
> 纯 GET 的那批（`/charging/{no}/cats`、`/elec/phases`、`/elec-cost/metrics-year`、
> `/tenants/summary` vs `/tenants/{id}`、`/api/pnl` vs `/api/pv` 的读侧）**全部不用管了**。

### 5.3 七条例外的依据（逐条查证过，非推测）

① **`POST /api/params/recalc` 归 `billing-run`。**
`ParamService.recalc()` 内部就是 `alloc.generate(ym)` + `billNotice.generate(ym)`，
不写任何参数表，落的是 `alloc_pool_result` / `alloc_loss_result` / `bill_notice`。
语义与 `/alloc/generate` 完全同级。按 controller 归 `param` 会让专员重算不了，出账链断在这一步。

② **月度键（`monthlyCheck=true`，现为 14 个）的 PUT 归 `param-monthly`。**
键清单以 `ParamRegistry` 里 `monthlyCheck=true` 为准，与前端 ① 区的 `Group.MONTHLY` 分组
**一一对应**（`ParamPermissionSplitTest` 钉死；不对齐就会出现「界面有按钮点下去 403」或
「界面藏了按钮 API 却放行」）。后端按 `cfg_key` 判 —— 要看请求体的规则之一（另见：抄表导入改已有表倍率要 `meter-master:edit`，`MeterService.importRows` 按行判，2026-10-03 安全审计 F15）。

> ⚠ **2026-08-22 修复**：这条规则此前**只写在注释里没有实现**。`PermissionRegistry` 给
> `PUT /api/params` 登记的是「policy 或 monthly 任一」，而 `ParamService` 里没有细分判定 ——
> 只有 `param-monthly:edit` 的财务专员绕开前端直接调 API 就能改**任何一个计费口径键**。
> 前端把按钮藏了，后端的门是开的。现由 `PermissionGuard` 在 `ParamService.write()` 里落实。

④ **`POST /api/price-cfg/copy`（复制上月电价）归 `param-monthly`，不是 `param-policy`。**
它只搬 `ELEC_KEYS` 六个月变电价键，是月度录入的活。挂 policy 的话财务专员在计费参数页
① 区看得到按钮、点下去 403 —— 而那正是他每月的活。必须排在 `/api/price-cfg/**` 之前。

③ **`POST /api/elec-cost/simulate` 必须提到 `param-policy`。**
`ElecCostService.insertCfgIfAbsent()`（第 387–398 行）被 simulate 调用，
对缺配置的月份直接 `insert` `third_party_price` 与 `grid_posted_price`。
只收紧 `PUT /elec-cost/price-cfg` 而放开 simulate，`param` 门形同虚设。
> 替代方案：删掉 `insertCfgIfAbsent`，缺电价就在结果里报 missing。二选一，不能都不做。

④ **`DELETE /api/meters/readings` 留在 `meter-reading:edit`，但爆炸半径要知道。**
默认 `cascade=true` + `dropEmptyMeters=true`，会顺手删该月
`alloc_pool_result` / `alloc_pool_meter_result` / `alloc_loss_result` / `alloc_result` 派生快照并删空表档案。

判给抄表员是**刻意的**：「导错了→删本月读数→重导」是他自己的闭环，收到主管那里会让他每次重导都得找人。
而且读数变了、派生结果本就该失效，级联是对的；`dropEmptyMeters` 只清那些删完一条读数都不剩的表。

> 2026-08-21 修正：本条原文写「留在 meter-master」，与 §5.2 映射表的顺序
> （`/api/meters/readings/**` 排在 `/api/meters/**` 之前）相矛盾。以映射表为准 ——
> 若按原文特判成 master，专员会看得见按钮、点下去吃 403。

⑤ **`POST /api/pv-meter/simulate` 是电站单价的写旁路。**
`PvMeterService` 第 204–208 行：单价为空的电站，simulate 会按附表6 反推写入 `price_yuan`，
此后每条 `pv_reading` 的 `price_snap` 都快照这个值。与 ③ 同型。

⑥ **`POST /api/cp-meter/simulate` 归 `billing-run`。**
它读附表7/8 整年批量派生写入 `cp_reading` + `cp_power_usage`，等同「跑一次出结果」，
与逐条 readings 写差一个量级。

⑦ **`POST /api/import-log` 必须任意已登录可写。**
`frontend/src/utils/importRegistry.ts` 在每次导入成功后统一调它，**9 个导入屏共用**。
若挂 `entry:edit`，只有 `meter-reading:edit` 的人导完表会被 403 —— 而前端是
`catch { console.warn('记录失败(不影响导入)') }` 吞掉的，**用户毫无感知，审计痕迹静默丢失**。

### 5.4 覆盖率测试（本规范最重要的一条）

```
扫描所有 @RequestMapping 方法 → 筛出非 GET → 断言每一条都被映射表覆盖 → 未覆盖即测试红
```

半年后新加写接口忘了配权限，它当场拦你。**默认拒绝，不是放行。**

同时钉死这几条回归断言（都是 §5.2 铁律 1/2 会踩的）：

```
PUT    /api/elec-cost/price-cfg → param-policy   （不得落 entry）
非GET  /api/pv-meter/**         → meter-*        （不得落 entry）
PUT    /api/bills/paymap        → billing-issue  （不得落 billing-run）
DELETE /api/salary/imported     ≠ POST /api/salary/import 的规则
匿名   GET /actuator/health     → 200            （容器健康检查）
GET    /api/salary/**（没有 salary:view 的账号，含只有分析 / 报表查看的股东）→ 403
GET    分析白名单里的模块接口（只有 analysis:view 的账号）→ 200
```

> ⚠ **v3 改写了最后两条**：v2 钉的是「零 edit 账号读台账与工资 → 200」（读全开）。v3 推翻读全开，
> 改钉「工资只认 salary:view」与「分析独立放行」—— 后一条守的正是 v1 的失败（分析层被各模块查看权拦成空壳）。
> 落点：`ReadPermissionIT.shareholder_readsAnalysisAndItsWhitelist_butNotModuleDetailOrSalary`、
> `PermissionCoverageTest.everyReadEndpointIsMapped`（读端点也逐条覆盖，§11.3）。

### 5.5 权限解析：内存缓存，不烤进 JWT

JWT 有效期 120 分钟。权限烤进令牌 → 停用一个人他还能再用两小时。

做法：JWT 只带用户名；后端一个 `Map<username, Set<perm>>` 全量装内存（账号几十行），
任何用户/角色写操作后刷新。每请求零 DB 查询，改完立刻生效，停用立刻踢。

### 5.6 已知的越权旁路（不是权限表能解决的，要改 service）

| 旁路 | 事实 | 修法 |
|------|------|------|
| 台账屏能建租户、建/删公司 | `LedgerView.vue:166` `companyApi.remove`、`:177` `companyApi.create`、`:334` `tenantApi.create` | 这三个按钮按 `master:edit` 判；台账导入遇未登记租户时，无权者只给「跳过/关联已有」，不给「新建档案」 |
| 删公司级联毁 entry + report | `CompanyService.delete` 同事务删 `monthly_ledger` + `report_amount` + `report_custom_row` + `report_account` | **加 service 守卫**：该公司存在台账/报表数据则 409，要求先清空。不发明新权限档 —— 这是缺守卫不是缺权限 |
| 报表导入会静默建公司 | `ReportService.createCompany` 由 `importRows` 在遇到库里没有的公司名时调用 | 改成未匹配即报错并返回未匹配名单。**2026-10-03 已修**（安全审计 F16）：未匹配的段报错跳过，`createCompany` 已删 |
| 单元面积是计费口径却只要 `master:edit` | `unit.area` 同时是 `per_sqm_month` 租金的面积来源与 area 法公摊池的分摊基数 | 面积改动写一条变更日志（§7）。**「面积污染」已经炸过一次**，见 `demo3_s15_fixes` |
| 导入中心是全域写入口 | `importRegistry.ts` 16 类导入含 `billingTerms`（合同计费行）、`contractFull`（不在册的自动建档）、报表、预算 | 权限挂在 **import kind** 上而非导入中心这个屏：给 `ImportTypeEntry` 加 `module` 字段，`ImportCenterView` 按角色过滤磁贴 |

---

## 6. 前端改造点

> ⚠ **v3 已改**：前端也判 view —— 导航与搜索按查看权过滤、router 守卫把没有查看权的屏送到「无权查看」页、
> 跨屏深链没有目标屏查看权时置灰写原因（`composables/useViewGate.ts`）。下表 `router/index.ts` 那行「只加 system 段的守卫」已不成立。
>
> v2 下前端**只判 `edit`**。没有 view 守卫、没有无权限页、没有深链拦截 —— 全都随读全开一起消失了。

| 落点 | 改什么 |
|------|--------|
| `stores/auth.ts` | 加 `permissions` ref（双轨存储口径同 token）+ `can(key)`（内部用 Set）。`isReadonly` 保留，退化成 `permissions.length === 0`。**2026-09-07（P5）加** `roleNames`（后端 `auth_role.name`，双轨同口径）+ `roleLabel`（有真名显真名，无则按权限派生并标「（派生）」）+ `landing` |
| **`api/index.ts:35`** | ⚠ **本次改造唯一的真实安全洞**：401 拦截器有自己一份清理列表 `['token','displayName','role']`。不加 `'permissions'`，token 过期后权限数组留在 storage 里，同一台机器下一个人登录会继承前一个人的权限 |
| `nav/fpNav.ts` | **零改动**。`NavLayer.id` 已有 `data`/`reports`/`analysis`，导航过滤直接用它匹配角色的 `nav_layers`，不需要给每个屏加字段 |
| `SidebarPanel.vue` / `IconRail.vue:50` | 按 `nav_layers` 过滤层；`system` 层按 `system:view` |
| `paletteFilter.ts` | 同口径：不可见层的屏不进命令面板 |
| `router/index.ts` | **只加 `system` 段的守卫**，其余 47 屏零改动。登录落地页按角色。**2026-09-07（P5）改**：落地页判据从「看得见哪几层」扩成「这个人进来干什么」—— 零 `:edit`（总经理 / 股东 / 只读账号）落 `/cockpit`，`review:approve` 且有 data 层落 `/data-home`，其余沿用三档。四个判据收在 `auth.landing` 一个 computed 里，router 四处 + `LoginView` + `ChangePasswordView` 共六处全读它 |
| 有编辑模式的 19 屏 | 「编辑模式」按钮的 `v-if` 从 `!auth.isReadonly` 换成对应模块的 `can('xxx:edit')` |
| 无编辑模式的屏 | 合同（新增/编辑/续签/终止/删除）、租户、楼栋 —— 各写按钮直接判 `contract:edit` / `master:edit` |
| `PoolLedgerView.vue:58` | `canEdit` 一个开关同时开两扇门。拆 `canGen = can('billing-run:edit')` + `canCfg = can('param-policy:edit')`。「生成本月」判前者，「新增/编辑/删除池」判后者。⚠ 本屏**没有**行内 `paramsApi.put`：分摊基数/加减度数两列是只读镜像，点格子深链去计费参数页改 |
| `BillNoticesView.vue:64` | `canWrite` 同时管生成、确认、收款槽、备注。拆 `canRun` + `canIssue` |
| `CoefBookWindow.vue:37` | ⚠ 系数簿的开关**不能**用催缴单页的 `canEdit`（那是 `billing` 直通 `param`）。改取 `param-policy:edit`。**无权时窗口照常打开、所有系数照常显示，只是没有编辑模式按钮** —— 拍板 #11 的原话 |
| `ParamCenterView.vue` | ①区（月度键）判 `param-monthly:edit`，②③④区判 `param-policy:edit`，「重算本月」判 `billing-run:edit` |
| `MeterDetailDrawer.vue` | 档案字段（倍率/绑定/删表）判 `meter-master:edit`，读数表判 `meter-reading:edit` |

---

## 7. 操作日志

**三层日志，一个统一时间线页。** 不合并进一张通用表 —— `param_change_log` 的
`old_value/new_value/cfg_key` 是专用字段，合并就得塞 JSON，历史页反而难查。
市面同样分开（Odoo 的 tracking vs logging、Jira 的 issue history vs audit log）。

| 表 | 状态 | 装什么 |
|----|------|--------|
| `param_change_log` | **已有**（V96） | 计费参数与公摊配置变更，带 `actor` / `old_value` / `new_value` / `action` |
| `import_log` | **已有**（V20） | 导入记录，带 `operator` |
| `auth_audit_log` | **已有**（V102） | 账号与角色变更、**编辑锁接管**（记接管人 + 授权人两个）、强制解锁、密码重置、登录锁定 |
| `review_log` | **新建**（V124） | 审核动作留痕：`submit` / `approve` / `return` / `withdraw`，带 `review_key` 与理由。**无 `authorizer` 列** —— 审核不走提权（`review:approve` 在不可提权名单里），没有「代他人执行」这回事，union 时写 `NULL AS authorizer` |

统一时间线页放在 `系统管理 → 操作日志`：**四张表** union 后按时间倒序，可按类型 / 操作人 / 时间筛。
后端落点 `AuditQueryMapper.BRANCHES`（每个分支必须写全列别名，否则单源查询「Unknown column」500）+ `SystemService.auditLogs()` 的来源白名单 + `actors()` 的 UNION。

**前端落点四处**（R2 已补，2026-09-07）：`SystemLogsView.vue` 的 `SRC` 色表 / `ACTION` 人话字典 / `SRC_OPTS` 筛选项，加 `types/system.ts` 的 `AuditSource` 联合类型。
四处都补齐才算接上 —— `SRC` 有 `OTHER` 兜底，漏了不会崩，但一屏审计日志上写着「其他 / approve」等于「不知道这是什么」。
`review` 的徽标 tone 用 `slate`（`BadgeTone` 没有 green 档，为一行日志给 `ds/Badge` 加一档色不划算）；左侧圆点的 color 是自由值，那里给绿，与「已审核」在清单上的色同源。

### 7.1 必须补的留痕缺口

⚠ **系数簿现在半边有痕半边没有**：

| 系数簿里的操作 | 端点 | 现状 |
|---------------|------|------|
| 改管理费 | `PUT /params` | ✅ 落 `param_change_log` |
| 改层份 | `PUT /alloc/rules/{id}` | ❌ **完全没有** |

`AllocService.updateRule()`（第 548–558 行）一行日志都没写，
而且 `ruleMembers.deleteByRuleMonth` + `saveChildren` 是先删后插 —— 层份改了之后旧值查不回来。

**必须补**：`updateRule` / `createRule` / `deleteRule` 写 `param_change_log`（`tbl='alloc'`）。
拍板 #7 点名的「编辑系数要留存记录」指的就是这里。同样待补：`unit.area` 变更（§5.6 已列）。

---

## 8. 数据库

| 表 | 内容 |
|----|------|
| `auth_role` | `code` · `name` · `builtin`（系统角色不可删）· `nav_layers`（JSON，见 §4）· `remark` |
| `auth_role_perm` | `role_id` × `perm`（如 `param-policy:edit`） |
| `auth_user_role` | `user_id` × `role_id`，**多对多**（现实里有「主管兼管理员」） |
| `auth_audit_log` | 见 §7 |
| `auth_user` 增列 | `must_change_password TINYINT`（拍板 #3） |

`auth_user.role` 老字段保留不动，迁移时按它给老账号挂新角色。老代码路径不受影响。

**账号只做停用不做删除。** 删掉的账号名下有导入记录、系数簿修改历史、审核痕迹，
真删了这些记录成孤儿，追责链断掉。停用 = 立刻登不进来、已登录的下一个请求被踢，历史里名字还在。

---

## 9. 明确不采纳的审计建议

| 建议 | 不采纳的理由 |
|------|-------------|
| 拆 `report-struct`（报表科目结构） | 用户需求里没有这条区分。科目结构本来就是报表岗的事 |
| 新增 `master:purge`（删公司） | 删公司级联毁数据是 **service 缺守卫**，不是缺权限档。见 §5.6 |
| 拆 `entry:purge`（整月清空导入行） | 同上，属操作确认问题不是权限分级问题。整月清空前弹影响行数确认即可 |
| 给分析层做 `*-agg` 聚合端点以防逐户明细泄漏 | v2 读全开，逐户明细本就人人可见，此建议失去前提 |

---

## 10. 分期

| 期 | 内容 |
|----|------|
| **P0** | 建表 · 灌 6 个预置角色 · **126 条写端点映射表** + 覆盖率测试 + 6 条回归断言 · 内存权限缓存 · 前端 `can()` 替换 `isReadonly`（含 `api/index.ts` 那个洞）· §5.6 五条 service 守卫 |
| **P1** ✅ | 2026-08-22 完成。第 4 层「系统管理」+ 用户管理屏 + 角色权限矩阵屏 + 首次强制改密 + `V102` 审计表与写入 |
| **P2** ✅ | 2026-08-22 完成。操作日志统一时间线（三表 union）+ §7.1 两个留痕缺口 |

### 10.2 P2 实施记录（2026-08-22）

`GET /api/system/logs?src=&actor=&from=&to=&page=&size=` —— 三张来源表 UNION 后按时间倒序。
**分页与筛选都在 SQL 里做**：`param_change_log` 随每次改参数增长，全捞进内存再切正是
`QueryHygieneTest` 防的那种「返回行数只涨不跌」。

写这段 union SQL 踩到两个坑，都被 `AuditLogApiIT` 抓到了，值得记下来：

1. **每个分支都要写全列别名。** UNION 的结果列名取自**第一个** SELECT ——
   只在 param 分支写别名的话，`src=import` 单独跑时外层 `ORDER BY u.ts` 直接
   「Unknown column」500。别名不是美观问题。
2. **ORDER BY 必须是全序。** 只按 `(ts, source)` 排不够：种子日志是批量插的，
   一秒里几十行，MySQL 对并列行的顺序不保证 —— LIMIT/OFFSET 翻页时同一行可能
   在两页都出现、另一行谁也见不着。所以带上来源表 id 做末位键。

两个留痕缺口都补了，而且测试断言的是**旧值有没有被留住**，不是"写了一条"：

| 缺口 | 补法 |
|------|------|
| 公摊规则（系数簿改层份走这条） | `createRule`/`updateRule`/`deleteRule` 写 `param_change_log`（`scope=rule:{id}`）。⚠ `updateRule` 内部是 `deleteByRuleMonth` + `saveChildren`，**旧成员数必须在删之前抓**，否则再也查不回来 |
| 单元面积 | `updateUnit` 面积变化时写 `param_change_log`（`scope=unit:{id}`，`cfg_key=area`，走 old/new 两列）。`unit.area` 同时是 `per_sqm_month` 租金的面积来源与 area 法公摊的分摊基数 —— 「面积污染」已经炸过一次。面积没变则不写，免得日志被噪声淹掉 |

**留下的**：改密后旧令牌不失效（内网 + 令牌 2 小时过期；要做需引入令牌版本号）。

### 10.1 P1 实施记录（2026-08-22）

后端：`SystemService` / `SystemController`（`/api/system/**`）· `AuditLogService` · `V102__audit_log.sql` ·
`Perm.META`（13 个权限点的人话名，前端不硬编码）· `SystemApiIT` 10 条。
前端：`fpNav` 第 4 层 · `SystemUsersView` · `SystemRolesView` · `ChangePasswordView` + 强制改密守卫。

**⚠ 每个写方法收尾必须 `cache.reload()`。** 不刷新的话新建账号登得进但每个请求都 401
（缓存里没它），且没有任何报错指向真正原因。dev 上实测过，`SystemApiIT.newUserIsUsableImmediately` 钉住了它。

**自锁防护三条**（`SystemService.guardSelf*`）：不能停用自己、不能改自己的角色、
不能把自己的 `system:edit` 摘掉。这个系统没有第二条进门的路，锁了只能去数据库手改。

**实施中修正的三处**：
- `builtin` 契约写的是 `=1`、实现是 Java `boolean` → JSON `true`，前端按 number 判导致
  6 个预置角色全被归进「自定义」还显示了删除按钮。已统一 `boolean`，两个 spec 的 fixture 同步
  （用 `1/0` 的 mock 正是测试没抓到它的原因）。
- 路由未拦 system 层，手打地址能进到「后端 403、页面只剩报错」的屏。已补守卫，只拦
  `meta.layer === 'system'`，其余 47 屏刻意不拦（读全开）。
- 通用 403 文案「不能修改…可查看」对 system 段是**反的** —— 被拦的人恰恰不该看到账号与角色配置。
  已单独文案并加断言。
- `landingPath()` 补第三档：只有 `system:view`、无任何业务层的自建角色原本会落到没有入口的屏。

**待定**：改密后旧令牌不失效（内网 + 令牌 2 小时过期；要做需引入令牌版本号）。

P0 做完权限已真在管用，只是还得用 SQL 加人。P1 做完客户彻底不用碰代码。

---

## 11. v3：读写分开（2026-10-04 用户拍板）

> 用户原话：「可以做成读跟改分开的两个选项权限吗」。推翻 v2 拍板 #8（读全开）与 #11（工资全开）。

### 11.1 模型

**每个模块「查看 / 编辑」两项，编辑包含查看。** 新增 9 个查看点（`Perm` 常量 → 值），权限点总数 18 → 27：

| 常量 | 值 | 模块 | 被谁隐含 |
|---|---|---|---|
| `MASTER_VIEW` | `master:view` | 主数据：楼栋、单元、租户、租户分类、公司与收款账户 | `master:edit`、`company:manage` |
| `CONTRACT_VIEW` | `contract:view` | 合同 | `contract:edit` |
| `PARAM_VIEW` | `param:view` | 计费参数：计费口径、月度电价、公摊规则、电价配置、系数簿 | `param-policy:edit`、`param-monthly:edit` |
| `METER_VIEW` | `meter:view` | 抄表：园区抄表、光伏分栋、充电桩 | `meter-master:edit`、`meter-reading:edit` |
| `BILLING_VIEW` | `billing:view` | 出账与催缴单：公共电核算/公摊、账单、催缴单 | `billing-run:edit`、`billing-issue:edit` |
| `ENTRY_VIEW` | `entry:view` | 台账与附表：月度台账、附表 6/7/8/10/11/12、办公水电、预算、电费成本；**不含工资** | `entry:edit`、`book-template:edit`、`book-template:switch` |
| `SALARY_VIEW` | `salary:view` | 工资 | **无**（`entry:edit` 不隐含） |
| `REPORT_VIEW` | `report:view` | 报表：三大报表、损益附表、收入核对 | `report:edit` |
| `ANALYSIS_VIEW` | `analysis:view` | 经营分析层 | **无** |

`system:view` / `system:edit` 不动；按同一条规则，`system:edit` 隐含 `system:view`（见 §11.6 第 4 条）。

**分组（`Perm.Meta.group` / `kind`）**，`/api/auth/perms` 与 `/api/system/perms` 原样返回，前端不硬编码权限点：
模块键固定为 `master contract param meter billing entry salary report analysis system other`，
`kind` 取 `view | edit | other`。每个业务组恰好一个 `view`，「编辑隐含查看」就是从这里推出来的（`Perm.IMPLIED_VIEW`）。

- `book-template:edit` / `book-template:switch` 归 **entry**：账册清单与模板版本链（`/api/books/**`）只有月度台账、附表10、
  导入中心与模板面板用，都是录入岗的屏。
- `review:approve`、`lock:takeover`、`elevate:request` 归 **other**（`kind=other`）：跨模块，不隐含任何查看。

### 11.2 规则

1. **编辑隐含查看**：`UserPermissionCache` 装载快照时把隐含的 view 并进 perms（`Perm.withImplied`），**不落库**。
   后端判定（authorities）、`/auth/me`、登录回包拿到的都是展开后的集合；角色屏存的仍是勾选的原样。
   角色屏勾编辑自动勾查看、取消查看连带取消该模块的编辑（前端做）。
2. **读也默认拒绝**：`SecurityConfig` 里 `GET /api/**` 走 `ReadAccessManager`（形状照 `WriteAccessManager`），
   查 `PermissionRegistry.registerReads` 的读规则表 —— 同样按 `PathPattern`、首个命中生效、最长字面前缀在前；
   表里没有的 GET 一律 403。`/api/system/**` 与 `/actuator/**` 的现有规则不变（排在前面先命中）。
   GET 被拒的 403 文案写明缺哪一项、去找系统管理员（`ReadAccessManager.deniedMessage`），不再套写被拒那句「可查看」。
3. **任何已登录都能读的**只限身份 / 会话 / 协作基础设施与不含业务数据的字典，**逐条精确登记、不用 `/**` 通配**：
   `/api/auth/` 下 `me` `perms` `elevate` `approvals` `approvals/candidates`；`/api/notices` 与 `/api/notices/system-seen`；
   `/api/review` 与 `/api/review/` 下 `states` `closed-months` `pending` `returned`；`/api/zones`；`/api/probe/ok` `/api/probe/boom`。
   通配的话，这几个前缀下以后新加一个返回全员数据的 GET 会悄悄对所有账号开放、覆盖测试照绿；
   逐条登记后新路径落默认拒绝，`everyReadEndpointIsMapped` 当场红，审过回包再登记。
   可批人 `approvals/candidates` 遇到不可提权的点直接 403（`ApprovalService.requireElevatable`），
   否则它就是「谁有 `salary:view`」的花名册。
   （`/api/presence/**`、`/api/locks/**` 没有 GET 端点，不登记。）
4. **分析独立**：`analysis:view` 放行 `/api/analysis/**`，以及分析层前端实际调用到的各模块读接口（白名单见 §11.3），
   这些接口的读规则是「模块 view 或 analysis:view 任一」。**工资明细不对 `analysis:view` 放行**：
   分析层一次都没调 `/api/salary/**`，只用损益附表5 与资产负债表里的汇总行。
5. **敏感字段服务端打码**（`SensitiveMask`）：调用者没有字段所属模块的 view 时，回包给掩码，前端不靠隐藏。见 §11.4。
6. **查看不可提权**：全部 `*:view` 进 `Perm.NOT_ELEVATABLE`；`ReadAccessManager` 不查 `ElevationStore`。
   借得到的话「工资只给两个人看」就成了一句话的事 —— 请主管授权 30 分钟，整年工资就导走了。
7. **迁移 V134**（`V134__rbac_view_perms.sql`，幂等）：除园区股东外的每个角色（内置与自建）勾上 8 个查看点（工资除外）；
   `salary:view` 只给 `admin` 与 `finance_manager`；`shareholder` 只给 `analysis:view` + `report:view`，
   `nav_layers` 设为 `'analysis,reports'`；第 ④ 段把 V101 / V124 种的角色备注里 V134 之后不成立的几句改掉
   （股东「导航只有经营分析」、审核员「只有 review:approve」、总经理 / 只读「导航全部可见」），只改没被客户动过的原句。

### 11.3 读规则表（从上到下首个命中生效）

跨模块读一律按「**本模块 view ∪ 实际调用它的屏所属模块的 view**」放行。「数据层任一」= master / contract / param /
meter / billing / entry / salary 任一 view（`/data-home` 的路由门）。

| 路径 | 放行（任一） | 理由 |
|---|---|---|
| `/api/auth/me` `/perms` `/elevate` `/approvals` `/approvals/candidates`、`/api/notices` `/system-seen`、`/api/review` `/states` `/closed-months` `/pending` `/returned`、`/api/zones`、`/api/probe/ok` `/boom` | 任何已登录 | 规则 3，逐条精确登记 |
| `/api/system/**` | system:view | 与 SecurityConfig 那一行同值；登记在这里是为了覆盖测试不开豁免名单 |
| `/api/analysis/**` | analysis | 分析专用：months、s10-tenant-months、ledger-tenant-months |
| `/api/tenants/summary` | master · analysis | 租户 KPI，驾驶舱的 Promise.all 无 catch。排在 `/{id}` 前 |
| `/api/tenants/{id}` | master | 租户详情只有主数据屏用 |
| `/api/tenants` | master · contract · param · meter · billing · entry · analysis | 跨模块字典（合同新建无 catch、抄表导入预取、台账对户、分析五屏）。电话 / 姓名打码；aliases 只对没有任何数据层查看的人打码（见 §11.4）；户名、remark 不打码 |
| `/api/tenant-categories` | master | |
| `/api/buildings/summary` | master · analysis | 排在 `/{id}` 前 |
| `/api/buildings/{id}` | master · contract | 合同新建逐栋取单元 |
| `/api/buildings` | master · contract · param · meter · billing · analysis | 跨模块楼栋字典，不含个人信息 |
| `/api/companies` | master · billing · entry · report · analysis | 台账公司选择器、三大报表（无 catch）、催缴单收款簿、分析只用公司名。账号与个人卡户名打码 |
| `/api/contracts/summary` | contract · analysis | 驾驶舱无 catch。排在 `/{id}` 前 |
| `/api/contracts/{id}/terminate-preview` | contract | 终止确认框 |
| `/api/contracts/{id}` | contract · analysis | TenantPeerView 只用 billingLines；租户快照里的联系人打码 |
| `/api/contracts` | contract · billing · analysis | 催缴单对租户与合同；分析四屏 |
| `/api/params/status` | 数据层任一 | 出账链矩阵 billingPeriod.ts 加载，不含金额。排在 `/**` 前 |
| `/api/params` | param · billing · analysis | 核算 / 损耗 / 系数簿读系数；PvMeterAnaView 取 6 个 pv_* 判据键 |
| `/api/params/**` `/api/price-cfg` | param | |
| `/api/alloc/rules` | param · billing | 公摊规则归计费参数，核算与系数簿要读。排在 `/api/alloc/**` 前 |
| `/api/alloc/cfg` | param | |
| `/api/alloc/pool-months` `/loss-months`、`/api/bill-notices/months`、`/api/meters/months` | 数据层任一 | 出账链月索引，billingPeriod.ts:91 的 Promise.all 无 catch，少一条整屏「出账月数据加载失败」 |
| `/api/alloc/**` `/api/bill-notices/**` `/api/bills/**` | billing | |
| `/api/data-home/**` | 数据层任一 | 本月出账枢纽；催缴单那一步的金额另按 billing:view 去掉 |
| `/api/meters/{id}/readings` | meter · billing | 核算看池内各表读数。三段，吞不掉 `readings/delete-preview` |
| `/api/meters` | meter · billing · param | 核算与计费参数的表列 |
| `/api/meters/**` | meter | |
| `/api/pv-meter/stations` `/readings` | meter · analysis | PvMeterAnaView |
| `/api/pv-meter/**` `/api/cp-meter/months` | meter | |
| `/api/cp-meter/**` | meter · analysis | ChargingAnalysisView 四个都调 |
| `/api/elec-cost/price-cfg` | param · entry · analysis | 4 个电价键归计费参数；ElecAnalysisView 12 个月一个 Promise.all 无 catch。排在 `/**` 前 |
| `/api/elec-cost/meters` `/entries` `/metrics-year` | entry · analysis | |
| `/api/elec-cost/**` | entry | |
| `/api/budget/all` | entry · analysis | 预算归 entry（拍板 #9），读方只有分析层 |
| `/api/books/**` `/api/ledger/**` `/api/s10/overview` | entry | 分析走 `/api/analysis/ledger-tenant-months`，不直接读台账 |
| `/api/s10/**` | entry · report | 报表屏勾稽与派生对照 |
| `/api/pv/records` `/api/charging/*/records` `/api/elec/records` `/api/utilities/*/records` | entry · report · analysis | 逐月台账；报表 pnlDerive 派生对照、分析白名单 |
| `/api/pv/**` | entry · analysis | |
| `/api/charging/**` `/api/elec/**` `/api/utilities/**` | entry | |
| `/api/import-log/**` | 数据层任一 · report | 导入中心历史：文件名、行数、操作人，不含金额 |
| `/api/salary/**` | **salary** | 不对 analysis / report 放行 |
| `/api/pnl/*/overview` | report | 分析不调。排在 `/*/*` 前 |
| `/api/pnl/*/*` | report · analysis | 附表5 的工资是汇总行，符合规则 4 |
| `/api/reports/is/*/*/*` `/api/reports/bs/*/*/*` | report · analysis | 只放 is / bs 本期：科目余额表 tb 的科目名里有疑似银行账号片段，分析也不调 |
| `/api/reports/**` `/api/recon/**` | report | |

覆盖测试：`PermissionCoverageTest.everyReadEndpointIsMapped` 枚举全部 GET 映射（当前 121 条），每条都必须命中；
`readRulesOnlyReferenceViewPerms` 保证读规则只引用 `kind=view` 的点。

### 11.4 打码

| 字段 | 出口 | 掩码 | 明文要 |
|---|---|---|---|
| `TenantDTO.contactPhone` | `GET /api/tenants`、`/{id}`、POST/PUT 回包（`TenantService.buildTenantDto`） | ≥ 11 位前 3 + `****` + 后 4（`138****5678`）；8–10 位只留后 4（`****6666`）；更短给 `****`。7–8 位座机套「前 3 后 4」等于全露 | master:view |
| `TenantDTO.aliases` | 同上 | 逐项只留第一个字，半角逗号连（`宋**,冯*`）。别名里是老板个人姓名（V86），但它也是抄表导入与台账对户的匹配键，所以**数据层任一查看就给明文**，只有报表 / 分析查看的人（股东）拿掩码 | master:view 或数据层任一 view |
| `TenantDTO.contactName` | 同上 | 只留第一个字（`王**`） | master:view |
| `ContractDetailDTO.tenant.contactPhone / contactName` | `GET /api/contracts/{id}`（取 tenant 表现值，归 master） | 同上 | master:view |
| `CompanyAccountDTO.accountNo` | `GET /api/companies`、增改账户回包（`CompanyService.toDTO`），所有 kind | 只留后 4 位（`****5678`） | master:view |
| `CompanyAccountDTO.accountName` | 同上，只对 `kind=personal` | 只留第一个字 | master:view |
| `data-home` 催缴单那一步的 detail | `GET /api/data-home/overview` | 去掉「 · ¥总额」，只留「N 张」 | billing:view |
| 工资写接口回包整行 | `POST /api/salary/records`、`PATCH /records/{id}/note` | 只回 id，其余为空 | salary:view |

**写回守卫**：`PUT /api/tenants/{id}`（联系人、电话、别名）、`PUT /api/company-accounts/{id}` 收到的值等于「现值的掩码」时当作没改
（`SensitiveMask.keepIfMasked`）。靠提权拿到编辑权的人（查看不可提权）表单里回填的是掩码，不拦的话一保存就把真号码冲掉。
null 与空串原样返回；打码只看本人角色给的点（含隐含），不看提权。
没有 master:view 的人不许把个人卡改成别的类型（403）：写回守卫会把掩码户名还原成真名，回包又按新类型不打码，改一次就换出收款人全名。

### 11.5 和 v1 失败的区别

v1（§0.1）也是每模块 view / edit，失败在**分析层依赖各模块的查看权**：股东只有 `analysis:view`，
分析层 15 屏共用的取数层要调 pnl / report / tenant / contract / building / pv… 全被拦，账号做出来是空壳，12 处深链撞墙。

v3 的两处不同：

1. **分析独立放行**：分析屏实际调到的模块读接口（§11.3 带 analysis 的那些行）对 `analysis:view` 放行，
   不要求各模块的查看权；股东 = `analysis:view` + `report:view` 就能把分析层与报表看全。
   深链跳到没有查看权的模块屏时，前端置灰并写明原因，而不是点过去撞墙。
2. **放宽的代价由服务端打码兜住**：跨模块与分析放行让更多人读得到租户与公司列表，联系人电话、姓名、收款账号
   按 master:view 打码（§11.4），工资明细不放行。v1 当年「`/api/analysis/*-tenant-months` 本来就返回逐户明细，
   view 的隔离根本不成立」—— v3 不追求隔离逐户金额，只隔离个人信息、资金账户与工资。

### 11.6 留给用户定的四件事（实现按默认做法）

1. **催缴单导出会印收款账号。** 有 billing 权限但没有 master:view 的角色导出的单上是 `****1234`，而这张单要发给租户。
   V134 之后现有角色都有 master:view，只有今后新建的角色会遇到。默认：这类账号的导出按钮置灰并写明「印收款账号需要
   主数据 · 查看」（前端）。另一做法：让 billing:view 也看得到账号明文。
2. **工资写入权要不要收紧。** 财务专员没有 salary:view 但有 entry:edit，仍能经导入中心写工资（看不见内容也能写）。
   默认：写入仍挂 entry:edit，只把写接口回包里的行内容去掉。另一做法：工资写入同时要求 salary:view。
3. **损益附表「餐补费」派生**要用 `/api/salary/records` 的月合计，只有 report:view 的人（如股东）拿不到。
   默认：没有 salary:view 时前端不发这 12 个请求，这一项派生不显示。另一做法：新增只回月合计的工资汇总接口。
4. **`system:edit` 隐含 `system:view`。** 默认隐含（统一规则，后端展开与角色屏联动不写特例）。
   内置角色不受影响；只有自建角色勾了 system:edit 没勾 system:view 时会多出系统管理的查看权。

### 11.7 落点

后端：`Perm`（9 常量、ALL 27、NOT_ELEVATABLE、META 加 group / kind、`IMPLIED_VIEW` / `withImplied`）·
`PermissionRegistry.registerReads` / `resolveRead` · `ReadAccessManager` · `SecurityConfig` · `UserPermissionCache` ·
`SensitiveMask` + 五个 service 的打码挂点 · `V134__rbac_view_perms.sql`。
测试：`PermissionCoverageTest`（读覆盖、读规则只引用查看点、读路由回归、查看不可提权、隐含表与设计 / META 一致）·
`ReadPermissionIT`（缺查看 403 与文案、股东、打码与写回、本月出账金额、工资、编辑隐含查看）·
`RbacViewPermsMigrationIT`（V134 重放幂等与第 7 条分配）。
