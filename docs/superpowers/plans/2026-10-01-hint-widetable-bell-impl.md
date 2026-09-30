# 提示层级 · 宽表 · 铃铛 · 三屏 · 实现计划（2026-10-01）

实现规范：`docs/superpowers/specs/2026-10-01-hint-widetable-bell-impl-design.md`（共享件 API、各表先后、按推荐定下的 26 条、这次不做、门禁）。
画布：`../运维文档/设计稿/未实现/提示层级与公共电核算-2026-09-29/`（Design 画布第 26 版）。分支 `jfen/hint-impl`（从 `jfen/hint-table-spec` 拉，已带上 2541db6 的 FPLoadError 引入修复）。

## 0. 怎么做

- **一个阶段一个工作流**：阶段内是 实现 → 对抗复查 → 修 → 破坏验证 → 验收，不再按任务另开工作流。阶段之间顺序做（文件归属见规范 §3）。
- **实现者按任务分，不按文件切条目**：一个条目涉及的文件全交给同一个实现者；两个条目的文件重叠就合给同一个人。S3 三屏各一个实现者，一次改完该屏上三块的活（画布 03–05 + 宽表接入 + 提示件替换）。
- **同一阶段里并行的实现者文件不重叠**；都在同一个工作树里改（不用 worktree：Windows 上 worktree 删除会穿过 node_modules 联接），**实现者不提交**，阶段验收后由主会话按任务分组提交。
- 实现者纪律：前端源码是 CRLF；改已有文件用精确字符串替换并断言命中一次；中文文件不用 PowerShell 读写；破坏验证用字符串替换，不用 `git checkout`；过程中只跑相关 spec；`npm run typecheck` 只看自己文件的报错；每条新断言自己先做一次破坏验证，交回时列出「已破坏验证的断言」和「跳过的条目 + 理由」。
- **对抗复查**（每阶段一轮，在验收之前）：三个镜头（行为回归 / 规范与图不符 / 该有而没写的断言）各找一遍，每条发现交给一个只想推翻它的复核者，坐实的交修复者。
- **破坏验证**：由一个没写过这些测试的 agent 对本阶段新断言逐条重做；主会话再抽查。
- **验收**：`npm run typecheck`、本阶段相关 spec、后端涉及的 IT；判绿数产物。每阶段收口跑一次全量。
- **只读复查员**：写完本计划后 `mockup-coverage-check` 对图数一遍覆盖表；S6 收口前再数一遍屏上落点，并派 `screen-copy-adversary` 过一遍新上屏的字。
- **成本估计**：约 70–80 个 agent（S1 ≈ 9、S2 ≈ 10、S3 ≈ 14、S4 ≈ 24、S5 ≈ 14、S6 ≈ 3），按每阶段实际数字在收口消息里报。
- **发版**：中间阶段不单独发版。收口时按 RELEASE-NOTES-SPEC 定版本（功能更新，涨中间一位）写 `changelog.ts`；拆几个 PR、什么时候推，收口时问用户（推送和开 PR 都要先问）。

## 1. 稿 → 任务覆盖表（对着图数）

「图上位置」里的 `sN_k` 指第 N 节截图的第 k+1 段，截图存在画布目录 `_shots/2026-10-01/`。四个勘察员各对一段截图逐块数（01、02、06-A~D → 提示件；03–05 → 三屏；06-D 左、06-E~G → 铃铛；07 → 宽表）。「不做」的都写了理由；画布自己的说明文字、现状对照图、图例不上屏。

