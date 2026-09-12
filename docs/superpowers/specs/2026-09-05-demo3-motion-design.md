# demo3 动效设计规范(MOTION-DESIGN-SPEC)v1 —— 设计稿,待拍板

> 2026-09-05 立。用户原话:「页面切换、按钮点击、开屏出场、登录完进入页面、切换动效,最重要的是分析屏每个图表可视化的动效」。
> **本文是设计,不是实现:仓库源码零改动。** 配套设计画布(每条动效的可重播演示 + 时间线 + 落点):见文末「附录 B」。
> 产出方式:5 名调查员(ECharts 源码 / 交互面 / 导航时间线 / 图表清单 / 约束摘要)→ 3 名设计师(克制 / 流体空间 / 图表叙事三种视角)→ 3 名评审打分 → 合稿 → 24 名对抗复核(8 簇 × 3 视角,186 条判定、77 条修正、2 条否决)→ 复核稿 → 完整性检查(6 条补遗)。所有 file:line 与 ECharts 键均对照仓库源码与 `node_modules/echarts` 6.1.0 核过。

## 0. 先看这一页

### 0.1 现状五条硬伤(全部有证据,动效之前先修)

1. **图表今天根本没有入场动画。** `AnaEChart.vue:132` 的 ResizeObserver 在 observe 后立刻回调一次 `chart.resize()`,引擎以 `duration:0` 的 payload 走 update(`echarts.js:998-1003`,`basicTransition.js:80-84`),把每张图的入场在首帧截断到 0(评审本机实测:挂了 RO 的图 50ms 时柱高已是终值)。
2. **换期会重播入场。** 类目标签随期变化('MM-DD'/'YYYY-MM')的图,`setOption(notMerge:true)` 后 DataDiffer 全部旧删新增 → 1000ms 入场重播 + 200ms 旧柱淡出;标签不变的图走 500ms cubicInOut 形变。两者都与 LAYOUT-STABILITY §7.1「换期内容不动」相抵。
3. **换年整棵塌陷。** `PvMeterAnaView.vue:939` `v-if="loading"` 让 `.av2-grid` 卸载 → 240px 转圈 → 撑回 2000px+;且 `year` 先变、`readings` 后到,八张图先空后满。17/19 个分析屏同款。
4. **令牌与减动效有 bug。** `tokens.css:260/262` 的 `--ease-out` 定义两次(后者生效);`FPLoadBar.vue:50-59` 的 reduced-motion 呼吸被 `motion.css:49` 全局 `1ms !important` 压成静止蓝条。
5. **三处交互位移。** `TabStrip.vue:257` 激活签 min-width 42↔124 推动邻签;`ana.css:16/96` 段控 `.on` 字重 500→600 让药丸变宽;`AnaShell.vue:118` 月下拉 v-if 插拔推动工具条后续控件。

### 0.2 三处待拍板(设计上的取舍,画布上各有一块画板)

| # | 取舍 | 本稿结论 | 备选 |
|---|---|---|---|
| A | 登录完进入页面要不要过渡 | **不加**。只把登录按钮的「登录中…」延续到落地 chunk 确认(C4-02),落地屏骨架→数据原地硬切 | 「反向破晓」黑遮罩 320ms 淡出(已否:提交钮在白卡里,视线处本是白→白,遮罩让白卡先闪黑再亮回,两刀代替一刀;`/change-password` 分支不挂外壳会让一次性标志泄漏) |
| B | 数据更新形变 200ms 还是 120ms | **200**,作为原则 1 唯一明写的例外 | 120(三位评审主张):短到读不出「哪根动了」,且与引擎删除淡出硬编码的 200 错拍 |
| C | 段控选中态要不要保留字重变化 | **删**,向 DS Segmented 契约及其测试对齐 | 保留(一位评审:纯中文标签 advance 不随字重变;PV-SPEC §06.7 保留字重通道 —— 但那条针对图内状态,不针对段控) |

### 0.3 六个数字

| 项 | 值 |
|---|---|
| 图表实例(19 个分析屏) | 65 张 AnaEChart + 9 张 inline-SVG + 4 张 CSS 图 + 16 组 KPI |
| 动效项 | 44 条(页面切换 5 / 按钮 6 / 开屏 2 / 登录后 2 / 切换 8 / 图表 21)+ 补遗 6 条 |
| 新令牌 | **0** 个时长/曲线令牌;新增 1 条组件 scoped 关键帧 `fp-wipe` + `anaMotion.ts` 镜像常量 |
| 时长阶梯 | 0 / 120 / 200 / 320 ms(存量 2s 行高亮、登录页 1.1s 不动) |
| 明确不做 | 28 条,每条注明被哪一问杀掉 |
| index 预算 | 预计 +0.2~0.4KB(余量 0.6KB,CI 再少 ~1KB);实测后再决定是否签字 191→192 |

---



## 1. 动效原则

1. **频次先于一切**(LAYOUT-STABILITY §7.1 + Kowalski 四问)。100+/天(页签、命令面板、侧栏行、录入按钮)→ 零动效或纯色瞬变;**几十次/天**(换期、月步进、下拉、段控、队列行)→ ≤ `--dur-fast` 120ms;偶发(弹窗、抽屉、popover)→ `--dur-base` 200ms;一屏一次(图表首绘)→ `--dur-slow` 320ms。**唯一明写的例外:同实体同键的数据形变(ECharts 更新相、AnaBarRow)取 200**——120 短到读不出「哪根动了」,且引擎删除淡出硬编码 200(`basicTransition.js:71`),形变 120 会与淡出错拍。更长的只有存量 `--dur-highlight` 2s 与登录页 1.1s。**不新增任何时长或曲线令牌。**
2. **数据不为风格而动。** 换期/对比/选中时只做「同实体同键 200ms 形变」或瞬变;**不同实体之间永远不形变**;类目随期漂移('MM-DD'/'YYYY-MM')的图也不承受旧元素 200 幽灵淡出——系列 id 带实体/期键走瞬换。不做 count-up、不做两栋线插值、不做迷你线 d 插值。
3. **只动不触发布局的属性**:transform / opacity(合成器)+ color / fill / stroke / filter / clip-path(重绘不重排)。存量 width(`ana.css:55`)改 clip-path;存量 left 导航条整条删掉换 FPLoadBar。
4. **入场 = `@keyframes … forwards/both`,退场 = v-if 瞬时;带遮罩或 inset:0 的元素永不用 `<Transition>`**(`FPSideDrawer.vue:34-36`)。**所有「一生一次」的 CSS 入场类必须在 animationend 时摘掉**(KeepAlive 重插缓存 DOM 会重启 CSS 动画);**监听必须挂在动画元素自身或用 `.self` 守卫,不用 `.once`(会被先结束的子动画消费);scoped `<style>` 的 @keyframes 名会被 Vue 加 hash,不能按 animationName 精确比对。**
5. **ECharts 动画键必须逐系列注入。** `Model.js:87-97` `getShallow` 只在系列自身缺键时才回落;`PieSeries.js:211-217`(1000/500)、`LineSeries.js:142`(linear)、`TreemapSeries.js:220-222`(900/quinticInOut/animation:true)、`SankeySeries.js:221-222`(linear/1000)的 defaultOption 经 `Component.js:62-67` merge 只填空位。注入顺序 `{...注入, ...屏侧顶层显式键, ...系列}`,屏侧显式键(顶层或系列)永远优先。
6. **首绘与更新两条路径**:首绘 `animationDuration:320` + 短序列错峰;更新 `animationDuration:0` + `animationDurationUpdate:200`(`basicTransition.js:75-77`,`:121` duration>0 才动)。首绘相由 AnaShell provide 的屏级 `entered` 标志决定,AnaEChart 在 `await import` 之前同步快照;**且 `AnaEChart.vue:132` 的 ResizeObserver 回调必须只在尺寸真变时才 resize**——resize 以 `duration:0` payload 走 update(`echarts.js:998-1003`,`basicTransition.js:80-84`),今天它把每一张图的入场在首帧截断为零。
7. **一次交互只有一个动的东西。** 登录后不接力、不遮罩;首进屏骨架原地硬切真版式,唯一动的是各图自己的 320 首绘;开抽屉只有卡片 rise,内图瞬现;按下按钮只换一档底色。
8. **指示器过 200ms 门槛、退场立刻**(`useDeferredFlag(source: Ref<boolean>, 200)`);FPLoadBar 必须是 `.fp-stale` 宿主的兄弟而非子节点。
9. **reduced-motion 是分工不是关闭**:CSS 全局 1ms(`motion.css:45-53`);ECharts 由 `motionize` 注入顶层 + 逐系列 `animation:false` 与 `stateAnimation 0`;离屏(非 reduced)只关 animation;转圈 / FPLoadBar 呼吸按例外继续(FPLoadBar 例外今天被压死,本轮修)。
10. **不发明未记录的字面值**;ECharts 纯 JSON 在 `components/ana/anaMotion.ts` 镜像同一组数(与 `views/analysis/pvAnaColors.ts` 同一做法);STAGGER 是 ECharts 专用无 CSS 对应,注释写明。本轮零新令牌。
11. **先修位移再谈动效**:TabStrip `.on` min-width、AnaShell 月 Select v-if、`.on` 字重变宽、换年 v-if 转圈、首进屏转圈——五处零动效修正是前置。

## 2. 令牌与共享关键帧

**修复**
- `tokens.css:260` `--ease-out: cubic-bezier(0.23,1,0.32,1)` 删除;`:262` 保留(9 处引用现值即它,零行为变化);`:256-259` 注释改成只描述存在的两条。镜像注释按令牌名写,不按行号。
- `FPLoadBar.vue:50-59` @media 块加 `animation-duration: 1.6s !important; animation-iteration-count: infinite !important;`——`motion.css:49` 全局 `*` 规则今天把呼吸压成静止蓝条;scoped 选择器 (0,2,1) > `*`,同为 !important 时赢。**本轮 C1-01 也改用 FPLoadBar,这条是它的硬前置。**

**复用(不新增)**:`--dur-fast 120 / --dur-base 200 / --dur-slow 320 / --dur-highlight 2s`;`--ease-standard`(颜色/clip-path)、`--ease-out`(一切入场)、`--ease-both`(FPLoadBar);关键帧 `fp-fade-in / fp-rise-in / fp-pop-in`(motion.css:18-37)、`.fp-stale`(base.css:95-106)。

**已否的新令牌**:`--press-dim`(透明底不可见 + 层叠上下文劫持;按压改底色换档,见 §6)、`@keyframes fp-fade-out`(随 C4-01 删)、`@keyframes fp-draw`(多段 polyline 并行描不是一笔;改 fp-wipe)。

**新增**

| 名 | 值 | 放哪 | 为什么 |
|---|---|---|---|
| `@keyframes fp-wipe` | `to { clip-path: inset(0 0 0 0) }`,基态 `clip-path: inset(0 100% 0 0)` | `PvDayChart.vue` scoped | 数据组一个 `<g>` 一条动画从左到右一笔;唯一消费者;分析块不进 index;animationend 用 `.self` 不比名字 |
| `anaMotion.ts` 镜像 | `DUR={enter:320,update:200,state:120}; EASE={enter:'quarticOut',update:'cubicOut'}; STAGGER={step:12,cap:12,maxN:24}; ANIM_KEYS=[六个 animation* 键]` | `components/ana/anaMotion.ts` | 按名镜像三档;quarticOut(`zrender easing.js:32`)最接近 `--ease-out`;错峰只给 ≤24 项;ANIM_KEYS 吸收屏侧顶层键 |

**index 预算**:C4-01 删除(−250B)+ 按压规则(+≈400B)+ FPLoadBar 进 index(+≈400B)− 删掉的 nav-bar CSS(−≈300B)− `tokens.css:260`(−50B)≈ **+0.2~0.4KB**;本地余量 0.6KB、CI 多 ~1KB。**实施第 6 步前 `npm run build && node scripts/size-check.mjs` 实测**,红了才签 191→192 并在 size-check.mjs 写日期段落。anaMotion.ts / fp-wipe / clip-path 全在分析懒加载块。

## 3. 开屏出场(问 3)

现状(`main.ts:17`、`index.html:16-29`、`LoginView.vue:433-448, 71-79, 320-321`):白 → LoginView chunk → 黑遮罩 `lg-dawn 1.1s ease-out .1s` 淡出 + 粒子 800ms 暗场 + 1000ms 显影;reduced 下遮罩 `display:none`、canvas 静帧。

**决定:全部保持,一个数不调(C3-01)。不做 index.html 内联骨架/底色(C3-02)**:已登录刷新白→白连续;未登录冷启白→黑是既有硬切,内联骨架不知道登录态做不了两种颜色。

## 4. 登录完进入页面(问 4)

现状:submit → `auth.login` → `router.push`(不 await,`LoginView.vue:45,50`;finally 立即 loading=false)→ chunk 到达 → `App.vue:50-61` isBare 翻转同帧换树。外壳导航条此时未挂载。

**C4-01 反向破晓遮罩已 KILL**:提交钮在 400-500px 白卡里(`LoginView.vue:481-486 .lg-panel { background:#fff }`),视线所在处本是白→白;遮罩让白卡先闪黑再亮回,两刀代替一刀,还盖住落地骨架 320ms;`/change-password` 分支不挂外壳,一次性标志会泄漏到之后无关的外壳挂载。

**设计:只有 C4-02。** 登录与导航分两个错误域,两条 push 都 await:

```ts
let target: string | undefined
try { await auth.login(...); target = auth.mustChangePassword ? '/change-password' : (redirect || landingPath) }
catch (e) { errorMsg.value = e?.msg || e?.message || '登录失败，请检查账号和密码'; return }
finally { if (!target) loading.value = false }
try { await router.push(target) } catch { errorMsg.value = '页面加载失败，请刷新重试' } finally { loading.value = false }
```
按钮停在「登录中…」直到 chunk 确认;懒块 404(`router/index.ts:143-145` 已知路径)不再冒充密码错误。落地:DataHome 骨架→数据硬切(C4-03);Cockpit 首进走 C6-01 骨架。

## 5. 页面切换(问 1)

| 场景 | 频次 | 动什么 | 编号 |
|---|---|---|---|
| 回缓存签 / 命令面板 / 深链 / openFresh 内容区 | 100+/天 | **零动效**。KeepAlive 瞬时恢复,ECharts 实例活着不重画;新实例首帧即骨架 | C1-04 |
| 导航进度条 | 几十次/天 | **删自绘 `.fp-nav-bar`(AppShell.vue:231-249)与 motion.css:66-69,改 `<FPLoadBar :on="navShown" />`** 放 `.fp-main-card` 最后一个子节点;`navShown = useDeferredFlag(storeToRefs(ui).navigating)`;不加淡入;base.css:138 打印列表换 `.fp-lb` | C1-01 |
| 页签宽度跳变 | 100+/天 | **修位移**:`TabStrip.vue:233` 42→124,删 `:257`;两态同值,接受溢出菜单更早 | C1-02 |
| IconRail `.on` / hover | 100+/天 | `:142` transition 补 background/box-shadow 120 --ease-standard | C1-03 |
| TabStrip 溢出菜单 | 偶发 | `.fp-tablist-pop` `fp-pop-in 120 --ease-out`;关瞬时;不给 `.on` 行 transition(死规则) | C1-05 |

## 6. 按钮点击(问 2)

**语法:按下瞬到(`transition-duration:0ms`),松开随既有 background 120ms 回弹;反馈 = 底色(或底色变量)换一档更深;不缩放、不位移、不 filter。** 透明底控件也可见,触屏/键盘 Space 无 hover 同样成立。内联 `transition`(Segmented.vue:92-93、SidebarNav ROW_BASE/:253)必须迁到样式表,否则 :active 的 0ms 永远输。

```css
/* ds/Button.vue */
.ds-btn:active:not(:disabled) { transition-duration: 0ms; }
.ds-btn[data-variant="borderless"]:active:not(:disabled), .ds-btn[data-variant="outline"]:active:not(:disabled) { --ds-btn-bg: var(--ink-100); }
.ds-btn[data-variant="gray"]:active:not(:disabled) { --ds-btn-bg: var(--ink-300); }
.ds-btn[data-variant="filled"]:active:not(:disabled), .ds-btn[data-variant="danger"]:active:not(:disabled) { --ds-btn-bg: var(--control-solid-hover); }
```

| 控件 | 现状 | 改法 | 编号 |
|---|---|---|---|
| ds/Button 五变体 | 无 :active;borderless 底 transparent | 上面四行 | C2-01 |
| ds/IconButton、`.anx-nav button`、`.anx-icobtn`、FPPager `.fp-nav` | IconButton 无 :active;步进钮 hover 硬切 | IconButton `--ds-ib-bg: var(--ink-100)`;白底三处 `background: var(--ink-100)`;步进钮补 background/color 120;`[data-active]`/`.on` 不压 | C2-02 |
| ds/Segmented、`.anx-seg`、`.ak-seg2`、FPStepStrip | 阴影瞬现、transition 内联、`.on` 字重 500→600 | ① Segmented transition + box-shadow 迁出内联进 scoped;② ana.css:14/:95、FPStepStrip:148 补 --ease-standard + box-shadow;③ 删 `.on` 字重(ana.css:16/:96、FPStepStrip:157);④ `:active:not(.on):not([data-on])` 底色 --ink-100;当前步不压 | C2-03 |
| SidebarNav 行 / IconRail 钮 / TabStrip 签 | 无 :active;SidebarNav transition 内联 | SidebarNav 迁出内联 transition,`:active { --fp-sbnav-bg: var(--ink-100) }`;IconRail `:active:not(.on)` --ink-100;TabStrip `:active:not(.on)` --ink-100、`.on:active` --surface-sunken | C2-04 |
| PvQueue 行 | hover/on 硬切 | `transition: background, box-shadow 各 120 --ease-standard` + `:active:not(.on)` --ink-100 | C2-05 |
| ds/Select / Input / 文字链 | 已有 120 边框与箭头 | 保持;不加 :active;文字链不加 transition(无 hover 规则,死) | C2-06 |

## 7. 切换动效(问 5)

**按月/按年、月步进、对比(不打接口,C5-01)**:`PvMeterAnaView.vue:137` 同一份整年数据本地重算 → 无 `.fp-stale`、无 LoadBar;已挂载图走更新路径:同键 200 形变、新元素瞬现、旧元素引擎 200 淡出。按月↔按年标签整换('1..31' ↔ 'N月')→ 新柱瞬现 + 旧柱淡出。b3(`:1031`)挂在 `v-if="gran==='month'"` 上,切粒度是重挂——屏级 `entered`(§8.3)保证走更新相。同比首次选中是追加拉取(`:139 loadPrev`),当前数据仍有效,不 stale。位移修正:`AnaShell.vue:118` 保留 `v-if="pmode==='full'"`,gran 那半改 `.anx-hid { visibility:hidden; pointer-events:none }`。

**换年(打接口,C5-02)——最违规的一处**:今天 `:939 v-if="loading"` 整棵卸载 → 240px 转圈 → 撑回;且 year 先变、readings 还旧 → 新年 ticks 配旧年 rows → 八张图先空后满 = 伪装的入场重播。改:

```vue
<!-- AnaShell:sticky .anx-tools 内 <FPLoadBar :on="busy" />,18 屏 <AnaShell :busy="staleShown"> -->
<div v-if="!snap && loading" class="pma-skel">…骨架(C6-01)…</div>
<!-- failed / !snap 分支保留 -->
<div v-else class="av2-grid" data-stale-host :class="{ 'fp-stale': staleShown }" :aria-busy="staleShown">…</div>
```
- `const loadedYear = ref(year.value)`,load() 里与 readings 同步赋值;snapInput/segLabel 用 loadedYear。
- `const staleShown = useDeferredFlag(loading)`(loading 已是 Ref)。
- `data-stale-host` 让类摘掉后仍有 transition-property,退场才是 200(`base.css:101-106`;全仓 0 处用,存量 9 处退场其实硬切,另起 commit 补)。`base.css:99` 的 140 是被盖掉的死行,不动。
- FPLoadBar **不进 stale 节点**(会被糊掉),放 AnaShell sticky 工具条(`:194`,position:sticky 即定位祖先,滚动时始终可见)。
- S 档 `base.css` 加 `@media (max-width:600px){ .fp-stale{ filter:none } }`。落地后核显机量一次 stale 进场帧时间,>16ms 退到 opacity-only。

