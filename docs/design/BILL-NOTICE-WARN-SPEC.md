# BILL-NOTICE-WARN-SPEC — 催缴单告警:结构化与文案门禁

> 范围:催缴单(`BillNoticesView`)的八类生成告警。本规范同时修两件事 ——
> **A** `bill_notice.warn` 这个 255 字符的分号口袋换成结构化条目;
> **B** 告警文案进入一道机器门禁,写歪了会红。
>
> 本文里的每条规矩后面都跟一条「怎么验证」。没有判据的话不写。

---

## §-1 这一稿的来历

2026-09-23 一轮工作流产出草案,三名对抗复查者提出 8 条 blocking,本稿逐条改过:

| # | 被推翻的 | 改成 |
|---|---|---|
| 1 | §1.4 payload 取 `contract_no` | 取计费行 id。实测合同 145 有 5 条缺参数行、其中两条同名,原方案会撞 `uk_warn` 导致**整月出不了单** |
| 2 | §2.1「warn 列留一版当 undo」 | 说明它不是 undo:463 条全在 draft 单上,重生成会连行带串删掉 |
| 3 | §2.1 缺 payload 唯一性约束 | 补成第 4 条硬约束,并规定后端去重键 = `(code, payload)` |
| 4 | §5.1 `itemLabel` + `fmt` 双标签 | 删 `itemLabel`,标签只由 `fmt` 出(否则屏上是「房号 房号 544」) |
| 5 | §5.2 声称 G5 钉住了「场地未定:544.00」 | 实测三起事故 G5 一起都拦不住。G5 降级为防退化写法,新增 **G6 闭集断言**(唯一会为真实事故变红的判据) |
| 6 | §4.4 chip 公式 `s+g.items.length` | 补 `|| 1` 兜底。本屏现有那组 stale 的 items 就是空的,不补则 chip 显示「无待处理」 |
| 7 | §8「条数落在 ~344 的量级」 | 删掉。那个数按旧形状算,新形状按实例展开必然数倍于它 |
| 8 | §8 只跑 vitest | 补 `npm run build`:类型门禁红在 `vue-tsc` 那一步,数 vitest passed 看不见 |

另有一条草案里的活是不存在的,一并删除:`DataHomeServiceTest:308` 是纯函数吃字面量,
改口径它根本不会红,按草案去「重新钉」等于制造假绿。

---

## §0 为什么现在改

**病根 A —— 字段窄,于是文案必须短,于是屏上什么也做不了。**
`warn VARCHAR(255)`(`V89__bill_notice.sql:16`)里用分号拼接九类语义完全不同的告警,
前端 `billNoticeLogic.ts:647` 再 `split(';')` 拆开。字段窄 ⇒ 每条写到最短、不带实例数据
⇒ 屏上没法分类、没法列条目、没法给落点。今天它的全部呈现是:行尾一个 hover 才看得见的「!」
(`BillNoticesView.vue:958`)和明细抽屉里一坨 `white-space: pre-line` 的文本(`:994-996`)。

**病根 B —— 这条链上没有验收。**
数字算错了有人对账发现;字写歪了没有任何机器或人会发现。实测事故:

| 事故 | 原因 | 状态 |
|---|---|---|
| `场地未定:544.00` | 拼的是 `meter.name` 导入原串,水表那批带 `.00`,用户读成金额 | 2026-09-23 已修 |
| `rent_office` / `rent_dorm` 原始 key 上屏 | 同上 | 2026-09-23 已修 |
| `缺价 elec_sharp(2024-02)` | 原始价目键直接上屏;中文名的事实源在前端,后端手上没有 | **未修**(库里当前 0 条,没被撞上) |

**第三个证据 —— warn 是冻结快照,改了代码旧行不会变。**
实测库里 463 条带 warn 的单,装的全是 2026-09-23 之前的话:
`有费项未设置收款公司` 401 条(判据已从代码摘掉)、`场地未定:xxx` 86 条(文案已改成
`房号对不上合同:xxx`,而新文案库里 **0 条**)。这正是「改完这里那里还在说旧话」。

---

## §1 告警目录(九类)

通用约定:

- `code` = `WarnCode` 枚举常量名,**库里、DTO 里只有它**,一个汉字都不存。
- `payload` / `hint` = **实例数据**(房号、价目键、合同号、表名),不是文案。
- 屏上一行 = `fmt(payload, hint)` 的返回值,**标签与值都由 `fmt` 一处出**。
  不另设 `itemLabel` 字段:标签有两个出处就会拼成「房号 房号 544」,而 §1.7 的条目
  (一个费项名)根本没有「标签+值」结构,一个必填的 itemLabel 会逼它编一个词。
- 「实测条数」一律取自 **2026-08-30 那三批旧快照**,新代码重生成后会变;取旧数是因为今天库里
  只有这一份可数的东西,不是新代码的预测。

### §1.1 `W_METER_NO_CONTRACT` 有表未归属合同

| 项 | 内容 |
|---|---|
| 屏上块头 | 表没挂上合同 |
| desc | 这些表在出单时找不到归属合同,金额照出但挂在租户名下,没留合同快照。不处理的话事后按合同对账时这几块表的钱找不到出处。 |
| 条目形状 | `{hint}`(hint = `meterTag(m)`,见下;hint 为空时回落 `表 #{payload}`);payload = `meterId` |
| 落点屏 | `/meters` 园区抄表 · 动作「去园区抄表」 |
| 判据(代码) | `"manual".equals(row.status())` — `BillNoticeService.java:273` |
| 判据(人话) | 绑定解析没给这块表定出合同 |
| 对账单影响 | 行照出、金额一分不变;`contract_id` 快照为空、premise 落不上 |
| 实测 | 65 单 / 32 户 / 39 个户·月 / 3 个 ym 全中 |
| 进抽屉 | 是 |

> `MeterBindingDTO.Row` 已经带 `bucket`(`date_missing` / `ambiguous` / `bld_mismatch` /
> `no_contract`,`MeterBindingService.java:141-150`),四种原因在触发点上已经分好了。
> 本轮**不**把它拆成四个 code:那是四段新文案、四个新落点判断,超出「换形状」的范围。
> 落进 `payload` 也不做 —— payload 已经被 `meterId` 占着,而 uk 是 `(notice_id, code, payload)`。
> 记在这里,下一轮要拆时判据是现成的。

**这块表在屏上怎么称呼 = `BillNoticeService.meterTag(Meter)`。** 一条判据,两处共用
(本类的 hint、`W_ROOM_MISMATCH` 的「裸数字表名存空串」),不许各写各的:

| 表名(`meter.name`) | 屏上写 | 为什么 |
|---|---|---|
| 带字(`A101旭化成水`) | 表名本身 | 它是唯一认得出「是哪一块」的东西 |
| 只有房号数字(`636.00`、`544`) | `{spot} {sub_name}`(`六楼 4-636 水表①`) | 裸数字上屏会被读成金额 —— 「场地未定:544.00」那起事故的形状 |

不拿 `sub_name` 单独做主:2026-09-23 真屏走查,租户旭化成三块水表的 `sub_name` 全是「水表①」,
屏上并排三行一模一样。实测面:358 个条目 / 229 块表 → `meterTag` 出 **229 个互不相同**的称呼,
任何一张单里都没有重样条目,也没有一条裸数字上屏(库里数出来的,不是估的)。

