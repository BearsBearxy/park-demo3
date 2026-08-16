# 「计费参数管理」页 · 成熟做法调研

调研日期：2026-08-16　范围：只读调研（未改任何项目文件/数据库）。
对象：园区（厂房出租，两期 + 宿舍）财务系统的计费参数——现状散在「价目管理页」「系数簿窗口」「公共电核算抽屉」「楼栋损耗屏『本月口径』面板」四处。

---

## 0. 一页速览（先看结论）

| 问题 | 成熟产品的共同答案 | 对本系统的含义 |
|---|---|---|
| 参数怎么组织 | **费项 → 收费标准（含单价/公式）→ 绑定到对象（楼栋/单元/房间/户）+ 起止日期**。国内物业系统全部是这个三层结构 | 现有 `tenant_price_cfg`(键×版本) 与 `alloc_cfg`(scope×键×月) 已经隐含这个结构，缺的是**一张统一的表面** |
| 生效时间怎么表达 | 一律 **valid-from / valid-to**；新版本自动截断旧版本（SAP）；旧价对象不可变、只能新建+归档（Stripe）；改错 vs 改变分两种动作（Oracle DateTrack 的 Correction / Update） | `acct_month=''` 应显示为「长期有效（自 X 起）」，月行显示为「仅 2023-08」；编辑必须区分「改错（原地覆盖）」和「改变（自某月起新版本）」 |
| 具体压一般（例外） | SAP access sequence：客户+物料 → 物料 → 组织，**找到即停**；Salesforce：自定义价目簿条目可 `UseStandardPrice` 回落标准簿；国内物业：「每户单独录入」是四种计价方式之一 | 户级例外 > 表级 > 栋级 > 期级 > 园区级 的覆盖顺序要**在每个数字旁边可点开看「为什么是这个值」** |
| 改了参数怎么生效 | 存量不自动变（Chargebee 改 plan 价只影响新订阅）；要变就**显式选择时点**（立即 / 下期 / 指定日期）；先出 **影响预览**（Terraform：N 增 N 改 N 删）；已生成费用可「清除或重算」但审核过的不能改（物业通） | 保存后出「参数已改，影响 N 月 × N 户/N 池」横幅 + 「预览影响」+「重新生成」，而不是靠人记得去点重算 |
| 历史怎么看 | 版本 diff + 谁/何时/改了什么（LaunchDarkly change history 给 previous/current/delta） | 每条参数一条时间轴，每次变更一条日志 |

---

## 1. 国内物业 / 园区收费系统

### 1.1 极致科技（Jeez）收费管理
来源：
- 物业收费管理解决方案（博客园转载极致方案文）<https://www.cnblogs.com/Jeez_JBF/p/17436579.html>
- 极致官网收费方案页 <https://www.jeez.com.cn/newsinfo/683338.html>
- 极致帮助中心 <http://help.jeez.com.cn/index.html>（本次抓取时连接被拒，仅存目录入口）

提取到的做法：
- **收费项目是核心，层次结构可分组**：「收费项目是整个费用管理的核心，所有的收费都围绕收费项目展开，收费项目为层次结构，可以按照一定的分类建立一些组」；项目类型分 常规费用 / 抄表费用 / 临时费用。
- **收费标准 = 单价+金额+公式**：「收费标准是整个费用计算的核心，包括费用的单价、金额以及计算公式等重要参数」；公式支持数值/字符串/日期三类运算，可用 SQL 取系统数据、支持临时变量、条件流程、系统函数。
- **绑定粒度**：「对组织内所有的房间或单独一间房间进行设置收费标准」——即同一标准可以整片盖、也可以单房间盖。
- **起止日期**：「可以指定收费标准计费开始和结束日期，结束日期到期后，后续不再生成费用」。
- **公摊**：「公摊仪表有两种类型分总表和公摊表」；分摊公式可设，常见按平均 / 按用量 / 按建筑面积。
- **一次抄表多费项**：「一次抄表，同时计算出水费和污水处理费的金额」。
- 每个管理处可自定义收费标准；同一房间不同收费项目可指定不同缴费客户/托收账号。

### 1.2 微小区「收费项目及标准」帮助文档
来源：<https://www.weixiaoqu.com/2648.html>

- 两层：**收费项目**（名称、类别 周期性/一次性/押金类、滞纳金起算/延期天数/日比例、周期不足处理、损耗设置、默认收费周期）→ **收费标准**（标准名称、金额计算方式、单价、计量方式、收费周期、备注）。
- **金额计算方式四选一**：「单价×数量」「固定金额」「每户单独录入」（关联时逐户填）「自定义公式」（阶梯电费等）。——**「每户单独录入」就是户级例外的正统做法**，与标准同表不另开表。
- **关联即生效**：房屋与标准 单独关联/批量关联，填开始时间与结束时间；「关联收费标准后，到达开始时间第二天，系统自动生成第一期费用账单」。
- 解除关联双向：从标准里删房屋 / 从房屋里删标准。
- 文档**未提及**改标准后已生成账单如何重算——这是国内文档普遍的空白，本系统要自己定。

### 1.3 智轩云物业管理系统用户手册
来源：<https://www.zxnyun.com/plus/products/84.html>

