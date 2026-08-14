# WRITE-KEEP-CONTEXT-SPEC — 写操作不得丢用户的位置

> 定稿 2026-08-14。需求来源：用户报障「点击电表停用账期、退场账期，点完直接刷新页面，
> 然后用户需要从头开始滚动页面找到对应电表或者租户，这个情况在很多个页面都有出现」。
> 调研：workflow `survey-reload-scroll-loss`（8 组并行扫全站 view + 逐条复核），31 条初筛 → 15 条确认。

## 0. 一句话

**用户在长表里改一格，改完必须还站在那一格旁边。**
写操作之后重拉数据是对的；把用户的滚动位置、展开状态、打开的行一起冲掉，是不对的。

---

## 1. 缺陷形状

```
用户在第 800 行改一格
  → 写接口成功
  → .then(() => reloadAll())            // 整屏重拉，替换数据 ref
  → 新数组引用
  → watch(() => props.rows) 触发
  → wrapEl.scrollTop = 0                // ← 命案现场
  → 用户回到第 0 行，在 1100 行里重新找刚才那块表
```

关键：**行集内容一模一样也会回顶**。`watch` 按 `Object.is` 判断数组引用，
`buildRows`/`filterRows` 每次都产新数组，所以「重载」与「换了另一张表」在它眼里没有区别。

## 2. 铁律（三条）

### 铁律一：回顶只能由「换了另一张表」触发，不能由「同一张表重载」触发

判据是**视图身份**，不是数组引用。视图身份 = 那些一变就该重新开始看的筛选维度拼串，例如
抄表屏的 `ym|kind|zone|building|own|status|q|suspectOnly`。

```ts
// ✅ 对
watch(() => props.viewKey, () => { wrapEl.value.scrollTop = 0 })
watch(() => props.rows,    () => { syncWindow(true) })      // 只重建窗口，不动 scrollTop

// ❌ 错
watch(() => props.rows, () => { wrapEl.value.scrollTop = 0; syncWindow(true) })
```

没有虚拟滚动的表同理：重拉后不要重置 `scrollTop`，浏览器本来就会保留。

### 铁律二：行内提交优先「局部改一条」，不要「整屏重拉」

一个格子的写操作，回包里已经有新值，就地 patch 那一条即可：

```ts
// ✅ 对：只动这一条
await allocApi.saveCfg(req)
patchCfgRow(cfgs.value, req)        // 就地 upsert/删除
cfgDirty.value = true

// ❌ 错：为了一个格子重拉整月三个接口
await allocApi.saveCfg(req)
loadMonth()                          // pools + cfg + member-diff 全量
```

只有当写操作会**改变行集构成**（新增/删除行、改了参与筛选的字段）时才整屏重拉——
且此时仍受铁律一约束（内容真变了，viewKey 没变，就保位重排而不是回顶）。

### 铁律三：提示条不许挤动表格

`cfgDirty` 之类的提示条一出现，flex 容器立刻矮几十像素，表内容整体上移、底部行被切掉，
用户刚改的那行可能滑出视口——**这也是一种"丢位置"**。

提示条要么常驻占位（始终渲染，用 `visibility`/`opacity` 切换），要么绝对定位浮在表上方，
不参与 flex 高度计算。

## 3. 例外（这些情况本就该重置，不算违规）

- 新增一条记录后回到第一页/滚到新行 —— 语义上正确
- 删除当前行后跳到相邻行
- 提交后视图本就要关闭（弹窗里的保存）
- 换账期 / 换分区 / 改筛选 —— 正是铁律一里的 viewKey 变化

## 4. 自查清单（改任何写路径前过一遍）

1. 这个 `.then()` 后面跟的是整屏 load 吗？能不能改成 patch 一条？
2. 表格组件里有没有 `scrollTop = 0`？它 watch 的是数组引用还是视图身份？
3. 写完之后会不会多出/少掉一条提示条？它挤不挤表格？
4. 抽屉/弹窗还开着吗？关掉之后用户落在哪一行？

## 5. 已确认的落点（调研产出，15 条）

根因高度集中：**抄表屏 6 条全部指向同一行代码**
`frontend/src/views/meters/MeterLedgerGrid.vue:132-135` 的
`watch(() => props.rows, () => { wrapEl.value.scrollTop = 0; syncWindow(true) })`。
它把「行集换了」和「同一行集重载」混为一谈，于是抽屉里 7 个 `emit('reload')`、
草稿批量保存、KeepAlive 回页全部回顶。改这一处即同时修好六条。

| 屏 | 触发 | 丢什么 |
|---|---|---|
| 抄表 MeterLedgerGrid | 根因：任何让 gridRows 重算的写 | 滚动位 + 虚拟滚动窗口（~200–400 行/视图，全库 1134 块表） |
| 抄表 MeterView.onSaveChanges | 草稿批量保存 | 同上；**失败分支更致命**：alert 点名了失败行，表却已回顶，找不到那几行去重试 |
| 抄表 MeterDetailDrawer ×5 | 挂租户 / 补历史读数 / 绑合同 / 解除存疑 / 改停用账期 | 抽屉不关，但背后表回顶；这些都是「筛一批逐个处理」的批量动线，每处理一个顶一次 |
| 公共电核算 PoolLedgerView.commitRuleCfg | 改「系数(月)」「加度(月)」 | 提示条插入挤动表格（铁律三）+ 每格三次全月请求 |
| 楼栋损耗 LossLedgerView.commitCalib | 改本月口径三格 | 面板控件回显被重算吞掉（已于 b7e25ac 单独修 resolveCfg 部分） |

> 「改停用账期」那条最没道理：停用行按 `buildRows` 口径**仍然产行、仍在原位**，
> 行集长度与顺序分毫未变，却整表重拉并回顶——没有任何"行没了所以要重排"的正当理由。

## 6. 不做

不引入滚动位置的全局持久化（跨路由/跨会话记忆）。本规范只管**一次写操作前后**的连续性。
