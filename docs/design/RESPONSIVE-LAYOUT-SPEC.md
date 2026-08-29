# 响应式布局规范（RESPONSIVE-LAYOUT-SPEC）v1

> 2026-08-29 立。起因：用户报告「屏幕缩小侧边栏直接消失」，并要求全尺寸响应式 +
> 独立的手机浏览器布局。
>
> 前史：2026-07-12 responsive-shrink spec 定了三级缩窗（≤1280 侧栏自动收轨 /
> 分析层中间档 / <960 全局硬地板出文档横滚），并把移动端明确判为 YAGNI。
> 本规范**保留其「分级重排、绝不缩放」原则，取代其 T3 硬地板、推翻其移动端 YAGNI**。
> 设计稿（外壳四态线框 + 手机版五屏）见当日发布的「Factory Park 响应式设计稿」Artifact。

## 1. 断点体系：四档，三个值

全站只允许三个断点值。桌面优先 `max-width` 写法；**宽档规则写在窄档之前**，
靠层叠覆盖（ana.css 1280→1100 的既有顺序即此规则的先例）。

| 档 | 视口宽 | 一句话 |
|---|---|---|
| **XL** 宽桌面 | > 1280 | 现状，零差异验收 |
| **L** 窄桌面 | 961–1280 | 侧栏收轨（现状）；手动展开改浮层 |
| **M** 平板/窄窗 | 601–960 | 拆全局地板；外壳收纳；未迁移屏内部横滚 |
| **S** 手机 | ≤ 600 | 独立手机外壳（§4） |

```css
/* 授权写法：字面量 + 档注释。CSS 自定义属性进不了 @media，这是语言限制不是偷懒 */
@media (max-width: 1280px) { /* L↓ */ }
@media (max-width: 960px)  { /* M↓ */ }
@media (max-width: 600px)  { /* S  */ }
```

- JS/TS 侧唯一事实源：`src/styles/breakpoints.ts` 导出 `BP = { s: 600, m: 960, l: 1280 }`；
  `src/composables/useViewport.ts` 基于 matchMedia 暴露响应式 `tier`（'xl'|'l'|'m'|'s'）与
  `isTouch`。matchMedia 必须带 jsdom/SSR guard（照抄 stores/ui.ts:19 的写法）并进 vitest 口径。
- **除 600/960/1280 外禁止新增断点值**。分析层既有 1100（av2 全堆叠 / mx-body 单列）、
  ParkView 900、ContractDrawer 880、LoginView 1080/560 属存量豁免，不新增、不模仿。
- 触屏规则不按视口、按输入能力：`@media (hover: none)`（§6）。

## 2. 与既有铁律的关系（先读这节再动手）

| 条款 | 处置 | 说明 |
|---|---|---|
| 零布局位移（LAYOUT-STABILITY §1） | **保留** | 新增边界裁定见 §7 |
| z-index 七级阶梯（DESIGN-FIDELITY §八） | **保留** | 新浮层落点见 §3/§4 |
| 侧栏自动收放口径（ui.spec.ts 六条） | **保留** | 自动不写 localStorage，手动才是偏好，延伸到全部新档 |
| 分级重排绝不缩放（responsive-shrink §0） | **保留** | 四档全重排，禁 transform 缩放 |
| T3 硬地板 `.fp-stage min-width:960px` | **取代** | 地板下沉为屏级 `.fp-legacy-floor`（§8） |
| 移动端 YAGNI（responsive-shrink §0.4） | **推翻** | 2026-08-29 用户需求即推翻理由 |
| 居中弹卡（DESIGN-FIDELITY §七，2026-07-02 用户决策） | **仅 S 档修订** | ≤600 全屏 sheet（§4.4）；M 档以上仍居中弹卡 |
| 工具栏单行（LIST-PAGE-SPEC §2） | **M/S 修订** | 允许两行，行组成按档静态确定，不随内容抖动 |
| 高度驱动布局链/整页无滚动条（LIST-PAGE-SPEC §3） | **仅 S 档修订** | S 档改内容驱动自然流（§5.1），「常规窗口无滚动条」判据在 S 档不适用 |
| PRESENCE §03 头像组定宽 | **L 以下修订** | 收成「+N」计数徽记，仍定宽不挪版 |
| useFitRows 定高翻页（LIST-PAGE-SPEC §6） | **仅 S 档停用** | 手机自然流 + 每页固定 10（§5.1） |

