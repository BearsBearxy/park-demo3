# 公摊池入口修复方案

> 2026-08-29。对应调研 [`2026-08-29-pool-entry-coverage-audit.md`](2026-08-29-pool-entry-coverage-audit.md)。
> 目标：**让库里现存的 98 个池全部能从界面原样维护**，不再需要改代码或直接改库。

## 四条修复，按「改动量 ÷ 影响面」排序

| # | 根因 | 影响 | 改动量 |
|---|---|---|---|
| **F1** | `@Pattern` 值域漏 `carrier`/`manual` | 5 个池存不回去 | 1 行 |
| **F2** | `fee_key` 载入竞态 | 40 个池可能被静默改写 | 3 行 |
| **F3** | `direct` 必须恰一户，无例外 | 10 个池存不回去 | ~8 行 + 1 条测试 |
| **F4** | 按定位重算池名 + 方位没进 `side` 列 | 8 个池被改名，7 个撞名 | 1 迁移 + 1 校验 |

---

## F1 · 值域补两个 method（1 行）

`backend/src/main/java/com/park/demo3/dto/AllocRuleReq.java:12`

```java
@Pattern(regexp = "direct|area|floor|loss|none|ref") String method
```
→
```java
// 值域 = 引擎真实支持的全集。carrier(V73 冲减载体)与 manual(V81 §H4.2e 人工指定行)
// 库里正式在用却漏在值域外，导致这类池「打开抽屉什么都没改、点保存被 400」。
// ⚠ 只放开**回传**：抽屉仍不把 carrier/manual 放进新建池的单选组
// （PoolLedgerView 的 methodRadios 只列 area/floor/direct/none，非该值时才把当前值补进去），
// 所以这条不会让用户新建出这两类池，只让存量池存得回去。
@Pattern(regexp = "direct|area|floor|loss|none|ref|carrier|manual") String method
```

**为什么不同时开放新建**：`ref`/`carrier` 是复刻旧 Excel 账册的产物（广告字档 / 冲减载体），
`manual` 是无电表的人工指定行。三者都不该由用户从零建，调研 §4 已定「明确不做」。
这条只解决「存量池维护不了」。

**验收**：池 17（carrier）、92/93/94/95（manual）打开抽屉直接保存 → 200，且库里字段一字未变。

---

## F2 · 载入竞态守卫（3 行）

守卫**已经存在**，只是条件写窄了。`frontend/src/views/alloc/PoolLedgerView.vue`：

```js
// :175  现状
const rulesFailed = ref(false)          // 只在 loadRules().catch 里置 true
// :1280 现状
:disabled="saving || rulesFailed"
// :222  现状（文案已经写对了）
<div v-if="rulesFailed">池参数(出口费项)未加载成功 —— 此时保存会把它冲成默认值,请先重试</div>
```

问题在 `:203` 的 `loadRules().catch(()=>{})` 是 fire-and-forget，
**「还在飞」的窗口里 `rulesFailed` 是 false**，而 `:582` 的
`feeKey: rule?.feeKey ?? 'share_elec_floor'` 已经拿不到值了。

改：加一个 in-flight 标记，与 `rulesFailed` 一起进禁用条件与提示。

```js
const rulesLoading = ref(true)
// loadRules() 的 finally 里 rulesLoading.value = false
const rulesNotReady = computed(() => rulesLoading.value || rulesFailed.value)
```

`:1280` → `:disabled="saving || rulesNotReady"`；`:222` 的提示按两种原因分别措辞
（「正在载入…」vs「载入失败，请重试」）。

**为什么不改成「拿不到就不发 feeKey」**：`AllocRuleReq.feeKey` 是 `@NotBlank`，
不发直接 400；而发 `undefined` 会被 Jackson 当缺失，同样 400。禁用保存是唯一不会静默改数的解法。

**验收**：在 `/alloc/rules` 返回前打开任一池抽屉 → 保存按钮禁用且有提示；返回后自动可用。

---

## F3 · `direct` 恰一户，开两个例外（~8 行）

`backend/src/main/java/com/park/demo3/service/AllocService.java:621-622`

```java
if ("direct".equals(req.method()) && (req.members() == null || req.members().size() != 1))
    throw new BizException(ResultCode.BAD_REQUEST, "整笔归户规则受益人必须恰好一户");
```

两个例外，理由不同，**要分开写**：

```java
if ("direct".equals(req.method())) {
    int n = req.members() == null ? 0 : req.members().size();
    // 例外一:整笔挂亏池(park_loss_pool)的净量喂「园区损耗公摊池」的 G,按语义就不该有受益人。
    // 库里 5 个(23/96/97/98/99)全是 0 户,种子直接写入绕过了本校验。
    boolean parkLoss = "park_loss_pool".equals(req.feeKey());
    // 例外二:**已存在**的池允许 0 户 —— 那是它当前的状态,不该因为「想改个备注」就被逼着先指定受益户。
    // 新建仍然硬拦:不给用户从零造一个算得出钱却摊不到人的池。
    // 0 户的后果引擎已有告警(memberAmounts 的「无受益人,跳过」),不会静默吞钱。
    boolean editingExisting = existingId != null && n == 0;
    if (n > 1 || (n != 1 && !parkLoss && !editingExisting))
        throw new BizException(ResultCode.BAD_REQUEST, "整笔归户规则受益人必须恰好一户");
}
```

> `n > 1` 单独前置：无论哪个例外，**多于一户永远非法**（整笔归户只能归一户）。

