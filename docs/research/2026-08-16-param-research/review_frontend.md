# S21 前端复核（Task 10~13，1e156e3 / b6ff7e6 / ebc438c / 9d16bfa）

> 复核员：前端只读复核（不改代码，只跑测试与只读接口）。日期 2026-08-16。对照 `docs/design/S21-PARAM-CENTER-SPEC.md` §5 与 `docs/superpowers/plans/2026-08-16-s21-param-center.md` Task 10~13。
> 范围：`utils/paramRegistry.ts`、`utils/paramCenterLogic.ts`、`api/params.ts`、`views/params/*`、`views/alloc/LossLedgerView.vue`、`views/alloc/PoolLedgerView.vue`、`views/bills/BillNoticesView.vue`、`views/bills/CoefBookWindow.vue` + `utils/coefBookLogic.ts`、nav/router，以及删除的价目页三文件。
> 结论一句话：**`npm run typecheck` 净、`npm test` 106 文件 / 1256 用例全绿；七项复核点 ①②③④⑤⑥⑦ 主线全部成立；1 项「严重」（④ 新增例外的配套写计划不全，会多收管网费/管理费）+ 7 项「中级」需补一刀；其余为低危与文案。**

---

## 0. 验证记录（做了什么、看到什么）

| 项 | 方法 | 结果 |
|---|---|---|
| 类型检查 | `cd frontend; npm run typecheck`（`vue-tsc --noEmit -p tsconfig.app.json`） | EXIT 0，零报错 |
| 单测 | `npm test`（`vitest run`） | **106 文件 / 1256 用例 全绿**（Task 12 提交时 107/1276，Task 13 删 `priceCfgLogic.spec.ts` 后 −1 文件 −20 用例，数对得上） |
| ① 禁词·静态 | `paramRegistry.spec.ts`（label/formula/hint/枚举字典扫 `/(building:\|rule:\|meter:\|tenant:\|默认·所有月份\|_)/`）+ `paramCenterView.spec.ts`（挂载后 `w.text()` 浏览态/编辑态扫 `forbiddenText`） | 全绿 |
| ① 禁词·实扫 | python 只读调 dev 后端 `GET /api/params?ym={2023-08,2024-02}&zone={all,p1,p2,dorm}`（774/484/268/97 行）扫 label/unit/scopeLabel/valueText/rangeText/formula/hint/note/sourceChain；`GET /params/changes` 两月 | **主表可见字段 0 命中**；只有 3 条 DB `note` 命中（见 M7）；变更记录 0 命中 |
| ① 禁词·主数据 | 只读 SQL：meter/building/alloc_rule/tenant 名称 REGEXP 禁词 | 0 行（1137 表 / 30 栋 / 98 池 / 381 户） |
| ⑤ 残留 grep | `saveCfg\|commitRuleCfg\|commitAdj\|commitCalib\|upsertMonthCfg\|resolveCfg\|allocApi\.cfg\b` 全 `frontend/src` | 仅 `api/alloc.ts:369-370` 的 `cfg/saveCfg` 定义（零调用方，计划说「过渡保留」）+ `allocLogic.ts` 一行退役注释 |
| ⑥ 死引用 | `priceCfg\|PriceCfg\|PRICE_KEYS\|price-cfg` 全 `frontend/src` + Glob `**/*riceCfg*` | 无 `views/price-cfg`、`utils/priceCfgLogic*`、`api/priceCfg.ts` 残文件；剩余命中皆为 `elecCost.priceCfg`（电费成本模块自己的价目端点，非本刀）、router `/price-cfg → /params` 重定向、fpNav 注释、`api/params.copyPrev` 走旧 `POST /price-cfg/copy`（spec §6 保留） |
| ④ 生效方式对齐 | 读 `ParamEditPopover.submit/remove` vs `ParamService.write()`（backend L345-389） | month/from → `mode`+`acctMonth=页面 ym`；改错 → `correction:true`+`mode=命中行 mode`，后端按 `stand=ym` 解析命中行原地改、上级作用域 400；删除 → `value:null`（有月行删月行，否则删命中版本行），后端 `usedBy` 拦已取用 ✓ |
| ⑦ 竞态/行高 | 读五处 `let seq=0 / ++seq / if (my!==seq) return`（ParamCenterView.load、LossLedgerView.loadMonth、PoolLedgerView.loadMonth、BillNoticesView.loadMonth、CoefBookWindow.load、两抽屉）；`.pm-table` 样式 | 守卫齐；`table-layout:fixed` + `<colgroup>` 全列定宽仅一列弹性、`tr height:var(--mx-row-h,56px)`、td `nowrap/ellipsis` + `title` ✓ |
| ② 浏览态零写入口 | 读四屏模板 `v-if="editMode"` 分布 | LossLedgerView 已无任何写入口（只剩跳转）；PoolLedgerView「分母/加度」两列与抽屉③只读镜像、`commitRuleCfg` 已删；ParamCenterView [改…]/[删]/[+添加]/[新增例外]/[批量修改→系数簿]/[复制上月电价] 全在编辑态；例外见 M2 |
| ③ 只 patch 该行 | `put() → patchRow() → bumpPending()`；spec 断言保存后 `paramsApi.list` 不重拉 | ✓；④ 成对键两次 put 两次 patch、pendingChanges+2 与后端两条 set 日志一致 |