| # | 图上位置 | 块 | 任务（阶段） | 不做的理由 |
|---|---|---|---|---|
| 1 | s1_0 左上第 1 张卡 | 01-A 卡1 就地标记（S10-0162 行「● 缺起止日期」） | T06（S1） |  |
| 2 | s1_0 上排中卡 | 01-A 卡2 工具条入口（待补档案 ▾ 胶囊 + 两项弹层） | T07（S1） |  |
| 3 | s1_0 上排右卡 | 01-A 卡3 块内提示（标的段与费用卡里「租金行还没绑单元 · 去绑定」黄条） | T06（S1） |  |
| 4 | s1_0 下排左卡 | 01-A 卡4 页面状态（公共电核算 ● 本月未生成 / 园区抄表 ✎ 编辑中·3 处改动） | T06（S1） |  |
| 5 | s1_0 下排中卡 | 01-A 卡5 结果回执（已导出 公共电核算-2023-08.xlsx） | T01（S1） |  |
| 6 | s1_0 下排右卡 | 01-A 卡6 需要拍板（放弃 3 处未保存的修改？继续编辑/放弃，遮罩） | T02（S1） |  |
| 7 | s1_0 六卡下方左条 | 01-A 规则条左「从 1 往下找」 | 不做 | 规则文字，已写进 LAYOUT-STABILITY §2，不是界面 |
| 8 | s1_0 六卡下方右条 | 01-A 规则条右「页面里不再出现流内提示条，唯一例外加载失败」 | T05（S1） |  |
| 9 | s1_0 中部合同管理大卡右上 | 01-B 合同管理工具条「待补档案 ▾」+ 三项弹层（缺起止日期 133/无租金计费行 203/租金行未绑单元 16） | T12（S4） |  |
| 10 | s1_0 合同卡下方说明条 | 01-B 筛选生效后实底胶囊「缺起止日期 133 ×」 | T12（S4） |  |
| 11 | s1_0 合同卡左栏与右栏 | 01-B 合同列表与详情主体（月租、即将到期标记、字段行、操作钮） | 不做 | 现有界面原样，图中只为示意黄条让位 |
| 12 | s1_0 两处右上角暗色小图 | 01-B / 01-C「现状」缩略图 | 不做 | 现状对照截图，不是要实现的界面 |
| 13 | s1_0 底部联塑精锢标题行 | 01-C 明细标题徽标「房号两边对不上 1 ▾」「包干行没挂上池 1 ▾」 | T14（S3） |  |
| 14 | s1_1 顶部中间白浮层 | 01-C 徽标浮层「房号 547 · 去园区抄表 · 生成本月催缴单那一刻查出的…」 | T14（S3） |  |
| 15 | s1_1 主体 | 01-C 明细正文（位置/合计/月租金、收款公司 ● 5 项待指定、场地租金表） | 不做 | 现有内容不变；图示橙块让位后的原样 |
| 16 | s1_1 底部灰字 | 01-C 脚注「现状橙块 80px 高，整块让给明细表」 | T14（S3） |  |
| 17 | s2_0 02-A 顶部页签 | 02-A 页签条（园区抄表 · 2023-08 带橙色改动点） | T09（S1） |  |
| 18 | s2_0 02-A 中央白卡 | 02-A 离开确认弹窗（关闭「园区抄表 · 2023-08」？/ 这页有 3 处改动还没保存 / 继续编辑 / 放弃改动并关闭，页面变暗） | T09（S1） |  |
| 19 | s2_0 02-A 下方灰字 | 02-A 注「0 处改动时不弹，直接关、直接放锁」 | T08（S1） |  |
| 20 | s2_0 02-A 标题行 | 02-A 标题里的「切账期」 | T17（S4） |  |
| 21 | s2_0 02-A 标题行 | 02-A 标题里的「侧栏跳转」 | 不做 | TAB-BAR 例外二：正在编辑的屏点侧栏会开新页签不卸载，不丢改动，见 open_questions |
| 22 | s2_0 02-A 标题行 | 02-A 标题里的「退出登录」 | T09（S1） |  |
| 23 | s2_0 02-B 左卡 | 02-B 左 普通确认（导入会整期替换本期数据 / 取消 · 仍要导入） | T20（S4） |  |
| 24 | s2_0 02-B 右卡 | 02-B 右 删除类确认（删除 2023-08 全部读数？/ 共 76 条 / 取消 · 删除 76 条） | T18（S3） |  |
| 25 | s2_0 02-B 下方灰字 | 02-B 脚注（标题问句、正文给数、按钮写动作、删除类焦点在取消） | T02（S1） |  |
| 26 | s2_0 02-C 底部两条深色胶囊 | 02-C 回执叠放（已导出… 成功 + 保存失败：服务器没有响应 · 重试 ×） | T01（S1） |  |
| 27 | s2_0 02-C 下方灰字 | 02-C 脚注「表单里的字段错误不走回执，贴在字段下面」 | T27（S4） |  |
| 28 | s2_1 左侧暗色截图 | 02-D 卡1 浏览器自带离开框现状截图 | 不做 | 现状对照截图 |
| 29 | s2_1 中卡 | 02-D 卡2 没有改动 → 不拦（编辑中·0 处 › 直接关闭） | T08（S1） |  |
| 30 | s2_1 右卡 | 02-D 卡3 有改动 → 只能用浏览器的框（编辑中·3 处 › 浏览器确认框） | T08（S1） |  |
| 31 | s6_0 06-A 首行 | 06-A 顶部五个数（1,255 / 93 / 464 / 219 / 7） | 不做 | 盘点统计，不是界面 |
| 32 | s6_0 06-A 第 2 行 | 06-A 整条提示条行（6 种底色样例） | T16（S3/S4） |  |
| 33 | s6_0 06-A 第 3 行 | 06-A 加载失败行（5 种写法样例） | T05（S1） |  |
| 34 | s6_0 06-A 第 4 行 | 06-A 工具条入口行：待处理 3 / 未绑定 12 / 只看存疑 · 4 | T07（S1） |  |
| 35 | s6_0 06-A 第 4 行第 2 颗 | 06-A 工具条入口行：已退回 · 李审 03-05 | 不做 | 2026-09-30 拍板保持原样 |
| 36 | s6_0 06-A 第 4 行第 5 颗 | 06-A 工具条入口行：待批授权 2 | 不做 | 归 06-F 铃铛块（主管条点开的是铃铛面板） |
| 37 | s6_0 06-A 第 5 行左图 | 06-A 点开以后去哪：右侧抽屉 440 宽 · 7 处 | T16（S3/S4） |  |
| 38 | s6_0 06-A 第 5 行中图 | 06-A 点开以后去哪：贴着按钮的浮层 · 退回理由 | 不做 | 拍板保持原样 |
| 39 | s6_0 06-A 第 5 行右图 | 06-A 点开以后去哪：居中弹卡 · 47 个文件 | 不做 | PAGE-BEHAVIOR §2：明细/记录/录入仍走居中卡 |
| 40 | s6_0 06-A 第 6 行 | 06-A 块里的一行提示行（7 种样子） | T22（S4） |  |
| 41 | s6_0 06-A 第 7 行 | 06-A 表单报错行（14/16/18 三种高度） | T26（S4） |  |
| 42 | s6_0 06-A 第 8 行第 1 格 | 06-A 悬停说明行：浏览器 title | T03（S1） |  |
| 43 | s6_0 06-A 第 8 行中间 4 颗深色签 | 06-A 悬停说明行：ShellTip / ECharts 读数 / 光伏 cz-tip / SVG 读数 | 待用户定 | 延迟不同（图表读数要零延迟跟鼠标）这点不改；五族外观要不要统一成一种，待用户定 |
| 44 | s6_0 06-A 第 8 行末格白卡 | 06-A 悬停说明行：页签悬停卡 | 不做 | TAB-BAR-SPEC 另有定义，保持 |
| 45 | s6_0 06-B 上排第 1 格 | 06-B ① 就地标记卡（● 缺起止日期 ● 比上月少 1.43） | T06（S1） |  |
| 46 | s6_0 06-B 上排第 2 格 | 06-B ② 入口胶囊卡（待处理 5 / 无待处理） | T07（S1） |  |
| 47 | s6_0 06-B 上排第 3 格 | 06-B ③ 问题面板卡（待重算 2 · 参数改过 · 重算本月） | T07（S1） |  |
| 48 | s6_0 06-B 上排第 4 格 | 06-B ④ 块内提示卡（黄：租金行还没绑单元；红：删除后不能撤销） | T06（S1） |  |
| 49 | s6_0 06-B 上排第 5 格 | 06-B ⑤ 字段报错卡（红框 + 请输入合同号） | T06（S1） |  |
| 50 | s6_0 06-B 下排第 1 格 | 06-B ⑥ 页面状态卡（本月未生成 / 编辑中·3 处改动 / 显示 2026-08 · 9 月无数据） | T06（S1） |  |
| 51 | s6_0 06-B 下排第 2 格 | 06-B ⑦ 空状态·加载失败卡（还没生成·生成本月 / 没读到·重试） | T05（S1） |  |
| 52 | s6_0 06-B 下排第 2 格「替代」行 | 06-B ⑦ 替代「空状态 150 处」中手写的非 AnaEmpty 空态 ~86 处 | 待用户定 | 规范 §4：手写空态约 86 处换不换成 ⑦ 一种样子，待用户定 |
| 53 | s6_0 06-B 下排第 3 格 | 06-B ⑧ 结果回执卡（已保存「A座」） | T01（S1） |  |
| 54 | s6_0 06-B 下排第 3 格替代行 | 06-B ⑧ 替代「版本更新改进铃铛」 | 不做 | 归 06-E/F 通知块 |
| 55 | s6_0 06-B 下排第 4 格 | 06-B ⑨ 确认弹窗卡（删除 76 条读数？取消 / 删除 76 条） | T02（S1） |  |
| 56 | s6_0 06-B 下排第 4 格替代行 | 06-B ⑨ 替代「自写遮罩弹窗 16 处」 | T26（S4） |  |
| 57 | s6_0 06-B 下排第 5 格 | 06-B ⑩ 悬停说明卡（原册 D 列：这一行电表的用途） | T03（S1） |  |
| 58 | s6_1 06-C 左大卡 | 06-C 方案 A 公共电核算「待处理 5 ▾」+ 贴附面板（待重算 2 展开两行 · 重算本月；本次生成告警 2、池成员变动 1 收起） | T16（S3/S4） |  |
| 59 | s6_1 06-C 左卡底 | 06-C 方案 A 三条脚注（离问题近 / 点一条跳到行闪一下 / 多于 20 条面板内滚动） | T07（S1） |  |
| 60 | s6_1 06-C 右大卡（灰） | 06-C 方案 B 居中弹卡 | 不做 | 未选（画布标「未选」） |
| 61 | s6_1 06-D 左格 | 06-D 左 通知进铃铛 | FE-PANEL（S5） |  |
| 62 | s6_1 06-D 中格标题行 | 06-D 中 经营驾驶舱期间旁「显示 2026-08 · 9 月无数据」 | T11（S4） |  |
| 63 | s6_1 06-D 中格内卡 | 06-D 中 收入构成卡头「显示 2026-07」 | T11（S4） |  |
| 64 | s6_1 06-D 右格 | 06-D 右 加载失败（红圈图标 / 2023 年 8 月的数据没读到 / 屏上不显示上个月的数字 / 重试） | T05（S1） |  |
| 65 | s6_1 下半 + s6_2 + s6_3 | 06-E 现有通知表、06-F 铃铛面板、06-G 铃铛记号 | S5 各任务 | 06-E/F/G 逐块见 #128–#179 |
| 66 | s3_0 y≈229 | 03-A 链路条（换出账月 2023-08 · 五道工序） | 不做 | 现状已是此样（FPStepStrip），不改 |
| 67 | s3_0 y≈172 右 | 03-A 顶栏「只有你在线 · 搜索」 | 不做 | 09-29 拍板顶栏不动 |
| 68 | s3_0 y≈272 左 | 03-A 标题行左：公共电核算 + 一期/二期/三期/宿舍 | P4-B1（S3） |  |
| 69 | s3_0 y≈272 右首 | 03-A 标题行右：待处理 27 胶囊 | 不做 | 依赖 P1/P2 入口胶囊+问题面板，本屏位置已对，不改调用 |
| 70 | s3_0 y≈272 右 | 03-A 标题行右：导出当月 / 交审 2 项 / 编辑模式 | P4-B1（S3） |  |
| 71 | s3_0 y≈328 右 | 03-A 卡内工具条：分时用量开关 + 列 · 2 列隐藏 | P4-B2（S3） |  |
| 72 | s3_0 y≈372 | 03-A 表头 12 列单行（位置…加减度数），应分摊列蓝下划浅底 | P4-B2（S3） |  |
| 73 | s3_0 y≈411/451/731 | 03-A 分组行兼小计（园区级 1 个池 收起 / A座及园区公共表 6 个池 7,448.52 8,538.00） | P4-B3（S3） |  |
| 74 | s3_0 y≈491–931 | 03-A 数据行：位置灰区域+楼层、用途单行、电表①、倍率、读数两位、应分摊加粗、分摊方式签、分摊标准、分摊基数 ↗、加减度数 | P4-B3（S3） |  |
| 75 | s3_0 y≈811 电表列 | 03-A 电表格「新表」小签 | P4-B3（S3） |  |
| 76 | s3_0 y≈611 | 03-A 招商中心电1 行：› 展开 + 冲减 5 表 | P4-B3（S3） |  |
| 77 | s3_0 y≈771 | 03-A 无绑定表行（联塑精铟 全 –） | P4-B3（S3） |  |
| 78 | s3_0 y≈979 | 03-A 合计行 7,584.52 / 8,693.88（加粗浅底） | P4-B3（S3） |  |
| 79 | s3_0 注 3（交互态） | 03-A 分时用量打开后 尖峰平谷 4 列 | P4-B2（S3） |  |
| 80 | s3_0 注 4；y≈328「列 · 2 列隐藏」 | 03-A 列菜单：实收/盈亏默认隐藏 | P4-B2（S3） |  |
| 81 | s3_0 y≈691「80,000 m² ↗」 | 03-A 分摊基数/加减度数悬停 ↗ 去计费参数 | P4-B3（S3） |  |
| 82 | s3_0 y≈1055–1073 | 03-A 底部四条注释 | 不做 | 画布说明文字，不上屏（屏上不许提设计稿） |
| 83 | s3_0 y≈116 右 | 03-A 右上「现状」缩略图 | 不做 | 画布对照图，不上屏 |
| 84 | s3_0 y≈1171 | 03-B 已生成：标题+段控+导出当月+编辑模式 | P4-B1（S3） |  |
| 85 | s3_0 y≈1247 | 03-B 未生成·编辑模式：● 本月未生成 标签 + 新增池 + 生成本月 + 完成 | P4-B1（S3） |  |
| 86 | s3_0 y≈1323–1500；s3_1 顶 | 03-B 加载失败：图标 + 「2023 年 8 月的池数据没读到」+ 重试 占住内容区 | P4-B1（S3） |  |
| 87 | s3_1 左卡 | 03-C 现状卡（12px 居中两行挤一格 蓝字） | 不做 | 现状对照，不做 |
| 88 | s3_1 右卡 | 03-C 改后卡：40 行高/14 正文/12 表头/2 位小数/0 字距、字左数右、钱加粗 | P4-B5（S3） |  |
| 89 | s4_0 y≈147–204 | 04-A 链路条 + 顶栏 | 不做 | 现状已是此样 / 顶栏不动 |
| 90 | s4_0 y≈247 左 | 04-A 标题行左：园区抄表 + 租户表已抄 76 / 78 + 期区段控 | P4-C1（S3） |  |
| 91 | s4_0 y≈247 右 | 04-A 标题行右（浏览）：导出当月 / … / 编辑模式 | P4-C1（S3） |  |
| 92 | s4_0 y≈294 | 04-A 第二行：电表/水表 + 全部 / 未抄 2 / 待核 1 + 全部归属 + 搜索 | P4-C2（S3） |  |
| 93 | s4_0 y≈349 | 04-A 卡内工具条：分时列开关 + 列 | P4-C4（S3） |  |
| 94 | s4_0 y≈393 | 04-A 表头 位置/用途/房号/租户/表号/编码/倍率/上月行至/本月行至/用量/状态 | P4-C4（S3） |  |
| 95 | s4_0 y≈432 | 04-A 组头兼小计「A座 13 块 144,183.58」可收起 | P4-C5（S3） |  |
| 96 | s4_0 y≈473–575 | 04-A 分时表 A座总电 ⌄ 展开 峰段/平段/谷段 三行 | P4-C5（S3） |  |
| 97 | s4_0 y≈609–1049 | 04-A 数据行：归属签（配电总表/园区公摊/园区自担）、● 本月册子没有、新表签、编码、读数两位 | P4-C4（S3） |  |
| 98 | s4_0 y≈609 右「未抄」 | 04-A 状态列只写不正常（未抄），已抄留空 | P4-C4（S3） |  |
| 99 | s4_0 y≈1089 | 04-A 组尾「另有 3 块已停用 显示」 | P4-C5（S3） |  |
| 100 | s4_0 y≈1136 | 04-A 合计 2,892,034.93（无已抄/未抄字样） | P4-C4（S3） |  |
| 101 | s4_0 y≈1282 | 04-B 编辑态标题行：编辑中 · 3 处改动 + 租户表已抄 + 段控；导入▾ / 新增表 / … / 完成 | P4-C1（S3） |  |
| 102 | s4_0 y≈1328–1400 | 04-B 「…」打开态：导出当月 / 下载模板 / 批量删除本期（红） | P4-C1（S3） |  |
| 103 | s4_0 y≈1374–1476 | 04-B 分时段行输入格 + 回车 总→峰→平→谷 | P4-C6（S3） |  |
| 104 | s4_1 y≈10 | 04-B 缺底数行「底数」输入格 | P4-C6（S3） |  |
| 105 | s4_1 y≈90 | 04-B 倒走行：99.8 红框、−28.60、「比上月少 1.43」 | P4-C6（S3） |  |
| 106 | s4_1 左卡 | 04-C 宿舍 0/299：不出分时列也不出开关 | P4-C4（S3） |  |
| 107 | s4_1 中卡 | 04-C 一期 49/184：默认只看总数，分时表那一行点开 | P4-C5（S3） |  |
| 108 | s4_1 右卡 | 04-C 二期 63/69：分时列默认打开 | P4-C4（S3） |  |
| 109 | 无图（09-29 拍板） | 04 开关记住上次选择（公摊同一套） | P4-A1（S3） |  |
| 110 | s4_0 表格行距 | 04 字距与行（40 行高/两位小数） | P4-C7（S3） |  |
| 111 | s5_0 y≈147–204 | 05-A 链路条「2023-09（8 月水电）」+ 顶栏 | 不做 | 现状已是此样 / 顶栏不动 |
| 112 | s5_0 y≈247 左 | 05-A 标题行左：催缴单 + 一期/二期/三期 | 不做 | 现状已是此样（胶囊挪走由 P4-D1 做） |
| 113 | s5_0 y≈247 右 | 05-A 标题行右：待处理 5 / 簿册▾ / 导出▾ / 编辑模式 | P4-D1（S3） |  |
| 114 | s5_0 y≈294–366 | 05-A 簿册下拉打开态：收款公司/收款簿/系数簿 | P4-D1（S3） |  |
| 115 | s5_0 y≈294 左 | 05-A 状态页签：全部 12/待核对 7/已确认 3/已导出 2/有警告 4 | P4-D2（S3） |  |
| 116 | s5_0 y≈294 右（被下拉遮住） | 05-A 搜租户名（页签行右端） | P4-D2（S3） |  |
| 117 | s5_0 y≈349 右 | 05-A 卡内工具条「批量确认」 | P4-D1（S3） |  |
| 118 | s5_0 y≈393 | 05-A 表头 租户/位置/本期合计（元）/月租金参考（元）/状态/警告（无行数） | P4-D3（S3） |  |
| 119 | s5_0 y≈432/780/820 | 05-A 分组行「A座 7 户」+ 两列小计，B座/C座 收起 | P4-D3（S3） |  |
| 120 | s5_0 y≈475–739 | 05-A 数据行：状态签四色、警告写类别 +1、● 缺收款公司、负数红、行尾 › | P4-D3（S3） |  |
| 121 | s5_0 y≈563 广联 | 05-A 行悬停「确认」钮 | 不做 | 现状已有 .bn-cfm，保持编辑态才出（见 open_questions） |
| 122 | s5_0 y≈864 | 05-A 合计 215,786.94 / 206,814.02 | P4-D3（S3） |  |
| 123 | s5_0 x≈1115–1235 浅蓝列 | 05-A 本期合计列加粗浅底（03-C 同一套） | P4-D6（S3） |  |
| 124 | s5_0 y≈1006 | 05-B 未生成·编辑模式标题行：无待处理 / 簿册▾ / 完成 | P4-D1（S3） |  |
| 125 | s5_0 y≈1130–1200 | 05-B 空状态：2023-09 的催缴单还没生成 + 说明句 + ▷ 生成本月 | P4-D4（S3） |  |
| 126 | s5_0 y≈1431 | 05-C 选择条：已选 3 户 · 其中 1 户缺收款公司 / 全选待核对 / 确认 3 户 / 退出 | P4-D5（S3） |  |
| 127 | s5_1 全图 | 05-C 勾选列：已确认/已导出禁用淡显、选中行蓝底、「A座 7 户 · 可确认 5」 | P4-D5（S3） |  |
| 128 | s6_1 中部左格 | 06-D 左格 通知预览（铃铛 4 + 小面板 4 行） | FE-PANEL（S5） |  |
| 129 | s6_1 中部中格 | 06-D 中格 分析屏期间回退 | T11（S4） | 同 #62–#63 |
| 130 | s6_1 中部右格 | 06-D 右格 加载失败带重试 | T05（S1） | 同 #64 |
| 131 | s6_1 下部表头上方 | 06-E 顶部五个数（25/3/9/3 秒/没有） | 不做 | 画布盘点数，不上屏 |
| 132 | s6_1 表第 1 行 | 06-E 等你处理·同事请你远程授权（不变，搬进面板） | FE-PANEL（S5） |  |
| 133 | s6_1 表第 2 行 | 06-E 等你处理·有表等你审（不变） | FE-PANEL（S5） |  |
| 134 | s6_1 表第 3 行 | 06-E 等你处理·你交的表被退回（逐张列出带理由） | BE2（S5） |  |
| 135 | s6_1 表「进铃铛·有结果了」第 1 行 | 06-E 有结果了·授权批准了 | BE3（S5） |  |
| 136 | s6_1 表有结果了第 2 行 | 06-E 有结果了·授权被拒绝 | BE3（S5） |  |
| 137 | s6_1 表有结果了第 3 行 | 06-E 有结果了·授权超时（取消不算超时） | FE-ELEV（S5） |  |
| 138 | s6_1 表末行 / s6_2 顶 | 06-E 有结果了·你交的表审核通过 | BE2（S5） |  |
| 139 | s6_2 表第 1 行 | 06-E 有结果了·审核被撤销（带理由） | BE2（S5） |  |
| 140 | s6_2 表第 2 行 | 06-E 有结果了·催缴单被取消确认或作废（带理由） | BE4（S5） |  |
| 141 | s6_2 表第 3 行 | 06-E 有结果了·角色或权限被改「刷新后生效」 | BE5（S5） |  |
| 142 | s6_2 系统组第 1 行 | 06-E 系统·发了新版本（进铃铛带刷新） | FE-UPD（S5） |  |
| 143 | s6_2 系统组第 2 行 | 06-E 系统·有没看过的更新记录（三处点收进铃铛） | FE-DOT（S5） |  |
| 144 | s6_2 当场出现组第 1 行 | 06-E 当场·编辑权被接管 | 不做 | 改后列写「不变」 |
| 145 | s6_2 当场出现组第 2 行 | 06-E 当场·编辑态失效 | 不做 | 改后列写「不变」 |
| 146 | s6_2 当场出现组第 3 行 | 06-E 当场·正在编辑的表被交审或审核通过 | FE-STOP（S5） |  |
| 147 | s6_2 当场出现组第 4 行 | 06-E 当场·临时授权到期（底部一句） | FE-APP（S5） |  |
| 148 | s6_2 当场出现组第 5 行 | 06-E 当场·临时授权被系统提前收回 | BE6（S5） |  |
| 149 | s6_2 当场出现组第 6 行 | 06-E 当场·断网或服务出错走结果回执 | T04（S1） | AppShell 断网条改失败回执带「刷新」 |
| 150 | s6_2 当场出现组第 7 行 | 06-E 当场·别的标签页退出或换了账号（居中弹窗只有刷新） | FE-APP（S5） |  |
| 151 | s6_2 当场出现组第 8 行 | 06-E 当场·这一页属于新版本 | 不做 | 不变；FE-UPD 保留 blocked 那条 |
| 152 | s6_2 登录页组第 1 行 | 06-E 登录页·在别处登录或密码被改 | 不做 | 改后列写「不变」 |
| 153 | s6_2 登录页组第 2 行 | 06-E 登录页·账号被停用 | BE5（S5） |  |
| 154 | s6_2 登录页组第 3 行 | 06-E 登录页·登录过期 | FE-LOGIN（S5） |  |
| 155 | s6_2 登录页组第 4 行 | 06-E 登录页·管理员重置了你的密码 | 不做 | 改后列写「不变」 |
| 156 | s6_2 最后一组 | 06-E 照旧自动弹·本次更新弹卡 | 不做 | 改后列写「不变」 |
| 157 | s6_2 表下方一行 | 06-E 表脚「不算通知，留在原处」 | 不做 | 原处不动 |
| 158 | s6_2 下部左上 | 06-F 面板顶铃铛红 4 | FE-BELL（S5） |  |
| 159 | s6_2 面板第 1 组头 | 06-F 等你处理组头「等你处理 4」 | FE-PANEL（S5） |  |
| 160 | s6_2 面板第 1 行 | 06-F 授权请求行（头像/一句/小字/1:42/你的密码/拒绝/批准/后果一句） | FE-PANEL（S5） |  |
| 161 | s6_2 面板第 2、3 行 | 06-F 待审行 ×2（文档图标、X 交 · N 分钟前、›） | FE-PANEL（S5） |  |
| 162 | s6_2 面板第 4 行 | 06-F 被退回行（撤回图标、审核人：理由 · 时刻、›） | FE-PANEL（S5） |  |
| 163 | s6_2 面板底 / s6_3 面板顶 | 06-F 有结果了组（未看行左侧小蓝点，4 行） | FE-PANEL（S5） |  |
| 164 | s6_3 面板系统组第 1 行 | 06-F 系统组·新版本行「刷新」 | FE-PANEL（S5） |  |
| 165 | s6_3 面板系统组第 2 行 | 06-F 系统组·更新记录行「看看」（新增 3 项 · 改进 2 项） | FE-PANEL（S5） |  |
| 166 | s6_3 面板底 | 06-F 面板底「全部标为已读」 | FE-PANEL（S5） |  |
| 167 | s6_2 右上三卡 | 06-F 右·铃铛上的记号三卡（红数字/蓝点/什么都没有） | FE-BELL（S5） |  |
| 168 | s6_2 右中三卡 | 06-F 右·三类怎么消失三卡 | FE-BELL-STORE（S5） |  |
| 169 | s6_2 右下签条 | 06-F 右·不进铃铛当场出现 9 个签 | FE-APP（S5） |  |
| 170 | s6_2 右下最后一行 | 06-F 右·底注（70% 高、手机贴顶栏满宽、点整行跳转） | FE-PANEL（S5） |  |
| 171 | s6_3 中上六卡 | 06-G 一天里记号怎么变（09:00→11:00 六格） | FE-BELL-STORE（S5） |  |
| 172 | s6_3 中部放大 2 倍一排 | 06-G 长什么样（蓝点 8×8 / 1 位 16×16 / 2 位 / 99+ / 没有记号） | FE-BELL（S5） |  |
| 173 | s6_3 规则表 1–4 行 | 06-G 规则·数字还是点 / 两种都有 / 数的是什么 / 红数字何时减 | FE-BELL-STORE（S5） |  |
| 174 | s6_3 规则表第 5 行 | 06-G 规则·蓝点何时消失（行蓝点关面板变灰） | FE-PANEL（S5） |  |
| 175 | s6_3 规则表 6–10 行 | 06-G 规则·封顶 / 0 / 位置和大小 / 出现消失 120ms / 读屏 | FE-BELL（S5） |  |
| 176 | s6_3 规则表第 11 行 | 06-G 规则·只挂在铃铛上 | FE-TOOLBAR（S5） |  |
| 177 | s6_3 规则表末行 | 06-G 规则·多个标签页、多台电脑 | BE6（S5） |  |
| 178 | 06-E 第 1 行「现在在哪」列 | 本月出账主管条「待批授权 N」点开铃铛面板 | FE-HOME（S5） |  |
| 179 | 06-F 底注手机一句 | 手机顶栏铃铛 | FE-MTB（S5） |  |
| 180 | s7_0 顶部标题行右侧灰字 | 07 节标题下的说明（例子是月度台账、未进浏览器实测） | 不做 | 画布自述，不是界面 |
| 181 | s7_0 07-A 卡左列第一行 | 07-A 1920 现状条（固定 794 占 63%，中间约 4 列） | 不做 | 现状对照 |
| 182 | s7_0 07-A 卡右列第一行 | 07-A 1920 改后条：租户·上月结余 / 7 列 / 应收合计·本月结余，收款、备注退成普通列（480，38%） | W2（S2） |  |
| 183 | s7_0 07-A 卡左列第二行 | 07-A 1366 现状条（左右压住 94px 红斜纹） | 不做 | 现状对照 |
| 184 | s7_0 07-A 卡右列第二行 | 07-A 1366 改后条：只留租户和本月结余（248，35%） | W2（S2） |  |
| 185 | s7_0 07-A 卡左列第三行 | 07-A 1024 现状条（压住 201px） | 不做 | 现状对照 |
| 186 | s7_0 07-A 卡右列第三行 | 07-A 1024 改后条：租户收到 1/5 省略 + 本月结余（235，正好 40%） | W2（S2） |  |
| 187 | s7_0 07-A 1024 改后条下的说明 | 名字省略后悬停看全称 | W2（S2） |  |
| 188 | s7_0 07-A 右列三行里上月结余右边、应收合计/本月结余左边的竖线 | 改后条里固定列内沿的分隔竖线（阴影挪到还固定的最里面一列） | W1（S2） |  |
| 189 | s7_0 07-A 卡左下角 | 07-A 图例（固定列 / 跟着滚的列 / 互相压住 / 1:2 缩小） | 不做 | 画布图例 |
| 190 | s7_0 07-B 卡第一列 | 07-B 现状示意（分组表头贴顶 34 + 列名 38 + 6 行 + 合计贴底 40，红字只露约 6 行） | 不做 | 现状对照 |
| 191 | s7_0 07-B 卡第二列 | 07-B 改后·往下滚时：只贴列名，合计跟在最后一行后，露约 8.8 行 | W1（S2） |  |
| 192 | s7_0 07-B 卡第三列 | 07-B 改后·更矮的屏：表格保留 8 行高，↓整页继续往下滚 | W1（S2） |  |
| 193 | s7_0 07-B 三列示意的上半截 | 07-B 顶栏 48 / 页签条 44 / 页头约 164 三块 | 不做 | 外壳尺寸只是算高度的背景，不改 |
| 194 | s7_0 07-B 卡右侧清单第 1 条 | 「按顺序让」第 1 步：屏顶瘦身（统计卡改页签、说明进悬停） | 不做 | 稿注明 04-A、05-A 已画，归 s4 园区抄表 / s5 催缴单那两批 |
| 195 | s7_0 07-B 右侧清单第 2 条 | 「按顺序让」第 2 步：分组表头不贴顶 | W1（S2） |  |
| 196 | s7_0 07-B 右侧清单第 3 条 | 「按顺序让」第 3 步：合计行不贴底 | W1（S2） |  |
| 197 | s7_0 07-B 右侧清单第 4 条 | 「按顺序让」第 4 步：表格最少 8 行高、整页往下滚 | W1（S2） |  |
| 198 | s7_0 07-B 右侧清单下的段落 | 够 8 行时什么都不让；只按表格区实际高度判断 | W1（S2） |  |
| 199 | s7_0 07-C 规则表第 1 行 | 07-C 规则：按表格自己的宽度算 | W1（S2） |  |
| 200 | s7_0 07-C 规则表第 2 行 | 07-C 规则：固定列最多占 40% | W1（S2） |  |
| 201 | s7_0 07-C 规则表第 3 行 | 07-C 规则：超了按先后退 + 月度台账顺序 | W2（S2） |  |
| 202 | s7_0 07-C 规则表第 4 行 | 07-C 规则：退掉的列原地变普通列、阴影挪 | W1（S2） |  |
| 203 | s7_0 07-C 规则表第 5 行 | 07-C 规则：备注这类说明文字不固定 | W2（S2） |  |
| 204 | s7_1 规则表第 1 行 | 07-C 规则：名称列最多占 1/5 | W1（S2） |  |
| 205 | s7_1 规则表第 2 行 | 07-C 规则：固定数字列不再锁死 128（含园区抄表读数锁 96） | W2（S2） |  |
| 206 | s7_1 规则表第 3 行 | 07-C 规则：只在宽度变了时重算，换数据重算列宽，滚动翻页不重算 | W1（S2） |  |
| 207 | s7_1 下表第 1 行 | 7 张表 · 月度台账行 | W2（S2） |  |
| 208 | s7_1 下表第 2 行 | 7 张表 · 园区抄表行 | W7（S3） |  |
| 209 | s7_1 下表第 3 行 | 7 张表 · 损益附表 1–5 行（含编辑态 640–696） | W4（S2） |  |
| 210 | s7_1 下表第 4 行 | 7 张表 · 附表10 销售收入行 | W3（S2） |  |
| 211 | s7_1 下表第 5 行 | 7 张表 · 公共电核算行 | W8（S3） |  |
| 212 | s7_1 下表第 6 行 | 7 张表 · 楼栋损耗行 | W6（S2） |  |
| 213 | s7_1 下表第 7 行 | 7 张表 · 附表12 工资行 | W5（S2） |  |
| 214 | s7_1 下表最右一列 | 「小屏上」红字列（现状问题） | 不做 | 现状说明，由上面七行各自的任务消掉 |

