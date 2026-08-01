-- V83__frozen_params.sql — BOOK-REBUILD-SPEC §H3:二期 2023 遗留链「显式冻结参数 + 标注真实年月」。
--
-- 事实(原册图谱 §6.9 + 直读 二期2024年2月水电费.xlsx『公共电分摊』hidden sheet 复核):
--   这张隐藏表是 2023-04/05 的死模板(B1 写 2023年05月、B17 写 2023年04月、7 个合计行一律写
--   「2023年05月份合计：」),价格全部指向另一张隐藏表 厂房电!T10:T13(2023 价),与 2024 年现行的
--   二期园区电!AD10:AD13 是两套价,差约 17%。它并没有死透 —— 四格仍被 2024 年 2 月的租户 sheet 直接引用:
--     M99  = 0.005    r99 备注格手写的「路灯公摊单价」,被 46 处 2024-02 租户 sheet 引用
--                     (曹小芳!J16 = 公共电分摊!M99 → K16 = ROUND(0.005*3170.35,2) = 15.85)
--     M109 = 0.01     r109 备注格手写的「绿化水泵单价」,被 39 处引用
--     L24  = 205.39   六车间块「消防用电」段 = ROUND(J24/6,2),J24=1232.36 由 厂房电!E139/T10~T13 现算,
--                     K24='6层'(2023 的出租层数;系统 2024 池按 7 层)
--     L99  = 0.01     水泵、消防控制室段 = ROUND(J99/148918.01,2),J99=2129.26 同上由 2023 抄见值现算
--   曹小芳!I14 = ROUND(公共电分摊!L24 + 公共电分摊!L99*E16/0.7, 2) = 250.68
--            → K14 = ROUND(250.68*0.7,2) = 175.48 —— **2024年2月实收的这 175.48 元消防用电,
--              用的是 2023年04月抄见值和 2023 年电价**。
--
-- 本刀只做「说清楚」,不改金额:自动按 2024 年重算会改动已出的实收,需用户单独拍板(spec §H3)。
--
-- 落点为什么是 alloc_cfg 而不是 tenant_price_cfg(价目簿):这四个值不是价目输入,而是**绑定在具体池上
-- 的历史事实**;V62(用户 2026-07-27 拍板)已把五个月推单价键清出价目簿,且前端 PRICE_KEYS 注册表定格
-- 19 键并且是价目页渲染的唯一驱动 —— 塞回价目簿只会变成查不到也编辑不了的隐形行。见 PriceCfgService 头注。
-- acct_month='' (默认行)本身就是语义:**不随月份变 = 冻结**;真实年月写在 note 里。
-- cfg_key 'frozen_2023' 不被 AllocService 的任何 cfgVal 取用 → 引擎一格不动(红线)。
-- 消费方:公共电核算屏「分摊标准」列 title(poolLedgerLogic.FROZEN_CFG_KEY / FROZEN_HINT)。
--
-- 规则 id 硬编码沿用 V70 的写法;附 zone/fee_name 守卫,池若已被改挪则不插脏 scope。

INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, note)
SELECT CONCAT('rule:', r.id), 'frozen_2023', 0.005000, '',
       '冻结于 2023-05:二期2024年2月水电费.xlsx『公共电分摊』(hidden,2023-04/05 死模板) M99=0.005,r99 备注格手写路灯单价,被 46 处 2024-02 租户 sheet 直接引用(曹小芳!J16→K16=15.85)。2023 年的价,不是当月价。'
FROM alloc_rule r WHERE r.id = 18 AND r.zone = 'p2' AND r.fee_name = '路灯';

INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, note)
SELECT CONCAT('rule:', r.id), 'frozen_2023', 0.010000, '',
       '冻结于 2023-05:『公共电分摊』(hidden) M109=0.01,r109 备注格手写绿化水泵单价,被 39 处 2024-02 租户 sheet 直接引用。2023 年的价,不是当月价。'
FROM alloc_rule r WHERE r.id = 13 AND r.zone = 'p2' AND r.fee_name = '绿化水泵';

INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, note)
SELECT CONCAT('rule:', r.id), 'frozen_2023', 205.390000, '',
       '冻结于 2023-04:『公共电分摊』(hidden) L24=ROUND(J24/6,2)=205.39 元/层,六车间消防段;J24 由 厂房电!E139 抄见值×厂房电!T10~T13(2023 电价)现算,K24=6层。被 曹小芳!I14 等户表引用出 2024-02 实收。'
FROM alloc_rule r WHERE r.id = 20 AND r.zone = 'p2' AND r.fee_name = '消防';

INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, note)
SELECT CONCAT('rule:', r.id), 'frozen_2023', 0.010000, '',
       '冻结于 2023-04:『公共电分摊』(hidden) L99=ROUND(J99/148918.01,2)=0.01 元/㎡,水泵、消防控制室段;J99 由 厂房电!E256 抄见值×2023 电价现算。曹小芳!I14=ROUND(L24+L99*面积/0.7,2)→2024-02 实收 175.48。'
FROM alloc_rule r WHERE r.id = 4 AND r.zone = 'p2' AND r.fee_name = '消防水稳压泵';
