# 暗色模式规范（DARK-MODE-SPEC）

2026-09-19 定稿。设计稿：`../运维文档/设计稿/未实现/暗色模式-2026-09-19/`，线上画布 https://claude.ai/artifact/9JedPtffMBhFMC7BspnoX1。
7 块画板：Main / Tokens / Shell / Analysis / Kpi / Components / Mobile。**图是规格**；每个令牌的暗色值与对比度以生成脚本
`gen-画板生成脚本.mjs` 的 `darkOf(DIRS.d2)` 为准（脚本对每一对「字 × 底」断言 ≥4.5、控件边框 ≥3）。

## 1. 用户拍板（2026-09-19）

| # | 定了什么 |
|---|---|
| M1 | 底色 = **② 中性深灰**：画布 rgb(32,32,34) / 卡片 rgb(42,42,44) / 卡内浅底 rgb(50,50,52) / 浮层 rgb(58,58,61) / 主字 rgb(236,236,238) |
| M2 | KPI 卡暗色 = **(i) 同色相压暗**（四个 `--accent-*` 的暗色值见 tokens.css） |
| M3 | 「外观」默认 = **浅色** |
| M4 | 其余按稿上推荐（用户「其他按推荐来」）：暗色下实底反过来（亮底深字）；图上深色气泡用提亮一层的灰蓝 `--tip-bg`；提示条的红与全站新红统一；命令面板选中行在暗色下提亮；在线头像身份色两种模式一起压暗到白字 ≥4.5，并换掉偏紫的那个 |

## 2. 结构

- 只换颜色：字号、间距、版式一律不动。
- **全站颜色走令牌**：`styles/tokens.css` 的 `:root` 是浅色，`:root[data-theme="dark"]` 重定义颜色类令牌（已写好）。引用别的令牌的别名（`--text-primary` 等）不用重写。
- 新令牌（浅色值 = 现在写死的那个值，浅色外观不变）：`--surface-raised`、`--border-control`、`--border-control-strong`、`--scrim`、`--tip-bg`、`--toast-bg`、`--warn-bg`、`--danger-bg`、`--row-selected`、`--shadow-dialog`；KPI 稿的 `--delta-up-text`、`--delta-down-text`、`--info-text-on-tint`、`--text-muted-tint`、`--warn-text`。

## 3. 外观开关（画板 Main 第 1 节、Mobile）

- 位置：桌面 = 左下角头像点开的账号菜单里一行「外观」，三段段控 **浅色 / 深色 / 跟随系统**，在「版本更新」上面；手机 = 导航抽屉同一行，段控高 44。
- 点一下立刻生效，不刷新、不关菜单。
- 记法：`localStorage["fp-appearance:<账号>"]`，按账号分开（同「版本更新看没看过」）；另写一份 `fp-appearance:last` 给首帧用。读写包 try/catch，读不到 = 浅色（M3）。
- 「跟随系统」= `matchMedia('(prefers-color-scheme: dark)')`，系统切换时实时跟。
- **首帧不闪**：`index.html` 的 `<head>` 里一段内联脚本，在 CSS / JS 之前按 `fp-appearance:last` 设好 `<html data-theme>`；登录后按该账号的值再设一次。
- 实现：`stores/appearance.ts`（`mode: 'light'|'dark'|'system'`、`resolved: 'light'|'dark'`），只它写 `data-theme`。

### 3.1 切换动画（2026-09-20 用户定：整页渐变）

- 在账号菜单 / 手机抽屉里点外观、而且明暗真的会变时：**整个页面从旧外观渐变到新外观**，600ms（`stores/appearance.ts` 的 `FADE_MS`；起初 320ms，用户嫌快）、`cubic-bezier(0.4, 0, 0.2, 1)`。
- 做法：View Transitions —— 浏览器先拍下旧外观，回调里换 `data-theme`，新外观那层整页 `opacity 0 → 1` 盖过旧外观；旧外观那层原样垫在下面、不跟着淡出，所以中途不会整页发灰（`motion.css` 关掉 View Transitions 自带的动画）。
- **计时从过渡就绪后画出的第一帧开始**，不从 `ready` 那一刻：截新画面那一下可能卡住（实测普通 Edge 7–19ms，Claude 桌面端内嵌浏览器面板 0.4–1 秒），从 `ready` 起算的话渐变会整段落在卡顿里，恢复时已经播完，看上去就是直接切换。开始前新外观那层透明，播完 `fill: forwards` 停在全显，直到过渡拆掉。
- **播放中再点不打断**：浏览器遇到新过渡会跳过正在播的那个、直接跳到终态。只记下最后点的那个（段控当场显示它），这次播完再渐变到它。
- 切换期间 `<html data-theme-switching>`：新外观那层先透明；`motion.css` 关掉全站 `transition`、暂停循环动画（`animation-play-state: paused`）—— 新外观那层是实时画面，页面上有东西在动就得每帧整页重画，会掉帧。过渡结束即拿掉。
- 不动画、直接换：浏览器不支持 View Transitions；系统开了「减少动态效果」；页面在后台；明暗没变（如浅色时选「跟随系统」而系统也是浅色）；系统自己在夜里切深浅（跟随系统时）。
- 历史：09-20 先做了「从头像圆扩散到全屏」，用户试了两轮后放弃，改为整页渐变。

