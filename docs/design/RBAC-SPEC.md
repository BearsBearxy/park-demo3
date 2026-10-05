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
> 2026-10-04 又加第 28 个 `salary:edit`（工资录入，§11.8）：附表 12 的写从 `entry:edit` 拆出来。

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
| `entry:edit` | 月度台账、附表 6/7/8/10/11、办公·三期水电、年度预算导入。**附表 12 工资 2026-10-04 起不归它**（§11.8） |
| `salary:edit` | 附表 12 工资明细的新增、改备注、删除、批删、导入、清空本期导入（含导入中心的工资磁贴）、交审附表 12；隐含 `salary:view`；**进 `Perm.NOT_ELEVATABLE`**（§11.8） |
| `report:edit` | 三大报表、损益附表 1–5、收入核对处置标记；**2026-10-05 起含经营分析的「目标与阈值」**（§14.3，角色屏上这一格叫「账簿报表」） |
| `system:edit` | 用户、角色、日志的管理 |
| `system:view` | **唯一的读权限点**：能不能看到用户列表、角色配置、操作日志 |
| `lock:takeover` | **能授权别人接管**编辑锁（不是能自己接管），见 CONCURRENCY-SPEC §4.3 |
| `elevate:request` | **能不能请主管当场授权**。没有这项的账号（`viewer` / `shareholder`）连编辑模式按钮都看不到，见 ELEVATION-SPEC |
| `review:approve` | **审核通过 / 退回 / 撤销**某张表某个月（SIDEBAR-UX-REDESIGN §7）。交审不设独立权限点 —— 该表的 edit 权即交审权，映射见下面 §2.2。**进 `Perm.NOT_ELEVATABLE`**：审核能当场借 30 分钟的话，录审分离当场作废（录入方可以请主管借一次权把自己刚录的东西审掉） |