钉它的断言在 `BillNoticeApiIT` t9:同户四块表(两块带字、一块裸数字、一块普通),
断言 hints `hasSize(4).doesNotHaveDuplicates()` 且 `doesNotContain("636.00")`。
破坏验证:`meterTag` 改回 `sub_name` → 红;去掉裸数字回落 → 红。

### §1.1b `W_METER_BIND_STALE` 表绑的合同本月没生效

> 2026-09-23 补的第九类（旭化成报障）。编号用 `1.1b` 不改后面七节的号：§1.7 之类被正文引用着，
> renumber 会把那些引用全指歪。`WARN_CODES` 里它排**第二**（屏上组序：两类表的问题挨在一起）。

| 项 | 内容 |
|---|---|
| 屏上块头 | 表绑的合同本月没生效 |
| desc | 这些表被指认给了一份本月还没生效(或已经到期)的合同,那份合同的前后期里也没有能接上本月的。量照算进这张单,但单上这几块表挂的是一份本月不作数的合同 —— 而同一张单的租金走的是本月那一期,事后按合同对账时两边对不上。 |
| 条目形状 | `{hint}`（hint = `meterTag(m)`，与 §1.1 同一条判据）；payload = `meterId` |
| 落点屏 | `/meters` 园区抄表 · 动作「去园区抄表」 |
| 判据(代码) | `"override_stale".equals(row.status())` — `BillNoticeService` 与 §1.1 同一处 if/else |
| 判据(人话) | 有人给这块表指认过一份合同，但本月不在它的租期内，它所在的递增段/续签链上也没有能接上本月的段，规则 2-5 的自动归属同样定不出替代 |
| 对账单影响 | 行照出、金额一分不变；`contract_id` 快照落的是**本月并未生效的那一份** |
| 实测 | 改绑定规则之前 2023-08 有 203 行这种表费项、一声不吭；规则改后 2023-08 残留 108 块表进这一类，2023-10 / 2024-02 归零（见 `S2-BIND-SPEC` 规则1修订） |
| 进抽屉 | 是 |

> **为什么不并进 §1.1。** 那一类是「没人指认过」→ 去挂合同；这一类是「指认过但指错了期」
> → 去改绑定、或去补那一期的合同。动作不同就不共用一句话（§5 的规矩）。
> 而且并进去还会撞 `uk_warn`：两类的 payload 都是 `meterId`。

### §1.2 `W_ROOM_MISMATCH` 房号对不上合同

| 项 | 内容 |
|---|---|
| 屏上块头 | 房号两边对不上 |
| desc | 表上的房号和合同上的房号对不上,位置只能退回合同级的一长串。不处理的话单子上的位置说不清是哪间房。 |
| 条目形状 | `房号 {payload}`,hint 非空时追加 `(表 {hint})`;payload = 房号 token,hint = 表名(表名是裸数字时为空) |
| 落点屏 | `/meters` 园区抄表 · 动作「去园区抄表」 |
| 判据(代码) | `Pin.undecided()` = `tokens > 0 && cands > 0 && candTokens > 0 && hits == 0` — `BillNoticeService.java:1071`,触发 `:290-300` |
| 判据(人话) | 两边都写了房号,但一个都没对上 |
| 对账单影响 | premise 回退合同级长串,行照出,金额不变 |
| 实测 | 86 单 / 18 户 / 408 条目(旧文案「场地未定」);单户单月去重后最多 **9** 条 |
| 进抽屉 | 是 |

> 它分不出「合同漏录这间房」还是「这块表挂错人」—— `BillNoticeService.java:284-289` 的注释
> 已明确拒绝写成定性文案。desc 照此只写测量(对不上),不替用户判断哪边错了。
> 任务书里的「一户最多 27 条」是同一户(租户 60)**跨三个月**的合计,单户单月实测上限是 9;
> 9 行是内容不是拥挤,不做折叠(§4.4)。

### §1.3 `W_CONTRACT_NO_DATES` 缺起止日期

| 项 | 内容 |
|---|---|
| 屏上块头 | 合同没有起止日期 |
| desc | 这些合同没填起止日期,整份合同的租金行都没派生出来。不处理的话单子上这几户的租金是缺的。 |
| 条目形状 | `合同 {payload}`;payload = `contract_no` |
| 落点屏 | `/contracts` 合同管理 · 动作「去合同管理」 |
| 判据(代码) | `c.getStartDate() == null || c.getEndDate() == null` — `BillNoticeService.java:736-739` |
| 判据(人话) | 起或止有一头是空的 |
| 对账单影响 | 该合同**整份**不出租金行(`continue` 跳出整个计费行循环) |
| 实测 | 落库 23 单 / 3 户(115 双成 9、119 仁恒 10、360 黎镇源 4) |
| 进抽屉 | 是 |

> 判据排在 `covers()` **之前**(`:740`),而无日期合同天然不可能 covering ——
> 所以它对每个账期月都必然触发一次,与该合同当月是否在租无关。这是结构性的,不是 bug,
> 但意味着这一组的条目数不会随时间自己消掉。

### §1.4 `W_TERM_NO_PARAMS` 计费行缺参数

| 项 | 内容 |
|---|---|
| 屏上块头 | 计费行参数不全 |
| desc | 这些计费行少了算钱要用的参数,这一行的租金没派生;同一份合同里其他行照出。不处理的话单子上少这一笔。 |
| 条目形状 | `合同 {hint}`;payload = `String(term.getId())`,hint = `contract_no + ' · ' + fee_name` |
| 落点屏 | `/contracts` 合同管理 · 动作「去合同管理」 |
| 判据(代码) | `ContractService.lineMonthly(t, kva) == null` — `BillNoticeService.java:748-752`,分支见 `ContractService.java:796-810` |
| 判据(人话) | 按 `bill_mode` 该填的那几个字段有空的(按㎡缺面积或单价 / 按间缺单价或间数 / 按 kVA 缺合同容量 / 其余缺固定金额) |
| 对账单影响 | **只跳该行**,其余租金行照出 |
| 实测 | 29 单 / 4 户(11 保奔路 6、14 中科华贸 9、104 合源创盈 9、146 周兴 5) |
| 进抽屉 | 是 |

> ⚠ **payload 必须是计费行本身的 id,不能是 `contract_no`。** 2026-09-23 对抗复查实测:
> 合同 145(`S10-0145#1`,租户 11)有 **5 条**缺参数计费行,其中**两条都叫「厂房租金」**;
> 合同 94 有 4 条,合同 54 / 74 / 330 各 2 条,三个账期全覆盖。
> payload 取 `contract_no` 时这 5 条在同一张单上撞 `uk_warn` → 多值 INSERT 报 1062 →
> `generate()` 是 `@Transactional` → **整月一张单都生成不出来**。把 `fee_name` 也并进唯一键
> 同样救不了(那两条同名)。所以 payload 取行 id,`contract_no · fee_name` 放 hint 给人看。
> 两条同名行会在屏上出现两条一模一样的条目 —— 这是实情(那份合同确实有两条同名行),不是重复。

### §1.5 `W_RENT_FREE_BAD` 免租期读不出来

| 项 | 内容 |
|---|---|
| 屏上块头 | 免租期读不出来 |
| desc | 合同上的免租期字段读不出来,这个月按没有免租算,租金比应收多。不处理的话这几户会多收。 |
| 条目形状 | `合同 {payload}`;payload = `contract_no` |
| 落点屏 | `/contracts` 合同管理 · 动作「去合同管理」 |
| 判据(代码) | `rent_free` JSON 解析抛异常 — `BillNoticeService.java:806-812` |
| 判据(人话) | 免租期那段存的内容解析不了 |
| 对账单影响 | 免租扣减按 0 记,金额**偏高** —— 八类里唯一一条「多收」型 |
| 实测 | **0 条**。全库只有 1 份合同的 `rent_free` 非空且 `JSON_VALID=1`;写入口 `validateRentFree` 已校验,这是纯防御分支 |
| 进抽屉 | 是(组可以永远为空) |

