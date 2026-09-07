# 并发编辑规范（CONCURRENCY-SPEC）v1

> 状态：**P1–P4 已实现**（2026-08-25 ~ 08-27）。设计 2026-08-21 立。
>
> | 期 | 状态 | 落点 |
> |----|------|------|
> | P1 悲观锁 | ✅ 已实现，铺**月度台账 + 附表族 7 屏** | 见下方「P1 实现落点」 |
> | P3 铺满剩下的写面 | ✅ 已实现（2026-08-26） | 见下方「P3 实现落点」 |
> | 乐观锁（9 张表 `version`） | 未实现 | §5 |
> | 在场层（顶栏头像 / 入口标记） | ✅ 已实现（P2，2026-08-26） | 见下方「P2 实现落点」 |
> | 远程授权（挑一个在线主管弹请求过去） | ✅ 已实现（P4，2026-08-26） | 见下方「P4 实现落点」 |
> | 编辑态的**被动退出**（授权结束 / 关窗 / 关浏览器） | ✅ 已实现（2026-08-27） | 见下方「被动退出审计」 |
>
> ### P1 实现落点
>
> | 层 | 文件 | 说明 |
> |----|------|------|
> | 互斥语义 | `security/PresenceStore.java` | 纯内存 `ConcurrentHashMap`，**零迁移**。`putIfAbsent`/`compute` 的原子性就是那把「唯一索引」 |
> | 语义测试 | `security/PresenceStoreTest.java` | 10 条，不起容器。互斥 / 本人重入 / 非持有人不能 release / 心跳自愈 / 心跳续锁 / 接管转给请求者 / 当面通知 / 授权人留名 / 空闲判定 |
> | 账号与审计 | `service/LockService.java` | 谁有资格占锁、接管走哪条路、审计记谁 |
> | 端点 | `controller/LockController.java` + `PermissionRegistry` 里 `/api/locks/**` | 四个端点，登记为「任何已登录账号」，具体门在 LockService |
> | 端到端测试 | `api/LockApiIT.java` | 4 条：第二人被挡 / 活跃持有人须授权 / 授权接管后锁归请求者且审计记两人 / 只读账号不能占锁 |
> | 客户端机制 | `composables/useEditLock.ts` | 占·续（20s）·还·被接管。`useEditMode` 与 `SchedHeader` **共用同一份** |
> | 编辑模式挂钩 | `composables/useEditMode.ts` | `toggle()` 里权限齐之后多一步 `acquire(scope)`；不传 scope 的屏行为一个字不变 |
> | 界面 | `fp/FPTakeoverDrawer.vue` · `fp/FPEvictedDialog.vue` | 接管两条路径 / 被接管的当面提示 |
> | 三态按钮 | `sched/SchedHeader.vue` · `ledger/LedgerWideTable.vue` | 锁位就长在「编辑模式」按钮上，`min-width:150px` 定死，换文案不换宽度 |
>
> **共用校验**：`ElevationService.verifyAuthorizer()` 从 `elevate()` 里抽出，
> 提权与接管共用同一套（失败锁定 / 空跑 BCrypt 防用户名枚举 / 失败进审计）。
> 抄两份的结果不是两份一样的防护，是其中一份先烂掉而没人发现。
>
> **P1 未覆盖**（已由 P3 补齐）：抄表三屏、电费成本、三大报表、两个窗口，
> 以及 §3.2 的 `billing-chain:{ym}` 共占锁。
>
> ### P3 实现落点（铺满 + 出账链共占锁）
>
> | 层 | 文件 | 说明 |
> |----|------|------|
> | **作用域表** | `utils/lockScopes.ts` + `.spec.ts` | §3.1 的整张表**收进一处**。此前 7 个附表屏各把模板写了两遍（页头 `:scope` + 年份门 `:scope-of`），迟早不同步，而不同步的表现是「锁没生效」不是报错 |
> | 7 个自持编辑态的屏 | 抄表 / 光伏分栋 / 充电桩分桩 / 电费成本 / 公共电核算 / 催缴单 / 计费参数 | 全都已在用 `useEditMode`，各加一行 `{ scope: () => ... }` |
> | 三大报表 | `components/fin/useFinStatementScreen.ts` + 3 个 View | 「全部汇总」视图 `S.report()` 返回 null → **不上锁**（它 `save()` 第一行就 return，给它上锁只会平白挡人） |
> | 系数簿窗口 | `views/bills/CoefBookWindow.vue` | ⚠ 键取**生效月 effYm**，不是催缴单页当前账期 |
> | 侧栏圆点 | `ds/SidebarNav.vue` + `NAV_SCOPE_PREFIX` | 绝对定位，出现消失不改行高 |
>
> **§3.2 出账链共占锁**：计费参数 / 公共电核算 / 催缴单 / 系数簿四个写面共用
> `S.paramCenter === S.poolLedger === S.billNotices === S.coefBook`，由
> `lockScopes.spec.ts` 断言它们**恒等**。靠四处字面量恰好写得一样来维持，
> 是迟早会烂的约定 —— 变成两把锁时不会报错，只会安静地失效。
>
> **一处对 §3.1 的有意偏离**：附表键改成统一的冒号分段
> （`sched:utilities:{no}:{year}`，原文是 `sched:utilities{no}:{year}`）。
> 数字与名字粘着时「按模块前缀找人」做不了 —— `sched:utilities` 匹配不上
> `sched:utilities13:...`，除非放宽边界，而放宽会让 `sched:pv:2025` 误伤 `sched:pv:20251`。
> 键是内存态标识符、不落库，改成分段零迁移。
>
> **P3 顺手修掉的一个 P1 遗留**：`FPEvictedDialog` 原文案「你改的还在屏幕上，可以先核对再复制」
> 是**假的** —— 退出编辑态后表格渲染的是服务端数据，草稿不在屏幕上；而且那个
> 「复制我的改动」按钮 emit 出去**没有任何地方接**。现在：台账实现了草稿转 TSV 的真复制，
> 没有提供复制能力的屏则不显示该块（给一个数字却不给出路，等于告诉他「你丢了 14 处改动」然后关门）。
>
> ### P2 实现落点（在场层）
>
> **核心约束：不开第二条通道。** 在场与锁是同一份数据的两个视图，共用一条 20 秒的 ping。
> P1 那条 `PUT /locks/{scope}/heartbeat` 已被 `PUT /api/presence/ping` **取代**（不是并存）——
> 分成两条的话编辑态每 20 秒发两个请求，而且两边的「最后一次活动」各记各的，
> 空闲判定就会有两个不一致的答案，而它决定接管要不要叫主管。
>
> | 层 | 文件 | 说明 |
> |----|------|------|
> | 在场台账 | `security/PresenceStore.java` | 与锁同一个 store、同一个时钟。`ping()` 登记座位并在 `mode=edit` 时续锁 |
> | 端点 | `controller/PresenceController.java` · `service/PresenceService.java` | `PUT /presence/ping` · `DELETE /presence/{sid}` |
> | 客户端 | `stores/presence.ts` | 全站唯一的轮询。做成 Pinia store 而非模块单例 —— 单测靠 `createPinia()` 天然隔离，不必在生产代码里留 `__reset()` 后门 |
> | 顶栏 | `fp/FPPresenceBar.vue` → `shell/Toolbar.vue` | 头像组 + 浮层。**宽度写死 130px**，人数变化不挪版 |
> | 入口标记 | `sched/SchedYearGate.vue`（年份卡角标）· `sched/SchedMonthPills.vue`（6px 点） | 一律 `position:absolute`，尺寸不受影响 |
> | 头像配色 | `ds/Avatar.vue` | 改取**账号名** hash（原为显示名首字 `charCodeAt % 6`，中文名同姓必撞）；色板 6 → 8，去掉配白字对比度不足的 `--fill-cyan` |
>
> **两条 TTL 不同、各有理由**：锁 3 分钟（掉了代价是重占，宽容）；在场 60 秒
> （错了代价是有人按错误信息做决定 —— 白等一个已经下班的人，从紧）。
>
> **P2 两个 TDD 抓出来的真 bug**：
> 1. `presence.start()` 的「立刻发一拍」会让「你被接管了」在 `acquire()` 返回前送达，
>    于是 `exit()` 跑在 `editMode = true` 之前被它盖掉 —— 表现为「刚拿到锁就被接管、
>    人却照样进了编辑模式」。改为 `setMode` 不立刻发拍（刚占的锁有 3 分钟，下一拍绰绰有余）。
> 2. 切页签时 `enter()` 会把 scope 清成 null、mode 降回 view，**锁就停止续期** ——
>    而 EDIT-MODE-SPEC v3 明确允许编辑态跨页签存活。改为编辑态下只换文案、不动 scope/mode。
>
> **P2 未覆盖**：
> - **侧栏 / 页签的小圆点**：需要一张「scope 前缀 → 导航项」的映射表，本仓还没有。留到 P3 与铺开一起做
> - **附表10（S10View）**：它不用 `SchedYearGate` / `SchedMonthPills`（自带布局），入口标记没接上；锁本身正常
> - 台账的月份矩阵（`BookMonthMatrix`）同理未接标记