`analysis` **没有权限点** —— 分析层是纯只读层。它唯一落库的写是年度预算导入，按拍板 #9 归 `entry:edit`；
~~另一个「写」是 `anaSettings.ts` 的目标与阈值，存 localStorage 不落库（文件头注释明写）。~~
→ 2026-10-05 起目标与阈值落库、全员一份，写要 `report:edit`（用户拍板，§14.3）。

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
| `salary` | `salary:edit`（2026-10-04 前是 `entry:edit`，§11.8） | `SalaryService` |
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
| salary:edit（V136，§11.8） | ✓ | ✓ | — | — | — | — |
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
~~系统不拦「同一账号既录又审」；客户若给主管勾了审核权，录审分离由客户自己负责。~~
**2026-10-04 推翻**（用户：「录审不分离在超级管理，其他分离」）：除系统管理员外，自己交的表要由别人通过或退回，见 §12.4。

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
POST /api/review/*/submit    → param-policy | param-monthly | meter-reading | billing-run | entry | salary
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
   /api/charging/**, /api/elec/**,
   /api/utilities/**                             → entry
   /api/salary/**                                → salary:edit    ★2026-10-04 从 entry 拆出，§11.8
   /api/reports/**, /api/pnl/**, /api/recon/**   → report
   PUT /api/analysis/settings                    → report         ★2026-10-05 目标与阈值（§14.3）；/api/analysis 下只有这一个写，别的写照旧默认拒绝
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
非GET  /api/salary/**           → salary:edit    （不得落 entry；PermissionCoverageTest.everySalaryWriteNeedsSalaryEdit 从源码枚举）
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
| `auth_audit_log` | **已有**（V102） | 账号与角色变更、**编辑锁接管**（记接管人 + 授权人两个）、强制解锁、密码重置、登录锁定；2026-10-05 起含**登录成功 / 失败**，角色权限写明加去了哪几项（§14.2） |
| `review_log` | **新建**（V124） | 审核动作留痕：`submit` / `approve` / `return` / `withdraw`，带 `review_key` 与理由。**无 `authorizer` 列** —— 审核不走提权（`review:approve` 在不可提权名单里），没有「代他人执行」这回事，union 时写 `NULL AS authorizer` |
| `meter_archive_log` | **已有**（V128） | 表档案归属 / 状态的每一次写（METER-TIMELINE-SPEC §5） |
| `value_change_log` | **新建**（V138，2026-10-05） | 台账、抄表读数、工资、三大报表、损益附表的手改逐格记，目标与阈值逐项记，改前 → 改后。`authorizer` 列 V139 补上（同日对抗复查）：提权期间改的数记授权人。见 §14 |

统一时间线页放在 `系统管理 → 操作日志`：~~**四张表**~~ **六张表**（2026-10-05 起）union 后按时间倒序，可按类型 / 操作人 / 时间筛，数据修改还能按表筛。
**一行说的是哪张表，就要那张表的查看权才看得见**（2026-10-05 用户拍板：看得到操作日志，不等于看得到工资）—— 判定下推进 SQL，见 §14.2。
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

**留下的**：~~改密后旧令牌不失效（内网 + 令牌 2 小时过期；要做需引入令牌版本号）。~~
→ V125 起改密即作废旧令牌；2026-10-04 起改密后本机换新令牌，见 §13.2。

### 10.1 P1 实施记录（2026-08-22）

后端：`SystemService` / `SystemController`（`/api/system/**`）· `AuditLogService` · `V102__audit_log.sql` ·
`Perm.META`（13 个权限点的人话名，前端不硬编码）· `SystemApiIT` 10 条。
前端：`fpNav` 第 4 层 · `SystemUsersView` · `SystemRolesView` · `ChangePasswordView` + 强制改密守卫。

**⚠ 每个写方法收尾必须 `cache.reload()`。** 不刷新的话新建账号登得进但每个请求都 401
（缓存里没它），且没有任何报错指向真正原因。dev 上实测过，`SystemApiIT.newUserIsUsableImmediately` 钉住了它。

**自锁防护三条**（`SystemService.guardSelf*`）：不能停用自己、不能改自己的角色、
不能把自己的 `system:edit` 摘掉。这个系统没有第二条进门的路，锁了只能去数据库手改。
2026-10-04 起另有分级与「至少留一个系统管理员」两道（§12），都排在这三条后面。

**实施中修正的三处**：
- `builtin` 契约写的是 `=1`、实现是 Java `boolean` → JSON `true`，前端按 number 判导致
  6 个预置角色全被归进「自定义」还显示了删除按钮。已统一 `boolean`，两个 spec 的 fixture 同步
  （用 `1/0` 的 mock 正是测试没抓到它的原因）。
- 路由未拦 system 层，手打地址能进到「后端 403、页面只剩报错」的屏。已补守卫，只拦
  `meta.layer === 'system'`，其余 47 屏刻意不拦（读全开）。
- 通用 403 文案「不能修改…可查看」对 system 段是**反的** —— 被拦的人恰恰不该看到账号与角色配置。
  已单独文案并加断言。
- `landingPath()` 补第三档：只有 `system:view`、无任何业务层的自建角色原本会落到没有入口的屏。

**待定**：~~改密后旧令牌不失效（内网 + 令牌 2 小时过期；要做需引入令牌版本号）。~~
→ V125 起改密即作废旧令牌；2026-10-04 起改密后本机换新令牌，见 §13.2。

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
| `SALARY_VIEW` | `salary:view` | 工资 | 2026-10-04 起只有 `salary:edit`（§11.8）；`entry:edit` 不隐含 |
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
   `/api/review` 与 `/api/review/` 下 `states` `closed-months` `pending` `returned`；`/api/zones`；`/api/probe/ok` `/api/probe/boom`；
   `/api/app/config`（部署配置两项，2026-10-05 加：外壳一登录就取，挂查看点的话那个账号丢模拟填充按钮和更新记录）。
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
   `salary:edit` 同理（§11.8）：它隐含工资查看，借得到的话财务专员请一次授权又能往看不见的工资表里导数。
7. **迁移 V134**（`V134__rbac_view_perms.sql`，幂等）：除园区股东外的每个角色（内置与自建）勾上 8 个查看点（工资除外）；
   `salary:view` 只给 `admin` 与 `finance_manager`；`shareholder` 只给 `analysis:view` + `report:view`，
   `nav_layers` 设为 `'analysis,reports'`；第 ④ 段把 V101 / V124 种的角色备注里 V134 之后不成立的几句改掉
   （股东「导航只有经营分析」、审核员「只有 review:approve」、总经理 / 只读「导航全部可见」），只改没被客户动过的原句。

### 11.3 读规则表（从上到下首个命中生效）

跨模块读一律按「**本模块 view ∪ 实际调用它的屏所属模块的 view**」放行。「数据层任一」= master / contract / param /
meter / billing / entry / salary 任一 view（`/data-home` 的路由门）。

| 路径 | 放行（任一） | 理由 |
|---|---|---|
| `/api/auth/me` `/perms` `/elevate` `/approvals` `/approvals/candidates`、`/api/notices` `/system-seen`、`/api/review` `/states` `/closed-months` `/pending` `/returned`、`/api/zones`、`/api/probe/ok` `/boom`、`/api/app/config` | 任何已登录 | 规则 3，逐条精确登记 |
| `/api/system/**` | system:view | 与 SecurityConfig 那一行同值；登记在这里是为了覆盖测试不开豁免名单 |
| `/api/analysis/**` | analysis | 分析专用：months、s10-tenant-months、ledger-tenant-months、settings（目标与阈值，2026-10-05；写要 report，§14.3） |
| `/api/tenants/summary` | master · analysis | 租户 KPI，驾驶舱的 Promise.all 无 catch。排在 `/{id}` 前 |
| `/api/tenants/{id}` | master | 租户详情只有主数据屏用 |
| `/api/tenants` | master · contract · param · meter · billing · entry · analysis | 跨模块字典（合同新建无 catch、抄表导入预取、台账对户、分析五屏）。电话 / 姓名打码；aliases 只对没有任何数据层查看的人打码（见 §11.4）；户名、remark 不打码 |
| `/api/tenant-categories` | master | |
| `/api/buildings/summary` | master · analysis | 排在 `/{id}` 前 |
| `/api/buildings/{id}` | master · contract | 合同新建逐栋取单元 |
| `/api/buildings` | master · contract · param · meter · billing · analysis | 跨模块楼栋字典，不含个人信息 |
| `/api/companies` | master · billing · entry · report · analysis | 台账公司选择器、三大报表（无 catch）、催缴单收款簿、分析只用公司名。账号与个人卡户名打码 |
| `/api/companies/payees` | billing | 催缴单屏与导出窗印的收款账户，账号明文（§11.8）。只此一处不按 master:view 打码 |
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
| `/api/salary/lunch-totals` | salary · report | 餐补逐月合计，12 个数不带人；损益附表5「餐补费」派生对照用（§11.8）。排在 `/**` 前 |
| `/api/salary/**` | **salary** | 逐人明细不对 analysis / report 放行 |
| `/api/pnl/*/overview` | report | 分析不调。排在 `/*/*` 前 |
| `/api/pnl/*/*` | report · analysis | 附表5 的工资是汇总行，符合规则 4 |
| `/api/reports/is/*/*/*` `/api/reports/bs/*/*/*` | report · analysis | 只放 is / bs 本期：科目余额表 tb 的科目名里有疑似银行账号片段，分析也不调 |
| `/api/reports/**` `/api/recon/**` | report | |

覆盖测试：`PermissionCoverageTest.everyReadEndpointIsMapped` 枚举全部 GET 映射（当前 123 条），每条都必须命中；
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
| `CompanyAccountDTO.accountNo / accountName` | `GET /api/companies/payees`（`CompanyService.listForNotice`，催缴单屏与导出窗） | 同上两行 | master:view **或** billing:view（§11.8） |
| `data-home` 催缴单那一步的 detail | `GET /api/data-home/overview` | 去掉「 · ¥总额」，只留「N 张」 | billing:view |

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

> 2026-10-04 用户拍板「按你推荐」：第 1、3 条改按「另一做法」，第 2 条改成单列一个工资录入权点 —— 落地见 §11.8。第 4 条维持默认。

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

### 11.8 v3 补三件（2026-10-04 用户拍板「按你推荐」）

1. **催缴单上印收款账号的明文**（推翻 §11.6 第 1 条默认）。新读接口 `GET /api/companies/payees`
   （`CompanyService.listForNotice`），读规则只放 `billing:view`，服务端再判一次 `master:view ∪ billing:view` 才给明文 ——
   读规则哪天被放宽，放进来的人拿到的也只是掩码。催缴单屏（`BillNoticesView.loadCompanies`，单户导出）与导出窗
   （`ExportNoticeWindow`，账户下拉与批量导出）改取它；屏上「导出通知单」「导出本户 Excel」不再因缺主数据查看置灰。
   **别处照旧打码**：`/api/companies`（主数据、收款公司窗、台账公司选择器、报表）仍按 `master:view`。
   收款公司窗是维护账户的地方，照旧走 `/api/companies`（写回守卫 `keepIfMasked` 照常生效）。
2. **工资录入单列一个权点 `salary:edit`**（推翻 §11.6 第 2 条默认）。`Perm.META` 归 `salary` 组、`kind=edit`，
   所以「编辑隐含查看」自动推出 `salary:edit ⇒ salary:view`；角色屏矩阵「工资」一行的编辑格多出「工资录入」。
   **工资的写一律要它**：`/api/salary` 与 `/api/salary/**` 的全部非 GET（新增、改备注、删除、批删、导入、清空本期导入）；
   导入中心的工资磁贴按它出（`importRegistry` 的 `module`）；交审 / 撤回附表 12（`ReviewKind.SALARY.perms()`，
   `/api/review/*/submit|recall` 的 URL 层放行并上它）。`salary_record` 只有 `SalaryService` 写，没有别的账册 / 模板 / 删公司
   路径碰它。**不可提权**（进 `Perm.NOT_ELEVATABLE`，见上面规则 6），附表 12 页头的编辑按钮对没有它的人置灰、写明缺哪一项，
   不弹授权窗（`SchedHeader` 的 `no-elevate`）。写接口回包按 `salary:view` 收的那道（`SalaryService.visible`）随之删掉：
   能写的人隐含查看且借不到，那道收已无事可做。
   **迁移 V136**（`V136__salary_edit.sql`，幂等）：同时有 `entry:edit` 与 `salary:view` 的每个角色（内置与自建）勾上
   `salary:edit` —— 种子里是 `admin`、`finance_manager`；财务专员只有 `entry:edit`，从此录不了工资。财务专员的角色备注
   只改 V101 原句（「…不可改档案、合同、计费口径」→「…、工资」）。
   **迁移 V137**（`V137__admin_salary_edit.sql`，幂等，复查补）：系统管理员角色无条件有 `salary:edit` 与 `salary:view`
   —— 部署前若有人取消过这个角色的事后录入或工资查看（分级之前任何有 `system:edit` 的人都改得了它），V136 会跳过它，
   而系统管理员要能调试整个软件（§12）。照 V108 / V112「新权限点 admin 无条件给」的老规矩；种子库上什么都不插。
   **V136 按角色判，权限按账号的角色并集算**：一个账号从 A 角色拿 `entry:edit`、从 B 角色拿 `salary:view`，部署前能录工资，
   部署后 A、B 都不够格，这个账号静默丢掉工资录入（屏上：附表 12 编辑置灰写「需要「工资录入」权限」、导入中心工资磁贴消失）。
   不放宽迁移（那会把工资录入发给只挂其中一个角色的别人）。**部署后跑一次下面这句（只读）**，跑出来的就是丢了的人，请系统管理员给他其中一个角色勾「工资录入」：
   ```sql
   SELECT u.username, u.display_name FROM auth_user u
   WHERE u.status = 1
     AND EXISTS (SELECT 1 FROM auth_user_role ur JOIN auth_role_perm p ON p.role_id = ur.role_id WHERE ur.user_id = u.id AND p.perm = 'entry:edit')
     AND EXISTS (SELECT 1 FROM auth_user_role ur JOIN auth_role_perm p ON p.role_id = ur.role_id WHERE ur.user_id = u.id AND p.perm = 'salary:view')
     AND NOT EXISTS (SELECT 1 FROM auth_user_role ur JOIN auth_role_perm p ON p.role_id = ur.role_id WHERE ur.user_id = u.id AND p.perm = 'salary:edit');
   ```
   **交审按钮跟着收**：本月出账清单的「交审」是粗判（任一编辑权就画），附表 12 那一行例外 —— 没有 `salary:edit` 不画
   （`DataHomeView` 的 `submittable`；不然财务专员每个月都看见一颗点下去恒 403 的按钮）；屏内审核动作簇（`FPReviewActions`）的「交审」
   只给宿主 `canEdit` 为真的人，被 `show` 放进来的纯审核员、缺工资录入的人只有通过 / 退回。
3. **损益附表「餐补费」派生走月合计**（推翻 §11.6 第 3 条默认）。新读接口 `GET /api/salary/lunch-totals?year=`
   （`SalaryService.lunchTotals`）只回 12 个月的餐补合计，没有工资行的月为 null（与「合计 0」分开）；读规则
   `salary · report`，排在 `/api/salary/**` 前。`pnlDerive.loadDeriveData` 一律走它（原来 12 个 `/api/salary/records`
   请求、没有工资查看就不发）—— 只有报表查看的总经理、园区股东也看得到这一项派生；逐人明细仍只给 `salary:view`。

落点：`Perm`（`SALARY_EDIT`、ALL 28、NOT_ELEVATABLE、META 与三条 hint）· `PermissionRegistry`（工资写段、审核交审两条、
两条读规则）· `ReviewKind.SALARY` · `SalaryService` / `SalaryController`（`lunchTotals`）· `CompanyService` /
`CompanyController`（`payees`）· `V136__salary_edit.sql`。
测试：`PermissionCoverageTest.everySalaryWriteNeedsSalaryEdit`（从源码枚举工资写端点）与读路由回归 ·
`ReadPermissionIT`（工资读写分开、餐补合计、催缴单收款账户）· `RbacViewPermsMigrationIT`（V136 分配与重放、V137 系统管理员）·
`RoleApiIT`（预置角色表）· 前端 `DataHomeView.spec`（附表 12 交审）· `FPReviewActions.spec`（canEdit 为假不画交审）。

---

## 12. 系统管理分级与录审分离（2026-10-04 用户拍板）

> 用户原话：「系统管理不分级反正我需要一个超级管理员的账号都能调试整个软件，录审不分离在超级管理，其他分离」。
> 对应安全审计 F86 / F38 / F39（只管账号的人能把自己升成系统管理员）与 F17 / F37（同一账号自己交自己审）。

### 12.1 谁是系统管理员

启用、且挂着预置角色 `admin`（屏上「系统管理员」）的账号。**按角色标识认，不按权限点认** —— 别的角色勾满全部权限也不是。
判据只有一处：`UserPermissionCache.isSuperAdmin`（快照重载时按角色 code 算）。登录回包与 `GET /api/auth/me` 带 `superAdmin`，
前端落进 auth 存储（键 `superAdmin`，存 `'1'`/缺省，口径同 `mustChangePassword`）。写 / 清 auth 存储的四处清单
（`stores/auth.ts` 登录换轨、登出，`api/index.ts` 401）都带这个键。

### 12.2 分级（只约束不是系统管理员的人）

比较用的「我的权限」= 角色给的权限 + 编辑隐含查看（快照里那份），**不含提权**（`system:*` 本来就借不到）。下表任一条命中 → 403（body.code）。

| 动作 | 拦的条件 | 文案 |
|---|---|---|
| 新建角色 | 勾的权限（展开隐含）里有我没有的 | 角色里有你没有的权限：X、Y。只有系统管理员能分配你没有的权限 |
| 改角色 / 删角色 | 是系统管理员角色；或改前 ∪ 改后有我没有的（往小里改比自己大的角色也不行） | 系统管理员角色只有系统管理员能改 / 同上一行 |
| 新建账号 | 要分配的角色里有系统管理员角色；或有我没有的权限 | 系统管理员角色只有系统管理员能分配 / 要分配的角色里有你没有的权限：…。只有系统管理员能分配你没有的权限 |
| 改账号（显示名或角色）、重置密码、停用 / 启用 | 目标挂着系统管理员角色；或目标现有权限里有我没有的；改角色时新角色另按上一行判 | 「张三」是系统管理员账号，只有系统管理员能改 / 「张三」有你没有的权限：…。只有系统管理员能改这个账号 |

- 改账号只改显示名也拦：比自己大的账号整个不归你管，屏上那一行三颗按钮一起置灰，不单为显示名留一条路。
- 不加「再输一次自己的密码」（同一句拍板：系统管理员调试要顺手）。
- 自锁防护三条（§10.1）照旧，排在分级前面；F39「改自己挂的角色给自己加权限」由改后那份拦住。

### 12.3 至少留一个启用的系统管理员（对所有人）

停用一个账号、或摘掉它的系统管理员角色之后，库里不再有别的启用账号挂这个角色 → 409
「「X」是最后一个启用的系统管理员账号，停用它或摘掉它的系统管理员角色后，就没有人能管理整个系统了。请先给另一个账号分配系统管理员角色。」
排在分级前面：只管账号的人去停最后一个管理员，该听到的是这个后果，不是一句「超出范围」。
系统管理员本人操作时，「不能停用自己 / 不能改自己的角色」已先拦住会走到这里的路；账号没有删除入口，系统管理员角色是预置的删不了。
**并发**：两个系统管理员同时互相停用（或摘角色），普通读各看见对方还启用着、双双放行，提交后一个都不剩。所以真要摘掉一个启用的
系统管理员时，守卫先 `FOR UPDATE` 锁住 `auth_role` 里系统管理员那一行（两件事排队），再用锁定读（`FOR SHARE`）数 `auth_user_role`
与 `auth_user` —— 锁定读读已提交的最新行，不是本事务开头拍的快照。别的账号改动不走这把锁。测试 `LastAdminLockIT`（三处各锁一次，停用要排队）。

### 12.4 录审分离

`ReviewService.approve` / `returnBack`：操作人就是 `submitted_by`、又不是系统管理员 → 409「2026-08 月度台账 是你自己交的，要由别人通过或退回」。
409 不是 403：他有审核权，拦的是「这一张是自己交的」这条规矩（同「不能停用自己」）；前端两处审核入口只给 403 冠「你没有这张表的权限：」，
冠在这句前面前后打架。
系统管理员自己交自己审照常放行。撤销审核（withdraw）不在这一条里。全站审核写入口只有 `ReviewController` 这几个端点（铃铛只列清单、不带动作）。
**铃铛同一条判据**：「等你审」的红数字（ping 的 `pendingReviews`）与清单（`GET /api/review/pending`）都走 `ReviewService.pendingOf` ——
不是系统管理员时去掉自己交的（`submitted_by` 为 NULL 的照列）。自己交的他审不了，列进「等你处理」就成了一件办不完的事，红点挂到别人审完为止。
`submitted_by` 可能为 NULL（直接写库的种子行）、取不到人时 `me()` 是空串：比较写成 `me().equals(submittedBy)`。

### 12.5 屏上

- **用户管理**：后端给 `UserDTO.manageable` / `RoleDTO.manageable`（守卫同一条判据算，系统管理员恒真）。管不了的账号「编辑 / 重置密码 / 停用（启用）」置灰，
  悬停「系统管理员账号只有系统管理员能改」或「这个账号有你没有的权限,只有系统管理员能改」；点行开的抽屉（手机行卡只有这一条路）只读并写明原因；
  新建 / 编辑里派不了的角色那一格置灰（「系统管理员角色只有系统管理员能分配」/「这个角色有你没有的权限,只有系统管理员能分配」）。
- **角色权限**：管不了的角色整块只读，底部写「系统管理员角色只有系统管理员能改。」或「这个角色有你没有的权限,只有系统管理员能改。」；
  能改的角色（含新建）里，自己没有的权限那一格置灰，悬停「你没有这项权限,只有系统管理员能把它分给角色」。系统管理员不受限。
- **审核动作簇**（`FPReviewActions`）与**本月出账清单**（`DataHomeView`）：待审的全是自己交的、又不是系统管理员 →「通过」「退回」照画、按不动，
  悬停「这张表是你自己交的,要由别人通过或退回」；多键里混着别人交的，只发别人那几把。判据 `types/review.ts` 的 `ownSubmission`（me 为空不算自己交的）。

### 12.6 落点

后端：`UserPermissionCache`（`SUPER_ADMIN_ROLE`、`isSuperAdmin`）· `SystemService`（`guardRoleInRange` / `guardUserInRange` / `guardKeepsAnAdmin` / `inMyRange`）·
`SystemDtos`（两个 `manageable`）· `LoginResp` / `MeResp` / `AuthService`（`superAdmin`）· `ReviewService.guardNotOwnSubmission`。无迁移。
测试：`SystemTieringIT`（四条升级路、系统管理员不受限且登录回包说实话、范围内照管与编辑隐含查看、最后一个管理员）·
`LastAdminLockIT`（最后一个管理员的守卫上锁）· `ReviewApiIT.selfReview_isBlockedForEveryoneButASuperAdmin`（409、铃铛红数字与清单不含自己交的）。前端：`systemUsersView` / `systemRolesView` / `FPReviewActions` / `DataHomeView` / `auth` / `loginKicked` 各 spec。

---

## 13. 改密（2026-10-04 用户拍板「按你推荐」）

> 用户原话：「首次登录强制改密，现在自己改不了自己的密码，并且在系统用户管理里面重置密码后，到登录的时候又要强制改一遍」。
> 对应安全审计 F02 / F40（强制改密只有前端路由守卫拦）与 F89（改密把本机也踢下线）。

### 13.1 入口

账号菜单「修改密码」→ `/change-password`：桌面在头像菜单「版本更新」下一行，手机在导航抽屉「版本更新」下一行。
改密页不进外壳（`App.vue` 的 `isBare`），去了外壳整个卸掉、各页签现场跟着没 —— 同退出登录，有没保存改动的页逐个先问（动词「离开」）。

| | 自己来改 | 强制态（`mustChangePassword`） |
|---|---|---|
| 标题 / 说明 | 修改密码 / 修改后这台设备保持登录。（不写「其他设备上的登录会退出」：单会话下同一账号同一时刻只有一台设备登着） | 请先修改初始密码 / 这是管理员分配的初始密码，改掉之后才能进入系统。 |
| 底部那颗 | 「返回」：回上一页；直接打开这个地址的（没有上一页）落首页 | 「退出登录」（忘了当前密码的人唯一的出口），没有「返回」 |
| 改完 | 回上一页（没有上一页落首页），回执「密码已修改」 | 落首页，回执同左 |

标题、说明、底部那颗进页时定下来，改完那一拍不跟着标志翻。

### 13.2 改完本机不掉线，别处下线

`POST /api/auth/change-password` 回 `{ token }`：服务端开一个新会话（`AuthService.reissueAfterPasswordChange` → `SessionService.open(…, "password")`），
token_version +1、换新 sid。改之前签的令牌全部作废 —— 单会话下别的设备上还活着的只可能是同一张，被抄走的也是它 ——
下一个请求 401、`X-Auth-Reason: password`，登录页说「密码已修改，请用新密码登录」。本人授权照旧随会话清空（ELEVATION-SPEC）。
前端 `auth.setToken` 换上新令牌，写回原来那一轨（没勾「记住登录」的不被改成记住）；同一浏览器别的标签页每个请求现读 storage，跟着换上。
**换令牌那一拍**：服务端先作废旧令牌、回包才带来新令牌，这中间拿旧令牌发出去的请求（在场心跳每 3 秒一拍，别的标签页也在发）撞 401。
`api/index.ts` 的 401 分支清身份之前先看：① 这个请求带的令牌已经不是 storage 里那张 → 用新的重发一次；② 原因是 `password`、令牌还没换
→ 等新令牌落地（至多 3 秒）再重发。等不来才是真被改了密码，照常清身份、去登录页。每个请求只重发一次。
改前是 `revokeAll`：连本机也踢回登录页，强制改密改完落到首页、紧接着又被弹回登录页。

### 13.3 用户管理里重置密码

| 重置的是 | `must_change_password` | 会话 | 回包 |
|---|---|---|---|
| 别人 | 置 1，本人下次登录必须改 | 那个人全部会话作废（`revokeAll(…, "password")`） | `{ token: null }` |
| 自己 | 置 0：密码是自己刚定的，不再逼自己改一遍 | 同 13.2，本机换新令牌、别处下线 | `{ token }` |

弹窗说明与完成那句按这两种分开写（`SystemUsersView` 的 `pwSelf`）。分级（§12.2）照旧排在前面。

### 13.4 带着管理员给的密码，服务端只放改密页用得到的几条

`must_change_password=1`（新建账号的初始密码、被别人重置的密码）的账号，`JwtAuthFilter` 认出令牌后，
除 `SecurityPaths.BEFORE_PASSWORD_CHANGE` 外一律 HTTP 403、`body.code` 428（`ResultCode.PASSWORD_CHANGE_REQUIRED`「请先修改初始密码，改完才能使用系统」）：

| 放行 | 谁调 |
|---|---|
| `POST /api/auth/change-password` · `POST /api/auth/logout` | 改密页上的两个按钮 |
| `GET /api/auth/me` · `GET /api/auth/elevate` | App 挂载时各取一次（刷新权限、恢复授权胶囊），只读本人自己的东西 |
| `POST /api/auth/login` | 登录本身不看令牌，请求头里捎着一张没改密的旧令牌也不该把登录挡掉 |

「方法 路径」原样比，写法不一样的一律算不在名单里。判据在权限快照里（`UserPermissionCache.mustChangePassword`，随 `reload()` 重算），
逐请求零查库；改完密码 `reload()` 当场清。改前只有前端路由守卫拦，拿初始密码换来的令牌直接调接口照样全通。
在场心跳、铃铛、版本检查都挂在外壳上，改密页不进外壳，所以强制态下它们本来就不跑。

前端 `api/index.ts`：收到 428 → 标志写进令牌所在那一轨 → 整页跳 `/change-password`（不报错、不退出；不把错交给调用方；
整页跳让外壳上的轮询跟着页面一起停）。已在改密页就不再跳，照常把错交回去。会撞上它的是：别的标签页刚用初始密码登进来，本页沿用了那张令牌。

### 13.5 落点

后端：`ResultCode.PASSWORD_CHANGE_REQUIRED` · `SecurityPaths.BEFORE_PASSWORD_CHANGE` · `JwtAuthFilter` · `UserPermissionCache.mustChangePassword` ·
`SessionService.open(…, by)` · `AuthService.reissueAfterPasswordChange` · `SystemService.changeOwnPassword / resetPassword` · `SystemDtos.PasswordChangedResp`。无迁移。
测试：`PasswordSelfServiceIT`（本机新令牌 + 旧令牌 401、重置自己 / 别人、强制态读写 428 而改密页四条放行、改完当场放行、强制态能登出）；
用 API 建号再以那个人身份调业务接口的 IT，建完号调 `AbstractMysqlIT.passwordAlreadyChanged`。
前端：`IconRail` / `MobileNavDrawer`（入口）· `ChangePasswordView` · `stores/auth` 的 `setToken` · `api/index.ts` · `SystemUsersView`；
spec：`changePasswordSelf` · `systemUsersReset` · `tabStrip`（入口走离开确认）。

---

## 14. 数据修改记录、目标与阈值落库、损益附表锁账月（2026-10-05 用户拍板）

> 用户原话「2按你建议，3，4一起做」：第 2 条目标与阈值从各人浏览器挪进库；第 3 条损益附表只存变了的格、拒整月锁账的月、逐格留痕；
> 第 4 条手改的钱表逐格记谁、何时、哪张表哪一格、改前、改后，登录成败与角色权限的加去也记，全进「系统 → 操作日志」，按人 / 表 / 时间筛，
> 而且看得到操作日志不能顺带看到自己打不开的表。

### 14.1 记什么、不记什么

新表 `value_change_log`（`db/common/V138__value_change_log.sql`，两条链都跑，只建表不写数）：一格一行 ——
`actor`（用户名）· `authorizer`（V139：提权放行时的授权人，取 `ElevationStore.currentAuthorizer()`，同 `AuditLogService`）· `at` · `tbl` ·
`row_ref`（人看得懂的行定位）· `field`（列的人话名）· `old_val` / `new_val`（按屏上显示的样子存字符串，
4500.00 存 4500；NULL = 原来没有 / 删掉了）· `note`。只有 `ChangeLogService` 写它：在调用方事务里写、**不吞错** ——
记不下来，这次保存一起失败（与 `AuditLogService` 相反，那边记不下来照样放行）。前后一样的格不记。

| 表（`tbl`） | 记的写路径 | `row_ref` 的样子 | 要看这类行需要 |
|---|---|---|---|
| `monthly_ledger` 台账 | `LedgerService.save` / `copyFromPrev` / `renameRow` / `bindRow` / `bindTenant` | 公司 · YYYY-MM · 账面名（列名取那个月模板的表头） | `entry:view` |
| `meter_reading` 抄表读数 | `MeterService.createReading` / `updateReading` / `deleteReading`；`batchDelete` 只记一行摘要 | 〈期区〉电表或水表 名称(编码) · YYYY-MM | `meter:view` |
| `salary_record` 工资 | `SalaryService.create` / `updateNote` / `delete` / `batchDelete`；`clearImported` 只记一行摘要 | 姓名 · YYYY-MM | `salary:view` |
| `report_amount` 三大报表 | `ReportService.save` / `deleteCustomRow`；删公司（`CompanyService.delete`）只记一行摘要 | 利润表 · 公司 · YYYY-MM · 行次 N | `report:view` |
| `pnl_row` 损益附表 | `PnlService.save`（§14.4） | 附表N 名称 · YYYY 年 · 分组 · 科目；`field` 是「3月」「备注」或「类别」 | `report:view` |
| `analysis_setting` 目标与阈值 | `AnalysisSettingService.save`（§14.3） | 经营分析；`field` 是弹层里那一项的名字 | `analysis:view` |

**不记的**（都是有意的）：

- **导入**（台账、抄表、工资、三大报表、损益附表）不逐格记 —— `import_log` 已经记了谁、何时、哪个文件、几行，操作日志「导入」一路照常显示。
- 台账存盘后 rechain 改掉的**后面月份**的上月结余（派生出来的，不是人改的）；保存时人填的上月结余被 rechain 改回，也不记。
- 新增 / 删除整行时为 0 的格（金额列默认 0，记了满屏「— → 0」）；连带抄表读数 0 在新增 / 删除时也不记，已有读数改成 0 或从 0 改走照记。
- `factor_snap`、科目余额表的科目树本身、损益附表行的排序、整行都空的行的增删。（损益附表行的**类别**要记：它决定这一行进不进经营分析的收入 / 成本 / 损益，§14.4）
- 整批动作只记一行摘要、不留逐格旧值：删公司（「…它名下 N 行台账（所有年月）一并删掉」，报表同）、抄表按月批删（「批量删除了这个月的 N 条读数」）、
  清空本月导入的工资（「…共 N 人」）。工资批删与删报表自定义子类照样逐格记。

### 14.2 操作日志：按查看权过滤、按表筛、登录、角色权限明细

- **一行说的是哪张表，就要那张表的查看权**：`SystemService.auditLogs` 按查看者的权限快照（含隐含查看、**不含提权** —— 查看本来就借不到，§11.2 第 6 条）
  算出 `tbls`（数据修改按上表）、`seeParam`（计费参数一路要 `param:view`：里面是单价的改前改后）、`seeMeter`（表档案一路要 `meter:view`），
  下推到 `AuditQueryMapper` 的每个分支（看不见的分支整路 `1=0`），条数、分页、操作人下拉三处同一套条件。
  内置角色里只有系统管理员有 `system:view`，而它什么权限都有，所以屏上看不出差别；会看出差别的是今后自建的「有系统管理查看、缺某模块查看」的角色。
  同日对抗复查（SEC-2）补齐另外几路，都照「那块数据在自己的屏上谁打得开」：导入一路 `seeImport` = 导入中心的读规则
  （`PermissionRegistry.resolveRead("/api/import-log/overview")`，八个模块查看权任一 —— 那条规则本来就让任一模块查看看到全部导入类型的文件名与行数，
  这里不另立按类型的名单，免得和前端 `importRegistry` 的类型清单两份对不上）；`auth_audit_log` 里 `bill-notice.*` 要 `billing:view`（`seeBilling`）、
  `meter.delete` 要 `meter:view`；审核一路照旧全给 —— `/api/review` 本来就对任何登录账号开（审核状态与退回理由）。
  回包 `AuditPageDTO.sources` = 这个人看得见的来源，前端来源下拉只列它们（选了看不见的一路只会是 0 条，读起来像从没发生过）。
- `GET /api/system/logs` 多一个参数 `tbl`：只看某张表的数据修改。不认识的表 400「未知的表：x」，和 `change` 以外的 `src` 同时给 400「按表筛只对「数据修改」这一路有效」，
  只给 `tbl` 等于 `src=change`。读规则不变（`system:view`），无新端点。回包 `AuditPageDTO.tables` = 这个人看得见的表；
  前端来源下拉在「数据修改」后面按它列「改台账 / 改抄表读数 / 改工资 / 改三大报表 / 改损益附表 / 改目标与阈值」（`SystemLogsView.srcOpts`），看不见的表不列。
  一行的样子：动作「改台账」，对象「row_ref · field」，详情「改前 → 改后」（缺的一边写 —，有 note 接在后面；摘要行只有 note），提权时带「由 X 授权」。
- **登录**（`AuthService`，写 `auth_audit_log`，进「账号与角色」一路）：成功 `login`、失败 `login.fail`，对象 = 客户端 IP，
  操作人 = 用户名按限流键的规则小写（`LoginRateLimiter.user`）。失败详情「密码不对 / 没有这个账号 / 账号已停用」，
  连错第 5 次那条再加「，已连错 5 次，这个网络地址 15 分钟内不能再试这个账号」（锁的是 地址 + 账号，不是电脑）。
  **没有这个账号时操作人记空、不记敲进去的名字**（常有人把密码敲进账号框）；密码任何时候都不记。
  行数有上限：锁定期间（429）的尝试不记（锁定本身记在第 5 次失败上）；没有这个账号的失败按**网络地址**合一个限流桶（不是按敲进去的名字 ——
  那样换一个名字就是一个新桶、永远到不了 5 次，一个地址换着名字刷就按请求速率涨行，同日对抗复查 SEC-1），15 分钟里只记第 1 次和第 5 次，
  第 5 次那条写「没有这个账号；这个网络地址 15 分钟内已试了 5 次不存在的账号，后面的不再一条条记」。
- **角色权限**：`role.create` / `role.update` 的详情从「权限 N 项」改成加去明细（`SystemService.permDiff`，按角色矩阵行序、用 `Perm.META` 人话名）：
  「加 2 项：工资 · 查看、报表 · 查看；去 1 项：台账与附表 · 查看；现共 2 项」，没增没减写「没动权限，共 K 项」（一项没有写「没勾任何权限」）——
  只改名 / 备注也走 `role.update`，所以屏上动作名叫「改角色」；28 项全加也在 255 字内（`SystemServicePermDiffTest`）。
  `role.delete` 与 `user.update`（「角色 N 个」）没改。

### 14.3 经营分析「目标与阈值」落库（第 2 条）

- 表 `analysis_setting`（同在 V138）：一项一行，**没有行 = 用默认值**（默认值不落库，我园和新园区一样）。默认值前端 `ANA_SETTINGS_DEFAULT` 与后端
  `AnalysisSettingService.Key` 各有一份（后端只用来给记录写「改前」），改要两边一起改。
- `GET /api/analysis/settings`（读规则沿用 `/api/analysis/**` → `analysis:view`）只回存过的项；`PUT /api/analysis/settings`（写规则 `report:edit`，§5.2）
  收部分 `{key: number}`，**只回送来的那几项**存进库的样子（回整份的话，有 `report:edit`、没有 `analysis:view` 的账号一次值没变的保存
  就能读走光伏投资额等，同日对抗复查 SEC-7）。范围照弹层输入框：出租率 / 收缴率 50–100、风险线 30–90、能耗突变 10–200、固定成本占比 0–1、光伏投资 0–1e8（上限只为放进
  DECIMAL(16,4)）；超出整次拒 400「「收缴率目标 (%)」要在 50 到 100 之间」，不认识的键「没有「x」这一项」。保留 4 位小数；值没变不写不记。
- 每改一项记一行：`row_ref`「经营分析」、`field` 弹层里的名字、改前（没存过就是默认值）→ 改后；光伏投资 0 写成「按各期工程成本合计」。`@NoReviewGuard`（没有月份）。
- 前端 `anaSettings.ts` 不再读写 localStorage，模块加载时删掉旧键 `fp-ana-settings`。**各人浏览器里原来的值不搬**（用户拍板）：有权限的人重填一次，在那之前大家看到默认值 ——
  更新公告 0.30.0 写了这一句。进分析层的路由先 `await loadAnaSettings()`（一次会话只真等第一次），屏上不会先按默认值画一遍再跳。
  别人改了，刷新页面后才看得到。
- 没有 `report:edit` 的人（主管临时授权借得到 —— 它不在 `NOT_ELEVATABLE`）：弹层六个框与「恢复默认」置灰，标题下一句
  「全园区共用这一份目标与阈值，需要「账簿报表」权限才能改」。盈亏平衡屏的固定成本系数滑杆**谁都能拖**（用户 2026-10-05「两个都按你建议」，
  推翻同日初稿的置灰）：拖动只重算本屏；没有 `report:edit` 的人拖出来的数只在本屏、一个请求都不发，滑杆下一行
  「拖动只是看看效果，不会保存；要改全园共用的数需要「账簿报表」权限」（不写「试算」——「试算平衡」是记账用语），离开这一屏（含页签切走再切回）或刷新回到全园的数，
  编辑权借到 / 到期时也作废。有权限的人松手存一次（一次拖动一行记录；改不改全园那一份按这一下的第一格定，拖到一半授权到期照样去存、被拒退回）；
  存不上退回库里的数并说一句。

### 14.4 损益附表只写变了的格、拒整月锁账的月（第 3 条）

- `PnlService.save` / `importRows` 原来 `clear(schedule, year)` 再整年重插、挂 `@NoReviewGuard`、不留痕；现在走 `apply`：读出这一年的行，
  按（分组, 科目）和提交的行配对，同名的第 k 个配第 k 个、不看先后（不按 `row_key`：前端按位置重编号，删一行后面全错位；原来按先后做最长公共子序列，
  导入文件的行序和屏上不同就把同一行拆成删一行加一行、误拒锁账月，还要 旧行数 × 新行数 的内存 —— 同日对抗复查 PROD-F2 / SEC-8），只删没了的行、只改变了的行
  （`UpdateWrapper` 每列显式写，清空的格真写成 NULL）、新行的 `row_key` 接在保留的最大号后面。整年没变 → 0 次写、0 行记录。
- **改到整月锁账的月整次拒**：只要有月份格变了才去查 `ReviewService.closedMonths`（整月锁账 = 该月全部计入锁账的审核键都已审核，SIDEBAR-UX-REDESIGN D20），
  碰到就 423「2025 年 3 月已锁账（本月出账里「本月锁账」打了勾），改不了。要改，先请审核员撤销那个月其中一张表的审核。」，
  多个月「2025 年 1 月、3 月已锁账（…），改不了。要改，先请审核员撤销每个月其中一张表的审核。」（屏上那一行叫「本月锁账」，不用内部的「整月锁账」）。
  删一行而那行在锁账月有数，也算碰到；**改类别**（明细 / 小计 / 损益 / 合计，决定这一行进不进经营分析的收入 / 成本 / 损益）算碰到这一行有数的每个月，
  并记一格「类别」（同日对抗复查 SEC-3）。只改备注、排序不碰月份，照存。导入同一规则，整次拒（哪怕是全年重导、只有锁账月的数对不上）。
  编辑态锁账月那几列只读（悬停「3 月已锁账…这一列改不了」）、「填入 / 全部填入派生值」跳过它们（`PnlTable lockedMonths`、`fillRow` 的 `skip`，PROD-F1）。
- 手录保存逐格记 `pnl_row`；导入不逐格记。`PUT …?auto=true`（打开某年时屏上自动补的行，只有我园的配置会补）**只许加行**：
  已有的行有一格不同或少了一行（几秒前读的整年、期间别人存过）就 409 不写（屏上静默），免得把别人的数改回去、还记成「自动补的行」（SEC-4）；
  加的行记录带注「打开这一年时自动补的行」。前端自动补行时跳过锁账月（`generateMissingRows` 的 `skip`），其余月照补。
- 损益附表**仍不进审核**（按年落库，没有月度键，SIDEBAR-UX-REDESIGN §9.1 第 2 条）；两处 `@NoReviewGuard` 的理由改写成「锁账月的拒在 apply 里做」。
- **上线前**读一次线上 `GET /api/review/closed-months`：列出来的月份，上线即在损益附表里改不了。

### 14.5 落点

后端：`V138__value_change_log.sql` / `V139__value_change_log_authorizer.sql`（校验和钉在 `baseline/migration-checksums.txt`）· `ChangeLogService` · `ValueChangeLog` / `ValueChangeLogMapper` ·
`AuditQueryMapper`（第 6 路 `change` 与三个可见性参数）· `SystemService.auditLogs` / `permDiff` · `AuditLogService.logAs` · `AuthService.loginFailed` ·
`LoginRateLimiter.user` · `LedgerService` / `MeterService` / `SalaryService` / `ReportService` / `CompanyService` / `BookService.labelsAt` · `PnlService.apply` ·
`AnalysisSettingService` / `AnalysisSettingMapper` · `AnalysisController` · `PnlController`（`auto`）· `PermissionRegistry`（一条写规则）。
前端：`SystemLogsView`（来源 `change`、动作名、按表筛）· `types/system.ts` · `analysis/anaSettings.ts` · `api/analysis.ts` · `router/index.ts` ·
`AnaShell.vue` · `BreakevenView.vue` · `api/pnl.ts` · `reports/pnlDerive.ts` · `PnlScheduleView.vue`。
测试：`AuditTrailIT`（可见性、按表筛与 400、登录、角色明细）· `ChangeLogWritePathsIT`（四张表的写路径逐行比对）· `ChangeLogServiceTest` ·
`SystemServicePermDiffTest` · `PnlServiceTest` / `PnlApiIT`（只写变的格、锁账月拒）· `AnalysisSettingApiIT` · `PermissionCoverageTest` 读写路由回归 ·
`ReviewGuardCoverageTest`；前端 `systemLogsView.spec` · `AnaShell.spec` · `viewGuard.spec` · `motionR2-expiryChargeBreakevenRoi.spec` · `pnlGenerateGate.spec` · `pnlDerive.spec`。