> 实测 0 条,所以**不**为它设计条目 UI、不给它 hint。保留一个可以永远为空的 code 就够。
> 它给得出动作(去改那份合同),所以不触发 §6-3 的破例。

### §1.6 `W_PACKAGE_NO_POOL` 包干行没挂上池

| 项 | 内容 |
|---|---|
| 屏上块头 | 包干行没挂上池 |
| desc | 这些包干行收了钱但没记到任何公摊池的已分摊里,对应池的未分摊差额会比实际高。不处理的话池账本上的差额对不上。 |
| 条目形状 | `{hint}`;payload = `feeKey`,hint = 费项中文名(走 `billFeeLabel`) |
| 落点屏 | `/alloc` 公共电核算 · 动作「去公共电核算」 |
| 判据(代码) | `poolId == null` — `BillNoticeService.java:930` |
| 判据(人话) | 找不到这笔包干该记到哪个池 |
| 对账单影响 | 行照出、金额=固定价;真影响在 §5.9 回填:`:573-575` 只聚合 `pool_rule_id` 非空的行,这笔钱进不了 `alloc_pool_result.allocated_amount` |
| 实测 | 22 单 / 7 户 / 2 个 ym;悬空 12 行合计 ¥875.35(`share_green_water` 10 行 627.28 + `share_elec_fire` 2 行 248.07) |
| 进抽屉 | 是 |

> desc 写的是后果(差额虚高),不是判据的复述(「无公摊池锚点」)——这是屏上文案口径:
> 写测量与后果,不写内部术语。
> `share_green_water` 那 10 行 **10/10 全部**无锚点(水侧园区级自动名册池没有显式成员,
> `:858-862`),这一类可能天然消不掉。本轮照旧报,该不该摘掉列在不做的里。

### §1.7 `W_PRICE_MISSING` 缺价

| 项 | 内容 |
|---|---|
| 屏上块头 | 这个月缺价 |
| desc | 这几项这个月没有可用的单价,对应的费用整项没出。不处理的话单子上少这几项。 |
| 条目形状 | `{paramDef(payload)?.label ?? payload}`;payload = 价目键 |
| 落点屏 | `/params` 计费参数 · 动作「去计费参数」 |
| 判据(代码) | `price.resolveHit(key, ym, tid, zone) == null` — `missPrice` 定义 `:1003-1004`,三个调用点 `:622` / `:630` / `:686` |
| 判据(人话) | 这个价目键在本月取不到价 |
| 对账单影响 | 跳该行,该项费用不出 |
| 实测 | **0 条**(全期三个月从未被撞上) |
| 进抽屉 | 是 |

可触发的键恰好 7 个:`elec_sharp` / `elec_peak` / `elec_flat` / `elec_valley` /
`elec_resident` / `elec_commercial` / `water`。`capacity_fee`(`:311`)、
`water_pipe`(`:672`)、`mgmt_fee*`(`:650`)取价失败走裸 `return`/`continue`,不产生告警
(本轮不补,见不做的)。

**payload 不带 `ym`**:`missPrice` 三个调用点传的 `ym` 全是 `generate(ym)` 的形参本身,
与单头 `bill_notice.ym` 恒等,是冗余。所以 `missPrice` 的签名同批去掉 `ym`。
中文名走前端 `paramRegistry.ts`(`elec_sharp` → 尖段电价),后端不抄第二份。

### §1.8 `W_TOTAL_NEGATIVE` 本期合计为负

| 项 | 内容 |
|---|---|
| 屏上块头 | —(不进抽屉) |
| desc | 这张单的合计是负数,通常来自读数回退或跨户转供冲减。 |
| 条目形状 | 无 payload、无 hint |
| 落点屏 | 无 |
| 判据(代码) | `total.signum() < 0` — `BillNoticeService.java:535`(唯一写在 `groups` 循环体内的,即**按单**算) |
| 判据(人话) | 这张单加起来是负的 |
| 对账单影响 | 无。负值本身合法(`V89:48` 行注释:允许负值) |
| 实测 | 1 单(id 15314,2023-08,租户 28,-3867.28;来自 `elec -3935.46` 与 `mgmt_fee -990.26` 两行) |
| 进抽屉 | **否**,`drawer: false` |

**`drawer: false` 的理由(必须写在文案表的 `why` 字段里,门禁 G3 查它非空):**
它不是数据缺口而是一个结论,清除路径不存在,给不出 §6-3 要求的可执行动作。
落点保持今天的样子:行尾「!」与明细抽屉横幅。

---

## §2 数据形状

### §2.1 DDL(V126,只建表)

```sql
-- V126__bill_notice_warn.sql — 催缴单告警条目化(BILL-NOTICE-WARN-SPEC §2)。
-- 为什么:warn VARCHAR(255) 是个分号口袋,九类语义不同的告警拼在一起,字段窄逼着每条写到最短、
-- 不带实例数据,屏上于是没法分类、没法列条目、没法给落点。
-- 为什么不回填:库里 463 条 warn 是 2026-08-30 的快照,其中 401 条的判据(有费项未设置收款公司)
-- 已于 2026-09-23 从代码摘掉,86 条还是旧文案(新文案「房号对不上合同」库里 0 条)。
-- 解析回填 = 把两个刚修好的 bug 原样搬进新表。要新告警就点一次「重新生成」。
-- warn 列留一版:代码停止读写它,核对无误后下一个迁移再 DROP。
-- ⚠ 它**不是 undo**。463 条旧 warn 全部落在 draft 单上(实测 0 条在 confirmed/exported),
--   而落地第 10 步的重新生成会把这些 draft 单连行带串一起删掉。留这一列只是为了迁移期间
--   万一要回读老文本,不构成「改坏了能退回来」的保证。真要回退得靠 git + 再生成一次。

CREATE TABLE IF NOT EXISTS bill_notice_warn (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  notice_id INT UNSIGNED NOT NULL,
  code      VARCHAR(24) NOT NULL COMMENT '告警类别=WarnCode 枚举常量名;库里不存文案',
  payload   VARCHAR(64) NOT NULL DEFAULT '' COMMENT '实例数据业务键(房号/价目键/合同号/表 id/费项键);无实例数据的类固定空串',
  hint      VARCHAR(64) NOT NULL DEFAULT '' COMMENT '第二段实例数据(表名/费项名);无则空串',
  UNIQUE KEY uk_warn (notice_id, code, payload),
  CONSTRAINT fk_warn_notice FOREIGN KEY (notice_id) REFERENCES bill_notice(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='催缴单告警条目;随单生随单死(CASCADE)';

ALTER TABLE bill_notice MODIFY warn VARCHAR(255) NULL
  COMMENT 'V126 之前的告警快照,只读;新告警在 bill_notice_warn';
```

三条硬约束,每条都有出处:

1. **`ON DELETE CASCADE` 是唯一的清理路径。** 全仓没有任何显式删明细行的代码 ——
   `generate()` 开头一句 `notices.delete(del)`(`BillNoticeService.java:167`,注释原话
   「行由 FK CASCADE 连删」),`confirm` / `markExported` / `void` 都只 `updateById`。
   *验证:* `SHOW CREATE TABLE` 必须含 `ON DELETE CASCADE`;IT 里 generate 两次后
   左连 `bill_notice` 为空的孤儿行数 = 0。