**L2 段控 `.pma-seg` 与一切期相关 v-if 重挂(C5-03)**:保持 v-if(`.pma-sec` 636 已钉;v-show 会让隐藏档 0×0 初始化)。不用屏侧 sectionSwitched——屏级 `entered`(§8.3)覆盖段控、粒度、hasB34、lab、AnomalyView `v-if=energyOption`、TenantEnergy `v-if=selPay.length` 全部重挂。

**折叠区(C5-04)**:只保留箭头 rotate 120(PvQueue:231 补 --ease-standard);组体瞬显瞬隐。

**弹窗 / 浮层**:FPDrawer 开 200 缓动 `--ease-standard → --ease-out`,关瞬时;**抽屉内三图瞬现**(entered 已真;卡片 rise 是唯一动效,C5-05)。`.fp-more-pop / .anx-pop` 补 `fp-pop-in 120`(不写 transform-origin);FPPager 面板长在上方 → 只 `fp-fade-in 120 forwards`;Cockpit `.cv2-mask` 与 FinCashflow `.fin-mask` 改 FPDrawer 同款遮罩 fade + 卡 rise 200(C5-06)。FPToast / MobileNavDrawer / FPSideDrawer / FPEditModeButton 不动(C5-07)。行高亮保持 2s,FinBalance `setTimeout(2000)` 改 `<tr @animationend="flashLabel === r.label && (flashLabel = null)">`(C5-08)。

## 8. 分析屏图表动效(问 6)

### 8.1 屏级编排

**首次进屏(C6-01)**:① `AnaShell.vue:192` **删 `v-if="!loaded"` 门**,slot 常渲染(`:184-188` 注释已论证 loaded 只表示月份列表完成;各屏 `loading` 初值 true 自出骨架);② `PvMeterAnaView.vue:939` 的 `.page-spin` 改真版式骨架:L0 76px、L1 = 卡头 + **248px**(`PvQueue.vue:200-204` 钉高)+ .pma-div + b2 脚、`.pma-sec` 636;其余屏按 `.av2-card` + 五档高度留白;ParkEnergy/Park 空数组期改常驻 '—' 瓦片;③ 骨架 → 真版式**硬切**(与 DataHome 同款),不做 `.av2-in`;④ 卡片不错峰;⑤ 视口内图各自 320 首绘,PvDayChart 数据组 320 擦入;首屏 ≤464ms。离屏图瞬到(C6-06)——PvMeterAnaView 的 L2 八张在首屏 463px 之下,基本永远走这条。

**换期(几十次/天)**:见 §7。**永不重播入场。**

**选中/焦点**:队列行 120 底色 → PvDayChart 数据组 120 淡入 → L2 SVG 三张焦点蓝 120 换色 → ECharts 选中系列瞬换(实体变)。

### 8.2 图元语法(ECharts 键,逐条核过读处)

见 chartGrammar 表。要点:
- **前置**:`AnaEChart.vue:132` RO 守卫(尺寸真变才 resize)。
- **enter**(逐系列):`animationDuration:320, animationEasing:'quarticOut', animationDelay:0`;bar/scatter 且 `data.length ≤ 24` 且未显式设置者 `animationDelay:(i)=>Math.min(i,12)*12`。
- **update**(逐系列):`animationDuration:0, animationDurationUpdate:200, animationEasing:'cubicOut', animationEasingUpdate:'cubicOut', animationDelay:0, animationDelayUpdate:0`(update 相 animationEasing 也注 cubicOut——`TreemapView.js:219` 更新读的是它)。
- **屏侧顶层键吸收**:系列合成 `{...keys, ...pick(o, ANIM_KEYS), ...stagger, ...s}`;Breakeven 顶层 `animationDurationUpdate:0` 才能压过注入的 200,marker 经宿主同为 0。
- **state / tooltip**(anaTheme.ts):`stateAnimation:{duration:120}`;`tooltip.transitionDuration:0`。
- **pie**:animationTypeUpdate 保持默认 'transition';emphasis 放大保持引擎默认,120ms 到位。
- **line**:逐系列 easing 覆盖 `LineSeries.js:142` linear。
- **treemap** 首绘无;**sankey** 只有首绘 clip。**gauge** 自动从旧角起。
- **markLine** 首绘缓动 **linear**(`MarkLineModel.js:84` 自带,接受不改),时长回落宿主;markPoint 全跟宿主;markArea 默认 false。
- **dataZoom 拖动** = 引擎 payload 100(`roams.js:126-135`),删 Cockpit 120 特例。
- **diff key** = 类目标签字符串:'N月'/'1..31' → 形变;'MM-DD'/'YYYY-MM' 随期漂移 → 系列 id 带期键瞬换(不承受 200 幽灵)。
- **实体变(C6-16)**:name 已随实体变的系列(b3/ParkEnergy/FinPnl/TenantEnergy)自动新视图瞬换;抽屉 b9/b10/b11 与 AnomalyView 加**带序号**的 id(`b9-${i}-${station.id}`,同 id 撞 idMap 报错);b6 两条 scatter 无 name,走 item-name 删/增(接受 200 幽灵)。**scatter 数据项必须带 name。**
- **对比虚线(C6-09)**:系列级 `animationDuration:200, animationEasing:'quarticOut'` 擦入;关掉是视图瞬时 dispose(不淡出);FinPnl 预算 markLine 不在此列。

### 8.3 AnaEChart.vue 改法

```ts
// components/ana/anaMotion.ts(新,分析共享块;纯函数可测)
export const DUR = { enter: 320, update: 200, state: 120 } as const   // 镜像 --dur-slow/--dur-base/--dur-fast
export const EASE = { enter: 'quarticOut', update: 'cubicOut' } as const
export const STAGGER = { step: 12, cap: 12, maxN: 24 } as const       // ECharts 专用,无 CSS 对应
const ANIM_KEYS = ['animationDuration','animationEasing','animationDelay','animationDurationUpdate','animationEasingUpdate','animationDelayUpdate'] as const
type Rec = Record<string, unknown>
const isObj = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v)
const pick = (o: Rec) => Object.fromEntries(ANIM_KEYS.filter(k => o[k] !== undefined).map(k => [k, o[k]]))
export function motionize(o: Rec, phase: 'enter' | 'update', env: { reduced: boolean; isS: boolean; visible: boolean }): Rec {
  const list = Array.isArray(o.series) ? o.series : o.series ? [o.series] : []
  const off = (s: unknown) => isObj(s) ? { ...s, animation: false } : s   // 逐系列:treemap 默认 animation:true
  if (env.reduced) return { ...o, animation: false, stateAnimation: { duration: 0 }, series: list.map(off) }
  if (!env.visible) return { ...o, animation: false, series: list.map(off) }   // 离屏:不动 stateAnimation
  const enter = phase === 'enter'
  const keys: Rec = {
    animationDuration: enter ? (env.isS ? DUR.update : DUR.enter) : 0,
    animationEasing: enter ? EASE.enter : EASE.update, animationDelay: 0,
    animationDurationUpdate: env.isS ? 0 : DUR.update, animationEasingUpdate: EASE.update, animationDelayUpdate: 0,
  }
  const top = pick(o)
  const stagger = (i: number) => Math.min(i, STAGGER.cap) * STAGGER.step
  const series = list.map(s => {
    if (!isObj(s)) return s
    const n = Array.isArray(s.data) ? s.data.length : 0
    const st = enter && !env.isS && (s.type === 'bar' || s.type === 'scatter') && n > 0 && n <= STAGGER.maxN && s.animationDelay === undefined ? { animationDelay: stagger } : {}
    return { ...keys, ...top, ...st, ...s }
  })
  return { ...keys, ...o, series }
}
```
```ts
// AnaShell.vue:  const entered = ref(false); provide('anaEntered', entered)
// AnaEChart.vue —— prop entrance?: boolean(可选覆盖);reduced 同 :99 matchMedia 判一次
const entered = inject('anaEntered', ref(false))
let painted = false
onMounted(async () => {
  const enter = props.entrance ?? !entered.value          // 第一句,await 之前快照
  nextTick(() => { entered.value = true })
  const ec = await import('./echartsBundle')
  …
  const visible = () => { const r = el.value?.getBoundingClientRect(); return !!r && !document.hidden && r.bottom > 0 && r.top < innerHeight }
  const apply = (o: object) => {
    const opt = mobilizeOption(o, isS) as Rec
    const list = Array.isArray(opt.series) ? opt.series : opt.series ? [opt.series] : []
    const phase = enter && !painted ? 'enter' : 'update'
    if (list.length) painted = true
    chart!.setOption(motionize(opt, phase, { reduced, isS, visible: visible() }), { notMerge: true })
  }
  apply(props.option)
  ro = new ResizeObserver(([e]) => {   // 尺寸真变才 resize —— 首帧空回调以 duration:0 payload 截断入场
    const w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height)
    if (chart && (w !== chart.getWidth() || h !== chart.getHeight())) chart.resize()
  })
  ro.observe(el.value)
  watch(() => props.option, apply, { deep: true })
})
```
- `notMerge:true` 保持;不注册 UniversalTransition、不改 echartsBundle。
- `anaTheme.ts` 只放静态键(`stateAnimation` 120、`tooltip.transitionDuration` 0)。
- 单测:`anaEChart.spec.ts:44/59` 改 `expect.objectContaining`,补 enter 320 / update 0 / 顶层 0 → 每系列 0 三条。

### 8.4 inline-SVG / DOM 图逐个

| 图 | 首绘 | 更新 / 选中 | 编号 |
|---|---|---|---|
| PvDayChart | 数据组 `<g :key="row.id" class="pdc-data" :class="{ first, swap }" @animationend.self="first = false; swap = false">`(按现有绘制顺序包 band/bandlab/runRects/fut/ctr/edge/ev/ax/各段 polyline/circles/漏标;网格与 xTicks 在组外);`.pdc-data.first { clip-path: inset(0 100% 0 0); animation: fp-wipe var(--dur-slow) var(--ease-out) both }` | 换栋:`watch(row.id → swap=true)`,`.pdc-data.swap { opacity:0; animation: fp-fade-in var(--dur-fast) var(--ease-out) forwards }`;animationend 摘类,KeepAlive 不重播;换期瞬变 | C6-17 |
| PvDots / PvSlope ×2 / PvSeasonRows | 随容器硬切 | `.dot/.stem`、`g .seg/g .lb`、`.ln/.pt` 各 `fill, stroke, stroke-width 120 --ease-standard`;PvSlope hover 进入 0ms(`@media (hover:hover) and (pointer:fine)`);r 4→5 瞬变 | C6-18 |
| AnaBarRow ×3 + TenantPortfolio:332 | 随容器 | fill 常驻 width:100%,`clip-path: inset(0 calc(100% - var(--pct,0%)) 0 0 round 4px)`,`transition: clip-path 200 --ease-standard`;内联改 `--pct` | C6-19 |
| KPI / L0 大数 / 迷你线 / AnaSpark / AnaBullet / PvQualityGrid / AnaTrend 十字线 | 随容器 | 瞬变;十字线 0ms;`.pma-b0` 与 `.big` 两处可选 color/border-left-color 120 | C6-20 |
| AnaEChart 首次 import 占位 | — | 无额外淡入 | C6-21 |

### 8.5 PV 屏的焦点故事

点 PvQueue 行(C2-05)→ 行底色 + inset 左条 120 → `selId` 变 → **同一 120ms**:PvDayChart 数据组淡入(C6-17)、卡头名称瞬换、PvDots/PvSlope 焦点蓝迁移(C6-18)、b3 选中线瞬换到新栋、b6 焦点点 item 删/增(C6-11/16)→ 点「看这一栋」→ FPDrawer 200 上浮(C5-05),内 3 张图瞬现 → 上一栋/下一栋 → 三图瞬换(id 按栋带序号,C6-16)→ 关抽屉瞬时。整条链上没有位移、没有假中间数据、没有超过 200ms 的东西。

### 8.6 reduced-motion

- CSS:全局 1ms(motion.css:45-53),forwards/both 停终态;`.fp-shim` 静止;`.page-spin` 例外继续;FPLoadBar 呼吸例外修在组件内(导航条与换期两处都靠它)。本方案没有 CSS 错峰,不需要 `animation-delay:0` 归零规则。
- ECharts:顶层 + 逐系列 `animation:false`、`stateAnimation.duration 0`(C6-05);`animateOrSetProps` 直接 `el.attr`,连 200 淡出也关。
- 登录页静帧。

### 8.7 性能预算

- 65 张 AnaEChart。首绘 320+144 每张一生一次,只画视口内(C6-06);首帧 RO 不再触发 resize;空闲后 zrender 10 帧自动休眠。
- 更新 200:PvMeterAnaView 月步进同时挂载的图最多 ~4 张(段控互斥);DPR≥2 每张 ≈2.8MB;S 档 SVGRenderer 更新 0。
- 后台标签页:rAF 停,回前台按绝对时间跳终态(`Animation.js:70-71`);`document.hidden` 时 setOption 直接 `animation:false`。
- clip-path / stroke / filter 是主线程重绘不是合成器动画;对 8px 条与一张 206px SVG 可忽略;`.fp-stale` 的 blur 在 2000px+ 网格上实测为准。
- 体积:anaMotion.ts ≈0.8KB 进分析块;index 见 §2。

## 9. 明确不做

见 rejected(28 条):反向破晓遮罩(白卡下两刀 + 标志泄漏)、--press-dim filter(透明底不可见)、fp-draw 描线与 band 子淡入(多段并行 + .once 被子动画消费)、`.av2-in` 淡入与 AnaShell 通用骨架、自绘导航条(重复 FPLoadBar)、Cockpit dataZoom 120(引擎 payload 100)、morph prop / sectionSwitched / entrancePhase(屏级 entered 覆盖)、不限长度错峰、路由 crossfade、滑动指示条、按钮缩放、count-up、换栋线插值、跨实体稳定 id、折叠高度动画、外壳接力、浮层退场、universalTransition、告警脉冲、换期重播、365 格扫出、滚动 reveal、登录页调参、卡片错峰/hover 上浮、tooltip 缓动、scaleX 条 / 不带 round 的 clip-path、文字链与溢出行的死 transition、饼图 scale:false。

## 10. 落地顺序

1. **令牌收口**(零行为):删 `tokens.css:260`;`FPLoadBar.vue:50-59` 加 !important。验证:token-check 绿;reduced 下 FPLoadBar 呼吸。
2. **AnaEChart 三件**:`:132` RO 守卫;anaMotion.ts + 双路径 + 屏级 entered(AnaShell provide / AnaEChart inject + painted);`anaTheme.ts` stateAnimation 120 + tooltip 0。验证:首进屏柱从基线长出(今天为零);切月/切粒度/切档/开抽屉不重播;reduced 下 canvas 瞬到;spec 三条断言。
3. **PvMeterAnaView 换期形状**:`:939-948` 骨架 + stale + data-stale-host;loadedYear;AnaShell `busy` prop + sticky 工具条 FPLoadBar;`AnaShell.vue:118` 月 Select `.anx-hid`;抽屉 b9/b10/b11 系列 id 带序号;AnomalyView id;`base.css` S 档去 blur;屏侧键:Breakeven 顶层 0、对比系列 200。验证:换年 `.av2-grid` 高度不变、CLS=0,旧图停在旧年直到新数据到。
4. **首进屏骨架**:`AnaShell.vue:192` 删门;`PvMeterAnaView.vue:939/1385` 骨架硬切;ParkEnergy/Park 常驻瓦片。之后推其余 16 屏。
5. **位移三修 + 导航条**:`TabStrip.vue:233/257`;`.on` 字重(ana.css:16/96、FPStepStrip:157);`AppShell.vue:121,231-249` 换 FPLoadBar,删 motion.css:66-69,base.css:138。
6. **按压语法 + 段控 + 六个入场**:Button / IconButton / Segmented(迁出内联)/ ana.css:14,95 / PvQueue:247 / AnaShell:205,229,232 / IconRail:142 / SidebarNav(迁出内联)/ TabStrip:246,371 / FPMoreMenu:74 / FPPager:178 / Cockpit & FinCashflow 模态。**先 build 实测 size-check**,红了才签 191→192。
7. **登录交接**:`LoginView.vue:41-56` 两个错误域 + await 两条 push。
8. **SVG 图**:`PvDayChart.vue` 数据组 + fp-wipe + swap;PvDots/PvSlope/PvSeasonRows 换色过渡;`ana.css:55` clip-path round 4px + AnaBarRow/TenantPortfolio `--pct`。
9. **收尾**:`FPDrawer.vue:98,113` `--ease-out`;`FinBalanceView.vue:314/191` animationend 守卫;PvQueue:231 --ease-standard。

每步独立可验、独立可回退;1-4 步完成后全站最违规的三处(入场被 RO 截断为零、换期重播、换年塌陷)已消失,其余都是打磨。

## 复核记录(24 位评审 × 3 视角 × 8 簇 → 本稿变更)

| 编号 / 项 | 判定 | 变更 | 依据 |
|---|---|---|---|
| C4-01 反向破晓 | KILL 成立 | 删项、删 fp-fade-out、删 ui.fromLogin;移入 §9 | `LoginView.vue:481-486 .lg-panel #fff` 亲核;/change-password 不挂外壳;+250B |
| C4-02 | FIX | 登录/导航分两个错误域,两条 push 都 await | 懒块 404 不得冒充密码错误 |
| --press-dim | 五位评审同一结论 | 不新增;按压改底色变量换档 + 0ms;内联 transition 迁出 | 透明底不可见;filter 层叠上下文 |
| C1-01 | 三 FIX | 删自绘条换 FPLoadBar;storeToRefs;无淡入;删 motion.css:66-69 | 重复实现;§7.4 呼吸;签名是 Ref |
| C1-02 | 2:1 | 全 124 | 激活标签可读 |
| C1-05 / C2-06 | FIX | 删死 transition | 无状态变化可过渡 |
| C2-03 字重 | 有争议 | 删 `.on` 字重 | DS Segmented 契约 + 测试;CJK 反证记录在案 |
| DUR.update | 3 主张 120 / 2 主张明写例外 | 保持 200,原则 1 明写例外 | 120 读不出形变;引擎淡出硬编码 200 错拍 |
| C5-01 | FIX | 同比首选是追加拉取;b3 重挂由 entered 覆盖;月 Select 只改 gran 半 | `:139 loadPrev`;`:1031 v-if` |
| C5-02 | 四 FIX | loadedYear;data-stale-host;FPLoadBar 进 AnaShell sticky;useDeferredFlag(loading) | 先空后满伪入场;base.css:101-106;糊掉 |
| C5-03 / C5-05 / C6-08 | FIX | 屏级 entered(AnaShell provide);抽屉内图瞬现 | 一处覆盖所有重挂;原则 7 |
| C5-06 | FIX | 删 transform-origin;FPPager 只淡 | 面板在触发器上方 |
| C5-08 | FIX | animationend 守卫 label | 迟到事件 |
| C6-01 | 三 FIX | 删 AnaShell 门;硬切不淡入;L1 248 | 通用壳做不了骨架;子动画冒泡摘类;一次一个动 |
| C6-02 RO | 评审实测 | RO 尺寸守卫;painted 标志 | `echarts.js:998-1003` 亲核 duration:0 payload |
| C6-03 幽灵 | FIX | 漂移类目 id 带期键瞬换 | `basicTransition.js:71` 硬编码淡出 |
| C6-06 | FIX | 离屏不动 stateAnimation | 折叠区 hover 永远 0 |
| C6-09 | FIX | exit = 视图瞬时 dispose;markLine 移出 | `echarts.js:1196-1200`;`MarkLineView.js:342-345` |
| C6-10 | FIX | 「不缩放」改「放大 120 到位」 | `PieSeries.js:205-208` scale:true |
| C6-11 / C6-16 | FIX | b6 item-name 删增;b9 id 带序号;AnomalyView 加入;scatter name 契约 | idMap Duplicated id;无 name 按 rawIndex |
| C6-14 | FIX | markLine linear 接受;措辞改 | `MarkLineModel.js:84` 亲核 |
| C6-15 | 三 FIX | 顶层键吸收;删 Cockpit 120 | `roams.js:126-135` 亲核 payload 100 |
| anaMotion | FIX | update 相 animationEasing cubicOut;错峰 ≤24 | `TreemapView.js:219` 亲核 |
| C6-17 | 六 FIX | 数据组 clip-path 擦入 + swap 类 + .self;fp-draw 废弃 | .once 被 120 子动画消费;多段并行;KeepAlive 重播 |
| C6-18 | FIX | PvSlope hover 进入 0ms;引用改 :180-197 | 指针驱动 |
| C6-19 | 2:1 | clip-path `round 4px`;TenantPortfolio:332 迁 --pct | 方口;整条不可见 |
| 原则 3 / 4 / 10 | FIX | 措辞:非布局属性;animationend 守卫规则;不发明未记录字面值 | clip-path 是重绘;.once 陷阱 |
| 引用修正 | — | finBalance/breakeven 路径、pvAnaColors 路径、.pma-lk :1496、LoginView :320-321、ana.css :16 | 评审逐条核对 |
| index 预算 | FIX | 不预签;实测后再 191→192 | C4-01 删除后 ≈ +0.2~0.4KB |