- 收费项目字段清单（可直接借用作字段名参考）：收费项目、项目编号、费用类型、关联仪表、费用期、计费周期、单价周期、数据形式、计算方式、数量、默认金额、应收日期、精确位数、按类计费、按阶梯价、按违约金、按类项目、生成模式。
- **收费标准 = 方案**：「如果同一个收费项目有不同的单价，则需要设置不同的收费标准方案」；有「方案分类」按钮。
- **启用 + 执行金额 + 开始日期**：点「启用」→ 输入执行金额和开始日期；「开始日期必须为该管理区最早收取该费用的日期」（即强制版本链有一个可回溯的起点）。
- 房间侧「收费信息页签」：选了标准自动带出已启用项目，**可独立设置每个收费项目的执行金额和开始日期**（= 房间级覆盖）。
- 公摊两种模式：「分摊总表」（每栋楼的公摊总表）/「公共用表」（公摊总量直接为表读数，不减用户分表）；分摊计算方式：按房屋 / 建筑面积 / 用量 / 楼层 / 收费方案。
- 抄表链：生成抄表任务 → 录入 → 抄表费用审核（自动审核 或 人工二次审核）。

### 1.4 西安亘和「物业通」v3.0 功能列表（PDF）
来源：<https://mkp-res.hc-cdn.com/marketplace/public/app/attachment/20201118/e72d9931-bb90-4ad2-ae88-003f0edfaa28/2011180332453282.pdf>

- 收费标准：「将物业公司的项目，分若干个收费标准，每个标准有自己对应的收费项目和单价，如住宅、住宅空置、商铺等」。
- **费用生成：「支持单户或批量算费，可单独指定计算某项费用，费用可清除或重算」**。
- **变更审核：「对于收费员提交的业主信息变更，或标准变更进行审核，审核过的记录方可生效」**——参数变更走审核态。
- 费用审核：「审核过的应收不能改变金额」——已确认的账单冻结，参数再改也不回写。
- **公摊仪表分配：「每次公摊的业主可能不同，支持每次重新加入公摊房间，重新计算公摊率」**——分摊成员按期可变。
- 变更审核 + 费用审核两道闸是国内老牌收费软件的通行做法。

### 1.5 设计文：「物业收费系统之计费模型设计思路」（人人都是产品经理）
来源：<https://www.woshipm.com/pd/1439731.html>

- 收费项目两级（大类→科目），同一科目可挂多个收费标准。
- 四种计价：单位单价 / 固定总价 / 阶梯价格 / 自定义。
- 数据来源三类：房间数据（面积）、仪表数据（水电气）、无计量数据（人工确认数量）。
- 绑定粒度：「按楼栋绑定、按单元绑定、按楼层绑定、按单个对象绑定」。
- 作者明说「预留下标准有效执行的时间范围」但没展开版本机制；也没讲改标准后已生成/未生成账单的处理——再次印证这块要自己定。

### 1.6 其它（只作旁证）
- 飞书汇编「8 个专业级物业收费管理系统」<https://www.feishu.cn/content/property-management-system>：提到「新增房源、变更收费标准或业主换房时，系统会自动同步更新相关信息」；「未审核单据 … 可以通过『计算费用』功能计算出单价、金额、优惠金额…应收金额」。
- 明源云、金蝶我家云、用友：公开页面只有产品介绍，未找到收费标准页的可引用帮助文档（明源 <https://www.mingyuanyun.com/>、金蝶我家云 <https://www.kingdee.com/solutions/estate_management.html>）。

**国内小结**：三层结构（费项→标准→绑定+起止）+ 四种计价方式（含「每户单独录入」）+ 公摊两种表型 + 「费用可清除或重算」+「变更审核」。共同盲区：**没有一家在文档里讲清「改了标准以后，已生成的账单怎么办」**。

---

## 2. ERP / 财务系统的 effective-dated 配置模式

### 2.1 SAP 条件技术（Condition Technique）
来源：
- Pricefx 知识库对 SAP condition technique 的整理 <https://knowledge.pricefx.com/technical-delivery-roles/integration-engineer-knowledge-base-home/sap-integration-reference/use-of-condition-records/sap-condition-technique>
- SAP Help「Access Sequences」<https://help.sap.com/docs/SAP_S4HANA_CLOUD/0e602d466b99490187fcbb30d1dc897c/c3e35944dd8946968493393a3f30b072.html>
- SAP Community 关于有效期重叠 <https://community.sap.com/t5/enterprise-resource-planning-q-a/validity-period-of-the-cond-created-overlaps-with-cond-shorter-periods/qaq-p/2696975>、<https://community.sap.com/t5/enterprise-resource-planning-q-a/condition-record-update-problem/qaq-p/3727929>
- 老版 SD 定价文档 PDF <https://download.consolut.com/direct/SAP_PrintDoku/en/SDBFPR/SDBFPR.PDF>

做法：
- 四层：**定价过程 → 条件类型 → 访问顺序 → 条件表 → 条件记录**。
- **访问顺序 = 从具体到一般的查找策略**：「客户+物料 → 物料 → 组织级」逐级找，找到即停（exclusive）；文档原话：「You can stipulate for a price that the SAP System first searches for a price for a specific plant, and then for a generally applicable price.」
- 每条条件记录带 **Valid From / Valid To**。
- **重叠自动截断**：新记录保存时「sets the end date of the previous validity periods to the last day before the start date of the newly created validity period」；部分重叠时「the system splits the validity periods automatically」。用户永远不需要手动去改旧行的截止日。
- 有 时间相关（PB00）与 时间无关（PBXX）两类条件——对应本系统「月变键」与「常数键」的区分。
- 阶梯（scale）挂在条件记录上。