## 3. 外壳分档行为

### 3.1 XL（>1280）——一个像素不动

图标轨 66 + 面板 234 内联 + 主卡；stage padding/gap 12；内容 padding 24。
验收：1440 与现状零差异、无横滚。

### 3.2 L（961–1280）——侧栏改浮层

- 自动收起沿用 ui.ts 现状（matchMedia 1280，六条测试口径不动）。
- **变更**：收起状态下手动展开 = 面板作浮层贴轨盖在内容上（`--z-popover` 60，
  无遮罩，点外关 + Esc 关，UI-OVERLAY-SPEC 的 capture mousedown 写法）。
  理由：现状内联展开在 1000px 视口把主卡压到 663px，比不展开更糟——
  展开是临时「看一眼导航」，不是常驻布局。
- **状态模型要补一个转移**：浮层的「点外关/Esc 关」是用户触发但**不是偏好**
  （临时看一眼），不得走 `toggleSidebar`（它无条件写 `fp-app-sb`，会污染用户的
  XL 偏好）。ui.ts 新增不落盘的 `closeTransient()`，并**补第七条测试**锁住
  「transient 关不写 localStorage」——「六条口径不动」指旧口径保留，不是 ui.ts 免改。
- 实现暗礁（查证过的，别踩）：①浮层面板不能定位在 `.fp-nav-card` 内——
  会被它的 `overflow:hidden`（AppShell.vue）裁掉，挂 stage 层或 Teleport；
  ②Toolbar 的折叠钮在浮层外，capture mousedown 先关面板、click 再 toggle 会重开
  （开关竞态）——触发钮要排除在点外判定之外（ds/Popover 的 trigger-in-wrap 写法）。
- Toolbar：FPPresenceBar 收成「+N」徽记（定宽、人数变化不挪版，PRESENCE 口径延续）。

### 3.3 M（601–960）——拆地板档

- `.fp-stage` 去掉 `min-width:960px`（min-width:0）；stage padding/gap 12→8；
  `.fp-content` padding 24→16，并加 `overflow-x:auto`（承接 §8 屏级地板的横滚）。
- 图标轨、TabStrip 保留。侧栏同 L 档浮层。
- Toolbar 收纳：搜索按钮 200px→40px 图标钮（Ctrl K 提示藏于 title）；
  面包屑只留屏名段（层名由图标轨高亮承担）；主题/操作记录/铃铛图标钮保留，
  铃铛红点机制不动。
- index.html 的 `body overflow-x:auto` 保留（存量兜底，正常情况下不再触发）。

### 3.4 S（≤600）——独立手机外壳

见 §4。

### 3.5 平板裁定：不另立第五档

平板不是新档——**纵向（768 / 810 / 834）落 M，横向（1024 / 1112 / 1180）落 L**，
形态完全按所落档执行，再叠加 §6 触屏规则（`hover:none` 自动命中 iPad）。
明确四点，免得实现时各猜各的：

- 页签条在平板保留（M 档口径）；关闭/固定钮按 §6 常显，双击固定在触屏失效，
  Pin 钮即唯一入口。
- 弹卡保持居中（M 档以上不全屏），`width:min(W, 92vw)`——账册族宽弹窗在 768
  上内滚可视宽约 706px，**平板可编辑**；「建议桌面端操作」提示只在 S 档出现。
- iPadOS 外接鼠标/触控板时 `hover:hover` 恢复，常显钮可回 hover 显形——
  由媒体查询自动跟随，**禁止 UA 嗅探**。
- 旋屏 = 跨档切换，属 §7 视口变化豁免；但两档间**数据与草稿状态必须无损**
  ——外壳只切形态，路由与 KeepAlive 缓存不因档位切换卸载。

## 4. 手机外壳（S 档）

放弃「画布上浮卡片」的桌面隐喻：内容通栏（无 stage padding、主卡无圆角边框），
导航沉底，覆盖层全屏化。**tabs store 照常运转**（afterEach 开签、localStorage 键
fp-app-tabs/preview/recent 格式不变），回桌面时页签原样都在——手机只是不渲染 TabStrip。