---

## 1. 发现清单

### 严重

**S1. ④「新增例外」配套写计划不全：水价不同写 `water_pipe=0`、包干电价不同写 `mgmt_fee/mgmt_fee_commercial=0` —— 经参数页录入的单户例外会被引擎多收管网费 / 管理费**
- 文件：`frontend/src/views/params/ParamCenterView.vue:266-276`（`submitEx`：只按注册表 `pairedWith` 同值再写一条）；`frontend/src/utils/paramRegistry.ts:71-75`（`pairedWith` 仅 `mgmt_fee → mgmt_fee_commercial`）；对照 `frontend/src/utils/coefBookLogic.ts:29-42`（系数簿 `WRITES`：`water → water_pipe=0`、`elec_package → mgmt_fee=0 + mgmt_fee_commercial=0`）。
- 事实：spec §3.4 明写「water(+water_pipe=0)」「mgmt_fee（+commercial 成对）」，注册表 `elec_package` 的 hint 也写「配套管理费双键 = 0」；引擎 `BillNoticeService.waterLines` L634 对 `water_pipe` 独立走 `resolveHit(tenant→zone→'')`，户级只有 `water=4.45` 时管网费仍落全园 0.5 → 4.95 元/吨；包干价同理会再叠 mgmt 0.16/0.32。
- 后果：④ 是 spec 定义的「单户增删改」入口，用它录包干水价 / 包干电价会静默出错单；系数簿路径正确，两条入口写法分叉。
- 建议：把系数簿的 `WRITES` 写计划抬到 `paramRegistry`（或 `paramCenterLogic`）共享，`submitEx` 按写计划展开（含 `fixed` 值），`pairedWith` 同值语义只留给 mgmt 双键；同时 ④ [删] 也应按写计划整组删（现只删主键一行，`water_pipe=0` 会留下变成孤儿）。

### 中级

**M1. ④ 户级例外表按 `mode != null` 过滤，继承上级命中的 tenant 行会被当作「例外」列出**
- 文件：`ParamCenterView.vue:136`（`tenantRows = grouped.tenant.filter(hasHit)`，`hasHit = r.mode != null`）；`:209-212`（`delTenantRow` 对这种行发 `value:null` → 后端 `cur()` 找不到行 no-op → 回包 rowId 空 → `patchRow` 把它从列表拿掉，刷新又回来）。
- 事实：后端 `list()` 对某键的 tenant 作用域按「库中出现过」出行，行的命中站在 ym 级联 —— 户级版本起点晚于 ym（如系数簿「自 2024-03 起」）时，2024-02 看到的是继承全园/期的值、`rowId=null`。今日 dev 户级行 153/154 条全是初始版本，实扫三月 inherited-but-hit=0（未显形），但系数簿默认生效月=当前账期，第一批「自 X 起」例外一落地就触发。
- 建议：`filter(r => r.rowId != null)`（own hit）；[删] 只对 rowId 非空行出。

