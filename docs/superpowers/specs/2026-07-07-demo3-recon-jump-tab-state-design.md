# 收入核对跳转深链 + Tab 状态保持 规范(2026-07-07)

## 背景与痛点(用户原话归纳)

1. 收入核对页发现差异后,「去改台账/去改附表10」只是裸 `router.push('/ledger'|'/sales-income')`([ReconWorkbench.vue:111](../../frontend/src/views/reports/recon/ReconWorkbench.vue)),不带任何上下文,用户要手动重选公司/年/月再逐个找租户。
2. Tab 之间切换时页面整个重建(App.vue `<router-view :key="route.fullPath">`),年份月份等浏览状态全丢,要重新选。

## 现有架构(改动落点)

- 路由 path = '/'+value,tab 模型 = 钉住 tabs[] + 单 preview 槽([stores/tabs.ts](../../frontend/src/stores/tabs.ts));SidebarPanel 点击 = `router.push('/'+value)`;TabStrip 点击 = `tabs.open(value)+router.push`;App.vue 单一 `<router-view :key="route.fullPath">`(注释:兄弟路由共用组件需强制重建)。
- LedgerView 四级钻取状态(companyId/year/month)、S10View 三级(year/month/phase)都是组件内 ref,卸载即丢。

## 一、收入核对跳转深链

**语义**:点「去改台账/去改附表10」→ 目标页**固定为钉住 tab**(不占 preview 槽)+ **全新实例** + **自动钻取定位到该租户行并高亮**。

- 跳转上下文(ReconWorkbench 弹窗内已有):`props.year/month` + `selected`(tenantName、ledgerCards[].companyName、s10Cards[].phase)。
- 台账:`tabs.openFresh('ledger', {pin:true})` + `router.push({path:'/ledger', query:{y,m,company,tenant}})`(company=ledgerCards[0].companyName;多公司记户取第一张卡,弹窗里本就按卡展示)。
- 附表10:同法 query `{y,m,phase,tenant}`(phase=s10Cards[0].phase)。
- **目标页消费**(LedgerView/S10View):挂载时读 query → 依次自动钻取(台账:按名解析公司→年→月→加载宽表;附表10:年/月/期→加载月表)→ 滚动到该租户行 + 高亮闪烁(CSS 动画 ~2s 渐隐,行定位用 `scrollIntoView({block:'center'})`)。租户名/公司名解析不到时:正常进到能到的层级,`alert` 或静默停在该层(取静默,已到正确年月已解决 90% 痛点)。
- 传递用 route query(不是 store):刷新/分享仍可定位;App/KeepAlive 的 key 不含 query(见下),新实例由 openFresh 的 epoch 保证,故消费逻辑放 `onMounted`。

## 二、Tab 状态保持(KeepAlive per tab)+ 侧边栏新开语义

**语义矩阵**:

| 入口 | 行为 |
|---|---|
| TabStrip 点击已开 tab | **恢复该 tab 之前的浏览状态**(缓存实例,不重建) |
| SidebarPanel 点击页面 | **全新状态**(即使该页有缓存也重置) |
| 收入核对跳转 | 全新状态 + 深链定位(=openFresh) |
| 关闭 tab 后再打开 | 全新状态 |
| 命令面板 jump/new | 维持现状语义(jump=恢复,new=钉住;不 bump) |
| 数据首页/报表首页「去做事」行点击 | 全新状态(openFresh;复审补裁:显式任务导航=全新) |
| IconRail 层切换 | 全新状态(openFresh,同侧边栏级语义) |

> **2026-09-06（P3，SIDEBAR-UX-REDESIGN §4.1）修订**：上表 `SidebarPanel 点击页面` 那一行的
> 「全新状态」收窄 —— 侧边栏点击改为**恢复该 tab 之前的浏览状态**（与 TabStrip 点击同义）；
> 手机抽屉的目录条目同改。`数据首页/报表首页「去做事」行点击` 仍是全新（显式任务导航，不变）。
> 「全新」只剩三个显式动作：**Shift + 侧栏点击（点当前项也算，原地重挂载不 push）/
> 关闭 tab 后再打开（dropState）/ IconRail 换层**。点当前项、当前层一律 no-op（不 push、不动 epoch）。
> 理由：P0a–P0c 把期、公司、抽屉都落进了屏内，导航一次就重过一次门是这一期要消灭的东西；
> `:max` 同步 10 → 16 覆盖专员月内要开的屏数。代价：只在 `onMounted` 取数的纯读屏失去唯一刷新入口
> —— 13 屏补了 `onReactivated(重读)`，另 3 屏因「重读会清用户选择」或「有草稿态」不补（见 SIDEBAR-UX §12）。

**实现**:
- tabs store 增加 `epoch: Record<string, number>`(内存态,不持久化——刷新后全新是合理默认)与 `openFresh(value, opts)`(epoch[value]++ 后走 open)。**close() 本身不 bump**:弃状态由调用方(TabStrip)在 `router.push(neighbor)` 完成后调 `dropState(value)`——若 epoch++ 先于导航,当前路由 key 立变会让被关视图以新 key 瞬时重挂载(onMounted 重跑+快照污染缓存,复审实测击穿后修正)。
- App.vue 改为:
  ```html
  <router-view v-slot="{ Component }">
    <keep-alive :max="10">
      <component :is="Component" :key="route.name + ':' + tabs.epochOf(route.name)" />
    </keep-alive>
  </router-view>
  ```
  key = value:epoch。兄弟路由(充电桩7/8)value 不同 → key 不同 → 原「陈旧数据」防线不回归;`:max=10` LRU 兜底内存。
- SidebarPanel 点击改走 `tabs.openFresh(value)`;TabStrip 点击维持 `tabs.open`(不 bump → 命中缓存)。
- 已知取舍:KeepAlive 缓存实例的接口刷新时机不变(缓存恢复不重拉数据,这正是"保留浏览状态"的定义);台账月卡等实时性由既有 backToMonths 重拉与重建路径保证。

## 三、测试要求

- tabs store 单测:openFresh 递增 epoch、open/pin 不动 epoch、close 递增 epoch、epochOf 缺省 0。
- LedgerView/S10View 深链消费:单测其 query 解析纯函数(抽出 parseDeepLink 之类小函数测),视图钻取走人工验收。
- 全量 vitest + typecheck 门禁;人工验收清单:核对页跳台账定位高亮/跳附表10定位高亮/Tab 切换保状态/侧边栏点开重置/关闭再开重置/充电桩 7↔8 切换无陈旧数据。