## 1.1 对稿复查后的修订（2026-10-01，`mockup-coverage-check` 对 16 张图数出 31 处）

本节**压过** §2 里对应任务的「改 / 验」原文。实现者先读这里。

**补落点**
- T12 加两处：合同列表行缺起止日期的挂 `FPMark`「缺起止日期」（01-A 卡1）；合同「标的段与费用」里租金行未绑单元时出 `FPNote`「租金行还没绑单元 · 去绑定」（01-A 卡3）。
- 新任务 **T06b**（S1 补）：`ds/Input.vue` 的 `.ds-in-msg` 从 14 改成 18 常驻占位（06-B ⑤），断言红框 + 18 高；`FPStateTag` 断言 22 高和三种 tone。
- 新任务 **T08b 切账期离开确认**（S1 补）：`useEditMode` 里 scope 变了就 `exit()` 的地方（`useEditMode.ts:300` 附近）、`FPStepStrip`「换出账月」、顶栏期下拉，换期前对当前屏 `dirty > 0` 走 `askLeave`，点「继续编辑」则期不变；`dirty = 0` 照旧直接换。断言两态。
- T09 验补：页签 `dirty > 0` 时有 6px 橙点、`= 0` 时没有；退出登录 `dirty > 0` 出确认、`= 0` 不出。
- 钱那一列（公共电核算「应分摊」、园区抄表「用量」、催缴单「本期合计」）：加粗 + 整列浅蓝底 + **表头下蓝色下划线**（03-A / 04-A / 05-A 同形），归 P4-B5 / P4-C7 / P4-D6。
- P4-B3 加三条：冲减载体行在电表列写「冲减 N 表」；无绑定表的池整行写「–」；分摊基数 / 加减度数悬停带「↗ 去计费参数」。各一条断言。
- P4-C4 / P4-C6：缺底数行的「底数」输入格保住（`MeterLedgerGrid.vue:387` 附近现有功能），加断言。

**验收判据改硬**
- P4-B5 / P4-C7 / P4-D6：原「样式源不含 --brand」改前就绿（现状用的是 `--hue-blue`），作废。改钉：钱格文字不用 `--hue-blue`、正文 14、表头 12、行高 40、字距 0、钱列背景非空、表头下线存在。
- P4-C4：分时列打开时列名照 04-C 二期卡写「尖 / 峰 / 平 / 谷」，跟在「本月行至」后；「本月尖」这种字是计划自造的，作废。

**同文件三种说法收成一种（园区抄表）**
- 「只看存疑」→ 入口胶囊（筛选态实底 + ×），存疑数 > 0 才出（04-A 的夹具存疑为 0，所以图上没有）。
- `mt-hidbar`（已拆 / 未在册说明）删，说明挪到「已拆」「未在册」页签的悬停说明；这两个页签非零才出。
- `mt-bookbar`（本月没导册子）→ 标题旁页面状态「本月没导册子」。
- P4-C2、P4-C3、T18 以本条为准。

**其他**
- 入口胶囊凡是点开出面板的一律带 ▾（06-C、01-B 画了；03-A、05-A 的缩略里省了）。
- 表内列组之间的整高竖分隔线照图画（03-A 三条、04-A 按列组），1px `--line`。
- 06-D 左格是缩略，铃铛面板以 06-F 为准（分三组、逐表一行、授权当场输密码）。
- §2 的依赖「P1/P2 页面状态标签 / 空状态·加载失败 / 悬停说明 / 入口胶囊」分别是 T06 / T05 / T03 / T07。
- `FPToast` 的卡内回执（19 屏 23 处）不进底部队列，只统一时长和失败档（规范 §1.1）。

## 2. 阶段与任务

任务编号沿用勘察清单：T = 提示件，W = 宽表，P4- = 三屏，BE / FE- = 铃铛。

### S1 地基

**T01 结果回执标准件**〔M〕
- 文件：`utils/receipt.ts`、`components/fp/FPReceiptHost.vue`、`components/fp/FPToast.vue`、`components/fp/__tests__/hintFoundation.spec.ts`
- 改：新建 receipt 模块级队列（最多 3 条挤掉最旧）与 FPReceiptHost 底部居中渲染：成功 4 秒自收，失败不自收带动作钮+×。FPToast 默认 duration 改 4000，tone=error 不自收并支持 retryText/@retry。
- 稿 / 规：01-A 卡5；02-C；06-B ⑧｜LAYOUT-STABILITY §4.1；UI-OVERLAY §7；hints.prompt §二⑧
- 验：fake timers：连推 4 条 DOM 只剩后 3 条；ok 在 3999ms 在、4000ms 消失；fail 过 60s 仍在，点「重试」调到 run 一次。

**T02 确认弹窗 + 离开确认标准件**〔M〕
- 文件：`utils/ask.ts`、`components/fp/FPConfirmHost.vue`、`components/fp/__tests__/hintFoundation.spec.ts`
- 改：新建 ask()→Promise<boolean> 与 FPConfirmHost（居中 440，标题问句，主钮写动作，danger 默认焦点在取消，Esc/点外=false，z 用 --z-confirm）。附 askLeave：count=0 直接 true 不弹，否则「关闭「页」？/这页有 N 处改动还没保存。/继续编辑/放弃改动并关闭」。
- 稿 / 规：01-A 卡6；02-A 弹窗；02-B 左右两张；06-B ⑨｜UI-OVERLAY §7；LAYOUT-STABILITY §4.1；EDIT-MODE §6.1；hints.prompt §二⑨
- 验：ask({danger:true}) 后 document.activeElement 文本=「取消」；Esc resolve false；askLeave({count:0}) resolve true 且 DOM 无确认卡。

**T03 悬停说明 v-tip 指令**〔M〕
- 文件：`directives/tip.ts`、`main.ts`、`test-setup.ts`、`components/fp/__tests__/hintFoundation.spec.ts`
- 改：新建全局指令 v-tip：单例深色 12px 气泡挂 body，停 500ms 出、按下即收、触屏点一下出，无文字宿主补 aria-label。main.ts 与 test-setup.ts（config.global.directives）注册。
- 稿 / 规：06-B ⑩；06-A 悬停说明行｜LAYOUT-STABILITY §4.3；hints.prompt §二⑩；TAB-BAR §6.4（ShellTip 同款）
- 验：<button v-tip="'x'">：mouseenter 后 499ms 无 .fp-tip、500ms 有且文本 x；元素无 title 属性；pointerdown(pointerType=touch) 立即出。

**T04 AppShell 挂两个 host，断网条改回执**〔S〕　依赖 T01、T02
- 文件：`components/shell/AppShell.vue`
- 改：AppShell 挂 FPReceiptHost 与 FPConfirmHost；fp-net-toast 改 receipt.fail(ui.netError, {label:'刷新'})。fp-upd-toast 不动（归通知块）。
- 稿 / 规：06-B ⑧「替代 2 种自写（断网）」｜PAGE-BEHAVIOR §5.2 断网行
- 验：置 ui.netError → 出一条带「刷新」的失败回执，DOM 无 .fp-net-toast。

**T05 空状态 / 加载失败标准件**〔M〕
- 文件：`components/fp/FPEmpty.vue`、`components/fp/FPLoadError.vue`、`components/ana/AnaEmpty.vue`、`components/fp/__tests__/hintPieces.spec.ts`、`views/__tests__/noInteractionLayoutShift.spec.ts`
- 改：新建 FPEmpty（图标方块+一句+副句+至多一钮，占住内容区居中）；FPLoadError 改成它的 error 档（默认插槽一句、sub 副句、钮恒为「重试」），不再是流内红条。AnaEmpty 换同外形，props 不变；noInteractionLayoutShift 里把 FPLoadError 当流内条的注释/白名单改掉。
- 稿 / 规：06-B ⑦；06-D 右格；01-A 规则条右｜LAYOUT-STABILITY §3、§4 加载失败行；hints.prompt §四
- 验：mount FPLoadError sub=… → role=alert、含副句、唯一按钮文本「重试」点击 emit retry；根节点无 .fp-lderr 类。