**M2. 「重算本月」在浏览态（stale 时）可见可点，与 EDIT-MODE v2「浏览态零写入口」及公共电核算「生成本月」需编辑态不一致**
- 文件：`ParamCenterView.vue:352`（`v-if="canEdit && (editMode || stale)"`）；对照 `PoolLedgerView.vue:645`（生成/重新生成 `v-if="editMode"`）与 `:150`（深链 `generate=1` 直接进编辑态）。
- 重算=池/损耗/催缴单三表先删后插（且对从未生成的月是首次生成，spec §10.6），属写操作。
- 建议：门到 `editMode`；三屏 [去重算] 深链带 `edit=1`，`applyHandoff` 里 `if (q.edit==='1') editMode.value = true`（PoolLedgerView 同法），用户体验不退。

**M3. 「月变价目键只能按月」规则前端未镜像：改…弹窗与新增例外会给出必 400 的选项/默认**
- 文件：`ParamEditPopover.vue:53-57`（`wayOpts` 对电价 6 键仍出「自 X 起长期」）；`ParamCenterView.vue:262-264`（`openEx` 默认 `mode:'from'`）；后端 `ParamService.write` L355-356（`price && MONTHLY_KEYS && mode!='month'` → 400「只能按月生效」）。
- 事实：④ 新增例外选「损耗基数：园区表金额（照抄册面）」（spec §3.1 永龙 month 键、tenantEditable）按默认保存必报 400，用户须自己切「仅 X 月」；改…弹窗对电价键选「长期」同样 400。
- 建议：TS 注册表加 `monthOnly`（= 后端 PRICE 表 && defaultMode month；fixture 已有 `table` 字段可断言镜像）→ 弹窗隐藏 from 选项、新增例外默认 mode 按键取。

**M4. `loss_base_form_b{bid}`（spec §3.4 ★ 本刀新增入口）没有任何 UI 新增入口**
- 文件：`ParamCenterView.vue:250`（`exKeyOpts` 排除含 `{` 的模板键）；`coefBookLogic.ts:61-62`（`COEF_KEYS` 同样排除）。
- 已有行（邓宇峰）可在 ④ [改…]，但新户/新栋链无法录入，只能走 API。
- 建议：新增例外表单在选到该键时多出一个「楼栋」Select（该户挂表的栋），拼 `loss_base_form_b{bid}` 提交；或明确记为下刀。

**M5. LIST-PAGE-SPEC §8（渲染开销铁律，全站表格适用）违例：模板里线性查找 + 返回新对象的函数按「行×列×调用次数」乘开**
- `PoolLedgerView.vue:270-276, 847-850`（模板 `paramCell(r.ruleId, k)` 每格调用 6 次，函数体 `paramRows.value.find(...)` 线性扫 ~300 行并 new 一个对象；池表 70+ 行 × 2 列 → 每次渲染约 800 次线性 find；抽屉与表同组件，编辑态在抽屉里每敲一键整表重渲染 —— 正是 §8 写明的根因场景；抽屉③ `:1009-1010` 再调 4 次）。
- `LossLedgerView.vue:88-95, 197-212`（`badgeOf → paramOf → params.value.find` 每格 4 次；表小（≤20 行）但同违例）。
- 建议：`computed(() => new Map(paramRows.map(r => [`${r.scope}|${r.key}`, cell(r)])))`，模板改 `cellMap.get(...)`；LossLedger 同法按 `building:{id}|key` 建 Map。

**M6. ① 区「未设置行默认折叠」把无值的电价 6 键也藏起来了，与 §5.1「每月核对」/§5.2「未核对」意图冲突**
- 文件：`ParamCenterView.vue:129-135, 366-368, 385`。
- 事实：实扫 2024-03（无电价月）：`monthly` 无命中 211 行，其中全园级 6 行正是 `elec_*`；状态条「本月电价 0/6 ⚠ 缺 6 项」而 ① 表只剩空态一行，须点「显示未设置项（211）」再在 200 多行里找 6 条电价。折叠的初衷是压掉几百条栋级/池级空行，没必要连全园/期级月核对项一起藏。
- 建议：只折叠对象级（`building:` / `rule:`）无命中行；全园/期级 monthlyCheck 行常显并给「缺」徽标（`unchecked` 分支旁边加一个 `!hasHit && monthlyCheck && 期/全园` 分支）。