## 4. 写死的颜色收成令牌

- 现状（设计师重数）：颜色令牌引用 4142 处会自动跟着变；**写死的颜色 863 处 / 144 个文件**；`anaTheme.ts` 35 个颜色字面量。
- 收法：每个字面量换成**浅色值相同**的令牌（浅色外观零变化）。墨色半透明（`rgba(28,28,28,.06)` 这类，不在 ink 档位上）写成 `color-mix(in srgb, var(--ink-900) 6%, transparent)`：浅色下逐位相同，暗色下自动变成浅色半透明。没有同值令牌、又是反复出现的角色，才加新令牌（照 §2 那十个的做法，浅色值 = 原值，暗色值按稿）。一处一个、没有同值令牌的浅色底 / 深色字：浅色照原值写，紧跟一条 `:root[data-theme="dark"]` 规则换成令牌（行内样式里的按 `resolvedTheme` 取）。不许留下在暗底上会变成白块 / 黑字的字面量；半透明色底、墨色投影在暗底上照样是暗的，可以留（字面量门的基线里有清单）。
- **不收**（白名单，留原样）：Excel / 导出（`utils/*Excel*.ts` 等写进文件的颜色）、打印样式、品牌标志 SVG、登录页（本来就是暗色流动背景）、`anaTheme.ts`（改成两套色板，见 §6）。
- 实底上的字：落在 `--hue-*` / `--ink-900` / `--control-solid` 实底上的白字一律改引 `--control-solid-text`（暗色下是深字）；落在固定深底（`--tip-bg`、`--toast-bg`）上的白字用 `--text-on-solid`（两种模式都是白）。`ds/Button.vue` 危险按钮的字色改引 `--control-solid-text`。
- 拿 `--text-disabled` 写内容的地方（期区胶囊里的数量、楼栋表的「标准厂房」「/ 12」）改成 `--text-muted`：那不是禁用。
- 控件边框：输入框、下拉、搜索框、描边按钮、分页钮、手机层级胶囊的边框改引 `--border-control`；悬停 / 展开 / 聚焦改引 `--border-control-strong`；`--border-strong` 只留给虚线框、步骤条这类装饰。
- 段控选中格改用 `--surface-raised`。骨架微光 `.fp-shim` 渐变两端改 `--ink-040`（暗色下不变成黑块）。

## 5. 组件要点（画板 Components、Shell）

- 浮起的东西（下拉、日期面板、弹窗、抽屉、命令面板）用 `--surface-raised` + `--shadow-pop` / `--shadow-dialog`（暗色下是 1px 亮边 + 深投影）；遮罩 `--scrim`。
- 提示条（FPToast）底 `--toast-bg`；它自带的深底语义色（成功 / 出错 / 信息）暗色下与全站 `--hue-green` / `--hue-red` / `--hue-blue` 统一（M4）。刷新条按钮白边 45%。
- 命令面板选中行：暗色下用 `--row-selected`（和浮层分得开）。
- 在线头像：身份色压暗到白字 ≥4.5，去掉偏紫的 rgb(163,124,178)（两种模式都变，M4）。
- 表格选中行 `--row-selected`；警示条 `--warn-bg` + `--warn-text`；出错底 `--danger-bg`。
- 滚动条：`--scrollbar-thumb` 暗色 35% 白（对卡片 3.11）。

## 6. 图表（画板 Analysis 第 1 节）

- ECharts 主题是纯 JSON，引不了 CSS 变量：`components/ana/anaTheme.ts` 出浅色、暗色两套（同结构），注册成 `fpAnaTheme` / `fpAnaThemeDark`；`AnaEChart.vue` 按 `appearance.resolved` 选主题，切换时重建实例。
- 暗色值：分类色第 6 个 `#185FA5` → `#6E86AE`，其余 7 个不变；网格 8% 白、坐标轴 16% 白、坐标字 / 图例 = `--text-muted` / `--text-secondary` 的暗色值；悬停提示框底 = `--tip-bg`；标注环红 / 琥珀 / 蓝 = 暗色 `--hue-red` / `--hue-orange` / `--hue-blue`，中心点 = 卡片色；带子 7% 白。
- 视图里写在图表 option 里的颜色字面量，改成从 anaTheme 取（按当前外观）。

## 7. 检查

- `tokens.spec`：解析 tokens.css 两块，① 浅色块每个颜色令牌在暗色块里有值或是别名；② 按稿断言关键对的对比度（主字 / 次字 / 说明字在四层面上 ≥4.5，涨跌字在四个 accent 暗底上 ≥4.5，`--border-control` 叠在控件底上对外 ≥3，选中日期字对 `--hue-blue` ≥4.5）。
- 字面量门：`.vue` / `.css` / `.ts`（白名单除外）里不许再出现新的颜色字面量；计数只减不增。
- 浅色外观不变：收令牌前后浅色逐屏截图对比。

## 8. 不做

- 暗色下的打印样式；登录页（已是暗色）。
- 字号现网还有 13 / 12.5 / 10.5 / 9.5 几档不在阶梯上，本次不动。