2. **`payload` / `hint` 写 `NOT NULL DEFAULT ''`,不写 NULL。** `V92__bill_note_override.sql:5`
   已为这件事栽过:MySQL unique 索引对 NULL 不去重,NULL 键会攒重复行。
   *验证:* IT 里同一 notice 同 code 空 payload 插两次必须撞唯一键。
3. **挂 `notice_id`,不挂业务键。** `bill_note_override` 挂业务键是为了**活过重生成**
   (V92 头注),而告警是引擎输出,必须随单一起死。
4. **`payload` 必须在同一张单内唯一地指向一个实例。** `uk_warn` 在多值 INSERT 下不是去重器,
   是断路器:撞一行,整条 SQL 失败,整个 `generate()` 事务回滚。所以 payload 取的必须是
   「一行一个」的键(行 id、房号 token、价目键),不能取「一对多」的键(合同号、租户 id)。
   后端去重同批显式写成 `LinkedHashMap` keyed by `code + '\u0000' + payload`,
   **不要**让 `Warn` record 的 equals 把 hint 算进去 —— 否则 hint 差一个字就多一行,
   而 DB 那边只认 `(notice_id, code, payload)`,两边口径一差就是一次整月回滚。
   *验证:* IT 里造一份有两条同名缺参数计费行的合同 → generate 成功且落 2 行(不是撞键,也不是塌成 1 行)。

### §2.2 作用域怎么建模:不加 scope 列

七类按户算(`warnByTenant`,`:534` 被拷给该户每张单),一类按单算(`:535`)。
这个不对称是**生成期哪个循环写的**事实,不是存储事实。

- 八类一律挂 `notice_id`。户级那七条本来今天就已经被逐单复制(实测放大 1.77 倍,
  427 个户·月 → 739 张单,一户最多 6 张,抽样 id 14870–14875 六张单 warn 逐字相同)。
  结构化没让这件事变坏,也不该趁机改它。
- `code → 进不进抽屉` 在前端文案表的 `drawer` 字段里,不落库。
  *理由:* 落成列等于把可推导的数据存两份,`code` 改语义时会读出错值。

容量:三个月全量约 344 条(旧串 949 个分号段,剔掉 401 条已废判据、再按房号去重约 -204)。
对照 `bill_notice_line` 现有 7070 行,容量不是约束。**不建 `code` 索引**:
今天没有跨月按 code 统计的消费方,`uk_warn` 的最左前缀 `notice_id` 覆盖全部已知查询。

### §2.3 写入时机与批量

告警行与明细行同一个循环攒进 `pendingWarns`(必须在 `notices.insert(n)` 之后 —— 要自增 id),
循环结束后每 500 行一条多值 `INSERT`,与 `noticeLines.insertBatch` 同一套。
*理由:* `BillNoticeLineMapper` 头注写明逐条单发在云上 8~16s 且整段持锁。
~344 行 ≈ 1 条 SQL,对 `:517-521` 那段性能注释针对的 7000~8000 行明细行毫无影响;
`§5.9` 回填(`noticeLines.selectByYm`)在两批 flush 之后才读,顺序不变。

### §2.4 重新生成时怎么清

不需要写任何清理代码:`notices.delete(del)`(ym + `status in draft` + `notIn lockedTenants`)
一句连删单头、明细行、告警行。
*验证:* IT 里 generate 两次,第二次后 `bill_notice_warn` 总行数 = 第二次生成应有的行数
(不是两次之和),且无孤儿行。

### §2.5 旧数据

`warn` 列的 463 条留在原地、停止读写。三个月(2023-08 / 2023-10 / 2024-02)要各点一次
「重新生成」才有新告警,**在那之前这三个月的告警抽屉是空的** —— 这是不回填路线唯一的
可见代价,必须写进发版说明。

重生成零信息损失,四条实测:

| 判据 | 实测 |
|---|---|
| 非 draft 单会不会被覆盖 | 739 单里 732 draft;7 张 exported(租户 64/128/131,全在 2024-02)的 warn **全是 NULL**,且 `lockedTenants` 本来就跳过 |
| 审核轴拦不拦 | `review_state` 全表只有 `meters:2024-02` 一行,`BILL_NOTICES` 三个月都没有键 |
| 金额会不会变 | 最后一次导入 `import_log` = 2026-08-27,早于最后一次生成 2026-08-30。但 `auth_audit_log` 不记抄表与合同编辑,**这只是间接证据** —— 必须真跑前后快照比对(§8) |
| premise 会不会变 | 会,那正是 2026-09-23 修复的意图,不算 diff 失败 |

---

## §3 接口契约

### §3.1 DTO

```java
// dto/NoticeWarnDTO.java — 告警条目;一个汉字都不带,文案在前端 billNoticeWarnCopy.ts
public record NoticeWarnDTO(String code, String payload, String hint) {}
```

`BillNoticeDTO` 与 `BillNoticeDetailDTO` 里的 `String warn` **同批删掉**,换成
`List<NoticeWarnDTO> warns`(无告警时空数组,不是 null)。前端 `api/billNotices.ts:19` / `:62`
逐字跟上。

*不留过渡期的理由:* 消费者一共 12 处全在本仓(后端 7、前端 5),导出侧零引用
(`billNoticeExcel.ts` / `payBookLogic.ts` / `PayBookWindow.vue` 对 `warn` grep 无命中),
前后端同一次部署。留双写等于病根 A 原样活着,前端要同时维护两条渲染路径。

### §3.2 列表要什么

`list(ym)` 一次性把整月告警带出来,照抄 `lineCount` 那句的形状
(`BillNoticeService.java:1178-1184`):

```java
noticeWarns.selectList(new QueryWrapper<BillNoticeWarn>()
    .inSql("notice_id", "SELECT id FROM bill_notice WHERE ym = '" + ym + "'")
    .orderByAsc("id"))
```

(`ym` 已由 `requireYm` 正则校验。)按 `notice_id` 分组挂到各 DTO 上。

*为什么一次带出来:* 739 单 → ~344 行,一次查询;抽屉打开时再拉就多一次请求,而今天 warn 是
白送的,改结构化之后不带就是退步。
*硬约束:* 新查询一律 `selectList(wrapper)` / `inSql`,不许出现 `selectList(null)` ——
`QueryHygieneTest` 对它是**全等**断言,`BillNoticeService.java` 钉死 10。
*验证:* `QueryHygieneTest` 必须仍然全等(11 ≠ 10 就红)。

### §3.3 抽屉要什么

`detail(id)` 用 `eq("notice_id", id)` 取该单告警,填进 `BillNoticeDetailDTO.warns`。
*验证:* IT 里同一张单,列表的 `warns` 与明细的 `warns` 长度相等、逐项相等。

### §3.4 首页链路条

`DataHomeService:95-96` 的 `noticeWarn` 从「`warn != null` 的单数」改成
「该 ym 下在 `bill_notice_warn` 里有行的 notice 数」。
**口径仍是张数,`:330` 的文案「N 张有警告」一个字不改。**
*理由:* `DataHomeService.java:315-319` 已经用 METRIC-SOURCE-SPEC §1 的理由把首页钉成张数
而不是户数(屏上的户数是聚合后、且只算当前期别 tab 的数,首页要的是整月全期口径)。
改它是推翻一条带文字理由的既有裁定,要用户拍板。
*验证:* `DataHomeServiceTest.java:308` 是全等断言(`"295 张 · ¥4107986.54 · 183 张有警告"`),
重生成之后用**实跑出来**的数重新钉,不许估。

