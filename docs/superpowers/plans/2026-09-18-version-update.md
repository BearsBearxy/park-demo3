# 版本更新（What's New）实施计划 · 2026-09-18

**稿**：`运维文档/设计稿/未实现/版本更新-2026-09-18/`（画布 https://claude.ai/artifact/Rbm2WJX3dLVcYXTix7egue ），7 块画板。
**规范**：`docs/design/VERSION-UPDATE-SPEC.md`（图是规格，本计划与规范不一致时以图为准）。
**分支**：`jfen/version-update`（从 master 6186a3e 起）。

## 0. 怎么干（谁来做）

**我自己在主循环里实现，不派实现 agent、不开工作流。** 理由是 2026-09-16 的教训
（[[motion-impl-lessons-2026-09-16]]）：这轮的条目全是跨文件的（一个入口要同时动 Toolbar、IconRail、抽屉、store、测试），
按文件分派并行只会让跨文件条目掉进缝里；总量也就 8 个任务、十来个文件，协调开销大过收益。

**只派两个只读复查面**，都在最终验收之前（`adversarial-review-before-acceptance`）：

| agent | 什么时候 | 为什么触发 |
|---|---|---|
| `mockup-coverage-check` | 写计划前（已跑）、收口前各一次 | 照稿的任务 |
| `screen-copy-adversary` | T7 之后、收口之前 | 本轮往屏上加了大量新文案（弹窗、提示条、更新记录） |

## 1. 稿 → 任务 覆盖表

对着 7 张画板的图逐块数（`coverage-table-from-image`）。「说明性标注」= 画板上给人看的注解，不是产品部件。

### Entry 画板（入口）

| # | 稿上哪一块 | 落到哪个任务 |
|---|---|---|
| 1 | 顶栏 ✦ 按钮（操作记录与铃铛之间） | T6 |
| 2 | ✦ 右上角 8px 蓝点（未读） | T6 |
| 3 | 已看过态：无蓝点 + 悬停 `title` | T6 |
| 4 | 看完后 ✦ 下方的一次性提示气泡（4 秒） | T6 |
| 5 | 账号菜单里「版本更新 + 版本号 + 蓝点」一行 | T6 |
| 6 | 手机抽屉底部「版本更新」一行（未读时浅蓝底 + 蓝点） | T6 |
| 7 | 「为什么这样放」四条 | 说明性标注，不做 |

### Desktop / Mobile 画板（本次更新弹窗）

| # | 稿上哪一块 | 落到哪个任务 |
|---|---|---|
| 8 | 遮罩 + 居中弹窗（560×720，圆角 16、同款阴影） | T4 |
| 9 | 暗色页头：品牌行、关闭 ×、「版本更新 · 日期」、版本号、一句话标题 | T4 |
| 10 | 页头右下角放大的品牌标志水印 | T4 |
| 11 | 页头底色缓慢流动（复用 `GradientWave`，同色同速） | T4 |
| 12 | 本版重点卡：图标 + 「新增」标签 + 标题 + 说明 + 「去看看」 | T4 |
| 13 | 重点卡右侧 200px 小图（交审那张示意图） | T4（按稿画静态示意，见下「不做的部分」） |
| 14 | 分组标签「新增 / 改进 / 修复」+「N 项」 | T4 |
| 15 | 条目行：30×30 图标块 + 标题 + 说明 + 「去看看 ›」+ 整行悬停态 | T4 |
| 16 | 修复组的一句一条列表 | T4 |
| 17 | 正文滚动（页头与底栏不动） | T4 |
| 18 | 底栏：「查看全部更新记录 ›」+「知道了」 | T4 |
| 19 | 手机全屏形态（页头 196、底部固定按钮、重点卡上下排） | T4 |

### History 画板（更新记录）

