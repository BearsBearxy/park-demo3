# AGENTS.md：给接手的 agent 和开发者

开工前先读完这一份。命令怎么跑见 [README.md](README.md)；用户拍过板的产品决定见 [docs/DECISIONS.md](docs/DECISIONS.md)；docs/ 每份文件的状态见 [docs/README.md](docs/README.md)；仓外的待办和文件地图见 [../README.md](../README.md)。

出处里写「记忆 xxx」的，是项目主人本机 Claude 记忆里的同名文件（不随仓走）；仍然有效的内容已经抄进本文或 DECISIONS.md。写对外材料（方案、报价、宣传页、截图）的规矩不在仓里，见 [../运维文档/README.md](../运维文档/README.md)「对外发布准备」一节开头。

---

## 1. 动手前必读

| 要做的事 | 先读（按顺序） |
|---|---|
| 改任何界面 | [PAGE-BEHAVIOR](docs/design/PAGE-BEHAVIOR-SPEC.md)、[LIST-PAGE](docs/design/LIST-PAGE-SPEC.md)、[UI-CONSISTENCY](docs/design/UI-CONSISTENCY-SPEC.md)、[LAYOUT-STABILITY](docs/design/LAYOUT-STABILITY-SPEC.md)、[UI-OVERLAY](docs/design/UI-OVERLAY-SPEC.md)、[EDIT-MODE](docs/design/EDIT-MODE-SPEC.md)（这六份是设计系统 SKILL.md 列的页面级铁律） |
| 改界面时按涉及面加读 | [RESPONSIVE-LAYOUT](docs/design/RESPONSIVE-LAYOUT-SPEC.md)（新屏根节点挂 `.fp-fluid`）、[WRITE-KEEP-CONTEXT](docs/design/WRITE-KEEP-CONTEXT-SPEC.md)（写完不丢滚动位置）、[DARK-MODE](docs/design/DARK-MODE-SPEC.md)（新颜色只走令牌）、[KPI-CARD](docs/design/KPI-CARD-SPEC.md)、[DATE-PICKER](docs/design/DATE-PICKER-SPEC.md)（不许原生日期框）、[TAB-BAR](docs/design/TAB-BAR-SPEC.md)（页签与缓存） |
| 改分析屏 | [分析屏版式与文字规范 45 条](../运维文档/设计稿/未实现/分析屏现状画布-2026-10-03/版式与文字规范/分析屏版式与文字规范-2026-10-04.md)（在仓外，配量尺 `measure.mjs`）、`frontend/src/components/ana/anaSentence.ts`（句型库）、`frontend/src/views/__tests__/anaCopyLint.spec.ts`、[PV-ANALYSIS-SPEC](docs/design/PV-ANALYSIS-SPEC.md)、[DECISIONS 分析屏](docs/DECISIONS.md#分析屏) |
| 出设计稿 | 上面六份铁律、设计系统 `SKILL.md`（§8）、[../运维文档/设计稿/README.md](../运维文档/设计稿/README.md)（放哪、怎么分类）、本文 §2「出设计稿」、DECISIONS.md 里相关领域 |
| 改计费逻辑（合同、抄表、公摊、催缴单） | [METRIC-SOURCE](docs/design/METRIC-SOURCE-SPEC.md)（同一判定只许一个实现）、[CONTRACT-BILLING-REWORK](docs/design/CONTRACT-BILLING-REWORK-SPEC.md)、[METER-TIMELINE](docs/design/METER-TIMELINE-SPEC.md)、[POOL-ENGINE](docs/design/POOL-ENGINE-SPEC.md)、[BOOK-STRUCTURE-2024-02](docs/design/BOOK-STRUCTURE-2024-02.md)（原册唯一事实源）、[S4-BILL-NOTICE](docs/design/S4-BILL-NOTICE-SPEC.md)；催缴单月份规则只写在 [DECISIONS](docs/DECISIONS.md#计费与账单) |
| 改导入 | [IMPORT-GUIDE](docs/design/IMPORT-GUIDE.md)、[METER-IMPORT](docs/design/METER-IMPORT-SPEC.md)、[BOOK-WORKBENCH §7](docs/design/BOOK-WORKBENCH-SPEC.md)、[导入中心实现规范](docs/superpowers/specs/2026-10-10-import-center-modal-impl-design.md) |
| 改后端接口或权限 | [API-CONTRACT](docs/design/API-CONTRACT-SPEC.md)、[RBAC §15](docs/design/RBAC-SPEC.md)、[ELEVATION](docs/design/ELEVATION-SPEC.md)、[CONCURRENCY](docs/design/CONCURRENCY-SPEC.md)、[SCAFFOLD](docs/design/SCAFFOLD.md)（代码放哪，草案） |
| 发版（任何用户看得见的 PR） | [RELEASE-NOTES-SPEC](docs/design/RELEASE-NOTES-SPEC.md)（§2.1 判定、§8 清单）、[VERSION-UPDATE-SPEC](docs/design/VERSION-UPDATE-SPEC.md)、`frontend/src/changelog.ts`、`frontend/src/__tests__/changelog.spec.ts`、本文 §4 |
| 改数据库 | `backend/src/main/resources/db/migration/README.md`、`db/baseline/README.md`、`db/common/README.md`、`backend/src/test/resources/baseline/migration-checksums.txt`、`MigrationLayoutTest.java` |
| 部署 | [deploy/README-部署指南.md](deploy/README-部署指南.md)、`.github/workflows/deploy.yml`、[.env.example](.env.example)、[../运维文档/README.md](../运维文档/README.md)（服务器、备份、迁机） |

## 2. 红线与流程规则

### git 与发布

| 规则 | 出处 |
|---|---|
| `git push` 和开 PR 每次都先问用户；只认字面的「推」「PR」，一次授权只管那一次。本地 commit 可以自己做 | 记忆 ask-before-push-and-pr；误开过 PR #53、#62（都已关） |
| 「开给我审核」= 本地把前后端起起来给用户看，不是开 PR | 同上 |
| 合进 master 就自动部署生产，生产没有审批人。所以 PR 交给用户前，所有提交先推上去 | `deploy.yml` 的 workflow_run；RELEASE-NOTES-SPEC §8 第 8 条 |
| 外层文件夹（`..`）的 git 仓不提交，也不改它的 `.gitignore`，别提议整理提交；Excel 不进任何 git | 记忆 outer-repo-no-excel（10-09 用户定） |
| 工作树里有不是你改的东西 = 有别人正在用这个仓，先问再动 | 记忆 only-touch-promo-repo |
| 删除前先确认：不可逆 + 不在版本控制里 + 有人在用，三条占一条就先报体量和谁在用。删库前查每个库是谁的（本机共用的 docker MySQL 里有别人的库） | 记忆 dont-infer-delete-authorization（09-13 误删 29MB 素材、09-28 误清临时库） |

### 什么东西不进这个仓

| 规则 | 出处 |
|---|---|
| 设计稿不进 demo3 仓，放 `../运维文档/设计稿/{已实现,未实现,被否}/`，并维护那里的 README；做完的稿挪进「已实现」 | 记忆 design-files-outside-repo（09-15） |
| 对账脚本、线上修数变更集、对账报告不进仓，放 `../运维文档/对账/<年-月>/` | 记忆 recon-tools-outside-repo；PR #60 已关 |
| 这个仓在 GitHub 上现在是公开的（10-16 查；是否改私有待用户确认）。仓内文档不写服务器地址、SSH、账号口令、客户、报价与成本，这些只写「见 ../运维文档/某文件」 | `gh repo view`；本轮交接要求 |
| 源码不许出现园区真实名称；`noParkNames.spec.ts` 会红 | `frontend/src/__tests__/noParkNames.spec.ts` |
| 包体预算门禁（size-check）已按用户要求删掉，别加回来；重型库静态 import 门禁还在 | 记忆 size-budget-removed-2026-09-18 |

### 说话和屏上的字

| 规则 | 出处 |
|---|---|
| 回复、收口消息、画布便签一律中文；代码、提交信息、标识符照旧 | 记忆 reply-in-chinese（09-29） |
| 对用户说话和屏上文字用大白话：不用「包干、口径、落账、派生」这类源册行话，说具体发生了什么，再给一个真实例子 | 记忆 user-plain-words-no-ledger-jargon（10-05） |
| 屏上的字按「用户看不看得懂、这一层有没有必要」判，对标成熟产品，不为凑字数删字。例外：分析层句型库的字数上限是硬的（§5 冲突表） | 记忆 copy-judged-by-comprehension（10-05） |
| 屏上不提设计稿、不写行话、图例写实测数；具体见 [DECISIONS 界面与文案](docs/DECISIONS.md#界面与文案) | 记忆 screen-copy-no-jargon-no-overlay（09-12） |
| 给用户的方案要能直接用：带定数，假设集中写一处，要拍板的题不超过 3 条，长稿只当附录 | 记忆 concrete-plans-not-analysis（10-07） |

### 出设计稿

| 规则 | 出处 |
|---|---|
| 「画布设计稿」指 claude.ai 上的 Design 画布（一板一个 `.dc.html`，现状截图做对照板，说明写便签），不是本地 HTML；本地副本放 `../运维文档/设计稿/` | 记忆 design-canvas-means-artifact（09-29） |
| 出稿前先读 §1 的六份页面级铁律；稿上的数是占位，不当数据问题报 | 记忆 design-read-page-specs-first（09-29） |
| 一个设计师从头画到尾，不开「多方案 + 评审面板」；派工前报预算；交付前自己渲染看一眼 | 记忆 design-mockup-cost-2026-09-13 |
| 改稿要删或合并一块之前，先 grep 源码注释里的「用户 + 日期」和 `git log -S`；有拍板的只改呈现，不删（例：驾驶舱「下月预测」） | 记忆 redesign-check-user-decided-blocks（10-03） |
| 屏上有切换档（电费/水费、按月/按年），每一档都要画一块板；任务书先从源码列出所有档 | 记忆 redesign-cover-every-toggle（10-05） |
| 画布上新加一排，要复用已经认可的推荐版部件，总览板写明接在哪；交付前和推荐版并排渲染比一比 | 记忆 new-row-reuses-approved-system（10-15） |
| 参考图只取感觉不照抄：动笔前写「取 X 不取 Y」，颜色、面、浮层一律走令牌和标准件 | 记忆 reference-image-is-feel-not-copy（10-14） |

### 验收

| 规则 | 出处 |
|---|---|
| 一次改一屏；对抗复查排在最终验收之前；每条断言都要做破坏验证（改坏它，确认测试会红） | 记忆 sabotage-verification-cadence（08-29 用户定） |
| 判断「过了」看产物（surefire 报告、vitest JSON 的 `success`），不看退出码 | 同上；记忆 demo3-typecheck-gate |
| 用户的屏比 1440 宽：对稿除 1440 外再截 1920；自绘 SVG 尺寸跟容器宽走，同排卡要看高度差 | 记忆 check-wide-screens（10-06） |

## 3. git 规则

| 事 | 怎么做 |
|---|---|
| 主分支 | `master`；GitHub 仓 `BearsBearxy/park-demo3`，仓上有一条名叫「PR」的 ruleset |
| 分支命名 | `jfen/<事情>`（现有分支都是这个格式） |
| 一个 PR 一件事 | 用户看得见的改动要在同一个 PR 里涨版本号、写公告（§4） |
| 叠着开的 PR | base 是另一条分支时，下层合并后它**不会**自动改成合进 master，要另开 PR（#64 合进了 hint-impl，补开 #65 才进 master） |
| worktree | 放 `.claude/worktrees/`（被本机 `.git/info/exclude` 忽略）。`node_modules` 若是 junction，先单独删 junction 再 `git worktree remove`，否则会穿过去删掉主检出的 `node_modules`（记忆 motion-impl-lessons） |
| 换行 | `core.autocrlf=true`：git 里是 LF，工作区是 CRLF；只有 `*.sh` 强制 LF（`.gitattributes`） |
| 本机才有的忽略 | `.git/info/exclude` 忽略了 `.claude/worktrees/`、impeccable 插件的 `.claude/agents`、`.claude/skills`、`.github/{agents,hooks,skills}`、`.impeccable/` 缓存。新 clone 的人看不到这些规则，别把这些目录提交上去 |

## 4. 发版规则摘要

原文 [docs/design/RELEASE-NOTES-SPEC.md](docs/design/RELEASE-NOTES-SPEC.md)，下面只是摘要，有出入以原文为准。

| 改动（按 §2.1 判定） | 版本号 | 弹不弹 |
|---|---|---|
| 功能更新：有新增、用法变了、金额或数量会变、删了屏或入口 | 中间一位 +1，最后一位归 0（0.34.0 → 0.35.0） | 自动弹「本次更新」 |
| 小调整：修复（不改金额）、文字样式布局微调、提示更清楚、变快 | 最后一位 +1（0.34.0 → 0.34.1） | 不弹，只进铃铛「系统」一类 |
| 用户看不见（测试、构建、日志、内部整理） | 不涨，不写公告 | — |
| 要用户重新学用法（导航整体换掉、老数据要迁移） | 第一位 +1，由用户拍板 | 自动弹 |

- **版本号唯一来源**：`frontend/package.json` 的 `version`。`backend/pom.xml` 还停在 0.12.0、git tag 停在 v0.12.0，都不作数。
- **公告**：写在 `frontend/src/changelog.ts` 数组最前面，`date` 用北京时间当天，整版不超过 450 字。带新功能（`feature`）的版本要配图：`frontend/src/components/shell/release/Art0350.vue` 这种文件名（0.35.0 → `0350`，去点，照 `release/` 下现有文件），在 `art.ts` 按 `'0.35.0': Art0350` 登记。
- **同一个 PR 里做完**：定号 → 写条目 → 配图 → 只跑 `changelog.spec.ts` 和 `versionUpdate.spec.ts` → 核文案 → 交给用户前推上去。PR 描述写一句「版本号 X，公告讲了 N 条：……」。
- **抢号**：合并前 master 动过，按原文 §1.1 重新定号。
- **例外**：PR #76（台账核对页 5 列）、#77（头像橙圈、页码底色）是屏上改动，没涨版本、没写公告，是用户 10-14 定的（两个 PR 描述、提交 6043646a / 1a0f81e8），不是欠账；见 [DECISIONS 发版](docs/DECISIONS.md#发版)。规则照旧：以后用户没另说，就按上表涨号写公告。

## 5. 规范以谁为准

总原则：**先查下面「已知不一致」表**。表里没有的：**令牌值和组件外观以代码为准**（`frontend/src/styles/tokens.css`、`frontend/src/components/**/*.vue`，「实现即标准」）；**页面行为规则以 `docs/design/` 的 SPEC 为准**；SPEC 里引的行号、文件名、数值和代码对不上时，以代码为准，并在 [docs/README.md](docs/README.md) 那份规格那一行记一笔。设计系统 skill 的 `.prompt.md` 和线上 artifact 只是说明，可能落后，排最后。带「定稿·待实现」标记的条目是目标，不是现网行为：**新代码照定稿做，不照现网抄**。

### 各主题的权威来源

| 主题 | 以谁为准 | 其他参考（可能落后） |
|---|---|---|
| 颜色令牌（浅色） | `tokens.css` 的 `:root`；一律写 `var(--x)`。状态颜色只从 `components/fp/contractStatus.ts`、`unitStatus.ts` 取 | skill `tokens/colors.css`（镜像）、UI-CONSISTENCY §3 §4、KPI-CARD §2 |
| 暗色 | `tokens.css` 的 `:root[data-theme="dark"]` + DARK-MODE-SPEC。只有 `stores/appearance.ts` 能写 `data-theme`；图表用 `anaTheme.ts` 的暗色主题 | 仓外设计稿「暗色模式-2026-09-19」 |
| 字体与字号 | `tokens.css`（`--font-*`、`--fs-*` 八档）+ UI-CONSISTENCY §2：只取 28/24/20/16/15/14/12/11，不许小数，中文最小 11。字体自托管，不许远程字体 | skill `tokens/fonts.css`、`typography.css` |
| 间距、圆角、阴影 | `tokens.css`；具体组件看各自 `.vue`（`ds/Card.vue` 圆角 20，`KpiCard`/`FPStat` 16，分析图卡 `.av2-card` 8 带 1px 边） | skill `tokens/spacing.css`、readme 的 Corner radii（部分过期） |
| 浮层与 z-index | `tokens.css` 的 `--z-*` 七级 + PAGE-BEHAVIOR §3 + UI-OVERLAY；新浮层照 `ds/Popover.vue` 抄 | skill `tokens/layers.css` |
| 图标 | `components/ds/icon.ts` 的 `iconFor`（lucide-vue-next 0.468，线宽 2）。状态用 6px 圆点加字，不用 emoji | skill readme ICONOGRAPHY（过期） |
| 组件用法 | `components/{ds,fp,ana,shell}/*.vue` | skill `components/**/*.prompt.md`（示例还是 JSX，有 13 个组件代码里没有，另有约 29 个现网组件没写） |
| 图表 | `components/ana/anaTheme.ts`（色板、`calloutMark`）+ `AnaEChart.vue`；颜色从 `anaTheme.ts` 的 `anaPalette()`、`anaFmt.ts` 的 `hues()` 取；新图表类型在 `echartsBundle.ts` 注册 | skill `charts.prompt.md`（整篇是旧样子，别照做） |
| 分析屏版式与读数句 | 仓外 [版式与文字规范 45 条](../运维文档/设计稿/未实现/分析屏现状画布-2026-10-03/版式与文字规范/分析屏版式与文字规范-2026-10-04.md) + `anaSentence.ts`；首屏按 1440×900 的 782px 算 | FORECAST-BAND §3.4、`anaCopyLint.spec.ts` |
| 列表与表格 | LIST-PAGE-SPEC + skill `components/data/datagrid.prompt.md`；实现在 `FPSortableTable.vue`、`composables/useWideTable.ts`、`styles/mx-list.css`。**新屏**照 LIST-PAGE-SPEC 和 datagrid.prompt 里标「定稿·待实现」的条目做（:30 正文 14px、钱那一列加粗浅底；:34 数字列用 `useWideTable.ts` 的 `numW` 按整列撑宽、不省略），骨架参照 `BuildingsView` / `TenantsView`（LIST-PAGE-SPEC:83）。`mx-list.css` 的 13 / 13.5 / 12.5 / 10px（:62、:125、:126、:133）和 `FPSortableTable` 的数字省略是存量欠账，别照抄 | — |
| 编辑态 | EDIT-MODE-SPEC v5 + UI-CONSISTENCY §6；实现 `useEditMode.ts`、`useEditLock.ts`、`fp/FPEditModeButton.vue` | ELEVATION、RBAC |
| 页面稳定、加载、提示 | LAYOUT-STABILITY + PAGE-BEHAVIOR §1 + skill `components/feedback/hints.prompt.md`（六级、十件标准件、铃铛）；门禁 `views/__tests__/noInteractionLayoutShift.spec.ts` | 仓外「提示层级与公共电核算」稿 |
| 响应式断点 | `styles/breakpoints.ts`（S≤600 / M≤960 / L≤1280 / XL）+ RESPONSIVE-LAYOUT v1.3；不许新增断点值；新手机屏根节点挂 `.fp-fluid` | MOBILE-390-AUDIT、RESPONSIVE-V2-PLAN |
| 文案语气 | 没有单一权威，按场景：分析屏句子看 `anaSentence.ts` 和 `anaCopyLint.spec`；更新公告看 RELEASE-NOTES §4 和 `changelog.spec` 禁词表；状态词看 `contractStatus.ts`。共通：称用户「你」不用「您」，负号用 U+2212，没数写「—」，写测量不写定性，不用感叹号和 emoji | 本文 §2「说话和屏上的字」 |
| 动效 | `tokens.css` 的 `--dur-*`/`--ease-*` + `styles/motion.css` + `ana/anaMotion.ts` + `utils/rowMotion.ts`（时长 120/200/320，不弹跳，高频操作不加动画，外观切换 450ms） | [动效规范 v1](docs/superpowers/specs/2026-09-05-demo3-motion-design.md)（标题还写「待拍板」）；v2 只在仓外「全站动效-2026-09-05」 |
| 版本公告 | RELEASE-NOTES-SPEC + `changelog.ts` + `changelog.spec.ts` | VERSION-UPDATE-SPEC |
| 品牌名与标志 | 界面上的名字只看 `frontend/src/brand.ts`，标志 `frontend/src/assets/brand/logo.svg`；改名还要改后端启动横幅 `backend/src/main/java/com/park/demo3/Demo3Application.java:23`、`:25`（版权声明和暗水印，做法见 `../运维文档/版权水印/`），以及仓外的宣传页、PDF 源稿 | `docs/brand/DESIGN-PHILOSOPHY.md` 只是 logo 概念稿的美术说明，不是界面规则 |
| KPI 卡、日期选择器、页签栏 | KPI-CARD、DATE-PICKER、TAB-BAR 三份 SPEC（都写「图是规格」） | 仓外对应设计稿 |

### 已知不一致

| 主题 | 说法 A（在哪） | 说法 B（在哪） | 现在以谁为准 |
|---|---|---|---|
| 绿色能不能用 | 不许用绿，正向用蓝（skill `Badge`/`Card`/`charts` 的 prompt、两张 guideline 卡） | 2026-08 已解禁，成功和正向变化用绿（skill SKILL.md、`tokens/colors.css`） | **以代码为准**：B。`--delta-up`、`--status-success` 都是绿；只有 `ds/Badge.vue` 没有绿档 |
| 合同状态 active 叫法 | 「生效中」，绿（skill Badge.prompt、readme） | 「执行中」，蓝（UI-CONSISTENCY §4） | **以代码为准**：`contractStatus.ts:16` 执行中、蓝 |
| FPStat 数值字号 | 19px（skill product.prompt） | 20/26（KPI-CARD §3） | **以代码为准**：`FPStat.vue` 20/26 |
| KPI 数值字号引用 | `KpiCard.vue:76` 是 `--fs-h1` + 行高 1.1，`AnaKpiTile.vue:43` 是 `--fs-h3`（skill SKILL.md、skill CLAUDE.md:17、PAGE-BEHAVIOR §4.4） | KpiCard 24/30，AnaKpiTile 20/26，放不下降到 16（KPI-CARD §3） | **以代码为准**：B；A 的行号和行高都过期 |
| 图表长相 | JSX 胶囊圆角柱、环图（skill charts.prompt、readme） | ECharts，柱默认直角，色板取 `anaTheme` | **以代码为准**：B |
| 分析图卡外观 | 圆角 20、米白底、无边框（skill readme） | 白底、1px 边、圆角 8 | **以代码为准**：`ana/ana.css` 的 `.av2-card` |
| 外壳布局 | 三栏、280 宽右栏、顶栏 60（skill readme） | 图标栏 66 + 面板 234、页签条 44、顶栏 48 | **以代码为准**：B |
| 侧栏宽度 | 可拖，212 起（skill navigation.prompt） | 固定 234（PAGE-BEHAVIOR §4.1） | 代码和规格一致：固定 234 |
| 图标线宽 | 约 1.5，CDN 加载（skill readme） | lucide-vue-next 0.468，线宽 2 | **以代码为准**：B |
| 品牌标志 | 「暂无正式 logo」（skill readme、`colors.css`） | 灵睿 LinkSight 09-18 定稿 | **以代码为准**：`brand.ts`、`logo.svg` |
| PAGE-BEHAVIOR 的出处 | 指向 `SidebarNav.jsx`、`Card.jsx`、`FitText.jsx` 等 | 这些原型 10-15 已从 skill 删掉 | 规则本身和代码一致，只是出处成了死链 |
| `--text-disabled` 能不能写信息 | 只给禁用控件，写信息用 `--text-muted`（UI-CONSISTENCY §3、DARK-MODE §4） | 小节标题用 `--text-disabled`（skill product.prompt；`FPSectionLabel.vue:14` 就这么写） | **以规格为准**：A 是目标，代码待改 |
| 字号禁小数 | 只取阶梯值（UI-CONSISTENCY §2） | 代码里还有约 238 处小数字号（10-16 grep `font-size: N.Npx`），没有门禁 | **以规格为准**：新代码别照抄 |
| 外观切换时长 | 600ms（动效规范 `docs/superpowers/specs/2026-09-05-demo3-motion-design.md:5`，已过时） | 450ms（DARK-MODE §3.1，10-14 定以代码为准） | **以代码为准**：`appearance.ts:43` 450 |
| KPI 卡默认色序 | slate / sky / blue / cyan（skill Card.prompt） | slate → blue → sky → cyan（KPI-CARD K2） | **以代码为准**：`KpiCard.vue` 是 B |
| skill 令牌镜像 | 说是 `tokens.css` 的镜像（skill SKILL.md） | 镜像比 `tokens.css` 少 19 个变量（10-16 按变量名比：`tokens.css` 165 个、镜像 146 个，镜像独有 0 个；`grep -ohE -- '--[a-zA-Z0-9_-]+\s*:'` 两边去重后 `comm`），09-20 以后没同步 | **以代码为准**：`tokens.css` |
| 分析屏文案字数上限 | 只是参考，先看懂不懂（记忆 copy-judged-by-comprehension） | 读数句 30 / 参照 28 / 卡头 24 / KPI 副行 16，开发环境超长直接抛错（`anaSentence.ts` LIMIT、`anaCopyLint.spec`） | 句型库和分析层模板是**硬上限**；别处的文案按看不看得懂判 |
| 设计稿路径和状态 | 暗色、日期选择器与 KPI 卡、提示层级等稿放在「未实现」；VERSION-UPDATE-SPEC:3 写稿在「未实现/版本更新-2026-09-18」 | 都已合进 master（PR #47、#63、#65）；版本更新稿实际在「已实现」 | **以 git 为准**：已实现；规格里的路径是旧的 |
| 屏上称呼 | 系统口吻，状态词「生效中」（skill readme） | 称用户「你」，不用「您」 | **以代码为准**：屏上文案「您」0 处（`stores/auth.ts:292` 注释里引浏览器原文的那一处除外） |
| ECharts 新图表类型在哪注册 | `AnaEChart.vue` 的 `use([...])`（PAGE-BEHAVIOR-SPEC:139） | `components/ana/echartsBundle.ts` 的 `use([...])`（:10、:42；`AnaEChart.vue:86` 注释写明「要改的是 echartsBundle.ts，不是这里」） | **以代码为准**：B |
| 设计出处与授权 | 原创，无外部署名义务（skill readme） | skill `uploads/` 里的参考截图来自一套第三方 UI kit | **不确定**，待用户确认 |

## 6. 已知的坑

| 坑 | 怎么避免 |
|---|---|
| 裸跑 `npx vue-tsc --noEmit` 一个文件都不查，永远退出 0（根 tsconfig 是 `files: []`） | 用 `npm run typecheck` |
| 管道会吃掉退出码（`cmd \| tail; echo $?` 拿到的是 tail 的） | 先重定向到文件再 `echo $?`；判绿数产物 |
| Windows PowerShell 5.1 的 `Get-Content` 按 ANSI 读 UTF-8，改中文文件会不可逆地毁掉 | 读写文件用 Bash、Python 或编辑器工具；PowerShell 只跑纯命令 |
| 工作区源码是 CRLF | 脚本做多行替换按 `\r\n` 写锚点、按 CRLF 写回；带反斜杠的补丁别用 Bash heredoc，写成 `.py` 再跑 |
| `.gitattributes` 只强制 `*.sh` 为 LF | 往服务器传别的脚本前先确认换行 |
| `.cmd` 文件被 cmd 按 GBK 读 | `.cmd` 里只写 ASCII |
| 本地后端是 8481 不是 8080 | 改端口要同步 `frontend/vite.config.ts` 的代理 |
| 开发库在 13306；本机还有别的分支的走查库、测试库容器 | 连之前看清端口；删任何库前查清是谁的 |
| Testcontainers 复用库是多个 agent 共用的：分支上的新迁移跑进去，以后会校验和不符，或让 master 的精确断言变红 | 加或改迁移时跑 IT 设 `TESTCONTAINERS_REUSE_ENABLE=false`；报校验和不符时先确认是复用库 |
| 本机是悉尼时区，共享测试库有一行落在夏令时跳过的那一小时，IT 报 `HOUR_OF_DAY: 2 -> 3` | `pom.xml` 的 surefire（:79）已带 `-Dapi.version=1.44 -Duser.timezone=UTC`；从 IDE 等别的入口跑 IT 要两个一起带（缺 `api.version` 在 Docker Desktop 29.x + Windows 上 Testcontainers 报 400，见 `pom.xml:70-71`），例如 `JAVA_TOOL_OPTIONS="-Dapi.version=1.44 -Duser.timezone=UTC"` |
| 已发出的迁移改一个字节，生产和共享测试库启动就校验失败（V1–V141 都钉在 `migration-checksums.txt`） | 新迁移只进 `db/common`，从 V142 起，并在 `migration-checksums.txt` 补一行 |
| `db/common` 的迁移两条链都跑 | 不写任何园区数据；回填 UPDATE 在空库上要是空操作 |
| `backend/scripts/fixes/` 的老修数脚本：V129 删了 meter 表 16 列，其中 8 个脚本还在 UPDATE 这些列 | 别重跑老脚本；新的一次性修数手动跑、不进迁移；线上跑没跑过看 `../运维文档/对账/` |
| 表档案按月记录（`meter_assign`/`meter_status` 只存起始月） | 改归属或状态只走 `MeterTimelineService`，按月读用 `viewAt(ym)` |
| 公摊池的绑定、折入、取整位按月生效；户级绿化水按 `green_rate` 收 | 对账对不上先看比的是不是公摊层，别为它改引擎 |
| CI 有重型库静态 import 门：`exceljs`/`echarts` 静态引入会红 | 用 `await import(...)`；echarts 唯一装配点是 `components/ana/echartsBundle.ts` |
| 新手机屏根节点漏挂 `.fp-fluid`，`base.css:131` 的 800px 地板把页面撑出屏 | 新建或迁移完的手机屏根节点挂 `.fp-fluid` |
| `anaSentence.ts` 的模板超长，开发环境直接抛错，整屏崩 | 改模板前先有单测，用最长的真实输入调到它 |
| 状态颜色或叫法各屏自己写，会不一致 | 只从 `contractStatus.ts`、`unitStatus.ts` 取；同一判定只许一个实现（METRIC-SOURCE-SPEC） |
| Maven 增量编译：还原文件带回旧修改时间，`.class` 沿用破坏版，测试假绿 | 还原后 `touch` 文件或 `mvnw clean` |
| 并行派工按文件切，跨文件的条目会掉进缝里 | 按条目切；收口时逐个读每个 agent 报的「跳过」 |
| 无头 Edge 截图残留进程打满 CPU | 数据目录写完整路径；截完 `taskkill /T` 杀整组；全机同时只开一个；Edge 154 起要先自己启动再 `puppeteer.connect` |
| 等长任务时只认成功标志，会把崩溃当成还在跑（10-14 空等七个半小时） | 等待条件同时匹配失败签名（`Error`、`failed`、`ENOENT` 等），先去掉颜色码再 grep |
| Browser 面板走查：开视口模拟后点击可能不落地；截图落后于 DOM（未在本轮复测） | 判成败看网络请求或读 DOM；登录口令只能用户自己输 |
| compose 会把服务名注册成网络别名，几个园区的服务都叫 `backend` 就会串站（正式站前端随机连到别的园区）。`deploy/park.sh` 现在已按园区名起服务名（`<名>-backend`，`park.sh:126`），只在本园区自己的网里加别名 `backend`（:149） | 手写 `parks/*.yml` 或改 `park.sh` 时别把服务名改回 `backend`；园区名不能让库名撞上正式库 `park_demo3`（脚本 :40 已检查） |
| 单会话：一个账号同时只能在一处登录，新登录会把旧会话作废（`AuthService.java:60`、`JwtAuthFilter.java:23`，V125，用户 2026-09-12 定）。脚本或 agent 登一次 admin，就会把项目主人、别的 agent 或线上修数执行器踢下线 | 别用别人正在用的账号登录；走查和截图用自己建的账号或自己的库（例：私有库里加一个 admin 副本，另起一个后端端口） |
| 编辑态、失败态各屏写法不一 | 照 `PvMeterView` 的定型写法：每个数据源独立错误槽加序号守卫，错误只在成功分支清，下拉一律 `ds/Select`（记忆 fp-edit-lock-shapes，未逐条对现码） |
| `backend/pom.xml` 版本 0.12.0，和前端不同步 | 版本号只看 `frontend/package.json` |

## 7. 仓外资料和本机记忆

| 东西 | 在哪 | 说明 |
|---|---|---|
| 交接总览、待办、待拍板 | [../README.md](../README.md) | 外层文件夹的入口 |
| 运维文档（服务器、备份、对账、安全审计、发布准备、版权水印） | [../运维文档/README.md](../运维文档/README.md) | 不在任何 git 里，只有这一份 |
| 设计稿与线上画布 | [../运维文档/设计稿/README.md](../运维文档/设计稿/README.md) | 分「已实现 / 未实现 / 被否」 |
| 产品宣传页 | `../产品宣传页/`（独立 git 仓） | 和本仓无代码依赖 |
| 本机 Claude 记忆 | 项目主人本机 `~/.claude/projects/` 下 | 不随仓走；仍有效的已抄进本文和 DECISIONS.md。记忆写的是当时情况，引用前要自己核 |
| 项目主人的全局工作规范 | 本机 `~/.claude/CLAUDE.md`（总则 + 「什么时候读哪条」索引）、`~/.claude/specs/`（22 份实现纪律，如 adversarial-review-before-acceptance、coverage-table-from-image）、`~/.claude/agents/`（三个只读复查 agent：chart-data-feasibility、mockup-coverage-check、screen-copy-adversary） | 管着派工、对抗复查、照稿、发版收口。不随仓走，只在本机，交接时要一起拷 |

## 8. 设计系统在哪

**本仓里没有设计系统。**

| 东西 | 在哪 | 说明 |
|---|---|---|
| 设计系统 skill（真身） | [../.claude/skills/factory-park-design/](../.claude/skills/factory-park-design/SKILL.md) | 外层文件夹里。外层 git 没有远程、按约定不提交，所以**没有远程备份**，交接时整个目录要一起拷 |
| 入口 | `SKILL.md` | 事实源分层表、六份页面级铁律索引、品牌基础（紫色只有预算线一处例外、绿色已解禁、字阶、字体、Lucide）、已作废规则表 |
| skill 的 `CLAUDE.md` | `CLAUDE.md`（skill 目录里那份，不是本仓根的 CLAUDE.md） | 「变长内容不得破坏网格」的现行做法：数字不省略、KPI 放不下先降一档再换「万」、新代码不许再写 `FitText`（:11-27）；SKILL.md:61 引它 |
| 令牌镜像 | `tokens/*.css` | 比 `frontend/src/styles/tokens.css` 落后，以后者为准 |
| 规范卡、组件说明 | `guidelines/*.html`、`components/**/*.prompt.md` | 部分过期，见 §5 冲突表 |
| 线上版 | claude.ai artifact `8X4gUPP8swAu5iV7UR7Ucb` | 私有，只有项目主人能打开；照 master `6a78bbb`（10-14）做的静态快照，代码一改就旧 |
| 唯一的令牌标准 | `frontend/src/styles/tokens.css` | 在本仓，「实现即标准」 |

**git status 里一片 `D` 是故意的**：10-15 用户定删掉 skill 里 83 个 2026-06 的 React 原型文件（`*.jsx`、`templates/`、`ui_kits/` 等），外层按约定没提交。别 `git checkout` 把它们恢复回来。

**怎么装成 skill**：Claude Code 读 `~/.claude/skills/<名字>/SKILL.md`。本机做法是建一个目录链接指过去（别拷第二份，两份会分叉）：

```bat
:: Windows（cmd）
mklink /J "%USERPROFILE%\.claude\skills\factory-park-design" "<外层文件夹>\.claude\skills\factory-park-design"
```

```bash
# macOS / Linux
ln -s "<外层文件夹>/.claude/skills/factory-park-design" ~/.claude/skills/factory-park-design
```

本机的链接已核（`~/.claude/skills/factory-park-design` 指向外层这份）；上面两条命令没在新机器上实测。