**T06 页面状态 / 块内提示 / 就地标记 / 字段报错标准件**〔S〕
- 文件：`components/fp/FPStateTag.vue`、`components/fp/FPNote.vue`、`components/fp/FPMark.vue`、`styles/base.css`、`components/fp/__tests__/hintPieces.spec.ts`
- 改：新建 FPStateTag（22 高，warn/edit/muted）、FPNote（12px 圆角 8，info/warn/danger，#action 插槽，无竖条无虚线）、FPMark（6px 点+12px 字）。base.css 加 .fp-field-err（12px 红，line-height/min-height 18px）。
- 稿 / 规：01-A 卡1/3/4；06-B ①④⑤⑥｜LAYOUT-STABILITY §2、§4.2；hints.prompt §一、§二
- 验：FPMark tone=danger 渲染 .dot+文本；FPNote tone=warn 根类含 warn、无 border-left；base.css 文本含 .fp-field-err 且 min-height: 18px。

**T07 入口胶囊 + 问题面板**〔M〕
- 文件：`components/fp/FPAlertChip.vue`、`components/fp/FPAlertPanel.vue`、`components/fp/__tests__/alertPanel.spec.ts`
- 改：FPAlertChip 改 28 高带 ▾，有/无/筛选生效（实底+× emit clear）三态；FPAlertPanel 从 FPSideDrawer 改成以 chip 为触发的 ds/Popover，420 宽不变暗，组头可收起、带件数与处理钮，明细可点，>20 条面板内滚动，另留默认插槽。
- 稿 / 规：06-B ②③；06-C 方案 A；01-A 卡2｜LAYOUT-STABILITY §6；PAGE-BEHAVIOR §2 2026-09-30 注；UI-OVERLAY §7.1
- 验：点 chip → 出 width 420 面板且 DOM 无 .fp-sdw-mask；点组头明细收起；Esc、点外都关；21 条明细时列表容器 overflow:auto；count=0 显「无待处理」。

**T08 编辑登记表带改动数，关浏览器只在有改动时拦**〔M〕
- 文件：`stores/auth.ts`、`composables/useEditLock.ts`、`composables/useEditMode.ts`、`stores/__tests__/auth.spec.ts`、`composables/__tests__/useEditLock.spec.ts`
- 改：openEditor 加第三参 dirty?: () => number（缺省按 1，宁可多问），新增 dirtyOn(screen)/dirtyTotal；beforeunload 只在 dirtyTotal>0 时 preventDefault。useEditLock/useEditMode 加 dirty 透传。
- 稿 / 规：02-A 注「0 处改动时不弹」；02-D 中右两卡｜EDIT-MODE §6.1；UI-OVERLAY §7 关浏览器；TAB-BAR 行 52
- 验：登记 dirty=()=>0 后派发 beforeunload，defaultPrevented=false；换成 ()=>3 为 true 且 dirtyOn(screen)===3。

**T09 关页签 / 退出登录走离开确认，页签挂改动点**〔M〕　依赖 T02、T08
- 文件：`components/shell/TabStrip.vue`、`components/shell/__tests__/tabStrip.spec.ts`、`stores/tabs.ts`、`components/shell/IconRail.vue`、`components/shell/mobile/MobileNavDrawer.vue`
- 改：okToDrop 改 async 按 auth.dirtyOn 逐页 askLeave（关页签/重新加载/关闭其他/关闭右侧），页签 dirty>0 时 × 前挂 6px 橙点；IconRail/MobileNavDrawer 退出登录先对 dirty>0 的屏 askLeave。这三个文件的原生 title 顺手换 v-tip。
- 稿 / 规：02-A 页签条与弹窗｜TAB-BAR 行 52；UI-OVERLAY §7；EDIT-MODE §6.1
- 验：tabStrip.spec：dirty=0 关页签无确认卡且页签消失；dirty=3 出「关闭「园区抄表 · 2023-08」？」「这页有 3 处改动还没保存。」，点继续编辑后页签仍在。

**T10 收藏提示改回执**〔S〕　依赖 T01
- 文件：`components/shell/Toolbar.vue`、`components/shell/__tests__/toolbar.spec.ts`
- 改：☆ 下方 fp-star-note 深色条改 receipt.ok('已收藏，在「首页」上能找到', {label:'撤销'})。铃铛部分不动。
- 稿 / 规：06-B ⑧「替代…收藏」｜TAB-BAR 行 138
- 验：点 ☆ → 回执含「撤销」，DOM 无 .fp-star-note；点撤销收藏数回退。


### S2 宽表

**W1 共享件 useWideTable：固定列退列 + 表格高度分级**〔M〕
- 文件：`composables/useWideTable.ts`、`composables/__tests__/useWideTable.spec.ts`
- 改：新建纯函数 planFixed/heightStage/numW/textW 和 composable useWideTable（RO 量表格可见宽高，只在宽高真变时重算）。不碰任何表。
- 稿 / 规：07-A 三行改后；07-B 改后两块 + 右侧「按顺序让」；07-C 固定列规则 8 行｜LIST-PAGE-SPEC §9.1、§9.2；datagrid.prompt.md「固定列」「表格高度」
- 验：planFixed 台账夹具（租户132、四根数字各116、rank 租户0/本月结余1/应收合计2/上月结余3/收款4）：visW=1254 留 4 根合计 480；700 只留租户+本月结余 248；593 租户封顶 118、合计≤237。heightStage 台账尺寸(34/38/34/40)：338→2、384→0、383→1、309→3。numW 合计串最长时按合计算宽。visW=0 全留；S 档 hStage=0。

**W2 月度台账接入：先后、数字列不锁 128、高度分级**〔M〕　依赖 W1
- 文件：`components/fp/FPLedgerTable.vue`、`components/fp/__tests__/ledgerFixedCols.spec.ts`
- 改：去掉 tier 退列和 effW/128，按 rank 租户→本月结余→应收合计→上月结余→收款 走 planFixed，备注永不固定；固定数字列宽=numW(全部行+合计)不省略，租户列宽=min(最长名估宽, 1/5) 省略+title。hStage≥1 分组行和 rowspan 固定表头 top:-34px、列名行 top:0；≥2 tfoot bottom:auto；3 时 .lg-wrap min-height 310px。
- 稿 / 规：07-A 1920/1366/1024 三行改后；07-B 改后·往下滚时、更矮的屏｜LIST-PAGE-SPEC §9.1 月度台账先后（2026-10-01 用户确认）、§9.2、§4 列宽铁律
- 验：RO 桩把 .lg-wrap clientWidth 设 700：本月结余 th 为 sticky right:0px 且带 lg-fix，上月结余/应收合计/收款/备注都没有 lg-fix；设 1254：应收合计 right=本月结余宽 px，收款、备注仍无 lg-fix；12,345,678.90 的结余格没有 ellipsis 且列宽≥numW。

**W3 附表10 销售收入接入**〔S〕　依赖 W1
- 文件：`views/sales-income/S10Table.vue`、`views/sales-income/S10Table.spec.ts`
- 改：租户(rank0)→合计(rank1) 走 planFixed，删 :405-416 的 @media 600 sticky 块；租户列封顶 1/5 省略。高度按 34/34/38/42 分级，删 min-height:300 改 stage3 下限。
- 稿 / 规：07-C「现在的 7 张表」附表10 行；07-B｜LIST-PAGE-SPEC §9.1、§9.2、§9.3
- 验：clientWidth 400 + 长租户名：合计列失去 sticky、租户列宽=80；clientWidth 1200：两根都 sticky；旧 S10Table.spec 断言照绿。

**W4 损益附表 1–5 接入（读态+编辑态）**〔M〕　依赖 W1
- 文件：`views/reports/pnl/PnlTable.vue`、`views/reports/pnl/__tests__/pnlFixedCols.spec.ts`
- 改：sticky 从 CSS 类(:221-234) 改成 planFixed 内联：科目细分(rank0，编辑态勾选列随它)→本年合计→分组→填入，备注永不固定；删 :266-286 的 @media 块。无贴底合计，只接 stage3 下限(38+8×38)。
- 稿 / 规：07-C 损益附表行（454 · 编辑 640–696）｜LIST-PAGE-SPEC §9.1「备注不固定」、§9.3
- 验：编辑态+有填入，取一个能留住填入的宽：备注 td 无 sticky，本年合计 right=填入宽 px；clientWidth 500：本年合计失去 sticky，只剩勾选+科目细分。

**W5 附表12 工资接入（顺带修编辑态叠列）**〔S〕　依赖 W1
- 文件：`views/salary/SalaryTable.vue`、`views/salary/__tests__/salaryFixedCols.spec.ts`
- 改：姓名(rank0)→序号(rank1) 走 planFixed，姓名 left 取序号实际宽（编辑态含复选框约 64，不再写死 48）；删 :327-329 @media 块。高度按 28/38/37/44 分级。
- 稿 / 规：07-C 附表12 行｜LIST-PAGE-SPEC §9.1、§9.2
- 验：编辑态宽屏：姓名 left=序号列宽且≠48；取一个两根超 40% 的宽：序号失去 sticky、姓名 left:0px；salaryCardS 的 s12-sticky 类计数照绿。

**W6 楼栋损耗接入**〔S〕　依赖 W1
- 文件：`views/alloc/LossLedgerView.vue`、`views/__tests__/lossFixedCols.spec.ts`
- 改：位置列(唯一 rank0) 不再锁 360：宽=min(最长名估宽, 1/5)，省略+title；删 :174-181 tier 逻辑。高度按 0/38/34/40 分级（wrap 在 v-else 里，靠 watch(wrap)）。
- 稿 / 规：07-C 楼栋损耗行（768 宽约占 56%）｜LIST-PAGE-SPEC §9.1 名称列 1/5
- 验：clientWidth 1000 + 20 字位置名：位置列宽=200 且带 ellipsis、title 在；clientWidth 2000 短名：列宽<360。


### S3 三屏

**P4-A1 按比例出列工具 touColumns**〔S〕
- 文件：`utils/touColumns.ts`、`utils/touColumns.spec.ts`
- 改：新增 touMode 与开关记忆（localStorage，try/catch）。公摊、抄表两屏共用。
- 稿 / 规：04-C 三张卡（宿舍 0/299、一期 49/184、二期 63/69）｜datagrid.prompt.md「按比例出列」定稿·待实现 04-C；记忆 09-29 拍板「开关记住上次选择，公共电核算同一套」
- 验：touMode(0,299)==='none' && touMode(49,184)==='row' && touMode(63,69)==='cols' && touMode(50,100)==='row'

**P4-A2 表格卡工具条 FPTableTools**〔S〕
- 文件：`components/fp/FPTableTools.vue`、`components/fp/__tests__/FPTableTools.spec.ts`
- 改：卡内右上一条：可选开关 + 「列 · N 列隐藏」勾选菜单 + 默认插槽。mode=none 不渲染开关。
- 稿 / 规：03-A 卡内右上「分时用量 · 列·2 列隐藏」；04-A「分时列 · 列」｜datagrid.prompt.md 按比例出列；03-A 注「实收/盈亏默认隐藏，收进列菜单」
- 验：mount({mode:'row',hidden:['paid','pl'],columns:[…]}) 文本含「2 列隐藏」且 [role=switch] 数为 1；mode:'none' 时为 0

**P4-A3 FPMoreMenu 加带字触发与红色项**〔S〕
- 文件：`components/fp/FPMoreMenu.vue`、`components/fp/__tests__/FPMoreMenu.spec.ts`
- 改：加可选 label/icon 渲染「字 ▾」描边钮；MoreItem 加 danger。不传 label 行为不变。
- 稿 / 规：05-A「簿册 ▾」打开态、「导出 ▾」；04-B「…」打开态红字「批量删除本期」｜hints.prompt.md ⑨ 删除类；画布 05 标题「八个按钮收成四个」
- 验：mount({label:'簿册',items}) 触发钮文本==='簿册'；mount({items}) 触发钮 title 仍为「更多操作」；danger 项带 danger class

**P4-B4 poolLedgerLogic 助手**〔S〕
- 文件：`utils/poolLedgerLogic.ts`、`utils/poolLedgerLogic.spec.ts`
- 改：加 poolMethodLabel、lineShortLabel、hasTouQty、fmtFixed2。poolSemantics/poolSubtitle 屏上不再调用，导出若仍用则留。
- 稿 / 规：03-A 分摊方式签「户对户/按面积」、电表列「电表①」；03-C 两位小数｜datagrid.prompt.md 表格样式 03-C
- 验：lineShortLabel({label:'A座·负一层·地下车库东侧照明·电表①',subName:'电表①'})==='电表①'；poolMethodLabel({method:'area',baseSnap:80000})==='按面积'；fmtFixed2(497.3)==='497.30'

**P4-B1 公共电核算标题行与页面三态**〔M〕　依赖 P1/P2 页面状态标签、P1/P2 空状态·加载失败
- 文件：`views/alloc/PoolLedgerView.vue`、`views/__tests__/poolLedgerLayout.spec.ts`
- 改：删 .pl-bar 与 FPLoadError 条，未生成贴 P1/P2 页面状态「本月未生成」，加载失败用 P1/P2 加载失败件整块换掉表格区。编辑态按钮=新增池+生成本月/重新生成+完成，导出当月只在浏览态。
- 稿 / 规：03-B 三态（已生成 / 未生成·编辑模式 / 加载失败「2023 年 8 月的池数据没读到 · 重试」）｜LAYOUT-STABILITY-SPEC §3 表「本月尚未生成」「加载失败」定稿·待实现 03-B；hints.prompt.md ⑥⑦
- 验：generated=false 挂载：.pl-bar 不存在且 .pl-head 文本含「本月未生成」；loadErr 挂载：.pl-table 不存在、存在文本「重试」的按钮

**P4-B2 公共电核算列模型：少列、分时收起、实收盈亏进列菜单**〔M〕　依赖 P4-A1、P4-A2
- 文件：`views/alloc/PoolLedgerView.vue`、`views/__tests__/poolLedgerLayout.spec.ts`
- 改：区域+楼层并成「位置」（区域灰字），分摊语义改「分摊方式」只写方式，删备注列，实收/盈亏进 FPTableTools 默认隐藏，用量单列、尖峰平谷随 touMode 开关。表头改单行，colCount 重算。
- 稿 / 规：03-A 表头一行 12 列；卡内工具条；注「尖峰平谷默认收起」「实收/盈亏默认隐藏」｜datagrid.prompt.md 按比例出列；记忆 09-30「03 尖峰平谷与实收盈亏默认收起」
- 验：一期夹具默认挂载 thead th 文本逐项 === ['位置','用途','电表','倍率','上月行至','本月行至','用量','应分摊（元）','分摊方式','分摊标准','分摊基数','加减度数']；开关打开后在「用量」后多出 尖/峰/平/谷