**M7. 禁词：主表面 0 命中，但历史/变更记录抽屉渲染 DB `note`，dev 库 3 条注记含禁词会在 `/params` 抽屉里上屏**
- 文件：`ParamHistoryDrawer.vue:46,62`、`ParamChangesDrawer.vue:63`（直接渲染 `note`）；数据：`tenant_price_cfg '' water_pipe` note「…(dorm 行 0)」、`alloc_cfg rule:100 price_override` note「…tenant:*.water=4.45…」、`tenant_price_cfg tenant:68 fire_amount_fixed` note「…rule:20/4…」（`param_change_log` 另有一条 V98 迁移日志「p1.price_flat/p2.price_loss」，`changes?ym` 因 action=migrate 不返回，无碍）。
- 页面 spec 只扫主表 `w.text()`，抽屉是按需挂载抓不到；属数据债（改 3 条注记即可），另建议 spec/规范注明「note 是自由文本，禁词规则只管系统文案」，否则以后每条历史注记都成隐患。

### 低（顺带，不阻塞）
- `api/alloc.ts:77-92, 369-370` `AllocCfgDTO/AllocCfgReq/cfg/saveCfg` 前端零调用（计划「过渡保留」）；后续可删。
- `PoolLedgerView.vue` 抽屉③只读句：基数键池显示「当月分母 T = **分母 = 一期路灯面积基数 80000（价目参数）**（长期（初始版本））」双「分母 =」；加度未设置显「**未设置**（未设置）」——`paramCell.full/range` 直接拼句造成。
- `LossLedgerView.vue:65-70` / `PoolLedgerView.refreshStatus` / `BillNoticesView onReactivated`：切回页签的 `status` 补拉无 seq/ym 守卫，切回瞬间又换月时旧月 status 可能盖住新月的 stale 条（概率极低）。
- `ParamCenterView.vue:41` `onDeactivated` 未关 `histRow/changesOpen`（FPDrawer Teleport 到 body，KeepAlive 停用时 teleport 子树不随实例移出）；有全屏 backdrop，实际只有键盘/浏览器后退能触发。
- 「重算本月」confirm 未提示「本月尚无催缴单，将首次生成」（spec §10.6 用户须知），可按 `status.billBatchAt == null` 换文案。
- `.ll-pv` / `.pl-pv` 可点 `<span>` 无 `role=button`/键盘可达；`.pm-table thead th sticky` 在 `overflow-x:auto` 容器里不会随页面滚动钉住（装饰性）。
- `ParamCenterView.put()` 无 seq 守卫（回包到达前换月会把旧月行 patch 进新月列表）；因弹窗/抽屉是模态、[删] 走 confirm，实际不可达，记一笔。

---

## 2. 逐项结论（任务清单 ①~⑦）

| 项 | 结论 |
|---|---|
| ① 禁词 | ✓ 注册表 spec + 页面 spec + 实扫 API 主表 0 命中；抽屉 note 见 M7 |
| ② EDIT-MODE v2 浏览态零写入口 | ✓ 四屏写入口全在编辑态；例外：ParamCenter「重算本月」浏览态可点（M2） |
| ③ 保存后只 patch 该行 | ✓ `patchRow` 按 (scope,key) 原位替换/追加/移除，spec 断言 list 不重拉；「复制上月电价」整页重拉（批量 6 行，可接受） |
| ④ 生效方式三选一 vs 后端 mode/correction | ✓ 语义对齐（month/from 带页面 ym；correction 用命中行；删除 value=null）；缺口：月变价目键 monthOnly 未镜像（M3） |
| ⑤ 楼栋损耗/公共电核算写入口收敛 | ✓ 只剩 `api/alloc.ts` 的 `cfg/saveCfg` 定义无调用方；`commitRuleCfg/commitAdj/commitCalib/upsertMonthCfg/resolveCfg` 全部消失 |
| ⑥ 价目页删除后无死引用 | ✓ typecheck EXIT 0；无 `PriceCfgView/priceCfgLogic/api/priceCfg` 残留；router `/price-cfg` 重定向、tabs 持久化按 ROUTES 过滤旧值 |
| ⑦ LIST-PAGE-SPEC 行高/列宽/竞态守卫 | ✓ 56px 行高、fixed 布局、单弹性列、ellipsis+title、五处 ++seq；违例只在 §8 渲染开销（M5） |