| # | 稿上哪一块 | 落到哪个任务 |
|---|---|---|
| 20 | 760×620 固定尺寸弹窗 + 56px 头部 + 关闭 | T5 |
| 21 | 左列版本列表：版本号、「新」角标、日期、一句话标题、选中态 | T5 |
| 22 | 左列脚注「当前版本 / 更早的版本没有整理记录」 | T5 |
| 23 | 右列：版本号、发布日期、一句话标题、三组紧凑条目 | T5 |
| 24 | 选中旧版本时右列换内容（弹窗不变尺寸、旧版条目无「去看看」） | T5 |
| 25 | 手机：顶部横滑版本胶囊 + 返回/关闭 | T5 |

### Motion 画板（动效）

| # | 稿上哪一块 | 落到哪个任务 |
|---|---|---|
| 26 | 遮罩淡入 200ms、卡片 `fp-rise-in` 200ms | T4 |
| 27 | 条目不错峰、关闭无退场 | T4 |
| 28 | 蓝点瞬现瞬消 | T6 |
| 29 | 入口提示 `fp-pop-in` 120ms + 4 秒后消失 | T6 |
| 30 | 刷新提示条淡入、不自动消失 | T7 |
| 31 | 减少动态效果时全部 1ms、页头静止 | T4（`motion.css` 既有 + `GradientWave` 既有） |
| 32 | 什么时候弹（首屏数据到齐后 / 每账号每版一次 / 编辑态不弹） | T3 + T7 |
| 33 | 循环演示、逐帧图、时间轴 | 说明性标注，不做 |

### Refresh 画板（刷新提示条）

| # | 稿上哪一块 | 落到哪个任务 |
|---|---|---|
| 34 | 底部提示条（位置/颜色/按钮同 `.fp-net-toast`） | T7 |
| 35 | 文案一：有新版 | T7 |
| 36 | 文案二：页面打不开（按需加载失败后立刻出） | T7 |
| 37 | 文案三：编辑态「保存后再刷新」 | T7 |
| 38 | 与别的提示条叠放（更新这条在上） | T7 |
| 39 | 手机：抬到底栏之上、文字折行 | T7 |
| 40 | 轮询发现新版（5 分钟 + 切回标签页），服务器不缓存版本文件 | T1 + T3 |
| 41 | 「刷新之后紧接着弹本次更新」 | T3 + T7 |

### Main 画板（总览）

| # | 稿上哪一块 | 落到哪个任务 |
|---|---|---|
| 42 | 版本号取自 `package.json`（构建时注入） | T1 |
| 43 | 更新内容写在 `src/changelog.ts` | T2 |
| 44 | 已读记在浏览器本地、按账号分开 | T3 |
| 45 | 四步动线、「一条更新怎么写」、「放在哪」四卡 | 说明性标注，不做 |

**稿上不做的部分（写清理由）**

- #13 重点卡小图：稿上那张是「交审」示意图。**做成静态示意图（HTML/CSS），不接真实数据**——它是说明配图，不是活的看板；每版换内容时由写 changelog 的人换成一段静态描述或换图。
- #33 循环演示/逐帧图/时间轴、#7、#45：画板上的说明，不是产品部件。
- 稿上的版本号 v0.13.0、日期 2026-09-18、各条目文字都是**示例**。本轮按稿实现结构，`changelog.ts` 里先落这一版的内容，发版前由人逐条核。

## 2. 任务

每个任务的验收都必须**数产物**（`judge-green-from-artifacts`）：`npm run typecheck`（不许用 `npx vue-tsc`）+ 本任务相关的 vitest 文件（JSON reporter 数条数），全量留到 T8。