**为什么例外二不是「一律放开」**：新建时 0 户是配置错误——用户刚建的池算得出钱却摊不到人，
当场拦住比事后靠告警强。编辑时 0 户是**既成事实**，硬拦只会把人挡在门外。

**前端配套**：`:1226` 那行红字 `整笔归户规则受益人必须恰好一户` 的显示条件要跟着改，
否则按钮能点了、红字还在。改成只在「新建 且 非 park_loss_pool 且 户数≠1」时显示。

**验收**：池 23/96/97/98/99（park_loss_pool，0 户）直接保存 → 200；
池 30/31/56/85/86（share_elec_floor，0 户）编辑保存 → 200；
新建一个 direct 池不选受益人 → 仍被拦。

---

## F4 · 方位回填 + 撞名校验（1 迁移 + 1 校验）

两件事，缺一不可。

### F4a · 把方位从 `name` 抽进 `side` 列（迁移 V115）

8 个池的方位只写在 `name` 字符串里，`side` 列是 NULL。抽屉读 `side` 读到空、
原样回传空，保存时按定位重算名字就把方位丢了。

```sql
-- V115__pool_side_backfill.sql
-- 一期历史池把「东侧/西侧」写在 name 里,没进 side 列(全库仅 51/52 两池真用了 side)。
-- 抽屉的侧向框读 side 列,读到空就原样回传空 → 保存时按定位重算池名,方位蒸发,
-- 且 C/D/E 座东西侧货梯各自撞成同名、F座 88 与既有 89 逐字同名。
-- 回填只认 name 里紧跟 floor_label 之后的方位词,不做模糊匹配。
UPDATE alloc_rule SET side = '东侧'
WHERE side IS NULL AND floor_label IS NOT NULL
  AND name LIKE CONCAT('%', floor_label, '东侧%');
UPDATE alloc_rule SET side = '西侧'
WHERE side IS NULL AND floor_label IS NOT NULL
  AND name LIKE CONCAT('%', floor_label, '西侧%');
```

**回填后自检**（迁移里跑不了断言，作为验收步骤）：

```sql
-- 期望:8 行(59/60/69/70/78/79/88 + 25 不在此列,25 是另一类问题)
SELECT id, name, floor_label, side FROM alloc_rule WHERE side IS NOT NULL;
-- 期望:0 行 —— 回填后按定位重算的名字应与现名一致
SELECT id, name FROM alloc_rule WHERE ...  -- 用 ZoneService/poolName 同规则复算比对
```

> **池 25「一期园区·路灯」不在这条修复里**：它的问题方向相反——`building_id` 为 NULL
> 却填了 `floor_label='一楼'`，保存会**多出**一截楼层。这是定位数据本身填错了，
> 应由用户在界面上把楼层清空，不该由迁移猜。F4b 的撞名校验不拦它（它不撞名），
> 但重设计后的「名字预览」会让它一眼可见（见设计稿 §2）。

### F4b · 保存时拦撞名（后端）

`alloc_rule.name` 无唯一键。88 保存一次就和 89 逐字同名，不报错。

在 `AllocService.apply()` 算出 auto 名之后、写库之前加：

```java
// 池名是屏上/账册/告警里认池的唯一可读标识,重名后人分不出谁是谁(88 保存一次就与既有的 89 同名)。
// 不加 DB 唯一键:存量已有同名行(89 显然被这条路径改过一次),加约束会让迁移失败。
Long dup = rules.selectCount(new QueryWrapper<AllocRule>()
    .eq("name", finalName).ne(existingId != null, "id", existingId));
if (dup != null && dup > 0)
    throw new BizException(ResultCode.BAD_REQUEST,
        "池名「" + finalName + "」已被占用 —— 请补上侧向或改费项名，让两个池分得开");
```

**验收**：把 88 的 `side` 清空再保存 → 被拦并提示；填回「东侧」→ 200 且名字不变。

---

## 改动清单

| 文件 | 改什么 |
|---|---|
| `dto/AllocRuleReq.java:12` | @Pattern 加 `carrier\|manual` |
| `service/AllocService.java:621-622` | direct 校验加两个例外 + `n > 1` 前置 |
| `service/AllocService.java` apply() | 写库前查重名 |
| 新 `db/migration/V115__pool_side_backfill.sql` | 方位回填 |
| `views/alloc/PoolLedgerView.vue` `:175/:203/:222/:1280` | `rulesLoading` 守卫 |
| `views/alloc/PoolLedgerView.vue` `:1226` | 红字显示条件跟着 F3 改 |

## 测试

**后端**（`AllocApiIT`）
- carrier / manual 池原样 PUT → 200 且字段未变
- park_loss_pool + 0 户 → 200；新建 direct + 0 户 → 仍 400
- 已存在的 direct 池 0 户编辑 → 200
- direct + 2 户 → 400（无论哪个例外都不放行）
- 撞名：两个池重算成同名 → 400 且文案含被占用的名字

**迁移**（`SeedIT` 或专门 IT）
- V115 跑完后 `side IS NOT NULL` 的行数与预期一致
- 回填后逐池用 `poolName` 复算，与现名全等

**前端**
- `zonesApi`/`allocApi.rules` 未返回时保存按钮禁用且有「正在载入」提示
- 返回后按钮自动可用

**回归（最重要）**
- 三个有数据的月份重新生成后，`alloc_result` / `alloc_pool_result` / `alloc_loss_result`
  与修改前**逐行逐分相同**。修复只放开保存路径，不碰计算内核——任何金额变动都说明改错了。
  比对脚本沿用上一轮的 `_pre_*` 备份表口径。