## 3. 建议的下一刀顺序
1. S1（写计划共享）+ M3（monthOnly 镜像）—— 都是 ④ 新增例外/弹窗的一处小改，可同一提交。
2. M1（rowId 过滤）一行；M2（重算门到编辑态 + 深链 edit=1）三处小改。
3. M5（两屏 Map 化）纯性能；M6（折叠规则）文案/过滤；M4 与 M7 记入 spec §10 待修清单或本刀收尾一起做。

## 4. 处理记录（前端实现，2026-08-16 同日；无一项证伪）
| 项 | 处置 |
|---|---|
| S1 | 已修：写计划抬到 `paramRegistry.writePlan()`（系数簿 `COEF_KEYS.writes` 改取同一份，只留窗口提示语）；④ 新增例外走 `paramCenterLogic.tenantExceptionReqs`（水价→+管网费=0 / 包干价→+双 mgmt=0 / 管理费双键同值）、[删] 走 `tenantExceptionDelReqs` 整组删（confirm 文案列出配套键）；`paramRegistry.spec` 断言计划首键=主键、配套键皆 tenantEditable、pairedWith ∈ 计划 |
| M1 | 已修：`tenantRows = grouped.tenant.filter(r => r.rowId != null)`；页面 spec 加继承行断言 |
| M2 | 已修：[重算本月] `v-if="canEdit && editMode"`；`applyHandoff` 认 `edit=1`；楼栋损耗 / 公共电核算 / 催缴单 三屏 [去重算] 深链带 `edit:'1'`；页面 spec 加浏览态无重算 + `edit=1` 进编辑态两断言 |
| M3 | 已修：TS 注册表加 `monthOnly`（7 键；spec 按 fixture `table==='price' && defaultMode==='month'` 断言镜像）；改…弹窗与新增例外 monthOnly 时不出「自 X 起长期」；新增例外默认 mode 按键 `defaultMode` |
| M4 | 已修：新增例外「参数」下拉含「损耗费基数形态（按栋）」，选中多出「楼栋」Select（候选=该户挂表所在栋，无则全部楼栋），提交拼 `loss_base_form_b{bid}`；系数簿仍不收（需指定楼栋，批量语义不合） |
| M5 | 已修：PoolLedgerView `paramCells` computed Map（`rule:{id}|key`），`paramCell()` 只 get；LossLedgerView `badges` computed Map 同法 |
| M6 | 已修：折叠只压对象级（building:/rule:/meter:）无命中行；全园/期级月核对项无值常显，值格「— 缺」；spec §5.2 补一句 |
| M7 | 未改代码（note 是自由文本，按设计不过滤）：spec §5.2 注明 note 不受禁词约束、§10 ⑦ 记 3 条注记数据债（前端不能 SQL 写 dev 库，留给用户在页面备注栏或迁移改写） |
| 低 | 已修：抽屉③只读句改 `roParamLine`（基数键池直显后端整句、未设置不重复括注）；三屏切回补拉 status 加 seq 守卫；`onDeactivated` 关 histRow/changesOpen；重算 confirm 在 `billBatchAt` 空时提示首次生成；`.ll-pv/.pl-pv` 加 role=button/tabindex/Enter；`.pm-table thead` 去 sticky；`put()` 加 seq 守卫（回包前换月不 patch）。**未动**：`api/alloc.ts cfg/saveCfg/AllocCfgDTO/AllocCfgReq`——计划与源码注释明写「过渡保留」（后端 `PUT /api/alloc/cfg` 兼容端点仍在），留待下刀统一删 |