### 4.1 结构

| 区 | 高度 | 内容 |
|---|---|---|
| 顶栏 | 52px + safe-area-top | 菜单钮（开导航抽屉）· 当前屏名（route.meta.page）· 搜索钮（开命令面板）· 铃铛（红点随迁） |
| 内容 | 其余，`overflow-y:auto` | padding 16px；高度基准 100dvh 不用 100vh |
| 底栏 | 56px + safe-area-bottom | ≤4 个层 tab（数据/报表/分析/系统，按 navLayers + system:view 过滤，同 IconRail 口径）；点按 = `openFresh(layer.home)` |

### 4.2 导航抽屉

左滑入 `min(320px, 85vw)`，带遮罩，`--z-modal` 300（带遮罩即模态档，
不得用 popover 档——DESIGN-FIDELITY §八原话）。内容自上而下：

1. 层切换段（4 层，同 IconRail 过滤口径）
2. 当前层 sections 列表（fpNav 同一数据源，与桌面 SidebarPanel 1:1）
3. 「最近打开」= tabs.recent（8 条）——页签模型在手机的化身
4. 底部账号段：头像 + 账号名 + 角色徽记 + **退出登录**（照抄 IconRail 头像
   Popover 的内容）。S 档不渲染 IconRail，这是全站唯一的账号菜单——漏掉它
   手机用户就无法退出登录。

导航语义分开走，与桌面各自的同类入口保持一致：
- 层切换段 / sections 条目 = `openFresh` + push（与 IconRail/SidebarPanel 同义，
  全新状态）；
- **「最近打开」= `open` + push**（与 CommandPalette 的 recent 同义，恢复
  KeepAlive 现场）。它既然是页签的化身就要继承页签的恢复语义——走 openFresh
  会 epoch++ 把用户填到一半的表单丢掉，而同一动作在桌面命令面板是恢复现场。

点条目后关抽屉。

### 4.3 命令面板

S 档全屏接管（inset:0，顶部搜索行 + 结果列表），`--z-palette` 200 不变。
kbd 提示（Ctrl K / Esc / 方向键）在 `hover:none` 下隐藏。

### 4.4 覆盖层全屏化

S 档 FPDrawer / FpImportModal / **FPSideDrawer**（LAYOUT-STABILITY §6 钦定的
告警抽屉标准件，告警 chip 会随工具栏进入 S 档，390px 上必须有裁定）渲染为
全屏 sheet：头 48px（标题 + ✕）、体 flex:1 内滚、脚部操作条贴底 + safe-area。
这是对「居中弹卡」决策的**档内修订**，M 档以上一律仍居中弹卡。实现落在
组件内部按档切换，**调用方零改动**。SaveConfirmDialog（--z-confirm 350）
保持居中小卡，手机上可容忍、不改。
账册族宽弹窗（PayBook/CoefBook/CompanyBook 1000–1080px）见 §5.3。

### 4.5 反馈层

FPToast/网络错误 toast 底部偏移 = 56px 底栏 + safe-area，不被底栏遮住。

## 5. 六类布局模式 × 档规则

全站 49 屏已收敛为六类。**新功能屏先认领模式，再按行取规则**；
认领不了的，在 PR 里说明并把新模式补进本节——不逐屏发明。

### 5.1 mx 列表页（租户/楼栋/合同/系统用户；单一事实源 mx-list.css）

- XL/L：现状；≤1100 单列（存量豁免断点）。
- M：工具栏允许两行（§2 修订）；搜索框 230px→`flex:1 1 160px`。
- S：**行转卡片列**——每行一张定高 72px 卡：主字段 + ≤2 个次级字段 + 状态胶囊，
  点卡 = 点行。fitRows 停用、每页固定 10 条，FPPager 保留在卡列底部。
  KPI 轨收成横向滑动的胶囊行。
- **S 档必须拆掉高度驱动布局链**（10×72=720px 卡列塞不进 `flex:1`+
  `overflow:hidden` 的定高链，溢出的卡会被静默裁掉、分页器够不着）,三件一套：
  ①页面根 `height:100%` 改自然高——它现在是各 View 的**内联 style**,媒体查询
  盖不住内联,配套动作是把它收编成类（这五处内联 1600px 壳同题,一起收）,
  **根节点逐屏要动,这一半做不到零改动**；②`.mx-listcard` 去掉 flex:1 与
  min-height:440；③`.mx-tablewrap` 放开 overflow。卡片模板本身做进
  mx-list.css / FPSortableTable 的 S 档分支,不逐屏手写。