---

## §4 屏上呈现

### §4.1 走 FPAlertPanel,不做流内提示条

`FPAlertPanel.vue:1-5` 的注释是 2026-08-25 用户拍板:状态型告警统一收进右侧抽屉,
入口是位置固定的常驻 chip,**不做流内提示条**(顶动表格 + 清不掉 = 永久噪音)。
催缴单屏已经在用它(今天只有一组「本屏为旧快照」)。

契约逐字:
`AlertItem = { text, hint?, onClick? }`;
`AlertGroup = { key, title, desc, tone?, items, action? }`;组标题旁固定渲染 `items.length`。

**现成的够用**:七组 + 已有的「本屏为旧快照」组直接塞进同一个 `groups` 数组,组件一行不改。
不够用的只有一处,已在 §4.5 单独处理。

### §4.2 §6-3 怎么满足

§6-3:每组必须给「这是什么、不处理会怎样」+ 可执行动作;只报不给动作的不许进来。

七类进抽屉,每组一个 `action`(见 §1 各节的落点屏),动作只做**纯路由跳转**,
不做逐条目深链(`/meters` 今天完全不读 `route.query`,给它加深链是新功能)。
`W_TOTAL_NEGATIVE` 不进抽屉,文案表里写 `drawer: false` + `why`。

*验证:* 门禁 G3 —— `drawer:true` 的 code 必须 `desc`/`actionLabel`/`route` 三样非空;
`drawer:false` 的必须 `why` 非空且含 ≥6 个中文字符。

### §4.3 分组构造是纯函数

`buildNoticeAlertGroups(alerts) => AlertGroup[]` 写在 `utils/billNoticeLogic.ts`,
字段名直接对齐 `FPAlertPanel`,视图 `gs.push(...)` 不再转一层 ——
照抄 `poolLedgerLogic.ts:301-315` 的 `meterDiffGroup`(它的注释就是这么写的)。
*理由:* 纯函数才单测得动去重、排序、计数三件事。
组序 = `WARN_CODES` 常量数组序,不是构造序。

### §4.4 三个口径

| 落点 | 口径 | 今天 | 改成 |
|---|---|---|---|
| chip 计数 | **Σ 各组 items.length,无 items 的组按 1 计** | `BillNoticesView.vue:771` 传 `alertGroups.length`(组数) | `reduce((s,g)=>s+(g.items.length || 1), 0)` |
| KPI「警告户数」 | 聚合后、当前期别 tab 的**户数** | `tenantKpis(phaseRows)`,判据 `if (r.warn)` | 判据换成 `r.alerts.length > 0`,**口径不变** |
| 「仅看有警告」 | 聚合后的户行 | `:299` 判据 `!!r.warn` | `r.alerts.length > 0` |

chip 口径的出处:`FPAlertChip.vue:5-6` 注释「count 口径全站钉死 = 待处理条目数
(Σ 各组 items.length,无 items 的组按 1 计),不是组数」。今天催缴单屏只有一组一条,
数字碰巧相同,**从一组变成最多八组那一刻就错**。

⚠ `|| 1` 这个兜底不能省,本屏当场就要用上:现有那组「本屏为旧快照」在 `lastChangeText`
为空时 `items` 是空数组(`BillNoticesView.vue:180`),而 `FPAlertPanel` 对空 items 的组
照样渲染组头与 desc(`:47-52`)。按 `PoolLedgerView.vue:487` 那句不带兜底的公式抄,
抽屉里明明有一组东西、chip 却显示「无待处理」,用户点都不会点。
(`PoolLedgerView` 那句同样缺兜底,那是存量,本轮不顺手改。)

*验证:* 两组共 5 条告警时 chip 显示 5;一组 3 条 + 一组 items 为空时 chip 显示 **4**。

「仅看有警告」的两个 checkbox(`:861` 宽档、`:890` S 档筛选面板)绑的是**同一个 `warnOnly` ref**,
所以只改 `:299` 一处判据;`billNoticesNarrow.spec.ts:479-502` 两个用例分别盯着两处渲染。

**不做条目数上限、不做折叠。** 实测单户单月去重后最多 9 条。9 行是内容。

### §4.5 行尾「!」与明细抽屉

> **2026-09-23 改(照稿实现,画布「催缴单租户抽屉 · 整屏重设计」):明细抽屉那一路不再是「横幅」。**
> 告警从抽屉正文的整宽横条,改成**抽屉副标题行上的徽标**(一类一个,写明类名与条数),
> 点徽标才展开明细 + 落点链 + 时效句。理由是逐户核对:一个月要按「下一户」走一百多次,
> 告警这一户有、下一户没有,正文就整体上下弹。徽标长在本来就存在的那一行上 ⇒ 有无都不改高度。
> 真屏实测(旭化成有徽标 / 南宗没有):费项表顶边都在抽屉正文的 186 px 处。
> 机器判据在 `views/__tests__/billNoticeDrawerShape.spec.ts`(11 条,逐条破坏验证过)。
> **行尾「!」那一路没变**,仍是 `warnSummaryLines` 出的多行文本。


两处保留,文本改成按文案表合成的多行(**含** `W_TOTAL_NEGATIVE`,它的唯一落点就是这里)。
`:826` 的 KPI sub 文案「悬停行尾「!」看原文」要跟着改成指向抽屉的话 —— 否则它在说旧话。

**形状:一类一行 = 块头 + 该类的条目**,由 `billNoticeLogic.warnSummaryLines(alerts)` 独家出字。

```
表没挂上合同:A101旭化成水、旭化成二楼水1、旭化成二楼水2
合同没有起止日期:合同 S10-0062
```

三条硬约束(单测在 `billNoticeLogic.spec.ts`,四条全部破坏验证过):

1. **每一行都带块头。** 只列条目屏上就是几个光秃秃的名字 —— 2026-09-23 用户原话:
   每个租户的卡里面还是莫名其妙的提示。
2. **组序共用 `WARN_CODES`**,与 `buildNoticeAlertGroups` 同一份,不按入参顺序排。
3. **不复用 `buildNoticeAlertGroups`。** 它按 §6-3 滤掉 `drawer:false` 的类
   (今天是 `W_TOTAL_NEGATIVE`),而这两个落点要把这户的告警全部说完 ——
   滤掉就成了「亮着灯却没有字」。这条在单测里是一条独立断言。

条目文字本身仍只由 `WARN_COPY[code].fmt` 出,`warnSummaryLines` 不碰(§5.1 一份事实源)。
`W_TOTAL_NEGATIVE` 的条目就是块头本身,不复述成「X:X」。

---

## §5 文案规矩

### §5.1 一张表,一个事实源

全部文案住在 `frontend/src/utils/billNoticeWarnCopy.ts`:

```ts
export const WARN_CODES = ['W_METER_NO_CONTRACT', 'W_METER_BIND_STALE', ...] as const   // 顺序 = 屏上组序
export const WARN_COPY: Record<WarnCode, {
  title: string          // 屏上块头
  desc: string           // 这是什么、不处理会怎样
  fmt(payload: string, hint: string): string   // 条目整行的字:标签与值都由它出
  route: string          // 组动作跳哪一屏
  actionLabel: string
  drawer: boolean
  why?: string           // drawer:false 时必填:为什么不进抽屉
}>
```