## 11. 补遗(完整性检查提出的 6 条,待拍板;均不新增令牌)

### C6-22 PvLabTable 行(高级分析档检验表)
- **缺口**:用户点名的图表清单里有 PvLabTable,规范未提。`PvLabTable.vue:49-51` 行可点(`@click="emit('pick', t.id)"`,`:92 .plt tbody tr { cursor:pointer }`),无 hover、无按压,换期/切档时表体怎么换也没写。
- **建议**:沿用 C2-05 队列行语法,写在 PvLabTable.vue scoped:`.plt tbody tr { transition: background var(--dur-fast) var(--ease-standard) } .plt tbody tr:hover { background: var(--bg-hover) } .plt tbody tr:active { background: var(--ink-100); transition-duration: 0ms }`;换期时 p/q/z 数字瞬换;不给行入场(lab 档已有存量 `.ak-analyst` akFade 320)。减动效:全局 1ms,无需额外处理。
- **待确认**:按队列行语法(120 底色 + 0ms 按压),还是明确「检验表只读、不加动效」。

### C6-23 PvRoiView 选中(分期柱 itemStyle 压暗)
- **缺口**:19 屏之一的 PvRoiView 未被点名。它的选中方式独一份:点分期柱 → selPhase → 同一批数据项的 `itemStyle.opacity` 1 / 0.45(`PvRoiView.vue:98-112`)+ `.roi2-sel` 明细卡 v-if 换。更新路径下 BarView 的 updateStyle 不走动画,压暗是瞬变的,但规范没写,C6-16 的实体/期表也没列。
- **建议**:C6-16 ⑤ 加一行:PvRoiView phaseOpt 选中 = 同一批 item 的 itemStyle.opacity 变(name 稳定、数据不变)→ 样式瞬变、柱不动;`.roi2-sel` v-if 瞬切;rampOpt 的投资额 markLine 首绘 linear 320、回本点 markPoint 随宿主 320 缩放进入,更新相都是 0。零代码改动。
- **待确认**:非选中柱的 0.45 压暗要不要 120ms 过渡?ECharts 更新时不给 item 样式做动画,不写自定义钩子只能瞬变 —— 确认接受瞬变。

### C6-24 图例开关
- **缺口**:分析层 31 处 `legend` 定义,没有一处 `selectedMode:false`(已 grep),图例全部可点。点图例是引擎内部 update:被隐藏的系列走硬编码 200 淡出,剩余系列重排(堆叠塌陷、y 轴重刻度)按 animationDurationUpdate 200。规范没写这条,§8.1 焦点故事也没包含。
- **建议**:C6-03 补一句:「图例开关 = 引擎内部更新:隐藏系列 200 淡出(basicTransition.js:71),剩余系列 200 cubicOut 重排、轴 200 重刻度 —— 照单接受,不加逐系列键;legendHoverLink 高亮走 stateAnimation 120(C6-04)」。减动效:motionize 逐系列 animation:false 已覆盖。
- **待确认**:图例开关按「同实体同键 200 形变」接受,不在任何屏加 `selectedMode:false`。

### C2-07 Pagination / PopoverItem / PvQualityGrid 榜按钮按压
- **缺口**:问 2 还有三类可按面没进 C2-01~06:(a) ds/Pagination `.ds-pg-pill`(:178-185,hover 只换 `--ds-pg-border`,无 :active);(b) ds/PopoverItem `.ds-popitem`(:40-45,hover 底 120,无 :active —— Select / FPMoreMenu / 设置弹层的每一行);(c) PvQualityGrid `.pqg-rank .r` 缺抄榜按钮(:312-318,`all:unset`,hover 硬切,无 transition 无 :active)。FPPager 已覆盖,ds/Pagination 是另一个组件。
- **建议**:同一语法三条:`.ds-pg-pill:active:not(:disabled):not([aria-current='page']) { --ds-pg-border: var(--border-strong); background: var(--ink-100); transition-duration: 0ms }`(:182 的 transition 列表补 `background var(--dur-fast) var(--ease-standard)`);`.ds-popitem:active { background: var(--ink-100); transition-duration: 0ms }`;`.pqg-rank .r { transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard) } .pqg-rank .r:active { background: var(--ink-100); transition-duration: 0ms }`。365 个日历格 `.c` 的 hover 描边保持瞬变(C6-20)。预算:Pagination/PopoverItem 在 index(+≈150B),PvQualityGrid 在分析块。
- **待确认**:按压语法是否扩到 ds/Pagination 与 ds/PopoverItem(都在 index 块,第 6 步后再核 size-check),或像 Select/Input 一样明确排除。

### C5-09 减动效下的行定位高亮
- **缺口**:motion.css:47-52 对 `*` 强制 `animation-duration:1ms !important`;`.fb-flash td`(FinBalanceView.vue:339)与 `tr.row-flash > td`(LedgerWideTable.vue:434)是不带 !important 的 scoped 规则 → 减动效下 2s 底色渐隐塌成 1ms,被定位的行完全没有视觉提示 —— 一条无障碍能力的静默退化;C5-08 的 animationend 守卫也会在 1ms 触发。§8.6 的例外只列了 .page-spin / .fp-shim / FPLoadBar。
- **建议**:在 motion.css 的减动效块(顶替 C1-01 删掉的 `.fp-nav-bar::after` 那几行)加 `.fb-flash td, tr.row-flash > td { animation-duration: var(--dur-highlight) !important; }` —— 底色渐隐不是位移/视差/闪烁,与 .page-spin 例外同一理由。零新令牌,+≈80B index。
- **待确认**:把行高亮列为第三个减动效例外;还是改成静态终态(高亮底色一直保持到下一次点击),后者要另选一个颜色令牌。

### C6-01 附:骨架高度表
- **缺口**:C6-01 写「其余屏按 .av2-card + AnaEChart 五档高度留白」,但没列五档是多少、哪屏用哪档;五档只在 AnaEChart.vue:95-104 的注释里(xs 170 / sm 200 / md 250 / lg 300 / xl 440;S 档 150/180/220/260/260)。第 4 步推其余 16 屏的人没有表可抄,一旦挑错高度,「骨架 → 真版式」的位移又回来了。
- **建议**:C6-01 附上五档表(170/200/250/300/440,S 档 150/180/220/260/260)与一条规则:「骨架块高 = 它顶替的那张 AnaEChart 的 :height + 卡头(.av2-card-h 约 28px)—— 逐屏照抄模板里的 :height 字面值;PvRoiView 7 图是最高的屏」。一句话,零新令牌。
- **待确认**:骨架必须逐图镜像 :height(零位移),而不是一个通用的 .av2-card 占位高。


## 12. 动效项总表(44 条,按类别)


### 12.3 开屏出场(2 条)

### [C3-01] LoginView 破晓遮罩 .lg-root::after + canvas 粒子 logo 显影
- **类别**:开屏出场 · **触发**:LoginView 挂载 · **频次**:一天一次
- **目的**:第一印象;已拍板(7736130)
- **动什么**:保持:黑遮罩 opacity 1→0(lg-dawn 1.1s ease-out 延迟 0.1s forwards);canvas 暗场 800ms + 逐颗显影 1000ms。不调一个数。
- **属性**:opacity(遮罩);canvas 像素 · **时长·曲线**:1.1s + 0.1s delay;800 + 1000ms(登录页专属字面量) / ease-out(存量字面量)
- **减动效**:遮罩 display:none(LoginView.vue:445-448);canvas 静帧无 rAF(:320-321 `if (reduced) { bg?.draw(0); return }`)
- **落点**:`frontend/src/views/LoginView.vue:433-448`、`frontend/src/views/LoginView.vue:71-79`、`frontend/src/views/LoginView.vue:320-321`
- **现状**:全部已存在;遮罩 pointer-events:none,自动聚焦的用户名框在破晓期间可输入
- **为什么**:一天一次是唯一允许长拍的地方;TUNE 参数登录页专属不令牌化;三版位移方案已被否。

### [C3-02] index.html 首帧 / 冷启白屏
- **类别**:开屏出场 · **触发**:冷启动 chunk 到达前 · **频次**:一次/会话
- **目的**:明确:不做
- **动什么**:无。不加内联骨架、不加底色。
- **属性**:— · **时长·曲线**:0 / —
- **减动效**:—
- **落点**:`frontend/index.html:16-29`、`frontend/src/main.ts:17`
- **现状**:空 <div id=app>,router.isReady 后才 mount
- **为什么**:已登录刷新:白→白连续(--surface-page 白,tokens.css:119)。未登录冷启:白→登录页黑是既有硬切,接受——内联骨架不知道登录态,做不了两种颜色。

### 12.4 登录完进入(2 条)

### [C4-02] 登录按钮 loading 态持续到导航确认(登录后唯一反馈)
- **类别**:登录完进入 · **触发**:submit 成功 → router.push · **频次**:一天一次
- **目的**:push 未 await,loading 在 chunk 到达前复位;冷缓存时登录页原样停几百 ms 无反馈;外壳导航条此时未挂载
- **动什么**:无新动效,逻辑改动:登录与导航分两个错误域——`let target; try { await auth.login(...); target = auth.mustChangePassword ? '/change-password' : (redirect || landingPath) } catch (e) { errorMsg = …; return } finally { if (!target) loading.value = false }` 然后 `try { await router.push(target) } catch { errorMsg.value = '页面加载失败，请刷新重试' } finally { loading.value = false }`。两条 push 都 await。
- **属性**:—(逻辑) · **时长·曲线**:— / —
- **减动效**:—
- **落点**:`frontend/src/views/LoginView.vue:41-56`
- **现状**:LoginView.vue:45,50 两处 push 不 await;:51-52 catch 把任何错误映射成「登录失败，请检查账号和密码」;:54 finally 立即 loading=false
- **为什么**:DESIGN-FIDELITY §6.5 导航期间必须有反馈;把 push 塞进登录 try 会让懒块 404(router/index.ts:143-145 已知路径)冒充密码错误,故分域。

### [C4-03] 落地屏 DataHomeView 骨架 → 真数据
- **类别**:登录完进入 · **触发**:getOverview 返回 · **频次**:一天一次
- **目的**:明确:保持无动效
- **动什么**:无。v-if 骨架 ↔ v-else 真版式同结构原地替换,已零位移。
- **属性**:— · **时长·曲线**:0 / —
- **减动效**:—
- **落点**:`frontend/src/views/data-home/DataHomeView.vue:68-105`
- **现状**:硬切,零位移
- **为什么**:文字原地替换,淡入无信息增益;KeepAlive(App.vue:55-61)重插会重播根节点 animation。C6-01 首进分析屏与此同款。

### 12.1 页面切换(5 条)

### [C1-01] 导航进度条:删自绘 .fp-nav-bar,改用 FPLoadBar
- **类别**:页面切换 · **触发**:ui.navigating(beforeEach → afterEach) · **频次**:几十次/天(预热命中的绝大多数 <200ms 全程静默)
- **目的**:chunk 空窗唯一反馈(DESIGN-FIDELITY §6.5);存量动 left(布局属性)、无 200ms 门、reduced 下仍横向滑动(违 LAYOUT-STABILITY §7.4「进度线改呼吸」)
- **动什么**:AppShell.vue:`import { storeToRefs } from 'pinia'; const { navigating } = storeToRefs(ui); const navShown = useDeferredFlag(navigating)`;模板 :121 改 `<FPLoadBar :on="navShown" />` 放在 .fp-main-card **最后一个子节点**(.fp-tabstrip 是 position:relative,DOM 靠后才画在上面);.fp-main-card 已 position:relative(:228)。删 :231-249 `.fp-nav-bar` + `fp-nav-slide`,删 motion.css:66-69 例外,base.css:138 打印隐藏列表 `.fp-nav-bar` 换 `.fp-lb`。不加淡入(2px 细线过了 200ms 门才出现,不需要;250ms 的导航会把半淡的条卸掉)。
- **属性**:transform(FPLoadBar 扫动 translateX) · **时长·曲线**:扫动 900ms(FPLoadBar 存量,指示器类不入三档);门槛 200ms / --ease-both(存量) · **退场**:瞬时(v-if)
- **减动效**:FPLoadBar 呼吸(opacity .30↔.85),依赖 §2 的 !important 修复
- **落点**:`frontend/src/components/shell/AppShell.vue:118-121`、`frontend/src/components/shell/AppShell.vue:228-249`、`frontend/src/components/fp/FPLoadBar.vue:26-46`、`frontend/src/styles/motion.css:66-69`、`frontend/src/styles/base.css:138`、`frontend/src/composables/useDeferredFlag.ts:20`
- **现状**:AppShell.vue:121 直接 v-if=ui.navigating 无门槛;:244-249 动 left;motion.css:66-69 reduced 下继续横滑
- **为什么**:仓内已有一条 2px translateX 进度线组件,注释自带「传 useDeferredFlag 的结果」——复用而不是再写一条。useDeferredFlag 签名是 Ref 不是 getter(useDeferredFlag.ts:20)。FPLoadBar ≈0.4KB 进 index,减去删掉的 nav-bar CSS 大致抵消,实测为准。DESIGN-FIDELITY §6.5 补一句「经 200ms 门(LAYOUT-STABILITY §7.3②),预热命中静默」。

### [C1-02] TabStrip 激活签宽度跳变(修正,非动效)
- **类别**:页面切换 · **触发**:任何路由切换 · **频次**:100+/天
- **目的**:.fp-tab.on{min-width:124px} vs 非激活 42px → 拥挤时邻签横移,违 §1 铁律
- **动什么**:无动效:TabStrip.vue:233 `min-width: 42px` 改 124,删 :257 的 min-width;两态同值。接受溢出菜单更早触发(它就是为拥挤准备的)。:281 `.on` 标签字重不动——flex-basis 0 + 显式 min-width 下内容宽不参与分配,不位移。加注释「激活签不得改宽 — 邻签会横移(LAYOUT-STABILITY §1)」。
- **属性**:—(布局修正) · **时长·曲线**:— / —
- **减动效**:—
- **落点**:`frontend/src/components/shell/TabStrip.vue:231-261`、`frontend/src/components/shell/TabStrip.vue:37-49`
- **现状**:TabStrip.vue:233 min-width:42px;:257 .on min-width:124px;transition :246-249 不含宽度
- **为什么**:三位评审一位主张全 42(删 :257),两位主张全 124;取 124——激活标签永远可读比塞下 19 个图标签重要。

### [C1-03] IconRail 主钮 .fp-rail-btn 选中 / hover 换色
- **类别**:页面切换 · **触发**:路由确认后高亮迁移 / hover · **频次**:100+/天
- **目的**:transition 只列 color,黑底 .on 与 hover 底硬切;与 SidebarNav(bg 120ms)不一致
- **动什么**:IconRail.vue:142 transition 改 `color var(--dur-fast) var(--ease-standard), background var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard)`。不加 scale。同一行同时服务 C2-04 的按压回弹。
- **属性**:color, background-color, box-shadow · **时长·曲线**:120ms(--dur-fast) / --ease-standard
- **减动效**:1ms
- **落点**:`frontend/src/components/shell/IconRail.vue:142-155`、`frontend/src/components/ds/SidebarNav.vue:58`
- **现状**:IconRail.vue:142 `transition: color var(--dur-fast) var(--ease-standard)`;:146 hover bg、:150-153 .on 黑底硬切
- **为什么**:补齐已有换色列表,100+/天档不加新动效。

### [C1-04] 内容区旧屏→新屏(openFresh)、回缓存页签、命令面板、深链
- **类别**:页面切换 · **触发**:侧栏 / 轨 / 页签 / Ctrl-K / 地址栏 · **频次**:100+/天(页签/面板)、几十次/天(侧栏)
- **目的**:明确:零动效
- **动什么**:无。新实例首帧即骨架(C6-01);缓存实例 KeepAlive 瞬时恢复,ECharts 实例活着不重画;命令面板开关硬切(刻意,CommandPalette.vue:63-64)。
- **属性**:— · **时长·曲线**:0 / —
- **减动效**:—
- **落点**:`frontend/src/App.vue:55-61`、`frontend/src/components/shell/CommandPalette.vue:63-64`、`frontend/src/components/shell/AppShell.vue:129-132`
- **现状**:已是零动效
- **为什么**:频次门第一档;KeepAlive 单棵树做不了并存过渡;根节点 animation 会在重插时重播(C6-01 已因此改为硬切,本项不再依赖任何摘类)。

### [C1-05] TabStrip 溢出菜单
- **类别**:页面切换 · **触发**:点溢出钮 · **频次**:偶发
- **目的**:与 ds/Popover 同规格(那边已有 fp-pop-in)
- **动什么**:`.fp-tablist-pop { animation: fp-pop-in var(--dur-fast) var(--ease-out) }`(TabStrip.vue:371);关闭 v-if 瞬时。不给 `.fp-tablist-row.on` 加 transition——selectTab(:88-92)push 后同步关菜单,.on 变化没有一帧可画,是死规则。
- **属性**:opacity, transform(translateY -4px→0) · **时长·曲线**:120ms(--dur-fast) / --ease-out · **退场**:瞬时
- **减动效**:1ms(fp-pop-in to 帧即元素默认态,无 forwards 也安全)
- **落点**:`frontend/src/components/shell/TabStrip.vue:171-175`、`frontend/src/components/shell/TabStrip.vue:371-385`、`frontend/src/styles/motion.css:34-37`
- **现状**:开关均硬切
- **为什么**:最便宜的统一点;Popover.vue:107 / Select.vue:272 同款。

### 12.2 按钮点击(6 条)

### [C2-01] ds/Button 五变体按压
- **类别**:按钮点击 · **触发**::active(鼠标 / 触屏 / 键盘 Space) · **频次**:100+/天
- **目的**:全 DS 按钮按下零反馈;按压是对手指的同步回应,不是等待
- **动什么**:复用 Button.vue:119-123 已有的 --ds-btn-bg 变量换值机制,不用 filter:`.ds-btn:active:not(:disabled) { transition-duration: 0ms }`;`[data-variant=borderless]:active, [data-variant=outline]:active { --ds-btn-bg: var(--ink-100) }`;`[data-variant=gray]:active { --ds-btn-bg: var(--ink-300) }`;`[data-variant=filled]:active, [data-variant=danger]:active { --ds-btn-bg: var(--control-solid-hover) }`(均带 :not(:disabled))。按下瞬到,松开随 :104-107 既有 background 120ms 回弹。不加 hover 规则,故无需 @media (hover) 包裹。
- **属性**:background-color(经自定义属性) · **时长·曲线**:按下 0ms;释放 120ms(--dur-fast) / --ease-standard(存量)
- **减动效**:释放也 1ms;纯色态不受影响
- **落点**:`frontend/src/components/ds/Button.vue:104-107`、`frontend/src/components/ds/Button.vue:113-125`、`frontend/src/styles/tokens.css:110-115`、`frontend/src/styles/tokens.css:191`
- **现状**:Button.vue:104-107 只过渡 bg/border/color/opacity;无 :active;borderless 底 transparent(:113)
- **为什么**:brightness(.94) 在透明底上只压暗文字 6%,触屏无 hover 时零反馈(五位评审同一结论);底色换档在所有变体都可见,零新令牌、零层叠上下文。