> ### P4 实现落点（远程授权）
>
> 「要做通知机制」曾是当初否掉远程授权的两条理由之一。P2 的心跳建好之后，
> 它的边际成本就只剩「响应体多两个字段」——**不开第二条通道**。
>
> | 层 | 文件 | 说明 |
> |----|------|------|
> | 存储 | `security/ApprovalStore.java` | 内存待批表，TTL 2 分钟。按「请求人+授权人+权限点」去重 |
> | 服务 | `service/ApprovalService.java` | `peek → 验密 → take` 三步。**顺序不能换** |
> | 端点 | `controller/ApprovalController.java` | `POST/GET /api/auth/approvals`、`POST .../{id}/decide` |
> | 通道 | `PUT /api/presence/ping` | 响应体带 `approvals[]`（我要批的）与 `outcome`（我请的批了没） |
> | 请求端 | `FPElevateDialog.vue` | 第二个页签「远程请求授权」+ SVG 等待环（gap 在底部、头像在环心） |
> | 批准端 | `FPApprovalDrawer.vue` + `Toolbar.vue` | 顶栏 Bell 红点 —— 那个「写了但没实际作用的死组件」终于有用了 |
>
> **P4 三个 TDD / 实测抓出来的真 bug**：
> 1. `decide()` 原本先 `take()` 再验密码 —— 授权人打错一次密码，请求就被销毁了。改成 `peek → 验密 → take`
> 2. `outcome` 原本是单槽回调，而 `FPElevateDialog` **每个可编辑屏都挂着一个实例** ——
>    最后挂载的那个赢，结果派发给了一个根本没打开的弹窗。改成 store 上的 ref，由发起方按 id 认领
> 3. **「批准了却进不去编辑模式」**：远程这条路从没更新过客户端的 `auth.grants`，
>    `auth.can()` 一直是 false，`useEditMode` 那道「权限不齐就退出」的守卫当场把人弹回浏览态。
>    修法：`emit('elevated')` 之前先 `await auth.refreshElevation()`
>
> ### 账册模板：锁的轴改成 (册, 年, 月)（2026-08-27）
>
> **两个 PR 各自都对，合起来就错了** —— 本规范的 P4 与 PR #9（模板全局化 + 按月 pin，
> V110/V111/V112）在同一天前后脚落地，git 文本上毫无冲突，语义却对不上。
>
> P4 给账册模板补锁时写的是 `book-template:{bookId}`，理由：
> 「改模板会改动这本账册**所有月份**的列结构」。PR #9 之后这句话**不再成立** ——
> 它的设计 P4 白纸黑字「改完存成新版本，只把当前月切到新版；同册其他月份、其他册一律不动」，
> 面板自己的头部文案也是这么写的。**同一个屏上两句话互相打脸。**
>
> 改法：作用域跟着 **pin 键**走 —— `book-template:{bookId}:{year}-{MM}`。
> 两个写口 `booksApi.saveTemplate(bookId, def, y, m)` 与 `booksApi.pin(bookId, ver, y, m)`
> 带的都是这三个键，那才是真正会被两个人抢的东西。锁到册是**多锁**：
> A 改 3 月模板会平白挡住 B 改 7 月。
>
> 链本身（版本号 链尾+1、只追加不改写）**不进锁**：PR #9 的 P4 明说版本就是「一套列的快照」，
> 两条并行的快照是有意允许的，不是丢失更新。
>
> **顺带堵掉一条旁路**：版本选择器 `te-verpick` 的 `@change` 会走 `booksApi.pin(...)`，
> 是真写服务端，可它长在**编辑态之外**，此前只看 `monthHasData / canSwitch`。
> 于是 A 握着本月模板锁在编辑时，B 能同时把这个月切到别的版本 ——
> 与「公共电核算待处理入口直通编辑池」同一类。现在 `heldByOther` 非空即置灰并说明原因。
>
> ⚠ 留给以后的教训：**锁的作用域注释里写的「为什么」是会过期的**，
> 而它过期时不报错、不冲突，只是悄悄多锁或少锁。改动数据模型时要回来看这张表。
>
> ### 被动退出审计（2026-08-27）
>
> EDIT-MODE-SPEC v4 铁律①「进得了编辑模式 ⇒ 本页权限一定齐」**只在 `useEditMode` 里实现过一次**，
> 而它自己的注释写着「不必让 7 个页面各自记得」。问题是**另外六个编辑器根本不走 `useEditMode`**：
> 系数簿 / 收款簿 / 附表页头 / 账册模板 / 三大报表 / 月度台账（`LedgerView` 是裸的 `ref(false)`）。
> 于是六处各自都没有这道守卫。
>
> | 被动退出的触发 | 原状 | 修法 |
> |---|---|---|
> | 点「结束授权」/ 授权 30 分钟到期 | 六处全无守卫：人留在编辑态，**锁还被 3 秒 ping 一直续着**，连 3 分钟心跳自愈都等不到 | `useEditLock(onExit, canEdit)` 第二个参数 —— 守卫放进 composable，六处一次到位 |
> | 关掉抽屉式编辑器 | 系数簿 / 收款簿的重置 watcher 第一行是 `if (!o) return`，**只在开窗时跑**；组件又是常挂载的，`onUnmounted` 永不触发 | 改成 `if (!o) { editMode.value = false; return }` |
> | 组件卸载（路由切走 / `v-if` 撤掉） | 只有 `useEditMode` 记得写 | `useEditLock` 内 `onUnmounted(release)` |
> | **关浏览器 / 关标签页** | 只还了锁，**在场座位什么都没发** → 挂满 `PRESENCE_TTL` 60 秒。而按钮与红点读的是**座位**不是锁，于是「显示 admin 在编辑中，却又进得去」 | `presence.leaveOnUnload()`：`fetch keepalive` 的 `DELETE /presence/{sid}` |
>
> **关页面二次确认**（用户拍板 2026-08-26）：挂在 `auth` store 上，判据是 `editors.size > 0` ——
> 那是全站唯一的编辑态登记表，六个编辑器都已往里登记。
>
> ⚠ 它逼出了一个**必须同时做的改动**：还锁从 `beforeunload` 挪到 `pagehide`。
> 确认框让 `beforeunload` **可能被取消**（用户点「留在此页」），而还锁若仍挂在那儿，
> 那一下已经发出去了 —— 人留在编辑态、锁却没了，别人随时能进来盖掉他正在改的东西，
> **比不加确认框更糟**。`pagehide` 只在页面真的要走时触发。这条是测试拦下来的，不是想出来的。
>
> ⚠ 判据是「在不在编辑态」而**不是「改没改过」**：全站没有统一脏标记
> （附表页头是 `dirty`、台账是 `draft`、系数簿是 `stash`，各是各的）；
> 而在编辑态里本就攥着一把锁，直接关掉不只丢草稿，还让那把锁走 3 分钟超时。
>
> 配套：[RBAC-SPEC.md](RBAC-SPEC.md)（权限决定谁能进编辑态，本规范决定进去之后互相不打架）。
> 依赖：[EDIT-MODE-SPEC.md](EDIT-MODE-SPEC.md) —— 锁挂在「编辑模式」这个已有闸门上。