对本系统的直接映射：`tenant`(户) → `meter`(表) → `building`(栋) → `p1/p2`(期) → 园区，就是一条访问顺序；页面上每个生效值旁边应能展开「命中链」。

### 2.2 Oracle EBS DateTrack（HRMS）
来源：Oracle 官方文档「How DateTrack Works」<https://docs.oracle.com/cd/E18727-01/doc.121/e13513/T2650T402375.htm>；模式说明 <https://oracleappshr.wordpress.com/2018/02/19/date-track-modes/>

做法：
- 每张表 `EFFECTIVE_START_DATE / EFFECTIVE_END_DATE`，查询结果取决于「你站在哪个日期看」。
- 改值时系统**必问两选一**：
  - **UPDATE**（改变）：「Updated values are written to the database as a new row, effective from today until 31-DEC-4712. The old values remain effective up to and including yesterday.」
  - **CORRECTION**（改错）：「The updated values override the old record values and inherit the same effective dates.」
- 若已有未来版本，再问 Insert（只改到下一版本前）还是 Replace（连未来版本一起覆盖）。
- 删除也分四档：End Date（结束有效期）/ Purge（物理删）/ All（删所有未来变更）/ Next Change（只删下一变更）。
- 有 DateTrack History 可看某记录全部版本。

对本系统：这是最值得抄的一条——**「改错」与「改变」必须是两个按钮**。现在价目页「录新版本」只有改变，`本月口径` 面板「写月行压默认行」是另一种改变，而用户真正常做的「上月手滑填错了」没有对应动作。

### 2.3 Stripe Price 对象
来源：Stripe 文档「Manage products and prices」<https://docs.stripe.com/products-prices/manage-prices>；Price 对象 <https://docs.stripe.com/api/prices/object>

- **价格不可变**：「After you create a price, you can only update its metadata, nickname, and active fields.」「you can't change a price's amount in the API. Instead, we recommend creating a new price for the new amount, switch to the new price's ID, then update the old price to be inactive.」
- **归档而非删除**：「You can only delete prices that you've never used. Otherwise, you can archive them.」归档后已有订阅继续用旧价直到取消。
- **default price**（产品的默认价）+ **lookup_key 可转移**（`transfer_lookup_key=true` 把逻辑名从旧价搬到新价）——业务代码引用逻辑名，不引用具体价格 id。
- Dashboard 呈现：产品页下「Pricing」列表，Active / Archived 页签，价格行「⋯」菜单 Edit / Archive / Delete。

对本系统：历史账期取过的价格版本应视为「已使用、只能归档不能删」——本系统 V62 已说明「历史账期取价不受后续改价扰动」，UI 上应把「删版本」限制为「未被任何账期取用过」的版本。

### 2.4 Salesforce Price Book
来源：Salesforce Help「Manage Price Books」<https://help.salesforce.com/s/articleView?id=sales.pricebooks_landing_page.htm&language=en_US&type=5>；数据加载说明 <https://help.salesforce.com/s/articleView?id=000385493&language=en_US&type=1>

- **标准价目簿**（所有产品的默认标准价）+ **自定义价目簿**（针对细分市场/地区/客户群的 list price）。
- 自定义簿条目只能建在有 active 标准条目的产品上；`UseStandardPrice=TRUE` 表示该条目回落到标准价。
- 一个 Opportunity 只能选一本价目簿——**作用域绑定是「对象选簿」不是「簿选对象」**。

对本系统：可类比为「园区标准簿」+「二期簿」+「宿舍簿」+「户级例外」，每户显示它命中的是哪本簿的哪一行。

### 2.5 Chargebee：改 plan 价与存量订阅
来源：<https://www.chargebee.com/docs/billing/2.0/kb/product-catalog/will-a-new-plan-price-affect-the-existing-subscriptions>；订阅操作 <https://www.chargebee.com/docs/billing/2.0/subscriptions/subscriptions>

- 「When you update a plan's price, the new price applies only to new subscriptions」——存量默认 grandfather。
- 要影响存量：单户「Edit Subscription → Apply Changes」，可选 **Immediately / At end of term / On a specific date**；批量走「Bulk Operation → Update Subscription for Items」。
- 「Price overriding must be enabled」——单户改价是一个需要显式开启的能力。

对本系统：「参数生效时点」应作为保存对话框里的一个显式选项（自本月 / 自下月 / 自指定月），而不是靠 acct_month 隐式表达。

### 2.6 SAP RE-FX 服务费结算（房地产公摊分摊的 ERP 标准件）
来源：Consilios 对 RE-FX SCS 的介绍 <https://consiliosit.com/en/sap-real-estate-management-re-fx/settlement-of-service-charges-in-sap-re-fx/>；SAP Community 博文 <https://community.sap.com/t5/financial-management-blog-posts-by-sap/sap-s-4-hana-flexible-real-estate-management-re-fx-service-charge/ba-p/13457955>；SAP Help「Specifying and Editing Adjustments」<https://help.sap.com/docs/SAP_S4HANA_ON-PREMISE/3683a11901b74d8fa71f35d86abaaae1/a060d0531d8b4208e10000000a174cb4.html>