**后端一个字都不拼。** 价目键中文名走 `paramDef(key)?.label`(`paramRegistry.ts`),
费项名走 `billFeeLabel` —— 这两张表已经是单一事实源,不在这里抄第二份。

**payload / hint 是实例数据,不是文案。** 它们可以含中文(表名「邓宇峰三车间电」)、
可以含小数点(「544.00」)。规矩是:**它们永远由 `fmt` 加标签之后才上屏**。
「场地未定:544.00」的根因是原串贴在了本该是文案的位置、没有标签 ——
禁形态只会逼人去掉小数位把事故藏起来,加标签才是根治。

### §5.2 五条机器判据

门禁文件:`frontend/src/utils/billNoticeWarnCopy.spec.ts`(被 `npm run test` 自动收进 CI,
不动 `ci.yml`)。骨架抄 `paramRegistry.spec.ts`(它解的就是同一个问题:键有中文名、
中文名里不许出现原始 key),只从 `anaCopyLint.spec.ts` 抄三个手法:
`[...s].length` 数码点、基线写死并注明只许改小、钉住尺子的元断言。

| # | 判据 | 怎么判 | 破坏验证 |
|---|---|---|---|
| **G1** | 不许出现原始标识符 | `title`/`desc`/`itemLabel`/`actionLabel` 跑 `FORBIDDEN`(逐字抄 `ParamRegistryTest.java:45` 的 `/(building:|rule:|meter:|tenant:|默认·所有月份|_)/`,再补一条「连续 ≥3 个 ASCII 小写字母」),白名单只放单位 `kVA`/`kWh`/`m²` | 把 `elec_sharp` 写进某个 desc → 红 |
| **G2** | 每一类都有词条,且没有孤儿词条 | `readFileSync` 读 `backend/.../WarnCode.java` 解析枚举常量,与 `Object.keys(WARN_COPY)` 做 `toEqual` 全等 | 加第九个常量不写文案 → 红;文案表多一个孤儿 → 红 |
| **G3** | §6-3 契约 | `drawer:true` → `desc`/`actionLabel`/`route` 非空;`drawer:false` → `why` 非空且含 ≥6 中文字符 | 把某组 `actionLabel` 置空 → 红 |
| **G4** | 分字段长度 | 码点计:`title` 4..12、`desc` 24..120、`actionLabel` ≤12 | 把某个 desc 砍到 10 字 → 红(**下限挡住写敷衍**,光有上限不会红) |
| **G5** | `fmt` 不许退化成「原样吐出 payload」 | 对 `drawer:true` 且声明了 payload 的 code,用**该 code 的合法探针值**调 `fmt`(如 `W_PRICE_MISSING` 用 `'elec_sharp'`、`W_ROOM_MISMATCH` 用 `'544'`、`W_PACKAGE_NO_POOL` 用 `'share_green_water'`),断言返回值 `!==` 探针、不以探针开头、且含 ≥1 个中文字符 | 把某条 `fmt` 改成 `p => p` → 红 |
| **G6** | **价目键 / 费项键必须查得到中文名**(闭集断言) | `W_PRICE_MISSING` 能产出的 7 个键逐个断言 `paramDef(k)?.label` 非空且 `!== k`;`W_PACKAGE_NO_POOL` 能产出的 feeKey 逐个断言 `billFeeLabel(k) !== k`;再断言 `fmt(k,'')` 的输出里不含连续 ≥3 个 ASCII 小写字母 | 从 `paramRegistry` 删掉 `elec_sharp` 的 label → 红;从 `BILL_FEE_LABEL` 删掉 `share_green_water` → 红 |

**G6 是整套门禁里唯一会为真实事故变红的判据,别把它当附属条。** 2026-09-23 对抗复查逐个
代入三起事故核过:

| 事故 | G1 | G5 | G6 | 真正会为它变红的 |
|---|---|---|---|---|
| `缺价 elec_sharp(2024-02)` | 绿(G1 只扫常量,这串是运行时 `?? key` 回落吐的) | 绿 | **红** | G6 |
| `rent_office` / `rent_dorm` 上屏 | 绿(同上) | 绿 | **红** | G6 |
| `场地未定:544.00` | 绿 | **绿**(该串本来就有中文标签、也不以探针开头) | 绿 | 落地第 9 步那条 IT:断言 `payload='999'`、`hint='IT场地电999'` **分两列存**,不拼串 |

所以:**G5 只防「退化写法」,不要在规范里声称它钉住了「场地未定:544.00」。**
那起事故的机制是「标签说的是场地,塞进去的是表名」—— 标签种类与取值种类对不上,
前端门禁看不见,只有把 payload/hint 分列落库的那条 IT 会为它红。

`elec_sharp` 与 `rent_office` 两起事故是同一个机制:`BILL_FEE_LABEL[k] ?? k` /
`paramDef(k)?.label ?? k` 这类回落在查不到时把原始键原样吐上屏(`billNoticeLogic.ts:17-18,36`
的注释白纸黑字记着这就是当时的机制)。回落本身要留(引擎加费项不丢行),所以 G6 用**闭集**
把「能产出的键」逐个钉死 —— 十几行,拦住三起里的两起。

**扫描面下限**(仓内三道后端门禁全有:`>=15` / `>=30` / `>150`;`anaCopyLint` 恰恰没有,
这一点不要照它抄):G2 里显式断言从 Java 解析出的常量数 `>= 8`,读不到文件要抛错而不是
返回空清单 —— 否则路径写错时门禁悄悄全绿。G6 同样要断言闭集非空(`keys.length === 7`),
否则哪天闭集来源改了,这条会退化成空循环、永远绿。

**跨端清单走「前端直接读 Java 源码」,不走人工拷 fixture。**
`reviewGateCoverage.spec.ts:21` 的 `backendKinds()` 已经这么干了(从 `frontend/src`
resolve 到仓库根读 `ReviewKind.java`)。`paramRegistry` 那一对靠人工从 `target/` 拷 fixture,
后端改了忘拷就没有任何东西变红 —— 那个洞不要再开一个。

### §5.3 后端那道弱门

`backend/src/test/java/com/park/demo3/arch/BillNoticeWarnTest.java`,抄 `QueryHygieneTest`
的「全等断言 + 存量基线」:

1. `WarnCode` 常量清单与写死的 `EXPECTED` **全等**(size 8)。
   *全等不是 ≤ 的理由,QueryHygieneTest 类注释已写:清理了也红一次,否则数字只会烂成
   一张没人信的假账,门禁跟着失效。*
2. 每个常量在 `BillNoticeService.java` 里作为产地**恰好出现 1 次**(注释行不计,比对前去空格)
   —— 防两种病共用一句话。
3. 扫描面下限 + 枚举常量名只含 `[A-Z_]`。

### §5.4 不建的两条,以及为什么

- **「不许出现像金额的形态」不建。** 它拦症状不拦根因(见 §5.1),且会误伤正当的房号。
- **「判据描述与代码判据一致」不建机器判据 —— 那会是一条假绿。**
  `undecided() = tokens>0 && cands>0 && candTokens>0 && hits==0` 与一句中文之间没有可计算的关系。
  改为:把每类的判据原文与 `BillNoticeService` 行号作为 javadoc 钉在 `WarnCode` 常量上,
  交给对抗复查这一步的人看。

### §5.5 屏上口径(沿用仓里既有三条)

