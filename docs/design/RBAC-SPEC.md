# 账号与权限规范（RBAC-SPEC）v2

> 状态：**现行模型是 v4「权限细到菜单单项」**（2026-10-09 用户拍板，见 [§15](#15-v4权限细到菜单单项2026-10-09-用户拍板)），已实现、复查修过一轮（§15.13），版本 0.33.0，在分支 `jfen/rbac-screen-perms` 上、未合并。沿革：2026-08-21 立，同日按「读全开」重写为 v2；2026-10-04 改 v3「读写分开」（§11）；2026-10-09 细到菜单单项为 v4（§15）。
> 配套：[CONCURRENCY-SPEC.md](CONCURRENCY-SPEC.md)（权限决定谁能改，并发决定同时改的人互相不打架）。

---

## 0. 核心模型（v2 一句话）

> ⚠ **2026-10-04 用户拍板推翻了 v2 的拍板 #8「读全开」、#10「无权的屏除股东外一律显示」与 #11「工资全开」**。
> 现行模型是 **v4「权限细到菜单单项」**，见 [§15](#15-v4权限细到菜单单项2026-10-09-用户拍板)；读写分开的骨架来自 v3（[§11](#11-v3读写分开2026-10-04-用户拍板)），§15 取代了 v3 的查看点清单、读写规则表与交审权限表。
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

---

## 15. v4：权限细到菜单单项（2026-10-09 用户拍板）

> 用户拍板（2026-10-09）：
> ① 「全部单项真拆」：每个菜单单项各自「查看 / 编辑」，原有特殊动作（催缴单签发、账册模板、换版、表档案等）挂到所属那一屏下；
> 后端逐接口按屏拦，绕不过；旧角色迁移后每人能看能改的一屏不变。
> ② 「加成员栏」：角色屏加「本角色成员」名单（账号 + 姓名），可添加 / 移出；和用户管理里的分配是同一份数据，两边改哪边都行。
>
> 客户原话：「模块权限应当详细分列具体单项设立权限选择，如图角色与权限都是分级分项的这样适应性才强」。
> 截图红框圈的是「经营分析 · 查看」那一行，批注「要细分到下一级菜单栏单个项目可选」；参照系统的权限树是
> 大功能模块 → 下面细分单项可选，同一模块里可以有部分单项没授权。
>
> 本节取代：§11.1 的查看点清单、§11.3 的读规则表、§5.2 的写映射表、§2.2 的 kind → 权限点表、§11.4 打码判据里的模块键。
> §5.2 的三条匹配铁律、§11.2 的规则 2 / 3 / 5 / 6、§12（分级、最后一个系统管理员、录审分离）、§14 照旧。版本 0.33.0（功能更新）。

### 15.1 模型

**一句话：每个菜单单项一个「查看」，有写的屏一个「编辑」，原来单列出来的特殊动作挂到发起它的那一屏；后端每条接口按「哪几屏会调它」放行。**

| | v3（§11） | v4 |
|---|---|---|
| 权限点 | 按模块：9 个查看 + 19 个编辑类，共 28 | 按屏：51 屏各一个查看、34 个编辑、19 个专有动作、跨屏 3 个，共 **107** |
| 命名 | `master:view`、`billing-run:edit`… | `<屏>:<动作>`，屏 = `fpNav.ts` 的 `item.value`（`ledger:view`、`bill-notices:issue`）；动作 `view` / `edit` / 专有动作的短英文 |
| 编辑隐含查看 | 同模块编辑 → 模块查看 | 同屏任一非查看动作 → 本屏查看（装载快照时展开，不落库）；**不跨屏** |
| 进屏门 | 数据层逐屏表 + 报表 / 分析 / 系统三层各一项 + `?mode=` 分本 | 一屏一项 `<屏>:view`；`?mode=` 不再分权 |
| 读规则 | 本模块查看 ∪ 调它的屏所属模块的查看 | **实际调用这条接口的那几屏的查看**（逐屏勘察清单，§15.5） |
| 写规则 | 模块编辑 | 发起这条写的那一屏的编辑或专有动作；URL 分不出屏的，在 service 里再判（§15.6） |
| 角色屏 | 模块 × 查看 / 编辑矩阵 | 层 → 分组 → 屏的树，每屏一行：查看、编辑、其他动作；右侧加「本角色成员」（§15.9） |

**为什么不会重蹈 v1（§0.1 / §11.5）**：v1 的病根是「分析层依赖各模块的查看权」，股东账号做出来是空壳、12 处深链撞墙。
屏级拆分把这个风险放大到 51 屏：只给某一屏查看权的角色，打开那一屏任何一个读接口 403 就是整屏或半屏加载失败。v4 的四条对策：

1. **读规则按调用方列，不按数据归属列。** 读规则表的每一行写的是「哪几屏会调这条接口」，逐屏来源是 2026-10-09 的勘察清单
   （每屏的 `reads`：进屏、换期、切回、开抽屉、开弹窗各会调什么）。分析屏实际调到的模块接口照样对该分析屏放行（「分析独立」保留），
   不要求对应数据屏的查看权。
2. **几屏共用的取数枢纽整组放行。** 出账链月索引（`stores/billingPeriod.ts` 的 `Promise.all`，没有 catch）对出账链六屏任一查看都放行；
   分析层共用的 `/api/analysis/months`、`/settings` 对 20 个分析屏任一查看放行。
3. **表驱动测试从同一份清单生成**：「只给这一屏查看权，这屏的每个读接口都不是 403」「只给这一屏编辑权，这屏的每个写接口放行、兄弟屏的写拒」（§15.10）。
   报表中心、损益附表派生对照用 `Promise.allSettled`，403 不会让屏报错，所以断言落在接口状态码上，不看屏上有没有报错。
4. **屏间跳转都先问目标屏的查看权**：没有就置灰写原因（`useViewGate`），不把人送进「无权查看」页。v3 里漏判的几处（步骤条、报表中心卡片、
   出账链各屏的跳转、驾驶舱「查看全部」）一并补上（§15.7）。

### 15.2 权限点全表（107 个，按 fpNav 的层 / 分组 / 屏顺序；这就是 `Perm.ALL` 与 `Perm.META` 的顺序）

后端 `Perm` 的形状：

- `record Screen(String value, String label, String layer)`，`SCREENS` 51 条，顺序、value、label 与 `frontend/src/nav/fpNav.ts` 逐条一致（§15.10 有测试对账）。
- `record Meta(String key, String label, String hint, String screen, String kind)`：`screen` = 屏 value（跨屏三项为 `null`）；
  `kind` ∈ `view` / `edit` / `action` / `other`。原来的 `group` 字段去掉（前端按 `screen` 挂树）。
- `ALL` = `META` 的 key 按序；`exists(k)` 只认 `ALL`。
- `IMPLIED_VIEW`：`kind` 为 `edit` / `action` 的 → `screen + ":view"`。`withImplied` 不变。
- `isWrite(k)`：`kind` 为 `edit` / `action`。只读判定与占编辑锁都用它（§15.6），不再按 `:edit` 结尾判。
- `NOT_ELEVATABLE` 由规则算出：全部 `view`；系统管理层三屏的全部动作；`salary:edit`；`review:approve`、`lock:takeover`、`elevate:request`。其余可提权。
- `LEGACY_LABELS`：23 个旧键 → 人话名（§15.8），只给 `label()` 用，不进 `ALL`、不可勾。
- `DATA_SCREEN_VIEWS`：数据层 17 屏的查看（`data-home` 到 `utilities`，**不含 `import`**），只给租户别名明文用（§15.6）。`DATA_LAYER_VIEWS` 删掉。
- `needText(List<String>)`：403 与置灰文案里「需要什么」的写法（§15.6 第 6 行）。

「隐含」列：`本屏查看` = 勾它会带上本屏查看、装载时也展开；「提权」列：能不能请主管当场授权。

**数据中心**

| key | 中文名（屏上显示） | 说明（hint） | screen | kind | 隐含 | 提权 |
|---|---|---|---|---|---|---|
| `data-home:view` | 本月出账 · 查看 | 这个月每张表录没录、交没交审、审没审；催缴单那一步的金额另要「催缴单 · 查看」才显示 | data-home | view | — | 不可 |
| `buildings:view` | 楼栋管理 · 查看 | 楼栋、楼层、单元和面积 | buildings | view | — | 不可 |
| `buildings:edit` | 楼栋管理 · 编辑 | 新增、修改、删除楼栋、楼层和单元；单元面积会影响按面积分摊和按面积收的租金 | buildings | edit | 本屏查看 | 可 |
| `tenants:view` | 租户管理 · 查看 | 租户档案、分类和联系人；没有这一项时，别的屏上看到的租户联系人和电话只显示一部分 | tenants | view | — | 不可 |
| `tenants:edit` | 租户管理 · 编辑 | 新增、修改、删除租户 | tenants | edit | 本屏查看 | 可 |
| `contracts:view` | 合同管理 · 查看 | 合同列表、合同详情和租金计费行 | contracts | view | — | 不可 |
| `contracts:edit` | 合同管理 · 编辑 | 新增、编辑、续签、终止、删除合同，导入合同计费行；楼栋抽屉里的「新增合同」、导入中心的两块合同磁贴也要这一项 | contracts | edit | 本屏查看 | 可 |
| `params:view` | 计费参数 · 查看 | 单价、系数、户级例外、每月电价，以及它们的改动记录 | params | view | — | 不可 |
| `params:edit` | 计费参数 · 编辑 | 长期计费口径：常量、规则、户级例外、不计入的表 | params | edit | 本屏查看 | 可 |
| `params:monthly` | 计费参数 · 月度录入 | 每月照供电局账单填的电价和调整量，「复制上月电价」 | params | action | 本屏查看 | 可 |
| `params:recalc` | 计费参数 · 重算 | 「重算本月」：按改好的参数重新生成这个月的公共电核算、楼栋损耗和催缴单 | params | action | 本屏查看 | 可 |
| `meters:view` | 园区抄表 · 查看 | 每块表的读数、表档案和按月归属 | meters | view | — | 不可 |
| `meters:edit` | 园区抄表 · 编辑 | 录读数、改读数、导入抄表册、删掉本期读数 | meters | edit | 本屏查看 | 可 |
| `meters:archive` | 园区抄表 · 表档案 | 新增、删除电表，改倍率、表号、按月归属、在用 / 停用、和合同的绑定；导入抄表册时改倍率也要这一项 | meters | action | 本屏查看 | 可 |
| `alloc:view` | 公共电核算 · 查看 | 每个公摊池本月的用量、分摊结果和受益户 | alloc | view | — | 不可 |
| `alloc:edit` | 公共电核算 · 编辑 | 生成 / 重新生成本月公共电核算，交审 | alloc | edit | 本屏查看 | 可 |
| `alloc:pools` | 公共电核算 · 公摊池配置 | 新增、修改、删除公摊池：受益户、绑的表、折入关系 | alloc | action | 本屏查看 | 可 |
| `alloc-loss:view` | 楼栋损耗 · 查看 | 每栋楼本月的损耗和备注 | alloc-loss | view | — | 不可 |
| `alloc-loss:edit` | 楼栋损耗 · 编辑 | 改备注、重算本月、交审 | alloc-loss | edit | 本屏查看 | 可 |
| `bill-notices:view` | 催缴单 · 查看 | 每户催缴单、明细和收款簿；收款账号显示完整（单子要发给租户） | bill-notices | view | — | 不可 |
| `bill-notices:edit` | 催缴单 · 编辑 | 生成 / 重新生成本月催缴单、改单据备注、交审；在园区抄表里删读数或删表时连带删草稿催缴单也要这一项 | bill-notices | edit | 本屏查看 | 可 |
| `bill-notices:issue` | 催缴单 · 签发 | 确认、取消确认、作废、标记已导出、指定收款公司；单子发出去就收不回 | bill-notices | action | 本屏查看 | 可 |
| `bill-notices:coef` | 催缴单 · 系数簿 | 在「系数簿」里改每户的单价系数和电梯 / 消防层份 | bill-notices | action | 本屏查看 | 可 |
| `bill-notices:payee` | 催缴单 · 收款公司 | 在「收款公司」里改公司名称、加改删收款账户；报表屏上给公司改名也要这一项 | bill-notices | action | 本屏查看 | 可 |
| `ledger:view` | 月度台账 · 查看 | 各公司每月台账，账册模板的历史版本 | ledger | view | — | 不可 |
| `ledger:edit` | 月度台账 · 编辑 | 录入、导入、从上月复制、绑定租户、交审 | ledger | edit | 本屏查看 | 可 |
| `ledger:template` | 月度台账 · 账册模板 | 改列名、别名、列宽，增删自定义列（升一版模板） | ledger | action | 本屏查看 | 可 |
| `ledger:version` | 月度台账 · 更换版本 | 给还没录数的月份换一版账册模板 | ledger | action | 本屏查看 | 可 |
| `ledger:company` | 月度台账 · 新增删除公司 | 新增记账公司（同时建台账册）；删除公司会连同它全部台账和报表数据一起删掉，不能恢复。报表屏的新增 / 删除公司、收款公司里的新增公司也要这一项 | ledger | action | 本屏查看 | 可 |
| `sales-income:view` | 附表10 销售收入 · 查看 | 四本期区册每月的销售收入 | sales-income | view | — | 不可 |
| `sales-income:edit` | 附表10 销售收入 · 编辑 | 录入、导入、删除、绑定租户、交审 | sales-income | edit | 本屏查看 | 可 |
| `sales-income:template` | 附表10 销售收入 · 账册模板 | 改列名、别名、列宽，增删自定义列（升一版模板） | sales-income | action | 本屏查看 | 可 |
| `sales-income:version` | 附表10 销售收入 · 更换版本 | 给还没录数的月份换一版账册模板 | sales-income | action | 本屏查看 | 可 |
| `salary:view` | 附表12 工资明细 · 查看 | 逐人逐月工资明细 | salary | view | — | 不可 |
| `salary:edit` | 附表12 工资明细 · 编辑 | 新增、改备注、删除、导入（含导入中心）、交审；不能请主管当场授权 | salary | edit | 本屏查看 | **不可** |
| `pv-income:view` | 附表6 光伏发电 · 查看 | 报送台账和分栋运营账两本 | pv-income | view | — | 不可 |
| `pv-income:edit` | 附表6 光伏发电 · 编辑 | 报送台账的录入、导入、删除、交审 | pv-income | edit | 本屏查看 | 可 |
| `pv-income:archive` | 附表6 光伏发电 · 电站档案 | 新增、修改、删除电站（含上网单价），模拟填充 | pv-income | action | 本屏查看 | 可 |
| `pv-income:reading` | 附表6 光伏发电 · 分栋读数 | 分栋运营账的抄表记录录入、导入、删除 | pv-income | action | 本屏查看 | 可 |
| `car-charging:view` | 附表7 汽车充电桩 · 查看 | 报送台账和分桩运营账两本（汽车桩） | car-charging | view | — | 不可 |
| `car-charging:edit` | 附表7 汽车充电桩 · 编辑 | 报送台账的录入、导入、删除、交审 | car-charging | edit | 本屏查看 | 可 |
| `car-charging:archive` | 附表7 汽车充电桩 · 桩库 | 新增、修改、删除汽车充电桩 | car-charging | action | 本屏查看 | 可 |
| `car-charging:reading` | 附表7 汽车充电桩 · 分桩读数 | 汽车桩的充电记录和电表用电量录入、导入、删除；「模拟填充」要汽车、电动车两屏的这一项都有 | car-charging | action | 本屏查看 | 可 |
| `ebike-charging:view` | 附表8 电动车充电桩 · 查看 | 报送台账和分桩运营账两本（电动车桩） | ebike-charging | view | — | 不可 |
| `ebike-charging:edit` | 附表8 电动车充电桩 · 编辑 | 报送台账的录入、导入、删除、交审 | ebike-charging | edit | 本屏查看 | 可 |
| `ebike-charging:archive` | 附表8 电动车充电桩 · 桩库 | 新增、修改、删除电动车充电桩 | ebike-charging | action | 本屏查看 | 可 |
| `ebike-charging:reading` | 附表8 电动车充电桩 · 分桩读数 | 电动车桩的充电记录和电表用电量录入、导入、删除；「模拟填充」要汽车、电动车两屏的这一项都有 | ebike-charging | action | 本屏查看 | 可 |
| `elec-cost:view` | 附表11 电费成本 · 查看 | 报送台账和园区电费模型两本 | elec-cost | view | — | 不可 |
| `elec-cost:edit` | 附表11 电费成本 · 编辑 | 报送台账和电费模型的费项录入、导入、电表增删、交审 | elec-cost | edit | 本屏查看 | 可 |
| `elec-cost:price` | 附表11 电费成本 · 电价口径 | 电费模型里的电价参数，模拟填充 | elec-cost | action | 本屏查看 | 可 |
| `utilities:view` | 办公·三期水电 · 查看 | 办公室和三期的逐月水电 | utilities | view | — | 不可 |
| `utilities:edit` | 办公·三期水电 · 编辑 | 录入、导入、删除、交审 | utilities | edit | 本屏查看 | 可 |
| `import:view` | 导入中心 · 查看 | 导入记录：文件名、行数、谁导的；每块导入磁贴另按它导进去的那一屏的编辑权显示 | import | view | — | 不可 |
| `import:edit` | 导入中心 · 编辑 | 导入年度预算（预算只在导入中心导） | import | edit | 本屏查看 | 可 |

**账簿与报表**

| key | 中文名 | 说明 | screen | kind | 隐含 | 提权 |
|---|---|---|---|---|---|---|
| `reports-home:view` | 报表中心 · 查看 | 本期各张报表做没做、勾稽对不对；看不了的报表照样列出，卡片上写明缺哪一项 | reports-home | view | — | 不可 |
| `income-statement:view` | 利润表 · 查看 | 各公司和全部汇总的利润表 | income-statement | view | — | 不可 |
| `income-statement:edit` | 利润表 · 编辑 | 改数、增删子类、导入、交审 | income-statement | edit | 本屏查看 | 可 |
| `balance-sheet:view` | 资产负债表 · 查看 | 各公司和全部汇总的资产负债表 | balance-sheet | view | — | 不可 |
| `balance-sheet:edit` | 资产负债表 · 编辑 | 改数、增删子类、导入、交审 | balance-sheet | edit | 本屏查看 | 可 |
| `trial-balance:view` | 科目余额表 · 查看 | 各公司的科目余额 | trial-balance | view | — | 不可 |
| `trial-balance:edit` | 科目余额表 · 编辑 | 改数、增删科目、导入、交审 | trial-balance | edit | 本屏查看 | 可 |
| `rent-pnl:view` | 附表1 租金损益 · 查看 | 逐月数和取自台账附表的对照数 | rent-pnl | view | — | 不可 |
| `rent-pnl:edit` | 附表1 租金损益 · 编辑 | 改数、导入 | rent-pnl | edit | 本屏查看 | 可 |
| `elec-pnl:view` | 附表2 用电损益 · 查看 | 同上 | elec-pnl | view | — | 不可 |
| `elec-pnl:edit` | 附表2 用电损益 · 编辑 | 改数、导入 | elec-pnl | edit | 本屏查看 | 可 |
| `water-pnl:view` | 附表3 用水损益 · 查看 | 同上 | water-pnl | view | — | 不可 |
| `water-pnl:edit` | 附表3 用水损益 · 编辑 | 改数、导入 | water-pnl | edit | 本屏查看 | 可 |
| `ops-pnl:view` | 附表4 运管损益 · 查看 | 同上 | ops-pnl | view | — | 不可 |
| `ops-pnl:edit` | 附表4 运管损益 · 编辑 | 改数、导入 | ops-pnl | edit | 本屏查看 | 可 |
| `expense-pnl:view` | 附表5 费用支出 · 查看 | 同上 | expense-pnl | view | — | 不可 |
| `expense-pnl:edit` | 附表5 费用支出 · 编辑 | 改数、导入 | expense-pnl | edit | 本屏查看 | 可 |
| `reconciliation:view` | 收入核对 · 查看 | 台账和附表10 的逐户对账 | reconciliation | view | — | 不可 |
| `reconciliation:edit` | 收入核对 · 编辑 | 标记已核实、取消核实 | reconciliation | edit | 本屏查看 | 可 |

**经营分析**（20 屏都只读数据；6 屏的「编辑」是改弹层「目标与阈值」里归它的那一项，全园共用一份）

| key | 中文名 | 说明 | screen | kind | 隐含 | 提权 |
|---|---|---|---|---|---|---|
| `cockpit:view` | 经营驾驶舱 · 查看 | 收入、出租、收缴、异常的总览 | cockpit | view | — | 不可 |
| `anomaly:view` | 异常提醒中心 · 查看 | 用能突变、欠费、光伏发电异常等提醒 | anomaly | view | — | 不可 |
| `anomaly:edit` | 异常提醒中心 · 编辑 | 改「能耗突变阈值」（全园共用） | anomaly | edit | 本屏查看 | 可 |
| `park:view` | 出租与楼栋 · 查看 | 出租率、楼栋与楼层出租情况 | park | view | — | 不可 |
| `park:edit` | 出租与楼栋 · 编辑 | 改「出租率目标」（全园共用） | park | edit | 本屏查看 | 可 |
| `park-energy:view` | 园区能耗 · 查看 | 园区用电、用水、充电、光伏的逐月对比 | park-energy | view | — | 不可 |
| `tenant-energy:view` | 用能与缴费 · 查看 | 逐户用能和缴费 | tenant-energy | view | — | 不可 |
| `tenant-portfolio:view` | 结构与续约 · 查看 | 租户行业结构、面积结构和续约 | tenant-portfolio | view | — | 不可 |
| `tenant-peer:view` | 租户对标 · 查看 | 选中一户，看它在同类租户里的位置 | tenant-peer | view | — | 不可 |
| `fin-pnl:view` | 利润表分析 · 查看 | 收入、成本、利润的趋势和预算对比 | fin-pnl | view | — | 不可 |
| `fin-balance:view` | 资产负债分析 · 查看 | 资产负债结构和变化 | fin-balance | view | — | 不可 |
| `fin-cashflow:view` | 现金流量分析 · 查看 | 收缴率、欠费和账龄；导出催缴清单 | fin-cashflow | view | — | 不可 |
| `fin-cashflow:edit` | 现金流量分析 · 编辑 | 改「收缴率目标」（全园共用） | fin-cashflow | edit | 本屏查看 | 可 |
| `fin-expense:view` | 费用与报销 · 查看 | 费用支出的结构和趋势 | fin-expense | view | — | 不可 |
| `churn:view` | 租户流失预警 · 查看 | 按缴费和用能给每户打的流失风险分 | churn | view | — | 不可 |
| `churn:edit` | 租户流失预警 · 编辑 | 改「流失风险线」（全园共用，异常提醒中心也用这条线） | churn | edit | 本屏查看 | 可 |
| `expiry:view` | 到期墙与续约 · 查看 | 合同按月到期分布 | expiry | view | — | 不可 |
| `breakeven:view` | 盈亏平衡与敏感性 · 查看 | 盈亏平衡点和各因素的影响 | breakeven | view | — | 不可 |
| `breakeven:edit` | 盈亏平衡与敏感性 · 编辑 | 改「固定成本占比」（全园共用，滑杆松手就存） | breakeven | edit | 本屏查看 | 可 |
| `budget:view` | 预算对比 · 查看 | 预算和实际的逐项对比 | budget | view | — | 不可 |
| `pnl-analysis:view` | 损益附表分析 · 查看 | 五张损益附表的汇总分析 | pnl-analysis | view | — | 不可 |
| `pv-roi:view` | 光伏投资回收 · 查看 | 光伏累计收益和回收进度 | pv-roi | view | — | 不可 |
| `pv-roi:edit` | 光伏投资回收 · 编辑 | 改「光伏投资额」（全园共用） | pv-roi | edit | 本屏查看 | 可 |
| `pv-meter-analysis:view` | 光伏分栋分析 · 查看 | 逐栋发电、利用小时和异常 | pv-meter-analysis | view | — | 不可 |
| `elec-analysis:view` | 电费成本分析 · 查看 | 园区电费成本结构和单价 | elec-analysis | view | — | 不可 |
| `charging-analysis:view` | 充电桩分析 · 查看 | 汽车、电动车充电量和收入 | charging-analysis | view | — | 不可 |

**系统管理**（全部不可提权：能当场借到的话，一次授权就能换一个永久管理员账号，§11.2 规则 6 同理）

| key | 中文名 | 说明 | screen | kind | 隐含 | 提权 |
|---|---|---|---|---|---|---|
| `sys-users:view` | 用户管理 · 查看 | 账号列表和每个账号挂的角色 | sys-users | view | — | 不可 |
| `sys-users:edit` | 用户管理 · 编辑 | 新建账号、改显示名和角色、停用 / 启用、重置密码 | sys-users | edit | 本屏查看 | 不可 |
| `sys-roles:view` | 角色权限 · 查看 | 每个角色勾了哪些权限、有哪些成员 | sys-roles | view | — | 不可 |
| `sys-roles:edit` | 角色权限 · 编辑 | 新建、修改、删除角色，添加和移出角色成员 | sys-roles | edit | 本屏查看 | 不可 |
| `sys-logs:view` | 操作日志 · 查看 | 谁在什么时候改了什么；只列你看得了的那几屏的记录 | sys-logs | view | — | 不可 |

**跨屏（原键原义，不动）**

| key | 中文名 | 说明 | screen | kind | 隐含 | 提权 |
|---|---|---|---|---|---|---|
| `review:approve` | 审核 | 通过 / 退回 / 撤销某张表某个月的审核；已审核的表任何人都改不了，只有审核员能撤销 | — | other | — | 不可 |
| `lock:takeover` | 编辑锁 · 授权 | 别人正在编辑时，授权他人接管（不是自己接管） | — | other | — | 不可 |
| `elevate:request` | 可请求提权 | 遇到没权限的操作时，能请主管当场输密码授权 30 分钟；不给这项的账号连编辑模式按钮都看不到 | — | other | — | 不可 |

合计：查看 51 + 编辑 34（数据 17、报表 9、分析 6、系统 2）+ 专有动作 19 + 跨屏 3 = **107**。最长的键 `pv-meter-analysis:view` 22 个字符，`auth_role_perm.perm` 是 `varchar(32)`，不用改列。

### 15.3 旧键 → 新键（V140 用）

规则只有两条：

- **查看**：一个角色在 v3 下能打开哪一屏（`navAccess.ts` 的进屏门；编辑隐含的查看也算），就给那一屏的 `:view`。
- **动作**：旧编辑键映射到新动作，**只在这个角色已经能看那一屏时才给**。大多数映射旧键自己就带出那一屏的查看（`entry:edit` → 台账查看 → 月度台账），等于无条件；
  标「需本屏查看」的几行是跨模块的，没有那一屏查看的角色不给 —— 不然 K2 的「动作隐含本屏查看」会让它凭空多看到一屏。

| v3 键 | 给的查看（只要角色有这一键） | 给的动作 | 条件 |
|---|---|---|---|
| `master:view` | buildings、tenants、data-home、import | — | |
| `master:edit` | 同 `master:view`（编辑隐含查看） | `buildings:edit`、`tenants:edit` | |
| | | `bill-notices:payee` | 需本屏查看（`billing:*`） |
| `company:manage` | 同 `master:view` | `ledger:company` | 需本屏查看（`entry:*`） |
| `contract:view` | contracts、data-home、import | — | |
| `contract:edit` | 同上 | `contracts:edit` | |
| `param:view` | params、data-home、import | — | |
| `param-policy:edit` | 同 `param:view` | `params:edit` | |
| | | `alloc:pools`、`bill-notices:coef` | 需本屏查看（`billing:*`） |
| | | `elec-cost:price` | 需本屏查看（`entry:*`） |
| `param-monthly:edit` | 同 `param:view` | `params:monthly` | |
| `meter:view` | meters、pv-income、car-charging、ebike-charging、data-home、import | — | |
| `meter-master:edit` | 同 `meter:view` | `meters:archive`、`pv-income:archive`、`car-charging:archive`、`ebike-charging:archive` | |
| `meter-reading:edit` | 同 `meter:view` | `meters:edit`、`pv-income:reading`、`car-charging:reading`、`ebike-charging:reading` | |
| `billing:view` | alloc、alloc-loss、bill-notices、data-home、import | — | |
| `billing-run:edit` | 同 `billing:view` | `alloc:edit`、`alloc-loss:edit`、`bill-notices:edit` | |
| | | `params:recalc` | 需本屏查看（`param:*`） |
| `billing-issue:edit` | 同 `billing:view` | `bill-notices:issue` | |
| `entry:view` | ledger、sales-income、pv-income、car-charging、ebike-charging、elec-cost、utilities、data-home、import | — | |
| `entry:edit` | 同 `entry:view` | `ledger:edit`、`sales-income:edit`、`pv-income:edit`、`car-charging:edit`、`ebike-charging:edit`、`elec-cost:edit`、`utilities:edit`、`import:edit` | |
| `book-template:edit` | 同 `entry:view` | `ledger:template`、`sales-income:template` | |
| `book-template:switch` | 同 `entry:view` | `ledger:version`、`sales-income:version` | |
| `salary:view` | salary（**键名不变**）、data-home、import | — | |
| `salary:edit` | 同 `salary:view` | `salary:edit`（**键名不变**） | |
| `report:view` | 报表层 10 屏、import | — | |
| `report:edit` | 同 `report:view` | 报表层 9 个 `:edit`（利润表、资产负债表、科目余额表、附表1–5、收入核对） | |
| | | `park:edit`、`anomaly:edit`、`fin-cashflow:edit`、`churn:edit`、`breakeven:edit`、`pv-roi:edit` | 需本屏查看（`analysis:view`） |
| `analysis:view` | 分析层 20 屏 | — | |
| `system:view` | sys-users、sys-roles、sys-logs | — | |
| `system:edit` | 同 `system:view` | `sys-users:edit`、`sys-roles:edit` | |
| `review:approve`、`lock:takeover`、`elevate:request` | — | 原键保留 | |

**v3 里两个模块查看任一就能看的屏**（K5）：

| 屏 | v3 进屏门 | v4 | 对只勾了其中一个的自建角色 |
|---|---|---|---|
| 附表6 光伏发电、附表7 / 附表8 充电桩 | `entry:view` 或 `meter:view`；`?mode=summary` 只认前者、`?mode=meter` 只认后者，左栏只列看得了的那本 | 一个 `<屏>:view` 看两本；写按本分（报送台账 = `:edit`，档案 / 读数 = 两个专有动作） | **扩大**：只有其中一个模块查看的角色，迁移后两本都看得到（多看到另一本的数）。报送台账、档案、读数的写不扩大；充电桩「模拟填充」见下一张表 |
| 本月出账 | 七个数据模块查看任一 | `data-home:view` | 不变：七个任一都给。催缴单那一步的金额改认「催缴单 · 查看」，迁移后与 v3 的 `billing:view` 同一批人 |
| 导入中心 | 七个数据模块查看任一，或 `report:view` | `import:view` | 不变。注意：园区股东（只有报表、分析查看）v3 就能打开导入中心看导入记录，迁移后照旧有这一项；他的导航层里没有数据中心，入口本来就不显示 |

**动作挂到别的屏之后，自建角色能改的会变的几处**（预置 7 角色都不受影响，15.4 逐格相等）：

| 动作 | v3 判据 | v4 | 对自建角色 |
|---|---|---|---|
| 充电桩「模拟填充」（只在园区工具打开时有这个按钮） | `billing-run:edit`，且打得开分桩运营账（抄表查看） | 汽车、电动车两屏的 `:reading` 都要 | **会变**：有抄表录入、没有出账运行的角色**多了**这个入口；有出账运行和抄表查看、没有抄表录入的角色**少了**它。理由：模拟填充一次写两种桩一整年的充电记录，是录读数，不是出账运行；要守 v3 的判据得在两屏各加一个「模拟填充」动作，只为一个园区工具按钮不值 |
| 利润表、资产负债表、科目余额表上给公司**改名** | `master:edit`（加报表查看就能进屏） | `bill-notices:payee`，迁移时要有催缴单查看才给 | **缩小**：有主数据编辑和报表查看、没有出账查看的角色，迁移后报表屏上的「改名」没了 |
| 报表屏上**新增 / 删除公司**、报表导入时自动建公司 | `company:manage`（新增删除按钮另要 `master:edit` 才画） | `ledger:company`，迁移时要有台账查看才给 | **缩小**：有公司管理和报表查看、没有台账查看的角色失去这几个入口 |

后两行偏离了用户拍板①「能看能改的一屏不变」，只落在自建角色上。系统管理员要补回，只能给这个角色勾「催缴单 · 收款公司」/「月度台账 · 新增删除公司」——
动作隐含本屏查看，会连带多看到催缴单 / 月度台账一屏；不想多给就只能接受缩小。要做到真不变，得把公司改名、新增删除做成不挂屏的两项（和审核一样放进「不分屏的权限」），
那就不是「挂到实际承载它的那一屏」了（**待定**，要拍板）；本节先按挂屏走，§15.8 ③ 给一条只读 SQL，部署后按角色列出这三行碰到的角色。

### 15.4 预置 7 角色 × 屏的等价核对

v3 有效权限 = 「能打开这一屏」且「有那一项编辑键」；v4 = 有 `<屏>:<动作>`。按 15.3 迁移后**逐格相同**，下表即两边共同的结果（种子库 `db/baseline/V137__baseline.sql:1293-1393` 的预置权限）。
`RbacScreenPermsMigrationIT` 把下表逐格钉住（§15.10）。看 = 查看，编 = 编辑，其余写动作名，— = 什么都没有。

| 屏 | v3 判据 | 系统管理员 | 财务主管 | 财务专员 | 总经理 | 园区股东 | 只读账号 | 审核员 |
|---|---|---|---|---|---|---|---|---|
| 本月出账 | 七个数据查看任一 | 看 | 看 | 看 | 看 | — | 看 | 看 |
| 楼栋管理、租户管理 | 看 master:view；编 master:edit | 看 编 | 看 编 | 看 | 看 | — | 看 | 看 |
| 合同管理 | contract:view / contract:edit | 看 编 | 看 编 | 看 | 看 | — | 看 | 看 |
| 计费参数 | param:view；编 param-policy；月度录入 param-monthly；重算 billing-run | 看 编 月度录入 重算 | 看 编 月度录入 重算 | 看 重算 | 看 | — | 看 | 看 |
| 园区抄表 | meter:view；编 meter-reading；表档案 meter-master | 看 编 表档案 | 看 编 表档案 | 看 编 | 看 | — | 看 | 看 |
| 公共电核算 | billing:view；编 billing-run；公摊池配置 param-policy | 看 编 公摊池配置 | 看 编 公摊池配置 | 看 编 | 看 | — | 看 | 看 |
| 楼栋损耗 | billing:view；编 billing-run | 看 编 | 看 编 | 看 编 | 看 | — | 看 | 看 |
| 催缴单 | billing:view；编 billing-run；签发 billing-issue；系数簿 param-policy；收款公司 master:edit | 看 编 签发 系数簿 收款公司 | 看 编 签发 系数簿 收款公司 | 看 编 | 看 | — | 看 | 看 |
| 月度台账 | entry:view；编 entry:edit；模板 book-template:edit；换版 book-template:switch；新增删除公司 company:manage | 看 编 账册模板 更换版本 新增删除公司 | 看 编 | 看 编 | 看 | — | 看 | 看 |
| 附表10 销售收入 | entry:view；编 entry:edit；模板 / 换版同上 | 看 编 账册模板 更换版本 | 看 编 | 看 编 | 看 | — | 看 | 看 |
| 附表12 工资明细 | salary:view / salary:edit | 看 编 | 看 编 | — | — | — | — | — |
| 附表6 / 7 / 8 | entry 或 meter 查看；编 entry:edit；档案 / 桩库 meter-master；读数 meter-reading | 看 编 档案 读数 | 看 编 档案 读数 | 看 编 读数 | 看 | — | 看 | 看 |
| 附表11 电费成本 | entry:view；编 entry:edit；电价口径 param-policy | 看 编 电价口径 | 看 编 电价口径 | 看 编 | 看 | — | 看 | 看 |
| 办公·三期水电 | entry:view / entry:edit | 看 编 | 看 编 | 看 编 | 看 | — | 看 | 看 |
| 导入中心 | 七个数据查看或 report:view；编（预算）entry:edit | 看 编 | 看 编 | 看 编 | 看 | 看 | 看 | 看 |
| 报表中心 | report:view | 看 | 看 | 看 | 看 | 看 | 看 | 看 |
| 利润表、资产负债表、科目余额表、附表1–5、收入核对（9 屏） | report:view / report:edit | 看 编 | 看 编 | 看 编 | 看 | 看 | 看 | 看 |
| 分析层 14 个只读屏 | analysis:view | 看 | 看 | 看 | 看 | 看 | 看 | 看 |
| 出租与楼栋、异常提醒中心、现金流量分析、租户流失预警、盈亏平衡、光伏投资回收 | analysis:view；编（目标与阈值）report:edit | 看 编 | 看 编 | 看 编 | 看 | 看 | 看 | 看 |
| 用户管理、角色权限 | system:view / system:edit | 看 编 | — | — | — | — | — | — |
| 操作日志 | system:view | 看 | — | — | — | — | — | — |
| 审核 / 编辑锁 · 授权 / 可请求提权 | 原键 | 三项都有 | 编辑锁 · 授权、可请求提权 | 可请求提权 | 可请求提权 | — | — | 审核 |

全部相等，没有需要写理由的格。屏上行为会变、但权限不变的几处（都是 v3 前端画了按钮、点下去后端 403 的地方，v4 改成不画或置灰）：
公共电核算在只有「出账运行」时画出的池配置入口、只有池配置时保存池后自动「重新生成」（要 `alloc:edit`）、报表屏「新增 / 删除公司」按主数据编辑画、收款公司窗「新增公司」同理、
收入核对「标记已核实」不判权、台账导入的列映射面板「映射到现有列 / 新建自定义列」不判权（要 `ledger:template`；财务专员导带新列的台账就卡在这一步）。

### 15.5 读规则表与写规则表（取代 §11.3 与 §5.2 的表）

三条铁律照旧（§5.2）：`PathPattern` 按段匹配；首个命中生效、具体的排在通配前；表里没有的一律拒绝。另加第四条：

4. **按屏拆的路径段只认字面值。** `/api/charging/{no}`（`int no`，`07`、`+7` 都会被转成 7）、`/api/pnl/{schedule}`、`/api/reports/{statement}`
   这三处按段拆到屏；拆完每处补一条**显式拒绝**规则（anyOf 为空）接住其余写法。空 anyOf：两个 AccessManager 直接拒，**不问提权**。
   覆盖率测试里模板路径（`/api/charging/{no}/records`）落在这条拒绝规则上算「已登记」，真实路径另由 §15.10 的屏矩阵测试钉住。

下面「anyOf」一列：读表里写屏 value，意思是 `<屏>:view`；写表里写完整的键。组名：

- **出账链** = data-home、params、meters、alloc、alloc-loss、bill-notices（`billingPeriod.loadChain` 的六个使用方）
- **分析全部** = 分析层 20 屏
- **损益五屏** = rent-pnl、elec-pnl、water-pnl、ops-pnl、expense-pnl（`pnlDerive.loadDeriveData` 每屏都拉 8 个接口，不按附表收窄）
- **损益分析** = cockpit、fin-pnl、fin-expense、breakeven、budget、pnl-analysis（`anaData.fetchPnlSummary` / `fetchPnlYear`）
- **台账读者** = cockpit、anomaly、park-energy + 损益五屏（`fetchAnomalyInputs`、`fetchElecYear` 等与 `pnlDerive`）

#### 15.5.1 读规则（GET，从上到下首个命中）

| # | 路径 | anyOf（屏的查看） | 依据：勘察清单里哪几屏调它 |
|---|---|---|---|
| 1 | `/api/auth/me` `/perms` `/elevate` `/approvals` `/approvals/candidates`、`/api/notices` `/system-seen`、`/api/review` `/states` `/closed-months` `/pending` `/returned`、`/api/zones`、`/api/probe/ok` `/boom`、`/api/app/config` | 任何已登录 | 不变（§11.2 规则 3） |
| 2 | `/api/system/perms` | sys-roles | 角色权限屏的权限字典 |
| 3 | `/api/system/roles` | sys-roles、sys-users | 角色权限屏；用户管理屏的角色勾选 |
| 4 | `/api/system/users` | sys-users、sys-roles | 用户管理屏；角色权限屏的成员栏与「添加成员」候选 |
| 5 | `/api/system/logs` | sys-logs | 操作日志屏 |
| 6 | `/api/analysis/s10-tenant-months` | cockpit、anomaly、park-energy、tenant-energy、tenant-peer、fin-cashflow、churn、breakeven | `fetchS10Rows` / `fetchS10PhaseMonthly` / `fetchS10TenantMap` / `fetchAnomalyInputs` 的调用屏 |
| 7 | `/api/analysis/ledger-tenant-months` | cockpit、anomaly、tenant-energy、fin-cashflow、churn | `fetchLedgerRows` / `fetchCollectRates` / `fetchAnomalyInputs` |
| 8 | `/api/analysis/**` | 分析全部 | `months`（AnaShell 挂载）、`settings`（进分析层的路由守卫） |
| 9 | `/api/tenants/summary` | tenants | 租户屏 KPI（分析层不调，v3 的 analysis 放行去掉） |
| 10 | `/api/tenants/{id}` | tenants | 租户抽屉 |
| 11 | `/api/tenants` | tenants、contracts、params、meters、alloc、ledger、sales-income、park、tenant-energy、tenant-portfolio、tenant-peer、fin-cashflow | 合同新增弹窗、计费参数与核算的主数据、抄表、台账 / 附表10 对户、分析五屏 |
| 12 | `/api/tenant-categories` | tenants | 租户抽屉与弹窗 |
| 13 | `/api/buildings/summary` | buildings、park | |
| 14 | `/api/buildings/{id}` | buildings、contracts、park | 合同弹窗逐栋取单元；出租与楼栋点一栋（修 v3 缺口） |
| 15 | `/api/buildings` | buildings、contracts、params、meters、alloc、bill-notices、park、tenant-peer | |
| 16 | `/api/companies/payees` | bill-notices | 催缴单屏与导出窗 |
| 17 | `/api/companies` | ledger、bill-notices、income-statement、balance-sheet、trial-balance、fin-pnl、fin-balance、fin-cashflow | 台账左轨、收款公司 / 收款簿窗、三大报表、分析三屏 |
| 18 | `/api/contracts/summary` | contracts | |
| 19 | `/api/contracts/{id}/terminate-preview` | contracts | |
| 20 | `/api/contracts/{id}` | contracts、tenant-peer | |
| 21 | `/api/contracts` | contracts、bill-notices、park、tenant-portfolio、tenant-peer、expiry | |
| 22 | `/api/params/status` | 出账链 | `loadChain` 与各屏 loadMonth |
| 23 | `/api/params` | params、alloc、alloc-loss、bill-notices、anomaly、pv-meter-analysis | 核算 / 损耗 / 系数簿读系数；光伏判据。`key`、`scope` 都可不带、不带就回当月全表，所以**回包再按屏收窄**（§15.6 ParamController 行）：没有计费参数查看的人只拿到自己那几屏要的键 |
| 24 | `/api/params/**` | params | history、changes、months |
| 25 | `/api/price-cfg` | params | 旧接口，没有屏在调，归计费参数 |
| 26 | `/api/alloc/rules` | params、alloc、bill-notices | 计费参数的池所在期、核算、系数簿 |
| 27 | `/api/alloc/cfg` | params | 没有屏在调 |
| 28 | `/api/alloc/pool-months`、`/api/alloc/loss-months` | 出账链 | |
| 29 | `/api/alloc/pools` | alloc、bill-notices | 系数簿按生效月取池 |
| 30 | `/api/alloc/loss` | alloc-loss | |
| 31 | `/api/alloc/**` | alloc | pool-candidates、member-diff、meter-diff；没有屏在调的 years、result（分摊结果，本屏自己的产物）、recon 一并归它。recon 回包里另有楼栋损耗那几行和一个电费成本合计，两屏都不调它，分不出单一归属，暂归本屏，列为下线候选 |
| 32 | `/api/bill-notices/months` | 出账链 | |
| 33 | `/api/bill-notices/**` | bill-notices | 列表、`{id}`、notes |
| 34a | `/api/bills/paymap` | bill-notices | 催缴单屏、收款簿窗 |
| 34b | `/api/bills/s10` | sales-income | 没有屏在调；回的是某期全部附表10 逐户行，归附表10（不能挂催缴单：只勾「催缴单 · 查看」的人会读到附表10 的逐户数） |
| 34c | `/api/bills` | ledger | 没有屏在调；回的是某期台账 × 租户 × 公司的全部行，归月度台账，理由同上 |
| 35 | `/api/data-home/**` | data-home | |
| 36 | `/api/meters/months` | 出账链 | |
| 37 | `/api/meters/{id}/readings` | meters、alloc | 池抽屉移出表前确认 |
| 38 | `/api/meters` | meters、params、alloc | |
| 39 | `/api/meters/**` | meters | readings、binding、timeline、status-impact、delete-impact、delete-preview、years、usage-summary |
| 40 | `/api/pv-meter/months` | pv-income、anomaly | 异常中心光伏卡首调（修 v3 缺口） |
| 41 | `/api/pv-meter/stations`、`/api/pv-meter/readings` | pv-income、anomaly、pv-meter-analysis | |
| 42 | `/api/pv-meter/**` | pv-income | years |
| 43 | `/api/cp-meter/months` | car-charging、ebike-charging | 带 `?vehicleType`，service 再按车型判（§15.6） |
| 44 | `/api/cp-meter/**` | car-charging、ebike-charging、charging-analysis | stations、readings、power-usage、years；回包按车型过滤（§15.6） |
| 45 | `/api/elec-cost/price-cfg` | elec-cost、pv-meter-analysis、elec-analysis | 计费参数屏不调，v3 的 param 放行去掉 |
| 46 | `/api/elec-cost/meters`、`/entries`、`/metrics-year` | elec-cost、elec-analysis | |
| 47 | `/api/elec-cost/**` | elec-cost | months、metrics、years |
| 48 | `/api/budget/all` | cockpit、fin-pnl、budget | |
| 49 | `/api/books/**` | ledger、sales-income | 账册清单与模板版本（列名，不含金额），不再按账册细分；导入中心的台账 / 附表10 磁贴要目标屏编辑，编辑隐含查看 |
| 50 | `/api/ledger/**` | ledger | 导入中心台账单段导入的覆盖预检要台账编辑，隐含查看 |
| 51 | `/api/s10/overview` | sales-income | |
| 52 | `/api/s10/year-summary` | sales-income、损益五屏 | |
| 52a | `/api/s10/month-totals`（新） | reports-home、sales-income | 报表中心勾稽③（营业收入交叉）只要四个期区的月合计：`{1: 合计, 2: …, 3: …, 4: …}`，逐个取 `S10Service.month(期区, 年, 月).grandTotal`（含自定义列，和现在前端取的是同一个数），不带租户。不改用 year-summary：它只加 25 个固定列、不含自定义列，有自定义列的月份两边对不上 |
| 53 | `/api/s10/**` | sales-income | `{phase}/{y}/{m}` 逐租户宽表只给附表10 本屏。报表中心不再读它：v3 让 `report:view` 读整张宽表，只为取一个合计 |
| 54 | `/api/pv/records` | pv-income、park-energy、pv-roi、损益五屏 | |
| 55 | `/api/pv/phases` | pv-income、pv-roi | |
| 56 | `/api/pv/overview` | pv-income、park-energy、pv-roi | `fetchPvAll` |
| 57 | `/api/pv/**` | pv-income | |
| 58 | `/api/charging/7/records` | car-charging、台账读者 | |
| 59 | `/api/charging/8/records` | ebike-charging、台账读者 | |
| 60 | `/api/charging/7/**` | car-charging | cats、overview |
| 61 | `/api/charging/8/**` | ebike-charging | |
| 62 | `/api/charging/**` | **拒绝** | 铁律 4 |
| 63 | `/api/elec/records` | elec-cost、台账读者 | |
| 64 | `/api/elec/**` | elec-cost | phases、overview |
| 65 | `/api/utilities/*/records` | utilities、台账读者 | 13、14 一视同仁（一屏两个页签） |
| 66 | `/api/utilities/**` | utilities | overview |
| 67 | `/api/import-log/**` | import | 导入记录 |
| 68 | `/api/salary/lunch-totals` | salary、损益五屏 | |
| 69 | `/api/salary/**` | salary | |
| 70 | `/api/pnl/s1/overview` | rent-pnl | 报表中心只在看得了附表1 时才取（§15.7） |
| 71 | `/api/pnl/s1/*` | rent-pnl、损益分析 | |
| 72–79 | `/api/pnl/s2…s5/overview`、`/api/pnl/s2…s5/*` | 同上，换成 elec-pnl / water-pnl / ops-pnl / expense-pnl | |
| 80 | `/api/pnl/**` | **拒绝** | 铁律 4 |
| 81 | `/api/reports/is/all/*/*` | income-statement、fin-pnl、fin-balance | 报表中心只在看得了利润表时才取 |
| 82 | `/api/reports/is/*/*/*` | income-statement、fin-pnl、fin-balance | |
| 83 | `/api/reports/is/**` | income-statement | years、整年 |
| 84 | `/api/reports/bs/all/*/*`、`/api/reports/bs/*/*/*` | balance-sheet、fin-balance | |
| 85 | `/api/reports/bs/**` | balance-sheet | |
| 86 | `/api/reports/tb/**` | trial-balance | 科目余额表不给分析（科目名里有疑似账号片段，§11.3 原理由） |
| 87 | `/api/reports/**` | **拒绝** | 铁律 4 |
| 88 | `/api/recon/**` | reconciliation | 报表中心、本月出账只在看得了收入核对时才取 |

#### 15.5.2 写规则（非 GET，从上到下首个命中）

| # | 方法 路径 | anyOf | 依据 / 另有 service 判 |
|---|---|---|---|
| 1 | POST `/api/auth/elevate`、POST `/api/auth/approvals` | `elevate:request` | 不变。**必须排在第 2 行前面**：`PathPattern` 的 `/api/auth/approvals/**` 也匹配 `/api/auth/approvals` 本身（spring-web 6.1.14 实测），顺序反了只读账号也能发远程授权请求（`ApprovalService.request` 不再判 `elevate:request`）。v3 就是这个顺序 |
| 2 | POST `/api/import-log`、POST `/api/auth/change-password`、POST `/api/auth/logout`、DELETE `/api/auth/elevate`、POST `/api/auth/approvals/**`（批准 `/{id}`）、DELETE `/api/auth/approvals/*`、`/api/locks/**`、`/api/presence/**`、`/api/notices/**` | 任何已登录 | 不变 |
| 3 | POST `/api/alloc/rules` | `alloc:pools` | 公共电核算「新增池」 |
| 4 | PUT `/api/alloc/rules/*` | `alloc:pools`、`bill-notices:coef` | 核算池抽屉；系数簿改层份。**service**：只有系数簿的人只许改二期电梯 / 消防池的层份（§15.6） |
| 5 | `/api/alloc/rules/**` | `alloc:pools` | 删池等 |
| 6 | `/api/alloc/cfg` | `params:edit` | 没有屏在调；service 按键再判 |
| 7 | POST `/api/alloc/generate` | `alloc:edit`、`alloc-loss:edit` | 两屏都调 |
| 8 | PUT `/api/alloc/loss/note` | `alloc-loss:edit` | |
| 9 | `/api/alloc/**` | `alloc:edit` | result/manual 等 |
| 10 | POST `/api/params/recalc` | `params:recalc` | |
| 11 | PUT `/api/params` | `params:edit`、`params:monthly`、`bill-notices:coef` | 计费参数各区；系数簿改户级单价。**service** 按键判：系数簿只认 12 个白名单键（§15.6） |
| 12 | `/api/params/**` | `params:edit`、`params:monthly` | |
| 13 | POST `/api/price-cfg/copy` | `params:monthly` | 「复制上月电价」 |
| 14 | `/api/price-cfg`、`/api/price-cfg/**` | `params:edit` | service 按键再判 |
| 15 | `/api/elec-cost/price-cfg`、POST `/api/elec-cost/simulate` | `elec-cost:price` | |
| 16 | `/api/elec-cost/**` | `elec-cost:edit` | |
| 17 | `/api/bills/paymap` | `bill-notices:issue` | 抽屉收款槽、收款簿 |
| 18 | `/api/bills/**` | `bill-notices:edit` | |
| 19 | `/api/bill-notices/confirm` `/unconfirm` `/mark-exported` `/{id}/issue` `/{id}/void` | `bill-notices:issue` | |
| 20 | `/api/bill-notices/**` | `bill-notices:edit` | 生成、备注 |
| 21 | `/api/meters/readings`、`/api/meters/readings/**`、POST `/api/meters/import` | `meters:edit` | 导入里改倍率另由 service 判 `meters:archive` |
| 22 | `/api/meters`、`/api/meters/**` | `meters:archive` | 新增表、改档案、归属、状态、撤销导入批次、绑定、一键挂、删表（删表 / 删本期连带删草稿单另判 `bill-notices:edit`） |
| 23 | `/api/pv-meter/stations`、`/stations/**`、POST `/api/pv-meter/simulate` | `pv-income:archive` | |
| 24 | `/api/pv-meter/**` | `pv-income:reading` | |
| 25 | `/api/cp-meter/stations`、`/stations/**` | `car-charging:archive`、`ebike-charging:archive` | **service** 按桩的车型判（§15.6） |
| 26 | POST `/api/cp-meter/simulate` | `car-charging:reading`、`ebike-charging:reading` | **service** 两项都要 |
| 27 | `/api/cp-meter/**` | `car-charging:reading`、`ebike-charging:reading` | **service** 按车型判 |
| 28 | POST `/api/budget/import` | `import:edit` | |
| 29 | PUT `/api/books/*/template` | `ledger:template`、`sales-income:template` | **service** 按账册所属屏判 |
| 30 | POST `/api/books/*/template/pin` | `ledger:version`、`sales-income:version` | **service** 同上 |
| 31 | POST `/api/review/*/submit`、`/recall` | 下面 17 项任一：`params:edit` `params:monthly` `meters:edit` `alloc:edit` `alloc-loss:edit` `bill-notices:edit` `ledger:edit` `sales-income:edit` `salary:edit` `utilities:edit` `pv-income:edit` `car-charging:edit` `ebike-charging:edit` `elec-cost:edit` `income-statement:edit` `balance-sheet:edit` `trial-balance:edit` | **service** 按 kind 细判（ReviewKind，§15.6）；补上了 v3 缺的报表编辑 |
| 32 | POST `/api/review/*/approve` `/return` `/withdraw` | `review:approve` | 不变 |
| 33 | POST `/api/companies`、DELETE `/api/companies/**` | `ledger:company` | 台账左轨、报表屏公司菜单、收款公司窗、导入自动建公司 |
| 34 | PUT `/api/companies/*`、POST `/api/companies/*/accounts`、`/api/company-accounts`、`/api/company-accounts/**` | `bill-notices:payee` | 收款公司窗；报表屏公司改名 |
| 35 | `/api/buildings`、`/**`、`/api/units`、`/**` | `buildings:edit` | |
| 36 | `/api/tenants`、`/**`、`/api/tenant-categories`、`/**` | `tenants:edit` | |
| 37 | `/api/contracts`、`/**` | `contracts:edit` | 含 billing-lines/import、import-full |
| 38 | `/api/ledger`、`/**` | `ledger:edit` | |
| 39 | `/api/s10`、`/**` | `sales-income:edit` | |
| 40 | `/api/pv`、`/**` | `pv-income:edit` | |
| 41 | `/api/charging/7/**` | `car-charging:edit` | |
| 42 | `/api/charging/8/**` | `ebike-charging:edit` | |
| 43 | `/api/charging/**` | **拒绝** | 铁律 4 |
| 44 | `/api/elec`、`/**` | `elec-cost:edit` | |
| 45 | `/api/utilities`、`/**` | `utilities:edit` | |
| 46 | `/api/salary`、`/**` | `salary:edit` | 不变 |
| 47 | `/api/reports/is/**` | `income-statement:edit` | |
| 48 | `/api/reports/bs/**` | `balance-sheet:edit` | |
| 49 | `/api/reports/tb/**` | `trial-balance:edit` | |
| 50 | `/api/reports/**` | **拒绝** | 铁律 4 |
| 51 | `/api/pnl/s1/**` … `/api/pnl/s5/**` | `rent-pnl:edit` … `expense-pnl:edit`（五条） | 含 `?auto=true` 自动补行 |
| 52 | `/api/pnl/**` | **拒绝** | 铁律 4 |
| 53 | `/api/recon`、`/**` | `reconciliation:edit` | |
| 54 | PUT `/api/analysis/settings` | `park:edit`、`anomaly:edit`、`fin-cashflow:edit`、`churn:edit`、`breakeven:edit`、`pv-roi:edit` | **service** 按项判（§15.6） |
| 55 | `/api/system/users`、`/api/system/users/**` | `sys-users:edit` | |
| 56 | `/api/system/roles`、`/api/system/roles/**` | `sys-roles:edit` | 含成员（§15.9） |

`/api/system` 下不再留 `/**` 兜底：新加的写端点落默认拒绝，覆盖率测试当场红。`SecurityConfig` 里 `/api/system/**` 的两行删掉，交给两个 AccessManager（§15.6）。

### 15.6 规则表以外的判权

| 位置 | 旧 | 新 | 理由 |
|---|---|---|---|
| `SecurityConfig.java:41-42` | GET `/api/system/**` → `system:view`；非 GET → `system:edit` | **删掉这两行**，系统管理三屏走读写规则表（15.5.1 #2–5、15.5.2 #55–56） | 三屏各自一项，SecurityConfig 一行表达不了 |
| `SecurityConfig.java:43` | `/actuator/**` → `system:view` | `hasAnyAuthority(sys-users:view, sys-roles:view, sys-logs:view)` | 系统管理任一查看 |
| `SecurityConfig.java:55-75` 403 文案 | system 段单独一句；写被拒用 `ResultCode.FORBIDDEN`「…可查看…」 | 不再分 system 段。读：「无查看权限：需要{needText}，请联系系统管理员在角色里勾上」；写：「无修改权限：需要{needText}，请联系系统管理员在角色里勾上」；need 为空：读「无查看权限：这项数据没有对你的账号开放，请联系系统管理员」、写「无修改权限：这个操作没有对你的账号开放，请联系系统管理员」 | 屏级拆分后「可查看」不一定成立 |
| `ReadAccessManager.java:69-76` deniedMessage | 1 项 / 多项用「或」连 | 改调 `Perm.needText` | K10 |
| `WriteAccessManager.java:54-81` | 不写 need；空 anyOf 也问提权 | 被拒时同样 `setAttribute(REQ_ATTR_NEED, anyOf)`；anyOf 为空直接拒，不问 `ElevationStore` | 写文案也写屏名；铁律 4 的拒绝规则不能被提权打开 |
| `Perm.needText`（新） | — | 1 项：「「月度台账 · 查看」」；2–3 项：「「A」或「B」其中一项」；4 项及以上：「「A」「B」等 N 项中的任一项」（各档都按 `Perm.ALL` 顺序排，4 项及以上取前两项） | K10：十几个屏名不糊进一句 |
| `PermissionGuard.java:35-55` | `require(perm, what)`，文案「没有修改「what」的权限。可以查看,如需修改请点编辑模式旁的授权按钮…」 | 判权逻辑不改；新增 `requireAny(List<String>)`（任一，认提权）；`require(perm)` 去掉 `what` 参数。两个的文案统一成和写规则表拒绝同一句：「无修改权限：需要{needText}，请联系系统管理员在角色里勾上」 | 原句的「可以查看」「点编辑模式旁的授权按钮」在 v4 新加的判权点上常常不成立：只有抄表编辑的人删本期时勾连带删草稿催缴单，他可能根本看不了催缴单；他那一屏的授权按钮申请的也不是「催缴单 · 编辑」。前端在缺权时自己弹授权窗，这句只是兜底 |
| `ParamService.java:599-603` requireWritePerm | monthly → `param-monthly:edit`；其余 → `param-policy:edit` | **新建池落初始分母 / 加度 / 取整位（`newPoolBootstrap`，只有 `AllocService.createRule` 传）→ `requireAny(alloc:pools, params:edit)`**（实现时补：建池本身要「公摊池配置」，不认的话只勾了它的人建一个带初始分母的池就 403）；monthly → `params:monthly`；**scope `tenant:` 且键在系数簿白名单里** → `requireAny(params:edit, bill-notices:coef)`；其余 → `params:edit`。白名单 = `ParamRegistry.Def` 新加的 `coefBook` 标志，恰好 12 个键：系数簿的 10 个价目键（`mgmt_fee`、`capacity_fee`、`water`、`elec_package`、`share_elec_fixed`、`share_water_fixed`、`green_rate`、`lamp_rate`、`fire_amount_fixed`、`loss_base_form`）加它们写计划里的配套键 `mgmt_fee_commercial`、`water_pipe` | 不能按「户级、非月度」笼统放：那样会多出 `loss_base_form_b{bid}`（按栋的损耗基数形态）和 `loss_base_park_meter`（引用型），前端系数簿特意排除了这两个、只在计费参数 ④ 区改（`coefBookLogic.spec.ts` 钉着）。`ParamRegistryTest` 把 `coefBook` 导进 `param-registry.json`，前端 `coefBookLogic.spec` 加一条：`COEF_KEYS` 价目键 ∪ 它们 `writePlan` 的键 = 注册表里 `coefBook` 的键 |
| `ParamController.java:24-34` list（新判） | 不带 `key`、`scope` 就回当月全表 | 调用者有 `params:view` 照旧；否则回包只留他看得了的那几屏要的键：alloc → `coefficient`、`extra_qty`、`frozen_2023`、`round_scale`；alloc-loss → `loss_adj_qty`、`loss_adj_rate`、`loss_rate_manual`；bill-notices → `coefBook` 的键；anomaly、pv-meter-analysis → `pv_` 开头的键。带了 `key` 就再取交集 | 读规则只能按路径放行，挡不住「不带 key 拉全表」：只勾异常提醒中心的人能读到含租户名的户级例外。键表就是这几屏现在实际带的 `key` 参数（勘察清单） |
| `S10Controller`（新端点） | — | `GET /api/s10/month-totals?year=&month=` → 四个期区各自 `S10Service.month(…).grandTotal`，没有行的期区给 0（和现在前端拿到的一样） | 报表中心勾稽③只要这四个数（15.5.1 #52a） |
| `MeterService.java:1246-1251` | `meter-master:edit`，提示「没有「表档案」权限,倍率没有改」 | `meters:archive`，提示「没有「园区抄表 · 表档案」权限,倍率没有改」（标点照旧半角，只换权限名：抄表导入的等价金样 `meter-import/equivalence.txt` 只改这一处） | |
| `MeterService.java:748-755` guardOpenNotices | `billing-run:edit`，文案「催缴单」 | `bill-notices:edit`，文案走 `PermissionGuard` 的统一句（「无修改权限：需要「催缴单 · 编辑」…」） | 连带删草稿催缴单是催缴单屏的写 |
| `DataHomeService.java:127-131` | `billing:view` 才给催缴单金额 | `bill-notices:view` | |
| `TenantService.java:225-234` | 联系人：`master:view`；别名：`master:view` 或 `DATA_LAYER_VIEWS` | 联系人：`tenants:view`；别名：`tenants:view` 或 `Perm.DATA_SCREEN_VIEWS`（数据层 17 屏，不含导入中心） | 迁移后与 v3 同一批人；不含导入中心是因为园区股东迁移后有 `import:view`，含了他就多拿到别名明文 |
| `TenantService.java:92-97` keepIfMasked | — | 不改 | |
| `ContractService.java:151-157` | `master:view` | `tenants:view` | 联系人归租户屏 |
| `CompanyService.java:71`、`:78-80`、`:220-221`、`:232-237`、`:293-299` | 收款账号明文：`master:view`；催缴单出口 `master:view ∪ billing:view`；个人卡改类型要 `master:view` | 全部改认 `bill-notices:view` | 账户维护挪到了催缴单屏（收款公司窗）；预置角色里 v3 两项同现，迁移后同一批人 |
| `SensitiveMask.java` | — | 不改（只看 authorities，不看提权） | |
| `SalaryService` | 只靠 URL | 不改 | |
| `ApprovalService.java:66-87`、`:92-118`、`:138-159` | `Perm.exists / elevatable` | 不改代码，跟着新的 `ALL` 与 `NOT_ELEVATABLE` | |
| `ElevationService.java:66` | 不可提权文案按 `p.startsWith("system:")` 分两句 | 改按 `Perm.isSystem(p)`（键的屏在系统管理层）分 | 键名变了 |
| `ElevationService.java:197-199` | 自己一份 label | 删掉，改调 `Perm.label` | 只留一份人话名 |
| `LockService.java:128-132` | 任一键以 `:edit` 结尾才能占锁 | `Perm.isWrite` 任一 | 专有动作（`bill-notices:issue` 等）不以 `:edit` 结尾也是写 |
| `LockService.java:97-98` | `lock:takeover` | 不改 | |
| `ReviewKind.java:27-58` perms() | 模块键 | PARAMS → `params:edit`、`params:monthly`；METERS → `meters:edit`；ALLOC → `alloc:edit`；ALLOC_LOSS → `alloc-loss:edit`、`alloc:edit`（公共电核算一次交两把键）；BILL_NOTICES → `bill-notices:edit`；LEDGER → `ledger:edit`；S10 → `sales-income:edit`；SALARY → `salary:edit`；UTILITIES → `utilities:edit`；PV → `pv-income:edit`；CHARGING_CAR → `car-charging:edit`；CHARGING_EBIKE → `ebike-charging:edit`；ELEC_COST、ELEC_MODEL → `elec-cost:edit`；REPORT_IS / BS / TB → `income-statement:edit` / `balance-sheet:edit` / `trial-balance:edit` | 交审权 = 那一屏的编辑 |
| `ReviewService.java:549-553` requireAnyPerm | 文案通用 | 交审「交审「{kind 中文名}」需要{needText}」；撤回「撤回「{kind 中文名}」的交审需要{needText}」 | |
| `ReviewService` 录审分离、`PresenceService.java:102-104` | — | 不改 | |
| `SystemService.java:102-122` auditLogs | seeParam `param:view`；seeMeter `meter:view`；seeBilling `billing:view`；seeImport 读 `/api/import-log/overview` 的读规则 | seeParam `params:view`；seeMeter `meters:view`；seeBilling `bill-notices:view`；seeImport 照旧读读规则（结果是 `[import:view]`） | |
| `ChangeLogService.java:36-42` Tbl.viewPerm | 每表一个模块查看 | `viewPerm` 改成 `List<String>`（任一）：monthly_ledger → ledger；meter_reading → meters；salary_record → salary；analysis_setting → 分析全部（20 屏都看得到这份设置）；report_amount、pnl_row 再按行定位过滤：`row_ref` 以「利润表 ·」「资产负债表 ·」「科目余额表 ·」开头的要对应报表屏查看，以「附表1 」…「附表5 」开头的要对应附表屏查看（`AuditQueryMapper` 多一个「看得见的前缀」参数，条数、分页、操作人下拉同一套条件） | 「看得到操作日志不能顺带看到自己打不开的表」（§14.2）在屏级下继续成立 |
| `CompanyService.java:182-187` 删公司（为上一行改） | 报表金额一次删光，记一条摘要，`row_ref` 是裸公司名 | 按三张报表各删一次（`report_amount.statement` = is / bs / tb），各记一条摘要：`row_ref` =「利润表 · {公司}」「资产负债表 · {公司}」「科目余额表 · {公司}」，详情写各自的格数；某张表 0 格就不记那一条 | 裸公司名不以任何报表名开头，按前缀过滤后这条记录谁都看不到（系统管理员也看不到），而它记的恰恰是最不可逆的一步：整家公司全部年月的报表金额。台账那条摘要归 `monthly_ledger`，不受影响 |
| `AuditQueryMapper.REF_FILTER`（复查补，§15.13 ③） | — | `report_amount` 里行定位不以三张报表名开头的旧行（0.30–0.32 写的「删除公司」摘要，`row_ref` 是裸公司名）照样给看；能走到这一行已经过了 `tbl IN tbls`，即三张报表至少看得了一张 | 只改今后的写法不够：库里已有的旧摘要按前缀过滤后谁都看不到，系统管理员也看不到。不写迁移改旧行（下一个迁移号可能和别的分支撞），过滤里多一行就够；旧摘要记的是三张一起删，看得了任一张就给看 |
| `ChargingController` / `ChargingService.batchDelete`（复查补，§15.13 ②） | 只按 id 删，注释写「一批 id 可跨附表」 | 带上 URL 里的附表号，不属本附表的 id 按不存在算（同 `delete` / `updateNote`） | 附表7、8 拆成两屏后，只有汽车桩编辑的人从 `/7/batch` 送电动车的 id 就能删掉电动车那屏的数据 |
| `ReportService.deleteCustomRow`（复查补，§15.13 ②） | 按 id 取行、再按 URL 的报表删同名 `row_key` | id 不属 URL 那张报表 → 404 | 三张报表是三屏；不判的话删掉的是本报表里同名的另一行 |
| `SystemService` 操作日志回包 | `elevate.grant` 的对象是原键 `perm:param-policy:edit,…` | 返回前把 `perm:` 开头的对象换成「权限：」+ 逐项 `Perm.label`（旧键用 `LEGACY_LABELS`） | 旧键在日志里也是人话（K4） |
| `AuthController.java:76-79` | `Perm.META`（含 group） | 原样返回新 META（key、label、hint、screen、kind） | |
| `PermissionRegistry.java:44` DATA_LAYER | `Perm.DATA_LAYER_VIEWS` | 删；出账链六屏改用组常量 `CHAIN` | |
| `UserPermissionCache.java:120-123`、`:137` | 库里的键原样装 | 先滤 `Perm.exists` 再 `withImplied`：旧键当不存在 | K4 |
| `SystemService` 里读 `auth_role_perm` 的四处：`:138` listRoles 的 permsByRole（toDto、`RoleDTO.manageable`）、`:183` updateRole 的 `before`（`guardRoleInRange(r, before ∪ next)` 和 `changed` 两个用途）、`:233` listUsers 的 permsByRole（`UserDTO.manageable`）、`:542-546` permsOfRoles | 原样读、原样比较 | 统一走一个私有 `knownPermsOf(roleIds)`：读出来先滤 `Perm.exists`，再按 `Perm.ALL` 排序。`guardSelfKeepsRolesEdit`（下一行）按单个新键 `sys-roles:edit` 计数，旧键碰不到它 | 旧键不出现在角色屏，也不参与分级比较。漏一处的后果：`before` 原样读，非系统管理员保存任何一个还没在 0.33 存过的角色都 403「角色里有你没有的权限：主数据 · 查看（旧版）…」，成员栏的增删走同一个保存也被拦；`changed` 恒为真，只改备注也给全体成员发铃铛；listUsers 原样读，挂了旧键角色的账号对非系统管理员全是 `manageable=false`，整列置灰 |
| `SystemService.java:404-423` guardSelfKeepsSystemEdit | 守 `system:edit` | 改名 guardSelfKeepsRolesEdit，守 `sys-roles:edit`（有它就能把别的都改回来）；文案里的权限名换成「角色权限 · 编辑」 | 自锁 |
| `SystemService.java:429-441` permDiff | 逐项人话名 | 按屏合并：「加：月度台账（查看、编辑）、催缴单（签发）；去：…；现共 K 项」；超过 255 字时截到放得下的最后一屏，后面写「等 N 屏」 | 107 项全加逐项写必超 255 |
| `SystemService.java:279-308` updateUser | 角色变更内联；审计「角色 N 个」 | 抽出 `changeRoles`（§15.9），审计写「角色：加「X」；去「Y」」 | 与成员栏同一条路径 |
| `AllocService.updateRule`（新判） | — | 没有 `alloc:pools`、只有 `bill-notices:coef` 时，在 `apply(r, req)` 之后、`rules.updateById` 之前判，四条都满足才放行：① 池在二期（`zone = p2`）且费项是 `share_elec_elevator` / `share_elec_fire`；② `r.equals(before)`，即名称、方法、费项、定位、算式、基数键、备注一个没变；③ `pm.write()`、`pl.write()` 都是假（绑定表、折入链和站在 `memberMonth` 的有效组相同；`memberMonth` 为空时这两个恒为真，自然不过）；④ `pb.was` 与 `pb.now` 去掉份额后的租户 id 集合相同，只有份额变。否则 403「只有「公共电核算 · 公摊池配置」能改这个池」。**不比** `coefficient` / `extraQty` / `roundScale`：系数簿从不带 `ym` 的 `/alloc/rules` 取它们（拿到的是初始版），既有池上 `apply` 本来就忽略这三个 | 系数簿与池配置写同一个端点。只比「这次会真写的东西」，不比请求原文：分母或加度在初始版之后按月改过版的二期池，系数簿送来的 `coefficient` 和生效版不同，逐字段比会让只有系数簿的人每次改层份都 403。①是因为系数簿只开二期电梯 / 消防层份（`coefBookLogic.poolsOfFeeKey`、`FLOOR_KEYS`），不能借它改别的池的份额 |
| `BookService` 模板写与换版（新判） | — | 按账册的 screen（`ledger` / `s10`）`require` 对应屏的 `:template` / `:version`（认提权） | URL 只有 bookId |
| `CpMeterService`（新判） | — | 写：新增桩按请求的车型、改 / 删桩按桩的车型（改车型两边都要）、读数与用电量按所属桩的车型，`require` `car-charging:<动作>` 或 `ebike-charging:<动作>`；导入按行的车型，文件里有哪种就要哪种的读数权，缺一种整次 403；模拟填充两种读数都要。读：没有 `charging-analysis:view` 时，stations / readings / power-usage / years 只回自己看得了的车型（years 由看得了的桩的账期推出）；`months?vehicleType=` 缺那一屏查看 403，不带 `vehicleType` 时同样只数看得了的车型 | 汽车、电动车两屏共用一组接口和一张表 |
| `AnalysisSettingService.save`（新判） | URL `report:edit` | 每一项按归属屏 `require`：occTarget → `park:edit`，collectTarget → `fin-cashflow:edit`，churnTh → `churn:edit`，spikeTh → `anomaly:edit`，breakevenFixedRatio → `breakeven:edit`，pvInvestment → `pv-roi:edit`；`Key` 枚举加 `screen` 字段 | 一次 PUT 可带多项 |

`Perm.DATA_LAYER_VIEWS` 的全部用处（K7）：`PermissionRegistry.java:44/295/303/304/306/310/313` → `CHAIN`；`TenantService.java:228` → `DATA_SCREEN_VIEWS`；前端镜像 `navAccess.ts:12` 的 `DATA_ANY` → 删。

### 15.7 前端改键表

**`nav/navAccess.ts` 新写法**（infra）：

```ts
const ROUTES = fpBuildRoutes()
/** 跨屏三项:不属于任何一屏。 */
export const CROSS_PERMS = ['review:approve', 'lock:takeover', 'elevate:request'] as const
const screenOf = (p: string) => p.slice(0, p.lastIndexOf(':'))
/** 这一屏要哪项查看权:一屏一项。不认识的地址 null(不设门)。 */
export function viewPermsOf(to: string): readonly string[] | null {
  const path = to.replace(/^\//, '').split(/[?#]/)[0]
  return ROUTES[path] ? [`${path}:view`] : null
}
/** 屏级写权:前缀是导航里的一屏、动作不是 view。只读判定用它。 */
export const isScreenWrite = (p: string) => !!ROUTES[screenOf(p)] && !p.endsWith(':view')
/** 认得的键:屏级键或跨屏三项。快照里有认不得的(0.32 留在浏览器里的旧键)就重取一次 /auth/me。 */
export const isKnownPerm = (p: string) => !!ROUTES[screenOf(p)] || (CROSS_PERMS as readonly string[]).includes(p)
```

`DATA_ANY`、`BOOKS`、`DATA_VIEW`、`LAYER_VIEW`、`MODE_VIEW` 删掉；`canViewPage`、`viewLack`、`isLayerVisible`、`visibleSections`、`layerEntry`、`canReach` 不改。
`landingPath` 的第二个参数从 `canSystemView: boolean` 改成 `systemHome: string | null`（最后一档 `return systemHome ?? '/cockpit'`）。

**`test-utils/perms.ts` 新导出（名字定死）**：

```ts
/** 全部业务屏的查看权(系统管理三屏除外),从导航表派生 —— 新加一屏自动带上。 */
export const ALL_VIEWS: string[] = fpAllPages().filter((p) => p.layer !== 'system').map((p) => `${p.value}:view`)
/** 某一层全部屏的查看权:viewsOf('analysis')。 */
export function viewsOf(layer: 'data' | 'reports' | 'analysis' | 'system'): string[]
/** 给当前 pinia 的 auth 补上 ALL_VIEWS 和 extra(保留已有的)。签名不变。 */
export function grantViews(...extra: string[]): void
```

**逐处改键**（勘察清单 `permChecks` 与源码里的权限字面量，一行一处或一组同改的行；「不改」的是判据随 navAccess / 后端自动变的调用点）：

| 文件:行 | 旧 | 新 |
|---|---|---|
| `nav/navAccess.ts:11-31`、`:47` | DATA_ANY / BOOKS / DATA_VIEW / LAYER_VIEW / MODE_VIEW | 删，见上 |
| `nav/navAccess.ts` landingPath | `canSystemView ? '/sys-users'` | `systemHome ?? '/cockpit'` |
| `router/index.ts:162-165` | 快照里一个 `:view` 都没有才重取 `/auth/me` | `auth.permissions.some(p => !isKnownPerm(p))` 时重取一次 |
| `router/index.ts:166`、`:238` | `canViewPage(to.fullPath)` | 不改 |
| `router/index.ts:174` | 没有 `report:edit` 才取权限字典 | 进分析层一律 `loadPermDict()`（六项各归一屏，不再有「一项全能改」） |
| `stores/auth.ts:131` isReadonly | 没有以 `:edit` 结尾的键 | `!permissions.some(isScreenWrite)` |
| `stores/auth.ts:144` roleLabel | `can('system:view')` | `can('sys-users:view')` |
| `stores/auth.ts:158` roleHome | `landingPath(…, can('system:view'), …)` | `landingPath(…, isLayerVisible('system', [], can) ? '/' + layerEntry(系统层, can) : null, …)` |
| `components/shell/Toolbar.vue:153` | `can('system:view')` | `can('sys-logs:view')` |
| `composables/useViewGate.ts:13` lackText | 全部用「或」连 | ≤3 项照旧；4 项及以上「需要「A」「B」等 N 项中任一项权限」（同 `Perm.needText`） |
| `api/perms.ts` permLabel（复查补，§15.13 ⑥） | 字典没到退回权限点原名 | 字典没到（或取不到）时按导航表拼：`<屏>:view` →「屏名 · 查看」、`:edit` →「屏名 · 编辑」，专有动作只写屏名；和后端 `Perm.META` 逐字相同，字典到了也不跳字 | `blocked()` 的回执是定死的一句，字典只在分析层和授权窗才取，数据层第一次点出来的回执里是 `tenants:view`，一直挂到点 × |
| `types/system.ts:5-25` PermDTO | `group?`、`kind: 'view'\|'edit'\|'other'` | `screen?: string \| null`、`kind: 'view' \| 'edit' \| 'action' \| 'other'` |
| `types/system.ts:42-49` RoleReq | — | 加 `addUserIds?: number[]`、`removeUserIds?: number[]` |
| `views/system/SystemRolesView.vue:23`、`:125` | `system:edit` | `sys-roles:edit` |
| `views/system/SystemRolesView.vue:89-104` | 模块矩阵 | 权限树 + 成员栏（§15.9） |
| `views/system/SystemUsersView.vue:38` | `system:edit` | `sys-users:edit` |
| `views/NoAccessView.vue:22`、`components/shell/*`（IconRail、SidebarPanel、paletteFilter、MobileNavDrawer） | 经 navAccess | 不改 |
| `utils/importRegistry.ts:291` | `type ImportModule = 'entry:edit' \| …`，`module: ImportModule` | `module: readonly string[]`（任一）；各条：ledger `['ledger:edit']`、s10 `['sales-income:edit']`、pv `['pv-income:edit']`、pvMeter `['pv-income:reading']`、cpMeter `['car-charging:reading','ebike-charging:reading']`、meter `['meters:edit']`、billingTerms / contractFull `['contracts:edit']`、charging_7 `['car-charging:edit']`、charging_8 `['ebike-charging:edit']`、elec / elecCost `['elec-cost:edit']`、salary `['salary:edit']`、office_13 / 14 `['utilities:edit']`、report_is / bs / tb `['income-statement:edit']` / `['balance-sheet:edit']` / `['trial-balance:edit']`、pnl_s1..s5 `['rent-pnl:edit']`…`['expense-pnl:edit']`、budget `['import:edit']`（`:409 :521 :577 :594 :620 :647 :698 :740 :785 :807 :823 :848 :871 :905 :942 :976 :1020 :1051`） |
| `views/import-center/ImportCenterView.vue:34` | `auth.can(t.module)` | `t.module.some(auth.can)` |
| `utils/importRegistry.ts:228-235` prefetchBudgetPnlRevenue（年度预算弹窗打开时预取损益附表） | 不判权，拉不到就静默跳过收入核对 | 只在五张损益附表的查看都有时才取（`fetchPnlSummary` 一次拉五张，缺一张整个失败）；不取时弹窗提示行写「有的损益附表你看不了，这次导入不拿它们的收入合计核对预算。」（复查改：判据是五张任缺一张，原句「你看不了损益附表」说过头）。读规则不对导入中心放行 `/api/pnl/**`：迁移后凡有数据层任一查看的角色都有 `import:view`，放行就等于让他们读到全部损益附表。v3 只有导入权、没有报表查看的人同样静默跳过，这里只是把跳过说出来 |
| `views/import-center/ImportCenterView.vue:203` | `canViewPage(目标)` | 不改 |
| `views/data-home/DataHomeView.vue:69` | `lock:takeover \|\| system:view` | `lock:takeover \|\| sys-users:view` |
| `views/data-home/DataHomeView.vue:282` | `report:view` 才取收入核对 | `reconciliation:view` |
| `views/data-home/DataHomeView.vue:343-345` canSubmitAny、`:352` submittable、`:378` submit、`:392` submitPending | 六个模块编辑任一；工资行另判 `salary:edit`；整行的键一起交 | **逐键判**：`keys.filter(canSubmitKey)`。`canSubmitKey(k)` 取键的 kind（第一个 `:` 前），查 `SUBMIT_PERMS: Record<kind, string[]>`，任一 `hasOwn` 就算（复查改：原写 `can`，含提权，后端交审不认提权；判据挪到 `types/review.ts` 的 `canSubmitKey`，与审核动作簇共用）：params → `params:edit`、`params:monthly`；meters → `meters:edit`；alloc → `alloc:edit`；alloc-loss → `alloc-loss:edit`、`alloc:edit`；bill-notices → `bill-notices:edit`；ledger → `ledger:edit`；s10 → `sales-income:edit`；salary → `salary:edit`；utilities → `utilities:edit`；pv → `pv-income:edit`；charging-car → `car-charging:edit`；charging-ebike → `ebike-charging:edit`；elec-cost、elec-model → `elec-cost:edit`；report-is / bs / tb → 三张报表各自的 `:edit`（与后端 `ReviewKind.perms` 逐条相同）。`canSubmitAny`、`submittable` 删掉。不能按行的 `go` 判：附表7/8 那一行 `go` 写死 `car-charging`、行内却是汽车和电动车两把键；也不能用 `screenOfKind`，它把 `charging-ebike` 也映射到 `car-charging` |
| `views/data-home/DataHomeView.vue:94 :171 :596 :651`（lack / blocked）、`:346 :460 :516`（review:approve） | — | 不改 |
| `views/buildings/BuildingsView.vue:258`；`BuildingDrawer.vue:229 :233 :277 :279 :291 :341 :374` | `master:edit` | `buildings:edit` |
| `views/buildings/BuildingDrawer.vue:238` | `contract:edit` | `contracts:edit` |
| `views/tenants/TenantsView.vue:220`；`TenantDrawer.vue:116 :122` | `master:edit` | `tenants:edit` |
| `views/tenants/TenantDrawer.vue:129` | `contract:edit` | `contracts:edit`（按钮没有 @click 是既有问题，不在本次） |
| `views/contracts/ContractsView.vue:340 :344`；`ContractDrawer.vue:262 :354`；`ContractNewDialog.vue:141` | `contract:edit` | `contracts:edit` |
| `views/params/ParamCenterView.vue:65` canRun | `billing-run:edit` | `params:recalc` |
| `views/params/ParamCenterView.vue:76` useEditMode | `['param-monthly:edit','param-policy:edit','billing-run:edit']` | `['params:monthly','params:edit','params:recalc']`（`useEditMode` 进编辑态要三项齐，缺项当场弹授权、授权掉一项自动退出，所以各区写入口仍只判编辑态；单独判键的只有「重算」`canRun` → `params:recalc`） |
| `views/params/ParamCenterView.vue:580` | `router.push` 不判权 | `blocked(目标)` 先判 |
| `views/meters/MeterView.vue:91 / :92 / :101` | `meter-reading:edit` / `meter-master:edit` / 两档 | `meters:edit` / `meters:archive` / `['meters:edit','meters:archive']` |
| `views/meters/MeterView.vue:595`；`MeterDeleteDialog.vue:24` | `billing-run:edit` | `bill-notices:edit` |
| `views/meters/MeterDetailDrawer.vue:63 / :64` | `meter-master:edit` / `meter-reading:edit` | `meters:archive` / `meters:edit` |
| `views/alloc/PoolLedgerView.vue:89` canGen | `billing-run:edit` | `alloc:edit` |
| `views/alloc/PoolLedgerView.vue:98` | `['billing-run:edit','param-policy:edit']` | `['alloc:edit','alloc:pools']` |
| `views/alloc/PoolLedgerView.vue` 池配置写入口（新增池、行点开池抽屉、保存 / 删池）与保存池后自动重新生成 | 只判 editMode | **不改**（实现时更正）：本屏 `useEditMode(['alloc:edit','alloc:pools'])` 进编辑态要两项齐，缺一项当场弹授权、授权掉一项就自动退出编辑态，编辑态里这两项恒为真。v3 同理（只有出账运行的人点「编辑模式」先被要求授权计费口径），「看得见、点下去 403」「只有公摊池配置的人保存后撞『重新生成失败』」两个前提都不成立，加判断是死代码 |
| `views/alloc/PoolLedgerView.vue:540`；`LossLedgerView.vue:225` | `router.push` 不判权 | `blocked(目标)` |
| `views/alloc/LossLedgerView.vue:78` | `['billing-run:edit']` | `['alloc-loss:edit']` |
| `views/bills/BillNoticesView.vue:87 / :88 / :102` | `billing-run:edit` / `billing-issue:edit` / 两档 | `bill-notices:edit` / `bill-notices:issue` / `['bill-notices:edit','bill-notices:issue']` |
| `views/bills/BillNoticesView.vue:204 :234 :1293` | `router.push` 不判权 | `blocked(目标)` |
| `views/bills/CoefBookWindow.vue:54 :89 :101` | `param-policy:edit` | `bill-notices:coef` |
| `views/bills/CompanyBookWindow.vue:28 :155` | `master:edit` | `bill-notices:payee` |
| `views/bills/CompanyBookWindow.vue:250`（新增公司） | `master:edit`（后端要 company:manage，对不上） | `ledger:company`；新增时右侧表单能不能填也认它（`canForm = creating ? ledger:company : bill-notices:payee`），不然只有新增权的人点了「新增公司」表单是灰的 |
| `views/bills/PayBookWindow.vue:47 :68 :401` | `billing-issue:edit` | `bill-notices:issue` |
| `views/ledger/LedgerView.vue:744 :756`；`LedgerCompanyPicker.vue:37 :60 :65` | `company:manage` | `ledger:company` |
| `views/ledger/LedgerView.vue:834 :850`；`LedgerWideTable.vue:85 :86 :380 :384 :463 :479 :483 :525` | `entry:edit` | `ledger:edit` |
| `views/ledger/LedgerView.vue:883 / :884` | `book-template:edit` / `book-template:switch` | `ledger:template` / `ledger:version` |
| `views/ledger/LedgerView.vue:730` | `router.push` 不判权 | `blocked(目标)` |
| `views/ledger/LedgerView.vue:480-488` onMapApply、`components/fp/ColumnMapPanel.vue:45-47` | 列映射面板三种决策都能选，「应用」直接 `booksApi.saveTemplate` | 面板加 prop `canChangeTemplate`（宿主传 `can('ledger:template')`）；没有时「映射到现有列」「新建自定义列」置灰（DS `Segmented` 没有单项禁用：面板用样式灰掉前两项、点了不改值），悬停 `lackText(['ledger:template'])`，每列默认「本次忽略」（这两种决策都会升一版模板，后端要 `ledger:template`；财务专员只有 `ledger:edit`，v3 起导带新列的台账点「应用」就 403、导入卡住） |
| `views/sales-income/S10View.vue:666 :733 :814` | `entry:edit` | `sales-income:edit` |
| `views/sales-income/S10View.vue:827 / :828` | `book-template:edit` / `book-template:switch` | `sales-income:template` / `sales-income:version` |
| `views/sales-income/S10View.vue:554` | `router.push` 不判权 | `blocked(目标)` |
| `components/fp/TemplateEditorPanel.vue:140` | 锁的权限写死 `['book-template:edit']` | 新 prop `editPerm`（宿主传 `ledger:template` / `sales-income:template`），锁用它 |
| `components/fp/FPStepStrip.vue:70-77` | `go()` 直接 push | 宽档：步骤目标看不了的置灰、悬停写 `lack(目标)`；`go()` 先过 `blocked`。窄档面板项同样置灰、原因写在名字下面（复查补：触屏没有悬停，更新公告「置灰，写明缺哪一项」才成立）；前后箭头点到看不了的一步说一句原因、不跳 |
| `views/salary/SalaryView.vue:344` | `salary:edit` | 不改（键名没变） |
| `views/pv/PvView.vue:48 / :50` | 按 `entry:view` / `meter:view` 过滤左栏、`METER_ONLY` | 两本都列；`METER_ONLY` 删 |
| `views/pv/PvView.vue:202` | `perm="entry:edit"` | `perm="pv-income:edit"` |
| `views/pv/PvMeterView.vue:58 / :65 / :66` | `meter-master:edit`、`meter-reading:edit` | `['pv-income:archive','pv-income:reading']` / `pv-income:archive` / `pv-income:reading` |
| `views/charging/ChargingView.vue:64 / :66` | 同 PvView | 同 PvView |
| `views/charging/ChargingView.vue:225` | `perm="entry:edit"` | `` :perm="`${MODE_SCREEN}:edit`" `` |
| `views/charging/CpMeterView.vue:68 / :75 / :76` | `meter-master:edit`、`meter-reading:edit`、`billing-run:edit` | 本屏 scr = car-charging 或 ebike-charging：`` [`${scr}:archive`, `${scr}:reading`] `` / `` `${scr}:archive` `` / `` `${scr}:reading` `` |
| `views/charging/CpMeterView.vue:77` canRun（模拟填充） | `billing-run:edit` | `can('car-charging:reading') && can('ebike-charging:reading')` |
| `views/charging/CpMeterView.vue:833`（新增桩车型） | 两种都能选 | 只列有桩库权的车型 |
| `views/elec/ElecView.vue:224` | `perm="entry:edit"` | `perm="elec-cost:edit"` |
| `views/elec/ElecCostView.vue:54 / :55 / :68` | `entry:edit` / `param-policy:edit` / 两档 | `elec-cost:edit` / `elec-cost:price` / `['elec-cost:edit','elec-cost:price']` |
| `views/utilities/UtilitiesView.vue:198` | `perm="entry:edit"` | `perm="utilities:edit"` |
| `components/sched/SchedHeader.vue:85 :87 :108 :215 :298` | 按宿主传的键 / `review:approve` / `elevate:request` | 不改 |
| `components/fp/FPReviewActions.vue` toSubmit / toRecall（复查改，§15.13 ④） | 「交审」按宿主的 `canEdit`（= 编辑模式按钮画不画：本屏任一写权或「可请求提权」）画 | 逐键判：`types/review.ts` 的 `canSubmitKey(key, auth.hasOwn)`（`SUBMIT_PERMS` 从 `monthClose.logic.ts` 挪到这里，那边转出），只认角色给的，与后端 `ReviewService.requireAnyPerm` 同口径；撤回同一道 | 只有「园区抄表 · 表档案」、只能请提权、或借来编辑权的人，原来在六屏每个已录未交的月都看到「交审」，点了 403 |
| `composables/useEditMode.ts` toggle / askFor（复查改，§15.13 ⑦） | 缺任一项就弹授权窗 | 能请提权（`elevate:request`）照旧弹窗；不能请的不弹，回执「进这一屏的编辑模式还要「A」「B」，你的账号不能请主管当场授权，请找系统管理员在角色里勾上」 | 授权窗里当场授权、远程请求两条路后端都要 `elevate:request`，弹了也是主管输完密码吃 403 |
| `components/shell/NotifyPanel.vue` go / goDataHome（复查补，§15.13 ⑤） | 按 kind 换算出屏就 push | 先 `blocked('/' + 屏)`：看不了就说一句缺哪一项、不跳、面板不关 | 自建审核角色（审核 + 部分屏查看）点到看不了的那张表会被送进「无权查看」页 |
| `views/data-home/monthClose.logic.ts` screenOfKind（复查补） | `charging-ebike` 随附表7/8 那一行去 `car-charging` | `charging-ebike` → `ebike-charging` | v4 起两屏查看权分开；只看得了电动车的审核员点电动车的待审被挡在汽车那屏 |
| `components/fin/useFinStatementScreen.ts:73` canEdit、`:352` 锁 | `report:edit` | 本屏的 `:edit`：在 composable 里按已有的 `stmt` 查字面量表 `EDIT_PERM = { is: 'income-statement:edit', bs: 'balance-sheet:edit', tb: 'trial-balance:edit' }`（实现时改：不另加宿主参数 —— `stmt` 已经定了是哪一屏，再传一个 `screen` 只多一处可能对不上） |
| `components/fin/useFinStatementScreen.ts:74` canManageCo | `master:edit` 一项管新增 / 改名 / 删除 | 拆两项：`canAddDelCo = can('ledger:company')`、`canRenameCo = can('bill-notices:payee')` |
| `components/fin/FinCompanyMenu.vue:14 :80`；`FinPeriodBar.vue:17 :29` | `canManage` 一个 prop | `canAddDel`、`canRename` 两个 prop，新增 / 删除与改名各看各的：没有的那颗不画（同 v3「没有就不出」），两项都没有不出底栏；空态「新增公司」只认 `canAddDel` |
| `views/reports/income-statement/IncomeStatementView.vue:316 :331 :355`；`balance-sheet/BalanceSheetView.vue:370 :385 :409`；`trial-balance/TrialBalanceView.vue:329 :344 :368` | `canManageCo` | 按上一行传两个 |
| `IncomeStatementView.vue:360`；`BalanceSheetView.vue:414`；`TrialBalanceView.vue:373 :407` | `canEdit` | 不改（随 useFinStatementScreen） |
| `views/reports/pnl/PnlScheduleView.vue:467` | `perm="report:edit"` | `` :perm="`${screen}:edit`" ``（screen = 路由 meta.value） |
| `views/reports/pnl/PnlScheduleView.vue:123-149` tryGenerate | 不判权，只读的人进年也会发 | 只在 `can(screen + ':edit')` 时发 |
| `views/reports/recon/ReconWorkbench.vue:339` | 不判权 | 没有 `reconciliation:edit` 时置灰，悬停 `lackText(['reconciliation:edit'])`；同一弹窗的备注框一并置灰（存不了的备注不让填）；弹窗照开，金额与「去改台账 / 附表10」照常 |
| `views/reports/recon/ReconWorkbench.vue:335 :336` | lack | 不改 |
| `views/reports/home/ReportsHomeView.vue:45-49` go() | 不判权 | 看不了的卡片 / 行照样列出、置灰、悬停写 `lack(目标)` |
| `reports/reportsHome.ts` loadHomeData、defaultPeriod | 一律取全部报表、收入核对、附表10 四期整张宽表 | 签名加判权函数：`loadHomeData(年, 月, can)`、`defaultPeriod(can)`（纯函数，屏传 `auth.can`）。只取看得了的那几张；看不了的卡值写「没有查看权」（不写「待生成」）、徽标「—」、`locked: true`；没有收入核对查看时 defaultPeriod 不调接口，直接落今年今月；勾稽③只在看得了利润表时算，附表10 那一边改取 `s10Api.monthTotals(年, 月)`（`GET /api/s10/month-totals`，15.5.1 #52a），不再调四次 `s10Api.getMonth`。**实现时补**：勾稽项也带 `locked`（算它要的那张报表看不了）—— 结果格写「没有查看权」不写「待查」，「n / m 项已平」的 m 不数它；m 为 0 时不出这句 |
| `api/s10.ts` | — | 加 `monthTotals(year, month): Promise<Record<1\|2\|3\|4, number>>` |
| `views/analysis/AnaShell.vue:151 :231-245` | 一个 `lock` 管六个框 | 每个框按归属屏 `anaSettingsLock(key)` 置灰，悬停写那一项的原话；「恢复默认」只送自己能改的那几项（`resetAnaSettings(keys)`），一项都改不了时置灰。弹层顶上那句：只锁一项时就是那一项的原话；锁两项及以上写「全园区共用这一份目标与阈值，置灰的项各要它所属那一屏的编辑权限才能改（停在框上看是哪一屏）」—— 六项各要一把不同的键，不能用 lackText 的「任一项」句式（补上任一项并不能全改） |
| `analysis/anaSettings.ts:62` anaSettingsLock | `report:edit` | `anaSettingsLock(key)`：新常量 `ANA_SETTING_SCREEN = { occTarget: 'park', collectTarget: 'fin-cashflow', churnTh: 'churn', spikeTh: 'anomaly', breakevenFixedRatio: 'breakeven', pvInvestment: 'pv-roi' }`，缺 `<屏>:edit` 时返回「全园区共用这一份目标与阈值，{lackText}才能改」 |
| `views/analysis/BreakevenView.vue:109 :111` | `report:edit` | `breakeven:edit` |
| `views/analysis/FinCashflowView.vue:197 :198` | `master:view` | `tenants:view` |
| `views/analysis/CockpitView.vue:387` go('/anomaly') | 不判权 | `:disabled="!!lack('/anomaly')" v-tip="lack('/anomaly')"`（实现时改：它是按钮，按 `useViewGate` 的约定置灰写原因；`blocked` 留给图上的点、整行点击这类没法置灰的入口） |
| `views/analysis/PvRoiView.vue:227`（勘察漏列） | 空态副句写死「要有「账簿报表」权限才能填」 | 改不了光伏投资的人末尾接 `anaSettingsLock('pvInvestment')` 的原话（要「光伏投资回收 · 编辑」），改得了的人不说权限 |
| 分析屏与 AnaEmpty 的 lack / blocked / canReach（CockpitView、AnomalyView、ParkView、TenantEnergyView、TenantPortfolioView、TenantPeerView、FinPnlView、FinBalanceView、FinCashflowView、ExpenseView、ChurnView、ExpiryView、BreakevenView、BudgetView、PnlAnalysisView、PvRoiView、PvMeterAnaView、ElecAnalysisView、ChargingAnalysisView、`components/ana/AnaEmpty.vue:25-26`） | 经 navAccess | 不改（`?mode=meter` 深链不再要求抄表查看，只要目标屏查看） |

### 15.8 V140 迁移

文件 `backend/src/main/resources/db/common/V140__rbac_screen_perms.sql`。两条链都跑（老链 V1..V137 + common；起点链 V137 baseline + common）。
**幂等、只增不删**：旧键行原样保留；空库（没有角色）什么都不插；整份重放一遍什么都不变。`backend/src/test/resources/baseline/migration-checksums.txt` 补一行。
只用派生表（`SELECT … UNION ALL …`），不建临时表：字面量跟着列的排序规则走，不会撞「排序规则不一致」。

```sql
-- v4:权限细到菜单单项(用户 2026-10-09 拍板,RBAC-SPEC §15)。只增不删、幂等;旧键行保留(回滚到 0.32 时旧代码照常)。
-- ① 查看:角色在 v3 下能打开哪一屏(navAccess 的进屏门,编辑隐含的查看也算),就给那一屏的 :view
INSERT INTO auth_role_perm (role_id, perm)
SELECT DISTINCT p.role_id, CONCAT(g.scr, ':view')
FROM auth_role_perm p
JOIN (            SELECT 'master:view' AS k, 'master:view' AS v
  UNION ALL SELECT 'master:edit', 'master:view'          UNION ALL SELECT 'company:manage', 'master:view'
  UNION ALL SELECT 'contract:view', 'contract:view'      UNION ALL SELECT 'contract:edit', 'contract:view'
  UNION ALL SELECT 'param:view', 'param:view'            UNION ALL SELECT 'param-policy:edit', 'param:view'
  UNION ALL SELECT 'param-monthly:edit', 'param:view'
  UNION ALL SELECT 'meter:view', 'meter:view'            UNION ALL SELECT 'meter-master:edit', 'meter:view'
  UNION ALL SELECT 'meter-reading:edit', 'meter:view'
  UNION ALL SELECT 'billing:view', 'billing:view'        UNION ALL SELECT 'billing-run:edit', 'billing:view'
  UNION ALL SELECT 'billing-issue:edit', 'billing:view'
  UNION ALL SELECT 'entry:view', 'entry:view'            UNION ALL SELECT 'entry:edit', 'entry:view'
  UNION ALL SELECT 'book-template:edit', 'entry:view'    UNION ALL SELECT 'book-template:switch', 'entry:view'
  UNION ALL SELECT 'salary:view', 'salary:view'          UNION ALL SELECT 'salary:edit', 'salary:view'
  UNION ALL SELECT 'report:view', 'report:view'          UNION ALL SELECT 'report:edit', 'report:view'
  UNION ALL SELECT 'analysis:view', 'analysis:view'
  UNION ALL SELECT 'system:view', 'system:view'          UNION ALL SELECT 'system:edit', 'system:view'
) i ON i.k = p.perm
JOIN (            SELECT 'master:view' AS v, 'data-home' AS scr
  UNION ALL SELECT 'contract:view', 'data-home'  UNION ALL SELECT 'param:view', 'data-home'
  UNION ALL SELECT 'meter:view', 'data-home'     UNION ALL SELECT 'billing:view', 'data-home'
  UNION ALL SELECT 'entry:view', 'data-home'     UNION ALL SELECT 'salary:view', 'data-home'
  UNION ALL SELECT 'master:view', 'buildings'    UNION ALL SELECT 'master:view', 'tenants'
  UNION ALL SELECT 'contract:view', 'contracts'  UNION ALL SELECT 'param:view', 'params'
  UNION ALL SELECT 'meter:view', 'meters'
  UNION ALL SELECT 'billing:view', 'alloc'       UNION ALL SELECT 'billing:view', 'alloc-loss'
  UNION ALL SELECT 'billing:view', 'bill-notices'
  UNION ALL SELECT 'entry:view', 'ledger'        UNION ALL SELECT 'entry:view', 'sales-income'
  UNION ALL SELECT 'salary:view', 'salary'
  UNION ALL SELECT 'entry:view', 'pv-income'     UNION ALL SELECT 'meter:view', 'pv-income'
  UNION ALL SELECT 'entry:view', 'car-charging'  UNION ALL SELECT 'meter:view', 'car-charging'
  UNION ALL SELECT 'entry:view', 'ebike-charging' UNION ALL SELECT 'meter:view', 'ebike-charging'
  UNION ALL SELECT 'entry:view', 'elec-cost'     UNION ALL SELECT 'entry:view', 'utilities'
  UNION ALL SELECT 'master:view', 'import'       UNION ALL SELECT 'contract:view', 'import'
  UNION ALL SELECT 'param:view', 'import'        UNION ALL SELECT 'meter:view', 'import'
  UNION ALL SELECT 'billing:view', 'import'      UNION ALL SELECT 'entry:view', 'import'
  UNION ALL SELECT 'salary:view', 'import'       UNION ALL SELECT 'report:view', 'import'
  UNION ALL SELECT 'report:view', 'reports-home' UNION ALL SELECT 'report:view', 'income-statement'
  UNION ALL SELECT 'report:view', 'balance-sheet' UNION ALL SELECT 'report:view', 'trial-balance'
  UNION ALL SELECT 'report:view', 'rent-pnl'     UNION ALL SELECT 'report:view', 'elec-pnl'
  UNION ALL SELECT 'report:view', 'water-pnl'    UNION ALL SELECT 'report:view', 'ops-pnl'
  UNION ALL SELECT 'report:view', 'expense-pnl'  UNION ALL SELECT 'report:view', 'reconciliation'
  UNION ALL SELECT 'analysis:view', 'cockpit'    UNION ALL SELECT 'analysis:view', 'anomaly'
  UNION ALL SELECT 'analysis:view', 'park'       UNION ALL SELECT 'analysis:view', 'park-energy'
  UNION ALL SELECT 'analysis:view', 'tenant-energy' UNION ALL SELECT 'analysis:view', 'tenant-portfolio'
  UNION ALL SELECT 'analysis:view', 'tenant-peer' UNION ALL SELECT 'analysis:view', 'fin-pnl'
  UNION ALL SELECT 'analysis:view', 'fin-balance' UNION ALL SELECT 'analysis:view', 'fin-cashflow'
  UNION ALL SELECT 'analysis:view', 'fin-expense' UNION ALL SELECT 'analysis:view', 'churn'
  UNION ALL SELECT 'analysis:view', 'expiry'     UNION ALL SELECT 'analysis:view', 'breakeven'
  UNION ALL SELECT 'analysis:view', 'budget'     UNION ALL SELECT 'analysis:view', 'pnl-analysis'
  UNION ALL SELECT 'analysis:view', 'pv-roi'     UNION ALL SELECT 'analysis:view', 'pv-meter-analysis'
  UNION ALL SELECT 'analysis:view', 'elec-analysis' UNION ALL SELECT 'analysis:view', 'charging-analysis'
  UNION ALL SELECT 'system:view', 'sys-users'    UNION ALL SELECT 'system:view', 'sys-roles'
  UNION ALL SELECT 'system:view', 'sys-logs'
) g ON g.v = i.v
WHERE NOT EXISTS (SELECT 1 FROM auth_role_perm x WHERE x.role_id = p.role_id AND x.perm = CONCAT(g.scr, ':view'));

-- ② 动作:旧编辑键 → 新动作,只在这个角色已经有那一屏的 :view(上一步给的)时才给 —— 动作隐含本屏查看,
--    不加这个条件,没有那一屏查看的角色会凭空多看到一屏(15.3 标「需本屏查看」的几行)
INSERT INTO auth_role_perm (role_id, perm)
SELECT DISTINCT p.role_id, m.nk
FROM auth_role_perm p
JOIN (            SELECT 'master:edit' AS ok, 'buildings:edit' AS nk
  UNION ALL SELECT 'master:edit', 'tenants:edit'            UNION ALL SELECT 'master:edit', 'bill-notices:payee'
  UNION ALL SELECT 'company:manage', 'ledger:company'
  UNION ALL SELECT 'contract:edit', 'contracts:edit'
  UNION ALL SELECT 'param-policy:edit', 'params:edit'       UNION ALL SELECT 'param-policy:edit', 'alloc:pools'
  UNION ALL SELECT 'param-policy:edit', 'bill-notices:coef' UNION ALL SELECT 'param-policy:edit', 'elec-cost:price'
  UNION ALL SELECT 'param-monthly:edit', 'params:monthly'
  UNION ALL SELECT 'meter-master:edit', 'meters:archive'    UNION ALL SELECT 'meter-master:edit', 'pv-income:archive'
  UNION ALL SELECT 'meter-master:edit', 'car-charging:archive' UNION ALL SELECT 'meter-master:edit', 'ebike-charging:archive'
  UNION ALL SELECT 'meter-reading:edit', 'meters:edit'      UNION ALL SELECT 'meter-reading:edit', 'pv-income:reading'
  UNION ALL SELECT 'meter-reading:edit', 'car-charging:reading' UNION ALL SELECT 'meter-reading:edit', 'ebike-charging:reading'
  UNION ALL SELECT 'billing-run:edit', 'alloc:edit'         UNION ALL SELECT 'billing-run:edit', 'alloc-loss:edit'
  UNION ALL SELECT 'billing-run:edit', 'bill-notices:edit'  UNION ALL SELECT 'billing-run:edit', 'params:recalc'
  UNION ALL SELECT 'billing-issue:edit', 'bill-notices:issue'
  UNION ALL SELECT 'entry:edit', 'ledger:edit'              UNION ALL SELECT 'entry:edit', 'sales-income:edit'
  UNION ALL SELECT 'entry:edit', 'pv-income:edit'           UNION ALL SELECT 'entry:edit', 'car-charging:edit'
  UNION ALL SELECT 'entry:edit', 'ebike-charging:edit'      UNION ALL SELECT 'entry:edit', 'elec-cost:edit'
  UNION ALL SELECT 'entry:edit', 'utilities:edit'           UNION ALL SELECT 'entry:edit', 'import:edit'
  UNION ALL SELECT 'book-template:edit', 'ledger:template'  UNION ALL SELECT 'book-template:edit', 'sales-income:template'
  UNION ALL SELECT 'book-template:switch', 'ledger:version' UNION ALL SELECT 'book-template:switch', 'sales-income:version'
  UNION ALL SELECT 'report:edit', 'income-statement:edit'   UNION ALL SELECT 'report:edit', 'balance-sheet:edit'
  UNION ALL SELECT 'report:edit', 'trial-balance:edit'      UNION ALL SELECT 'report:edit', 'rent-pnl:edit'
  UNION ALL SELECT 'report:edit', 'elec-pnl:edit'           UNION ALL SELECT 'report:edit', 'water-pnl:edit'
  UNION ALL SELECT 'report:edit', 'ops-pnl:edit'            UNION ALL SELECT 'report:edit', 'expense-pnl:edit'
  UNION ALL SELECT 'report:edit', 'reconciliation:edit'     UNION ALL SELECT 'report:edit', 'park:edit'
  UNION ALL SELECT 'report:edit', 'anomaly:edit'            UNION ALL SELECT 'report:edit', 'fin-cashflow:edit'
  UNION ALL SELECT 'report:edit', 'churn:edit'              UNION ALL SELECT 'report:edit', 'breakeven:edit'
  UNION ALL SELECT 'report:edit', 'pv-roi:edit'
  UNION ALL SELECT 'system:edit', 'sys-users:edit'          UNION ALL SELECT 'system:edit', 'sys-roles:edit'
) m ON m.ok = p.perm
WHERE EXISTS (SELECT 1 FROM auth_role_perm s
              WHERE s.role_id = p.role_id AND s.perm = CONCAT(SUBSTRING_INDEX(m.nk, ':', 1), ':view'))
  AND NOT EXISTS (SELECT 1 FROM auth_role_perm x WHERE x.role_id = p.role_id AND x.perm = m.nk);
```

`salary:view`、`salary:edit`、`review:approve`、`lock:takeover`、`elevate:request` 键名不变，不用映射。角色备注不改（现有几句在 v4 下照样成立）。

**按角色给、权限按账号的角色并集算**（同 V136 的坑，§11.8）：一个账号从 A 角色拿旧编辑键、从 B 角色拿那一屏的查看，v3 能做的动作，V140 按角色给不出来。
会碰上的只有 15.3 标「需本屏查看」的那几行（收款公司、新增删除公司、公摊池配置、系数簿、电价口径、重算、分析目标与阈值）。
不放宽迁移（那会把动作发给只挂其中一个角色的别人）。**部署后跑一次（只读）**，跑出来的人请系统管理员给他其中一个角色补勾：

```sql
SELECT DISTINCT u.username, u.display_name, m.nk AS 缺的权限
FROM auth_user u
JOIN auth_user_role ur ON ur.user_id = u.id
JOIN auth_role_perm p ON p.role_id = ur.role_id
JOIN ( /* 粘贴上面 ② 的 m 派生表原文 */ ) m ON m.ok = p.perm
WHERE u.status = 1
  AND EXISTS (SELECT 1 FROM auth_user_role a JOIN auth_role_perm s ON s.role_id = a.role_id
              WHERE a.user_id = u.id AND s.perm = CONCAT(SUBSTRING_INDEX(m.nk, ':', 1), ':view'))
  AND NOT EXISTS (SELECT 1 FROM auth_user_role b JOIN auth_role_perm x ON x.role_id = b.role_id
                  WHERE b.user_id = u.id AND x.perm = m.nk);
```

上面这条只抓「账号已经有那一屏查看」的人。15.3「自建角色能改的会变的几处」碰到的是**没有**那一屏查看的角色，抓不到，另跑这一条（只读，按角色列）：

```sql
-- ③ 迁移后能改的会变的角色(15.3 第二张表),交给系统管理员逐个决定补不补
SELECT r.code, r.name, '报表屏上给公司改名：没了' AS 变化 FROM auth_role r
WHERE EXISTS (SELECT 1 FROM auth_role_perm p WHERE p.role_id = r.id AND p.perm = 'master:edit')
  AND EXISTS (SELECT 1 FROM auth_role_perm p WHERE p.role_id = r.id AND p.perm IN ('report:view', 'report:edit'))
  AND NOT EXISTS (SELECT 1 FROM auth_role_perm p WHERE p.role_id = r.id AND p.perm = 'bill-notices:payee')
UNION ALL
SELECT r.code, r.name, '报表屏上新增 / 删除公司、报表导入自动建公司：没了' FROM auth_role r
WHERE EXISTS (SELECT 1 FROM auth_role_perm p WHERE p.role_id = r.id AND p.perm = 'company:manage')
  AND EXISTS (SELECT 1 FROM auth_role_perm p WHERE p.role_id = r.id AND p.perm IN ('report:view', 'report:edit'))
  AND NOT EXISTS (SELECT 1 FROM auth_role_perm p WHERE p.role_id = r.id AND p.perm = 'ledger:company')
UNION ALL
SELECT r.code, r.name, '充电桩模拟填充：没了' FROM auth_role r
WHERE EXISTS (SELECT 1 FROM auth_role_perm p WHERE p.role_id = r.id AND p.perm = 'billing-run:edit')
  AND EXISTS (SELECT 1 FROM auth_role_perm p WHERE p.role_id = r.id
              AND p.perm IN ('meter:view', 'meter-master:edit', 'meter-reading:edit'))
  AND NOT EXISTS (SELECT 1 FROM auth_role_perm p WHERE p.role_id = r.id AND p.perm = 'meter-reading:edit')
UNION ALL
SELECT r.code, r.name, '充电桩模拟填充：多了' FROM auth_role r
WHERE EXISTS (SELECT 1 FROM auth_role_perm p WHERE p.role_id = r.id AND p.perm = 'meter-reading:edit')
  AND NOT EXISTS (SELECT 1 FROM auth_role_perm p WHERE p.role_id = r.id AND p.perm = 'billing-run:edit');
```

**启动时补一次新键**（回滚再升级、开发库被 master 存过角色时用）：V140 是版本化迁移，只跑一次；而 0.32 的代码保存角色是整组替换、丢掉它不认识的键。
所以回滚到 0.32 期间有人在角色屏存过的角色只剩旧键，再升回 0.33 时 V140 已记在 flyway 历史里不会再跑，这个角色的人登进去什么都看不到。
开发期也一样：13306 上另有 agent 跑 master，他存一次角色，本分支看到的就是空角色。
做法：新加 `config/LegacyPermBackfill`（`ApplicationRunner`），每次启动把 classpath 里 `db/common/V140__rbac_screen_perms.sql` 的正文再执行一遍（`ResourceDatabasePopulator`），然后 `cache.reload()`。
**只碰还有纯旧键的角色**（复查改，§15.13 ①）：两条 INSERT 的 `FROM auth_role_perm p` 后面各插一个
`JOIN (SELECT DISTINCT role_id FROM auth_role_perm WHERE perm IN (<Perm.LEGACY_LABELS 的 23 个键>)) lg ON lg.role_id = p.role_id`，
按精确字符串插、命中不是 2 处就启动失败（V140 正文被校验和钉死，不会悄悄变）。映射表仍只有 V140 一份。
原先「原样重跑、不加条件」是错的：`salary:view` / `salary:edit` 新旧同名、也在第①步的旧键表里，0.33 里存过的角色只要勾了工资，
每次启动都被补上「本月出账 · 查看」「导入中心 · 查看」，管理员取消了下次重启又回来（越权，复查用私有 MySQL 复现过）。
库里还有纯旧键行 ⇔ 这个角色从上次在 0.32 保存以来没在 0.33 存过（0.33 一存旧键就删光），这时它的新键本来就该等于从旧键推出来的那一组，重跑只会补上缺的。
代价：回滚期间在 0.32 新建、只勾了工资（没有别的旧键）的角色补不到本月出账与导入中心的查看 —— 少给不多给，管理员补勾即可。每次启动两条 `INSERT … SELECT`，表只有几十行。
不用 Flyway 的 `R__` 可重复迁移：它只在文件校验和变了时才重跑，回滚再升级时文件没变。

**新代码怎么忽略旧键**：`Perm.exists` 只认 107 个新键；`UserPermissionCache.reload` 和 `SystemService` 里读 `auth_role_perm` 的四处（`knownPermsOf`，§15.6）先滤 `exists`。
所以旧键行在库里不起任何作用：不进快照、不进 `/auth/me`、不在角色屏出现、不参与分级比较和「权限变没变」的判断。

**角色保存时清旧键**：`replacePerms` 本来就是整组删了再插、`validPerms` 丢掉不认识的键 —— 一个角色在 0.33 里保存一次，它的旧键行就没了。
`permDiff` 的「改前」先滤 `exists`，所以这次保存不会在日志里记一串「去：主数据 · 查看（旧版）…」。

**回滚的代价**：回到 0.32 后，在 0.33 里保存过的角色只剩新键，旧代码一项都不认，这个角色的人登进去什么都看不到，要在 0.32 的角色屏重新勾一遍。
没在 0.33 里保存过的角色照常（旧键行还在）。反方向（回滚期间在 0.32 存过的角色再升回 0.33）由上面的启动补齐接住，不丢。
开发期间同一个 13306 开发库上另有 agent 跑 master（0.32）：本分支在开发库上存一次角色，master 那边这个角色就空了 —— **本分支开发时不要在开发库上保存角色**；master 那边存角色，本分支下次启动会补回新键。

**旧键的只读中文名**（`Perm.LEGACY_LABELS`，只给 `label()` 用，不进 `ALL`、不可勾）：v3 的 23 个键各用原来的中文名加「（旧版）」——
`master:view` 主数据 · 查看（旧版）、`master:edit` 主数据（旧版）、`company:manage` 公司/账册管理（旧版）、`contract:view` 合同 · 查看（旧版）、`contract:edit` 合同（旧版）、
`param:view` 计费参数 · 查看（旧版）、`param-policy:edit` 计费口径（旧版）、`param-monthly:edit` 月度计费录入（旧版）、`meter:view` 抄表 · 查看（旧版）、
`meter-master:edit` 表档案（旧版）、`meter-reading:edit` 抄表（旧版）、`billing:view` 出账与催缴单 · 查看（旧版）、`billing-run:edit` 出账运行（旧版）、
`billing-issue:edit` 催缴单签发（旧版）、`entry:view` 台账与附表 · 查看（旧版）、`entry:edit` 事后录入（旧版）、`book-template:edit` 账册模板编辑（旧版）、
`book-template:switch` 更换账册版本（旧版）、`report:view` 报表 · 查看（旧版）、`report:edit` 账簿报表（旧版）、`analysis:view` 经营分析 · 查看（旧版）、
`system:view` 系统管理 · 查看（旧版）、`system:edit` 系统管理 · 管理（旧版）。
会用到它的地方：操作日志里 0.32 之前的 `elevate.grant`（对象原样存的是 `perm:旧键`，§15.6 换成人话再回包）。

**测试库重放**：`RbacViewPermsMigrationIT` 的 `@AfterEach` 会把 V134–V137 重放进共享测试库、`ReviewMigrationIT` 会删掉审核员角色再用 V124 + V134 重建。
两处收尾都要**再重放一次 V140**，否则同一容器里后面的 IT 看到的预置角色只有旧键（新代码眼里一项权限都没有）。旧键被重放回来不碍事（新代码不认）。

0.33 稳定一段时间后，另开一个迁移删掉旧键行（不在本次）。

### 15.9 角色屏：权限树与成员栏

#### 权限树（取代「模块权限」矩阵）

- 数据：`GET /api/system/perms` 的 `perms[]`（key、label、hint、screen、kind）。前端不列权限点清单，只按 `FP_NAV` 的层 / 分组 / 屏顺序把它们挂上去；
  树的结构计算放进 `views/system/roleTree.ts`（纯函数：建树、三态、整列勾 / 清），屏只管画。
- 结构：**层**（数据中心、账簿与报表、经营分析、系统管理）→ **分组**（`section.title`；没标题的分组的屏直接挂在层下）→ **屏**。
  `screen` 不在 `FP_NAV` 里的键落最后一组「其他」，不丢；`screen` 为空的三项落树下面单独一段「不分屏的权限」（照旧是一行一个勾选框加说明）。
- 每屏一行，三列：**查看**（一个勾选框）、**编辑**（一个勾选框，或「—」）、**其他动作**（0–4 个带名字的勾选框，名字取中文名「 · 」后面那段，悬停看说明）。
  屏名下面一行小字是查看那一项的说明。
- 层行、分组行在三列各放一个**三态勾选框**，可编辑时三态**只数自己有的那几项**（`lacks` 的格不算；只读时按全部键算，复查改：不然勾着很多项的角色表头显示空框、格子却是勾上的）：这些项全勾 → 勾；一个没勾 → 空；部分 → 半勾。点一下：不是全勾就把这些项全勾上，全勾就全清。
  `lacks` 的格不被整列勾上，也不被整列清掉；这一列下面全是 `lacks` 时表头置灰、点不动，悬停同格子那句。这一列下面一项都没有（比如经营分析的「其他动作」）就画「—」。
  （`lacks` 不能算进三态：管得了的角色不可能已经勾着编辑者没有的权限（§12.2），把它们算进去，这一列永远到不了「全勾」，表头只会一直「全勾上」、再也清不掉。）
- 联动：勾编辑或任一动作 → 自动勾上本屏查看；取消本屏查看 → 连带取消本屏全部动作。整列操作同样联动（整列勾编辑会把这些屏的查看一起勾上；整列清查看会把这些屏的动作一起清掉）。
- 管不了的角色整块只读（`manageable=false`），自己没有的那一格置灰，悬停「你没有这项权限，只有系统管理员能把它分给角色」（§12.5 照旧）。
- 「导航可见层」那一段不动（每行右边原来印着 `data` / `reports` / `analysis` 代码胶囊，复查时去掉；只改说明里那句「系统管理层单独由「系统管理 · 查看」权限决定」：v4 没有这一项了，改成「系统管理层不在这里配，看用户管理、角色权限、操作日志这三屏的查看勾没勾」）。
- 窄屏（≤960）照旧单列、树的外框横滚。

#### 成员栏

- 位置：右栏放得下时在权限树右边一列，宽 280；放不下就排到权限树上面整宽；≤960 跟着单列。页面最大宽度从 1200 放到 1440。
  「放得下」按右栏自己的内宽判（容器查询，内宽 > 935 = 权限树最小 600 + 间距 16 + 成员 280 + 余量 40），**不按视口 1200 判**：
  视口 1440、左边导航展开时右栏内宽只有 736（浏览器实测），按视口判会把权限树挤到 440 宽、横向滚动。实测视口 1920 时并排、1440 时上下排。
- 数据：`load()` 里 `GET /api/system/users`（不带筛选；读规则对 `sys-roles:view` 放行）和权限字典、角色列表一起取；本角色成员 = `roles` 里含本角色 id 的账号。不按角色逐个请求。
  什么时候重取：进屏、保存 / 删除之后、页签切回（`onReactivated`，和用户管理屏同一个钩子）。切回时表单没有改动就三样全重取；
  有改动就只重取账号列表（权限勾选是整份快照，不能冲掉；成员改动是增量，换了底也成立）：待加入的人已经在角色里了、待移出的人已经不在了，这一条待办就去掉，改动数跟着少。
  这样在用户管理里改了某人的角色，切回角色屏就看得到。
- 每行：账号（等宽字）· 姓名 ·「已停用」徽标（停用的账号）·「你」（自己）；行尾「移出」。
- 「添加成员」：`ds/Popover` 里放 `ds/SearchField`（按账号或姓名筛）和 `ds/PopoverItem` 列表，列出不在本角色、也没在本次待加入里的账号；不用原生 select，也不新造组件。
- 改动先记在表单里，和权限一起点「保存」提交：待加入的行排最前，标「保存后加入」，可以再点「移出」撤掉；待移出的行变灰，标「保存后移出」，行尾换成「撤销」。
- **改动数** = 原来的（名称、备注、每勾 / 去一个权限点、每勾 / 去一个导航层各 1）+ 待加入人数 + 待移出人数。新建角色时 = 标识、名称、勾上的权限点、待加入人数。离开 / 换角色的确认（`askLeave`）用同一个数。
- 新建角色时也能直接挑成员。

#### 接口

不加新端点，跟角色保存走同一个请求（同一个事务：权限和成员一起成，或一起不成）：

| | 请求 | 回包 |
|---|---|---|
| `POST /api/system/roles` | `RoleCreateReq{code, name, navLayers, perms, remark, addUserIds?: Integer[]}` | `RoleDTO`（`userCount` 已含新成员） |
| `PUT /api/system/roles/{id}` | `RoleUpdateReq{name, navLayers, perms, remark, addUserIds?: Integer[], removeUserIds?: Integer[]}` | `RoleDTO` |

带**增量**而不是整份名单：保存前别人在用户管理里给某人加了这个角色，整份名单会把他冲掉；增量不会。
已在角色里的再加、不在的再移出：不算错，什么都不做。同一个 id 同时在两个列表里 → 400「同一个账号不能同时加入和移出」；id 不存在 → 404「账号不存在」。

#### 守卫（与用户管理改角色同一条路径）

`SystemService` 抽出 `changeRoles(AuthUser u, Set<Integer> nextRoleIds, String auditDetail)`，`updateUser`（用户管理整组改）和角色保存里的每个增 / 删都调它。顺序：

1. 写端点要 `sys-roles:edit`（规则表）；用户管理那边要 `sys-users:edit`。
2. 角色本身：`guardSelfKeepsRolesEdit`（原 guardSelfKeepsSystemEdit，守 `sys-roles:edit`）→ `guardRoleInRange(角色, 改前 ∪ 改后的权限)` → 写权限。成员的守卫在权限写完之后跑，比的是这次保存之后的权限。
3. 每个要变的账号，`changeRoles` 里：
   1. 改自己的角色 → 409「不能修改自己的角色，请另一位管理员操作」（成员栏用这句；用户管理整组改照旧先用它原来那句「不能修改自己的角色。显示名可以改……」拦在前面）；
   2. 角色集合有变 → `guardKeepsAnAdmin(u, true, next)`：把最后一个启用的系统管理员移出系统管理员角色 → 409（§12.3 原文案，带锁）。
      实现时核对：这一条**从成员栏走不到** —— 能改系统管理员角色的只有系统管理员（`guardRoleInRange` 先 403 别人），而他自己就是另一个启用的系统管理员，移出自己又先被第 1 条拦下。守卫留在共用路径上，由用户管理那条路钉（SystemTieringIT）；成员栏那一行的置灰照旧（前端按账号状态判）；
   3. `guardUserInRange(u, next)`：目标是系统管理员账号、目标现有权限里有我没有的、把系统管理员角色分给人、新角色超出我的范围 → 403（§12.2 原文案）；
   4. 单行 `INSERT` / `DELETE auth_user_role`（不整组删了再插，免得和用户管理同时改时互相覆盖；`updateUser` 自己按差集同样单行写）；
   5. 审计 `user.update`，对象 `user:<账号>`，详情「加入角色「X」」/「移出角色「X」」（用户管理整组改写「角色：加「X」；去「Y」」）。
4. 角色的名称 / 导航层 / 权限有变才写 `role.update`（详情是新 `permDiff`）；只改了成员不写这一条。
5. 全部成功后一次 `cache.reload()`；给每个**角色或权限变了的人**发一条铃铛「你的角色或权限被改了」/「刷新后生效」（同一次保存里一人只发一条；`NoticeService.add` 照旧跳过操作人本人）。
6. 任一条守卫拦下 → 整次保存回滚，toast 显示后端原话（带账号名）。方法照旧 `@Transactional` + `@NoReviewGuard`。

#### 边界

| 情形 | 屏上 |
|---|---|
| 本角色没有成员 | 「还没有账号用这个角色」 |
| 停用的账号 | 照常列出、能加能移出，带「已停用」 |
| 自己那一行 | 「移出」置灰，悬停「不能改自己的角色，请另一位管理员操作」；「添加成员」里自己也置灰、同一句 |
| 系统管理员角色里最后一个启用的账号 | 「移出」置灰，悬停「「X」是最后一个启用的系统管理员账号，移出后就没有人能管理整个系统了」 |
| 管不了的账号（`UserDTO.manageable=false`） | 「移出」与候选里置灰，悬停「系统管理员账号只有系统管理员能改」或「这个账号有你没有的权限，只有系统管理员能改」 |
| 管不了的角色、或没有 `sys-roles:edit` | 只列名单，没有「添加成员」「移出」 |
| 候选为空 | 「所有账号都已在这个角色里」；搜索无结果「没有找到这个账号」 |
| 删除角色 | 有成员时按钮置灰，悬停「该角色下还有 N 个账号，请先移出」 |

#### 屏上文案（逐句）

- 页头副标题：「每一屏有「查看」，能改数据的屏另有「编辑」，有的屏还有单独的动作（比如催缴单的「签发」）；勾编辑或动作会自动带上这一屏的查看。共 N 个角色」（复查改：51 屏里 17 屏没有编辑，原句「每一屏分查看和编辑」不成立）
- 权限段标题「菜单权限」；说明「没勾查看的屏，导航里不出、直接打开显示无权查看。层和分组那一行的勾选框管下面整列：点一下全勾，再点一下全清。」
- 列头：「菜单」「查看」「编辑」「其他动作」；树下面一段标题「不分屏的权限」。
- 成员栏标题「本角色成员（N）」，有待加入 / 待移出时写「本角色成员（现 N，保存后 M）」（复查改：原来只写保存后的数，和角色头「N 个账号使用中」并排对不上）；按钮「添加成员」；搜索框占位「按账号或姓名找」；行内「移出」「撤销」；标记「保存后加入」「保存后移出」「已停用」「你」。
- 保存成功：「已保存「X」 —— 立即生效；被改到的账号刷新页面后，导航才跟着变」（复查改：原句「这些账号」前面没有可指的账号）。
- 只读说明：「只读：改角色需要「角色权限 · 编辑」。」

### 15.10 测试清单

跑法照任务书：后端 IT 合成一次跑、带 `TESTCONTAINERS_REUSE_ENABLE=false`；判绿数 `surefire-reports/TEST-*.xml`；前端看 vitest JSON。

**要改的旧测试**（勘察 testsPinning）

| 文件 | 改什么 |
|---|---|
| `security/PermissionCoverageTest` | 28 / 10 / 11 组的钉子换成：ALL 107、查看 51 且每屏恰好一个、`IMPLIED_VIEW` 由 META 推出且每条都指向本屏、`NOT_ELEVATABLE` 等于 15.2 的「不可」列、读规则只引用查看、**写规则不引用查看**、读写路由回归按 15.5 重写（含铁律 4：`/api/charging/07/records`、`/api/pnl/S1/2025`、`/api/reports/IS/1/2025/1` → 空 anyOf；`POST /api/auth/approvals` → `[elevate:request]`、`POST /api/auth/approvals/7` → 任何已登录；`GET /api/bills` → `[ledger:view]`、`/api/bills/s10` → `[sales-income:view]`、`/api/s10/1/2025/1` → `[sales-income:view]`、`/api/s10/month-totals` → `[reports-home:view, sales-income:view]`）、工资写只认 `salary:edit` 照旧 |
| `security/RoleApiIT` | 七个预置角色的权限集合按 15.4 换成新键；admin 恰好等于 `Perm.ALL`（107） |
| `security/ReadPermissionIT` | `userWith(...)` 换屏键；403 文案按 `needText` 三档各钉一条；股东 = 报表 10 + 分析 20 + `import:view`；打码改认 `tenants:view` / `bill-notices:view`；编辑隐含查看换成「动作隐含本屏查看」 |
| `api/RbacViewPermsMigrationIT`、`api/ReviewMigrationIT` | 收尾重放后再重放 V140（§15.8） |
| `api/SystemApiIT` | `/system/perms` 字典 = `Perm.ALL`；自锁改钉 `sys-roles:edit`；未知键与旧键都被静默丢掉 |
| `api/SystemTieringIT` | 角色只有 `sys-users:*`、`sys-roles:*`；`sys-roles:edit` 隐含 `sys-roles:view`；分级换屏键 |
| `service/SystemServicePermDiffTest` | 新格式逐字；107 项全加不超过 255 字（截断写「等 N 屏」） |
| `api/AuditTrailIT` | 可见性换屏键；`report_amount` / `pnl_row` 按行定位过滤（只有利润表查看看不到资产负债表的改动）；删一家三张报表都有数的公司后，只有利润表查看的人在日志里看到「利润表 · {公司}」那一条摘要、看不到另两条；`role.update` 详情新格式 |
| `api/AnalysisSettingApiIT` | 六项各要归属屏编辑：只有 `park:edit` 改 collectTarget → 403，改 occTarget → 200 |
| `api/ReviewApiIT`、`api/ReviewPingIT`、`security/ReviewKeyTest` | kind → 新键；只有 `income-statement:edit` 的角色能交利润表的审（修 v3 缺口；实现放在 `api/ScreenPermIT`，和其余单屏角色一起建） |
| `api/ElevationApiIT` | `param-policy:edit` → `params:edit`；不可提权文案按 `Perm.isSystem` |
| `api/MeterImportFactorPermIT`、`service/MeterImportEquivalenceIT:66-67` | `meter-master:edit` → `meters:archive` |
| `api/BookPinApiIT` | ALL 107；换版按账册所属屏（按屏那条实现放在 `api/ScreenPermIT`） |
| `api/ApiErrorEnvelopeIT:70`、`api/PentestFixesIT:208-211` | system 段 403 文案改成通用的 needText 写法 |
| `api/NoticeApiIT:157`、`security/ApprovalStoreTest:39`、`api/InputLimitsApiIT:101`、`service/CompanyServiceTest:127`、`security/PasswordSelfServiceIT:95` | 字面量换新键 |
| 用预置角色登录断言「能读不能写」的一批（CpMeterApiIT、ElecCostApiIT、PvMeterApiIT、AppConfigApiIT、AuditLogApiIT、AllocApiIT、BillNoticeApiIT、BillsApiIT、LockApiIT、SessionCacheRaceIT、AuthUserLostUpdateIT） | 不改；迁移等价，这批必须照绿 |
| `BaselineChainIT`、`MigrationLayoutTest` | V140 两条链结果逐行相同；校验和文件补一行 |
| `api/ChargingDeleteApiIT`、`api/ChargingImportApiIT`、`api/PnlApiIT`、`api/ReportApiIT`（实现时补） | 非法附表号 / 附表 / 报表（`/api/charging/99/…`、`/api/pnl/s9/…`、`/api/reports/xx/…`）原来走到 service 回体内 404 / 400，铁律 4 之后在 URL 层就 HTTP 403（系统管理员也一样），断言改成 403 |
| `api/ChangeLogWritePathsIT`（实现时补） | 删公司的报表摘要按三张表各一条，行定位「利润表 · {公司}」，0 格的表不记 |
| `arch/QueryHygieneTest`（实现时补） | `SystemService` 全表查基线 5 → 4（读 `auth_role_perm` 收进 `knownPermsOf`） |
| 前端 `nav/__tests__/navAccess.spec`、`router/viewGuard.spec`、`stores/__tests__/auth.spec`、`views/system/systemRolesView.spec`、`components/ana/__tests__/anaViewGate.spec`、`views/__tests__/crossLayerLinkGate.spec`、`views/__tests__/readonlyHasNoWriteButtons.spec`，以及 §15.11 列的其余 spec | 字面量换屏键；`ALL_VIEWS` 改从导航表派生后，只用 `grantViews` 的 spec 不用改 |

**要加的新测试**

| 测试 | 钉什么 |
|---|---|
| `security/PermScreensMatchFpNavTest`（单测） | 读 `../frontend/src/nav/fpNav.ts`，抽出每个 `{ value, label }` 和它在第几层：与 `Perm.SCREENS` 逐条相同（个数、顺序、value、label、层），多一个少一个都红 |
| `security/ScreenAccessMatrixTest`（单测，表驱动，不起容器） | 夹具 = 勘察清单逐屏的 reads / writes（每屏一组具体路径，不用模板；实现时勘察清单不在手边，按 15.5 两张表的「依据」列按屏倒过来写，另加一条**等式**：一条路径放行的恰好是夹具里调它的那几屏 / 那几项，多一个即越权）。① 只给 `<屏>:view`：这屏每个读路径 `resolveRead` 含它；② 只给这屏的编辑或动作：这屏每个写路径 `resolve` 含对应键；③ 兄弟屏拒：如 `alloc-loss:edit` 不在 `POST /api/alloc/rules` 里、`car-charging:edit` 不在 `/api/charging/8/**` 里、`rent-pnl:edit` 不在 `/api/pnl/s2/**` 里、`ledger:template` 不在 `POST /api/books/1/template/pin` 里、`bill-notices:view` 不在 `GET /api/bills` 与 `/api/bills/s10` 里、`reports-home:view` 不在 `GET /api/s10/1/2025/1` 里、`import:view` 不在 `GET /api/pnl/s1/2025` 里 |
| `api/ScreenPermIT`（真 HTTP） | 六个单屏角色各跑一遍自己的读接口全不是 403：只看楼栋损耗（出账链月索引）、只看附表1（八个派生接口）、只看光伏分栋分析、只看出租与楼栋（`/buildings/{id}`）、只看异常提醒中心（`/pv-meter/months`）、只看报表中心 + 利润表（勾稽③读 `/api/s10/month-totals` 200、`/api/reports/is/all/…` 200；附表10 宽表 `/api/s10/1/2025/1` 403 —— 报表中心只拿合计）、只看报表中心（`/api/reports/is/all/…` 403 —— 卡片上的数要对应报表的查看）。另外：只看汽车桩的人读 `/cp-meter/stations` 只回汽车桩、写电动车桩 403；只看异常提醒中心的人不带 `key` 调 `/api/params`，回包只有 `pv_` 开头的键；只有系数簿的人：改池的受益户 403、改二期电梯池层份 200（夹具用分母或加度在初始版之后按月改过版的池，请求照系数簿原样带初始版的 `coefficient`）、改一期池或二期非电梯 / 消防池的份额 403、`PUT /api/params` 写 `tenant:1` 的 `lamp_rate` 200、写 `loss_base_park_meter` 和 `loss_base_form_b1` 403；只读账号 `POST /api/auth/approvals` 403；`/api/charging/07/records` 403 |
| `api/RbacScreenPermsMigrationIT` | 七个预置角色迁移后的键集合与 15.4 逐格相等；自建夹具：只有 `meter:view` → 六屏查看；`param-policy:edit` 没有出账查看 → 新键恰好 `{data-home:view, params:view, import:view, params:edit}`（`param-policy:edit` 先折成 `param:view`，它给计费参数、本月出账、导入中心三屏查看），`alloc:pools`、`bill-notices:coef`、`elec-cost:price` 都不在；`company:manage` + `entry:view` → `ledger:company`；旧键行原样保留；重放一遍什么都不变。启动补齐：一个只剩旧键的角色（模拟回滚期间在 0.32 存过）跑一次 `LegacyPermBackfill` 后新键与 V140 结果相同；只有新键的角色一行不变 |
| `api/RoleMembersIT` | 加 / 移出成员走 PUT；改自己 409；最后一个启用的系统管理员 409；非系统管理员动比自己大的账号 403；被改的人收到铃铛（一人一条）；审计「加入角色」「移出角色」；被移出的人下一个请求按新权限判；增量不冲掉用户管理同时加的人；新建角色带成员 |
| `api/LegacyKeysIgnoredIT` | 一个只有旧键的角色：角色列表回包为空、`/auth/me` 为空；在 0.33 保存一次后旧键行没了、日志里不记旧键。另用一个旧键 + 新键都有的自建角色 X（V140 跑完的样子）和一个非系统管理员、有 `sys-roles:edit` 与 `sys-users:edit`、新键覆盖 X 的操作人：他保存 X（只改备注）得 200、X 的成员收不到铃铛；他在 `GET /api/system/users` 里看挂着 X 的账号 `manageable=true`；`GET /api/system/roles` 里 X 的 `manageable=true` |
| `security/FrontendPermLiteralsTest`（单测） | 扫 `frontend/src` 非测试文件里 `can('…')`、`hasOwn('…')`、`perm="…"`、`useEditMode([…])`、`lackText([…])`、`openEditor(…, […])`、`module: […]`、`asking.value = […]` 里的字面量，每个都必须 `Perm.exists`。三个前端 agent 各改各的，键名打错字由它当场拦 |
| 前端 `views/system/roleTree.spec.ts` | 树按 `FP_NAV` 顺序；不认识的 screen 落「其他」；三态（全 / 空 / 部分）；整列勾带上查看、整列清查看带走动作；`lacks` 的格不被整列操作碰到；有 `lacks` 项的列点两下回到全空（三态只数非 `lacks` 项）；整列全是 `lacks` 时表头不可点；改动数含成员增减 |
| 前端 `views/system/systemRolesView.spec.ts`（重写） | 渲染树与成员栏；自己 / 最后一个系统管理员 / 管不了的账号置灰与悬停原话；保存请求体带 `addUserIds` / `removeUserIds`；只读角色没有成员按钮；切回时表单干净 → 三样重取，表单有改动 → 只重取账号、勾选不动、已失效的待加入 / 待移出被去掉 |
| 前端 `views/data-home/DataHomeView.spec.ts`（加） | 逐键交审：只有 `ebike-charging:edit` 时附表7/8 行只交电动车那把键；只有 `car-charging:edit` 时不交电动车那把；只有 `alloc:edit` 时楼栋损耗那一行也能交（同 `ReviewKind.ALLOC_LOSS`）；`SUBMIT_PERMS` 的每个键都 `isKnownPerm` |
| 前端 `reports/reportsHome.spec.ts`（加） | 只授 `reports-home:view` + `balance-sheet:view`：`loadHomeData` 不请求 `/reports/is/all`、`/reports/tb/all`、`/recon/*`、`/pnl/*/overview`、`/s10/*`，利润表卡状态是「没有查看权」不是「待生成」；再加 `income-statement:view`：勾稽③只调一次 `/s10/month-totals`，不调 `/s10/{期区}/…` |
| 前端 `utils/coefBookLogic.spec.ts`（加） | `COEF_KEYS` 价目键 ∪ 它们 `writePlan` 的键 = `param-registry.json` 里 `coefBook` 为真的键（12 个） |
| 前端 `nav/__tests__/navAccess.spec.ts`（重写） | 51 屏 `viewPermsOf` 都是 `[<屏>:view]`；`?mode=meter` 不再改门；`isScreenWrite` / `isKnownPerm` |

**复查后补的测试**（§15.13）

| 测试 | 钉什么 |
|---|---|
| `api/ScreenPermIT.everyScreen_viewOnly_noReadOfThatScreenIs403` | 51 屏逐屏只勾这一屏的查看，把 `ScreenAccessMatrixTest` 夹具里这屏的读接口真打一遍 HTTP，一个都不许 403（URL 门之外 service 里还有按屏收窄的几处，单测看不到）。夹具路径不带查询参数：400 / 404 不算，只认 403 |
| `api/ScreenPermIT.chargingBatchDelete_onlyTouchesTheScheduleInTheUrl`、`reportCustomRowDelete_idOfAnotherStatementIsNotFound` | 只有汽车桩编辑的人从 `/7/batch` 送电动车的 id：那行还在、同批本附表的行照删；利润表编辑的人删资产负债表的自定义行 → 404，两张表同名行都还在 |
| `api/RbacScreenPermsMigrationIT.startupBackfill_…`（加三个夹具） | 0.33 里存过、勾了工资查看 / 工资编辑的角色，启动补齐后一行不变；还有旧键的角色工资照旧键推 |
| `api/AuditTrailIT.legacyCompanyDeletionSummaryWithBareCompanyName_…` | 照 0.32 原样写一行裸公司名的删公司摘要：系统管理员、只看科目余额表的人看得到；一张报表都看不了的人看不到 |
| 前端 `FPReviewActions.spec`、`DataHomeView.spec` | 只有「园区抄表 · 表档案」、只能请提权、借来编辑权的人都不画「交审」 |
| 前端 `notifyPanel.spec` | 看不了那一屏不跳、不关面板、回执写屏名；电动车的待审去电动车那屏 |
| 前端 `useEditMode.spec` | 缺一项且不能请提权：不弹授权窗，回执写还要哪几项 |
| 前端 `stepStripNarrow.spec`、`stepStrip.spec`、`systemRolesView.spec`、`router/viewGuard.spec` | 窄档面板看不了的那步置灰写原因；字典没到时原因写屏名不写英文键；只读时三态照实际勾的画；成员栏「现 N，保存后 M」；导航可见层不印代码；只授利润表查看时资产负债表落「无权查看」 |

新写的守卫断言照断言纪律逐条破坏验证（改坏 → 只红那一条 → 精确替换还原 → touch）。

### 15.11 文件归属（前端）

一个文件只归一个 agent；一个 spec 同时测两边的归 data。

| agent | 文件 |
|---|---|
| infra | `nav/navAccess.ts`、`stores/auth.ts`、`router/index.ts`、`test-utils/perms.ts`、`types/system.ts`、`api/system.ts`、`views/system/SystemRolesView.vue`、`views/system/roleTree.ts`（新）、`views/system/SystemUsersView.vue`、`components/shell/Toolbar.vue`、`composables/useViewGate.ts`、`changelog.ts`；spec：`nav/__tests__/navAccess.spec.ts`、`router/viewGuard.spec.ts`、`stores/__tests__/auth.spec.ts`、`stores/__tests__/favorites.spec.ts`、`stores/__tests__/presence.spec.ts`、`stores/__tests__/tabs.spec.ts`、`composables/__tests__/useEditLock.spec.ts`、`composables/__tests__/useEditMode.spec.ts`、`components/shell/__tests__/notifyPanel.spec.ts`、`components/shell/__tests__/palette.spec.ts`、`components/shell/__tests__/sidebarPanel.spec.ts`、`__tests__/appInterrupts.spec.ts`、`views/system/roleTree.spec.ts`（新）、`views/system/systemRolesView.spec.ts`、`views/system/systemUsersReset.spec.ts`、`views/system/systemUsersView.spec.ts`、`views/__tests__/changePasswordSelf.spec.ts`、`views/home/__tests__/homeView.spec.ts` |
| data | `utils/importRegistry.ts`、`views/import-center/ImportCenterView.vue`、`views/data-home/DataHomeView.vue`、`views/buildings/BuildingsView.vue`、`views/buildings/BuildingDrawer.vue`、`views/tenants/TenantsView.vue`、`views/tenants/TenantDrawer.vue`、`views/contracts/ContractsView.vue`、`views/contracts/ContractDrawer.vue`、`views/contracts/ContractNewDialog.vue`、`views/params/ParamCenterView.vue`、`views/meters/MeterView.vue`、`views/meters/MeterDetailDrawer.vue`、`views/meters/MeterDeleteDialog.vue`、`views/alloc/PoolLedgerView.vue`、`views/alloc/LossLedgerView.vue`、`views/bills/BillNoticesView.vue`、`views/bills/CoefBookWindow.vue`、`views/bills/CompanyBookWindow.vue`、`views/bills/PayBookWindow.vue`、`views/ledger/LedgerView.vue`、`views/ledger/LedgerWideTable.vue`、`views/ledger/LedgerCompanyPicker.vue`、`views/sales-income/S10View.vue`、`views/pv/PvView.vue`、`views/pv/PvMeterView.vue`、`views/charging/ChargingView.vue`、`views/charging/CpMeterView.vue`、`views/elec/ElecView.vue`、`views/elec/ElecCostView.vue`、`views/utilities/UtilitiesView.vue`、`components/fp/TemplateEditorPanel.vue`、`components/fp/FPStepStrip.vue`、`components/fp/ColumnMapPanel.vue`、`views/data-home/monthClose.logic.ts`、`utils/__fixtures__/param-registry.json`（照后端导出拷）；spec：`utils/coefBookLogic.spec.ts`、`components/fp/__tests__/FPReviewActions.spec.ts`、`bookRailChips.spec.ts`、`elevChip.spec.ts`、`elevateRemote.spec.ts`、`components/sched/__tests__/schedBannerSweep.spec.ts`、`schedHeader.spec.ts`、`schedHints.spec.ts`、`views/data-home/DataHomeView.spec.ts`、`views/alloc/__tests__/poolBanners.spec.ts`、`views/bills/bookBatchBar.spec.ts`、`views/bills/coefBookLock.spec.ts`、`views/contracts/contractTerminate.spec.ts`、`views/ledger/__tests__/ledgerCardS.spec.ts`、`ledgerImportRunner.spec.ts`、`views/meters/__tests__/meterDetailDrawer.spec.ts`、`views/params/__tests__/paramCenterView.spec.ts`、`views/sales-income/__tests__/s10ImportRunner.spec.ts`、`views/__tests__/` 下的 archivedCols、billBookWindowsHints、billNoticeDrawerShape、billNoticeLayout、billNoticeTimeline、billNoticeWriteGuards、billNoticesNarrow、cpMeterFlow、crossLayerLinkGate、elecCostFlow、hintSwapBuildingsTenants、importCenterDeepLink、importElecHints、ledgerDeepLink、ledgerLeaveAndReturn、ledgerMonthReview、ledgerReviewGate、lossFixedCols、lossNoteGuards、meterLayout、meterNarrow、meterPeriodFlow、meterWriteGuards、monthTemplate、noInteractionLayoutShift、poolFixedCols、poolLedgerLayout、poolMeterTimeline、poolMonthlyConfig、poolWriteGuards、readonlyHasNoWriteButtons、reportWorkbenchFlow（同时测 FPReviewActions 与利润表）、s10DeepLink、schedDirtyApprox、schedReviewWiring、schedYearReview、twoBooksRail、unboundPanelLeave（各 `.spec.ts`） |
| reports | `analysis/anaSettings.ts`、`views/analysis/AnaShell.vue`、`views/analysis/BreakevenView.vue`、`views/analysis/FinCashflowView.vue`、`views/analysis/CockpitView.vue`、`components/fin/useFinStatementScreen.ts`、`components/fin/FinCompanyMenu.vue`、`components/fin/FinPeriodBar.vue`、`views/reports/income-statement/IncomeStatementView.vue`、`views/reports/balance-sheet/BalanceSheetView.vue`、`views/reports/trial-balance/TrialBalanceView.vue`、`views/reports/pnl/PnlScheduleView.vue`、`views/reports/recon/ReconWorkbench.vue`、`views/reports/home/ReportsHomeView.vue`、`reports/reportsHome.ts`、`api/s10.ts`；spec：`reports/reportsHome.spec.ts`、`components/ana/__tests__/anaViewGate.spec.ts`、`components/fin/__tests__/finReportFixes.spec.ts`、`finReportScreens.spec.ts`、`finStatementHints.spec.ts`、`views/analysis/AnaShell.spec.ts`、`views/reports/__tests__/reportsHints.spec.ts`、`views/reports/income-statement/__tests__/isHintS.spec.ts`、`views/reports/recon/__tests__/reconStateTag.spec.ts`、`views/reports/trial-balance/__tests__/tbCardS.spec.ts`、`views/__tests__/motionR2-expiryChargeBreakevenRoi.spec.ts`、`pnlGenerateGate.spec.ts`、`reportDeepLink.spec.ts` |

后端全部文件归后端实现（不在这张表）。`views/NoAccessView.vue`、`components/shell/` 其余文件、`components/sched/SchedHeader.vue`、`components/fp/FPReviewActions.vue`、`composables/useEditMode.ts`、`views/salary/SalaryView.vue` 不用改。

### 15.12 落点

后端：`Perm`（SCREENS、新 META、ALL 107、IMPLIED_VIEW、isWrite、isSystem、NOT_ELEVATABLE、LEGACY_LABELS、DATA_SCREEN_VIEWS、needText）·
`PermissionRegistry`（15.5 两张表、组常量、拒绝规则）· `SecurityConfig` · `ReadAccessManager` / `WriteAccessManager` · `PermissionGuard`（requireAny、统一文案）·
`UserPermissionCache` · `ReviewKind` / `ReviewService` · `ParamRegistry`（coefBook）/ `ParamService` / `ParamController`（回包按屏收窄）· `MeterService` · `AllocService` · `BookService` · `CpMeterService` · `AnalysisSettingService` ·
`S10Controller`（month-totals）· `DataHomeService` · `TenantService` · `ContractService` · `CompanyService`（删公司按报表分条记）· `ChangeLogService` / `AuditQueryMapper` · `SystemService`（changeRoles、成员、permDiff、日志对象、knownPermsOf）·
`SystemDtos`（PermMeta.screen、RoleCreateReq / RoleUpdateReq 的成员增量）· `ElevationService` · `LockService` · `V140__rbac_screen_perms.sql` · `config/LegacyPermBackfill`（启动补齐）。
前端：§15.11。版本 0.33.0，更新公告照 `RELEASE-NOTES-SPEC.md` 写在 `changelog.ts`。

### 15.13 复查后补的几处（2026-10-09 第二轮）

对抗复查（安全 / 越权 / 文案三路）报的，逐条核实后改的。①–⑦ 是行为，文案逐句改动见 §15.9 与更新公告。

1. **启动补齐不再碰只有新键的角色**（§15.8）。`salary:*` 新旧同名，原样重跑 V140 会给 0.33 里存过、勾了工资的角色每次启动补上本月出账与导入中心的查看。
2. **按 id 的写不许跨屏**：附表7 / 8 的批删、三张报表的自定义行删除，id 不属 URL 那一屏按不存在算（§15.6）。其余按 id 的写逐个核过：要么那组接口只对一屏（台账、附表10、工资、光伏报送、水电、电费、催缴单、抄表、收入核对），要么 service 里已按屏判（附表7 / 8 单条删与改备注、分桩 `CpMeterService`、账册 `BookService`、交审 `ReviewService`）；损益附表按 URL 的附表号整年写，没有按 id 的写。
3. **0.30–0.32 的删公司摘要照样看得到**（§15.6 `REF_FILTER`）。
4. **「交审」画不画与后端同一份判据**：`types/review.ts` 的 `canSubmitKey(key, hasOwn)`，审核动作簇与本月出账共用；不认提权（§15.7）。
5. **铃铛跳转先问目标屏的查看权**；电动车的待审去电动车那屏（§15.7）。
6. **字典没到时原因写屏名**：`permLabel` 按导航表拼，和字典逐字相同（§15.7）。
7. **编辑模式要几项齐的七屏**（参数、抄表、公共电核算、催缴单、光伏分栋、两屏分桩、电费模型）：**照旧**「进编辑模式要本屏列出的几项都有，缺一项当场请主管授权」（2026-08-22 用户拍板：宁可多叫一次主管，也不要编辑态里一半控件点不动）。
   复查指出 v4 的树能勾出「只勾编辑、不勾签发、也不勾可请求提权」的角色，这个账号永远进不了编辑态。本轮只做两件，不改进入规则：
   - 不能请提权的人点「编辑模式」不再弹一个注定 403 的授权窗，改说一句还缺哪几项、找系统管理员补勾；
   - 这七屏的查看说明（角色树里屏名下面那行）写明「编辑模式要「编辑」「签发」都有才进得去」，「可请求提权」的说明写明不给它时缺一项就进不去。
   **待用户定**：要不要改成「持有其中任一项就能进，缺的那几项的入口不出现」。要改的话七屏的写入口都要按自己的键判（公共电核算的池配置、计费参数的口径 / 月度两区现在只判编辑态），并推翻 08-22 那条。