- **Settlement Unit（结算单元）**：决定某种介质（电/水/暖）按消耗还是按面积分摊，用 additional cost key 归类成本。
- **Participation Group（参与组）**：哪些租赁对象参与该介质的分摊——即「池成员」。
- **Apportionment / Measurement**：分摊基数（面积、消耗量等）。
- **Meter 挂接**：「Various meters can be assigned to both the billing units and the leased facilities, including e.g. main meters for the initial distribution of consumption.」——总表挂在结算单元，分表挂在租赁对象。
- 流程：模拟结算 → 与预收对比 → 算多退少补 → 生成租户信函；支持冲销。
- 商业租赁支持「negotiable conditions」（可议定的分摊条件）= 户级例外。

对本系统：`alloc_rule`(池) ≈ Settlement Unit，`alloc_rule_member` ≈ Participation Group，`alloc_rule_meter` ≈ 挂在结算单元上的总表，`loss_c_meter`/`loss_head`/`loss_variant` 就是「结算单元的核算方式」——这几项应当**归在池/栋对象下面展示**，而不是散作 cfg 行。

---

## 3. 「参数改了如何生效」的 UX 惯例

| 惯例 | 出处 | 关键做法 |
|---|---|---|
| **未保存变更条**（contextual save bar） | Shopify Polaris <https://polaris-react.shopify.com/components/deprecated/contextual-save-bar>；App Bridge Save Bar API <https://shopify.dev/docs/api/app-home/apis/save-bar> | 页面一有改动，顶部固定条出现「Unsaved changes ｜ Discard ｜ Save」；离开页面拦截；官方建议**避免同页多个表单同时可编辑**，分区编辑用「Edit」按钮进弹窗逐段保存 |
| **影响预览**（plan before apply） | Terraform plan <https://developer.hashicorp.com/terraform/tutorials/cli/plan>；解释文 <https://spacelift.io/blog/terraform-plan> | 先算出「Plan: 3 to add, 1 to change, 2 to destroy」再让人点 apply；「If you expected to add one resource and the plan says 5 to destroy, stop and investigate」 |
| **存量不自动变 + 生效时点显式选择** | Chargebee（§2.5） | Immediately / At end of term / On a specific date 三选一 |
| **变更审核 + 已审核不可改** | 亘和物业通（§1.4） | 「标准变更进行审核，审核过的记录方可生效」「审核过的应收不能改变金额」 |
| **费用可清除或重算** | 亘和物业通（§1.4） | 「支持单户或批量算费，可单独指定计算某项费用，费用可清除或重算」——重算是显式动作、可按户/按费项局部做 |
| **改错 vs 改变** | Oracle DateTrack（§2.2） | Correction 原地覆盖不留痕；Update 生成新版本旧值保留到昨天 |
| **重叠自动截断** | SAP 条件记录（§2.1） | 录新有效期后旧记录 valid-to 自动改为新 valid-from 的前一天 |
| **变更历史带 diff** | LaunchDarkly change history <https://launchdarkly.com/docs/home/releases/change-history>；API <https://launchdarkly.com/docs/api/audit-log> | 每条记录 who/when/what，「Details」展开 previousVersion / currentVersion / delta（JSON patch）|
| **不可变 + 归档** | Stripe（§2.3） | 用过的价格只能归档；引用走逻辑名 lookup_key |
| **手动重算模式的心智模型** | Excel「手动计算」——状态栏显示「计算」，改单元格后公式不自动更新直到按 F9（常识，不另引） | 本系统派生结果是快照，就该像 Excel 手动模式一样明确显示「需要重算」标记 |

---

## 4. 针对本系统的建议

### 4.0 先把四类参数放进同一张「参数模型」

| 类别 | 例子（现有键） | 时间语义 | 作用域 | 现在住哪 |
|---|---|---|---|---|
| ① 逐月参数 | 电价 6 键、加度 extra_qty、层数 T、人工调整度数 loss_adj_qty | **只对某月有效**（不前滚） | 期 / 池 / 栋 | 价目页月变键、公共电抽屉、损耗屏面板 |
| ② 长期常数 | 管理费 0.16、容量费 22.6、路灯面积基数 80000、均摊 6 栋 park_share_div | **自某月起长期有效**（前滚到下一版本） | 期 / 园区 | 价目页常数键、系数簿 |
| ③ 结构性口径 | loss_c_meter（组C只取此总表）、loss_head（并入他栋）、loss_variant（损耗口径）、loss_recon（不入对账）、loss_exclude（表剔出Σ）、池成员/池总表 | 长期有效为主，偶有某月覆盖 | 栋 / 表 / 池 | 损耗屏「本月口径」面板（只读+三类可改） |
| ④ 户级例外 | 某户管理费单价、层份、绿化水等 | 自某月起长期 | 户 | 价目页右栏（只读+删）+ 系数簿（增改） |

统一后每条参数 = **键 + 作用域 + 生效方式（仅某月 / 自某月起长期）+ 值 + 备注/来源 + 最近修改人时间**。四类只是同一模型的四种「生效方式 × 作用域」组合，页面因此可以合一。

### 4.1 方案 A：「一页四区」—— 按参数性质分区，一个月份选择器统管