### 5.2 分析 av2 栅格(18 屏) + AnaShell

- 1280/1100 两档保留原顺序（宽先窄后，不得插队打乱层叠）。
- S：`.av2-kpis` 定两列；AnaEChart 图高降档 **xl/lg→260、md→220、sm→180、xs→150**，
  「同一行卡等高」约束随单列堆叠自然消失，但降档仍整组同改;
  echarts 动态 import 与 ResizeObserver 契约不动；S 档换 SVGRenderer
  （AnaEChart 注释预留的出路），不降 DPR——注意该注释同时写明要动
  echartsBundle 的渲染器装配，这是点名的配套改动。
- `.anx-tools` M/S 档收纳进两行内；`@media print` 行为不得被新断点样式覆盖。

### 5.3 宽台账 / 报表表（FPLedgerTable 族、S10、利润表/科目余额表…）

- 各档一律内部横滚（现状），**列宽常量与 colgroup 不因档位变**。
- S：查看优先——sticky 只留**一根首列** + 表头（桌面多根 sticky 列在 390px
  会占满视口：S10 左右 sticky 316px、PnlTable 370px 是实测教训）；
  重编辑屏（账册族弹窗、批量参数、台账录入）给「建议在桌面端操作」的
  常驻提示行（预留位，非流内条），查看不拦、编辑入口不藏。
- `.fin-two`（资产负债表双表并排）≤960 降单列。

### 5.4 colgroup 定宽表（催缴单/计费参数/充电桩…）

**列永不响应式增删**——colgroup 少一根全表串位是修过的事故类（S20 月租金 52px），
断点改列结构等于把这类事故做成常态。窄了就横滚：外框必须显式 `overflow-x:auto`，
现在缺的（部分账册弹窗）补上。

### 5.5 卡片墙（楼栋/导入中心/功能门）

auto-fill 天然自适应；S 档 minmax 改 `minmax(min(100%, 248px), 1fr)` 防
容器比 min 值还窄时溢出。

### 5.6 左轨 workbench（台账 208px / 附表10 200px）

- M：左轨收成顶部横向选择器（chips 或 Select，定高，选中项常显）。
- S：同 M，选择器点开为全屏列表 sheet。

## 6. 触屏与 iOS（跨档，按 `hover:none` 生效）

1. **hover 显形一律落地**：`opacity:0` 悬停显形的控件（6 张年账表行按钮、
   卡片跳转钮、页签关闭/固定钮、FPLedgerTable .ch）在 `hover:none` 下常显
   （可半透明弱化，不可不可达）。
2. **触达面积**：主操作 ≥44×44；行内次级操作 ≥36×36（现 24×24 的扩热区，
   视觉尺寸可不变，热区用 padding/伪元素扩）。
3. **双击不当唯一入口**：页签双击固定在触屏失效——Pin 钮常显即兜底。
4. **title 不是信息载体**：迁移屏中仅存于 title 的说明须给可见等价物
   （胶囊/说明行/点按弹层）；未迁移屏不回填（496 处不做考古式清账）。
5. **iOS 三件套**：
   - S 档输入控件 font-size 16px：新令牌 `--fs-input-m: 16px` 进 tokens.css
     （过 token-check），仅 S 档媒体块引用。**不加 maximum-scale**——
     禁缩放换不聚焦缩放是拿无障碍换观感，不做。
   - 固定条（顶栏/底栏/toast/全屏 sheet 脚）用 `env(safe-area-inset-*)`；
     高度基准 `100dvh`；PlaceholderView 的 100vh 顺手改掉。
   - `backdrop-filter` 一律补 `-webkit-backdrop-filter`（iOS ≤17 无前缀不识别，
     现状 15 处遮罩在 iOS 上本来就没模糊）。
6. 浮层点外关闭的 capture mousedown 在触屏由合成 mouse 事件触发，行为保持；
   若实测滚动误关，修在 ds/Popover 一处，不逐屏打补丁。