---

## 0. 用户拍板记录（2026-08-21）

| # | 问题 | 拍板 |
|---|------|------|
| 1 | 锁的粒度 | 按**公司 + 年月**；园区抄表锁到**年** |
| 2 | 超时 | 按推荐：心跳 30 秒，断 **3 分钟**自动释放 |
| 3 | 强制接管 | **允许**，两条路径：持有人**空闲 ≥20 分钟**任何有该屏 edit 权的人可直接接管；持有人**活跃中**需财务主管及以上**现场输账号+密码**授权。两条都提示被接管者是谁 |
| 4 | 台账保存改成只提交 dirty 行 | **先不做** |
| 5 | 空闲阈值 | **20 分钟**（无键鼠操作） |

---

## 1. 现状（查证结果，不是推测）

| 项 | 事实 |
|----|------|
| 自动刷新 | **零轮询 / 零 WebSocket / 零焦点重拉** → 页面永不自刷新 |
| 并发保护 | **零乐观锁 / 零版本号 / 零互斥 / 零编辑锁** → 后写静默盖先写 |
| 台账保存 | `LedgerView.vue:238` `draft.value.map(...)` 全量提交屏上所有行所有列 → **整行级串写** |
| 关页面 | 全仓无 `beforeunload` → 编辑态直接关浏览器，草稿静默消失 |
| 生成类操作 | 催缴单生成 / 公摊生成 / `params/recalc` 全是先删后插，零互斥 |
| `updated_at` | **冻的，且口径不统一** —— 见 §5.1 |