```
┌─ 计费参数 · 2023-08 ─────────────────────────────────────────── [编辑模式] [变更记录] ┐
│ 账期 [2023 ▾][08 ▾]   期 [一期 ▾]   ⚠ 本月 3 条参数由「长期默认」兜底，未单独设定  [查看]  │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ ① 本月参数（每月要填）                                     状态：电价 6/6 ✓  加度 2 条        │
│ ┌──────────────┬──────────┬────────┬───────────────────────────────────────────────┐ │
│ │ 参数          │ 作用范围  │ 2023-08│ 说明 / 来源                                     │ │
│ ├──────────────┼──────────┼────────┼───────────────────────────────────────────────┤ │
│ │ 供电局月均价   │ 一期      │ 0.9542 │ 供电局账单 → 商业单价 = 月均 + 0.16              │ │
│ │ 尖峰/峰/平/谷 │ 一期      │ …      │                                                 │ │
│ │ 招商中心池加度 │ 招商中心池 │ −670   │ 计入池净量；⚠ 若源册本月无此调整请填 0            │ │
│ │ B座层数 T      │ B座       │ 5      │ 每层单价 = 车间池 ÷ T                            │ │
│ └──────────────┴──────────┴────────┴───────────────────────────────────────────────┘ │
│   [复制上月 →]                                                                       │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ ② 长期常数（改一次，管到下次改）                                                       │
│ ┌──────────────┬──────────┬────────┬───────────────┬────────────────────────────────┐ │
│ │ 参数          │ 作用范围  │ 生效值  │ 生效区间        │ 说明                              │ │
│ ├──────────────┼──────────┼────────┼───────────────┼────────────────────────────────┤ │
│ │ 管理费加价     │ 全园区    │ 0.16   │ 2023-08 起长期  │ 商业单价 = 月均 + 0.16            │ │
│ │ 容量费单价     │ 二期      │ 22.6   │ 2023-08 起长期  │ 元/kVA·月                        │ │
│ │ 路灯面积基数   │ 一期      │ 80000  │ 2023-08 起长期  │ 路灯池 ÷ 80000 ㎡                │ │
│ │ 园区公共电均摊 │ 一期      │ 6 栋   │ 2023-08 起长期  │ 园区级公共电 ÷ 6                  │ │
│ └──────────────┴──────────┴────────┴───────────────┴────────────────────────────────┘ │
│   每行「⋯」：改错（原地覆盖，不留版本）｜自某月起改变（新版本）｜查看历史时间轴                │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ ③ 核算口径（哪块表算总表、哪栋不核算、谁并谁）             ▸ 按栋折叠                        │
│ ▾ B座（一期）                                                                        │
│    · 损耗按纯公摊算：率 = 公摊度数 ÷ 总表 + 加点            2023-08 起长期   [改…]        │
│    · 总表只认「B座总电表①」，其余总表不入 C/D              2023-08 起长期   [改…]        │
│ ▾ C座（一期）                                                                        │
│    · 与 D座 合并计损（共用一块总表）                        2023-08 起长期   [改…]        │
│    · 「力美C201电」不计入总表/分表合计                       ⚠ 仅 2023-08     [改…]        │
│ ▾ G座（二期）                                                                        │
│    · 不核算损耗（只陈列度数，不出损耗率，不入对账合计）       2023-08 起长期   [改…]        │
├─────────────────────────────────────────────────────────────────────────────────────┤
│ ④ 户级例外（某户不按标准）                                       [+ 新增例外] [批量…]     │
│ ┌──────────┬────────────┬───────┬───────────────┬──────────────────────────────────┐ │
│ │ 租户      │ 参数        │ 值    │ 生效区间        │ 覆盖了：                           │ │
│ ├──────────┼────────────┼───────┼───────────────┼──────────────────────────────────┤ │
│ │ 力灏      │ 管理费单价   │ 0.12  │ 2024-01 起长期  │ 全园区 0.16                       │ │
│ │ 鑫皇      │ 层份        │ 2     │ 2023-08 起长期  │ B座默认 1                         │ │
│ └──────────┴────────────┴───────┴───────────────┴──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
 保存后浮出： ┃ 参数已修改 · 影响 2023-08 ~ 2024-02 共 7 个月、一期 4 栋 / 56 户的派生结果已过期
             ┃ [预览影响明细]  [重新生成这些月]  [稍后]
```
- 页面 = 一个页 + 四个分区 + 一个月份选择器；①随月切换，②③④显示「站在该月看的生效值」。
- 表格列固定为：参数（人话名）｜作用范围｜生效值｜生效区间（「仅 2023-08」/「2023-08 起长期」/「2023-08 ~ 2024-01」）｜说明/来源。
- 编辑交互：行内改 ①；②③④ 走「⋯」→ 弹窗二选一「改错」/「自某月起改变」（Oracle DateTrack 模式）。
- 优点：四处散落合一，用户一眼知道「哪些是每月要填的」；缺点：③按栋折叠后，跨栋看「哪些表被剔出」要靠筛选。

### 4.2 方案 B：「按对象树」—— 左树（园区→期→栋→池/表→户），右侧看该对象的全部生效参数与继承来源