## 7. 与零位移铁律的边界裁定

**视口变化（拖窗、旋屏、软键盘、地址栏伸缩）引起的确定性重排，不算违反
LAYOUT-STABILITY §1**——那条铁律管的是「用户的一次交互不得挪动已渲染内容」，
改窗口大小本身就是要求重排。但：

- 同一视口宽度内的一切交互，在**每一档各自**零位移。骨架、预留位、
  三态定宽按钮等既有机制按档各自成立。
- 跨档切换必须确定：同一宽度进出多次结果一致，禁止在断点边缘抖动
  （必要时档判定加 1px 滞回，但先别做——ponytail：拖窗恰好停在 960px 上的
  概率不值一个机制）。
- useFitRows 在 M 档以上照旧；软键盘引起的高度骤变若实测导致 pageSize 跳变，
  修法是「高度变化 <120px 不重算」，修在 useFitRows 一处。

## 8. 迁移机制：屏级地板

外壳先行、屏分批迁移，中间态必须始终可用：

1. P1 外壳落地时，**全部业务屏**根节点挂 `.fp-legacy-floor`：

   ```css
   /* ⚠ 必须限定 M↓。L/XL 档铬边更宽(内容区 961–1100 视口下只有 ~773–807px)，
      无条件挂 floor 会让今天不横滚的 L 档区间开始横滚——零差异回归，
      且 §9 四宽(1180/768)恰好夹不住这个波段。 */
   @media (max-width: 960px) {
     .fp-content > :first-child:not(.fp-fluid) { min-width: 800px; }
   }
   ```

   实现落点是 base.css 的全局选择器而非逐屏挂类（P1 实测定稿）：
   - 用 `> :first-child` 而不是 `> *`：LedgerView 等屏的根是多节点 Fragment，
     主体后面跟着 `position:fixed` 的弹窗遮罩兄弟节点，`> *` 会给遮罩套上
     800px 最小宽、把居中弹卡在 390px 视口挤出屏；主体恒为首个元素，
     fixed 兄弟天然豁免。⚠ 由此得出一条屏结构约束：**屏根 Fragment 的首个
     元素必须是主体**——在主体前插流内兄弟节点会让它丢地板。
   - 迁移完的屏在根元素加 `.fp-fluid` 类退出地板（= 通过 §9 验收的标志）。

   **800 的来历（逐项算，不是拍的）**：存量屏是在旧 T3 地板下设计的，
   960 视口 · L 档铬边 = stage padding 24 + 轨 66 + 卡边框 4 + gap 12 +
   content padding 48 + 滚动条 gutter 0–34 ≈ 154–188，即内容区实测 772–806px
   ——全部存量屏已被证明在 ~800px 内容宽下成立。M 档铬边 126–160，
   960 视口内容区 800–834 ≥ 800：恰好无滚，更窄才滚。
2. 横滚发生在 `.fp-content` 内部——外壳（轨/页签/顶栏/底栏）任何档位都
   完整可用，这是与旧 T3 文档级横滚的本质区别。
3. 每按 §5 迁移完一屏，摘掉该屏的 floor。摘 floor = 该屏通过 §9 验收。
4. S 档下挂着 floor 的屏照样能看（横滚），只是不好用——好用靠迁移，不靠壳。

## 9. 验收（每个新功能屏 / 每次迁移）

- [ ] 四宽实测：**1440 / 1180 / 768 / 390**，外加 844×390 横屏与
      **961/1000（L 档下缘）**抽查——四宽恰好夹不住 961–1100 波段，
      §8 的 L 档回归就是在这里漏的；1440 与现状零差异。
- [ ] 只用 600/960/1280 断点值（§1 存量豁免除外）；宽档规则写在窄档之前。
- [ ] 认领 §5 六类模式之一并按行取规则；认领不了的补规范再合入。
- [ ] 触屏仿真过一遍（手机 390 与平板 768/1024 各一轮）：无 hover 唯一入口、
      无 <36px 触达、S 档输入 16px。
- [ ] 同档内交互零位移（noInteractionLayoutShift 门禁 + 人工核）；
      colgroup 列数未变。
- [ ] 新令牌过 token-check；vue-tsc、vitest 全绿；ui.spec.ts 六条口径不破。