### 1.1 现在就能复现的事故

```
10:00  A 打开一泽 2025-06 台账，进编辑模式
10:01  B 打开同一个月，也进编辑模式        ← 没有任何提示说 A 在里面
10:05  A 只改张三的租金，保存 → 成功
10:12  B 只改李四的水费，保存 → 也提示成功
结果   A 改的租金被还原成 10:01 的旧值，两边都显示"保存成功"，没有报错
```

台账是 21 个费用列的宽表，B 从来没碰过张三，却把张三整行写回了旧值。

**比"刷新丢草稿"更麻烦**：刷新丢草稿当场就知道；静默覆盖没人知道，等月底对账对不上，
回头查也查不出来 —— 库里只剩最后写入的那一版。

---

## 2. 三种机制，按屏的性质分派

| 性质 | 屏 | 提交方式 | 机制 |
|------|----|---------|------|
| 一个人录一期的宽表 | 台账、附表 6/7/8/10/11/12、三大报表、损益附表1-5、办公三期水电、抄表三屏、电费成本 | 整片草稿一次提交 | **悲观锁**（期级签出） |
| 逐条改的档案与参数 | 楼栋、单元、租户、合同、计费参数、公摊规则、公司、收款账户 | 单行 PUT | **乐观锁**（`version` 列） |
| 整批重算 | 公摊生成、催缴单生成、`params/recalc` | 先删后插 | **悲观锁**（与所在屏共用，见 §3.2） |