```
┌─ 计费参数 · 2023-08 ──────────────────────────────────────────────────────────────┐
│ 左：对象树                       │ 右：B座（一期） · 站在 2023-08 看                    │
│ ▾ 园区                           │ ┌───────────────┬───────┬──────────────┬─────────┐ │
│   ▾ 一期                         │ │ 参数           │ 生效值 │ 生效区间       │ 来自     │ │
│     ▾ A座                        │ ├───────────────┼───────┼──────────────┼─────────┤ │
│     ▾ B座        ← 选中           │ │ 商业电价       │ 1.1142│ 仅 2023-08    │ 一期 ↑   │ │
│        · 池：B座车间池           │ │ 管理费加价     │ 0.16  │ 2023-08 起    │ 全园区 ↑ │ │
│        · 表：B座总电表①(总表)     │ │ 损耗口径       │ 纯公摊│ 2023-08 起    │ 本栋 ●   │ │
│        · 表：B101…B305（12）      │ │ 组C总表        │ 总电表①│ 2023-08 起   │ 本栋 ●   │ │
│        · 户：鑫皇 / 力灏 / …      │ │ 层数 T         │ 5     │ 仅 2023-08    │ 本栋 ●   │ │
│     ▸ C座 ⚠(2 条本月覆盖)         │ │ 路灯面积基数   │ 80000 │ 2023-08 起    │ 一期 ↑   │ │
│   ▸ 二期                          │ └───────────────┴───────┴──────────────┴─────────┘ │
│   ▸ 宿舍                          │  「来自」列：● 本对象设定  ↑ 继承自上级（点开看链）      │
│                                   │  [在本对象上覆盖…]  [查看历史]  [变更记录]           │
└───────────────────────────────────┴─────────────────────────────────────────────────┘
```
- 每个数字都能回答「为什么是这个值、从谁继承来的」（SAP access sequence 的反向视图 / Salesforce 价目簿命中）。
- 优点：③结构口径与④户级例外天然归位到对象下；对「某户/某栋为什么算成这样」的追问最友好。
- 缺点：每月例行填电价/加度要在树里点来点去，① 类参数的月度工作流很别扭；跨对象一览差。

### 4.3 方案 C：「时间轴版本簿」—— 每键一行，横轴是月份，版本是色条

```
┌─ 计费参数 · 版本时间轴 ── 范围 [一期 ▾]  参数类别 [全部 ▾]  年 [2023 ▾] ────────────────┐
│ 参数 / 作用范围              │ 07  08  09  10  11  12 │ 01  02  03 …                     │
├─────────────────────────────┼────────────────────────┼─────────────────────────────────┤
│ 商业电价 · 一期（逐月）        │  ·  1.11 1.09 1.10 1.12 1.09│ 1.08 1.10  ·                 │
│ 管理费加价 · 全园区            │ ▐████████ 0.16 ██████████████████████████▶ 长期        │
│ 容量费单价 · 二期              │ ▐████████ 22.6 ████████▌▐███ 23.0 ██████▶                │
│ 招商中心池加度                 │  ·  −670  ·   ·   ·   · │  ·  −670  ·                    │
│ B座 损耗口径                   │ ▐████ 纯公摊 ██████████████████████████████▶            │
│ 力美C201电 · 剔出Σ             │  ·  [仅此月] ·   ·   ·  │  ·   ·   ·                     │
│ 力灏 · 管理费单价（例外）        │  ·   ·   ·   ·   ·   ·  │ ▐██ 0.12 ████████▶            │
└─────────────────────────────┴────────────────────────┴─────────────────────────────────┘
 点任一格：弹窗显示 该月生效值 / 来源版本(自 X 起) / 谁何时改 / 「改错」「自此月起改变」「删此版本(未被账期使用时)」
```
- 一眼看清「哪条是长期、哪条只对某月」；跨月找漏填（空格子）极容易；版本重叠不可能发生（视觉上就是色条接续，对应 SAP 自动截断）。
- 优点：把「默认·所有月份」这个概念彻底换成「色条从 X 月开始一直延伸」；审计友好。
- 缺点：行数多时（户级例外几十行、表级剔出几十行）需要筛选；不适合当每月录入的主工作面。

### 4.4 推荐：A 为主页，C 作每条参数的「历史」抽屉，B 的「来自」列并进 A 的每一行

理由：
1. 用户的高频动作是「每月填 ①」和「对不上账时查 ③」，A 的分区正对这两件事；B 的树形对月度录入不友好，C 的横表当主页太宽。
2. A 的表格里加一列「来自」（本栋● / 继承自一期↑ / 户级例外覆盖了全园区），就拿到了 B 最有价值的东西——**每个数字可解释**；点「来自」展开命中链：`力灏 0.12（户级例外，2024-01 起）→ 覆盖 全园区 0.16（2023-08 起）`。
3. 任一行「查看历史」打开 C 的单行时间轴 + 变更日志（who/when/旧值→新值），版本 diff 就有了。
4. 三处现有入口（系数簿窗口 / 公共电抽屉 / 损耗屏本月口径面板）**不必删**，改为「只读镜像 + 一个『去参数页改』链接」——写入口收敛为一处，避免再出现「导入静默冲掉人工档案」类漂移。

### 4.5 版本与生效的呈现规则（落到字段级）

