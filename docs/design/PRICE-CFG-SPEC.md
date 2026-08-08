# 价目管理（PRICE-CFG-SPEC）— UTILITY-BILLING 刀3 · S1 切片

> 状态：定稿（2026-07-27，用户拍板开工）。定位：**派生引擎取价的单一事实源**。
> 本切片只做：储价（V60）+ 录入页（价目管理屏）+ 取价级联规则。**不做派生计算**（S3）。
> 价值锚点：终结"价格活在 Excel 格子里"（宿舍路灯 1.1315688 陈旧跨册引用事故即本切片的反面教材）。

## 1. 数据模型（V60__tenant_price_cfg.sql）

照抄 alloc_cfg 模式（V47:47-58），差异仅两处：**cfg_value DECIMAL(14,8)**（电价 8 位小数，alloc 的 (12,6) 不够）；scope 增加 `tenant:{id}` 层。

```sql
CREATE TABLE tenant_price_cfg (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope      VARCHAR(24) NOT NULL DEFAULT '',  -- ''=全园 | p1|p2|dorm 分区 | tenant:{id} 户级
  cfg_key    VARCHAR(32) NOT NULL,             -- 受控白名单，见 §2
  acct_month CHAR(7)     NOT NULL DEFAULT '',  -- 'YYYY-MM' 月行 | ''=默认行(勿用 NULL，唯一键失效)
  cfg_value  DECIMAL(14,8) NOT NULL,
  note       VARCHAR(255) DEFAULT NULL,        -- 数值来源锚点(如 "2024-02 代理购电价表")
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_price (scope, cfg_key, acct_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
```

扩展方式=**加行不加列**：新费项只新增 cfg_key 取值。月度池派生值（电梯每层基数/损耗率/宿舍路灯 0.06 等）**不进本表**——它们是引擎月算值（P2 §9.1），本表只存单价与参数。

## 2. cfg_key 注册表（受控白名单，前后端各一份镜像常量）

后端 `PriceCfgService.CFG_KEYS`（static Set，照 ContractService.FEE_KEYS 模式）；前端 `utils/priceCfgLogic.ts` 导出 `PRICE_KEYS: {key,label,unit,group,overridable,hint}[]`（分组渲染+户级下拉数据源）。

| group | key | label | unit | 默认值(种子) | 说明 |
|---|---|---|---|---|---|
| 电价·月变 | elec_peak | 峰段电价 | 元/度 | 月行 2024-02: 1.20606875 | 代理购电逐月变 |
| 电价·月变 | elec_sharp | 尖段电价(名义) | 元/度 | 1.50076875 | 实收按峰,见开关 |
| 电价·月变 | elec_flat | 平段电价 | 元/度 | 0.72076875 | |
| 电价·月变 | elec_valley | 谷段电价 | 元/度 | 0.29116875 | |
| 电价·月变 | elec_resident | 居民电价(宿舍) | 元/度 | 0.63586875 | 单一价 |
| 电价·月变 | elec_commercial | 商业电价 | 元/度 | 0.79416875 | |
| 附加与开关 | mgmt_fee | 电力管理费(分时/居民) | 元/度 | ''行: 0.16 | 户级例外 0.15/0.10/0.1 |
| 附加与开关 | mgmt_fee_commercial | 商业维护费 | 元/度 | ''行: 0.32 | 商业综合=0.794+0.32 |
| 附加与开关 | sharp_as_peak_ratio | 尖按尖价收取比率 | 比率 | ''行: 0 | 政策开关,0=尖按峰收 |
| 容量与水 | capacity_fee | 装机容量费 | 元/kVA·月 | ''行: 22.6 | 55户实证;可莱恩23户级 |
| 容量与水 | water | 水价 | 元/吨 | ''行: 3.95; dorm行: 3.85 | 户级例外 4.45 |
| 容量与水 | water_pipe | 水管网维护费 | 元/吨 | ''行: 0.5; dorm行: 0 | 宿舍无管网费 |
| 月推参数 | lamp_area_base | 路灯面积基数 | ㎡ | p1行: 80000; dorm行: 15510 | 月推分母,非全司常数 |
| 月推参数 | green_area_base | 绿化面积基数 | ㎡ | p1行: 15510 | 一期绿化0.009月推分母 |
| 月推参数 | area_base | 园区总面积基数 | ㎡ | p2行: 148918.01 | 二期园区级池(消防/路灯/绿化)分母,原表硬编码10格 |
| 月推参数 | elevator_area_base | 电梯面积基数 | ㎡ | p1行: 12487.04 | A座电梯分母(历史计费面积≠在租面积17424.19) |
| 特殊轨道 | loss_rate | 固定损耗率 | 比率 | dorm行: 0.012 | 仅宿舍/商铺固定;厂房月算 |
| 特殊轨道 | elec_package | 包干电价 | 元/度 | 无默认行 | 仅户级:包干户1.0/商铺1.5 |
| 特殊轨道 | share_elec_fixed | 孵化协议固定收取(电) | 元/月 | 无默认行 | 仅户级:替楼层公共+电梯+路灯三项 |
| 特殊轨道 | share_water_fixed | 孵化协议固定收取(水) | 元/月 | 无默认行 | 仅户级:替绿化水公摊 |