**台账为什么不用乐观锁**：粒度对不上。乐观锁只能说「这一期在你打开之后变过了」，
而他整片草稿录了半小时 —— 知道了也还是得整期重来。不如一开始就不让第二个人进编辑态。
而且台账业务上本来就是一个人负责一期，锁住不是限制，是把已有的分工写进系统。

**主数据为什么不用悲观锁**：两个人改不同的租户完全不冲突。租户有 313 户，
锁整屏 = 一人改一户全所有人不能建档。

---

## 3. 锁作用域表

### 3.1 逐屏清单（20 个写面）

**A. `SchedHeader` 统一编辑按钮族（7 屏）**

| 屏 | 作用域模板 | 依据 |
|----|-----------|------|
| 附表12 工资 | `sched:salary:{year}-{month}` | `records(y,m)` / `clearImported(y,m)` 都带月 |
| 附表10 销售收入 | `sched:s10:{phase}:{year}-{month}` | 三处 API 都带期（phase = 一/二/三期/宿舍） |
| 附表6 光伏汇总 | `sched:pv:{year}` | `records(y)` 整年一张表；phase 仅视图筛选 |
| 附表7/8 充电桩汇总 | `sched:charging{no}:{year}` | `records(no,y)`；cat 仅筛选 |
| 附表11 月度电费 | `sched:elec:{year}` | ⚠ `clearImported(y)` **跨 energy+basic 两类** → `type` 不得进键 |
| 附表13/14 水电 | `sched:utilities{no}:{year}` | 13/14 后端分表 |
| 损益附表1–5 | `pnl:{schedule}:{year}` | `pnlApi.save` = **整年 clear+insert**，园区全局，**无公司维度** |

**B. 三大报表（3 屏，共用 `useFinStatementScreen.ts`）**

`report:{is\|bs\|tb}:{companyId}:{year}-{month}` —— `save()` 整期替换。
⚠ 第 180 行 `if (... || isAll.value) return` → **「全部汇总」视图不可写，无需锁**。

**C. 月度台账（1 屏）**

`ledger:{companyId}:{year}-{month}` —— 与拍板 #1 一致。

**D. 自建 `editMode` ref（7 屏）**

| 屏 | 作用域模板 | 依据 |
|----|-----------|------|
| 园区抄表 | `meters:{year}` | 拍板 #1。佐证：`metersApi.list()` 表档案全局无期，抽屉可任意补录历史月 |
| 光伏分栋抄表 | `pv-meter:{year}` | 与园区抄表同构，`simulate(year)` 写整年 |
| 充电桩分桩明细 | `cp-meter:{vehicleType}:{year}` | ⚠ 见 §3.3 残留风险 |
| 电费成本总览 | `elec-cost:{year}-{month}` | `entries(y,m)` / `upsertEntry{acctMonth}` 逐格月粒度 |
| 公共电核算 | → `billing-chain:{year}-{month}` | 见 §3.2 |
| 催缴单 | → `billing-chain:{year}-{month}` | 见 §3.2 |
| 计费参数 | → `billing-chain:{year}-{month}` | 见 §3.2 |

**E. 窗口级 `editMode`（2 个）**

| 窗口 | 作用域 |
|------|--------|
| `CoefBookWindow` 系数簿 | `billing-chain:{effYear}-{effMonth}` ⚠ **生效月由窗口内独立选择，可与催缴单页当前 ym 不同** —— 键必须取 `effYm`，不是页面 ym |
| `PayBookWindow` 收款簿 | ⚠ **paymap 无月份维度**（文件头第 29 行注释），无期可锁 → 走乐观锁，不走编辑锁 |

### 3.2 ⭐ 出账链三屏必须共占同一把月锁

`ParamService.recalc()` 内部就是 `alloc.generate(ym)` + `billNotice.generate(ym)`。
也就是说这三个动作打的是**同一批快照表**（`alloc_pool_result` → `alloc_loss_result` → `bill_notice`，
均为先删后插）：

- 计费参数页「重算本月」 → `POST /params/recalc`
- 公共电核算页「生成本月」 → `POST /alloc/generate`
- 催缴单页「生成本月」 → `POST /bill-notices/generate`

**三屏各锁各的等于没锁**：A 在参数页重算 2024-02，B 同时在催缴单页点生成，两把不同的锁全放行。

→ 合并为一把 **`billing-chain:{year}-{month}`**，四个写面（三屏 + 系数簿窗口）共占。

### 3.3 残留风险：充电桩桩库是 car/ebike 共享表

`cp_station` 是汽车与电动车两屏**共享**的一张表，前端按 `vehicleType` 过滤。
按 `cp-meter:{vehicleType}:{year}` 分锁，两个人分别锁 car 和 ebike 时，
改的仍是同一张 `stations` 表 → 桩库档案层面仍可能串写。