| 任务 | 做什么 | 验收 |
|---|---|---|
| **T1 版本号与版本文件** | `vite.config.ts`：读 `package.json` 的 `version` 注入 `__APP_VERSION__`；加一个构建期插件把 `{"version":"x.y.z"}` 写成 `dist/version.json`；`nginx.conf` 加 `location = /version.json { add_header Cache-Control "no-cache"; }`（安全头照例重复一遍——子 location 不继承）；`env.d.ts` 声明常量 | `npm run build` 后 `dist/version.json` 存在且版本号等于 `package.json`；nginx 配置里那一段存在 |
| **T2 changelog 内容** | 新建 `src/changelog.ts`：`ReleaseNote` 类型（`version / date / headline / feature? / added[] / improved[] / fixed[]`，条目含 `icon / title / desc / to?`）+ v0.13.0…v0.9.0 五段内容（照稿文字） | 单测：每条 `to` 都能在 `fpBuildRoutes()` 里找到（防写死一个不存在的屏）；版本号按日期倒序；当前版本在第一位 |
| **T3 update store** | `src/stores/update.ts`：`currentVersion`（来自 `__APP_VERSION__`）、`seenVersion`（`localStorage` key 含 `auth.me`）、`unread`、`shouldPopup`、`markSeen()`、`newVersionAvailable`、`blocked`（按需加载失败）、`startPolling()`（5 分钟 + `visibilitychange`）、`dismissBar()` | 单测：换账号各记各的、已读后不再弹、轮询到新版本置位、`blocked` 优先于 `newVersionAvailable`、`dismissBar` 只压这一版且不压 `blocked` |
| **T4 本次更新弹窗** | `src/components/shell/WhatsNewDialog.vue`（含暗色页头 + `GradientWave` 异步加载 + 三组 + 底栏），S 档全屏 | 单测：三组条数与 changelog 一致、四种关闭方式都触发 `markSeen`、「去看看」跳对路由并关窗、S 档类名；断言钉坐标/尺寸（`assert-coordinates`）：弹窗宽 560、页头高 164 |
| **T5 更新记录弹窗** | `src/components/shell/ChangelogDialog.vue`（左列版本 + 右列详情，S 档全屏 + 顶部胶囊） | 单测：默认选中当前版本、切版本只换右列、旧版本条目无「去看看」、「新」角标只在未读时出现 |
| **T6 三处入口 + 一次性提示** | `Toolbar.vue`（✦ + 蓝点 + `title`）、`IconRail.vue`（账号菜单一行）、`MobileNavDrawer.vue`（抽屉一行）、看完弹窗后的 coach 气泡（4 秒） | 单测：未读时有蓝点、已读无、点 ✦ 开更新记录、菜单行显示版本号、抽屉行位置在账号块之上；coach 只出现一次（写进 localStorage） |
| **T7 AppShell 接线 + 刷新提示条** | `AppShell.vue`：挂 `update` store 轮询、首屏数据到齐后判断是否弹 `WhatsNewDialog`、第三条 `.fp-net-toast`（三种文案 + 叠放 + S 档抬高）；`router/index.ts` 的 `onError` 置 `blocked` | 单测：编辑态不弹、已读不弹、三种文案各自出现的条件、两条 toast 同时在场时 `.stacked`、点「刷新」调 `location.reload` |
| **T8 收口** | 派 `screen-copy-adversary` + `mockup-coverage-check`，修完再跑全量 | `npm run typecheck`、全量 `vitest`（JSON reporter 数条数）、`npm run build` 三样都绿；收口消息里写「稿上哪些没做」（`report-what-was-not-built`） |

## 3. 已知的坑

- **`vite.config.ts` 会在 Node 里被导入**：`src/brand.ts` 那条注释（不许 import 图片/浏览器模块）同样适用于任何被它引用的新文件。版本号走 `define`，不要让组件去 import `package.json`。
- **`.fp-net-toast` 的入场只淡不移**：元素自身 `translateX(-50%)` 居中，位移关键帧会把它永久钉到右半边（AppShell 里已有这条注释）。
- **S 档 `.stacked` 的媒体查询不加特异度**：桌面那条 `bottom:84px` 在 S 档照样赢，抬高要按现有写法处理。
- **弹窗不要挡住加载骨架**：`shouldPopup` 的判断放在首屏数据到齐之后，不在 `onMounted` 里直接弹。
- **`prefers-reduced-motion`**：`GradientWave` 组件自己已处理（`renderStill`），不要再加一层。
- **测试跑全量会翻动 `anaSkeletonParity.spec.ts.snap` 的行尾**：内容没变就 `git checkout --` 它。