**2026-08-09 包干两键**：`elevator_package` 改名 `share_elec_fixed`（建键时以为孵化器包干只替电梯；源册
`一期2024年2月水电费.xlsx` 各户缴费通知单 + 电费/水费两张总表证明它替「楼层公共、消防照明 + 电梯用电 +
路灯公摊」三项），并新增水侧同形态的 `share_water_fixed`（替「绿化水公摊」，**不含**按吨计的水管网维护费）。
改名时 `elevator_package` 全库 0 行。派生消费点=`BillNoticeService.applyPackages`：命中户的原公摊行不落，
改落一条固定额行（fee_key 沿用 `share_elec_floor`/`share_green_water`，回挂 pool_rule_id）。**注册表 20 键。**

**V61→V62 演进**：V61 曾把公摊单价改为月行快照；**V62（用户拍板 2026-07-27）彻底删除这五个键**（green_water/green_water_hi/lamp_sqm/fire_sqm/elevator_sqm）——它们是引擎月推输出不是价目输入，不入价目簿（公式见 POOL-FORMULA-AUDIT-2024-02.md），价目簿只存其面积基数参数。**注册表定格 19 键**。电价 6 键标 `monthly: true`（月变键）。

词表映射（决策⑤固化，随 registry 落前端常量 `POWER_TYPE_WORDS`）：大工业/工业→industrial；一般工商业/商业→commercial；居民→resident。语义注记：industrial≈两部制(收容量费)、其余≈单一制（power_type 改名属 S2）。

## 3. 取价规则 v2：版本链（前后端同规则，各一份实现+测试）

**acct_month 语义 = 版本生效起点**（''=初始版本/自始生效）。每个 (scope, cfg_key) 的行序列按 acct_month 升序构成**版本链**；`updated_at` 为该版本的变更时间戳（MySQL ON UPDATE 自动）。改价=写入"自某月起"的新版本行，**历史账期取价永不受扰动**——这是"账单不窜时间"的第一层保证（第二层=S3 派生落 bill_notice 时快照 price_snap+版本生效月）。

`resolve(key, ym, tenantId?, zone?)`：按 scope 级联 `tenant:{id} → zone → ''`，**每级内部**：
- **月变键**（registry `monthly: true`，即电价 6 键）：仅命中 `acct_month == ym` 的行（电价逐月变，缺当月版本=null→派生门禁拦截，绝不用上月价滚出错账；月变键禁止 '' 行，upsert 校验 400）；
- **常数键**：命中 `acct_month <= ym` 中最大者（''最小）——没有变化就一直沿用该版本，"版本自动前滚"。
某级命中即返（返回 value + acctMonth 生效起点 + updatedAt 时间戳），全空返 null。字符串比较即可（YYYY-MM 字典序=时间序）。

## 4. API 契约（照抄 alloc cfg 端点形制）

- `GET /api/price-cfg` → `List<PriceCfgDTO>`：**整表全量**（行数<100，版本链解析与历史展示归前端），排序 scope,cfg_key,acct_month。DTO=record{id,scope,cfgKey,acctMonth,value,note,**updatedAt**,tenantName}——tenantName 仅 tenant: scope 非空（联租户表解析，已删租户显"已删租户#id"）。
- `PUT /api/price-cfg` → 单行 upsert：req=record{scope(@Pattern `^(|p1|p2|dorm|tenant:\d+)$`), cfgKey(@NotBlank,白名单校验 400), acctMonth(@Pattern 可空,null→''；**月变键必填非空**否则 400), value(null=删该版本行), note}。
- `POST /api/price-cfg/copy` → req{fromYm,toYm}：仅复制**月变键**（电价 6 键）的 fromYm 版本到 toYm，目标已有跳过（幂等），返回 record{copied,skipped}——语义="复制上月电价"。
- 权限零配置：SecurityConfig 全局门（GET=已登录可读，非 GET=ADMIN）。业务错误 HTTP 200+body.code（白名单外 key=400），校验失败 HTTP 400。

## 5. V60 种子

默认行/分区行按 §2 表格"默认值"列全量插入（note 写文档锚点）；月行插 2024-02 六个电价。**V62**：删除五个月推键（green_water/green_water_hi/lamp_sqm/fire_sqm/elevator_sqm）全部行——引擎月推输出不入价目簿。**户级例外不入迁移**（tenant_id 环境相关），由录入页人工添加，待录清单（9 项，S3 锚点月验收前必录）：
永龙 mgmt_fee 0.15｜朱漫钳 mgmt_fee 0.10｜林锐辉 mgmt_fee 0.1｜南一·朱漫钳 water 4.45｜可莱恩 capacity_fee 23｜禹晨/粤海华创/联塑精铟 elec_package 1.0 + water 4.45｜商铺户 elec_package 1.5｜孵化器5户 share_elec_fixed 232/47.2/63.8/47.3/79.45 + share_water_fixed 155/31.5/42.54/31.6/53（SQL 草稿 `backend/scripts/fixes/incubator-package-20260809.sql`）。