**P4-B3 公共电核算分组行兼小计与逐行写法**〔L〕　依赖 P4-B4、P1/P2 悬停说明
- 文件：`views/alloc/PoolLedgerView.vue`、`views/__tests__/poolLedgerLayout.spec.ts`
- 改：分组行写「N 个池」+用量/应分摊小计、点它收起，删 .pl-bfoot；电表格只写 subName，「新表」拆小签，全称进悬停；用途删 Σ 副标题；row 模式有分时量的行带 › 展开段行；合计删脚注。
- 稿 / 规：03-A「园区级 1 个池」「A座及园区公共表 6 个池 7,448.52/8,538.00」、电表①/新表、招商中心 › 冲减 5 表、无绑定表行、合计 7,584.52/8,693.88｜datagrid.prompt.md「分组行兼小计」定稿·待实现 03-A；03-A 注「电表列只写表」
- 验：分组行文本含 bandFooter(rows).cost 的两位格式；tr.pl-bfoot 数===0；点分组行后该组数据行数===0；点招商中心行 › 后出现文本「平段」的行

**P4-B5 公共电核算字距与行（03-C）**〔S〕　依赖 P4-B4
- 文件：`views/alloc/PoolLedgerView.vue`、`views/__tests__/poolLedgerLayout.spec.ts`
- 改：行高 40、正文 14、表头 12、字左数右、应分摊列加粗浅底不用品牌蓝、读数金额两位小数、无字距；表铺满可用宽度。
- 稿 / 规：03-C 改后卡「40 行高 / 14 正文 / 12 表头 / 2 位小数 / 0 字距」；03-A 应分摊浅蓝底列｜datagrid.prompt.md「表格样式」定稿·待实现 03-C
- 验：渲染本月行至 497.3 的格文本==='497.30'；.pl-sumc 的样式源不含 --brand

**W8 公共电核算接入（接在 s3 表重排之后）**〔M〕　依赖 W1
- 文件：`views/alloc/PoolLedgerView.vue`、`views/__tests__/poolFixedCols.spec.ts`
- 改：按 s3 定稿列走 planFixed：用途(rank0)→位置；删 :314-326 tier 逻辑，分组/分带标签格(:1063 colspan) 的 sticky 宽不超过仍固定的列。高度按 s3 后表头行数、34 行高、40 合计分级。
- 注：由公共电核算实现者一并做（同文件）。
- 稿 / 规：07-C 公共电核算行（768 宽约占一半）｜LIST-PAGE-SPEC §9.1、§9.2
- 验：clientWidth 500：位置列失去 pl-fix、用途 left:0px；分组标签格 sticky 宽≤用途列宽；poolWriteGuards/poolMonthlyConfig 照绿。

**T16 公共电核算 / 楼栋损耗 / 计费参数 问题面板 + 机械替换**〔L〕　依赖 T01、T02、T03、T05、T06、T07、T08
- 文件：`views/alloc/PoolLedgerView.vue`、`views/alloc/LossLedgerView.vue`、`views/params/ParamCenterView.vue`、`utils/poolLedgerLogic.ts`、`views/__tests__/poolWriteGuards.spec.ts`、`views/__tests__/poolMeterTimeline.spec.ts`、`views/__tests__/poolMonthlyConfig.spec.ts`、`views/params/__tests__/paramCenterView.spec.ts`
- 改：三屏 chip+抽屉换新问题面板（公共电核算即 06-C：待重算/本次生成告警/池成员变动，组头「重算本月」），明细点一条跳行并闪；pl-bar/ll-bar 改 FPStateTag+FPEmpty，pm-bar 拆成标题旁标签、重算动作并入面板。按机械规则换 native 21 处、title 78 处、块内条与加载失败，useEditLock 传 dirty。
- 注：**本阶段只做公共电核算那部分**；楼栋损耗、计费参数的问题面板与替换进 S4（归 T16b）。
- 稿 / 规：06-C 方案 A 全块；01-A 卡4「本月未生成」｜LAYOUT-STABILITY §4、§6；PAGE-BEHAVIOR §2 注
- 验：poolWriteGuards：打开面板无 .fp-sdw-mask、组头有「重算本月」；三文件 confirm/alert/原生 title=0；四个 spec 绿。

**P4-C5 展平改组头在前 + 分时段行 + 组尾停用行**〔M〕
- 文件：`composables/useMeterWorkbench.ts`、`composables/useMeterWorkbench.spec.ts`
- 改：flattenGroups 改组头（块数+组用量、可收起）→数据行→展开的段行→组尾「另有 N 块已停用 · 显示」，停用行点显示才进列表。删组尾 bsum，itemH 按新类型给高。
- 稿 / 规：04-A「A座 13 块 144,183.58」组头、A座总电下 峰段/平段/谷段、「另有 3 块已停用 显示」｜METER-TIMELINE-SPEC L164 定稿·待实现 04-A；datagrid.prompt.md 分组行兼小计
- 验：组含 2 活动+1 停用：flattenGroups(gs,{}) 类型序列 === ['ghead','row','row','retired']；showRetired 含该组时 'row' 数===3

**P4-C1 园区抄表标题行：七个按钮收成四个**〔M〕　依赖 P4-A3、P1/P2 页面状态标签
- 文件：`views/meters/MeterView.vue`、`views/__tests__/meterLayout.spec.ts`
- 改：标题旁写「租户表已抄 {read} / {tenant}」替进度条，期区段控挪进标题行；浏览=导出当月+「…」(下载模板)+编辑模式，编辑=导入+新增表+「…」(导出当月/下载模板/批量删除本期 红)+完成。「编辑中 · N 处改动」作页面状态贴标题旁，删「重置」「下载模板」独立钮。
- 稿 / 规：04-A 标题行；04-B 标题行 + 「…」打开态｜画布 04 标题「七个按钮收成四个」；EDIT-MODE-SPEC（导入只在编辑态）
- 验：浏览态 .mt-head 直接按钮数===3 且不含「下载模板」「重置」；编辑态 .mt-head 直接按钮数===4 且含「导入」「新增表」「完成」；标题行文本含「租户表已抄 76 / 78」

**P4-C2 六张统计卡并进状态页签**〔M〕
- 文件：`views/meters/MeterView.vue`、`views/__tests__/meterLayout.spec.ts`
- 改：桌面删 .mt5-cards，第二行=电表/水表+状态页签（全部/未抄/待核，其余非零才出）+全部归属+搜索。删楼栋/状态下拉、只看存疑、重置（去向见 open_questions）。
- 稿 / 规：04-A 第二行「电表 水表 | 全部 未抄 2 待核 1 | 全部归属 ▾ | 搜索」｜画布 04 标题「六张统计卡并进状态页签」；datagrid.prompt.md「正常状态不显示」
- 验：夹具 2 未抄、1 待核、0 异常：页签文本 === ['全部','未抄 2','待核 1']；.mt5-cards 不存在

**P4-C3 抄表流内条换成空状态/加载失败**〔S〕　依赖 P1/P2 空状态·加载失败
- 文件：`views/meters/MeterView.vue`、`views/__tests__/meterLayout.spec.ts`
- 改：.mt-empty 改 P1/P2 空状态占表格区（编辑态按钮「导入」），读数失败 FPLoadError 改 P1/P2 加载失败件换掉表格区。删 .mt-hidbar/.mt-bookbar。
- 稿 / 规：04 无单独图；对齐 03-B 加载失败与 05-B 空状态｜LAYOUT-STABILITY-SPEC §3 加载失败/§2 不许流内条；hints.prompt.md ⑦
- 验：readings=[] 挂载：.mt-empty 不存在且 MeterLedgerGrid 不渲染；readErr 挂载：有「重试」按钮且 .mlg-table 不存在

**P4-C4 抄表表格列：位置合列、分时按比例、状态只写不正常**〔M〕　依赖 P4-A1、P4-A2
- 文件：`views/meters/MeterLedgerGrid.vue`、`views/__tests__/meterLayout.spec.ts`
- 改：删「区域」列，上月/本月各一列、分时列按 touMode+开关出（FPTableTools 放卡内）。状态列已抄留空只写未抄等，「新表」拆小签，用量列加粗浅底。
- 稿 / 规：04-A 表头 位置/用途/房号/租户/表号/编码/倍率/上月行至/本月行至/用量/状态；卡内「分时列 · 列」；04-C 宿舍/二期｜datagrid.prompt.md「格内写法」「按比例出列」定稿·待实现 04-A/04-C
- 验：0 分时夹具：thead 无「尖」且无 [role=switch]；63/69 夹具默认 thead 含「本月尖」；已抄行状态格文本===''

**P4-C6 编辑态分时录入与倒走写法**〔M〕　依赖 P4-C4、P4-C5
- 文件：`views/meters/MeterLedgerGrid.vue`、`views/__tests__/meterLayout.spec.ts`
- 改：row 模式分时表的段行在编辑态出本月段输入格，回车 总→峰→平→谷→下一块表。倒走行本月格红框、用量负数、状态格写「比上月少 X」。
- 稿 / 规：04-B 录读数（A座总电段行输入、A4东侧总1「底数」、联塑精铟 99.8 红框 −28.60「比上月少 1.43」）｜METER-V5-SPEC L58 草稿式编辑；画布 04-B「分时表回车依次走 总→峰→平→谷」
- 验：分时表总格按 Enter 后 activeElement 为同表「峰」段输入；草稿本月比上月少 1.43 时状态格文本==='比上月少 1.43'

**P4-C7 抄表字距与行（03-C 同一套）**〔S〕　依赖 P4-C5
- 文件：`views/meters/MeterLedgerGrid.vue`、`composables/useMeterWorkbench.ts`、`views/meters/meter-shared.css`
- 改：ROW_H 34→40、正文 14 表头 12、读数用量两位小数、无字距。
- 稿 / 规：03-C 改后卡；04-A 表格｜datagrid.prompt.md「表格样式」定稿·待实现 03-C
- 验：ROW_H===40；渲染上月 452.02、本月 497.3 的行本月格文本==='497.30'

**W7 园区抄表接入（接在 s4 表重排之后）**〔L〕　依赖 W1
- 文件：`views/meters/MeterLedgerGrid.vue`、`views/__tests__/meterFixedCols.spec.ts`
- 改：按 s4 定稿列走 planFixed：用途(rank0)→用量→位置/区域→楼层→状态，colgroup 里候选列宽取 planFixed；用量和读数列按全部行 numW 定宽不省略（窗口化表只能按全量算）；删 :95-112 tier 逻辑，楼栋汇总标签格不许比仍固定的列宽。高度按 s4 后表头行数分级。
- 注：由园区抄表实现者一并做（同文件）。
- 稿 / 规：07-C 园区抄表行（读数锁 96 带省略号）；07-B「屏顶还有 6 张统计卡只露约 3 行」｜LIST-PAGE-SPEC §9.1、§9.2、§4 窗口化列宽
- 验：clientWidth 700：只有用途+用量带 mlg-fix；一条 12,345.67 读数格无 ellipsis 且 col 宽≥numW；滚动（改 scrollTop 触发窗口）后 colgroup 宽不变。meterNarrow/meterWriteGuards 照绿。

**T18 园区抄表主屏：只看存疑入口、编辑中标签、流内条**〔L〕　依赖 T01、T02、T03、T05、T06、T07、T08
- 文件：`views/meters/MeterView.vue`、`views/meters/MeterAssignDialog.vue`、`views/meters/MeterDeleteDialog.vue`、`views/meters/MeterStatusDialog.vue`、`views/__tests__/meterWriteGuards.spec.ts`、`views/__tests__/meterNarrow.spec.ts`、`views/__tests__/meterPeriodFlow.spec.ts`
- 改：「只看存疑 · N」换 FPAlertChip（筛选态实底+×），mt5-tag 换 FPStateTag「编辑中 · N 处改动」，mt-empty 改标题旁标签+FPEmpty，mt-hidbar/mt-bookbar 改卡内 FPNote，两处 FPLoadError 换形。mt-dlg 删除确认按 02-B 右改样（保留输入账期，待拍板），useEditLock 传 dirtyIds.length，native 12/title 7 按机械规则。
- 注：由园区抄表实现者一并做。
- 稿 / 规：01-A 卡4「编辑中·3 处改动」；02-B 右；06-A 入口行「只看存疑」｜hints.prompt §二②⑥⑨
- 验：三个 meter spec 改 mock ask 后绿；编辑态标签文本=「编辑中 · 3 处改动」；本文件 confirm/alert/原生 title=0。

**T19 抄表抽屉与读数格机械替换**〔M〕　依赖 T01、T02、T03、T05、T06
- 文件：`views/meters/MeterDetailDrawer.vue`、`views/meters/__tests__/meterDetailDrawer.spec.ts`、`views/meters/MeterLedgerGrid.vue`、`views/meters/MeterTimelinePane.vue`
- 改：按机械规则换 native 20、title 46、md-empty.fail→FPLoadError、块内条 5。mlg-book 改 FPMark。
- 注：由园区抄表实现者一并做。
- 稿 / 规：06-A 各行；06-B ①⑦⑩｜UI-OVERLAY §7；LAYOUT-STABILITY §3
- 验：meterDetailDrawer.spec 绿；4 文件 confirm/alert/原生 title=0。

**P4-D1 催缴单标题行：八个按钮收成四个**〔M〕　依赖 P4-A3
- 文件：`views/bills/BillNoticesView.vue`、`views/__tests__/billNoticeLayout.spec.ts`
- 改：收款公司/收款簿/系数簿并成「簿册 ▾」，导出通知单/导出对账表并成「导出 ▾」，待处理胶囊挪到右侧组最前。生成本月进空状态，批量确认进表格卡工具条。
- 稿 / 规：05-A 标题行「待处理 5 · 簿册▾ · 导出▾ · 编辑模式」+ 簿册打开态｜画布 05 标题「八个按钮收成四个」
- 验：浏览态 .bn-actions 不含文本为「收款公司」「导出通知单」的独立按钮，含「簿册」「导出」「编辑模式」；FPAlertChip 位于 .bn-actions 内

**P4-D2 四张 KPI 卡并进状态页签**〔M〕
- 文件：`views/bills/BillNoticesView.vue`、`utils/billNoticeLogic.ts`、`utils/billNoticeLogic.spec.ts`、`views/__tests__/billNoticeLayout.spec.ts`
- 改：删 .bn-kpis 与「仅看有警告」，第二行=全部/待核对(含部分确认)/已确认/已导出/有警告(含缺收款公司) + 右侧搜租户名。billNoticeLogic 加 tenantTabCounts，filtered 按页签筛。
- 稿 / 规：05-A「全部 12 待核对 7 已确认 3 已导出 2 有警告 4」+ 搜索框｜记忆 09-29 拍板「部分确认并进待核对」；画布 05 标题「四张统计卡并进状态页签」
- 验：夹具 draft/partial/confirmed/exported 各 1、其中 1 户缺收款公司：tenantTabCounts === {all:4,todo:2,confirmed:1,exported:1,warned:1}