**处置**：桩库档案的写（`/api/cp-meter/stations/**`）按 RBAC-SPEC 归 `meter-master:edit`（主管），
日常抄表员碰不到，冲突概率低。**接受此残留风险**，在 SPEC 里显式记下，不为它单开一把锁。

### 3.4 不适合上锁的屏

| 屏 | 理由 |
|----|------|
| `TenantsView` + 抽屉 | 逐户 CRUD（313 户）。锁整屏 = 一人改一户全所有人不能建档 |
| `ContractsView` + 抽屉 | 同上，`create`/`update`/`renew`/`terminate`/`remove` 全是逐合同 |
| `BuildingsView` + 抽屉 | 逐栋、逐单元写。锁整屏 = 楼栋/单元维护全站串行 |
| `CompanyBookWindow` 收款公司簿 | 逐公司逐账户 |

这四类走**乐观锁**。

---

### 3.5 审核态与锁正交（2026-09-03 拍板，SIDEBAR-UX-REDESIGN §7）

审核态**不占锁、不发在场点**，两套机制互不知道对方存在：

- 锁答的是「现在有没有别人正在改」——会话级、会自愈、可接管。
- 审核态答的是「这个月这张表还准不准改」——落库、跨会话、只有审核员能撤。

已审核的屏没人能进编辑模式，在场点自然消失，不需要额外清理。
反过来，锁被接管不影响审核态；审核通过也不会踢掉正握着锁的人（他下一次写会撞 423）。

⚠ 一个已知的粗糙处：审核通过的那一刻若有人正握着该屏的锁并停在编辑态，屏上不会立刻变化，
要等他下一次写才 423。R2 可以在 ping 的响应里带审核态来即时收编辑态；R1 不做。

## 4. 锁的生命周期

### 4.1 挂在编辑模式上（零新交互）

`EDIT-MODE-SPEC` v2 已规定：编辑模式是全站唯一写入口（19 屏照做），
且「编辑态不跨会话，离开页面即回浏览态（`onDeactivated` 复位）」。
锁的**获取时机**与**释放时机**在代码里各有一个现成落点。

```
点「编辑模式」   → POST /locks/{scope}
                   ├ 200 → 进编辑态
                   └ 409 → 「张三正在编辑本期（2 分钟前活动）」
                           只能查看 · 接管入口按 §4.3 两条路径分流

编辑态中        → PUT /locks/{scope}/heartbeat   每 30 秒
                   （带 lastActivityAt，服务端据此算空闲，见 §4.3）

点「完成」/离屏  → DELETE /locks/{scope}
                   （onDeactivated 已有落点；再补 beforeunload 的 sendBeacon）

服务端兜底      → 心跳断 3 分钟自动释放
```

### 4.2 锁必须能自愈

心跳 + 超时自动释放 + 可接管 + 管理员强制解锁，**四件缺一不可**。

> **任何需要人来解的锁，最后都会变成日常工单。** 用友那套「找管理员解锁单据」之所以被骂，
> 就是缺了自动释放这一环。

心跳只要页面开着就一直发，所以 3 分钟超时只在**真的关了页面 / 断网**时触发 ——
中途接电话、去开会都不会掉锁。

### 4.3 接管：两条路径（拍板 #3 / #5）

> ⚠ **初版设计有缺陷，此处为修订版。** 初版写「无 `lock:takeover` 权限者按钮不渲染」，
> 结果是财务B 看不到接管入口，只能让主管去接 —— 而**锁会归主管，B 还是进不去**，
> 除非主管接管后立刻退出、B 抢在别人前点进去。荒唐的竞态。
> 真正需要的是：**锁转给请求者，主管只授权这件事发生**。

#### 两个独立的计时器，别混

| 计时器 | 触发条件 | 后果 |
|--------|---------|------|
| **心跳超时 3 分钟** | 页面关了 / 断网 → 心跳停 | 锁**自动释放**，谁都能直接进，无需接管 |
| **空闲 20 分钟** | 页面开着，但 20 分钟无键鼠操作 | 锁还在，但**标记为 idle**，走「直接接管」 |

心跳只要页面开着就发。所以「持有人开着页面去开会」这种情况心跳超时永远不触发 ——
空闲判定就是为消掉这一格而存在的，否则那格只能靠惊动主管解决，是纯浪费。

#### 路径一：直接接管（持有人空闲 ≥20 分钟）

```
界面显示：张三 · 已 23 分钟无操作
按钮：[ 接管编辑 ]        ← 任何持有该屏 <模块>:edit 的人都能点
点击 → 二次确认 → 锁易主 → 写 audit_log
```

不需要主管，不需要密码。**绝大多数实际场景走这条。**

#### 路径二：授权接管（持有人活跃中）

市面上叫「主管授权 / manager override」—— 零售 POS 的收银员改价退款、
Epic 的 break-the-glass、SAP 的 approval override 都是这个模式。三条要点：
**授权者不登录 · 操作归属仍是请求者 · 审计记两个人**。