## 6. 页面设计（价目管理 · value='price-cfg' · 出账链组 合同管理之后）

**v2 重设计（2026-07-27 用户反馈：信息密度不足、留白过多）——单视图双栏，取消 tabs。**

**遵守规范**：EDIT-MODE-SPEC v2 + LIST-PAGE-SPEC（56px 行高/列宽铁律；免 useFitRows/FPPager，短窗外层滚动）+ DESIGN-FIDELITY §6 加载门/§7 覆盖层。

骨架：标题行（h2「价目管理」+ 副标题「收费价目版本簿 · 派生取价单一事实源」）→ `.mx-toolbar`（左=年 Select+月 Select+**月变价状态徽标**（电价当月版本 6/6 绿 / 缺 N 项红,红时 title="缺当月电价版本,该月派生将被门禁拦截"）；右=「复制上月电价」Button(size=sm,**仅编辑态**,confirm 带 from→to 与跳过说明) →「编辑模式/完成」（最右,v-if="!auth.isReadonly"）→ `.mx-body` 双栏 grid（`grid-template-columns: minmax(0,1fr) 360px; gap:16px`，窄窗右栏换行到下方）。

**左栏·价目表**（手写分组表格,分组小节头行,56px 行高）：列=费项(label+unit,hint 作 title)｜范围(Badge)｜**生效价**(resolvePrice v2 解析)｜**生效自**(版本起点:acctMonth 或"长期")｜**更新时间**(该版本 updatedAt,YYYY-MM-DD HH:mm)｜编辑态末列=**新价输入**(placeholder="自 {选定月} 起",@click.stop @change 即时写回 upsert{acctMonth:选定月},title="回车/失焦保存;只影响 {选定月} 及以后账期")。月变键(电价)输入即录当月版本;清空=删除选定月版本行(PUT value=null)。无死列(不再有恒为"—"的默认值/当月值双列)——密度即来自于此。
**右栏·上卡「版本状态」**：选定月概览紧凑列表——电价月版本 n/6(缺失红字列出缺哪几个)；各组生效键计数；全簿最近更新时间戳(max updatedAt+对应费项名)。
**右栏·下卡「户级例外」**：紧凑表(租户｜费项｜值｜生效自｜编辑态:删)+编辑态卡头「新增」→ FPDrawer（FPTenantPicker+overridable 费项 Select+生效月(空=长期)+值+备注）。删除原生 `confirm('确认删除「{租户} · {费项}」例外？删除后该户回退默认价。')`。

通用不变：首载加载门/v-else 紧邻/++seq 竞态防线/watch([year,month])/onDeactivated 复位/空态三分支/alert 错误。

通用：首载 `<template v-if="loaded">` + `.page-loading` 加载门，v-else 紧邻铁律；`loadMonth` 带 `++seq` 竞态防线；`watch([year,month])` 重载；`onDeactivated` 复位 editMode+drawer；空态三分支（编辑态引导录入/浏览态提示进编辑模式/viewer 纯说明）；写失败 `alert(e.message ?? '保存失败')`。图标 'tags'（ds/icon.ts 未注册则注册 lucide Tags）。

## 7. 测试与验收

后端 `api/PriceCfgApiIT`（extends AbstractMysqlIT，@Transactional 回滚，写路径月份用 **2099-XX 槽**，探针模式禁顺序依赖）：种子回读（jsonPath 过滤断言 elec_peak 2024-02=1.20606875、dorm water=3.85）／PUT upsert+更新／value=null 删行回退／copy 幂等（二跑 copied=0）／白名单外 key→body.code 400／scope 非法→400／ym 格式→400。前端：`priceCfgLogic.spec.ts`（六步级联+词表）；fpNav.spec 45→46+`r['price-cfg'].layer==='data'` 锚点；`npm run typecheck`+`npm test` 全绿。人工验收：浏览器目视两 tab/编辑模式/复制上月/例外增删。

## 8. 实施 plan（workflow 两 agent 并行，文件面无交集）

**A-后端**：V60 迁移(§1+§5) → entity/TenantPriceCfg(@Data/@TableName/@TableId AUTO/fill 注解) → mapper(BaseMapper+default selectEffective(ym)) → service(白名单+resolve+upsert+copy,构造注入+BizException) → controller(@Tag/@Validated,直返 DTO) → dto 三 record → PriceCfgApiIT → `mvn test -Dtest=PriceCfgApiIT` 绿。
**B-前端**：api/priceCfg.ts(http 封装,Promise<T>) → utils/priceCfgLogic.ts(PRICE_KEYS+resolvePrice+POWER_TYPE_WORDS)+spec → views/price-cfg/PriceCfgView.vue(§6) → fpNav 插行+spec 46 → router meta.value 分支+懒加载 → icon 注册 → `npm run typecheck`+`npm test` 全绿。
**C-验收**（主会话）：起 dev server 浏览器目视 + 记忆归档。