- 写测量不写定性:`W_ROOM_MISMATCH` 只说「对不上」,不说是合同错还是表错
  —— `BillNoticeService.java:284-289` 已明确拒绝定性。
- 不提设计稿、不提 spec 编号。本规范里的 `§x.y` 一个都不许出现在屏上文案里。
- desc 说后果不说内部名词:`W_PACKAGE_NO_POOL` 的屏上话是「池的差额会虚高」,
  不是「包干行无公摊池锚点」。

---

## §6 迁移与回填

见 §2.1(DDL)与 §2.5(旧数据)。三条要点:

1. **迁移号只能是 V126。** 现有最大 `V125__session_revocation.sql`。一个号在任何库里被应用过
   就永久占用(`V121` 注释记录过实测:复用会报
   `Detected applied migration not resolved locally` / checksum mismatch)。
   迁移目录是 `backend/src/main/resources/db/migration/`,不是仓库根的 `db/migration/`。
2. **不写回滚。** 全仓无一条 DOWN/回滚段;可逆性靠正文一句话交代 —— 这里是
   「代码停止读写 warn 列,核对无误后下一个迁移再 DROP」。
3. **已确认 / 已导出的单怎么办:什么都不做。** `generate()` 的 `lockedTenants`
   (`:156-166`)本来就整户跳过它们,方案不得绕过这道闸。
   实测那 7 张 exported 单的 warn 全是 NULL,重生成对它们零影响。
   *验证:* 重生成后这 7 张单的 `id` 与 `generated_at` 一个字没动。

---

## §7 新增一类告警要做什么(清单)

下一个人加第九类时,漏任何一条都会有东西变红。按顺序走:

1. **`WarnCode` 加常量**,javadoc 里写清判据原文 + `BillNoticeService` 行号 + 对账单影响。
   → 不写常量:没法落库。
2. **`BillNoticeService` 加产地**,`warn(tid, CODE, payload, hint)` 一处,只能一处。
   → 加了两处:后端门禁 ②(产地计数全等 1)红。
3. **`BillNoticeWarnTest.EXPECTED` 加一行。**
   → 不加:后端门禁 ①(清单全等)红。
4. **`billNoticeWarnCopy.ts` 加词条**:`title` / `desc` / `fmt` /
   `route` / `actionLabel` / `drawer`(`drawer:false` 时连 `why` 一起)。
   → 不加:前端门禁 G2(双向全等)红。
5. **`WARN_CODES` 数组里放到该在的位置**(它定组序)。
   → 忘了:G2 红(数组与表键不一致)。
6. **文案自检**:不含原始标识符、长度在 §5.2 G4 的区间内、`fmt` 输出带中文标签。
   → 违反:G1 / G4 / G5 分别红。
6b. **新 code 的 payload 若来自某张字典表**(价目键、费项键一类),把它能产出的键闭集
   加进 G6。→ 不加:那条键将来查不到中文名时会原样上屏,而没有任何东西变红。
7. **落点屏必须已经存在**;不存在就先别加这一类,或者写 `drawer:false` + `why`。
   → 写了 `drawer:true` 却没 `route`:G3 红。
8. **实测一遍**:写一条 SQL 数出这一类在库里有多少条,填进本规范 §1 的新一节。
   → 库里 0 条不是不加的理由(`W_PRICE_MISSING` 就是 0 条),但**必须数过**。
9. **加一条 IT**:造出触发条件 → generate → `bill_notice_warn` 里恰好一行且三列对得上。

---

## §8 收口判据(数产物,不看退出码)

1. **重生成前后金额逐行相同。**
   前:`SELECT ym,tenant_id,notice_kind,total_amount FROM bill_notice ORDER BY 1,2,3` 存文件;
   后:再抓一次 `diff`。必须零差异。(`premise_text` 会变,不在这条判据里。)
   *为什么必须真跑:* `auth_audit_log` 不记抄表与合同编辑,「业务数据没动过」只是间接推断。
2. **7 张 exported 单未被覆盖**(id + `generated_at` 未变)。
3. **`bill_notice_warn` 的 code 全部落在八个枚举常量内,库里零汉字文案**
   (`SELECT DISTINCT code` 逐个比对;`payload`/`hint` 里的中文是实例数据,不在此条)。
4. **条数不设预期值。** 草案原本写「落在 ~344 的量级」,那个数是按旧形状「每户每类一条」
   算出来的;新形状按实例展开(一户 9 个房号 = 9 条),必然数倍于它。照那条判会把正常结果
   当成去重坏了。改为只断言结构:`SELECT code, COUNT(*) FROM bill_notice_warn GROUP BY code`
   八类各自的条数与 §1 各节「实测」一栏的**量级**对得上,且 `W_ROOM_MISMATCH` 的条数
   ≥ 户数(按实例展开的证据)。
5. **两道门禁各自逐条破坏验证过一次**(每条判据改坏一次,确认红,再改回来)。
6. **`QueryHygieneTest` 的 `BillNoticeService.java=10` 仍然全等。**
7. **`./mvnw -B verify`、`npm run test`、`npm run build` 三样各跑一次全量**
   (过程中只跑相关文件,全量留到收口)。
   ⚠ `npm run build` 这一条不能省:`billNoticeWriteGuards.spec.ts:75-95` 的夹具是**显式标注类型**的
   `BillNoticeDTO[]` / `BillNoticeDetailDTO`(文件头注自陈「按真实 DTO 声明」就是为了这种时候红),
   而 `tsconfig.app.json` 的 include 覆盖 `.spec.ts` —— 它红在 `vue-tsc` 那一步,
   只数 vitest 的 passed 数看不见它。

---

## §9 已实测但本轮不修的(留档)

- **124 户的告警从未上过屏。** 七类是**户级**判据,而 `warn` 挂在**单头**:没有任何行的租户
  不进 `groups`,`warnByTenant` 里的告警被静默丢弃。实测 136 份无起止日期合同覆盖 127 户,
  其中只有 3 户有单 —— 124 户的「缺起止日期」从未落过库。
  修它要 `notice_id` 可空 + 列表多一条「没有单的租户也要出行」的读路径,是改屏的信息架构,
  不是把口袋换成结构化。
- **户级七类被逐单复制 1.77 倍。** 结构化没让它变坏,也没趁机改。
- **三处零提示的少收:** `capacity_fee`(`:311`)、`water_pipe`(`:672`)、
  `mgmt_fee*`(`:650`)取价失败走裸 `return`/`continue`,与 `W_PRICE_MISSING` 同构却连一句话
  都没有。补它是新增类别,先写一条 SQL 数出来再决定。
- **`share_green_water` 的包干行 10/10 全部无锚点**,可能天然消不掉。该不该从 `W_PACKAGE_NO_POOL`
  里摘掉,需要用户拍板。
- **`BillNoticeGenResultDTO.warned` 把两种单位相加**(带 warn 单数 + 因锁定跳过的户数),
  连自己的 toast 文案都得加括号解释(`BillNoticesView.vue:534`)。这是第三个问题。
- **`FPAlertPanel` §6-3 对另外三个使用屏的存量违例**(`PoolLedgerView.vue:451-455` 已明文记在案)。
- **后端一重启就把在线的人踢下去。** 本轮重算三个月,每重启一次后端都要重新登录一次。
  机制已查实、与会话管理无关:`UserPermissionCache` 在 `ApplicationRunner` 里 reload,
  启动窗口内 `JwtAuthFilter` 对在线心跳直接 401,前端拦截器据此清掉本地凭据。
  实测佐证:被踢时 `auth_session` 那一行既没撤销也没过期。
  修它是启动期的就绪门(缓存装好之前不收请求 / 心跳 401 不清凭据),是另一件事,本轮不碰。