| 数据事实 | 页面文案 | 备注 |
|---|---|---|
| `acct_month=''` 的常数键 | **「2023-08 起长期有效」**（起点 = 该键最早有账期使用的月，或版本链首行的 acct_month；若确实无起点，写「长期有效（初始版本）」） | 严禁出现「默认·所有月份」「不限月份」 |
| `acct_month='2023-08'` 的月变键 | **「仅 2023-08」** | |
| `acct_month='2024-03'` 的常数键，且后有 `2024-09` 版本 | **「2024-03 ~ 2024-08」** | 区间右端由下一版本自动推出（SAP 自动截断的展示版） |
| 某月行覆盖了默认行 | 「仅 2023-08 · 已覆盖长期值 1」并给「恢复为长期值」按钮 | 对应现面板的「跟随默认」 |
| 保存动作 | 弹窗二选一：**「改错」**（原地覆盖，用于手滑填错，不产生新版本、日志记「更正」）/ **「自 X 月起改变」**（新版本；X 默认 = 当前选中月，可改） | Oracle DateTrack Correction/Update |
| 删除版本 | 仅当该版本未被任何账期的派生结果取用过时允许「删除」；否则只给「结束于 X 月」 | Stripe 已使用价格只能归档 |
| 版本被账期使用 | 行尾灰字「已被 2023-08 ~ 2024-02 的催缴单使用」 | 提醒改它会牵连 |

### 4.6 「改了要重算」的 UX（三段式）

1. **保存即提示影响范围**（不是保存前拦，是保存后告知）：横幅「参数已修改 · 影响 2023-08 ~ 2024-02 共 7 个月 · 一期 4 栋 / 56 户 / 3 个池的派生结果已过期」。影响范围来自：该参数作用域 × 生效区间 ∩ 已生成派生结果的月份。
2. **预览影响明细**（Terraform plan 式）：表格列 = 月份｜对象（栋/池/户）｜受影响费项｜旧值 → 预计新值（能算则算，不能算就写「需重算」）｜该月账单状态（草稿/已确认）。已确认账单标红「不会自动改，需先取消确认」（物业通「审核过的应收不能改变金额」）。
3. **一键重算 + 记录**：「重新生成这 7 个月」按钮；完成后横幅消失；变更日志追加「因参数 X 变更重算 7 月」。派生页头部长期显示「参数版本：2026-08-16 14:02（与派生时一致 ✓ / 参数已更新，本页数字为旧快照 ⚠）」——把 Excel 手动计算模式的「计算」提示做成常驻。

### 4.7 人话文案原则（具体到键）

原则：**先说对象，再说规则，再说算式；不出现字段名、id、枚举值；时间用「仅 X 月」/「X 起长期」；能给算式的一律给算式。**

| 现在的写法 | 建议写法 |
|---|---|
| `组C只取此总表 building:13 默认·所有月份` | **B座：总表只认「B座总电表①」，其余总表不入总表/分表合计 —— 2023-08 起长期有效** |
| `loss_variant=1` | **B座：损耗按纯公摊算（率 = 公摊度数 ÷ 总表 + 加点）** |
| `loss_variant=2` | **G座：不核算损耗（只陈列度数，不出损耗率，也不进对账合计）** |
| `loss_variant=0` / 无行 | **C座：正常核算（损耗 = 总表 − 分表合计）** |
| `loss_head=25` on building:13 | **C座：与 D座 合并计损（两栋共用一块总表，损耗率合并出一个）** |
| `loss_recon=0` | **G座：不参与「供电侧总表 vs 单元合计」两行对账** |
| `meter:307 loss_exclude=1 (默认行)` | **力美C201电：这块表的度数不计入 C座 的总表/分表合计 —— 2023-08 起长期**；若是月行：**…—— 仅 2023-08** |
| `rule:xx extra_qty=-670` | **招商中心池：本月加度 −670 度计入池净量（直接影响公摊分摊度数）—— 仅 2023-08** |
| `park_share_div=6` | **一期园区级公共电：均摊到 6 栋 —— 2023-08 起长期** |
| `price_flat=1.11417 (p1, 2024-02)` | **一期商业电价：1.1142 元/度 = 供电局月均 0.9542 + 管理费加价 0.16 —— 仅 2024-02** |
| `acct_month=''` | **「长期有效（自 2023-08 起）」** |
| `tenant:力灏 mgmt_price=0.12` | **力灏：管理费单价 0.12（户级例外，覆盖全园区 0.16）—— 2024-01 起长期** |
| 「跟随默认」 | **「恢复为长期值（0.16）」** |
| 「写月行压默认行」 | **「只改 2023-08 这一个月」** |
| 「录新版本」 | **「自 2023-08 起改为 …」** |

补充规则：
- 作用范围列统一用 全园区 / 一期 / 二期 / 宿舍 / B座 / 招商中心池 / 力美C201电 / 力灏（户），不显示 `p1`、`building:13`。
- 数值后跟单位与算式（元/度、元/kVA·月、栋、度）。
- 布尔类不显示 0/1，直接写状态句（「不计入」「参与」）。
- 「仅 X 月」的行用醒目色（现在面板把默认行标红是反的——真正容易背着人生效的是**长期行被误当成本月行**，而**月行是刻意的一次性校准**；建议：长期行常规色，月行加「仅本月」标签，长期行若来自别的月校准则在说明里注明「按 2024-02 校准」）。

---

## 5. 最值得借鉴的 5 条具体做法