### [C2-02] ds/IconButton、AnaShell 步进钮 .anx-nav button、.anx-icobtn、FPPager 前后钮
- **类别**:按钮点击 · **触发**::active / hover · **频次**:几十~100+/天
- **目的**:同 C2-01;步进钮连 hover 都无 transition(硬切)
- **动什么**:IconButton.vue:`.ds-iconbtn:active:not(:disabled):not([data-active]) { --ds-ib-bg: var(--ink-100); transition-duration: 0ms }`(:66-68 transition 已含 background);AnaShell.vue:229 `.anx-nav button { transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard) }` + `:active:not(:disabled) { background: var(--ink-100); transition-duration: 0ms }`;`.anx-icobtn`(:205)补 --ease-standard,`:active:not(.on)` 同款;FPPager `.fp-nav:active:not(:disabled)` 同款(:130 已有 background 120)。
- **属性**:background-color, color · **时长·曲线**:按下 0 / 释放 120ms / --ease-standard
- **减动效**:1ms
- **落点**:`frontend/src/components/ds/IconButton.vue:60-79`、`frontend/src/views/analysis/AnaShell.vue:205-206`、`frontend/src/views/analysis/AnaShell.vue:229-231`、`frontend/src/components/fp/FPPager.vue:125-133`
- **现状**:IconButton 无 :active(底 transparent :60);AnaShell.vue:229-231 步进钮 hover 硬切、无 :active;.anx-pop 是 .anx-icobtn 的兄弟(:156-160),不受影响
- **为什么**:同一按压语法;[data-active] / .on 常亮态不压(已是选中态,再压读成两种选中)。

### [C2-03] ds/Segmented、.anx-seg、.ak-seg2、FPStepStrip 选中药丸
- **类别**:按钮点击 · **触发**:点击换档 · **频次**:几十次/天
- **目的**:白药丸阴影瞬现(boxShadow 内联三元不在 transition 列表);color 无缓动;.anx-seg/.ak-seg2/FPStepStrip 的 .on 字重 500→600 与 DS Segmented(两态同 --fw-medium,Segmented.spec.ts:20-26 有测试钉住)不一致
- **动什么**:① Segmented.vue:90-93 把 transition 与 boxShadow **移出内联 style** 进 scoped:`.ds-seg-item { transition: background var(--dur-fast) var(--ease-standard), color var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard); box-shadow: none } .ds-seg-item[data-on] { box-shadow: var(--shadow-pill) }`(内联 transition 会让任何 :active 的 transition-duration:0 失效);② ana.css:14 与 :95 补 --ease-standard + box-shadow;FPStepStrip.vue:148 同;③ ana.css:16/:96、FPStepStrip.vue:157 删掉 `.on` 的 font-weight 变化(只改底色与文字色);④ 按压:`button:active:not(.on):not([data-on]):not(:disabled) { background: var(--ink-100); transition-duration: 0ms }`;FPStepStrip `.fss-step.on` 是 cursor:default 的当前步,不压。不加滑动指示条。
- **属性**:background-color, color, box-shadow · **时长·曲线**:120ms(--dur-fast) / --ease-standard
- **减动效**:1ms
- **落点**:`frontend/src/components/ds/Segmented.vue:89-93`、`frontend/src/components/ds/__tests__/Segmented.spec.ts:20-26`、`frontend/src/components/ana/ana.css:14-16`、`frontend/src/components/ana/ana.css:95-96`、`frontend/src/components/fp/FPStepStrip.vue:126`、`frontend/src/components/fp/FPStepStrip.vue:148-160`
- **现状**:Segmented.vue:91 boxShadow 三元硬切、:92-93 transition 内联;ana.css:14 无 ease;ana.css:16/96 `.on { font-weight: var(--fw-semibold) }`(基态 --fw-medium)
- **为什么**:字重去留有争议(一位评审指出纯 CJK 标签 advance 不随字重变、PV-SPEC §06 保留字重通道):取删——三份复制品向 DS 契约与其测试对齐,且未来出现拉丁/数字标签时不留隐患;PV-SPEC 字重通道针对图内状态,不针对段控。

### [C2-04] SidebarNav 行 / IconRail 钮 / TabStrip 签 按压
- **类别**:按钮点击 · **触发**::active · **频次**:100+/天
- **目的**:按压即时确认;三处底色都是 transparent 或 5% 灰,filter 不可见
- **动什么**:SidebarNav.vue:删 ROW_BASE(:176)与 :253 的内联 `transition`,在既有无 scope 的 <style> 加 `.fp-sbnav-row { transition: background var(--dur-fast) var(--ease-standard) } .fp-sbnav-row:active { --fp-sbnav-bg: var(--ink-100); transition-duration: 0ms }`(变量换值;提示/浮出层是行的兄弟 :270-293,不受影响);IconRail:`.fp-rail-btn:active:not(.on) { background: var(--ink-100); transition-duration: 0ms }`(C1-03 已把 background 加进 :142 transition);TabStrip:`.fp-tab:active:not(.on) { background: var(--ink-100); transition-duration: 0ms }`、`.fp-tab.on:active { background: var(--surface-sunken); transition-duration: 0ms }`。关闭钮 @click.stop 不阻止 :active 冒泡,按 X 时整签压一下,接受。
- **属性**:background-color · **时长·曲线**:0 / 120ms / --ease-standard
- **减动效**:无影响(瞬变)
- **落点**:`frontend/src/components/ds/SidebarNav.vue:176-186`、`frontend/src/components/ds/SidebarNav.vue:247-258`、`frontend/src/components/ds/SidebarNav.vue:349-354`、`frontend/src/components/shell/IconRail.vue:142-155`、`frontend/src/components/shell/TabStrip.vue:246-261`
- **现状**:三处均无 :active;SidebarNav 行 transition 写在内联(h() 建节点无 data-v)
- **为什么**:0ms 按下不受「100+/天零动效」约束:它不让用户等任何东西。内联 transition 会让样式表的 transition-duration:0 永远输,必须迁出。

### [C2-05] PvQueue 楼栋行 .pq-row 选中 / hover / 按压
- **类别**:按钮点击 · **触发**:@pick → selId 变(焦点故事第一拍) · **频次**:几十次/天(本屏最频繁交互)
- **目的**:行 .on 底色 + inset 左条硬切;无 :active
- **动什么**:`.pq-row { transition: background var(--dur-fast) var(--ease-standard), box-shadow var(--dur-fast) var(--ease-standard) }`(inset 2px 左条自 none 可插值);`.pq-row:active:not(.on) { background: var(--ink-100); transition-duration: 0ms }`;.nm 字重瞬变(grid 列 minmax(0,1fr) + ellipsis,不推数字列)。
- **属性**:background-color, box-shadow(inset 左条) · **时长·曲线**:120ms(--dur-fast) / --ease-standard
- **减动效**:1ms
- **落点**:`frontend/src/views/analysis/PvQueue.vue:203-214`、`frontend/src/views/analysis/PvQueue.vue:241-255`
- **现状**:PvQueue.vue:243 底 none,:247-249 hover/on 无 transition,无 :active
- **为什么**:「点谁谁亮」的起点,与 C6-18 同 120ms;行是真 <button>、scoped 样式,样式表 :active 生效。

### [C2-06] ds/Select 触发器、SearchField、Input、文字链 .pma-lk / .anx-link
- **类别**:按钮点击 · **触发**:focus / open / hover · **频次**:100+/天 / 几十次/天
- **目的**:已有边框色 120ms 与箭头 rotate 120ms;文字链今天无任何 hover 换色规则
- **动什么**:Select/Input 保持,不加 :active(输入类压暗读成误触;面板 pop-in 已是反馈)。文字链**不加 transition**——.anx-link(AnaShell.vue:204)与 .pma-lk(PvMeterAnaView.vue:1496-1499)没有 hover/active 换色,transition 是死规则;若日后要 hover,B端惯例是 `text-decoration: underline`,不需要过渡。
- **属性**:border-color, transform(rotate)(存量) · **时长·曲线**:120ms(存量) / --ease-standard(存量)
- **减动效**:1ms
- **落点**:`frontend/src/components/ds/Select.vue:158`、`frontend/src/components/ds/Select.vue:177-178`、`frontend/src/views/analysis/AnaShell.vue:204`、`frontend/src/views/analysis/PvMeterAnaView.vue:1496-1499`
- **现状**:Select 已存在;文字链无 hover 规则(原稿引用 :975 是 L0 页脚,已改 :1496)
- **为什么**:surgical;没有状态变化就没有东西可过渡。

### 12.5 切换动效(8 条)

### [C5-01] PvMeterAnaView 按月/按年、月步进、对比切换(不打接口的重算)
- **类别**:切换动效 · **触发**:period.setGran / step / cmp.mode · **频次**:几十次/天
- **目的**:同一份整年数据本地重算(PvMeterAnaView.vue:137 注释),无网络;内容必须原地形变。同比首次选中是一次**追加**拉取(:139 loadPrev,无 loading 标志),当前数据仍有效,不需要 stale。
- **动什么**:无 .fp-stale、无 LoadBar;已挂载的 AnaEChart 走更新路径(C6-03):同实体同键 200ms 形变、新元素瞬现、删除元素引擎 200ms 淡出。按月↔按年类目标签整体换('1..31' ↔ 'N月',pvMeterAna.logic.ts:804-805/1178-1181)→ 新柱瞬现 + 旧柱 200 淡出。b3(:1031)挂在 `v-if="gran==='month'"` 上,切粒度是重挂——由屏级 entered 标志(C6-02)保证走更新相瞬现,不重播入场。PvDayChart / PvDots / PvSlope / PvSeasonRows / KPI 瞬变。位移修正:AnaShell.vue:118 保留 `v-if="pmode === 'full'"`,gran 那半改 `:class="{ 'anx-hid': period.sel.value.gran !== 'month' }"` + `.anx-hid { visibility:hidden; pointer-events:none }`(保宽;visibility 也移出 tab 序)。
- **属性**:ECharts shape/position/opacity;visibility · **时长·曲线**:200ms(DUR.update,原则 1 例外) / cubicOut(ECharts) · **退场**:引擎 200 淡出(同键图);标签整换时旧柱淡出
- **减动效**:ECharts animation:false(C6-05)
- **落点**:`frontend/src/views/analysis/PvMeterAnaView.vue:137-139`、`frontend/src/views/analysis/PvMeterAnaView.vue:1031-1032`、`frontend/src/views/analysis/AnaShell.vue:104-107`、`frontend/src/views/analysis/AnaShell.vue:118-122`、`frontend/src/views/analysis/pvMeterAna.logic.ts:804-805`、`frontend/src/views/analysis/pvMeterAna.logic.ts:1178-1181`
- **现状**:ECharts 走默认 500ms 形变或(标签全换时)1000ms 重播入场 + 200ms 淡出(实际入场被首帧 resize 截断);月 Select v-if 插拔推动后续控件;b3 每次切粒度重挂重播
- **为什么**:§7.1 换期内容不动;不打接口就不用退让。一位评审主张 120——取 200 并在原则 1 明写例外(见 decisions)。

### [C5-02] 换年 / 需网络的换期(PvMeterAnaView load(y)、CockpitView 及其余 usePeriod 屏)
- **类别**:切换动效 · **触发**:watch(year) → loading=true 且已有旧数据 · **频次**:几次~几十/天
- **目的**:今天整棵 .av2-grid 卸载 → 240px 转圈 → 撑开,是 §7.1 明令禁止的形状;且 year 先变、readings 还是旧年 → snapInput 用新年 ticks 配旧年 rows → 八张图先变空再填满 = 伪装的入场重播
- **动什么**:① `const loadedYear = ref(year.value)`,load() 里与 readings 同步赋值;snapInput/segLabel 用 loadedYear,year 只驱动 load——旧图停在旧年直到新数据到;② `const staleShown = useDeferredFlag(loading)`(loading 已是 Ref);③ 模板链保留 failed / !snap 分支:`<div v-if="!snap && loading" class="pma-skel">骨架(C6-01)</div> … <div v-else class="av2-grid" data-stale-host :class="{ 'fp-stale': staleShown }" :aria-busy="staleShown">`——`data-stale-host` 让类摘掉后仍有 transition-property,退场才是 200(base.css:101-106;全仓今天 0 处用它,存量 9 处退场其实是硬切,另起一 commit 补);④ FPLoadBar **不放在 stale 节点里**(会被 opacity .42 + blur 一起糊掉):AnaShell 加 prop `busy?: boolean`,在 sticky `.anx-tools`(:194,position:sticky 即定位祖先,滚动时始终可见)渲染 `<FPLoadBar :on="busy" />`,18 屏 `<AnaShell :busy="staleShown">` 免费获得;⑤ S 档 base.css 加 `@media (max-width:600px) { .fp-stale { filter:none } }`。数据回来:stale 200 退场与 ECharts 200 形变同帧起步。
- **属性**:opacity, filter(blur), pointer-events;ECharts shape · **时长·曲线**:进出 200ms(base.css:101-106;:99 的 140 被后一条同特异性规则盖掉,存量死行不动);门槛 200ms / --ease-out(base.css);cubicOut(ECharts) · **退场**:stale 类摘 200 淡出(data-stale-host)
- **减动效**:stale 1ms;FPLoadBar 呼吸(修复后生效)
- **落点**:`frontend/src/views/analysis/PvMeterAnaView.vue:108-125`、`frontend/src/views/analysis/PvMeterAnaView.vue:142-146`、`frontend/src/views/analysis/PvMeterAnaView.vue:939-948`、`frontend/src/views/analysis/AnaShell.vue:100`、`frontend/src/views/analysis/AnaShell.vue:194`、`frontend/src/views/analysis/CockpitView.vue:278`、`frontend/src/styles/base.css:95-106`、`frontend/src/components/fp/FPLoadBar.vue:14-19`、`frontend/src/composables/useDeferredFlag.ts:20`、`frontend/src/views/params/ParamCenterView.vue:540`、`frontend/src/views/params/ParamCenterView.vue:597`
- **现状**:PvMeterAnaView.vue:939 `v-if=loading` 转圈替换全部内容(:1385 min-height 240);分析层 .fp-stale/FPLoadBar 零命中;ParamCenterView.vue:540/597 是唯一样板(LoadBar 在外层 .pm-page、stale 在内层,兄弟关系)
- **为什么**:pointer-events:none 是安全项(旧行 id 写回事故);§7.3② 200ms 门槛。2000px+ 网格叠 8 张 DPR2 canvas 做 blur 1.5px:落地后核显机量一次 stale 进场帧时间,>16ms 退到 opacity-only。

### [C5-03] PvMeterAnaView L2 段控 .pma-seg(绝对水平 / 账面量 / 高级分析)与一切期相关 v-if 重挂
- **类别**:切换动效 · **触发**:Segmented v-model section / gran / hasB34 / lab 数据翻转 · **频次**:几十次/天
- **目的**:段内 AnaEChart 随 v-if 重挂 → 每次切档、切粒度重播图表入场;watch(SECTIONS, immediate) 还会在首绘前程序化改 section
- **动什么**:保持 v-if(.pma-sec 636 已钉,v-show 会让隐藏档图表 0×0 初始化告警 + 4 张多余 canvas)。不用屏侧 sectionSwitched:入场相由 AnaShell `provide('anaEntered', ref(false))` + AnaEChart inject 的屏级标志决定(C6-02)——同一渲染批挂载的图拿到 enter,`nextTick` 后置 true,此后任何 v-if 重挂(段控、粒度、hasB34、lab、AnomalyView `v-if=energyOption`、TenantEnergy `v-if=selPay.length`)全部走更新相瞬现。段切本身无淡入淡出。lab 档存量 .ak-analyst akFade 320 保留(偶发;KeepAlive 回签会重播,记录不改)。
- **属性**:—(v-if 瞬切;容器高度不变故零位移) · **时长·曲线**:0(切档) / —
- **减动效**:—
- **落点**:`frontend/src/views/analysis/PvMeterAnaView.vue:491-495`、`frontend/src/views/analysis/PvMeterAnaView.vue:1010-1031`、`frontend/src/views/analysis/PvMeterAnaView.vue:1447`、`frontend/src/views/analysis/AnaShell.vue:100`、`frontend/src/components/ana/AnaEChart.vue:90`、`frontend/src/components/ana/AnaEChart.vue:104-134`
- **现状**:PvMeterAnaView.vue:1021+ 三段 template v-if 硬替换,ECharts 每次重挂重播 1000ms(实际被 RO 截断)
- **为什么**:一个 provide 覆盖 19 屏所有重挂路径,零屏侧 prop;比每张图手写 :entrance 少 65 处改动。

### [C5-04] PvQueue 组头折叠 / SidebarNav 目录展开
- **类别**:切换动效 · **触发**:点组头 / 目录 · **频次**:偶发~几十次/天
- **目的**:用户主动推开下方内容,规范容许
- **动什么**:只保留箭头 rotate(90deg) 120ms(PvQueue.vue:231 补 --ease-standard;SidebarNav.vue:70-71 已有);组体 v-show / 子树 v-if 瞬显瞬隐,不做高度动画、不做淡入。
- **属性**:transform(rotate) · **时长·曲线**:120ms(--dur-fast) / --ease-standard
- **减动效**:1ms
- **落点**:`frontend/src/views/analysis/PvQueue.vue:231-232`、`frontend/src/components/ds/SidebarNav.vue:70-71`
- **现状**:箭头有(PvQueue 无 ease,浏览器默认 ease)、组体硬切
- **为什么**:height 是布局属性;在已位移的内容上叠淡入只是把位移画出来。

### [C5-05] FPDrawer 开 / 关(含 PvMeterAnaView 单栋抽屉)
- **类别**:切换动效 · **触发**:open 翻转 · **频次**:偶发~坏日子一口气十几次
- **目的**:承载决策,值 200ms;曲线归位;抽屉内图表不叠第二个动的东西
- **动什么**:开:遮罩 fp-fade-in + 卡 fp-rise-in(8px/.985)200ms,FPDrawer.vue:98,113 `var(--ease-standard, ease)` 改 `var(--ease-out)`;关:v-if 瞬时(保持)。抽屉内 3 张 AnaEChart **瞬现**——开抽屉时屏级 entered 已为 true(C6-02),自动走更新相,卡片 rise 是这次交互唯一的动效;上一栋/下一栋见 C6-16。
- **属性**:opacity, transform · **时长·曲线**:200ms(--dur-base) / --ease-out · **退场**:瞬时
- **减动效**:1ms;forwards 停终态。Teleport 到 body 的节点在 KeepAlive 回签时重插会重播一次 200 淡入,终态 opacity 1,无害
- **落点**:`frontend/src/components/fp/FPDrawer.vue:53`、`frontend/src/components/fp/FPDrawer.vue:94-113`、`frontend/src/views/analysis/PvMeterAnaView.vue:1300-1360`
- **现状**:FPDrawer.vue:98,113 用 --ease-standard;关硬切;抽屉内图表每次开重播 1000ms(被 RO 截断)
- **为什么**:tokens.css:256-259 自己写明 standard「用在进出场偏软」;原则 7 一次一个动的东西;「偶发」对这屏的抽屉不诚实,故内图不再 320。