---

## §10 实施 plan(11 步,按依赖顺序;每步都能独立破坏验证)

对抗复查改过的地方标 ⚠。

| # | 做什么 | 主要文件 | 怎么验证 |
|---|---|---|---|
| 1 | `V126__bill_notice_warn.sql`:只建表,零回填。DDL 见 §2.1,含四条硬约束。⚠ 文件头注不要写「留一版当 undo」,按 §2.1 的真实说法写 | `db/migration/V126__bill_notice_warn.sql` | flyway migrate 后 `SHOW CREATE TABLE` 必须同时出现 `uk_warn(notice_id,code,payload)` 与 `ON DELETE CASCADE`。破坏验证:去掉 CASCADE → 第 2 步那条孤儿行断言红 |
| 2 | 后端结构化:`WarnCode.java`(9 常量,javadoc 钉判据原文 + 行号)、`BillNoticeWarn.java`、`BillNoticeWarnMapper.java`、改 `BillNoticeService`。⚠ 去重用 `LinkedHashMap` keyed by `code + ' ' + payload`,**不是**整条 record;⚠ `W_TERM_NO_PARAMS` 的 payload = 计费行 id | `service/WarnCode.java`、`entity/`、`mapper/`、`service/BillNoticeService.java` | 造 status=manual 的表 → generate → 恰好一行 `W_METER_NO_CONTRACT`。⚠ **必做**:造一份有两条同名缺参数计费行的合同 → generate **成功**且落 2 行(既不撞键、也不塌成 1 行)。破坏验证:payload 改回 `contract_no` → 该用例红(1062) |
| 3 | 后端弱门 `arch/BillNoticeWarnTest.java`(抄 `QueryHygieneTest` 的全等断言 + 扫描面下限) | `test/.../arch/BillNoticeWarnTest.java` | 加第九个常量不改 EXPECTED → 红;把某个 code 的产地复制成两处 → 红;把扫描路径写错 → 抛错而不是空清单 |
| 4 | 接口契约:`NoticeWarnDTO(code,payload,hint)`;两个 DTO 的 `String warn` → `List<NoticeWarnDTO> warns` | `dto/`、`BillNoticeService`、`DataHomeService` | 列表与明细的 warns 逐项相等;⚠ `QueryHygieneTest` 的 `BillNoticeService.java=10` 仍全等(新查询一律带 wrapper) |
| 5 | 前端文案表 `billNoticeWarnCopy.ts`:`WARN_CODES` + `WARN_COPY`。⚠ 无 `itemLabel` 字段,标签只由 `fmt` 出 | `frontend/src/utils/billNoticeWarnCopy.ts` | 第 7 步门禁全绿 |
| 6 | 前端逻辑:`NoticeLike.warn`/`TenantNoticeRow.warn` → `alerts: NoticeAlert[]`;聚合去重键 `${code}|${payload}`;按 `WARN_CODES` 序再按 payload numeric 序 | `frontend/src/utils/billNoticeLogic.ts` | 同户两张单的户级告警聚合后剩一条;两条 payload 不同的同 code 保留两条。破坏验证:去重键改回整条对象 → 第一条红 |
| 7 | 前端门禁 `billNoticeWarnCopy.spec.ts`:⚠ **六条**判据(G1–G6),G6 是闭集断言 | `frontend/src/utils/billNoticeWarnCopy.spec.ts` | 逐条破坏。⚠ G6 单独验:从 `paramRegistry` 删掉 `elec_sharp` 的 label → 红;从 `BILL_FEE_LABEL` 删掉 `share_green_water` → 红 |
| 8 | `BillNoticesView.vue` 接线。⚠ chip 计数 `reduce((s,g)=>s+(g.items.length || 1), 0)` | `frontend/src/views/bills/BillNoticesView.vue` | 两组共 5 条 → chip=5;⚠ 一组 3 条 + 一组 items 为空 → chip=**4**。破坏验证:去掉 `|| 1` → 后一条红 |
| 9 | 修红既有断言 | 见下方清单 | ⚠ 收口判据见 §8 第 7 条:**三样都要跑**(`mvnw verify` / `npm run test` / `npm run build`) |
| 10 | 重新生成 2023-08 / 2023-10 / 2024-02 三个月,前后对账 | — | ① `total_amount` 快照逐行相同(`premise_text` 会变,那是 2026-09-23 修复的意图);② 7 张 exported 单的 id 与 `generated_at` 一字未动;③ ⚠ 条数不设预期值,按 §8 第 4 条判结构 |
| 11 | 发版说明(RELEASE-NOTES-SPEC §2.1 判为功能更新,中间位) | `frontend/src/changelog.ts` | `changelog.spec` 自动查;正文必须写出代价:这三个月要各点一次「重新生成」,在那之前告警抽屉是空的 |

### 第 9 步:会被打红的断言(⚠ 草案漏了 5 处,已补齐)

| 文件:行 | 断言 | 怎么改 |
|---|---|---|
| `BillNoticeApiIT:399` / `:441` | `warned >= 1` | 口径不变,改查 `bill_notice_warn` 行数 |
| `BillNoticeApiIT:426` ⚠ | `.contains("负")` | 改断言 `code = W_TOTAL_NEGATIVE` |
| `BillNoticeApiIT:444` ⚠ | `.contains("未归属")` | 改断言 `code = W_METER_NO_CONTRACT` |
| `BillNoticeApiIT:564` ⚠ | `.contains("缺起止日期")` | 改断言 `code = W_CONTRACT_NO_DATES` |
| `BillNoticeApiIT:624-632` | `contains("房号对不上合同:999(表 IT场地电999)")` 且只出现一次 | 改断言 `code=W_ROOM_MISMATCH, payload='999', hint='IT场地电999'` **分三列**,且该 payload 只有一行。**这条是「场地未定:544.00」那起事故的指定判据**(§5.2) |
| `BillNoticeApiIT:630-634` ⚠ | `warnA.doesNotContain("收款公司")` | 改成断言 `bill_notice_warn` 里不存在任何与收款公司相关的 code。**不能顺手删** —— 它守的是「随时会变的判据不许冻进快照」(2026-09-23 配的防回归) |
| `billNoticeWriteGuards.spec.ts:75-95` ⚠ | 夹具显式标注 `BillNoticeDTO[]` / `BillNoticeDetailDTO` | 改字段。它红在 `vue-tsc`,不在 vitest |
| `billNoticeLogic.spec.ts:758-764` | 分号拆项 / 换行连接的行为断言 | 改成 alerts 数组的行为断言 |
| `billNoticesNarrow.spec.ts:479-502` | 「仅看有警告」两处渲染 | 改夹具 |
| ~~`DataHomeServiceTest:308`~~ ⚠ | ~~「183 张有警告」~~ | **删掉这项活**。`buildChain` 是纯函数、数是字面量传进去的,改口径它根本不会红;草案给它安排的「重新钉」是假绿 |

### 需要用户点头才做的两步

- **第 10 步**会真的重写这三个月的催缴单(739 张单里的 draft 部分)。已确认 / 已导出的单由
  `lockedTenants` 整户跳过,实测那 7 张 exported 的 warn 本来就是 NULL,零影响。
  但这是写真数据,动之前要说一声。
- **第 11 步**的版本号与公告按 RELEASE-NOTES-SPEC 走,要不要这一轮就发,由用户定。