1. **Oracle DateTrack 的「改错 / 改变」二选一**：保存参数时必问「原地更正（不留版本）」还是「自 X 月起新版本（旧值保留到上月）」；已有未来版本时再问「只改到下一版本前」还是「连未来版本一起换」。
2. **SAP 条件记录的「自动截断 + 访问顺序」**：录新版本自动把上一版本的截止月改为新版本前一月，用户不手动维护 valid-to；每个生效值可展开「命中链」（户 → 表 → 栋 → 期 → 园区，找到即停）说明它从哪一级来。
3. **Stripe 的「用过的价格只能归档不能删 + 引用逻辑名」**：被任何账期派生结果取用过的参数版本禁止删除，只能「结束于 X 月」；派生引擎按键名取值、页面按键名显示人话。
4. **Terraform plan / Chargebee 的「先预览影响、再选生效时点、再应用」**：保存后横幅列出「影响 N 月 × N 栋/池/户」，可展开逐行旧值→新值与账单状态；已确认账单明确标「不会自动改」。
5. **物业通 / 微小区的「每户单独录入」是标准的一种 + 「费用可按户/按费项清除重算」+「标准变更需审核」**：户级例外与标准同表同版本链，不另开系统；重算是显式、可局部的动作；有权限的人才能把参数改到生效。

---

## 6. 来源清单

国内物业/园区：
- 极致物业收费方案（博客园）<https://www.cnblogs.com/Jeez_JBF/p/17436579.html>；极致官网 <https://www.jeez.com.cn/newsinfo/683338.html>；极致帮助中心入口 <http://help.jeez.com.cn/index.html>
- 微小区「收费项目及标准」<https://www.weixiaoqu.com/2648.html>
- 智轩云物业管理系统用户手册 <https://www.zxnyun.com/plus/products/84.html>
- 西安亘和「物业通」v3.0 功能列表 PDF <https://mkp-res.hc-cdn.com/marketplace/public/app/attachment/20201118/e72d9931-bb90-4ad2-ae88-003f0edfaa28/2011180332453282.pdf>
- 人人都是产品经理「物业收费系统之计费模型设计思路」<https://www.woshipm.com/pd/1439731.html>
- 飞书「8 个专业级物业收费管理系统」<https://www.feishu.cn/content/property-management-system>

ERP / 财务：
- SAP condition technique（Pricefx 知识库）<https://knowledge.pricefx.com/technical-delivery-roles/integration-engineer-knowledge-base-home/sap-integration-reference/use-of-condition-records/sap-condition-technique>；SAP Help Access Sequences <https://help.sap.com/docs/SAP_S4HANA_CLOUD/0e602d466b99490187fcbb30d1dc897c/c3e35944dd8946968493393a3f30b072.html>；有效期重叠 <https://community.sap.com/t5/enterprise-resource-planning-q-a/validity-period-of-the-cond-created-overlaps-with-cond-shorter-periods/qaq-p/2696975>
- Oracle「How DateTrack Works」<https://docs.oracle.com/cd/E18727-01/doc.121/e13513/T2650T402375.htm>；DateTrack 模式 <https://oracleappshr.wordpress.com/2018/02/19/date-track-modes/>
- Stripe「Manage products and prices」<https://docs.stripe.com/products-prices/manage-prices>；Price 对象 <https://docs.stripe.com/api/prices/object>
- Salesforce「Manage Price Books」<https://help.salesforce.com/s/articleView?id=sales.pricebooks_landing_page.htm&language=en_US&type=5>
- Chargebee「Will a new plan price affect the existing subscriptions?」<https://www.chargebee.com/docs/billing/2.0/kb/product-catalog/will-a-new-plan-price-affect-the-existing-subscriptions>
- SAP RE-FX 服务费结算 <https://consiliosit.com/en/sap-real-estate-management-re-fx/settlement-of-service-charges-in-sap-re-fx/>；SAP Community 博文 <https://community.sap.com/t5/financial-management-blog-posts-by-sap/sap-s-4-hana-flexible-real-estate-management-re-fx-service-charge/ba-p/13457955>

UX 惯例：
- Shopify Polaris Contextual save bar <https://polaris-react.shopify.com/components/deprecated/contextual-save-bar>；App Bridge Save Bar <https://shopify.dev/docs/api/app-home/apis/save-bar>
- Terraform plan <https://developer.hashicorp.com/terraform/tutorials/cli/plan>；<https://spacelift.io/blog/terraform-plan>
- LaunchDarkly change history <https://launchdarkly.com/docs/home/releases/change-history>；Audit Log API <https://launchdarkly.com/docs/api/audit-log>

本系统事实（只读查阅）：
- `demo3/backend/.../V47__alloc.sql`（alloc_cfg：scope × cfg_key × acct_month，''=默认行）
- `demo3/backend/.../V62__price_version_chain.sql`（acct_month 语义 = 版本生效起点；常数键前滚、月变键仅命中当月）
- `demo3/frontend/src/views/alloc/LossLedgerView.vue`（「本月口径」面板：loss_exclude / loss_variant / loss_c_meter / loss_head / loss_recon / extra_qty 的现有文案）
- `demo3/frontend/src/views/price-cfg/PriceCfgView.vue`（价目管理 v2 双栏：费项｜范围｜生效价｜生效自｜更新时间 + 户级例外只读卡）