**P4-D3 催缴单表格列、警告写类别、分组行**〔M〕　依赖 P1/P2 悬停说明
- 文件：`views/bills/BillNoticesView.vue`、`utils/billNoticeLogic.ts`、`utils/billNoticeLogic.spec.ts`、`views/__tests__/billNoticeLayout.spec.ts`
- 改：删「行数」列，警告列写首类+「+N」，缺收款公司以橙点+字挪进警告列，行尾加 ›。分组行加月租金小计与收起，合计行删户数/行数；加 warnHead(alerts)。
- 稿 / 规：05-A 表头与 A座 7 行（房号两边对不上 +1 / 上个月缺价 / ● 缺收款公司 / −312.40 红 / 部分确认）、B座 C座 收起、合计｜datagrid.prompt.md「格内写法：第一项 +N」定稿·待实现 05-A；hints.prompt.md ① 就地标记
- 验：两类告警的行警告格文本==='房号两边对不上 +1'；thead 文本 === ['租户','位置','本期合计（元）','月租金参考（元）','状态','警告']；warnHead 单测 more===1

**P4-D4 05-B 本月未生成空状态**〔S〕　依赖 P1/P2 空状态·加载失败
- 文件：`views/bills/BillNoticesView.vue`、`views/__tests__/billNoticeLayout.spec.ts`
- 改：无单时删 .bn-bar 与表内「本月尚未生成」行，卡内出 P1/P2 空状态「{noticeYm} 的催缴单还没生成」+说明句+编辑态「生成本月」。此时不出页签与工具条。
- 稿 / 规：05-B「2023-09 的催缴单还没生成 / 按 8 月读数和 9 月租金生成… / ▷ 生成本月」｜LAYOUT-STABILITY-SPEC §3 表「本月尚未生成」定稿·待实现 05-B
- 验：rows=[] 编辑态：.bn-bar 不存在，卡内按钮文本==='生成本月'，.bn-table 不存在

**P4-D5 05-C 批量确认选择条**〔M〕　依赖 P4-D3
- 文件：`views/bills/BillNoticesView.vue`、`views/__tests__/billNoticeLayout.spec.ts`
- 改：批量态卡内工具条换成：已选 N 户 + 「其中 M 户缺收款公司，不影响确认」+ 全选待核对 + 确认 N 户 + 退出。已确认/已导出行勾选框禁用并淡显，分组行加「· 可确认 K」。
- 稿 / 规：05-C 选择条 + A座 7 户 · 可确认 5 勾选态｜画布 05-C「表格自己的工具条换成选择条，页面不动」；LAYOUT-STABILITY §1 不位移
- 验：夹具 7 户可确认 5：点「全选待核对」后 selCount===5；已确认行 checkbox.disabled===true

**P4-D6 催缴单字距与行（03-C 同一套）**〔S〕
- 文件：`views/bills/BillNoticesView.vue`
- 改：主表行高 40、正文 14 表头 12、本期合计列加粗浅底不用品牌蓝、金额两位小数、无字距。
- 稿 / 规：03-C；05-A 本期合计浅蓝底列｜datagrid.prompt.md「表格样式」定稿·待实现 03-C
- 验：.bn-sumc 样式源不含 --brand；本期合计格 8212.3 显示 '8,212.30'

**T14 催缴单明细橙色大块 → 徽标浮层**〔S〕　依赖 T07
- 文件：`views/bills/BillNoticesView.vue`、`views/__tests__/billNoticeDrawerShape.spec.ts`
- 改：明细弹窗副标题的告警徽标（房号两边对不上 1 ▾…）改 ds/Popover 触发，bn-apanel 从流内橙块改成贴着徽标的浮层（类名+明细+去处链接+时效句）。换户、关弹窗时收起。
- 注：由催缴单实现者一并做。
- 稿 / 规：01-C 标题徽标与「房号 547 · 去园区抄表」浮层；01-C 脚注 80px｜hints.prompt §一第 2 级；LAYOUT-STABILITY §1.1
- 验：点徽标后浮层出现且弹窗正文第一块仍是明细表（.bn-apanel 在 popover 容器内）；stepTenant 后浮层消失。

**T15 催缴单问题面板 + 本月未生成 + 机械替换**〔L〕　依赖 T14、T01、T02、T03、T05、T06、T07、T08
- 文件：`views/bills/BillNoticesView.vue`、`views/__tests__/billNoticesNarrow.spec.ts`、`views/__tests__/billNoticeTimeline.spec.ts`、`utils/billNoticeLogic.ts`、`utils/billNoticeWarnCopy.ts`
- 改：待处理 chip+抽屉换新 FPAlertPanel，明细一条点击跳行并闪；bn-bar 改标题旁 FPStateTag「本月未生成」+ 内容区 FPEmpty，bn-gapdot/bn-arch 改 FPMark。按机械规则换 17 处 confirm/alert、68 处 title，useEditLock 传 dirty，window.prompt 暂留。
- 注：由催缴单实现者一并做。
- 稿 / 规：06-C 方案 A；06-B ①③⑥⑦｜LAYOUT-STABILITY §4、§6；PAGE-BEHAVIOR §2 注
- 验：billNoticesNarrow/Timeline 改 vi.mock('@/utils/ask') 后绿；本文件 confirm/alert/原生 title=0；面板打开无 .fp-sdw-mask。

**P4-E1 跨屏门禁回归**〔M〕　依赖 P4-B1、P4-B2、P4-B3、P4-B5、P4-C1、P4-C2、P4-C3、P4-C4、P4-C6、P4-C7、P4-D1、P4-D2、P4-D3、P4-D4、P4-D5、P4-D6
- 文件：`views/__tests__/noInteractionLayoutShift.spec.ts`、`__tests__/darkOverrides.spec.ts`、`views/__tests__/lockDialogsCoverage.spec.ts`、`views/__tests__/chainPeriodGate.spec.ts`、`views/__tests__/meterPeriodFlow.spec.ts`、`views/params/__tests__/paramCenterView.spec.ts`、`views/__tests__/reviewActionsWiredGate.spec.ts`、`views/__tests__/reviewGateCoverage.spec.ts`、`views/__tests__/anaCopyLint.spec.ts`
- 改：按 B/C/D 改后的结构更新引用了被删选择器/按钮名的断言，不放宽判据。其余引用三屏的 spec 若红也归本批，超 10 个拆 E2。
- 稿 / 规：无（回归）｜LAYOUT-STABILITY-SPEC §5 门禁
- 验：这 9 个 spec 全绿；改过的每条断言对改前结构会红（逐条破坏验证）


### S4 全站替换

**T11 分析屏期间回退横幅 → 期间旁 / 卡头标签**〔L〕　依赖 T03、T05、T06
- 文件：`views/analysis/AnaShell.vue`、`components/ana/AnaPeriodBanner.vue`、`components/ana/__tests__/anaPeriodBanner.spec.ts`、`views/analysis/BreakevenView.vue`、`views/analysis/CockpitView.vue`、`views/analysis/ExpenseView.vue`、`views/analysis/FinBalanceView.vue`、`views/analysis/ParkEnergyView.vue`、`views/analysis/TenantEnergyView.vue`、`views/__tests__/anaSkeletonParity.spec.ts`
- 改：AnaShell 在期间选择右侧开 #period-note，整页回退放 FPStateTag「显示 2026-08 · 9 月无数据」，单图回退（Breakeven s10、ParkEnergy 桑基、TenantEnergy 台账）贴那张卡头「显示 2026-07」；删 AnaPeriodBanner 组件、spec 与骨架里的 ana-hole 占位。顺带把这几屏的 title/加载失败（AnaEmpty failed→FPLoadError 接上重载）/块内条按机械规则换掉。
- 稿 / 规：06-D 中格；06-B ⑥｜LAYOUT-STABILITY §4 期间回退行；hints.prompt §四
- 验：驾驶舱损益回退时 .anx-period 内有「显示 … 月无数据」标签；全仓 grep AnaPeriodBanner=0；anaSkeletonParity 更新快照后绿。

**T12 合同管理「待补档案」黄条 → 工具条入口**〔M〕　依赖 T07
- 文件：`views/contracts/ContractsView.vue`、`views/__tests__/contractsGapEntry.spec.ts`
- 改：删 mx-gapbar 整条，工具条「按某天查看」左侧放 FPAlertChip「待补档案 ▾」，点开 ds/Popover 列三项及件数，点一项筛选并关面板。筛选生效后胶囊变实底「缺起止日期 133 ×」，点 × 回全部。
- 稿 / 规：01-B 全块；01-B 下方「筛选生效后入口变实底」条｜hints.prompt §二②；LAYOUT-STABILITY §6
- 验：有缺口时 DOM 无 .mx-gapbar；点胶囊出 3 行带数；点「缺起止日期」后列表只剩命中合同、胶囊含「缺起止日期」与 ×；点 × 恢复全部。