### [C5-06] 缺 pop-in 的浮层(FPMoreMenu、AnaShell .anx-pop、FPPager 跳页面板、TabStrip 溢出见 C1-05)+ 两处自绘模态(Cockpit .cv2-mask/.cv2-modal、FinCashflow .fin-mask/.fin-modal)
- **类别**:切换动效 · **触发**:v-if 开 · **频次**:偶发
- **目的**:与 ds/Popover(fp-pop-in 120)与 FPDrawer(fade+rise 200)一致
- **动什么**:`.fp-more-pop, .anx-pop { animation: fp-pop-in var(--dur-fast) var(--ease-out) }`(各自 scoped;不写 transform-origin——fp-pop-in 只有 translateY,origin 是空操作);FPPager 面板长在触发器**上方**(bottom: calc(100% + 6px)),fp-pop-in 的 -4px→0 方向反了,改 `opacity:0; animation: fp-fade-in var(--dur-fast) var(--ease-out) forwards`(只淡不位移,不为罕见操作加向上关键帧);两处自绘模态改 FPDrawer 同款:遮罩 `opacity:0; animation: fp-fade-in var(--dur-base) var(--ease-out) forwards`,卡 `animation: fp-rise-in var(--dur-base) var(--ease-out) both`。关闭全部瞬时。
- **属性**:opacity, transform · **时长·曲线**:120ms(贴附)/ 200ms(模态) / --ease-out · **退场**:瞬时
- **减动效**:1ms;forwards/both 到终态
- **落点**:`frontend/src/components/fp/FPMoreMenu.vue:54-79`、`frontend/src/views/analysis/AnaShell.vue:160`、`frontend/src/views/analysis/AnaShell.vue:232`、`frontend/src/components/fp/FPPager.vue:70`、`frontend/src/components/fp/FPPager.vue:178-183`、`frontend/src/views/analysis/CockpitView.vue:367-368`、`frontend/src/views/analysis/CockpitView.vue:427-428`、`frontend/src/views/analysis/FinCashflowView.vue:293`、`frontend/src/views/analysis/FinCashflowView.vue:354`、`frontend/src/styles/motion.css:18-37`
- **现状**:六处全部 v-if 硬出硬消
- **为什么**:不新增机制,复用 motion.css 三条关键帧。

### [C5-07] FPToast / MobileNavDrawer / FPSideDrawer / FPEditModeButton
- **类别**:切换动效 · **触发**:— · **频次**:几十次/天 / 手机偶发 / 偶发
- **目的**:明确:不动
- **动什么**:FPToast 保持 <Transition> 容忍例外(进 200 --ease-out 6px,出 120 淡出;无遮罩、自动摘除);MobileNavDrawer 保持;FPSideDrawer 直开直关(用户指定例外);FPEditModeButton 经 ds/Button 自然继承 C2-01 按压。
- **属性**:既有 · **时长·曲线**:既有 / 既有
- **减动效**:既有
- **落点**:`frontend/src/components/fp/FPToast.vue:56-72`、`frontend/src/components/fp/FPToast.vue:144-147`、`frontend/src/components/fp/FPSideDrawer.vue:34-37`、`frontend/src/components/fp/FPEditModeButton.vue:43-57`
- **现状**:已实现
- **为什么**:禁令的两个安全例外,不扩散。

### [C5-08] 行定位高亮(LedgerWideTable / S10Table / FinBalanceView)
- **类别**:切换动效 · **触发**:深链定位 / 点扇区定位行 · **频次**:罕见
- **目的**:回答「变的是哪一行」
- **动什么**:保持 --dur-highlight 2s 底色渐隐;FinBalanceView.vue:314 的 `<tr>` 加 `@animationend="flashLabel === r.label && (flashLabel = null)"`(animation 在 td 上,animationend 冒泡到 tr,多个 td 触发多次赋 null 无害;守卫防止点第二个扇区后迟到事件把新目标清掉),删 :191 setTimeout(2000)。
- **属性**:background-color · **时长·曲线**:2s(--dur-highlight) / --ease-standard
- **减动效**:1ms → animationend 立即触发,类立刻摘;:190 scrollIntoView smooth 是 JS 显式值不受 CSS 规则影响,位置仍由滚动回答
- **落点**:`frontend/src/views/analysis/FinBalanceView.vue:188-191`、`frontend/src/views/analysis/FinBalanceView.vue:314`、`frontend/src/views/analysis/FinBalanceView.vue:339-340`、`frontend/src/views/ledger/LedgerWideTable.vue:117-118`
- **现状**:三处存量;FinBalance JS 时长与 CSS 令牌双写
- **为什么**:消灭双写。

### 12.6 分析屏图表(21 条)

### [C6-01] 分析屏首次进屏(PvMeterAnaView 为样板,同法推 18 屏)
- **类别**:分析屏图表 · **触发**:openFresh / 深链挂载 → 数据到达 · **频次**:一屏一两次/天
- **目的**:今天 AnaShell 转圈 → 屏转圈 → 整棵硬出(先塌 240px 后撑 2000px+),两个转圈接力,全站最大位移;§7.3③ 版式已知不许转圈
- **动什么**:① AnaShell.vue:192 **删掉 `v-if="!loaded"` 门**,slot 常渲染——:184-188 注释已论证 loaded 只表示 fetchAvailableMonths 完成,各屏 `loading` 初值 true(PvMeterAnaView.vue:76)自己出骨架;② PvMeterAnaView.vue:939 的 .page-spin 改真版式骨架:L0 卡 76px(:1389)+ L1 卡 = 卡头 + **248px**(PvQueue.vue:200-204 `.pq` max-height 248 = `.pdc` 实测高)+ .pma-div + b2 脚三行 + .pma-sec 636(:1447),三块 .fp-shim;其余屏按 .av2-card + AnaEChart 五档高度留白;KPI 由 .anx-kpis min-height 94 兜位;ParkEnergy/Park 的 kpis 空数组期改常驻 '—' 瓦片,只换 :255/:184 的 body 转圈;③ 骨架 → 真版式**硬切**(与 C4-03 DataHome 同款),不做 .av2-in 淡入、不做 animationend 摘类;④ 卡片之间不错峰;⑤ 视口内的 AnaEChart 各自 320 首绘并行,PvDayChart 数据组 320 擦入;首屏总长 ≤464ms。短队列时 L1 骨架比真版式高一点的残余位移是首进、无交互,§1 不涉及,接受。
- **属性**:—(硬切);各图自身 shape/clip · **时长·曲线**:0(切换);320(各图) / —
- **减动效**:.fp-shim 静止(motion.css:65)
- **落点**:`frontend/src/views/analysis/AnaShell.vue:184-193`、`frontend/src/views/analysis/PvMeterAnaView.vue:76`、`frontend/src/views/analysis/PvMeterAnaView.vue:939-948`、`frontend/src/views/analysis/PvMeterAnaView.vue:1385`、`frontend/src/views/analysis/PvMeterAnaView.vue:1389`、`frontend/src/views/analysis/PvMeterAnaView.vue:1447`、`frontend/src/views/analysis/PvQueue.vue:200-204`、`frontend/src/styles/base.css:68-82`、`frontend/src/views/analysis/ParkEnergyView.vue:125`、`frontend/src/views/analysis/ParkEnergyView.vue:255`、`frontend/src/views/analysis/ParkView.vue:52`、`frontend/src/views/analysis/ParkView.vue:184`
- **现状**:AnaShell.vue:192 .page-loading > .page-spin;PvMeterAnaView.vue:939 .pma-hold 240px 转圈;两个门串联
- **为什么**:三位评审都指出 AnaShell 通用壳做不了屏专属骨架,且 `.av2-in` 淡入会被子动画的 animationend 冒泡提前摘掉、与图表首绘叠成两个动的东西——删门 + 硬切最短。

### [C6-02] 全部 65 张 AnaEChart 首绘(enter 路径)
- **类别**:分析屏图表 · **触发**:AnaEChart 首次画出带 series 的 option,且挂载时屏级 entered 为假且可见 · **频次**:一屏一次(图表一生一次)
- **目的**:从 0 到有的编排是唯一允许的图表出场;今天默认 1000ms cubicInOut 与令牌脱节——且**实际零入场**:AnaEChart.vue:132 的 ResizeObserver 在 observe 后立刻回调一次 → chart.resize() → echarts.js:998-1003 以 `animation:{duration:0}` payload 走 update → basicTransition.js:80-84 payload 最高优先 → :138-144 el.attr 直设终态(评审本机实测:挂 RO 的图 50ms 时柱高已终值)
- **动什么**:① RO 守卫:`ro = new ResizeObserver(([e]) => { const w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height); if (w !== chart.getWidth() || h !== chart.getHeight()) chart.resize() })`(ChartInst 接口补 getWidth/getHeight);真窗口缩放仍会截断动画,接受。② 相位:AnaShell `provide('anaEntered', entered = ref(false))`;AnaEChart `const entered = inject('anaEntered', ref(false))`,onMounted **第一句**(await import 之前)`const enter = props.entrance ?? !entered.value`,随后 `nextTick(() => { entered.value = true })`;`let painted = false`,每次 setOption 前 `const phase = enter && !painted ? 'enter' : 'update'; if (list.length) painted = true`——挂载时 option 为空 `{}`、数据随后到的图(b9/b3 `if (!d) return {}`、Breakeven `be ? … : {}`)首次真数据仍走 enter。③ anaMotion.ts `motionize(opt, phase, env)`:顶层与**每个系列**注入 `animationDuration:320, animationEasing:'quarticOut', animationDelay:0, animationDurationUpdate:200, animationEasingUpdate:'cubicOut', animationDelayUpdate:0`,顺序 `{...keys, ...pick(o, ANIM_KEYS), ...stagger, ...s}`(屏侧顶层显式键吸收进系列,系列显式键最优先);type ∈ {bar, scatter} 且 `data.length ≤ 24` 且未显式设置者注入 `animationDelay:(i)=>Math.min(i,12)*12`。形态:bar 自基线长出、line 自左向右擦出、pie 顺时针展开、scatter 缩放淡入、gauge 自 startAngle 扫入、sankey 整组擦出、treemap 无(引擎)。
- **属性**:ECharts shape / rotation / scale / opacity / clipPath · **时长·曲线**:320ms(DUR.enter = --dur-slow)+ stagger ≤144ms / quarticOut(zrender easing.js:32,≈ --ease-out) · **错峰**:bar/scatter 逐 dataIndex 12ms,封顶 12 根,仅 data.length ≤ 24;pie/line/gauge/sankey/treemap 不错峰 · **打断**:resize 截断为引擎行为,不补播
- **减动效**:animation:false(C6-05)
- **落点**:`frontend/src/components/ana/AnaEChart.vue:104-134`、`frontend/src/components/ana/anaMotion.ts`、`frontend/src/views/analysis/AnaShell.vue:100`、`frontend/node_modules/echarts/lib/core/echarts.js:998-1003`、`frontend/node_modules/echarts/lib/animation/basicTransition.js:64-92`、`frontend/node_modules/echarts/lib/animation/basicTransition.js:121-144`、`frontend/node_modules/echarts/lib/model/Model.js:87-97`、`frontend/node_modules/echarts/lib/model/Component.js:62-67`、`frontend/node_modules/echarts/lib/chart/pie/PieSeries.js:211-217`、`frontend/node_modules/echarts/lib/chart/line/LineSeries.js:142`、`frontend/src/components/ana/__tests__/anaEChart.spec.ts:44-59`
- **现状**:AnaEChart.vue:130 setOption 无 animation 键;:132 RO 首帧 resize 把入场截断为零;spec :44/:59 精确 toHaveBeenCalledWith,注入后必红(改 objectContaining,补 enter 320 / update 0 两条断言)
- **为什么**:必须逐系列:getShallow 只在系列缺键时回落全局,四类系列的 defaultOption 已在系列层。不修 RO,C6-02~13 全部落空。

### [C6-03] 全部 65 张 AnaEChart 数据更新(update 路径)
- **类别**:分析屏图表 · **触发**:watch(props.option, deep) → setOption;或 entered 已真时的首挂 · **频次**:几十次/天(换期、对比、选中、段控、抽屉换栋)
- **目的**:从根上杀掉换期重播入场;同实体同键 200ms 形变;类目随期漂移的图不承受幽灵淡出
- **动什么**:`motionize(opt, 'update', env)`:顶层与每个系列注入 `animationDuration:0`(新增元素瞬现)、`animationDurationUpdate:200, animationEasing:'cubicOut', animationEasingUpdate:'cubicOut', animationDelay:0, animationDelayUpdate:0`(update 相 animationEasing 也注 cubicOut——TreemapView.js:219 更新读的是 animationEasing)。删除元素淡出为引擎硬编码 200ms cubicOut(basicTransition.js:71-73,只有 animation:false 能关)。diff key = 类目标签字符串(SeriesData.js:955-976 makeIdFromName):'N月'/'1..31' 与期无关 → 形变;'MM-DD'/'YYYY-MM' 类目随期漂移 → 旧标签 200 淡出叠在新柱上是幽灵,**屏侧给系列 `id: \`${key}:${periodKey}\``** 让 ChartView 重建瞬换(C6-16 同一规则)。notMerge:true 保持——视图复用(echarts.js:1156-1180)与 diff 都在它之下正常工作;系列 id 变时旧视图是 :1196-1200 zr.remove + dispose **瞬时**移除,不是淡出。
- **属性**:ECharts shape / position · **时长·曲线**:200ms(DUR.update = --dur-base,原则 1 例外) / cubicOut · **退场**:同系列内元素删除引擎 200 淡出;系列 id 变瞬时 dispose
- **减动效**:animation:false
- **落点**:`frontend/src/components/ana/AnaEChart.vue:137`、`frontend/node_modules/echarts/lib/core/echarts.js:1156-1200`、`frontend/node_modules/echarts/lib/data/SeriesData.js:918-982`、`frontend/node_modules/echarts/lib/animation/basicTransition.js:71-73`、`frontend/node_modules/echarts/lib/animation/basicTransition.js:121`、`frontend/node_modules/echarts/lib/chart/treemap/TreemapView.js:217-222`
- **现状**:与首绘同一通道;标签同键 500ms cubicInOut 形变、标签换则重播入场(被 RO 截断)+ 200ms 淡出
- **为什么**:basicTransition.js:121 duration>0 才 animateTo,0 即 el.attr 瞬到。一位评审提议 morph prop 关 animation——用既有 id 机制更省,且不丢首绘。

### [C6-04] ECharts hover 强调态与 tooltip 跟随
- **类别**:分析屏图表 · **触发**:鼠标移入图元 / 移动 · **频次**:每分钟数十次
- **目的**:指针跟随类反馈必须零延迟
- **动什么**:anaTheme.ts 顶层加 `stateAnimation: { duration: 120, easing: 'cubicOut' }`(默认 300,globalDefault.js:113;读处 echarts.js:1935-1942;Global.js:701-708 非组件键 merge 只填空位);tooltip 加 `transitionDuration: 0`(TooltipModel.js:76 默认 0.4;TooltipHTMLContent.js:154 ≤0 不加 CSS transition)。饼图 emphasis 放大保持引擎默认(PieSeries.js:205-208 scale:true/scaleSize 5;TenantPortfolioView.vue:115 显式 scaleSize:4 是有意设计),只是 120ms 到位。
- **属性**:ECharts emphasis 样式;tooltip DOM transform · **时长·曲线**:120ms(DUR.state = --dur-fast)/ 0 / cubicOut
- **减动效**:motionize 覆盖 stateAnimation.duration:0(仅 reduced,离屏不覆盖)
- **落点**:`frontend/src/components/ana/anaTheme.ts:43-51`、`frontend/node_modules/echarts/lib/component/tooltip/TooltipModel.js:76`、`frontend/node_modules/echarts/lib/component/tooltip/TooltipHTMLContent.js:143-154`、`frontend/node_modules/echarts/lib/core/echarts.js:1935-1942`、`frontend/node_modules/echarts/lib/model/Global.js:691-711`、`frontend/node_modules/echarts/lib/chart/pie/PieSeries.js:205-208`
- **现状**:stateAnimation 300ms;tooltip 0.4s 拖尾滑行
- **为什么**:静态默认进主题,动态相位进 motionize。

### [C6-05] ECharts 减动效
- **类别**:分析屏图表 · **触发**:matchMedia('(prefers-reduced-motion: reduce)').matches · **频次**:—
- **目的**:canvas 绕过 motion.css 全局规则,全站唯一不响应系统设置的动效源
- **动什么**:motionize reduced 分支:顶层 `animation:false, stateAnimation:{duration:0}` **并逐系列** `animation:false`(TreemapSeries.js:220 系列默认 animation:true 会压过顶层;Series.js:350 isAnimationEnabled 读 getShallow('animation'));marker 经 MarkerModel.js:85 `&& hostSeries.isAnimationEnabled()` 一并关。matchMedia 挂载时判一次(与 AnaEChart.vue:99 isS 同法)。
- **属性**:— · **时长·曲线**:0 / —
- **减动效**:即本项;animateOrSetProps 直接 el.attr(basicTransition.js:138-144),连 200 淡出也关
- **落点**:`frontend/src/components/ana/AnaEChart.vue:99`、`frontend/src/components/ana/anaMotion.ts`、`frontend/node_modules/echarts/lib/model/Series.js:343-356`、`frontend/node_modules/echarts/lib/chart/treemap/TreemapSeries.js:220`、`frontend/node_modules/echarts/lib/component/marker/MarkerModel.js:82-86`
- **现状**:无任何 reduced-motion 处理
- **为什么**:逐系列是因为 treemap。

### [C6-06] 离屏 / 后台标签页的 AnaEChart + S 档 SVGRenderer 降档
- **类别**:分析屏图表 · **触发**:setOption 时 el 不在视口或 document.hidden;isS · **频次**:—
- **目的**:引擎无视口检测(离屏照样逐帧重绘);SVG 下动画是逐元素 DOM attr 更新
- **动什么**:AnaEChart `visible()` = `!document.hidden && r.bottom > 0 && r.top < innerHeight`(一次 getBoundingClientRect,在 await import 之后、setOption 之前同步取;仅视口判定,不减 sticky 工具条,不用 IntersectionObserver);不可见且非 reduced → 该次 setOption 顶层 + 逐系列 `animation:false`,**不动 stateAnimation**(否则折叠区图表 hover 永远 0ms 直到下次换期);滚到时已画好,不补播。KeepAlive 停用的页签 rect 全 0 → 走此分支。isS → enter 200 无错峰、update animationDurationUpdate 0(删除淡出仍 200,13 元素 SVG 可忽略)。后台回前台引擎按绝对时间跳终态(zrender Animation.js:70-71)。
- **属性**:— · **时长·曲线**:0 / S 档 200 / —
- **减动效**:同 C6-05(reduced 分支另含 stateAnimation 0)
- **落点**:`frontend/src/components/ana/AnaEChart.vue:99-100`、`frontend/src/components/ana/AnaEChart.vue:127-137`、`frontend/src/components/ana/echartsBundle.ts:40-46`、`frontend/node_modules/zrender/lib/animation/Animation.js:70-76`
- **现状**:所有图同时动画,含折叠区/下半屏;S 档吃桌面同款
- **为什么**:性能:DPR≥2 每张 600×300 ≈2.8MB,首绘只画看得见的。PvMeterAnaView 的 L2 八张图在首屏 463px 之下,基本永远走「离屏瞬到」——首绘编排在这屏实际是 PvDayChart 擦入 + 视口内 1-2 张图,不要为此补回放。

### [C6-07] bar 系列(~38 张:竖柱、横条、堆叠、瀑布、龙卷风)
- **类别**:分析屏图表 · **触发**:首绘 / 更新 · **频次**:一次 / 几十次/天
- **目的**:柱从基线长出、短序列自左向右错峰;更新只改高度
- **动什么**:enter:BarView.js:533-547 新建 rect height/width 0 → layout 320 quarticOut,:199 initProps 带 dataIndex → 逐 idx 错峰 min(i,12)×12(仅 data.length ≤ 24;堆叠按类目同 delay 整根一起堆;横条从左轴长出)。update:同键 200 cubicOut(:287-289 updateProps;isValueSame 跳过未变值);exit::294-296 removeElementWithFadeOut 200。
- **属性**:shape.height / shape.width(canvas 内) · **时长·曲线**:320 / 200 / 退出 200 / quarticOut / cubicOut · **错峰**:12ms × ≤12,仅短序列 · **退场**:200 淡出
- **减动效**:animation:false
- **落点**:`frontend/node_modules/echarts/lib/chart/bar/BarView.js:195-203`、`frontend/node_modules/echarts/lib/chart/bar/BarView.js:283-298`、`frontend/node_modules/echarts/lib/chart/bar/BarView.js:533-547`、`frontend/src/views/analysis/CockpitView.vue:308`、`frontend/src/views/analysis/ExpenseView.vue:176`、`frontend/src/views/analysis/TenantEnergyView.vue:388`
- **现状**:1000ms cubicInOut 入场无错峰(被 RO 截断);500 更新
- **为什么**:Bar 无系列级动画默认,为统一走逐系列。