```
财务B 点「申请接管」
  └ 弹窗：张三正在编辑「一泽 2025-06 台账」，已持有 12 分钟，2 分钟前仍在操作
          此操作需要财务主管及以上授权
          ┌ 授权人账号  [____________]     ← 必须连账号一起输
          └ 密码        [____________]

后端校验
  ├ 该账号存在且 status=1
  ├ 该账号持有 lock:takeover（财务主管 / 系统管理员）
  └ 密码正确（BCrypt，与登录同一套）

通过 → 锁转给【财务B】，不是转给授权人
     → audit_log 记 { 动作:takeover, 接管人:财务B, 授权人:张三, 作用域, 时间 }
失败 → 计入 LoginRateLimiter（现成的，键是 IP+用户名）
```

**必须连账号一起输，不能只输密码。** 只输密码后端无从知道是哪个主管授权的，审计就废了。

#### 两条路径共同：被接管者当面收到提示

```
原持有人的下一次心跳（≤30 秒）返回 409 + 接管者信息
  → 页面立刻弹「你对本期的编辑权已被 李四 接管」（授权接管时附「由 张三 授权」）
  → 提供「复制我的草稿到剪贴板」
  → 退回浏览态
```

**必须是当面提示，不是等他保存时才 403。** 心跳是现成的通道，不需要 WebSocket。

#### 空闲判定怎么算

前端在编辑态监听 `keydown` / `mousedown` / `input` / `change`，
任一事件刷新本地 `lastActivityAt`；心跳把这个时间戳一起报上去，服务端存并计算空闲时长。

不把判定放在服务端「最后一次写请求」上 —— 用户可能在表格里录了 10 分钟还没点保存，
那不是空闲。

#### 已知风险与处置

让主管在别人的机器上输密码，有肩窥与键盘记录的风险。

对本项目规模（几十个账号、一个园区、同一间办公室）**接受此风险**，
且这是行业通行做法。两条低成本缓解已含在上面：失败计入现有限流、
`audit_log` 记清楚授权发生在谁的会话里。

> 替代方案（**不采用**）：主管在自己设备上远程批准。更安全但要做通知机制，
> 且主管不在电脑前时请求者就卡住。仅当团队不在同一办公室时才值得。

### 4.4 落库与端点

```
edit_lock(
  scope             VARCHAR PK,   -- 如 ledger:3:2025-06
  user_id, display_name,
  acquired_at,                    -- 何时占的
  heartbeat_at,                   -- 最后一次心跳 → 算 3 分钟自动释放
  last_activity_at                -- 最后一次键鼠操作 → 算 20 分钟空闲
)
```

`heartbeat_at` 与 `last_activity_at` **是两个字段，不能合并** —— 合了就分不出
「页面关了」和「页面开着但人走了」，而这两种的接管门槛不一样。

| 端点 | 用途 |
|------|------|
| `POST   /locks/{scope}` | 占锁。已被占返 409 + 持有人 / 已持有时长 / 空闲时长 |
| `PUT    /locks/{scope}/heartbeat` | 心跳，带 `lastActivityAt`。被接管后返 409 + 接管者 |
| `DELETE /locks/{scope}` | 释放（「完成」/ `onDeactivated` / `beforeunload` 的 `sendBeacon`） |
| `POST   /locks/{scope}/takeover` | 接管。空闲态免授权；活跃态须带授权人账号+密码 |

接管事件写 `auth_audit_log`（见 RBAC-SPEC §6），字段含**接管人**与**授权人**两个。

---

## 5. 乐观锁

### 5.1 为什么不能用 `updated_at`（比"全冻"更糟）

MyBatis-Plus 3.5.7 的 `strictFillStrategy` 字节码：`ifnonnull` 直接跳到 return ——
**只在字段为 null 时才填**。而 `MyBatisPlusConfig.java:12-14` 的 `updateFill` 只调 `strictUpdateFill`，
代码里普遍是 `selectById` → `updateById`，实体上 `updatedAt` 已带旧值，
于是被原样 `SET` 回去，**压过 DDL 的 `ON UPDATE CURRENT_TIMESTAMP`**。

冻结的路径（`select 行 → update 行`）：

```
BuildingService  273→283 (building)   336→341 (unit)
CompanyService    76→ 83 (management_company)   120→124 (company_account)
ContractService  179→203 (update)  222→227 (terminate)  235→242 (renew)
AllocService     550→554 (alloc_rule)
```

⚠ **但有三处例外，`updated_at` 其实是动的**：

- `TenantService.java:78` —— 走 `UpdateWrapper`，SET 子句里根本没有 `updated_at` → `ON UPDATE` 正常触发
- `CompanyService.java:144` `clearOtherDefaults()` —— 同款 `UpdateWrapper`
- `ParamService.java:432-442` —— `new TenantPriceCfg()` 只 `setId(id)`，`updatedAt` 为 null → 填充生效