**T13 合同目录机械替换 + 改动数**〔M〕　依赖 T01、T02、T03、T05、T06、T08
- 文件：`views/contracts/ContractsView.vue`、`views/contracts/ContractDrawer.vue`、`views/contracts/ContractNewDialog.vue`、`views/contracts/FPContractChain.vue`、`views/contracts/FPContractTimeline.vue`
- 改：按机械规则换（confirm→ask/未保存类 askLeave；alert 成败→receipt、字段错→.fp-field-err；title→v-tip；加载失败→FPLoadError；带底色块内条→FPNote；自写确认遮罩→ask）。ContractDrawer 的终止/删除 cd-dlg 换 ask(danger)，ContractNewDialog 关闭走 askLeave 并给 openEditor 传 dirty。
- 稿 / 规：02-B 右；06-A 各行｜UI-OVERLAY §7
- 验：rg 本批 5 文件 window.confirm|alert(|原生 title= 为 0；删除合同出 ask 且焦点在取消。

**T17 台账 / 附表10「未绑定」→ 入口胶囊 + 问题面板**〔L〕　依赖 T01、T02、T03、T06、T07、T08
- 文件：`views/ledger/LedgerView.vue`、`views/ledger/LedgerWideTable.vue`、`views/sales-income/S10View.vue`、`components/fp/FPTenantIssuePanel.vue`、`components/fp/FPLedgerTable.vue`、`views/sales-income/S10Table.vue`、`views/sales-income/S10BindDrawer.vue`、`views/__tests__/monthTemplate.spec.ts`、`views/ledger/LedgerMonthGrid.vue`、`views/ledger/LedgerCompanyBadge.vue`
- 改：lg-issues/s10-issues 换 FPAlertChip，FPSideDrawer+FPTenantIssuePanel 改进 FPAlertPanel 默认插槽；切换账册/换期原生确认改 askLeave，lg-bulk 删除遮罩改 ask(danger)。lg-unbound-dot/s10-unbound-dot 改 FPMark「未绑定」，其余按机械规则（native 22、title 25），useEditLock 传 dirty。
- 稿 / 规：06-A 工具条入口行「未绑定 12」；06-A 点开以后去哪行｜LAYOUT-STABILITY §6；PAGE-BEHAVIOR §2 注
- 验：monthTemplate.spec 绿；点「未绑定」出面板且无 .fp-sdw-mask；dirty=0 切账册不弹、dirty>0 出 askLeave。

**T20 机械替换 M1：ds / fin / 导入**〔M〕　依赖 T01、T02、T03、T06、T08
- 文件：`components/ana/AnaKpiTile.vue`、`components/ds/Avatar.vue`、`components/ds/DatePicker.vue`、`components/ds/KpiCard.vue`、`components/ds/Pagination.vue`、`components/ds/SidebarNav.vue`、`components/fin/FinReportTable.vue`、`components/fin/FinDialogs.vue`、`components/fin/useFinStatementScreen.ts`、`components/import/ImportResultToast.vue`
- 改：按机械规则换 title 13、native 7（导入/切公司类走 askLeave 或 02-B 左的 ask「仍要导入」）、FinDialogs fin-erm→.fp-field-err、delco 遮罩→ask(danger)。useFinStatementScreen 给 useEditLock 传 dirty。
- 稿 / 规：02-B 左；06-B ⑤⑨⑩｜UI-OVERLAY §7
- 验：10 文件 confirm/alert/原生 title=0；三大报表相关 spec 绿。

**T21 机械替换 M2：fp 组件（一）**〔S〕　依赖 T01、T03、T05
- 文件：`components/fp/BookMonthMatrix.vue`、`components/fp/ChainMonthGate.vue`、`components/fp/FPMonthGate.vue`、`components/fp/FPEditModeButton.vue`、`components/fp/FPMoreMenu.vue`、`components/fp/FPReviewActions.vue`、`components/fp/__tests__/FPReviewActions.spec.ts`、`components/fp/FPSortableTable.vue`、`components/fp/FPStat.vue`、`components/fp/FPStepStrip.vue`
- 改：title 13 处→v-tip；FPReviewActions 1 处 alert→receipt.fail（已退回胶囊不动）。两个 MonthGate 的错误档确认已经换成新 FPLoadError 且 retry 接通，cmg-legend 图例保留。
- 稿 / 规：06-B ⑦⑩｜LAYOUT-STABILITY §3
- 验：FPReviewActions.spec 桩换 receipt 后绿；10 文件原生 title/alert=0。

**T22 机械替换 M3：fp 组件（二）+ 导入弹窗**〔M〕　依赖 T03、T06、T08
- 文件：`components/fp/FPUnitMap.vue`、`components/fp/FPUnitPicker.vue`、`components/fp/FPWideCards.vue`、`components/fp/PaySlotGrid.vue`、`components/fp/TemplateEditorPanel.vue`、`components/fp/FPElevateDialog.vue`、`components/fp/FPTakeoverDrawer.vue`、`components/import/FpImportModal.vue`、`components/import/ImportSummary.vue`
- 改：title 17→v-tip；te-histbar 改 FPStateTag「正在查看 v2（历史版）」+回到现行版按钮，tk-warn 竖条、fpimp-msg/fpimp-fb、isum-head 改 FPNote，ev-err/tk-err 统一 .fp-field-err。TemplateEditorPanel 给 useEditLock 传 dirty。
- 稿 / 规：06-A 块里的一行提示行；06-B ④⑤⑥｜LAYOUT-STABILITY §2、§4.2
- 验：9 文件原生 title=0，rg 'border-left.*orange|dashed' 于这些块内条=0；导入相关 spec 绿。

**T23 机械替换 M4：附表页头 / 工资 / 水电**〔M〕　依赖 T01、T02、T03、T05、T06、T08
- 文件：`components/sched/SchedHeader.vue`、`components/sched/SchedMonthPills.vue`、`components/sched/SchedNoteCell.vue`、`components/sched/SchedYearGate.vue`、`composables/useSchedScreen.ts`、`views/utilities/UtilitiesTable.vue`、`views/salary/SalaryTable.vue`、`views/salary/SalaryView.vue`、`views/__tests__/salaryGuards.spec.ts`
- 改：SchedHeader 导入确认走 02-B 左 ask 并把 props.dirty 报给 openEditor，useSchedScreen 清空确认→ask(danger)、alert→receipt；lc-mdot 改 FPMark，sm-yerr→.fp-field-err。s12-fail 两处换 FPLoadError，其余 title 18→v-tip。
- 稿 / 规：02-B 左；06-B ①⑤⑦｜UI-OVERLAY §7；EDIT-MODE §6.1
- 验：salaryGuards.spec 改 mock ask 后绿；9 文件 confirm/alert/原生 title=0。

**T24 机械替换 M5：分析屏其余**〔M〕　依赖 T01、T03、T05、T06、T11
- 文件：`views/analysis/AnomalyView.vue`、`views/analysis/BudgetView.vue`、`views/analysis/ChargingAnalysisView.vue`、`views/analysis/ElecAnalysisView.vue`、`views/analysis/FinCashflowView.vue`、`views/analysis/ParkView.vue`、`views/analysis/PnlAnalysisView.vue`、`views/analysis/PvLedgerScatter.vue`、`views/analysis/PvMeterAnaView.vue`、`views/analysis/TenantPeerView.vue`
- 改：AnaEmpty failed/err 五处换 FPLoadError 并接上各屏重载函数；ea-simbar、bv2-gran-hint 改期间旁 FPStateTag，结论卡（*-concl）保留。title 12→v-tip，FinCashflow 2 处 alert→receipt，块内条→FPNote（不加 ⓘ 触发图标）。
- 稿 / 规：06-D 右格；06-A 加载失败行「没有重试按钮的灰框」｜hints.prompt §四；LAYOUT-STABILITY §3
- 验：每屏 mock 接口失败 → 出「重试」，点后接口再被调一次；10 文件原生 title/alert=0。

**T25 机械替换 M6：出账窗口 + 零散屏**〔M〕　依赖 T01、T02、T03、T05、T06、T08
- 文件：`views/bills/CoefBookWindow.vue`、`views/bills/CompanyBookWindow.vue`、`views/bills/ExportNoticeWindow.vue`、`views/bills/ExportReconWindow.vue`、`views/bills/PayBookWindow.vue`、`views/analysis/TenantPortfolioView.vue`、`views/home/HomeView.vue`、`views/import-center/ImportCenterView.vue`、`views/elec/ElecView.vue`
- 改：三个簿窗口 native 25 处按机械规则换，openEditor 传 stash/dirty 计数；cb-bar「仅二期开放」改替换表格的 FPEmpty，ex-warn 改 FPNote，ex-dot/pb-dot 改 FPMark。其余 title 29、ImportCenter/ElecView 确认、TenantPortfolio 加载失败按规则换。
- 稿 / 规：06-A 整条提示条行；06-B ①④⑦⑨⑩｜UI-OVERLAY §7；LAYOUT-STABILITY §2
- 验：9 文件 confirm/alert/原生 title=0；关系数簿窗口 dirty=0 不弹、>0 出 askLeave。

**T26 机械替换 M7：楼栋 / 租户 / 系统**〔M〕　依赖 T01、T02、T03、T05、T06、T08
- 文件：`views/buildings/BuildingCard.vue`、`views/buildings/BuildingDrawer.vue`、`views/buildings/BuildingNewDialog.vue`、`views/buildings/BuildingsView.vue`、`views/tenants/TenantDrawer.vue`、`views/tenants/TenantNewDialog.vue`、`views/tenants/TenantsView.vue`、`views/system/SystemLogsView.vue`、`views/system/SystemRolesView.vue`、`views/system/SystemUsersView.vue`
- 改：bd-dlg/TenantDrawer fin-dlg/SystemUsers 停用确认卡→ask(danger)，bd-erm/lg-dlg-erm/fin-erm/su-erm→.fp-field-err，三个系统屏加载失败换 FPLoadError。native 15、title 30 按机械规则，SystemRoles 给 openEditor 传 dirty。
- 稿 / 规：02-B 右；06-B ⑤⑦⑨｜UI-OVERLAY §7；LAYOUT-STABILITY §4.2
- 验：10 文件 confirm/alert/原生 title=0；formPhoneSheet.spec 仍绿（BuildingNewDialog）。

**T27 机械替换 M8：电费 / 充电**〔L〕　依赖 T01、T02、T03、T05、T06、T08
- 文件：`views/elec/ElecCostView.vue`、`views/__tests__/elecCostFlow.spec.ts`、`views/elec/ElecTable.vue`、`views/charging/ChargingTable.vue`、`views/charging/CpMeterView.vue`、`views/__tests__/cpMeterFlow.spec.ts`
- 改：ElecCost/CpMeter 共 native 36：校验类 alert（桩名不能为空…）改字段下 .fp-field-err，成败改 receipt，确认改 ask；gate-fail 与流内 FPLoadError 换形，ec-empty/cm-empty 改标题旁标签+FPEmpty。title 46→v-tip，useEditLock 传 dirty。
- 稿 / 规：02-C 脚注「字段错误贴字段下面」；06-D 右格｜LAYOUT-STABILITY §4.1、§4.2
- 验：elecCostFlow/cpMeterFlow 改 mock 后绿；空桩名提交时字段下出红字且无回执；6 文件 confirm/alert/原生 title=0。

**T28 机械替换 M9：光伏 / 参数抽屉 / 台账零散**〔M〕　依赖 T01、T02、T03、T05、T06、T08
- 文件：`views/pv/PvMeterView.vue`、`views/pv/PvTable.vue`、`views/params/ParamChangesDrawer.vue`、`views/params/ParamEditPopover.vue`、`views/params/ParamHistoryDrawer.vue`、`views/ledger/LedgerTenantDrawer.vue`、`views/ledger/LedgerDeleteCompanyDialog.vue`、`views/ledger/LedgerNewCompanyDialog.vue`、`views/ledger/LedgerCompanyPicker.vue`
- 改：PvMeter native 17 按机械规则（校验→字段报错），pm-gate-fail/流内失败换 FPLoadError，pm-empty 改标签+FPEmpty；ph-err/pc-err 换 FPLoadError 带重试。LedgerDeleteCompanyDialog 自写遮罩→ask(danger)，lg-dlg-erm→.fp-field-err，其余 title→v-tip。
- 稿 / 规：06-A 加载失败行「只有红字」；02-B 右｜LAYOUT-STABILITY §3、§4.2
- 验：9 文件 confirm/alert/原生 title=0；参数历史抽屉接口失败时出「重试」且点后重拉。

**T29 机械替换 M10：报表**〔M〕　依赖 T01、T02、T03、T06
- 文件：`views/reports/balance-sheet/BalanceSheetView.vue`、`views/reports/income-statement/IncomeStatementView.vue`、`views/reports/pnl/PnlScheduleView.vue`、`views/reports/pnl/PnlTable.vue`、`views/reports/recon/ReconView.vue`、`views/reports/recon/ReconWorkbench.vue`、`views/reports/trial-balance/TbTable.vue`、`views/reports/trial-balance/TrialBalanceView.vue`、`views/reports/home/ReportsHomeView.vue`
- 改：native 13、title 17 按机械规则；fin-mask/pnl-mask 批量删除遮罩→ask(danger)，pnl-derr/fin-erm→.fp-field-err。rc-banner/rc-balance 属内容保持，SaveConfirmDialog 保持。
- 稿 / 规：02-B 右；06-B ⑤⑨｜UI-OVERLAY §7
- 验：9 文件 confirm/alert/原生 title=0；批量删除 ask 默认焦点在取消。

**T30 机械替换 M11：数据首页**〔S〕　依赖 T02、T03、T08
- 文件：`views/data-home/DataHomeView.vue`、`views/data-home/DataHomeView.spec.ts`
- 改：「从首页重新打开会丢改动」原生确认改 askLeave，title 8→v-tip。dh-blocker 前置条与待批授权胶囊不动（前者规范写留原处，后者归铃铛块）。
- 稿 / 规：02-A；06-B ⑩｜PAGE-BEHAVIOR §5.2「不算通知，留在原处」
- 验：DataHomeView.spec 改 mock 后绿；文件 confirm/alert/原生 title=0。

**T31 收口：门禁 + 规范摘标记 + 更新公告**〔M〕　依赖 T09、T10、T11、T12、T13、T15、T16、T17、T18、T19、T20、T21、T22、T23、T24、T25、T26、T27、T28、T29、T30
- 文件：`views/__tests__/noNativeDialogs.spec.ts`、`views/__tests__/noNativeTitle.spec.ts`、`docs/design/LAYOUT-STABILITY-SPEC.md`、`docs/design/UI-OVERLAY-SPEC.md`、`docs/design/EDIT-MODE-SPEC.md`、`docs/design/TAB-BAR-SPEC.md`、`docs/design/PAGE-BEHAVIOR-SPEC.md`、`changelog.ts`、`frontend/package.json`、`C:/financial_dashboard/.claude/skills/factory-park-design/components/feedback/hints.prompt.md`
- 改：新增两条门禁：非测试源码里 window.confirm/alert、裸 confirm(/alert( 为 0；.vue 模板小写标签及透传到原生的 ds 组件上 title= 为 0（白名单只放声明了 title prop 的组件）。已实现条目摘掉「定稿·待实现」，按 RELEASE-NOTES-SPEC 定版本写 changelog。
- 注：门禁两条在 S4；规范摘标记与更新公告挪到 S6。
- 稿 / 规：02 节标题「全部换成同一套」；06-B｜hints.prompt 头注「实现哪一条就去掉那一条的标记」；RELEASE-NOTES-SPEC §2.1/§8
- 验：两条门禁绿，各做一次破坏验证（任一文件插 alert() / title= 必红）；npm run typecheck 绿；收口跑一次全量。

**T16b 楼栋损耗 / 计费参数：问题面板 + 机械替换**〔M〕　依赖 S1
- 文件：`views/alloc/LossLedgerView.vue`、`views/params/ParamCenterView.vue`、`views/params/__tests__/paramCenterView.spec.ts`
- 改：两屏 chip + 抽屉换新问题面板（组头带重算动作），`ll-bar` 改 FPStateTag + FPEmpty，`pm-bar` 拆成标题旁标签、重算动作并入面板；confirm / alert / title / 加载失败按机械规则换，useEditLock 传 dirty。
- 稿 / 规：06-C 方案 A；06-A 整条提示条行｜LAYOUT-STABILITY §4、§6
- 验：两屏打开面板无 `.fp-sdw-mask`；两文件 confirm / alert / 原生 title = 0；paramCenterView.spec 绿。


### S5 铃铛

**BE1 消息表与读写接口**〔M〕
- 文件：`backend/src/main/resources/db/migration/V133__user_notice.sql`、`backend/src/main/java/com/park/demo3/entity/UserNotice.java`、`backend/src/main/java/com/park/demo3/mapper/UserNoticeMapper.java`、`backend/src/main/java/com/park/demo3/service/NoticeService.java`、`backend/src/main/java/com/park/demo3/controller/NoticeController.java`、`backend/src/main/java/com/park/demo3/dto/NoticeDtos.java`、`backend/src/test/java/com/park/demo3/api/NoticeApiIT.java`
- 改：建 user_notice（照 V130 写法）+ NoticeService（add/list/markSeen/unseenCount，插入时裁到 30 条、发给自己跳过）。GET /api/notices 返回最近 30 条带 seen，POST /api/notices/seen 把本人未读置 seen_at。
- 稿 / 规：06-F 有结果了 · 三类怎么消失「只留最近 30 条」「09-30 定做，放第二步」｜PAGE-BEHAVIOR-SPEC §5.1 第二步；hints.prompt.md §五 三类
- 验：NoticeApiIT：给 A 写 31 条 → GET 恰 30 条且首条 id 最大；POST seen 后 unseenCount(A)=0；add(to=当前用户) 后行数不变

**BE2 审核事件写消息 + 被退回明细接口**〔M〕　依赖 BE1
- 文件：`backend/src/main/java/com/park/demo3/service/ReviewService.java`、`backend/src/main/java/com/park/demo3/controller/ReviewController.java`、`backend/src/main/java/com/park/demo3/dto/ReviewDtos.java`、`backend/src/test/java/com/park/demo3/api/ReviewApiIT.java`
- 改：approve 给 submittedBy 写 review_approved；withdraw 在 deleteById 前读行，给 submittedBy（及不是本人的原 reviewedBy）写 review_withdrawn 带理由，ref=review key。新增 GET /api/review/returned（本人 status=returned 行，带 label/审核人显示名/时间/理由）；PendingItemDTO 加 submittedByName。
- 稿 / 规：06-E 你交的表被退回（逐张列出带理由）/ 审核通过 / 审核被撤销；06-F 等你处理第 4 行、有结果了第 2、3 行｜PAGE-BEHAVIOR-SPEC §5.1；ReviewService.returnedCount 头注「撤销做不到」由读行先于删行解决
- 验：ReviewApiIT：A 交审 B 通过 → A 的 /api/notices 有 1 条 kind=review_approved 且 ref=该键；B 撤销带理由 → A 有 review_withdrawn 且 detail 含理由；B 退回 → A 的 /api/review/returned 含该键与理由

**BE3 远程授权结果写消息 + 撤回请求**〔M〕　依赖 BE1
- 文件：`backend/src/main/java/com/park/demo3/service/ApprovalService.java`、`backend/src/main/java/com/park/demo3/security/ApprovalStore.java`、`backend/src/main/java/com/park/demo3/controller/ApprovalController.java`、`backend/src/test/java/com/park/demo3/security/ApprovalStoreTest.java`
- 改：decide 批准/拒绝给 requester 写 approval_approved/approval_rejected；ApprovalStore sweep 删过期条时回调 onExpire → approval_timeout。新增 DELETE /api/auth/approvals/{id}（仅请求者本人）删掉待批且不算超时。
- 稿 / 规：06-E 授权批准了/被拒绝/超时（问题列「点了取消请求照样报超时」）；06-F 有结果了第 1 行｜PAGE-BEHAVIOR-SPEC §5.1；hints.prompt.md §五
- 验：ApprovalStoreTest：请求后时钟 +2min+1s 再调 inbox → onExpire 恰被调 1 次；先 cancel 再过期 → 0 次且审批人 inbox 为空

**BE4 催缴单取消确认/作废写消息**〔S〕　依赖 BE1
- 文件：`backend/src/main/java/com/park/demo3/service/BillNoticeService.java`、`backend/src/test/java/com/park/demo3/api/BillNoticeApiIT.java`
- 改：unconfirm 在清 confirmed_by 前、void 在 transition 前读原确认人，不是本人就写 bill_unconfirmed/bill_voided，detail=理由，ref=bill-notices:ym。
- 稿 / 规：06-E 你确认的催缴单被取消确认或作废；06-F 有结果了第 4 行「陈会计取消确认了联塑精铟 9 月的催缴单」｜PAGE-BEHAVIOR-SPEC §5.1
- 验：BillNoticeApiIT：A 确认、B 取消确认带理由 → A 有 1 条 bill_unconfirmed 且含理由；A 自己取消 → A 无新消息

**BE5 角色改动写消息、停用原因送达、/auth/me**〔M〕　依赖 BE1
- 文件：`backend/src/main/java/com/park/demo3/service/SystemService.java`、`backend/src/main/java/com/park/demo3/security/UserPermissionCache.java`、`backend/src/main/java/com/park/demo3/security/JwtAuthFilter.java`、`backend/src/main/java/com/park/demo3/controller/AuthController.java`、`backend/src/test/java/com/park/demo3/api/SystemApiIT.java`
- 改：updateRole 给持该角色的人（除自己）、updateUser 角色确有变化时给该人写 perms_changed（detail「刷新后生效」）。reload 时另记停用账号集合，令牌签名有效但账号停用时回 X-Auth-Reason: disabled；新增 GET /api/auth/me 返回当前权限/导航层/角色名。
- 稿 / 规：06-E 你的角色或权限被改了「刷新后生效」；登录页组「账号被停用」｜PAGE-BEHAVIOR-SPEC §5.1 / §5.2 被踢回登录页一类
- 验：SystemApiIT：admin 改角色 R → 持 R 的 U 有 1 条 perms_changed，admin 自己没有；停用 U 后 U 旧令牌请求 401 且头 X-Auth-Reason=disabled；改角色后 U 调 /auth/me 权限已变

**BE6 心跳带未读结果数与授权是否还在**〔S〕　依赖 BE1
- 文件：`backend/src/main/java/com/park/demo3/service/PresenceService.java`、`backend/src/main/java/com/park/demo3/dto/PresenceDtos.java`、`backend/src/test/java/com/park/demo3/service/PresenceServiceTest.java`
- 改：PingResp 加 unseenResults（NoticeService.unseenCount）与 elevated（ElevationStore.active(me) 非空）。
- 稿 / 规：06-G 规则「多个标签页、多台电脑」；06-E 临时授权被系统提前收回｜PAGE-BEHAVIOR-SPEC §5.3 末行；EDIT-MODE-SPEC §6.2
- 验：PresenceServiceTest：写 2 条消息后 ping.unseenResults=2，markSeen 后 0；grant 后 elevated=true，revokeAllUsers 后 elevated=false

**FE-API 前端接口与心跳字段**〔S〕
- 文件：`stores/presence.ts`、`stores/__tests__/presence.spec.ts`、`api/notices.ts`、`api/review.ts`、`api/approvals.ts`、`stores/auth.ts`、`stores/__tests__/auth.spec.ts`
- 改：presence 读 unseenResults/elevated（缺席回 0/null）；新 noticesApi；reviewApi.returned、approvalsApi.cancel；auth.refreshMe 覆盖 permissions/navLayers/roleNames 并写回存储。
- 稿 / 规：06-F 有结果了；06-E 角色被改「刷新后生效」｜PAGE-BEHAVIOR-SPEC §5.1 / §5.3
- 验：presence.spec：ping 响应 {unseenResults:3,elevated:false} → store 值 3/false，字段缺席 → 0/null；auth.spec：refreshMe 返回新权限后 can('x:edit') 由 false 变 true

**FE-DOT ✦、账号菜单、手机抽屉不再挂点**〔S〕
- 文件：`components/shell/IconRail.vue`、`components/shell/mobile/MobileNavDrawer.vue`、`components/shell/__tests__/iconRail.spec.ts`
- 改：删账号菜单版本号旁 .dot 和手机抽屉「版本更新」行的 .dot 与 unread 整行底色。
- 稿 / 规：06-E 系统组「有没看过的更新记录」现状列；06-G 规则「只挂在铃铛上」｜PAGE-BEHAVIOR-SPEC §5.3；VERSION-UPDATE-SPEC §1 表（不挂）
- 验：iconRail.spec：upd.unread=true 时账号菜单里查不到 .dot

**FE-UPD 新版本不再走底部条**〔S〕
- 文件：`stores/update.ts`、`components/shell/AppShell.vue`、`components/shell/__tests__/updateToast.spec.ts`、`components/shell/__tests__/versionUpdate.spec.ts`、`stores/__tests__/update.spec.ts`、`stores/__tests__/updateMinor.spec.ts`
- 改：barKind 只剩 'blocked'，加 hasNewVersion；AppShell 删「已更新到 v…」两句与其 ×，只留「这一页属于新版本」那条。
- 稿 / 规：06-E 系统组「发了新版本」→进铃铛带刷新；当场出现组「这一页属于新版本」不变｜VERSION-UPDATE-SPEC §6 载体（2026-09-30 改）
- 验：update.spec：serverVersion 比本地新 → barKind===null 且 hasNewVersion===true；reportBlocked 后 barKind==='blocked'；updateToast.spec：只有新版时不渲染 .fp-upd-toast

**FE-LOGIN 登录页说「登录已过期」**〔S〕
- 文件：`api/index.ts`、`router/index.ts`、`views/LoginView.vue`、`views/__tests__/loginKicked.spec.ts`
- 改：401 无原因头且本地令牌已过期、或路由守卫因过期拦回时，记原因 'expired'；登录页把 'expired' 写成「登录已过期，请重新登录」，'disabled' 那句保持。
- 稿 / 规：06-E 登录页组「登录过期」「账号被停用」｜PAGE-BEHAVIOR-SPEC §5.2 被踢回登录页一类
- 验：loginKicked.spec：sessionStorage 原因=expired 挂载 LoginView → 文本含「登录已过期」；api 401 无头+过期令牌 → 存下 expired，有头 disabled → 存 disabled

**FE-STOP 编辑中的表被交审/审过：居中弹窗**〔M〕
- 文件：`components/fp/FPEvictedDialog.vue`、`stores/ui.ts`、`composables/useEditMode.ts`、`components/sched/SchedHeader.vue`、`views/ledger/LedgerWideTable.vue`、`components/fin/useFinStatementScreen.ts`、`components/fp/__tests__/evictedDialog.spec.ts`、`composables/__tests__/useEditMode.spec.ts`
- 改：四处「reviewBlock 变真就退出编辑」的地方退出前调 ui.reportEditStop(review.rowOf(key), auth.me)；FPEvictedDialog 加 review 分支写谁交审/谁审过，别人做的才弹。
- 稿 / 规：06-E 当场出现组「正在编辑的表被交审或审核通过」→同一个居中弹窗｜PAGE-BEHAVIOR-SPEC §5.2；EDIT-MODE-SPEC §6.2；CONCURRENCY-SPEC §4.3 形态
- 验：useEditMode.spec：编辑态中该键被他人置 approved → ui.editStop={status:'approved',by:'李审'}；by===me → 仍为 null。evictedDialog.spec：review 非空时标题含「审核通过」且含「李审」

**FE-BELL-STORE 铃铛状态 store**〔M〕　依赖 FE-API、FE-UPD
- 文件：`stores/bell.ts`、`stores/__tests__/bell.spec.ts`
- 改：red=approvals+pendingReviews+myReturned；blue=red==0 且（unseenResults>0 或 系统项自上次开铃后有新）；openPanel 记系统项已看（按账号 localStorage，try/catch）、取三份明细、再 noticesApi.seen，关面板清行点。
- 稿 / 规：06-G 一天里记号怎么变（6 格）+ 规则表前 5 行；06-F 三类怎么消失｜PAGE-BEHAVIOR-SPEC §5.3；hints.prompt.md §六
- 验：bell.spec：1 条授权 → red=1 且 openPanel 后仍 1；授权清空+unseenResults=1 → blue=true，openPanel 后 blue=false；red=2 且 unseen=1 → blue=false；ariaLabel 依次为「通知，4 件等你处理」「通知，有新消息」「通知」；red=120 → markText='99+'

**FE-BELL 铃铛按钮与记号**〔S〕　依赖 FE-BELL-STORE
- 文件：`components/shell/NotifyBell.vue`、`components/shell/__tests__/notifyBell.spec.ts`
- 改：按钮+右上角记号：数字 16 高只往宽里长、蓝点 8、外圈 2px 底色描边、120ms 淡入淡出不跳动、记号 aria-hidden，按钮名取 bell.ariaLabel；点开懒加载 NotifyPanel。
- 稿 / 规：06-G 长什么样（蓝点/1 位/2 位/99+/没有记号）+ 规则表 封顶/0/位置和大小/出现和消失/读屏；06-F 铃铛上的记号三卡｜PAGE-BEHAVIOR-SPEC §5.3
- 验：notifyBell.spec：red=4 → 记号文字 '4' 且按钮 aria-label='通知，4 件等你处理'；red=0 blue=true → 有 .dot 无数字；都为假 → 无记号节点

**FE-PANEL 铃铛面板三类**〔L〕　依赖 FE-BELL-STORE
- 文件：`components/shell/NotifyPanel.vue`、`components/shell/__tests__/notifyPanel.spec.ts`、`components/fp/FPApprovalDrawer.vue`、`components/fp/__tests__/reviewBell.spec.ts`
- 改：照 06-F：组头+行（图标、一句、小字、行尾动作词或 ›），授权行当场处理（倒计时/你的密码/拒绝/批准/后果一句），点整行跳那张表那个月，有结果了未看行挂小蓝点，系统行「刷新」「看看」（编辑中新版行第二行「你正在编辑，保存后再刷新」），底部「全部标为已读」；桌面 420 宽贴铃铛，高 ≤70vh 内滚，手机贴顶栏下方满宽；点外关、Esc 只关自己。删 FPApprovalDrawer 与其测试（断言搬过来）。
- 稿 / 规：06-F 左侧面板全部行；06-D 左格；06-F 底注「面板最高到屏幕的 70%…点整行跳到那张表那个月」｜PAGE-BEHAVIOR-SPEC §5.1；hints.prompt.md §五 面板；UI-OVERLAY-SPEC §7.1；TAB-BAR-SPEC 表中「铃铛面板里点一行」例外
- 验：notifyPanel.spec：组头顺序为 等你处理/有结果了/系统；输密码点批准 → approvalsApi.decide(id,true,pw)；退回行显示理由；点待审行 → router.push 到 periodLink(屏,{p})；hasNewVersion 时出现「刷新」；点「全部标为已读」→ noticesApi.seen 被调；mousedown 面板外 → emit close

**FE-HOME 主管条点开的是铃铛面板**〔S〕　依赖 FE-BELL-STORE
- 文件：`views/data-home/DataHomeView.vue`、`views/data-home/DataHomeView.spec.ts`
- 改：「待批授权 N」按钮改调 bell.openPanel()，删 FPApprovalDrawer 懒加载与 inbox。
- 稿 / 规：06-E 同事请你远程授权「本月出账主管条」｜PAGE-BEHAVIOR-SPEC §5.1「主管条上的待批授权 N，点开的也是铃铛面板」
- 验：DataHomeView.spec：点 .dh-sup-inbox → bell.open===true，且组件树里没有 FPApprovalDrawer

**FE-ELEV 关掉授权弹窗时撤回请求**〔S〕　依赖 FE-API
- 文件：`components/fp/FPElevateDialog.vue`、`components/fp/__tests__/elevateRemote.spec.ts`
- 改：等待中关掉弹窗 → approvalsApi.cancel(myId)（失败静默），不再让它按超时算。
- 稿 / 规：06-E 你请的远程授权超时（问题列「点了取消请求照样报超时」）｜PAGE-BEHAVIOR-SPEC §5.1 等你处理「过期了」才消失
- 验：elevateRemote.spec：发出请求后 open=false → approvalsApi.cancel 以该 id 被调 1 次；没发请求就关 → 不调

**FE-TOOLBAR 桌面顶栏换成新铃铛、✦ 去点**〔S〕　依赖 FE-BELL
- 文件：`components/shell/Toolbar.vue`、`components/shell/__tests__/toolbar.spec.ts`
- 改：铃铛段换 <NotifyBell />，悬停标题改「通知」；删 .fp-upd-dot 与 pendingCount；✦ 下指路气泡保留。
- 稿 / 规：06-G 规则「只挂在铃铛上」；06-E 系统组「有没看过的更新记录」｜TAB-BAR-SPEC §6（2026-09-30 改）；VERSION-UPDATE-SPEC §1
- 验：toolbar.spec：upd.unread=true 时无 .fp-upd-dot；找得到 aria-label 以「通知」开头的按钮

**FE-MTB 手机顶栏换成新铃铛**〔S〕　依赖 FE-BELL
- 文件：`components/shell/mobile/MobileTopBar.vue`、`components/shell/mobile/__tests__/topBarAction.spec.ts`
- 改：铃铛段换 <NotifyBell mobile />，删本地 pendingCount 与 FPApprovalDrawer。
- 稿 / 规：06-F 底注「手机上贴着顶栏下方，占满宽」｜PAGE-BEHAVIOR-SPEC §5.1；RESPONSIVE-LAYOUT-SPEC §4.1 顶栏
- 验：topBarAction.spec：顶栏仍按 菜单/标题/动作/搜索/铃铛 顺序渲染，铃铛 aria-label 以「通知」开头

**FE-APP 换账号弹窗、授权到期一句、审核打断弹窗挂载**〔M〕　依赖 FE-API、FE-STOP
- 文件：`App.vue`、`__tests__/darkOverrides.spec.ts`、`__tests__/appInterrupts.spec.ts`
- 改：顶部红色满宽 .app-drift 换成居中弹窗（点外、Esc 都不关，只有「刷新」）；授权按时到期或心跳 elevated=false 时底部 FPToast「授权已到期，已退出编辑」（不在编辑只写「授权已到期」）；挂一个全局 FPEvictedDialog 读 ui.editStop；远程授权结果批准且无弹窗认领时 refreshElevation；onMounted 调 auth.refreshMe。
- 稿 / 规：06-E 当场出现组「别的标签页退出或换了账号（10-01 拍板）」「临时授权到期」「临时授权被系统提前收回」「正在编辑的表被交审或审核通过」；06-E 授权批准了问题列「弹窗关着时批下来，本页不知道」｜PAGE-BEHAVIOR-SPEC §5.2；UI-OVERLAY-SPEC §3.5 例外；EDIT-MODE-SPEC §6.2
- 验：appInterrupts.spec：auth.drifted=true → role=alertdialog 内只有一个按钮「刷新」，mousedown 遮罩与按 Esc 后仍在，且无 .app-drift；有授权时置 presence.elevated=false → 出现「授权已到期」文本且 auth.grants 清空


### S6 收口

**W9 规范收口：§9 标已实现 + 各表先后写进去**〔S〕　依赖 W2、W3、W4、W5、W6、W7、W8
- 文件：`docs/design/LIST-PAGE-SPEC.md`、`docs/design/RESPONSIVE-LAYOUT-SPEC.md`、`C:/financial_dashboard/.claude/skills/factory-park-design/components/data/datagrid.prompt.md`
- 改：§9 与 datagrid「固定列」「表格高度」两条去掉「定稿·待实现」，补上用户确认后的各表先后；RESPONSIVE §5.4「列宽常量不因档位变」改成按容器宽。
- 稿 / 规：07-C｜LIST-PAGE-SPEC §9；RESPONSIVE-LAYOUT-SPEC §5.4
- 验：grep 这三处不再有 §9/固定列的「定稿·待实现」，每张表的先后都能在 §9.1 里找到。


## 3. 收口（S6）

- W9 与各阶段的规范收口：已实现的条目摘掉「定稿·待实现」（LIST-PAGE §9、LAYOUT-STABILITY、UI-OVERLAY、EDIT-MODE、TAB-BAR、PAGE-BEHAVIOR、VERSION-UPDATE、METER-TIMELINE、skill hints / datagrid / product），补上规范 §2 按推荐定下的做法。
- 版本号与 `changelog.ts`（RELEASE-NOTES-SPEC §2.1 / §8，`changelog.spec` 自动查）。
- 全量一次（前端 vitest + typecheck + build，后端 verify），判绿数产物。
- 浏览器实测：1366×768 台账固定列与 8.8 行；三屏各截一张与画布对照；铃铛记号四态。
- `mockup-coverage-check` 数屏上落点，`screen-copy-adversary` 过新上屏的字。
- 收口消息列出稿上没做的部分（规范 §4 + 覆盖表「不做」）和成本数。