### [C6-08] line / area 系列(~28 张,含 opacity0+areaStyle 静默带)
- **类别**:分析屏图表 · **触发**:首绘 / 更新 · **频次**:一次 / 几十次/天
- **目的**:线的擦出是「时间从左到右」的直觉;更新形变
- **动什么**:enter:lineGroup clipPath 宽 0→满(LineView.js:569;createClipPathFromCoordSys.js:73-100)320 quarticOut——**逐系列写**才能覆盖 LineSeries.js:142 的 linear;符号点按其在 clip 内比例延迟出现(:828-870,delay 函数以 null 调用故不给 line 错峰);静默带同 clip 一起擦出。update:点位变 → polyline 200 形变(:604-607 → :1057,按 data id 对齐),面积同步;更新分支 :582-587 重建 clip 走 enter 键(更新相 0)即瞬到。凡挂在期相关 v-if 上的折线(b3 :1031、TenantEnergy :371、AnomalyView :224)重挂由屏级 entered 走更新相。
- **属性**:clipPath.shape.width;polyline points · **时长·曲线**:320 / 200 / quarticOut / cubicOut
- **减动效**:animation:false
- **落点**:`frontend/node_modules/echarts/lib/chart/line/LineView.js:499`、`frontend/node_modules/echarts/lib/chart/line/LineView.js:569-607`、`frontend/node_modules/echarts/lib/chart/line/LineView.js:828-833`、`frontend/node_modules/echarts/lib/chart/line/LineSeries.js:142`、`frontend/src/views/analysis/PvMeterAnaView.vue:1031`、`frontend/src/views/analysis/TenantEnergyView.vue:352`、`frontend/src/views/analysis/AnomalyView.vue:224`
- **现状**:1000ms linear 擦出(被 RO 截断);500 形变
- **为什么**:折线是单元素,不承诺逐点错峰(引擎边界)。

### [C6-09] 对比虚线(Cockpit 主图 / Expense 总计(上月) / FinPnl 上期线 / PnlAnalysis 上月线 / ParkEnergy combo 虚线)——独立 line 系列
- **类别**:分析屏图表 · **触发**:cmp.mode 开 / 关 · **频次**:几十次/天
- **目的**:多出来的那条线是新信息,要「画进来」让人看见多了什么;主系列不动
- **动什么**:更新相唯一保留的入场:对比系列在 option 构建时**系列级**写 `animationDuration: 200, animationEasing: 'quarticOut'`(系列键压过注入的 0;新 name → 新视图 → _data 空 → LineView.js:569 clip initProps 读系列自身 200)→ 从左向右擦入 200;关掉时该 name 视图 __alive=false → echarts.js:1196-1200 **瞬时** dispose(不是淡出);既有系列值未变 → isValueSame 零抖动。对比系列 name 稳定以便期步进时 diff 对齐。**FinPnl 预算 markLine 不在本项**:markLine 读 mlModel 自身 → 回落全局(MarkLineView.js:342-345 hostModel=mlModel),更新相全局 0 → 瞬现,与 C6-14 一致。
- **属性**:clipPath.shape.width(引擎) · **时长·曲线**:200(DUR.update) / quarticOut · **退场**:瞬时(视图 dispose)
- **减动效**:animation:false 全关
- **落点**:`frontend/src/views/analysis/CockpitView.vue:104-123`、`frontend/src/views/analysis/ExpenseView.vue:176`、`frontend/src/views/analysis/PnlAnalysisView.vue:189`、`frontend/src/views/analysis/ParkEnergyView.vue:303`、`frontend/node_modules/echarts/lib/animation/basicTransition.js:75-77`、`frontend/node_modules/echarts/lib/core/echarts.js:1196-1200`
- **现状**:对比系列随 notMerge 整图重放(被 RO 截断)
- **为什么**:更新相全部 ≤200 一条线;擦入的「画」感来自 clip 方向。

### [C6-10] pie / donut ×8(Cockpit、Charging、Expense、Expiry、FinBalance×2、Park、TenantPortfolio)
- **类别**:分析屏图表 · **触发**:首绘 / 换期 / 点扇区筛选 · **频次**:一次 / 几十次/天
- **目的**:环是构成,扇角形变直接可读;绝不重播展开
- **动什么**:enter:animationType 'expansion'(默认)自 startAngle 顺时针展开(PieView.js:84-127)320 quarticOut,不错峰——逐系列 animationDuration 320 覆盖 PieSeries.js:212 的 1000;update:animationTypeUpdate 默认已是 'transition'(PieSeries.js:214),**不要写成 'expansion'**(PieView.js:266-268 不存 _data,每次更新当首建重播),逐系列 animationDurationUpdate 200 覆盖 :216 的 500,按 name 对齐扇角/半径形变;点击扇区触发的外部筛选(TenantPortfolio phaseFilter)令帕累托同步 200 形变;emphasis 放大(引擎默认 scale:true)120ms 到位。
- **属性**:sector startAngle / endAngle / r · **时长·曲线**:320 / 200 / quarticOut / cubicOut · **退场**:200 淡出
- **减动效**:animation:false
- **落点**:`frontend/node_modules/echarts/lib/chart/pie/PieView.js:84-134`、`frontend/node_modules/echarts/lib/chart/pie/PieView.js:264-268`、`frontend/node_modules/echarts/lib/chart/pie/PieSeries.js:205-217`、`frontend/src/views/analysis/TenantPortfolioView.vue:111-116`、`frontend/src/views/analysis/FinBalanceView.vue:234-244`
- **现状**:系列默认 1000 展开 / 500 transition(顶层键覆盖不到)
- **为什么**:PieSeries 系列级默认是逐系列注入的第一理由。「不缩放」原稿有误,已改。

### [C6-11] scatter ×8(Churn 象限 / Park 面积-租金 / TenantEnergy 气泡 / TenantPortfolio 箱点 / PvMeterAna b6・b9 残差・labAlpha / Budget 标记)
- **类别**:分析屏图表 · **触发**:首绘 / 更新 / 选中 · **频次**:一次 / 几十次/天
- **目的**:点逐个浮现;更新按 item name 位移
- **动什么**:enter:Symbol.js:157-168 scaleX=scaleY=0 + opacity 0 → 目标,320 quarticOut,逐 idx 错峰 ≤144(仅 data.length ≤ 24;b9 残差 365 点整体 320 起);update:Symbol.js:148-151 + SymbolDraw.js:137-141 位移/缩放 200;remove:Symbol.js:314-323 缩放+淡出 200(硬编码)。**契约:scatter 数据项必须带 `name`(稳定实体键)**——SeriesData.js:918-926 无 name 时按 rawIndex diff,换期会把第 i 个点从实体 A 形变到实体 B;三处已核带 name。b6 两条 scatter **系列无 name**(自动 id 按索引稳定 → 同一 ChartView),换栋是数据项按 name 的删/增:旧焦点点 200 淡出+缩放,新焦点点更新相 0ms 出现;灰点系列反向同理——两个 200ms 幽灵重叠,可接受;若不接受,给两系列 `id: \`b6f:${selId}\`` / `\`b6o:${selId}\`` 走视图重建瞬换。
- **属性**:scaleX/scaleY, opacity, x/y · **时长·曲线**:320 / 200 / quarticOut / cubicOut · **错峰**:12ms × ≤12,仅短序列 · **退场**:缩放+淡出 200
- **减动效**:animation:false
- **落点**:`frontend/node_modules/echarts/lib/chart/helper/Symbol.js:144-170`、`frontend/node_modules/echarts/lib/chart/helper/Symbol.js:310-326`、`frontend/node_modules/echarts/lib/chart/helper/SymbolDraw.js:130-150`、`frontend/node_modules/echarts/lib/data/SeriesData.js:918-926`、`frontend/src/views/analysis/PvMeterAnaView.vue:373-406`、`frontend/src/views/analysis/ChurnView.vue:54-55`、`frontend/src/views/analysis/TenantEnergyView.vue:402`
- **现状**:1000 / 500;b6 换栋已是 item 级删增
- **为什么**:同 bar;原稿「b6 独立系列随 selId 换 data → 实体变 → 瞬换」机制写错,已按 item-name diff 改写。

### [C6-12] gauge ×2(FinBalanceView 资产负债率 / 流动比率)
- **类别**:分析屏图表 · **触发**:首绘 / 换公司 / 换期 · **频次**:偶发
- **目的**:指针从旧值扫到新值是唯一天然表达「变了多少」的形变
- **动什么**:enter:progress 弧 endAngle 与指针 rotation 自 startAngle 扫入(GaugeView.js:361-375)320;update:GaugeView.js:385-404 自动取旧 rotation / 旧 endAngle 起 200 到新角;detail 数字瞬换(GaugeSeries.js:163/181 valueAnimation 默认 false)。
- **属性**:rotation, shape.endAngle · **时长·曲线**:320 / 200 / quarticOut / cubicOut
- **减动效**:animation:false
- **落点**:`frontend/node_modules/echarts/lib/chart/gauge/GaugeView.js:358-406`、`frontend/node_modules/echarts/lib/chart/gauge/GaugeSeries.js:163`、`frontend/src/views/analysis/FinBalanceView.vue:257`、`frontend/src/views/analysis/finBalance.logic.ts:44-55`
- **现状**:1000 / 500 默认
- **为什么**:gauge 无系列级默认。原稿路径 src/analysis/ 不存在,已改 src/views/analysis/。

### [C6-13] sankey ×1(ParkEnergy 能耗桑基)与 treemap ×1(ParkView 楼栋租金)
- **类别**:分析屏图表 · **触发**:首绘 / 换期 / 点节点 · **频次**:偶发
- **目的**:承认引擎边界:sankey 只有首绘擦出、更新零动画;treemap 首绘零动画、更新有补间
- **动什么**:sankey enter:SankeyView.js:277-281 仅 `!this._data` 首次给 mainGroup 加 clip 左→右(:332-350),逐系列 animationDuration 320 / animationEasing quarticOut 覆盖 SankeySeries.js:221-222 的 linear/1000;update::122 removeAll 重建瞬变(不承诺),换期靠 .fp-stale 落位遮;点节点 → 邻图「板块月度趋势」bar 走 C6-07;emphasis adjacency 120。treemap enter:TreemapView.js:124-125 isInit → renderFinally,无(不伪造);update::217-222 读 animationDurationUpdate(注入 200)与 **animationEasing**(非 *Update;update 相注入 cubicOut),函数形态归零故不给 delay;点击选中栋只换 itemStyle。
- **属性**:clipPath.width(sankey);rect x/y/w/h(treemap 内部补间) · **时长·曲线**:320 / 0(sankey);0 / 200(treemap) / quarticOut / cubicOut
- **减动效**:逐系列 animation:false(treemap 默认 animation:true)
- **落点**:`frontend/node_modules/echarts/lib/chart/sankey/SankeyView.js:118-126`、`frontend/node_modules/echarts/lib/chart/sankey/SankeyView.js:272-350`、`frontend/node_modules/echarts/lib/chart/sankey/SankeySeries.js:221-222`、`frontend/node_modules/echarts/lib/chart/treemap/TreemapView.js:110-128`、`frontend/node_modules/echarts/lib/chart/treemap/TreemapView.js:214-226`、`frontend/node_modules/echarts/lib/chart/treemap/TreemapSeries.js:220-222`、`frontend/src/views/analysis/ParkEnergyView.vue:281-297`、`frontend/src/views/analysis/ParkView.vue:203`
- **现状**:sankey 1000 linear 擦出、更新瞬变;treemap 更新 900 quinticInOut
- **为什么**:不用 graphic/custom(未注册)伪造引擎做不到的事。

### [C6-14] markLine / markPoint / markArea(≈22 张)
- **类别**:分析屏图表 · **触发**:首绘 / 更新 · **频次**:一次 / 几十次/天
- **目的**:参照线随数据到位,不抢戏;面积区域形变无阅读价值
- **动什么**:零代码改动,措辞修正:markLine/markPoint 的**开关**看宿主(MarkerModel.js:85 `getShallow('animation') && hostSeries.isAnimationEnabled()`),**时长**回落宿主系列(MarkerModel.js:118 以 seriesModel 为 parentModel 建模)→ 320 / 200;markLine 首绘**缓动 linear**(MarkLineModel.js:84 自带 animationEasing:'linear',自身有键不回落,注入的 quarticOut 到不了它;Line.js:125-130 percent 0→1 端到端画),更新缓动无自身默认 → cubicOut;markPoint 全跟宿主;markArea 瞬到(MarkAreaModel.js:65 默认 animation:false)。1px 参照线 320ms linear 与 quarticOut 读不出差别,不为它加注入分支。C6-15 的 Breakeven 顶层 0 经 motionize 吸收进系列后,marker 经宿主同样为 0。
- **属性**:line / point 位置 · **时长·曲线**:320 / 200 / markArea 0 / markLine 首绘 linear(引擎默认)/ 其余 quarticOut / cubicOut
- **减动效**:animation:false(经宿主)
- **落点**:`frontend/node_modules/echarts/lib/component/marker/MarkerModel.js:82-86`、`frontend/node_modules/echarts/lib/component/marker/MarkerModel.js:112-131`、`frontend/node_modules/echarts/lib/component/marker/MarkLineModel.js:60-86`、`frontend/node_modules/echarts/lib/component/marker/MarkLineView.js:342-345`、`frontend/node_modules/echarts/lib/component/marker/MarkAreaModel.js:65`、`frontend/src/views/analysis/PvMeterAnaView.vue:816`、`frontend/src/views/analysis/PvMeterAnaView.vue:846`、`frontend/src/views/analysis/breakeven.logic.ts:84`
- **现状**:随系列默认(markLine linear)
- **为什么**:已核默认值;原稿「跟随宿主 quarticOut」有误,原稿 breakeven 路径 src/analysis/ 不存在,已改 src/views/analysis/。

### [C6-15] 连续输入驱动的图:Breakeven 三图(滑杆)与 Cockpit 主图(dataZoom)
- **类别**:分析屏图表 · **触发**:拖固定成本系数滑杆 / 拖 dataZoom · **频次**:连续(每帧)
- **目的**:跟手:任何 >0 的更新动画都让图落后手指
- **动什么**:Breakeven:breakeven.logic.ts:84/130/164 三个 option **顶层**写 `animationDurationUpdate: 0`,motionize 把屏侧顶层 ANIM_KEYS 吸收进每个系列(`{...keys, ...pick(o, ANIM_KEYS), ...s}`),线与 markPoint/markLine(经宿主)同时为 0——不吸收的话顶层 0 是死键(系列自身有注入的 200,getShallow 不回落)。Cockpit:**删掉 120 特例**——dataZoom 拖动由 roams.js:126-135 每次 dispatch 自带 `animation:{easing:'cubicOut',duration:100}` payload(basicTransition.js:80-84 最高优先),滑杆 realtime 同为 100(SliderZoomView.js:69-72),屏侧键管不到拖动;月步进走通用 200。首绘仍 320。
- **属性**:— · **时长·曲线**:0(Breakeven)/ 引擎 100(dataZoom 拖动)/ 200(Cockpit 月步进) / cubicOut
- **减动效**:animation:false
- **落点**:`frontend/src/views/analysis/BreakevenView.vue:138-162`、`frontend/src/views/analysis/breakeven.logic.ts:84-103`、`frontend/src/views/analysis/breakeven.logic.ts:130`、`frontend/src/views/analysis/breakeven.logic.ts:164`、`frontend/src/views/analysis/CockpitView.vue:104-135`、`frontend/node_modules/echarts/lib/component/dataZoom/roams.js:126-135`、`frontend/node_modules/echarts/lib/component/dataZoom/SliderZoomView.js:69-72`、`frontend/node_modules/echarts/lib/animation/basicTransition.js:80-84`
- **现状**:500ms 默认更新动画拖尾;src 内无任何 animation 键
- **为什么**:数据是手的延伸;三位评审同时指出顶层键会被逐系列注入压死,吸收规则一处改完、原则 5「屏侧显式键优先」对顶层也成立。

### [C6-16] 实体变 vs 期变 的 diff 规则:b3 选中线、b6 焦点点、选中驱动的兄弟图(ParkEnergy 板块趋势 / FinPnl 科目趋势 / TenantEnergy 租户趋势 / TenantPortfolio 帕累托 / AnomalyView 租户能耗)、抽屉 b9/b10/b11 上一栋/下一栋、类目随期漂移的图
- **类别**:分析屏图表 · **触发**:@chart-click / @pick / stepStation 改 ref → option 变;换期 · **频次**:几十次/天
- **目的**:不同实体之间形变是假中间数据;同实体不同期才形变;漂移类目不承受幽灵
- **动什么**:规则:实体变(栋/租户/科目)→ 旧删新增;同实体同键期变 → 200 形变;类目随期漂移('MM-DD'/'YYYY-MM')→ 系列 id 带期键瞬换。落地:① b3(name: sel.name :326-330)、ParkEnergy(name: BOARD_ZH[board] :183)、FinPnl(name: subject :262)、TenantEnergy(name: 租户名 :158)系列 name 已随实体变 → 自动 id 变(util/model.js:352-355)→ 新 ChartView(echarts.js:1165-1167;更新路径 animationDuration 0 即瞬现),旧视图 :1196-1200 瞬时 dispose;**不加** id:'sel'。② b6 两条 scatter 无 name,走 item-name 删/增(C6-11)。③ 抽屉 b9 四条系列(:826-846)全无 name、xAxis 'MM-DD' 跨栋同键 → 今天跨栋 500 形变;加 id **必须带序号**避免撞 id(model.js:352 idMap 去重报 Duplicated id):`series.map((s, i) => ({ ...s, id: \`b9-${i}-${station.id}\` }))`,b10/b11 同。④ AnomalyView.vue:64 energyOption 系列 name 恒定('电费'/'水费'/'园区P25'…)、月类目共享 → 跨租户形变,同法 `id: \`elec-${i}-${sel.id}\``;其 `v-if="energyOption"` 的 null↔值重挂由屏级 entered 走更新相。⑤ 实施前 grep 一遍选中 ref 驱动、系列 name 为常量字符串的屏,同规则。TenantPortfolio 点扇区改 phaseFilter 是同实体集合的筛选 → 帕累托 200 形变(name 稳定)。
- **属性**:ECharts 系列 id · **时长·曲线**:0(实体变)/ 200(期变) / cubicOut · **退场**:视图 dispose 瞬时
- **减动效**:animation:false
- **落点**:`frontend/src/views/analysis/PvMeterAnaView.vue:307-334`、`frontend/src/views/analysis/PvMeterAnaView.vue:376-406`、`frontend/src/views/analysis/PvMeterAnaView.vue:822-850`、`frontend/src/views/analysis/PvMeterAnaView.vue:1328-1353`、`frontend/src/views/analysis/ParkEnergyView.vue:177-183`、`frontend/src/views/analysis/FinPnlView.vue:262`、`frontend/src/views/analysis/TenantEnergyView.vue:147-158`、`frontend/src/views/analysis/AnomalyView.vue:64`、`frontend/src/views/analysis/AnomalyView.vue:224`、`frontend/node_modules/echarts/lib/util/model.js:338-356`、`frontend/node_modules/echarts/lib/core/echarts.js:1156-1200`
- **现状**:name 变 → 旧视图瞬时 dispose + 新视图 1000ms 入场(被 RO 截断);抽屉翻栋 / AnomalyView 换租户 500 跨实体形变
- **为什么**:与拒绝「换栋线插值」同一原则;原稿「旧系列淡出」措辞错、b9 同 id 会报错、b6 机制错,均已改。