## 10. 实施顺序

1. **P1 基建 + 外壳**：breakpoints.ts / useViewport / hover:none 规则；
   外壳四态（L 浮层面板 + `closeTransient` + 第七条测试、M 收纳、
   S 手机壳 + 导航抽屉 + 底栏）；FPDrawer/FpImportModal/FPSideDrawer/
   CommandPalette 的 S 档全屏分支；`.fp-legacy-floor` 全屏挂载（限 ≤960）。
   **index.html 两处配套**：viewport meta 补 `viewport-fit=cover`（没有它
   iOS 上 `env(safe-area-inset-*)` 恒为 0，§4 的 safe-area 方案整套失效）；
   S 档高度链裁定——`@media (max-width:600px)` 下 html/body/#app 高度基准
   改 `100dvh`，顶/底栏是壳内 flex 子项（不用 fixed），safe-area 由栏自身
   padding 承接（现状 body `overflow-y:hidden` + 100% 链在 iOS 地址栏收起时
   会把超出部分裁掉，dvh 链避开这个坑）。
   此阶段结束：手机上外壳与导航完整可用，业务屏横滚可看。
2. **P2 高频屏**：驾驶舱 + 分析层（底子最好）→ mx 列表页卡片化 →
   催缴单/台账查看态。每屏摘 floor。
3. **P3 长尾（2026-08-30 按 §11 调研结论修订）**：
   ①层首页优先：数据中心首页 + 报表中心（手机底栏落地第一屏，改动小）；
   ②报表查看态：三大表 + 损益附表 + 收入核对（横滚 + 首列 sticky，不做编辑适配）；
   ③数据层查看态：园区抄表 / 公共电核算 / 楼栋损耗 / 计费参数（速查）；
   ④年账六屏 + SystemRolesView：**只做查看态**（编辑态按 §11.2 荐桌面）；
   ⑤报表打印样式（打印 = 一种 media，规则同源）。
   **不再迁移**（只读兜底挂地板即可，§11.1）：导入中心、银行流水、角色权限的
   配置态。原计划的「年账/录入态卡片化」整体取消——投入换给 §11.3 的 App 阶段
   backlog。

## 11. 移动端能力分层（2026-08-30 调研定稿）

> 依据：6 赛道 20+ 同类产品调研（「移动场景设计稿」Artifact，2026-08-30）。
> 两个核心结论：**小屏编辑表格行业零先例**（SAP Fiori 设计规范明文宽表仅
> 桌面/平板；QuickBooks 官方把对账/日记账归 web；简道云明文禁移动端表格
> 批量操作）；**看细表愿意但只看不改**，前提排版可用。移动端动线的公约数
> 是「一次只碰一条记录」。

### 11.1 三层

| 层 | 覆盖 | 投入 |
|---|---|---|
| 主动做 | 驾驶舱看盘、租户/合同/楼栋单条查询、催缴单条处理（收款登记走弹窗 S 档全屏 sheet，P2 已覆盖） | 现有网页形态即可承载 |
| 只读可看 | 报表全家、分析层、台账/年账查看态、操作日志、参数速查 | 横滚 + 首列 sticky（§5.3）；编辑入口不藏，挂「建议桌面」预留位提示 |
| 明确不做 | 参数批量编辑、账册族宽弹窗、导入/流水对账、报表编制导出、系统管理配置 | 零 S 档投入，只读兜底 |

### 11.2 录入态裁定（2026-08-30 用户拍板）

台账/年账等录入态在手机上**不禁止、不隐藏、不优化**：功能照常可用、
提示荐桌面（预留位形态，LAYOUT-STABILITY §2），不再为手机编辑体验投入
任何工时。依据：「愿意录一条 ≠ 愿意改一张表」（最激进的移动做账产品
柠檬云也把复杂表格标电脑端专属）。

### 11.3 移动 App 阶段 backlog（网页版不做）

当前手机形态是**网页**，无系统级推送、离线与相机深度集成。以下推送/设备
能力驱动的流，留到真正的手机 App 立项时实现（形态设计已备好，见
「移动场景设计稿」§04，届时直接取用）：