所以真实理由比"全冻"更强：**同一张表不同入口的 `updated_at` 语义不一致**，
拿它当版本号会出现**假阴性冲突**（该报冲突的没报）。

> `V96__param_mode_and_log.sql:13` 的注释已经记过这件事：「updated_at 不能当证据(strictUpdateFill 冻结)」。

### 5.2 加 `version` 列的表（9 张）

| 域 | 实体 | 表 |
|----|------|-----|
| 楼栋 | `entity/Building.java` | `building` |
| 单元 | `entity/Unit.java` | `unit` |
| 租户 | `entity/Tenant.java` | `tenant` |
| 合同 | `entity/Contract.java` | `contract` |
| 计费参数·价目 | `entity/TenantPriceCfg.java` | `tenant_price_cfg` |
| 计费参数·分摊 | `entity/AllocCfg.java` | `alloc_cfg` |
| 公摊规则 | `entity/AllocRule.java` | `alloc_rule` |
| 管理公司 | `entity/ManagementCompany.java` | `management_company` |
| 收款账户 | `entity/CompanyAccount.java` | `company_account` |

- `version` 这个列名在全部 100 个迁移里**零占用**，可直接用
- 「计费参数」是**两张表**（S21 参数中心的 price / alloc 两簿，见 V96 的 `tbl ENUM('price','alloc')`）
- `CompanyAccount` 实体不映射 `created/updated`（注释写明由 DB 维护），加 `version` 得显式新增字段

### 5.3 拦截器注册是纯增量

`MybatisPlusInterceptor` bean **不存在**（全仓含 `src/test` 零匹配）。
`config/` 下只有三个 `@Bean`：`CorsConfigurationSource` / `MetaObjectHandler` / `OpenAPI`。

**后端根本没有服务端分页**：零 `IPage` / `new Page` / `selectPage`，无 XML mapper，
mapper 里零 `LIMIT`。所以注册 `OptimisticLockerInnerInterceptor` 不会跟任何既有行为打架。

### 5.4 风险点

加 `@Version` 之后，**实体没带 version 就 update** 的路径会静默失败（MP 的乐观锁在
version 为 null 时退化成普通 update，不报错）。P2 实施时要逐条过 §5.1 那张路径表。

### 5.5 冲突时的界面

别只弹「保存失败」。要显示**谁 / 什么时候 / 改了哪几个字段**，然后给三个选择：

```
用我的覆盖    放弃我的、看他的    取消，回去手动合并
```

「谁改的」信息现成 —— `ParamService.actor()` 已经在从 `SecurityContextHolder` 取用户名。

---

## 6. 一条铁律

> ## 永远不要刷新用户正在编辑的表格。

所有成熟产品在这一点上没有例外。做并发的时候顺手加个自动刷新，
正好是把一个隐性问题换成一个显性灾难。

**提示，而不是替换。** 编辑态下若检测到服务端有更新，顶部出一条信息条：

```
本期数据在你编辑期间被更新过   ·   查看差异   ·   放弃我的改动并重载
```

由用户点，**绝不自动执行**。只有在**浏览态**（非编辑模式）才允许后台静默更新。

有了悲观锁之后这条基本不会出现（你在编辑时别人进不去编辑态），它是兜底不是主路径。

---

## 7. 分期

| 期 | 内容 |
|----|------|
| **P0** | `beforeunload` 守卫（一行）+ 出账链三动作互斥（先用一把 `billing-chain:{ym}` 的进程内互斥挡住最脏的错乱） |
| **P1** | 完整悲观锁：`edit_lock` 表 + 三个端点 + 心跳 + 挂编辑模式（一次覆盖 20 个写面）+ **两条接管路径**（空闲判定 + 主管授权）+ audit_log |
| **P2** | 乐观锁：9 张表加 `version` + 注册拦截器 + 冲突界面 + 过一遍 §5.4 风险路径 |
| **不做** | 实时协同（OT / CRDT）。要重写数据层，且财务场景不需要「一起涂」——真要多人同录一个月，正确答案是按公司分工 |

---

## 8. 待拍板

| # | 问题 | 现状 |
|---|------|------|
| 1 | 台账保存改成只提交 dirty 行 | 拍板 #4 已定**先不做**。记在这里是因为它能把冲突面积缩到最小（两人改不同租户就真的不冲突），做锁不依赖它，将来可单独做 |
| 2 | `cp_station` 共享表的残留串写 | §3.3 已按「接受风险」处理。若实际发生，再单开一把 `cp-station` 全局锁 |
| 3 | `PayBookWindow` 的 paymap 无期可锁 | 已定走乐观锁。但 `bill_pay_company` 表当前无 `version` 列，§5.2 的 9 张表里没有它 —— 若要乐观锁需补第 10 张 |