### [C6-17] PvDayChart(L1 单栋逐刻度比值大图,inline SVG)
- **类别**:分析屏图表 · **触发**:首挂 / PvQueue 点行换栋 / 换期 · **频次**:首挂一次 / 几十次/天
- **目的**:首绘是本屏愉悦预算唯一落点;换栋是本屏最高频图表变化,焦点故事第二拍
- **动什么**:结构:按现有绘制顺序把 band + bandlab + runRects + fut 组 + ctr + edge + ev + ax + 各段 polyline + circles + 漏标 包进 `<g :key="row.id" class="pdc-data" :class="{ first, swap }" @animationend.self="first = false; swap = false">`;网格线/刻度值/xTicks 留在组外(z 序不变)。首挂:`first = ref(true)`,`.pdc-data.first { clip-path: inset(0 100% 0 0); animation: fp-wipe var(--dur-slow) var(--ease-out) both } @keyframes fp-wipe { to { clip-path: inset(0 0 0 0) } }`(PvDayChart.vue scoped)——整组从左到右一笔擦入,多段 polyline、带、点、漏标同一动作,不用 pathLength,不另给 band 120 淡入。换栋:`watch(() => props.row.id, () => { swap.value = true })`,`.pdc-data.swap { opacity:0; animation: fp-fade-in var(--dur-fast) var(--ease-out) forwards }`(fp-fade-in 只有 to 帧,基态 opacity:0 必须显式写);animationend 后类摘掉,KeepAlive 重插找不到动画类不重播;首挂时 swap=false 不叠。换期:瞬变。segs 为空的栋:g 仍存在,动画照常结束,不会卡 first。
- **属性**:clip-path(首挂), opacity(换栋) · **时长·曲线**:320 擦入(首挂);120 淡入(换栋) / --ease-out
- **减动效**:1ms;both/forwards 停终态;CSS 动画在 document.hidden 时冻结,回前台到终态不会卡
- **落点**:`frontend/src/views/analysis/PvDayChart.vue:163-218`、`frontend/src/views/analysis/PvDayChart.vue:255-256`、`frontend/src/views/analysis/PvMeterAnaView.vue:989-993`、`frontend/src/styles/motion.css:18-20`、`frontend/src/views/analysis/pvMeterAna.logic.ts:689-690`
- **现状**:零动效;polyline 是 `v-for segs` 多段(:216);整图硬换;PvDayChart 同一实例跨换栋(v-if=selRow 无 :key)
- **为什么**:六位评审指出 svg 级 @animationend.once 会被 120ms 子动画先消费、描线在 1/3 处跳满;pathLength 逐段并行不是一笔;数据组常驻 animation 会在 KeepAlive 回签重播。一个 g、一条 clip-path、.self 守卫三件事一起解决,fp-draw 废弃。

### [C6-18] PvDots / PvSlope ×2 / PvSeasonRows 的选中与悬停换色
- **类别**:分析屏图表 · **触发**:sel-name / selId 变 / hover · **频次**:几十次/天
- **目的**:焦点蓝只属于选中那栋(PV-SPEC §06.7),焦点迁移用颜色过渡而非位移;三张 L2 SVG 图与队列行同一 120ms
- **动什么**:PvDots `.dot, .stem`、PvSlope `g .seg, g .lb`(PvSlope 的组没有 .row 类)、PvSeasonRows `.ln, .pt` 加 `transition: fill var(--dur-fast) var(--ease-standard), stroke var(--dur-fast) var(--ease-standard), stroke-width var(--dur-fast) var(--ease-standard)`;.nm 字重瞬变;PvDots 选中点 r 4→5 瞬变(属性);`.pt.hollow` fill:none 不可插值 → 瞬变,可接受。PvSlope hover `g.on` 是指针驱动:`@media (hover:hover) and (pointer:fine) { g.on:not(.sel) .seg, g.on:not(.sel) .lb { transition-duration: 0ms } }`——进入瞬时、离开仍 120,13 条 12px 命中区扫过时不留几条同时亮的拖尾。首绘随容器硬切,不逐行错峰、不描线、不长杆。
- **属性**:fill, stroke, stroke-width · **时长·曲线**:120ms(--dur-fast);PvSlope hover 进入 0 / --ease-standard
- **减动效**:1ms
- **落点**:`frontend/src/views/analysis/PvDots.vue:69-102`、`frontend/src/views/analysis/PvSlope.vue:86-126`、`frontend/src/views/analysis/PvSeasonRows.vue:180-197`
- **现状**:三者 .sel/.on 规则纯 CSS 硬切;全仓只有 PvQueue.vue:231 有 transition
- **为什么**:13 栋无栋色,焦点蓝只有一支,它在屏上「走」。原稿 PvSeasonRows 引用 :139-150 是模板,样式在 :180-197。

### [C6-19] AnaBarRow .ak-bar-fill(Expense Top7 / FinCashflow 收缴率 / FinPnl 占比)+ TenantPortfolioView 直接用类的一处
- **类别**:分析屏图表 · **触发**:换期重算 · **频次**:几十次/天
- **目的**:存量 width .7s:布局属性,时长不在三档
- **动什么**:ana.css:55 → `.ak-bar-fill { height:100%; width:100%; border-radius:4px; clip-path: inset(0 calc(100% - var(--pct, 0%)) 0 0 round 4px); transition: clip-path var(--dur-base) var(--ease-standard) }`(**round 4px 必写**,否则右端被切成方口、圆角端头消失;两端 inset() 同带 round 才可插值);AnaBarRow.vue:29 内联改 `{ '--pct': wPct + '%', background: fill }`(单位必带);TenantPortfolioView.vue:332 同步改 `'--pct'`(它今天内联 width、不走 AnaBarRow,不改会变成 inset(0 100%) 整条不可见)。目标线 .ak-bar-target 不动。wPct=0 → inset(0 100% …) 渲染为空,与今天 width:0 等价。
- **属性**:clip-path · **时长·曲线**:200ms(--dur-base,原则 1 例外) / --ease-standard
- **减动效**:1ms
- **落点**:`frontend/src/components/ana/ana.css:53-56`、`frontend/src/components/ana/AnaBarRow.vue:27-30`、`frontend/src/views/analysis/TenantPortfolioView.vue:332`、`frontend/src/views/analysis/ExpenseView.vue:226`、`frontend/src/views/analysis/FinCashflowView.vue:224`、`frontend/src/views/analysis/FinPnlView.vue:282`
- **现状**:ana.css:55 `transition:width .7s var(--ease-standard)`;AnaBarRow.vue:29 内联 width;三处调用 key 均为实体键(label/ym/name),无跨实体形变
- **为什么**:.7s 出自 0ba634d,52e1e8f 只令牌化缓动;一位评审主张只改 .7s→令牌保留 width——取 clip-path 让原则 3 干净;录入层 BuildingCard .3s 不在范围。

### [C6-20] AnaKpiTile ×15 组、.pma-b0 L0 巡检卡、56×20 迷你线、AnaSpark、AnaBullet、PvQualityGrid、AnaTrend 十字线
- **类别**:分析屏图表 · **触发**:换期 / 首绘 / pointermove · **频次**:几十次/天 / 连续
- **目的**:数字是被读的,不是被看的;指针驱动 0ms
- **动什么**:无动效:值瞬变、迷你线 d 瞬变、bullet rect 瞬变、日历格瞬变、十字线 0ms 跟手。首绘随容器(.anx-kpis min-height 94 已兜位移;ParkEnergy/Park 空数组期改常驻 '—' 瓦片,见 C6-01)。可选:`.pma-b0 { transition: border-left-color var(--dur-fast) var(--ease-standard) } .pma-b0 .big { transition: color var(--dur-fast) var(--ease-standard) }`——.quiet 同时改 :1397 左条色与 :1405 大数色,两处都写,否则数字淡、左条跳。
- **属性**:—(可选 color / border-left-color) · **时长·曲线**:0 / —
- **减动效**:—
- **落点**:`frontend/src/components/ana/AnaKpiTile.vue:24-47`、`frontend/src/views/analysis/PvMeterAnaView.vue:951`、`frontend/src/views/analysis/PvMeterAnaView.vue:1397-1405`、`frontend/src/views/analysis/AnaShell.vue:221`、`frontend/src/components/ana/AnaTrend.vue:70-73`、`frontend/src/views/analysis/PvQualityGrid.vue:262-272`、`frontend/src/components/ana/AnaBullet.vue:31-39`
- **现状**:已零动效;ParkEnergy/Park kpis 加载中为空
- **为什么**:count-up、365 格扫出、杆长出全部被「数据不为风格而动」杀掉。

### [C6-21] AnaEChart 首次动态 import 占位 → 图
- **类别**:分析屏图表 · **触发**:会话内第一张图 echartsBundle 到达 · **频次**:一次/会话
- **目的**:浅灰占位已定高零位移
- **动什么**:无额外淡入:ECharts 首绘本身(C6-02)就是从空到有的动作。ready 翻转不改尺寸,不触发 C6-02 的 RO 守卫。
- **属性**:— · **时长·曲线**:— / —
- **减动效**:—
- **落点**:`frontend/src/components/ana/AnaEChart.vue:134`、`frontend/src/components/ana/AnaEChart.vue:146-151`
- **现状**:.ana-echart.loading 浅灰底,ready 后硬出
- **为什么**:一次一个动的东西。


## 13. 图元语法总表

| 图元 | 首绘 enter(一屏一次;动画键读处) | 更新 update(几十次/天) | 焦点 / hover | 退出 | 键 / 落点 |
|---|---|---|---|---|---|
| 前置(全部图元) | AnaEChart.vue:132 RO 回调只在尺寸真变时 resize——否则首帧 resize 以 duration:0 payload(echarts.js:998-1003)截断一切入场 | 相位由 AnaShell provide 的屏级 entered 决定;挂载时 option 为空的图以 painted 标志判首绘 | — | — | AnaEChart.vue onMounted 第一句快照 enter,再 await import |
| bar(~38 张) | 自基线长出(BarView.js:533-547)320ms quarticOut,data.length ≤ 24 时逐 idx 错峰 min(i,12)×12ms;堆叠按类目错峰整根一起堆 | 同实体同键 200ms cubicOut 形变;新键瞬现 | stateAnimation 120(echarts.js:1935-1942) | 引擎 200ms 淡出(basicTransition.js:71-73 硬编码);系列 id 变则视图瞬时 dispose | 逐系列 animationDuration/Easing/Delay + *Update 三键 + 屏侧顶层键吸收 |
| line / area(~28 张) | clipPath 宽 0→满(LineView.js:569)320ms quarticOut——逐系列写覆盖 LineSeries.js:142 linear;符号点按 clip 比例延迟(:828-870) | polyline 200ms 形变(:604-607,按 data id 对齐);面积同步;更新分支重建 clip 走 enter 键 0 即瞬到 | 120 | 200 淡出 / 视图 dispose 瞬时 | 同上 |
| 对比虚线(cmp.mode 新增 line 系列) | — | 更新相唯一保留的入场:屏侧系列级 animationDuration:200, animationEasing:'quarticOut' → 擦入 200;主系列零抖动;name 稳定 | — | 关掉 = 视图瞬时 dispose(echarts.js:1196-1200),不淡出 | 屏侧 option(Cockpit/Expense/PnlAnalysis/ParkEnergy);FinPnl 预算 markLine 不在此列(瞬现) |
| pie / donut(8 张) | 'expansion' 顺时针展开(PieView.js:84-127)320ms,不错峰;逐系列覆盖 PieSeries.js:212 的 1000 | animationTypeUpdate 保持默认 'transition'(PieView.js:266-268);按 name 扇角 200ms;逐系列覆盖 :216 的 500 | emphasis 放大(引擎默认 scale:true)120ms 到位 | 200 淡出 | 逐系列注入 |
| scatter(8 张) | scale 0→1 + opacity(Symbol.js:157-168)320ms;≤24 点逐点错峰,365 点整体起 | 同 item name 位移 200ms;**数据项必须带 name**,否则按 rawIndex 跨实体形变;b6 换栋 = item 删(200 硬编码淡出)/ 增(0) | 选中系列换 FOCUS 色 | 缩放+淡出 200 | 逐系列注入;b6 若嫌幽灵可加 id 按 selId |
| gauge(2 只) | 弧/指针自 startAngle 扫入(GaugeView.js:361-375)320ms | 从旧角 200ms 到新角(:385-404 自动);detail 瞬换 | — | — | 逐系列注入 |
| sankey(1) | 整组 clip 左→右(SankeyView.js:277-281 仅首次)320ms;逐系列覆盖 SankeySeries.js:221-222 | 无(:122 removeAll 重建);换期靠 .fp-stale 遮 | adjacency 120 | — | 逐系列注入 |
| treemap(1) | 无(TreemapView.js:124-125 isInit→renderFinally) | 200ms(:217-222 读 animationDurationUpdate 与 animationEasing 非 *Update → update 相 animationEasing 注 cubicOut) | 选中栋 itemStyle 200 | — | 逐系列;reduced 须逐系列 animation:false(TreemapSeries.js:220) |
| markLine / markPoint | 开关看宿主(MarkerModel.js:85),时长回落宿主 320;markLine 缓动 **linear**(MarkLineModel.js:84 自带),markPoint quarticOut | 200 cubicOut(markLine 更新缓动无自身默认) | — | — | 零改动;Breakeven 顶层 0 经吸收到系列后 marker 同为 0 |
| markArea | 瞬到 | 瞬到 | — | — | MarkAreaModel.js:65 默认 animation:false |
| tooltip / hover 态 | — | tooltip transitionDuration 0(TooltipModel.js:76);stateAnimation {duration:120}(默认 300) | — | — | anaTheme.ts 顶层键 |
| 连续输入(Breakeven 滑杆 3 图) | 320 | 顶层 animationDurationUpdate: 0(motionize 吸收进系列与 marker) | — | — | breakeven.logic.ts:84/130/164 |
| Cockpit 主图 dataZoom | 320 | 拖动 = 引擎 payload 100(roams.js:126-135,屏侧键管不到);月步进通用 200 | — | — | 无特例 |
| 类目随期漂移的图('MM-DD'/'YYYY-MM') | 320 | 系列 id 带期键 → 视图重建瞬换,不承受旧标签 200 幽灵 | — | 瞬时 | 屏侧 id |
| PvDayChart(SVG 数据组) | `<g.pdc-data.first>` clip-path inset 100%→0 擦入 320 --ease-out(fp-wipe,组件 scoped);@animationend.self 摘类 | 换栋:swap 类 120 fp-fade-in,animationend 摘;换期瞬变;不插值 | 队列行 120 底色 | 瞬变 | PvDayChart.vue first/swap 两个 ref |
| PvDots / PvSlope ×2 / PvSeasonRows(SVG) | 随容器硬切 | 瞬变 | fill/stroke/stroke-width 120 --ease-standard;PvSlope hover 进入 0ms | 瞬变 | 各组件 scoped transition |
| AnaBarRow ×3 + TenantPortfolio 一处 | 随容器 | clip-path inset(… round 4px) 200 --ease-standard,--pct 驱动 | — | — | ana.css:55 + 内联 --pct |
| KPI 瓦片 / L0 大数 / 迷你线 / AnaSpark / AnaBullet / PvQualityGrid | 随容器 | 瞬变(.pma-b0 .quiet 可选 color 120) | — | — | 无 |
| AnaTrend 十字线 | — | 0ms 跟手 | — | — | 无 |
| 离屏 / document.hidden 的图 | 该次 setOption 顶层+逐系列 animation:false 瞬到,stateAnimation 不动 | 同 | 120 保留 | — | motionize visible 参数 |
| S 档 SVGRenderer | 200 无错峰 | animationDurationUpdate 0 | 120 | 删除仍 200(可忽略) | motionize isS 分支 |
| 减动效(全部) | 顶层 + 逐系列 animation:false | 同 | stateAnimation 0 | 瞬变(连 200 淡出也关) | motionize reduced 分支 |



## 14. 明确不做(全 28 条)