- **抄表采集流**（楼栋→表位列表→逐项表单+拍照留证+离线暂存回传）——
  2026-08-30 拍板「先不做，进后续计划」。调研中唯一被反复验证「天然属于
  手机」的场景（摄像头/定位/离线/人在表旁，桌面全无），App 立项后优先级最高。
- **提权审批 sheet + 异常提醒处理动作**（推送驱动）——2026-08-30 拍板
  「放到有市场推出的真正手机 App 再实现」。网页版铃铛红点保留（P1 已随迁
  手机顶栏），审批操作继续走桌面。

## 12. 并行开发交接（给同仓其他分支/智能体，合并前必读）

> 响应式分支（claude/page-layout-worktree-cb3e10，PR 见 git 记录）动了大量共享
> 文件。多条分支并行开发时，**合并/变基遇到冲突按本节解，解完必须过 §12.3
> 红线**——不要用「整块保留一边」了事，那是最常见的改错方式。

### 12.1 冲突解法

- **共享高危文件**（本分支重改过，别的分支也常动）：`AppShell.vue`、`base.css`、
  `tokens.css`、`index.html`、`ana.css`、`mx-list.css`、`useFitRows.ts`、
  `FPSortableTable.vue`、`FPDrawer / FPSideDrawer / FpImportModal / CommandPalette`、
  `TabStrip.vue / Toolbar.vue`、`stores/ui.ts`。冲突原则：**两边功能都保留、
  手工合段**；样式冲突尤其如此——两个 feature 的规则几乎总能共存。
- **@media 块冲突**：层叠序恒为「宽档在前窄档在后」（1280→1100→960→600→print）；
  断点值只许 600/960/1280（§1，存量豁免见该节）；不要把两边的规则合并进同一个
  媒体条件里打乱层叠，也不要移动既有块的相对位置。
- **解冲突时绝对禁止**（每一条都会引发已修复缺陷的回归）：
  - 恢复 `.fp-stage` 的 `min-width:960px`（T3 地板已由 §8 屏级地板取代）
  - 删除/放宽 base.css 的 `.fp-content > :first-child:not(.fp-fluid)` 地板规则
  - 把 index.html 的 `body overflow-x:auto` 改回 `hidden`，或去掉
    `viewport-fit=cover` / S 档 100dvh 链
  - 增删任何表格的 `<col>`（colgroup 串位是修过的事故类）
  - 把 z-index 令牌换回字面量；或把表内 sticky 的 3/8/7 阶梯「顺手」令牌化
    （它是审计备案的例外，见 §2 表注）
  - 删掉 ui.spec.ts 的第七条测试或改动前六条口径

### 12.2 本分支立下的契约（新代码必须遵守）

- **类名契约**（跨文件协作靠它们，改名=全断）：`fp-fluid`（摘地板，屏根挂）、
  `.fp-legacy-floor` 机制（§8）、`mx-page`（列表屏根收编）、`hint-desk`
  （桌面交互话术，S 档隐藏）、`av2-core` / `av2-lead`（分析层阅读序）、
  `.lgw-s-hint` 形态的荐桌面预留位提示行。
- **机制契约**：`ui.closeTransient()` 不落盘（浮层临时关，勿改走 toggleSidebar）；
  `useFitRows` S 档固定 10 跳过测量；`FPSortableTable` S 档 `#card` 分支；
  `AnaEChart.mobilizeOption` 注入集（屏侧显式值永远优先，新图别依赖注入行为）；
  覆盖层 S 档全屏分支在组件内部（调用方零改动，别在调用方再包一层）。
- **新屏**：先认领 §5 六类模式，走 §9 验收清单；屏根 Fragment 的首个元素必须是
  主体（§8 的 :first-child 前提）。

### 12.3 合并后红线（三道门禁 + 抽查）

```bash
cd frontend && npx vue-tsc --noEmit -p tsconfig.app.json && npx vitest run && node scripts/token-check.mjs
```

全部门禁挂在 `npm run build` 里，绿了才算解完冲突；再按 §9 做四宽
（1440/1180/768/390）+ 961/1000 边界抽查。1440 与合并前零差异是硬标准。

附：`.claude/launch.json` 的 `frontend-wt`（端口 5273）是给 worktree 并行开发用的
第二前端入口——主仓 5173 被占时用它，别删。