- 登录→外壳反向破晓遮罩(C4-01:.fp-stage::before 黑遮罩 320ms 淡出 + ui.fromLogin + fp-fade-out): 评审 KILL,证据核实成立:登录页提交按钮在 400-500px 白卡里(LoginView.vue:481-486 .lg-panel background:#fff),用户视线所在处本是白→白无切口;遮罩让白卡先闪成 #060a13 再 320ms 亮回,两刀代替一刀,还盖住落地骨架 320ms;/change-password 分支不挂外壳,一次性标志泄漏到之后无关的外壳挂载上;≈250B 进 index 逼预算签字。C4-02 的按钮 loading 态是登录后唯一且足够的反馈。
- --press-dim = brightness(0.94) 全站按压 filter: 透明底控件(borderless Button/IconButton、IconRail、SidebarNav 行、TabStrip 非激活签、段控非选中、PvQueue 行)上只压暗文字 6%,触屏/键盘无 hover 时零反馈;filter 新建层叠上下文劫持 absolute/fixed 子孙。改为 :active 底色变量换一档 + transition-duration:0(C2-01~05),零新令牌。
- PvDayChart fp-draw 描线(pathLength=1 + stroke-dashoffset)与 band/ctr/edge 120 淡入: 折线是按漏抄断开的多段 polyline,逐段 pathLength 并行描不是一笔;svg 级 animationend.once 会被 120ms 子动画先消费,线在 1/3 处跳满;两件事叠着动违原则 7。改为数据组一次 clip-path 擦入(C6-17)。
- 首进屏 .av2-grid 200ms 淡入 + animationend 摘类;AnaShell 通用壳做屏专属骨架: 淡入与各图 320 首绘叠成两个动的东西,animationend 会被子动画冒泡提前摘掉;AnaShell 不知道 19 屏版式。改为删 !loaded 门 + 屏内骨架硬切(与 DataHome C4-03 同款,C6-01)。
- 自绘导航条 .fp-nav-bar 改 translateX + 120 淡入: FPLoadBar 已是同规格的 2px translateX 进度线且自带 reduced 呼吸;再养一条是重复实现;淡入过了 200ms 门没有必要且 250ms 导航会卸掉半淡的条。删自绘条换 FPLoadBar(C1-01)。
- Cockpit 主图 animationDurationUpdate:120 拖动特例: dataZoom 拖动由引擎 roams.js:126-135 每次 dispatch 自带 duration:100 payload(最高优先),屏侧键管不到;月步进走通用 200 即可。
- AnaEChart morph prop / 屏侧 sectionSwitched / entrancePhase(pathname) 1s 窗 / 每张图手写 :entrance: AnaShell provide 的屏级 entered + painted 标志一处覆盖段控、粒度、hasB34、lab、AnomalyView 等全部重挂路径;类目漂移幽灵由既有系列 id 机制解决(C6-16),不加 prop。
- ECharts 首绘错峰不限长度(365 根柱 / 365 残差点): cap 12 后前 12 根涟漪、其余 353 根在 144ms 同帧砸下是一次性首绘里最显眼的 glitch;错峰只给 data.length ≤ 24。
- 路由切换内容区 crossfade / 新屏根节点淡入: 页签与面板 100+/天;KeepAlive 单棵树做不了并存过渡,重插 DOM 重启根节点 animation。新实例首帧已是骨架。
- Segmented / .anx-seg / TabStrip 的滑动指示条(含 --ease-spring): 几十/天与 100+/天档;需 JS 量宽 + ResizeObserver,与 9ac7f37「hover 回归 CSS」相悖;120ms 药丸换底在使用中不可区分。
- 按钮 :active scale(.97) / translateY(1px): 32px 文字按钮缩放让字形亚像素抖动;底色换档在 0ms 同样确认了按下。LoginView 提交钮的 translateY 是登录页专属。
- KPI 数字 count-up、L0 26px 大数滚动、gauge detail valueAnimation: 320ms 内屏幕显示的是从未存在过的数;管理层扫读 KPI 就是在读那个数;首绘正是第一眼读数。
- PvQueue 换栋时 PvDayChart 两条线插值 / 描线重画 / 灰色幻影旧线: 每栋量程自算,中间帧是两栋比值加权平均,假数据;换栋几十次/天,让用户等线画完才能读。焦点迁移由 120 数据组淡入 + 队列行底色承担。
- 选中驱动的兄弟图给稳定 id 让不同实体之间形变(b3 id:'sel'、ParkEnergy board、FinPnl subject、TenantEnergy tenant): 不同实体之间的形变是假中间数据;name 已随实体变,DataDiffer 自然旧删新增。抽屉 b9/b10/b11 与 AnomalyView 反而要加带序号的 id 阻止跨实体形变(C6-16)。
- PvQueue 组体 / SidebarNav 子树 展开高度动画或淡入: height 是布局属性;用户主动推开内容规范容许瞬变。
- 登录后外壳接力入场(轨 → 页签 → 内容错峰)与两卡先后上浮: 接力 ≥500ms,用户登录后要立刻点东西;连单张遮罩也已否,一次交互一个动的东西。
- FPDrawer / FPSideDrawer / Select / Popover / 命令面板 退场动画: Transition 禁令(FPSideDrawer.vue:34-36);CSS 退场需延迟卸载 = JS 计时器 = 同一失败模式。
- ECharts universalTransition: 未注册(echartsBundle.ts:42-47),需新 use 项吃 echarts 预算;它做跨系列/跨形态 morph,本仓没有这种切换。
- 告警数字脉冲 / 红黄灯呼吸 / 超阈值 markPoint 闪烁: PV-ANALYSIS-SPEC §05 屏不下判词;无限循环动画在 reduced-motion 下还要另开例外。
- 换期 / 段控切档 / 开抽屉时重播图表入场(今天的实际行为,且被 RO 截断): 几十次/天 × 1000ms;LAYOUT-STABILITY §7.1 明令换期内容不动。更新路径 animationDuration:0 + 屏级 entered 直接消灭。
- PvQualityGrid 365 格逐列扫出、PvDots 茎 / PvSeasonRows 行 逐行错峰入场、PvSlope 右标签延后出现: 密集矩阵和小倍数是被扫读的数据;错峰推迟阅读;CSS 错峰延迟不受全局 1ms 压制,还得另写归零规则。
- 滚动触发的逐卡 reveal(IntersectionObserver): 阅读中滚动几十/天,每次滚到都「再出场」是干扰;离屏图改为「该次 setOption 不动画」,一次 getBoundingClientRect。
- 登录页破晓 / 显影重新调参、index.html 内联外壳骨架或底色: 已拍板(7736130);内联骨架不知道登录态,做不了深浅两种。
- ECharts 首绘卡片间错峰(L0 → L1 → L2 依次淡入)、卡片 hover 上浮: 一次一个动的东西;L2 在首屏 463px 之下看不见;卡片不可点,hover 抬升误导可点性。
- AnaTrend 十字线 / ECharts tooltip 的跟随缓动: 指针驱动永远 0ms;ECharts 默认 tooltip transitionDuration 0.4s 是要删的。
- AnaBarRow .ak-bar-fill 改 transform:scaleX;clip-path 不带 round: scaleX 压扁圆角端头;inset() 不带 round 4px 右端切成方口。取 inset(… round 4px)。
- 文字链 .anx-link / .pma-lk 的 color transition;TabStrip 溢出菜单 .on 行 transition: 文字链今天没有任何 hover 换色规则,.on 行在同一 handler 里随菜单关闭——没有状态变化就没有东西可过渡,死规则。
- 饼图 anaTheme 加 pie.emphasis.scale:false: TenantPortfolioView.vue:115 显式 scaleSize:4 是有意设计,改它需用户拍板;引擎默认放大改 120ms 到位即可。



## 15. 合稿决策记录

- C4-01 反向破晓 KILL 成立(评审证据核实:LoginView.vue:481-486 `.lg-panel { background:#fff }`,提交钮在白卡内;/change-password 分支不挂外壳致标志泄漏)。删 C4-01、fp-fade-out、ui.fromLogin;C4-02 登录按钮 loading 态成为登录后唯一反馈,并按评审分两个错误域(懒块 404 不得冒充密码错误)。
- 按压语法弃 filter:--press-dim 不新增。五位评审同一结论——透明底控件上 brightness 不可见。改为 :active 底色/底色变量换一档 + transition-duration:0,松开随既有 background 120 回弹;深底 filled/danger 用既有 --control-solid-hover,不引入 opacity .85 字面值。内联 transition(Segmented.vue:92-93、SidebarNav ROW_BASE/:253)必须迁到样式表,否则 :active 的 0ms 永远输。
- C1-01 导航条:复用 FPLoadBar(评审 1 STEAL),删自绘 .fp-nav-bar 与 motion.css:66-69,不加淡入;useDeferredFlag 传 storeToRefs(ui).navigating(签名是 Ref);reduced 下自动得到呼吸,依赖 §2 FPLoadBar !important 修复。
- C1-02 取「全 124」(两位评审)而非「全 42」(一位):激活标签永远可读 > 塞下 19 个图标签;溢出菜单本就为拥挤准备。.on 字重不动(flex-basis 0 下内容宽不参与分配)。
- C2-03 段控 .on 字重变化删除,尽管一位评审指出纯 CJK 标签 advance 不随字重变、PV-SPEC §06 保留字重通道:取删——三份复制品向 DS Segmented 契约及其测试(Segmented.spec.ts:20-26)对齐,PV-SPEC 字重通道针对图内状态非段控;未来拉丁/数字标签不留隐患。
- DUR.update 保持 200 而非 120(三处评审主张 120,两处主张明写例外):120 短到读不出「哪根动了」,且引擎删除淡出硬编码 200(basicTransition.js:71),形变 120 会与淡出错拍。原则 1 明写这一条例外;AnaBarRow clip-path 同为 200。换期频次改称「几十次/天」。
- 类目随期漂移('MM-DD'/'YYYY-MM')的图:旧标签 200 幽灵淡出叠在新柱上是真问题(评审 charts 2);不加 morph prop,用既有系列 id 机制——id 带期键 → 视图重建瞬换(echarts.js:1196-1200 dispose 瞬时)。与 C6-16 实体规则合并成一条。
- 首绘相位改屏级:AnaShell `provide('anaEntered')`,AnaEChart 在 await import 之前同步快照 `enter = props.entrance ?? !entered.value`,nextTick 后置真;加 painted 标志让「挂载时 option 为空、数据随后到」的图仍走首绘。替掉 sectionSwitched、entrancePhase、逐图 :entrance。抽屉三图随之瞬现(entered 已真),开抽屉只有卡片 rise(原则 7;「偶发」对这屏抽屉不诚实)。
- AnaEChart.vue:132 ResizeObserver 首帧回调触发 chart.resize() → 以 duration:0 payload 走 update(echarts.js:998-1003,basicTransition.js:80-84 已核)→ 今天所有图入场为零。加「尺寸真变才 resize」守卫,是 C6-02~13 的硬前置;真窗口缩放截断接受。
- motionize 三项修正:① 系列合成 `{...keys, ...pick(o, ANIM_KEYS), ...stagger, ...s}` 吸收屏侧顶层显式键(Breakeven 顶层 0 才能压过注入的 200,marker 经宿主同为 0);② update 相 animationEasing 也注 cubicOut(TreemapView.js:219 更新读 animationEasing 非 *Update,已核);③ 错峰只给 data.length ≤ 24 的 bar/scatter。reduced 与 invisible 分支分开:invisible 只关 animation 不动 stateAnimation。
- Cockpit dataZoom 120 特例删除:roams.js:126-135 每次 dispatch 自带 duration:100 payload(已核),屏侧键管不到拖动;月步进走通用 200。
- markLine 首绘缓动 linear(MarkLineModel.js:84 已核)接受不改:1px 参照线 320ms linear 与 quarticOut 读不出差别,不为它加注入分支。C6-09 把 FinPnl 预算 markLine 移出对比擦入清单;对比系列关掉是视图瞬时 dispose 不是淡出。
- 饼图 emphasis 放大保持引擎默认(PieSeries.js:205-208 scale:true;TenantPortfolioView.vue:115 显式 scaleSize:4 是有意设计),措辞改「放大 120ms 到位」;不在 anaTheme 加 scale:false。
- b6 焦点点机制改写:两条 scatter 无 name → 同一 ChartView,换栋是数据项按 item name 的删(200 硬编码淡出)/增(0),不是系列瞬换;接受 200ms 幽灵,若不接受再加 id 按 selId。scatter 契约:数据项必须带 name。
- 抽屉 b9/b10/b11 系列 id 必须带序号(`b9-${i}-${station.id}`)——四条系列同 id 撞 ECharts idMap 报 Duplicated id。AnomalyView energyOption(常量 name + 共享月类目)加入实体变清单。
- C5-02 换年:① loadedYear 快照防「year 先变 → 旧 rows 配新 ticks → 先空后满」的伪入场;② .av2-grid 加 data-stale-host 才有 200 退场(全仓 0 处用,存量 9 处退场其实硬切,另起 commit 补);③ FPLoadBar 不进 stale 节点,改 AnaShell prop busy 渲染在 sticky .anx-tools,18 屏免费;④ useDeferredFlag(loading) 传 Ref。
- C6-01 首进屏:删 AnaShell.vue:192 `!loaded` 门(:184-188 注释已论证 loaded 与各屏数据无关,各屏 loading 初值 true 自出骨架);骨架→真版式硬切,不做 .av2-in;L1 骨架高按 PvQueue.vue:200-204 钉的 248。
- C6-17 PvDayChart:六位评审指出 svg 级 @animationend.once 会被 120ms 子动画先消费(描线 1/3 处跳满)、多段 polyline 逐段并行不是一笔、数据组常驻 animation 在 KeepAlive 回签重播。改为一个 `<g.pdc-data>` 一条 clip-path 擦入(fp-wipe,组件 scoped)+ swap 类 120 淡入 + @animationend.self 摘类;fp-draw 废弃。原则 4 补「监听挂自身或 .self 守卫,不用 .once,scoped 关键帧名带 hash 不按名比对」。
- C6-19:取 clip-path(两位评审)而非只改 .7s→令牌保留 width(一位):原则 3 干净;`inset(… round 4px)` 必写,TenantPortfolioView.vue:332 同步迁 --pct,否则整条不可见。
- C5-06:FPPager 面板长在触发器上方,fp-pop-in 方向反了 → 只淡不位移(fp-fade-in);transform-origin 对纯 translateY 是空操作,删。
- C5-08:animationend 守卫 `flashLabel === r.label && (flashLabel = null)`,防迟到事件清掉新目标。
- C6-18:PvSlope hover 进入 0ms(指针驱动,与十字线同则),离开仍 120;hover 规则包 @media (hover:hover) and (pointer:fine)。
- 死规则删除:C2-06 文字链 transition、C1-05 .on 行 transition(评审指出无状态变化可过渡)。
- 原则 3 措辞改「只动不触发布局的属性:transform/opacity(合成器)+ color/fill/stroke/filter/clip-path(重绘不重排)」——clip-path/stroke 是主线程重绘,原稿「合成器属性」不准;性能结论不变。
- 引用修正:finBalance.logic.ts 与 breakeven.logic.ts 在 src/views/analysis/(非 src/analysis/);pvAnaColors.ts 在 views/analysis/;.pma-lk 在 PvMeterAnaView.vue:1496-1499;PvSeasonRows 样式在 :180-197;LoginView reduced 分支 :320-321;ana.css .on 字重在 :16/:96,基态 --fw-medium(500→600)。
- index 预算:C4-01 删除(−250B)、按压规则(+≈400B)、FPLoadBar 进 index(+≈400B)减去删掉的 nav-bar CSS(−≈300B)、tokens:260(−50B)≈ +0.2~0.4KB;本地余量 0.6KB、CI 多 ~1KB。实施第 6 步前 `npm run build && node scripts/size-check.mjs` 实测,红了才按仓规签字 191→192 并在 size-check.mjs 写日期段落,不预签。
- anaEChart.spec.ts:44/59 精确 toHaveBeenCalledWith 注入后必红:改 objectContaining,补 enter 相 animationDuration 320 / update 相 0 / 顶层 animationDurationUpdate:0 → 每系列 0 三条断言;补一条 shell 测试:navigating 150ms 内翻转不渲染 .fp-lb。
- C6-06 明写:PvMeterAnaView 的 L2 八张图在首屏 463px 之下,基本永远走「离屏瞬到」,首绘编排在这屏实际是 PvDayChart 擦入 + 视口内图;不要为此补 IntersectionObserver 回放。



## 16. 令牌明细

- --ease-out(修复) = cubic-bezier(0.16, 1, 0.3, 1);删除 tokens.css:260 那行 cubic-bezier(0.23,1,0.32,1),保留 :262;:256-259 注释改成只描述存在的两条 — 同名定义两次,后声明生效,9 处引用现值即 :262;删前一行零行为变化。镜像注释按令牌名写,不按行号(删行后行号漂移)。
- --dur-fast(复用) = 120ms(tokens.css:263) — 几十次/天一切:按压释放、段控底色/阴影、pop-in、SVG 选中换色、PvDayChart 换栋淡入、ECharts stateAnimation(镜像 DUR.state)。
- --dur-base(复用) = 200ms(tokens.css:264) — 偶发与同实体形变:弹窗/抽屉入场、.fp-stale 进出、ECharts 更新形变(镜像 DUR.update,原则 1 明写例外)、对比线擦入、.ak-bar-fill clip-path。与引擎删除淡出硬编码 200(basicTransition.js:71)同拍。
- --dur-slow(复用) = 320ms(tokens.css:265) — 一屏一次:ECharts 首绘(镜像 DUR.enter)、PvDayChart 数据组首绘擦入、存量 .ak-analyst。登录→外壳遮罩已否,本轮不再用于登录。
- --dur-highlight(复用) = 2s(tokens.css:269) — 行定位高亮三处存量;FinBalanceView 的 setTimeout(2000) 改守卫 animationend 消灭双写。
- --ease-standard / --ease-both(复用) = cubic-bezier(.4,0,.2,1) / cubic-bezier(.77,0,.175,1) — 颜色 / filter / clip-path 过渡用 standard;FPLoadBar 扫动继续 both;不新增曲线。
- --press-dim(已否,不新增) = — — brightness(0.94) 在透明底控件(Button borderless、IconButton、IconRail、SidebarNav 行、TabStrip 非激活签、.anx-seg 非选中、PvQueue 行)上只压暗文字 6%,触屏/键盘无 hover 时等于零反馈;且 filter 新建层叠上下文劫持 absolute/fixed 子孙。按压改为「:active 把已有底色变量/底色换一档更深(--ink-100 / --surface-sunken / --control-solid-hover),transition-duration:0ms,松开随既有 background 120ms 回弹」,零新令牌、零 filter。
- @keyframes fp-wipe(新,PvDayChart.vue scoped <style>) = to { clip-path: inset(0 0 0 0) };元素基态 clip-path: inset(0 100% 0 0) — 取代 fp-draw:PvDayChart 折线是按漏抄断开的多段 polyline(PvDayChart.vue:216 v-for segs),pathLength=1 逐段会各自并行描;把 band/线/点/漏标包成一个 <g class=pdc-data> 做一次 clip-path 左→右擦入,一个元素一条动画、从左到右一笔,不需要 pathLength 也不需要 band 的另一条 120 淡入。只有一个消费者故放组件 scoped,animationend 用 .self 守卫不比名字;分析懒加载块,不进 index。
- @keyframes fp-fade-out(已否,不新增) = — — 随 C4-01 反向破晓遮罩一起删除。
- anaMotion.ts 镜像常量(新文件 components/ana/anaMotion.ts) = DUR = { enter: 320, update: 200, state: 120 }; EASE = { enter: 'quarticOut', update: 'cubicOut' }; STAGGER = { step: 12, cap: 12, maxN: 24 }; ANIM_KEYS = 六个 animation* 键名 — 320/200/120 按名镜像 --dur-slow/--dur-base/--dur-fast;quarticOut(zrender easing.js:32)最接近 --ease-out,cubicOut 对应 --ease-standard 收尾。错峰只给 data.length ≤ 24 的 bar/scatter(年档 365 根柱前 12 根涟漪后 353 根同帧砸下是假错峰)。ANIM_KEYS 用于把屏侧顶层显式键吸收进每个系列(Breakeven 顶层 0 才能压过注入的 200)。update 相 animationEasing 也注 cubicOut——TreemapView.js:219 更新读的是 animationEasing 而非 *Update。
- FPLoadBar reduced-motion 例外(修复,FPLoadBar.vue:50-59) = .fp-lb i { animation: fp-lb-pulse 1.6s ease-in-out infinite; animation-duration: 1.6s !important; animation-iteration-count: infinite !important; } — motion.css:49 全局 `* { animation-duration:1ms !important; animation-iteration-count:1 !important }` 把无 !important 的呼吸压成静止蓝条;scoped 选择器 (0,2,1) > `*`,同为 !important 时赢。修在组件内零 index 字节。本轮 C1-01 导航条也改用 FPLoadBar,这条修复成为它的硬前置。



---

## 附录 A. 设计过程与证据

### A.1 三种视角的设计与评审结论

| 视角 | 骨架 | 评审 1(仓库维护者) | 评审 2(B 端产品设计) | 评审 3(可视化动效) |
|---|---|---|---|---|
| 克制(Emil Kowalski) | 默认不动;频次门;0 新令牌 | **49 / 60,胜** | **49,胜** | 45 |
| 流体空间(Apple) | 逐系列注入;反向破晓;离屏跳过;稳定 id | 44 | 43 | **49,胜** |
| 图表叙事 | 最完整引擎审计;count-up;365 格扫出 | 39 | 41 | 45 |

合稿取克制的骨架 + 流体的「逐系列注入 / 离屏跳过 / hover 门控」+ 叙事的「饼图 animationTypeUpdate 必须留 transition / treemap 逐系列 animation:false / markArea 默认 false / Breakeven 0 / 段控字重位移」。

### A.2 对抗复核

24 位复核(约束 / 频次与手感 / 技术真伪三视角 × 开屏登录 / 导航 / 按压 / 切换 / ECharts / SVG / 令牌减动效 / PV 焦点八簇),186 条判定:pass 109、fix 75、kill 2。两条否决(反向破晓遮罩、fp-draw 逐段描线)均采纳;`--press-dim` filter 按压被五位复核同时否决改为底色换档;RO 首帧截断入场由复核实测发现,成为图表动效的硬前置。逐条变更见正文「复核记录」。

### A.3 调查报告(要点已并入正文)

- ECharts 6.1.0 动画事实:`globalDefault.js:113-122` 默认值;`basicTransition.js:51-144` enter/update 三对键与 payload 优先级;`echarts.js:1156-1180` notMerge 复用 ChartView;`SeriesData.js:918-982` diff key = 类目标签;各系列 defaultOption 行号。
- 交互面盘点:DS 层零 `:active`;「开有入场、关无退场」是仓内惯例;内联 transition 三处;阴影从不过渡;令牌外硬编码时长 14 处清单。
- 导航时间线:冷启白屏 → 整壳硬切;登录 → 外壳 v-if 同帧换树;回缓存签零动效(正确);首进屏两个转圈接力;换期整棵卸载。
- 图表清单:65/9/4/16;27 张有点击;12 屏跟随 usePeriod;对比模式影响 5 张;抽屉 3 张每次开重挂。
- 约束摘要:LAYOUT-STABILITY §1/§7、DESIGN-FIDELITY §6-8、UI-OVERLAY、RESPONSIVE §5-7、PV-ANALYSIS §05-06、UI-CONSISTENCY;`<Transition>` 禁令的失败机制与两个安全例外;size-check 191/3900 与 token-check 只查未定义 var();四个已拍板的历史动效决定(7736130 / 3c4cd1e / 9ac7f37 / 52e1e8f)。

## 附录 B. 设计画布

画布地址:https://claude.ai/code/artifact/95ef8d6b-b71e-4b85-81fa-84ecdc47f25d

画板(每块 = 一类动效,含可重播演示、0-320ms 时间线尺、落点表、编号标注):
总览 · 开屏出场 · 登录完进入 · 页面切换 · 按钮点击 · 切换动效 · 图表图元语法 · 首进分析屏编排 · 数据更新与焦点故事 · SVG 与 DOM 图。
源文件:`_design/motion/*.dc.html` + `canvas.json`。
